/**
 * TeamDeduction Module - 团队推断系统
 * 通过观察出牌行为推断谁和谁一队，实现隐队友协作。
 */

// 证据权重配置
const EVIDENCE_WEIGHTS = {
  PASS_ON_BEATABLE: 0.18,
  BEAT: -0.12,
  FEED_SMALL_CARD: 0.15,
  COVER_FINISH: 0.25,
  CALL_CARD_REVEAL: 1.0,
  REPEATED_BEAT: -0.20,
  LET_FINISH: -0.30,
  CONSECUTIVE_PASS: 0.12,
};

class TeamTracker {
  /**
   * @param {number} playerIndex - 此追踪器所属的玩家
   * @param {Object} gameState - { declarerIndex, calledCard, teammateRevealed, teammateIndex }
   */
  constructor(playerIndex, gameState) {
    this.playerIndex = playerIndex;
    this.declarerIndex = (gameState && gameState.declarerIndex !== undefined) ? gameState.declarerIndex : -1;
    this.calledCard = (gameState && gameState.calledCard) || null;
    this.teammateKnown = false;
    this.teammateIndex = -1;

    // 信念分数: 对每个其他玩家 [-1, +1]
    this.scores = {};
    for (let i = 0; i < 4; i++) {
      if (i !== playerIndex) this.scores[i] = 0;
    }
    this.evidence = [];

    // 如果我是庄家且队友已揭晓
    if (gameState && gameState.teammateRevealed && gameState.teammateIndex !== undefined) {
      this.setKnownTeammate(gameState.teammateIndex);
    }
  }

  setKnownTeammate(tmIdx) {
    this.teammateKnown = true;
    this.teammateIndex = tmIdx;
    for (let i = 0; i < 4; i++) {
      if (i !== this.playerIndex) {
        this.scores[i] = (i === tmIdx) ? 1.0 : -1.0;
      }
    }
  }

  observeAction(action) {
    if (!action || action.actor === undefined) return;
    if (action.actor === this.playerIndex) return;
    if (this.teammateKnown) return;

    const actor = action.actor;
    const target = action.target;

    switch (action.type) {
      case 'pass':
        if (target !== undefined) {
          this.adjustScore(actor, EVIDENCE_WEIGHTS.PASS_ON_BEATABLE);
          this.addEvidence('P' + actor + ' 不压 P' + target + ' -> 可能是队友(+)');
        }
        break;
      case 'play':
        if (action.calledCardPlayed) {
          this.setKnownTeammate(actor);
          this.addEvidence('P' + actor + ' 打出叫牌 ' + (action.calledCard || '') + ' -> 确定是队友!');
        }
        if (action.isFinish) {
          this.addEvidence('P' + actor + ' 出完所有牌');
        }
        break;
      case 'beat':
        if (target !== undefined) {
          this.adjustScore(actor, EVIDENCE_WEIGHTS.BEAT);
          this.addEvidence('P' + actor + ' 压 P' + target + ' -> 敌对(−)');
          if (target === this.declarerIndex) {
            this.adjustScore(actor, EVIDENCE_WEIGHTS.REPEATED_BEAT);
            this.addEvidence('P' + actor + ' 压庄家 -> 很可能是对手');
          }
        }
        break;
    }
  }

  adjustScore(playerIdx, weight) {
    if (playerIdx === this.playerIndex || this.teammateKnown) return;
    this.scores[playerIdx] = Math.max(-1, Math.min(1, (this.scores[playerIdx] || 0) + weight));
  }

  addEvidence(text) {
    this.evidence.push(text);
    if (this.evidence.length > 20) this.evidence.shift();
  }

  getBestGuess() {
    if (this.teammateKnown) {
      return { teammate: this.teammateIndex, confidence: 100, known: true, evidence: this.evidence.slice(-5) };
    }
    let bestPlayer = null, bestScore = -999;
    for (const [p, score] of Object.entries(this.scores)) {
      if (score > bestScore) { bestScore = score; bestPlayer = parseInt(p); }
    }
    const confidence = bestScore > 0 ? Math.min(100, Math.round(bestScore / 0.5 * 100)) : 0;
    return { teammate: bestPlayer, confidence, known: false, evidence: this.evidence.slice(-5) };
  }

  serialize() {
    return {
      playerIndex: this.playerIndex,
      declarerIndex: this.declarerIndex,
      calledCard: this.calledCard,
      teammateKnown: this.teammateKnown,
      teammateIndex: this.teammateIndex,
      scores: { ...this.scores },
      evidence: [...this.evidence],
      guess: this.getBestGuess(),
    };
  }
}

function createTeamTracker(playerIndex, gameState) {
  return new TeamTracker(playerIndex, gameState);
}

function updateAllTrackers(trackers, gameState, lastAction) {
  if (!trackers || !lastAction) return;
  for (const [idx, tracker] of Object.entries(trackers)) {
    if (tracker) tracker.observeAction(lastAction);
  }
}

module.exports = { TeamTracker, createTeamTracker, updateAllTrackers, EVIDENCE_WEIGHTS };