from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import hashlib
import hmac
import json
import os
import random
import re
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any

import jwt
from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from modules.block_registry import (
    BlockCatalog,
    DEFAULT_RUNTIME_BLOCK_ROLES,
)
from modules.chat_commands import process_chat_command
from modules.command_runtime import apply_command_result
from modules.editor_tools import load_texture47_configs, register_editor_routes
from modules.ws_player_actions import respawn_player_to_door
from modules.worldgen import generate_world_layers
from pydantic import BaseModel, Field

PORT = int(os.getenv("PORT", "3000"))
JWT_SECRET = os.getenv("JWT_SECRET", "dev_secret_change_me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRES_SECONDS = 7 * 24 * 60 * 60
WORLD_WIDTH = 120
WORLD_HEIGHT = 70
DAMAGE_REGEN_MIN_SECONDS = 5.0
DAMAGE_REGEN_MAX_SECONDS = 7.0
PLAYER_PICKUP_RADIUS = 0.72
GEM_DENOMINATIONS = (100, 50, 10, 5, 1)
GEM_DROP_SPAWN_RADIUS = 0.23
GEM_DROP_MIN_IN_TILE = 0.08
GEM_DROP_MAX_IN_TILE = 0.92

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
DATA_DIR = BASE_DIR / "data" / "db"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "game.db"
BLOCKS_PATH = PUBLIC_DIR / "data" / "blocks.json"
SEEDS_PATH = PUBLIC_DIR / "data" / "seeds.json"


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def initialize_db() -> None:
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS worlds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                tiles_json TEXT NOT NULL,
                door_x INTEGER,
                door_y INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS guest_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL UNIQUE,
                username TEXT NOT NULL,
                gems INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )
            """
        )

        columns = {
            str(row["name"]).lower()
            for row in conn.execute("PRAGMA table_info(worlds)").fetchall()
        }
        if "door_x" not in columns:
            conn.execute("ALTER TABLE worlds ADD COLUMN door_x INTEGER")
        if "door_y" not in columns:
            conn.execute("ALTER TABLE worlds ADD COLUMN door_y INTEGER")

        user_columns = {
            str(row["name"]).lower()
            for row in conn.execute("PRAGMA table_info(users)").fetchall()
        }
        if "gems" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN gems INTEGER NOT NULL DEFAULT 0")


def normalize_name(value: str | None, fallback: str = "") -> str:
    return (value or fallback).strip().lower()


def get_user_gems(user_id: int) -> int:
    if user_id <= 0:
        return 0

    with get_db() as conn:
        row = conn.execute("SELECT gems FROM users WHERE id = ?", (user_id,)).fetchone()

    if not row:
        return 0

    try:
        return max(0, int(row["gems"]))
    except Exception:
        return 0


def set_user_gems(user_id: int, gems: int) -> None:
    if user_id <= 0:
        return

    with get_db() as conn:
        conn.execute("UPDATE users SET gems = ? WHERE id = ?", (max(0, int(gems)), user_id))


def normalize_guest_device_id(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9_-]{12,128}", normalized):
        return ""
    return normalized


def get_or_create_guest_profile(device_id: str) -> dict[str, Any] | None:
    normalized_device_id = normalize_guest_device_id(device_id)
    if not normalized_device_id:
        return None

    now = int(time.time())
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id, username, gems FROM guest_profiles WHERE device_id = ?",
            (normalized_device_id,),
        ).fetchone()
        if existing:
            return {
                "id": int(existing["id"]),
                "device_id": normalized_device_id,
                "username": str(existing["username"]),
                "gems": max(0, int(existing["gems"])),
            }

        guest_number = secrets.randbelow(900) + 100
        guest_username = f"Guest_{guest_number}"
        cursor = conn.execute(
            "INSERT INTO guest_profiles (device_id, username, gems, created_at) VALUES (?, ?, ?, ?)",
            (normalized_device_id, guest_username, 0, now),
        )
        profile_id = int(cursor.lastrowid)

    return {
        "id": profile_id,
        "device_id": normalized_device_id,
        "username": guest_username,
        "gems": 0,
    }


def get_guest_profile_gems(profile_id: int) -> int:
    if profile_id <= 0:
        return 0

    with get_db() as conn:
        row = conn.execute("SELECT gems FROM guest_profiles WHERE id = ?", (profile_id,)).fetchone()

    if not row:
        return 0

    try:
        return max(0, int(row["gems"]))
    except Exception:
        return 0


def set_guest_profile_gems(profile_id: int, gems: int) -> None:
    if profile_id <= 0:
        return

    with get_db() as conn:
        conn.execute("UPDATE guest_profiles SET gems = ? WHERE id = ?", (max(0, int(gems)), profile_id))


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 200_000)
    return f"{salt}:{digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, expected = stored.split(":", 1)
    except ValueError:
        return False

    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 200_000)
    return hmac.compare_digest(digest.hex(), expected)


def create_token(user_id: int, username: str, extra_claims: dict[str, Any] | None = None) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "username": username,
        "iat": now,
        "exp": now + JWT_EXPIRES_SECONDS,
    }
    if isinstance(extra_claims, dict):
        payload.update(extra_claims)
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def parse_token(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None

    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        return None


BLOCK_CATALOG = BlockCatalog(BLOCKS_PATH, required_roles=DEFAULT_RUNTIME_BLOCK_ROLES)
BACKGROUND_BLOCK_IDS: set[int] = set()
BLOCKS_BY_ID: dict[int, dict[str, Any]] = {}
RUNTIME_BLOCK_IDS: dict[str, int] = {}


def _sync_block_catalog_cache() -> None:
    global BACKGROUND_BLOCK_IDS, BLOCKS_BY_ID, RUNTIME_BLOCK_IDS
    BACKGROUND_BLOCK_IDS = set(BLOCK_CATALOG.background_ids)
    BLOCKS_BY_ID = dict(BLOCK_CATALOG.blocks_by_id)
    RUNTIME_BLOCK_IDS = dict(BLOCK_CATALOG.runtime_ids)


def refresh_block_definitions_if_changed(force: bool = False) -> None:
    if BLOCK_CATALOG.refresh_if_changed(force=force):
        _sync_block_catalog_cache()


def load_blocks_payload() -> dict[str, Any]:
    return BLOCK_CATALOG.load_payload()


def load_seeds_payload() -> dict[str, Any]:
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


def get_seed_definition(seed_id: int) -> dict[str, Any] | None:
    if seed_id < 0:
        return None

    payload = load_seeds_payload()
    seeds = payload.get("seeds", []) if isinstance(payload, dict) else []
    if not isinstance(seeds, list):
        return None

    for seed in seeds:
        if not isinstance(seed, dict):
            continue

        try:
            current_id = int(seed.get("SEED_ID", -1))
        except Exception:
            current_id = -1

        if current_id == seed_id:
            return seed

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


def get_block_seed_drop_ids(tile_id: int) -> list[int]:
    block = BLOCKS_BY_ID.get(tile_id)
    if not block:
        return []

    drop_ids: list[int] = []

    # Canonical format: optional list of seed IDs with per-entry chance.
    if "SEED_IDS" in block:
        raw_seed_ids = block.get("SEED_IDS")
        if not isinstance(raw_seed_ids, list):
            return []

        for entry in raw_seed_ids:
            chance = 1.0
            seed_id = -1

            if isinstance(entry, dict):
                try:
                    chance = float(entry.get("CHANCE", entry.get("chance", 0.2)))
                except Exception:
                    chance = 0.2

                try:
                    seed_id = int(entry.get("ID", entry.get("SEED_ID", entry.get("id", -1))))
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
                seed_id = int(entry.get("SEED_ID", -1))
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
        seed_id = int(block.get("SEED_DROP_ID", -1))
    except Exception:
        seed_id = -1

    if seed_id < 0:
        return []

    return [seed_id]


def split_gem_amount(total: int) -> list[int]:
    remaining = max(0, int(total))
    drops: list[int] = []

    for value in GEM_DENOMINATIONS:
        while remaining >= value:
            drops.append(value)
            remaining -= value

    return drops


def ensure_world_gem_state(world: dict[str, Any]) -> dict[str, dict[str, Any]]:
    gem_drops = world.setdefault("gem_drops", {})
    if not isinstance(gem_drops, dict):
        world["gem_drops"] = {}
        gem_drops = world["gem_drops"]
    return gem_drops


def ensure_world_seed_state(world: dict[str, Any]) -> dict[str, dict[str, Any]]:
    seed_drops = world.setdefault("seed_drops", {})
    if not isinstance(seed_drops, dict):
        world["seed_drops"] = {}
        seed_drops = world["seed_drops"]
    return seed_drops


def ensure_world_tree_state(world: dict[str, Any]) -> dict[str, dict[str, Any]]:
    planted_trees = world.setdefault("planted_trees", {})
    if not isinstance(planted_trees, dict):
        world["planted_trees"] = {}
        planted_trees = world["planted_trees"]
    return planted_trees


def get_tree_key(x: int, y: int) -> str:
    return f"{x}:{y}"


def get_planted_tree_at(world: dict[str, Any], x: int, y: int) -> dict[str, Any] | None:
    tree = ensure_world_tree_state(world).get(get_tree_key(x, y))
    return tree if isinstance(tree, dict) else None


def place_planted_tree(world: dict[str, Any], x: int, y: int, seed_id: int, planted_at_ms: int) -> dict[str, Any] | None:
    if seed_id < 0:
        return None

    if get_seed_definition(seed_id) is None:
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


def remove_planted_tree_at(world: dict[str, Any], x: int, y: int) -> dict[str, Any] | None:
    tree = ensure_world_tree_state(world).pop(get_tree_key(x, y), None)
    return tree if isinstance(tree, dict) else None


def serialize_gem_drops(world: dict[str, Any]) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
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


def serialize_seed_drops(world: dict[str, Any]) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for drop in ensure_world_seed_state(world).values():
        if not isinstance(drop, dict):
            continue

        try:
            payload.append(
                {
                    "id": str(drop.get("id", "")),
                    "x": float(drop.get("x", 0.0)),
                    "y": float(drop.get("y", 0.0)),
                    "seedId": int(drop.get("seed_id", -1)),
                }
            )
        except Exception:
            continue

    return payload


def serialize_planted_trees(world: dict[str, Any]) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for tree in ensure_world_tree_state(world).values():
        if not isinstance(tree, dict):
            continue

        try:
            payload.append(
                {
                    "id": str(tree.get("id", "")),
                    "x": int(tree.get("x", 0)),
                    "y": int(tree.get("y", 0)),
                    "seedId": int(tree.get("seed_id", -1)),
                    "plantedAtMs": int(tree.get("planted_at_ms", 0)),
                }
            )
        except Exception:
            continue

    return payload


def parse_world_gem_drops(raw: Any, width: int, height: int) -> dict[str, dict[str, Any]]:
    parsed: dict[str, dict[str, Any]] = {}
    entries: list[Any]

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


def parse_world_seed_drops(raw: Any, width: int, height: int) -> dict[str, dict[str, Any]]:
    parsed: dict[str, dict[str, Any]] = {}
    entries: list[Any]

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
            seed_id = int(entry.get("seedId", entry.get("seed_id", -1)))
        except Exception:
            continue

        if seed_id < 0:
            continue

        parsed[drop_id] = {
            "id": drop_id,
            "x": x,
            "y": y,
            "seed_id": seed_id,
            "created_at": time.monotonic(),
        }

    return parsed


def parse_world_planted_trees(raw: Any, width: int, height: int) -> dict[str, dict[str, Any]]:
    parsed: dict[str, dict[str, Any]] = {}
    entries: list[Any]

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
            seed_id = int(entry.get("seedId", entry.get("seed_id", -1)))
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


def spawn_gem_drops(world: dict[str, Any], tile_x: int, tile_y: int, total_amount: int) -> list[dict[str, Any]]:
    values = split_gem_amount(total_amount)
    if not values:
        return []

    gem_drops = ensure_world_gem_state(world)
    created: list[dict[str, Any]] = []

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


def spawn_seed_drop(world: dict[str, Any], tile_x: int, tile_y: int, seed_id: int) -> dict[str, Any] | None:
    if seed_id < 0:
        return None

    seed_drops = ensure_world_seed_state(world)

    # Do not stack multiple floating seed drops in the same tile.
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

    drop_id = secrets.token_hex(6)
    offset_x = random.uniform(-GEM_DROP_SPAWN_RADIUS, GEM_DROP_SPAWN_RADIUS)
    offset_y = random.uniform(-GEM_DROP_SPAWN_RADIUS, GEM_DROP_SPAWN_RADIUS)
    local_x = max(GEM_DROP_MIN_IN_TILE, min(GEM_DROP_MAX_IN_TILE, 0.5 + offset_x))
    local_y = max(GEM_DROP_MIN_IN_TILE, min(GEM_DROP_MAX_IN_TILE, 0.5 + offset_y))
    drop = {
        "id": drop_id,
        "x": float(tile_x + local_x),
        "y": float(tile_y + local_y),
        "seed_id": int(seed_id),
        "created_at": time.monotonic(),
    }
    seed_drops[drop_id] = drop
    return drop


def collect_gems_for_player(world: dict[str, Any], player: dict[str, Any]) -> tuple[list[str], int]:
    gem_drops = ensure_world_gem_state(world)
    if not gem_drops:
        return [], 0

    try:
        player_center_x = float(player.get("x", 0.0)) + 0.36
        player_center_y = float(player.get("y", 0.0)) + 0.46
    except Exception:
        return [], 0

    collected_ids: list[str] = []
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


def collect_seed_drops_for_player(world: dict[str, Any], player: dict[str, Any]) -> tuple[list[str], list[int]]:
    seed_drops = ensure_world_seed_state(world)
    if not seed_drops:
        return [], []

    try:
        player_center_x = float(player.get("x", 0.0)) + 0.36
        player_center_y = float(player.get("y", 0.0)) + 0.46
    except Exception:
        return [], []

    collected_ids: list[str] = []
    collected_seed_ids: list[int] = []
    radius_sq = PLAYER_PICKUP_RADIUS * PLAYER_PICKUP_RADIUS

    for drop_id, drop in list(seed_drops.items()):
        if not isinstance(drop, dict):
            continue

        try:
            dx = float(drop.get("x", 0.0)) - player_center_x
            dy = float(drop.get("y", 0.0)) - player_center_y
            seed_id = int(drop.get("seed_id", -1))
        except Exception:
            continue

        if seed_id < 0:
            seed_drops.pop(drop_id, None)
            continue

        if (dx * dx) + (dy * dy) <= radius_sq:
            seed_drops.pop(drop_id, None)
            collected_ids.append(str(drop_id))
            collected_seed_ids.append(seed_id)

    return collected_ids, collected_seed_ids


def get_tile_damage_key(x: int, y: int, layer: str) -> str:
    return f"{layer}:{x}:{y}"


def serialize_tile_damage(world: dict[str, Any]) -> list[dict[str, Any]]:
    states = world.get("tile_damage")
    if not isinstance(states, dict):
        return []

    payload: list[dict[str, Any]] = []
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


def clear_tile_damage(world: dict[str, Any], x: int, y: int, layer: str | None = None) -> list[dict[str, Any]]:
    states = world.setdefault("tile_damage", {})
    if not isinstance(states, dict):
        world["tile_damage"] = {}
        states = world["tile_damage"]

    layers = [layer] if layer else ["foreground", "background"]
    cleared: list[dict[str, Any]] = []

    for layer_name in layers:
        if layer_name not in {"foreground", "background"}:
            continue

        key = get_tile_damage_key(x, y, layer_name)
        if key in states:
            states.pop(key, None)
            cleared.append({"x": x, "y": y, "layer": layer_name})

    return cleared


def apply_tile_hit(world: dict[str, Any], x: int, y: int, layer: str, tile_id: int) -> dict[str, Any]:
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


def collect_expired_tile_damage(world: dict[str, Any], now_monotonic: float) -> list[dict[str, Any]]:
    states = world.setdefault("tile_damage", {})
    if not isinstance(states, dict):
        world["tile_damage"] = {}
        return []

    expired: list[dict[str, Any]] = []
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


def default_door(width: int, height: int) -> dict[str, int]:
    return {
        "x": max(0, width // 2),
        "y": max(1, int(height * 0.58) - 1),
    }


def sanitize_door(door: Any, width: int, height: int) -> dict[str, int]:
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


def get_spawn_from_door(world: dict[str, Any]) -> tuple[float, float]:
    door = sanitize_door(world.get("door"), world["width"], world["height"])
    spawn_x = float(door["x"] + 0.14)
    # Collider height is 0.92 in the client. Spawning at door_y + (1 - 0.92)
    # places the player visually on the door tile while standing on the support block below.
    spawn_y = float(max(0, door["y"] + 0.08))
    return spawn_x, spawn_y


def enforce_bedrock_under_door(world: dict[str, Any], previous_door: dict[str, int] | None = None) -> bool:
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


def create_world(name: str) -> dict[str, Any]:
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
        "players": {},
        "tile_damage": {},
        "gem_drops": {},
        "seed_drops": {},
        "planted_trees": {},
    }

    enforce_bedrock_under_door(world)
    return world


def save_world(world: dict[str, Any]) -> None:
    now = int(time.time())
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

    with get_db() as conn:
        existing = conn.execute("SELECT id, created_at FROM worlds WHERE name = ?", (world["name"],)).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE worlds
                SET width = ?, height = ?, tiles_json = ?, door_x = ?, door_y = ?, updated_at = ?
                WHERE name = ?
                """,
                (world["width"], world["height"], tiles_json, door["x"], door["y"], now, world["name"]),
            )
        else:
            conn.execute(
                """
                INSERT INTO worlds (name, width, height, tiles_json, door_x, door_y, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (world["name"], world["width"], world["height"], tiles_json, door["x"], door["y"], now, now),
            )


def load_world(name: str) -> dict[str, Any]:
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

    foreground: list[int] = []
    background: list[int] = []
    parsed_door: dict[str, int] | None = None
    db_door: dict[str, int] | None = None

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

    return {
        "name": name,
        "width": width,
        "height": height,
        "foreground": foreground,
        "background": background,
        "door": resolved_door,
        "previous_door": parsed_door,
        "players": {},
        "tile_damage": {},
        "gem_drops": gem_drops,
        "seed_drops": seed_drops,
        "planted_trees": planted_trees,
    }


class RegisterBody(BaseModel):
    username: str = Field(min_length=3, max_length=16)
    password: str = Field(min_length=6, max_length=72)


class LoginBody(BaseModel):
    username: str
    password: str


class GuestLoginBody(BaseModel):
    deviceId: str = Field(min_length=12, max_length=128)


world_cache: dict[str, dict[str, Any]] = {}
save_tasks: dict[str, asyncio.Task[Any]] = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async def periodic_flush() -> None:
        while True:
            await asyncio.sleep(30)
            for world in list(world_cache.values()):
                await asyncio.to_thread(save_world, world)

    async def periodic_damage_regen() -> None:
        while True:
            await asyncio.sleep(0.5)
            now_monotonic = time.monotonic()
            for world in list(world_cache.values()):
                expired = collect_expired_tile_damage(world, now_monotonic)
                for entry in expired:
                    await broadcast_to_world(
                        world,
                        {
                            "type": "tile_damage_clear",
                            "x": int(entry["x"]),
                            "y": int(entry["y"]),
                            "layer": str(entry["layer"]),
                        },
                    )

    flush_task = asyncio.create_task(periodic_flush())
    regen_task = asyncio.create_task(periodic_damage_regen())
    try:
        yield
    finally:
        flush_task.cancel()
        regen_task.cancel()
        for world in list(world_cache.values()):
            await asyncio.to_thread(save_world, world)


app = FastAPI(lifespan=lifespan)
initialize_db()
refresh_block_definitions_if_changed(force=True)
register_editor_routes(
    app,
    public_dir=PUBLIC_DIR,
    blocks_path=BLOCKS_PATH,
    seeds_path=SEEDS_PATH,
    load_blocks_payload=load_blocks_payload,
    load_seeds_payload=load_seeds_payload,
    refresh_block_definitions_if_changed=refresh_block_definitions_if_changed,
)


async def schedule_world_save(world_name: str) -> None:
    existing = save_tasks.get(world_name)
    if existing and not existing.done():
        existing.cancel()

    async def _run() -> None:
        await asyncio.sleep(0.25)
        world = world_cache.get(world_name)
        if world:
            await asyncio.to_thread(save_world, world)

    save_tasks[world_name] = asyncio.create_task(_run())


def get_world(name_input: str | None) -> dict[str, Any]:
    world_name = normalize_name(name_input, "start") or "start"

    if world_name not in world_cache:
        loaded_world = load_world(world_name)
        previous_door = loaded_world.get("previous_door")
        if enforce_bedrock_under_door(loaded_world, previous_door=previous_door):
            save_world(loaded_world)
        loaded_world.pop("previous_door", None)
        world_cache[world_name] = loaded_world

    return world_cache[world_name]


@app.get("/")
def root() -> FileResponse:
    return FileResponse(PUBLIC_DIR / "index.html")


@app.get("/favicon.ico")
def favicon() -> Response:
    return Response(status_code=204)


@app.post("/api/auth/register")
def register(payload: RegisterBody) -> dict[str, Any]:
    username = normalize_name(payload.username)

    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Username already exists")

        now = int(time.time())
        password_hash = hash_password(payload.password)
        cursor = conn.execute(
            "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
            (username, password_hash, now),
        )
        user_id = int(cursor.lastrowid)

    token = create_token(user_id, username)
    return {"token": token, "user": {"id": user_id, "username": username}}


@app.post("/api/auth/login")
def login(payload: LoginBody) -> dict[str, Any]:
    username = normalize_name(payload.username)

    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()

    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = create_token(int(user["id"]), user["username"])
    return {"token": token, "user": {"id": int(user["id"]), "username": user["username"]}}


@app.post("/api/auth/guest")
def guest_login(payload: GuestLoginBody) -> dict[str, Any]:
    profile = get_or_create_guest_profile(payload.deviceId)
    if not profile:
        raise HTTPException(status_code=400, detail="Invalid guest device id")

    profile_id = int(profile["id"])
    guest_id = -(1_000_000 + profile_id)
    guest_username = str(profile["username"])

    token = create_token(
        guest_id,
        guest_username,
        extra_claims={
            "guestProfileId": profile_id,
            "guestDeviceId": str(profile["device_id"]),
        },
    )
    return {
        "token": token,
        "user": {
            "id": guest_id,
            "username": guest_username,
        },
    }


@app.get("/api/worlds")
def list_worlds(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")

    token = authorization[7:]
    auth_user = parse_token(token)
    if not auth_user:
        raise HTTPException(status_code=401, detail="Invalid token")

    with get_db() as conn:
        rows = conn.execute("SELECT name FROM worlds ORDER BY name ASC").fetchall()

    names = [str(row["name"]) for row in rows]
    if "start" not in names:
        names.insert(0, "start")

    return {"worlds": names}


@app.get("/api/bootstrap")
def bootstrap_payload(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")

    token = authorization[7:]
    auth_user = parse_token(token)
    if not auth_user:
        raise HTTPException(status_code=401, detail="Invalid token")

    blocks_payload = load_blocks_payload()

    texture47_atlas_ids: set[str] = set()
    for block in blocks_payload.get("blocks", []):
        if not isinstance(block, dict):
            continue
        atlas_id = str(block.get("ATLAS_ID", "")).strip().lower()
        if atlas_id:
            texture47_atlas_ids.add(atlas_id)

    payload = {
        "blocks": blocks_payload,
        "seeds": load_seeds_payload(),
        "texture47Configs": load_texture47_configs(PUBLIC_DIR, texture47_atlas_ids),
    }
    return JSONResponse(
        payload,
        headers={
            "Cache-Control": "private, max-age=3600",
        },
    )


def get_public_cache_headers(safe_path: str) -> dict[str, str]:
    lower = safe_path.lower()

    # Keep HTML and bundle entrypoint fresh so deployments propagate quickly.
    if lower == "index.html" or lower == "build/game.bundle.js":
        return {"Cache-Control": "no-cache"}

    # Heavily cache static assets and JSON data consumed by the bundle.
    if lower.startswith("assets/") or lower.startswith("data/"):
        return {"Cache-Control": "public, max-age=31536000, immutable"}

    if lower.endswith((".png", ".svg", ".jpg", ".jpeg", ".webp", ".gif", ".json", ".css", ".js")):
        return {"Cache-Control": "public, max-age=31536000, immutable"}

    return {"Cache-Control": "no-cache"}


clients: dict[str, dict[str, Any]] = {}


async def ws_send(socket: WebSocket, payload: dict[str, Any]) -> None:
    await socket.send_text(json.dumps(payload))


async def broadcast_to_world(world: dict[str, Any], payload: dict[str, Any], except_client_id: str | None = None) -> None:
    for client_id, player in list(world["players"].items()):
        if except_client_id and client_id == except_client_id:
            continue

        try:
            await ws_send(player["ws"], payload)
        except Exception:
            pass


async def leave_world(client: dict[str, Any]) -> None:
    world_name = client.get("world_name")
    if not world_name:
        return

    world = world_cache.get(world_name)
    if not world:
        client["world_name"] = None
        return

    if client["id"] in world["players"]:
        del world["players"][client["id"]]
        await broadcast_to_world(world, {"type": "player_left", "id": client["id"]})

    client["world_name"] = None


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()

    client_id = secrets.token_hex(8)
    client = {
        "id": client_id,
        "user_id": None,
        "guest_profile_id": None,
        "username": None,
        "world_name": None,
        "ws": websocket,
    }
    clients[client_id] = client

    await ws_send(websocket, {"type": "connected", "id": client_id})

    try:
        while True:
            text = await websocket.receive_text()
            try:
                msg = json.loads(text)
            except Exception:
                continue

            msg_type = msg.get("type")

            if msg_type == "ping":
                await ws_send(
                    websocket,
                    {
                        "type": "pong",
                        "clientSentAt": msg.get("clientSentAt"),
                    },
                )
                continue

            if msg_type == "join_world":
                auth_user = parse_token(str(msg.get("token", "")))
                if not auth_user:
                    await ws_send(websocket, {"type": "error", "message": "Authentication required"})
                    continue

                await leave_world(client)

                world = get_world(str(msg.get("world", "start")))
                client["username"] = str(auth_user.get("username", "player"))
                try:
                    client["user_id"] = int(auth_user.get("sub", 0))
                except Exception:
                    client["user_id"] = None
                try:
                    client["guest_profile_id"] = int(auth_user.get("guestProfileId", 0))
                except Exception:
                    client["guest_profile_id"] = None
                client["world_name"] = world["name"]
                spawn_x, spawn_y = get_spawn_from_door(world)

                reconnect_x = msg.get("reconnectX")
                reconnect_y = msg.get("reconnectY")
                reconnect_x_value = None
                reconnect_y_value = None
                try:
                    reconnect_x_value = float(reconnect_x)
                    reconnect_y_value = float(reconnect_y)
                except Exception:
                    reconnect_x_value = None
                    reconnect_y_value = None

                if reconnect_x_value is not None and reconnect_y_value is not None:
                    spawn_x = max(0.0, min(float(world["width"] - 1), reconnect_x_value))
                    spawn_y = max(0.0, min(float(world["height"] - 1), reconnect_y_value))

                persisted_gems = 0
                if isinstance(client.get("user_id"), int) and int(client.get("user_id", 0)) > 0:
                    persisted_gems = await asyncio.to_thread(get_user_gems, int(client["user_id"]))
                elif isinstance(client.get("guest_profile_id"), int) and int(client.get("guest_profile_id", 0)) > 0:
                    persisted_gems = await asyncio.to_thread(get_guest_profile_gems, int(client["guest_profile_id"]))

                world["players"][client_id] = {
                    "id": client_id,
                    "username": client["username"],
                    "x": spawn_x,
                    "y": spawn_y,
                    "gems": int(persisted_gems),
                    "fly_enabled": False,
                    "noclip_enabled": False,
                    "ws": websocket,
                }

                await ws_send(
                    websocket,
                    {
                        "type": "world_snapshot",
                        "serverTimeMs": int(time.time() * 1000),
                        "world": {
                            "name": world["name"],
                            "width": world["width"],
                            "height": world["height"],
                            "foreground": world["foreground"],
                            "background": world["background"],
                            "door": sanitize_door(world.get("door"), world["width"], world["height"]),
                            "tiles": world["foreground"],
                            "players": [
                                {
                                    "id": p["id"],
                                    "username": p["username"],
                                    "x": p["x"],
                                    "y": p["y"],
                                }
                                for p in world["players"].values()
                            ],
                            "tileDamage": serialize_tile_damage(world),
                            "gemDrops": serialize_gem_drops(world),
                            "seedDrops": serialize_seed_drops(world),
                            "plantedTrees": serialize_planted_trees(world),
                        },
                        "selfId": client_id,
                        "gems": int(world["players"][client_id].get("gems", 0)),
                    },
                )

                await broadcast_to_world(
                    world,
                    {
                        "type": "player_joined",
                        "player": {
                            "id": client_id,
                            "username": client["username"],
                            "x": spawn_x,
                            "y": spawn_y,
                        },
                    },
                    except_client_id=client_id,
                )
                continue

            if msg_type == "leave_world":
                await leave_world(client)
                continue

            world_name = client.get("world_name")
            if not world_name:
                continue

            world = world_cache.get(world_name)
            if not world:
                continue

            if msg_type == "respawn":
                did_respawn = await respawn_player_to_door(
                    world=world,
                    player_id=client_id,
                    get_spawn_from_door=get_spawn_from_door,
                    broadcast_to_world=broadcast_to_world,
                )
                if not did_respawn:
                    continue
                continue

            if msg_type == "player_move":
                player = world["players"].get(client_id)
                if not player:
                    continue

                try:
                    x = float(msg.get("x", 0))
                    y = float(msg.get("y", 0))
                except Exception:
                    continue

                x = max(0, min(world["width"] - 1, x))
                y = max(0, min(world["height"] - 1, y))
                player["x"] = x
                player["y"] = y

                await broadcast_to_world(
                    world,
                    {"type": "player_moved", "id": client_id, "x": x, "y": y},
                    except_client_id=client_id,
                )

                collected_ids, collected_total = collect_gems_for_player(world, player)
                if collected_total > 0:
                    player["gems"] = int(player.get("gems", 0)) + collected_total
                    if isinstance(client.get("user_id"), int) and int(client.get("user_id", 0)) > 0:
                        await asyncio.to_thread(set_user_gems, int(client["user_id"]), int(player["gems"]))
                    elif isinstance(client.get("guest_profile_id"), int) and int(client.get("guest_profile_id", 0)) > 0:
                        await asyncio.to_thread(set_guest_profile_gems, int(client["guest_profile_id"]), int(player["gems"]))
                    await schedule_world_save(world["name"])

                    await ws_send(
                        websocket,
                        {
                            "type": "gem_count",
                            "gems": int(player["gems"]),
                            "delta": int(collected_total),
                        },
                    )

                    for drop_id in collected_ids:
                        await broadcast_to_world(
                            world,
                            {
                                "type": "gem_drop_remove",
                                "id": drop_id,
                                "collectorId": client_id,
                            },
                        )

                collected_seed_drop_ids, collected_seed_ids = collect_seed_drops_for_player(world, player)
                if collected_seed_drop_ids:
                    await schedule_world_save(world["name"])
                    seed_counts: dict[int, int] = {}
                    for seed_id in collected_seed_ids:
                        seed_counts[seed_id] = seed_counts.get(seed_id, 0) + 1

                    for drop_id in collected_seed_drop_ids:
                        await broadcast_to_world(
                            world,
                            {
                                "type": "seed_drop_remove",
                                "id": drop_id,
                                "collectorId": client_id,
                            },
                        )

                    await ws_send(
                        websocket,
                        {
                            "type": "seed_collected",
                            "drops": [{"seedId": int(seed_id), "count": int(count)} for seed_id, count in sorted(seed_counts.items())],
                        },
                    )
                continue

            if msg_type == "set_tile":
                refresh_block_definitions_if_changed()

                try:
                    x = int(msg.get("x"))
                    y = int(msg.get("y"))
                    tile = int(msg.get("tile", 0))
                except Exception:
                    continue

                if x < 0 or x >= world["width"] or y < 0 or y >= world["height"]:
                    continue

                index = y * world["width"] + x
                action = str(msg.get("action", "place")).lower()
                changed_tiles: set[tuple[int, int]] = set()

                updated = False
                target_layer = "foreground"
                if action == "break":
                    removed_tree = remove_planted_tree_at(world, x, y)
                    if removed_tree is not None:
                        await schedule_world_save(world["name"])
                        await broadcast_to_world(
                            world,
                            {
                                "type": "tree_removed",
                                "id": str(removed_tree.get("id", "")),
                                "x": int(removed_tree.get("x", x)),
                                "y": int(removed_tree.get("y", y)),
                            },
                        )
                        continue

                    target_tile = 0
                    if world["foreground"][index] != 0:
                        target_layer = "foreground"
                        target_tile = int(world["foreground"][index])
                    elif world["background"][index] != 0:
                        target_layer = "background"
                        target_tile = int(world["background"][index])

                    if target_tile <= 0:
                        continue

                    if not is_breakable(target_tile):
                        continue

                    damage_state = apply_tile_hit(world, x, y, target_layer, target_tile)
                    current_hits = int(damage_state.get("hits", 0))
                    max_hits = max(1, int(damage_state.get("max_hits", 1)))

                    if current_hits >= max_hits:
                        broken_tile_id = target_tile
                        if target_layer == "foreground":
                            world["foreground"][index] = 0
                        else:
                            world["background"][index] = 0

                        clear_tile_damage(world, x, y, target_layer)
                        updated = True

                        gem_total = get_block_gem_drop_total(broken_tile_id)
                        if gem_total > 0:
                            spawned_drops = spawn_gem_drops(world, x, y, gem_total)
                            for drop in spawned_drops:
                                await broadcast_to_world(
                                    world,
                                    {
                                        "type": "gem_drop_spawn",
                                        "drop": {
                                            "id": str(drop["id"]),
                                            "x": float(drop["x"]),
                                            "y": float(drop["y"]),
                                            "value": int(drop["value"]),
                                        },
                                    },
                                )

                        seed_drop_ids = get_block_seed_drop_ids(broken_tile_id)
                        for seed_drop_id in seed_drop_ids:
                            seed_drop = spawn_seed_drop(world, x, y, seed_drop_id)
                            if seed_drop is not None:
                                await broadcast_to_world(
                                    world,
                                    {
                                        "type": "seed_drop_spawn",
                                        "drop": {
                                            "id": str(seed_drop["id"]),
                                            "x": float(seed_drop["x"]),
                                            "y": float(seed_drop["y"]),
                                            "seedId": int(seed_drop["seed_id"]),
                                        },
                                    },
                                )
                    else:
                        await broadcast_to_world(
                            world,
                            {
                                "type": "tile_damage_update",
                                "x": x,
                                "y": y,
                                "layer": target_layer,
                                "hits": current_hits,
                                "maxHits": max_hits,
                            },
                        )
                        continue
                else:
                    tile = max(0, tile)
                    if tile <= 0:
                        continue

                    if get_planted_tree_at(world, x, y) is not None:
                        continue

                    if tile not in BLOCKS_BY_ID:
                        continue

                    block_def = BLOCKS_BY_ID.get(tile) or {}
                    block_type = str(block_def.get("BLOCK_TYPE", "")).upper()

                    # Platforms share the foreground layer with solid blocks.
                    # Only explicit BACKGROUND blocks are placed in background.
                    place_in_background = block_type == "BACKGROUND"

                    if place_in_background:
                        if world["background"][index] == 0:
                            world["background"][index] = tile
                            target_layer = "background"
                            updated = True
                            changed_tiles.add((x, y))
                    else:
                        if world["foreground"][index] == 0:
                            door_block_id = int(RUNTIME_BLOCK_IDS.get("door", int(RUNTIME_BLOCK_IDS.get("air", 0))))
                            if tile == door_block_id:
                                previous_door = sanitize_door(world.get("door"), world["width"], world["height"])

                                candidate_positions: set[tuple[int, int]] = {
                                    (x, y),
                                    (x, y + 1),
                                    (int(previous_door["x"]), int(previous_door["y"])),
                                    (int(previous_door["x"]), int(previous_door["y"]) + 1),
                                }

                                before_foreground: dict[tuple[int, int], int] = {}
                                for cx, cy in candidate_positions:
                                    if 0 <= cx < world["width"] and 0 <= cy < world["height"]:
                                        before_foreground[(cx, cy)] = int(world["foreground"][cy * world["width"] + cx])

                                world["door"] = sanitize_door({"x": x, "y": y}, world["width"], world["height"])
                                enforce_bedrock_under_door(world, previous_door=previous_door)

                                for (cx, cy), old_value in before_foreground.items():
                                    new_value = int(world["foreground"][cy * world["width"] + cx])
                                    if new_value != old_value:
                                        changed_tiles.add((cx, cy))

                                updated = len(changed_tiles) > 0
                            else:
                                world["foreground"][index] = tile
                                changed_tiles.add((x, y))
                                updated = True
                            target_layer = "foreground"

                if not updated:
                    continue

                if not changed_tiles:
                    changed_tiles.add((x, y))

                for changed_x, changed_y in sorted(changed_tiles):
                    for cleared in clear_tile_damage(world, changed_x, changed_y, None):
                        await broadcast_to_world(
                            world,
                            {
                                "type": "tile_damage_clear",
                                "x": int(cleared["x"]),
                                "y": int(cleared["y"]),
                                "layer": str(cleared["layer"]),
                            },
                        )

                await schedule_world_save(world["name"])

                for changed_x, changed_y in sorted(changed_tiles):
                    changed_index = changed_y * world["width"] + changed_x
                    await broadcast_to_world(
                        world,
                        {
                            "type": "tile_updated",
                            "x": changed_x,
                            "y": changed_y,
                            "tile": world["foreground"][changed_index],
                            "foreground": world["foreground"][changed_index],
                            "background": world["background"][changed_index],
                        },
                    )
                continue

            if msg_type == "plant_seed":
                try:
                    x = int(msg.get("x"))
                    y = int(msg.get("y"))
                    seed_id = int(msg.get("seedId", msg.get("seed_id", -1)))
                except Exception:
                    continue

                if x < 0 or x >= world["width"] or y < 0 or y >= world["height"]:
                    continue

                if seed_id < 0:
                    continue

                if get_seed_definition(seed_id) is None:
                    continue

                index = y * world["width"] + x
                # Planting must happen in an empty foreground tile (background is allowed).
                target_foreground = int(world["foreground"][index])
                if target_foreground != 0:
                    continue

                # Planting requires a supporting solid foreground block directly below.
                below_y = y + 1
                if below_y >= world["height"]:
                    continue

                below_index = below_y * world["width"] + x
                support_tile = int(world["foreground"][below_index])
                if support_tile <= 0:
                    continue

                # Do not allow planting on/with door tiles as support.
                door_block_id = int(RUNTIME_BLOCK_IDS.get("door", int(RUNTIME_BLOCK_IDS.get("air", 0))))
                if support_tile == door_block_id:
                    continue

                # Background-type blocks are not valid support for planted trees.
                if support_tile in BACKGROUND_BLOCK_IDS:
                    continue

                if get_planted_tree_at(world, x, y) is not None:
                    continue

                planted_tree = place_planted_tree(world, x, y, seed_id, int(time.time() * 1000))
                if planted_tree is None:
                    continue

                await schedule_world_save(world["name"])
                await broadcast_to_world(
                    world,
                    {
                        "type": "tree_planted",
                        "tree": {
                            "id": str(planted_tree.get("id", "")),
                            "x": int(planted_tree.get("x", x)),
                            "y": int(planted_tree.get("y", y)),
                            "seedId": int(planted_tree.get("seed_id", seed_id)),
                            "plantedAtMs": int(planted_tree.get("planted_at_ms", 0)),
                        },
                        "serverTimeMs": int(time.time() * 1000),
                    },
                )
                continue

            if msg_type == "chat_message":
                message_text = str(msg.get("message", "")).strip()
                if not message_text:
                    continue

                if len(message_text) > 160:
                    message_text = message_text[:160]

                player = world["players"].get(client_id)
                username = client.get("username") or (player.get("username") if player else "player")
                command_sender_original: tuple[float, float] | None = None
                if player:
                    try:
                        command_sender_original = (float(player.get("x", 0.0)), float(player.get("y", 0.0)))
                    except Exception:
                        command_sender_original = None

                command_result = process_chat_command(
                    raw_message=message_text,
                    client_id=client_id,
                    client_username=str(username),
                    world=world,
                )

                if command_result is not None:
                    await apply_command_result(
                        command_result=command_result,
                        websocket=websocket,
                        world=world,
                        client_id=client_id,
                        command_sender_original=command_sender_original,
                        ws_send=ws_send,
                        broadcast_to_world=broadcast_to_world,
                        clear_tile_damage=clear_tile_damage,
                        schedule_world_save=schedule_world_save,
                        sanitize_door=sanitize_door,
                        enforce_bedrock_under_door=enforce_bedrock_under_door,
                        get_spawn_from_door=get_spawn_from_door,
                    )

                    continue

                await broadcast_to_world(
                    world,
                    {
                        "type": "chat_message",
                        "id": client_id,
                        "username": username,
                        "message": message_text,
                    },
                )
                continue

    except WebSocketDisconnect:
        pass
    finally:
        await leave_world(client)
        clients.pop(client_id, None)


@app.get("/{file_path:path}")
def public_files(file_path: str) -> FileResponse:
    safe_path = file_path.strip("/")
    if not safe_path:
        safe_path = "index.html"

    # Serve bundled client only; avoid exposing modular source entrypoints.
    if safe_path == "game.js" or (safe_path.startswith("game/") and safe_path.endswith(".js")):
        raise HTTPException(status_code=404, detail="Not Found")

    target = (PUBLIC_DIR / safe_path).resolve()
    public_root = PUBLIC_DIR.resolve()

    if not str(target).startswith(str(public_root)):
        raise HTTPException(status_code=404, detail="Not Found")

    if not target.is_file():
        raise HTTPException(status_code=404, detail="Not Found")

    return FileResponse(target, headers=get_public_cache_headers(safe_path))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=PORT, access_log=False)
