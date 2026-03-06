from __future__ import annotations

import json
from typing import Any

from fastapi import WebSocket


async def ws_send(socket: WebSocket, payload: dict[str, Any]) -> None:
    await socket.send_text(json.dumps(payload))


async def broadcast_to_world(
    world: dict[str, Any],
    payload: dict[str, Any],
    except_client_id: str | None = None,
) -> None:
    for client_id, player in list(world["players"].items()):
        if except_client_id and client_id == except_client_id:
            continue

        try:
            await ws_send(player["ws"], payload)
        except Exception:
            pass


async def leave_world(client: dict[str, Any], world_cache: dict[str, dict[str, Any]]) -> None:
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
