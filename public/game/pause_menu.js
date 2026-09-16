export function createPauseMenuController({ state, screens, elements, actions }) {
  const {
    pauseOverlay,
    pauseWorldName,
    pausePlayerCount,
    pauseWorldCreated,
    pauseWorldBio,
    pauseExitWorldBtn,
    pauseRespawnBtn,
    pauseOptionsBtn,
    pauseLogoutBtn,
    pauseBackBtn,
  } = elements;

  const {
    sendWs,
    updateDebugUi,
    updateDebugInfo,
    appendChatLine,
    leaveWorld,
    logout,
  } = actions;

  function setPauseMenuOpen(open) {
    const nextOpen = !!open;
    state.pauseMenuOpen = nextOpen;
    pauseOverlay?.classList.toggle("hidden", !nextOpen);

    if (nextOpen) {
      updatePauseInfo();
      state.keys.clear();
      state.jumpQueued = false;
      pauseBackBtn?.focus();
    }
  }

  function updatePauseInfo() {
    if (pauseWorldName) {
      pauseWorldName.textContent = state.world?.name || "No world";
    }
    if (pausePlayerCount) {
      pausePlayerCount.textContent = `Players: ${state.players.size}`;
    }
    if (pauseWorldCreated) {
      const createdAt = Number(state.world?.createdAt ?? state.world?.created_at ?? 0);
      pauseWorldCreated.textContent = Number.isFinite(createdAt) && createdAt > 0
        ? `Created: ${new Date(createdAt * 1000).toLocaleDateString()}`
        : "Created: Unknown";
    }
    if (pauseWorldBio) {
      const worldBio = state.world?.motd || state.world?.bio || state.world?.description;
      pauseWorldBio.textContent = String(worldBio || "No world bio available.").trim();
    }
  }

  function togglePauseMenu() {
    if (!screens.game.classList.contains("active")) {
      return;
    }
    setPauseMenuOpen(!state.pauseMenuOpen);
  }

  function isPauseMenuOpen() {
    return !!state.pauseMenuOpen;
  }

  function respawnInCurrentWorld() {
    if (!state.world) {
      return;
    }
    sendWs({ type: "respawn" });
  }

  function openPauseOptions() {
    state.debugEnabled = !state.debugEnabled;
    updateDebugUi();
    updateDebugInfo(true);
    appendChatLine("system", `Options: debug ${state.debugEnabled ? "enabled" : "disabled"}.`);
  }

  function bindControls() {
    pauseBackBtn?.addEventListener("click", () => {
      setPauseMenuOpen(false);
    });

    pauseExitWorldBtn?.addEventListener("click", () => {
      setPauseMenuOpen(false);
      leaveWorld();
    });

    pauseRespawnBtn?.addEventListener("click", () => {
      setPauseMenuOpen(false);
      respawnInCurrentWorld();
    });

    pauseOptionsBtn?.addEventListener("click", () => {
      setPauseMenuOpen(false);
      openPauseOptions();
    });

    pauseLogoutBtn?.addEventListener("click", () => {
      setPauseMenuOpen(false);
      logout();
    });

    pauseOverlay?.addEventListener("click", (event) => {
      if (event.target === pauseOverlay) {
        setPauseMenuOpen(false);
      }
    });
  }

  return {
    setPauseMenuOpen,
    updatePauseInfo,
    togglePauseMenu,
    isPauseMenuOpen,
    bindControls,
  };
}
