// 游戏界面渲染
const GameUI = {
  myIndex: -1,
  players: [],
  myHand: [],
  selectedCards: new Set(),
  seatOrder: [],
  isMyTurn: false,
  gameState: null,
  calledCardId: null,
  lastPlayCards: [],
  _countdownTimer: null,
  _countdownSec: 0,
  _avatars: [],
  _seats: ['player-bottom', 'player-right', 'player-top', 'player-left'],

  // 初始化座位映射
  initSeats(myIdx) {
    this.myIndex = myIdx;
    const bottom = myIdx;
    const right = (myIdx + 1) % 4;
    const top = (myIdx + 2) % 4;
    const left = (myIdx + 3) % 4;
    this.seatOrder = [bottom, right, top, left];
    
    // Generate avatars for AI players
    this._avatars = [null, null, null, null];
  },

  getSeatForPlayerIndex(playerIndex) {
    const idx = this.seatOrder.indexOf(playerIndex);
    return this._seats[idx] || 'player-bottom';
  },

  moveActionBarToTop() {
    const bar = document.getElementById('action-bar');
    const timer = document.getElementById('game-timer');
    const container = document.querySelector('.game-container');
    if (bar && timer && container && bar.parentNode === container) {
      container.insertBefore(bar, timer);
    }
  },

  getSeatName(playerIndex) {
    const idx = this.seatOrder.indexOf(playerIndex);
    return ['bottom', 'right', 'top', 'left'][idx] || 'bottom';
  },

  // 渲染游戏桌面
  renderTable(gameState) {
    this.gameState = gameState;
    this.players = gameState.players;
    this.myHand = gameState.myHand || [];
    this.myIndex = gameState.myIndex;

    if (!this.seatOrder.length) this.initSeats(this.myIndex);

    // Move action bar above hand area
    this.moveActionBarToTop();

    // Render four seats
    this.players.forEach((p, i) => {
      const seat = this.getSeatForPlayerIndex(i);
      if (!seat) return;

      const seatEl = document.getElementById(seat);
      if (!seatEl) return;

      this.renderPlayerLastPlay(i, this.getSeatName(i));

      const nameEl = seatEl.querySelector('.player-name');
      const countEl = seatEl.querySelector('.player-card-count');
      const badgeEl = seatEl.querySelector('.player-badge');
      const avatarEl = seatEl.querySelector('.player-avatar');

      // Avatar
      if (avatarEl) {
        const isMe = i === this.myIndex;
        if (isMe) {
          const savedAvatar = localStorage.getItem('chuanjian_avatar') || '🧑';
          avatarEl.textContent = savedAvatar;
          avatarEl.classList.remove('clickable');
          avatarEl.title = '你自己';
        } else if (p.isBot) {
          if (!this._avatars[i]) {
            this._avatars[i] = getRandomEmoji();
          }
          avatarEl.textContent = this._avatars[i];
          avatarEl.style.background = getBgColor(i);
          avatarEl.classList.add('clickable');
          avatarEl.title = '扔番茄给 ' + p.nickname;
          avatarEl.onclick = (e) => {
            e.stopPropagation();
            throwTomato(p.nickname, avatarEl);
          };
        } else {
          avatarEl.textContent = p.avatar || p.nickname[0];
          avatarEl.style.background = getBgColor(i + 3);
          avatarEl.classList.add('clickable');
          avatarEl.title = '扔番茄给 ' + p.nickname;
          avatarEl.onclick = (e) => {
            e.stopPropagation();
            throwTomato(p.nickname, avatarEl);
          };
        }
      }

      if (nameEl) {
        const sc = (this.gameState?.cumulativeScores || [0,0,0,0])[i] || 0;
        nameEl.textContent = p.nickname + (sc !== 0 ? ` [${sc > 0 ? '+' : ''}${sc}]` : '');
      }
      if (countEl) {
        if (p.finished) {
          countEl.textContent = `✓ 第${p.finishPosition}名`;
        } else {
          countEl.textContent = `剩${p.cardCount}张`;
        }
      }

      // Badge
      badgeEl.className = 'player-badge';
      if (p.finished) {
        badgeEl.classList.add('finished');
        badgeEl.textContent = `#${p.finishPosition}`;
      } else if (p.isDeclarer) {
        badgeEl.classList.add('declarer');
        badgeEl.textContent = '庄';
      } else if (p.isTeammate) {
        badgeEl.classList.add('bangzhuang');
        badgeEl.textContent = '帮庄';
      } else if (!this.gameState.teammateRevealed) {
        badgeEl.classList.add('xian');
        badgeEl.textContent = '闲';
      }
      // Active turn pulse (keeps role text, adds glow)
      if (this.gameState.currentTurn === i && !this.isMyTurn && !p.finished) {
        badgeEl.classList.add('active');
      }
    });

    // Play area
    if (gameState.lastPlay) {
      this.renderPlayArea(gameState.lastPlay);
    } else {
      document.getElementById('play-cards').innerHTML = '';
    }

    this.renderHand();
    this.updateActionButtons();

    // Countdown
    if (this.isMyTurn && gameState.phase === 'playing') {
      this.startCountdown(20);
    } else {
      this.stopCountdown();
    }

    // Status text
    const statusEl = document.getElementById('game-status-text');
    if (statusEl) {
      if (gameState.phase === 'call') {
        statusEl.textContent = '叫牌阶段';
      } else if (gameState.phase === 'playing') {
        statusEl.textContent = '出牌中';
      } else if (gameState.phase === 'finished') {
        statusEl.textContent = '游戏结束';
      }
    }

    this.renderCalledCard(gameState);
  },

  renderPlayerLastPlay(playerIndex, seat) {
    const container = document.getElementById(`played-${seat}`);
    if (!container) return;
    container.innerHTML = '';

    const lastPlays = this.gameState?.lastPlays;
    if (!lastPlays) return;

    const lp = lastPlays[playerIndex];
    if (!lp || !lp.cards || lp.cards.length === 0) return;

    // Add hand type label per-seat
    if (lp.handAnalysis && lp.handAnalysis.type) {
      const typeLabel = document.createElement('div');
      typeLabel.className = 'played-label';
      typeLabel.textContent = UI.getHandName(lp.handAnalysis.type);
      container.appendChild(typeLabel);
    }

    lp.cards.forEach(cardId => {
      const suit = cardId[0];
      const rank = cardId.slice(1);
      const el = UI.renderCardElement({ suit, rank });
      el.style.cssText = 'width:30px;height:40px;font-size:0.7rem;margin:0 2px;';
      container.appendChild(el);
    });
  },

  animateCardsFly(playerIndex, cards) {
    if (playerIndex === this.myIndex) return;
    const seatName = this.getSeatName(playerIndex);
    const seatEl = document.getElementById(`player-${seatName}`);
    const targetEl = document.getElementById("played-${seatName}");
    if (!seatEl || !targetEl) return;

    const src = seatEl.getBoundingClientRect();
    const dst = targetEl.getBoundingClientRect();

    cards.forEach((cardId, i) => {
      const suit = cardId[0];
      const rank = cardId.slice(1);
      const el = UI.renderCardElement({ suit, rank });
      el.className += ' flying-card';
      const startX = src.left + src.width / 2 - 22;
      const startY = src.top + src.height / 2 - 29;
      const dx = dst.left + dst.width / 2 - startX - 22;
      const dy = dst.top + dst.height / 2 - startY - 29;
      el.style.position = 'fixed';
      el.style.left = startX + 'px';
      el.style.top = startY + 'px';
      el.style.zIndex = '500';
      el.style.pointerEvents = 'none';
      el.style.setProperty('--dx', dx + 'px');
      el.style.setProperty('--dy', dy + 'px');
      el.style.animationDelay = (i * 0.06) + 's';
      document.body.appendChild(el);
      el.addEventListener('animationend', function() { el.remove(); }, { once: true });
    });
  },

  renderCalledCard(gameState) {
    const bar = document.getElementById('called-card-bar');
    const display = document.getElementById('called-card-display');
    if (!bar || !display) return;

    const calledCard = gameState.calledCard;
    if (calledCard && gameState.phase === 'playing') {
      const suit = calledCard[0];
      const rank = calledCard.slice(1);
      const f = UI.formatCard({ suit, rank });
      display.innerHTML = '';
      const cardEl = UI.renderCardElement({ suit, rank }, true);
      cardEl.style.cssText = 'width:26px;height:34px;font-size:0.7rem;margin-right:4px;';
      display.appendChild(cardEl);
      const labelSpan = document.createElement('span');
      labelSpan.textContent = rank;
      display.appendChild(labelSpan);
      bar.classList.remove('hidden');
    } else {
      bar.classList.add('hidden');
    }
  },

  renderPlayArea(lastPlay) {
    const area = document.getElementById('play-cards');
    area.innerHTML = '';
    if (!lastPlay || !lastPlay.cards) return;

    // Label moved to per-seat area

    const cardsDiv = document.createElement('div');
    cardsDiv.style.cssText = 'display:flex;gap:4px;justify-content:center;';
    lastPlay.cards.forEach(cardId => {
      const suit = cardId[0];
      const rank = cardId.slice(1);
      const el = UI.renderCardElement({ suit, rank });
      cardsDiv.appendChild(el);
    });
    area.appendChild(cardsDiv);
  },

  renderHand() {
    const container = document.getElementById('hand-cards');
    if (!container) return;
    container.innerHTML = '';

    if (!this.myHand || this.myHand.length === 0) {
      container.innerHTML = '<div style="color:rgba(230,200,100,0.2);text-align:center;padding:20px;font-family:\'ZCOOL XiaoWei\',serif;letter-spacing:2px;">手牌已空</div>';
      return;
    }

    const sorted = [...this.myHand].sort((a, b) => {
      const order = { '3': 15, '2': 14, 'A': 13, 'K': 12, 'Q': 11, 'J': 10, '10': 9, '9': 8, '8': 7, '7': 6, '6': 5, '5': 4, '4': 3 };
      const va = order[a.rank] || 0;
      const vb = order[b.rank] || 0;
      if (vb !== va) return vb - va;
      const suitOrder = { S: 4, H: 3, C: 2, D: 1 };
      return (suitOrder[b.suit] || 0) - (suitOrder[a.suit] || 0);
    });

    sorted.forEach((card, idx) => {
      const el = UI.renderHandCard(card);
      el.style.zIndex = idx;
      if (this.selectedCards.has(card.id)) el.classList.add('selected');
      el.onclick = () => this.toggleCardSelection(card.id);
      container.appendChild(el);
    });
  },

  toggleCardSelection(cardId) {
    if (!this.isMyTurn) return;
    if (this.gameState?.phase !== 'playing') return;

    if (this.selectedCards.has(cardId)) {
      this.selectedCards.delete(cardId);
    } else {
      this.selectedCards.add(cardId);
    }
    this.renderHandSelection();
  },

  renderHandSelection() {
    var selIdx = 0;
    document.querySelectorAll('.hand-card').forEach(el => {
      var isSel = this.selectedCards.has(el.dataset.cardId);
      el.classList.toggle('selected', isSel);
      if (isSel) el.style.zIndex = 200 + (selIdx++);
    });
    const playBtn = document.getElementById('action-play');
    if (playBtn) {
      playBtn.textContent = this.selectedCards.size > 0
        ? `出牌 (${this.selectedCards.size})`
        : '出牌';
    }
  },

  clearSelection() {
    this.selectedCards.clear();
    this.renderHandSelection();
  },

  updateActionButtons() {
    const passBtn = document.getElementById('action-pass');
    const playBtn = document.getElementById('action-play');
    const hintBtn = document.getElementById('action-hint');

    const isPlaying = this.gameState?.phase === 'playing';

    if (this.isMyTurn && isPlaying) {
      playBtn.style.display = '';
      passBtn.style.display = '';
      hintBtn.style.display = '';

      if (!this.gameState?.lastPlay) {
        passBtn.disabled = true;
        passBtn.style.opacity = '0.3';
      } else {
        passBtn.disabled = false;
        passBtn.style.opacity = '';
      }
    } else {
      playBtn.style.display = 'none';
      passBtn.style.display = 'none';
      hintBtn.style.display = 'none';
    }
  },

  showCallOverlay(hand) {
    const overlay = document.getElementById('call-overlay');
    overlay.classList.remove('hidden');

    const container = document.getElementById('call-cards');
    container.innerHTML = '';

    const suits = ['S', 'H', 'C', 'D'];
    const ranks = ['3', '2', 'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4'];
    const handIds = new Set(hand.map(c => c.id));

    let selectedCall = null;

    suits.forEach(suit => {
      ranks.forEach(rank => {
        const cardId = suit + rank;
        if (handIds.has(cardId)) return;

        const el = document.createElement('div');
        el.className = 'call-card-item';
        el.textContent = UI.SUIT_SYMBOLS[suit] + rank;
        el.style.color = (suit === 'H' || suit === 'D') ? 'var(--card-red)' : 'var(--ink-dark)';
        el.onclick = () => {
          container.querySelectorAll('.call-card-item').forEach(e => e.classList.remove('selected'));
          el.classList.add('selected');
          selectedCall = cardId;
        };
        container.appendChild(el);
      });
    });

    document.getElementById('confirm-call-btn').onclick = () => {
      if (!selectedCall) {
        UI.showToast('请选择一张牌');
        return;
      }
      emitCallCard(selectedCall);
    };
  },

  hideCallOverlay() {
    document.getElementById('call-overlay').classList.add('hidden');
  },

  showTeammateReveal(data) {
    // Find the avatar element
    const playerIdx = data.teammateIndex;
    if (playerIdx === undefined) playerIdx = this.players.findIndex(p => p.nickname === data.teammateNickname);
    if (playerIdx >= 0) {
      const seat = this.getSeatForPlayerIndex(playerIdx);
      const avatarEl = document.querySelector(`#${seat} .player-avatar`);
      if (avatarEl) {
        UI.showTeammateSeal(avatarEl, data.teammateNickname);
      } else {
        // Fallback
        const overlay = document.getElementById('teammate-overlay');
        const text = document.getElementById('teammate-text');
        text.textContent = `队友是：${data.teammateNickname}！`;
        overlay.classList.remove('hidden');
        setTimeout(() => overlay.classList.add('hidden'), 3000);
      }
    } else {
      const overlay = document.getElementById('teammate-overlay');
      const text = document.getElementById('teammate-text');
      text.textContent = `队友是：${data.teammateNickname}！`;
      overlay.classList.remove('hidden');
      setTimeout(() => overlay.classList.add('hidden'), 3000);
    }
  },

  showResult(result) {
    const overlay = document.getElementById('result-overlay');
    const title = document.getElementById('result-title');
    const details = document.getElementById('result-details');

    details.innerHTML = '';

    const me = this.players[this.myIndex];
    const isDeclarer = me?.isDeclarer;
    const isTeammate = me?.isTeammate;

    // Figure out which team the player is on
    const team1 = result.team1;
    const team2 = result.team2;
    const onTeam1 = team1 && team1.includes(this.myIndex);
    const myTeamScore = onTeam1 ? result.team1Score : result.team2Score;

    // Render rankings
    result.details.forEach(d => {
      const item = document.createElement('div');
      item.className = 'result-item';

      const pos = document.createElement('span');
      pos.className = `pos pos-${d.position}`;
      pos.textContent = `#${d.position}`;

      const name = document.createElement('span');
      name.className = 'result-name';
      name.textContent = d.nickname;

      const scoreVal = document.createElement('span');
      scoreVal.className = `result-score-val ${d.score > 0 ? 'win' : d.score < 0 ? 'lose' : ''}`;
      scoreVal.textContent = d.score > 0 ? `+${d.score}` : `${d.score}`;

      const role = document.createElement('span');
      role.className = `result-role ${d.isDeclarer ? 'declarer' : ''} ${d.isTeammate ? 'bangzhuang' : ''} ${!d.isDeclarer && !d.isTeammate ? 'xian' : ''}`;
      role.textContent = d.isDeclarer ? '庄' : d.isTeammate ? '帮庄' : '闲';

      item.appendChild(pos);
      item.appendChild(name);
      item.appendChild(scoreVal);
      item.appendChild(role);
      details.appendChild(item);
    });

    // Show bomb info
    if (result.bombCount && result.bombCount > 0) {
      const bombInfo = document.createElement('div');
      bombInfo.className = 'result-bomb-info';
      bombInfo.textContent = `💥 炸弹 × ${result.bombCount}（倍数 ×${result.multiplier}）`;
      details.appendChild(bombInfo);
    }

    // Score
    const scoreDiv = document.createElement('div');
    scoreDiv.className = `result-score ${myTeamScore > 0 ? 'win' : (myTeamScore < 0 ? 'lose' : '')}`;
    if (myTeamScore > 0) {
      scoreDiv.textContent = `胜利 · +${myTeamScore} 分`;
      title.textContent = '胜';
    } else if (myTeamScore < 0) {
      scoreDiv.textContent = `败 · ${myTeamScore} 分`;
      title.textContent = '败';
    } else {
      scoreDiv.textContent = '平局 · 0 分';
      title.textContent = '和';
    }

    // Gold update for online matches
    if (window._isMatch) {
      var goldChange = 0;
      if (myTeamScore > 0) goldChange = 10;
      else if (myTeamScore < 0) goldChange = -10;
      var goldDiv = document.getElementById('result-gold');
      if (goldDiv) {
        if (goldChange > 0) goldDiv.textContent = '🪙 +' + goldChange + ' 金币';
        else if (goldChange < 0) goldDiv.textContent = '🪙 ' + goldChange + ' 金币';
        else goldDiv.textContent = '';
      }
      if (typeof updateGold === 'function' && goldChange !== 0) {
        updateGold(goldChange);
      }
    }
    Sound.play(myTeamScore > 0 ? 'win' : 'lose');
    details.appendChild(scoreDiv);

    overlay.classList.remove('hidden');

    if (window._isQuickAI) {
      // AI mode: don't auto-restart, let user click back
    } else {
      if (window._restartTimer) clearTimeout(window._restartTimer);
      window._restartTimer = setTimeout(() => emitRestartGame(), 6000);
    }
  },

  startCountdown(seconds) {
    this.stopCountdown();
    this._countdownSec = seconds;
    const timerEl = document.getElementById('game-timer');
    if (!timerEl) return;
    timerEl.textContent = seconds;
    timerEl.className = 'game-timer-center';
    this._countdownTimer = setInterval(() => {
      this._countdownSec--;
        if (this._countdownSec <= 0) {
        this.stopCountdown();
        // Auto-play or pass on timeout
        if (this.isMyTurn && this.myHand.length > 0) {
          if (this.gameState && this.gameState.lastPlay && typeof emitPass === 'function') {
            emitPass();
          } else if (typeof emitPlayCards === 'function') {
            var cards = [...this.myHand].sort(function(a,b){return a.value-b.value;});
            if (cards.length > 0) {
              var card = cards[0];
              this.myHand = this.myHand.filter(function(c){return c.id!==card.id;});
              this.renderHand();
              emitPlayCards([card.id], [card]);
            }
          }
        }
        timerEl.textContent = '超时';
        timerEl.className = 'game-timer-center urgent';
        return;
      }
      timerEl.textContent = this._countdownSec;
      timerEl.className = 'game-timer-center' + (this._countdownSec <= 5 ? ' urgent' : '');
    }, 1000);
  },

  stopCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
    const timerEl = document.getElementById('game-timer');
    if (timerEl) { timerEl.textContent = ''; timerEl.className = 'game-timer-center'; }
  },

  hideResult() {
    document.getElementById('result-overlay').classList.add('hidden');
  },

  reset() {
    this.stopCountdown();
    this.myIndex = -1;
    this.players = [];
    this.myHand = [];
    this.selectedCards.clear();
    this.seatOrder = [];
    this.isMyTurn = false;
    this.gameState = null;
    this.calledCardId = null;
    this.lastPlayCards = [];
    this._avatars = [];
    document.getElementById('play-cards').innerHTML = '';
    document.getElementById('hand-cards').innerHTML = '';
    document.querySelectorAll('.player-badge').forEach(el => { el.className = 'player-badge'; });
    document.querySelectorAll('.player-avatar').forEach(el => {
      el.classList.remove('teammate-revealed');
      const seal = el.querySelector('.avatar-seal');
      if (seal) seal.remove();
      el.style.background = '';
    });
    this.hideCallOverlay();
    this.hideResult();
    document.getElementById('action-play').style.display = 'none';
    document.getElementById('action-pass').style.display = 'none';
    document.getElementById('action-hint').style.display = 'none';
  }
};
