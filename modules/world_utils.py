from __future__ import annotations

import asyncio
import json
import random
import secrets
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

from modules.player_data import (
    get_db,
    normalize_name,
    normalize_item_type,
    normalize_inventory,
    make_inventory_key,
)
from modules.worldgen import generate_world_layers

# These constants are expected to be set by the importing code (typically
# app.py) so the logic here can remain decoupled from the surrounding
# application configuration.  See app.py for assignment.
WORLD_WIDTH: int = 0
WORLD_HEIGHT: int = 0
RUNTIME_BLOCK_IDS: Dict[str, int] = {}

# block catalog replicas (updated from app._sync_block_catalog_cache)
BACKGROUND_BLOCK_IDS: set[int] = set()
BLOCKS_BY_ID: Dict[int, Dict[str, Any]] = {}

# paths that must be initialized by the importing application
PUBLIC_DIR: Path | None = None
BLOCKS_PATH: Path | None = None
SEEDS_PATH: Path | None = None
WEATHER_PATH: Path | None = None

# other numeric constants; app will set these after import
DAMAGE_REGEN_MIN_SECONDS: float = 0.0
DAMAGE_REGEN_MAX_SECONDS: float = 0.0
PLAYER_PICKUP_RADIUS: float = 0.0
GEM_DENOMINATIONS: Tuple[int, ...] = ()
GEM_DROP_SPAWN_RADIUS: float = 0.0
GEM_DROP_MIN_IN_TILE: float = 0.0
GEM_DROP_MAX_IN_TILE: float = 0.0

# cache state shared across the application
world_cache: Dict[str, Dict[str, Any]] = {}
save_tasks: Dict[str, asyncio.Task[Any]] = {}


def load_seeds_payload() -> Dict[str, Any]:
    try:
        with SEEDS_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return {"seeds": []}

    if not isinstance(payload, dict):
        return {"seeds": []}

    seeds = payload.get("seeds", [])
    output = {"seeds": seeds if isinstance(seeds, list) else []}

    # Preserve future metadata fields while intentionally omitting VERSION.
    for key, value in payload.items():
        if key in {"seeds", "VERSION"}:
            continue
        output[key] = value

    return output


def load_weather_payload() -> Dict[str, Any]:
    # loader for weather.json. preserve metadata and convert legacy
    # ITEM_ID fields to WEATHER_ID so UI remains consistent.
    try:
        with WEATHER_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return {"weather": []}

    if not isinstance(payload, dict):
        return {"weather": []}

    raw = payload.get("weather", []) if isinstance(payload.get("weather"), list) else []
    weather_list: list[Any] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        if "WEATHER_ID" not in entry and "ITEM_ID" in entry:
            entry["WEATHER_ID"] = entry.get("ITEM_ID")
        weather_list.append(entry)

    output: Dict[str, Any] = {"weather": weather_list}

    for key, value in payload.items():
        if key in {"weather", "VERSION"}:
            continue
        output[key] = value

    return output


# utility helpers for blocks and drops

def get_item_definition(item_id: int, item_type: str = "seed") -> Dict[str, Any] | None:
    """Return a definition for *item_id* of *item_type*.

    Currently only "seed" and "block" are supported; seeds are looked up
    by scanning the seeds payload (respecting both ITEM_ID and legacy
    SEED_ID), while blocks are retrieved from the in-memory catalog.
    """
    if item_id < 0:
        return None
    itype = normalize_item_type(item_type, "seed")

    if itype == "seed":
        payload = load_seeds_payload()
        seeds = payload.get("seeds", []) if isinstance(payload, dict) else []
        if not isinstance(seeds, list):
            return None

        for seed in seeds:
            if not isinstance(seed, dict):
                continue
            try:
                current_id = int(seed.get("ITEM_ID", seed.get("SEED_ID", -1)))
            except Exception:
                current_id = -1
            if current_id == item_id:
                return seed
        return None

    if itype == "block":
        # BLOCKS_BY_ID is maintained during catalog sync
        return BLOCKS_BY_ID.get(item_id)

    return None


def is_breakable(tile_id: int) -> bool:
    if tile_id <= 0:
        return False

    block = BLOCKS_BY_ID.get(tile_id)
    if not block:
        return True

    return bool(block.get("BREAKABLE", True))


def get_block_toughness(tile_id: int) -> int:
    block = BLOCKS_BY_ID.get(tile_id)
    if not block:
        return 1

    try:
        toughness = int(block.get("TOUGHNESS", 1))
    except Exception:
        toughness = 1

    return max(1, toughness)


def get_block_gem_drop_total(tile_id: int) -> int:
    block = BLOCKS_BY_ID.get(tile_id)
    if not block:
        return 0

    try:
        chance = float(block.get("GEM_CHANCE", 0.0))
    except Exception:
        chance = 0.0

    chance = max(0.0, min(1.0, chance))
    if chance <= 0.0 or random.random() > chance:
        return 0

    try:
        base_amount = int(block.get("GEM_AMOUNT", 0))
    except Exception:
        base_amount = 0

    try:
        amount_var = int(block.get("GEM_AMOUNT_VAR", 0))
    except Exception:
        amount_var = 0

    amount_var = max(0, amount_var)
    if amount_var > 0:
        base_amount += random.randint(-amount_var, amount_var)

    return max(0, base_amount)


def get_tree_gem_drop_total(tree: Dict[str, Any]) -> int:
    """Return total gem amount to spawn when a planted tree is harvested.

    The configuration is stored on the seed definition under the TREE object.
    Fields mirror the block format:
      TREE.GEM_CHANCE          # chance 0.0-1.0
      TREE.GEM_AMOUNT          # base amount
      TREE.GEM_AMOUNT_VAR      # random variance +/-

    Legacy support is minimal; if the TREE object is missing the keys we
    simply return 0. The caller must handle zero appropriately.
    """
    if not isinstance(tree, dict):
        return 0

    try:
        seed_id = int(tree.get("seed_id", -1))
    except Exception:
        seed_id = -1

    if seed_id < 0:
        return 0

    seed = get_item_definition(seed_id, "seed")
    if not isinstance(seed, dict):
        return 0

    raw_tree = seed.get("TREE") if isinstance(seed.get("TREE"), dict) else {}

    try:
        chance = float(raw_tree.get("GEM_CHANCE", 0.0))
    except Exception:
        chance = 0.0

    chance = max(0.0, min(1.0, chance))
    if chance <= 0.0 or random.random() > chance:
        return 0

    try:
        base_amount = int(raw_tree.get("GEM_AMOUNT", 0))
    except Exception:
        base_amount = 0

    try:
        amount_var = int(raw_tree.get("GEM_AMOUNT_VAR", 0))
    except Exception:
        amount_var = 0

    amount_var = max(0, amount_var)
    if amount_var > 0:
        base_amount += random.randint(-amount_var, amount_var)

    return max(0, base_amount)


def get_block_seed_drop_ids(tile_id: int) -> List[int]:
    block = BLOCKS_BY_ID.get(tile_id)
    if not block:
        return []

    drop_ids: List[int] = []

    # Canonical format: optional list of seed IDs with per-entry chance.
    if "SEED_IDS" in block:
        raw_seed_ids = block.get("SEED_IDS")
        if not isinstance(raw_seed_ids, list):
            return []

        for entry in raw_seed_ids:
            chance = 1.0
            seed_id = -1

            if isinstance(entry, dict):
                # allow both uppercase and lowercase keys, and accept legacy ITEM_ID/SEED_ID or new
                # "ID" field; chance defaults to 0.2 if not provided (matching old behaviour).
                try:
                    chance = float(entry.get("CHANCE", entry.get("chance", 0.2)))
                except Exception:
                    chance = 0.2

                try:
                    # support multiple possible keys for the seed identifier
                    seed_id = int(
                        entry.get("ITEM_ID",
                                  entry.get("SEED_ID",
                                            entry.get("id",
                                                      entry.get("ID", -1))))
                    )
                except Exception:
                    seed_id = -1
            else:
                try:
                    seed_id = int(entry)
                except Exception:
                    seed_id = -1

            chance = max(0.0, min(1.0, chance))
            if chance <= 0.0 or random.random() > chance:
                continue

            if seed_id >= 0:
                drop_ids.append(seed_id)

        return drop_ids

    # Legacy format: multiple optional seed drops.
    raw_seed_drops = block.get("SEED_DROPS")
    if isinstance(raw_seed_drops, list):
        for entry in raw_seed_drops:
            if not isinstance(entry, dict):
                continue

            try:
                chance = float(entry.get("CHANCE", 0.0))
            except Exception:
                chance = 0.0

            chance = max(0.0, min(1.0, chance))
            if chance <= 0.0 or random.random() > chance:
                continue

            try:
                seed_id = int(
                    entry.get("ITEM_ID",
                              entry.get("SEED_ID",
                                        entry.get("ID", -1)))
                )
            except Exception:
                seed_id = -1

            if seed_id >= 0:
                drop_ids.append(seed_id)

        if drop_ids:
            return drop_ids

    # Legacy format: single optional seed drop.
    try:
        chance = float(block.get("SEED_DROP_CHANCE", 0.0))
    except Exception:
        chance = 0.0

    chance = max(0.0, min(1.0, chance))
    if chance <= 0.0 or random.random() > chance:
        return []

    try:
        seed_id = int(block.get("SEED_DROP_ID", block.get("ITEM_DROP_ID", -1)))
    except Exception:
        seed_id = -1

    if seed_id < 0:
        return []

    return [seed_id]


def _clamp_chance(raw_value: Any, default: float = 0.0) -> float:
    try:
        chance = float(raw_value)
    except Exception:
        chance = float(default)
    return max(0.0, min(1.0, chance))


def _resolve_drop_entry_seed_id(raw_entry: Any) -> int:
    try:
        if isinstance(raw_entry, dict):
            return int(raw_entry.get("ITEM_ID", raw_entry.get("SEED_ID", raw_entry.get("id", -1))))
        return int(raw_entry)
    except Exception:
        return -1


def _resolve_drop_entry_item_type(raw_entry: Any, default: str = "seed") -> str:
    if isinstance(raw_entry, dict):
        for key in ("ITEM_TYPE", "item_type", "TYPE", "type"):
            if key in raw_entry:
                return normalize_item_type(raw_entry.get(key), default)
    return normalize_item_type(default)


def _resolve_drop_entry_item_id(raw_entry: Any, default_item_id: int = -1) -> int:
    if not isinstance(raw_entry, dict):
        return _resolve_drop_entry_seed_id(raw_entry)

    for key in ("ITEM_ID", "item_id", "ID", "SEED_ID", "id"):
        if key not in raw_entry:
            continue
        try:
            return int(raw_entry.get(key))
        except Exception:
            continue

    return int(default_item_id)


def _resolve_drop_entry_count(raw_entry: Any, *, default_count: int = 1) -> int:
    if not isinstance(raw_entry, dict):
        return max(1, int(default_count))

    try:
        base_count = int(raw_entry.get("COUNT", raw_entry.get("count", default_count)))
    except Exception:
        base_count = default_count

    # Support ranged yields in either TREE.DROPS or TREE_DROPS entries.
    try:
        min_count = int(raw_entry.get("MIN", raw_entry.get("min", base_count)))
    except Exception:
        min_count = base_count

    try:
        max_count = int(raw_entry.get("MAX", raw_entry.get("max", base_count)))
    except Exception:
        max_count = base_count

    min_count = max(0, min_count)
    max_count = max(min_count, max_count)
    if max_count == min_count:
        return max(0, min_count)

    return max(0, random.randint(min_count, max_count))


def get_block_self_drop_seed_ids(tile_id: int) -> List[int]:
    block = BLOCKS_BY_ID.get(tile_id)
    if not isinstance(block, dict):
        return []

    drop_self_enabled = bool(block.get("DROP_SELF", False))
    if not drop_self_enabled:
        return []

    chance = _clamp_chance(block.get("DROP_SELF_CHANCE", 0.2), default=0.2)
    if chance <= 0.0 or random.random() > chance:
        return []

    if tile_id < 0:
        return []

    # Self drop is intentionally a single item for growth progression balance.
    return [tile_id]


def get_tree_item_drops(tree: Dict[str, Any], now_ms: int) -> List[Dict[str, Any]]:
    if not isinstance(tree, dict):
        return []

    try:
        seed_id = int(tree.get("seed_id", -1))
    except Exception:
        seed_id = -1

    if seed_id < 0:
        return []

    seed = get_item_definition(seed_id, "seed")
    if not isinstance(seed, dict):
        return []

    try:
        planted_at_ms = int(tree.get("planted_at_ms", 0))
    except Exception:
        planted_at_ms = 0

    try:
        grow_seconds = max(1, int(seed.get("GROWTIME", 1)))
    except Exception:
        grow_seconds = 1

    elapsed_ms = max(0, int(now_ms) - max(0, planted_at_ms))
    is_fully_grown = elapsed_ms >= (grow_seconds * 1000)
    if not is_fully_grown:
        return []

    # Preferred format for harvest drops:
    # TREE.DROPS: [{ID/SEED_ID, CHANCE, COUNT|MIN/MAX}, ...]
    # Legacy/alt format supported: TREE_DROPS: [...]
    raw_drops: Any = []
    raw_tree = seed.get("TREE")
    if isinstance(raw_tree, dict) and isinstance(raw_tree.get("DROPS"), list):
        raw_drops = raw_tree.get("DROPS", [])
    elif isinstance(seed.get("TREE_DROPS"), list):
        raw_drops = seed.get("TREE_DROPS", [])

    drops: List[Dict[str, Any]] = []

    # Preferred format for fruit yields:
    # FRUIT_DROPS: [{ITEM_TYPE, ITEM_ID, MIN, MAX}, ...]
    raw_fruit_drops: Any = seed.get("FRUIT_DROPS")
    if (not isinstance(raw_fruit_drops, list) or not raw_fruit_drops) and isinstance(raw_tree, dict):
        if isinstance(raw_tree.get("FRUIT_DROPS"), list):
            raw_fruit_drops = raw_tree.get("FRUIT_DROPS", [])

    # ... (rest of file continues unchanged)
def ensure_world_gem_state(world: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    gem_drops = world.setdefault("gem_drops", {})
    if not isinstance(gem_drops, dict):
        world["gem_drops"] = {}
        gem_drops = world["gem_drops"]
    return gem_drops


def ensure_world_seed_state(world: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    seed_drops = world.setdefault("seed_drops", {})
    if not isinstance(seed_drops, dict):
        world["seed_drops"] = {}
        seed_drops = world["seed_drops"]
    return seed_drops


def ensure_world_tree_state(world: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    planted_trees = world.setdefault("planted_trees", {})
    if not isinstance(planted_trees, dict):
        world["planted_trees"] = {}
        planted_trees = world["planted_trees"]
    return planted_trees


def get_tree_key(x: int, y: int) -> str:
    return f"{x}:{y}"


def get_planted_tree_at(world: Dict[str, Any], x: int, y: int) -> Dict[str, Any] | None:
    tree = ensure_world_tree_state(world).get(get_tree_key(x, y))
    return tree if isinstance(tree, dict) else None


def place_planted_tree(
    world: Dict[str, Any], x: int, y: int, seed_id: int, planted_at_ms: int
) -> Dict[str, Any] | None:
    if seed_id < 0:
        return None

    if get_item_definition(seed_id, "seed") is None:
        return None

    tree = {
        "id": secrets.token_hex(6),
        "x": int(x),
        "y": int(y),
        "seed_id": int(seed_id),
        "planted_at_ms": int(planted_at_ms),
    }
    ensure_world_tree_state(world)[get_tree_key(int(x), int(y))] = tree
    return tree


def remove_planted_tree_at(world: Dict[str, Any], x: int, y: int) -> Dict[str, Any] | None:
    tree = ensure_world_tree_state(world).pop(get_tree_key(x, y), None)
    return tree if isinstance(tree, dict) else None


def serialize_gem_drops(world: Dict[str, Any]) -> List[Dict[str, Any]]:
    payload: List[Dict[str, Any]] = []
    for drop in ensure_world_gem_state(world).values():
        if not isinstance(drop, dict):
            continue

        try:
            payload.append(
                {
                    "id": str(drop.get("id", "")),
                    "x": float(drop.get("x", 0.0)),
                    "y": float(drop.get("y", 0.0)),
                    "value": int(drop.get("value", 0)),
                }
            )
        except Exception:
            continue

    return payload


def serialize_seed_drops(world: Dict[str, Any]) -> List[Dict[str, Any]]:
    payload: List[Dict[str, Any]] = []
    for drop in ensure_world_seed_state(world).values():
        if not isinstance(drop, dict):
            continue

        try:
            payload.append(
                {
                    "id": str(drop.get("id", "")),
                    "x": float(drop.get("x", 0.0)),
                    "y": float(drop.get("y", 0.0)),
                    "itemId": int(drop.get("item_id", drop.get("seed_id", -1))),
                    "itemType": str(drop.get("item_type", "seed")),
                }
            )
        except Exception:
            continue

    return payload


def serialize_planted_trees(world: Dict[str, Any]) -> List[Dict[str, Any]]:
    payload: List[Dict[str, Any]] = []
    for tree in ensure_world_tree_state(world).values():
        if not isinstance(tree, dict):
            continue

        try:
            payload.append(
                {
                    "id": str(tree.get("id", "")),
                    "x": int(tree.get("x", 0)),
                    "y": int(tree.get("y", 0)),
                    "itemId": int(tree.get("seed_id", -1)),
                    "seedId": int(tree.get("seed_id", -1)),
                    "plantedAtMs": int(tree.get("planted_at_ms", 0)),
                }
            )
        except Exception:
            continue

    return payload


def parse_world_gem_drops(raw: Any, width: int, height: int) -> Dict[str, Dict[str, Any]]:
    parsed: Dict[str, Dict[str, Any]] = {}
    entries: List[Any]

    if isinstance(raw, dict):
        entries = list(raw.values())
    elif isinstance(raw, list):
        entries = raw
    else:
        return parsed

    max_x = max(0.0, float(width) - 0.001)
    max_y = max(0.0, float(height) - 0.001)

    for entry in entries:
        if not isinstance(entry, dict):
            continue

        drop_id = str(entry.get("id") or secrets.token_hex(6)).strip()
        if not drop_id or drop_id in parsed:
            continue

        try:
            x = max(0.0, min(max_x, float(entry.get("x", 0.0))))
            y = max(0.0, min(max_y, float(entry.get("y", 0.0))))
            value = max(1, int(entry.get("value", 0)))
        except Exception:
            continue

        parsed[drop_id] = {
            "id": drop_id,
            "x": x,
            "y": y,
            "value": value,
            "created_at": time.monotonic(),
        }

    return parsed


def parse_world_seed_drops(raw: Any, width: int, height: int) -> Dict[str, Dict[str, Any]]:
    parsed: Dict[str, Dict[str, Any]] = {}
    entries: List[Any]

    if isinstance(raw, dict):
        entries = list(raw.values())
    elif isinstance(raw, list):
        entries = raw
    else:
        return parsed

    max_x = max(0.0, float(width) - 0.001)
    max_y = max(0.0, float(height) - 0.001)

    for entry in entries:
        if not isinstance(entry, dict):
            continue

        drop_id = str(entry.get("id") or secrets.token_hex(6)).strip()
        if not drop_id or drop_id in parsed:
            continue

        try:
            x = max(0.0, min(max_x, float(entry.get("x", 0.0))))
            y = max(0.0, min(max_y, float(entry.get("y", 0.0))))
            item_id = int(
                entry.get("itemId", entry.get("item_id", entry.get("seedId", entry.get("seed_id", -1))))
            )
            item_type = str(entry.get("itemType", entry.get("item_type", "seed"))).strip().lower()
        except Exception:
            continue

        if item_id < 0:
            continue

        item_type = normalize_item_type(item_type)

        parsed[drop_id] = {
            "id": drop_id,
            "x": x,
            "y": y,
            "item_id": item_id,
            "item_type": item_type,
            "created_at": time.monotonic(),
        }

    return parsed


def parse_world_planted_trees(raw: Any, width: int, height: int) -> Dict[str, Dict[str, Any]]:
    parsed: Dict[str, Dict[str, Any]] = {}
    entries: List[Any]

    if isinstance(raw, dict):
        entries = list(raw.values())
    elif isinstance(raw, list):
        entries = raw
    else:
        return parsed

    for entry in entries:
        if not isinstance(entry, dict):
            continue

        try:
            x = int(entry.get("x", -1))
            y = int(entry.get("y", -1))
            seed_id = int(entry.get("itemId", entry.get("item_id", entry.get("seedId", entry.get("seed_id", -1)))))
            planted_at_ms = int(entry.get("plantedAtMs", entry.get("planted_at_ms", 0)))
        except Exception:
            continue

        if x < 0 or x >= width or y < 0 or y >= height or seed_id < 0:
            continue

        tree_id = str(entry.get("id") or secrets.token_hex(6)).strip()
        if not tree_id:
            tree_id = secrets.token_hex(6)

        key = get_tree_key(x, y)
        parsed[key] = {
            "id": tree_id,
            "x": x,
            "y": y,
            "seed_id": seed_id,
            "planted_at_ms": max(0, planted_at_ms),
        }

    return parsed


def split_gem_amount(total: int) -> list[int]:
    remaining = max(0, int(total))
    drops: list[int] = []

    for value in GEM_DENOMINATIONS:
        while remaining >= value:
            drops.append(value)
            remaining -= value

    return drops


def spawn_gem_drops(world: Dict[str, Any], tile_x: int, tile_y: int, total_amount: int) -> List[Dict[str, Any]]:
    values = split_gem_amount(total_amount)
    if not values:
        return []

    gem_drops = ensure_world_gem_state(world)
    created: List[Dict[str, Any]] = []

    for value in values:
        drop_id = secrets.token_hex(6)
        offset_x = random.uniform(-GEM_DROP_SPAWN_RADIUS, GEM_DROP_SPAWN_RADIUS)
        offset_y = random.uniform(-GEM_DROP_SPAWN_RADIUS, GEM_DROP_SPAWN_RADIUS)
        local_x = max(GEM_DROP_MIN_IN_TILE, min(GEM_DROP_MAX_IN_TILE, 0.5 + offset_x))
        local_y = max(GEM_DROP_MIN_IN_TILE, min(GEM_DROP_MAX_IN_TILE, 0.5 + offset_y))
        drop = {
            "id": drop_id,
            "x": float(tile_x + local_x),
            "y": float(tile_y + local_y),
            "value": int(value),
            "created_at": time.monotonic(),
        }
        gem_drops[drop_id] = drop
        created.append(drop)

    return created


def spawn_item_drop(
    world: Dict[str, Any],
    tile_x: int,
    tile_y: int,
    item_id: int,
    *,
    item_type: str = "seed",
    allow_tile_stack: bool = False,
) -> Dict[str, Any] | None:
    if item_id < 0:
        return None

    seed_drops = ensure_world_seed_state(world)

    if not allow_tile_stack:
        # Default behavior avoids stacking multiple floating drops in the same tile.
        for existing in seed_drops.values():
            if not isinstance(existing, dict):
                continue
            try:
                existing_tile_x = int(float(existing.get("x", -1)))
                existing_tile_y = int(float(existing.get("y", -1)))
            except Exception:
                continue
            if existing_tile_x == int(tile_x) and existing_tile_y == int(tile_y):
                return None

    # Ensure the item_type actually matches the item_id; if not, try to infer
    # a correct type so client and inventory use consistent keys.
    try:
        desired_type = normalize_item_type(item_type)
    except Exception:
        desired_type = "seed"

    # If the provided type doesn't resolve to a known definition for this
    # item_id, attempt to find a matching type (prefer block then seed).
    if get_item_definition(item_id, desired_type) is None:
        for candidate in ("block", "seed", "furniture", "clothes"):
            try:
                if get_item_definition(item_id, candidate) is not None:
                    desired_type = candidate
                    break
            except Exception:
                continue

    item_type = desired_type

    drop_id = secrets.token_hex(6)
    offset_x = random.uniform(-GEM_DROP_SPAWN_RADIUS, GEM_DROP_SPAWN_RADIUS)
    offset_y = random.uniform(-GEM_DROP_SPAWN_RADIUS, GEM_DROP_SPAWN_RADIUS)
    local_x = max(GEM_DROP_MIN_IN_TILE, min(GEM_DROP_MAX_IN_TILE, 0.5 + offset_x))
    local_y = max(GEM_DROP_MIN_IN_TILE, min(GEM_DROP_MAX_IN_TILE, 0.5 + offset_y))
    drop = {
        "id": drop_id,
        "x": float(tile_x + local_x),
        "y": float(tile_y + local_y),
        "item_id": int(item_id),
        "item_type": normalize_item_type(item_type),
        "created_at": time.monotonic(),
    }
    seed_drops[drop_id] = drop
    return drop


def spawn_item_drop_center(
    world: Dict[str, Any],
    tile_x: int,
    tile_y: int,
    item_id: int,
    *,
    item_type: str = "seed",
    allow_tile_stack: bool = False,
) -> Dict[str, Any] | None:
    if item_id < 0:
        return None

    width = int(world.get("width", 0))
    height = int(world.get("height", 0))
    if width <= 0 or height <= 0:
        return None

    # Only drop on the center tile (no nearby fallback).
    candidate_x = int(tile_x)
    candidate_y = int(tile_y)

    if candidate_x < 0 or candidate_x >= width or candidate_y < 0 or candidate_y >= height:
        return None

    return spawn_item_drop(
        world,
        candidate_x,
        candidate_y,
        item_id,
        item_type=item_type,
        allow_tile_stack=allow_tile_stack,
    )


def collect_gems_for_player(world: Dict[str, Any], player: Dict[str, Any]) -> Tuple[List[str], int]:
    gem_drops = ensure_world_gem_state(world)
    if not gem_drops:
        return [], 0

    try:
        player_center_x = float(player.get("x", 0.0)) + 0.36
        player_center_y = float(player.get("y", 0.0)) + 0.46
    except Exception:
        return [], 0

    collected_ids: List[str] = []
    collected_total = 0
    radius_sq = PLAYER_PICKUP_RADIUS * PLAYER_PICKUP_RADIUS

    for drop_id, drop in list(gem_drops.items()):
        if not isinstance(drop, dict):
            continue

        try:
            dx = float(drop.get("x", 0.0)) - player_center_x
            dy = float(drop.get("y", 0.0)) - player_center_y
            value = max(0, int(drop.get("value", 0)))
        except Exception:
            continue

        if value <= 0:
            gem_drops.pop(drop_id, None)
            continue

        if (dx * dx) + (dy * dy) <= radius_sq:
            gem_drops.pop(drop_id, None)
            collected_ids.append(str(drop_id))
            collected_total += value

    return collected_ids, collected_total


def collect_item_drops_for_player(
    world: Dict[str, Any],
    player: Dict[str, Any],
    inventory_slots: int | None = None,
    inventory: Dict[str, int] | None = None,
) -> Tuple[List[str], List[Dict[str, Any]], bool]:
    """Return ids/items the player can pick up plus overflow flag.

    ``overflow`` will be True if there were drops within pickup range but the
    inventory limit prevented collecting them; in that case no drops are
    removed from the world and the other two lists will be empty.
    """

    item_drops = ensure_world_seed_state(world)
    if not item_drops:
        return [], [], False

    try:
        player_center_x = float(player.get("x", 0.0)) + 0.36
        player_center_y = float(player.get("y", 0.0)) + 0.46
    except Exception:
        return [], []

    # gather candidates first (without mutating world)
    candidate_ids: List[str] = []
    candidate_items: List[Dict[str, Any]] = []
    radius_sq = PLAYER_PICKUP_RADIUS * PLAYER_PICKUP_RADIUS

    for drop_id, drop in list(item_drops.items()):
        if not isinstance(drop, dict):
            continue

        try:
            dx = float(drop.get("x", 0.0)) - player_center_x
            dy = float(drop.get("y", 0.0)) - player_center_y
            item_id = int(drop.get("item_id", drop.get("seed_id", -1)))
            item_type = str(drop.get("item_type", "seed")).strip().lower()
        except Exception:
            continue

        if item_id < 0:
            # invalid drop; clean up immediately
            item_drops.pop(drop_id, None)
            continue

        if (dx * dx) + (dy * dy) <= radius_sq:
            item_type = normalize_item_type(item_type)
            candidate_ids.append(str(drop_id))
            candidate_items.append({"itemId": item_id, "itemType": item_type})

    # capacity check
    overflowed = False
    if inventory_slots is not None and candidate_items:
        inv = inventory if inventory is not None else normalize_inventory(player.get("inventory", {}))
        used = len(inv)
        new_keys = set()
        for entry in candidate_items:
            key = make_inventory_key(entry.get("itemType", "seed"), entry.get("itemId", -1))
            if key and key not in inv:
                new_keys.add(key)
        if used + len(new_keys) > inventory_slots:
            # cannot pick up; leave drops in the world
            overflowed = True
            return [], [], overflowed

    # actually remove and return
    collected_ids: List[str] = []
    collected_items: List[Dict[str, Any]] = []

    for idx, entry in enumerate(candidate_items):
        drop_id = candidate_ids[idx]
        item_drops.pop(drop_id, None)
        collected_ids.append(drop_id)
        collected_items.append(entry)

    return collected_ids, collected_items, overflowed


def get_tile_damage_key(x: int, y: int, layer: str) -> str:
    return f"{layer}:{x}:{y}"


def serialize_tile_damage(world: Dict[str, Any]) -> List[Dict[str, Any]]:
    states = world.get("tile_damage")
    if not isinstance(states, dict):
        return []

    payload: List[Dict[str, Any]] = []
    for state in states.values():
        if not isinstance(state, dict):
            continue

        try:
            payload.append(
                {
                    "x": int(state.get("x", 0)),
                    "y": int(state.get("y", 0)),
                    "layer": str(state.get("layer", "foreground")),
                    "hits": int(state.get("hits", 0)),
                    "maxHits": int(state.get("max_hits", 1)),
                }
            )
        except Exception:
            continue

    return payload


def clear_tile_damage(world: Dict[str, Any], x: int, y: int, layer: str | None = None) -> List[Dict[str, Any]]:
    states = world.setdefault("tile_damage", {})
    if not isinstance(states, dict):
        world["tile_damage"] = {}
        states = world["tile_damage"]

    layers = [layer] if layer else ["foreground", "background"]
    cleared: List[Dict[str, Any]] = []

    for layer_name in layers:
        if layer_name not in {"foreground", "background"}:
            continue

        key = get_tile_damage_key(x, y, layer_name)
        if key in states:
            states.pop(key, None)
            cleared.append({"x": x, "y": y, "layer": layer_name})

    return cleared


def apply_tile_hit(world: Dict[str, Any], x: int, y: int, layer: str, tile_id: int) -> Dict[str, Any]:
    states = world.setdefault("tile_damage", {})
    if not isinstance(states, dict):
        world["tile_damage"] = {}
        states = world["tile_damage"]

    key = get_tile_damage_key(x, y, layer)
    max_hits = get_block_toughness(tile_id)
    now = time.monotonic()

    state = states.get(key)
    if not isinstance(state, dict) or int(state.get("tile_id", -1)) != int(tile_id):
        state = {
            "x": x,
            "y": y,
            "layer": layer,
            "tile_id": tile_id,
            "hits": 0,
            "max_hits": max_hits,
            "last_hit_at": now,
            "regen_delay": random.uniform(DAMAGE_REGEN_MIN_SECONDS, DAMAGE_REGEN_MAX_SECONDS),
        }
        states[key] = state

    state["max_hits"] = max_hits
    state["hits"] = min(max_hits, int(state.get("hits", 0)) + 1)
    state["last_hit_at"] = now
    state["regen_delay"] = random.uniform(DAMAGE_REGEN_MIN_SECONDS, DAMAGE_REGEN_MAX_SECONDS)

    return state


def collect_expired_tile_damage(world: Dict[str, Any], now_monotonic: float) -> List[Dict[str, Any]]:
    states = world.setdefault("tile_damage", {})
    if not isinstance(states, dict):
        world["tile_damage"] = {}
        return []

    expired: List[Dict[str, Any]] = []
    for key, state in list(states.items()):
        if not isinstance(state, dict):
            states.pop(key, None)
            continue

        try:
            last_hit_at = float(state.get("last_hit_at", 0.0))
            regen_delay = float(state.get("regen_delay", DAMAGE_REGEN_MIN_SECONDS))
        except Exception:
            states.pop(key, None)
            continue

        if now_monotonic - last_hit_at >= regen_delay:
            states.pop(key, None)
            expired.append(
                {
                    "x": int(state.get("x", 0)),
                    "y": int(state.get("y", 0)),
                    "layer": str(state.get("layer", "foreground")),
                }
            )

    return expired


def default_door(width: int, height: int) -> Dict[str, int]:
    return {
        "x": max(0, width // 2),
        "y": max(1, int(height * 0.58) - 1),
    }


def sanitize_door(door: Any, width: int, height: int) -> Dict[str, int]:
    fallback = default_door(width, height)
    if not isinstance(door, dict):
        return fallback

    try:
        x = int(door.get("x", fallback["x"]))
        y = int(door.get("y", fallback["y"]))
    except Exception:
        return fallback

    x = max(0, min(width - 1, x))
    y = max(0, min(height - 1, y))
    return {"x": x, "y": y}


def get_spawn_from_door(world: Dict[str, Any]) -> Tuple[float, float]:
    door = sanitize_door(world.get("door"), world["width"], world["height"])
    spawn_x = float(door["x"] + 0.14)
    # Collider height is 0.92 in the client. Spawning at door_y + (1 - 0.92)
    # places the player visually on the door tile while standing on the support block below.
    spawn_y = float(max(0, door["y"] + 0.08))
    return spawn_x, spawn_y


def enforce_bedrock_under_door(
    world: Dict[str, Any], previous_door: Dict[str, int] | None = None
) -> bool:
    air_block_id = int(RUNTIME_BLOCK_IDS.get("air", 0))
    door_block_id = int(RUNTIME_BLOCK_IDS.get("door", air_block_id))
    bedrock_block_id = int(RUNTIME_BLOCK_IDS.get("bedrock", air_block_id))

    width = int(world["width"])
    height = int(world["height"])
    door = sanitize_door(world.get("door"), width, height)
    world["door"] = door

    changed = False

    if previous_door:
        old_door = sanitize_door(previous_door, width, height)
        if old_door != door:
            old_floor_y = old_door["y"] + 1
            if 0 <= old_floor_y < height:
                old_index = old_floor_y * width + old_door["x"]
                foreground = world.get("foreground")
                if isinstance(foreground, list) and old_index < len(foreground):
                    old_door_index = old_door["y"] * width + old_door["x"]
                    if old_door_index < len(foreground) and int(foreground[old_door_index]) == door_block_id:
                        foreground[old_door_index] = air_block_id
                        changed = True

                    if int(foreground[old_index]) == bedrock_block_id:
                        foreground[old_index] = air_block_id
                        changed = True

    floor_y = door["y"] + 1
    if floor_y < 0 or floor_y >= height:
        return changed

    index = floor_y * width + door["x"]
    foreground = world.get("foreground")
    if not isinstance(foreground, list) or index >= len(foreground):
        return changed

    door_index = door["y"] * width + door["x"]
    if door_index < len(foreground) and int(foreground[door_index]) != door_block_id:
        foreground[door_index] = door_block_id
        changed = True

    if int(foreground[index]) == bedrock_block_id:
        return changed

    foreground[index] = bedrock_block_id
    return True


def create_world(name: str) -> Dict[str, Any]:
    generated = generate_world_layers(
        WORLD_WIDTH,
        WORLD_HEIGHT,
        name,
        block_ids=RUNTIME_BLOCK_IDS,
    )
    door = sanitize_door(generated.get("door"), generated["width"], generated["height"])
    world = {
        "name": name,
        "width": generated["width"],
        "height": generated["height"],
        "foreground": generated["foreground"],
        "background": generated["background"],
        "door": door,
        # each world has a persistent weather ID; default to 1
        "weather": 1,
        "players": {},
        "tile_damage": {},
        "gem_drops": {},
        "seed_drops": {},
        "planted_trees": {},
    }

    enforce_bedrock_under_door(world)
    return world


def save_world(world: Dict[str, Any]) -> None:
    now = int(time.time())
    # Support saving only weather (for /weather command)
    only_weather = getattr(world, "_only_weather", False)
    # consume the flag so future saves without the explicit
    # only_weather parameter perform a full save
    if only_weather and "_only_weather" in world:
        del world["_only_weather"]
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM worlds WHERE name = ?", (world["name"],)).fetchone()
        if only_weather and existing:
            # Update only weather property, do not touch door or tiles
            conn.execute(
                "UPDATE worlds SET weather = ?, updated_at = ? WHERE name = ?",
                (int(world.get("weather", 0)), now, world["name"]),
            )
            return

        door = sanitize_door(world.get("door"), world["width"], world["height"])
        world["door"] = door
        tiles_json = json.dumps(
            {
                "foreground": world["foreground"],
                "background": world["background"],
                "door": door,
                "gem_drops": serialize_gem_drops(world),
                "seed_drops": serialize_seed_drops(world),
                "planted_trees": serialize_planted_trees(world),
            }
        )
        if existing:
            conn.execute(
                """
                UPDATE worlds
                SET width = ?, height = ?, tiles_json = ?, door_x = ?, door_y = ?, weather = ?, updated_at = ?
                WHERE name = ?
                """,
                (world["width"], world["height"], tiles_json, door["x"], door["y"], int(world.get("weather", 0)), now, world["name"]),
            )
        else:
            conn.execute(
                """
                INSERT INTO worlds (name, width, height, tiles_json, door_x, door_y, weather, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (world["name"], world["width"], world["height"], tiles_json, door["x"], door["y"], int(world.get("weather", 0)), now, now),
            )


def load_world(name: str) -> Dict[str, Any]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM worlds WHERE name = ?", (name,)).fetchone()

    if not row:
        world = create_world(name)
        save_world(world)
        return world

    width = int(row["width"])
    height = int(row["height"])
    expected = width * height

    try:
        parsed_tiles = json.loads(row["tiles_json"])
    except Exception:
        parsed_tiles = {}

    foreground: List[int] = []
    background: List[int] = []
    parsed_door: Dict[str, int] | None = None
    db_door: Dict[str, int] | None = None

    try:
        if row["door_x"] is not None and row["door_y"] is not None:
            db_door = sanitize_door({"x": int(row["door_x"]), "y": int(row["door_y"])}, width, height)
    except Exception:
        db_door = None

    if isinstance(parsed_tiles, list):
        for value in parsed_tiles[:expected]:
            try:
                tile_id = int(value)
            except Exception:
                tile_id = 0

            foreground.append(max(0, tile_id))
        while len(foreground) < expected:
            foreground.append(0)
        background = [0 for _ in range(expected)]
        parsed_gem_drops: Any = []
        parsed_seed_drops: Any = []
        parsed_planted_trees: Any = []
    else:
        raw_foreground = parsed_tiles.get("foreground", []) if isinstance(parsed_tiles, dict) else []
        raw_background = parsed_tiles.get("background", []) if isinstance(parsed_tiles, dict) else []
        parsed_gem_drops = parsed_tiles.get("gem_drops", []) if isinstance(parsed_tiles, dict) else []
        parsed_seed_drops = parsed_tiles.get("seed_drops", []) if isinstance(parsed_tiles, dict) else []
        parsed_planted_trees = parsed_tiles.get("planted_trees", []) if isinstance(parsed_tiles, dict) else []
        if isinstance(parsed_tiles, dict):
            parsed_door = sanitize_door(parsed_tiles.get("door"), width, height)

        for value in raw_foreground[:expected]:
            try:
                tile_id = int(value)
            except Exception:
                tile_id = 0
            foreground.append(max(0, tile_id))

        for value in raw_background[:expected]:
            try:
                tile_id = int(value)
            except Exception:
                tile_id = 0
            background.append(max(0, tile_id))

        while len(foreground) < expected:
            foreground.append(0)
        while len(background) < expected:
            background.append(0)

    resolved_door = db_door or parsed_door or default_door(width, height)
    gem_drops = parse_world_gem_drops(parsed_gem_drops, width, height)
    seed_drops = parse_world_seed_drops(parsed_seed_drops, width, height)
    planted_trees = parse_world_planted_trees(parsed_planted_trees, width, height)

    # read weather from database column, fallback to 1 if missing/invalid
    try:
        weather_val = int(row["weather"] or 1)
    except Exception:
        weather_val = 1

    return {
        "name": name,
        "width": width,
        "height": height,
        "foreground": foreground,
        "background": background,
        "door": resolved_door,
        "previous_door": parsed_door,
        "weather": weather_val,
        "players": {},
        "tile_damage": {},
        "gem_drops": gem_drops,
        "seed_drops": seed_drops,
        "planted_trees": planted_trees,
    }


async def schedule_world_save(world_name: str, only_weather: bool = False) -> None:
    existing = save_tasks.get(world_name)
    if existing and not existing.done():
        existing.cancel()

    async def _run() -> None:
        await asyncio.sleep(0.25)
        world = world_cache.get(world_name)
        if world:
            # if caller requested only-weather, mark flag on world
            if only_weather:
                world["_only_weather"] = True
            await asyncio.to_thread(save_world, world)

    save_tasks[world_name] = asyncio.create_task(_run())


def get_world(name_input: str | None) -> Dict[str, Any]:
    world_name = normalize_name(name_input, "start") or "start"

    if world_name not in world_cache:
        loaded_world = load_world(world_name)
        previous_door = loaded_world.get("previous_door")
        if enforce_bedrock_under_door(loaded_world, previous_door=previous_door):
            save_world(loaded_world)
        loaded_world.pop("previous_door", None)
        world_cache[world_name] = loaded_world

    return world_cache[world_name]
