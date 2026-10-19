const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const players = {};

io.on('connection', (socket) => {
  socket.on('joinGame', (data) => {
    players[socket.id] = {
      id: socket.id,
      username: data.username || 'Anonymous',
      color: data.color,
      x: 0.5,
      y: 0.5,
      angle: 0,
      speed: 0,
      idleTime: 0,
      trail: [],
      score: 0,
      hp: 100,
      isDead: false
    };
    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', players[socket.id]);
    broadcastOnlineCount();
  });

  function broadcastOnlineCount() {
    const count = Object.keys(players).length;
    io.emit('onlineCount', count);
  }

  socket.on('playerMovement', (data) => {
    if (players[socket.id]) {
      Object.assign(players[socket.id], data);
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  // World Chat
  socket.on('sendChatMessage', (message) => {
    const sender = players[socket.id];
    if (sender && message && message.trim().length > 0) {
      io.emit('newChatMessage', {
        id: socket.id,
        username: sender.username,
        color: sender.color.glow,
        text: message.trim().substring(0, 80)
      });
    }
  });

  // Sync Laser Bullets
  socket.on('shootBullet', (bulletData) => {
    const newBullet = {
      ...bulletData,
      owner: socket.id
    };
    socket.broadcast.emit('newBullet', newBullet);
  });

  // Direct Damage & Elimination
  socket.on('applyDirectDamage', ({ bulletId, targetId, amount, hitX, hitY }) => {
    const target = players[targetId];
    const attacker = players[socket.id];
    if (target && !target.isDead) {
      const dmg = amount || 35;
      target.hp = Math.max(0, target.hp - dmg);

      if (bulletId) {
        io.emit('bulletDestroyed', { bulletId, hitX, hitY });
      }

      if (target.hp <= 0) {
        target.hp = 0;
        target.isDead = true;
        if (attacker && attacker.id !== targetId) {
          attacker.score += 100;
        }
        const killerName = attacker ? attacker.username : 'Unknown';
        io.emit('playerExploded', { 
          victimId: targetId, 
          killerId: socket.id,
          killerName: killerName 
        });
      } else {
        io.emit('playerDamaged', { id: targetId, hp: target.hp, amount: dmg, hitX, hitY });
      }
      io.emit('scoreUpdate', players);
    }
  });

  // Respawn Player
  socket.on('respawnPlayer', () => {
    const player = players[socket.id];
    if (player) {
      player.hp = 100;
      player.isDead = false;
      player.x = Math.random() * 0.8 + 0.1;
      player.y = Math.random() * 0.8 + 0.1;
      io.emit('playerRespawned', player);
      io.emit('scoreUpdate', players);
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
    broadcastOnlineCount();
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Battle Arena Server running on port ${PORT}`);
});