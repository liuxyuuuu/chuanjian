'use strict';
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const accounts = require('../services/accounts');
const sessions = require('../services/sessions');
const mail = require('../services/mail');
const announcements = require('../services/announcements');
const tasks = require('../services/tasks');
const wechat = require('../auth/wechat');

function meView(player) {
  return {
    ...accounts.publicView(player),
    unreadMail: mail.unreadCount(player.id),
  };
}

function authMiddleware(req, res, next) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || '');
  const player = sessions.validate(token);
  if (!player) return res.status(401).json({ success: false, reason: '未登录' });
  req.player = player;
  req.token = token;
  next();
}

function buildRouter() {
  const router = express.Router();
  router.use(express.json());

  // 公共配置：前端据此决定显示哪种登录
  router.get('/config', (req, res) => {
    res.json({ wechatEnabled: false, allowDevLogin: false, registerMode: true });
  });

  // 注册（纯数字 8-10 位 ID + 密码）：注册成功即登录
  router.post('/auth/register', (req, res) => {
    const { loginId, password } = req.body || {};
    const r = accounts.register({ loginId, password });
    if (!r.ok) return res.json({ success: false, reason: r.reason });
    tasks.onLogin(r.player.id);
    const token = sessions.issue(r.player.id);
    res.json({ success: true, token, player: meView(accounts.getById(r.player.id)) });
  });

  // 登录（ID + 密码）
  router.post('/auth/login', (req, res) => {
    const { loginId, password } = req.body || {};
    const r = accounts.loginWithPassword({ loginId, password });
    if (!r.ok) return res.json({ success: false, reason: r.reason });
    tasks.onLogin(r.player.id);
    const token = sessions.issue(r.player.id);
    res.json({ success: true, token, player: meView(accounts.getById(r.player.id)) });
  });

  // 开发模拟登录（生产可关闭）
  router.post('/auth/dev-login', (req, res) => {
    if (!config.allowDevLogin) return res.status(403).json({ success: false, reason: '已禁用模拟登录' });
    const { nickname, avatar } = req.body || {};
    let devKey = (req.body && req.body.devKey) || '';
    if (!devKey) devKey = 'dev_' + crypto.randomBytes(8).toString('hex');
    const { player, isNew } = accounts.upsertDev({ devKey, nickname, avatar });
    tasks.onLogin(player.id);
    const token = sessions.issue(player.id);
    res.json({ success: true, token, devKey, isNew, player: meView(accounts.getById(player.id)) });
  });

  // 微信网页授权：跳转
  router.get('/auth/wechat', (req, res) => {
    if (!config.wechat.enabled) return res.status(503).send('wechat not configured');
    const state = crypto.randomBytes(8).toString('hex');
    res.redirect(wechat.buildAuthorizeUrl(state));
  });

  // 微信网页授权：回调
  router.get('/auth/wechat/callback', async (req, res) => {
    try {
      const code = req.query.code;
      if (!code) return res.status(400).send('missing code');
      const profile = await wechat.loginWithCode(code);
      const { player } = accounts.upsertWechat(profile);
      tasks.onLogin(player.id);
      const token = sessions.issue(player.id);
      // 带令牌跳回前端，前端取出后存入 localStorage 并清理 URL
      res.redirect('/?token=' + encodeURIComponent(token));
    } catch (e) {
      res.status(500).send('微信登录失败: ' + e.message);
    }
  });

  router.get('/me', authMiddleware, (req, res) => {
    res.json({ success: true, player: meView(req.player) });
  });

  router.post('/logout', authMiddleware, (req, res) => {
    sessions.revoke(req.token);
    res.json({ success: true });
  });

  // 更新资料（昵称/头像）
  router.post('/profile', authMiddleware, (req, res) => {
    const { nickname, avatar } = req.body || {};
    accounts.setProfile(req.player.id, { nickname, avatar });
    res.json({ success: true, player: meView(accounts.getById(req.player.id)) });
  });

  router.get('/announcements', (req, res) => {
    res.json({ success: true, list: announcements.listActive() });
  });

  router.get('/mail', authMiddleware, (req, res) => {
    res.json({ success: true, list: mail.listForPlayer(req.player.id), unread: mail.unreadCount(req.player.id) });
  });
  router.post('/mail/:id/read', authMiddleware, (req, res) => {
    mail.markRead(req.player.id, parseInt(req.params.id, 10));
    res.json({ success: true });
  });
  router.post('/mail/:id/claim', authMiddleware, (req, res) => {
    const r = mail.claim(req.player.id, parseInt(req.params.id, 10));
    res.json({ success: r.ok, reason: r.reason, gold: r.gold, counter: r.counter, player: meView(accounts.getById(req.player.id)) });
  });

  router.get('/shop/counter', (req, res) => {
    res.json({ success: true, items: config.economy.counterShop });
  });
  router.post('/shop/counter/buy', authMiddleware, (req, res) => {
    const id = req.body && req.body.id;
    const item = config.economy.counterShop.find(i => i.id === id);
    if (!item) return res.json({ success: false, reason: '商品不存在' });
    const p = accounts.getById(req.player.id);
    if (p.gold < item.gold) return res.json({ success: false, reason: '金币不足' });
    accounts.addGold(p.id, -item.gold, 'shop_counter', item.id);
    accounts.addCounter(p.id, item.seconds, 'shop_counter', item.id);
    res.json({ success: true, player: meView(accounts.getById(p.id)) });
  });

  router.get('/tasks', authMiddleware, (req, res) => {
    res.json({ success: true, list: tasks.getForPlayer(req.player.id) });
  });
  router.post('/tasks/:id/claim', authMiddleware, (req, res) => {
    const r = tasks.claim(req.player.id, req.params.id);
    res.json({ success: r.ok, reason: r.reason, gold: r.gold, counter: r.counter, player: meView(accounts.getById(req.player.id)) });
  });

  return router;
}

module.exports = { buildRouter, authMiddleware, meView };
