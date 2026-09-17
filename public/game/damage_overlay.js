export function createDamageOverlayController({ state, ctx, canvas, settings }) {
  const { TILE_SIZE } = settings;

  function getTileDamageKey(x, y, layer) {
    return `${layer}:${x}:${y}`;
  }

  function normalizeDamageLayer(layer) {
    return layer === "background" ? "background" : "foreground";
  }

  function setTileDamage(entry) {
    if (!entry) {
      return;
    }

    const x = Number(entry.x);
    const y = Number(entry.y);
    const hits = Number(entry.hits);
    const maxHits = Number(entry.maxHits);
    const layer = normalizeDamageLayer(entry.layer);

    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return;
    }

    if (!Number.isFinite(hits) || !Number.isFinite(maxHits) || hits <= 0 || maxHits <= 1) {
      state.tileDamage.delete(getTileDamageKey(x, y, layer));
      return;
    }

    const damageKey = getTileDamageKey(x, y, layer);
    const existingDamage = state.tileDamage.get(damageKey);
    state.tileDamage.set(damageKey, {
      x,
      y,
      layer,
      hits,
      maxHits,
      crackAtlasIndex: existingDamage?.crackAtlasIndex
        ?? Math.floor(Math.random() * state.crackAtlases.length),
    });
  }

  function clearTileDamageAt(x, y, layer = null) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return;
    }

    if (layer) {
      state.tileDamage.delete(getTileDamageKey(x, y, normalizeDamageLayer(layer)));
      return;
    }

    state.tileDamage.delete(getTileDamageKey(x, y, "foreground"));
    state.tileDamage.delete(getTileDamageKey(x, y, "background"));
  }

  function drawDamageOverlays() {
    if (!state.world || state.tileDamage.size === 0 || state.crackAtlases.length === 0) {
      return;
    }

    for (const damage of state.tileDamage.values()) {
      const progress = Math.max(0, Math.min(1, damage.hits / damage.maxHits));
      if (progress <= 0) {
        continue;
      }

      const screenX = (damage.x * TILE_SIZE - state.camera.x) * state.camera.zoom;
      const screenY = (damage.y * TILE_SIZE - state.camera.y) * state.camera.zoom;
      const size = TILE_SIZE * state.camera.zoom;

      if (
        screenX + size < -4 ||
        screenY + size < -4 ||
        screenX > canvas.width + 4 ||
        screenY > canvas.height + 4
      ) {
        continue;
      }

      const crackAtlas = state.crackAtlases[damage.crackAtlasIndex] || state.crackAtlases[0];
      const frameWidth = Math.max(1, Number(crackAtlas.frameWidth) || 1);
      const frameHeight = Math.max(1, Number(crackAtlas.frameHeight) || 1);
      const frameCount = Math.max(1, Number(crackAtlas.columns) || 1);

      const frameIndex = Math.max(0, Math.min(frameCount - 1, Math.ceil(progress * frameCount) - 1));
      const sourceX = frameIndex * frameWidth;
      const sourceY = 0;

      ctx.globalAlpha = 0.35 + progress * 0.65;
      ctx.drawImage(
        crackAtlas.image,
        sourceX,
        sourceY,
        frameWidth,
        frameHeight,
        screenX,
        screenY,
        size,
        size,
      );
      ctx.globalAlpha = 1;
    }
  }

  return {
    setTileDamage,
    clearTileDamageAt,
    drawDamageOverlays,
  };
}
