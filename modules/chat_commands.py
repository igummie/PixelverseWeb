from __future__ import annotations

from typing import Any
from modules import world_utils
from modules.events import trigger_event


COMMAND_HELP = "Commands: /noclip, /fly, /pull <user>, /to <user>, /door <x> <y>, /weather <id>, /event <id>"


def _normalize_name(value: Any) -> str:
    return str(value or "").strip().lower()


def _clamp_position(world: dict[str, Any], x: float, y: float) -> tuple[float, float]:
    max_x = max(0.0, float(world["width"]) - 1.0)
    max_y = max(0.0, float(world["height"]) - 1.0)
    clamped_x = max(0.0, min(max_x, float(x)))
    clamped_y = max(0.0, min(max_y, float(y)))
    return clamped_x, clamped_y


def _find_player(world: dict[str, Any], query: str) -> tuple[str | None, dict[str, Any] | None, str | None]:
    target_name = _normalize_name(query)
    if not target_name:
        return None, None, "Usage: /pull <user> or /to <user>"

    players = world.get("players", {})
    exact_matches: list[tuple[str, dict[str, Any]]] = []
    prefix_matches: list[tuple[str, dict[str, Any]]] = []

    for player_id, player in players.items():
        username = _normalize_name(player.get("username", ""))
        if not username:
            continue

        if username == target_name:
            exact_matches.append((player_id, player))
        elif username.startswith(target_name):
            prefix_matches.append((player_id, player))

    if len(exact_matches) == 1:
        return exact_matches[0][0], exact_matches[0][1], None

    if len(exact_matches) > 1:
        return None, None, "Multiple exact user matches found."

    if len(prefix_matches) == 1:
        return prefix_matches[0][0], prefix_matches[0][1], None

    if len(prefix_matches) > 1:
        return None, None, "Name is ambiguous. Be more specific."

    return None, None, f"User '{query}' not found in this world."


def process_chat_command(
    *,
    raw_message: str,
    client_id: str,
    client_username: str,
    world: dict[str, Any],
) -> dict[str, Any] | None:
    text = str(raw_message or "").strip()
    if not text.startswith("/"):
        return None

    parts = text[1:].split()
    if not parts:
        return {
            "sender_message": COMMAND_HELP,
            "direct_messages": [],
            "teleports": [],
            "state_update": None,
        }

    command = parts[0].lower()
    args = parts[1:]

    if command == "?":
        return {
            "sender_message": COMMAND_HELP,
            "direct_messages": [],
            "teleports": [],
            "state_update": None,
        }

    player = world.get("players", {}).get(client_id)
    if not player:
        return {
            "sender_message": "You are not in a world.",
            "direct_messages": [],
            "teleports": [],
            "state_update": None,
        }

    if command == "noclip":
        noclip_enabled = not bool(player.get("noclip_enabled", False))
        # Noclip movement relies on fly controls on the client, so toggle both together.
        fly_enabled = noclip_enabled
        player["fly_enabled"] = fly_enabled
        player["noclip_enabled"] = noclip_enabled
        return {
            "sender_message": "Noclip enabled. Flying enabled."
            if noclip_enabled
            else "Noclip disabled. Flying disabled.",
            "direct_messages": [],
            "teleports": [],
            "state_update": {
                "id": client_id,
                "flyEnabled": fly_enabled,
                "noclipEnabled": noclip_enabled,
            },
        }

    if command == "fly":
        fly_enabled = not bool(player.get("fly_enabled", False))
        player["fly_enabled"] = fly_enabled

        noclip_enabled = bool(player.get("noclip_enabled", False))
        if not fly_enabled and noclip_enabled:
            # Noclip cannot function with fly disabled.
            noclip_enabled = False
            player["noclip_enabled"] = False

        return {
            "sender_message": "Flying enabled." if fly_enabled else "Flying disabled.",
            "direct_messages": [],
            "teleports": [],
            "state_update": {
                "id": client_id,
                "flyEnabled": fly_enabled,
                "noclipEnabled": noclip_enabled,
            },
        }

    if command in {"pull", "to"}:
        target_query = " ".join(args).strip()
        target_id, target_player, target_error = _find_player(world, target_query)
        if target_error or not target_id or not target_player:
            return {
                "sender_message": target_error or "Target player not found.",
                "direct_messages": [],
                "teleports": [],
                "state_update": None,
            }

        sender_x = float(player.get("x", 0.0))
        sender_y = float(player.get("y", 0.0))
        target_x = float(target_player.get("x", 0.0))
        target_y = float(target_player.get("y", 0.0))

        if command == "pull":
            next_x, next_y = _clamp_position(world, sender_x, sender_y)
            target_player["x"] = next_x
            target_player["y"] = next_y
            return {
                "sender_message": f"Pulled {target_player.get('username', 'player')}.",
                "direct_messages": [
                    {
                        "target_id": target_id,
                        "message": f"{client_username} pulled you.",
                    }
                ],
                "teleports": [{"id": target_id, "x": next_x, "y": next_y}],
                "state_update": None,
            }

        next_x, next_y = _clamp_position(world, target_x, target_y)
        player["x"] = next_x
        player["y"] = next_y
        return {
            "sender_message": f"Teleported to {target_player.get('username', 'player')}.",
            "direct_messages": [],
            "teleports": [{"id": client_id, "x": next_x, "y": next_y}],
            "state_update": None,
        }

    if command == "weather":
        # change the weather ID for the current world and persist it
        if len(args) != 1:
            return {
                "sender_message": "Usage: /weather <id>",
                "direct_messages": [],
                "teleports": [],
                "state_update": None,
            }
        try:
            new_weather = int(args[0])
        except Exception:
            return {
                "sender_message": "Weather must be an integer ID. Usage: /weather <id>",
                "direct_messages": [],
                "teleports": [],
                "state_update": None,
            }

        # update the in‑memory world value; command_runtime will handle persistence
        world["weather"] = new_weather
        return {
            "sender_message": f"Weather set to {new_weather}.",
            "direct_messages": [],
            "teleports": [],
            "state_update": None,
            "weather_change": new_weather,
        }

    if command == "event":
        if len(args) != 1:
            return {
                "sender_message": "Usage: /event <id>",
                "direct_messages": [],
                "teleports": [],
                "state_update": None,
            }
        try:
            eid = int(args[0])
        except Exception:
            return {
                "sender_message": "Event id must be an integer. Usage: /event <id>",
                "direct_messages": [],
                "teleports": [],
                "state_update": None,
            }
        ev = trigger_event(world, eid)
        if not ev:
            return {
                "sender_message": f"Event {eid} not found or not enabled.",
                "direct_messages": [],
                "teleports": [],
                "state_update": None,
            }
        return {
            "sender_message": f"Triggered event {eid}.",
            "direct_messages": [],
            "teleports": [],
            "state_update": None,
            "event_trigger": ev,
        }

    if command in {"door", "movedoor"}:
        if len(args) != 2:
            return {
                "sender_message": "Usage: /door <x> <y>",
                "direct_messages": [],
                "teleports": [],
                "state_update": None,
            }

        try:
            next_door_x = int(args[0])
            next_door_y = int(args[1])
        except Exception:
            return {
                "sender_message": "Door coordinates must be integers. Usage: /door <x> <y>",
                "direct_messages": [],
                "teleports": [],
                "state_update": None,
            }

        max_x = max(0, int(world["width"]) - 1)
        max_y = max(0, int(world["height"]) - 1)
        clamped_x = max(0, min(max_x, next_door_x))
        clamped_y = max(0, min(max_y, next_door_y))

        return {
            "sender_message": f"Door moved to ({clamped_x}, {clamped_y}).",
            "direct_messages": [],
            "teleports": [],
            "state_update": None,
            "door_move": {
                "x": clamped_x,
                "y": clamped_y,
            },
        }

    return {
        "sender_message": f"Unknown command '/{command}'. {COMMAND_HELP}",
        "direct_messages": [],
        "teleports": [],
        "state_update": None,
    }
