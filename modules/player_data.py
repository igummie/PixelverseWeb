from __future__ import annotations

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

JWT_SECRET = os.getenv("JWT_SECRET", "dev_secret_change_me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRES_SECONDS = 7 * 24 * 60 * 60
ALLOWED_ITEM_TYPES = {"seed", "block", "furniture", "clothes"}

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "db"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "game.db"


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
                inventory_json TEXT NOT NULL DEFAULT '{}',
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
                weather INTEGER NOT NULL DEFAULT 0,
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
                inventory_json TEXT NOT NULL DEFAULT '{}',
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
        if "weather" not in columns:
            conn.execute("ALTER TABLE worlds ADD COLUMN weather INTEGER NOT NULL DEFAULT 0")

        user_columns = {
            str(row["name"]).lower()
            for row in conn.execute("PRAGMA table_info(users)").fetchall()
        }
        if "gems" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN gems INTEGER NOT NULL DEFAULT 0")
        if "inventory_json" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN inventory_json TEXT NOT NULL DEFAULT '{}' ")

        guest_columns = {
            str(row["name"]).lower()
            for row in conn.execute("PRAGMA table_info(guest_profiles)").fetchall()
        }
        if "inventory_json" not in guest_columns:
            conn.execute("ALTER TABLE guest_profiles ADD COLUMN inventory_json TEXT NOT NULL DEFAULT '{}' ")


def normalize_name(value: str | None, fallback: str = "") -> str:
    return (value or fallback).strip().lower()


def normalize_item_type(value: Any, default: str = "seed") -> str:
    normalized_default = str(default or "seed").strip().lower()
    if normalized_default not in ALLOWED_ITEM_TYPES:
        normalized_default = "seed"

    text = str(value or normalized_default).strip().lower()
    if text not in ALLOWED_ITEM_TYPES:
        return normalized_default
    return text


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


def make_inventory_key(item_type: str, item_id: int) -> str:
    normalized_type = normalize_item_type(item_type)
    return f"{normalized_type}:{int(item_id)}"


def parse_inventory_key(raw_key: Any) -> tuple[str, int] | None:
    text = str(raw_key or "").strip().lower()
    if not text:
        return None

    if ":" in text:
        kind, raw_id = text.split(":", 1)
        kind = str(kind or "").strip().lower()
        if kind not in ALLOWED_ITEM_TYPES:
            return None
        try:
            item_id = int(raw_id.strip())
        except Exception:
            return None
        if item_id < 0:
            return None
        return kind, item_id

    # Legacy inventory keys were plain numeric ids; try to infer the type.
    try:
        item_id = int(text)
    except Exception:
        return None
    if item_id < 0:
        return None

    # prefer block if we have a definition for this id
    try:
        from app import BLOCKS_BY_ID
        if isinstance(BLOCKS_BY_ID, dict) and item_id in BLOCKS_BY_ID:
            return "block", item_id
    except Exception:
        pass

    return "seed", item_id


def normalize_inventory(raw: Any) -> dict[str, int]:
    if not isinstance(raw, dict):
        return {}

    normalized: dict[str, int] = {}
    for raw_item_key, raw_count in raw.items():
        parsed = parse_inventory_key(raw_item_key)
        if not parsed:
            continue

        item_type, item_id = parsed

        try:
            count = int(raw_count)
        except Exception:
            continue

        if count <= 0:
            continue

        key = make_inventory_key(item_type, item_id)
        normalized[key] = int(normalized.get(key, 0)) + count

    return normalized


def parse_inventory_json(raw: Any) -> dict[str, int]:
    if raw is None:
        return {}

    payload: Any = raw
    if isinstance(raw, str):
        try:
            payload = json.loads(raw)
        except Exception:
            return {}

    return normalize_inventory(payload)


def serialize_inventory_json(inventory: dict[str, int]) -> str:
    normalized = normalize_inventory(inventory)
    payload = {str(item_key): int(count) for item_key, count in sorted(normalized.items())}
    return json.dumps(payload, separators=(",", ":"))


def inventory_to_client_payload(inventory: dict[str, int]) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    normalized = normalize_inventory(inventory)
    sortable_entries: list[tuple[str, int, int]] = []
    for key, count in normalized.items():
        parsed = parse_inventory_key(key)
        if not parsed:
            continue
        item_type, item_id = parsed
        sortable_entries.append((item_type, item_id, int(count)))

    for item_type, item_id, count in sorted(sortable_entries, key=lambda entry: (entry[0], entry[1])):
        payload.append({"itemType": item_type, "itemId": int(item_id), "count": int(count)})
    return payload


def get_user_inventory(user_id: int) -> dict[str, int]:
    if user_id <= 0:
        return {}

    with get_db() as conn:
        row = conn.execute("SELECT inventory_json FROM users WHERE id = ?", (user_id,)).fetchone()

    if not row:
        return {}

    return parse_inventory_json(row["inventory_json"])


def set_user_inventory(user_id: int, inventory: dict[str, int]) -> None:
    if user_id <= 0:
        return

    with get_db() as conn:
        conn.execute(
            "UPDATE users SET inventory_json = ? WHERE id = ?",
            (serialize_inventory_json(inventory), user_id),
        )


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
            "SELECT id, username, gems, inventory_json FROM guest_profiles WHERE device_id = ?",
            (normalized_device_id,),
        ).fetchone()
        if existing:
            return {
                "id": int(existing["id"]),
                "device_id": normalized_device_id,
                "username": str(existing["username"]),
                "gems": max(0, int(existing["gems"])),
                "inventory": parse_inventory_json(existing["inventory_json"]),
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
        "inventory": {},
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


def get_guest_profile_inventory(profile_id: int) -> dict[str, int]:
    if profile_id <= 0:
        return {}

    with get_db() as conn:
        row = conn.execute("SELECT inventory_json FROM guest_profiles WHERE id = ?", (profile_id,)).fetchone()

    if not row:
        return {}

    return parse_inventory_json(row["inventory_json"])


def set_guest_profile_inventory(profile_id: int, inventory: dict[str, int]) -> None:
    if profile_id <= 0:
        return

    with get_db() as conn:
        conn.execute(
            "UPDATE guest_profiles SET inventory_json = ? WHERE id = ?",
            (serialize_inventory_json(inventory), profile_id),
        )


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
