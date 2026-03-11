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

  function beginLoadingForUser(username) {    console.log(`[auth] begin loading for ${username}`);    // do not wipe existing log; keep historical messages across reconnects
    renderChatLog(true);
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
    console.log("[auth] begin post-login flow for", username);
    await ensureAssetsLoadedWithProgress();
    console.log("[auth] assets loaded");
    await loadWorldList();
    console.log("[auth] world list loaded");
    appendChatLine("system", `welcome ${username}!`);
    showScreen("world");

    // remove focus from the world name field to stop any pending key events
    // (like the Enter that logged the user in) from immediately firing our
    // "join" handler. the player can click or tab into it when they're ready.
    try {
      worldInput.blur();
    } catch {}

    // if we have a remembered world (from before reload), log it but do *not* auto-enter.
    //
    // a recent regression caused the client to immediately re‑join the last world on
    // *every* page load. that meant even first‑time visitors would wind up on the
    // game canvas with a WS connection attempt (HUD showed “Connecting...” but no
    // UI, since the user never clicked anything). the storage-clearing steps we
    // recommend to players don't touch sessionStorage in some browsers, so the
    // value could persist across visits and trigger the behaviour for innocents.
    //
    // Instead, remove the remembered value and leave the user on world selection.
    // They can click the button themself if they actually want to re‑enter the
    // previous world.
    try {
      const last = sessionStorage.getItem("lastWorld");
      if (last) {
        sessionStorage.removeItem("lastWorld");
        appendChatLine("system", `remembered world ${last} – use the \"Enter World\" button to join.`);
      }
    } catch {}  }

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
      console.log("[auth] sending request", action, {username});
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
      console.error("auth() caught error", error);
      console.error(error.stack);
      if (screens.loading?.classList.contains("active")) {
        showScreen("login");
      }
      // show only the message; stack is in console
      loginError.textContent = error.message;
    }
  }

  async function authGuest() {
    loginError.textContent = "";
    beginLoadingForUser("guest");

    try {
      console.log("[auth] guest login");
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
      console.error("authGuest() caught error", error);
      console.error(error.stack);
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

  // options may include reconnectX/reconnectY coordinates when rejoining after
  // a dropped connection. only used by reconnect logic in game.js.
  async function enterWorld(targetWorldName = null, options = {}) {
    console.log("[auth] enterWorld invoked", targetWorldName, options);
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

    const payload = { type: "join_world", world: worldName, token: state.token };
    if (options.reconnectX != null) payload.reconnectX = options.reconnectX;
    if (options.reconnectY != null) payload.reconnectY = options.reconnectY;

    const ok = sendWs(payload);
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
    renderChatLog(true);
    state.token = null;
    state.user = null;
    clearAuthSession();
    // also forget the last world stored in sessionStorage; otherwise the next
    // visitor using the same browser/tab could be whisked straight into a world
    // ahead of time.
    try {
      sessionStorage.removeItem("lastWorld");
    } catch {}
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
