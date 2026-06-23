const { v4: uuidv4 } = require('uuid');
const { dealCards, sortCards, removeCards, cardDisplay, RANK_ORDER } = require('./deck');
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
    this.bombCount = 0;
    this.seats = [];
  }

  start(players) {
    if (players.length !== 4) return false;
    this.players = players.map(p => ({ ...p, hand: [], finished: false, finishPosition: -1 }));
    const hands = dealCards();
    this.players.forEach((p, i) => { p.hand = sortCards(hands[i]); });
    const heart4Index = this.players.findIndex(p => p.hand.some(c => c.id === 'H4'));
    this.declarerIndex = heart4Index >= 0 ? heart4Index : 0;
    // 满 52 张发牌时红桃4 必被发出；此处仅作防御，不再注入多余牌（避免出现第 14 张）。
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
    // 校验通过、确定本次出牌生效后再累加炸弹倍数（避免被拒绝的出牌污染倍数）
    if (handAnalysis.type === HAND_TYPE.BOMB) this.bombCount++;
    let teammateJustRevealed = false;
    const calledCardPlayed = cards.some(c => c.id === this.calledCardId);
    if (calledCardPlayed && !this.teammateRevealed) { this.teammateRevealed = true; teammateJustRevealed = true; }
    player.hand = removeCards(player.hand, cardIds);
    // 新一轮的第一手牌打出时，才清空上一轮所有人的出牌区（含“不出”标记），
    // 让出牌/过牌的显示规则一致：保留到本轮重置或被新牌覆盖。
    if (this.lastPlay === null) this.lastPlays = [null, null, null, null];
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
        var _earlyEnd = false;
        if (this.finishOrder.length >= 2) {
          var _t1 = [this.declarerIndex, this.teammateIndex];
          var _t2 = [];
          for (var _ti = 0; _ti < 4; _ti++) {
            if (_ti !== this.declarerIndex && _ti !== this.teammateIndex) _t2.push(_ti);
          }
          var _t1f = 0, _t2f = 0;
          for (var _fi = 0; _fi < _t1.length; _fi++) { if (this.players[_t1[_fi]].finished) _t1f++; }
          for (var _fi = 0; _fi < _t2.length; _fi++) { if (this.players[_t2[_fi]].finished) _t2f++; }
          if (_t1f === 2 || _t2f === 2) {
            _earlyEnd = true;
            remaining.forEach(function(p) {
              p.finished = true;
              p.finishPosition = this.finishOrder.length + 1;
              this.finishOrder.push(this.players.indexOf(p));
            }.bind(this));
            this.phase = PHASE.FINISHED;
            this.currentTurnIndex = -1;
          }
        }
        if (!_earlyEnd) {
          var tm = this.teammateRevealed ? this.getPlayerTeammate(playerIndex) : null;
          if (tm !== null && !this.players[tm].finished) {
            this.currentTurnIndex = tm;
          } else {
            this.advanceTurn();
          }
        }
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
    // 记录“不出”，让该玩家的出牌区像出牌一样保留到本轮重置
    this.lastPlays[playerIndex] = { passed: true };
    var activePlayers = this.players.filter(function(p){ return !p.finished; }).length;
    if (this.passCount >= Math.max(1, activePlayers - 1)) {
      this.lastPlay = null;
      // 不在此刻清空 lastPlays：保留所有人的出牌/“不出”标记，
      // 直到新一轮第一手牌打出时（playCards 中）再统一清空。
      this.passCount = 0;
      this.currentTurnIndex = this.lastActiveIndex;
      // 接风: teammate gets lead only if revealed, otherwise order
      if (this.players[this.currentTurnIndex].finished) {
        var tm2 = this.teammateRevealed ? this.getPlayerTeammate(this.lastActiveIndex) : null;
        if (tm2 !== null && !this.players[tm2].finished) {
          this.currentTurnIndex = tm2;
        } else {
          this.advanceTurn();
        }
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

  getPlayerTeammate(playerIndex) {
    if (this.declarerIndex === undefined || this.teammateIndex === undefined || this.teammateIndex === -1) return null;
    if (playerIndex === this.declarerIndex) return this.teammateIndex;
    if (playerIndex === this.teammateIndex) return this.declarerIndex;
    var team2 = [0,1,2,3].filter(function(i){ return i !== this.declarerIndex && i !== this.teammateIndex; }.bind(this));
    return team2.find(function(i){ return i !== playerIndex; }) || null;
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
    const multiplier = Math.pow(2, this.bombCount);
    const perPlayerScores = {};
    this.finishOrder.forEach(pIdx => {
      const isTeam1 = team1.includes(pIdx);
      perPlayerScores[pIdx] = ((isTeam1 ? s1 : s2) / 2) * multiplier;
    });
    var remainingCards = this.players.map(function(p, i) { return { playerIndex: i, nickname: p.nickname, cards: p.hand.map(function(c) { return c.id; }) }; }).filter(function(r) { return r.cards.length > 0; });
    return { finishOrder: [...this.finishOrder], team1, team2, team1Score: s1 * multiplier, team2Score: s2 * multiplier, bombCount: this.bombCount, multiplier, perPlayerScores, remainingCards: remainingCards, details: this.finishOrder.map((pIdx, pos) => ({ position: pos + 1, nickname: this.players[pIdx].nickname, isDeclarer: pIdx === this.declarerIndex, isTeammate: pIdx === this.teammateIndex, score: (perPlayerScores[pIdx] / multiplier), bombMultiplier: multiplier })) };
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
      teammateIndex: this.teammateRevealed ? this.teammateIndex : undefined,
      lastPlay: this.lastPlay ? { playerIndex: this.lastPlay.playerIndex, cards: this.lastPlay.cards, handAnalysis: this.lastPlay.handAnalysis } : null,
      passCount: this.passCount,
      teammateRevealed: this.teammateRevealed,
      lastPlays: this.lastPlays.map(lp => lp ? { cards: lp.cards, handAnalysis: lp.handAnalysis, passed: lp.passed } : null),
      calledCard: this.calledCardId,
      bombCount: this.bombCount,
      finishOrder: this.finishOrder.length > 0 ? [...this.finishOrder] : null,
      myHand: forPlayerIndex >= 0 ? this.players[forPlayerIndex].hand : [],
      myIndex: forPlayerIndex >= 0 ? forPlayerIndex : -1,
      result: this.phase === PHASE.FINISHED ? this.getResult() : undefined
    };
  }
}

module.exports = { GameManager, PHASE };
