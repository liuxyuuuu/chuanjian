'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { analyzeHand, canBeat, HAND_TYPE } = require('../src/game/rules');
const { createCard } = require('../src/game/deck');
const { GameManager, PHASE } = require('../src/game/gameManager');
const RoomManager = require('../src/room/roomManager');

const card = (suit, rank) => createCard(suit, rank);
const hand = (...pairs) => pairs.map(([s, r]) => card(s, r));

test('three of a kind is a valid hand', () => {
  const a = analyzeHand(hand(['S', '7'], ['H', '7'], ['C', '7']));
  assert.strictEqual(a.type, HAND_TYPE.THREE);
  assert.strictEqual(a.length, 3);
});

test('666 small thunder / QQQ big thunder beat plain triple detection', () => {
  assert.strictEqual(analyzeHand(hand(['S', '6'], ['H', '6'], ['C', '6'])).type, HAND_TYPE.SMALL_THUNDER);
  assert.strictEqual(analyzeHand(hand(['S', 'Q'], ['H', 'Q'], ['C', 'Q'])).type, HAND_TYPE.BIG_THUNDER);
});

test('bomb must be a pure four of a kind; four-plus-one is invalid', () => {
  assert.strictEqual(analyzeHand(hand(['S', '5'], ['H', '5'], ['C', '5'], ['D', '5'])).type, HAND_TYPE.BOMB);
  assert.strictEqual(analyzeHand(hand(['S', '5'], ['H', '5'], ['C', '5'], ['D', '5'], ['S', '6'])).type, HAND_TYPE.INVALID);
});

test('canBeat null guard: anything can lead when there is no last play', () => {
  const single = analyzeHand(hand(['S', '7']));
  assert.strictEqual(canBeat(single, null), true);
});

test('normal hands can only beat the same type', () => {
  const single6 = analyzeHand(hand(['S', '6']));
  const single7 = analyzeHand(hand(['S', '7']));
  const pair5 = analyzeHand(hand(['S', '5'], ['H', '5']));
  const three7 = analyzeHand(hand(['S', '7'], ['H', '7'], ['C', '7']));
  const three8 = analyzeHand(hand(['S', '8'], ['H', '8'], ['C', '8']));
  assert.strictEqual(canBeat(single7, single6), true);
  assert.strictEqual(canBeat(single6, single7), false);
  assert.strictEqual(canBeat(pair5, single6), false);
  assert.strictEqual(canBeat(three8, three7), true);
  assert.strictEqual(canBeat(three7, pair5), false);
});

test('special hand power ordering', () => {
  const pair = analyzeHand(hand(['S', '5'], ['H', '5']));
  const bomb5 = analyzeHand(hand(['S', '5'], ['H', '5'], ['C', '5'], ['D', '5']));
  const bomb9 = analyzeHand(hand(['S', '9'], ['H', '9'], ['C', '9'], ['D', '9']));
  const sword = analyzeHand(hand(['S', '4'], ['H', '4'], ['S', 'A']));
  const small = analyzeHand(hand(['S', '6'], ['H', '6'], ['C', '6']));
  const big = analyzeHand(hand(['S', 'Q'], ['H', 'Q'], ['C', 'Q']));
  assert.strictEqual(canBeat(bomb5, pair), true);
  assert.strictEqual(canBeat(pair, bomb5), false);
  assert.strictEqual(canBeat(bomb9, bomb5), true);
  assert.strictEqual(canBeat(sword, pair), true);
  assert.strictEqual(canBeat(small, sword), true);
  assert.strictEqual(canBeat(big, small), true);
  assert.strictEqual(canBeat(sword, small), false);
});

test('straights only compare at equal length', () => {
  const s3 = analyzeHand(hand(['S', '5'], ['H', '6'], ['C', '7']));
  const s3b = analyzeHand(hand(['S', '6'], ['H', '7'], ['C', '8']));
  const s4 = analyzeHand(hand(['S', '5'], ['H', '6'], ['C', '7'], ['D', '8']));
  assert.strictEqual(canBeat(s3b, s3), true);
  assert.strictEqual(canBeat(s4, s3), false);
});

function makeGame() {
  const g = new GameManager('TEST');
  g.phase = PHASE.PLAYING;
  g.currentTurnIndex = 0;
  g.declarerIndex = 0;
  g.teammateIndex = 1;
  g.players = [0, 1, 2, 3].map(i => ({ nickname: 'p' + i, hand: [], finished: false, finishPosition: -1, isBot: false }));
  return g;
}

test('rejected play does not inflate bomb multiplier', () => {
  const g = makeGame();
  g.players[0].hand = hand(['S', '5'], ['H', '5'], ['C', '5'], ['D', '5']);
  g.lastPlay = { playerIndex: 1, cards: [], handAnalysis: analyzeHand(hand(['S', '9'], ['H', '9'], ['C', '9'], ['D', '9'])) };
  const res = g.playCards(0, ['S5', 'H5', 'C5', 'D5']);
  assert.strictEqual(res.success, false);
  assert.strictEqual(g.bombCount, 0);
});

test('accepted bomb increments multiplier', () => {
  const g = makeGame();
  g.players[0].hand = hand(['S', '5'], ['H', '5'], ['C', '5'], ['D', '5'], ['S', '8']);
  g.lastPlay = null;
  const res = g.playCards(0, ['S5', 'H5', 'C5', 'D5']);
  assert.strictEqual(res.success, true);
  assert.strictEqual(g.bombCount, 1);
});

test('roomManager.updateScores accumulates across rounds', () => {
  const rm = new RoomManager();
  const room = rm.createMatchRoom([
    { socketId: 'a', nickname: 'a' }, { socketId: 'b', nickname: 'b' },
    { socketId: 'c', nickname: 'c' }, { socketId: 'd', nickname: 'd' },
  ]);
  rm.updateScores(room.code, { 0: 2, 1: 2, 2: -2, 3: -2 });
  rm.updateScores(room.code, { 0: 1, 1: 1, 2: -1, 3: -1 });
  assert.deepStrictEqual(room.scores, [3, 3, -3, -3]);
});

test('mid-game disconnect keeps the seat and does not reindex', () => {
  const rm = new RoomManager();
  const r = rm.createRoom('s0', 'p0', '');
  rm.joinRoom(r.roomCode, 's1', 'p1', '');
  rm.joinRoom(r.roomCode, 's2', 'p2', '');
  rm.joinRoom(r.roomCode, 's3', 'p3', '');
  const room = rm.getRoom(r.roomCode);
  room.isPlaying = true;
  room.game = {};
  const res = rm.leaveRoom('s1');
  assert.strictEqual(res.action, 'player_disconnected_ingame');
  assert.strictEqual(room.players.length, 4);
  assert.strictEqual(room.players[1].disconnected, true);
  assert.strictEqual(room.players[1].index, 1);
});

test('pass marks persist after round reset until the next round\'s first play', () => {
  const g = new GameManager('r');
  g.players = [
    { nickname: 'p0', hand: hand(['S', '7'], ['S', '8']), finished: false, finishPosition: -1 },
    { nickname: 'p1', hand: hand(['H', '7']), finished: false, finishPosition: -1 },
    { nickname: 'p2', hand: hand(['C', '7']), finished: false, finishPosition: -1 },
    { nickname: 'p3', hand: hand(['D', '7']), finished: false, finishPosition: -1 },
  ];
  g.phase = PHASE.PLAYING;
  g.declarerIndex = 0;
  g.teammateIndex = 1;
  g.teammateRevealed = false;
  g.currentTurnIndex = 0;
  g.lastActiveIndex = 0;
  g.lastPlay = null;
  g.lastPlays = [null, null, null, null];
  g.passCount = 0;
  g.finishOrder = [];

  assert.strictEqual(g.playCards(0, ['S7']).success, true);
  assert.strictEqual(g.pass(1).success, true);
  assert.strictEqual(g.pass(2).success, true);
  const reset = g.pass(3);
  assert.strictEqual(reset.roundReset, true);

  // 全员过牌触发本轮重置后，出牌/“不出”标记不应被立即清空
  assert.strictEqual(g.lastPlay, null);
  assert.deepStrictEqual(g.lastPlays[0].cards, ['S7']);
  assert.strictEqual(g.lastPlays[1].passed, true);
  assert.strictEqual(g.lastPlays[2].passed, true);
  assert.strictEqual(g.lastPlays[3].passed, true);

  // 新一轮第一手牌打出时才统一清空，并写入新出牌者的牌
  assert.strictEqual(g.playCards(0, ['S8']).success, true);
  assert.deepStrictEqual(g.lastPlays[0].cards, ['S8']);
  assert.strictEqual(g.lastPlays[1], null);
  assert.strictEqual(g.lastPlays[2], null);
  assert.strictEqual(g.lastPlays[3], null);
});
