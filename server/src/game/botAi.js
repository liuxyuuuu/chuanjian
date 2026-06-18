const { analyzeHand, canBeat, HAND_TYPE } = require('./rules');
const { sortCards, RANK_ORDER } = require('./deck');

// Bot calls a random card it doesn't have
function botCallCard(hand) {
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
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Bot decides what to play
function botPlayCards(hand, lastPlay) {
  const sorted = sortCards(hand);

  // New round: play smallest single
  if (!lastPlay) {
    return { action: 'play', cardIds: [sorted[sorted.length - 1].id] };
  }

  const lastType = lastPlay.handAnalysis?.type;
  const lastValue = lastPlay.handAnalysis?.mainValue;

  // Try to beat with single
  if (lastType === HAND_TYPE.SINGLE) {
    for (const card of sorted) {
      if (card.value > lastValue) return { action: 'play', cardIds: [card.id] };
    }
  }

  // Try to beat with pair
  if (lastType === HAND_TYPE.PAIR) {
    const pairs = findPairs(sorted);
    for (const p of pairs) {
      if (p.value > lastValue) return { action: 'play', cardIds: p.ids };
    }
  }

  // Can't beat - pass
  return { action: 'pass' };
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

module.exports = { botCallCard, botPlayCards };
