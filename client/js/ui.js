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
