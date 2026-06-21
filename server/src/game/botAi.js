const { analyzeHand, canBeat, HAND_TYPE } = require('./rules');
const { sortCards, RANK_ORDER } = require('./deck');

// ===== Lazy AI bot loader (unused now, kept for compatibility) =====
let aiBot = null;
function getAiBot() {
  if (!aiBot) {
    try { aiBot = require('./aiBot'); } catch (e) { aiBot = null; }
  }
  return aiBot;
}

// ===== Bot call card =====
function botCallCard(hand, difficulty) {
  if (difficulty === 'ai') {
    const ab = getAiBot();
    if (ab) return ab.aiCallCard(hand);
  }
  const suits = ['S', 'H', 'C', 'D'];
  const ranks = Object.keys(RANK_ORDER);
  const handIds = new Set(hand.map(c => c.id));
  const candidates = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      const id = suit + rank;
      if (!handIds.has(id)) candidates.push(id);
    }
  }
  if (difficulty === 'medium' || difficulty === 'ai') {
    const rankCounts = {};
    hand.forEach(c => { rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1; });
    // Prefer calling a rank we have 2 or 3 of (bomb/three potential)
    for (const [rank, count] of Object.entries(rankCounts)) {
      if (count >= 3) {
        for (const suit of suits) {
          const id = suit + rank;
          if (!handIds.has(id)) return id;
        }
      }
    }
    for (const [rank, count] of Object.entries(rankCounts)) {
      if (count >= 2) {
        for (const suit of suits) {
          const id = suit + rank;
          if (!handIds.has(id)) return id;
        }
      }
    }
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ===== Bot play cards =====
function botPlayCards(hand, lastPlay, difficulty) {
  if (difficulty === 'ai') {
    const ab = getAiBot();
    if (ab) return ab.aiPlayCards(hand, lastPlay, null, 0).catch(() => ({ action: 'pass' }));
  }
  const sorted = sortCards(hand); // DESC: [highest ... lowest]
  if (difficulty === 'easy') {
    return easyBot(sorted, lastPlay);
  }
  return mediumBot(sorted, lastPlay);
}

// ===== 牌型感知 - 分析手牌结构 =====
function analyzeComposition(sorted) {
  const singles = [], pairs = [], triples = [], bombs = [];
  const groups = groupByRank(sorted);
  for (const [rank, cards] of Object.entries(groups)) {
    if (cards.length >= 4) bombs.push(cards);
    else if (cards.length === 3) triples.push(cards);
    else if (cards.length === 2) pairs.push(cards);
    else singles.push(cards[0]);
  }
  // Sort each group by value ASC (smallest first)
  const byValAsc = (a, b) => a.value - b.value;
  singles.sort(byValAsc);
  pairs.sort((a, b) => a[0].value - b[0].value);
  triples.sort((a, b) => a[0].value - b[0].value);
  bombs.sort((a, b) => a[0].value - b[0].value);
  return { singles, pairs, triples, bombs, groups };
}

// ===== 获取最小可管的牌 =====
function findSmallestBeatable(sorted, lastValue) {
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].value > lastValue) return sorted[i];
  }
  return null;
}

// ===== 获取最小可管的对子 =====
function findSmallestBeatablePair(pairs, lastValue) {
  // pairs is already sorted ASC
  for (const p of pairs) {
    if (p[0].value > lastValue) return p;
  }
  return null;
}

// ===== 拆炸弹成对子 =====
function splitBombToPair(groups, lastValue) {
  // If we have 4+ of a kind, we can split it into a pair
  for (const [rank, cards] of Object.entries(groups)) {
    if (cards.length >= 4 && cards[0].value > lastValue) {
      return [cards[0], cards[1]]; // smallest 2 from the bomb
    }
  }
  return null;
}

// ===== Easy bot =====
function easyBot(sorted, lastPlay) {
  const comp = analyzeComposition(sorted);

  // New round: play smallest card
  if (!lastPlay) {
    if (comp.pairs.length > 0) {
      return { action: 'play', cardIds: comp.pairs[0].map(c => c.id) };
    }
    return { action: 'play', cardIds: [sorted[sorted.length - 1].id] };
  }

  const lastType = lastPlay.handAnalysis?.type;
  const lastValue = lastPlay.handAnalysis?.mainValue;
  const lastLen = lastPlay.handAnalysis?.length;

  if (lastType === 'single') {
    const found = findSmallestBeatable(sorted, lastValue);
    if (found) return { action: 'play', cardIds: [found.id] };
  }
  if (lastType === 'pair') {
    let found = findSmallestBeatablePair(comp.pairs, lastValue);
    if (!found) found = splitBombToPair(comp.groups, lastValue);
    if (found) return { action: 'play', cardIds: found.map(c => c.id) };
  }
  if (lastType === 'straight') {
    const straight = findSmallestStraight(sorted, lastLen, lastValue);
    if (straight) return { action: 'play', cardIds: straight };
  }

  // Special cards (easy: always use if can beat)
  const sp = tryEasySpecial(sorted, lastPlay);
  if (sp) return sp;

  return { action: 'pass' };
}

function tryEasySpecial(sorted, lastPlay) {
  if (!lastPlay || !lastPlay.handAnalysis) return null;
  const la = lastPlay.handAnalysis;
  const rGroups = groupByRank(sorted);
  // Bomb
  for (const [rank, cards] of Object.entries(rGroups)) {
    if (cards.length >= 4) {
      const ba = analyzeHand(cards);
      if (canBeat(ba, la)) return { action: 'play', cardIds: cards.map(c => c.id) };
    }
  }
  // Sword 44A
  const fours = sorted.filter(c => c.rank === '4');
  const ace = sorted.filter(c => c.rank === 'A');
  if (fours.length >= 2 && ace.length >= 1) {
    const sword = [fours[0], fours[1], ace[0]];
    const sa = analyzeHand(sword);
    if (canBeat(sa, la)) return { action: 'play', cardIds: sword.map(c => c.id) };
  }
  return null;
}

// ===== Medium bot with dynamic strategy =====
function mediumBot(sorted, lastPlay) {
  const comp = analyzeComposition(sorted);
  const handCount = sorted.length;

  // ===== 三阶段策略 =====
  const stage = handCount > 9 ? 'early' : handCount > 5 ? 'mid' : 'end';
  const nearWin = handCount <= 4;

  // ===== 新回合（首发） =====
  if (!lastPlay) {
    return leadPlay(comp, sorted, stage);
  }

  const lastType = lastPlay.handAnalysis?.type;
  const lastValue = lastPlay.handAnalysis?.mainValue;
  const lastLen = lastPlay.handAnalysis?.length;

  // ===== 管牌逻辑 =====
  let result = tryBeat(sorted, comp, lastType, lastValue, lastLen, lastPlay);
  if (result) return result;

  // ===== 终局：管不上时用特殊牌 =====
  if (nearWin) {
    const sp = tryAllSpecial(sorted, lastPlay);
    if (sp) return sp;
  }

  return { action: 'pass' };
}

// ===== 首发出牌策略 =====
function leadPlay(comp, sorted, stage) {
  const { singles, pairs, triples, bombs } = comp;

  // 终局(<=4张): 冲刺型出牌
  if (stage === 'end') {
    // 有炸弹先出炸弹
    if (bombs.length > 0) return { action: 'play', cardIds: bombs[0].map(c => c.id) };
    // 有三带出三带
    if (triples.length > 0) {
      const t = triples[0];
      if (singles.length > 0) return { action: 'play', cardIds: [...t.map(c => c.id), singles[0].id] };
      if (pairs.length > 0) return { action: 'play', cardIds: [...t.map(c => c.id), ...pairs[0].map(c => c.id)] };
    }
    // 出最小对子
    if (pairs.length > 0) return { action: 'play', cardIds: pairs[0].map(c => c.id) };
    // 出最小单张
    return { action: 'play', cardIds: [sorted[sorted.length - 1].id] };
  }

  // 中期(5-9张): 根据牌型选择首发
  if (stage === 'mid') {
    // 对子多(>=3) → 出最小对子
    if (pairs.length >= 3) return { action: 'play', cardIds: pairs[0].map(c => c.id) };
    // 单张多(>=5) → 出最小单张
    if (singles.length >= 5) return { action: 'play', cardIds: [sorted[sorted.length - 1].id] };
    // 有三带 → 出最小三带(min triple + min kicker)
    if (triples.length >= 1 && singles.length >= 1) {
      return { action: 'play', cardIds: [...triples[0].map(c => c.id), singles[0].id] };
    }
    // 出最小对子
    if (pairs.length > 0) return { action: 'play', cardIds: pairs[0].map(c => c.id) };
    return { action: 'play', cardIds: [sorted[sorted.length - 1].id] };
  }

  // 早期(>=10张): 试探性出牌
  // 出最小对子（如果有），否则出最小单张
  if (pairs.length > 0) return { action: 'play', cardIds: pairs[0].map(c => c.id) };
  return { action: 'play', cardIds: [sorted[sorted.length - 1].id] };
}

// ===== 管牌逻辑 =====
function tryBeat(sorted, comp, lastType, lastValue, lastLen, lastPlay) {
  const { singles, pairs, triples, bombs, groups } = comp;

  // 1. 单张
  if (lastType === 'single') {
    const found = findSmallestBeatable(sorted, lastValue);
    if (found) return { action: 'play', cardIds: [found.id] };
  }

  // 2. 对子
  if (lastType === 'pair') {
    let found = findSmallestBeatablePair(pairs, lastValue);
    // 拆炸弹成对子
    if (!found) found = splitBombToPair(groups, lastValue);
    if (found) return { action: 'play', cardIds: found.map(c => c.id) };
  }

  // 3. 顺子
  if (lastType === 'straight') {
    const straight = findSmallestStraight(sorted, lastLen, lastValue);
    if (straight) return { action: 'play', cardIds: straight };
  }

  // 4. 连对
  if (lastType === 'consecutive_pairs') {
    const cp = findConsecutivePairs(sorted, lastLen / 2, lastValue);
    if (cp) return { action: 'play', cardIds: cp };
  }

  // 5. 三带一 / 三带二
  if (lastType === 'three_one' || lastType === 'three_two') {
    const tp = findThreePlay(sorted, lastType, lastLen, lastValue);
    if (tp) return { action: 'play', cardIds: tp };
  }

  // 6. 特殊牌型管牌
  const sp = tryAllSpecial(sorted, lastPlay);
  if (sp) return sp;

  return null;
}

// ===== 尝试所有特殊牌 =====
function tryAllSpecial(sorted, lastPlay) {
  if (!lastPlay || !lastPlay.handAnalysis) return null;
  const la = lastPlay.handAnalysis;

  const rGroups = groupByRank(sorted);

  // 炸弹
  for (const [rank, cards] of Object.entries(rGroups)) {
    if (cards.length >= 4) {
      const ba = analyzeHand(cards);
      if (canBeat(ba, la)) return { action: 'play', cardIds: cards.map(c => c.id) };
    }
  }

  // 剑 44A
  const fours = sorted.filter(c => c.rank === '4');
  const ace = sorted.filter(c => c.rank === 'A');
  if (fours.length >= 2 && ace.length >= 1) {
    const sword = [fours[0], fours[1], ace[0]];
    const sa = analyzeHand(sword);
    if (canBeat(sa, la)) return { action: 'play', cardIds: sword.map(c => c.id) };
  }

  // 666 小雷
  const sixes = sorted.filter(c => c.rank === '6');
  if (sixes.length >= 3) {
    const thunder = sixes.slice(0, 3);
    const ta = analyzeHand(thunder);
    if (canBeat(ta, la)) return { action: 'play', cardIds: thunder.map(c => c.id) };
  }

  // QQQ 大雷
  const queens = sorted.filter(c => c.rank === 'Q');
  if (queens.length >= 3) {
    const thunder = queens.slice(0, 3);
    const ta = analyzeHand(thunder);
    if (canBeat(ta, la)) return { action: 'play', cardIds: thunder.map(c => c.id) };
  }

  return null;
}

// ===== Helper functions =====
function findPairs(sorted) {
  const pairs = [];
  let i = 0;
  while (i < sorted.length - 1) {
    if (sorted[i].value === sorted[i+1].value) {
      pairs.push([sorted[i], sorted[i+1]]);
      i += 2;
    } else i++;
  }
  // Sort pairs by value ASC
  pairs.sort((a, b) => a[0].value - b[0].value);
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
  sorted.forEach(c => {
    if (!seen.has(c.rank) && c.rank !== '2' && c.rank !== '3') {
      uniqueCards.push(c);
      seen.add(c.rank);
    }
  });
  // Sort ASC for smallest-first search
  uniqueCards.sort((a, b) => a.value - b.value);

  for (let i = 0; i <= uniqueCards.length - length; i++) {
    const segment = uniqueCards.slice(i, i + length);
    let consecutive = true;
    for (let j = 1; j < segment.length; j++) {
      if (segment[j].value !== segment[j-1].value + 1) { consecutive = false; break; }
    }
    if (consecutive && segment[segment.length-1].value > minValue) {
      return segment.map(c => c.id);
    }
  }
  return null;
}

function findConsecutivePairs(sorted, pairCount, minValue) {
  if (sorted.length < pairCount * 2) return null;
  const pairs = findPairs(sorted);
  if (pairs.length < pairCount) return null;
  for (let i = 0; i <= pairs.length - pairCount; i++) {
    const segment = pairs.slice(i, i + pairCount);
    let consecutive = true;
    for (let j = 1; j < segment.length; j++) {
      if (segment[j][0].value !== segment[j-1][0].value + 1) { consecutive = false; break; }
    }
    if (consecutive && segment[segment.length-1][0].value > minValue) {
      return segment.flatMap(p => p.map(c => c.id));
    }
  }
  return null;
}

function findThreePlay(sorted, type, length, minValue) {
  const rkGroups = groupByRank(sorted);
  const triples = Object.entries(rkGroups).filter(([r, cards]) => cards.length >= 3);
  // Sort triples by value ASC
  triples.sort((a, b) => RANK_ORDER[a[0]] - RANK_ORDER[b[0]]);
  for (const [rank, cards] of triples) {
    if (RANK_ORDER[rank] > minValue) {
      const threeIds = cards.slice(0, 3).map(c => c.id);
      if (type === 'three_one' && length === 4) {
        const kicker = sorted.find(c => c.rank !== rank);
        if (kicker) return [...threeIds, kicker.id];
      } else if (type === 'three_two' && length === 5) {
        const pair = findPairs(sorted).find(p => !threeIds.includes(p[0].id));
        if (pair) return [...threeIds, pair[0].id, pair[1].id];
      }
    }
  }
  return null;
}

module.exports = { botCallCard, botPlayCards };
