// 牌的花色和点数定义
const SUITS = ['S', 'H', 'C', 'D']; // Spade, Heart, Club, Diamond
const SUIT_NAMES = { S: '♠', H: '♥', C: '♣', D: '♦' };
const SUIT_ORDER = { S: 4, H: 3, C: 2, D: 1 };

// 点数从高到低: 3 > 2 > A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4
const RANK_ORDER = {
  '3': 15, '2': 14, 'A': 13, 'K': 12, 'Q': 11, 'J': 10,
  '10': 9, '9': 8, '8': 7, '7': 6, '6': 5, '5': 4, '4': 3
};

// 连续顺子用的数值（4最小，A最大），3不参与顺子
const STRAIGHT_VALUES = {
  '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

function createCard(suit, rank) {
  return {
    id: `${suit}${rank}`,
    suit,
    rank,
    value: RANK_ORDER[rank],
    suit_order: SUIT_ORDER[suit],
  };
}

// 创建一副新牌（52张，无大小王）
function createDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of Object.keys(RANK_ORDER)) {
      cards.push(createCard(suit, rank));
    }
  }
  return cards;
}

// Fisher-Yates 洗牌
function shuffle(cards) {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// 发牌：4人各13张
function dealCards() {
  const deck = shuffle(createDeck());
  return [
    deck.slice(0, 13),
    deck.slice(13, 26),
    deck.slice(26, 39),
    deck.slice(39, 52),
  ];
}

// 按值+花色排序（从大到小）
function sortCards(cards) {
  return [...cards].sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    return b.suit_order - a.suit_order;
  });
}

// 找某张牌在手中的索引
function findCardIndex(hand, cardId) {
  return hand.findIndex(c => c.id === cardId);
}

// 从手中移除指定牌
function removeCards(hand, cardIds) {
  const ids = new Set(cardIds);
  return hand.filter(c => !ids.has(c.id));
}

// 牌面显示
function cardDisplay(card) {
  return `${SUIT_NAMES[card.suit]}${card.rank}`;
}

function devDealCards() {
  const deck = createDeck();
  // Dev player gets: 4x3 (bomb), 3x6 (small_thunder), 3xQ (big_thunder), 2x4+1xA (sword)
  const four3s = deck.filter(c => c.rank === "3").slice(0, 4);
  const three6s = deck.filter(c => c.rank === "6").slice(0, 3);
  const threeQs = deck.filter(c => c.rank === "Q").slice(0, 3);
  const two4s = deck.filter(c => c.rank === "4").slice(0, 2);
  const oneA = deck.filter(c => c.rank === "A").slice(0, 1);
  const player0Cards = [...four3s, ...three6s, ...threeQs, ...two4s, ...oneA];
  const usedIds = new Set(player0Cards.map(c => c.id));
  const remaining = deck.filter(c => !usedIds.has(c.id));
  return [
    sortCards(player0Cards),
    sortCards(remaining.slice(0, 13)),
    sortCards(remaining.slice(13, 26)),
    sortCards(remaining.slice(26, 39)),
  ];
}

function cardsDisplay(cards) {
  return cards.map(cardDisplay).join(' ');
}

module.exports = {
  SUITS, SUIT_NAMES, SUIT_ORDER, RANK_ORDER, STRAIGHT_VALUES,
  createCard, createDeck, shuffle, dealCards, devDealCards, sortCards,
  findCardIndex, removeCards, cardDisplay, cardsDisplay
};
