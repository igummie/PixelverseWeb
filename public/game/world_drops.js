import * as utils from "./utils.js";

export function createWorldDropsController({ state, settings }) {
  // ALLOWED_ITEM_TYPES preserved internally if needed elsewhere
  const ALLOWED_ITEM_TYPES = new Set(["seed", "block", "furniture", "clothes"]);

  const {
    GEM_BOB_BASE_AMPLITUDE_PX,
    GEM_BOB_AMPLITUDE_VARIANCE_PX,
    GEM_BOB_BASE_SPEED,
    GEM_BOB_SPEED_VARIANCE,
  } = settings;

  function normalizeGemDrop(entry) {
    if (!entry) {
      return null;
    }

    const id = String(entry.id || "").trim();
    const x = Number(entry.x);
    const y = Number(entry.y);
    const value = Number(entry.value);

    if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    return {
      id,
      x,
      y,
      value: Math.floor(value),
    };
  }

  function hashStringToUnit(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0) / 4294967295;
  }

  function getGemBobParams(dropId) {
    const unitA = hashStringToUnit(`${dropId}:a`);
    const unitB = hashStringToUnit(`${dropId}:b`);
    const unitC = hashStringToUnit(`${dropId}:c`);
    return {
      bobPhase: unitA * Math.PI * 2,
      bobSpeed: GEM_BOB_BASE_SPEED + unitB * GEM_BOB_SPEED_VARIANCE,
      bobAmplitude: GEM_BOB_BASE_AMPLITUDE_PX + unitC * GEM_BOB_AMPLITUDE_VARIANCE_PX,
    };
  }

  function applyGemDropSnapshot(drops) {
    state.gemDrops.clear();
    for (const entry of drops || []) {
      const normalized = normalizeGemDrop(entry);
      if (!normalized) {
        continue;
      }
      const bob = getGemBobParams(normalized.id);
      state.gemDrops.set(normalized.id, {
        ...normalized,
        ...bob,
      });
    }
  }

  function upsertGemDrop(entry) {
    const normalized = normalizeGemDrop(entry);
    if (!normalized) {
      return;
    }

    const existing = state.gemDrops.get(normalized.id);
    if (existing) {
      state.gemDrops.set(normalized.id, {
        ...existing,
        ...normalized,
      });
      return;
    }

    const bob = getGemBobParams(normalized.id);
    state.gemDrops.set(normalized.id, {
      ...normalized,
      ...bob,
    });
  }

  function removeGemDropById(dropId) {
    const normalizedId = String(dropId || "").trim();
    if (!normalizedId) {
      return;
    }
    state.gemDrops.delete(normalizedId);
  }

  function normalizeSeedDrop(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const id = String(entry.id || "").trim();
    const x = Number(entry.x);
    const y = Number(entry.y);
    const itemId = Number(entry.itemId ?? entry.item_id ?? entry.seedId ?? entry.seed_id);
    if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(itemId) || itemId < 0) {
      return null;
    }

    const itemType = utils.normalizeItemType(entry.itemType ?? entry.item_type ?? "seed", "seed");

    return {
      id,
      x,
      y,
      itemId: Math.floor(itemId),
      itemType,
    };
  }

  function applySeedDropSnapshot(drops) {
    state.seedDrops.clear();
    for (const entry of drops || []) {
      const normalized = normalizeSeedDrop(entry);
      if (!normalized) {
        continue;
      }
      const bob = getGemBobParams(`seed:${normalized.id}`);
      state.seedDrops.set(normalized.id, {
        ...normalized,
        ...bob,
      });
    }
  }

  function upsertSeedDrop(entry) {
    const normalized = normalizeSeedDrop(entry);
    if (!normalized) {
      return;
    }

    const existing = state.seedDrops.get(normalized.id);
    if (existing) {
      state.seedDrops.set(normalized.id, {
        ...existing,
        ...normalized,
      });
      return;
    }

    const bob = getGemBobParams(`seed:${normalized.id}`);
    state.seedDrops.set(normalized.id, {
      ...normalized,
      ...bob,
    });
  }

  function removeSeedDropById(dropId) {
    const normalizedId = String(dropId || "").trim();
    if (!normalizedId) {
      return;
    }
    state.seedDrops.delete(normalizedId);
  }

  function normalizePlantedTree(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const id = String(entry.id || "").trim();
    const x = Number(entry.x);
    const y = Number(entry.y);
    const seedId = Number(entry.itemId ?? entry.item_id ?? entry.seedId ?? entry.seed_id);
    const plantedAtMs = Number(entry.plantedAtMs ?? entry.planted_at_ms ?? 0);
    if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(seedId) || seedId < 0) {
      return null;
    }

    return {
      id,
      x: Math.floor(x),
      y: Math.floor(y),
      seedId: Math.floor(seedId),
      plantedAtMs: Math.max(0, Math.floor(plantedAtMs)),
    };
  }

  function getTreeMapKey(x, y) {
    return `${Math.floor(Number(x) || 0)}:${Math.floor(Number(y) || 0)}`;
  }

  function applyPlantedTreeSnapshot(trees) {
    state.plantedTrees.clear();
    for (const entry of trees || []) {
      const normalized = normalizePlantedTree(entry);
      if (!normalized) {
        continue;
      }
      state.plantedTrees.set(getTreeMapKey(normalized.x, normalized.y), normalized);
    }
  }

  function upsertPlantedTree(entry) {
    const normalized = normalizePlantedTree(entry);
    if (!normalized) {
      return;
    }
    state.plantedTrees.set(getTreeMapKey(normalized.x, normalized.y), normalized);
  }

  function removePlantedTree(entry) {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const x = Number(entry.x);
    const y = Number(entry.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    state.plantedTrees.delete(getTreeMapKey(x, y));
  }

  return {
    applyGemDropSnapshot,
    upsertGemDrop,
    removeGemDropById,
    applySeedDropSnapshot,
    upsertSeedDrop,
    removeSeedDropById,
    applyPlantedTreeSnapshot,
    upsertPlantedTree,
    removePlantedTree,
  };
}
