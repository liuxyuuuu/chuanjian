// ===== 应用入口 =====
let myNickname = "";
let myPlayerIndex = -1;

// 自动检测本地存储的昵称
const savedNick = localStorage.getItem("chuanjian_nickname");
if (savedNick) {
  document.getElementById("nickname-input").value = savedNick;
}

function getNickname() {
  const nick = document.getElementById("nickname-input").value.trim();
  return nick || "游客" + Math.floor(Math.random() * 10000);
}

function saveNickname(nick) {
  localStorage.setItem("chuanjian_nickname", nick);
}

// ===== 全局 UI 事件 =====

async function createRoom() {
  const nick = getNickname();
  saveNickname(nick);
  myNickname = nick;

  if (!socket || !socket.connected) {
    UI.showToast("正在连接服务器...");
    return;
  }

  const res = await emitCreateRoom(nick);
  if (res.success) {
    document.getElementById("room-code-text").textContent = res.roomCode;
    UI.showPage("room-page");
  } else {
    UI.showToast(res.reason || "创建房间失败");
  }
}

async function joinRoom() {
  const code = document.getElementById("room-code-input").value.trim().toUpperCase();
  if (!code) {
    UI.showToast("请输入房间号");
    return;
  }
  if (code.length !== 6) {
    UI.showToast("房间号为6位");
    return;
  }

  const nick = getNickname();
  saveNickname(nick);
  myNickname = nick;

  if (!socket || !socket.connected) {
    UI.showToast("正在连接服务器...");
    return;
  }

  const res = await emitJoinRoom(code, nick);
  if (res.success) {
    document.getElementById("room-code-text").textContent = code;
    UI.showPage("room-page");
  } else {
    UI.showToast(res.reason || "加入房间失败");
  }
}

function toggleReady() {
  emitToggleReady();
}

async function addBot() {
  const res = await emitAddBot();
  if (!res.success) UI.showToast(res.reason || "添加电脑失败");
}

async function removeBot() {
  const res = await emitRemoveBot();
  if (!res.success) UI.showToast(res.reason || "移除电脑失败");
}

async function startGame() {
  const res = await emitStartGame();
  if (!res.success) {
    UI.showToast(res.reason || "开始游戏失败");
  }
}

function playSelected() {
  if (!GameUI.isMyTurn) {
    UI.showToast("不是你的回合");
    return;
  }
  if (GameUI.selectedCards.size === 0) {
    UI.showToast("请选择要出的牌");
    return;
  }
  const selectedIds = Array.from(GameUI.selectedCards);
  // 乐观更新：立即从手牌移除
  const removedCards = GameUI.myHand.filter(c => selectedIds.includes(c.id));
  GameUI.myHand = GameUI.myHand.filter(c => !selectedIds.includes(c.id));
  GameUI.renderHand();
  // 发送到服务器，携带 removedCards 用于失败恢复
  emitPlayCards(selectedIds, removedCards);
}

function passTurn() {
  if (!GameUI.isMyTurn) {
    UI.showToast("不是你的回合");
    return;
  }
  emitPass();
}

function showHint() {
  if (GameUI.myHand.length === 0) {
    UI.showToast("没有手牌");
    return;
  }
  
  const order = { "3": 15, "2": 14, "A": 13, "K": 12, "Q": 11, "J": 10, "10": 9, "9": 8, "8": 7, "7": 6, "6": 5, "5": 4, "4": 3 };
  
  // 新回合，出最小的牌
  if (!GameUI.gameState?.lastPlay) {
    const sorted = [...GameUI.myHand].sort((a, b) => (order[a.rank] || 0) - (order[b.rank] || 0));
    GameUI.selectedCards.clear();
    GameUI.selectedCards.add(sorted[0].id);
    GameUI.renderHandSelection();
    UI.showToast("已选择最小的牌");
    return;
  }
  
  const lastPlay = GameUI.gameState.lastPlay;
  const lastType = lastPlay.handAnalysis?.type;
  const lastValue = lastPlay.handAnalysis?.mainValue;
  
  if (lastType === "single") {
    const sorted = [...GameUI.myHand].sort((a, b) => (order[a.rank] || 0) - (order[b.rank] || 0));
    const found = sorted.find(c => (order[c.rank] || 0) > lastValue);
    if (found) {
      GameUI.selectedCards.clear();
      GameUI.selectedCards.add(found.id);
      GameUI.renderHandSelection();
    } else {
      UI.showToast("没有能管上的牌");
    }
  } else if (lastType === "pair") {
    const rankCounts = {};
    GameUI.myHand.forEach(c => { rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1; });

// 横屏检测
checkOrientation();
window.addEventListener("resize", checkOrientation);
window.addEventListener("orientationchange", function() {
  setTimeout(checkOrientation, 300);
});
    const bigPairs = Object.entries(rankCounts)
      .filter(([r, c]) => c >= 2 && (order[r] || 0) > lastValue)
      .sort((a, b) => (order[a[0]] || 0) - (order[b[0]] || 0));
    if (bigPairs.length > 0) {
      const pairRank = bigPairs[0][0];
      GameUI.selectedCards.clear();
      GameUI.myHand.filter(c => c.rank === pairRank).slice(0, 2).forEach(c => GameUI.selectedCards.add(c.id));
      GameUI.renderHandSelection();
    } else {
      UI.showToast("没有能管上的对子");
    }
  } else {
    UI.showToast("复杂牌型暂不支持智能提示");
  }
}

function leaveRoom() {
  emitLeaveRoom();
  GameUI.reset();
  myPlayerIndex = -1;
  UI.showPage("lobby-page");
}

function backToRoom() {
  GameUI.hideResult();
  GameUI.reset();
  myPlayerIndex = -1;
  UI.showPage("room-page");
  emitGetGameState().then(res => {
    if (res.success && res.roomInfo) {
      renderPlayerList(res.roomInfo.players);
      updateRoomButtons(res.roomInfo.players);
    }
  });
}

function confirmLeave() {
  UI.showConfirm("退出游戏", "确定要退出当前游戏吗？", () => {
    emitLeaveRoom();
    GameUI.reset();
    myPlayerIndex = -1;
    UI.showPage("lobby-page");
  });
}

function closeConfirm() {
  UI.hideOverlay("confirm-overlay");
}

function copyRoomCode() {
  const code = document.getElementById("room-code-text").textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code).then(() => {
      UI.showToast("已复制房间号：" + code);
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      UI.showToast("已复制房间号：" + code);
    });
  } else {
    UI.showToast("房间号：" + code);
  }
}

// ===== 房间渲染 =====

function renderPlayerList(players) {
  const container = document.getElementById("player-list");
  container.innerHTML = "";

  for (let i = 0; i < 4; i++) {
    const player = players.find(p => p.index === i);
    
    const item = document.createElement("div");
    item.className = "player-item";
    
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    
    const nameSpan = document.createElement("span");
    nameSpan.className = "name";
    
    const badgeSpan = document.createElement("span");
    badgeSpan.className = "badge";
    
    if (player) {
      avatar.textContent = player.isBot ? "\uD83E\uDD16" : player.nickname[0];
      nameSpan.textContent = player.nickname;
      
      if (player.isHost) {
        badgeSpan.classList.add("host");
        badgeSpan.textContent = "房主";
      } else if (player.ready) {
        badgeSpan.classList.add("ready");
        badgeSpan.textContent = "已准备";
      } else {
        badgeSpan.classList.add("waiting");
        badgeSpan.textContent = "未准备";
      }
    } else {
      item.classList.add("empty-slot");
      avatar.textContent = "?";
      avatar.style.opacity = "0.3";
      nameSpan.textContent = "等待加入...";
      badgeSpan.classList.add("empty");
      badgeSpan.textContent = `(${i + 1}缺)`;
    }
    
    item.appendChild(avatar);
    item.appendChild(nameSpan);
    item.appendChild(badgeSpan);
    container.appendChild(item);
  }
}

function updateRoomButtons(players, allReady) {
  const readyBtn = document.getElementById("ready-btn");
  const startBtn = document.getElementById("start-game-btn");
  
  const myPlayer = myPlayerIndex >= 0
    ? players.find(p => p.index === myPlayerIndex)
    : players.find(p => p.nickname === myNickname);
  
  if (!myPlayer) {
    readyBtn.classList.add("hidden");
    startBtn.classList.add("hidden");
    return;
  }

  readyBtn.classList.remove("hidden");
  if (myPlayer.isBot) {
    readyBtn.classList.add("hidden");
  } else if (myPlayer.ready) {
    readyBtn.textContent = "取消准备";
    readyBtn.className = "btn outline";
  } else {
    readyBtn.textContent = "准备";
    readyBtn.className = "btn primary";
  }

  if (myPlayer.isHost) {
    startBtn.classList.remove("hidden");
    const allPlayersReady = players.length === 4 && players.every(p => p.ready);
    if (allPlayersReady) {
      startBtn.textContent = "开始游戏";
      startBtn.disabled = false;
      startBtn.className = "btn primary";
    } else if (players.length < 4) {
      startBtn.textContent = "等待加入 (" + players.length + "/4)";
      startBtn.disabled = true;
      startBtn.className = "btn secondary";
    } else {
      startBtn.textContent = "等待准备";
      startBtn.disabled = true;
      startBtn.className = "btn secondary";
    }
    // Bot controls
    showBotControls(players);
  } else {
    startBtn.classList.add("hidden");
    showBotControls(players);
  }
}

// ===== 加载完成 =====

// 显示/隐藏机器人控制按钮
function showBotControls(players) {
  const container = document.getElementById("bot-controls");
  if (!container) return;
  const myPlayer = myPlayerIndex >= 0 ? players.find(p => p.index === myPlayerIndex) : players.find(p => p.nickname === myNickname);
  if (!myPlayer || !myPlayer.isHost) { container.classList.add("hidden"); return; }
  const hasEmptySlot = players.length < 4;
  const hasBot = players.some(p => p.isBot);
  const addBtn = document.getElementById("add-bot-btn");
  const removeBtn = document.getElementById("remove-bot-btn");
  if (addBtn) addBtn.style.display = hasEmptySlot ? "" : "none";
  if (removeBtn) removeBtn.style.display = hasBot ? "" : "none";
  container.classList.remove("hidden");
}

// 规则弹窗
function toggleRules() {
  const overlay = document.getElementById("rules-overlay");
  overlay.classList.toggle("hidden");
}
function closeRules() {
  document.getElementById("rules-overlay").classList.add("hidden");
}

// 音效开关
function toggleSound() {
  const enabled = Sound.toggle();
  const btn = document.getElementById("sound-toggle");
  if (btn) btn.textContent = enabled ? "🔊" : "🔇";
  UI.showToast(enabled ? "音效已开启" : "音效已关闭");
}

// 横屏检测
function checkOrientation() {
  const overlay = document.getElementById("landscape-overlay");
  if (!overlay) return;
  const isPhone = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isPhone) { overlay.classList.remove("active"); return; }
  if (window.innerWidth > window.innerHeight) {
    overlay.classList.remove("active");
  } else {
    overlay.classList.add("active");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initSocket();
  UI.showPage("lobby-page");
  
  document.getElementById("room-code-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinRoom();
  });
  document.getElementById("nickname-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") createRoom();
  });
});
