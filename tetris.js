"use strict";

// =============================================
//  俄罗斯方块 — 核心常量与配置
// =============================================

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;
const NEXT_SIZE = 4;
const HOLD_SIZE = 4;
const PREVIEW_BLOCK = 22;

const COLORS = [
  null,
  "#00cfcf", // I — 青色
  "#0040ff", // J — 蓝色
  "#ff8800", // L — 橙色
  "#ffdd00", // O — 黄色
  "#00cc44", // S — 绿色
  "#cc00aa", // T — 紫色
  "#ff2222", // Z — 红色
];

const SHAPES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,0,0],[2,2,2],[0,0,0]],                   // J
  [[0,0,3],[3,3,3],[0,0,0]],                   // L
  [[4,4],[4,4]],                                 // O
  [[0,5,5],[5,5,0],[0,0,0]],                   // S
  [[0,6,0],[6,6,6],[0,0,0]],                   // T
  [[7,7,0],[0,7,7],[0,0,0]],                   // Z
];

const PIECE_NAMES = [null, "I", "J", "L", "O", "S", "T", "Z"];

const SCORE_TABLE = { 1: 100, 2: 300, 3: 500, 4: 800 };

const LEVEL_SPEED = [
  800, 720, 640, 560, 480, 400, 330, 270, 210, 160,
  120, 100, 80, 70, 60, 55, 50, 45, 40, 35,
];

const WALL_KICK_DATA = {
  "normal": [
    [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    [[0,0],[1,0],[1,-1],[0,2],[1,2]],
    [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
    [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  ],
  "I": [
    [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
    [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
    [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
    [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
  ],
};

// =============================================
//  DOM 元素获取
// =============================================

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const nextCanvas = document.getElementById("nextCanvas");
const nextCtx = nextCanvas.getContext("2d");
const holdCanvas = document.getElementById("holdCanvas");
const holdCtx = holdCanvas.getContext("2d");

canvas.width = COLS * BLOCK;
canvas.height = ROWS * BLOCK;
nextCanvas.width = NEXT_SIZE * PREVIEW_BLOCK;
nextCanvas.height = NEXT_SIZE * PREVIEW_BLOCK;
holdCanvas.width = HOLD_SIZE * PREVIEW_BLOCK;
holdCanvas.height = HOLD_SIZE * PREVIEW_BLOCK;

const scoreDisplay = document.getElementById("scoreDisplay");
const highScoreDisplay = document.getElementById("highScoreDisplay");
const levelDisplay = document.getElementById("levelDisplay");
const linesDisplay = document.getElementById("linesDisplay");
const btnStart = document.getElementById("btnStart");
const btnPause = document.getElementById("btnPause");
const btnRestart = document.getElementById("btnRestart");
const touchOverlay = document.getElementById("touchOverlay");

// =============================================
//  游戏状态（状态机）
//  STATE: "IDLE" | "RUNNING" | "PAUSED" | "OVER"
// =============================================

let gameState = "IDLE";   // 初始状态：未开始

let board = [];
let currentPiece = null;
let nextPiece = null;
let holdPiece = null;
let holdUsed = false;
let score = 0;
let highScore = parseInt(localStorage.getItem("tetrisHighScore") || "0");
let level = 1;
let lines = 0;
let lockTimer = null;
let lockDelay = 500;
let lockMoveCount = 0;
let lastMoveWasSpin = false;
let combo = 0;
let animationFrameId = null;
let lastTime = 0;
let dropAccumulator = 0;
let softDropActive = false;
let particles = [];
let flashLines = [];
let flashTimer = 0;
let shakeTimer = 0;
let backToBack = false;
let bag = [];
let nextQueue = [];

// 兼容旧逻辑的便利变量（由状态机驱动）
function isGameRunning() { return gameState === "RUNNING"; }
function isGamePaused()  { return gameState === "PAUSED"; }
function isGameOver()    { return gameState === "OVER"; }
function isGameIdle()    { return gameState === "IDLE"; }

// =============================================
//  棋盘与方块生成
// =============================================

function createBoard() {
  board = [];
  for (let r = 0; r < ROWS; r++) {
    board.push(new Array(COLS).fill(0));
  }
}

function refillBag() {
  bag = [1, 2, 3, 4, 5, 6, 7];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
}

function nextFromBag() {
  if (bag.length === 0) refillBag();
  return bag.pop();
}

function ensureQueue() {
  while (nextQueue.length < 5) {
    nextQueue.push(nextFromBag());
  }
}

function createPiece(type) {
  return {
    type,
    shape: SHAPES[type].map(row => [...row]),
    x: Math.floor(COLS / 2) - Math.floor(SHAPES[type][0].length / 2),
    y: 0,
    rotation: 0,
  };
}

function spawnPiece() {
  ensureQueue();
  const type = nextQueue.shift();
  ensureQueue();
  currentPiece = createPiece(type);
  holdUsed = false;
  lastMoveWasSpin = false;
  lockMoveCount = 0;
  if (collides(currentPiece, 0, 0)) {
    triggerGameOver();
  }
}

// =============================================
//  旋转与碰撞检测
// =============================================

function rotatePiece(piece, dir) {
  const N = piece.shape.length;
  const rotated = piece.shape.map((row, i) =>
    row.map((_, j) => piece.shape[dir > 0 ? N - 1 - j : j][dir > 0 ? i : N - 1 - i])
  );
  return rotated;
}

function collides(piece, dx, dy, shape) {
  const s = shape || piece.shape;
  for (let r = 0; r < s.length; r++) {
    for (let c = 0; c < s[r].length; c++) {
      if (!s[r][c]) continue;
      const nx = piece.x + c + dx;
      const ny = piece.y + r + dy;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny < 0) continue;
      if (board[ny][nx]) return true;
    }
  }
  return false;
}

function tryRotate(dir) {
  if (!currentPiece || !isGameRunning()) return false;
  const newShape = rotatePiece(currentPiece, dir);
  const newRotation = (currentPiece.rotation + dir + 4) % 4;
  const kickType = currentPiece.type === 1 ? "I" : "normal";
  const kicks = WALL_KICK_DATA[kickType][currentPiece.rotation];

  for (const [kx, ky] of kicks) {
    if (!collides(currentPiece, kx, -ky, newShape)) {
      currentPiece.shape = newShape;
      currentPiece.x += kx;
      currentPiece.y -= ky;
      currentPiece.rotation = newRotation;
      lastMoveWasSpin = true;
      onPieceMoved();
      return true;
    }
  }
  return false;
}

function tryMove(dx, dy) {
  if (!currentPiece || !isGameRunning()) return false;
  if (!collides(currentPiece, dx, dy)) {
    currentPiece.x += dx;
    currentPiece.y += dy;
    if (dx !== 0) {
      lastMoveWasSpin = false;
      onPieceMoved();
    }
    return true;
  }
  return false;
}

function onPieceMoved() {
  lockMoveCount++;
  if (lockMoveCount > 15) return;
  if (isOnGround()) {
    resetLockTimer();
  }
}

function isOnGround() {
  return collides(currentPiece, 0, 1);
}

function resetLockTimer() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => {
    if (currentPiece && isOnGround()) lockPiece();
  }, lockDelay);
}

// =============================================
//  硬降与锁定
// =============================================

function hardDrop() {
  if (!currentPiece || !isGameRunning()) return;
  let dropped = 0;
  while (!collides(currentPiece, 0, 1)) {
    currentPiece.y++;
    dropped++;
  }
  score += dropped * 2;
  updateScoreDisplay();
  lockPiece();
}

function lockPiece() {
  clearTimeout(lockTimer);
  lockTimer = null;
  if (!currentPiece) return;

  for (let r = 0; r < currentPiece.shape.length; r++) {
    for (let c = 0; c < currentPiece.shape[r].length; c++) {
      if (!currentPiece.shape[r][c]) continue;
      const ny = currentPiece.y + r;
      const nx = currentPiece.x + c;
      if (ny < 0) {
        triggerGameOver();
        return;
      }
      board[ny][nx] = currentPiece.type;
    }
  }

  const cleared = clearLines();
  addClearScore(cleared);
  spawnPiece();
}

// =============================================
//  消行与计分
// =============================================

function clearLines() {
  let cleared = 0;
  flashLines = [];
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(cell => cell !== 0)) {
      flashLines.push(r);
      cleared++;
    }
  }
  if (cleared > 0) {
    flashTimer = 8;
    shakeTimer = 12;
    spawnClearParticles(flashLines);
    setTimeout(() => {
      const rows = [...flashLines].sort((a, b) => b - a);
      for (const r of rows) {
        board.splice(r, 1);
        board.unshift(new Array(COLS).fill(0));
      }
      flashLines = [];
    }, 120);
  } else {
    combo = 0;
  }
  return cleared;
}

function addClearScore(cleared) {
  if (cleared === 0) {
    combo = 0;
    return;
  }
  const isTetris = cleared === 4;
  const isTSpin = lastMoveWasSpin && currentPiece && currentPiece.type === 6;
  let base = SCORE_TABLE[cleared] || 0;

  if (isTetris || isTSpin) {
    if (backToBack) {
      base = Math.floor(base * 1.5);
    }
    backToBack = true;
  } else {
    backToBack = false;
  }

  combo++;
  const comboBonus = combo > 1 ? (combo - 1) * 50 * level : 0;
  const totalScore = (base * level) + comboBonus;
  score += totalScore;
  lines += cleared;
  level = Math.min(20, Math.floor(lines / 10) + 1);
  updateScoreDisplay();

  if (score > highScore) {
    highScore = score;
    localStorage.setItem("tetrisHighScore", String(highScore));
    highScoreDisplay.textContent = highScore;
  }
}

// =============================================
//  储存（Hold）
// =============================================

function holdCurrentPiece() {
  if (!currentPiece || holdUsed || !isGameRunning()) return;
  holdUsed = true;
  const savedType = currentPiece.type;
  if (holdPiece === null) {
    holdPiece = savedType;
    spawnPiece();
  } else {
    const prevHold = holdPiece;
    holdPiece = savedType;
    currentPiece = createPiece(prevHold);
    holdUsed = true;
  }
  drawHold();
}

// =============================================
//  幽灵块（Ghost）
// =============================================

function getGhostY() {
  let gy = currentPiece.y;
  while (!collides(currentPiece, 0, gy - currentPiece.y + 1)) {
    gy++;
  }
  return gy;
}

// =============================================
//  粒子系统
// =============================================

function spawnClearParticles(rows) {
  for (const r of rows) {
    for (let c = 0; c < COLS; c++) {
      const color = COLORS[board[r][c]] || "#ffffff";
      for (let i = 0; i < 4; i++) {
        particles.push({
          x: (c + 0.5) * BLOCK,
          y: (r + 0.5) * BLOCK,
          vx: (Math.random() - 0.5) * 8,
          vy: (Math.random() - 1.5) * 6,
          alpha: 1,
          size: Math.random() * 6 + 3,
          color,
          life: 1,
        });
      }
    }
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.4;
    p.life -= 0.035;
    p.alpha = p.life;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// =============================================
//  绘图工具函数
// =============================================

function lightenColor(hex, amount) {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `rgb(${r},${g},${b})`;
}

function darkenColor(hex, amount) {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `rgb(${r},${g},${b})`;
}

function drawBlock(context, x, y, type, size, alpha) {
  if (!type) return;
  const color = COLORS[type];
  const s = size || BLOCK;
  const a = alpha !== undefined ? alpha : 1;

  context.save();
  context.globalAlpha = a;

  const gradient = context.createLinearGradient(x, y, x + s, y + s);
  gradient.addColorStop(0, lightenColor(color, 40));
  gradient.addColorStop(1, darkenColor(color, 20));
  context.fillStyle = gradient;
  context.fillRect(x + 1, y + 1, s - 2, s - 2);

  // 高光边
  context.strokeStyle = lightenColor(color, 60);
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x + 1, y + s - 1);
  context.lineTo(x + 1, y + 1);
  context.lineTo(x + s - 1, y + 1);
  context.stroke();

  // 暗边
  context.strokeStyle = darkenColor(color, 40);
  context.beginPath();
  context.moveTo(x + s - 1, y + 1);
  context.lineTo(x + s - 1, y + s - 1);
  context.lineTo(x + 1, y + s - 1);
  context.stroke();

  context.restore();
}

// =============================================
//  背景星星
// =============================================

let bgStars = [];

function initStars() {
  bgStars = [];
  for (let i = 0; i < 40; i++) {
    bgStars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.5 + 0.5,
      alpha: Math.random() * 0.4 + 0.1,
      speed: Math.random() * 0.3 + 0.1,
    });
  }
}

function updateStars() {
  for (const s of bgStars) {
    s.y += s.speed;
    if (s.y > canvas.height) {
      s.y = 0;
      s.x = Math.random() * canvas.width;
    }
  }
}

function drawStars() {
  for (const s of bgStars) {
    ctx.save();
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// =============================================
//  核心绘图
// =============================================

function drawGridLines() {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 0.5;
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, canvas.height);
    ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(canvas.width, r * BLOCK);
    ctx.stroke();
  }
  ctx.restore();
}

function getCompletionPercent() {
  let filled = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) filled++;
    }
  }
  return filled / (ROWS * COLS);
}

function drawDangerOverlay() {
  const pct = getCompletionPercent();
  if (pct > 0.5) {
    const alpha = (pct - 0.5) * 0.3;
    ctx.save();
    ctx.globalAlpha = alpha;
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "#ff0000");
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height * 0.3);
    ctx.restore();
  }
}

function drawStatsBadge() {
  if (!isGameRunning()) return;
  if (combo > 1) {
    ctx.save();
    ctx.font = `bold ${BLOCK * 0.75}px "Noto Sans SC", sans-serif`;
    ctx.fillStyle = `rgba(255,220,0,${Math.min(1, combo * 0.2)})`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(`${combo}x COMBO`, canvas.width - 4, 4);
    ctx.restore();
  }
  if (backToBack) {
    ctx.save();
    ctx.font = `bold ${BLOCK * 0.6}px "Noto Sans SC", sans-serif`;
    ctx.fillStyle = "rgba(100,200,255,0.9)";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("BACK TO BACK", canvas.width - 4, BLOCK);
    ctx.restore();
  }
}

function drawBoard() {
  // 背景
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 星星
  updateStars();
  drawStars();

  // 网格线
  drawGridLines();

  // 已放置的方块
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) {
        const isFlash = flashLines.includes(r);
        if (isFlash && flashTimer % 2 === 0) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(c * BLOCK, r * BLOCK, BLOCK, BLOCK);
        } else {
          drawBlock(ctx, c * BLOCK, r * BLOCK, board[r][c], BLOCK);
        }
      }
    }
  }

  // 危险提示
  drawDangerOverlay();

  // 统计徽标（combo/back-to-back）
  drawStatsBadge();
}

function drawGhost() {
  if (!currentPiece) return;
  const gy = getGhostY();
  for (let r = 0; r < currentPiece.shape.length; r++) {
    for (let c = 0; c < currentPiece.shape[r].length; c++) {
      if (!currentPiece.shape[r][c]) continue;
      const px = (currentPiece.x + c) * BLOCK;
      const py = (gy + r) * BLOCK;
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = COLORS[currentPiece.type];
      ctx.fillRect(px + 1, py + 1, BLOCK - 2, BLOCK - 2);
      ctx.restore();
    }
  }
}

function drawCurrentPiece() {
  if (!currentPiece) return;
  for (let r = 0; r < currentPiece.shape.length; r++) {
    for (let c = 0; c < currentPiece.shape[r].length; c++) {
      if (!currentPiece.shape[r][c]) continue;
      const px = (currentPiece.x + c) * BLOCK;
      const py = (currentPiece.y + r) * BLOCK;
      if (py < 0) continue;
      drawBlock(ctx, px, py, currentPiece.type, BLOCK);
    }
  }
}

function drawNext() {
  nextCtx.fillStyle = "#1a1a2e";
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (nextQueue.length === 0) return;
  const type = nextQueue[0];
  const shape = SHAPES[type];
  const rows = shape.length;
  const cols = shape[0].length;
  const offsetX = Math.floor((NEXT_SIZE - cols) / 2);
  const offsetY = Math.floor((NEXT_SIZE - rows) / 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!shape[r][c]) continue;
      drawBlock(nextCtx, (offsetX + c) * PREVIEW_BLOCK, (offsetY + r) * PREVIEW_BLOCK, type, PREVIEW_BLOCK);
    }
  }
}

function drawHold() {
  holdCtx.fillStyle = "#1a1a2e";
  holdCtx.fillRect(0, 0, holdCanvas.width, holdCanvas.height);
  if (holdPiece === null) return;
  const shape = SHAPES[holdPiece];
  const rows = shape.length;
  const cols = shape[0].length;
  const offsetX = Math.floor((HOLD_SIZE - cols) / 2);
  const offsetY = Math.floor((HOLD_SIZE - rows) / 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!shape[r][c]) continue;
      drawBlock(holdCtx, (offsetX + c) * PREVIEW_BLOCK, (offsetY + r) * PREVIEW_BLOCK, holdPiece, PREVIEW_BLOCK, holdUsed ? 0.4 : 1);
    }
  }
}

// =============================================
//  屏幕覆盖层（Game Over / 暂停 / 开始）
// =============================================

function drawGameOver() {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ff2222";
  ctx.font = `bold ${BLOCK * 1.2}px "Noto Sans SC", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2 - BLOCK);
  ctx.fillStyle = "#ffffff";
  ctx.font = `${BLOCK * 0.7}px "Noto Sans SC", sans-serif`;
  ctx.fillText(`得分: ${score}`, canvas.width / 2, canvas.height / 2 + BLOCK * 0.3);
  ctx.fillText("按「重新开始」重玩", canvas.width / 2, canvas.height / 2 + BLOCK * 1.3);
  ctx.restore();
}

function drawPauseScreen() {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${BLOCK * 1.1}px "Noto Sans SC", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("已暂停", canvas.width / 2, canvas.height / 2 - BLOCK * 0.3);
  ctx.font = `${BLOCK * 0.55}px "Noto Sans SC", sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText("点击「继续」或按 P 键继续游戏", canvas.width / 2, canvas.height / 2 + BLOCK * 0.6);
  ctx.restore();
}

function drawStartScreen() {
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 星星背景
  updateStars();
  drawStars();

  ctx.fillStyle = "#770e1c";
  ctx.font = `bold ${BLOCK * 1.5}px "Noto Sans SC", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("TETRIS", canvas.width / 2, canvas.height / 2 - BLOCK * 2);

  ctx.fillStyle = "#ffffff";
  ctx.font = `${BLOCK * 0.65}px "Noto Sans SC", sans-serif`;
  ctx.fillText("点击「开始游戏」", canvas.width / 2, canvas.height / 2 - BLOCK * 0.2);
  ctx.fillText("或按任意方向键开始", canvas.width / 2, canvas.height / 2 + BLOCK * 0.7);

  // 装饰方块
  ctx.globalAlpha = 0.15;
  for (let i = 1; i <= 7; i++) {
    const x = (i - 1) * BLOCK * 1.4 + BLOCK * 0.3;
    const y = canvas.height / 2 + BLOCK * 2.5;
    drawBlock(ctx, x, y, i, BLOCK * 1.2);
  }
  ctx.globalAlpha = 1;
}

// =============================================
//  主渲染循环
// =============================================

function render(timestamp) {
  // 暂停状态
  if (isGamePaused()) {
    drawBoard();
    if (currentPiece) {
      drawGhost();
      drawCurrentPiece();
    }
    drawPauseScreen();
    animationFrameId = requestAnimationFrame(render);
    return;
  }

  // 非运行状态（IDLE 或 OVER）
  if (!isGameRunning()) {
    if (isGameOver()) {
      drawBoard();
      drawGameOver();
    } else {
      drawStartScreen();
    }
    animationFrameId = requestAnimationFrame(render);
    return;
  }

  // 正常运行
  const delta = timestamp - lastTime;
  lastTime = timestamp;

  // 防止第一帧的巨大 delta（修复：初始化问题）
  if (delta > 1000) {
    animationFrameId = requestAnimationFrame(render);
    return;
  }

  const speed = softDropActive
    ? Math.max(30, LEVEL_SPEED[level - 1] / 8)
    : LEVEL_SPEED[level - 1];

  dropAccumulator += delta;
  if (dropAccumulator >= speed) {
    dropAccumulator = 0;
    if (!tryMove(0, 1)) {
      if (!lockTimer) {
        resetLockTimer();
      }
    } else {
      clearTimeout(lockTimer);
      lockTimer = null;
    }
  }

  if (flashTimer > 0) flashTimer--;
  if (shakeTimer > 0) shakeTimer--;

  updateParticles();

  // 屏幕抖动
  if (shakeTimer > 0) {
    const sx = (Math.random() - 0.5) * 4;
    const sy = (Math.random() - 0.5) * 4;
    ctx.save();
    ctx.translate(sx, sy);
  }

  drawBoard();
  if (currentPiece) {
    drawGhost();
    drawCurrentPiece();
  }
  drawParticles();

  if (shakeTimer > 0) {
    ctx.restore();
  }

  drawNext();

  animationFrameId = requestAnimationFrame(render);
}

// =============================================
//  分数显示更新
// =============================================

function updateScoreDisplay() {
  scoreDisplay.textContent = score;
  levelDisplay.textContent = level;
  linesDisplay.textContent = lines;
  if (score > highScore) {
    highScore = score;
    localStorage.setItem("tetrisHighScore", String(highScore));
  }
  highScoreDisplay.textContent = highScore;
  // 更新等级进度条
  if (levelBar) levelBar.update();
}

// =============================================
//  游戏状态控制（状态机核心）
// =============================================

/**
 * 更新按钮状态，确保按钮文本和可用性与当前游戏状态一致
 */
function updateButtonState() {
  switch (gameState) {
    case "IDLE":
      btnStart.textContent = "开始游戏";
      btnStart.style.display = "";
      btnPause.textContent = "暂停";
      btnPause.classList.remove("game-btn-resume");
      btnPause.classList.add("game-btn-pause");
      btnRestart.style.display = "none";
      break;
    case "RUNNING":
      btnStart.style.display = "none";
      btnPause.textContent = "暂停";
      btnPause.classList.remove("game-btn-resume");
      btnPause.classList.add("game-btn-pause");
      btnRestart.style.display = "";
      break;
    case "PAUSED":
      btnStart.style.display = "none";
      btnPause.textContent = "▶ 继续";
      btnPause.classList.remove("game-btn-pause");
      btnPause.classList.add("game-btn-resume");
      btnRestart.style.display = "";
      break;
    case "OVER":
      btnStart.textContent = "重新开始";
      btnStart.style.display = "";
      btnPause.textContent = "暂停";
      btnPause.classList.remove("game-btn-resume");
      btnPause.classList.add("game-btn-pause");
      btnRestart.style.display = "none";
      break;
  }
}

/**
 * 开始新游戏（重新初始化所有状态）
 */
function startGame() {
  // 清理旧的定时器和动画帧
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  clearTimeout(lockTimer);
  lockTimer = null;

  // 初始化棋盘
  createBoard();
  bag = [];
  nextQueue = [];
  refillBag();
  ensureQueue();

  // 重置所有游戏状态
  score = 0;
  level = 1;
  lines = 0;
  combo = 0;
  holdPiece = null;
  holdUsed = false;
  particles = [];
  flashLines = [];
  flashTimer = 0;
  shakeTimer = 0;
  backToBack = false;
  softDropActive = false;
  dropAccumulator = 0;
  lastTime = performance.now(); // 修复：使用当前时间，避免第一帧巨大 delta

  // 设置游戏状态为运行中
  gameState = "RUNNING";

  updateScoreDisplay();
  highScoreDisplay.textContent = highScore;
  updateButtonState();

  spawnPiece();
  drawNext();
  drawHold();

  animationFrameId = requestAnimationFrame(render);
}

/**
 * 暂停/继续切换
 * 只在 RUNNING 和 PAUSED 之间切换
 */
function togglePause() {
  if (gameState === "RUNNING") {
    // 运行中 -> 暂停
    gameState = "PAUSED";
    clearTimeout(lockTimer);
    lockTimer = null;
    softDropActive = false;
    updateButtonState();
  } else if (gameState === "PAUSED") {
    // 暂停 -> 继续运行
    gameState = "RUNNING";
    dropAccumulator = 0;
    lastTime = performance.now(); // 重置时间基准，避免跳帧
    updateButtonState();
  }
  // 其他状态（IDLE / OVER）不响应暂停操作
}

/**
 * 重新开始（在任何非 IDLE 状态下可用）
 * 核心逻辑：无论当前是暂停还是运行中，都完全重置并开始新游戏
 */
function restartGame() {
  startGame(); // startGame 已经处理了所有状态重置
}

/**
 * 触发 Game Over
 */
function triggerGameOver() {
  gameState = "OVER";
  clearTimeout(lockTimer);
  lockTimer = null;
  softDropActive = false;
  if (score > highScore) {
    highScore = score;
    localStorage.setItem("tetrisHighScore", String(highScore));
    highScoreDisplay.textContent = highScore;
  }
  currentPiece = null;
  updateButtonState();
}

// =============================================
//  键盘输入（仅处理非移动键，移动键由 DAS 处理）
// =============================================

document.addEventListener("keydown", (e) => {
  // 在 IDLE 状态下，按方向键或空格开始游戏
  if (isGameIdle()) {
    if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," "].includes(e.key)) {
      e.preventDefault();
      startGame();
      return;
    }
  }

  // Game Over 状态下不响应游戏按键
  if (isGameOver()) return;

  switch (e.key) {
    // 注意：ArrowLeft、ArrowRight、ArrowDown 由 DAS 输入系统处理
    // 这里只处理非移动键
    case "ArrowUp":
      e.preventDefault();
      tryRotate(1);
      break;
    case " ":
      e.preventDefault();
      hardDrop();
      break;
    case "z":
    case "Z":
      tryRotate(-1);
      break;
    case "x":
    case "X":
      tryRotate(1);
      break;
    case "c":
    case "C":
      holdCurrentPiece();
      drawHold();
      break;
    case "p":
    case "P":
      togglePause();
      break;
    case "Escape":
      togglePause();
      break;
    default:
      break;
  }
});

// =============================================
//  DAS 输入系统（处理左右移动和软降，带延迟自动重复）
// =============================================

function buildInputHandler() {
  const keys = new Set();
  const held = new Map();
  const DAS_DELAY = 150;   // 首次重复延迟
  const DAS_INTERVAL = 50; // 持续重复间隔

  const onDown = (key) => {
    if (keys.has(key)) return;
    keys.add(key);
    handleKey(key);
    held.set(key, {
      timer: setTimeout(() => {
        const h = held.get(key);
        if (h) {
          h.interval = setInterval(() => {
            if (keys.has(key)) handleKey(key);
          }, DAS_INTERVAL);
        }
      }, DAS_DELAY),
      interval: null,
    });
  };

  const onUp = (key) => {
    keys.delete(key);
    const h = held.get(key);
    if (h) {
      clearTimeout(h.timer);
      clearInterval(h.interval);
      held.delete(key);
    }
    if (key === "ArrowDown") softDropActive = false;
  };

  const handleKey = (key) => {
    if (!isGameRunning()) return;
    if (key === "ArrowLeft") tryMove(-1, 0);
    if (key === "ArrowRight") tryMove(1, 0);
    if (key === "ArrowDown") {
      softDropActive = true;
      if (tryMove(0, 1)) { score++; updateScoreDisplay(); }
    }
  };

  document.addEventListener("keydown", (e) => {
    if (["ArrowLeft","ArrowRight","ArrowDown"].includes(e.key)) {
      e.preventDefault();
      onDown(e.key);
    }
  });

  document.addEventListener("keyup", (e) => {
    onUp(e.key);
  });
}

buildInputHandler();

// =============================================
//  触摸输入（手机端）
// =============================================

let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let lastTapTime = 0;
let touchMoved = false;
const SWIPE_THRESHOLD = 25;
const TAP_TIMEOUT = 200;

touchOverlay.addEventListener("touchstart", (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
  touchStartTime = Date.now();
  touchMoved = false;
}, { passive: false });

touchOverlay.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (!isGameRunning() || !currentPiece) return;
  const touch = e.touches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;

  if (Math.abs(dx) > SWIPE_THRESHOLD) {
    touchMoved = true;
    if (dx > 0) tryMove(1, 0);
    else tryMove(-1, 0);
    touchStartX = touch.clientX;
  }
  if (dy > SWIPE_THRESHOLD) {
    touchMoved = true;
    softDropActive = true;
    if (tryMove(0, 1)) {
      score += 1;
      updateScoreDisplay();
    }
    touchStartY = touch.clientY;
  }
}, { passive: false });

touchOverlay.addEventListener("touchend", (e) => {
  e.preventDefault();
  softDropActive = false;
  const elapsed = Date.now() - touchStartTime;
  if (!touchMoved && elapsed < TAP_TIMEOUT) {
    const touch = e.changedTouches[0];
    const rect = canvas.getBoundingClientRect();
    const rx = touch.clientX - rect.left;
    const ry = touch.clientY - rect.top;
    const now = Date.now();

    if (now - lastTapTime < 300) {
      hardDrop();
      lastTapTime = 0;
      return;
    }
    lastTapTime = now;

    if (ry < canvas.height * 0.5) {
      tryRotate(1);
    } else if (rx < canvas.width * 0.5) {
      tryMove(-1, 0);
    } else {
      tryMove(1, 0);
    }
  }
  touchMoved = false;
}, { passive: false });

// =============================================
//  按钮事件
// =============================================

btnStart.addEventListener("click", (e) => {
  e.preventDefault();
  startGame();
});

btnPause.addEventListener("click", (e) => {
  e.preventDefault();
  togglePause();
});

btnRestart.addEventListener("click", (e) => {
  e.preventDefault();
  restartGame();
});

// =============================================
//  等级进度条
// =============================================

let levelBar = null;

function buildLevelProgressBar() {
  const barEl = document.createElement("div");
  barEl.className = "game-level-bar-wrap";
  const fillEl = document.createElement("div");
  fillEl.className = "game-level-bar-fill";
  barEl.appendChild(fillEl);

  const levelBox = document.getElementById("levelDisplay").parentElement;
  levelBox.appendChild(barEl);

  const update = () => {
    const linesInLevel = lines % 10;
    const pct = (linesInLevel / 10) * 100;
    fillEl.style.width = `${pct}%`;
  };

  return { update };
}

levelBar = buildLevelProgressBar();

// =============================================
//  Combo 显示
// =============================================

function buildComboDisplay() {
  const el = document.createElement("div");
  el.className = "game-combo-display";
  el.id = "comboDisplay";
  canvas.parentElement.appendChild(el);

  const show = (text, color) => {
    el.textContent = text;
    el.style.color = color || "#ffdd00";
    el.style.opacity = "1";
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
      el.style.opacity = "0";
    }, 1200);
  };

  return { show };
}

const comboDisplay = buildComboDisplay();

// 包装 addClearScore 以显示 combo
const _origAddClearScore = addClearScore;
addClearScore = function(cleared) {
  _origAddClearScore(cleared);
  if (cleared > 0) {
    if (cleared === 4) comboDisplay.show("TETRIS!", "#00cfcf");
    else if (combo > 2) comboDisplay.show(`${combo}x COMBO`, "#ffdd00");
    else if (backToBack) comboDisplay.show("BACK TO BACK", "#88aaff");
  }
};

// =============================================
//  页面可见性：自动暂停
// =============================================

document.addEventListener("visibilitychange", () => {
  if (document.hidden && isGameRunning()) {
    togglePause();
  }
});

window.addEventListener("blur", () => {
  if (isGameRunning()) {
    togglePause();
  }
});

// =============================================
//  动态注入 CSS
// =============================================

const styleEl = document.createElement("style");
styleEl.textContent = `
  .game-level-bar-wrap {
    width: 100%;
    height: 5px;
    background: #e0e0e0;
    border-radius: 3px;
    margin-top: 6px;
    overflow: hidden;
  }
  .game-level-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #770e1c, #cc2244);
    border-radius: 3px;
    width: 0%;
    transition: width 0.3s ease;
  }
  .game-combo-display {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    font-family: "Noto Sans SC", sans-serif;
    font-size: 1.2rem;
    font-weight: 800;
    color: #ffdd00;
    text-shadow: 0 0 10px rgba(255,200,0,0.8), 0 2px 4px rgba(0,0,0,0.5);
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.4s;
    white-space: nowrap;
    z-index: 10;
  }
`;
document.head.appendChild(styleEl);

// =============================================
//  初始化
// =============================================

highScoreDisplay.textContent = highScore;
initStars();
updateButtonState();
drawStartScreen();
drawNext();
drawHold();
animationFrameId = requestAnimationFrame(render);
