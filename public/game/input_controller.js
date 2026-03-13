export function createInputController({ state, screens, canvas, constants, actions }) {
  const { CAMERA_ZOOM_STEP, TILE_SIZE } = constants;
  const {
    setChatInputOpen,
    setChatLogOpen,
    setInventoryOpen,
    adjustCameraZoom,
    setCameraZoom,
    sendWs,
    pauseMenu,
    getSelectedInventoryItem,
    getCreativePlacement,
    isCreativeEnabled,
    dropSelectedInventorySeed,
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

        if (state.inventoryOpen) {
          setInventoryOpen(false);
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

      const key = event.key.toLowerCase();

      if (screens.game.classList.contains("active")) {
        if (key === "i") {
          event.preventDefault();
          setInventoryOpen(!state.inventoryOpen);
          return;
        }

        if (key === "q" && !event.repeat) {
          event.preventDefault();
          dropSelectedInventorySeed?.(1);
          return;
        }

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
        return;
      }

      if (isRightClick) {
        const creativeEnabled = !!isCreativeEnabled?.();
        if (creativeEnabled) {
          const creativePlacement = getCreativePlacement?.() || null;
          const creativeType = String(creativePlacement?.itemType || "").toLowerCase();
          const creativeItemId = Number(creativePlacement?.itemId);
          if (!Number.isFinite(creativeItemId) || creativeItemId < 0) {
            return;
          }

          if (creativeType === "seed") {
            sendWs({
              type: "plant_seed",
              x: tileX,
              y: tileY,
              seedId: Math.floor(creativeItemId),
              creative: true,
            });
            return;
          }

          sendWs({
            type: "set_tile",
            action: "place",
            x: tileX,
            y: tileY,
            tile: Math.floor(creativeItemId),
            creative: true,
          });
          return;
        }

        const selectedItem = getSelectedInventoryItem?.() || null;
        const itemType = String(selectedItem?.itemType || "").toLowerCase();
        const itemId = Number(selectedItem?.itemId);
        if (!Number.isFinite(itemId) || itemId < 0) {
          return;
        }

        if (itemType === "seed") {
          sendWs({
            type: "plant_seed",
            x: tileX,
            y: tileY,
            seedId: Math.floor(itemId),
          });
          return;
        }

        if (itemType === "block") {
          sendWs({
            type: "set_tile",
            action: "place",
            x: tileX,
            y: tileY,
            tile: Math.floor(itemId),
            itemType: "block",
            itemId: Math.floor(itemId),
          });
          return;
        }

        return;
      } else {
        // check for a pinata at this location first
        for (const pinata of state.pinatas.values()) {
          if (Math.floor(pinata.x) === tileX && Math.floor(pinata.y) === tileY) {
            sendWs({ type: "pinata_hit", id: pinata.id });
            return;
          }
        }

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
