import {state} from "./state.js";
import { INVENTORY_GRID_SLOTS } from "./constants.js";
import {
  normalizeItemType,
  getItemDisplayName,
  normalizeInventoryEntry,
  normalizeInventoryPayload,
  getInventoryEntriesSorted,
} from "./utils.js";

export function createInventoryController({
  getItemDropSprite,
  sendWs = () => {},
  itemSelectHud,
  inventoryGrid,
  inventorySelectedInfo,
  blockSelect,
  blockTypeInfo,
}) {
  if (!getItemDropSprite) {
    throw new Error("inventory controller requires getItemDropSprite callback");
  }
  // allow sendWs to be updated later if needed
  let _sendWs = sendWs;
  function setSendWs(fn) {
    _sendWs = fn || (() => {});
  }

  function getSelectedInventoryKey() {
    if (!Number.isFinite(Number(state.selectedItemId)) || state.selectedItemId < 0) {
      return "";
    }
    const type = normalizeItemType(state.selectedItemType || "seed", "seed");
    return `${type}:${Math.floor(Number(state.selectedItemId))}`;
  }

  function setSelectedItem(itemId, itemType = "seed") {
    const numeric = Number(itemId);
    const normalizedType = normalizeItemType(itemType, "seed");
    if (!Number.isFinite(numeric) || numeric < 0) {
      state.selectedItemId = -1;
      state.selectedItemType = "seed";
      state.selectedMissingSinceMs = 0;
      if (itemSelectHud) {
        itemSelectHud.value = "";
      }
      renderInventoryDrawer();
      return;
    }

    state.selectedItemId = Math.floor(numeric);
    state.selectedItemType = normalizedType;
    state.selectedMissingSinceMs = 0;
    if (itemSelectHud) {
      itemSelectHud.value = normalizedType === "seed" ? String(state.selectedItemId) : "";
    }
    renderInventoryDrawer();
  }

  function ensureSelectedItemStillValid() {
    if (state.selectedItemId < 0) {
      state.selectedMissingSinceMs = 0;
      return;
    }

    // blocks are not tracked in the inventory map
    if (String(state.selectedItemType || "").toLowerCase() === "block") {
      state.selectedMissingSinceMs = 0;
      return;
    }

    const selectedKey = getSelectedInventoryKey();
    if (selectedKey && Number(state.inventorySeeds.get(selectedKey) || 0) > 0) {
      state.selectedMissingSinceMs = 0;
      return;
    }

    const now = Date.now();
    if (!state.selectedMissingSinceMs) {
      state.selectedMissingSinceMs = now;
      return;
    }

    if (now - state.selectedMissingSinceMs < 450) {
      return;
    }

    setSelectedItem(-1);
  }

  function renderInventoryDrawer() {
    if (!inventoryGrid) {
      return;
    }

    const entries = getInventoryEntriesSorted(state);
    inventoryGrid.innerHTML = "";

    // compute slot count from the user's configured limit, but never below the
    // number of entries actually present (so items don't disappear). the
    // `INVENTORY_GRID_SLOTS` constant only provides the initial default – it
    // shouldn't prevent the limit from shrinking once the player adjusts it.
    const defaultLimit = INVENTORY_GRID_SLOTS || 12;
    const limit = Number(state.inventorySlotLimit);
    // if the limit isn't a valid number, fall back to defaultLimit
    const effectiveLimit = Number.isFinite(limit) && limit > 0 ? limit : defaultLimit;
    const slotCount = Math.max(effectiveLimit, entries.length);
    for (let i = 0; i < slotCount; i += 1) {
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "inventorySlot";

      const entry = entries[i];
      if (!entry) {
        slot.classList.add("empty");
        slot.disabled = true;
        inventoryGrid.appendChild(slot);
        continue;
      }

      const isSelected = entry.key === getSelectedInventoryKey();
      if (isSelected) {
        slot.classList.add("selected");
      }

      const sprite = getItemDropSprite(entry.itemId, entry.itemType);
      if (sprite) {
        const icon = document.createElement("img");
        icon.className = "inventoryItemIcon";
        icon.alt = "";
        icon.src = sprite.toDataURL("image/png");
        slot.appendChild(icon);
      } else {
        slot.textContent = `#${entry.itemId}`;
      }

      const count = document.createElement("span");
      count.className = "inventoryItemCount";
      count.textContent = String(entry.count);
      slot.appendChild(count);

      const itemName = entry.itemType === "block"
        ? getItemDisplayName(entry.itemId, "block", state)
        : getItemDisplayName(entry.itemId, entry.itemType, state);
      slot.title = `${itemName} x${entry.count}`;
      slot.addEventListener("click", () => {
        setSelectedItem(entry.itemId, entry.itemType);
      });
      inventoryGrid.appendChild(slot);
    }

    if (inventorySelectedInfo) {
      if (state.selectedItemId < 0) {
        inventorySelectedInfo.textContent = "Selected: none";
      } else {
        const selectedKey = getSelectedInventoryKey();
        const selectedCount = Number(state.inventorySeeds.get(selectedKey) || 0);
        const selectedItemName = getItemDisplayName(state.selectedItemId, state.selectedItemType, state);
        inventorySelectedInfo.textContent = `Selected: ${selectedItemName} x${Math.max(0, selectedCount)}`;
      }
    }
  }

  function dropSelectedInventorySeed(count = 1) {
    if (!state.connected) {
      return;
    }

    const itemId = Number(state.selectedItemId);
    if (!Number.isFinite(itemId) || itemId < 0) {
      return;
    }

    const itemType = normalizeItemType(state.selectedItemType || "seed", "seed");
    _sendWs({
      type: "drop_inventory_seed",
      itemType,
      itemId: Math.floor(itemId),
      count: Math.max(1, Math.floor(Number(count) || 1)),
    });
  }

  function applyInventorySnapshot(payload) {
    state.inventorySeeds = normalizeInventoryPayload(payload);
    ensureSelectedItemStillValid();
    renderInventoryDrawer();
  }

  // expose public helpers
  return {
    getSelectedInventoryKey,
    setSelectedItem,
    ensureSelectedItemStillValid,
    renderInventoryDrawer,
    dropSelectedInventorySeed,
    applyInventorySnapshot,
    setSendWs,
  };
}
