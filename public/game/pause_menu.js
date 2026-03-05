export function createPauseMenuController({ state, screens, elements, actions }) {
  const {
    pauseOverlay,
    pauseExitWorldBtn,
    pauseRespawnBtn,
    pauseOptionsBtn,
    pauseLogoutBtn,
    pauseBackBtn,
  } = elements;

  const {
    setChatInputOpen,
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
      setChatInputOpen(false);
      state.keys.clear();
      state.jumpQueued = false;
      pauseBackBtn?.focus();
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
    togglePauseMenu,
    isPauseMenuOpen,
    bindControls,
  };
}
