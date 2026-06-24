// 音效系统 - Web Audio API 合成音效
const Sound = {
  _ctx: null,
  _enabled: true,
  _volume: 0.8,
  _init() {
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this._ctx = new AC();
    }
    if (this._ctx && this._ctx.state === 'suspended') this._ctx.resume();
  },
  toggle() { this._enabled = !this._enabled; return this._enabled; },
  speechStyle: 'long',
  setVolume: function(v) { this._volume = Math.max(0, Math.min(1, v)); },
  toggleSpeechStyle() { this.speechStyle = this.speechStyle === 'long' ? 'short' : 'long'; return this.speechStyle; },
  play(type) {
    if (!this._enabled) return;
    try {
      this._init();
      if (!this._ctx) return;
      switch (type) {
        case 'playCard': this._beep(800, 0.08); break;
        case 'yourTurn': this._beep(660, 0.12, 2, 0.1); break;
        case 'gameStart': this._sweep(400, 900, 0.35); break;
        case 'win': this._sweep(500, 1200, 0.5); break;
        case 'lose': this._sweep(800, 200, 0.5); break;
        case 'teammate': this._beep(780, 0.15, 3, 0.08); break;
        case 'pass': this._beep(350, 0.06); break;
        case 'callCard': this._beep(520, 0.18); break;
        case 'bomb': this._sweep(200, 1500, 0.6); break;
        case 'sword': this._sweep(300, 1800, 0.5); break;
        case 'thunder': this._sweep(100, 600, 0.7); break;
        case 'finish': this._sweep(600, 1000, 0.3); break;
      }
    } catch (e) {}
  },
  _beep(freq, dur, count, gap) {
    count = count || 1; gap = gap || dur;
    for (let i = 0; i < count; i++) {
      const t = this._ctx.currentTime + i * (dur + gap);
      const osc = this._ctx.createOscillator();
      const gain = this._ctx.createGain();
      osc.connect(gain); gain.connect(this._ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.13 * this._volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t); osc.stop(t + dur + 0.02);
    }
  },

  _speak(text, opts) {
    opts = opts || {
// BGM autoplay unlock - modern browsers require user gesture
(function(){
  var _unlocked = false;
  function unlockBgm() {
    if (_unlocked) return;
    _unlocked = true;
    if (Sound._ctx && Sound._ctx.state === 'suspended') Sound._ctx.resume();
    if (!Sound._bgmPlaying) Sound.startBgm();
    document.removeEventListener('click', unlockBgm);
    document.removeEventListener('touchstart', unlockBgm);
    document.removeEventListener('keydown', unlockBgm);
  }
  document.addEventListener('click', unlockBgm);
  document.addEventListener('touchstart', unlockBgm);
  document.addEventListener('keydown', unlockBgm);
})();

};
    if (!this._enabled) return;
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = opts.rate || 1.0;
    u.pitch = opts.pitch || 0.9;
    u.volume = this._volume;
    var voices = window.speechSynthesis.getVoices();
    var zh = voices.find(function(v){ return v.lang.startsWith('zh'); });
    if (zh) u.voice = zh;
    // Speak immediately (don't wait for voices on mobile)
    window.speechSynthesis.speak(u);
    // If no voices now, retry once after they load
    if (voices.length === 0) {
      var self = this;
      window.speechSynthesis.onvoiceschanged = function() {
        window.speechSynthesis.onvoiceschanged = null;
        var v2 = window.speechSynthesis.getVoices();
        var zh2 = v2.find(function(v){ return v.lang.startsWith('zh'); });
        if (zh2) u.voice = zh2;
        window.speechSynthesis.speak(u);
      };
    }
  },
  warmupSpeech() {
    if (!window.speechSynthesis) return;
    // Prime the speech engine (required by iOS/mobile)
    window.speechSynthesis.getVoices();
    var u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    window.speechSynthesis.cancel();
  },

  _rankToChinese(rank) {
    var map = { '3': '三', '2': '二', 'A': '尖', 'K': '凯', 'Q': '圈', 'J': '勾',
      '10': '十', '9': '九', '8': '八', '7': '七', '6': '六', '5': '五', '4': '四' };
    return map[rank] || rank;
  },
  speakCards(cards, handType) {
    if (!this._enabled) return;
    if (!window.speechSynthesis) return;
    var text = this._getHandSpeech(cards, handType);
    if (!text) return;
    var opts = {};
    if (handType === 'sword_44a' || handType === 'small_thunder' || handType === 'big_thunder' || handType === 'bomb') {
      opts.rate = 0.85;
      opts.pitch = 0.8;
    }
    this._speak(text, opts);
  },
  speakEvent(eventType, data) {
    if (!this._enabled) return;
    var text = this._getEventSpeech(eventType, data);
    if (text) this._speak(text, eventType === 'reveal' ? { rate: 1.0, pitch: 0.85 } : {});
  },
  _getEventSpeech(eventType, data) {
    if (eventType === 'call' && data && data.cardId) {
      var suitNames = { S: '黑桃', H: '红心', C: '梅花', D: '方块' };
      return '庄家叫牌' + (suitNames[data.cardId[0]] || '') + this._rankToChinese(data.cardId.slice(1));
    }
    if (eventType === 'reveal') {
      var r = ['盟友已现，并肩作战', '信物显形，同袍在此', '叫牌已出，队友现身'];
      return r[Math.floor(Math.random() * r.length)];
    }
    if (eventType === 'pass') {
      return '过牌';
    }
    return '';
  },

  _getHandSpeech(cards, handType) {
    var specials = { sword_44a: '剑', small_thunder: '小雷', big_thunder: '大雷', bomb: '炸弹' };
    if (handType && specials[handType]) return specials[handType];
    if (!cards || cards.length === 0) return '';
    if (handType === 'pair') return '对' + this._rankToChinese(cards[0].rank);
    if (handType === 'straight' || handType === 'consecutive_pairs') {
      if (cards.length >= 2) {
        var fr = this._rankToChinese(cards[0].rank);
        var lr = this._rankToChinese(cards[cards.length-1].rank);
        return fr + '到' + lr;
      }
      return handType === 'straight' ? '顺子' : '连对';
    }
    if (handType === 'three_one') return '三带一';
    if (handType === 'three_two') return '三带二';
    // Single or unknown - read ranks
    var text = '';
    for (var i = 0; i < cards.length; i++) {
      var rank = cards[i].rank || (typeof cards[i] === 'string' ? cards[i].slice(1) : '');
      if (i > 0) text += ' ';
      text += this._rankToChinese(rank);
    }
    return text;
  },

  _sweep(f0, f1, dur) {
    const t = this._ctx.currentTime;
    const osc = this._ctx.createOscillator();
    const gain = this._ctx.createGain();
    osc.connect(gain); gain.connect(this._ctx.destination);
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.12 * this._volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(); osc.stop(t + dur + 0.03);
  }
};

// 国风背景色盘

// BGM autoplay unlock - modern browsers require user gesture
(function(){
  var _unlocked = false;
  function unlockBgm() {
    if (_unlocked) return;
    _unlocked = true;
    if (Sound._ctx && Sound._ctx.state === 'suspended') Sound._ctx.resume();
    if (!Sound._bgmPlaying) Sound.startBgm();
    document.removeEventListener('click', unlockBgm);
    document.removeEventListener('touchstart', unlockBgm);
    document.removeEventListener('keydown', unlockBgm);
  }
  document.addEventListener('click', unlockBgm);
  document.addEventListener('touchstart', unlockBgm);
  document.addEventListener('keydown', unlockBgm);
})();

const GUOFENG_BG = [
  'linear-gradient(135deg, #d4a373, #bc8f4f)',
  'linear-gradient(135deg, #8cb3a0, #6b9a85)',
  'linear-gradient(135deg, #c2956e, #a87a54)',
  'linear-gradient(135deg, #9b8d7a, #7d6f5c)',
  'linear-gradient(135deg, #b8856a, #9e6d52)',
  'linear-gradient(135deg, #7a9b8f, #5e8074)',
  'linear-gradient(135deg, #c9a84c, #a88630)',
  'linear-gradient(135deg, #8b7d6b, #6d5f4d)',
  'linear-gradient(135deg, #a07a6a, #81614f)',
  'linear-gradient(135deg, #6d8c7a, #54705e)',
  'linear-gradient(135deg, #b8966a, #9a7850)',
  'linear-gradient(135deg, #8c7a6a, #6e5c4c)',
];

// 随机生成 AI emoji 头像
function getRandomEmoji() {
  const emojis = ['🐉', '🦅', '🐯', '🐴', '🐍', '🦉', '🐺', '🦊', '🐲', '🐎', '🦢', '🦩', '🐈', '🦌', '🐇', '🐻', '🐼', '🐸', '🦋', '🐢', '🦎', '🐳', '🦈', '🐙'];
  return emojis[Math.floor(Math.random() * emojis.length)];
}

function getBgColor(index) {
  return GUOFENG_BG[index % GUOFENG_BG.length];
}

// UI 工具函数
const UI = {
  _toastTimer: null,

  showToast(msg, duration) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), duration || 2000);
  },

  showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(pageId);
    if (page) page.classList.add('active');
    if (window.Account && Account.renderBar) Account.renderBar();
    if (pageId === 'game-page') {
      Sound.stopBgm();
    } else if (pageId === 'lobby-page' || pageId === 'room-page') {
      Sound.startBgm();
    }
  },

  showOverlay(id) { document.getElementById(id).classList.remove('hidden'); },
  hideOverlay(id) { document.getElementById(id).classList.add('hidden'); },

  showConfirm(title, text, onConfirm) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-text').textContent = text;
    document.getElementById('confirm-yes').onclick = () => {
      UI.hideOverlay('confirm-overlay');
      if (onConfirm) onConfirm();
    };
    this.showOverlay('confirm-overlay');
  },

  SUIT_SYMBOLS: { S: '♠', H: '♥', C: '♣', D: '♦' },
  SUIT_CHINESE: { S: '黑桃', H: '红心', C: '梅花', D: '方块' },
  SUIT_COLORS: { S: 'black', H: 'red', C: 'black', D: 'red' },

  RANK_NAMES: { '3': '3', '2': '2', 'A': 'A', 'K': 'K', 'Q': 'Q', 'J': 'J', '10': '10', '9': '9', '8': '8', '7': '7', '6': '6', '5': '5', '4': '4' },

  formatCard(card) {
    if (!card) return '';
    const suit = card.suit || card.id?.[0];
    const rank = card.rank || card.id?.slice(1);
    return { suit, rank, symbol: this.SUIT_SYMBOLS[suit] || '', chinese: this.SUIT_CHINESE[suit] || '', color: this.SUIT_COLORS[suit] || 'black', display: `${this.SUIT_SYMBOLS[suit] || ''}${rank}` };
  },

  renderCardElement(card, small) {
    const f = this.formatCard(card);
    const el = document.createElement('div');
    el.className = `play-card ${f.color}`;
    el.textContent = f.display;
    if (small) el.style.fontSize = '0.7rem';
    return el;
  },

  renderHandCard(card) {
    const f = this.formatCard(card);
    const el = document.createElement('div');
    el.className = `hand-card ${f.color}`;
    el.dataset.cardId = card.id;
    const corner = document.createElement('div');
    corner.className = 'card-corner';
    const rankSpan = document.createElement('span');
    rankSpan.className = 'card-rank';
    rankSpan.textContent = f.rank;
    const suitSpan = document.createElement('span');
    suitSpan.className = 'card-suit';
    suitSpan.textContent = f.symbol;
    corner.appendChild(rankSpan);
    corner.appendChild(suitSpan);
    const center = document.createElement('div');
    center.className = 'card-center-suit';
    center.textContent = f.symbol;
    el.appendChild(corner);
    el.appendChild(center);
    return el;
  },

  HANDS: {
    single: '单张',
    pair: '对子',
    straight: '顺子',
    consecutive_pairs: '连对',
    sword_44a: '剑·44A',
    small_thunder: '小雷·666',
    big_thunder: '大雷·QQQ',
    bomb: '炸弹',
    invalid: '无效'
  },

  getHandName(type) {
    return this.HANDS[type] || type || '';
  },

  // Special effects
  playEffect(type) {
    switch (type) {
      case 'sword_44a': this.effectSword(); break;
      case 'small_thunder': this.effectThunder('small'); break;
      case 'big_thunder': this.effectThunder('big'); break;
      case 'bomb': this.effectBomb(); break;
    }
  },

  // 剑特效
  effectSword() {
    Sound.play('sword');
    const el = document.createElement('div');
    el.className = 'effect-sword';
    el.innerHTML = `
      <div class="sword-blade">🗡️</div>
      <div class="crack"></div>
      <div class="sword-text">剑·穿云</div>
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  },

  // 雷特效
  effectThunder(size) {
    Sound.play('thunder');
    const el = document.createElement('div');
    el.className = `effect-thunder ${size === 'small' ? 'small-thunder' : 'big-thunder'}`;
    el.innerHTML = `
      <div class="thunder-flash">⚡</div>
      <div class="thunder-text">${size === 'small' ? '小雷·天劫' : '大雷·天怒'}</div>
    `;
    document.body.appendChild(el);
    document.body.style.animation = 'shake 0.5s ease-out';
    setTimeout(() => {
      el.remove();
      document.body.style.animation = '';
    }, size === 'small' ? 1000 : 1400);
  },

  // 炸弹特效
  effectBomb() {
    Sound.play('bomb');
    const el = document.createElement('div');
    el.className = 'effect-bomb';
    let particles = '';
    for (let i = 0; i < 12; i++) {
      particles += '<div class="bomb-particle"></div>';
    }
    el.innerHTML = `
      <div class="bomb-core">💥</div>
      ${particles}
      <div class="bomb-text">炸·破军</div>
    `;
    document.body.appendChild(el);
    document.body.style.animation = 'shake 0.6s ease-out';
    setTimeout(() => {
      el.remove();
      document.body.style.animation = '';
    }, 1200);
  },

  // 队友揭示动画
  showTeammateSeal(avatarEl, caller) {
    // Add golden border glow
    avatarEl.classList.add('teammate-revealed');
    
    // Create seal stamp element
    const seal = document.createElement('div');
    seal.className = 'avatar-seal active';
    seal.textContent = '剑盟';
    
    // Remove existing seal and add new one
    const oldSeal = avatarEl.querySelector('.avatar-seal');
    if (oldSeal) oldSeal.remove();
    avatarEl.appendChild(seal);
    
    // Show overlay with seal
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.style.zIndex = '300';
    overlay.innerHTML = `
      <div class="overlay-content teammate-content">
        <div class="teammate-seal">剑盟</div>
        <div class="teammate-reveal-text">盟友已现 · ${caller}</div>
      </div>
    `;
    document.body.appendChild(overlay);
    Sound.play('teammate');
    setTimeout(() => overlay.remove(), 2500);
  },

  // 发牌动画
  dealAnimation(hands, callback) {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const seatPositions = this._getSeatPositions();
    
    let delay = 0;
    let totalCards = 0;
    hands.forEach(h => { totalCards += h.length; });
    
    hands.forEach((hand, playerIdx) => {
      hand.forEach((card, cardIdx) => {
        setTimeout(() => {
          const el = document.createElement('div');
          el.className = 'dealing-card';
          
          const toPos = seatPositions[playerIdx];
          const cardOffset = (cardIdx - (hand.length - 1) / 2) * 8;
          
          el.style.left = (centerX - 24) + 'px';
          el.style.top = (centerY - 35) + 'px';
          el.style.setProperty('--from-x', '0px');
          el.style.setProperty('--from-y', '0px');
          el.style.setProperty('--to-x', (toPos.x - centerX + cardOffset) + 'px');
          el.style.setProperty('--to-y', (toPos.y - centerY) + 'px');
          el.style.setProperty('--rotate-end', (Math.random() - 0.5) * 20 + 'deg');
          el.style.setProperty('--fly-duration', '0.18s');
          
          document.body.appendChild(el);
          
          setTimeout(() => el.remove(), 200);
          
          if (cardIdx === hand.length - 1 && playerIdx === hands.length - 1) {
            // All cards dealt: trigger callback after last card lands
          }
        }, delay);
        delay += 150; // 0.15s per card
      });
      delay += 50; // 0.05s pause between players
    });
    
    // Wait for all cards and callback
    setTimeout(() => {
      if (callback) callback();
    }, delay + 300);
  },

  _getSeatPositions() {
    // Returns center-relative positions for each seat
    // 0=bottom(player), 1=right, 2=top, 3=left
    const w = window.innerWidth;
    const h = window.innerHeight;
    return [
      { x: w / 2, y: h - 100 },           // bottom
      { x: w - 80, y: h / 2 + 40 },       // right
      { x: w / 2, y: 60 },                 // top
      { x: 80, y: h / 2 + 40 },            // left
    ];
  }
};
