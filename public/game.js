import {
  CAMERA_ZOOM_STEP,
  CHAT_BUBBLE_FADE_MS,
  CHAT_BUBBLE_LIFETIME_MS,
  CHAT_DRAWER_HANDLE_PEEK,
  CHAT_INPUT_PANEL_HEIGHT,
  CHAT_LOG_DRAWER_HEIGHT,
  CRACK_ATLAS_COLUMNS,
  CRACK_ATLAS_ROWS,
  CRACK_ATLAS_SRC,
  DEBUG_INFO_REFRESH_MS,
  DEBUG_PING_INTERVAL_MS,
  DEFAULT_TEXTURE47_VALID_MASKS,
  EPSILON,
  GEM_ATLAS_ID,
  GEM_BOB_AMPLITUDE_VARIANCE_PX,
  GEM_BOB_BASE_AMPLITUDE_PX,
  GEM_BOB_BASE_SPEED,
  GEM_BOB_SPEED_VARIANCE,
  GEM_TILE_SIZE,
  GEM_VALUE_TO_FRAME,
  GRAVITY,
  HORIZONTAL_SPEED,
  JUMP_SPEED,
  MAX_CAMERA_ZOOM,
  MAX_CHAT_LOG_LINES,
  MAX_FALL_SPEED,
  LEAVE_TEXT_FADE_MS,
  MIN_CAMERA_ZOOM,
  REMOTE_PLAYER_INTERP_SPEED,
  REMOTE_PLAYER_SNAP_DISTANCE,
  REMOTE_PLAYER_EXTRAPOLATE_BASE_MS,
  REMOTE_PLAYER_EXTRAPOLATE_MAX_MS,
  REMOTE_PLAYER_MAX_EXTRAPOLATE_SPEED,
  SELF_TELEPORT_SNAP_DISTANCE,
  SELF_RECONCILE_SNAP_DISTANCE,
  TEXTURE47_COLS,
  TEXTURE47_ROWS,
  TILE_SIZE,
} from "./game/constants.js";
import {
  clearAuthSession,
  getGuestDeviceId,
  isGuestUser,
  loadAuthSession,
  saveAuthSession,
} from "./game/session.js";
import { getGemDrawSizeForValue, getGemFrameForValue } from "./game/gems.js";
import { createHudController } from "./game/hud.js";
import { createChatDebugController } from "./game/chat_debug.js";
import { createChatBubblesController } from "./game/chat_bubbles.js";
import { createPauseMenuController } from "./game/pause_menu.js";
import { createInputController } from "./game/input_controller.js";

const screens = {
  main: document.getElementById("mainScreen"),
  login: document.getElementById("loginScreen"),
  loading: document.getElementById("loadingScreen"),
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
const loadingStatus = document.getElementById("loadingStatus");

const welcomeText = document.getElementById("welcomeText");
const worldListEl = document.getElementById("worldList");
const worldInput = document.getElementById("worldInput");
const joinWorldBtn = document.getElementById("joinWorldBtn");
const refreshWorldsBtn = document.getElementById("refreshWorldsBtn");
const logoutBtn = document.getElementById("logoutBtn");
const worldError = document.getElementById("worldError");

const leaveWorldBtn = document.getElementById("leaveWorldBtn");
const gameStatus = document.getElementById("gameStatus");
const gemCount = document.getElementById("gemCount");
const blockSelect = document.getElementById("blockSelect");
const seedSelectHud = document.getElementById("seedSelectHud");
const blockTypeInfo = document.getElementById("blockTypeInfo");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomResetBtn = document.getElementById("zoomResetBtn");
const zoomLevel = document.getElementById("zoomLevel");
const chatToggleBtn = document.getElementById("chatToggleBtn");
const debugToggleBtn = document.getElementById("debugToggleBtn");
const chatDrawerHandle = document.getElementById("chatDrawerHandle");
const chatDrawer = document.getElementById("chatDrawer");
const chatLogPanel = document.getElementById("chatLogPanel");
const chatLog = document.getElementById("chatLog");
const worldChatLog = document.getElementById("worldChatLog");
const worldChatDrawerHandle = document.getElementById("worldChatDrawerHandle");
const worldChatDrawer = document.getElementById("worldChatDrawer");
const loadingChatLog = document.getElementById("loadingChatLog");
const loadingChatDrawerHandle = document.getElementById("loadingChatDrawerHandle");
const loadingChatDrawer = document.getElementById("loadingChatDrawer");
const chatInputPanel = document.getElementById("chatInputPanel");
const chatInput = document.getElementById("chatInput");
const debugOverlay = document.getElementById("debugOverlay");
const debugInfo = document.getElementById("debugInfo");
const debugGridToggle = document.getElementById("debugGridToggle");
const debugHitboxesToggle = document.getElementById("debugHitboxesToggle");
const debugPingToolsToggle = document.getElementById("debugPingToolsToggle");
const debugNetSimPanel = document.getElementById("debugNetSimPanel");
const debugNetSimStats = document.getElementById("debugNetSimStats");
const debugSimPingInput = document.getElementById("debugSimPingInput");
const debugSimJitterInput = document.getElementById("debugSimJitterInput");
const debugSimLossInput = document.getElementById("debugSimLossInput");
const pauseOverlay = document.getElementById("pauseOverlay");
const pauseExitWorldBtn = document.getElementById("pauseExitWorldBtn");
const pauseRespawnBtn = document.getElementById("pauseRespawnBtn");
const pauseOptionsBtn = document.getElementById("pauseOptionsBtn");
const pauseLogoutBtn = document.getElementById("pauseLogoutBtn");
const pauseBackBtn = document.getElementById("pauseBackBtn");
const gameHud = document.getElementById("gameHud");
const gameTopbar = document.querySelector(".gameTopbar");

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const RECONNECT_INTERVAL_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 5;

const state = {
  token: null,
  user: null,
  ws: null,
  connected: false,
  selfId: null,
  world: null,
  gems: 0,
  gemDrops: new Map(),
  seedDrops: new Map(),
  plantedTrees: new Map(),
  players: new Map(),
  me: { x: 8, y: 8 },
  camera: { x: 0, y: 0, zoom: 1 },
  keys: new Set(),
  mouse: { x: 0, y: 0 },
  lastMoveSentAt: 0,
  blockDefs: new Map(),
  seedDefs: new Map(),
  atlases: new Map(),
  seedDropSpriteCache: new Map(),
  treeSpriteCache: new Map(),
  texture47: new Map(),
  selectedBlockId: 1,
  selectedSeedId: -1,
  velocity: { x: 0, y: 0 },
  collider: { width: 0.72, height: 0.92 },
  onGround: false,
  jumpQueued: false,
  worldRender: null,
  crackAtlas: null,
  tileDamage: new Map(),
  chatLogLines: [],
  chatLogOpen: false,
  chatInputOpen: false,
  chatDrawerHeight: CHAT_LOG_DRAWER_HEIGHT,
  chatDrawerOffsetY: -(CHAT_LOG_DRAWER_HEIGHT - CHAT_DRAWER_HANDLE_PEEK),
  chatDrawerDragging: false,
  chatDrawerDragStartY: 0,
  chatDrawerDragStartOffsetY: 0,
  worldChatLogOpen: false,
  worldChatDrawerHeight: CHAT_LOG_DRAWER_HEIGHT,
  worldChatDrawerOffsetY: -(CHAT_LOG_DRAWER_HEIGHT - CHAT_DRAWER_HANDLE_PEEK),
  worldChatDrawerDragging: false,
  worldChatDrawerDragStartY: 0,
  worldChatDrawerDragStartOffsetY: 0,
  loadingChatLogOpen: true,
  loadingChatDrawerHeight: CHAT_LOG_DRAWER_HEIGHT,
  loadingChatDrawerOffsetY: 0,
  loadingChatDrawerDragging: false,
  loadingChatDrawerDragStartY: 0,
  loadingChatDrawerDragStartOffsetY: 0,
  assetsLoaded: false,
  flyEnabled: false,
  noclipEnabled: false,
  debugEnabled: false,
  debugGridEnabled: false,
  debugHitboxesEnabled: false,
  debugFps: 0,
  debugPingMs: null,
  netSimPingMs: 0,
  netSimJitterMs: 0,
  netSimLossPercent: 0,
  debugPingToolsVisible: false,
  pauseMenuOpen: false,
  debugLastFrameAt: 0,
  debugLastInfoAt: 0,
  pingTimerId: null,
  transientSystemBubbles: [],
  serverTimeOffsetMs: 0,
  treeHintAnchor: null,
  treeHintTreeId: "",
  reconnect: {
    active: false,
    attempt: 0,
    timerId: null,
  },
};

const hud = createHudController({
  state,
  screens,
  canvas,
  ctx,
  elements: {
    zoomLevel,
    gemCount,
    debugOverlay,
    debugInfo,
    debugGridToggle,
    debugHitboxesToggle,
    gameTopbar,
    chatDrawer,
    chatInputPanel,
    chatInput,
    worldChatDrawer,
    loadingChatDrawer,
  },
  settings: {
    TILE_SIZE,
    CHAT_DRAWER_HANDLE_PEEK,
    CHAT_INPUT_PANEL_HEIGHT,
    CHAT_LOG_DRAWER_HEIGHT,
    DEBUG_INFO_REFRESH_MS,
  },
});

const chatDebug = createChatDebugController({
  state,
  screens,
  canvas,
  ctx,
  elements: {
    chatToggleBtn,
    debugToggleBtn,
    chatDrawerHandle,
    chatDrawer,
    chatLog,
    worldChatLog,
    worldChatDrawerHandle,
    worldChatDrawer,
    loadingChatLog,
    loadingChatDrawerHandle,
    loadingChatDrawer,
    chatInput,
    debugGridToggle,
    debugHitboxesToggle,
    debugPingToolsToggle,
    debugNetSimPanel,
    debugNetSimStats,
    debugSimPingInput,
    debugSimJitterInput,
    debugSimLossInput,
  },
  settings: {
    TILE_SIZE,
    MAX_CHAT_LOG_LINES,
    DEBUG_PING_INTERVAL_MS,
  },
  actions: {
    sendWs,
    setChatLogOpen,
    setChatInputOpen,
    applyChatDrawerPosition,
    getChatDrawerHiddenOffset,
    applyWorldChatDrawerPosition,
    getWorldChatDrawerHiddenOffset,
    applyLoadingChatDrawerPosition,
    getLoadingChatDrawerHiddenOffset,
    updateDebugUi,
    updateDebugInfo,
  },
});

const chatBubbles = createChatBubblesController({
  state,
  ctx,
  canvas,
  settings: {
    TILE_SIZE,
    CHAT_BUBBLE_FADE_MS,
    CHAT_BUBBLE_LIFETIME_MS,
    LEAVE_TEXT_FADE_MS,
  },
});

const TREE_HINT_FADE_OUT_MS = 280;
const TREE_HINT_HOLD_MS = LEAVE_TEXT_FADE_MS + 180;

function clampCameraZoom(value) {
  return Math.max(MIN_CAMERA_ZOOM, Math.min(MAX_CAMERA_ZOOM, value));
}

function updateZoomUi() {
  hud.updateZoomUi();
}

function updateGemUi() {
  hud.updateGemUi();
}

function updateDebugUi() {
  hud.updateDebugUi();
}

function updateDebugInfo(force = false) {
  hud.updateDebugInfo(force);
}

function stopPingTimer() {
  chatDebug.stopPingTimer();
}

function sendDebugPing() {
  chatDebug.sendDebugPing();
}

function updateNetworkSimInputsFromState() {
  chatDebug.updateNetworkSimInputsFromState();
}

function refreshNetworkSimStateFromInputs() {
  chatDebug.refreshNetworkSimStateFromInputs();
}

function getNetworkSimulationDelayMs() {
  return chatDebug.getNetworkSimulationDelayMs();
}

function shouldDropSimulatedPacket(payloadType = "") {
  return chatDebug.shouldDropSimulatedPacket(payloadType);
}

function startPingTimer() {
  chatDebug.startPingTimer();
}

function drawDebugGrid() {
  chatDebug.drawDebugGrid();
}

function clearReconnectTimer() {
  if (state.reconnect.timerId) {
    clearTimeout(state.reconnect.timerId);
    state.reconnect.timerId = null;
  }
}

function resetReconnectState() {
  clearReconnectTimer();
  state.reconnect.active = false;
  state.reconnect.attempt = 0;
}

async function repullGameBundle() {
  try {
    await fetch(`/build/game.bundle.js?t=${Date.now()}`, { cache: "no-store" });
  } catch {
    // Ignore bundle prefetch failures during reconnect.
  }
}

function clearActiveWorldRuntimeState() {
  setChatInputOpen(false);
  setChatLogOpen(false);
  setWorldChatLogOpen(false);
  pauseMenu.setPauseMenuOpen(false);
  state.world = null;
  state.worldRender = null;
  state.gems = 0;
  updateGemUi();
  state.gemDrops.clear();
  state.seedDrops.clear();
  state.plantedTrees.clear();
  state.treeHintAnchor = null;
  state.treeHintTreeId = "";
  state.tileDamage.clear();
  state.players.clear();
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.onGround = false;
  state.jumpQueued = false;
  state.flyEnabled = false;
  state.noclipEnabled = false;
}

function returnToWorldSelectAfterReconnectFailure() {
  clearActiveWorldRuntimeState();
  worldError.textContent = "Reconnect timed out. Please join a world again.";
  showScreen("world");
  loadWorldList();
}

async function performReconnectAttempt() {
  if (!state.reconnect.active || !state.token) {
    return false;
  }

  await repullGameBundle();

  try {
    await connectSocket();
  } catch {
    return false;
  }

  // Connection is back; stay on world select and let user choose a world manually.
  clearActiveWorldRuntimeState();
  resetReconnectState();
  worldError.textContent = "Connection restored. Select a world to join.";
  appendChatLine("system", "Connection restored. Select a world to join.");
  showScreen("world");
  loadWorldList();
  return true;
}

function scheduleReconnectAttempt() {
  clearReconnectTimer();

  if (!state.reconnect.active) {
    return;
  }

  if (state.reconnect.attempt >= MAX_RECONNECT_ATTEMPTS) {
    appendChatLine("system", "Reconnect timed out. Returning to world select.");
    resetReconnectState();
    returnToWorldSelectAfterReconnectFailure();
    return;
  }

  state.reconnect.timerId = setTimeout(async () => {
    if (!state.reconnect.active) {
      return;
    }

    state.reconnect.attempt += 1;
    appendChatLine("system", `Attempting to reconnect (${state.reconnect.attempt}/${MAX_RECONNECT_ATTEMPTS})...`);
    worldError.textContent = `Lost connection. Reconnecting (${state.reconnect.attempt}/${MAX_RECONNECT_ATTEMPTS})...`;
    const connected = await performReconnectAttempt();
    if (!connected && state.reconnect.active) {
      scheduleReconnectAttempt();
    }
  }, RECONNECT_INTERVAL_MS);
}

function beginReconnectFlow() {
  if (state.reconnect.active || !state.world || !state.token) {
    return;
  }

  state.reconnect.active = true;
  state.reconnect.attempt = 0;
  setChatInputOpen(false);
  setWorldChatLogOpen(true);
  appendChatLine("system", "Lost connection. Attempting to reconnect...");
  scheduleReconnectAttempt();
}

const pauseMenu = createPauseMenuController({
  state,
  screens,
  elements: {
    pauseOverlay,
    pauseExitWorldBtn,
    pauseRespawnBtn,
    pauseOptionsBtn,
    pauseLogoutBtn,
    pauseBackBtn,
  },
  actions: {
    setChatInputOpen,
    sendWs,
    updateDebugUi,
    updateDebugInfo,
    appendChatLine,
    leaveWorld,
    logout,
  },
});

const inputController = createInputController({
  state,
  screens,
  canvas,
  constants: {
    CAMERA_ZOOM_STEP,
    TILE_SIZE,
  },
  actions: {
    setChatInputOpen,
    setChatLogOpen,
    adjustCameraZoom,
    setCameraZoom,
    sendWs,
    pauseMenu,
    getChatInputValue: () => chatInput?.value || "",
    getSelectedSeedId: () => state.selectedSeedId,
  },
});

function setCameraZoom(nextZoom) {
  const clamped = clampCameraZoom(nextZoom);
  if (Math.abs(clamped - state.camera.zoom) < 0.0001) {
    return;
  }

  state.camera.zoom = clamped;
  updateZoomUi();
}

function adjustCameraZoom(delta) {
  const target = Math.round((state.camera.zoom + delta) * 100) / 100;
  setCameraZoom(target);
}

function isTexture47Block(block) {
  return typeof block?.ATLAS_ID === "string";
}

function getTileIdAtLayer(tileX, tileY, layer = "foreground") {
  if (!state.world || tileX < 0 || tileY < 0 || tileX >= state.world.width || tileY >= state.world.height) {
    return 0;
  }

  const index = tileY * state.world.width + tileX;
  if (layer === "background") {
    return Number(state.world.background?.[index] || 0);
  }
  return Number(state.world.foreground?.[index] || 0);
}

function sameTexture47Group(tileX, tileY, atlasId, layer = "foreground") {
  const neighborId = getTileIdAtLayer(tileX, tileY, layer);
  if (neighborId === 0) {
    return false;
  }

  const neighborBlock = state.blockDefs.get(neighborId);
  return !!neighborBlock && typeof neighborBlock.ATLAS_ID === "string" && neighborBlock.ATLAS_ID === atlasId;
}

function getTexture47Mask(tileX, tileY, atlasId, layer = "foreground") {
  const north = sameTexture47Group(tileX, tileY - 1, atlasId, layer);
  const east = sameTexture47Group(tileX + 1, tileY, atlasId, layer);
  const south = sameTexture47Group(tileX, tileY + 1, atlasId, layer);
  const west = sameTexture47Group(tileX - 1, tileY, atlasId, layer);

  const northEast = north && east && sameTexture47Group(tileX + 1, tileY - 1, atlasId, layer);
  const southEast = south && east && sameTexture47Group(tileX + 1, tileY + 1, atlasId, layer);
  const southWest = south && west && sameTexture47Group(tileX - 1, tileY + 1, atlasId, layer);
  const northWest = north && west && sameTexture47Group(tileX - 1, tileY - 1, atlasId, layer);

  let mask = 0;
  if (north) mask |= 2;
  if (east) mask |= 16;
  if (south) mask |= 64;
  if (west) mask |= 8;
  if (northEast) mask |= 1;
  if (southEast) mask |= 32;
  if (southWest) mask |= 128;
  if (northWest) mask |= 4;

  return mask;
}

function drawConnected47TileToContext(targetContext, block, drawX, drawY, layer = "foreground") {
  if (!state.world || !isTexture47Block(block)) {
    return false;
  }

  const texture47 = state.texture47.get(block.ATLAS_ID);
  if (!texture47?.image) {
    return false;
  }

  const tileX = Math.floor(drawX / TILE_SIZE);
  const tileY = Math.floor(drawY / TILE_SIZE);
  const mask = getTexture47Mask(tileX, tileY, block.ATLAS_ID, layer);
  const variants = texture47.maskVariants.get(mask) || texture47.maskVariants.get(255) || [texture47.fallbackIndex];
  const hash = Math.abs((tileX * 73856093) ^ (tileY * 19349663));
  const variantIndex = variants[hash % variants.length];
  const atlasColumns = Number.isInteger(texture47.columns) && texture47.columns > 0
    ? texture47.columns
    : TEXTURE47_COLS;

  const sourceX = (variantIndex % atlasColumns) * texture47.tileWidth;
  const sourceY = Math.floor(variantIndex / atlasColumns) * texture47.tileHeight;

  targetContext.drawImage(
    texture47.image,
    sourceX,
    sourceY,
    texture47.tileWidth,
    texture47.tileHeight,
    drawX,
    drawY,
    TILE_SIZE,
    TILE_SIZE,
  );

  return true;
}

function initializeRemotePlayerTracking(player) {
  player.targetX = player.x;
  player.targetY = player.y;
  player.renderX = player.x;
  player.renderY = player.y;
  player.netVx = 0;
  player.netVy = 0;
  player.lastNetUpdateAt = performance.now();
  chatBubbles.ensurePlayerBubbleQueue(player);
}

function appendChatLine(kind, text, username = "") {
  chatDebug.appendChatLine(kind, text, username);
}

function renderChatLog() {
  chatDebug.renderChatLog();
}

function getChatDrawerMaxHeight() {
  return hud.getChatDrawerMaxHeight();
}

function getChatDrawerHiddenOffset() {
  return hud.getChatDrawerHiddenOffset();
}

function updateDebugOverlayPosition() {
  hud.updateDebugOverlayPosition();
}

function applyChatDrawerPosition(nextOffsetY, immediate = false) {
  hud.applyChatDrawerPosition(nextOffsetY, immediate);
}

function setChatLogOpen(open) {
  hud.setChatLogOpen(open);
}

function setChatInputOpen(open) {
  hud.setChatInputOpen(open);
}

function getWorldChatDrawerHiddenOffset() {
  return hud.getWorldChatDrawerHiddenOffset();
}

function applyWorldChatDrawerPosition(nextOffsetY, immediate = false) {
  hud.applyWorldChatDrawerPosition(nextOffsetY, immediate);
}

function setWorldChatLogOpen(open) {
  hud.setWorldChatLogOpen(open);
}

function getLoadingChatDrawerHiddenOffset() {
  return hud.getLoadingChatDrawerHiddenOffset();
}

function applyLoadingChatDrawerPosition(nextOffsetY, immediate = false) {
  hud.applyLoadingChatDrawerPosition(nextOffsetY, immediate);
}

function setLoadingChatLogOpen(open) {
  hud.setLoadingChatLogOpen(open);
}

function setPlayerChatBubble(playerId, messageText) {
  chatBubbles.setPlayerChatBubble(playerId, messageText);
}

function addTransientSystemBubble(x, y, text, durationMs = CHAT_BUBBLE_LIFETIME_MS) {
  chatBubbles.addTransientSystemBubble(x, y, text, durationMs);
}

function normalizeGemDrop(entry) {
  if (!entry) {
    return null;
  }

  const id = String(entry.id || "").trim();
  const x = Number(entry.x);
  const y = Number(entry.y);
  const value = Number(entry.value);

  if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return {
    id,
    x,
    y,
    value: Math.floor(value),
  };
}

function hashStringToUnit(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  // Convert to a stable 0..1 range.
  return (hash >>> 0) / 4294967295;
}

function getGemBobParams(dropId) {
  const unitA = hashStringToUnit(`${dropId}:a`);
  const unitB = hashStringToUnit(`${dropId}:b`);
  const unitC = hashStringToUnit(`${dropId}:c`);
  return {
    bobPhase: unitA * Math.PI * 2,
    bobSpeed: GEM_BOB_BASE_SPEED + unitB * GEM_BOB_SPEED_VARIANCE,
    bobAmplitude: GEM_BOB_BASE_AMPLITUDE_PX + unitC * GEM_BOB_AMPLITUDE_VARIANCE_PX,
  };
}

function applyGemDropSnapshot(drops) {
  state.gemDrops.clear();
  for (const entry of drops || []) {
    const normalized = normalizeGemDrop(entry);
    if (!normalized) {
      continue;
    }
    const bob = getGemBobParams(normalized.id);
    state.gemDrops.set(normalized.id, {
      ...normalized,
      ...bob,
    });
  }
}

function upsertGemDrop(entry) {
  const normalized = normalizeGemDrop(entry);
  if (!normalized) {
    return;
  }

  const existing = state.gemDrops.get(normalized.id);
  if (existing) {
    state.gemDrops.set(normalized.id, {
      ...existing,
      ...normalized,
    });
    return;
  }

  const bob = getGemBobParams(normalized.id);
  state.gemDrops.set(normalized.id, {
    ...normalized,
    ...bob,
  });
}

function removeGemDropById(dropId) {
  const normalizedId = String(dropId || "").trim();
  if (!normalizedId) {
    return;
  }
  state.gemDrops.delete(normalizedId);
}

function normalizeSeedDrop(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = String(entry.id || "").trim();
  const x = Number(entry.x);
  const y = Number(entry.y);
  const seedId = Number(entry.seedId ?? entry.seed_id);
  if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(seedId) || seedId < 0) {
    return null;
  }

  return {
    id,
    x,
    y,
    seedId: Math.floor(seedId),
  };
}

function applySeedDropSnapshot(drops) {
  state.seedDrops.clear();
  for (const entry of drops || []) {
    const normalized = normalizeSeedDrop(entry);
    if (!normalized) {
      continue;
    }
    const bob = getGemBobParams(`seed:${normalized.id}`);
    state.seedDrops.set(normalized.id, {
      ...normalized,
      ...bob,
    });
  }
}

function upsertSeedDrop(entry) {
  const normalized = normalizeSeedDrop(entry);
  if (!normalized) {
    return;
  }

  const existing = state.seedDrops.get(normalized.id);
  if (existing) {
    state.seedDrops.set(normalized.id, {
      ...existing,
      ...normalized,
    });
    return;
  }

  const bob = getGemBobParams(`seed:${normalized.id}`);
  state.seedDrops.set(normalized.id, {
    ...normalized,
    ...bob,
  });
}

function removeSeedDropById(dropId) {
  const normalizedId = String(dropId || "").trim();
  if (!normalizedId) {
    return;
  }
  state.seedDrops.delete(normalizedId);
}

function normalizePlantedTree(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = String(entry.id || "").trim();
  const x = Number(entry.x);
  const y = Number(entry.y);
  const seedId = Number(entry.seedId ?? entry.seed_id);
  const plantedAtMs = Number(entry.plantedAtMs ?? entry.planted_at_ms ?? 0);
  if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(seedId) || seedId < 0) {
    return null;
  }

  return {
    id,
    x: Math.floor(x),
    y: Math.floor(y),
    seedId: Math.floor(seedId),
    plantedAtMs: Math.max(0, Math.floor(plantedAtMs)),
  };
}

function getTreeMapKey(x, y) {
  return `${Math.floor(Number(x) || 0)}:${Math.floor(Number(y) || 0)}`;
}

function applyPlantedTreeSnapshot(trees) {
  state.plantedTrees.clear();
  for (const entry of trees || []) {
    const normalized = normalizePlantedTree(entry);
    if (!normalized) {
      continue;
    }
    state.plantedTrees.set(getTreeMapKey(normalized.x, normalized.y), normalized);
  }
}

function upsertPlantedTree(entry) {
  const normalized = normalizePlantedTree(entry);
  if (!normalized) {
    return;
  }
  state.plantedTrees.set(getTreeMapKey(normalized.x, normalized.y), normalized);
}

function removePlantedTree(entry) {
  if (!entry || typeof entry !== "object") {
    return;
  }

  const x = Number(entry.x);
  const y = Number(entry.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }

  state.plantedTrees.delete(getTreeMapKey(x, y));
}

function getServerNowMs() {
  return Date.now() + (Number(state.serverTimeOffsetMs) || 0);
}

function updateRemotePlayersInterpolation(deltaSeconds) {
  if (!state.selfId) {
    return;
  }

  const alpha = 1 - Math.exp(-REMOTE_PLAYER_INTERP_SPEED * deltaSeconds);
  const now = performance.now();
  const pingMs = Number.isFinite(state.debugPingMs) ? Math.max(0, state.debugPingMs) : 0;
  const pingLeadMs = Math.min(120, pingMs * 0.5);

  for (const [playerId, player] of state.players) {
    if (playerId === state.selfId) {
      continue;
    }

    if (!Number.isFinite(player.renderX) || !Number.isFinite(player.renderY)) {
      initializeRemotePlayerTracking(player);
    }

    const targetX = Number.isFinite(player.targetX) ? player.targetX : player.x;
    const targetY = Number.isFinite(player.targetY) ? player.targetY : player.y;
    const maxSpeed = Math.max(0, Number(REMOTE_PLAYER_MAX_EXTRAPOLATE_SPEED) || 0);
    const rawNetVx = Number.isFinite(player.netVx) ? player.netVx : 0;
    const rawNetVy = Number.isFinite(player.netVy) ? player.netVy : 0;
    const netVx = Math.max(-maxSpeed, Math.min(maxSpeed, rawNetVx));
    const netVy = Math.max(-maxSpeed, Math.min(maxSpeed, rawNetVy));
    const sinceUpdateMs = Number.isFinite(player.lastNetUpdateAt)
      ? Math.max(0, now - player.lastNetUpdateAt)
      : 0;
    const staleLeadMs = Math.min(40, sinceUpdateMs * 0.15);
    const leadMs = Math.min(
      REMOTE_PLAYER_EXTRAPOLATE_MAX_MS,
      REMOTE_PLAYER_EXTRAPOLATE_BASE_MS + staleLeadMs + pingLeadMs * 0.35,
    );
    const predictedX = targetX + netVx * (leadMs / 1000);
    const predictedY = targetY + netVy * (leadMs / 1000);
    const dx = predictedX - player.renderX;
    const dy = predictedY - player.renderY;

    // Teleports or very stale jumps should snap to avoid rubber-band trails.
    if (Math.abs(dx) > REMOTE_PLAYER_SNAP_DISTANCE || Math.abs(dy) > REMOTE_PLAYER_SNAP_DISTANCE) {
      player.renderX = targetX;
      player.renderY = targetY;
      continue;
    }

    player.renderX += dx * alpha;
    player.renderY += dy * alpha;
  }
}

function drawTileToContext(targetContext, tileId, drawX, drawY, layer = "foreground") {
  const block = state.blockDefs.get(tileId);
  if (!block) {
    return;
  }

  if (drawConnected47TileToContext(targetContext, block, drawX, drawY, layer)) {
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
    drawTileToContext(state.worldRender.context, backgroundTile, drawX, drawY, "background");
  }
  if (foregroundTile !== 0) {
    drawTileToContext(state.worldRender.context, foregroundTile, drawX, drawY, "foreground");
  }
}

function updateWorldRenderTileArea(centerX, centerY) {
  for (let y = centerY - 1; y <= centerY + 1; y += 1) {
    for (let x = centerX - 1; x <= centerX + 1; x += 1) {
      updateWorldRenderTile(x, y);
    }
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
  hud.resizeCanvas();
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

async function loadBlockDefinitions(onAssetProgress = null) {
  const bootstrap = await requestJson("/api/bootstrap", {
    headers: {
      Authorization: `Bearer ${state.token}`,
    },
  });
  const data = bootstrap?.blocks || { atlases: [], blocks: [] };
  const seedsPayload = bootstrap?.seeds || { seeds: [], atlases: [] };
  const texture47Configs = bootstrap?.texture47Configs && typeof bootstrap.texture47Configs === "object"
    ? bootstrap.texture47Configs
    : {};

  state.blockDefs.clear();
  state.seedDefs.clear();
  state.atlases.clear();
  state.seedDropSpriteCache.clear();
  state.treeSpriteCache.clear();
  state.texture47.clear();
  state.crackAtlas = null;

  const texture47AtlasIds = new Set(
    Array.from(data.blocks || [])
      .filter((block) => isTexture47Block(block))
      .map((block) => block.ATLAS_ID),
  );

  const atlasSpecs = [];
  const seenAtlasIds = new Set();

  for (const atlas of data.atlases || []) {
    const atlasId = atlas?.ATLAS_ID;
    if (atlasId == null || seenAtlasIds.has(atlasId)) {
      continue;
    }
    seenAtlasIds.add(atlasId);
    atlasSpecs.push(atlas);
  }

  for (const atlas of seedsPayload.atlases || []) {
    const atlasId = atlas?.ATLAS_ID;
    if (atlasId == null || seenAtlasIds.has(atlasId)) {
      continue;
    }
    seenAtlasIds.add(atlasId);
    atlasSpecs.push(atlas);
  }

  const totalAssets = atlasSpecs.length + 1 + texture47AtlasIds.size;
  let loadedAssets = 0;
  const reportAssetProgress = (label) => {
    loadedAssets += 1;
    if (typeof onAssetProgress === "function") {
      onAssetProgress({ loaded: loadedAssets, total: totalAssets, label: String(label || "") });
    }
  };

  for (const atlas of atlasSpecs) {
    const image = await loadImage(atlas.SRC);
    state.atlases.set(atlas.ATLAS_ID, {
      ...atlas,
      image,
    });
    reportAssetProgress(`atlas ${atlas.ATLAS_ID}`);
  }

  for (const block of data.blocks || []) {
    state.blockDefs.set(block.ID, block);
  }

  for (const seed of seedsPayload.seeds || []) {
    const seedId = Number(seed?.SEED_ID);
    if (!Number.isFinite(seedId) || seedId < 0) {
      continue;
    }
    state.seedDefs.set(Math.floor(seedId), seed);
  }

  if (seedSelectHud) {
    seedSelectHud.innerHTML = "";
    const sortedSeeds = Array.from(state.seedDefs.values()).sort((a, b) => Number(a.SEED_ID || 0) - Number(b.SEED_ID || 0));
    for (const seed of sortedSeeds) {
      const option = document.createElement("option");
      const seedId = Math.floor(Number(seed.SEED_ID) || 0);
      option.value = String(seedId);
      option.textContent = `${seedId} - ${String(seed.NAME || `SEED_${seedId}`)}`;
      seedSelectHud.appendChild(option);
    }

    if (sortedSeeds.length > 0) {
      const firstSeedId = Math.floor(Number(sortedSeeds[0].SEED_ID) || 0);
      state.selectedSeedId = firstSeedId;
      seedSelectHud.value = String(firstSeedId);
    } else {
      state.selectedSeedId = -1;
    }
  }

  try {
    const crackImage = await loadImage(CRACK_ATLAS_SRC);
    state.crackAtlas = {
      image: crackImage,
      columns: CRACK_ATLAS_COLUMNS,
      rows: CRACK_ATLAS_ROWS,
      frameWidth: Math.floor(crackImage.width / CRACK_ATLAS_COLUMNS),
      frameHeight: Math.floor(crackImage.height / CRACK_ATLAS_ROWS),
    };
  } catch {
    state.crackAtlas = null;
  } finally {
    reportAssetProgress("cracks atlas");
  }

  for (const atlasId of texture47AtlasIds) {
    try {
      const image = await loadImage(`/assets/texture47/${atlasId}.png`);
      let columns = TEXTURE47_COLS;
      let rows = TEXTURE47_ROWS;
      let maskOrder = DEFAULT_TEXTURE47_VALID_MASKS;
      let maskVariants = new Map();

      try {
        const config = texture47Configs?.[atlasId] ?? null;
        const maybeColumns = Number(config?.columns);
        const maybeRows = Number(config?.rows);
        if (!Number.isNaN(maybeColumns) && maybeColumns > 0) {
          columns = Math.floor(maybeColumns);
        }
        if (!Number.isNaN(maybeRows) && maybeRows > 0) {
          rows = Math.floor(maybeRows);
        }

        if (Array.isArray(config?.maskOrder) && config.maskOrder.length > 0) {
          const normalized = config.maskOrder.map((value) => {
            const parsed = Number(value);
            return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
          });
          const hasValidMask = normalized.some((value) => Number.isInteger(value));
          if (hasValidMask) {
            maskOrder = normalized;
          }
        }

        if (config?.maskVariants && typeof config.maskVariants === "object") {
          for (const [maskKey, variantValues] of Object.entries(config.maskVariants)) {
            const mask = Number(maskKey);
            if (!Number.isInteger(mask) || mask < 0) {
              continue;
            }

            if (!Array.isArray(variantValues)) {
              continue;
            }

            const variants = variantValues
              .map((value) => Number(value))
              .filter((value) => Number.isInteger(value) && value >= 0);

            if (variants.length > 0) {
              maskVariants.set(mask, Array.from(new Set(variants)));
            }
          }
        }
      } catch {
      }

      const maskToIndex = new Map();
      let fallbackIndex = 0;
      for (let i = 0; i < maskOrder.length; i += 1) {
        const value = maskOrder[i];
        if (Number.isInteger(value) && value >= 0) {
          maskToIndex.set(value, i);
          fallbackIndex = i;
        }
      }

      if (maskToIndex.has(255)) {
        fallbackIndex = Number(maskToIndex.get(255));
      }

      if (maskVariants.size === 0) {
        for (const [maskValue, tileIndex] of maskToIndex.entries()) {
          maskVariants.set(maskValue, [tileIndex]);
        }
      }

      state.texture47.set(atlasId, {
        image,
        columns,
        rows,
        tileWidth: Math.floor(image.width / columns),
        tileHeight: Math.floor(image.height / rows),
        maskOrder,
        fallbackIndex,
        maskVariants,
        maskToIndex,
      });
    } catch (error) {
      console.warn(`47-tile texture missing for ${atlasId}:`, error.message);
    } finally {
      reportAssetProgress(`texture47 ${atlasId}`);
    }
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

  state.assetsLoaded = true;
}

function normalizeSeedTint(value) {
  const text = String(value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text) || /^#[0-9a-fA-F]{8}$/.test(text)) {
    return text.toLowerCase();
  }
  return "";
}

function buildTintedSeedSprite(image, texture, tintHex) {
  const width = Math.max(1, Math.floor(Number(texture?.w) || TILE_SIZE));
  const height = Math.max(1, Math.floor(Number(texture?.h) || TILE_SIZE));
  const sourceX = Math.floor(Number(texture?.x) || 0);
  const sourceY = Math.floor(Number(texture?.y) || 0);

  const spriteCanvas = document.createElement("canvas");
  spriteCanvas.width = width;
  spriteCanvas.height = height;
  const spriteCtx = spriteCanvas.getContext("2d");
  spriteCtx.imageSmoothingEnabled = false;
  spriteCtx.clearRect(0, 0, width, height);
  spriteCtx.drawImage(image, sourceX, sourceY, width, height, 0, 0, width, height);

  const tintColor = normalizeSeedTint(tintHex);
  if (!tintColor) {
    return spriteCanvas;
  }

  spriteCtx.globalCompositeOperation = "source-atop";
  spriteCtx.globalAlpha = 0.35;
  spriteCtx.fillStyle = tintColor;
  spriteCtx.fillRect(0, 0, width, height);
  spriteCtx.globalAlpha = 1;
  spriteCtx.globalCompositeOperation = "source-over";

  return spriteCanvas;
}

function getSeedDropSprite(seedId) {
  const normalizedSeedId = Number(seedId);
  if (!Number.isFinite(normalizedSeedId) || normalizedSeedId < 0) {
    return null;
  }

  const seed = state.seedDefs.get(Math.floor(normalizedSeedId));
  if (!seed || typeof seed !== "object") {
    return null;
  }

  const atlasId = seed.SEED_ATLAS_ID;
  const texture = seed.SEED_ATLAS_TEXTURE;
  const atlas = state.atlases.get(atlasId);
  const image = atlas?.image;
  if (!image || !texture || typeof texture !== "object") {
    return null;
  }

  const cacheKey = JSON.stringify({
    seedId: Math.floor(normalizedSeedId),
    atlasId,
    texture,
    tint: seed.SEED_TINT || "",
  });
  const cached = state.seedDropSpriteCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const sprite = buildTintedSeedSprite(image, texture, seed.SEED_TINT);
  state.seedDropSpriteCache.set(cacheKey, sprite);
  return sprite;
}

function getSeedTreeStage(seed, serverNowMs, plantedAtMs) {
  if (!seed || typeof seed !== "object") {
    return null;
  }

  const stages = Array.isArray(seed.TREE?.STAGES)
    ? seed.TREE.STAGES.filter((stage) => stage && typeof stage === "object").slice()
    : [];
  if (stages.length === 0) {
    return null;
  }

  stages.sort((a, b) => Number(a?.GROWTH_PERCENT ?? 0) - Number(b?.GROWTH_PERCENT ?? 0));

  const growSeconds = Math.max(1, Number(seed.GROWTIME) || 1);
  const elapsedMs = Math.max(0, Number(serverNowMs) - Number(plantedAtMs || 0));
  const progressPct = Math.max(0, Math.min(100, (elapsedMs / (growSeconds * 1000)) * 100));

  let active = stages[0];
  for (const stage of stages) {
    const threshold = Number(stage?.GROWTH_PERCENT ?? stage?.growth_percent ?? 0);
    if (progressPct >= threshold) {
      active = stage;
    }
  }

  return active;
}

function formatGrowthTimeRemaining(msRemaining) {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getNearbyTreeForHint() {
  if (!state.world || !state.selfId || state.plantedTrees.size === 0) {
    return null;
  }

  const me = state.players.get(state.selfId);
  if (!me) {
    return null;
  }

  const playerCenterX = Number(me.x) + 0.36;
  const playerCenterY = Number(me.y) + 0.46;
  if (!Number.isFinite(playerCenterX) || !Number.isFinite(playerCenterY)) {
    return null;
  }

  let nearest = null;
  let nearestDistSq = Infinity;
  for (const tree of state.plantedTrees.values()) {
    const dx = (Number(tree.x) + 0.5) - playerCenterX;
    const dy = (Number(tree.y) + 0.5) - playerCenterY;
    const distSq = dx * dx + dy * dy;
    if (distSq > 2.25) {
      continue;
    }

    if (distSq < nearestDistSq) {
      nearest = tree;
      nearestDistSq = distSq;
    }
  }

  return nearest;
}

function maybeShowTreeGrowthHint(nowMs) {
  const tree = getNearbyTreeForHint();
  if (!tree) {
    if (state.treeHintAnchor && Array.isArray(state.treeHintAnchor.bubbles) && state.treeHintAnchor.bubbles.length > 0) {
      const bubble = state.treeHintAnchor.bubbles[0];
      bubble.until = Math.min(Number(bubble.until) || nowMs, nowMs + TREE_HINT_FADE_OUT_MS);
    }
    state.treeHintAnchor = null;
    state.treeHintTreeId = "";
    return;
  }

  const seed = state.seedDefs.get(tree.seedId);
  if (!seed) {
    return;
  }

  const growSeconds = Math.max(1, Number(seed.GROWTIME) || 1);
  const totalMs = growSeconds * 1000;
  const elapsedMs = Math.max(0, getServerNowMs() - Number(tree.plantedAtMs || 0));
  const remainingMs = Math.max(0, totalMs - elapsedMs);
  const activeStage = getSeedTreeStage(seed, getServerNowMs(), tree.plantedAtMs);
  const stageNumber = Math.max(1, Number(activeStage?.STAGE ?? 1) || 1);

  const label = remainingMs <= 0
    ? `Stage ${stageNumber} | Tree ready`
    : `Stage ${stageNumber} | ${formatGrowthTimeRemaining(remainingMs)}`;

  const anchorX = Number(tree.x) + 0.5;
  const anchorY = Number(tree.y) - 0.1;
  const holdMs = TREE_HINT_HOLD_MS;
  const nextTreeId = String(tree.id || "");

  let anchor = state.treeHintAnchor;

  if (anchor && state.treeHintTreeId && state.treeHintTreeId !== nextTreeId) {
    if (Array.isArray(anchor.bubbles) && anchor.bubbles.length > 0) {
      const oldBubble = anchor.bubbles[0];
      oldBubble.until = Math.min(Number(oldBubble.until) || nowMs, nowMs + TREE_HINT_FADE_OUT_MS);
    }
    anchor = null;
    state.treeHintAnchor = null;
  }

  if (!anchor || !Array.isArray(anchor.bubbles)) {
    anchor = {
      x: anchorX,
      y: anchorY,
      bubbles: [
        {
          text: label,
          startedAt: nowMs,
          until: nowMs + holdMs,
          fadeWindowMs: TREE_HINT_FADE_OUT_MS,
        },
      ],
    };
    state.treeHintAnchor = anchor;
    state.treeHintTreeId = nextTreeId;
    state.transientSystemBubbles.push(anchor);
    return;
  }

  anchor.x = anchorX;
  anchor.y = anchorY;

  if (!anchor.bubbles[0]) {
    anchor.bubbles[0] = {
      text: label,
      startedAt: nowMs,
      until: nowMs + holdMs,
    };
    return;
  }

  anchor.bubbles[0].text = label;
  anchor.bubbles[0].until = nowMs + holdMs;
  anchor.bubbles[0].fadeWindowMs = TREE_HINT_FADE_OUT_MS;
  state.treeHintTreeId = nextTreeId;
}

function getTreeSprite(seed, stage) {
  const atlasId = stage?.ATLAS_ID;
  const texture = stage?.ATLAS_TEXTURE;
  const atlas = state.atlases.get(atlasId);
  const image = atlas?.image;
  if (!image || !texture || typeof texture !== "object") {
    return null;
  }

  const tint = String(seed?.TREE?.TINT || "");
  const cacheKey = JSON.stringify({ atlasId, texture, tint });
  const cached = state.treeSpriteCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const sprite = buildTintedSeedSprite(image, texture, tint);
  state.treeSpriteCache.set(cacheKey, sprite);
  return sprite;
}

function drawPlantedTrees() {
  if (!state.world || state.plantedTrees.size === 0) {
    return;
  }

  const serverNowMs = getServerNowMs();
  for (const tree of state.plantedTrees.values()) {
    const seed = state.seedDefs.get(tree.seedId);
    if (!seed) {
      continue;
    }

    const stage = getSeedTreeStage(seed, serverNowMs, tree.plantedAtMs);
    if (!stage) {
      continue;
    }

    const sprite = getTreeSprite(seed, stage);
    if (!sprite) {
      continue;
    }

    const screenX = (tree.x * TILE_SIZE - state.camera.x) * state.camera.zoom;
    const screenY = (tree.y * TILE_SIZE - state.camera.y) * state.camera.zoom;
    const drawWidth = TILE_SIZE * state.camera.zoom;
    const drawHeight = TILE_SIZE * state.camera.zoom;

    if (
      screenX + drawWidth < -8 ||
      screenY + drawHeight < -8 ||
      screenX > canvas.width + 8 ||
      screenY > canvas.height + 8
    ) {
      continue;
    }

    ctx.drawImage(sprite, screenX, screenY, drawWidth, drawHeight);
  }
}

function beginLoadingForUser(username) {
  state.chatLogLines = [];
  renderChatLog();
  appendChatLine("system", `attempting to log into ${username}...`);
  if (loadingStatus) {
    loadingStatus.textContent = "Preparing assets...";
  }
  showScreen("loading");
  setLoadingChatLogOpen(true);
}

async function ensureAssetsLoadedWithProgress() {
  if (state.assetsLoaded) {
    appendChatLine("system", "loading assets (cached)");
    return;
  }

  await loadBlockDefinitions(({ loaded, total }) => {
    appendChatLine("system", `loading assets (${loaded}/${Math.max(1, total)})`);
    if (loadingStatus) {
      loadingStatus.textContent = `Loading assets ${loaded}/${Math.max(1, total)}...`;
    }
  });
}

async function runPostLoginLoadingFlow() {
  const username = String(state.user?.username || "player");
  await ensureAssetsLoadedWithProgress();
  await loadWorldList();
  appendChatLine("system", `welcome ${username}!`);
  showScreen("world");
}

async function auth(action) {
  loginError.textContent = "";

  const username = usernameInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (!username || !password) {
    loginError.textContent = "Enter username and password.";
    return;
  }

  beginLoadingForUser(username);

  try {
    const data = await requestJson(`/api/auth/${action}`, {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    state.token = data.token;
    state.user = data.user;
    welcomeText.textContent = `Logged in as ${state.user.username}`;
    saveAuthSession(state.token, state.user);

    passwordInput.value = "";
    await runPostLoginLoadingFlow();
  } catch (error) {
    if (screens.loading?.classList.contains("active")) {
      showScreen("login");
    }
    loginError.textContent = error.message;
  }
}

async function authGuest() {
  loginError.textContent = "";
  beginLoadingForUser("guest");

  try {
    const deviceId = getGuestDeviceId();
    const data = await requestJson("/api/auth/guest", {
      method: "POST",
      body: JSON.stringify({ deviceId }),
    });

    state.token = data.token;
    state.user = data.user;
    welcomeText.textContent = `Logged in as ${state.user.username}`;
    saveAuthSession(state.token, state.user);

    usernameInput.value = "";
    passwordInput.value = "";
    await runPostLoginLoadingFlow();
  } catch (error) {
    if (screens.loading?.classList.contains("active")) {
      showScreen("login");
    }
    loginError.textContent = error.message;
  }
}

async function refreshGuestSessionIfNeeded() {
  if (!state.token || !isGuestUser(state.user)) {
    return;
  }

  const deviceId = getGuestDeviceId();
  const data = await requestJson("/api/auth/guest", {
    method: "POST",
    body: JSON.stringify({ deviceId }),
  });

  state.token = data.token;
  state.user = data.user;
  welcomeText.textContent = `Logged in as ${state.user.username}`;
  saveAuthSession(state.token, state.user);
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
    clearReconnectTimer();
    startPingTimer();
  });

  state.ws.addEventListener("close", () => {
    state.connected = false;
    gameStatus.textContent = "Disconnected";
    stopPingTimer();
    state.debugPingMs = null;
    if (state.world && state.token) {
      beginReconnectFlow();
    }
  });

  state.ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);

    const alreadyDelayed = !!msg.__simulatedDelayed;
    if (alreadyDelayed) {
      delete msg.__simulatedDelayed;
    } else {
      const simulatedDelayMs = getNetworkSimulationDelayMs();
      if (simulatedDelayMs > 0) {
        const delayedMsg = { ...msg, __simulatedDelayed: true };
        setTimeout(() => {
          if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
            return;
          }
          state.ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(delayedMsg) }));
        }, simulatedDelayMs);
        return;
      }
    }

    if (msg.type === "connected") {
      state.selfId = msg.id;
      return;
    }

    if (msg.type === "pong") {
      const sentAt = Number(msg.clientSentAt);
      if (Number.isFinite(sentAt)) {
        state.debugPingMs = Math.max(0, performance.now() - sentAt);
      }
      return;
    }

    if (msg.type === "error") {
      worldError.textContent = msg.message;
      gameStatus.textContent = msg.message;
      return;
    }

    if (msg.type === "world_snapshot") {
      state.world = msg.world;
      state.serverTimeOffsetMs = Number(msg.serverTimeMs || Date.now()) - Date.now();
      if (!Array.isArray(state.world.foreground)) {
        state.world.foreground = Array.isArray(state.world.tiles) ? state.world.tiles : [];
      }
      if (!Array.isArray(state.world.background)) {
        state.world.background = new Array(state.world.foreground.length).fill(0);
      }
      state.selfId = msg.selfId;
      state.gems = Number(msg.gems || 0);
      updateGemUi();
      state.players.clear();
      applyGemDropSnapshot(msg.world.gemDrops || []);
      applySeedDropSnapshot(msg.world.seedDrops || []);
      applyPlantedTreeSnapshot(msg.world.plantedTrees || []);
      state.tileDamage.clear();
      for (const damageState of msg.world.tileDamage || []) {
        setTileDamage(damageState);
      }
      rebuildWorldRenderCache();

      for (const player of msg.world.players) {
        initializeRemotePlayerTracking(player);
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

      appendChatLine("system", `Joined world ${msg.world.name}`);
      state.flyEnabled = false;
      state.noclipEnabled = false;

      gameStatus.textContent = `World: ${msg.world.name} | Players: ${state.players.size}`;
      showScreen("game");
      return;
    }

    if (!state.world) {
      return;
    }

    if (msg.type === "player_joined") {
      initializeRemotePlayerTracking(msg.player);
      state.players.set(msg.player.id, msg.player);
      gameStatus.textContent = `World: ${state.world.name} | Players: ${state.players.size}`;
      const joinedName = msg.player.username || "player";
      appendChatLine("system", `${joinedName} joined`);
      addTransientSystemBubble(msg.player.x, msg.player.y, `${joinedName} joined`);
      return;
    }

    if (msg.type === "player_left") {
      const leaving = state.players.get(msg.id);
      if (!leaving) {
        gameStatus.textContent = `World: ${state.world.name} | Players: ${state.players.size}`;
        return;
      }

      const username = leaving.username || "player";
      appendChatLine("system", `${username} has left.`);

      const anchorX = Number.isFinite(leaving.renderX) ? leaving.renderX : leaving.x;
      const anchorY = Number.isFinite(leaving.renderY) ? leaving.renderY : leaving.y;
      addTransientSystemBubble(anchorX, anchorY, `${username} has left.`);

      state.players.delete(msg.id);
      gameStatus.textContent = `World: ${state.world.name} | Players: ${state.players.size}`;
      return;
    }

    if (msg.type === "player_moved") {
      if (msg.id === state.selfId) {
        // Ignore routine self echoes, but allow authoritative teleport snaps.
        if (msg.teleport) {
          state.me.x = Number(msg.x) || state.me.x;
          state.me.y = Number(msg.y) || state.me.y;
          state.velocity.x = 0;
          state.velocity.y = 0;
          state.onGround = false;
          state.jumpQueued = false;

          const selfPlayer = state.players.get(state.selfId);
          if (selfPlayer) {
            selfPlayer.x = state.me.x;
            selfPlayer.y = state.me.y;
            selfPlayer.targetX = state.me.x;
            selfPlayer.targetY = state.me.y;
            selfPlayer.renderX = state.me.x;
            selfPlayer.renderY = state.me.y;
            selfPlayer.netVx = 0;
            selfPlayer.netVy = 0;
            selfPlayer.lastNetUpdateAt = performance.now();
          }
        }
        return;
      }

      const existing = state.players.get(msg.id);
      if (existing) {
        const now = performance.now();
        const prevX = existing.x;
        const prevY = existing.y;
        if (!Number.isFinite(existing.renderX) || !Number.isFinite(existing.renderY)) {
          initializeRemotePlayerTracking(existing);
        }

        const previousTargetX = Number.isFinite(existing.targetX) ? existing.targetX : existing.x;
        const previousTargetY = Number.isFinite(existing.targetY) ? existing.targetY : existing.y;
        const previousUpdateAt = Number.isFinite(existing.lastNetUpdateAt)
          ? existing.lastNetUpdateAt
          : now;
        const dtSeconds = Math.max(0.016, (now - previousUpdateAt) / 1000);

        existing.x = msg.x;
        existing.y = msg.y;
        existing.targetX = msg.x;
        existing.targetY = msg.y;
        existing.netVx = (msg.x - previousTargetX) / dtSeconds;
        existing.netVy = (msg.y - previousTargetY) / dtSeconds;
        existing.lastNetUpdateAt = now;

        const deltaX = msg.x - prevX;
        const deltaY = msg.y - prevY;
        const movedDistance = Math.hypot(deltaX, deltaY);
        if (movedDistance >= SELF_TELEPORT_SNAP_DISTANCE + SELF_RECONCILE_SNAP_DISTANCE) {
          existing.renderX = msg.x;
          existing.renderY = msg.y;
        }
      }
      return;
    }

    if (msg.type === "chat_message") {
      const username = String(msg.username || "player");
      const messageText = String(msg.message || "").trim();
      if (!messageText) {
        return;
      }

      appendChatLine("player", messageText, username);
      setPlayerChatBubble(String(msg.id || ""), messageText);
      return;
    }

    if (msg.type === "system_message") {
      const messageText = String(msg.message || "").trim();
      if (messageText) {
        appendChatLine("system", messageText);
      }
      return;
    }

    if (msg.type === "command_state") {
      state.flyEnabled = !!msg.flyEnabled;
      state.noclipEnabled = !!msg.noclipEnabled;
      return;
    }

    if (msg.type === "tile_updated" && state.world) {
      const index = msg.y * state.world.width + msg.x;
      state.world.foreground[index] = Number(msg.foreground ?? msg.tile ?? 0);
      state.world.background[index] = Number(msg.background ?? 0);
      clearTileDamageAt(msg.x, msg.y);
      updateWorldRenderTileArea(msg.x, msg.y);
      return;
    }

    if (msg.type === "tile_damage_update") {
      setTileDamage(msg);
      return;
    }

    if (msg.type === "tile_damage_clear") {
      clearTileDamageAt(Number(msg.x), Number(msg.y), msg.layer ? String(msg.layer) : null);
      return;
    }

    if (msg.type === "gem_drop_spawn") {
      upsertGemDrop(msg.drop);
      return;
    }

    if (msg.type === "gem_drop_remove") {
      removeGemDropById(msg.id);
      return;
    }

    if (msg.type === "gem_count") {
      state.gems = Number(msg.gems || 0);
      updateGemUi();
      return;
    }

    if (msg.type === "seed_drop_spawn") {
      upsertSeedDrop(msg.drop);
      return;
    }

    if (msg.type === "seed_drop_remove") {
      removeSeedDropById(msg.id);
      return;
    }

    if (msg.type === "tree_planted") {
      state.serverTimeOffsetMs = Number(msg.serverTimeMs || Date.now()) - Date.now();
      upsertPlantedTree(msg.tree);
      return;
    }

    if (msg.type === "tree_removed") {
      removePlantedTree(msg);
      return;
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

  const payloadType = String(payload?.type || "");
  if (shouldDropSimulatedPacket(payloadType)) {
    return true;
  }

  const serialized = JSON.stringify(payload);
  const simulatedDelayMs = getNetworkSimulationDelayMs();
  if (simulatedDelayMs > 0) {
    setTimeout(() => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      state.ws.send(serialized);
    }, simulatedDelayMs);
    return true;
  }

  state.ws.send(serialized);
  return true;
}

async function enterWorld(targetWorldName = null) {
  resetReconnectState();
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
  resetReconnectState();
  const leavingWorldName = state.world?.name;

  sendWs({ type: "leave_world" });
  if (leavingWorldName) {
    appendChatLine("system", `You left world ${leavingWorldName}`);
  }
  clearActiveWorldRuntimeState();
  showScreen("world");
  loadWorldList();
}

function logout() {
  leaveWorld();
  pauseMenu.setPauseMenuOpen(false);
  state.chatLogLines = [];
  renderChatLog();
  state.token = null;
  state.user = null;
  clearAuthSession();
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

seedSelectHud?.addEventListener("change", () => {
  const nextSeedId = Number(seedSelectHud.value);
  state.selectedSeedId = Number.isFinite(nextSeedId) ? Math.floor(nextSeedId) : -1;
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

chatDebug.bindControls();
pauseMenu.bindControls();
inputController.bindControls();


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

  if (state.flyEnabled) {
    let moveY = 0;
    if (state.keys.has("w") || state.keys.has("arrowup") || state.keys.has(" ")) moveY -= 1;
    if (state.keys.has("s") || state.keys.has("arrowdown")) moveY += 1;

    state.velocity.x = moveX * HORIZONTAL_SPEED;
    state.velocity.y = moveY * HORIZONTAL_SPEED;
    state.onGround = false;
    state.jumpQueued = false;

    const oldX = state.me.x;
    const oldY = state.me.y;
    const proposedX = oldX + state.velocity.x * deltaSeconds;
    const proposedY = oldY + state.velocity.y * deltaSeconds;

    if (state.noclipEnabled) {
      const maxX = Math.max(0, state.world.width - state.collider.width);
      const maxY = Math.max(0, state.world.height - state.collider.height);
      state.me.x = Math.max(0, Math.min(maxX, proposedX));
      state.me.y = Math.max(0, Math.min(maxY, proposedY));
    } else {
      state.me.x = resolveHorizontal(state.world, oldX, oldY, proposedX);
      const vertical = resolveVertical(state.world, state.me.x, oldY, proposedY, state.velocity.y);
      state.me.y = vertical.y;
      state.velocity.y = vertical.vy;
    }
  } else {
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
  }

  const me = state.players.get(state.selfId);
  if (me) {
    me.x = state.me.x;
    me.y = state.me.y;
    me.targetX = state.me.x;
    me.targetY = state.me.y;
    me.renderX = state.me.x;
    me.renderY = state.me.y;
  }

  updateRemotePlayersInterpolation(deltaSeconds);
  maybeShowTreeGrowthHint(now);

  if (now - state.lastMoveSentAt > 33) {
    sendWs({ type: "player_move", x: state.me.x, y: state.me.y });
    state.lastMoveSentAt = now;
  }

  const viewportWorldW = canvas.width / state.camera.zoom;
  const viewportWorldH = canvas.height / state.camera.zoom;
  state.camera.x = state.me.x * TILE_SIZE - viewportWorldW / 2;
  state.camera.y = state.me.y * TILE_SIZE - viewportWorldH / 2;

  const maxCameraX = Math.max(0, state.world.width * TILE_SIZE - viewportWorldW);
  const maxCameraY = Math.max(0, state.world.height * TILE_SIZE - viewportWorldH);
  state.camera.x = Math.max(0, Math.min(state.camera.x, maxCameraX));
  state.camera.y = Math.max(0, Math.min(state.camera.y, maxCameraY));
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

  const cameraX = Math.max(0, state.camera.x);
  const cameraY = Math.max(0, state.camera.y);
  const sourceX = Math.floor(cameraX);
  const sourceY = Math.floor(cameraY);
  const fracX = cameraX - sourceX;
  const fracY = cameraY - sourceY;
  const maxSourceW = state.worldRender.canvas.width - sourceX;
  const maxSourceH = state.worldRender.canvas.height - sourceY;
  // Pull a small extra margin so fractional camera offsets never expose gaps.
  const sourceW = Math.max(0, Math.min(Math.ceil(canvas.width / state.camera.zoom) + 2, maxSourceW));
  const sourceH = Math.max(0, Math.min(Math.ceil(canvas.height / state.camera.zoom) + 2, maxSourceH));

  if (sourceW <= 0 || sourceH <= 0) {
    return;
  }

  ctx.drawImage(
    state.worldRender.canvas,
    sourceX,
    sourceY,
    sourceW,
    sourceH,
    -fracX * state.camera.zoom,
    -fracY * state.camera.zoom,
    sourceW * state.camera.zoom,
    sourceH * state.camera.zoom,
  );
}

function getTileDamageKey(x, y, layer) {
  return `${layer}:${x}:${y}`;
}

function normalizeDamageLayer(layer) {
  return layer === "background" ? "background" : "foreground";
}

function setTileDamage(entry) {
  if (!entry) {
    return;
  }

  const x = Number(entry.x);
  const y = Number(entry.y);
  const hits = Number(entry.hits);
  const maxHits = Number(entry.maxHits);
  const layer = normalizeDamageLayer(entry.layer);

  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return;
  }

  if (!Number.isFinite(hits) || !Number.isFinite(maxHits) || hits <= 0 || maxHits <= 1) {
    state.tileDamage.delete(getTileDamageKey(x, y, layer));
    return;
  }

  state.tileDamage.set(getTileDamageKey(x, y, layer), {
    x,
    y,
    layer,
    hits,
    maxHits,
  });
}

function clearTileDamageAt(x, y, layer = null) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return;
  }

  if (layer) {
    state.tileDamage.delete(getTileDamageKey(x, y, normalizeDamageLayer(layer)));
    return;
  }

  state.tileDamage.delete(getTileDamageKey(x, y, "foreground"));
  state.tileDamage.delete(getTileDamageKey(x, y, "background"));
}

function drawDamageOverlays() {
  if (!state.world || state.tileDamage.size === 0 || !state.crackAtlas?.image) {
    return;
  }

  const frameWidth = Math.max(1, Number(state.crackAtlas.frameWidth) || 1);
  const frameHeight = Math.max(1, Number(state.crackAtlas.frameHeight) || 1);
  const frameCount = Math.max(1, Number(state.crackAtlas.columns) || 1);

  for (const damage of state.tileDamage.values()) {
    const progress = Math.max(0, Math.min(1, damage.hits / damage.maxHits));
    if (progress <= 0) {
      continue;
    }

    const screenX = (damage.x * TILE_SIZE - state.camera.x) * state.camera.zoom;
    const screenY = (damage.y * TILE_SIZE - state.camera.y) * state.camera.zoom;
    const size = TILE_SIZE * state.camera.zoom;

    if (
      screenX + size < -4 ||
      screenY + size < -4 ||
      screenX > canvas.width + 4 ||
      screenY > canvas.height + 4
    ) {
      continue;
    }

    const frameIndex = Math.max(0, Math.min(frameCount - 1, Math.ceil(progress * frameCount) - 1));
    const sourceX = frameIndex * frameWidth;
    const sourceY = 0;

    ctx.globalAlpha = 0.35 + progress * 0.65;
    ctx.drawImage(
      state.crackAtlas.image,
      sourceX,
      sourceY,
      frameWidth,
      frameHeight,
      screenX,
      screenY,
      size,
      size,
    );
    ctx.globalAlpha = 1;
  }
}

function drawGemDrops() {
  if (!state.world || state.gemDrops.size === 0) {
    return;
  }

  const gemAtlas = state.atlases.get(GEM_ATLAS_ID);
  const image = gemAtlas?.image;
  if (!image) {
    return;
  }

  const now = performance.now();
  for (const drop of state.gemDrops.values()) {
    const frame = getGemFrameForValue(drop.value, GEM_VALUE_TO_FRAME);
    const screenX = (drop.x * TILE_SIZE - state.camera.x) * state.camera.zoom;
    const screenY = (drop.y * TILE_SIZE - state.camera.y) * state.camera.zoom;
    const bobOffset = Math.sin(now * (drop.bobSpeed || GEM_BOB_BASE_SPEED) + (drop.bobPhase || 0))
      * (drop.bobAmplitude || GEM_BOB_BASE_AMPLITUDE_PX)
      * state.camera.zoom;
    const drawSize = getGemDrawSizeForValue(drop.value, state.camera.zoom);
    const drawX = screenX - drawSize / 2;
    const drawY = screenY - drawSize / 2 + bobOffset;

    if (
      drawX + drawSize < -8 ||
      drawY + drawSize < -8 ||
      drawX > canvas.width + 8 ||
      drawY > canvas.height + 8
    ) {
      continue;
    }

    ctx.drawImage(
      image,
      frame * GEM_TILE_SIZE,
      0,
      GEM_TILE_SIZE,
      GEM_TILE_SIZE,
      drawX,
      drawY,
      drawSize,
      drawSize,
    );
  }
}

function drawSeedDrops() {
  if (!state.world || state.seedDrops.size === 0) {
    return;
  }

  const now = performance.now();
  for (const drop of state.seedDrops.values()) {
    const sprite = getSeedDropSprite(drop.seedId);
    if (!sprite) {
      continue;
    }

    const screenX = (drop.x * TILE_SIZE - state.camera.x) * state.camera.zoom;
    const screenY = (drop.y * TILE_SIZE - state.camera.y) * state.camera.zoom;
    const bobOffset = Math.sin(now * (drop.bobSpeed || GEM_BOB_BASE_SPEED) + (drop.bobPhase || 0))
      * (drop.bobAmplitude || GEM_BOB_BASE_AMPLITUDE_PX)
      * state.camera.zoom;
    const baseSize = Math.max(sprite.width, sprite.height, 1);
    const drawSize = Math.max(8, 12 * state.camera.zoom);
    const scale = drawSize / baseSize;
    const drawWidth = sprite.width * scale;
    const drawHeight = sprite.height * scale;
    const drawX = screenX - drawWidth / 2;
    const drawY = screenY - drawHeight / 2 + bobOffset;

    if (
      drawX + drawWidth < -8 ||
      drawY + drawHeight < -8 ||
      drawX > canvas.width + 8 ||
      drawY > canvas.height + 8
    ) {
      continue;
    }

    ctx.drawImage(sprite, drawX, drawY, drawWidth, drawHeight);
  }
}

function drawPlayers() {
  const now = performance.now();
  const playerBoxW = Math.max(0.2, Number(state.collider?.width) || 0.72);
  const playerBoxH = Math.max(0.2, Number(state.collider?.height) || 0.92);
  const previousTextAlign = ctx.textAlign;
  ctx.textAlign = "center";
  for (const [, player] of state.players) {
    const drawX = Number.isFinite(player.renderX) ? player.renderX : player.x;
    const drawY = Number.isFinite(player.renderY) ? player.renderY : player.y;
    const screenX = (drawX * TILE_SIZE - state.camera.x) * state.camera.zoom;
    const screenY = (drawY * TILE_SIZE - state.camera.y) * state.camera.zoom;
    const playerDrawW = playerBoxW * TILE_SIZE * state.camera.zoom;
    const playerDrawH = playerBoxH * TILE_SIZE * state.camera.zoom;

    ctx.fillStyle = player.id === state.selfId ? "#22c55e" : "#3b82f6";
    ctx.fillRect(screenX, screenY, playerDrawW, playerDrawH);

    ctx.fillStyle = "#f9fafb";
    ctx.font = `${Math.max(10, Math.floor(12 * state.camera.zoom))}px "Segoe UI", Tahoma, sans-serif`;
    ctx.fillText(player.username ?? "player", screenX + playerDrawW * 0.5, screenY - 6 * state.camera.zoom);
    chatBubbles.drawPlayerBubbles(
      {
        x: screenX,
        y: screenY,
        width: playerDrawW,
      },
      player,
      now,
    );
  }
  ctx.textAlign = previousTextAlign;
}

function drawDebugHitboxes() {
  if (!state.world || !state.debugEnabled || !state.debugHitboxesEnabled) {
    return;
  }

  const zoom = Math.max(0.0001, state.camera.zoom);
  const cameraX = state.camera.x;
  const cameraY = state.camera.y;

  const toScreen = (worldX, worldY) => ({
    x: (worldX * TILE_SIZE - cameraX) * zoom,
    y: (worldY * TILE_SIZE - cameraY) * zoom,
  });

  const viewLeft = Math.max(0, Math.floor(cameraX / TILE_SIZE));
  const viewTop = Math.max(0, Math.floor(cameraY / TILE_SIZE));
  const viewRight = Math.min(state.world.width - 1, Math.ceil((cameraX + canvas.width / zoom) / TILE_SIZE));
  const viewBottom = Math.min(state.world.height - 1, Math.ceil((cameraY + canvas.height / zoom) / TILE_SIZE));

  ctx.save();
  ctx.lineWidth = Math.max(1, Math.round(zoom));

  // Tile bounds in view, color-coded by collision/type.
  for (let tileY = viewTop; tileY <= viewBottom; tileY += 1) {
    for (let tileX = viewLeft; tileX <= viewRight; tileX += 1) {
      const foregroundId = getTileIdAtLayer(tileX, tileY, "foreground");
      const backgroundId = getTileIdAtLayer(tileX, tileY, "background");
      if (foregroundId <= 0 && backgroundId <= 0) {
        continue;
      }

      const collisionKind = getCollisionKindAt(state.world, tileX, tileY);
      const block = foregroundId > 0 ? state.blockDefs.get(foregroundId) : null;
      const blockName = String(block?.NAME || "").toLowerCase();

      if (blockName.includes("door")) {
        ctx.strokeStyle = "rgba(16, 185, 129, 0.95)";
      } else if (collisionKind === "platform") {
        ctx.strokeStyle = "rgba(245, 158, 11, 0.95)";
      } else if (collisionKind === "solid") {
        ctx.strokeStyle = "rgba(248, 113, 113, 0.75)";
      } else if (foregroundId > 0) {
        ctx.strokeStyle = "rgba(168, 85, 247, 0.7)";
      } else {
        ctx.strokeStyle = "rgba(56, 189, 248, 0.55)";
      }

      const pos = toScreen(tileX, tileY);
      const size = TILE_SIZE * zoom;
      ctx.strokeRect(pos.x, pos.y, size, size);
    }
  }

  // Player bounds.
  for (const [, player] of state.players) {
    const playerX = Number.isFinite(player.renderX) ? player.renderX : player.x;
    const playerY = Number.isFinite(player.renderY) ? player.renderY : player.y;
    const isSelf = player.id === state.selfId;
    const boxW = state.collider.width;
    const boxH = state.collider.height;
    const pos = toScreen(playerX, playerY);
    ctx.strokeStyle = isSelf ? "rgba(34, 197, 94, 0.95)" : "rgba(96, 165, 250, 0.9)";
    ctx.strokeRect(pos.x, pos.y, boxW * TILE_SIZE * zoom, boxH * TILE_SIZE * zoom);
  }

  // Gem pickup boxes centered on drop point.
  ctx.strokeStyle = "rgba(250, 204, 21, 0.95)";
  for (const drop of state.gemDrops.values()) {
    const half = 0.16;
    const pos = toScreen(drop.x - half, drop.y - half);
    const size = half * 2 * TILE_SIZE * zoom;
    ctx.strokeRect(pos.x, pos.y, size, size);
  }

  ctx.restore();
}

function drawTransientWorldTexts() {
  const now = performance.now();
  chatBubbles.drawTransientSystemBubbles(now);
}

zoomOutBtn?.addEventListener("click", () => {
  adjustCameraZoom(-CAMERA_ZOOM_STEP);
});

zoomInBtn?.addEventListener("click", () => {
  adjustCameraZoom(CAMERA_ZOOM_STEP);
});

zoomResetBtn?.addEventListener("click", () => {
  setCameraZoom(1);
});

function loop() {
  const now = performance.now();
  if (state.debugLastFrameAt > 0) {
    const deltaMs = Math.max(1, now - state.debugLastFrameAt);
    const instantFps = 1000 / deltaMs;
    state.debugFps = state.debugFps <= 0 ? instantFps : (state.debugFps * 0.9 + instantFps * 0.1);
  }
  state.debugLastFrameAt = now;

  update();
  updateDebugInfo();

  if (screens.game.classList.contains("active")) {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!state.world) {
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "20px \"Segoe UI\", Tahoma, sans-serif";
      ctx.fillText("Loading world...", 30, 50);
    } else {
      drawWorld();
      drawDebugGrid();
      drawPlantedTrees();
      drawGemDrops();
      drawSeedDrops();
      drawDamageOverlays();
      drawPlayers();
      drawDebugHitboxes();
      drawTransientWorldTexts();
    }
  }

  requestAnimationFrame(loop);
}

(async () => {
  const existingSession = loadAuthSession();
  if (existingSession) {
    state.token = existingSession.token;
    state.user = existingSession.user;
    welcomeText.textContent = `Logged in as ${state.user.username}`;
    beginLoadingForUser(String(state.user?.username || "player"));
    try {
      await refreshGuestSessionIfNeeded();
      await runPostLoginLoadingFlow();
    } catch {
      clearAuthSession();
      state.token = null;
      state.user = null;
      showScreen("main");
    }
  } else {
    showScreen("main");
  }

  requestAnimationFrame(loop);
})();

updateZoomUi();
updateGemUi();
updateDebugUi();
updateNetworkSimInputsFromState();
