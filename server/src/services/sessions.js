'use strict';
const crypto = require('crypto');
const { db } = require('../db');
const config = require('../config');
const accounts = require('./accounts');

const now = () => Date.now();
const hash = (t) => crypto.createHash('sha256').update(t + config.sessionSecret).digest('hex');

// 为玩家签发会话令牌（返回明文 token，仅存哈希）
function issue(playerId) {
  const token = crypto.randomBytes(32).toString('hex');
  const ts = now();
  db.prepare('INSERT INTO sessions (token_hash, player_id, created_at, expire_at) VALUES (?,?,?,?)')
    .run(hash(token), playerId, ts, ts + config.sessionTtlMs);
  return token;
}

// 校验令牌 -> 返回 player（含滑动续期）；无效/过期返回 null
function validate(token) {
  if (!token || typeof token !== 'string') return null;
  const h = hash(token);
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(h);
  if (!row) return null;
  if (row.expire_at < now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
    return null;
  }
  // 滑动续期：剩余不足一半时续期
  if (row.expire_at - now() < config.sessionTtlMs / 2) {
    db.prepare('UPDATE sessions SET expire_at = ? WHERE token_hash = ?').run(now() + config.sessionTtlMs, h);
  }
  const player = accounts.getById(row.player_id);
  if (!player || player.banned) return null;
  return player;
}

function revoke(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
}

function cleanupExpired() {
  db.prepare('DELETE FROM sessions WHERE expire_at < ?').run(now());
}

module.exports = { issue, validate, revoke, cleanupExpired };
