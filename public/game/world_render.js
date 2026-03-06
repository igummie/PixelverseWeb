export function createWorldRenderController({ state, settings, callbacks }) {
  const { TILE_SIZE, TEXTURE47_COLS } = settings;
  const { getAnimatedRegularTextureRect, getRegularTextureRect } = callbacks;

  function isTexture47Block(block) {
    return !!getTexture47IdFromBlock(block);
  }

  function getTexture47IdFromBlock(block) {
    const explicitId = String(block?.TEXTURE47_ID || "").trim().toLowerCase();
    if (explicitId) {
      return explicitId;
    }

    // Backward compatibility: legacy Texture47 blocks used string ATLAS_ID directly.
    if (block?.ATLAS_TEXTURE && typeof block.ATLAS_TEXTURE === "object") {
      return "";
    }

    const legacyId = String(block?.ATLAS_ID || "").trim().toLowerCase();
    if (legacyId) {
      return legacyId;
    }

    return "";
  }

  function getTileIdAtLayer(tileX, tileY, layer = "foreground") {
    if (!state.world || tileX < 0 || tileY < 0 || tileX >= state.world.width || tileY >= state.world.height) {
      return 0;
    }

    const index = tileY * state.world.width + tileX;
    if (layer === "background") {
      return Number(state.world.background?.[index] || 0);
    }
    return Number(state.world.foreground?.[index] || 0);
  }

  function sameTexture47Group(tileX, tileY, texture47Id, layer = "foreground") {
    const neighborId = getTileIdAtLayer(tileX, tileY, layer);
    if (neighborId === 0) {
      return false;
    }

    const neighborBlock = state.blockDefs.get(neighborId);
    return !!neighborBlock && getTexture47IdFromBlock(neighborBlock) === texture47Id;
  }

  function getTexture47Mask(tileX, tileY, texture47Id, layer = "foreground") {
    const north = sameTexture47Group(tileX, tileY - 1, texture47Id, layer);
    const east = sameTexture47Group(tileX + 1, tileY, texture47Id, layer);
    const south = sameTexture47Group(tileX, tileY + 1, texture47Id, layer);
    const west = sameTexture47Group(tileX - 1, tileY, texture47Id, layer);

    const northEast = north && east && sameTexture47Group(tileX + 1, tileY - 1, texture47Id, layer);
    const southEast = south && east && sameTexture47Group(tileX + 1, tileY + 1, texture47Id, layer);
    const southWest = south && west && sameTexture47Group(tileX - 1, tileY + 1, texture47Id, layer);
    const northWest = north && west && sameTexture47Group(tileX - 1, tileY - 1, texture47Id, layer);

    let mask = 0;
    if (north) mask |= 2;
    if (east) mask |= 16;
    if (south) mask |= 64;
    if (west) mask |= 8;
    if (northEast) mask |= 1;
    if (southEast) mask |= 32;
    if (southWest) mask |= 128;
    if (northWest) mask |= 4;

    return mask;
  }

  function drawConnected47TileToContext(targetContext, block, drawX, drawY, layer = "foreground") {
    if (!state.world || !isTexture47Block(block)) {
      return false;
    }

    const texture47Id = getTexture47IdFromBlock(block);
    const texture47 = state.texture47.get(texture47Id);
    if (!texture47?.image) {
      return false;
    }

    const tileX = Math.floor(drawX / TILE_SIZE);
    const tileY = Math.floor(drawY / TILE_SIZE);
    const mask = getTexture47Mask(tileX, tileY, texture47Id, layer);
    const variants = texture47.maskVariants.get(mask) || texture47.maskVariants.get(255) || [texture47.fallbackIndex];
    const hash = Math.abs((tileX * 73856093) ^ (tileY * 19349663));
    const variantIndex = variants[hash % variants.length];
    const atlasColumns = Number.isInteger(texture47.columns) && texture47.columns > 0
      ? texture47.columns
      : TEXTURE47_COLS;

    const sourceX = (variantIndex % atlasColumns) * texture47.tileWidth;
    const sourceY = Math.floor(variantIndex / atlasColumns) * texture47.tileHeight;

    targetContext.drawImage(
      texture47.renderImage || texture47.image,
      sourceX,
      sourceY,
      texture47.tileWidth,
      texture47.tileHeight,
      drawX,
      drawY,
      TILE_SIZE,
      TILE_SIZE,
    );

    return true;
  }

  function drawTileToContext(targetContext, tileId, drawX, drawY, layer = "foreground") {
    const block = state.blockDefs.get(tileId);
    if (!block) {
      return;
    }

    if (drawConnected47TileToContext(targetContext, block, drawX, drawY, layer)) {
      return;
    }

    const atlas = state.atlases.get(block.ATLAS_ID);
    if (!atlas || !atlas.image) {
      return;
    }

    const tileX = Math.floor(drawX / TILE_SIZE);
    const tileY = Math.floor(drawY / TILE_SIZE);
    let tex = null;
    if (typeof getRegularTextureRect === "function") {
      tex = getRegularTextureRect(block, tileX, tileY, performance.now());
    }
    if (!tex) {
      tex = getAnimatedRegularTextureRect(block, performance.now()) || block.ATLAS_TEXTURE;
    }
    if (!tex) {
      return;
    }

    targetContext.drawImage(
      atlas.image,
      tex.x,
      tex.y,
      tex.w,
      tex.h,
      drawX,
      drawY,
      TILE_SIZE,
      TILE_SIZE,
    );
  }

  function rebuildWorldRenderCache() {
    if (!state.world) {
      state.worldRender = null;
      return;
    }

    const renderCanvas = document.createElement("canvas");
    renderCanvas.width = state.world.width * TILE_SIZE;
    renderCanvas.height = state.world.height * TILE_SIZE;
    const renderContext = renderCanvas.getContext("2d");
    renderContext.imageSmoothingEnabled = false;

    state.worldRender = {
      canvas: renderCanvas,
      context: renderContext,
    };

    for (let y = 0; y < state.world.height; y += 1) {
      for (let x = 0; x < state.world.width; x += 1) {
        updateWorldRenderTile(x, y);
      }
    }
  }

  function updateWorldRenderTile(tileX, tileY) {
    if (!state.worldRender || !state.world) {
      return;
    }

    if (tileX < 0 || tileY < 0 || tileX >= state.world.width || tileY >= state.world.height) {
      return;
    }

    const index = tileY * state.world.width + tileX;
    const foregroundTile = Number(state.world.foreground?.[index] || 0);
    const backgroundTile = Number(state.world.background?.[index] || 0);
    const drawX = tileX * TILE_SIZE;
    const drawY = tileY * TILE_SIZE;

    state.worldRender.context.clearRect(drawX, drawY, TILE_SIZE, TILE_SIZE);
    if (backgroundTile !== 0) {
      drawTileToContext(state.worldRender.context, backgroundTile, drawX, drawY, "background");
    }
    if (foregroundTile !== 0) {
      drawTileToContext(state.worldRender.context, foregroundTile, drawX, drawY, "foreground");
    }
  }

  function updateWorldRenderTileArea(centerX, centerY) {
    for (let y = centerY - 1; y <= centerY + 1; y += 1) {
      for (let x = centerX - 1; x <= centerX + 1; x += 1) {
        updateWorldRenderTile(x, y);
      }
    }
  }

  return {
    isTexture47Block,
    getTexture47IdFromBlock,
    getTileIdAtLayer,
    sameTexture47Group,
    getTexture47Mask,
    drawConnected47TileToContext,
    drawTileToContext,
    rebuildWorldRenderCache,
    updateWorldRenderTile,
    updateWorldRenderTileArea,
  };
}
