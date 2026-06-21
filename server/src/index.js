const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { botCallCard, botPlayCards } = require('./game/botAi');
const { aiCallCard, aiPlayCards } = require('./game/aiBot');
const { createTeamTracker } = require('./game/teamDeduction');
const RoomManager = require('./room/roomManager');
const { PHASE } = require('./game/gameManager');

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
    const startResult = game.startDevMode(room.players.map(p => ({
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
    // 处理叫牌（H4在玩家手中）
    const declarer = room.players[0];
    io.to(declarer.socketId).emit("your_turn_call", {
      myHand: game.getPlayerHand(0),
      canCallAny: true,
    });
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
        io.to(p.socketId).emit('game_state', undefined);
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
    const result = room.game.playCards(player.index, cardIds);
    
    if (result.success) {
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
      
      scheduleBotTurn(roomCode);

      if (result.gameOver) {
        io.to(roomCode).emit('game_over', {
          result: result.result,
        });
        room.isPlaying = false;
        room.game = null;
        room.players.forEach(p => p.ready = false);
        broadcastRoomUpdate(roomCode);
        return;
      }
      
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
    
    const result = room.game.pass(player.index);
    
    if (result.success) {
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

  // 断开连接
  socket.on('disconnect', () => {
    console.log(`[断开] ${socket.id} 已断开`);
    const result = roomManager.leaveRoom(socket.id);
    if (result) {
      if (result.action !== 'room_deleted') {
        broadcastRoomUpdate(result.roomCode);
        io.to(result.roomCode).emit('player_disconnected', {
          socketId: socket.id,
        });
      }
    }
  });
});


// ===== 机器人回合自动执行 =====
function scheduleBotTurn(roomCode) {
  const room = roomManager.getRoom(roomCode);
  if (!room || !room.game) return;
  if (room.game.phase === PHASE.FINISHED || room.game.phase === PHASE.WAITING) return;

  // CALL phase: check if declarer is a bot
  if (room.game.phase === PHASE.CALL) {
    const declarer = room.players[room.game.declarerIndex];
    if (!declarer || !declarer.isBot) return;
  } else {
    // PLAYING phase: check current turn player
    const cp = room.players[room.game.currentTurnIndex];
    if (!cp || !cp.isBot) return;
  }

  setTimeout(async () => {
    const cr = roomManager.getRoom(roomCode);
    if (!cr || !cr.game) return;
    if (cr.game.phase === PHASE.FINISHED) return;

    // Initialize team trackers for AI bots (once)
    if (!cr.teamTrackers || Object.keys(cr.teamTrackers).length < 4) {
      cr.teamTrackers = {};
      const gs = cr.game.getGameState(0);
      for (let i = 0; i < 4; i++) {
        cr.teamTrackers[i] = createTeamTracker(i, gs);
      }
    }

    if (cr.game.phase === PHASE.CALL) {
      const declarer = cr.players[cr.game.declarerIndex];
      if (!declarer || !declarer.isBot) return;
      // Bot declarer calls a card
      const hand = cr.game.getPlayerHand(cr.game.declarerIndex);
      const diff = (roomManager.getRoom(roomCode) || {}).botDifficulty || 'easy';
      let cardId;
      if (diff === 'ai') {
        cardId = await aiCallCard(hand, (cr.teamTrackers || {})[cr.game.declarerIndex]);
      } else {
        cardId = botCallCard(hand, diff);
      }
      const res = cr.game.callCard(cr.game.declarerIndex, cardId);
      if (res.success) {
        io.to(roomCode).emit("card_called", { calledCard: res.calledCard, declarerIndex: cr.game.declarerIndex });
        cr.players.forEach((p, i) => {
          if (!p.isBot) io.to(p.socketId).emit("game_state", Object.assign(cr.game.getGameState(i), { cumulativeScores: (roomManager.getRoom(roomCode) || {}).scores || [0,0,0,0] }));
        });
        const np = cr.players[res.currentTurn];
        if (np && !np.isBot) io.to(np.socketId).emit("your_turn", { lastPlay: null, isNewRound: true });
        scheduleBotTurn(roomCode);
      }
    } else if (cr.game.phase === PHASE.PLAYING) {
      const bp = cr.players[cr.game.currentTurnIndex];
      if (!bp || !bp.isBot) return;
      const hand = cr.game.getPlayerHand(cr.game.currentTurnIndex);
      const diff = (roomManager.getRoom(roomCode) || {}).botDifficulty || 'easy';
      let dec;
      if (diff === 'ai') {
        const gs = cr.game.getGameState(cr.game.currentTurnIndex);
        dec = await aiPlayCards(hand, cr.game.lastPlay, gs, cr.game.currentTurnIndex, (cr.teamTrackers || {})[cr.game.currentTurnIndex]);
      } else {
        dec = botPlayCards(hand, cr.game.lastPlay, diff);
      }

      if (dec.action === "play") {
        const res = cr.game.playCards(cr.game.currentTurnIndex, dec.cardIds);
        if (res.success) {
          io.to(roomCode).emit("cards_played", { playerIndex: res.playerIndex, cards: res.cards, handAnalysis: res.handAnalysis, justFinished: res.justFinished, finishPosition: res.finishPosition });
          if (res.teammateJustRevealed) io.to(roomCode).emit("teammate_revealed", { teammateIndex: res.teammateIndex, teammateNickname: res.teammateNickname, calledCardId: cr.game.calledCardId });
          if (res.gameOver) {
            io.to(roomCode).emit("game_over", { result: res.result });
            cr.isPlaying = false; cr.game = null;
            cr.players.forEach(p => p.ready = false);
            return;
          }
          cr.players.forEach((p, i) => {
            if (!p.isBot) io.to(p.socketId).emit("game_state", Object.assign(cr.game.getGameState(i), { cumulativeScores: (roomManager.getRoom(roomCode) || {}).scores || [0,0,0,0] }));
          });
          const np = cr.players[res.currentTurn];
          if (np && !np.isBot) io.to(np.socketId).emit("your_turn", { lastPlay: cr.game.lastPlay, isNewRound: false });
          scheduleBotTurn(roomCode);
        }
      } else {
        const res = cr.game.pass(cr.game.currentTurnIndex);
        if (res.success) {
          io.to(roomCode).emit("player_passed", { playerIndex: res.playerIndex, roundReset: res.roundReset });
          cr.players.forEach((p, i) => {
            if (!p.isBot) io.to(p.socketId).emit("game_state", Object.assign(cr.game.getGameState(i), { cumulativeScores: (roomManager.getRoom(roomCode) || {}).scores || [0,0,0,0] }));
          });
          const np = cr.players[res.currentTurn];
          if (np && !np.isBot) io.to(np.socketId).emit("your_turn", { lastPlay: cr.game.lastPlay, isNewRound: res.roundReset });
          scheduleBotTurn(roomCode);
        }
      }
    }
  }, 2000);
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
