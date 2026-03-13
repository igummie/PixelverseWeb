from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from modules.ws_player_actions import teleport_player
from modules.events import apply_event_effects

import random
import asyncio
import time

# helpers --------------------------------------------------------------------

def _choose_event_location(world: dict[str, Any], mode: str) -> tuple[int, int]:
    """Return a (x,y) pair satisfying *mode* or a random tile on failure.

    Modes:
    - ``any``: an *open* tile (foreground and background both 0)
    - ``open``: same as ``any`` (alias retained for legacy)
    - ``above``: foreground empty, background nonzero
    - ``player``: caller's position isn't handled here (caller must override)
    """
    try:
        width = int(world.get("width", 0))
        height = int(world.get("height", 0))
    except Exception:
        width = height = 0

    if width <= 0 or height <= 0:
        return 0, 0

    fg = world.get("foreground", [])
    bg = world.get("background", [])
    mode = (mode or "any").strip().lower()
    if mode == "open":
        mode = "any"  # treat open as alias for any

    for _ in range(200):  # a few attempts
        x = random.randrange(width)
        y = random.randrange(height)
        idx = y * width + x
        if mode == "any":
            # only foreground must be empty; background may be anything
            if idx < len(fg) and fg[idx] == 0:
                return x, y
        elif mode == "above":
            if (idx < len(fg) and fg[idx] == 0) and (idx < len(bg) and bg[idx] != 0):
                return x, y
        else:
            # unknown mode, fall back to completely random
            return x, y

    # if we didn't find a spot by random sampling, do a full scan
    if mode == "any":
        for y in range(height):
            for x in range(width):
                idx = y * width + x
                if idx < len(fg) and fg[idx] == 0:
                    return x, y
    elif mode == "above":
        for y in range(height):
            for x in range(width):
                idx = y * width + x
                if (
                    idx < len(fg)
                    and fg[idx] == 0
                    and idx < len(bg)
                    and bg[idx] != 0
                ):
                    return x, y
    # if still nothing, just pick a random point
    return random.randrange(width), random.randrange(height)
    # if nothing found, just pick a random point
    return random.randrange(width), random.randrange(height)



async def apply_command_result(
    *,
    command_result: dict[str, Any],
    websocket: Any,
    world: dict[str, Any],
    client_id: str,
    command_sender_original: tuple[float, float] | None,
    ws_send: Callable[..., Awaitable[Any]],
    broadcast_to_world: Callable[..., Awaitable[Any]],
    clear_tile_damage: Callable[..., list[dict[str, Any]]],
    schedule_world_save: Callable[..., Awaitable[Any]],
    sanitize_door: Callable[..., dict[str, int]],
    enforce_bedrock_under_door: Callable[..., bool],
    get_spawn_from_door: Callable[..., tuple[float, float]],
) -> None:
    global random  # ensure we always use module-level random rather than any accidental local binding
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
        teleport_target = world["players"].get(teleport_player_id)
        if not teleport_target:
            continue

        try:
            teleport_x = float(teleport.get("x", teleport_target.get("x", 0)))
            teleport_y = float(teleport.get("y", teleport_target.get("y", 0)))
        except Exception:
            continue

        await teleport_player(
            world=world,
            player_id=teleport_player_id,
            x=teleport_x,
            y=teleport_y,
            broadcast_to_world=broadcast_to_world,
        )

    # handle weather change regardless of door movement
    weather_change = command_result.get("weather_change")
    if weather_change is not None:
        world["weather"] = int(weather_change)
        await broadcast_to_world(
            world,
            {
                "type": "weather_changed",
                "weather": int(weather_change),
            },
        )
        # Save only weather state, not door or tiles
        await schedule_world_save(world["name"], only_weather=True)
        # continue on so door_move might still be processed if present

    # handle manual event triggers
    event_trigger = command_result.get("event_trigger")
    if isinstance(event_trigger, dict):
        await apply_event_effects(
            world=world,
            event_trigger=event_trigger,
            websocket=websocket,
            ws_send=ws_send,
            broadcast_to_world=broadcast_to_world,
            choose_event_location=_choose_event_location,
            schedule_world_save=schedule_world_save,
            command_sender_original=command_sender_original,
        )

    door_move = command_result.get("door_move")
    if not isinstance(door_move, dict):
        return

    width = int(world["width"])
    height = int(world["height"])
    try:
        next_door_x = int(door_move.get("x", 0))
        next_door_y = int(door_move.get("y", 0))
    except Exception:
        next_door_x = 0
        next_door_y = 0

    next_door_x = max(0, min(width - 1, next_door_x))
    next_door_y = max(0, min(height - 1, next_door_y))

    previous_door = sanitize_door(world.get("door"), width, height)
    world["door"] = {"x": next_door_x, "y": next_door_y}
    current_door = sanitize_door(world.get("door"), width, height)

    changed_tiles: set[tuple[int, int]] = set()
    for door_pos in (previous_door, current_door):
        changed_tiles.add((door_pos["x"], door_pos["y"]))
        floor_y = door_pos["y"] + 1
        if 0 <= floor_y < height:
            changed_tiles.add((door_pos["x"], floor_y))

    enforce_bedrock_under_door(world, previous_door=previous_door)

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
        changed_index = changed_y * width + changed_x
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

    spawn_x, spawn_y = get_spawn_from_door(world)
    for target_player_id in world["players"].keys():
        if target_player_id == client_id:
            continue

        await teleport_player(
            world=world,
            player_id=target_player_id,
            x=spawn_x,
            y=spawn_y,
            broadcast_to_world=broadcast_to_world,
        )

    caller_player = world["players"].get(client_id)
    if caller_player is None or command_sender_original is None:
        return

    await teleport_player(
        world=world,
        player_id=client_id,
        x=command_sender_original[0],
        y=command_sender_original[1],
        broadcast_to_world=broadcast_to_world,
    )
