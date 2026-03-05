export function createChatBubblesController({ state, ctx, canvas, settings }) {
  const {
    TILE_SIZE,
    CHAT_BUBBLE_FADE_MS,
    CHAT_BUBBLE_LIFETIME_MS,
    LEAVE_TEXT_FADE_MS,
  } = settings;

  function ensurePlayerBubbleQueue(player) {
    if (!player || typeof player !== "object") {
      return;
    }
    if (!Array.isArray(player.chatBubbles)) {
      player.chatBubbles = [];
    }
  }

  function pushBubbleToQueue(queue, text, lifetimeMs = CHAT_BUBBLE_LIFETIME_MS) {
    if (!Array.isArray(queue)) {
      return;
    }

    const trimmed = String(text || "").trim();
    if (!trimmed) {
      return;
    }

    const now = performance.now();
    queue.push({
      text: trimmed,
      startedAt: now,
      until: now + Math.max(300, Number(lifetimeMs) || CHAT_BUBBLE_LIFETIME_MS),
    });

    while (queue.length > 4) {
      queue.shift();
    }
  }

  function setPlayerChatBubble(playerId, messageText) {
    const player = state.players.get(playerId);
    if (!player) {
      return;
    }

    ensurePlayerBubbleQueue(player);
    pushBubbleToQueue(player.chatBubbles, messageText, CHAT_BUBBLE_LIFETIME_MS);
  }

  function addTransientSystemBubble(x, y, text, durationMs = CHAT_BUBBLE_LIFETIME_MS) {
    const anchor = {
      x: Number(x) || 0,
      y: Number(y) || 0,
      bubbles: [],
    };

    pushBubbleToQueue(anchor.bubbles, text, durationMs);
    if (anchor.bubbles.length > 0) {
      state.transientSystemBubbles.push(anchor);
    }
  }

  function wrapBubbleText(text, maxTextWidth) {
    const normalized = String(text || "").replace(/\r/g, "");
    const hardLines = normalized.split("\n");
    const wrapped = [];

    for (const hardLine of hardLines) {
      const words = hardLine.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        wrapped.push("");
        continue;
      }

      let current = words[0];
      for (let i = 1; i < words.length; i += 1) {
        const next = `${current} ${words[i]}`;
        if (ctx.measureText(next).width <= maxTextWidth) {
          current = next;
        } else {
          wrapped.push(current);
          current = words[i];
        }
      }
      wrapped.push(current);
    }

    return wrapped;
  }

  function drawBubbleStack(anchor, queue, now, options = {}) {
    if (!Array.isArray(queue) || queue.length === 0) {
      return;
    }

    const fadeWindowMs = Math.max(60, Number(options.fadeWindowMs) || CHAT_BUBBLE_FADE_MS);
    const riseOffsetPx = Math.max(8, Number(options.riseOffsetPx) || 32);
    const fontSize = Math.max(10, Math.floor(12 * state.camera.zoom));
    const paddingX = Math.max(4, Math.floor(6 * state.camera.zoom));
    const paddingY = Math.max(2, Math.floor(4 * state.camera.zoom));
    const gapY = Math.max(2, Math.floor(3 * state.camera.zoom));
    const lineGap = Math.max(1, Math.floor(fontSize * 0.18));
    const maxBubbleWidth = Math.max(140, Math.min(canvas.width * 0.5, 340));
    const maxTextWidth = Math.max(40, maxBubbleWidth - paddingX * 2);

    const active = queue.filter((entry) => entry && Number.isFinite(entry.until) && now < entry.until);
    queue.length = 0;
    for (const entry of active) {
      queue.push(entry);
    }

    if (queue.length === 0) {
      return;
    }

    const prepared = [];
    ctx.font = `${fontSize}px "Segoe UI", Tahoma, sans-serif`;
    for (const entry of queue) {
      const text = String(entry.text || "").trim();
      if (!text) {
        continue;
      }

      const lines = wrapBubbleText(text, maxTextWidth);
      let measuredMaxWidth = 0;
      for (const line of lines) {
        measuredMaxWidth = Math.max(measuredMaxWidth, Math.ceil(ctx.measureText(line).width));
      }

      const textHeight = lines.length * fontSize + Math.max(0, lines.length - 1) * lineGap;
      const remainingMs = Math.max(0, entry.until - now);
      const bubbleAlpha = Math.max(0, Math.min(1, remainingMs / fadeWindowMs));
      prepared.push({ lines, textHeight, measuredMaxWidth, bubbleAlpha });
    }

    if (prepared.length === 0) {
      return;
    }

    const messageGapY = gapY;
    const maxLineWidth = prepared.reduce((maxWidth, bubble) => Math.max(maxWidth, bubble.measuredMaxWidth), 0);
    const panelW = Math.max(24, maxLineWidth + paddingX * 2);
    const panelTextHeight = prepared.reduce((sum, bubble, idx) => {
      const gap = idx > 0 ? messageGapY : 0;
      return sum + gap + bubble.textHeight;
    }, 0);
    const panelH = panelTextHeight + paddingY * 2;
    const panelY = anchor.y - riseOffsetPx - panelH;
    const panelX = anchor.x + (anchor.width - panelW) / 2;

    const panelAlpha = prepared.length === 1 ? prepared[0].bubbleAlpha : 1;
    ctx.fillStyle = `rgba(15, 23, 42, ${0.9 * panelAlpha})`;
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = `rgba(148, 163, 184, ${0.6 * panelAlpha})`;
    ctx.strokeRect(panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1);

    const previousAlign = ctx.textAlign;
    ctx.textAlign = "center";

    let cursorY = panelY + paddingY + fontSize - 1;
    for (let i = 0; i < prepared.length; i += 1) {
      const bubble = prepared[i];
      ctx.fillStyle = `rgba(248, 250, 252, ${bubble.bubbleAlpha})`;
      for (const line of bubble.lines) {
        ctx.fillText(line, panelX + panelW / 2, cursorY);
        cursorY += fontSize + lineGap;
      }

      if (i < prepared.length - 1) {
        cursorY += messageGapY - lineGap;
      }
    }

    ctx.textAlign = previousAlign;
  }

  function drawPlayerBubbles(anchor, player, now) {
    ensurePlayerBubbleQueue(player);
    drawBubbleStack(anchor, player.chatBubbles, now, {
      riseOffsetPx: Math.max(32, Math.floor(40 * state.camera.zoom)),
      fadeWindowMs: CHAT_BUBBLE_FADE_MS,
    });
  }

  function drawTransientSystemBubbles(now) {
    if (state.transientSystemBubbles.length === 0) {
      return;
    }

    const nextAnchors = [];
    for (const entry of state.transientSystemBubbles) {
      if (!entry) {
        continue;
      }

      const screenX = (entry.x * TILE_SIZE - state.camera.x) * state.camera.zoom;
      const screenY = (entry.y * TILE_SIZE - state.camera.y) * state.camera.zoom;
      drawBubbleStack(
        {
          x: screenX,
          y: screenY,
          width: 0,
        },
        entry.bubbles,
        now,
        {
          riseOffsetPx: Math.max(36, Math.floor(42 * state.camera.zoom)),
          fadeWindowMs: LEAVE_TEXT_FADE_MS,
        },
      );

      if (Array.isArray(entry.bubbles) && entry.bubbles.length > 0) {
        nextAnchors.push(entry);
      }
    }

    state.transientSystemBubbles = nextAnchors;
  }

  return {
    ensurePlayerBubbleQueue,
    setPlayerChatBubble,
    addTransientSystemBubble,
    drawPlayerBubbles,
    drawTransientSystemBubbles,
  };
}
