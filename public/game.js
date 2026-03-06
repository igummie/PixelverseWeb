import {
  CAMERA_ZOOM_STEP,
  CHAT_BUBBLE_FADE_MS,
  CHAT_BUBBLE_LIFETIME_MS,
  CHAT_DRAWER_HANDLE_PEEK,
  CHAT_INPUT_PANEL_HEIGHT,
  CHAT_LOG_DRAWER_HEIGHT,
  INVENTORY_DRAWER_HEIGHT,
  INVENTORY_DRAWER_HANDLE_PEEK,
  INVENTORY_GRID_SLOTS,
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
import { createWorldDropsController } from "./game/world_drops.js";
import { createDamageOverlayController } from "./game/damage_overlay.js";
import { createPhysicsController } from "./game/physics.js";
import { createWorldRenderController } from "./game/world_render.js";
import { createAssetsLoaderController } from "./game/assets_loader.js";
import { createNetworkClientController } from "./game/network_client.js";
import { createAuthWorldFlowController } from "./game/auth_world_flow.js";

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

const gameStatus = document.getElementById("gameStatus");
const gemCount = document.getElementById("gemCount");
const blockSelect = document.getElementById("blockSelect");
const itemSelectHud = document.getElementById("itemSelectHud");
const blockHudControl = document.getElementById("blockHudControl");
const seedHudControl = document.getElementById("seedHudControl"); // remains named for CSS
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
const inventoryDrawerHandle = document.getElementById("inventoryDrawerHandle");
const inventoryDrawer = document.getElementById("inventoryDrawer");
const inventoryGrid = document.getElementById("inventoryGrid");
const inventorySelectedInfo = document.getElementById("inventorySelectedInfo");
const debugOverlay = document.getElementById("debugOverlay");
const debugInfo = document.getElementById("debugInfo");
const debugGridToggle = document.getElementById("debugGridToggle");
const debugHitboxesToggle = document.getElementById("debugHitboxesToggle");
const debugCreativeToggle = document.getElementById("debugCreativeToggle");
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
  animatedBlockIds: new Set(),
  seedDefs: new Map(),
  inventorySeeds: new Map(),
  atlases: new Map(),
  seedDropSpriteCache: new Map(),
  treeSpriteCache: new Map(),
  texture47: new Map(),
  // unified selection; we used to track block vs seed id separately
  selectedItemId: -1,
  selectedItemType: "seed",
  selectedMissingSinceMs: 0,
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
  inventoryOpen: false,
  inventoryDrawerHeight: INVENTORY_DRAWER_HEIGHT,
  inventoryDrawerOffsetY: Math.max(0, INVENTORY_DRAWER_HEIGHT - INVENTORY_DRAWER_HANDLE_PEEK),
  inventoryDrawerDragging: false,
  inventoryDrawerDragStartY: 0,
  inventoryDrawerDragStartOffsetY: 0,
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
  creativeEnabled: false,
  creativePlaceType: "block",
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
  bundleFingerprint: "",
  reloadInProgress: false,
};

const worldDrops = createWorldDropsController({
  state,
  settings: {
    GEM_BOB_BASE_AMPLITUDE_PX,
    GEM_BOB_AMPLITUDE_VARIANCE_PX,
    GEM_BOB_BASE_SPEED,
    GEM_BOB_SPEED_VARIANCE,
  },
});

const damageOverlay = createDamageOverlayController({
  state,
  ctx,
  canvas,
  settings: {
    TILE_SIZE,
  },
});

const physics = createPhysicsController({
  state,
  settings: {
    EPSILON,
  },
});

const worldRender = createWorldRenderController({
  state,
  settings: {
    TILE_SIZE,
    TEXTURE47_COLS,
  },
  callbacks: {
    getAnimatedRegularTextureRect,
  },
});

const assetsLoader = createAssetsLoaderController({
  state,
  settings: {
    TILE_SIZE,
    CRACK_ATLAS_SRC,
    CRACK_ATLAS_COLUMNS,
    CRACK_ATLAS_ROWS,
    TEXTURE47_COLS,
    TEXTURE47_ROWS,
    DEFAULT_TEXTURE47_VALID_MASKS,
  },
  elements: {
    itemSelectHud,
    blockSelect,
    blockTypeInfo,
  },
  callbacks: {
    requestJson,
    isTexture47Block: worldRender.isTexture47Block,
    getTexture47IdFromBlock: worldRender.getTexture47IdFromBlock,
    blockHasRegularAnimation,
    rebuildWorldRenderCache: worldRender.rebuildWorldRenderCache,
  },
});

const networkClient = createNetworkClientController({
  state,
  settings: {
    connectTimeoutMs: 5000,
  },
  callbacks: {
    onOpen: () => {
      state.connected = true;
      gameStatus.textContent = "Connected";
      clearReconnectTimer();
      startPingTimer();
    },
    onClose: () => {
      state.connected = false;
      gameStatus.textContent = "Disconnected";
      stopPingTimer();
      state.debugPingMs = null;
      if (state.world && state.token) {
        beginReconnectFlow();
      }
    },
    onMessage: handleSocketMessage,
    getNetworkSimulationDelayMs,
    shouldDropSimulatedPacket,
  },
});

const authWorldFlow = createAuthWorldFlowController({
  state,
  elements: {
    screens,
    loadingStatus,
    loginError,
    usernameInput,
    passwordInput,
    welcomeText,
    worldError,
    worldListEl,
    worldInput,
  },
  callbacks: {
    appendChatLine,
    renderChatLog,
    showScreen,
    setLoadingChatLogOpen,
    repullGameBundle,
    loadBlockDefinitions: assetsLoader.loadBlockDefinitions,
    requestJson,
    saveAuthSession,
    getGuestDeviceId,
    isGuestUser,
    connectSocket: networkClient.connectSocket,
    sendWs: networkClient.sendWs,
    resetReconnectState,
    clearActiveWorldRuntimeState,
    clearAuthSession,
    setPauseMenuOpen: (open) => pauseMenu.setPauseMenuOpen(open),
  },
});

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
    debugCreativeToggle,
    creativeHudControls: [blockHudControl, seedHudControl, blockTypeInfo],
    gameTopbar,
    chatDrawer,
    chatInputPanel,
    chatInput,
    worldChatDrawer,
    loadingChatDrawer,
    inventoryDrawer,
  },
  settings: {
    TILE_SIZE,
    CHAT_DRAWER_HANDLE_PEEK,
    CHAT_INPUT_PANEL_HEIGHT,
    CHAT_LOG_DRAWER_HEIGHT,
    INVENTORY_DRAWER_HEIGHT,
    INVENTORY_DRAWER_HANDLE_PEEK,
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
    debugCreativeToggle,
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
    const response = await fetch(`/build/game.bundle.js?t=${Date.now()}`, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    const fingerprint = [
      response.headers.get("etag") || "",
      response.headers.get("last-modified") || "",
      response.headers.get("content-length") || "",
    ].join("|");

    const hadFingerprint = Boolean(state.bundleFingerprint);
    const changed = hadFingerprint && fingerprint && state.bundleFingerprint !== fingerprint;
    if (fingerprint) {
      state.bundleFingerprint = fingerprint;
    }

    return changed;
  } catch {
    // Ignore bundle prefetch failures during reconnect.
    return false;
  }
}

function forceHardReloadForBundleUpdate() {
  if (state.reloadInProgress) {
    return;
  }

  state.reloadInProgress = true;
  const separator = window.location.search ? "&" : "?";
  window.location.replace(`${window.location.pathname}${window.location.search}${separator}bundleReload=${Date.now()}`);
}

function clearActiveWorldRuntimeState() {
  setChatInputOpen(false);
  setChatLogOpen(false);
  setInventoryOpen(false);
  setWorldChatLogOpen(false);
  pauseMenu.setPauseMenuOpen(false);
  state.world = null;
  state.worldRender = null;
  state.gems = 0;
  updateGemUi();
  state.inventorySeeds.clear();
  state.selectedItemId = -1;
  state.selectedItemType = "seed";
  renderInventoryDrawer();
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

  const bundleUpdated = await repullGameBundle();
  if (bundleUpdated) {
    appendChatLine("system", "New client update detected. Reloading...");
    forceHardReloadForBundleUpdate();
    return true;
  }

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
    setInventoryOpen,
    adjustCameraZoom,
    setCameraZoom,
    sendWs,
    pauseMenu,
    getChatInputValue: () => chatInput?.value || "",
    getSelectedInventoryItem: () => {
      const itemId = Number(state.selectedItemId);
      if (!Number.isFinite(itemId) || itemId < 0) {
        return null;
      }
      return {
        itemType: normalizeItemType(state.selectedItemType || "seed", "seed"),
        itemId: Math.floor(itemId),
      };
    },
    getCreativePlacement: () => {
      if (!state.creativeEnabled) {
        return null;
      }

      const itemId = Number(state.selectedItemId);
      if (!Number.isFinite(itemId) || itemId < 0) {
        return null;
      }
      return {
        itemType: normalizeItemType(state.selectedItemType || "seed", "seed"),
        itemId: Math.floor(itemId),
      };
    },
    isCreativeEnabled: () => !!state.creativeEnabled,
    dropSelectedInventorySeed,
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
  return worldRender.isTexture47Block(block);
}

function getTexture47IdFromBlock(block) {
  return worldRender.getTexture47IdFromBlock(block);
}

function getTileIdAtLayer(tileX, tileY, layer = "foreground") {
  return worldRender.getTileIdAtLayer(tileX, tileY, layer);
}

function sameTexture47Group(tileX, tileY, texture47Id, layer = "foreground") {
  return worldRender.sameTexture47Group(tileX, tileY, texture47Id, layer);
}

function getTexture47Mask(tileX, tileY, texture47Id, layer = "foreground") {
  return worldRender.getTexture47Mask(tileX, tileY, texture47Id, layer);
}

function drawConnected47TileToContext(targetContext, block, drawX, drawY, layer = "foreground") {
  return worldRender.drawConnected47TileToContext(targetContext, block, drawX, drawY, layer);
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

function getInventoryDrawerHiddenOffset() {
  return hud.getInventoryDrawerHiddenOffset();
}

function applyInventoryDrawerPosition(nextOffsetY, immediate = false) {
  hud.applyInventoryDrawerPosition(nextOffsetY, immediate);
}

function setInventoryOpen(open) {
  hud.setInventoryOpen(open);
}

function setPlayerChatBubble(playerId, messageText) {
  chatBubbles.setPlayerChatBubble(playerId, messageText);
}

function addTransientSystemBubble(x, y, text, durationMs = CHAT_BUBBLE_LIFETIME_MS) {
  chatBubbles.addTransientSystemBubble(x, y, text, durationMs);
}

function applyGemDropSnapshot(drops) {
  worldDrops.applyGemDropSnapshot(drops);
}

function upsertGemDrop(entry) {
  worldDrops.upsertGemDrop(entry);
}

function removeGemDropById(dropId) {
  worldDrops.removeGemDropById(dropId);
}

function applySeedDropSnapshot(drops) {
  worldDrops.applySeedDropSnapshot(drops);
}

function upsertSeedDrop(entry) {
  worldDrops.upsertSeedDrop(entry);
}

function removeSeedDropById(dropId) {
  worldDrops.removeSeedDropById(dropId);
}

function applyPlantedTreeSnapshot(trees) {
  worldDrops.applyPlantedTreeSnapshot(trees);
}

function upsertPlantedTree(entry) {
  worldDrops.upsertPlantedTree(entry);
}

function removePlantedTree(entry) {
  worldDrops.removePlantedTree(entry);
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

function normalizeAnimFrame(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const x = Number(entry.x);
  const y = Number(entry.y);
  const w = Number(entry.w);
  const h = Number(entry.h);
  const seconds = Number(entry.seconds ?? entry.SECONDS ?? entry.duration ?? 0.15);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
    return null;
  }

  if (x < 0 || y < 0 || w <= 0 || h <= 0) {
    return null;
  }

  return {
    x: Math.floor(x),
    y: Math.floor(y),
    w: Math.floor(w),
    h: Math.floor(h),
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0.15,
  };
}

function normalizePrimaryAnimSeconds(value, fallback = 0.15) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.max(0.01, Number(numeric.toFixed(3)));
}

function blockHasRegularAnimation(block) {
  if (!block?.ATLAS_TEXTURE || typeof block.ATLAS_TEXTURE !== "object") {
    return false;
  }

  return Array.isArray(block.ANIM_FRAMES) && block.ANIM_FRAMES.length > 0;
}

function getAnimatedRegularTextureRect(block, nowMs = performance.now()) {
  if (!block?.ATLAS_TEXTURE || typeof block.ATLAS_TEXTURE !== "object") {
    return null;
  }

  const rawFrames = Array.isArray(block.ANIM_FRAMES) ? block.ANIM_FRAMES : [];
  const normalizedExtraFrames = [];
  for (const rawFrame of rawFrames) {
    const frame = normalizeAnimFrame(rawFrame);
    if (frame) {
      normalizedExtraFrames.push(frame);
    }
  }

  const primarySeconds = normalizedExtraFrames.length > 0
    ? normalizePrimaryAnimSeconds(block?.ANIM_FIRST_SECONDS, 0.15)
    : 0.15;

  const base = {
    x: Number(block.ATLAS_TEXTURE.x) || 0,
    y: Number(block.ATLAS_TEXTURE.y) || 0,
    w: Number(block.ATLAS_TEXTURE.w) || TILE_SIZE,
    h: Number(block.ATLAS_TEXTURE.h) || TILE_SIZE,
    seconds: primarySeconds,
  };

  const frames = [base];
  for (const frame of normalizedExtraFrames) {
    frames.push(frame);
  }

  if (frames.length === 1) {
    return base;
  }

  const totalSeconds = frames.reduce((sum, frame) => sum + Math.max(0.01, Number(frame.seconds) || 0.15), 0);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return base;
  }

  let cursor = (Math.max(0, nowMs) / 1000) % totalSeconds;
  for (const frame of frames) {
    const frameSeconds = Math.max(0.01, Number(frame.seconds) || 0.15);
    if (cursor < frameSeconds) {
      return frame;
    }
    cursor -= frameSeconds;
  }

  return frames[frames.length - 1];
}

function drawTileToContext(targetContext, tileId, drawX, drawY, layer = "foreground") {
  worldRender.drawTileToContext(targetContext, tileId, drawX, drawY, layer);
}

function rebuildWorldRenderCache() {
  worldRender.rebuildWorldRenderCache();
}

function updateWorldRenderTile(tileX, tileY) {
  worldRender.updateWorldRenderTile(tileX, tileY);
}

function updateWorldRenderTileArea(centerX, centerY) {
  worldRender.updateWorldRenderTileArea(centerX, centerY);
}

function getForegroundTileId(world, tileX, tileY) {
  return physics.getForegroundTileId(world, tileX, tileY);
}

function getBackgroundTileId(world, tileX, tileY) {
  return physics.getBackgroundTileId(world, tileX, tileY);
}

function getCollisionKind(tileId) {
  return physics.getCollisionKind(tileId);
}

function getCollisionKindAt(world, tileX, tileY) {
  return physics.getCollisionKindAt(world, tileX, tileY);
}

function resolveHorizontal(world, oldX, oldY, proposedX) {
  return physics.resolveHorizontal(world, oldX, oldY, proposedX);
}

function resolveVertical(world, currentX, oldY, proposedY, currentVelocityY) {
  return physics.resolveVertical(world, currentX, oldY, proposedY, currentVelocityY);
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

async function loadBlockDefinitions(onAssetProgress = null) {
  await assetsLoader.loadBlockDefinitions(onAssetProgress);
}

let definitionsReloadPromise = null;
let lastDefinitionsReloadAtMs = 0;

function maybeRefreshDefinitionsForItem(itemId, itemType) {
  const normalizedItemId = Math.floor(Number(itemId));
  if (!Number.isFinite(normalizedItemId) || normalizedItemId < 0) {
    return;
  }

  const normalizedItemType = normalizeItemType(itemType, "seed");
  if (normalizedItemType === "seed") {
    if (state.seedDefs.has(normalizedItemId)) {
      return;
    }
  } else if (normalizedItemType === "block") {
    if (state.blockDefs.has(normalizedItemId)) {
      return;
    }
  } else {
    return;
  }

  // Throttle reloads so repeated drops with unknown IDs do not spam bootstrap requests.
  const now = Date.now();
  if (definitionsReloadPromise || now - lastDefinitionsReloadAtMs < 1200) {
    return;
  }

  lastDefinitionsReloadAtMs = now;
  definitionsReloadPromise = loadBlockDefinitions().catch(() => {
    // Keep gameplay flowing; next drop/update can retry if this refresh fails.
  }).finally(() => {
    definitionsReloadPromise = null;
  });
}

function getSeedDropSprite(seedId) {
  return assetsLoader.getSeedDropSprite(seedId);
}

function getItemDropSprite(itemId, itemType = "") {
  return assetsLoader.getItemDropSprite(itemId, itemType);
}

const ALLOWED_ITEM_TYPES = new Set(["seed", "block", "furniture", "clothes"]);

function normalizeItemType(value, fallback = "seed") {
  const normalizedFallback = ALLOWED_ITEM_TYPES.has(String(fallback || "").trim().toLowerCase())
    ? String(fallback).trim().toLowerCase()
    : "seed";
  const text = String(value ?? "").trim().toLowerCase();
  return ALLOWED_ITEM_TYPES.has(text) ? text : normalizedFallback;
}

function getItemDisplayName(itemId, itemType) {
  const normalizedType = normalizeItemType(itemType);
  if (normalizedType === "block") {
    return String(state.blockDefs.get(itemId)?.NAME || `Block ${itemId}`);
  }
  if (normalizedType === "furniture") {
    return `Furniture ${itemId}`;
  }
  if (normalizedType === "clothes") {
    return `Clothes ${itemId}`;
  }
  return String(
    state.seedDefs.get(itemId)?.NAME
    || state.blockDefs.get(itemId)?.NAME
    || `Item ${itemId}`,
  );
}

function normalizeInventoryEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const itemId = Number(entry.itemId ?? entry.item_id ?? entry.seedId ?? entry.seed_id);
  const itemType = normalizeItemType(entry.itemType ?? entry.item_type ?? "seed", "seed");
  const count = Number(entry.count);
  if (!Number.isFinite(itemId) || !Number.isFinite(count)) {
    return null;
  }

  const normalizedItemId = Math.floor(itemId);
  const normalizedCount = Math.floor(count);
  if (normalizedItemId < 0 || normalizedCount <= 0) {
    return null;
  }

  return {
    key: `${itemType}:${normalizedItemId}`,
    itemType,
    itemId: normalizedItemId,
    count: normalizedCount,
  };
}

function normalizeInventoryPayload(payload) {
  const merged = new Map();
  if (!Array.isArray(payload)) {
    return merged;
  }

  for (const rawEntry of payload) {
    const entry = normalizeInventoryEntry(rawEntry);
    if (!entry) {
      continue;
    }
    merged.set(entry.key, (merged.get(entry.key) || 0) + entry.count);
  }

  return merged;
}

function getInventoryEntriesSorted() {
  return Array.from(state.inventorySeeds.entries())
    .map(([itemKey, count]) => {
      const [typePart, idPart] = String(itemKey).split(":", 2);
      const itemType = normalizeItemType(typePart || "seed", "seed");
      const itemId = Number(idPart);
      return {
        key: String(itemKey),
        itemType,
        itemId,
        count: Number(count),
      };
    })
    .filter((entry) => Number.isFinite(entry.itemId) && Number.isFinite(entry.count) && entry.count > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function getSelectedInventoryKey() {
  if (!Number.isFinite(Number(state.selectedItemId)) || state.selectedItemId < 0) {
    return "";
  }
  const type = normalizeItemType(state.selectedItemType || "seed", "seed");
  return `${type}:${Math.floor(Number(state.selectedItemId))}`;
}

function setSelectedItem(itemId, itemType = "seed") {
  const numeric = Number(itemId);
  const normalizedType = normalizeItemType(itemType, "seed");
  if (!Number.isFinite(numeric) || numeric < 0) {
    state.selectedItemId = -1;
    state.selectedItemType = "seed";
    state.selectedMissingSinceMs = 0;
    if (itemSelectHud) {
      itemSelectHud.value = "";
    }
    renderInventoryDrawer();
    return;
  }

  state.selectedItemId = Math.floor(numeric);
  state.selectedItemType = normalizedType;
  state.selectedMissingSinceMs = 0;
  if (itemSelectHud) {
    itemSelectHud.value = normalizedType === "seed" ? String(state.selectedItemId) : "";
  }
  renderInventoryDrawer();
}

function ensureSelectedItemStillValid() {
  if (state.selectedItemId < 0) {
    state.selectedMissingSinceMs = 0;
    return;
  }

  const selectedKey = getSelectedInventoryKey();
  if (selectedKey && Number(state.inventorySeeds.get(selectedKey) || 0) > 0) {
    state.selectedMissingSinceMs = 0;
    return;
  }

  const now = Date.now();
  if (!state.selectedMissingSinceMs) {
    state.selectedMissingSinceMs = now;
    return;
  }

  if (now - state.selectedMissingSinceMs < 450) {
    return;
  }

  // Do not auto-switch to a different item when the current one is depleted.
  setSelectedItem(-1);
}

function renderInventoryDrawer() {
  if (!inventoryGrid) {
    return;
  }

  const entries = getInventoryEntriesSorted();
  inventoryGrid.innerHTML = "";

  const slotCount = Math.max(INVENTORY_GRID_SLOTS, entries.length);
  for (let i = 0; i < slotCount; i += 1) {
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "inventorySlot";

    const entry = entries[i];
    if (!entry) {
      slot.classList.add("empty");
      slot.disabled = true;
      inventoryGrid.appendChild(slot);
      continue;
    }

    const isSelected = entry.key === getSelectedInventoryKey();
    if (isSelected) {
      slot.classList.add("selected");
    }

    const sprite = getItemDropSprite(entry.itemId, entry.itemType);
    if (sprite) {
      const icon = document.createElement("img");
      icon.className = "inventoryItemIcon";
      icon.alt = "";
      icon.src = sprite.toDataURL("image/png");
      slot.appendChild(icon);
    } else {
      slot.textContent = `#${entry.itemId}`;
    }

    const count = document.createElement("span");
    count.className = "inventoryItemCount";
    count.textContent = String(entry.count);
    slot.appendChild(count);

    const itemName = entry.itemType === "block"
      ? getItemDisplayName(entry.itemId, "block")
      : getItemDisplayName(entry.itemId, entry.itemType);
    slot.title = `${itemName} x${entry.count}`;
    slot.addEventListener("click", () => {
      setSelectedItem(entry.itemId, entry.itemType);
    });
    inventoryGrid.appendChild(slot);
  }

  if (inventorySelectedInfo) {
    if (state.selectedItemId < 0) {
      inventorySelectedInfo.textContent = "Selected: none";
    } else {
      const selectedKey = getSelectedInventoryKey();
      const selectedCount = Number(state.inventorySeeds.get(selectedKey) || 0);
      const selectedItemName = getItemDisplayName(state.selectedItemId, state.selectedItemType);
      inventorySelectedInfo.textContent = `Selected: ${selectedItemName} x${Math.max(0, selectedCount)}`;
    }
  }
}

function dropSelectedInventorySeed(count = 1) {
  if (!state.connected) {
    return;
  }

  const itemId = Number(state.selectedItemId);
  if (!Number.isFinite(itemId) || itemId < 0) {
    return;
  }

  const itemType = normalizeItemType(state.selectedItemType || "seed", "seed");
  sendWs({
    type: "drop_inventory_seed",
    itemType,
    itemId: Math.floor(itemId),
    count: Math.max(1, Math.floor(Number(count) || 1)),
  });
}

function applyInventorySnapshot(payload) {
  state.inventorySeeds = normalizeInventoryPayload(payload);
  ensureSelectedItemStillValid();
  renderInventoryDrawer();
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
  return assetsLoader.getTreeSprite(seed, stage);
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
  authWorldFlow.beginLoadingForUser(username);
}

async function runPostLoginLoadingFlow() {
  await authWorldFlow.runPostLoginLoadingFlow();
}

async function auth(action) {
  await authWorldFlow.auth(action);
}

async function authGuest() {
  await authWorldFlow.authGuest();
}

async function refreshGuestSessionIfNeeded() {
  await authWorldFlow.refreshGuestSessionIfNeeded();
}

async function loadWorldList() {
  await authWorldFlow.loadWorldList();
}

function handleSocketMessage(msg) {
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
    applyInventorySnapshot(msg.inventory || []);
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
    const rawDrop = msg.drop || {};
    const dropItemId = Number(rawDrop.itemId ?? rawDrop.item_id ?? rawDrop.seedId ?? rawDrop.seed_id);
    const dropItemType = rawDrop.itemType ?? rawDrop.item_type ?? "seed";
    maybeRefreshDefinitionsForItem(dropItemId, dropItemType);
    upsertSeedDrop(msg.drop);
    return;
  }

  if (msg.type === "seed_drop_remove") {
    removeSeedDropById(msg.id);
    return;
  }

  if (msg.type === "seed_collected") {
    const drops = Array.isArray(msg.drops) ? msg.drops : [];
    if (drops.length > 0) {
      const label = drops
        .map((entry) => {
          const itemId = Math.floor(Number(entry.itemId ?? entry.item_id ?? entry.seedId ?? entry.seed_id) || 0);
          const itemType = normalizeItemType(entry.itemType ?? entry.item_type ?? "seed", "seed");
          const count = Math.max(1, Math.floor(Number(entry.count) || 1));
          const itemName = getItemDisplayName(itemId, itemType);
          return `${itemName} x${count}`;
        })
        .join(", ");
      appendChatLine("system", `Picked up ${label}`);
    }
    return;
  }

  if (msg.type === "inventory_update") {
    const incomingItems = Array.isArray(msg.inventory) ? msg.inventory : [];
    for (const entry of incomingItems) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const itemId = Number(entry.itemId ?? entry.item_id ?? entry.seedId ?? entry.seed_id);
      const itemType = entry.itemType ?? entry.item_type ?? "seed";
      maybeRefreshDefinitionsForItem(itemId, itemType);
    }
    applyInventorySnapshot(msg.inventory || []);
    return;
  }

  if (msg.type === "tree_planted") {
    state.serverTimeOffsetMs = Number(msg.serverTimeMs || Date.now()) - Date.now();
    upsertPlantedTree(msg.tree);
    return;
  }

  if (msg.type === "tree_removed") {
    removePlantedTree(msg);
  }
}

function connectSocket() {
  return networkClient.connectSocket();
}

function sendWs(payload) {
  return networkClient.sendWs(payload);
}

async function enterWorld(targetWorldName = null) {
  await authWorldFlow.enterWorld(targetWorldName);
}

function leaveWorld() {
  authWorldFlow.leaveWorld();
}

function logout() {
  authWorldFlow.logout();
}

playBtn.addEventListener("click", () => showScreen("login"));
backToMainBtn.addEventListener("click", () => showScreen("main"));
loginBtn.addEventListener("click", () => auth("login"));
registerBtn.addEventListener("click", () => auth("register"));
guestBtn.addEventListener("click", authGuest);
joinWorldBtn.addEventListener("click", () => enterWorld());
refreshWorldsBtn.addEventListener("click", loadWorldList);
logoutBtn.addEventListener("click", logout);
blockSelect.addEventListener("change", () => {
  const nextId = Number(blockSelect.value);
  if (!Number.isNaN(nextId)) {
    setSelectedItem(nextId, "block");
    if (state.creativeEnabled) {
      state.creativePlaceType = "block";
    }
    const block = state.blockDefs.get(nextId);
    blockTypeInfo.textContent = block?.BLOCK_TYPE || "UNKNOWN";
  }
});

itemSelectHud?.addEventListener("change", () => {
  const nextId = Number(itemSelectHud.value);
  if (state.creativeEnabled) {
    state.creativePlaceType = "seed";
  }
  setSelectedItem(Number.isFinite(nextId) ? Math.floor(nextId) : -1, "seed");
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

inventoryDrawerHandle?.addEventListener("pointerdown", (event) => {
  if (!screens.game.classList.contains("active")) {
    return;
  }

  event.preventDefault();
  state.inventoryDrawerDragging = true;
  state.inventoryDrawerDragStartY = event.clientY;
  state.inventoryDrawerDragStartOffsetY = state.inventoryDrawerOffsetY;
  inventoryDrawerHandle.setPointerCapture?.(event.pointerId);
  inventoryDrawer?.classList.add("dragging");
});

inventoryDrawerHandle?.addEventListener("pointermove", (event) => {
  if (!state.inventoryDrawerDragging) {
    return;
  }

  event.preventDefault();
  const deltaY = event.clientY - state.inventoryDrawerDragStartY;
  applyInventoryDrawerPosition(state.inventoryDrawerDragStartOffsetY + deltaY, true);
});

const endInventoryDrawerDrag = (event) => {
  if (!state.inventoryDrawerDragging) {
    return;
  }

  state.inventoryDrawerDragging = false;
  inventoryDrawer?.classList.remove("dragging");
  inventoryDrawerHandle?.releasePointerCapture?.(event?.pointerId);
  applyInventoryDrawerPosition(state.inventoryDrawerOffsetY);
  const hiddenOffset = getInventoryDrawerHiddenOffset();
  state.inventoryOpen = state.inventoryDrawerOffsetY < hiddenOffset - 0.5;
};

inventoryDrawerHandle?.addEventListener("pointerup", endInventoryDrawerDrag);
inventoryDrawerHandle?.addEventListener("pointercancel", endInventoryDrawerDrag);
applyInventoryDrawerPosition(state.inventoryDrawerOffsetY);
renderInventoryDrawer();


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

  drawAnimatedTilesOverlay();
}

function drawAnimatedTilesOverlay() {
  if (!state.world || state.animatedBlockIds.size === 0) {
    return;
  }

  const zoom = Math.max(0.0001, state.camera.zoom);
  const startTileX = Math.max(0, Math.floor(state.camera.x / TILE_SIZE));
  const startTileY = Math.max(0, Math.floor(state.camera.y / TILE_SIZE));
  const endTileX = Math.min(state.world.width - 1, Math.ceil((state.camera.x + canvas.width / zoom) / TILE_SIZE));
  const endTileY = Math.min(state.world.height - 1, Math.ceil((state.camera.y + canvas.height / zoom) / TILE_SIZE));
  const nowMs = performance.now();

  const drawLayer = (layer) => {
    for (let tileY = startTileY; tileY <= endTileY; tileY += 1) {
      for (let tileX = startTileX; tileX <= endTileX; tileX += 1) {
        const tileId = getTileIdAtLayer(tileX, tileY, layer);
        if (!state.animatedBlockIds.has(tileId)) {
          continue;
        }

        const block = state.blockDefs.get(tileId);
        const atlas = state.atlases.get(block?.ATLAS_ID);
        const image = atlas?.image;
        if (!image) {
          continue;
        }

        const tex = getAnimatedRegularTextureRect(block, nowMs);
        if (!tex) {
          continue;
        }

        const screenX = (tileX * TILE_SIZE - state.camera.x) * zoom;
        const screenY = (tileY * TILE_SIZE - state.camera.y) * zoom;
        ctx.drawImage(
          image,
          tex.x,
          tex.y,
          tex.w,
          tex.h,
          screenX,
          screenY,
          TILE_SIZE * zoom,
          TILE_SIZE * zoom,
        );
      }
    }
  };

  drawLayer("background");
  drawLayer("foreground");
}

function setTileDamage(entry) {
  damageOverlay.setTileDamage(entry);
}

function clearTileDamageAt(x, y, layer = null) {
  damageOverlay.clearTileDamageAt(x, y, layer);
}

function drawDamageOverlays() {
  damageOverlay.drawDamageOverlays();
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
    const sprite = getItemDropSprite(drop.itemId, drop.itemType);
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

  // Seed/item pickup boxes centered on drop point.
  for (const drop of state.seedDrops.values()) {
    const itemType = String(drop.itemType || "seed").toLowerCase();
    if (itemType === "seed") {
      ctx.strokeStyle = "rgba(34, 197, 94, 0.95)";
    } else {
      ctx.strokeStyle = "rgba(99, 102, 241, 0.95)";
    }
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
