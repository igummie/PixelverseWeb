export function createAssetsLoaderController({ state, settings, elements, callbacks }) {
  const {
    TILE_SIZE,
    CRACK_ATLAS_SRC,
    CRACK_ATLAS_COLUMNS,
    CRACK_ATLAS_ROWS,
    TEXTURE47_COLS,
    TEXTURE47_ROWS,
    DEFAULT_TEXTURE47_VALID_MASKS,
  } = settings;

  const {
    seedSelectHud,
    blockSelect,
    blockTypeInfo,
  } = elements;

  const {
    requestJson,
    isTexture47Block,
    getTexture47IdFromBlock,
    blockHasRegularAnimation,
    rebuildWorldRenderCache,
  } = callbacks;

  function atlasLookupKey(value) {
    const kind = typeof value;
    return `${kind}:${String(value)}`;
  }

  function normalizeSeedTint(value) {
    const text = String(value ?? "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(text) || /^#[0-9a-fA-F]{8}$/.test(text)) {
      return text.toLowerCase();
    }
    return "";
  }

  function buildTintedSeedSprite(image, texture, tintHex) {
    const width = Math.max(1, Math.floor(Number(texture?.w) || TILE_SIZE));
    const height = Math.max(1, Math.floor(Number(texture?.h) || TILE_SIZE));
    const sourceX = Math.floor(Number(texture?.x) || 0);
    const sourceY = Math.floor(Number(texture?.y) || 0);

    const spriteCanvas = document.createElement("canvas");
    spriteCanvas.width = width;
    spriteCanvas.height = height;
    const spriteCtx = spriteCanvas.getContext("2d");
    spriteCtx.imageSmoothingEnabled = false;
    spriteCtx.clearRect(0, 0, width, height);
    spriteCtx.drawImage(image, sourceX, sourceY, width, height, 0, 0, width, height);

    const tintColor = normalizeSeedTint(tintHex);
    if (!tintColor) {
      return spriteCanvas;
    }

    spriteCtx.globalCompositeOperation = "source-atop";
    spriteCtx.globalAlpha = 0.35;
    spriteCtx.fillStyle = tintColor;
    spriteCtx.fillRect(0, 0, width, height);
    spriteCtx.globalAlpha = 1;
    spriteCtx.globalCompositeOperation = "source-over";

    return spriteCanvas;
  }

  function buildTintedAtlasImage(image, tintHex, tintAlpha = 0.35) {
    const tintColor = normalizeSeedTint(tintHex);
    const alpha = Number(tintAlpha);
    if (!tintColor || !Number.isFinite(alpha) || alpha <= 0) {
      return image;
    }

    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    const tintedCanvas = document.createElement("canvas");
    tintedCanvas.width = image.width;
    tintedCanvas.height = image.height;
    const tintedContext = tintedCanvas.getContext("2d");
    tintedContext.imageSmoothingEnabled = false;
    tintedContext.clearRect(0, 0, tintedCanvas.width, tintedCanvas.height);
    tintedContext.drawImage(image, 0, 0);
    tintedContext.globalCompositeOperation = "source-atop";
    tintedContext.globalAlpha = clampedAlpha;
    tintedContext.fillStyle = tintColor;
    tintedContext.fillRect(0, 0, tintedCanvas.width, tintedCanvas.height);
    tintedContext.globalAlpha = 1;
    tintedContext.globalCompositeOperation = "source-over";
    return tintedCanvas;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load atlas image: ${src}`));
      img.src = src;
    });
  }

  async function loadBlockDefinitions(onAssetProgress = null) {
    const bootstrap = await requestJson("/api/bootstrap", {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    });
    const data = bootstrap?.blocks || { atlases: [], blocks: [] };
    const seedsPayload = bootstrap?.seeds || { seeds: [], atlases: [] };
    const texture47Configs = bootstrap?.texture47Configs && typeof bootstrap.texture47Configs === "object"
      ? bootstrap.texture47Configs
      : {};

    state.blockDefs.clear();
    state.animatedBlockIds.clear();
    state.seedDefs.clear();
    state.atlases.clear();
    state.seedDropSpriteCache.clear();
    state.treeSpriteCache.clear();
    state.texture47.clear();
    state.crackAtlas = null;

    const atlasSpecsById = new Map();

    const atlasSpecs = [];
    const seenAtlasIds = new Set();

    for (const atlas of data.atlases || []) {
      const atlasId = atlas?.ATLAS_ID;
      if (atlasId == null || seenAtlasIds.has(atlasId)) {
        continue;
      }
      seenAtlasIds.add(atlasId);
      atlasSpecs.push(atlas);
      atlasSpecsById.set(atlasLookupKey(atlasId), atlas);
    }

    for (const atlas of seedsPayload.atlases || []) {
      const atlasId = atlas?.ATLAS_ID;
      if (atlasId == null || seenAtlasIds.has(atlasId)) {
        continue;
      }
      seenAtlasIds.add(atlasId);
      atlasSpecs.push(atlas);
      atlasSpecsById.set(atlasLookupKey(atlasId), atlas);
    }

    const texture47AtlasIds = new Set();
    const texture47SrcById = new Map();
    for (const block of data.blocks || []) {
      if (!isTexture47Block(block)) {
        continue;
      }

      const texture47Id = getTexture47IdFromBlock(block);
      if (!texture47Id) {
        continue;
      }

      texture47AtlasIds.add(texture47Id);

      const atlasSpec = atlasSpecsById.get(atlasLookupKey(block?.ATLAS_ID));
      const atlasSrc = String(atlasSpec?.SRC || "").trim();
      if (atlasSrc && !texture47SrcById.has(texture47Id)) {
        texture47SrcById.set(texture47Id, atlasSrc);
      }
    }

    const totalAssets = atlasSpecs.length + 1 + texture47AtlasIds.size;
    let loadedAssets = 0;
    const reportAssetProgress = (label) => {
      loadedAssets += 1;
      if (typeof onAssetProgress === "function") {
        onAssetProgress({ loaded: loadedAssets, total: totalAssets, label: String(label || "") });
      }
    };

    for (const atlas of atlasSpecs) {
      const image = await loadImage(atlas.SRC);
      state.atlases.set(atlas.ATLAS_ID, {
        ...atlas,
        image,
      });
      reportAssetProgress(`atlas ${atlas.ATLAS_ID}`);
    }

    for (const block of data.blocks || []) {
      state.blockDefs.set(block.ID, block);
      const blockId = Number(block?.ID);
      if (blockHasRegularAnimation(block) && Number.isInteger(blockId)) {
        state.animatedBlockIds.add(blockId);
      }
    }

    for (const seed of seedsPayload.seeds || []) {
      const seedId = Number(seed?.SEED_ID);
      if (!Number.isFinite(seedId) || seedId < 0) {
        continue;
      }
      state.seedDefs.set(Math.floor(seedId), seed);
    }

    if (seedSelectHud) {
      seedSelectHud.innerHTML = "";
      const sortedSeeds = Array.from(state.seedDefs.values()).sort((a, b) => Number(a.SEED_ID || 0) - Number(b.SEED_ID || 0));
      for (const seed of sortedSeeds) {
        const option = document.createElement("option");
        const seedId = Math.floor(Number(seed.SEED_ID) || 0);
        option.value = String(seedId);
        option.textContent = `${seedId} - ${String(seed.NAME || `SEED_${seedId}`)}`;
        seedSelectHud.appendChild(option);
      }

      if (sortedSeeds.length > 0) {
        const firstSeedId = Math.floor(Number(sortedSeeds[0].SEED_ID) || 0);
        state.selectedSeedId = firstSeedId;
        seedSelectHud.value = String(firstSeedId);
      } else {
        state.selectedSeedId = -1;
      }
    }

    try {
      const crackImage = await loadImage(CRACK_ATLAS_SRC);
      state.crackAtlas = {
        image: crackImage,
        columns: CRACK_ATLAS_COLUMNS,
        rows: CRACK_ATLAS_ROWS,
        frameWidth: Math.floor(crackImage.width / CRACK_ATLAS_COLUMNS),
        frameHeight: Math.floor(crackImage.height / CRACK_ATLAS_ROWS),
      };
    } catch {
      state.crackAtlas = null;
    } finally {
      reportAssetProgress("cracks atlas");
    }

    for (const atlasId of texture47AtlasIds) {
      try {
        const texture47Src = texture47SrcById.get(atlasId) || `/assets/texture47/${atlasId}.png`;
        const image = await loadImage(texture47Src);
        let columns = TEXTURE47_COLS;
        let rows = TEXTURE47_ROWS;
        let maskOrder = DEFAULT_TEXTURE47_VALID_MASKS;
        let maskVariants = new Map();
        let tint = "";
        let tintAlpha = 0;

        try {
          const config = texture47Configs?.[atlasId] ?? null;
          const maybeColumns = Number(config?.columns);
          const maybeRows = Number(config?.rows);
          if (!Number.isNaN(maybeColumns) && maybeColumns > 0) {
            columns = Math.floor(maybeColumns);
          }
          if (!Number.isNaN(maybeRows) && maybeRows > 0) {
            rows = Math.floor(maybeRows);
          }

          if (Array.isArray(config?.maskOrder) && config.maskOrder.length > 0) {
            const normalized = config.maskOrder.map((value) => {
              const parsed = Number(value);
              return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
            });
            const hasValidMask = normalized.some((value) => Number.isInteger(value));
            if (hasValidMask) {
              maskOrder = normalized;
            }
          }

          if (config?.maskVariants && typeof config.maskVariants === "object") {
            for (const [maskKey, variantValues] of Object.entries(config.maskVariants)) {
              const mask = Number(maskKey);
              if (!Number.isInteger(mask) || mask < 0) {
                continue;
              }

              if (!Array.isArray(variantValues)) {
                continue;
              }

              const variants = variantValues
                .map((value) => Number(value))
                .filter((value) => Number.isInteger(value) && value >= 0);

              if (variants.length > 0) {
                maskVariants.set(mask, Array.from(new Set(variants)));
              }
            }
          }

          tint = normalizeSeedTint(config?.tint);
          const parsedTintAlpha = Number(config?.tintAlpha);
          if (Number.isFinite(parsedTintAlpha)) {
            tintAlpha = Math.max(0, Math.min(1, parsedTintAlpha));
          }
        } catch {
        }

        const maskToIndex = new Map();
        let fallbackIndex = 0;
        for (let i = 0; i < maskOrder.length; i += 1) {
          const value = maskOrder[i];
          if (Number.isInteger(value) && value >= 0) {
            maskToIndex.set(value, i);
            fallbackIndex = i;
          }
        }

        if (maskToIndex.has(255)) {
          fallbackIndex = Number(maskToIndex.get(255));
        }

        if (maskVariants.size === 0) {
          for (const [maskValue, tileIndex] of maskToIndex.entries()) {
            maskVariants.set(maskValue, [tileIndex]);
          }
        }

        const renderImage = buildTintedAtlasImage(image, tint, tintAlpha);

        state.texture47.set(atlasId, {
          image,
          renderImage,
          columns,
          rows,
          tileWidth: Math.floor(image.width / columns),
          tileHeight: Math.floor(image.height / rows),
          maskOrder,
          fallbackIndex,
          maskVariants,
          maskToIndex,
          tint,
          tintAlpha,
        });
      } catch (error) {
        console.warn(`47-tile texture missing for ${atlasId}:`, error.message);
      } finally {
        reportAssetProgress(`texture47 ${atlasId}`);
      }
    }

    if (state.world) {
      rebuildWorldRenderCache();
    }

    const placeableBlocks = Array.from(state.blockDefs.values()).filter((block) => block.PLACEABLE);

    blockSelect.innerHTML = "";
    for (const block of placeableBlocks) {
      const option = document.createElement("option");
      option.value = String(block.ID);
      option.textContent = `${block.ID} - ${block.NAME}`;
      blockSelect.appendChild(option);
    }

    if (placeableBlocks.length > 0) {
      state.selectedBlockId = placeableBlocks[0].ID;
      blockSelect.value = String(state.selectedBlockId);
      blockTypeInfo.textContent = placeableBlocks[0].BLOCK_TYPE;
    }

    state.assetsLoaded = true;
  }

  function getSeedDropSprite(seedId) {
    const normalizedSeedId = Number(seedId);
    if (!Number.isFinite(normalizedSeedId) || normalizedSeedId < 0) {
      return null;
    }

    const seed = state.seedDefs.get(Math.floor(normalizedSeedId));
    if (!seed || typeof seed !== "object") {
      return null;
    }

    const atlasId = seed.SEED_ATLAS_ID;
    const texture = seed.SEED_ATLAS_TEXTURE;
    const atlas = state.atlases.get(atlasId);
    const image = atlas?.image;
    if (!image || !texture || typeof texture !== "object") {
      return null;
    }

    const cacheKey = JSON.stringify({
      seedId: Math.floor(normalizedSeedId),
      atlasId,
      texture,
      tint: seed.SEED_TINT || "",
    });
    const cached = state.seedDropSpriteCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const sprite = buildTintedSeedSprite(image, texture, seed.SEED_TINT);
    state.seedDropSpriteCache.set(cacheKey, sprite);
    return sprite;
  }

  function getTexture47SingleCellSprite(block) {
    if (!block || typeof block !== "object") {
      return null;
    }

    const texture47Id = getTexture47IdFromBlock(block);
    if (!texture47Id) {
      return null;
    }

    const texture47 = state.texture47.get(texture47Id);
    if (!texture47?.image) {
      return null;
    }

    const variants = texture47.maskVariants?.get?.(0)
      || texture47.maskVariants?.get?.(255)
      || [Number(texture47.fallbackIndex) || 0];
    const tileIndex = Number(Array.isArray(variants) ? variants[0] : texture47.fallbackIndex) || 0;
    const columns = Math.max(1, Number(texture47.columns) || TEXTURE47_COLS);
    const tileWidth = Math.max(1, Number(texture47.tileWidth) || TILE_SIZE);
    const tileHeight = Math.max(1, Number(texture47.tileHeight) || TILE_SIZE);
    const sourceX = (tileIndex % columns) * tileWidth;
    const sourceY = Math.floor(tileIndex / columns) * tileHeight;

    const spriteCanvas = document.createElement("canvas");
    spriteCanvas.width = tileWidth;
    spriteCanvas.height = tileHeight;
    const spriteCtx = spriteCanvas.getContext("2d");
    spriteCtx.imageSmoothingEnabled = false;
    spriteCtx.clearRect(0, 0, tileWidth, tileHeight);
    spriteCtx.drawImage(
      texture47.renderImage || texture47.image,
      sourceX,
      sourceY,
      tileWidth,
      tileHeight,
      0,
      0,
      tileWidth,
      tileHeight,
    );
    return spriteCanvas;
  }

  function getBlockDropSprite(blockId) {
    const normalizedBlockId = Number(blockId);
    if (!Number.isFinite(normalizedBlockId) || normalizedBlockId < 0) {
      return null;
    }

    const block = state.blockDefs.get(Math.floor(normalizedBlockId));
    if (!block || typeof block !== "object") {
      return null;
    }

    const blockCacheKey = JSON.stringify({
      type: "block",
      blockId: Math.floor(normalizedBlockId),
      atlasId: block.ATLAS_ID,
      texture47Id: getTexture47IdFromBlock(block),
      texture: block.ATLAS_TEXTURE || null,
    });
    const cachedBlockSprite = state.seedDropSpriteCache.get(blockCacheKey);
    if (cachedBlockSprite) {
      return cachedBlockSprite;
    }

    let sprite = null;
    if (isTexture47Block(block)) {
      sprite = getTexture47SingleCellSprite(block);
    } else {
      const atlas = state.atlases.get(block.ATLAS_ID);
      const image = atlas?.image;
      const texture = block.ATLAS_TEXTURE;
      if (image && texture && typeof texture === "object") {
        sprite = buildTintedSeedSprite(image, texture, "");
      }
    }

    if (!sprite) {
      return null;
    }

    state.seedDropSpriteCache.set(blockCacheKey, sprite);
    return sprite;
  }

  function getItemDropSprite(itemId, itemType = "") {
    const normalizedItemId = Number(itemId);
    if (!Number.isFinite(normalizedItemId) || normalizedItemId < 0) {
      return null;
    }

    const normalizedItemType = String(itemType || "").trim().toLowerCase();

    if (normalizedItemType === "block") {
      return getBlockDropSprite(normalizedItemId);
    }

    if (normalizedItemType === "seed") {
      return getSeedDropSprite(normalizedItemId);
    }

    // Prefer seed visuals for legacy SEED_IDS compatibility when IDs overlap.
    const seedSprite = getSeedDropSprite(normalizedItemId);
    if (seedSprite) {
      return seedSprite;
    }

    return getBlockDropSprite(normalizedItemId);
  }

  function getTreeSprite(seed, stage) {
    const atlasId = stage?.ATLAS_ID;
    const texture = stage?.ATLAS_TEXTURE;
    const atlas = state.atlases.get(atlasId);
    const image = atlas?.image;
    if (!image || !texture || typeof texture !== "object") {
      return null;
    }

    const tint = String(seed?.TREE?.TINT || "");
    const cacheKey = JSON.stringify({ atlasId, texture, tint });
    const cached = state.treeSpriteCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const sprite = buildTintedSeedSprite(image, texture, tint);
    state.treeSpriteCache.set(cacheKey, sprite);
    return sprite;
  }

  return {
    loadBlockDefinitions,
    getSeedDropSprite,
    getItemDropSprite,
    getTreeSprite,
  };
}
