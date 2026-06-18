// Socket.IO 客户端连接
let socket = null;

function initSocket() {
  socket = io();

  socket.on("connect", () => {
    console.log("已连接:", socket.id);
  });

  socket.on("disconnect", () => {
    console.log("已断开连接");
    if (document.getElementById("game-page").classList.contains("active")) {
      UI.showToast("连接已断开");
    }
  });

  // 房间更新
  socket.on("room_update", (data) => {
    if (data.myIndex !== undefined) {
      myPlayerIndex = data.myIndex;
    }
    renderPlayerList(data.players);
    updateRoomButtons(data.players, data.allReady);
  });

  // 游戏开始
  socket.on("game_start", (data) => {
    UI.showPage("game-page");
    UI.showToast("游戏开始！");
  });

  // 轮到叫牌
  socket.on("your_turn_call", (data) => {
    GameUI.showCallOverlay(data.myHand);
  });

  // 叫牌结果
  socket.on("card_called", (data) => {
    GameUI.calledCardId = data.calledCard;
    GameUI.hideCallOverlay();
    UI.showToast("庄家叫了 " + data.calledCard);
  });

  // 队友信息（只发给庄家）
  socket.on("teammate_info", (data) => {
    UI.showToast("你的队友是：" + data.teammateNickname);
  });

  // 游戏状态更新
  socket.on("game_state", (data) => {
    GameUI.isMyTurn = (data.currentTurn === data.myIndex) && data.phase === "playing";
    GameUI.renderTable(data);
  });

  // 轮到出牌
  socket.on("your_turn", (data) => {
    GameUI.isMyTurn = true;
    GameUI.updateActionButtons();
    UI.showToast("轮到你出牌");
  });

  // 出牌广播
  socket.on("cards_played", (data) => {
    GameUI.clearSelection();
  });

  // 过牌广播
  socket.on("player_passed", (data) => {
    const player = GameUI.players[data.playerIndex];
    const name = player ? player.nickname : "玩家";
    if (data.roundReset) {
      UI.showToast(name + " 过牌，新回合开始");
    } else {
      UI.showToast(name + " 过牌");
    }
  });

  // 队友揭晓
  socket.on("teammate_revealed", (data) => {
    GameUI.showTeammateReveal(data);
  });

  // 游戏结束
  socket.on("game_over", (data) => {
    GameUI.showResult(data.result);
  });

  // 玩家断开
  socket.on("player_disconnected", (data) => {
    UI.showToast("有玩家断开了连接");
  });
}

// ===== 服务端通信封装 =====
function emitCreateRoom(nickname) {
  return new Promise((resolve) => {
    socket.emit("create_room", { nickname }, (res) => resolve(res));
  });
}

function emitJoinRoom(roomCode, nickname) {
  return new Promise((resolve) => {
    socket.emit("join_room", { roomCode, nickname }, (res) => resolve(res));
  });
}

function emitToggleReady() {
  socket.emit("toggle_ready");
}

function emitStartGame() {
  return new Promise((resolve) => {
    socket.emit("start_game", {}, (res) => resolve(res));
  });
}

function emitCallCard(cardId) {
  socket.emit("call_card", { cardId }, (res) => {
    if (!res.success) {
      UI.showToast(res.reason || "叫牌失败");
    }
  });
}

function emitPlayCards(cardIds) {
  socket.emit("play_cards", { cardIds }, (res) => {
    if (!res.success) {
      UI.showToast(res.reason || "出牌失败");
      GameUI.clearSelection();
    }
  });
}

function emitPass() {
  socket.emit("pass", {}, (res) => {
    if (!res.success) {
      UI.showToast(res.reason || "过牌失败");
    }
  });
}

function emitLeaveRoom() {
  socket.emit("leave_room");
}

function emitGetGameState() {
  return new Promise((resolve) => {
    socket.emit("get_game_state", {}, (res) => resolve(res));
  });
}
