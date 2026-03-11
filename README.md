# Pixelverse Web

multiplayer 2D build/break game using a custom canvas engine and a Python backend.

## Features

- Build and break blocks in a 2D tile world
- Multi-page flow: Main page → Login/Register page → World Selection page → Game page
- Join any world by name from the world selection screen
- Real-time multiplayer (players in same world see each other + tile updates)
- Custom client-side rendering/loop (no game framework)
- **Atlas texture variants** – blocks can specify multiple atlas rectangles and the engine
  picks one deterministically per‑tile, reducing visual repetition.  Variants can be
  edited in the atlas editor alongside the existing animation frame support.
- **Weather editor** – define multi‑layered world weather with parallax,
  scrolling and looping effects using a new web UI (`/weather-editor.html`).
  The editor now supports a global background color and layers that can be
  simple solid fills or basic shapes (rectangles/circles) in addition to atlas
  textures.  Backgrounds are identified by their own `BACKGROUND_ID` field.
- Persistent world and user data in SQLite (`data/db/game.db`)
- If a world does not exist, it is created automatically when entered
- Chat command `/weather <id>` lets a player set the current world's weather ID; the value is saved per-world and survives restarts

## Run

1. Install dependencies:

   ```bash
   py -m pip install -r requirements.txt
   ```

2. Start server:

   ```bash
   py app.py
   ```

   Or on Windows:

   ```bat
   install.bat
   start.bat
   ```

3. Open:

   ```
   http://localhost:3000
   ```

4. Open the URL in multiple tabs/devices and join the same world name.

## Database

- World and account data are saved in `data/db/game.db`.
- Worlds persist after server restart.
- Users can register/login and then enter worlds.

## Next steps you can add

- Collision and gravity/jumping
- Inventory and block types
- Per-user inventory slot limit (debug-adjustable and purchasable with gems, stored in DB)
- World persistence to a database
- Authentication and anti-cheat server validation
- Private/public world permissions
