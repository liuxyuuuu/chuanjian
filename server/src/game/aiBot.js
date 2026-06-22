/**
 * aiBot.js - Team-aware bot AI (rule-based, no LLM)
 *
 * Uses TeamDeduction belief tracking + rule engine for card decisions.
 * Falls back to mediumBot when team info is unavailable.
 *
 * Exports: aiCallCard, aiPlayCards, checkAiAvailable, AI_CONFIG
 */

const { sortCards, RANK_ORDER, SUIT_NAMES } = require('./deck');
const { analyzeHand, canBeat, HAND_TYPE } = require('./rules');
const { TeamTracker } = require('./teamDeduction');

// ===== Constants =====
const SUIT_SYMBOLS = { S: '♠', H: '♥', C: '♣', D: '♦' };
const RANK_VALUES = { '3': 15, '2': 14, 'A': 13, 'K': 12, 'Q': 11, 'J': 10, '10': 9, '9': 8, '8': 7, '7': 6, '6': 5, '5': 4, '4': 3 };
const TYPE_NAMES = { single: 'single', pair: 'pair', straight: 'straight', consecutive_pairs: 'consecutive_pairs', three_one: 'three_one', three_two: 'three_two', sword_44a: 'sword_44a', small_thunder: 'small_thunder', big_thunder: 'big_thunder', bomb: 'bomb' };

const AI_CONFIG = { provider: 'rule', model: 'team-rule-v1' };

// ===== Helpers (from botAi.js) =====
function findPairs(sorted) {
  const pairs = [];
  let i = 0;
  while (i < sorted.length - 1) {
    if (sorted[i].value === sorted[i+1].value) {
      pairs.push({ value: sorted[i].value, ids: [sorted[i].id, sorted[i+1].id] });
      i += 2;
    } else i++;
  }
  return pairs;
}

function groupByRank(sorted) {
  const groups = {};
  sorted.forEach(c => { if (!groups[c.rank]) groups[c.rank] = []; groups[c.rank].push(c); });
  return groups;
}

function findSmallestStraight(sorted, length, minValue) {
  if (sorted.length < length) return null;
  const uniqueCards = [];
  const seen = new Set();
  sorted.forEach(c => { if (!seen.has(c.rank) && c.rank !== '2' && c.rank !== '3') { uniqueCards.push(c); seen.add(c.rank); } });
  uniqueCards.sort((a, b) => b.value - a.value);
  for (let i = 0; i <= uniqueCards.length - length; i++) {
    const segment = uniqueCards.slice(i, i + length).sort((a, b) => a.value - b.value);
    let consecutive = true;
    for (let j = 1; j < segment.length; j++) { if (segment[j].value !== segment[j-1].value + 1) { consecutive = false; break; } }
    if (consecutive && segment[segment.length-1].value > minValue) return segment.map(c => c.id);
  }
  return null;
}

function findConsecutivePairs(sorted, pairCount, minValue) {
  if (sorted.length < pairCount * 2) return null;
  const pairs = findPairs(sorted);
  if (pairs.length < pairCount) return null;
  for (let i = 0; i <= pairs.length - pairCount; i++) {
    const segment = pairs.slice(i, i + pairCount).sort((a, b) => a.value - b.value);
    let consecutive = true;
    for (let j = 1; j < segment.length; j++) { if (segment[j].value !== segment[j-1].value + 1) { consecutive = false; break; } }
    if (consecutive && segment[segment.length-1].value > minValue) return segment.flatMap(p => p.ids);
  }
  return null;
}

function findThreePlay(sorted, type, length, minValue) {
  const rkGroups = groupByRank(sorted);
  const triples = Object.entries(rkGroups).filter(([r, cards]) => cards.length >= 3);
  for (const [rank, cards] of triples) {
    if (RANK_VALUES[rank] > minValue) {
      const threeIds = cards.slice(0, 3).map(c => c.id);
      if (type === 'three_one' && length === 4) {
        const kicker = sorted.find(c => c.rank !== rank);
        if (kicker) return [...threeIds, kicker.id];
      } else if (type === 'three_two' && length === 5) {
        const pair = findPairs(sorted).find(p => !threeIds.includes(p.ids[0]));
        if (pair) return [...threeIds, ...pair.ids];
      }
    }
  }
  return null;
}

// ===== Team-Aware Decision Logic =====

/**
 * Get the teammate index if known or inferred with high confidence
 */
function getEffectiveTeammate(teamTracker, gameState, playerIndex) {
  // 揭晓后：根据 庄家/队友 直接推出"我的队友"（两队都正确）
  if (gameState && gameState.teammateRevealed
      && gameState.declarerIndex !== undefined && gameState.declarerIndex >= 0
      && gameState.teammateIndex !== undefined && gameState.teammateIndex >= 0) {
    const declarer = gameState.declarerIndex;
    const teammate = gameState.teammateIndex;
    if (playerIndex === declarer) return teammate;
    if (playerIndex === teammate) return declarer;
    // 我属于闲家阵营：队友是另一个既非庄家也非帮庄的人
    for (let i = 0; i < 4; i++) {
      if (i !== declarer && i !== teammate && i !== playerIndex) return i;
    }
    return null;
  }

  if (!teamTracker) return null;

  // 直接获知（叫牌已打出）
  if (teamTracker.teammateKnown) return teamTracker.teammateIndex;

  // 揭晓前：高置信度推断
  const guess = teamTracker.getBestGuess();
  if (guess && guess.confidence >= 70 && guess.teammate !== null) {
    return guess.teammate;
  }

  return null;
}

/**
 * Check if a player is an opponent (not teammate, not self)
 */
function isOpponent(playerIdx, teammateIdx, selfIdx, gameState) {
  if (playerIdx === selfIdx) return false;
  if (teammateIdx !== null && playerIdx === teammateIdx) return false;
  
  // If teammate unknown, check game state
  if (gameState && gameState.teammateRevealed && gameState.teammateIndex !== undefined) {
    if (playerIdx === gameState.teammateIndex) return false;
    // Declarer's teammate is known, so everyone else is opponent if we're on a team
    if (gameState.declarerIndex === selfIdx || gameState.teammateIndex === selfIdx) {
      return true; // We're on declarer's team, everyone else is opponent
    }
  }
  
  return true; // Default: treat as opponent when uncertain
}

/**
 * Get the player index who played the last valid play (not pass)
 */
function getLastActivePlayer(gameState) {
  if (!gameState || !gameState.lastPlay) return null;
  return gameState.lastPlay.playerIndex;
}

/**
 * Find a player with few cards (close to winning)
 */
function findPlayerNearWin(gameState, excludeIndices = []) {
  if (!gameState || !gameState.players) return null;
  for (const p of gameState.players) {
    if (p.finished) continue;
    if (excludeIndices.includes(p.index)) continue;
    if (p.cardCount <= 3) return p.index;
  }
  return null;
}

// ===== Main API =====

/**
 * AI call card - team-aware, no LLM
 * Uses the same logic as medium bot with team considerations
 */
function aiCallCard(hand, teamTracker) {
  const { botCallCard } = require('./botAi');
  
  // Enhancement: if we know our teammate through teamTracker, 
  // try to call a card that complements our hand best
  // (Same as medium: prefer completing pairs/triples)
  return botCallCard(hand, 'medium');
}

/**
 * AI play cards - team-aware, no LLM
 * Applies cooperation rules on top of mediumBot logic
 */
function aiPlayCards(hand, lastPlay, gameState, playerIndex, teamTracker) {
  const { botPlayCards } = require('./botAi');
  const sorted = sortCards(hand);
  
  // Determine teammate
  const teammateIdx = getEffectiveTeammate(teamTracker, gameState, playerIndex);
  const lastActiveIdx = getLastActivePlayer(gameState);
  
  // === Rule 1: NEVER beat teammate's cards ===
  if (lastActiveIdx !== null && teammateIdx !== null && lastActiveIdx === teammateIdx) {
    console.log('[TEAM] Teammate played - passing');
    return { action: 'pass' };
  }
  
  // === Rule 2: Check who is near winning ===
  const selfNearWin = hand.length <= 3;
  const teammateNearWin = teammateIdx !== null && gameState 
    ? (gameState.players && gameState.players[teammateIdx] 
      ? gameState.players[teammateIdx].cardCount <= 3 && !gameState.players[teammateIdx].finished
      : false)
    : false;
  
  const opponentIndices = [];
  if (gameState && gameState.players) {
    for (const p of gameState.players) {
      if (p.finished) continue;
      if (p.index === playerIndex) continue;
      if (teammateIdx !== null && p.index === teammateIdx) continue;
      opponentIndices.push(p.index);
    }
  }
  
  let opponentNearWin = null;
  for (const oppIdx of opponentIndices) {
    if (gameState && gameState.players && gameState.players[oppIdx]) {
      if (gameState.players[oppIdx].cardCount <= 3) {
        opponentNearWin = oppIdx;
        break;
      }
    }
  }
  
  // === Rule 3: Teammate near winning - help them ===
  if (teammateNearWin) {
    console.log('[TEAM] Teammate near win - assisting');
    if (!lastPlay) {
      // Lead with smallest card to let teammate finish
      return { action: 'play', cardIds: [sorted[sorted.length - 1].id] };
    }
    // Try to beat the last play if it's from opponent
    if (lastActiveIdx !== null && teammateIdx !== null && lastActiveIdx !== teammateIdx) {
      const mediumResult = botPlayCards(hand, lastPlay, 'medium');
      if (mediumResult.action === 'play') {
        // Only play if we can beat it
        return mediumResult;
      }
      // If we can't beat, try special cards/bomb
      return trySpecialPlay(sorted, lastPlay);
    }
    return { action: 'pass' };
  }
  
  // === Rule 4: Opponent near winning - block ===
  if (opponentNearWin !== null) {
    console.log('[TEAM] Opponent near win - blocking');
    // Try to win the round with medium play
    if (!lastPlay) {
      // Lead with a medium card to keep control
      const pairs = findPairs(sorted);
      if (pairs.length > 0) return { action: 'play', cardIds: pairs[0].ids };
      const midIdx = Math.floor(sorted.length / 2);
      return { action: 'play', cardIds: [sorted[midIdx].id] };
    }
    // Aggressively try to beat
    const mediumResult = botPlayCards(hand, lastPlay, 'medium');
    if (mediumResult.action === 'play') return mediumResult;
    // If can't beat with normal, try special
    const specialResult = trySpecialPlay(sorted, lastPlay);
    if (specialResult) return specialResult;
    return { action: 'pass' };
  }
  
  // === Rule 5: Self near winning - rush ===
  if (selfNearWin) {
    console.log('[TEAM] Self near win - rushing');
    if (!lastPlay) {
      // Try to play a big combo to finish
      const pairs = findPairs(sorted);
      const groups = groupByRank(sorted);
      
      // Check for bomb
      for (const [rank, cards] of Object.entries(groups)) {
        if (cards.length >= 4) {
          return { action: 'play', cardIds: cards.map(c => c.id) };
        }
      }
      // Check for specials
      const sixes = sorted.filter(c => c.rank === '6');
      if (sixes.length >= 3) return { action: 'play', cardIds: sixes.slice(0, 3).map(c => c.id) };
      const queens = sorted.filter(c => c.rank === 'Q');
      if (queens.length >= 3) return { action: 'play', cardIds: queens.slice(0, 3).map(c => c.id) };
      
      // Play smallest
      if (pairs.length > 0) return { action: 'play', cardIds: pairs[0].ids };
      return { action: 'play', cardIds: [sorted[sorted.length - 1].id] };
    }
    // Must beat to continue
    const mediumResult = botPlayCards(hand, lastPlay, 'medium');
    if (mediumResult.action === 'play') return mediumResult;
    const specialResult = trySpecialPlay(sorted, lastPlay);
    if (specialResult) return specialResult;
    return { action: 'pass' };
  }
  
  // === Rule 6: Normal play - use medium logic ===
  const result = botPlayCards(hand, lastPlay, 'medium');
  
  // Enhancement: if medium says pass but we could use specials, try
  if (result.action === 'pass' && lastPlay) {
    const specialResult = trySpecialPlay(sorted, lastPlay);
    if (specialResult) return specialResult;
  }
  
  return result;
}

/**
 * Try to play a special card (sword/thunder/bomb) to beat the last play
 */
function trySpecialPlay(sorted, lastPlay) {
  if (!lastPlay || !lastPlay.handAnalysis) return null;
  
  // Check for bomb (4+ of a kind)
  const groups = groupByRank(sorted);
  for (const [rank, cards] of Object.entries(groups)) {
    if (cards.length >= 4) {
      const bombIds = cards.map(c => c.id);
      const bombAnalysis = analyzeHand(cards);
      if (canBeat(bombAnalysis, lastPlay.handAnalysis)) {
        return { action: 'play', cardIds: bombIds };
      }
    }
  }
  
  // Check sword (44A)
  const fours = sorted.filter(c => c.rank === '4');
  const ace = sorted.filter(c => c.rank === 'A');
  if (fours.length >= 2 && ace.length >= 1) {
    const swordCards = [fours[0], fours[1], ace[0]];
    const swordAnalysis = analyzeHand(swordCards);
    if (canBeat(swordAnalysis, lastPlay.handAnalysis)) {
      return { action: 'play', cardIds: swordCards.map(c => c.id) };
    }
  }
  
  // Check small thunder (666)
  const sixes = sorted.filter(c => c.rank === '6');
  if (sixes.length >= 3) {
    const thunderCards = sixes.slice(0, 3);
    const thunderAnalysis = analyzeHand(thunderCards);
    if (canBeat(thunderAnalysis, lastPlay.handAnalysis)) {
      return { action: 'play', cardIds: thunderCards.map(c => c.id) };
    }
  }
  
  // Check big thunder (QQQ)
  const queens = sorted.filter(c => c.rank === 'Q');
  if (queens.length >= 3) {
    const thunderCards = queens.slice(0, 3);
    const thunderAnalysis = analyzeHand(thunderCards);
    if (canBeat(thunderAnalysis, lastPlay.handAnalysis)) {
      return { action: 'play', cardIds: thunderCards.map(c => c.id) };
    }
  }
  
  return null;
}

function checkAiAvailable() {
  return false; // No LLM, always returns false
}

module.exports = { aiCallCard, aiPlayCards, checkAiAvailable, AI_CONFIG };
