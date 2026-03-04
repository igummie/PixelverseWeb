const screens = {
  main: document.getElementById("mainScreen"),
  login: document.getElementById("loginScreen"),
  world: document.getElementById("worldScreen"),
  game: document.getElementById("gameScreen"),
};

const playBtn = document.getElementById("playBtn");
const backToMainBtn = document.getElementById("backToMainBtn");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const guestBtn = document.getElementById("guestBtn");
const usernameInput = document.getElementById("usernameInput");
const passwordInput = document.getElementById("passwordInput");
const loginError = document.getElementById("loginError");

const welcomeText = document.getElementById("welcomeText");
const worldListEl = document.getElementById("worldList");
const worldInput = document.getElementById("worldInput");
const joinWorldBtn = document.getElementById("joinWorldBtn");
const refreshWorldsBtn = document.getElementById("refreshWorldsBtn");
const logoutBtn = document.getElementById("logoutBtn");
const worldError = document.getElementById("worldError");

const leaveWorldBtn = document.getElementById("leaveWorldBtn");
const gameStatus = document.getElementById("gameStatus");
const blockSelect = document.getElementById("blockSelect");
const blockTypeInfo = document.getElementById("blockTypeInfo");
const gameTopbar = document.querySelector(".gameTopbar");

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const TILE_SIZE = 32;
const HORIZONTAL_SPEED = 7.5;
const GRAVITY = 28;
const JUMP_SPEED = 11;
const MAX_FALL_SPEED = 24;
const EPSILON = 0.0001;

const state = {
  token: null,
  user: null,
  ws: null,
  connected: false,
  selfId: null,
  world: null,
  players: new Map(),
  me: { x: 8, y: 8 },
  camera: { x: 0, y: 0 },
  keys: new Set(),
  mouse: { x: 0, y: 0 },
  lastMoveSentAt: 0,
  blockDefs: new Map(),
  atlases: new Map(),
  selectedBlockId: 1,
  velocity: { x: 0, y: 0 },
  collider: { width: 0.72, height: 0.92 },
  onGround: false,
  jumpQueued: false,
  worldRender: null,
};

function drawTileToContext(targetContext, tileId, drawX, drawY) {
  const block = state.blockDefs.get(tileId);
  if (!block) {
    return;
  }

  const atlas = state.atlases.get(block.ATLAS_ID);
  if (!atlas || !atlas.image) {
    return;
  }

  const tex = block.ATLAS_TEXTURE;
  targetContext.drawImage(
    atlas.image,
    tex.x,
    tex.y,
    tex.w,
    tex.h,
    drawX,
    drawY,
    TILE_SIZE,
    TILE_SIZE,
  );
}

function rebuildWorldRenderCache() {
  if (!state.world) {
    state.worldRender = null;
    return;
  }

  const renderCanvas = document.createElement("canvas");
  renderCanvas.width = state.world.width * TILE_SIZE;
  renderCanvas.height = state.world.height * TILE_SIZE;
  const renderContext = renderCanvas.getContext("2d");
  renderContext.imageSmoothingEnabled = false;

  state.worldRender = {
    canvas: renderCanvas,
    context: renderContext,
  };

  for (let y = 0; y < state.world.height; y += 1) {
    for (let x = 0; x < state.world.width; x += 1) {
      updateWorldRenderTile(x, y);
    }
  }
}

function updateWorldRenderTile(tileX, tileY) {
  if (!state.worldRender || !state.world) {
    return;
  }

  if (tileX < 0 || tileY < 0 || tileX >= state.world.width || tileY >= state.world.height) {
    return;
  }

  const index = tileY * state.world.width + tileX;
  const foregroundTile = Number(state.world.foreground?.[index] || 0);
  const backgroundTile = Number(state.world.background?.[index] || 0);
  const drawX = tileX * TILE_SIZE;
  const drawY = tileY * TILE_SIZE;

  state.worldRender.context.clearRect(drawX, drawY, TILE_SIZE, TILE_SIZE);
  if (backgroundTile !== 0) {
    drawTileToContext(state.worldRender.context, backgroundTile, drawX, drawY);
  }
  if (foregroundTile !== 0) {
    drawTileToContext(state.worldRender.context, foregroundTile, drawX, drawY);
  }
}

function getForegroundTileId(world, tileX, tileY) {
  if (tileX < 0 || tileY < 0 || tileX >= world.width || tileY >= world.height) {
    return 0;
  }

  const index = tileY * world.width + tileX;

  if (Array.isArray(world.foreground)) {
    return Number(world.foreground[index] || 0);
  }

  if (Array.isArray(world.tiles)) {
    return Number(world.tiles[index] || 0);
  }

  return 0;
}

function getBackgroundTileId(world, tileX, tileY) {
  if (tileX < 0 || tileY < 0 || tileX >= world.width || tileY >= world.height) {
    return 0;
  }

  const index = tileY * world.width + tileX;
  if (Array.isArray(world.background)) {
    return Number(world.background[index] || 0);
  }

  return 0;
}

function getCollisionKind(tileId) {
  if (!tileId) {
    return null;
  }

  const block = state.blockDefs.get(tileId);
  const blockType = String(block?.BLOCK_TYPE || "SOLID").toUpperCase();

  if (blockType === "BACKGROUND") {
    return null;
  }

  if (blockType === "PLATFORM") {
    return "platform";
  }

  return "solid";
}

function getCollisionKindAt(world, tileX, tileY) {
  const foregroundKind = getCollisionKind(getForegroundTileId(world, tileX, tileY));
  if (foregroundKind) {
    return foregroundKind;
  }

  return getCollisionKind(getBackgroundTileId(world, tileX, tileY));
}

function resolveHorizontal(world, oldX, oldY, proposedX) {
  const width = state.collider.width;
  const height = state.collider.height;
  let x = proposedX;

  const top = oldY;
  const bottom = oldY + height - EPSILON;
  const startY = Math.floor(top);
  const endY = Math.floor(bottom);

  if (proposedX > oldX) {
    const right = proposedX + width - EPSILON;
    const tileX = Math.floor(right);
    for (let tileY = startY; tileY <= endY; tileY += 1) {
      if (getCollisionKindAt(world, tileX, tileY) === "solid") {
        x = Math.min(x, tileX - width);
      }
    }
  } else if (proposedX < oldX) {
    const left = proposedX;
    const tileX = Math.floor(left);
    for (let tileY = startY; tileY <= endY; tileY += 1) {
      if (getCollisionKindAt(world, tileX, tileY) === "solid") {
        x = Math.max(x, tileX + 1);
      }
    }
  }

  if (x < 0) {
    x = 0;
  }

  const maxX = world.width - width;
  if (x > maxX) {
    x = maxX;
  }

  return x;
}

function resolveVertical(world, currentX, oldY, proposedY, currentVelocityY) {
  const width = state.collider.width;
  const height = state.collider.height;
  let y = proposedY;
  let vy = currentVelocityY;
  let onGround = false;

  const left = currentX + EPSILON;
  const right = currentX + width - EPSILON;
  const startX = Math.floor(left);
  const endX = Math.floor(right);

  if (proposedY > oldY) {
    const oldBottom = oldY + height;
    const newBottom = proposedY + height;

    let collideTop = null;

    for (let tileX = startX; tileX <= endX; tileX += 1) {
      const startY = Math.floor(oldBottom - EPSILON);
      const endY = Math.floor(newBottom - EPSILON);

      for (let tileY = startY; tileY <= endY; tileY += 1) {
        const kind = getCollisionKindAt(world, tileX, tileY);

        if (!kind) {
          continue;
        }

        const tileTop = tileY;
        const crossedTop = oldBottom <= tileTop + 0.05 && newBottom >= tileTop;

        if (kind === "solid" && crossedTop) {
          collideTop = collideTop === null ? tileTop : Math.min(collideTop, tileTop);
        }

        if (kind === "platform" && crossedTop) {
          collideTop = collideTop === null ? tileTop : Math.min(collideTop, tileTop);
        }
      }
    }

    if (collideTop !== null) {
      y = collideTop - height;
      vy = 0;
      onGround = true;
    }
  } else if (proposedY < oldY) {
    const oldTop = oldY;
    const newTop = proposedY;

    let collideBottom = null;

    for (let tileX = startX; tileX <= endX; tileX += 1) {
      const startY = Math.floor(newTop);
      const endY = Math.floor(oldTop);

      for (let tileY = startY; tileY <= endY; tileY += 1) {
        const kind = getCollisionKindAt(world, tileX, tileY);

        if (kind !== "solid") {
          continue;
        }

        const tileBottom = tileY + 1;
        const crossedBottom = oldTop >= tileBottom - 0.05 && newTop <= tileBottom;
        if (crossedBottom) {
          collideBottom = collideBottom === null ? tileBottom : Math.max(collideBottom, tileBottom);
        }
      }
    }

    if (collideBottom !== null) {
      y = collideBottom;
      vy = 0;
    }
  }

  if (y < 0) {
    y = 0;
    vy = 0;
  }

  const maxY = world.height - height;
  if (y > maxY) {
    y = maxY;
    vy = 0;
    onGround = true;
  }

  return { y, vy, onGround };
}

function showScreen(name) {
  for (const [screenName, screenEl] of Object.entries(screens)) {
    screenEl.classList.toggle("active", screenName === name);
  }

  if (name === "game") {
    resizeCanvas();
  }
}

function resizeCanvas() {
  if (!screens.game.classList.contains("active")) {
    return;
  }

  const topbarHeight = gameTopbar ? gameTopbar.offsetHeight : 58;
  canvas.width = window.innerWidth;
  canvas.height = Math.max(1, window.innerHeight - topbarHeight);
}

window.addEventListener("resize", resizeCanvas);

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.detail || "Request failed");
  }

  return payload;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load atlas image: ${src}`));
    img.src = src;
  });
}

async function loadBlockDefinitions() {
  const data = await requestJson("/data/blocks.json");

  state.blockDefs.clear();
  state.atlases.clear();

  for (const atlas of data.atlases || []) {
    const image = await loadImage(atlas.SRC);
    state.atlases.set(atlas.ATLAS_ID, {
      ...atlas,
      image,
    });
  }

  for (const block of data.blocks || []) {
    state.blockDefs.set(block.ID, block);
  }

  if (state.world) {
    rebuildWorldRenderCache();
  }

  const placeableBlocks = Array.from(state.blockDefs.values()).filter((block) => block.PLACEABLE);

  blockSelect.innerHTML = "";
  for (const block of placeableBlocks) {
    const option = document.createElement("option");
    option.value = String(block.ID);
    option.textContent = `${block.ID} - ${block.NAME}`;
    blockSelect.appendChild(option);
  }

  if (placeableBlocks.length > 0) {
    state.selectedBlockId = placeableBlocks[0].ID;
    blockSelect.value = String(state.selectedBlockId);
    blockTypeInfo.textContent = placeableBlocks[0].BLOCK_TYPE;
  }
}

async function auth(action) {
  loginError.textContent = "";

  const username = usernameInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (!username || !password) {
    loginError.textContent = "Enter username and password.";
    return;
  }

  try {
    const data = await requestJson(`/api/auth/${action}`, {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    state.token = data.token;
    state.user = data.user;
    welcomeText.textContent = `Logged in as ${state.user.username}`;

    passwordInput.value = "";
    showScreen("world");
    await loadWorldList();
  } catch (error) {
    loginError.textContent = error.message;
  }
}

async function authGuest() {
  loginError.textContent = "";

  try {
    const data = await requestJson("/api/auth/guest", {
      method: "POST",
      body: JSON.stringify({}),
    });

    state.token = data.token;
    state.user = data.user;
    welcomeText.textContent = `Logged in as ${state.user.username}`;

    usernameInput.value = "";
    passwordInput.value = "";
    showScreen("world");
    await loadWorldList();
  } catch (error) {
    loginError.textContent = error.message;
  }
}

async function loadWorldList() {
  worldError.textContent = "";

  if (!state.token) {
    return;
  }

  try {
    const data = await requestJson("/api/worlds", {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    });

    worldListEl.innerHTML = "";
    for (const name of data.worlds) {
      const button = document.createElement("button");
      button.className = "worldItem";
      button.textContent = name;
      button.addEventListener("click", async () => {
        worldInput.value = name;
        await enterWorld(name);
      });
      worldListEl.appendChild(button);
    }
  } catch (error) {
    worldError.textContent = error.message;
  }
}

function connectSocket() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  if (state.ws && state.ws.readyState === WebSocket.CONNECTING) {
    return new Promise((resolve, reject) => {
      const onOpen = () => {
        state.ws.removeEventListener("open", onOpen);
        state.ws.removeEventListener("close", onClose);
        resolve();
      };

      const onClose = () => {
        state.ws.removeEventListener("open", onOpen);
        state.ws.removeEventListener("close", onClose);
        reject(new Error("Connection closed"));
      };

      state.ws.addEventListener("open", onOpen);
      state.ws.addEventListener("close", onClose);
    });
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  state.ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

  state.ws.addEventListener("open", () => {
    state.connected = true;
    gameStatus.textContent = "Connected";
  });

  state.ws.addEventListener("close", () => {
    state.connected = false;
    gameStatus.textContent = "Disconnected";
  });

  state.ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "connected") {
      state.selfId = msg.id;
      return;
    }

    if (msg.type === "error") {
      worldError.textContent = msg.message;
      gameStatus.textContent = msg.message;
      return;
    }

    if (msg.type === "world_snapshot") {
      state.world = msg.world;
      if (!Array.isArray(state.world.foreground)) {
        state.world.foreground = Array.isArray(state.world.tiles) ? state.world.tiles : [];
      }
      if (!Array.isArray(state.world.background)) {
        state.world.background = new Array(state.world.foreground.length).fill(0);
      }
      state.selfId = msg.selfId;
      state.players.clear();
      rebuildWorldRenderCache();

      for (const player of msg.world.players) {
        state.players.set(player.id, player);
        if (player.id === state.selfId) {
          state.me.x = player.x;
          state.me.y = player.y;
          state.velocity.x = 0;
          state.velocity.y = 0;
          state.onGround = false;
          state.jumpQueued = false;
          state.lastUpdateAt = performance.now();
        }
      }

      gameStatus.textContent = `World: ${msg.world.name} | Players: ${state.players.size}`;
      showScreen("game");
      return;
    }

    if (!state.world) {
      return;
    }

    if (msg.type === "player_joined") {
      state.players.set(msg.player.id, msg.player);
      gameStatus.textContent = `World: ${state.world.name} | Players: ${state.players.size}`;
      return;
    }

    if (msg.type === "player_left") {
      state.players.delete(msg.id);
      gameStatus.textContent = `World: ${state.world.name} | Players: ${state.players.size}`;
      return;
    }

    if (msg.type === "player_moved") {
      const existing = state.players.get(msg.id);
      if (existing) {
        existing.x = msg.x;
        existing.y = msg.y;
      }
      return;
    }

    if (msg.type === "tile_updated" && state.world) {
      const index = msg.y * state.world.width + msg.x;
      state.world.foreground[index] = Number(msg.foreground ?? msg.tile ?? 0);
      state.world.background[index] = Number(msg.background ?? 0);
      updateWorldRenderTile(msg.x, msg.y);
    }
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out connecting to server"));
    }, 5000);

    state.ws.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );

    state.ws.addEventListener(
      "close",
      () => {
        clearTimeout(timeout);
        reject(new Error("Disconnected while connecting"));
      },
      { once: true },
    );

    state.ws.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket error"));
      },
      { once: true },
    );
  });
}

function sendWs(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  state.ws.send(JSON.stringify(payload));
  return true;
}

async function enterWorld(targetWorldName = null) {
  worldError.textContent = "";

  const isEventObject = typeof targetWorldName === "object" && targetWorldName !== null;
  const isExplicitName = typeof targetWorldName === "string";
  const rawWorldName = isExplicitName ? targetWorldName : worldInput.value;
  const worldName = String(isEventObject ? worldInput.value : rawWorldName).trim().toLowerCase();

  if (worldName === "[object pointerevent]" || worldName === "[object event]") {
    worldError.textContent = "Invalid world name.";
    return;
  }

  if (!worldName) {
    worldError.textContent = "Enter a world name.";
    return;
  }

  worldInput.value = worldName;

  if (!state.token) {
    worldError.textContent = "Please log in first.";
    return;
  }

  try {
    await connectSocket();
  } catch (error) {
    worldError.textContent = error.message;
    return;
  }

  const ok = sendWs({ type: "join_world", world: worldName, token: state.token });
  if (!ok) {
    worldError.textContent = "Socket not connected.";
  }
}

function leaveWorld() {
  sendWs({ type: "leave_world" });
  state.world = null;
  state.worldRender = null;
  state.players.clear();
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.onGround = false;
  state.jumpQueued = false;
  showScreen("world");
  loadWorldList();
}

function logout() {
  leaveWorld();
  state.token = null;
  state.user = null;
  usernameInput.value = "";
  passwordInput.value = "";
  loginError.textContent = "";
  worldError.textContent = "";
  showScreen("main");
}

playBtn.addEventListener("click", () => showScreen("login"));
backToMainBtn.addEventListener("click", () => showScreen("main"));
loginBtn.addEventListener("click", () => auth("login"));
registerBtn.addEventListener("click", () => auth("register"));
guestBtn.addEventListener("click", authGuest);
joinWorldBtn.addEventListener("click", () => enterWorld());
refreshWorldsBtn.addEventListener("click", loadWorldList);
logoutBtn.addEventListener("click", logout);
leaveWorldBtn.addEventListener("click", leaveWorld);
leaveWorldBtn.addEventListener("mousedown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  leaveWorld();
});

blockSelect.addEventListener("change", () => {
  const nextBlockId = Number(blockSelect.value);
  if (!Number.isNaN(nextBlockId)) {
    state.selectedBlockId = nextBlockId;
    const block = state.blockDefs.get(nextBlockId);
    blockTypeInfo.textContent = block?.BLOCK_TYPE || "UNKNOWN";
  }
});

passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    auth("login");
  }
});

worldInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    enterWorld();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && screens.game.classList.contains("active")) {
    leaveWorld();
    return;
  }

  const key = event.key.toLowerCase();
  if (!event.repeat && (key === " " || key === "w" || key === "arrowup")) {
    event.preventDefault();
    state.jumpQueued = true;
  }

  state.keys.add(key);
});

document.addEventListener("keyup", (event) => {
  state.keys.delete(event.key.toLowerCase());
});

canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  state.mouse.x = event.clientX - rect.left;
  state.mouse.y = event.clientY - rect.top;
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

canvas.addEventListener("mousedown", (event) => {
  if (!state.world) {
    return;
  }

  const tileX = Math.floor((state.mouse.x + state.camera.x) / TILE_SIZE);
  const tileY = Math.floor((state.mouse.y + state.camera.y) / TILE_SIZE);

  if (tileX < 0 || tileX >= state.world.width || tileY < 0 || tileY >= state.world.height) {
    return;
  }

  const isRightClick = event.button === 2;
  if (isRightClick) {
    sendWs({
      type: "set_tile",
      action: "break",
      x: tileX,
      y: tileY,
    });
  } else {
    sendWs({
      type: "set_tile",
      action: "place",
      x: tileX,
      y: tileY,
      tile: state.selectedBlockId,
    });
  }
});

function update() {
  if (!state.world || !state.selfId) {
    return;
  }

  const now = performance.now();
  const deltaSeconds = Math.min(0.05, Math.max(0.001, (now - (state.lastUpdateAt || now)) / 1000));
  state.lastUpdateAt = now;

  let moveX = 0;
  if (state.keys.has("a") || state.keys.has("arrowleft")) moveX -= 1;
  if (state.keys.has("d") || state.keys.has("arrowright")) moveX += 1;

  state.velocity.x = moveX * HORIZONTAL_SPEED;

  if (state.jumpQueued && state.onGround) {
    state.velocity.y = -JUMP_SPEED;
    state.onGround = false;
  }
  state.jumpQueued = false;

  state.velocity.y = Math.min(MAX_FALL_SPEED, state.velocity.y + GRAVITY * deltaSeconds);

  const oldX = state.me.x;
  const oldY = state.me.y;
  const proposedX = oldX + state.velocity.x * deltaSeconds;
  state.me.x = resolveHorizontal(state.world, oldX, oldY, proposedX);

  const proposedY = oldY + state.velocity.y * deltaSeconds;
  const vertical = resolveVertical(state.world, state.me.x, oldY, proposedY, state.velocity.y);
  state.me.y = vertical.y;
  state.velocity.y = vertical.vy;
  state.onGround = vertical.onGround;

  const me = state.players.get(state.selfId);
  if (me) {
    me.x = state.me.x;
    me.y = state.me.y;
  }

  if (now - state.lastMoveSentAt > 50) {
    sendWs({ type: "player_move", x: state.me.x, y: state.me.y });
    state.lastMoveSentAt = now;
  }

  state.camera.x = state.me.x * TILE_SIZE - canvas.width / 2;
  state.camera.y = state.me.y * TILE_SIZE - canvas.height / 2;

  state.camera.x = Math.max(0, Math.min(state.camera.x, state.world.width * TILE_SIZE - canvas.width));
  state.camera.y = Math.max(0, Math.min(state.camera.y, state.world.height * TILE_SIZE - canvas.height));
}

function drawWorld() {
  if (!state.world) {
    return;
  }

  if (!state.worldRender) {
    rebuildWorldRenderCache();
  }

  if (!state.worldRender) {
    return;
  }

  const sourceX = Math.max(0, Math.floor(state.camera.x));
  const sourceY = Math.max(0, Math.floor(state.camera.y));
  const maxSourceW = state.worldRender.canvas.width - sourceX;
  const maxSourceH = state.worldRender.canvas.height - sourceY;
  const sourceW = Math.max(0, Math.min(canvas.width, maxSourceW));
  const sourceH = Math.max(0, Math.min(canvas.height, maxSourceH));

  if (sourceW <= 0 || sourceH <= 0) {
    return;
  }

  ctx.drawImage(
    state.worldRender.canvas,
    sourceX,
    sourceY,
    sourceW,
    sourceH,
    0,
    0,
    sourceW,
    sourceH,
  );
}

function drawPlayers() {
  for (const [, player] of state.players) {
    const screenX = player.x * TILE_SIZE - state.camera.x;
    const screenY = player.y * TILE_SIZE - state.camera.y;

    ctx.fillStyle = player.id === state.selfId ? "#22c55e" : "#3b82f6";
    ctx.fillRect(screenX + 6, screenY + 6, TILE_SIZE - 12, TILE_SIZE - 12);

    ctx.fillStyle = "#f9fafb";
    ctx.font = "12px system-ui";
    ctx.fillText(player.username ?? "player", screenX - 4, screenY - 6);
  }
}

function loop() {
  update();

  if (screens.game.classList.contains("active")) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!state.world) {
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "20px system-ui";
      ctx.fillText("Loading world...", 30, 50);
    } else {
      drawWorld();
      drawPlayers();
    }
  }

  requestAnimationFrame(loop);
}

(async () => {
  try {
    await loadBlockDefinitions();
  } catch (error) {
    console.error(error);
    gameStatus.textContent = "Failed loading block definitions";
  }

  requestAnimationFrame(loop);
  showScreen("main");
})();
