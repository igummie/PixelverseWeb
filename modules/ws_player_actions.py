from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any


async def teleport_player(
    *,
    world: dict[str, Any],
    player_id: str,
    x: float,
    y: float,
    broadcast_to_world: Callable[..., Awaitable[Any]],
) -> bool:
    player = world.get("players", {}).get(player_id)
    if not isinstance(player, dict):
        return False

    player["x"] = float(x)
    player["y"] = float(y)

    await broadcast_to_world(
        world,
        {
            "type": "player_moved",
            "id": player_id,
            "x": float(x),
            "y": float(y),
            "teleport": True,
        },
    )
    return True


async def respawn_player_to_door(
    *,
    world: dict[str, Any],
    player_id: str,
    get_spawn_from_door: Callable[..., tuple[float, float]],
    broadcast_to_world: Callable[..., Awaitable[Any]],
) -> bool:
    spawn_x, spawn_y = get_spawn_from_door(world)
    return await teleport_player(
        world=world,
        player_id=player_id,
        x=spawn_x,
        y=spawn_y,
        broadcast_to_world=broadcast_to_world,
    )
