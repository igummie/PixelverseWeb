export function createHudController({ state, screens, canvas, ctx, elements, settings }) {
  const {
    zoomLevel,
    gemCount,
    debugOverlay,
    debugInfo,
    debugGridToggle,
    debugHitboxesToggle,
    debugCreativeToggle,
    creativeHudControls,
    gameTopbar,
    chatDrawer,
    chatInputPanel,
    chatInput,
    worldChatDrawer,
    loadingChatDrawer,
    inventoryDrawer,
    debugInventorySlotsInput,
  } = elements;

  const {
    TILE_SIZE,
    CHAT_DRAWER_HANDLE_PEEK,
    CHAT_INPUT_PANEL_HEIGHT,
    CHAT_LOG_DRAWER_HEIGHT,
    INVENTORY_DRAWER_HEIGHT,
    INVENTORY_DRAWER_HANDLE_PEEK,
    DEBUG_INFO_REFRESH_MS,
  } = settings;

  function updateZoomUi() {
    if (!zoomLevel) {
      return;
    }
    zoomLevel.textContent = `Zoom ${state.camera.zoom.toFixed(2)}x`;
  }

  function updateGemUi() {
    if (!gemCount) {
      return;
    }
    gemCount.textContent = `Gems: ${Math.max(0, Math.floor(Number(state.gems) || 0))}`;
  }

  function updateDebugUi() {
    debugOverlay?.classList.toggle("hidden", !state.debugEnabled);
    if (debugGridToggle) {
      debugGridToggle.checked = !!state.debugGridEnabled;
    }
    if (debugHitboxesToggle) {
      debugHitboxesToggle.checked = !!state.debugHitboxesEnabled;
    }
    if (debugCreativeToggle) {
      debugCreativeToggle.checked = !!state.creativeEnabled;
    }
    if (Array.isArray(creativeHudControls)) {
      for (const control of creativeHudControls) {
        control?.classList.toggle("hidden", !state.creativeEnabled);
      }
    }
    if (debugInventorySlotsInput) {
      debugInventorySlotsInput.value = String(Number(state.inventorySlotLimit) || 20);
    }
  }

  function updateDebugInfo(force = false) {
    if (!state.debugEnabled || !debugInfo) {
      return;
    }

    const now = performance.now();
    if (!force && now - state.debugLastInfoAt < DEBUG_INFO_REFRESH_MS) {
      return;
    }
    state.debugLastInfoAt = now;

    const worldName = state.world?.name || "-";
    const worldW = Number(state.world?.width || 0);
    const worldH = Number(state.world?.height || 0);
    const playerTileX = Math.floor(state.me.x);
    const playerTileY = Math.floor(state.me.y);
    const mouseWorldX = state.camera.x + state.mouse.x / Math.max(0.0001, state.camera.zoom);
    const mouseWorldY = state.camera.y + state.mouse.y / Math.max(0.0001, state.camera.zoom);
    const hoveredTileX = Math.floor(mouseWorldX / TILE_SIZE);
    const hoveredTileY = Math.floor(mouseWorldY / TILE_SIZE);
    const hoverTileInBounds =
      hoveredTileX >= 0 && hoveredTileX < worldW && hoveredTileY >= 0 && hoveredTileY < worldH;
    const hoverTileText = hoverTileInBounds ? `${hoveredTileX}, ${hoveredTileY}` : "out";
    const pingText = Number.isFinite(state.debugPingMs) ? `${Math.round(state.debugPingMs)}ms` : "--";
    const gemDropCount = Number(state.gemDrops?.size || 0);
    const itemDropCount = Number(state.seedDrops?.size || 0);
    const totalDropCount = gemDropCount + itemDropCount;

    debugInfo.textContent = [
      `world: ${worldName} (${worldW}x${worldH})`,
      `players: ${state.players.size}  gems: ${Math.floor(Number(state.gems) || 0)}`,
      `pos: ${state.me.x.toFixed(3)}, ${state.me.y.toFixed(3)}  tile: ${playerTileX}, ${playerTileY}`,
      `vel: ${state.velocity.x.toFixed(3)}, ${state.velocity.y.toFixed(3)}  onGround: ${state.onGround}`,
      `camera: ${state.camera.x.toFixed(2)}, ${state.camera.y.toFixed(2)}  zoom: ${state.camera.zoom.toFixed(2)}x`,
      `mouse(tile): ${hoverTileText}`,
      `fps: ${state.debugFps.toFixed(1)}  ping: ${pingText}  grid: ${state.debugGridEnabled ? "on" : "off"}  hitboxes: ${state.debugHitboxesEnabled ? "on" : "off"}  creative: ${state.creativeEnabled ? "on" : "off"}`,
      `drops: ${totalDropCount} (gems ${gemDropCount}, items ${itemDropCount})  damageTiles: ${state.tileDamage.size}`,
    ].join("\n");
  }

  function getChatDrawerMaxHeight() {
    return CHAT_LOG_DRAWER_HEIGHT + (state.chatInputOpen ? CHAT_INPUT_PANEL_HEIGHT : 0);
  }

  function getChatDrawerHiddenOffset() {
    const drawerHeight = getChatDrawerMaxHeight();
    return -(drawerHeight - CHAT_DRAWER_HANDLE_PEEK);
  }

  function updateDebugOverlayPosition() {
    if (!debugOverlay) {
      return;
    }

    const topbarHeight = gameTopbar ? gameTopbar.offsetHeight : 58;
    const visibleDrawerHeight = Math.max(0, state.chatDrawerHeight + state.chatDrawerOffsetY);
    const drawerPushDown = Math.max(0, visibleDrawerHeight - CHAT_DRAWER_HANDLE_PEEK);
    const debugTop = topbarHeight + 10 + drawerPushDown;
    debugOverlay.style.top = `${Math.round(debugTop)}px`;
  }

  function applyChatDrawerPosition(nextOffsetY, immediate = false) {
    const drawerHeight = getChatDrawerMaxHeight();
    const hiddenOffset = getChatDrawerHiddenOffset();
    state.chatDrawerHeight = drawerHeight;
    state.chatDrawerOffsetY = Math.max(hiddenOffset, Math.min(0, nextOffsetY));

    if (chatDrawer) {
      if (immediate) {
        chatDrawer.classList.add("dragging");
      } else {
        chatDrawer.classList.remove("dragging");
      }
      chatDrawer.style.height = `${drawerHeight}px`;
      chatDrawer.style.transform = `translateY(${state.chatDrawerOffsetY}px)`;
    }

    updateDebugOverlayPosition();
  }

  function setChatLogOpen(open) {
    state.chatLogOpen = !!open;

    if (!state.chatLogOpen) {
      state.chatInputOpen = false;
    }

    chatInputPanel?.classList.toggle("hidden", !state.chatInputOpen);
    const targetOffset = state.chatLogOpen ? 0 : getChatDrawerHiddenOffset();
    applyChatDrawerPosition(targetOffset);
  }

  function setChatInputOpen(open) {
    state.chatInputOpen = !!open;
    chatInputPanel?.classList.toggle("hidden", !state.chatInputOpen);

    if (state.chatInputOpen) {
      state.chatLogOpen = true;
    }

    const targetOffset = state.chatLogOpen ? 0 : getChatDrawerHiddenOffset();
    applyChatDrawerPosition(targetOffset);

    if (state.chatInputOpen) {
      chatInput?.focus();
    } else if (chatInput) {
      chatInput.value = "";
    }
  }

  function getWorldChatDrawerHiddenOffset() {
    return -(CHAT_LOG_DRAWER_HEIGHT - CHAT_DRAWER_HANDLE_PEEK);
  }

  function applyWorldChatDrawerPosition(nextOffsetY, immediate = false) {
    const hiddenOffset = getWorldChatDrawerHiddenOffset();
    state.worldChatDrawerHeight = CHAT_LOG_DRAWER_HEIGHT;
    state.worldChatDrawerOffsetY = Math.max(hiddenOffset, Math.min(0, nextOffsetY));

    if (worldChatDrawer) {
      if (immediate) {
        worldChatDrawer.classList.add("dragging");
      } else {
        worldChatDrawer.classList.remove("dragging");
      }
      worldChatDrawer.style.height = `${CHAT_LOG_DRAWER_HEIGHT}px`;
      worldChatDrawer.style.transform = `translateY(${state.worldChatDrawerOffsetY}px)`;
    }
  }

  function setWorldChatLogOpen(open) {
    state.worldChatLogOpen = !!open;
    const targetOffset = state.worldChatLogOpen ? 0 : getWorldChatDrawerHiddenOffset();
    applyWorldChatDrawerPosition(targetOffset);
  }

  function getLoadingChatDrawerHiddenOffset() {
    return -(CHAT_LOG_DRAWER_HEIGHT - CHAT_DRAWER_HANDLE_PEEK);
  }

  function applyLoadingChatDrawerPosition(nextOffsetY, immediate = false) {
    const hiddenOffset = getLoadingChatDrawerHiddenOffset();
    state.loadingChatDrawerHeight = CHAT_LOG_DRAWER_HEIGHT;
    state.loadingChatDrawerOffsetY = Math.max(hiddenOffset, Math.min(0, nextOffsetY));

    if (loadingChatDrawer) {
      if (immediate) {
        loadingChatDrawer.classList.add("dragging");
      } else {
        loadingChatDrawer.classList.remove("dragging");
      }
      loadingChatDrawer.style.height = `${CHAT_LOG_DRAWER_HEIGHT}px`;
      loadingChatDrawer.style.transform = `translateY(${state.loadingChatDrawerOffsetY}px)`;
    }
  }

  function setLoadingChatLogOpen(open) {
    state.loadingChatLogOpen = !!open;
    const targetOffset = state.loadingChatLogOpen ? 0 : getLoadingChatDrawerHiddenOffset();
    applyLoadingChatDrawerPosition(targetOffset);
  }

  function resizeCanvas() {
    if (!screens.game.classList.contains("active")) {
      return;
    }

    const topbarHeight = gameTopbar ? gameTopbar.offsetHeight : 58;
    screens.game.style.setProperty("--hud-height", `${topbarHeight}px`);

    // account for devicePixelRatio so that zooming the browser (or using
    // a high‑DPI monitor) doesn’t leave the internal drawing surface at a
    // different resolution.  If we simply set width/height to CSS pixels the
    // browser will scale the canvas visually and small rounding errors when
    // we compute tile positions can make layers appear to hop around.
    const dpr = window.devicePixelRatio || 1;
    // measure the canvas itself; this avoids any discrepancies between CSS
    // `100vw` and window.innerWidth caused by scrollbars.  Using the raw
    // client rect ensures the backing store matches the visible element exactly.
    const rect = canvas.getBoundingClientRect();
    const cw = rect.width;
    const ch = Math.max(1, rect.height);
    // use ceil rather than round to ensure backing surface is at least as
    // large as the CSS box; rounding down by half a pixel could produce a
    // one‑pixel strip of untranslated area at the right/bottom edges.
    canvas.width = Math.ceil(cw * dpr);
    canvas.height = Math.ceil(ch * dpr);
    // scale future drawing operations automatically
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Resizing resets canvas context state, so restore pixel-art rendering.
    ctx.imageSmoothingEnabled = false;
    updateDebugOverlayPosition();
  }

  function getInventoryDrawerHiddenOffset() {
    return Math.max(0, INVENTORY_DRAWER_HEIGHT - INVENTORY_DRAWER_HANDLE_PEEK);
  }

  function applyInventoryDrawerPosition(nextOffsetY, immediate = false) {
    const hiddenOffset = getInventoryDrawerHiddenOffset();
    state.inventoryDrawerHeight = INVENTORY_DRAWER_HEIGHT;
    state.inventoryDrawerOffsetY = Math.max(0, Math.min(hiddenOffset, nextOffsetY));

    if (inventoryDrawer) {
      if (immediate) {
        inventoryDrawer.classList.add("dragging");
      } else {
        inventoryDrawer.classList.remove("dragging");
      }
      inventoryDrawer.style.height = `${INVENTORY_DRAWER_HEIGHT}px`;
      inventoryDrawer.style.transform = `translateY(${state.inventoryDrawerOffsetY}px)`;
    }
  }

  function setInventoryOpen(open) {
    state.inventoryOpen = !!open;
    const targetOffset = state.inventoryOpen ? 0 : getInventoryDrawerHiddenOffset();
    applyInventoryDrawerPosition(targetOffset);
  }

  return {
    updateZoomUi,
    updateGemUi,
    updateDebugUi,
    updateDebugInfo,
    getChatDrawerMaxHeight,
    getChatDrawerHiddenOffset,
    updateDebugOverlayPosition,
    applyChatDrawerPosition,
    setChatLogOpen,
    setChatInputOpen,
    getWorldChatDrawerHiddenOffset,
    applyWorldChatDrawerPosition,
    setWorldChatLogOpen,
    getLoadingChatDrawerHiddenOffset,
    applyLoadingChatDrawerPosition,
    setLoadingChatLogOpen,
    getInventoryDrawerHiddenOffset,
    applyInventoryDrawerPosition,
    setInventoryOpen,
    resizeCanvas,
  };
}
