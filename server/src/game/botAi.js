const { analyzeHand, canBeat, HAND_TYPE } = require('./rules');
const { sortCards, RANK_ORDER } = require('./deck');

// Bot calls a card strategically
function botCallCard(hand, difficulty) {
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
  
  // Medium: try to call a card that makes a good team
  if (difficulty === 'medium') {
    // Call a card with a rank we have pairs/triples of (to create bomb potential)
    const rankCounts = {};
    hand.forEach(c => { rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1; });
    
    // Prefer calling a card that has same rank as cards we have 2 or 3 of
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

// Bot decides what to play
function botPlayCards(hand, lastPlay, difficulty) {
  const sorted = sortCards(hand);
  
  if (difficulty === 'easy') {
    return easyBot(sorted, lastPlay);
  } else {
    return mediumBot(sorted, lastPlay);
  }
}

// Easy bot: play smallest cards, rarely keep special cards
function easyBot(sorted, lastPlay) {
  // New round: play smallest single
  if (!lastPlay) {
    return { action: 'play', cardIds: [sorted[sorted.length - 1].id] };
  }

  const lastType = lastPlay.handAnalysis?.type;
  const lastValue = lastPlay.handAnalysis?.mainValue;

  // Try to beat with single
  if (lastType === 'single') {
    for (const card of sorted) {
      if (card.value > lastValue) return { action: 'play', cardIds: [card.id] };
    }
  }

  // Try to beat with pair
  if (lastType === 'pair') {
    const pairs = findPairs(sorted);
    for (const p of pairs) {
      if (p.value > lastValue) return { action: 'play', cardIds: p.ids };
    }
  }

  // Try to beat with straight
  if (lastType === 'straight') {
    const lastLen = lastPlay.handAnalysis?.length;
    const straight = findSmallestStraight(sorted, lastLen, lastValue);
    if (straight) return { action: 'play', cardIds: straight };
  }

  // Try special cards if we have them
  // Check for 44A (sword)
  const fours = sorted.filter(c => c.rank === '4');
  const ace = sorted.filter(c => c.rank === 'A');
  if (fours.length >= 2 && ace.length >= 1) {
    const swordIds = [fours[0].id, fours[1].id, ace[0].id];
    const swordAnalysis = analyzeHand(sorted.filter(c => swordIds.includes(c.id)));
    if (canBeat(swordAnalysis, lastPlay?.handAnalysis)) {
      return { action: 'play', cardIds: swordIds };
    }
  }

  // Check for bomb
  const rankGroups = groupByRank(sorted);
  for (const [rank, cards] of Object.entries(rankGroups)) {
    if (cards.length >= 4) {
      const bombIds = cards.map(c => c.id);
      const bombAnalysis = analyzeHand(sorted.filter(c => bombIds.includes(c.id)));
      if (canBeat(bombAnalysis, lastPlay?.handAnalysis)) {
        return { action: 'play', cardIds: bombIds };
      }
    }
  }

  return { action: 'pass' };
}

// Medium bot: smarter play, save bombs/thunder for key moments
function mediumBot(sorted, lastPlay) {
  // New round
  if (!lastPlay) {
    // Play pairs if available, otherwise smallest single
    const pairs = findPairs(sorted);
    if (pairs.length > 0) {
      return { action: 'play', cardIds: pairs[0].ids };
    }
    return { action: 'play', cardIds: [sorted[sorted.length - 1].id] };
  }

  const lastType = lastPlay.handAnalysis?.type;
  const lastValue = lastPlay.handAnalysis?.mainValue;
  const lastLen = lastPlay.handAnalysis?.length;

  // Try to beat with same type first
  // Single
  if (lastType === 'single') {
    for (const card of sorted) {
      if (card.value > lastValue && card.rank !== '4' && card.rank !== 'A') {
        return { action: 'play', cardIds: [card.id] };
      }
    }
    // If nothing, use a 4 or A if needed and not part of sword combo
    for (const card of sorted) {
      if (card.value > lastValue) return { action: 'play', cardIds: [card.id] };
    }
  }

  // Pair
  if (lastType === 'pair') {
    const pairs = findPairs(sorted);
    for (const p of pairs) {
      if (p.value > lastValue) return { action: 'play', cardIds: p.ids };
    }
  }

  // Straight
  if (lastType === 'straight') {
    const straight = findSmallestStraight(sorted, lastLen, lastValue);
    if (straight) return { action: 'play', cardIds: straight };
  }

  // Consecutive pairs
  if (lastType === 'consecutive_pairs') {
    const cp = findConsecutivePairs(sorted, lastLen / 2, lastValue);
    if (cp) return { action: 'play', cardIds: cp };
  }

  // Three-one / Three-two
  if (lastType === 'three_one' || lastType === 'three_two') {
    const threePlay = findThreePlay(sorted, lastType, lastLen, lastValue);
    if (threePlay) return { action: 'play', cardIds: threePlay };
  }

  // Try special cards - medium bot only plays them when necessary
  // (when hand is small or opponent is about to win)
  const criticalMode = sorted.length <= 5;

  // Small thunder (666)
  const sixes = sorted.filter(c => c.rank === '6');
  if (sixes.length >= 3 && isWorthPlayingSpecial(handSize(sorted.length), lastPlay, criticalMode)) {
    return { action: 'play', cardIds: sixes.slice(0, 3).map(c => c.id) };
  }

  // Big thunder (QQQ)
  const queens = sorted.filter(c => c.rank === 'Q');
  if (queens.length >= 3 && isWorthPlayingSpecial(handSize(sorted.length), lastPlay, criticalMode)) {
    return { action: 'play', cardIds: queens.slice(0, 3).map(c => c.id) };
  }

  // Sword (44A)
  const fours = sorted.filter(c => c.rank === '4');
  const ace = sorted.filter(c => c.rank === 'A');
  if (fours.length >= 2 && ace.length >= 1) {
    const swordIds = [fours[0].id, fours[1].id, ace[0].id];
    if (isWorthPlayingSpecial(handSize(sorted.length), lastPlay, criticalMode)) {
      return { action: 'play', cardIds: swordIds };
    }
  }

  // Bomb (only in critical mode or very valuable)
  const rGroups = groupByRank(sorted);
  for (const [rank, cards] of Object.entries(rGroups)) {
    if (cards.length >= 4) {
      const bombIds = cards.map(c => c.id);
      if (criticalMode) {
        return { action: 'play', cardIds: bombIds };
      }
    }
  }

  return { action: 'pass' };
}

function handSize(size) {
  return size > 8 ? 'large' : size > 4 ? 'medium' : 'small';
}

function isWorthPlayingSpecial(handSize, lastPlay, criticalMode) {
  // Play special cards when:
  // 1. We need to regain initiative (no lastPlay means new round)
  // 2. Critical mode (hand <= 5 cards)
  // 3. Last play is also a special card (need to counter)
  if (criticalMode) return true;
  if (!lastPlay) return false; // Don't waste special cards on new round
  const lastPower = lastPlay.handAnalysis ? getPowerLevel(lastPlay.handAnalysis.type) : 0;
  if (lastPower >= 10) return true; // Counter special cards
  return false;
}

function getPowerLevel(type) {
  const powers = {
    'single': 1, 'pair': 2, 'straight': 3, 'consecutive_pairs': 3,
    'three_one': 4, 'three_two': 5,
    'sword_44a': 10, 'small_thunder': 11, 'big_thunder': 12, 'bomb': 13
  };
  return powers[type] || 0;
}

function findPairs(sorted) {
  const pairs = [];
  let i = 0;
  while (i < sorted.length - 1) {
    if (sorted[i].value === sorted[i+1].value) {
      pairs.push({ value: sorted[i].value, ids: [sorted[i].id, sorted[i+1].id] });
      i += 2;
    } else {
      i++;
    }
  }
  return pairs;
}

function groupByRank(sorted) {
  const groups = {};
  sorted.forEach(c => {
    if (!groups[c.rank]) groups[c.rank] = [];
    groups[c.rank].push(c);
  });
  return groups;
}

function findSmallestStraight(sorted, length, minValue) {
  if (sorted.length < length) return null;
  // Extract unique values for straight check
  const uniqueCards = [];
  const seen = new Set();
  sorted.forEach(c => {
    if (!seen.has(c.rank) && c.rank !== '2' && c.rank !== '3') {
      uniqueCards.push(c);
      seen.add(c.rank);
    }
  });
  uniqueCards.sort((a, b) => b.value - a.value);
  
  for (let i = 0; i <= uniqueCards.length - length; i++) {
    const segment = uniqueCards.slice(i, i + length).sort((a, b) => a.value - b.value);
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
    const segment = pairs.slice(i, i + pairCount).sort((a, b) => a.value - b.value);
    let consecutive = true;
    for (let j = 1; j < segment.length; j++) {
      if (segment[j].value !== segment[j-1].value + 1) { consecutive = false; break; }
    }
    if (consecutive && segment[segment.length-1].value > minValue) {
      return segment.flatMap(p => p.ids);
    }
  }
  return null;
}

function findThreePlay(sorted, type, length, minValue) {
  const rkGroups = groupByRank(sorted);
  const triples = Object.entries(rkGroups).filter(([r, cards]) => cards.length >= 3);
  
  for (const [rank, cards] of triples) {
    if (RANK_ORDER[rank] > minValue) {
      const threeIds = cards.slice(0, 3).map(c => c.id);
      if (type === 'three_one' && length === 4) {
        // Need one kicker
        const kicker = sorted.find(c => c.rank !== rank);
        if (kicker) return [...threeIds, kicker.id];
      } else if (type === 'three_two' && length === 5) {
        // Need one pair as kicker
        const pair = findPairs(sorted).find(p => !threeIds.includes(p.ids[0]));
        if (pair) return [...threeIds, ...pair.ids];
      }
    }
  }
  return null;
}

module.exports = { botCallCard, botPlayCards };