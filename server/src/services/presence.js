'use strict';
// 在线状态：playerId -> Set(socketId)
const map = new Map();

function add(playerId, socketId) {
  if (!playerId) return;
  if (!map.has(playerId)) map.set(playerId, new Set());
  map.get(playerId).add(socketId);
}

function remove(playerId, socketId) {
  if (!playerId || !map.has(playerId)) return;
  const s = map.get(playerId);
  s.delete(socketId);
  if (s.size === 0) map.delete(playerId);
}

function isOnline(playerId) {
  return map.has(playerId) && map.get(playerId).size > 0;
}

function onlineCount() { return map.size; }
function onlineIds() { return Array.from(map.keys()); }

module.exports = { add, remove, isOnline, onlineCount, onlineIds };
