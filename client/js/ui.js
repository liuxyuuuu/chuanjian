// 音效系统 - Web Audio API 合成音效
const Sound = {
  _ctx: null,
  _enabled: true,
  _init() {
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this._ctx = new AC();
    }
    if (this._ctx && this._ctx.state === 'suspended') {
      this._ctx.resume();
    }
  },
  toggle() {
    this._enabled = !this._enabled;
    return this._enabled;
  },
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
        case 'finish': this._sweep(600, 1000, 0.3); break;
      }
    } catch (e) { /* 静默失败 */ }
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
      gain.gain.setValueAtTime(0.13, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t); osc.stop(t + dur + 0.02);
    }
  },
  _sweep(f0, f1, dur) {
    const t = this._ctx.currentTime;
    const osc = this._ctx.createOscillator();
    const gain = this._ctx.createGain();
    osc.connect(gain); gain.connect(this._ctx.destination);
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(); osc.stop(t + dur + 0.03);
  }
};

// UI 工具函数
const UI = {
  _toastTimer: null,

  showToast(msg, duration) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add("hidden"), duration || 2000);
  },

  showPage(pageId) {
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    const page = document.getElementById(pageId);
    if (page) page.classList.add("active");
  },

  showOverlay(id) {
    document.getElementById(id).classList.remove("hidden");
  },

  hideOverlay(id) {
    document.getElementById(id).classList.add("hidden");
  },

  showConfirm(title, text, onConfirm) {
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-text").textContent = text;
    document.getElementById("confirm-yes").onclick = () => {
      UI.hideOverlay("confirm-overlay");
      if (onConfirm) onConfirm();
    };
    this.showOverlay("confirm-overlay");
  },

  SUIT_SYMBOLS: { S: "♠", H: "♥", C: "♣", D: "♦" },
  SUIT_COLORS: { S: "black", H: "red", C: "black", D: "red" },
  SUIT_NAMES: { S: "黑桃", H: "红心", C: "梅花", D: "方块" },

  RANK_NAMES: { "3": "3", "2": "2", "A": "A", "K": "K", "Q": "Q", "J": "J", "10": "10", "9": "9", "8": "8", "7": "7", "6": "6", "5": "5", "4": "4" },

  formatCard(card) {
    if (!card) return "";
    const suit = card.suit || card.id?.[0];
    const rank = card.rank || card.id?.slice(1);
    return { suit, rank, symbol: this.SUIT_SYMBOLS[suit] || "", color: this.SUIT_COLORS[suit] || "black", display: `${this.SUIT_SYMBOLS[suit] || ""}${rank}` };
  },

  renderCardElement(card, small) {
    const f = this.formatCard(card);
    const el = document.createElement("div");
    el.className = `play-card ${f.color}`;
    el.textContent = f.display;
    if (small) el.style.fontSize = "0.7rem";
    return el;
  },

  renderHandCard(card) {
    const f = this.formatCard(card);
    const el = document.createElement("div");
    el.className = `hand-card ${f.color}`;
    el.dataset.cardId = card.id;
    const rankSpan = document.createElement("div");
    rankSpan.className = "card-rank";
    rankSpan.textContent = f.rank;
    const suitSpan = document.createElement("div");
    suitSpan.className = "card-suit";
    suitSpan.textContent = f.symbol;
    el.appendChild(rankSpan);
    el.appendChild(suitSpan);
    return el;
  },

  HANDS: {
    single: "单张",
    pair: "对子",
    straight: "顺子",
    consecutive_pairs: "连对",
    sword_44a: "剑（44A）",
    small_thunder: "小雷（666）",
    big_thunder: "大雷（QQQ）",
    bomb: "炸弹",
    invalid: "无效"
  },

  getHandName(type) {
    return this.HANDS[type] || type;
  }
};
