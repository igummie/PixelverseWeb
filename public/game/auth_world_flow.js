export function createAuthWorldFlowController({ state, elements, callbacks }) {
  const {
    screens,
    loadingStatus,
    loginError,
    usernameInput,
    passwordInput,
    welcomeText,
    worldError,
    worldListEl,
    worldInput,
  } = elements;

  const {
    appendChatLine,
    renderChatLog,
    showScreen,
    setLoadingChatLogOpen,
    repullGameBundle,
    loadBlockDefinitions,
    requestJson,
    saveAuthSession,
    getGuestDeviceId,
    isGuestUser,
    connectSocket,
    sendWs,
    resetReconnectState,
    clearActiveWorldRuntimeState,
    clearAuthSession,
    setPauseMenuOpen,
  } = callbacks;

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
    appendChatLine("system", "checking latest game bundle...");
    if (loadingStatus) {
      loadingStatus.textContent = "Checking latest game bundle...";
    }
    await repullGameBundle?.();

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

    // if we have a remembered world (from before reload), auto-enter it at the door
    try {
      const last = sessionStorage.getItem("lastWorld");
      if (last && state.token) {
        sessionStorage.removeItem("lastWorld");
        appendChatLine("system", `continuing in world ${last}...`);
        await enterWorld(last);
      }
    } catch {}
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
    } else {
      try {
        sessionStorage.setItem("lastWorld", worldName);
      } catch {}
    }
  }

  function leaveWorld() {
    resetReconnectState();
    const leavingWorldName = state.world?.name;

    sendWs({ type: "leave_world" });
    if (leavingWorldName) {
      appendChatLine("system", `You left world ${leavingWorldName}`);
    }
    try {
      sessionStorage.removeItem("lastWorld");
    } catch {}
    clearActiveWorldRuntimeState();
    showScreen("world");
    loadWorldList();
  }

  function logout() {
    leaveWorld();
    setPauseMenuOpen(false);
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

  return {
    beginLoadingForUser,
    runPostLoginLoadingFlow,
    auth,
    authGuest,
    refreshGuestSessionIfNeeded,
    loadWorldList,
    enterWorld,
    leaveWorld,
    logout,
  };
}
