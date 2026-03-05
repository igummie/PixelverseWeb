export function createInputController({ state, screens, canvas, constants, actions }) {
  const { CAMERA_ZOOM_STEP, TILE_SIZE } = constants;
  const {
    setChatInputOpen,
    setChatLogOpen,
    adjustCameraZoom,
    setCameraZoom,
    sendWs,
    pauseMenu,
    getSelectedSeedId,
  } = actions;

  function bindControls() {
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && screens.game.classList.contains("active")) {
        event.preventDefault();
        if (pauseMenu.isPauseMenuOpen()) {
          pauseMenu.setPauseMenuOpen(false);
          return;
        }

        if (state.chatInputOpen) {
          setChatInputOpen(false);
          return;
        }

        pauseMenu.togglePauseMenu();
        return;
      }

      if (pauseMenu.isPauseMenuOpen()) {
        event.preventDefault();
        return;
      }

      if (screens.game.classList.contains("active") && event.key === "Enter") {
        event.preventDefault();

        if (state.chatInputOpen) {
          const nextMessage = String(actions.getChatInputValue?.() || "").trim();
          if (nextMessage.length > 0) {
            sendWs({ type: "chat_message", message: nextMessage });
          }
          setChatInputOpen(false);
        } else {
          setChatLogOpen(true);
          setChatInputOpen(true);
        }
        return;
      }

      if (state.chatInputOpen) {
        return;
      }

      if (screens.game.classList.contains("active")) {
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          adjustCameraZoom(CAMERA_ZOOM_STEP);
          return;
        }

        if (event.key === "-" || event.key === "_") {
          event.preventDefault();
          adjustCameraZoom(-CAMERA_ZOOM_STEP);
          return;
        }

        if (event.key === "0") {
          event.preventDefault();
          setCameraZoom(1);
          return;
        }
      }

      const key = event.key.toLowerCase();
      if (!event.repeat && (key === " " || (!state.flyEnabled && (key === "w" || key === "arrowup")))) {
        event.preventDefault();
        state.jumpQueued = true;
      }

      state.keys.add(key);
    });

    document.addEventListener("keyup", (event) => {
      if (pauseMenu.isPauseMenuOpen()) {
        return;
      }

      if (state.chatInputOpen && event.key.toLowerCase() !== "escape") {
        return;
      }
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

      if (event.button === 1) {
        event.preventDefault();
      }

      const worldMouseX = state.camera.x + state.mouse.x / state.camera.zoom;
      const worldMouseY = state.camera.y + state.mouse.y / state.camera.zoom;
      const tileX = Math.floor(worldMouseX / TILE_SIZE);
      const tileY = Math.floor(worldMouseY / TILE_SIZE);

      if (tileX < 0 || tileX >= state.world.width || tileY < 0 || tileY >= state.world.height) {
        return;
      }

      const isRightClick = event.button === 2;
      const isMiddleClick = event.button === 1;
      if (isMiddleClick) {
        const seedId = Number(getSelectedSeedId?.());
        if (!Number.isFinite(seedId) || seedId < 0) {
          return;
        }
        sendWs({
          type: "plant_seed",
          x: tileX,
          y: tileY,
          seedId: Math.floor(seedId),
        });
      } else if (isRightClick) {
        sendWs({
          type: "set_tile",
          action: "place",
          x: tileX,
          y: tileY,
          tile: state.selectedBlockId,
        });
      } else {
        sendWs({
          type: "set_tile",
          action: "break",
          x: tileX,
          y: tileY,
        });
      }
    });

    canvas.addEventListener(
      "wheel",
      (event) => {
        if (!screens.game.classList.contains("active")) {
          return;
        }

        event.preventDefault();
        const direction = event.deltaY > 0 ? -1 : 1;
        adjustCameraZoom(direction * CAMERA_ZOOM_STEP);
      },
      { passive: false },
    );
  }

  return {
    bindControls,
  };
}
