const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { botCallCard, botPlayCards } = require('./game/botAi');
const { aiCallCard, aiPlayCards } = require('./game/aiBot');
const { createTeamTracker, updateAllTrackers } = require('./game/teamDeduction');
const RoomManager = require('./room/roomManager');
const { PHASE, GameManager } = require('./game/gameManager');

// ===== Match System =====
var onlineCount = 0;
var matchQueue = [];
var matchTimer = null;
var BOT_NAMES = ['\u5c0f\u660e','\u5c0f\u7ea2','\u5927\u58ee','\u963f\u82b1','\u8001\u738b','\u5c0f\u674e','\u963f\u6770','\u5c0f\u96ea','\u5927\u9e4f','\u5c0f\u7f8e','\u963f\u5f3a','\u83b1\u83b1','\u963f\u8c6a','\u5c0f\u6167','\u963f\u9f99','\u5c0f\u654f','\u963f\u4f1f','\u5c0f\u82b3','\u963f\u56fd','\u71d5\u5b50'];
var BOT_AVATARS = ['\ud83d\ude0a','\ud83d\ude0e','\ud83e\udd20','\ud83d\udc31','\ud83d\udc36','\ud83d\udc09','\ud83e\udd85','\ud83c\udf1f','\ud83c\udfae','\ud83c\udfaf','\ud83c\udfb2','\ud83c\udfaa'];

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const roomManager = new RoomManager();

// 静态文件服务（客户端）
app.use(express.static(path.join(__dirname, '../../client')));

// 辅助函数：广播 room_update 给房间里每个玩家，附带各自的 myIndex
function broadcastRoomUpdate(roomCode) {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;
  const sanitized = room.players.map(p => ({
    index: p.index, nickname: p.nickname, avatar: p.avatar || "", ready: p.ready, isHost: p.isHost, isBot: p.isBot || false
  }));
  room.players.forEach(p => {
    io.to(p.socketId).emit('room_update', {
      players: sanitized,
      myIndex: p.index,
    });
  });
}

// Socket.IO 事件处理
io.on('connection', (socket) => {
  console.log(`[连接] ${socket.id} 已连接`);

  let currentNickname = '';

  // 创建房间
  socket.on('create_room', (data, callback) => {
    const nickname = (data && data.nickname) || `玩家${socket.id.slice(0, 4)}`;
    currentNickname = nickname;
    const avatar = (data && data.avatar) || "";
    
    const result = roomManager.createRoom(socket.id, nickname, avatar);
    socket.join(result.roomCode);
    
    console.log(`[房间] ${nickname} 创建了房间 ${result.roomCode}`);
    
    if (callback) callback({ success: true, ...result });
  });

  // 开发者模式
  socket.on('dev_mode', (data, callback) => {
    const nickname = (data && data.nickname) || "开发者";
    currentNickname = nickname;
    const avatar = (data && data.avatar) || "";
    const result = roomManager.createRoom(socket.id, nickname, avatar);
    if (!result || !result.roomCode) {
      if (callback) callback({ success: false, reason: "创建房间失败" });
      return;
    }
    socket.join(result.roomCode);
    const roomCode = result.roomCode;
    // 添加3个机器人
    roomManager.addBot(roomCode);
    roomManager.addBot(roomCode);
    roomManager.addBot(roomCode);
    // 启动开发者模式游戏
    const room = roomManager.getRoom(roomCode);
    if (!room) { if (callback) callback({ success: false, reason: "房间不存在" }); return; }
    const game = new (require("./game/gameManager").GameManager)(roomCode);
    const startResult = game.start(room.players.map(p => ({
      socketId: p.socketId,
      nickname: p.nickname,
      avatar: p.avatar || "",
      isBot: p.isBot || false,
    })));
    room.game = game;
    room.isPlaying = true;
    // 广播游戏开始
    broadcastRoomUpdate(roomCode);
    io.to(roomCode).emit("game_start", {
      phase: "call",
      declarerIndex: startResult.declarerIndex,
      declarerNickname: startResult.declarerNickname,
      playerCount: 4,
    });
    room.players.forEach((p, i) => {
      io.to(p.socketId).emit("game_state", Object.assign(room.game.getGameState(i), { cumulativeScores: room.scores || [0,0,0,0] }));
    });
    // 叫牌：庄家是红桃4持有者（可能是机器人）
    const declarer = room.players[startResult.declarerIndex];
    if (declarer && !declarer.isBot) {
      io.to(declarer.socketId).emit("your_turn_call", {
        myHand: game.getPlayerHand(startResult.declarerIndex),
        canCallAny: true,
      });
    }
    scheduleBotTurn(roomCode);
    if (callback) callback({ success: true, roomCode });
  });

  // 快速人机对战
  socket.on('quick_start_ai', (data, callback) => {
    const nickname = (data && data.nickname) || '玩家';
    const avatar = (data && data.avatar) || '';
    currentNickname = nickname;
    const aiDifficulty = (data && data.difficulty) || 'easy';
    const createRes = roomManager.createRoom(socket.id, nickname, avatar);
    if (!createRes || !createRes.roomCode) {
      if (callback) callback({ success: false });
      return;
    }
    const roomCode = createRes.roomCode;
    socket.join(roomCode);
    roomManager.addBot(roomCode);
    roomManager.addBot(roomCode);
    roomManager.addBot(roomCode);
    const room = roomManager.getRoom(roomCode);
    if (!room) { if (callback) callback({ success: false }); return; }
    room.botDifficulty = aiDifficulty;
    const game = new (require("./game/gameManager").GameManager)(roomCode);
    const startResult = game.start(room.players.map(p => ({
      socketId: p.socketId, nickname: p.nickname, avatar: p.avatar || '', isBot: p.isBot || false,
    })));
    room.game = game;
    room.isPlaying = true;
    broadcastRoomUpdate(roomCode);
    io.to(roomCode).emit('game_start', { phase: 'call', declarerIndex: startResult.declarerIndex, declarerNickname: startResult.declarerNickname, playerCount: 4, isQuickAI: true });
    // Delay game_state to let dealing animation play
    setTimeout(async () => {
      try {
        const cr2 = roomManager.getRoom(roomCode);
        if (!cr2 || !cr2.game) {
          console.log('[ERR] quick_start_ai: room/game null, retrying in 1s');
          setTimeout(async () => {
            const cr2b = roomManager.getRoom(roomCode);
            if (!cr2b || !cr2b.game) { console.log('[ERR] quick_start_ai: retry failed'); return; }
            cr2b.players.forEach((p, i) => {
              io.to(p.socketId).emit('game_state', Object.assign(cr2b.game.getGameState(i), { cumulativeScores: cr2b.scores || [0,0,0,0] }));
            });
            // Also send your_turn_call for human declarer
            const declarer2 = cr2b.players[startResult.declarerIndex];
            if (declarer2 && !declarer2.isBot) {
              io.to(declarer2.socketId).emit('your_turn_call', {
                myHand: cr2b.game.getPlayerHand(startResult.declarerIndex),
                canCallAny: true,
              });
            }
          }, 1000);
          return;
        }
        cr2.players.forEach((p, i) => {
          io.to(p.socketId).emit('game_state', Object.assign(cr2.game.getGameState(i), { cumulativeScores: cr2.scores || [0,0,0,0] }));
        });
      // Bot declarer auto-calls after hands are dealt
      const declarer = cr2.players[startResult.declarerIndex];
      if (declarer && declarer.isBot) {
        setTimeout(async () => {
          const cr3 = roomManager.getRoom(roomCode);
          if (!cr3 || !cr3.game || cr3.game.phase !== 'call') return;
          const hand = cr3.game.getPlayerHand(startResult.declarerIndex);
          const diff = cr3.botDifficulty || 'easy';
          let cardId;
          if (diff === 'ai') {
            cardId = await aiCallCard(hand, (cr3.teamTrackers || {})[cr3.game.declarerIndex]);
          } else {
            cardId = botCallCard(hand, diff);
          }
          const callRes = cr3.game.callCard(startResult.declarerIndex, cardId);
          if (callRes.success) {
            io.to(roomCode).emit('card_called', { calledCard: callRes.calledCard, declarerIndex: cr3.game.declarerIndex });
            cr3.players.forEach(p => { if (!p.isBot) io.to(p.socketId).emit('game_state', Object.assign(cr3.game.getGameState(p.index), { cumulativeScores: cr3.scores || [0,0,0,0] })); });
            const np = cr3.players[callRes.currentTurn];
            if (np && !np.isBot) io.to(np.socketId).emit('your_turn', { lastPlay: null, isNewRound: true });
            scheduleBotTurn(roomCode);
          }
        }, 1500);
      } else {
        io.to(declarer.socketId).emit('your_turn_call', {
          myHand: cr2.game.getPlayerHand(startResult.declarerIndex),
          canCallAny: true,
        });
        scheduleBotTurn(roomCode);
      }
      } catch (e) {
        console.log('[ERR] quick_start_ai error:', e.message);
      }
    }, 1500);
    if (callback) callback({ success: true, roomCode });
  });


  // 添加机器人
  socket.on('add_bot', (data, callback) => {
    const roomCode = roomManager.getRoomCode(socket.id);
    if (!roomCode) { if (callback) callback({ success: false }); return; }
    const result = roomManager.addBot(roomCode);
    if (result.success) {
      broadcastRoomUpdate(roomCode);
    }
    if (callback) callback(result);
  });

  // 移除机器人
  socket.on('remove_bot', (data, callback) => {
    const roomCode = roomManager.getRoomCode(socket.id);
    if (!roomCode) { if (callback) callback({ success: false }); return; }
    const result = roomManager.removeBot(roomCode);
    if (result.success) {
      broadcastRoomUpdate(roomCode);
    }
    if (callback) callback(result);
  });

  // 加入房间
  socket.on('join_room', (data, callback) => {
    const { roomCode, nickname } = data || {};
    if (!roomCode) {
      if (callback) callback({ success: false, reason: '请输入房间号' });
      return;
    }
    
    const nick = nickname || `玩家${socket.id.slice(0, 4)}`;
    currentNickname = nick;
    const avatar = (data && data.avatar) || "";
    
    const result = roomManager.joinRoom(roomCode.toUpperCase(), socket.id, nick, avatar);
    if (result.success) {
      socket.join(roomCode.toUpperCase());
      broadcastRoomUpdate(result.roomCode);
      console.log(`[房间] ${nick} 加入了房间 ${roomCode}`);
    } else {
      console.log(`[房间] ${nick} 加入房间 ${roomCode} 失败: ${result.reason}`);
    }
    
    if (callback) callback(result);
  });

  // 准备/取消准备
  socket.on('toggle_ready', (data, callback) => {
    const result = roomManager.toggleReady(socket.id);
    if (result) {
      broadcastRoomUpdate(result.roomCode);
    }
    if (callback) callback(result || { success: false });
  });

  // 开始游戏
  socket.on('start_game', (data, callback) => {
    const result = roomManager.startGame(socket.id);
    
    if (result.success) {
      const roomCode = roomManager.getRoomCode(socket.id);
      const room = roomManager.getRoom(roomCode);
      const game = room.game;
      
      io.to(roomCode).emit('game_start', {
        phase: 'call',
        declarerIndex: result.gameInfo.declarerIndex,
        declarerNickname: result.gameInfo.declarerNickname,
        playerCount: 4,
      });
      
      const declarerSocketId = room.players[result.gameInfo.declarerIndex].socketId;
      io.to(declarerSocketId).emit('your_turn_call', {
        myHand: game.getPlayerHand(result.gameInfo.declarerIndex),
        canCallAny: true,
      });
      
      room.players.forEach((p, i) => {
        io.to(p.socketId).emit('game_state', Object.assign(room.game.getGameState(i), { cumulativeScores: room.scores || [0,0,0,0] }));
      });

      // 如果是电脑庄家，自动叫牌
      const declarer = room.players[result.gameInfo.declarerIndex];
      if (declarer && declarer.isBot) {
        setTimeout(async () => {
          const cr = roomManager.getRoom(roomCode);
          if (!cr || !cr.game || cr.game.phase !== 'call') return;
          const hand = game.getPlayerHand(result.gameInfo.declarerIndex);
          const diff = (roomManager.getRoom(roomCode) || {}).botDifficulty || 'easy';
          let cardId;
          if (diff === 'ai') {
            cardId = await aiCallCard(hand, (cr.teamTrackers || {})[cr.game.declarerIndex]);
          } else {
            cardId = botCallCard(hand, diff);
          }
          const callRes = game.callCard(result.gameInfo.declarerIndex, cardId);
          if (callRes.success) {
            io.to(roomCode).emit('card_called', {
              calledCard: callRes.calledCard,
              declarerIndex: game.declarerIndex
            });
            cr.players.forEach(p => {
              if (!p.isBot) io.to(p.socketId).emit('game_state', game.getGameState(p.index));
            });
            const np = cr.players[callRes.currentTurn];
            if (np && !np.isBot) io.to(np.socketId).emit('your_turn', { lastPlay: null, isNewRound: true });
            scheduleBotTurn(roomCode);
          }
        }, 1500);
      } else {
        scheduleBotTurn(roomCode);
      }
    }
    
    if (callback) callback(result);
  });

  // 叫牌
  socket.on('call_card', (data, callback) => {
    const roomCode = roomManager.getRoomCode(socket.id);
    if (!roomCode) { if (callback) callback({ success: false, reason: '不在房间中' }); return; }
    
    const room = roomManager.getRoom(roomCode);
    if (!room || !room.game) { if (callback) callback({ success: false, reason: '游戏不存在' }); return; }
    
    const player = roomManager.getPlayerFromRoom(roomCode, socket.id);
    if (!player) { if (callback) callback({ success: false, reason: '玩家不存在' }); return; }
    
    const result = room.game.callCard(player.index, data.cardId);
    
    if (result.success) {
      io.to(roomCode).emit('card_called', {
        calledCard: result.calledCard,
        declarerIndex: room.game.declarerIndex,
      });

      // 不发送 teammate_info，队友在出叫牌时才暴露

      room.players.forEach((p, i) => {
        io.to(p.socketId).emit('game_state', Object.assign(room.game.getGameState(i), { cumulativeScores: room.scores || [0,0,0,0] }));
      });

      const currentPlayer = room.players[result.currentTurn];
      io.to(currentPlayer.socketId).emit('your_turn', {
        lastPlay: null,
        isNewRound: true,
      });

      scheduleBotTurn(roomCode);

      // 将 gameState 注入 ACK 回调（绕过 broadcast 丢失问题）
      const gs = room.game.getGameState(player.index);
      result.myGameState = gs;
    }

    if (callback) callback(result);
  });

  // 出牌
  socket.on('play_cards', (data, callback) => {
    const roomCode = roomManager.getRoomCode(socket.id);
    if (!roomCode) { if (callback) callback({ success: false, reason: '不在房间中' }); return; }
    
    const room = roomManager.getRoom(roomCode);
    if (!room || !room.game) { if (callback) callback({ success: false, reason: '游戏不存在' }); return; }
    
    const player = roomManager.getPlayerFromRoom(roomCode, socket.id);
    if (!player) { if (callback) callback({ success: false, reason: '玩家不存在' }); return; }
    
    const { cardIds } = data;
    const prevLastPlay = room.game.lastPlay;
    const result = room.game.playCards(player.index, cardIds);
    
    if (result.success) {
      recordTrackerAction(room, player.index, 'play', prevLastPlay, cardIds);
      io.to(roomCode).emit('cards_played', {
        playerIndex: result.playerIndex,
        cards: result.cards,
        handAnalysis: result.handAnalysis,
        justFinished: result.justFinished,
        finishPosition: result.finishPosition,
      });
      
      if (result.teammateJustRevealed) {
        io.to(roomCode).emit('teammate_revealed', {
          teammateIndex: result.teammateIndex,
          teammateNickname: result.teammateNickname,
          calledCardId: room.game.calledCardId,
        });
      }

      if (result.gameOver) {
        finishGame(room, roomCode, result);
        return;
      }

      scheduleBotTurn(roomCode);
      
      room.players.forEach((p, i) => {
        io.to(p.socketId).emit('game_state', Object.assign(room.game.getGameState(i), { cumulativeScores: room.scores || [0,0,0,0] }));
      });
      
      const currentPlayer = room.players[result.currentTurn];
      io.to(currentPlayer.socketId).emit('your_turn', {
        lastPlay: room.game.lastPlay,
        isNewRound: false,
      });
    }
    
    if (callback) callback(result);
  });

  // 过牌
  socket.on('pass', (data, callback) => {
    const roomCode = roomManager.getRoomCode(socket.id);
    if (!roomCode) { if (callback) callback({ success: false, reason: '不在房间中' }); return; }
    
    const room = roomManager.getRoom(roomCode);
    if (!room || !room.game) { if (callback) callback({ success: false, reason: '游戏不存在' }); return; }
    
    const player = roomManager.getPlayerFromRoom(roomCode, socket.id);
    if (!player) { if (callback) callback({ success: false, reason: '玩家不存在' }); return; }
    
    const prevLastPlay = room.game.lastPlay;
    const result = room.game.pass(player.index);
    
    if (result.success) {
      recordTrackerAction(room, player.index, 'pass', prevLastPlay, null);
      io.to(roomCode).emit('player_passed', {
        playerIndex: result.playerIndex,
        roundReset: result.roundReset,
      });
      
      if (result.roundReset) {
        room.players.forEach((p, i) => {
          io.to(p.socketId).emit('game_state', Object.assign(room.game.getGameState(i), { cumulativeScores: room.scores || [0,0,0,0] }));
        });
        const currentPlayer = room.players[result.currentTurn];
        io.to(currentPlayer.socketId).emit('your_turn', {
          lastPlay: null,
          isNewRound: true,
        });
      } else {
        room.players.forEach((p, i) => {
          io.to(p.socketId).emit('game_state', Object.assign(room.game.getGameState(i), { cumulativeScores: room.scores || [0,0,0,0] }));
        });
        const currentPlayer = room.players[result.currentTurn];
        io.to(currentPlayer.socketId).emit('your_turn', {
          lastPlay: room.game.lastPlay,
          isNewRound: false,
        });
      }
      scheduleBotTurn(roomCode);
    }
    
    if (callback) callback(result);
  });

  // 断线重连
  // 重新开始游戏
  socket.on('restart_game', (data, callback) => {
    const roomCode = roomManager.getRoomCode(socket.id);
    if (!roomCode) { if (callback) callback({ success: false }); return; }
    const room = roomManager.getRoom(roomCode);
    if (!room) { if (callback) callback({ success: false }); return; }
    const result = roomManager.restartGame(socket.id);
    if (result.success) {
      io.to(roomCode).emit('game_start', { phase: 'call', declarerIndex: result.gameInfo.declarerIndex, declarerNickname: result.gameInfo.declarerNickname, playerCount: 4 });
      const declarerSocketId = room.players[result.gameInfo.declarerIndex].socketId;
      io.to(declarerSocketId).emit('your_turn_call', { myHand: room.game.getPlayerHand(result.gameInfo.declarerIndex), canCallAny: true });
      room.players.forEach((p, i) => { io.to(p.socketId).emit('game_state', Object.assign(room.game.getGameState(i), { cumulativeScores: room.scores || [0,0,0,0] })); });
      const declarer = room.players[result.gameInfo.declarerIndex];
      if (declarer && declarer.isBot) {
        setTimeout(async () => {
          const cr = roomManager.getRoom(result.roomCode);
          if (!cr || !cr.game || cr.game.phase !== 'call') return;
          const hand = cr.game.getPlayerHand(result.gameInfo.declarerIndex);
          const diff = cr.botDifficulty || 'easy';
          let cardId;
          if (diff === 'ai') {
            cardId = await aiCallCard(hand);
          } else {
            cardId = botCallCard(hand, diff);
          }
          const callRes = cr.game.callCard(result.gameInfo.declarerIndex, cardId);
          if (callRes.success) {
            io.to(result.roomCode).emit('card_called', { calledCard: callRes.calledCard, declarerIndex: cr.game.declarerIndex });
            cr.players.forEach(p => { if (!p.isBot) io.to(p.socketId).emit('game_state', Object.assign(cr.game.getGameState(p.index), { cumulativeScores: cr.scores || [0,0,0,0] })); });
            const np = cr.players[callRes.currentTurn];
            if (np && !np.isBot) io.to(np.socketId).emit('your_turn', { lastPlay: null, isNewRound: true });
            scheduleBotTurn(result.roomCode);
          }
        }, 1500);
      } else { scheduleBotTurn(result.roomCode); }
    }
    if (callback) callback(result);
  });

  socket.on('get_game_state', (data, callback) => {
    const roomCode = roomManager.getRoomCode(socket.id);
    if (!roomCode) { if (callback) callback({ success: false, reason: '不在房间中' }); return; }
    
    const room = roomManager.getRoom(roomCode);
    if (!room) { if (callback) callback({ success: false, reason: '房间不存在' }); return; }
    
    const player = roomManager.getPlayerFromRoom(roomCode, socket.id);
    if (!player) { if (callback) callback({ success: false, reason: '玩家不存在' }); return; }
    
    if (room.game) {
      if (callback) callback({ success: true, gameState: room.game.getGameState(player.index) });
    } else {
      if (callback) callback({ success: true, gameState: null, roomInfo: { players: room.players.map(p => ({ index: p.index, nickname: p.nickname, ready: p.ready, isHost: p.isHost, isBot: p.isBot || false })) } });
    }
  });

  // 离开房间
  socket.on('leave_room', (data, callback) => {
    const result = roomManager.leaveRoom(socket.id);
    if (result) {
      if (result.action === 'room_deleted') {
        // 房间删了
      } else {
        socket.leave(result.roomCode);
        broadcastRoomUpdate(result.roomCode);
        if (result.action === 'player_disconnected_ingame') {
          io.to(result.roomCode).emit('player_disconnected', { socketId: socket.id });
          scheduleBotTurn(result.roomCode); // 让服务器接管该断线座位继续推进
        }
      }
    }
    if (callback) callback({ success: true });
  });

  // 设置机器人难度
  socket.on('set_bot_difficulty', (data, callback) => {
    const roomCode = roomManager.getRoomCode(socket.id);
    if (!roomCode) { if (callback) callback({ success: false }); return; }
    const room = roomManager.getRoom(roomCode);
    if (!room) { if (callback) callback({ success: false }); return; }
    const difficulty = data.difficulty || 'easy';
    room.botDifficulty = difficulty;
    console.log('[AI Bot] difficulty:', difficulty);
    if (callback) callback({ success: true, difficulty });
  });

  // 在线匹配：加入匹配队列
  socket.on('quick_match', (data, callback) => {
    const nickname = (data && data.nickname) || ('玩家' + socket.id.slice(0, 4));
    const avatar = (data && data.avatar) || '';
    currentNickname = nickname;
    removeFromMatchQueue(socket.id);
    matchQueue.push({ socketId: socket.id, socket, nickname, avatar });
    notifyMatchQueue();
    if (callback) callback({ success: true, queueSize: matchQueue.length });
    if (matchQueue.length >= 4) {
      tryFormMatch(false);
    } else {
      if (matchTimer) clearTimeout(matchTimer);
      matchTimer = setTimeout(() => tryFormMatch(true), 12000);
    }
  });

  // 取消匹配
  socket.on('cancel_match', () => {
    removeFromMatchQueue(socket.id);
    notifyMatchQueue();
    if (matchQueue.length === 0 && matchTimer) { clearTimeout(matchTimer); matchTimer = null; }
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log(`[断开] ${socket.id} 已断开`);
    removeFromMatchQueue(socket.id);
    const result = roomManager.leaveRoom(socket.id);
    if (result) {
      if (result.action !== 'room_deleted') {
        broadcastRoomUpdate(result.roomCode);
        io.to(result.roomCode).emit('player_disconnected', {
          socketId: socket.id,
        });
        if (result.action === 'player_disconnected_ingame') {
          scheduleBotTurn(result.roomCode); // 让服务器接管该断线座位继续推进
        }
      }
    }
  });
});


// ===== 回合自动推进（机器人 / 断线托管 / 真人超时托管） =====
const HUMAN_TURN_MS = 30000; // 连线真人超时托管阈值（>客户端 20s 倒计时）
const AUTO_TURN_MS = 2000;   // 机器人/断线座位的行动延迟

function isAutoSeat(room, idx) {
  const p = room.players[idx];
  return !!(p && (p.isBot || p.disconnected));
}

function clearRoomTimer(room) {
  if (room && room._turnTimer) { clearTimeout(room._turnTimer); room._turnTimer = null; }
}

function ensureTrackers(room) {
  if (!room.game) return;
  if (!room.teamTrackers || Object.keys(room.teamTrackers).length < 4) {
    room.teamTrackers = {};
    const gs = room.game.getGameState(0);
    for (let i = 0; i < 4; i++) room.teamTrackers[i] = createTeamTracker(i, gs);
  }
}

// 把一次出牌/过牌喂给队友推断系统
function recordTrackerAction(room, actorIndex, kind, prevLastPlay, playedCardIds) {
  if (!room || !room.game || !room.teamTrackers) return;
  let action;
  if (kind === 'pass') {
    action = { actor: actorIndex, type: 'pass', target: prevLastPlay ? prevLastPlay.playerIndex : undefined };
  } else {
    const calledCardPlayed = !!(playedCardIds && room.game.calledCardId && playedCardIds.includes(room.game.calledCardId));
    action = {
      actor: actorIndex,
      type: calledCardPlayed ? 'play' : (prevLastPlay ? 'beat' : 'play'),
      target: prevLastPlay ? prevLastPlay.playerIndex : undefined,
      calledCardPlayed,
      calledCard: room.game.calledCardId,
    };
  }
  try { updateAllTrackers(room.teamTrackers, room.game.getGameState(0), action); } catch (e) {}
}

// 向所有"连线真人"广播各自的游戏状态
function broadcastState(room) {
  if (!room.game) return;
  room.players.forEach((p, i) => {
    if (p.isBot || p.disconnected) return;
    io.to(p.socketId).emit('game_state', Object.assign(room.game.getGameState(i), { cumulativeScores: room.scores || [0,0,0,0] }));
  });
}

// 统一的结算收尾：累计积分、清状态、广播
function finishGame(room, roomCode, result) {
  io.to(roomCode).emit('game_over', { result: result.result });
  if (result.result && result.result.perPlayerScores) {
    roomManager.updateScores(roomCode, result.result.perPlayerScores);
  }
  clearRoomTimer(room);
  room.isPlaying = false;
  room.game = null;
  room.teamTrackers = null;
  room.players.forEach(p => { p.ready = false; p.disconnected = false; p.connected = true; });
  broadcastRoomUpdate(roomCode);
}

// 调度：为"当前回合"座位安排一个（且仅一个）定时器。
// 机器人/断线座位 -> 短延时自动行动；连线真人 -> 仅作超时兜底。
function scheduleBotTurn(roomCode) {
  const room = roomManager.getRoom(roomCode);
  if (!room || !room.game) return;
  clearRoomTimer(room);
  const phase = room.game.phase;
  if (phase === PHASE.FINISHED || phase === PHASE.WAITING) return;

  const seatIdx = phase === PHASE.CALL ? room.game.declarerIndex : room.game.currentTurnIndex;
  if (seatIdx === undefined || seatIdx < 0) return;

  const delay = isAutoSeat(room, seatIdx) ? AUTO_TURN_MS : HUMAN_TURN_MS;
  const nonce = (room._turnNonce || 0) + 1;
  room._turnNonce = nonce;
  room._turnTimer = setTimeout(() => { performAutoTurn(roomCode, nonce); }, delay);
}

// 执行当前座位的自动行动（机器人决策；真人超时同样用机器人逻辑代打）
async function performAutoTurn(roomCode, nonce) {
  const room = roomManager.getRoom(roomCode);
  if (!room || !room.game) return;
  if (nonce !== undefined && room._turnNonce !== nonce) return; // 过期定时器，忽略
  room._turnTimer = null;
  const game = room.game;
  if (game.phase === PHASE.FINISHED) return;
  ensureTrackers(room);
  const diff = room.botDifficulty || 'easy';

  try {
    if (game.phase === PHASE.CALL) {
      const idx = game.declarerIndex;
      const hand = game.getPlayerHand(idx);
      let cardId;
      if (diff === 'ai') cardId = await aiCallCard(hand, (room.teamTrackers || {})[idx]);
      else cardId = botCallCard(hand, diff);
      const res = game.callCard(idx, cardId);
      if (res.success) {
        io.to(roomCode).emit('card_called', { calledCard: res.calledCard, declarerIndex: game.declarerIndex });
        broadcastState(room);
        const np = room.players[res.currentTurn];
        if (np && !np.isBot && !np.disconnected) io.to(np.socketId).emit('your_turn', { lastPlay: null, isNewRound: true });
        scheduleBotTurn(roomCode);
      }
      return;
    }

    if (game.phase === PHASE.PLAYING) {
      const idx = game.currentTurnIndex;
      if (idx < 0) return;
      const hand = game.getPlayerHand(idx);
      const prevLastPlay = game.lastPlay;
      let dec;
      if (diff === 'ai') {
        const gs = game.getGameState(idx);
        dec = await aiPlayCards(hand, game.lastPlay, gs, idx, (room.teamTrackers || {})[idx]);
      } else {
        dec = botPlayCards(hand, game.lastPlay, diff);
      }
      if (!dec) dec = { action: 'pass' };
      // 新回合（无上家牌）不能过：自动出最小单张兜底
      if (dec.action !== 'play' && !game.lastPlay) {
        const smallest = [...hand].sort((a, b) => a.value - b.value)[0];
        if (smallest) dec = { action: 'play', cardIds: [smallest.id] };
      }

      if (dec.action === 'play') {
        const res = game.playCards(idx, dec.cardIds);
        if (res.success) {
          recordTrackerAction(room, idx, 'play', prevLastPlay, dec.cardIds);
          io.to(roomCode).emit('cards_played', { playerIndex: res.playerIndex, cards: res.cards, handAnalysis: res.handAnalysis, justFinished: res.justFinished, finishPosition: res.finishPosition });
          if (res.teammateJustRevealed) io.to(roomCode).emit('teammate_revealed', { teammateIndex: res.teammateIndex, teammateNickname: res.teammateNickname, calledCardId: game.calledCardId });
          if (res.gameOver) { finishGame(room, roomCode, res); return; }
          broadcastState(room);
          const np = room.players[res.currentTurn];
          if (np && !np.isBot && !np.disconnected) io.to(np.socketId).emit('your_turn', { lastPlay: game.lastPlay, isNewRound: false });
          scheduleBotTurn(roomCode);
          return;
        }
        // 兜底：决策出牌被拒，则尝试过牌
        dec = { action: 'pass' };
      }

      const res = game.pass(idx);
      if (res.success) {
        recordTrackerAction(room, idx, 'pass', prevLastPlay, null);
        io.to(roomCode).emit('player_passed', { playerIndex: res.playerIndex, roundReset: res.roundReset });
        broadcastState(room);
        const np = room.players[res.currentTurn];
        if (np && !np.isBot && !np.disconnected) io.to(np.socketId).emit('your_turn', { lastPlay: game.lastPlay, isNewRound: res.roundReset });
        scheduleBotTurn(roomCode);
      }
    }
  } catch (e) {
    console.log('[ERR] performAutoTurn:', e.message);
  }
}

// ===== 在线匹配 =====
function removeFromMatchQueue(socketId) {
  const i = matchQueue.findIndex(e => e.socketId === socketId);
  if (i >= 0) matchQueue.splice(i, 1);
}

function notifyMatchQueue() {
  matchQueue.forEach(e => { if (e.socket) e.socket.emit('match_update', { queueSize: matchQueue.length }); });
}

// 满 4 人立即开局；force=true（超时）则用机器人补满后开局
function tryFormMatch(force) {
  if (matchQueue.length === 0) return;
  if (!force && matchQueue.length < 4) return;
  if (matchTimer) { clearTimeout(matchTimer); matchTimer = null; }

  const humans = matchQueue.splice(0, 4);
  const players = humans.map(e => ({ socketId: e.socketId, nickname: e.nickname, avatar: e.avatar, isBot: false }));
  let bi = 0;
  while (players.length < 4) {
    players.push({
      socketId: `bot_match_${Date.now()}_${bi}`,
      nickname: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
      avatar: BOT_AVATARS[Math.floor(Math.random() * BOT_AVATARS.length)],
      isBot: true,
    });
    bi++;
  }

  const room = roomManager.createMatchRoom(players);
  const roomCode = room.code;
  room.botDifficulty = 'medium';
  humans.forEach(e => { if (e.socket) e.socket.join(roomCode); });

  const game = new GameManager(roomCode);
  const startResult = game.start(room.players.map(p => ({
    socketId: p.socketId, nickname: p.nickname, avatar: p.avatar || '', isBot: p.isBot || false,
  })));
  room.game = game;
  room.isPlaying = true;
  broadcastRoomUpdate(roomCode);

  io.to(roomCode).emit('game_start', {
    phase: 'call', declarerIndex: startResult.declarerIndex,
    declarerNickname: startResult.declarerNickname, playerCount: 4, isMatch: true,
  });
  room.players.forEach((p, i) => {
    if (!p.isBot) io.to(p.socketId).emit('game_state', Object.assign(game.getGameState(i), { cumulativeScores: room.scores || [0,0,0,0] }));
  });
  const declarer = room.players[startResult.declarerIndex];
  if (declarer && !declarer.isBot) {
    io.to(declarer.socketId).emit('your_turn_call', { myHand: game.getPlayerHand(startResult.declarerIndex), canCallAny: true });
  }
  scheduleBotTurn(roomCode);
}

// 启动服务器
process.on("uncaughtException", (err) => {
  console.log("[崩溃]", err.message);
  console.log(err.stack);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[启动] 穿剑服务器已启动，端口: ${PORT}`);
  console.log(`[启动] 访问 http://localhost:${PORT} 进入游戏`);
});
