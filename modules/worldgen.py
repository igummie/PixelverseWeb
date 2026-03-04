from __future__ import annotations

import random
from typing import Any

AIR_BLOCK_ID = 0
DIRT_BLOCK_ID = 1
BEDROCK_BLOCK_ID = 2
STONE_BLOCK_ID = 3
DOOR_BLOCK_ID = 17

DEFAULT_WORLDGEN_CONFIG: dict[str, float | int] = {
    "surface_ratio": 0.58,
    "surface_min_margin": 6,
    "bedrock_layers": 3,
    "door_margin": 6,
    "stone_chance_base": 0.03,
    "stone_chance_depth_bonus": 0.17,
}


def generate_world_layers(
    width: int,
    height: int,
    seed_name: str,
    config: dict[str, float | int] | None = None,
) -> dict[str, Any]:
    cfg = dict(DEFAULT_WORLDGEN_CONFIG)
    if config:
        cfg.update(config)

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
                foreground[index] = BEDROCK_BLOCK_ID
                continue

            depth = y - surface_y
            depth_ratio = depth / max(1, (bedrock_start_y - surface_y))
            stone_chance = stone_chance_base + (depth_ratio * stone_chance_depth_bonus)

            if rng.random() < stone_chance:
                foreground[index] = STONE_BLOCK_ID
            else:
                foreground[index] = DIRT_BLOCK_ID

    min_door_x = max(0, door_margin)
    max_door_x = min(width - 1, width - door_margin - 1)
    if min_door_x <= max_door_x:
        door_x = rng.randint(min_door_x, max_door_x)
    else:
        door_x = width // 2
    door_y = max(1, surface_y - 1)

    door_index = door_y * width + door_x
    foreground[door_index] = DOOR_BLOCK_ID

    if door_y - 1 >= 0:
        headroom_index = (door_y - 1) * width + door_x
        foreground[headroom_index] = AIR_BLOCK_ID

    floor_index = (door_y + 1) * width + door_x
    if floor_index < len(foreground):
        foreground[floor_index] = BEDROCK_BLOCK_ID

    return {
        "width": width,
        "height": height,
        "foreground": foreground,
        "background": background,
        "door": {"x": door_x, "y": door_y},
    }
