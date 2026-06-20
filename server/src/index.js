const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { botCallCard, botPlayCards } = require('./game/botAi');
const RoomManager = require('./room/roomManager');
const { PHASE } = require('./game/gameManager');

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
        setTimeout(() => {
          const cr = roomManager.getRoom(roomCode);
          if (!cr || !cr.game || cr.game.phase !== 'call') return;
          const hand = game.getPlayerHand(result.gameInfo.declarerIndex);
          const cardId = botCallCard(hand);
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

      io.to(socket.id).emit('teammate_info', {
        teammateIndex: result.teammateIndex,
        teammateNickname: result.teammateNickname,
      });

      room.players.forEach((p, i) => {
        io.to(p.socketId).emit('game_state', Object.assign(game.getGameState(i), { cumulativeScores: room.scores || [0,0,0,0] }));
      });

      const currentPlayer = room.players[result.currentTurn];
      io.to(currentPlayer.socketId).emit('your_turn', {
        lastPlay: null,
        isNewRound: true,
      });

      scheduleBotTurn(roomCode);
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

  setTimeout(() => {
    const cr = roomManager.getRoom(roomCode);
    if (!cr || !cr.game) return;
    if (cr.game.phase === PHASE.FINISHED) return;

    if (cr.game.phase === PHASE.CALL) {
      const declarer = cr.players[cr.game.declarerIndex];
      if (!declarer || !declarer.isBot) return;
      // Bot declarer calls a card
      const hand = cr.game.getPlayerHand(cr.game.declarerIndex);
      const cardId = botCallCard(hand);
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
      const dec = botPlayCards(hand, cr.game.lastPlay);

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
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[启动] 穿剑服务器已启动，端口: ${PORT}`);
  console.log(`[启动] 访问 http://localhost:${PORT} 进入游戏`);
});
