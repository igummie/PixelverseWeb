from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any

import jwt
from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from modules.chat_commands import process_chat_command
from modules.worldgen import generate_world_layers
from pydantic import BaseModel, Field

PORT = int(os.getenv("PORT", "3000"))
JWT_SECRET = os.getenv("JWT_SECRET", "dev_secret_change_me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRES_SECONDS = 7 * 24 * 60 * 60
WORLD_WIDTH = 120
WORLD_HEIGHT = 70
AIR_BLOCK_ID = 0
BEDROCK_BLOCK_ID = 2
DIRT_BLOCK_ID = 1
DOOR_BLOCK_ID = 17

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
DATA_DIR = BASE_DIR / "data" / "db"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "game.db"
BLOCKS_PATH = PUBLIC_DIR / "data" / "blocks.json"


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

        columns = {
            str(row["name"]).lower()
            for row in conn.execute("PRAGMA table_info(worlds)").fetchall()
        }
        if "door_x" not in columns:
            conn.execute("ALTER TABLE worlds ADD COLUMN door_x INTEGER")
        if "door_y" not in columns:
            conn.execute("ALTER TABLE worlds ADD COLUMN door_y INTEGER")


def normalize_name(value: str | None, fallback: str = "") -> str:
    return (value or fallback).strip().lower()


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


def create_token(user_id: int, username: str) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "username": username,
        "iat": now,
        "exp": now + JWT_EXPIRES_SECONDS,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def parse_token(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None

    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        return None


def load_block_definitions() -> tuple[set[int], dict[int, dict[str, Any]]]:
    try:
        with BLOCKS_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return set(), {}

    background_ids: set[int] = set()
    blocks_by_id: dict[int, dict[str, Any]] = {}

    for block in payload.get("blocks", []):
        try:
            block_id = int(block.get("ID", 0))
        except Exception:
            continue

        if block_id < 0:
            continue

        blocks_by_id[block_id] = block
        if str(block.get("BLOCK_TYPE", "")).upper() == "BACKGROUND":
            background_ids.add(block_id)

    return background_ids, blocks_by_id


BACKGROUND_BLOCK_IDS, BLOCKS_BY_ID = load_block_definitions()
BLOCKS_MTIME_NS = 0


def refresh_block_definitions_if_changed(force: bool = False) -> None:
    global BACKGROUND_BLOCK_IDS, BLOCKS_BY_ID, BLOCKS_MTIME_NS

    try:
        current_mtime_ns = BLOCKS_PATH.stat().st_mtime_ns
    except Exception:
        current_mtime_ns = 0

    if force or current_mtime_ns != BLOCKS_MTIME_NS:
        BACKGROUND_BLOCK_IDS, BLOCKS_BY_ID = load_block_definitions()
        BLOCKS_MTIME_NS = current_mtime_ns


def is_breakable(tile_id: int) -> bool:
    if tile_id <= 0:
        return False

    block = BLOCKS_BY_ID.get(tile_id)
    if not block:
        return True

    return bool(block.get("BREAKABLE", True))


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
    spawn_y = float(max(0, door["y"] - 0.92))
    return spawn_x, spawn_y


def enforce_bedrock_under_door(world: dict[str, Any], previous_door: dict[str, int] | None = None) -> bool:
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
                    if old_door_index < len(foreground) and int(foreground[old_door_index]) == DOOR_BLOCK_ID:
                        foreground[old_door_index] = AIR_BLOCK_ID
                        changed = True

                    if int(foreground[old_index]) == BEDROCK_BLOCK_ID:
                        foreground[old_index] = DIRT_BLOCK_ID
                        changed = True

    floor_y = door["y"] + 1
    if floor_y < 0 or floor_y >= height:
        return changed

    index = floor_y * width + door["x"]
    foreground = world.get("foreground")
    if not isinstance(foreground, list) or index >= len(foreground):
        return changed

    door_index = door["y"] * width + door["x"]
    if door_index < len(foreground) and int(foreground[door_index]) != DOOR_BLOCK_ID:
        foreground[door_index] = DOOR_BLOCK_ID
        changed = True

    if int(foreground[index]) == BEDROCK_BLOCK_ID:
        return changed

    foreground[index] = BEDROCK_BLOCK_ID
    return True


def create_world(name: str) -> dict[str, Any]:
    generated = generate_world_layers(WORLD_WIDTH, WORLD_HEIGHT, name)
    door = sanitize_door(generated.get("door"), generated["width"], generated["height"])
    world = {
        "name": name,
        "width": generated["width"],
        "height": generated["height"],
        "foreground": generated["foreground"],
        "background": generated["background"],
        "door": door,
        "players": {},
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
    else:
        raw_foreground = parsed_tiles.get("foreground", []) if isinstance(parsed_tiles, dict) else []
        raw_background = parsed_tiles.get("background", []) if isinstance(parsed_tiles, dict) else []
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

    return {
        "name": name,
        "width": width,
        "height": height,
        "foreground": foreground,
        "background": background,
        "door": resolved_door,
        "previous_door": parsed_door,
        "players": {},
    }


class RegisterBody(BaseModel):
    username: str = Field(min_length=3, max_length=16)
    password: str = Field(min_length=6, max_length=72)


class LoginBody(BaseModel):
    username: str
    password: str


class SaveTexture47ConfigBody(BaseModel):
    atlasId: str = Field(min_length=1, max_length=64)
    columns: int = Field(ge=1, le=512)
    rows: int = Field(ge=1, le=512)
    maskOrder: list[Any] = Field(default_factory=list)
    maskVariants: dict[str, list[Any]] = Field(default_factory=dict)


world_cache: dict[str, dict[str, Any]] = {}
save_tasks: dict[str, asyncio.Task[Any]] = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async def periodic_flush() -> None:
        while True:
            await asyncio.sleep(30)
            for world in list(world_cache.values()):
                await asyncio.to_thread(save_world, world)

    flush_task = asyncio.create_task(periodic_flush())
    try:
        yield
    finally:
        flush_task.cancel()
        for world in list(world_cache.values()):
            await asyncio.to_thread(save_world, world)


app = FastAPI(lifespan=lifespan)
initialize_db()
refresh_block_definitions_if_changed(force=True)


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
def guest_login() -> dict[str, Any]:
    guest_number = secrets.randbelow(900) + 100
    guest_username = f"Guest_{guest_number}"
    guest_id = -int(time.time() * 1000)

    token = create_token(guest_id, guest_username)
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


@app.post("/api/tools/texture47/save")
def save_texture47_config(
    payload: SaveTexture47ConfigBody,
) -> dict[str, Any]:
    atlas_id = normalize_name(payload.atlasId)
    if not re.fullmatch(r"[a-z0-9_-]+", atlas_id):
        raise HTTPException(status_code=400, detail="Invalid atlas id")

    sanitized_mask_order: list[int | None] = []
    for value in payload.maskOrder:
        try:
            mask = int(value)
        except Exception:
            sanitized_mask_order.append(None)
            continue

        if 0 <= mask <= 255:
            sanitized_mask_order.append(mask)
        else:
            sanitized_mask_order.append(None)

    sanitized_mask_variants: dict[str, list[int]] = {}
    if isinstance(payload.maskVariants, dict):
        for key, values in payload.maskVariants.items():
            try:
                mask = int(key)
            except Exception:
                continue

            if mask < 0 or mask > 255:
                continue

            if not isinstance(values, list):
                continue

            variants: list[int] = []
            for raw in values:
                try:
                    tile_index = int(raw)
                except Exception:
                    continue

                if tile_index >= 0 and tile_index not in variants:
                    variants.append(tile_index)

            if variants:
                sanitized_mask_variants[str(mask)] = variants

    output = {
        "columns": int(payload.columns),
        "rows": int(payload.rows),
        "maskOrder": sanitized_mask_order,
        "maskVariants": sanitized_mask_variants,
    }

    texture47_dir = PUBLIC_DIR / "assets" / "texture47" / "configs"
    texture47_dir.mkdir(parents=True, exist_ok=True)
    output_path = (texture47_dir / f"{atlas_id}.json").resolve()

    if not str(output_path).startswith(str(texture47_dir.resolve())):
        raise HTTPException(status_code=400, detail="Invalid atlas id")

    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2)
        handle.write("\n")

    return {
        "ok": True,
        "path": f"assets/texture47/configs/{atlas_id}.json",
        "saved": output,
    }


@app.get("/api/tools/texture47/atlases")
def list_texture47_atlases() -> dict[str, Any]:
    texture47_dir = PUBLIC_DIR / "assets" / "texture47"
    atlases: list[str] = []

    if texture47_dir.exists() and texture47_dir.is_dir():
        for file_path in sorted(texture47_dir.glob("*.png")):
            name = file_path.stem.strip().lower()
            if name and re.fullmatch(r"[a-z0-9_-]+", name):
                atlases.append(name)

    return {
        "atlases": atlases,
    }


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

            if msg_type == "join_world":
                auth_user = parse_token(str(msg.get("token", "")))
                if not auth_user:
                    await ws_send(websocket, {"type": "error", "message": "Authentication required"})
                    continue

                await leave_world(client)

                world = get_world(str(msg.get("world", "start")))
                client["username"] = str(auth_user.get("username", "player"))
                client["world_name"] = world["name"]
                spawn_x, spawn_y = get_spawn_from_door(world)

                world["players"][client_id] = {
                    "id": client_id,
                    "username": client["username"],
                    "x": spawn_x,
                    "y": spawn_y,
                    "fly_enabled": False,
                    "noclip_enabled": False,
                    "ws": websocket,
                }

                await ws_send(
                    websocket,
                    {
                        "type": "world_snapshot",
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
                        },
                        "selfId": client_id,
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

                await broadcast_to_world(world, {"type": "player_moved", "id": client_id, "x": x, "y": y})
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

                updated = False
                if action == "break":
                    if world["foreground"][index] != 0:
                        foreground_tile = int(world["foreground"][index])
                        if is_breakable(foreground_tile):
                            world["foreground"][index] = 0
                            updated = True
                    elif world["background"][index] != 0:
                        background_tile = int(world["background"][index])
                        if is_breakable(background_tile):
                            world["background"][index] = 0
                            updated = True
                else:
                    tile = max(0, tile)
                    if tile <= 0:
                        continue

                    if tile not in BLOCKS_BY_ID:
                        continue

                    if tile in BACKGROUND_BLOCK_IDS:
                        if world["background"][index] == 0:
                            world["background"][index] = tile
                            updated = True
                    else:
                        if world["foreground"][index] == 0:
                            world["foreground"][index] = tile
                            updated = True

                if not updated:
                    continue

                await schedule_world_save(world["name"])

                await broadcast_to_world(
                    world,
                    {
                        "type": "tile_updated",
                        "x": x,
                        "y": y,
                        "tile": world["foreground"][index],
                        "foreground": world["foreground"][index],
                        "background": world["background"][index],
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

                command_result = process_chat_command(
                    raw_message=message_text,
                    client_id=client_id,
                    client_username=str(username),
                    world=world,
                )

                if command_result is not None:
                    sender_message = str(command_result.get("sender_message", "")).strip()
                    if sender_message:
                        await ws_send(
                            websocket,
                            {
                                "type": "system_message",
                                "message": sender_message,
                            },
                        )

                    state_update = command_result.get("state_update")
                    if isinstance(state_update, dict):
                        await ws_send(
                            websocket,
                            {
                                "type": "command_state",
                                "flyEnabled": bool(state_update.get("flyEnabled", False)),
                                "noclipEnabled": bool(state_update.get("noclipEnabled", False)),
                            },
                        )

                    direct_messages = command_result.get("direct_messages") or []
                    for direct_message in direct_messages:
                        if not isinstance(direct_message, dict):
                            continue

                        target_id = str(direct_message.get("target_id", ""))
                        message = str(direct_message.get("message", "")).strip()
                        if not target_id or not message:
                            continue

                        target_player = world["players"].get(target_id)
                        if not target_player:
                            continue

                        target_socket = target_player.get("ws")
                        if target_socket is None:
                            continue

                        await ws_send(
                            target_socket,
                            {
                                "type": "system_message",
                                "message": message,
                            },
                        )

                    teleports = command_result.get("teleports") or []
                    for teleport in teleports:
                        if not isinstance(teleport, dict):
                            continue

                        teleport_player_id = str(teleport.get("id", ""))
                        teleport_player = world["players"].get(teleport_player_id)
                        if not teleport_player:
                            continue

                        try:
                            teleport_x = float(teleport.get("x", teleport_player.get("x", 0)))
                            teleport_y = float(teleport.get("y", teleport_player.get("y", 0)))
                        except Exception:
                            continue

                        teleport_player["x"] = teleport_x
                        teleport_player["y"] = teleport_y

                        await broadcast_to_world(
                            world,
                            {
                                "type": "player_moved",
                                "id": teleport_player_id,
                                "x": teleport_x,
                                "y": teleport_y,
                            },
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

    target = (PUBLIC_DIR / safe_path).resolve()
    public_root = PUBLIC_DIR.resolve()

    if not str(target).startswith(str(public_root)):
        raise HTTPException(status_code=404, detail="Not Found")

    if not target.is_file():
        raise HTTPException(status_code=404, detail="Not Found")

    return FileResponse(target)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=PORT)
