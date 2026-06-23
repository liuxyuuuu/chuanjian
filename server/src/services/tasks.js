'use strict';
const { db } = require('../db');
const accounts = require('./accounts');
const now = () => Date.now();

// 任务定义（可调）。type: daily（每日0点重置）/ achievement（累计一次性）
const TASKS = [
  { id: 'daily_login', type: 'daily', title: '每日登录', goal: 1, gold: 500, counter: 0 },
  { id: 'daily_match_play', type: 'daily', title: '完成 1 局在线匹配', goal: 1, gold: 300, counter: 0 },
  { id: 'daily_match_win', type: 'daily', title: '在线匹配胜 1 局', goal: 1, gold: 0, counter: 1800 },
  { id: 'daily_play3', type: 'daily', title: '完成 3 局（任意模式）', goal: 3, gold: 500, counter: 0 },
  { id: 'ach_first_win', type: 'achievement', title: '首胜', goal: 1, gold: 2000, counter: 0 },
  { id: 'ach_win10', type: 'achievement', title: '累计 10 胜', goal: 10, gold: 0, counter: 7200 },
  { id: 'ach_games100', type: 'achievement', title: '累计 100 局', goal: 100, gold: 5000, counter: 0 },
];
const byId = Object.fromEntries(TASKS.map(t => [t.id, t]));

// 以 Asia/Shanghai（UTC+8）计算每日 period key
function dailyKey() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function periodKey(type) { return type === 'daily' ? dailyKey() : 'all'; }

function getRow(playerId, task) {
  const pk = periodKey(task.type);
  return db.prepare('SELECT * FROM player_tasks WHERE player_id = ? AND task_id = ? AND period_key = ?')
    .get(playerId, task.id, pk);
}

function ensureRow(playerId, task) {
  const pk = periodKey(task.type);
  let row = getRow(playerId, task);
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO player_tasks (player_id, task_id, period_key, progress, claimed, updated_at) VALUES (?,?,?,0,0,?)')
      .run(playerId, task.id, pk, now());
    row = getRow(playerId, task);
  }
  return row;
}

function bump(playerId, taskId, amount = 1) {
  const task = byId[taskId];
  if (!task) return;
  ensureRow(playerId, task);
  const pk = periodKey(task.type);
  db.prepare('UPDATE player_tasks SET progress = MIN(progress + ?, ?), updated_at = ? WHERE player_id = ? AND task_id = ? AND period_key = ?')
    .run(amount, task.goal, now(), playerId, taskId, pk);
}

function getForPlayer(playerId) {
  return TASKS.map(t => {
    const row = getRow(playerId, t);
    const progress = row ? row.progress : 0;
    const claimed = row ? !!row.claimed : false;
    return {
      id: t.id, type: t.type, title: t.title, goal: t.goal,
      gold: t.gold, counter: t.counter,
      progress, claimed, done: progress >= t.goal,
    };
  });
}

function claim(playerId, taskId) {
  const task = byId[taskId];
  if (!task) return { ok: false, reason: '任务不存在' };
  const pk = periodKey(task.type);
  ensureRow(playerId, task);
  const info = db.prepare('UPDATE player_tasks SET claimed = 1 WHERE player_id = ? AND task_id = ? AND period_key = ? AND claimed = 0 AND progress >= ?')
    .run(playerId, taskId, pk, task.goal);
  if (info.changes !== 1) return { ok: false, reason: '未完成或已领取' };
  if (task.gold > 0) accounts.addGold(playerId, task.gold, 'task_reward', taskId);
  if (task.counter > 0) accounts.addCounter(playerId, task.counter, 'task_reward', taskId);
  return { ok: true, gold: task.gold, counter: task.counter };
}

// 事件钩子
function onLogin(playerId) { bump(playerId, 'daily_login', 1); }
function onGamePlayed(playerId, { won, isMatch }) {
  bump(playerId, 'daily_play3', 1);
  bump(playerId, 'ach_games100', 1);
  if (won) { bump(playerId, 'ach_first_win', 1); bump(playerId, 'ach_win10', 1); }
  if (isMatch) { bump(playerId, 'daily_match_play', 1); if (won) bump(playerId, 'daily_match_win', 1); }
}

module.exports = { TASKS, getForPlayer, bump, claim, onLogin, onGamePlayed };
