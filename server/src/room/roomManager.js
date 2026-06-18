const { v4: uuidv4 } = require('uuid');
const { GameManager, PHASE } = require('../game/gameManager');

class RoomManager {
  constructor() {
    this.rooms = new Map();     // roomId -> room
    this.socketRooms = new Map(); // socketId -> roomId
  }

  // 生成6位房间码
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }

  // 创建房间
  createRoom(socketId, nickname) {
    const roomCode = this.generateRoomCode();
    const room = {
      code: roomCode,
      id: uuidv4(),
      players: [{
        socketId,
        nickname,
        ready: false,
        index: 0,
        isHost: true,
      }],
      game: null,
      createdAt: Date.now(),
      isPlaying: false,
    };
    
    this.rooms.set(roomCode, room);
    this.socketRooms.set(socketId, roomCode);
    
    return {
      roomCode,
      roomId: room.id,
      players: room.players.map(this._sanitizePlayer),
    };
  }

  // 加入房间
  joinRoom(roomCode, socketId, nickname) {
    const room = this.rooms.get(roomCode);
    if (!room) return { success: false, reason: '房间不存在' };
    if (room.isPlaying) return { success: false, reason: '游戏已开始' };
    if (room.players.length >= 4) return { success: false, reason: '房间已满' };
    if (room.players.find(p => p.socketId === socketId)) {
      return { success: false, reason: '已在房间中' };
    }
    
    const playerIndex = room.players.length;
    room.players.push({
      socketId,
      nickname,
      ready: false,
      index: playerIndex,
      isHost: false,
    });
    
    this.socketRooms.set(socketId, roomCode);
    
    return {
      success: true,
      roomCode,
      roomId: room.id,
      players: room.players.map(this._sanitizePlayer),
      myIndex: playerIndex,
    };
  }

  // 离开房间
  leaveRoom(socketId) {
    const roomCode = this.socketRooms.get(socketId);
    if (!roomCode) return null;
    
    const room = this.rooms.get(roomCode);
    if (!room) {
      this.socketRooms.delete(socketId);
      return null;
    }
    
    // 移除玩家或机器人
    room.players = room.players.filter(p => p.socketId !== socketId);
    // 更新索引
    room.players.forEach((p, i) => p.index = i);
    this.socketRooms.delete(socketId);
    
    // 如果房间空了，删除房间
    if (room.players.length === 0) {
      this.rooms.delete(roomCode);
      return { roomCode, action: 'room_deleted', players: [] };
    }
    
    // 如果房主离开，转交给下一个
    const newHost = room.players[0];
    if (newHost) {
      room.players.forEach(p => p.isHost = false);
      newHost.isHost = true;
    }
    
    return {
      roomCode,
      action: 'player_left',
      players: room.players.map(this._sanitizePlayer),
    };
  }

  // 准备/取消准备
  toggleReady(socketId) {
    const roomCode = this.socketRooms.get(socketId);
    if (!roomCode) return null;
    
    const room = this.rooms.get(roomCode);
    if (!room || room.isPlaying) return null;
    
    const player = room.players.find(p => p.socketId === socketId);
    if (!player) return null;
    
    player.ready = !player.ready;
    
    // 检查是否所有人都准备好了
    const allReady = room.players.length === 4 && room.players.every(p => p.ready);
    
    return {
      roomCode,
      players: room.players.map(this._sanitizePlayer),
      allReady,
    };
  }

  // 开始游戏
  startGame(socketId) {
    const roomCode = this.socketRooms.get(socketId);
    if (!roomCode) return { success: false, reason: '不在房间中' };
    
    const room = this.rooms.get(roomCode);
    if (!room) return { success: false, reason: '房间不存在' };
    if (room.isPlaying) return { success: false, reason: '游戏已开始' };
    
    const player = room.players.find(p => p.socketId === socketId);
    if (!player || !player.isHost) return { success: false, reason: '只有房主可以开始游戏' };
    if (room.players.length !== 4) return { success: false, reason: '需要4名玩家' };
    
    // 检查是否所有人都准备了
    // 如果房主强制开始，也允许
    const allReady = room.players.every(p => p.ready);
    
    // 创建游戏
    const game = new GameManager(roomCode);
    const startResult = game.start(room.players.map(p => ({
      socketId: p.socketId,
      nickname: p.nickname,
      isBot: p.isBot || false,
    })));
    
    room.game = game;
    room.isPlaying = true;
    
    return {
      success: true,
      allReady,
      gameInfo: startResult,
    };
  }

  // 获取房间信息
  getRoom(roomCode) {
    return this.rooms.get(roomCode) || null;
  }
  
  getRoomBySocket(socketId) {
    const roomCode = this.socketRooms.get(socketId);
    if (!roomCode) return null;
    return this.rooms.get(roomCode) || null;
  }
  
  getRoomCode(socketId) {
    return this.socketRooms.get(socketId) || null;
  }
  
  getPlayerFromRoom(roomCode, socketId) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;
    return room.players.find(p => p.socketId === socketId) || null;
  }
  
  getAllSocketIds(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return [];
    return room.players.map(p => p.socketId);
  }

  // 添加机器人
  addBot(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || room.isPlaying) return { success: false, reason: "游戏进行中" };
    if (room.players.length >= 4) return { success: false, reason: "房间已满" };
    const botCount = room.players.filter(p => p.isBot).length;
    const nicknames = ["电脑甲", "电脑乙", "电脑丙", "电脑丁"];
    const playerIndex = room.players.length;
    room.players.push({
      socketId: `bot_${roomCode}_${botCount}`,
      nickname: nicknames[botCount],
      ready: true,
      index: playerIndex,
      isHost: false,
      isBot: true,
    });
    return { success: true, players: room.players.map(p => this._sanitizePlayer(p)) };
  }

  // 移除最后一个机器人
  removeBot(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || room.isPlaying) return { success: false, reason: "游戏进行中" };
    let botIdx = -1;
    for (let i = room.players.length - 1; i >= 0; i--) {
      if (room.players[i].isBot) { botIdx = i; break; }
    }
    if (botIdx === -1) return { success: false, reason: "没有机器人" };
    room.players.splice(botIdx, 1);
    room.players.forEach((p, i) => p.index = i);
    return { success: true, players: room.players.map(p => this._sanitizePlayer(p)) };
  }

  // 清理玩家名中的敏感信息
  _sanitizePlayer(player) {
    return {
      index: player.index,
      nickname: player.nickname,
      ready: player.ready,
      isHost: player.isHost,
      isBot: player.isBot || false,
    };
  }

  // 清理过期房间（可定期调用）
  cleanup(maxAge = 3600000) {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.createdAt > maxAge) {
        // 通知所有玩家
        const sockets = room.players.map(p => p.socketId);
        this.rooms.delete(code);
        sockets.forEach(sid => this.socketRooms.delete(sid));
      }
    }
  }
}

module.exports = RoomManager;
