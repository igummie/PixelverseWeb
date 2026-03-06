export function createNetworkClientController({ state, settings, callbacks }) {
  const { connectTimeoutMs = 5000 } = settings || {};
  const {
    onOpen,
    onClose,
    onMessage,
    getNetworkSimulationDelayMs,
    shouldDropSimulatedPacket,
  } = callbacks;

  function connectSocket() {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (state.ws && state.ws.readyState === WebSocket.CONNECTING) {
      return new Promise((resolve, reject) => {
        const onPendingOpen = () => {
          state.ws.removeEventListener("open", onPendingOpen);
          state.ws.removeEventListener("close", onPendingClose);
          resolve();
        };

        const onPendingClose = () => {
          state.ws.removeEventListener("open", onPendingOpen);
          state.ws.removeEventListener("close", onPendingClose);
          reject(new Error("Connection closed"));
        };

        state.ws.addEventListener("open", onPendingOpen);
        state.ws.addEventListener("close", onPendingClose);
      });
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    state.ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

    state.ws.addEventListener("open", () => {
      if (typeof onOpen === "function") {
        onOpen();
      }
    });

    state.ws.addEventListener("close", () => {
      if (typeof onClose === "function") {
        onClose();
      }
    });

    state.ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      const alreadyDelayed = !!msg.__simulatedDelayed;
      if (alreadyDelayed) {
        delete msg.__simulatedDelayed;
      } else {
        const simulatedDelayMs = Number(getNetworkSimulationDelayMs?.() || 0);
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

      if (typeof onMessage === "function") {
        onMessage(msg);
      }
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out connecting to server"));
      }, connectTimeoutMs);

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
    if (shouldDropSimulatedPacket?.(payloadType)) {
      return true;
    }

    const serialized = JSON.stringify(payload);
    const simulatedDelayMs = Number(getNetworkSimulationDelayMs?.() || 0);
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

  return {
    connectSocket,
    sendWs,
  };
}
