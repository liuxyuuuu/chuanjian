'use strict';
const { db } = require('../db');
const now = () => Date.now();

function listActive() {
  return db.prepare('SELECT id, title, body, created_at FROM announcements WHERE active = 1 ORDER BY created_at DESC LIMIT 50')
    .all().map(a => ({ id: a.id, title: a.title, body: a.body, createdAt: a.created_at }));
}

function listAll() {
  return db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 200').all();
}

function create({ title, body }) {
  const info = db.prepare('INSERT INTO announcements (title, body, active, created_at) VALUES (?,?,1,?)')
    .run(title, body || '', now());
  return Number(info.lastInsertRowid);
}

function setActive(id, active) {
  db.prepare('UPDATE announcements SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}

function remove(id) {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
}

module.exports = { listActive, listAll, create, setActive, remove };
