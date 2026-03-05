export function createChatDebugController({ state, screens, canvas, ctx, elements, settings, actions }) {
  const {
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
  } = elements;

  const {
    TILE_SIZE,
    MAX_CHAT_LOG_LINES,
    DEBUG_PING_INTERVAL_MS,
  } = settings;

  const {
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
  } = actions;

  function stopPingTimer() {
    if (state.pingTimerId) {
      clearInterval(state.pingTimerId);
      state.pingTimerId = null;
    }
  }

  function sendDebugPing() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    sendWs({
      type: "ping",
      clientSentAt: performance.now(),
    });
  }

  function startPingTimer() {
    stopPingTimer();
    sendDebugPing();
    state.pingTimerId = setInterval(sendDebugPing, DEBUG_PING_INTERVAL_MS);
  }

  function clampNumber(value, minValue, maxValue, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.max(minValue, Math.min(maxValue, numeric));
  }

  function updateNetworkSimInputsFromState() {
    if (debugSimPingInput) {
      debugSimPingInput.value = String(Math.round(state.netSimPingMs));
    }
    if (debugSimJitterInput) {
      debugSimJitterInput.value = String(Math.round(state.netSimJitterMs));
    }
    if (debugSimLossInput) {
      debugSimLossInput.value = String(Math.round(state.netSimLossPercent));
    }
    if (debugNetSimStats) {
      debugNetSimStats.textContent = `Net sim: ${Math.round(state.netSimPingMs)}ms +/-${Math.round(state.netSimJitterMs)}ms, loss ${Math.round(state.netSimLossPercent)}%`;
    }

    applyPingToolsVisibility();
  }

  function applyPingToolsVisibility() {
    const visible = state.debugPingToolsVisible !== false;
    debugNetSimPanel?.classList.toggle("hidden", !visible);
    if (debugPingToolsToggle) {
      debugPingToolsToggle.checked = visible;
    }
  }

  function refreshNetworkSimStateFromInputs() {
    state.netSimPingMs = clampNumber(debugSimPingInput?.value ?? state.netSimPingMs, 0, 2000, 0);
    state.netSimJitterMs = clampNumber(debugSimJitterInput?.value ?? state.netSimJitterMs, 0, 1000, 0);
    state.netSimLossPercent = clampNumber(debugSimLossInput?.value ?? state.netSimLossPercent, 0, 50, 0);
    updateNetworkSimInputsFromState();
    updateDebugInfo(true);
  }

  function getNetworkSimulationDelayMs() {
    const basePing = Math.max(0, Number(state.netSimPingMs) || 0);
    const jitter = Math.max(0, Number(state.netSimJitterMs) || 0);
    const halfRtt = basePing * 0.5;
    const randomJitter = jitter > 0 ? (Math.random() * 2 - 1) * jitter : 0;
    return Math.max(0, halfRtt + randomJitter);
  }

  function shouldDropSimulatedPacket(payloadType = "") {
    const dropPercent = Math.max(0, Number(state.netSimLossPercent) || 0);
    if (dropPercent <= 0) {
      return false;
    }

    // Keep pings flowing so debug RTT remains visible while simulating packet loss.
    if (payloadType === "ping") {
      return false;
    }

    return Math.random() < dropPercent / 100;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function renderChatLog() {
    const targets = [chatLog, worldChatLog, loadingChatLog].filter(Boolean);
    if (targets.length === 0) {
      return;
    }

    for (const target of targets) {
      target.innerHTML = "";
      for (const line of state.chatLogLines) {
        const row = document.createElement("div");
        row.className = `chatLine ${line.kind}`;
        if (line.kind === "player") {
          row.innerHTML = `<strong>${escapeHtml(line.username || "player")}</strong>: ${escapeHtml(line.text)}`;
        } else {
          row.textContent = line.text;
        }
        target.appendChild(row);
      }
      target.scrollTop = target.scrollHeight;
    }
  }

  function appendChatLine(kind, text, username = "") {
    const line = {
      kind,
      text: String(text || "").trim(),
      username: String(username || "").trim(),
      createdAt: Date.now(),
    };

    if (!line.text) {
      return;
    }

    state.chatLogLines.push(line);
    if (state.chatLogLines.length > MAX_CHAT_LOG_LINES) {
      state.chatLogLines.splice(0, state.chatLogLines.length - MAX_CHAT_LOG_LINES);
    }

    renderChatLog();
  }

  function drawDebugGrid() {
    if (!state.world || !state.debugEnabled || !state.debugGridEnabled) {
      return;
    }

    const zoom = Math.max(0.0001, state.camera.zoom);
    const worldTileSize = TILE_SIZE;
    const leftTile = Math.max(0, Math.floor(state.camera.x / worldTileSize));
    const topTile = Math.max(0, Math.floor(state.camera.y / worldTileSize));
    const rightTile = Math.min(state.world.width, Math.ceil((state.camera.x + canvas.width / zoom) / worldTileSize) + 1);
    const bottomTile = Math.min(state.world.height, Math.ceil((state.camera.y + canvas.height / zoom) / worldTileSize) + 1);

    ctx.save();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
    ctx.lineWidth = 1;

    for (let tileX = leftTile; tileX <= rightTile; tileX += 1) {
      const screenX = Math.round((tileX * worldTileSize - state.camera.x) * zoom) + 0.5;
      ctx.beginPath();
      ctx.moveTo(screenX, 0);
      ctx.lineTo(screenX, canvas.height);
      ctx.stroke();
    }

    for (let tileY = topTile; tileY <= bottomTile; tileY += 1) {
      const screenY = Math.round((tileY * worldTileSize - state.camera.y) * zoom) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, screenY);
      ctx.lineTo(canvas.width, screenY);
      ctx.stroke();
    }

    ctx.restore();
  }

  function bindControls() {
    chatToggleBtn?.addEventListener("click", () => {
      setChatLogOpen(!state.chatLogOpen);
    });

    debugToggleBtn?.addEventListener("click", () => {
      state.debugEnabled = !state.debugEnabled;
      updateDebugUi();
      updateDebugInfo(true);
    });

    debugGridToggle?.addEventListener("change", () => {
      state.debugGridEnabled = !!debugGridToggle.checked;
      updateDebugInfo(true);
    });

    debugHitboxesToggle?.addEventListener("change", () => {
      state.debugHitboxesEnabled = !!debugHitboxesToggle.checked;
      updateDebugInfo(true);
    });

    debugPingToolsToggle?.addEventListener("change", () => {
      state.debugPingToolsVisible = !!debugPingToolsToggle.checked;
      applyPingToolsVisibility();
    });

    debugSimPingInput?.addEventListener("change", refreshNetworkSimStateFromInputs);
    debugSimJitterInput?.addEventListener("change", refreshNetworkSimStateFromInputs);
    debugSimLossInput?.addEventListener("change", refreshNetworkSimStateFromInputs);

    chatDrawerHandle?.addEventListener("pointerdown", (event) => {
      if (!screens.game.classList.contains("active")) {
        return;
      }

      event.preventDefault();
      state.chatDrawerDragging = true;
      state.chatDrawerDragStartY = event.clientY;
      state.chatDrawerDragStartOffsetY = state.chatDrawerOffsetY;
      chatDrawerHandle.setPointerCapture?.(event.pointerId);
      chatDrawer?.classList.add("dragging");
    });

    chatDrawerHandle?.addEventListener("pointermove", (event) => {
      if (!state.chatDrawerDragging) {
        return;
      }

      event.preventDefault();
      const deltaY = event.clientY - state.chatDrawerDragStartY;
      applyChatDrawerPosition(state.chatDrawerDragStartOffsetY + deltaY, true);
    });

    const endChatDrawerDrag = (event) => {
      if (!state.chatDrawerDragging) {
        return;
      }

      state.chatDrawerDragging = false;
      chatDrawer?.classList.remove("dragging");
      chatDrawerHandle?.releasePointerCapture?.(event?.pointerId);

      // Keep the drawer exactly where the user dropped it (no snap open/closed).
      applyChatDrawerPosition(state.chatDrawerOffsetY);
      const hiddenOffset = getChatDrawerHiddenOffset();
      state.chatLogOpen = state.chatDrawerOffsetY > hiddenOffset + 0.5;
      if (!state.chatLogOpen && state.chatInputOpen) {
        setChatInputOpen(false);
      }
    };

    chatDrawerHandle?.addEventListener("pointerup", endChatDrawerDrag);
    chatDrawerHandle?.addEventListener("pointercancel", endChatDrawerDrag);

    applyChatDrawerPosition(state.chatDrawerOffsetY);

    worldChatDrawerHandle?.addEventListener("pointerdown", (event) => {
      if (!screens.world.classList.contains("active")) {
        return;
      }

      event.preventDefault();
      state.worldChatDrawerDragging = true;
      state.worldChatDrawerDragStartY = event.clientY;
      state.worldChatDrawerDragStartOffsetY = state.worldChatDrawerOffsetY;
      worldChatDrawerHandle.setPointerCapture?.(event.pointerId);
      worldChatDrawer?.classList.add("dragging");
    });

    worldChatDrawerHandle?.addEventListener("pointermove", (event) => {
      if (!state.worldChatDrawerDragging) {
        return;
      }

      event.preventDefault();
      const deltaY = event.clientY - state.worldChatDrawerDragStartY;
      applyWorldChatDrawerPosition(state.worldChatDrawerDragStartOffsetY + deltaY, true);
    });

    const endWorldChatDrawerDrag = (event) => {
      if (!state.worldChatDrawerDragging) {
        return;
      }

      state.worldChatDrawerDragging = false;
      worldChatDrawer?.classList.remove("dragging");
      worldChatDrawerHandle?.releasePointerCapture?.(event?.pointerId);

      // Keep the drawer exactly where the user dropped it (no snap open/closed).
      applyWorldChatDrawerPosition(state.worldChatDrawerOffsetY);
      const hiddenOffset = getWorldChatDrawerHiddenOffset();
      state.worldChatLogOpen = state.worldChatDrawerOffsetY > hiddenOffset + 0.5;
    };

    worldChatDrawerHandle?.addEventListener("pointerup", endWorldChatDrawerDrag);
    worldChatDrawerHandle?.addEventListener("pointercancel", endWorldChatDrawerDrag);

    applyWorldChatDrawerPosition(state.worldChatDrawerOffsetY);

    loadingChatDrawerHandle?.addEventListener("pointerdown", (event) => {
      if (!screens.loading.classList.contains("active")) {
        return;
      }

      event.preventDefault();
      state.loadingChatDrawerDragging = true;
      state.loadingChatDrawerDragStartY = event.clientY;
      state.loadingChatDrawerDragStartOffsetY = state.loadingChatDrawerOffsetY;
      loadingChatDrawerHandle.setPointerCapture?.(event.pointerId);
      loadingChatDrawer?.classList.add("dragging");
    });

    loadingChatDrawerHandle?.addEventListener("pointermove", (event) => {
      if (!state.loadingChatDrawerDragging) {
        return;
      }

      event.preventDefault();
      const deltaY = event.clientY - state.loadingChatDrawerDragStartY;
      applyLoadingChatDrawerPosition(state.loadingChatDrawerDragStartOffsetY + deltaY, true);
    });

    const endLoadingChatDrawerDrag = (event) => {
      if (!state.loadingChatDrawerDragging) {
        return;
      }

      state.loadingChatDrawerDragging = false;
      loadingChatDrawer?.classList.remove("dragging");
      loadingChatDrawerHandle?.releasePointerCapture?.(event?.pointerId);

      // Keep the drawer exactly where the user dropped it (no snap open/closed).
      applyLoadingChatDrawerPosition(state.loadingChatDrawerOffsetY);
      const hiddenOffset = getLoadingChatDrawerHiddenOffset();
      state.loadingChatLogOpen = state.loadingChatDrawerOffsetY > hiddenOffset + 0.5;
    };

    loadingChatDrawerHandle?.addEventListener("pointerup", endLoadingChatDrawerDrag);
    loadingChatDrawerHandle?.addEventListener("pointercancel", endLoadingChatDrawerDrag);

    applyLoadingChatDrawerPosition(state.loadingChatDrawerOffsetY);

    chatInput?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setChatInputOpen(false);
      }
    });

    applyPingToolsVisibility();
  }

  return {
    stopPingTimer,
    sendDebugPing,
    startPingTimer,
    updateNetworkSimInputsFromState,
    refreshNetworkSimStateFromInputs,
    getNetworkSimulationDelayMs,
    shouldDropSimulatedPacket,
    appendChatLine,
    renderChatLog,
    drawDebugGrid,
    bindControls,
  };
}
