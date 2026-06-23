'use strict';
const { db } = require('../db');
const config = require('../config');

const now = () => Date.now();

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  }
}

const getById = (id) => db.prepare('SELECT * FROM players WHERE id = ?').get(id) || null;
const getByOpenid = (openid) => db.prepare('SELECT * FROM players WHERE openid = ?').get(openid) || null;
const getByUnionid = (unionid) => db.prepare('SELECT * FROM players WHERE unionid = ?').get(unionid) || null;
const getByDevKey = (devKey) => db.prepare('SELECT * FROM players WHERE dev_key = ?').get(devKey) || null;

function publicView(p) {
  if (!p) return null;
  return {
    id: p.id,
    nickname: p.nickname,
    avatar: p.avatar,
    gold: p.gold,
    counterSeconds: p.counter_seconds,
    wins: p.wins,
    games: p.games,
  };
}

// 新手礼包（一次性）：在玩家刚插入时调用，幂等由调用处保证
function grantNewPlayerBonus(playerId) {
  const ts = now();
  db.prepare('UPDATE players SET gold = gold + ?, counter_seconds = counter_seconds + ? WHERE id = ?')
    .run(config.economy.newPlayerGold, config.economy.newPlayerCounterSeconds, playerId);
  const p = getById(playerId);
  db.prepare('INSERT INTO gold_ledger (player_id, delta, balance_after, reason, ref, created_at) VALUES (?,?,?,?,?,?)')
    .run(playerId, config.economy.newPlayerGold, p.gold, 'newbie_bonus', null, ts);
  db.prepare('INSERT INTO counter_ledger (player_id, delta, balance_after, reason, ref, created_at) VALUES (?,?,?,?,?,?)')
    .run(playerId, config.economy.newPlayerCounterSeconds, p.counter_seconds, 'newbie_bonus', null, ts);
}

// 微信 upsert：返回 { player, isNew }
function upsertWechat({ openid, unionid, nickname, avatar }) {
  return tx(() => {
    let p = null;
    if (unionid) p = getByUnionid(unionid);
    if (!p && openid) p = getByOpenid(openid);
    if (p) {
      db.prepare('UPDATE players SET nickname = ?, avatar = ?, last_login = ?, openid = COALESCE(openid, ?), unionid = COALESCE(unionid, ?) WHERE id = ?')
        .run(nickname || p.nickname, avatar || p.avatar, now(), openid || null, unionid || null, p.id);
      return { player: getById(p.id), isNew: false };
    }
    const ts = now();
    const info = db.prepare('INSERT INTO players (unionid, openid, nickname, avatar, created_at, last_login) VALUES (?,?,?,?,?,?)')
      .run(unionid || null, openid || null, nickname || '微信玩家', avatar || '', ts, ts);
    const id = Number(info.lastInsertRowid);
    grantNewPlayerBonus(id);
    return { player: getById(id), isNew: true };
  });
}

// 开发用模拟账号：以 devKey 唯一标识
function upsertDev({ devKey, nickname, avatar }) {
  return tx(() => {
    let p = getByDevKey(devKey);
    if (p) {
      db.prepare('UPDATE players SET nickname = ?, avatar = ?, last_login = ? WHERE id = ?')
        .run(nickname || p.nickname, avatar || p.avatar, now(), p.id);
      return { player: getById(p.id), isNew: false };
    }
    const ts = now();
    const info = db.prepare('INSERT INTO players (dev_key, nickname, avatar, created_at, last_login) VALUES (?,?,?,?,?)')
      .run(devKey, nickname || ('玩家' + devKey.slice(0, 4)), avatar || '🙂', ts, ts);
    const id = Number(info.lastInsertRowid);
    grantNewPlayerBonus(id);
    return { player: getById(id), isNew: true };
  });
}

// 原子金币变动；spend 为负数。clampZero=true 时余额不会低于 0。
// 返回 { ok, balance, applied }
function addGold(playerId, delta, reason, ref, opts = {}) {
  const clampZero = opts.clampZero !== false; // 默认不允许负余额
  return tx(() => {
    const p = getById(playerId);
    if (!p) return { ok: false, balance: 0, applied: 0 };
    let applied = delta;
    let next = p.gold + delta;
    if (next < 0) {
      if (clampZero) { applied = -p.gold; next = 0; }
      else return { ok: false, balance: p.gold, applied: 0 };
    }
    db.prepare('UPDATE players SET gold = ? WHERE id = ?').run(next, playerId);
    db.prepare('INSERT INTO gold_ledger (player_id, delta, balance_after, reason, ref, created_at) VALUES (?,?,?,?,?,?)')
      .run(playerId, applied, next, reason, ref || null, now());
    return { ok: true, balance: next, applied };
  });
}

// 原子记牌器时长变动（秒）。余额不会低于 0。
function addCounter(playerId, delta, reason, ref) {
  return tx(() => {
    const p = getById(playerId);
    if (!p) return { ok: false, balance: 0, applied: 0 };
    let applied = delta;
    let next = p.counter_seconds + delta;
    if (next < 0) { applied = -p.counter_seconds; next = 0; }
    db.prepare('UPDATE players SET counter_seconds = ? WHERE id = ?').run(next, playerId);
    db.prepare('INSERT INTO counter_ledger (player_id, delta, balance_after, reason, ref, created_at) VALUES (?,?,?,?,?,?)')
      .run(playerId, applied, next, reason, ref || null, now());
    return { ok: true, balance: next, applied };
  });
}

function recordGame(playerId, won) {
  db.prepare('UPDATE players SET games = games + 1, wins = wins + ? WHERE id = ?').run(won ? 1 : 0, playerId);
}

function setProfile(playerId, { nickname, avatar }) {
  const p = getById(playerId);
  if (!p) return null;
  db.prepare('UPDATE players SET nickname = ?, avatar = ? WHERE id = ?')
    .run(nickname || p.nickname, avatar || p.avatar, playerId);
  return getById(playerId);
}

function setBanned(playerId, banned) {
  db.prepare('UPDATE players SET banned = ? WHERE id = ?').run(banned ? 1 : 0, playerId);
}

module.exports = {
  tx,
  getById, getByOpenid, getByUnionid, getByDevKey,
  publicView,
  upsertWechat, upsertDev,
  addGold, addCounter, recordGame, setProfile, setBanned,
};
