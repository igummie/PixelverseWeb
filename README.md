# Pixelverse Web

multiplayer 2D build/break game using a custom canvas engine and a Python backend.

## Features

- Build and break blocks in a 2D tile world
- Multi-page flow: Main page → Login/Register page → World Selection page → Game page
- Join any world by name from the world selection screen
- Real-time multiplayer (players in same world see each other + tile updates)
- Custom client-side rendering/loop (no game framework)
- Persistent world and user data in SQLite (`data/db/game.db`)
- If a world does not exist, it is created automatically when entered

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
- World persistence to a database
- Authentication and anti-cheat server validation
- Private/public world permissions
