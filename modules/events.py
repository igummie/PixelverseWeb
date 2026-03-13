from __future__ import annotations

import asyncio
import json
import random
import time
from pathlib import Path
from typing import Any, Callable, Dict, Awaitable

from modules.world_utils import spawn_gem_drops, spawn_pinata


# path must be set by the importing application (typically app.py)
EVENTS_PATH: Path | None = None


def load_events_payload() -> Dict[str, Any]:
    """Load the payload from events.json.

    The structure is expected to be {"events": [...]} with arbitrary additional
    metadata. The loader preserves unknown metadata but omits VERSION.
    """
    try:
        with EVENTS_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return {"events": []}

    if not isinstance(payload, dict):
        return {"events": []}

    events = payload.get("events", [])
    output: Dict[str, Any] = {"events": events if isinstance(events, list) else []}

    for key, value in payload.items():
        if key in {"events", "VERSION"}:
            continue
        output[key] = value

    return output


def trigger_event(world: dict[str, Any], event_id: int) -> dict[str, Any] | None:
    """Attempt to trigger the event with *event_id* in *world*.

    This is a light helper that looks up the event definition and stores it
    on the world under ``last_event``. It does not perform any side effects;
    the caller should broadcast or act on the event.
    """
    payload = load_events_payload()
    events = payload.get("events", []) if isinstance(payload, dict) else []
    for ev in events:
        try:
            eid = int(ev.get("EVENT_ID", ev.get("ID", -1)))
        except Exception:
            continue
        if eid != event_id:
            continue
        if not ev.get("ENABLED", True):
            return None
        world["last_event"] = ev.copy()
        return ev.copy()
    return None


async def apply_event_effects(
    *,
    world: dict[str, Any],
    event_trigger: dict[str, Any],
    websocket: Any,
    ws_send: Callable[..., Awaitable[Any]],
    broadcast_to_world: Callable[..., Awaitable[Any]],
    choose_event_location: Callable[[dict[str, Any], str], tuple[int, int]],
    schedule_world_save: Callable[[str, bool], Awaitable[None]],
    command_sender_original: tuple[float, float] | None = None,
) -> None:
    """Perform side effects for a triggered event.

    This includes broadcasting the event, spawning gems/pinatas, and persisting
    world state as needed.
    """
    # store and broadcast event data
    world["last_event"] = event_trigger
    await broadcast_to_world(
        world,
        {
            "type": "event_triggered",
            "event": event_trigger,
        },
    )

    etype = str(event_trigger.get("TYPE", "")).upper()
    if etype == "GEM":
        # spawn gems according to the event definition
        try:
            min_amt = int(event_trigger.get("GEM_COUNT_MIN", 0))
        except Exception:
            min_amt = 0
        try:
            max_amt = int(event_trigger.get("GEM_COUNT_MAX", 0))
        except Exception:
            max_amt = min_amt
        if max_amt < min_amt:
            max_amt = min_amt
        total = 0
        if max_amt > min_amt:
            total = random.randint(min_amt, max_amt)
        else:
            total = min_amt

        if total > 0:
            # support timed distribution if duration/interval supplied
            try:
                duration = float(event_trigger.get("GEM_DURATION", 0))
            except Exception:
                duration = 0
            try:
                interval = float(event_trigger.get("GEM_INTERVAL", 1))
            except Exception:
                interval = 1

            async def spread_task(total_amount: int) -> None:
                remaining = total_amount
                start = time.monotonic()
                end = start + duration if duration > 0 else float("inf")
                while remaining > 0 and time.monotonic() < end:
                    # pick count proportional to time left
                    if duration > 0:
                        ticks_left = max(1, int((end - time.monotonic()) / interval))
                        to_spawn = max(1, remaining // ticks_left)
                    else:
                        to_spawn = remaining
                    # choose location based on mode
                    mode = str(event_trigger.get("SPAWN_MODE", "any")).lower()
                    tx, ty = choose_event_location(world, mode)
                    if mode == "player" and command_sender_original and isinstance(command_sender_original, (list, tuple)):
                        try:
                            tx = int(command_sender_original[0]); ty = int(command_sender_original[1])
                        except Exception:
                            pass
                    print(f"[event] [spread] spawning {to_spawn} gems at ({tx},{ty}) mode={mode}")
                    await ws_send(websocket, {"type": "system_message", "message": f"Spawning {to_spawn} gems at {tx},{ty} (mode {mode})"})
                    spawned = spawn_gem_drops(world, tx, ty, to_spawn)
                    for drop in spawned:
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
                    remaining -= to_spawn
                    if remaining <= 0:
                        break
                    await asyncio.sleep(interval)
            # kick off background task if duration specified
            if duration > 0:
                asyncio.create_task(spread_task(total))
            else:
                # immediate spawn
                mode = str(event_trigger.get("SPAWN_MODE", "any")).lower()
                tx, ty = choose_event_location(world, mode)
                if mode == "player" and command_sender_original and isinstance(command_sender_original, (list, tuple)):
                    try:
                        tx = int(command_sender_original[0]); ty = int(command_sender_original[1])
                    except Exception:
                        pass
                print(f"[event] spawning {total} gems at ({tx},{ty}) mode={mode}")
                await ws_send(websocket, {"type": "system_message", "message": f"Spawning {total} gems at {tx},{ty} (mode {mode})"})
                spawned = spawn_gem_drops(world, tx, ty, total)
                for drop in spawned:
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

    elif etype == "PINATA":
        # spawn an interactive pinata rather than bursting immediately
        try:
            width = int(world.get("width", 0))
            height = int(world.get("height", 0))
        except Exception:
            width = height = 0

        # determine base coordinate, preferring sender location when provided
        base_x = base_y = None
        if command_sender_original and isinstance(command_sender_original, (list, tuple)):
            try:
                base_x = int(command_sender_original[0])
                base_y = int(command_sender_original[1])
            except Exception:
                base_x = base_y = None

        mode = str(event_trigger.get("SPAWN_MODE", "any")).lower()
        # allow pinata-specific "spawn above" to translate to above mode
        if bool(event_trigger.get("SPAWN_ABOVE", False)):
            mode = "above"

        if base_x is None or base_y is None:
            if width > 0 and height > 0:
                base_x = random.randrange(width)
                base_y = random.randrange(height)
            else:
                base_x = base_y = 0

        if mode != "player":
            base_x, base_y = choose_event_location(world, mode)

        strength = int(event_trigger.get("STRENGTH", 1))
        atlas = str(event_trigger.get("TEXTURE_ATLAS", ""))
        rect = str(event_trigger.get("TEXTURE_RECT", ""))
        burst_mode = str(event_trigger.get("BURST_MODE", "area"))
        try:
            burst_radius = int(event_trigger.get("BURST_RADIUS", 0))
        except Exception:
            burst_radius = 0
        burst_items = event_trigger.get("BURST_ITEMS", [])
        if not isinstance(burst_items, list):
            burst_items = []

        # (timeout computed above)
        # compute timeout before spawning so variable is defined
        try:
            timeout = float(event_trigger.get("TIMEOUT", 0))
        except Exception:
            timeout = 0

        pinata = spawn_pinata(
            world,
            base_x,
            base_y,
            strength=strength,
            atlas=atlas,
            rect=rect,
            spawn_mode=mode,
            timeout=timeout,
            burst_mode=burst_mode,
            burst_radius=burst_radius,
            burst_items=burst_items,
        )

        # handle expiration task using same timeout variable
        if timeout > 0:
            async def expire_pinata(pinata_id: str, delay: float) -> None:
                await asyncio.sleep(delay)
                pinatas = world.get("pinatas") or {}
                if pinata_id in pinatas:
                    pinatas.pop(pinata_id, None)
                    await broadcast_to_world(world, {"type": "pinata_remove", "id": pinata_id})
                    await schedule_world_save(world["name"])
            asyncio.create_task(expire_pinata(pinata["id"], timeout))

        print(f"[event] spawned pinata {pinata['id']} at ({base_x},{base_y}) str={strength} mode={mode}")
        await ws_send(websocket, {"type": "system_message", "message": f"Spawned pinata at {base_x},{base_y} (mode {mode})"})
        # clients will handle rendering via pinata_spawn message
        await broadcast_to_world(world, {"type": "pinata_spawn", "pinata": pinata})
        await schedule_world_save(world["name"])

    # persist full world state so last_event is saved
    await schedule_world_save(world["name"])
