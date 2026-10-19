const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ชี้ตรงไปยัง Backend Server บน Render
const SERVER_URL = 'https://living-cursor-game.onrender.com';
let socket = null;

function generateNeonColor() {
  const hues = [185, 205, 285, 315, 340, 45];
  const hue = hues[Math.floor(Math.random() * hues.length)];
  return {
    hue: hue,
    main: `hsl(${hue}, 100%, 60%)`,
    glow: `hsl(${hue}, 100%, 75%)`
  };
}

const myColor = generateNeonColor();
let myUsername = '';
let isPlaying = false;
let myHp = 100;

let mouseX = canvas.width / 2;
let mouseY = canvas.height / 2;
let prevX = mouseX;
let prevY = mouseY;
let speed = 0;
let angle = 0;
let idleTime = 0;
const maxIdleTime = 80;

const trail = [];
const maxTrailLength = 26;
const otherPlayers = {};
let bullets = [];
const particles = [];
const damageTexts = [];
let damageFlashAlpha = 0;
let screenShake = 0;

let lastShootTime = 0;
const SHOOT_COOLDOWN = 180;
let isChatFocused = false;
let isDead = false;
let myScore = 0;

// UI Elements
const loginOverlay = document.getElementById('loginOverlay');
const usernameInput = document.getElementById('usernameInput');
const startBtn = document.getElementById('startBtn');
const hud = document.getElementById('hud');
const scoreDisplay = document.getElementById('myScoreDisplay');
const usernameDisplay = document.getElementById('myUsernameDisplay');
const hpBar = document.getElementById('myHpBar');
const hpText = document.getElementById('hpText');
const onlineCountText = document.getElementById('onlineCountText');

// Game Over UI
const gameOverOverlay = document.getElementById('gameOverOverlay');
const killerNameDisplay = document.getElementById('killerNameDisplay');
const finalScoreDisplay = document.getElementById('finalScoreDisplay');
const respawnBtn = document.getElementById('respawnBtn');

// Chat UI
const chatContainer = document.getElementById('chatContainer');
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

startBtn.addEventListener('click', startGame);
if (respawnBtn) {
  respawnBtn.addEventListener('click', respawnPlayer);
}
usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startGame();
});

function startGame() {
  const name = usernameInput.value.trim();
  if (!name) return;
  myUsername = name;
  usernameDisplay.innerText = myUsername.toUpperCase();
  loginOverlay.style.display = 'none';
  hud.style.display = 'block';
  chatContainer.style.display = 'flex';
  document.body.style.cursor = 'none';

  createMobileFireButton();
  initSocket();
  setupChat();
  isPlaying = true;
}

function respawnPlayer() {
  if (!isDead) return;
  if (gameOverOverlay) gameOverOverlay.style.display = 'none';
  document.body.style.cursor = 'none';
  myHp = 100;
  updateHpUI(100);
  isDead = false;
  mouseX = Math.random() * (canvas.width - 140) + 70;
  mouseY = Math.random() * (canvas.height - 140) + 70;
  prevX = mouseX;
  prevY = mouseY;
  trail.length = 0;
  if (socket && socket.connected) {
    socket.emit('respawnPlayer');
  }
}

// ควบคุมระบบแชท
function setupChat() {
  chatInput.addEventListener('focus', () => { isChatFocused = true; });
  chatInput.addEventListener('blur', () => { isChatFocused = false; });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (text) {
      appendChatMessage(myUsername, text, myColor.glow);
      if (socket && socket.connected) {
        socket.emit('sendChatMessage', text);
      }
      chatInput.value = '';
      chatInput.blur();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !isChatFocused && isPlaying) {
      e.preventDefault();
      chatInput.focus();
    }
  });
}

function appendChatMessage(sender, text, color) {
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg';
  msgEl.innerHTML = `<span class="chat-sender" style="color: ${color || '#00f0ff'}">${sender}:</span> ${escapeHTML(text)}`;
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  setTimeout(() => {
    msgEl.style.transition = 'opacity 1s';
    msgEl.style.opacity = '0.35';
  }, 10000);
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag] || tag));
}

// ปุ่ม FIRE
function createMobileFireButton() {
  if (document.getElementById('mobileFireBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'mobileFireBtn';
  btn.innerText = '⚡ FIRE';
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    width: '76px',
    height: '76px',
    borderRadius: '50%',
    background: 'rgba(0, 240, 255, 0.25)',
    border: '2px solid #00f0ff',
    color: '#00f0ff',
    fontFamily: "'Orbitron', monospace",
    fontSize: '13px',
    fontWeight: 'bold',
    zIndex: '50',
    backdropFilter: 'blur(8px)',
    boxShadow: '0 0 16px rgba(0, 240, 255, 0.45)',
    touchAction: 'none',
    cursor: 'pointer'
  });

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tryShoot();
  });
  document.body.appendChild(btn);
}

function initSocket() {
  socket = io(SERVER_URL);

  socket.on('connect', () => {
    socket.emit('joinGame', { username: myUsername, color: myColor });
  });

  socket.on('currentPlayers', (players) => {
    Object.keys(players).forEach((id) => {
      if (id !== socket.id) otherPlayers[id] = players[id];
    });
  });

  socket.on('newPlayer', (player) => {
    otherPlayers[player.id] = player;
  });

  socket.on('playerMoved', (data) => {
    if (otherPlayers[data.id]) Object.assign(otherPlayers[data.id], data);
  });

  socket.on('newChatMessage', (msg) => {
    if (msg.username !== myUsername) {
      appendChatMessage(msg.username, msg.text, msg.color);
    }
  });

  socket.on('newBullet', (b) => {
    if (b.owner !== socket.id) bullets.push(b);
  });

  socket.on('bulletDestroyed', ({ bulletId, hitX, hitY }) => {
    const idx = bullets.findIndex(b => b.id === bulletId);
    if (idx !== -1) {
      bullets.splice(idx, 1);
    }
    if (hitX !== undefined && hitY !== undefined) {
      createHitExplosion(hitX * canvas.width, hitY * canvas.height, '#ff0055', 18);
    }
  });

  socket.on('playerDamaged', ({ id, hp, amount, hitX, hitY }) => {
    const dmg = amount || 35;
    if (id === socket.id) {
      updateHpUI(hp);
      createHitExplosion(mouseX, mouseY, '#ff0055', 24);
      spawnDamageText(mouseX, mouseY - 25, `-${dmg}`, '#ff0055');
      triggerDamageFlash(0.45);
    } else if (otherPlayers[id]) {
      otherPlayers[id].hp = hp;
      const opp = otherPlayers[id];
      const px = hitX !== undefined ? hitX * canvas.width : opp.x * canvas.width;
      const py = hitY !== undefined ? hitY * canvas.height : opp.y * canvas.height;
      createHitExplosion(px, py, '#ff0055', 18);
      spawnDamageText(px, py - 25, `-${dmg}`, '#ff0055');
    }
  });

  socket.on('onlineCount', (count) => {
    if (onlineCountText) {
      onlineCountText.innerText = `${count} ONLINE`;
    }
  });

  socket.on('playerExploded', ({ victimId, killerId, killerName }) => {
    if (victimId === socket.id) {
      isDead = true;
      createHitExplosion(mouseX, mouseY, myColor.main, 36);
      createHitExplosion(mouseX, mouseY, '#ff0055', 30);
      spawnDamageText(mouseX, mouseY - 30, 'K.O.!', '#ff0055');
      triggerDamageFlash(0.7);
      updateHpUI(0);

      if (killerNameDisplay) killerNameDisplay.innerText = (killerName || 'UNKNOWN ENEMY').toUpperCase();
      if (finalScoreDisplay) finalScoreDisplay.innerText = myScore;
      if (gameOverOverlay) gameOverOverlay.style.display = 'flex';
      document.body.style.cursor = 'default';
    } else if (otherPlayers[victimId]) {
      const p = otherPlayers[victimId];
      p.isDead = true;
      p.hp = 0;
      const px = p.x * canvas.width;
      const py = p.y * canvas.height;
      createHitExplosion(px, py, p.color ? p.color.main : '#ff0055', 36);
      createHitExplosion(px, py, '#ff0055', 30);
      spawnDamageText(px, py - 30, 'K.O.!', '#00ff88');
    }
  });

  socket.on('playerRespawned', (data) => {
    if (data.id === socket.id) {
      isDead = false;
      updateHpUI(100);
      if (gameOverOverlay) gameOverOverlay.style.display = 'none';
      document.body.style.cursor = 'none';
      mouseX = data.x * canvas.width;
      mouseY = data.y * canvas.height;
      prevX = mouseX;
      prevY = mouseY;
    } else if (otherPlayers[data.id]) {
      Object.assign(otherPlayers[data.id], data);
      otherPlayers[data.id].isDead = false;
      otherPlayers[data.id].hp = 100;
    }
  });

  socket.on('scoreUpdate', (players) => {
    if (players[socket.id]) {
      myScore = players[socket.id].score;
      scoreDisplay.innerText = `SCORE ${myScore}`;
    }
    Object.keys(players).forEach((id) => {
      if (otherPlayers[id]) {
        otherPlayers[id].score = players[id].score;
      }
    });
  });

  socket.on('playerDisconnected', (id) => {
    delete otherPlayers[id];
  });
}

function updateHpUI(hp) {
  myHp = hp;
  hpText.innerText = `${Math.round(myHp)}%`;
  hpBar.style.width = `${Math.max(0, myHp)}%`;

  if (myHp > 45) {
    hpBar.style.background = 'linear-gradient(90deg, #00ff88, #00f0ff)';
    hpBar.style.boxShadow = '0 0 10px #00ff88';
    hpText.style.color = '#00ff88';
  } else {
    hpBar.style.background = 'linear-gradient(90deg, #ff0055, #ff5500)';
    hpBar.style.boxShadow = '0 0 12px #ff0055';
    hpText.style.color = '#ff0055';
  }
}

// Controls
canvas.addEventListener('pointermove', (e) => {
  if (!isPlaying || isChatFocused || isDead) return;
  e.preventDefault();
  mouseX = e.clientX;
  mouseY = e.clientY;
});

canvas.addEventListener('pointerdown', (e) => {
  if (!isPlaying || isChatFocused || isDead) return;
  mouseX = e.clientX;
  mouseY = e.clientY;
  tryShoot();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && isPlaying && !isChatFocused && !isDead) {
    e.preventDefault();
    tryShoot();
  }
});

function tryShoot() {
  if (isDead) return;
  const now = performance.now();
  if (now - lastShootTime >= SHOOT_COOLDOWN) {
    lastShootTime = now;
    shootLaserBeam();
  }
}

function shootLaserBeam() {
  const beamSpeed = 24;
  const spawnDist = 40;
  const spawnX = mouseX + Math.cos(angle) * spawnDist;
  const spawnY = mouseY + Math.sin(angle) * spawnDist;

  const bulletData = {
    id: 'b_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
    owner: socket && socket.connected ? socket.id : 'me',
    x: spawnX / canvas.width,
    y: spawnY / canvas.height,
    vx: (Math.cos(angle) * beamSpeed) / canvas.width,
    vy: (Math.sin(angle) * beamSpeed) / canvas.height,
    angle: angle,
    length: 65,
    radius: 7,
    color: myColor,
    life: 80
  };

  bullets.push(bulletData);
  if (socket && socket.connected) {
    socket.emit('shootBullet', bulletData);
  }
}

function updateBulletsAndHitCheck() {
  const myId = (socket && socket.connected) ? socket.id : 'me';

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.life--;

    const bx = b.x * canvas.width;
    const by = b.y * canvas.height;

    if (b.owner === myId) {
      for (const id of Object.keys(otherPlayers)) {
        const opp = otherPlayers[id];
        if (opp.isDead) continue;
        const ox = opp.x * canvas.width;
        const oy = opp.y * canvas.height;
        const dist = Math.hypot(bx - ox, by - oy);

        if (dist < 36) {
          createHitExplosion(ox, oy, '#ff0055', 18);
          if (socket && socket.connected) {
            socket.emit('applyDirectDamage', {
              bulletId: b.id,
              targetId: id,
              amount: 35,
              hitX: opp.x,
              hitY: opp.y
            });
          } else {
            spawnDamageText(ox, oy - 20, '-35', '#ff0055');
          }
          bullets.splice(i, 1);
          break;
        }
      }
    }

    if (b.life <= 0 || b.x < -0.1 || b.x > 1.1 || b.y < -0.1 || b.y > 1.1) {
      bullets.splice(i, 1);
    }
  }
}

function updateMovement() {
  if (isDead || isChatFocused) return;

  const dx = mouseX - prevX;
  const dy = mouseY - prevY;
  speed = Math.sqrt(dx * dx + dy * dy);

  if (speed > 0.8) {
    angle = Math.atan2(dy, dx);
    idleTime = Math.max(0, idleTime - 8);
  } else {
    idleTime = Math.min(maxIdleTime, idleTime + 1);
  }

  trail.push({ x: mouseX, y: mouseY });
  if (trail.length > maxTrailLength) trail.shift();

  if (socket && socket.connected) {
    const normTrail = trail.map(p => ({ x: p.x / canvas.width, y: p.y / canvas.height }));
    socket.emit('playerMovement', {
      x: mouseX / canvas.width,
      y: mouseY / canvas.height,
      angle: angle,
      speed: speed,
      idleTime: idleTime,
      trail: normTrail
    });
  }

  prevX = mouseX;
  prevY = mouseY;
}

let lastHitTime = 0;
function checkBodyCollisions() {
  if (isDead) return;
  const now = performance.now();
  if (now - lastHitTime < 180) return;

  Object.keys(otherPlayers).forEach((id) => {
    const opp = otherPlayers[id];
    if (opp.isDead) return;
    const ox = opp.x * canvas.width;
    const oy = opp.y * canvas.height;
    const dist = Math.hypot(mouseX - ox, mouseY - oy);

    if (dist < 42) {
      lastHitTime = now;
      createHitExplosion((mouseX + ox) / 2, (mouseY + oy) / 2, '#ff0055', 8);

      if (speed > opp.speed + 3) {
        socket.emit('applyDirectDamage', { targetId: id, amount: 40 });
      } else if (opp.speed > speed + 3) {
        socket.emit('applyDirectDamage', { targetId: socket.id, amount: 40 });
      } else {
        socket.emit('applyDirectDamage', { targetId: id, amount: 20 });
        socket.emit('applyDirectDamage', { targetId: socket.id, amount: 20 });
      }
    }
  });
}

function createHitExplosion(x, y, color, count = 12) {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = Math.random() * 5 + 2;
    particles.push({
      x, y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      radius: Math.random() * 3 + 1.5,
      color: color,
      alpha: 1,
      decay: Math.random() * 0.04 + 0.02
    });
  }
}

function updateAndDrawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= p.decay;
    if (p.alpha <= 0) {
      particles.splice(i, 1);
      continue;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.alpha;
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }
}

function drawNeonTrail(trailData, color, isNormalized = false) {
  if (!trailData || trailData.length < 2) return;

  for (let i = 1; i < trailData.length; i++) {
    const p1 = trailData[i - 1];
    const p2 = trailData[i];

    const x1 = isNormalized ? p1.x * canvas.width : p1.x;
    const y1 = isNormalized ? p1.y * canvas.height : p1.y;
    const x2 = isNormalized ? p2.x * canvas.width : p2.x;
    const y2 = isNormalized ? p2.y * canvas.height : p2.y;

    const progress = i / trailData.length;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color.main.replace(')', `, ${progress * 0.7})`).replace('hsl', 'hsla');
    ctx.lineWidth = progress * 9 + 1.5;
    ctx.lineCap = 'round';
    ctx.shadowColor = color.glow;
    ctx.shadowBlur = 12;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

function drawRoundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function drawCursor(x, y, color, curSpeed, curIdle, curAngle, username, hp = 100) {
  const sharpness = Math.min(curSpeed / 16, 1);
  const puff = curIdle / maxIdleTime;
  let len = (12 + sharpness * 26) * (1 - puff * 0.35) + 20 * puff;
  let wid = (9 - sharpness * 3.8) * (1 - puff * 0.25) + 20 * puff;

  // เลย์เอาต์ UI เหนือหัวเคอร์เซอร์
  const baseTopY = y - 55 - puff * 10;
  const barW = 50;
  const barH = 6;
  const barX = x - barW / 2;

  // 1. Username
  ctx.font = "bold 13px 'Rajdhani', sans-serif";
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 4;
  ctx.fillText(username.toUpperCase(), x, baseTopY);

  // 2. เปอร์เซ็นต์ HP
  ctx.font = "bold 10px 'Orbitron', monospace";
  ctx.fillStyle = hp > 40 ? '#00ff88' : '#ff0055';
  ctx.shadowColor = hp > 40 ? '#00ff88' : '#ff0055';
  ctx.shadowBlur = 6;
  ctx.fillText(`${Math.round(hp)}%`, x, baseTopY + 14);

  // 3. หลอดเลือดมนนีออน
  const barY = baseTopY + 18;
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(6, 6, 16, 0.85)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, barX, barY, barW, barH, 3);
  ctx.fill();
  ctx.stroke();

  const fillW = Math.max(0, barW * (hp / 100));
  if (fillW > 0) {
    ctx.fillStyle = hp > 40 ? '#00ff88' : '#ff0055';
    ctx.shadowColor = hp > 40 ? '#00ff88' : '#ff0055';
    ctx.shadowBlur = 8;
    drawRoundedRect(ctx, barX, barY, fillW, barH, 3);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // ตัวเคอร์เซอร์และหัวลูกศร
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(curAngle);

  // หัวลูกศรชี้ข้างหน้า
  const arrowDist = len + 18 + puff * 5;
  ctx.beginPath();
  ctx.moveTo(arrowDist + 11, 0);
  ctx.lineTo(arrowDist, -6);
  ctx.lineTo(arrowDist + 3, 0);
  ctx.lineTo(arrowDist, 6);
  ctx.closePath();
  ctx.fillStyle = color.glow;
  ctx.shadowColor = color.glow;
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Body
  ctx.beginPath();
  ctx.ellipse(0, 0, len + 14, wid + 12, 0, 0, Math.PI * 2);
  ctx.fillStyle = color.main.replace(')', ', 0.15)').replace('hsl', 'hsla');
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
  ctx.fillStyle = color.main;
  ctx.shadowColor = color.glow;
  ctx.shadowBlur = 24 + puff * 16;
  ctx.fill();

  // จุดกลาง
  ctx.beginPath();
  ctx.arc(0, 0, 3 + puff * 2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.shadowBlur = 0;
  ctx.fill();

  ctx.restore();
}

function drawBullets() {
  bullets.forEach(b => {
    const bx = b.x * canvas.width;
    const by = b.y * canvas.height;
    const bAngle = Math.atan2(b.vy * canvas.height, b.vx * canvas.width);
    const beamLen = b.length || 65;

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(bAngle);

    ctx.beginPath();
    ctx.moveTo(-beamLen, 0);
    ctx.lineTo(0, 0);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.shadowColor = b.color ? b.color.glow : '#00f0ff';
    ctx.shadowBlur = 16;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = b.color ? b.color.main : '#00f0ff';
    ctx.fill();

    ctx.restore();
  });
}

function spawnDamageText(x, y, text, color = '#ff0055') {
  damageTexts.push({
    x,
    y,
    text,
    color,
    alpha: 1.0,
    vy: -1.8,
    life: 50
  });
}

function updateAndDrawDamageTexts() {
  for (let i = damageTexts.length - 1; i >= 0; i--) {
    const dt = damageTexts[i];
    dt.y += dt.vy;
    dt.life--;
    dt.alpha = Math.max(0, dt.life / 50);

    ctx.save();
    ctx.font = "900 18px 'Orbitron', monospace";
    ctx.textAlign = 'center';
    ctx.fillStyle = dt.color;
    ctx.shadowColor = dt.color;
    ctx.shadowBlur = 12;
    ctx.globalAlpha = dt.alpha;
    ctx.fillText(dt.text, dt.x, dt.y);
    ctx.restore();

    if (dt.life <= 0) {
      damageTexts.splice(i, 1);
    }
  }
}

function triggerDamageFlash(intensity = 0.45) {
  damageFlashAlpha = intensity;
  screenShake = 12;
}

function gameLoop() {
  let shakeX = 0;
  let shakeY = 0;
  if (screenShake > 0) {
    shakeX = (Math.random() - 0.5) * screenShake;
    shakeY = (Math.random() - 0.5) * screenShake;
    screenShake = Math.max(0, screenShake - 1);
  }

  ctx.save();
  ctx.translate(shakeX, shakeY);

  ctx.fillStyle = 'rgba(5, 5, 10, 0.25)';
  ctx.fillRect(-20, -20, canvas.width + 40, canvas.height + 40);

  if (isPlaying) {
    updateMovement();
    updateBulletsAndHitCheck();
    checkBodyCollisions();

    if (!isDead) {
      drawNeonTrail(trail, myColor, false);
    }

    Object.keys(otherPlayers).forEach((id) => {
      const p = otherPlayers[id];
      if (p.isDead) return;
      if (p.trail) drawNeonTrail(p.trail, p.color, true);
      drawCursor(p.x * canvas.width, p.y * canvas.height, p.color, p.speed, p.idleTime, p.angle, p.username, p.hp);
    });

    if (!isDead) {
      drawCursor(mouseX, mouseY, myColor, speed, idleTime, angle, myUsername, myHp);
    }

    drawBullets();
    updateAndDrawParticles();
    updateAndDrawDamageTexts();
  }

  if (damageFlashAlpha > 0) {
    ctx.fillStyle = `rgba(255, 0, 85, ${damageFlashAlpha})`;
    ctx.fillRect(-20, -20, canvas.width + 40, canvas.height + 40);
    damageFlashAlpha = Math.max(0, damageFlashAlpha - 0.035);
  }

  ctx.restore();

  requestAnimationFrame(gameLoop);
}

gameLoop();