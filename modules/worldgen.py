from __future__ import annotations

import copy
import random
from typing import Any

DEFAULT_WORLDGEN_CONFIG: dict[str, float | int] = {
    "surface_ratio": 0.58,
    "surface_min_margin": 6,
    "bedrock_layers": 3,
    "door_margin": 6,
    "stone_chance_base": 0.03,
    "stone_chance_depth_bonus": 0.01,
}

# Primary worldgen material profile.
# Edit this section to control which block roles are used and how strata behave.
DEFAULT_WORLDGEN_MATERIALS: dict[str, Any] = {
    "background_role": "cave_background",
    "surface_role": "dirt",
    "surface_layer_count": 1,
    "fill_role": "dirt",
    "stone_role": "stone",
    "bedrock_role": "bedrock",
    "door_role": "door",
    "door_floor_role": "bedrock",
    "headroom_role": "air",
    # Optional depth rules. If empty, legacy dirt/stone chance logic is used.
    # Rule fields: role, min_depth, max_depth, base_weight, depth_weight.
    "strata_rules": [],
}


def _normalize_block_ids(block_ids: dict[str, int] | None) -> dict[str, int]:
    resolved: dict[str, int] = {}
    if not isinstance(block_ids, dict):
        return resolved

    for key, value in block_ids.items():
        normalized_key = str(key or "").strip().lower()
        try:
            numeric = int(value)
        except Exception:
            continue
        if numeric >= 0 and normalized_key:
            resolved[normalized_key] = numeric

    return resolved


def _resolve_role_id(role: Any, block_ids: dict[str, int], fallback: int) -> int:
    key = str(role or "").strip().lower()
    return int(block_ids.get(key, fallback))


def _build_worldgen_settings(config: dict[str, Any] | None) -> tuple[dict[str, Any], dict[str, Any]]:
    cfg: dict[str, Any] = dict(DEFAULT_WORLDGEN_CONFIG)
    if isinstance(config, dict):
        for key, value in config.items():
            if key != "materials":
                cfg[key] = value

    materials: dict[str, Any] = copy.deepcopy(DEFAULT_WORLDGEN_MATERIALS)
    if isinstance(config, dict) and isinstance(config.get("materials"), dict):
        override = config["materials"]
        for key, value in override.items():
            materials[key] = value

    return cfg, materials


def _choose_strata_block_id(
    depth: int,
    depth_span: int,
    rules: list[dict[str, Any]],
    block_ids: dict[str, int],
    rng: random.Random,
    fallback_id: int,
) -> int:
    if not rules:
        return fallback_id

    depth_ratio = max(0.0, min(1.0, float(depth) / float(max(1, depth_span))))
    weighted: list[tuple[int, float]] = []

    for rule in rules:
        if not isinstance(rule, dict):
            continue

        role = str(rule.get("role", "")).strip().lower()
        if not role:
            continue

        min_depth = int(rule.get("min_depth", 0) or 0)
        max_depth_raw = rule.get("max_depth", None)
        max_depth = int(max_depth_raw) if isinstance(max_depth_raw, (int, float)) else 10**9
        if depth < min_depth or depth > max_depth:
            continue

        block_id = block_ids.get(role)
        if block_id is None:
            continue

        try:
            base_weight = float(rule.get("base_weight", 1.0))
        except Exception:
            base_weight = 1.0
        try:
            depth_weight = float(rule.get("depth_weight", 0.0))
        except Exception:
            depth_weight = 0.0

        weight = base_weight + (depth_weight * depth_ratio)
        if weight <= 0.0:
            continue
        weighted.append((int(block_id), weight))

    if not weighted:
        return fallback_id

    total = sum(weight for _, weight in weighted)
    roll = rng.random() * total
    running = 0.0
    for block_id, weight in weighted:
        running += weight
        if roll <= running:
            return int(block_id)

    return int(weighted[-1][0])


def generate_world_layers(
    width: int,
    height: int,
    seed_name: str,
    config: dict[str, Any] | None = None,
    block_ids: dict[str, int] | None = None,
) -> dict[str, Any]:
    cfg, materials = _build_worldgen_settings(config)
    resolved_block_ids = _normalize_block_ids(block_ids)

    air_block_id = int(resolved_block_ids.get("air", 0))
    background_block_id = _resolve_role_id(materials.get("background_role"), resolved_block_ids, air_block_id)
    surface_block_id = _resolve_role_id(materials.get("surface_role"), resolved_block_ids, air_block_id)
    fill_block_id = _resolve_role_id(materials.get("fill_role"), resolved_block_ids, surface_block_id)
    stone_block_id = _resolve_role_id(materials.get("stone_role"), resolved_block_ids, fill_block_id)
    bedrock_block_id = _resolve_role_id(materials.get("bedrock_role"), resolved_block_ids, fill_block_id)
    door_block_id = _resolve_role_id(materials.get("door_role"), resolved_block_ids, air_block_id)
    door_floor_block_id = _resolve_role_id(materials.get("door_floor_role"), resolved_block_ids, bedrock_block_id)
    headroom_block_id = _resolve_role_id(materials.get("headroom_role"), resolved_block_ids, air_block_id)

    try:
        surface_layer_count = max(1, int(materials.get("surface_layer_count", 1)))
    except Exception:
        surface_layer_count = 1

    strata_rules = materials.get("strata_rules", [])
    if not isinstance(strata_rules, list):
        strata_rules = []

    foreground = [0 for _ in range(width * height)]
    background = [0 for _ in range(width * height)]

    rng = random.Random(f"worldgen:{seed_name}")

    base_surface = int(height * float(cfg["surface_ratio"]))
    surface_min_margin = int(cfg["surface_min_margin"])
    bedrock_layers = int(cfg["bedrock_layers"])
    door_margin = int(cfg["door_margin"])
    stone_chance_base = float(cfg["stone_chance_base"])
    stone_chance_depth_bonus = float(cfg["stone_chance_depth_bonus"])

    surface_y = max(surface_min_margin, min(height - (bedrock_layers + 4), base_surface))
    bedrock_start_y = height - bedrock_layers

    for x in range(width):
        for y in range(surface_y, height):
            index = y * width + x

            if y >= bedrock_start_y:
                foreground[index] = bedrock_block_id
                background[index] = background_block_id
                continue

            depth = y - surface_y
            if depth < surface_layer_count:
                foreground[index] = surface_block_id
                background[index] = background_block_id
                continue

            if strata_rules:
                foreground[index] = _choose_strata_block_id(
                    depth,
                    max(1, bedrock_start_y - surface_y),
                    strata_rules,
                    resolved_block_ids,
                    rng,
                    fill_block_id,
                )
            else:
                depth_ratio = depth / max(1, (bedrock_start_y - surface_y))
                stone_chance = stone_chance_base + (depth_ratio * stone_chance_depth_bonus)
                if rng.random() < stone_chance:
                    foreground[index] = stone_block_id
                else:
                    foreground[index] = fill_block_id

            background[index] = background_block_id

    min_door_x = max(0, door_margin)
    max_door_x = min(width - 1, width - door_margin - 1)
    if min_door_x <= max_door_x:
        door_x = rng.randint(min_door_x, max_door_x)
    else:
        door_x = width // 2
    door_y = max(1, surface_y - 1)

    door_index = door_y * width + door_x
    foreground[door_index] = door_block_id
    background[door_index] = background_block_id

    if door_y - 1 >= 0:
        headroom_index = (door_y - 1) * width + door_x
        foreground[headroom_index] = headroom_block_id

    floor_index = (door_y + 1) * width + door_x
    if floor_index < len(foreground):
        foreground[floor_index] = door_floor_block_id

    return {
        "width": width,
        "height": height,
        "foreground": foreground,
        "background": background,
        "door": {"x": door_x, "y": door_y},
    }
