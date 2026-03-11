from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"

GAME_JS = PUBLIC / "game.js"
CONSTANTS_JS = PUBLIC / "game" / "constants.js"
SESSION_JS = PUBLIC / "game" / "session.js"
GEMS_JS = PUBLIC / "game" / "gems.js"
HUD_JS = PUBLIC / "game" / "hud.js"
CHAT_DEBUG_JS = PUBLIC / "game" / "chat_debug.js"
CHAT_BUBBLES_JS = PUBLIC / "game" / "chat_bubbles.js"
PAUSE_MENU_JS = PUBLIC / "game" / "pause_menu.js"
INPUT_CONTROLLER_JS = PUBLIC / "game" / "input_controller.js"
WORLD_DROPS_JS = PUBLIC / "game" / "world_drops.js"
DAMAGE_OVERLAY_JS = PUBLIC / "game" / "damage_overlay.js"
PHYSICS_JS = PUBLIC / "game" / "physics.js"
WORLD_RENDER_JS = PUBLIC / "game" / "world_render.js"
ASSETS_LOADER_JS = PUBLIC / "game" / "assets_loader.js"
NETWORK_CLIENT_JS = PUBLIC / "game" / "network_client.js"
AUTH_WORLD_FLOW_JS = PUBLIC / "game" / "auth_world_flow.js"

# newly extracted modules
STATE_JS = PUBLIC / "game" / "state.js"
UTILS_JS = PUBLIC / "game" / "utils.js"
INVENTORY_JS = PUBLIC / "game" / "inventory.js"
WORLD_UTILS_JS = PUBLIC / "game" / "world_utils.js"

OUT_JS = PUBLIC / "build" / "game.bundle.js"


def strip_exports(source: str) -> str:
    return re.sub(r"(?m)^\s*export\s+", "", source)


def strip_imports(source: str) -> str:
    # constants may be imported from either "./game/constants.js" or "./constants.js"
    source = re.sub(
        r"(?ms)^\s*import\s*\{.*?\}\s*from\s*\"\.\/(?:game\/)?constants\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*\{.*?\}\s*from\s*\"\.\/game\/session\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*\{.*?\}\s*from\s*\"\.\/game\/gems\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*\{.*?\}\s*from\s*\"\.\/game\/hud\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*\{.*?\}\s*from\s*\"\.\/game\/chat_debug\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*\{.*?\}\s*from\s*\"\.\/game\/chat_bubbles\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*\{.*?\}\s*from\s*\"\.\/game\/pause_menu\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*\{.*?\}\s*from\s*\"\.\/game\/input_controller\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*\{.*?\}\s*from\s*\"\.\/game\/world_drops\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*\{.*?\}\s*from\s*\"\.\/game\/damage_overlay\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*\{.*?\}\s*from\s*\"\.\/game\/physics\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*\{.*?\}\s*from\s*\"\.\/game\/world_render\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*\{.*?\}\s*from\s*\"\.\/game\/assets_loader\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*\{.*?\}\s*from\s*\"\.\/game\/network_client\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*\{.*?\}\s*from\s*\"\.\/game\/auth_world_flow\.js\";\s*",
        "",
        source,
    )
    # remove imports of newly added utility modules
    # remove imports of newly added utility modules (both /game/ and local relative)
    source = re.sub(
        r"(?ms)^\s*import\s*(?:\{.*?\}|\*\s*as\s*\w+)\s*from\s*\"\.\/(?:game\/)?state\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*(?:\{.*?\}|\*\s*as\s*\w+)\s*from\s*\"\.\/(?:game\/)?utils\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*(?:\{.*?\}|\*\s*as\s*\w+)\s*from\s*\"\.\/(?:game\/)?inventory\.js\";\s*",
        "",
        source,
    )
    source = re.sub(
        r"(?ms)^\s*import\s*(?:\{.*?\}|\*\s*as\s*\w+)\s*from\s*\"\.\/(?:game\/)?world_utils\.js\";\s*",
        "",
        source,
    )
    return source


def main() -> None:
    def read_module(path):
        src = path.read_text(encoding="utf-8")
        # capture exported function names for certain modules so we can
        # re‑bundle them as an object named `utils` or `worldUtils`.
        names = []
        if path == UTILS_JS or path == WORLD_UTILS_JS:
            # find `export function foo` declarations
            names = re.findall(r"export\s+function\s+([A-Za-z0-9_]+)", src)
        stripped = strip_imports(strip_exports(src))
        if names:
            obj_name = "utils" if path == UTILS_JS else "worldUtils"
            stripped += "\nconst %s = { %s };" % (obj_name, ", ".join(names))
        return stripped

    constants = read_module(CONSTANTS_JS)
    session = read_module(SESSION_JS)
    gems = read_module(GEMS_JS)
    # include state and utils early as many modules depend on them
    state_mod = read_module(STATE_JS)
    utils = read_module(UTILS_JS)
    hud = read_module(HUD_JS)
    chat_debug = strip_exports(CHAT_DEBUG_JS.read_text(encoding="utf-8")).strip()
    chat_bubbles = read_module(CHAT_BUBBLES_JS)
    pause_menu = read_module(PAUSE_MENU_JS)
    inventory = read_module(INVENTORY_JS)
    world_utils = read_module(WORLD_UTILS_JS)
    input_controller = read_module(INPUT_CONTROLLER_JS)
    world_drops = read_module(WORLD_DROPS_JS)
    damage_overlay = read_module(DAMAGE_OVERLAY_JS)
    physics = read_module(PHYSICS_JS)
    world_render = read_module(WORLD_RENDER_JS)
    assets_loader = read_module(ASSETS_LOADER_JS)
    network_client = read_module(NETWORK_CLIENT_JS)
    auth_world_flow = read_module(AUTH_WORLD_FLOW_JS)
    game = strip_imports(strip_exports(GAME_JS.read_text(encoding="utf-8"))).strip()

    output = "\n\n".join(
        [
            "/* Auto-generated by scripts/build_bundle.py. Do not edit directly. */",
            constants,
            session,
            gems,
            state_mod,
            utils,
            hud,
            chat_debug,
            chat_bubbles,
            pause_menu,
            inventory,
            world_utils,
            input_controller,
            world_drops,
            damage_overlay,
            physics,
            world_render,
            assets_loader,
            network_client,
            auth_world_flow,
            game,
            "",
        ]
    )

    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.write_text(output, encoding="utf-8")
    print(f"Wrote {OUT_JS}")


if __name__ == "__main__":
    main()
