// 游戏界面渲染
const GameUI = {
  myIndex: -1,
  players: [],
  myHand: [],
  selectedCards: new Set(),
  seatOrder: [], // 座位顺序: [bottomIndex, rightIndex, topIndex, leftIndex]
  isMyTurn: false,
  gameState: null,
  calledCardId: null,
  lastPlayCards: [],

  // 初始化座位映射：以自己为底
  initSeats(myIdx, seatIndices) {
    this.myIndex = myIdx;
    // seatIndices 是庄家开始的依次顺序
    // 找到自己的位置，然后映射到 底->右->顶->左
    const bottom = myIdx;
    const right = (myIdx + 1) % 4;
    const top = (myIdx + 2) % 4;
    const left = (myIdx + 3) % 4;
    this.seatOrder = [bottom, right, top, left];
  },

  getSeatForPlayerIndex(playerIndex) {
    const idx = this.seatOrder.indexOf(playerIndex);
    return ["bottom", "right", "top", "left"][idx];
  },

  // 渲染游戏桌面
  renderTable(gameState) {
    this.gameState = gameState;
    this.players = gameState.players;
    this.myHand = gameState.myHand || [];
    this.myIndex = gameState.myIndex;
    
    if (!this.seatOrder.length) {
      this.initSeats(this.myIndex);
    }

    // 渲染四个座位
    this.players.forEach((p, i) => {
      const seat = this.getSeatForPlayerIndex(i);
      if (!seat) return;
      
      const seatEl = document.getElementById(`player-${seat}`);
      if (!seatEl) return;
      
      const nameEl = seatEl.querySelector(".player-name");
      const countEl = seatEl.querySelector(".player-card-count");
      const badgeEl = seatEl.querySelector(".player-badge");
      
      if (nameEl) nameEl.textContent = p.nickname;
      if (countEl) {
        if (p.finished) {
          countEl.textContent = `✓ 第${p.finishPosition}名`;
        } else {
          countEl.textContent = `剩${p.cardCount}张`;
        }
      }
      
      // 徽章
      badgeEl.className = "player-badge";
      if (p.finished) {
        badgeEl.classList.add("finished");
        badgeEl.textContent = `#${p.finishPosition}`;
      } else if (this.gameState.currentTurn === i && !this.isMyTurn) {
        badgeEl.classList.add("active");
        badgeEl.textContent = "出牌中";
      } else if (p.isDeclarer && this.gameState.teammateRevealed) {
        badgeEl.classList.add("declarer");
        badgeEl.textContent = "庄";
      } else if (p.isTeammate) {
        badgeEl.classList.add("teammate");
        badgeEl.textContent = "队友";
      }
    });

    // 渲染出牌区
    if (gameState.lastPlay) {
      this.renderPlayArea(gameState.lastPlay);
    } else {
      document.getElementById("play-cards").innerHTML = "";
    }

    // 渲染手牌
    this.renderHand();
    
    // 更新动作按钮
    this.updateActionButtons();
    
    // 更新游戏状态
    const statusEl = document.getElementById("game-status-text");
    if (statusEl) {
      if (gameState.phase === "call") {
        statusEl.textContent = "叫牌阶段";
      } else if (gameState.phase === "playing") {
        statusEl.textContent = "出牌中";
      } else if (gameState.phase === "finished") {
        statusEl.textContent = "游戏结束";
      }
    }

    // 如果队友已揭示，显示提示
    if (gameState.teammateRevealed) {
      // 检查自己是否是队友
      const me = this.players[this.myIndex];
      if (me && me.isTeammate) {
        // 在某个地方显示自己是队友
      }
    }
  },

  // 渲染出牌区
  renderPlayArea(lastPlay) {
    const area = document.getElementById("play-cards");
    area.innerHTML = "";
    if (!lastPlay || !lastPlay.cards) return;

    // 显示谁出的
    const player = this.players[lastPlay.playerIndex];
    if (player) {
      const label = document.createElement("div");
      label.style.cssText = "color:rgba(255,255,255,0.5);font-size:0.7rem;margin-bottom:4px;text-align:center;";
      label.textContent = `${player.nickname} 出了 ${UI.getHandName(lastPlay.handAnalysis?.type)}`;
      area.appendChild(label);
    }

    const cardsDiv = document.createElement("div");
    cardsDiv.style.cssText = "display:flex;gap:4px;justify-content:center;";
    lastPlay.cards.forEach(cardId => {
      // cardId is like "H4", "S13"
      const suit = cardId[0];
      const rank = cardId.slice(1);
      const el = UI.renderCardElement({ suit, rank });
      cardsDiv.appendChild(el);
    });
    area.appendChild(cardsDiv);
  },

  // 渲染手牌
  renderHand() {
    const container = document.getElementById("hand-cards");
    container.innerHTML = "";
    
    if (!this.myHand || this.myHand.length === 0) {
      container.innerHTML = '<div style="color:rgba(255,255,255,0.3);text-align:center;padding:20px;">没有手牌</div>';
      return;
    }

    // 对自己手牌排序（从大到小）
    const sorted = [...this.myHand].sort((a, b) => {
      // 自定义排序：3>2>A>K>Q>J>10>9>8>7>6>5>4
      const order = { "3": 15, "2": 14, "A": 13, "K": 12, "Q": 11, "J": 10, "10": 9, "9": 8, "8": 7, "7": 6, "6": 5, "5": 4, "4": 3 };
      const va = order[a.rank] || 0;
      const vb = order[b.rank] || 0;
      if (vb !== va) return vb - va;
      const suitOrder = { S: 4, H: 3, C: 2, D: 1 };
      return (suitOrder[b.suit] || 0) - (suitOrder[a.suit] || 0);
    });

    sorted.forEach(card => {
      const el = UI.renderHandCard(card);
      if (this.selectedCards.has(card.id)) {
        el.classList.add("selected");
      }
      el.onclick = () => this.toggleCardSelection(card.id);
      container.appendChild(el);
    });
  },

  // 切换牌的选择状态
  toggleCardSelection(cardId) {
    if (!this.isMyTurn) return;
    if (this.gameState?.phase !== "playing") return;
    
    if (this.selectedCards.has(cardId)) {
      this.selectedCards.delete(cardId);
    } else {
      this.selectedCards.add(cardId);
    }
    this.renderHandSelection();
  },

  renderHandSelection() {
    document.querySelectorAll(".hand-card").forEach(el => {
      el.classList.toggle("selected", this.selectedCards.has(el.dataset.cardId));
    });
    // 更新选中的牌数显示
    const playBtn = document.getElementById("action-play");
    if (playBtn) {
      playBtn.textContent = this.selectedCards.size > 0
        ? `出牌 (${this.selectedCards.size})`
        : "出牌";
    }
  },

  clearSelection() {
    this.selectedCards.clear();
    this.renderHandSelection();
  },

  // 更新动作按钮
  updateActionButtons() {
    const passBtn = document.getElementById("action-pass");
    const playBtn = document.getElementById("action-play");
    const hintBtn = document.getElementById("action-hint");
    
    const isPlaying = this.gameState?.phase === "playing";
    
    if (this.isMyTurn && isPlaying) {
      playBtn.style.display = "";
      passBtn.style.display = "";
      hintBtn.style.display = "";
      
      // 如果是新回合（没有上家牌），禁用过牌按钮
      if (!this.gameState?.lastPlay) {
        passBtn.disabled = true;
        passBtn.style.opacity = "0.4";
      } else {
        passBtn.disabled = false;
        passBtn.style.opacity = "";
      }
    } else {
      playBtn.style.display = "none";
      passBtn.style.display = "none";
      hintBtn.style.display = "none";
    }
  },

  // 显示叫牌界面
  showCallOverlay(hand) {
    const overlay = document.getElementById("call-overlay");
    overlay.classList.remove("hidden");
    
    const container = document.getElementById("call-cards");
    container.innerHTML = "";
    
    // 获取所有52张牌
    const suits = ["S", "H", "C", "D"];
    const ranks = ["3", "2", "A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4"];
    
    // 自己手里的牌id
    const handIds = new Set(hand.map(c => c.id));
    
    let selectedCall = null;
    
    suits.forEach(suit => {
      ranks.forEach(rank => {
        const cardId = suit + rank;
        if (handIds.has(cardId)) return; // 跳过自己有的牌
        
        const el = document.createElement("div");
        el.className = "call-card-item";
        el.textContent = UI.SUIT_SYMBOLS[suit] + rank;
        el.style.color = (suit === "H" || suit === "D") ? "#d32f2f" : "#fff";
        el.onclick = () => {
          container.querySelectorAll(".call-card-item").forEach(e => e.classList.remove("selected"));
          el.classList.add("selected");
          selectedCall = cardId;
        };
        container.appendChild(el);
      });
    });
    
    const confirmBtn = document.getElementById("confirm-call-btn");
    confirmBtn.onclick = () => {
      if (!selectedCall) {
        UI.showToast("请选择一张牌");
        return;
      }
      emitCallCard(selectedCall);
    };
  },

  // 隐藏叫牌界面
  hideCallOverlay() {
    document.getElementById("call-overlay").classList.add("hidden");
  },

  // 显示队友揭晓
  showTeammateReveal(data) {
    const overlay = document.getElementById("teammate-overlay");
    const text = document.getElementById("teammate-text");
    text.textContent = `队友是：${data.teammateNickname}！`;
    overlay.classList.remove("hidden");
    setTimeout(() => overlay.classList.add("hidden"), 3000);
  },

  // 显示结果
  showResult(result) {
    const overlay = document.getElementById("result-overlay");
    const title = document.getElementById("result-title");
    const details = document.getElementById("result-details");
    
    details.innerHTML = "";
    
    // 判断输赢
    const me = this.players[this.myIndex];
    const isDeclarer = me?.isDeclarer;
    const isTeammate = me?.isTeammate;
    // For the player, we might not know which team we're on if not revealed
    // But we can figure it out from the result
    
    // 渲染名次
    result.details.forEach(d => {
      const item = document.createElement("div");
      item.className = "result-item";
      
      const pos = document.createElement("span");
      pos.className = `pos pos-${d.position}`;
      pos.textContent = `#${d.position}`;
      
      const name = document.createElement("span");
      name.className = "result-name";
      name.textContent = d.nickname;
      
      const role = document.createElement("span");
      role.className = `result-role ${d.isDeclarer ? "declarer" : ""} ${d.isTeammate ? "teammate" : ""}`;
      role.textContent = d.isDeclarer ? "庄家" : d.isTeammate ? "队友" : "";
      
      item.appendChild(pos);
      item.appendChild(name);
      item.appendChild(role);
      details.appendChild(item);
    });
    
    // 显示胜负
    const scoreDiv = document.createElement("div");
    let myTeamScore = 0;
    
    // 从结果推断玩家所属队伍
    if (isDeclarer || isTeammate) {
      myTeamScore = result.team1Score;
    } else {
      // 玩家在对手队
      myTeamScore = result.team2Score;
    }
    
    scoreDiv.className = `result-score ${myTeamScore > 0 ? "win" : "lose"}`;
    if (myTeamScore > 0) {
      scoreDiv.textContent = `🎉 胜利! +${myTeamScore}分`;
      title.textContent = "胜利!";
    } else {
      scoreDiv.textContent = `😢 失败: ${myTeamScore}分`;
      title.textContent = "失败";
    }
    details.appendChild(scoreDiv);
    
    overlay.classList.remove("hidden");
  },

  // 隐藏结果
  hideResult() {
    document.getElementById("result-overlay").classList.add("hidden");
  },

  reset() {
    this.myIndex = -1;
    this.players = [];
    this.myHand = [];
    this.selectedCards.clear();
    this.seatOrder = [];
    this.isMyTurn = false;
    this.gameState = null;
    this.calledCardId = null;
    this.lastPlayCards = [];
    document.getElementById("play-cards").innerHTML = "";
    document.getElementById("hand-cards").innerHTML = "";
    document.querySelectorAll(".player-badge").forEach(el => { el.className = "player-badge"; });
    this.hideCallOverlay();
    this.hideResult();
    document.getElementById("action-play").style.display = "none";
    document.getElementById("action-pass").style.display = "none";
    document.getElementById("action-hint").style.display = "none";
  }
};
