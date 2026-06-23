'use strict';
const { db } = require('../db');
const accounts = require('./accounts');
const now = () => Date.now();

function send(playerId, { title, body, gold = 0, counter = 0, expireAt = 0 }) {
  const info = db.prepare(
    'INSERT INTO mail (player_id, title, body, gold_attach, counter_attach, expire_at, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(playerId, title, body || '', gold | 0, counter | 0, expireAt | 0, now());
  return Number(info.lastInsertRowid);
}

// 群发：给所有玩家各插一行
function broadcast({ title, body, gold = 0, counter = 0, expireAt = 0 }) {
  const ids = db.prepare('SELECT id FROM players').all();
  const stmt = db.prepare('INSERT INTO mail (player_id, title, body, gold_attach, counter_attach, expire_at, created_at) VALUES (?,?,?,?,?,?,?)');
  const ts = now();
  let n = 0;
  for (const r of ids) { stmt.run(r.id, title, body || '', gold | 0, counter | 0, expireAt | 0, ts); n++; }
  return n;
}

function listForPlayer(playerId) {
  return db.prepare('SELECT * FROM mail WHERE player_id = ? ORDER BY created_at DESC LIMIT 100').all(playerId)
    .map(m => ({
      id: m.id, title: m.title, body: m.body,
      gold: m.gold_attach, counter: m.counter_attach,
      read: !!m.is_read, claimed: !!m.claimed, createdAt: m.created_at,
      hasAttach: m.gold_attach > 0 || m.counter_attach > 0,
    }));
}

function unreadCount(playerId) {
  return db.prepare('SELECT COUNT(*) AS c FROM mail WHERE player_id = ? AND (is_read = 0 OR (claimed = 0 AND (gold_attach > 0 OR counter_attach > 0)))')
    .get(playerId).c;
}

function markRead(playerId, mailId) {
  db.prepare('UPDATE mail SET is_read = 1 WHERE id = ? AND player_id = ?').run(mailId, playerId);
}

// 领取附件：先原子置 claimed=1（防重复），成功后再发放
function claim(playerId, mailId) {
  const info = db.prepare('UPDATE mail SET claimed = 1, is_read = 1 WHERE id = ? AND player_id = ? AND claimed = 0')
    .run(mailId, playerId);
  if (info.changes !== 1) return { ok: false, reason: '已领取或不存在' };
  const m = db.prepare('SELECT * FROM mail WHERE id = ?').get(mailId);
  if (m.gold_attach > 0) accounts.addGold(playerId, m.gold_attach, 'mail_claim', 'mail:' + mailId);
  if (m.counter_attach > 0) accounts.addCounter(playerId, m.counter_attach, 'mail_claim', 'mail:' + mailId);
  return { ok: true, gold: m.gold_attach, counter: m.counter_attach };
}

module.exports = { send, broadcast, listForPlayer, unreadCount, markRead, claim };
