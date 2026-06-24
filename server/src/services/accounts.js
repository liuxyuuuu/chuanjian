'use strict';
const { db } = require('../db');
const config = require('../config');
const pwdUtil = require('../util/password');

const now = () => Date.now();

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
}

const getById = (id) => db.prepare('SELECT * FROM players WHERE id = ?').get(id) || null;
const getByLoginId = (loginId) => db.prepare('SELECT * FROM players WHERE login_id = ?').get(loginId) || null;

function publicView(p) {
  if (!p) return null;
  return { id: p.id, nickname: p.nickname, avatar: p.avatar, gold: p.gold, counterSeconds: p.counter_seconds, wins: p.wins, games: p.games };
}

function grantNewPlayerBonus(playerId) {
  const ts = now();
  db.prepare('UPDATE players SET gold = gold + ?, counter_seconds = counter_seconds + ? WHERE id = ?').run(config.economy.newPlayerGold, config.economy.newPlayerCounterSeconds, playerId);
  const p = getById(playerId);
  db.prepare('INSERT INTO gold_ledger (player_id, delta, balance_after, reason, ref, created_at) VALUES (?,?,?,?,?,?)').run(playerId, config.economy.newPlayerGold, p.gold, 'newbie_bonus', null, ts);
  db.prepare('INSERT INTO counter_ledger (player_id, delta, balance_after, reason, ref, created_at) VALUES (?,?,?,?,?,?)').run(playerId, config.economy.newPlayerCounterSeconds, p.counter_seconds, 'newbie_bonus', null, ts);
}

function register({ loginId, password, nickname }) {
  if (!/^\d{8,11}$/.test(loginId || '')) return { ok: false, reason: 'ID 必须为 8-11 位数字' };
  const pwd = String(password || '');
  if (pwd.length < 6 || pwd.length > 20) return { ok: false, reason: '密码需 6-20 位' };
  return tx(() => {
    if (getByLoginId(loginId)) return { ok: false, reason: '该 ID 已被注册' };
    const ts = now();
    const info = db.prepare('INSERT INTO players (login_id, pwd_hash, nickname, avatar, created_at, last_login) VALUES (?,?,?,?,?,?)').run(loginId, pwdUtil.hash(pwd), nickname || ('玩家' + loginId.slice(-4)), '\u{1F4B0}', ts, ts);
    const id = Number(info.lastInsertRowid);
    grantNewPlayerBonus(id);
    return { ok: true, player: getById(id) };
  });
}

function loginWithPassword({ loginId, password }) {
  const p = getByLoginId(loginId);
  if (!p || !p.pwd_hash) return { ok: false, reason: 'ID 或密码错误' };
  if (!pwdUtil.verify(String(password || ''), p.pwd_hash)) return { ok: false, reason: 'ID 或密码错误' };
  if (p.banned) return { ok: false, reason: '该账号已被封禁' };
  db.prepare('UPDATE players SET last_login = ? WHERE id = ?').run(now(), p.id);
  return { ok: true, player: getById(p.id) };
}

function addGold(playerId, delta, reason, ref, opts = {}) {
  const clampZero = opts.clampZero !== false;
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
    db.prepare('INSERT INTO gold_ledger (player_id, delta, balance_after, reason, ref, created_at) VALUES (?,?,?,?,?,?)').run(playerId, applied, next, reason, ref || null, now());
    return { ok: true, balance: next, applied };
  });
}

function addCounter(playerId, delta, reason, ref) {
  return tx(() => {
    const p = getById(playerId);
    if (!p) return { ok: false, balance: 0, applied: 0 };
    let applied = delta;
    let next = p.counter_seconds + delta;
    if (next < 0) { applied = -p.counter_seconds; next = 0; }
    db.prepare('UPDATE players SET counter_seconds = ? WHERE id = ?').run(next, playerId);
    db.prepare('INSERT INTO counter_ledger (player_id, delta, balance_after, reason, ref, created_at) VALUES (?,?,?,?,?,?)').run(playerId, applied, next, reason, ref || null, now());
    return { ok: true, balance: next, applied };
  });
}

function recordGame(playerId, won) {
  db.prepare('UPDATE players SET games = games + 1, wins = wins + ? WHERE id = ?').run(won ? 1 : 0, playerId);
}

function setProfile(playerId, { nickname, avatar }) {
  const p = getById(playerId);
  if (!p) return null;
  db.prepare('UPDATE players SET nickname = ?, avatar = ? WHERE id = ?').run(nickname || p.nickname, avatar || p.avatar, playerId);
  return getById(playerId);
}

function setBanned(playerId, banned) {
  db.prepare('UPDATE players SET banned = ? WHERE id = ?').run(banned ? 1 : 0, playerId);
}

module.exports = { tx, getById, getByLoginId, publicView, register, loginWithPassword, addGold, addCounter, recordGame, setProfile, setBanned };
