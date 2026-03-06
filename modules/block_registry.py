from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

DEFAULT_RUNTIME_BLOCK_ROLES: tuple[str, ...] = (
    "air",
    "dirt",
    "bedrock",
    "stone",
    "cave_background",
    "door",
)


def _to_non_negative_int(value: Any) -> int | None:
    try:
        numeric = int(value)
    except Exception:
        return None
    if numeric < 0:
        return None
    return numeric


def _normalize_runtime_role_name(value: Any, required_roles: set[str]) -> str:
    text = str(value or "").strip().lower()
    aliases = {
        "cavebackground": "cave_background",
        "cave-bg": "cave_background",
        "world_door": "door",
        "world-door": "door",
    }
    normalized = aliases.get(text, text)
    return normalized if normalized in required_roles else ""


def load_blocks_payload(blocks_path: Path) -> dict[str, Any]:
    try:
        with blocks_path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return {"atlases": [], "blocks": []}

    if not isinstance(payload, dict):
        return {"atlases": [], "blocks": []}

    atlases = payload.get("atlases", [])
    blocks = payload.get("blocks", [])
    return {
        "atlases": atlases if isinstance(atlases, list) else [],
        "blocks": blocks if isinstance(blocks, list) else [],
        "runtimeBlockRoles": payload.get("runtimeBlockRoles", {}),
    }


def build_block_indexes(blocks: list[Any]) -> tuple[dict[int, dict[str, Any]], dict[str, int], set[int]]:
    blocks_by_id: dict[int, dict[str, Any]] = {}
    block_name_to_id: dict[str, int] = {}
    background_ids: set[int] = set()

    for raw_block in blocks:
        if not isinstance(raw_block, dict):
            continue

        try:
            block_id = int(raw_block.get("ITEM_ID", raw_block.get("ID", 0)))
        except Exception:
            continue

        if block_id < 0:
            continue

        block = dict(raw_block)
        # Keep legacy field mirrored for older clients/tools that still read ID.
        block["ITEM_ID"] = block_id
        block["ID"] = block_id
        blocks_by_id[block_id] = block

        block_name = str(block.get("NAME", "")).strip().upper()
        if block_name and block_name not in block_name_to_id:
            block_name_to_id[block_name] = block_id

        if str(block.get("BLOCK_TYPE", "")).upper() == "BACKGROUND":
            background_ids.add(block_id)

    return blocks_by_id, block_name_to_id, background_ids


def resolve_runtime_block_ids(
    payload: dict[str, Any],
    blocks_by_id: dict[int, dict[str, Any]],
    *,
    required_roles: Iterable[str] = DEFAULT_RUNTIME_BLOCK_ROLES,
) -> dict[str, int]:
    role_order = tuple(str(role or "").strip().lower() for role in required_roles if str(role or "").strip())
    required_role_set = set(role_order)

    role_to_id: dict[str, int] = {}
    if not blocks_by_id:
        return role_to_id

    blocks = sorted(blocks_by_id.items(), key=lambda entry: entry[0])
    block_name_to_id: dict[str, int] = {}
    for block_id, block in blocks:
        block_name = str(block.get("NAME", "")).strip().upper()
        if block_name and block_name not in block_name_to_id:
            block_name_to_id[block_name] = block_id

    def set_role(role: str, block_id: int | None) -> None:
        if role in role_to_id:
            return
        if block_id is None:
            return
        if block_id not in blocks_by_id:
            return
        role_to_id[role] = int(block_id)

    def find_name(*names: Any) -> int | None:
        for name in names:
            key = str(name or "").strip().upper()
            if key in block_name_to_id:
                return int(block_name_to_id[key])
        return None

    configured_roles = payload.get("runtimeBlockRoles")
    if isinstance(configured_roles, dict):
        for role_raw, value in configured_roles.items():
            role = _normalize_runtime_role_name(role_raw, required_role_set)
            if not role:
                continue

            direct_id = _to_non_negative_int(value)
            if direct_id is not None and direct_id in blocks_by_id:
                set_role(role, direct_id)
                continue

            by_name = find_name(value)
            set_role(role, by_name)

    for block_id, block in blocks:
        role = _normalize_runtime_role_name(
            block.get("WORLDGEN_ROLE") or block.get("RUNTIME_ROLE"),
            required_role_set,
        )
        if role:
            set_role(role, block_id)

        if bool(block.get("IS_WORLD_DOOR")) or bool(block.get("IS_DOOR")):
            set_role("door", block_id)

    set_role("air", find_name("AIR"))
    set_role("dirt", find_name("DIRT"))
    set_role("bedrock", find_name("BEDROCK"))
    set_role("stone", find_name("STONE"))
    set_role("cave_background", find_name("CAVE_BACKGROUND"))
    set_role("door", find_name("WORLD_DOOR", "DOOR"))

    if "air" not in role_to_id:
        background_candidates = [
            block_id
            for block_id, block in blocks
            if str(block.get("BLOCK_TYPE", "")).upper() == "BACKGROUND"
        ]
        if background_candidates:
            set_role("air", background_candidates[0])
        else:
            set_role("air", blocks[0][0])

    if "bedrock" not in role_to_id:
        unbreakable_solids = [
            block_id
            for block_id, block in blocks
            if str(block.get("BLOCK_TYPE", "")).upper() == "SOLID" and bool(block.get("BREAKABLE", True)) is False
        ]
        if unbreakable_solids:
            set_role("bedrock", unbreakable_solids[0])

    if "cave_background" not in role_to_id:
        non_air_background = [
            block_id
            for block_id, block in blocks
            if str(block.get("BLOCK_TYPE", "")).upper() == "BACKGROUND" and block_id != role_to_id.get("air")
        ]
        if non_air_background:
            set_role("cave_background", non_air_background[0])

    if "dirt" not in role_to_id:
        solid_breakable = [
            block_id
            for block_id, block in blocks
            if str(block.get("BLOCK_TYPE", "")).upper() == "SOLID" and bool(block.get("BREAKABLE", True))
        ]
        if solid_breakable:
            set_role("dirt", solid_breakable[0])

    if "stone" not in role_to_id:
        solid_candidates = [
            (block_id, int(block.get("TOUGHNESS", 1)) if isinstance(block.get("TOUGHNESS", 1), (int, float)) else 1)
            for block_id, block in blocks
            if str(block.get("BLOCK_TYPE", "")).upper() == "SOLID" and bool(block.get("BREAKABLE", True))
        ]
        if solid_candidates:
            solid_candidates.sort(key=lambda item: item[1], reverse=True)
            set_role("stone", solid_candidates[0][0])

    if "door" not in role_to_id:
        by_name_contains = [
            block_id
            for block_id, block in blocks
            if "DOOR" in str(block.get("NAME", "")).upper()
        ]
        if by_name_contains:
            set_role("door", by_name_contains[0])

    air_fallback = role_to_id.get("air", blocks[0][0])
    for role in role_order:
        if role not in role_to_id:
            role_to_id[role] = air_fallback

    return role_to_id


def load_block_definitions(
    blocks_path: Path,
    *,
    required_roles: Iterable[str] = DEFAULT_RUNTIME_BLOCK_ROLES,
) -> tuple[set[int], dict[int, dict[str, Any]], dict[str, int]]:
    payload = load_blocks_payload(blocks_path)
    blocks_by_id, _, background_ids = build_block_indexes(payload.get("blocks", []))
    runtime_ids = resolve_runtime_block_ids(payload, blocks_by_id, required_roles=required_roles)
    return background_ids, blocks_by_id, runtime_ids


class BlockCatalog:
    def __init__(
        self,
        blocks_path: Path,
        *,
        required_roles: Iterable[str] = DEFAULT_RUNTIME_BLOCK_ROLES,
    ) -> None:
        self.blocks_path = blocks_path
        self.required_roles = tuple(required_roles)
        self.background_ids: set[int] = set()
        self.blocks_by_id: dict[int, dict[str, Any]] = {}
        self.runtime_ids: dict[str, int] = {}
        self.blocks_mtime_ns = 0

    def load_payload(self) -> dict[str, Any]:
        return load_blocks_payload(self.blocks_path)

    def refresh_if_changed(self, force: bool = False) -> bool:
        try:
            current_mtime_ns = self.blocks_path.stat().st_mtime_ns
        except Exception:
            current_mtime_ns = 0

        if not force and current_mtime_ns == self.blocks_mtime_ns:
            return False

        background_ids, blocks_by_id, runtime_ids = load_block_definitions(
            self.blocks_path,
            required_roles=self.required_roles,
        )
        self.background_ids = background_ids
        self.blocks_by_id = blocks_by_id
        self.runtime_ids = runtime_ids
        self.blocks_mtime_ns = current_mtime_ns
        return True
