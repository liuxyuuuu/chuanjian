'use strict';
const express = require('express');
const path = require('path');
const { db } = require('../db');
const accounts = require('../services/accounts');
const admins = require('../services/admins');
const mail = require('../services/mail');
const announcements = require('../services/announcements');

function buildRouter(deps) {
  const presence = deps.presence;
  const router = express.Router();
  router.use(express.json());

  function adminAuth(req, res, next) {
    const h = req.headers['authorization'] || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    const admin = admins.validate(token);
    if (!admin) return res.status(401).json({ success: false, reason: '未登录' });
    req.admin = admin;
    req.adminToken = token;
    next();
  }

  // 后台页面
  router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
  });

  router.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    const r = admins.login(username || '', password || '');
    if (!r) return res.status(401).json({ success: false, reason: '用户名或密码错误' });
    res.json({ success: true, token: r.token, admin: r.admin });
  });

  router.post('/api/logout', adminAuth, (req, res) => {
    admins.logout(req.adminToken);
    res.json({ success: true });
  });

  router.get('/api/me', adminAuth, (req, res) => {
    res.json({ success: true, admin: req.admin });
  });

  router.get('/api/stats', adminAuth, (req, res) => {
    const total = db.prepare('SELECT COUNT(*) AS c FROM players').get().c;
    res.json({ success: true, totalPlayers: total, online: presence.onlineCount() });
  });

  // 玩家列表（搜索 + 分页）
  router.get('/api/players', adminAuth, (req, res) => {
    const q = (req.query.search || '').trim();
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const size = Math.min(100, Math.max(1, parseInt(req.query.size || '20', 10)));
    const offset = (page - 1) * size;
    let where = '';
    let params = [];
    if (q) {
      where = 'WHERE nickname LIKE ? OR openid LIKE ? OR unionid LIKE ? OR CAST(id AS TEXT) = ?';
      params = [`%${q}%`, `%${q}%`, `%${q}%`, q];
    }
    const total = db.prepare(`SELECT COUNT(*) AS c FROM players ${where}`).get(...params).c;
    const rows = db.prepare(`SELECT * FROM players ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
    const list = rows.map(p => ({
      id: p.id, nickname: p.nickname, avatar: p.avatar,
      openid: p.openid, unionid: p.unionid, devKey: p.dev_key,
      gold: p.gold, counterSeconds: p.counter_seconds,
      wins: p.wins, games: p.games, banned: !!p.banned,
      online: presence.isOnline(p.id),
      createdAt: p.created_at, lastLogin: p.last_login,
    }));
    res.json({ success: true, total, page, size, list });
  });

  router.post('/api/players/:id/gold', adminAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const delta = parseInt(req.body && req.body.delta, 10) || 0;
    const reason = (req.body && req.body.reason) || 'admin_adjust';
    const r = accounts.addGold(id, delta, 'admin:' + reason, 'admin:' + req.admin.id, { clampZero: true });
    admins.audit(req.admin.id, 'adjust_gold', { playerId: id, delta, reason });
    res.json({ success: r.ok, player: accounts.publicView(accounts.getById(id)) });
  });

  router.post('/api/players/:id/counter', adminAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const delta = parseInt(req.body && req.body.delta, 10) || 0;
    accounts.addCounter(id, delta, 'admin_adjust', 'admin:' + req.admin.id);
    admins.audit(req.admin.id, 'adjust_counter', { playerId: id, delta });
    res.json({ success: true, player: accounts.publicView(accounts.getById(id)) });
  });

  router.post('/api/players/:id/ban', adminAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const banned = !!(req.body && req.body.banned);
    accounts.setBanned(id, banned);
    admins.audit(req.admin.id, 'set_banned', { playerId: id, banned });
    res.json({ success: true });
  });

  router.post('/api/mail/send', adminAuth, (req, res) => {
    const { playerId, broadcast, title, body, gold, counter } = req.body || {};
    if (!title) return res.json({ success: false, reason: '缺少标题' });
    const payload = { title, body, gold: parseInt(gold, 10) || 0, counter: parseInt(counter, 10) || 0 };
    let n = 0;
    if (broadcast) n = mail.broadcast(payload);
    else if (playerId) { mail.send(parseInt(playerId, 10), payload); n = 1; }
    else return res.json({ success: false, reason: '需指定玩家或群发' });
    admins.audit(req.admin.id, 'send_mail', { broadcast: !!broadcast, playerId, title });
    res.json({ success: true, count: n });
  });

  router.get('/api/announcements', adminAuth, (req, res) => {
    res.json({ success: true, list: announcements.listAll() });
  });
  router.post('/api/announcements', adminAuth, (req, res) => {
    const { title, body } = req.body || {};
    if (!title) return res.json({ success: false, reason: '缺少标题' });
    const id = announcements.create({ title, body });
    admins.audit(req.admin.id, 'create_announcement', { id, title });
    res.json({ success: true, id });
  });
  router.post('/api/announcements/:id/active', adminAuth, (req, res) => {
    announcements.setActive(parseInt(req.params.id, 10), !!(req.body && req.body.active));
    res.json({ success: true });
  });
  router.delete('/api/announcements/:id', adminAuth, (req, res) => {
    announcements.remove(parseInt(req.params.id, 10));
    res.json({ success: true });
  });

  router.post('/api/admins', adminAuth, (req, res) => {
    if (req.admin.role !== 'superadmin') return res.status(403).json({ success: false, reason: '需要超级管理员' });
    const { username, password, role } = req.body || {};
    if (!username || !password) return res.json({ success: false, reason: '缺少用户名或密码' });
    if (admins.getByUsername(username)) return res.json({ success: false, reason: '用户名已存在' });
    const id = admins.createAdmin(username, password, role || 'admin');
    admins.audit(req.admin.id, 'create_admin', { id, username });
    res.json({ success: true, id });
  });

  return router;
}

module.exports = { buildRouter };
