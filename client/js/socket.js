// Socket.IO 客户端连接
let socket = null;

function initSocket() {
  socket = io();

  socket.on('connect', () => {});

  socket.on('disconnect', () => {
    if (document.getElementById('game-page').classList.contains('active')) {
      UI.showToast('连接已断开');
    }
  });

  // 房间更新
  socket.on('room_update', (data) => {
    if (data.myIndex !== undefined) myPlayerIndex = data.myIndex;
    renderPlayerList(data.players);
    updateRoomButtons(data.players, data.allReady);
  });

  // 游戏开始
  var _isQuickAI = false;
socket.on('game_start', (data) => {
    window._isQuickAI = data.isQuickAI || false;
    UI.showPage('game-page');
    Sound.play('gameStart');
    
    // Show dealing animation
    removeDealingOverlay(); // clean any leftover
    const dealOverlay = document.createElement('div');
    dealOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:400;pointer-events:none;display:flex;align-items:center;justify-content:center;flex-direction:column;background:rgba(26,20,16,0.4);';
    dealOverlay.id = 'dealing-overlay';
    const dealEmoji = document.createElement('div');
    dealEmoji.style.cssText = 'font-size:4rem;animation:deal-icon 0.6s ease-out;';
    dealEmoji.textContent = '🎴';
    dealOverlay.appendChild(dealEmoji);
    const dealText = document.createElement('div');
    dealText.style.cssText = 'font-size:1.6rem;color:var(--gold);font-family:"Ma Shan Zheng",cursive;letter-spacing:6px;margin-top:10px;text-shadow:0 0 30px rgba(201,168,76,0.5);';
    dealText.textContent = '发牌';
    dealOverlay.appendChild(dealText);
    document.body.appendChild(dealOverlay);
    
    // Auto-remove after 3.5s as fallback
    window._dealTimer = setTimeout(removeDealingOverlay, 3500);
  });
  
  function removeDealingOverlay() {
    if (window._dealTimer) { clearTimeout(window._dealTimer); window._dealTimer = null; }
    const overlay = document.getElementById('dealing-overlay');
    if (overlay) {
      overlay.style.transition = 'opacity 0.4s';
      overlay.style.opacity = '0';
      setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 400);
    }
    // Also make hidden hand cards visible
    document.querySelectorAll('.hand-card').forEach(el => { el.style.visibility = 'visible'; });
  }

  // 轮到叫牌
  socket.on('your_turn_call', (data) => {
    // Remove dealing overlay immediately so call overlay is visible
    if (window._dealTimer) { clearTimeout(window._dealTimer); window._dealTimer = null; }
    var d = document.getElementById('dealing-overlay');
    if (d) { d.style.opacity = '0'; setTimeout(function(){ if(d.parentNode) d.remove(); }, 100); }
    GameUI.showCallOverlay(data.myHand);
  });

  // 叫牌结果
  socket.on('card_called', (data) => {
    GameUI.calledCardId = data.calledCard;
    GameUI.hideCallOverlay();
    Sound.play('callCard');
    Sound.speakEvent('call', { cardId: data.calledCard });
  });

  // 队友信息（只发给庄家）
  socket.on('teammate_info', (data) => {
    Sound.play('teammate');
  });

  // 游戏状态更新
  socket.on('game_state', (data) => {
    if (!data) return;
    const wasFirstState = !GameUI.gameState;
    GameUI.isMyTurn = (data.currentTurn === data.myIndex) && data.phase === 'playing';
    GameUI.renderTable(data);
    
    // Remove first dealing-overlay when game state arrives
    (function(){
      if (window._dealTimer) { clearTimeout(window._dealTimer); window._dealTimer = null; }
      var dd = document.getElementById('dealing-overlay');
      if (dd) { dd.style.opacity = '0'; setTimeout(function(){ if(dd.parentNode) dd.remove(); }, 100); }
    })();
    // First state: trigger dealing animation
    if (wasFirstState && data.myHand && data.myHand.length > 0) {
      // Wait a tiny bit for layout to settle, then animate
      setTimeout(() => {
        // Mark existing hand cards as invisible during animation
        const handCards = document.querySelectorAll('.hand-card');
        handCards.forEach(el => { el.style.visibility = 'hidden'; });
        
        // We don't know other players' hands, but we can still animate
        // just the dealing visual from center
        const dealOverlay = document.createElement('div');
        dealOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:400;pointer-events:none;';
        document.body.appendChild(dealOverlay);
        
        // Show dealing indicator
        const centerIcon = document.createElement('div');
        centerIcon.style.cssText = `
          position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
          font-size:2rem;color:var(--gold);
          font-family:"Ma Shan Zheng",cursive;
          text-shadow:0 0 20px rgba(201,168,76,0.5);
          animation:deal-center 0.8s ease-out;
        `;
        centerIcon.textContent = '⚔️ 发牌';
        dealOverlay.appendChild(centerIcon);
        
        setTimeout(() => {
          dealOverlay.remove();
          handCards.forEach(el => { el.style.visibility = 'visible'; });
        }, 800);
      }, 100);
    }
  });

  // 轮到出牌
  socket.on('your_turn', (data) => {
    GameUI.isMyTurn = true;
    GameUI.updateActionButtons();
    Sound.play('yourTurn');
  });

  // 出牌广播
  socket.on('cards_played', (data) => {
    GameUI.clearSelection();
    Sound.play('playCard');
    // Animate cards flying from player seat to center
    if (data.cards && data.cards.length > 0) {
      const cardIds = data.cards.map(function(c) { return c.id || c; });
      GameUI.animateCardsFly(data.playerIndex, cardIds);
    }
    // Speak card names aloud
    if (data.cards && data.cards.length > 0) {
      Sound.speakCards(data.cards, data.handAnalysis?.type);
    }
    // Dispatch special effects based on hand type
    if (data.handAnalysis) {
      const type = data.handAnalysis.type;
      if (type === 'sword_44a') {
        setTimeout(() => UI.playEffect('sword_44a'), 150);
      } else if (type === 'small_thunder') {
        setTimeout(() => UI.playEffect('small_thunder'), 150);
      } else if (type === 'big_thunder') {
        setTimeout(() => UI.playEffect('big_thunder'), 150);
      } else if (type === 'bomb') {
        setTimeout(() => UI.playEffect('bomb'), 150);
      }
    }
  });

  // 过牌广播
  socket.on('player_passed', (data) => {
    Sound.play('pass');
    const player = GameUI.players[data.playerIndex];
    const name = player ? player.nickname : '玩家';
    if (data.roundReset) {
      UI.showToast(name + ' 过，新回合始');
    } else {
      UI.showToast(name + ' 过牌');
    }
  });

  // 队友揭晓
  socket.on('teammate_revealed', (data) => {
    GameUI.showTeammateReveal(data);
    Sound.speakEvent('reveal');
  });

  // 游戏结束
  socket.on('game_over', (data) => {
    GameUI.showResult(data.result);
  });

  socket.on('player_disconnected', () => {
    UI.showToast('有玩家断线');
  });
}

// ===== 服务端通信封装 =====
function emitCreateRoom(nickname, avatar) {
  return new Promise(resolve => socket.emit('create_room', { nickname, avatar }, res => resolve(res)));
}

function emitJoinRoom(roomCode, nickname, avatar) {
  return new Promise(resolve => socket.emit('join_room', { roomCode, nickname, avatar }, res => resolve(res)));
}

function emitToggleReady() { socket.emit('toggle_ready'); }

function emitStartGame() {
  return new Promise(resolve => socket.emit('start_game', {}, res => resolve(res)));
}

function emitCallCard(cardId) {
  socket.emit('call_card', { cardId }, (res) => {
    if (!res.success) {
      UI.showToast(res.reason || '叫牌失败');
    } else {
      if (res.myGameState) {
        GameUI.renderTable(res.myGameState);
        GameUI.isMyTurn = true;
        GameUI.updateActionButtons();
        GameUI.startCountdown(20);
        Sound.play('yourTurn');
      }
    }
  });
}

function emitPlayCards(cardIds, removedCards) {
  socket.emit('play_cards', { cardIds }, (res) => {
    if (!res.success) {
      if (removedCards && removedCards.length > 0) {
        GameUI.myHand = [...GameUI.myHand, ...removedCards];
        GameUI.renderHand();
      }
      UI.showToast(res.reason || '出牌失败');
      GameUI.clearSelection();
    }
  });
}

function emitPass() {
  socket.emit('pass', {}, (res) => {
    if (!res.success) UI.showToast(res.reason || '过牌失败');
  });
}

function emitLeaveRoom() { socket.emit('leave_room'); }

function emitAddBot() {
  return new Promise(resolve => socket.emit('add_bot', {}, res => resolve(res)));
}

function emitRemoveBot() {
  return new Promise(resolve => socket.emit('remove_bot', {}, res => resolve(res)));
}

function emitRestartGame() { socket.emit('restart_game'); }

function emitGetGameState() {
  return new Promise(resolve => socket.emit('get_game_state', {}, res => resolve(res)));
}