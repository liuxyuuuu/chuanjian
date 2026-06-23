'use strict';
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

const db = new DatabaseSync(config.dbPath);

// 基础 pragma
try { db.exec('PRAGMA journal_mode = WAL;'); } catch (e) { /* ignore */ }
try { db.exec('PRAGMA foreign_keys = ON;'); } catch (e) { /* ignore */ }

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unionid TEXT UNIQUE,
      openid TEXT UNIQUE,
      dev_key TEXT UNIQUE,
      nickname TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      gold INTEGER NOT NULL DEFAULT 0,
      counter_seconds INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      games INTEGER NOT NULL DEFAULT 0,
      banned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_login INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      player_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expire_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);

    CREATE TABLE IF NOT EXISTS gold_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gold_player ON gold_ledger(player_id);

    CREATE TABLE IF NOT EXISTS counter_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_counter_player ON counter_ledger(player_id);

    CREATE TABLE IF NOT EXISTS mail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      gold_attach INTEGER NOT NULL DEFAULT 0,
      counter_attach INTEGER NOT NULL DEFAULT 0,
      is_read INTEGER NOT NULL DEFAULT 0,
      claimed INTEGER NOT NULL DEFAULT 0,
      expire_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mail_player ON mail(player_id);

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS player_tasks (
      player_id INTEGER NOT NULL,
      task_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      claimed INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, task_id, period_key)
    );

    CREATE TABLE IF NOT EXISTS match_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      players_json TEXT NOT NULL,
      result_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      pwd_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at INTEGER NOT NULL,
      last_login INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expire_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
  `);
}

migrate();

module.exports = { db, migrate };
