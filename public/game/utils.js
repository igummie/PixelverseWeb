import { TILE_SIZE } from "./constants.js";

// miscellaneous helpers shared across modules
export function normalizeTint(value) {
  const text = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text) || /^#[0-9a-fA-F]{8}$/.test(text)) {
    return text.toLowerCase();
  }
  return "";
}

export function clampCameraZoom(value, minZoom, maxZoom) {
  return Math.max(minZoom, Math.min(maxZoom, value));
}

export function normalizeAnimFrame(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const x = Number(entry.x);
  const y = Number(entry.y);
  const w = Number(entry.w);
  const h = Number(entry.h);
  const seconds = Number(entry.seconds ?? entry.SECONDS ?? entry.duration ?? 0.15);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
    return null;
  }

  if (x < 0 || y < 0 || w <= 0 || h <= 0) {
    return null;
  }

  return {
    x: Math.floor(x),
    y: Math.floor(y),
    w: Math.floor(w),
    h: Math.floor(h),
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0.15,
  };
}

export function normalizePrimaryAnimSeconds(value, fallback = 0.15) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.max(0.01, Number(numeric.toFixed(3)));
}

export function blockHasRegularAnimation(block) {
  if (!block?.ATLAS_TEXTURE || typeof block.ATLAS_TEXTURE !== "object") {
    return false;
  }

  return Array.isArray(block.ANIM_FRAMES) && block.ANIM_FRAMES.length > 0;
}

export function blockHasTextureVariants(block) {
  return Array.isArray(block?.ATLAS_TEXTURE_VARIANTS) && block.ATLAS_TEXTURE_VARIANTS.length > 0;
}

// hashing strategy used for deterministic variant selection
export function getVariantTextureRect(block, tileX, tileY) {
  if (!blockHasTextureVariants(block)) {
    return null;
  }
  const variants = block.ATLAS_TEXTURE_VARIANTS;
  const hash = Math.abs((tileX * 73856093) ^ (tileY * 19349663));
  const idx = hash % variants.length;
  const rect = variants[idx];
  if (!rect || typeof rect !== "object") {
    return null;
  }
  const x = Number(rect.x) || 0;
  const y = Number(rect.y) || 0;
  const w = Number(rect.w) || TILE_SIZE;
  const h = Number(rect.h) || TILE_SIZE;
  return { x, y, w, h };
}

// wrappers that apply variants before animation/base texture
export function getRegularTextureRect(block, tileX, tileY, nowMs = performance.now()) {
  const variant = getVariantTextureRect(block, tileX, tileY);
  const animated = blockHasRegularAnimation(block);

  if (animated) {
    if (variant) {
      const temp = Object.assign({}, block);
      temp.ATLAS_TEXTURE = variant;
      return getAnimatedRegularTextureRect(temp, nowMs);
    }
    return getAnimatedRegularTextureRect(block, nowMs);
  }

  if (variant) {
    return variant;
  }

  if (block?.ATLAS_TEXTURE && typeof block.ATLAS_TEXTURE === "object") {
    return {
      x: Number(block.ATLAS_TEXTURE.x) || 0,
      y: Number(block.ATLAS_TEXTURE.y) || 0,
      w: Number(block.ATLAS_TEXTURE.w) || TILE_SIZE,
      h: Number(block.ATLAS_TEXTURE.h) || TILE_SIZE,
    };
  }
  return null;
}

export function getAnimatedRegularTextureRect(block, nowMs = performance.now()) {
  if (!block?.ATLAS_TEXTURE || typeof block.ATLAS_TEXTURE !== "object") {
    return null;
  }

  const rawFrames = Array.isArray(block.ANIM_FRAMES) ? block.ANIM_FRAMES : [];
  const normalizedExtraFrames = [];
  for (const rawFrame of rawFrames) {
    const frame = normalizeAnimFrame(rawFrame);
    if (frame) {
      normalizedExtraFrames.push(frame);
    }
  }

  const primarySeconds = normalizedExtraFrames.length > 0
    ? normalizePrimaryAnimSeconds(block?.ANIM_FIRST_SECONDS, 0.15)
    : 0.15;

  const base = {
    x: Number(block.ATLAS_TEXTURE.x) || 0,
    y: Number(block.ATLAS_TEXTURE.y) || 0,
    w: Number(block.ATLAS_TEXTURE.w) || TILE_SIZE,
    h: Number(block.ATLAS_TEXTURE.h) || TILE_SIZE,
    seconds: primarySeconds,
  };

  const frames = [base, ...normalizedExtraFrames];
  if (frames.length === 1) {
    return base;
  }

  const totalSeconds = frames.reduce((sum, frame) => sum + Math.max(0.01, Number(frame.seconds) || 0.15), 0);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return base;
  }

  let cursor = (Math.max(0, nowMs) / 1000) % totalSeconds;
  for (const frame of frames) {
    const frameSeconds = Math.max(0.01, Number(frame.seconds) || 0.15);
    if (cursor < frameSeconds) {
      return frame;
    }
    cursor -= frameSeconds;
  }

  return frames[frames.length - 1];
}

// inventory / item helpers
export const ALLOWED_ITEM_TYPES = new Set(["seed", "block", "furniture", "clothes"]);

export function normalizeItemType(value, fallback = "seed") {
  const normalizedFallback = ALLOWED_ITEM_TYPES.has(String(fallback || "").trim().toLowerCase())
    ? String(fallback).trim().toLowerCase()
    : "seed";
  const text = String(value ?? "").trim().toLowerCase();
  return ALLOWED_ITEM_TYPES.has(text) ? text : normalizedFallback;
}

export function getItemDisplayName(itemId, itemType, state) {
  const normalizedType = normalizeItemType(itemType);
  if (normalizedType === "block") {
    return String(state.blockDefs.get(itemId)?.NAME || `Block ${itemId}`);
  }
  if (normalizedType === "furniture") {
    return `Furniture ${itemId}`;
  }
  if (normalizedType === "clothes") {
    return `Clothes ${itemId}`;
  }
  return String(
    state.seedDefs.get(itemId)?.NAME
    || state.blockDefs.get(itemId)?.NAME
    || `Item ${itemId}`,
  );
}

export function normalizeInventoryEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const itemId = Number(entry.itemId ?? entry.item_id ?? entry.seedId ?? entry.seed_id);
  const itemType = normalizeItemType(entry.itemType ?? entry.item_type ?? "seed", "seed");
  const count = Number(entry.count);
  if (!Number.isFinite(itemId) || !Number.isFinite(count)) {
    return null;
  }

  const normalizedItemId = Math.floor(itemId);
  const normalizedCount = Math.floor(count);
  if (normalizedItemId < 0 || normalizedCount <= 0) {
    return null;
  }

  return {
    key: `${itemType}:${normalizedItemId}`,
    itemType,
    itemId: normalizedItemId,
    count: normalizedCount,
  };
}

export function normalizeInventoryPayload(payload) {
  const merged = new Map();
  if (!Array.isArray(payload)) {
    return merged;
  }

  for (const rawEntry of payload) {
    const entry = normalizeInventoryEntry(rawEntry);
    if (!entry) {
      continue;
    }
    merged.set(entry.key, (merged.get(entry.key) || 0) + entry.count);
  }

  return merged;
}

export function getInventoryEntriesSorted(state) {
  return Array.from(state.inventorySeeds.entries())
    .map(([itemKey, count]) => {
      const [typePart, idPart] = String(itemKey).split(":", 2);
      const itemType = normalizeItemType(typePart || "seed", "seed");
      const itemId = Number(idPart);
      return {
        key: String(itemKey),
        itemType,
        itemId,
        count: Number(count),
      };
    })
    .filter((entry) => Number.isFinite(entry.itemId) && Number.isFinite(entry.count) && entry.count > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function formatGrowthTimeRemaining(msRemaining) {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function getServerNowMs(state) {
  return Date.now() + (Number(state.serverTimeOffsetMs) || 0);
}
