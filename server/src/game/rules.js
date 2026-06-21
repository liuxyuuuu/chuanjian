const { RANK_ORDER, STRAIGHT_VALUES, PAIR_STRAIGHT_VALUES, sortCards } = require('./deck');

// 牌型枚举
const HAND_TYPE = {
  SINGLE: 'single',           // 单张
  PAIR: 'pair',               // 对子
  STRAIGHT: 'straight',       // 顺子（>=3张）
  CONSECUTIVE_PAIRS: 'consecutive_pairs', // 连对（>=2对）
  SWORD_44A: 'sword_44a',     // 44A（剑）
  SMALL_THUNDER: 'small_thunder', // 666（小雷）
  BIG_THUNDER: 'big_thunder',   // QQQ（大雷）
  THREE_ONE: 'three_one',     // 三带一
  THREE_TWO: 'three_two',     // 三带二
  BOMB: 'bomb',               // 炸弹（>=4张）
  INVALID: 'invalid'           // 无效牌型
};

// 牌型等级（用于比较是否能压过）
const HAND_POWER = {
  [HAND_TYPE.SINGLE]: 1,
  [HAND_TYPE.PAIR]: 2,
  [HAND_TYPE.STRAIGHT]: 3,
  [HAND_TYPE.CONSECUTIVE_PAIRS]: 3,
  [HAND_TYPE.SWORD_44A]: 10,
  [HAND_TYPE.SMALL_THUNDER]: 11,
  [HAND_TYPE.BIG_THUNDER]: 12,
  [HAND_TYPE.THREE_ONE]: 4,
  [HAND_TYPE.THREE_TWO]: 5,
  [HAND_TYPE.BOMB]: 13,
};

// 分析一手牌型
function analyzeHand(cards) {
  if (!cards || cards.length === 0) return { type: HAND_TYPE.INVALID };
  
  const sorted = sortCards(cards);
  const n = sorted.length;
  const values = sorted.map(c => c.value);
  const valueCount = getValueCounts(values);
  
  // 单张
  if (n === 1) {
    return { type: HAND_TYPE.SINGLE, mainValue: values[0], length: 1 };
  }
  
  // 特殊牌型：44A
  if (n === 3) {
    const ranks = sorted.map(c => c.rank);
    const fours = ranks.filter(r => r === '4').length;
    const aces = ranks.filter(r => r === 'A').length;
    if (fours === 2 && aces === 1) {
      return { type: HAND_TYPE.SWORD_44A, mainValue: 10, length: 3 };
    }
  }
  
  // 特殊牌型：666（小雷）
  if (n === 3) {
    const sixes = sorted.filter(c => c.rank === '6').length;
    if (sixes === 3) {
      return { type: HAND_TYPE.SMALL_THUNDER, mainValue: 666, length: 3 };
    }
  }
  
  // 特殊牌型：QQQ（大雷）
  if (n === 3) {
    const queens = sorted.filter(c => c.rank === 'Q').length;
    if (queens === 3) {
      return { type: HAND_TYPE.BIG_THUNDER, mainValue: 999, length: 3 };
    }
  }
  
  // 对子
  if (n === 2 && values[0] === values[1]) {
    return { type: HAND_TYPE.PAIR, mainValue: values[0], length: 2 };
  }
  
  // 炸弹（4张或以上相同点数）
  for (const [val, cnt] of Object.entries(valueCount)) {
    if (cnt >= 4) {
      return { type: HAND_TYPE.BOMB, mainValue: parseInt(val), length: n, bombCount: cnt };
    }
  }
  


  // 三带一 (3+1=4张)
  if (n === 4) {
    const entries = Object.entries(valueCount).map(([v, c]) => [parseInt(v), c]);
    const three = entries.find(([v, c]) => c === 3);
    const one = entries.find(([v, c]) => c === 1);
    if (three && one) {
      return { type: HAND_TYPE.THREE_ONE, mainValue: three[0], length: 4 };
    }
  }

  // 三带二 (3+2=5张)
  if (n === 5) {
    const entries = Object.entries(valueCount).map(([v, c]) => [parseInt(v), c]);
    const three = entries.find(([v, c]) => c === 3);
    const two = entries.find(([v, c]) => c === 2);
    if (three && two) {
      return { type: HAND_TYPE.THREE_TWO, mainValue: three[0], length: 5 };
    }
  }
  // 连对：>=4张，偶数，点数两两相同，连续
  if (n >= 4 && n % 2 === 0) {
    const pairs = n / 2;
    const pairValues = [];
    let valid = true;
    for (let i = 0; i < n; i += 2) {
      if (values[i] !== values[i + 1]) {
        valid = false;
        break;
      }
      pairValues.push(values[i]);
    }
    if (valid && pairValues.length >= 2) {
      // 检查是否连续（用顺子值检查）
      const sortedPairVals = [...pairValues].sort((a, b) => a - b);
      const straightRanks = sortedPairVals.map(v => rankFromValue(v));
      if (isConsecutiveStraight(straightRanks, true)) {
        return { type: HAND_TYPE.CONSECUTIVE_PAIRS, mainValue: Math.max(...pairValues), length: n, pairCount: pairs };
      }
    }
  }
  
  // 顺子：>=3张，所有牌不同，点数连续
  if (n >= 3) {
    const uniqueVals = new Set(values);
    if (uniqueVals.size === n) {
      const ranks = sorted.map(c => c.rank);
      if (isConsecutiveStraight(ranks)) {
        return { type: HAND_TYPE.STRAIGHT, mainValue: Math.max(...values), length: n };
      }
    }
  }
  
  return { type: HAND_TYPE.INVALID };
}

// 获取点数出现次数
function getValueCounts(values) {
  const counts = {};
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1;
  }
  return counts;
}

// 从值获取点数名称
function rankFromValue(value) {
  for (const [rank, val] of Object.entries(RANK_ORDER)) {
    if (val === value) return rank;
  }
  return null;
}

// 检查是否是连续顺子的点数（用STRAIGHT_VALUES，3不参与）
function isConsecutiveStraight(ranks, usePairValues) {
  const valueMap = usePairValues ? PAIR_STRAIGHT_VALUES : STRAIGHT_VALUES;
  const vals = ranks.map(r => valueMap[r]).filter(v => v !== undefined);
  if (vals.length !== ranks.length) return false;
  vals.sort((a, b) => a - b);
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] !== vals[i - 1] + 1) return false;
  }
  return true;
}

// 能否压过上家出的牌
function canBeat(currentPlay, lastPlay) {
  const { type: curType, mainValue: curVal, length: curLen } = currentPlay;
  const { type: lastType, mainValue: lastVal, length: lastLen } = lastPlay;
  
  // 如果上家没牌（新回合），任何合法牌型都可以出
  if (!lastPlay) return true;
  
  const curPower = HAND_POWER[curType];
  const lastPower = HAND_POWER[lastType];
  
  // 不同牌型大类的比较：特殊牌型可以压普通牌型
  if (curPower > lastPower) return true;
  if (curPower < lastPower) return false;
  
  // 同一大类牌型
  if (curType === lastType) {
    if (curLen === lastLen) {
      return curVal > lastVal;
    }
    // 炸弹：张数多的更大
    if (curType === HAND_TYPE.BOMB) {
      if (curLen !== lastLen) return curLen > lastLen;
      return curVal > lastVal;
    }
    return false;
  }
  
  // 顺子和连对同等级，但类型不同不能互压
  if (curPower === lastPower && curType !== lastType) {
    return false;
  }
  
  return false;
}

// 从上家牌推断在出什么牌型，然后判断这手牌是否能接上
function canPlayOn(cards, lastPlay) {
  const currentPlay = analyzeHand(cards);
  if (currentPlay.type === HAND_TYPE.INVALID) return false;
  return canBeat(currentPlay, lastPlay);
}

module.exports = {
  HAND_TYPE, HAND_POWER,
  analyzeHand, canBeat, canPlayOn
};
