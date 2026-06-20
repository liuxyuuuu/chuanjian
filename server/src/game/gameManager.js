const { v4: uuidv4 } = require('uuid');
const { dealCards, devDealCards, sortCards, removeCards, cardDisplay, RANK_ORDER } = require('./deck');
const { analyzeHand, canBeat, HAND_TYPE } = require('./rules');

const PHASE = {
  WAITING: 'waiting',
  CALL: 'call',
  PLAYING: 'playing',
  FINISHED: 'finished'
};

class GameManager {
  constructor(roomId) {
    this.id = uuidv4();
    this.roomId = roomId;
    this.players = [];
    this.phase = PHASE.WAITING;
    this.declarerIndex = -1;
    this.calledCardId = null;
    this.calledCardRank = null;
    this.teammateIndex = -1;
    this.teammateRevealed = false;
    this.currentTurnIndex = -1;
    this.lastPlay = null;
    this.passCount = 0;
    this.lastActiveIndex = -1;
    this.lastPlays = [null, null, null, null];
    this.finishOrder = [];
    this.seats = [];
  }

  start(players) {
    if (players.length !== 4) return false;
    this.players = players.map(p => ({ ...p, hand: [], finished: false, finishPosition: -1 }));
    const hands = dealCards();
    this.players.forEach((p, i) => { p.hand = sortCards(hands[i]); });
    const heart4Index = this.players.findIndex(p => p.hand.some(c => c.id === 'H4'));
    this.declarerIndex = heart4Index >= 0 ? heart4Index : 0;
    if (heart4Index < 0) {
      this.players[0].hand.push({ id: 'H4', suit: 'H', rank: '4', value: RANK_ORDER['4'], suit_order: 3 });
      this.players[0].hand = sortCards(this.players[0].hand);
    }
    this.seats = [0, 1, 2, 3].map(i => (this.declarerIndex + i) % 4);
    this.phase = PHASE.CALL;
    return { gameId: this.id, declarerIndex: this.declarerIndex, declarerNickname: this.players[this.declarerIndex].nickname, phase: PHASE.CALL };
  }

  callCard(playerIndex, cardId) {
    if (this.phase !== PHASE.CALL) return { success: false, reason: '不是叫牌阶段' };
    if (playerIndex !== this.declarerIndex) return { success: false, reason: '不是叫牌玩家' };
    if (this.players[playerIndex].hand.some(c => c.id === cardId)) return { success: false, reason: '必须叫一张自己没有的牌' };
    const [suit, rank] = [cardId[0], cardId.slice(1)];
    if (!['S', 'H', 'C', 'D'].includes(suit) || !RANK_ORDER[rank]) return { success: false, reason: '无效的牌' };
    this.calledCardId = cardId;
    this.calledCardRank = rank;
    this.teammateIndex = this.players.findIndex(p => p.hand.some(c => c.id === cardId));
    this.phase = PHASE.PLAYING;
    this.currentTurnIndex = this.declarerIndex;
    this.lastActiveIndex = this.declarerIndex;
    return { success: true, calledCard: cardId, teammateIndex: this.teammateIndex, teammateNickname: this.players[this.teammateIndex].nickname, currentTurn: this.currentTurnIndex };
  }

  playCards(playerIndex, cardIds) {
    if (this.phase !== PHASE.PLAYING) return { success: false, reason: '不是出牌阶段' };
    if (playerIndex !== this.currentTurnIndex) return { success: false, reason: '不是你的回合' };
    const player = this.players[playerIndex];
    if (player.finished) return { success: false, reason: '已经出完牌了' };
    const handIds = new Set(player.hand.map(c => c.id));
    for (const id of cardIds) { if (!handIds.has(id)) return { success: false, reason: '没有牌 ' + id }; }
    const cards = cardIds.map(id => player.hand.find(c => c.id === id));
    const handAnalysis = analyzeHand(cards);
    if (handAnalysis.type === HAND_TYPE.INVALID) return { success: false, reason: '无效牌型' };
    if (this.lastPlay && !canBeat(handAnalysis, this.lastPlay.handAnalysis)) return { success: false, reason: '管不上' };
    let teammateJustRevealed = false;
    const calledCardPlayed = cards.some(c => c.id === this.calledCardId);
    if (calledCardPlayed && !this.teammateRevealed) { this.teammateRevealed = true; teammateJustRevealed = true; }
    player.hand = removeCards(player.hand, cardIds);
    this.lastPlay = { playerIndex, cards: cards.map(c => c.id), handAnalysis };
    this.lastPlays[playerIndex] = { cards: cards.map(c => c.id), handAnalysis };
    this.lastActiveIndex = playerIndex;
    this.passCount = 0;
    let justFinished = false;
    if (player.hand.length === 0) {
      player.finished = true;
      player.finishPosition = this.finishOrder.length + 1;
      this.finishOrder.push(playerIndex);
      justFinished = true;
      const remaining = this.players.filter(p => !p.finished);
      if (remaining.length <= 1) {
        if (remaining.length === 1) {
          remaining[0].finished = true;
          remaining[0].finishPosition = this.finishOrder.length + 1;
          this.finishOrder.push(this.players.indexOf(remaining[0]));
        }
        this.phase = PHASE.FINISHED;
        this.currentTurnIndex = -1;
      } else {
        this.advanceTurn();
      }
    } else {
      this.advanceTurn();
    }
    const r = { success: true, playerIndex, cards: cards.map(c => ({ id: c.id, suit: c.suit, rank: c.rank })), handAnalysis, justFinished, finishPosition: justFinished ? player.finishPosition : null, finishOrder: justFinished ? [...this.finishOrder] : null, currentTurn: this.currentTurnIndex, teammateJustRevealed };
    if (teammateJustRevealed) { r.teammateIndex = this.teammateIndex; r.teammateNickname = this.players[this.teammateIndex].nickname; }
    if (this.phase === PHASE.FINISHED) { r.gameOver = true; r.result = this.getResult(); }
    return r;
  }

  pass(playerIndex) {
    if (this.phase !== PHASE.PLAYING) return { success: false, reason: '不是出牌阶段' };
    if (playerIndex !== this.currentTurnIndex) return { success: false, reason: '不是你的回合' };
    if (!this.lastPlay) return { success: false, reason: '你是本轮第一个出牌，不能过' };
    this.passCount++;
    if (this.passCount >= 3) {
      this.lastPlay = null;
      this.lastPlays = [null, null, null, null];
      this.passCount = 0;
      this.currentTurnIndex = this.lastActiveIndex;
      // 如果最后出牌的人已经出完，跳到下一个没出完的
      if (this.players[this.currentTurnIndex].finished) {
        this.advanceTurn();
      }
      return { success: true, playerIndex, passed: true, roundReset: true, currentTurn: this.currentTurnIndex };
    }
    this.advanceTurn();
    return { success: true, playerIndex, passed: true, roundReset: false, currentTurn: this.currentTurnIndex };
  }

  advanceTurn() {
    let next = (this.currentTurnIndex + 1) % 4;
    let attempts = 0;
    while (this.players[next].finished && attempts < 4) { next = (next + 1) % 4; attempts++; }
    this.currentTurnIndex = next;
  }

  getResult() {
    const team1 = [this.declarerIndex, this.teammateIndex];
    const team2 = [0, 1, 2, 3].filter(i => !team1.includes(i));
    const team1Pos = team1.map(i => this.players[i].finishPosition);
    const team2Pos = team2.map(i => this.players[i].finishPosition);
    const t1b = Math.min(...team1Pos), t1w = Math.max(...team1Pos);
    const t2b = Math.min(...team2Pos), t2w = Math.max(...team2Pos);
    let s1 = 0, s2 = 0;
    if (t1b === 1 && t1w === 2) { s1 = 4; s2 = -4; }  // 每名队员+2
    else if (t1b === 1 && t1w === 3) { s1 = 2; s2 = -2; }  // 每名队员+1
    else if (t1b === 1 && t1w === 4) { s1 = 0; s2 = 0; }   // 平局
    else if (t2b === 1 && t2w === 2) { s2 = 4; s1 = -4; }
    else if (t2b === 1 && t2w === 3) { s2 = 2; s1 = -2; }
    else if (t2b === 1 && t2w === 4) { s2 = 0; s1 = 0; }
    const perPlayerScores = {};
    this.finishOrder.forEach(pIdx => {
      const isTeam1 = team1.includes(pIdx);
      perPlayerScores[pIdx] = (isTeam1 ? s1 : s2) / 2;
    });
    return { finishOrder: [...this.finishOrder], team1, team2, team1Score: s1, team2Score: s2, perPlayerScores, details: this.finishOrder.map((pIdx, pos) => ({ position: pos + 1, nickname: this.players[pIdx].nickname, isDeclarer: pIdx === this.declarerIndex, isTeammate: pIdx === this.teammateIndex, score: perPlayerScores[pIdx] })) };
  }

  // 开发者模式：给玩家0发剑+雷+炸
  startDevMode(players) {
    if (players.length !== 4) return false;
    this.players = players.map(p => ({ ...p, hand: [], finished: false, finishPosition: -1 }));
    const hands = devDealCards();
    this.players.forEach((p, i) => { p.hand = sortCards(hands[i]); });
    this.declarerIndex = 0;
    this.seats = [0, 1, 2, 3].map(i => (this.declarerIndex + i) % 4);
    this.phase = PHASE.CALL;
    return { gameId: this.id, declarerIndex: this.declarerIndex, declarerNickname: this.players[0].nickname, phase: PHASE.CALL };
  }

  getPlayerHand(playerIndex) { return this.players[playerIndex].hand; }

  getGameState(forPlayerIndex) {
    return {
      gameId: this.id,
      phase: this.phase,
      players: this.players.map((p, i) => ({
        index: i, nickname: p.nickname, avatar: p.avatar || "", cardCount: p.hand.length, finished: p.finished, finishPosition: p.finishPosition,
        isDeclarer: i === this.declarerIndex, isTeammate: this.teammateRevealed && i === this.teammateIndex,
        isBot: p.isBot || false
      })),
      declarerIndex: this.declarerIndex,
      currentTurn: this.currentTurnIndex,
      lastPlay: this.lastPlay ? { playerIndex: this.lastPlay.playerIndex, cards: this.lastPlay.cards, handAnalysis: this.lastPlay.handAnalysis } : null,
      passCount: this.passCount,
      teammateRevealed: this.teammateRevealed,
      lastPlays: this.lastPlays.map(lp => lp ? { cards: lp.cards, handAnalysis: lp.handAnalysis } : null),
      calledCard: this.calledCardId,
      finishOrder: this.finishOrder.length > 0 ? [...this.finishOrder] : null,
      myHand: forPlayerIndex >= 0 ? this.players[forPlayerIndex].hand : [],
      myIndex: forPlayerIndex >= 0 ? forPlayerIndex : -1,
      result: this.phase === PHASE.FINISHED ? this.getResult() : undefined
    };
  }
}

module.exports = { GameManager, PHASE };
