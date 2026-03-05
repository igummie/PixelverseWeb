from __future__ import annotations

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


def generate_world_layers(
    width: int,
    height: int,
    seed_name: str,
    config: dict[str, float | int] | None = None,
    block_ids: dict[str, int] | None = None,
) -> dict[str, Any]:
    cfg = dict(DEFAULT_WORLDGEN_CONFIG)
    if config:
        cfg.update(config)

    resolved_block_ids: dict[str, int] = {}
    if isinstance(block_ids, dict):
        for key, value in block_ids.items():
            normalized_key = str(key or "").strip().lower()
            try:
                numeric = int(value)
            except Exception:
                continue
            if numeric >= 0:
                resolved_block_ids[normalized_key] = numeric

    air_block_id = int(resolved_block_ids.get("air", 0))
    dirt_block_id = int(resolved_block_ids.get("dirt", air_block_id))
    bedrock_block_id = int(resolved_block_ids.get("bedrock", dirt_block_id))
    stone_block_id = int(resolved_block_ids.get("stone", dirt_block_id))
    cave_background_block_id = int(resolved_block_ids.get("cave_background", air_block_id))
    door_block_id = int(resolved_block_ids.get("door", air_block_id))

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
                background[index] = cave_background_block_id
                continue

            depth = y - surface_y
            if depth <= 0:
                foreground[index] = dirt_block_id
                background[index] = cave_background_block_id
                continue

            depth_ratio = depth / max(1, (bedrock_start_y - surface_y))
            stone_chance = stone_chance_base + (depth_ratio * stone_chance_depth_bonus)

            if rng.random() < stone_chance:
                foreground[index] = stone_block_id
            else:
                foreground[index] = dirt_block_id

            background[index] = cave_background_block_id

    min_door_x = max(0, door_margin)
    max_door_x = min(width - 1, width - door_margin - 1)
    if min_door_x <= max_door_x:
        door_x = rng.randint(min_door_x, max_door_x)
    else:
        door_x = width // 2
    door_y = max(1, surface_y - 1)

    door_index = door_y * width + door_x
    foreground[door_index] = door_block_id
    background[door_index] = cave_background_block_id

    if door_y - 1 >= 0:
        headroom_index = (door_y - 1) * width + door_x
        foreground[headroom_index] = air_block_id

    floor_index = (door_y + 1) * width + door_x
    if floor_index < len(foreground):
        foreground[floor_index] = bedrock_block_id

    return {
        "width": width,
        "height": height,
        "foreground": foreground,
        "background": background,
        "door": {"x": door_x, "y": door_y},
    }
