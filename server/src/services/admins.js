'use strict';
const crypto = require('crypto');
const { db } = require('../db');
const config = require('../config');

const now = () => Date.now();
const ADMIN_TTL_MS = 12 * 3600 * 1000;
const tokenHash = (t) => crypto.createHash('sha256').update('admin:' + t + config.sessionSecret).digest('hex');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, salt, derived] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !derived) return false;
    const test = crypto.scryptSync(password, salt, 32);
    const ref = Buffer.from(derived, 'hex');
    return test.length === ref.length && crypto.timingSafeEqual(test, ref);
  } catch (e) { return false; }
}

function getByUsername(username) {
  return db.prepare('SELECT * FROM admins WHERE username = ?').get(username) || null;
}

function createAdmin(username, password, role = 'admin') {
  const ts = now();
  const info = db.prepare('INSERT INTO admins (username, pwd_hash, role, created_at) VALUES (?,?,?,?)')
    .run(username, hashPassword(password), role, ts);
  return Number(info.lastInsertRowid);
}

// 首次启动若无管理员则种入默认管理员
function seedDefault() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
  if (count === 0) {
    createAdmin(config.defaultAdmin.username, config.defaultAdmin.password, 'superadmin');
    console.log(`[admin] 已创建默认管理员: ${config.defaultAdmin.username}（请尽快修改密码）`);
  }
}

function login(username, password) {
  const a = getByUsername(username);
  if (!a) return null;
  if (!verifyPassword(password, a.pwd_hash)) return null;
  db.prepare('UPDATE admins SET last_login = ? WHERE id = ?').run(now(), a.id);
  const token = crypto.randomBytes(32).toString('hex');
  const ts = now();
  db.prepare('INSERT INTO admin_sessions (token_hash, admin_id, created_at, expire_at) VALUES (?,?,?,?)')
    .run(tokenHash(token), a.id, ts, ts + ADMIN_TTL_MS);
  return { token, admin: { id: a.id, username: a.username, role: a.role } };
}

function validate(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM admin_sessions WHERE token_hash = ?').get(tokenHash(token));
  if (!row) return null;
  if (row.expire_at < now()) { db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash(token)); return null; }
  const a = db.prepare('SELECT id, username, role FROM admins WHERE id = ?').get(row.admin_id);
  return a || null;
}

function logout(token) {
  if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash(token));
}

function audit(adminId, action, detail) {
  db.prepare('INSERT INTO admin_audit (admin_id, action, detail, created_at) VALUES (?,?,?,?)')
    .run(adminId, action, detail ? JSON.stringify(detail) : null, now());
}

module.exports = { seedDefault, login, validate, logout, createAdmin, getByUsername, audit, hashPassword, verifyPassword };
