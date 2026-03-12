from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import json
import os
import random
import secrets
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from modules.block_registry import (
    BlockCatalog,
    DEFAULT_RUNTIME_BLOCK_ROLES,
)
from modules.chat_commands import process_chat_command
from modules.command_runtime import apply_command_result
from modules.editor_tools import load_texture47_configs, register_editor_routes
from modules.player_data import (
    create_token,
    get_db,
    get_guest_profile_gems,
    get_guest_profile_inventory,
    get_guest_profile_inventory_slots,
    get_or_create_guest_profile,
    get_user_gems,
    get_user_inventory,
    get_user_inventory_slots,
    set_user_inventory_slots,
    hash_password,
    initialize_db,
    inventory_to_client_payload,
    make_inventory_key,
    normalize_inventory,
    normalize_item_type,
    normalize_name,
    parse_token,
    set_guest_profile_gems,
    set_guest_profile_inventory,
    set_user_gems,
    set_user_inventory,
    verify_password,
)
from modules.ws_runtime import broadcast_to_world, leave_world, ws_send
from modules.ws_player_actions import respawn_player_to_door
from modules.worldgen import generate_world_layers
from modules import world_utils
from modules.world_utils import (
    world_cache,
    save_tasks,
    schedule_world_save,
    get_world,
    get_item_definition,
    is_breakable,
    get_block_toughness,
    get_block_gem_drop_total,
    get_tree_gem_drop_total,
    get_block_seed_drop_ids,
    get_block_self_drop_seed_ids,
    get_tree_item_drops,
    spawn_gem_drops,
    spawn_item_drop,
    spawn_item_drop_center,
    collect_gems_for_player,
    collect_item_drops_for_player,
    serialize_gem_drops,
    serialize_seed_drops,
    serialize_planted_trees,
    sanitize_door,
    get_spawn_from_door,
    enforce_bedrock_under_door,
    default_door,
    parse_world_gem_drops,
    parse_world_seed_drops,
    parse_world_planted_trees,
    place_planted_tree,
    remove_planted_tree_at,
    get_tile_damage_key,
    serialize_tile_damage,
    clear_tile_damage,
    apply_tile_hit,
    collect_expired_tile_damage,
)
from pydantic import BaseModel, Field

PORT = int(os.getenv("PORT", "3000"))
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
BLOCKS_PATH = PUBLIC_DIR / "data" / "blocks.json"
SEEDS_PATH = PUBLIC_DIR / "data" / "seeds.json"
WEATHER_PATH = PUBLIC_DIR / "data" / "weather.json"

# configure world_utils shared constants and paths
world_utils.PUBLIC_DIR = PUBLIC_DIR
world_utils.BLOCKS_PATH = BLOCKS_PATH
world_utils.SEEDS_PATH = SEEDS_PATH
world_utils.WEATHER_PATH = WEATHER_PATH

world_utils.WORLD_WIDTH = WORLD_WIDTH
world_utils.WORLD_HEIGHT = WORLD_HEIGHT
world_utils.DAMAGE_REGEN_MIN_SECONDS = DAMAGE_REGEN_MIN_SECONDS
world_utils.DAMAGE_REGEN_MAX_SECONDS = DAMAGE_REGEN_MAX_SECONDS
world_utils.PLAYER_PICKUP_RADIUS = PLAYER_PICKUP_RADIUS
world_utils.GEM_DENOMINATIONS = GEM_DENOMINATIONS
world_utils.GEM_DROP_SPAWN_RADIUS = GEM_DROP_SPAWN_RADIUS
world_utils.GEM_DROP_MIN_IN_TILE = GEM_DROP_MIN_IN_TILE
world_utils.GEM_DROP_MAX_IN_TILE = GEM_DROP_MAX_IN_TILE

BLOCK_CATALOG = BlockCatalog(BLOCKS_PATH, required_roles=DEFAULT_RUNTIME_BLOCK_ROLES)
BACKGROUND_BLOCK_IDS: set[int] = set()
BLOCKS_BY_ID: dict[int, dict[str, Any]] = {}
RUNTIME_BLOCK_IDS: dict[str, int] = {}


def _sync_block_catalog_cache() -> None:
    global BACKGROUND_BLOCK_IDS, BLOCKS_BY_ID, RUNTIME_BLOCK_IDS
    BACKGROUND_BLOCK_IDS = set(BLOCK_CATALOG.background_ids)
    BLOCKS_BY_ID = dict(BLOCK_CATALOG.blocks_by_id)
    RUNTIME_BLOCK_IDS = dict(BLOCK_CATALOG.runtime_ids)
    # mirror changes into world_utils so helpers there stay up to date
    world_utils.BACKGROUND_BLOCK_IDS = BACKGROUND_BLOCK_IDS
    world_utils.BLOCKS_BY_ID = BLOCKS_BY_ID
    world_utils.RUNTIME_BLOCK_IDS = RUNTIME_BLOCK_IDS


def refresh_block_definitions_if_changed(force: bool = False) -> None:
    if BLOCK_CATALOG.refresh_if_changed(force=force):
        _sync_block_catalog_cache()


def load_blocks_payload() -> dict[str, Any]:
    return BLOCK_CATALOG.load_payload()

def load_seeds_payload() -> dict[str, Any]:
    return world_utils.load_seeds_payload()

def load_weather_payload() -> dict[str, Any]:
    return world_utils.load_weather_payload()


def load_seeds_payload() -> dict[str, Any]:
    return world_utils.load_seeds_payload()


def get_item_definition(item_id: int, item_type: str = "seed") -> dict[str, Any] | None:
    return world_utils.get_item_definition(item_id, item_type)


def is_breakable(tile_id: int) -> bool:
    return world_utils.is_breakable(tile_id)


def get_block_toughness(tile_id: int) -> int:
    return world_utils.get_block_toughness(tile_id)


def get_block_gem_drop_total(tile_id: int) -> int:
    return world_utils.get_block_gem_drop_total(tile_id)


def get_tree_gem_drop_total(tree: dict[str, Any]) -> int:
    return world_utils.get_tree_gem_drop_total(tree)


def get_block_seed_drop_ids(tile_id: int) -> list[int]:
    return world_utils.get_block_seed_drop_ids(tile_id)


def _clamp_chance(raw_value: Any, default: float = 0.0) -> float:
    return world_utils._clamp_chance(raw_value, default)


def _resolve_drop_entry_seed_id(raw_entry: Any) -> int:
    return world_utils._resolve_drop_entry_seed_id(raw_entry)


def _resolve_drop_entry_item_type(raw_entry: Any, default: str = "seed") -> str:
    return world_utils._resolve_drop_entry_item_type(raw_entry, default)


def _resolve_drop_entry_item_id(raw_entry: Any, default_item_id: int = -1) -> int:
    return world_utils._resolve_drop_entry_item_id(raw_entry, default_item_id)


def _resolve_drop_entry_count(raw_entry: Any, *, default_count: int = 1) -> int:
    return world_utils._resolve_drop_entry_count(raw_entry, default_count=default_count)


def get_block_self_drop_seed_ids(tile_id: int) -> list[int]:
    return world_utils.get_block_self_drop_seed_ids(tile_id)


def get_tree_item_drops(tree: dict[str, Any], now_ms: int) -> list[dict[str, Any]]:
    return world_utils.get_tree_item_drops(tree, now_ms)


def split_gem_amount(total: int) -> list[int]:
    return world_utils.split_gem_amount(total)


def ensure_world_gem_state(world: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return world_utils.ensure_world_gem_state(world)


def ensure_world_seed_state(world: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return world_utils.ensure_world_seed_state(world)


def ensure_world_tree_state(world: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return world_utils.ensure_world_tree_state(world)


def get_tree_key(x: int, y: int) -> str:
    return world_utils.get_tree_key(x, y)


def get_planted_tree_at(world: dict[str, Any], x: int, y: int) -> dict[str, Any] | None:
    return world_utils.get_planted_tree_at(world, x, y)


def place_planted_tree(world: dict[str, Any], x: int, y: int, seed_id: int, planted_at_ms: int) -> dict[str, Any] | None:
    return world_utils.place_planted_tree(world, x, y, seed_id, planted_at_ms)


def remove_planted_tree_at(world: dict[str, Any], x: int, y: int) -> dict[str, Any] | None:
    return world_utils.remove_planted_tree_at(world, x, y)


def serialize_gem_drops(world: dict[str, Any]) -> list[dict[str, Any]]:
    return world_utils.serialize_gem_drops(world)


def serialize_seed_drops(world: dict[str, Any]) -> list[dict[str, Any]]:
    return world_utils.serialize_seed_drops(world)


def serialize_planted_trees(world: dict[str, Any]) -> list[dict[str, Any]]:
    return world_utils.serialize_planted_trees(world)


def parse_world_gem_drops(raw: Any, width: int, height: int) -> dict[str, dict[str, Any]]:
    return world_utils.parse_world_gem_drops(raw, width, height)


def parse_world_seed_drops(raw: Any, width: int, height: int) -> dict[str, dict[str, Any]]:
    return world_utils.parse_world_seed_drops(raw, width, height)


def parse_world_planted_trees(raw: Any, width: int, height: int) -> dict[str, dict[str, Any]]:
    return world_utils.parse_world_planted_trees(raw, width, height)


def spawn_gem_drops(world: dict[str, Any], tile_x: int, tile_y: int, total_amount: int) -> list[dict[str, Any]]:
    return world_utils.spawn_gem_drops(world, tile_x, tile_y, total_amount)


def spawn_item_drop(
    world: dict[str, Any],
    tile_x: int,
    tile_y: int,
    item_id: int,
    *,
    item_type: str = "seed",
    allow_tile_stack: bool = False,
) -> dict[str, Any] | None:
    return world_utils.spawn_item_drop(
        world,
        tile_x,
        tile_y,
        item_id,
        item_type=item_type,
        allow_tile_stack=allow_tile_stack,
    )


def spawn_item_drop_center(
    world: dict[str, Any],
    tile_x: int,
    tile_y: int,
    item_id: int,
    *,
    item_type: str = "seed",
    allow_tile_stack: bool = False,
) -> dict[str, Any] | None:
    return world_utils.spawn_item_drop_center(
        world,
        tile_x,
        tile_y,
        item_id,
        item_type=item_type,
        allow_tile_stack=allow_tile_stack,
    )


def collect_gems_for_player(world: dict[str, Any], player: dict[str, Any]) -> tuple[list[str], int]:
    return world_utils.collect_gems_for_player(world, player)


def collect_item_drops_for_player(
    world: dict[str, Any],
    player: dict[str, Any],
    inventory_slots: int | None = None,
    inventory: dict[str, int] | None = None,
) -> tuple[list[str], list[dict[str, Any]], bool]:
    return world_utils.collect_item_drops_for_player(world, player, inventory_slots, inventory)


def get_tile_damage_key(x: int, y: int, layer: str) -> str:
    return world_utils.get_tile_damage_key(x, y, layer)


def serialize_tile_damage(world: dict[str, Any]) -> list[dict[str, Any]]:
    return world_utils.serialize_tile_damage(world)


def clear_tile_damage(world: dict[str, Any], x: int, y: int, layer: str | None = None) -> list[dict[str, Any]]:
    return world_utils.clear_tile_damage(world, x, y, layer)


def apply_tile_hit(world: dict[str, Any], x: int, y: int, layer: str, tile_id: int) -> dict[str, Any]:
    return world_utils.apply_tile_hit(world, x, y, layer, tile_id)


def collect_expired_tile_damage(world: dict[str, Any], now_monotonic: float) -> list[dict[str, Any]]:
    return world_utils.collect_expired_tile_damage(world, now_monotonic)


def default_door(width: int, height: int) -> dict[str, int]:
    return world_utils.default_door(width, height)


def sanitize_door(door: Any, width: int, height: int) -> dict[str, int]:
    return world_utils.sanitize_door(door, width, height)


def get_spawn_from_door(world: dict[str, Any]) -> tuple[float, float]:
    return world_utils.get_spawn_from_door(world)


def enforce_bedrock_under_door(world: dict[str, Any], previous_door: dict[str, int] | None = None) -> bool:
    return world_utils.enforce_bedrock_under_door(world, previous_door)


def create_world(name: str) -> dict[str, Any]:
    return world_utils.create_world(name)


def save_world(world: dict[str, Any]) -> None:
    return world_utils.save_world(world)


def load_world(name: str) -> dict[str, Any]:
    return world_utils.load_world(name)


class RegisterBody(BaseModel):
    username: str = Field(min_length=3, max_length=16)
    password: str = Field(min_length=6, max_length=72)


class LoginBody(BaseModel):
    username: str
    password: str


class GuestLoginBody(BaseModel):
    deviceId: str = Field(min_length=12, max_length=128)




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
    weather_path=WEATHER_PATH,
    load_blocks_payload=load_blocks_payload,
    load_seeds_payload=load_seeds_payload,
    load_weather_payload=load_weather_payload,
    refresh_block_definitions_if_changed=refresh_block_definitions_if_changed,
)


async def schedule_world_save(world_name: str, only_weather: bool = False) -> None:
    # delegate to world_utils implementation
    await world_utils.schedule_world_save(world_name, only_weather)


def get_world(name_input: str | None) -> dict[str, Any]:
    # thin wrapper around world_utils implementation
    return world_utils.get_world(name_input)


@app.get("/")
def root() -> FileResponse:
    return FileResponse(PUBLIC_DIR / "index.html")


@app.get("/favicon.ico")
def favicon() -> Response:
    return Response(status_code=204)


@app.post("/internal/prepare_restart")
async def prepare_restart() -> JSONResponse:
    """Notify all connected clients that the server is updating, then close sockets.

    This endpoint is intended to be called by local administration tooling (start.bat)
    prior to killing the process so clients receive a graceful notice and will
    refetch client resources when they reconnect.
    """
    payload = {
        "type": "server_update",
        "message": "Game is updating. You will be disconnected and should reload when reconnecting; you'll be reconnected automatically.",
    }

    # Broadcast to all players in every world
    for world in list(world_cache.values()):
        try:
            await broadcast_to_world(world, payload)
        except Exception:
            pass

    # Also notify any connected client sockets that aren't yet in a world
    for client_id, client in list(clients.items()):
        try:
            await ws_send(client["ws"], payload)
        except Exception:
            pass

    # Close sockets to ensure clients enter reconnect flow promptly.
    for client_id, client in list(clients.items()):
        try:
            await client["ws"].close()
        except Exception:
            pass

    return JSONResponse({"status": "ok"})


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

        texture47_id = str(block.get("TEXTURE47_ID", "")).strip().lower()
        if texture47_id:
            texture47_atlas_ids.add(texture47_id)
            continue

        # Backward compatibility: legacy Texture47 blocks used string ATLAS_ID directly.
        atlas_id = str(block.get("ATLAS_ID", "")).strip().lower()
        if atlas_id and not isinstance(block.get("ATLAS_TEXTURE"), dict):
            texture47_atlas_ids.add(atlas_id)

    payload = {
        "blocks": blocks_payload,
        "seeds": load_seeds_payload(),
        "weather": load_weather_payload(),
        "texture47Configs": load_texture47_configs(PUBLIC_DIR, texture47_atlas_ids),
    }
    return JSONResponse(
        payload,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
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

                await leave_world(client, world_cache)

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
                persisted_inventory: dict[str, int] = {}
                persisted_slots = 20
                if isinstance(client.get("user_id"), int) and int(client.get("user_id", 0)) > 0:
                    persisted_gems = await asyncio.to_thread(get_user_gems, int(client["user_id"]))
                    persisted_inventory = await asyncio.to_thread(get_user_inventory, int(client["user_id"]))
                    persisted_slots = await asyncio.to_thread(get_user_inventory_slots, int(client["user_id"]))
                elif isinstance(client.get("guest_profile_id"), int) and int(client.get("guest_profile_id", 0)) > 0:
                    persisted_gems = await asyncio.to_thread(get_guest_profile_gems, int(client["guest_profile_id"]))
                    persisted_inventory = await asyncio.to_thread(
                        get_guest_profile_inventory, int(client["guest_profile_id"])
                    )
                    # also load slot limit using helper
                    persisted_slots = await asyncio.to_thread(
                        get_guest_profile_inventory_slots, int(client["guest_profile_id"]))

                # add player to world state
                world["players"][client_id] = {
                    "id": client_id,
                    "username": client["username"],
                    "x": spawn_x,
                    "y": spawn_y,
                    "facing_x": 1,
                    "gems": int(persisted_gems),
                    "inventory": normalize_inventory(persisted_inventory),
                    "inventory_slots": int(persisted_slots),
                    "fly_enabled": False,
                    "noclip_enabled": False,
                    "ws": websocket,
                }

                # notify other clients already in the world that a new player has joined
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

                # send snapshot to joining client
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
                            "weather": int(world.get("weather", 1)),
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
                        "inventory": inventory_to_client_payload(world["players"][client_id].get("inventory", {})),
                        "inventorySlots": int(world["players"][client_id].get("inventory_slots", persisted_slots)),
                    },
                )
                continue

            if msg_type == "set_inventory_slots":
                # client requesting to change their personal inventory limit
                slots = msg.get("slots")
                try:
                    slots = max(1, int(slots))
                except Exception:
                    continue
                # update persisted value for authenticated user or guest
                if isinstance(client.get("user_id"), int) and client.get("user_id", 0) > 0:
                    await asyncio.to_thread(set_user_inventory_slots, int(client["user_id"]), slots)
                elif isinstance(client.get("guest_profile_id"), int) and client.get("guest_profile_id", 0) > 0:
                    # update guest record directly
                    with await asyncio.to_thread(get_db) as conn:
                        conn.execute(
                            "UPDATE guest_profiles SET inventory_slots = ? WHERE id = ?",
                            (slots, int(client["guest_profile_id"])),
                        )
                # also update our in‑memory player state if inside a world
                if client_id and world_cache and client_id in world_cache[client.get("world_name", "")]["players"]:
                    world_cache[client.get("world_name")]["players"][client_id]["inventory_slots"] = slots
                # tell the client their new limit
                await ws_send(websocket, {"type": "inventory_slots", "inventorySlots": slots})
                continue
            if msg_type == "leave_world":
                await leave_world(client, world_cache)
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

                try:
                    previous_x = float(player.get("x", x))
                except Exception:
                    previous_x = x

                horizontal_delta = x - previous_x
                if horizontal_delta > 0.001:
                    player["facing_x"] = 1
                elif horizontal_delta < -0.001:
                    player["facing_x"] = -1

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

                # compute current inventory for capacity check
                current_inventory = normalize_inventory(player.get("inventory", {}))
                slots_limit = int(player.get("inventory_slots", 0)) or None
                collected_item_drop_ids, collected_items, overflow = collect_item_drops_for_player(
                    world,
                    player,
                    slots_limit,
                    current_inventory,
                )
                if overflow:
                    # notify the player that their inventory is full
                    await ws_send(websocket, {"type": "system_message", "message": "Inventory full"})
                if collected_item_drop_ids:
                    await schedule_world_save(world["name"])
                    item_counts: dict[tuple[str, int], int] = {}
                    for entry in collected_items:
                        try:
                            item_type = str(entry.get("itemType", "seed")).strip().lower()
                            item_id = int(entry.get("itemId", -1))
                        except Exception:
                            continue

                        item_type = normalize_item_type(item_type)
                        if item_id < 0:
                            continue

                        key = (item_type, item_id)
                        item_counts[key] = item_counts.get(key, 0) + 1

                    inventory = normalize_inventory(player.get("inventory", {}))
                    for (item_type, item_id), count in item_counts.items():
                        if item_id < 0 or count <= 0:
                            continue
                        inventory_key = make_inventory_key(item_type, item_id)
                        inventory[inventory_key] = int(inventory.get(inventory_key, 0)) + int(count)
                    player["inventory"] = inventory

                    if isinstance(client.get("user_id"), int) and int(client.get("user_id", 0)) > 0:
                        await asyncio.to_thread(set_user_inventory, int(client["user_id"]), inventory)
                    elif isinstance(client.get("guest_profile_id"), int) and int(client.get("guest_profile_id", 0)) > 0:
                        await asyncio.to_thread(set_guest_profile_inventory, int(client["guest_profile_id"]), inventory)

                    for drop_id in collected_item_drop_ids:
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
                            "drops": [
                                {
                                    "itemType": str(item_type),
                                    "itemId": int(item_id),
                                    "count": int(count),
                                }
                                for (item_type, item_id), count in sorted(item_counts.items(), key=lambda entry: (entry[0][0], entry[0][1]))
                            ],
                        },
                    )
                    await ws_send(
                        websocket,
                        {
                            "type": "inventory_update",
                            "inventory": inventory_to_client_payload(inventory),
                        },
                    )
                continue

            if msg_type == "drop_inventory_seed":
                player = world["players"].get(client_id)
                if not isinstance(player, dict):
                    continue

                try:
                    item_id = int(msg.get("itemId", msg.get("item_id", msg.get("seedId", msg.get("seed_id", -1)))))
                except Exception:
                    item_id = -1

                drop_item_type = normalize_item_type(msg.get("itemType", msg.get("item_type", "seed")))

                try:
                    drop_count = int(msg.get("count", 1))
                except Exception:
                    drop_count = 1

                item_id = int(item_id)
                drop_count = max(1, min(99, int(drop_count)))
                if item_id < 0:
                    continue

                inventory = normalize_inventory(player.get("inventory", {}))
                inventory_key = make_inventory_key(drop_item_type, item_id)
                current_count = int(inventory.get(inventory_key, 0))
                if current_count <= 0:
                    continue

                # Clamp to what the player actually owns.
                drop_count = min(drop_count, current_count)
                if drop_count <= 0:
                    continue

                try:
                    player_center_x = float(player.get("x", 0.0)) + 0.36
                    player_center_y = float(player.get("y", 0.0)) + 0.46
                except Exception:
                    player_center_x = 0.36
                    player_center_y = 0.46

                facing_x = -1 if int(player.get("facing_x", 1)) < 0 else 1
                drop_tile_x = max(0, min(world["width"] - 1, int(player_center_x) + facing_x))
                drop_tile_y = max(0, min(world["height"] - 1, int(player_center_y)))

                spawned_item_drops: list[dict[str, Any]] = []
                for _ in range(drop_count):
                    spawned_item_drop = spawn_item_drop(
                        world,
                        drop_tile_x,
                        drop_tile_y,
                        item_id,
                        item_type=drop_item_type,
                        allow_tile_stack=True,
                    )
                    if spawned_item_drop is None:
                        break
                    spawned_item_drops.append(spawned_item_drop)

                actual_drop_count = len(spawned_item_drops)
                if actual_drop_count <= 0:
                    continue

                next_count = current_count - actual_drop_count
                if next_count <= 0:
                    inventory.pop(inventory_key, None)
                else:
                    inventory[inventory_key] = next_count
                player["inventory"] = inventory

                if isinstance(client.get("user_id"), int) and int(client.get("user_id", 0)) > 0:
                    await asyncio.to_thread(set_user_inventory, int(client["user_id"]), inventory)
                elif isinstance(client.get("guest_profile_id"), int) and int(client.get("guest_profile_id", 0)) > 0:
                    await asyncio.to_thread(set_guest_profile_inventory, int(client["guest_profile_id"]), inventory)

                for spawned_item_drop in spawned_item_drops:
                    await broadcast_to_world(
                        world,
                        {
                            "type": "seed_drop_spawn",
                            "drop": {
                                "id": str(spawned_item_drop["id"]),
                                "x": float(spawned_item_drop["x"]),
                                "y": float(spawned_item_drop["y"]),
                                "itemId": int(spawned_item_drop.get("item_id", spawned_item_drop.get("seed_id", -1))),
                                "itemType": str(spawned_item_drop.get("item_type", "seed")),
                            },
                        },
                    )

                await ws_send(
                    websocket,
                    {
                        "type": "inventory_update",
                        "inventory": inventory_to_client_payload(inventory),
                    },
                )
                await schedule_world_save(world["name"])
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
                player = world["players"].get(client_id)
                if not isinstance(player, dict):
                    continue
                creative_action = bool(msg.get("creative", False))
                changed_tiles: set[tuple[int, int]] = set()
                placement_consumes_inventory = False
                placement_inventory: dict[str, int] | None = None
                placement_inventory_key = ""
                placement_inventory_count = 0

                updated = False
                target_layer = "foreground"
                if action == "break":
                    removed_tree = remove_planted_tree_at(world, x, y)
                    if removed_tree is not None:
                        tree_drops = get_tree_item_drops(removed_tree, int(time.time() * 1000))
                        for tree_drop in tree_drops:
                            try:
                                tree_item_id = int(tree_drop.get("itemId", -1))
                            except Exception:
                                tree_item_id = -1
                            tree_item_type = normalize_item_type(tree_drop.get("itemType", "seed"))
                            if tree_item_id < 0:
                                continue

                            tree_seed_drop = spawn_item_drop_center(
                                world,
                                x,
                                y,
                                tree_item_id,
                                item_type=tree_item_type,
                                allow_tile_stack=True,
                            )
                            if tree_seed_drop is not None:
                                await broadcast_to_world(
                                    world,
                                    {
                                        "type": "seed_drop_spawn",
                                        "drop": {
                                            "id": str(tree_seed_drop["id"]),
                                            "x": float(tree_seed_drop["x"]),
                                            "y": float(tree_seed_drop["y"]),
                                            "itemId": int(tree_seed_drop.get("item_id", tree_seed_drop.get("seed_id", -1))),
                                            "itemType": str(tree_seed_drop.get("item_type", "seed")),
                                        },
                                    },
                                )
                        # gems from trees
                        gem_total = get_tree_gem_drop_total(removed_tree)
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
                            seed_drop = spawn_item_drop_center(
                                world,
                                x,
                                y,
                                seed_drop_id,
                                item_type="seed",
                            )
                            if seed_drop is not None:
                                await broadcast_to_world(
                                    world,
                                    {
                                        "type": "seed_drop_spawn",
                                        "drop": {
                                            "id": str(seed_drop["id"]),
                                            "x": float(seed_drop["x"]),
                                            "y": float(seed_drop["y"]),
                                            "itemId": int(seed_drop.get("item_id", seed_drop.get("seed_id", -1))),
                                            "itemType": str(seed_drop.get("item_type", "seed")),
                                        },
                                    },
                                )

                        self_drop_ids = get_block_self_drop_seed_ids(broken_tile_id)
                        for self_drop_id in self_drop_ids:
                            self_drop = spawn_item_drop_center(
                                world,
                                x,
                                y,
                                self_drop_id,
                                item_type="block",
                            )
                            if self_drop is not None:
                                await broadcast_to_world(
                                    world,
                                    {
                                        "type": "seed_drop_spawn",
                                        "drop": {
                                            "id": str(self_drop["id"]),
                                            "x": float(self_drop["x"]),
                                            "y": float(self_drop["y"]),
                                            "itemId": int(self_drop.get("item_id", self_drop.get("seed_id", -1))),
                                            "itemType": str(self_drop.get("item_type", "block")),
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

                    if not creative_action:
                        place_item_type = normalize_item_type(msg.get("itemType", msg.get("item_type", "block")), "block")
                        try:
                            place_item_id = int(msg.get("itemId", msg.get("item_id", tile)))
                        except Exception:
                            place_item_id = -1

                        if place_item_type != "block" or place_item_id != tile:
                            continue

                        placement_inventory = normalize_inventory(player.get("inventory", {}))
                        placement_inventory_key = make_inventory_key("block", tile)
                        placement_inventory_count = int(placement_inventory.get(placement_inventory_key, 0))
                        if placement_inventory_count <= 0:
                            continue
                        placement_consumes_inventory = True

                    if tile not in BLOCKS_BY_ID:
                        continue

                    block_def = BLOCKS_BY_ID.get(tile) or {}
                    block_type = str(block_def.get("BLOCK_TYPE", "")).upper()

                    # Platforms share the foreground layer with solid blocks.
                    # Only explicit BACKGROUND blocks are placed in background.
                    place_in_background = block_type == "BACKGROUND"

                    # Allow placing background blocks behind planted trees,
                    # but prevent foreground placement on top of trees.
                    if get_planted_tree_at(world, x, y) is not None and not place_in_background:
                        continue

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

                if placement_consumes_inventory and placement_inventory is not None and placement_inventory_key:
                    next_block_count = placement_inventory_count - 1
                    if next_block_count <= 0:
                        placement_inventory.pop(placement_inventory_key, None)
                    else:
                        placement_inventory[placement_inventory_key] = next_block_count
                    player["inventory"] = placement_inventory

                    if isinstance(client.get("user_id"), int) and int(client.get("user_id", 0)) > 0:
                        await asyncio.to_thread(set_user_inventory, int(client["user_id"]), placement_inventory)
                    elif isinstance(client.get("guest_profile_id"), int) and int(client.get("guest_profile_id", 0)) > 0:
                        await asyncio.to_thread(set_guest_profile_inventory, int(client["guest_profile_id"]), placement_inventory)

                    await ws_send(
                        websocket,
                        {
                            "type": "inventory_update",
                            "inventory": inventory_to_client_payload(placement_inventory),
                        },
                    )

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
                    seed_id = int(msg.get("itemId", msg.get("item_id", msg.get("seedId", msg.get("seed_id", -1)))))
                except Exception:
                    continue

                if x < 0 or x >= world["width"] or y < 0 or y >= world["height"]:
                    continue

                if seed_id < 0:
                    continue

                if get_item_definition(seed_id, "seed") is None:
                    continue

                player = world["players"].get(client_id)
                if not isinstance(player, dict):
                    continue
                creative_planting = bool(msg.get("creative", False))

                inventory: dict[str, int] | None = None
                seed_inventory_key = ""
                current_seed_count = 0
                if not creative_planting:
                    inventory = normalize_inventory(player.get("inventory", {}))
                    seed_inventory_key = make_inventory_key("seed", seed_id)
                    current_seed_count = int(inventory.get(seed_inventory_key, 0))
                    if current_seed_count <= 0:
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

                if not creative_planting and inventory is not None and seed_inventory_key:
                    next_seed_count = current_seed_count - 1
                    if next_seed_count <= 0:
                        inventory.pop(seed_inventory_key, None)
                    else:
                        inventory[seed_inventory_key] = next_seed_count
                    player["inventory"] = inventory

                    if isinstance(client.get("user_id"), int) and int(client.get("user_id", 0)) > 0:
                        await asyncio.to_thread(set_user_inventory, int(client["user_id"]), inventory)
                    elif isinstance(client.get("guest_profile_id"), int) and int(client.get("guest_profile_id", 0)) > 0:
                        await asyncio.to_thread(set_guest_profile_inventory, int(client["guest_profile_id"]), inventory)

                await schedule_world_save(world["name"])
                if not creative_planting and inventory is not None:
                    await ws_send(
                        websocket,
                        {
                            "type": "inventory_update",
                            "inventory": inventory_to_client_payload(inventory),
                        },
                    )
                await broadcast_to_world(
                    world,
                    {
                        "type": "tree_planted",
                        "tree": {
                            "id": str(planted_tree.get("id", "")),
                            "x": int(planted_tree.get("x", x)),
                            "y": int(planted_tree.get("y", y)),
                            "itemId": int(planted_tree.get("seed_id", seed_id)),
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
        await leave_world(client, world_cache)
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