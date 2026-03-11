export const TILE_SIZE = 32;
export const HORIZONTAL_SPEED = 7.5;
export const GRAVITY = 28;
export const JUMP_SPEED = 11;
export const MAX_FALL_SPEED = 24;
export const EPSILON = 0.0001;
export const MIN_CAMERA_ZOOM = 0.5;
export const MAX_CAMERA_ZOOM = 3;
export const CAMERA_ZOOM_STEP = 0.1;
export const REMOTE_PLAYER_INTERP_SPEED = 14;
export const REMOTE_PLAYER_SNAP_DISTANCE = 2.5;
export const REMOTE_PLAYER_EXTRAPOLATE_BASE_MS = 65;
export const REMOTE_PLAYER_EXTRAPOLATE_MAX_MS = 220;
export const REMOTE_PLAYER_MAX_EXTRAPOLATE_SPEED = 12;
export const SELF_TELEPORT_SNAP_DISTANCE = 0.75;
export const SELF_RECONCILE_SNAP_DISTANCE = 2.25;
export const CHAT_BUBBLE_LIFETIME_MS = 4500;
export const CHAT_BUBBLE_FADE_MS = 1700;
export const LEAVE_TEXT_FADE_MS = 4000;
export const MAX_CHAT_LOG_LINES = 180;
export const CHAT_LOG_DRAWER_HEIGHT = 220;
export const CHAT_INPUT_PANEL_HEIGHT = 56;
export const CHAT_DRAWER_HANDLE_PEEK = 16;
export const INVENTORY_DRAWER_HEIGHT = 248;
export const INVENTORY_DRAWER_HANDLE_PEEK = 16;
export const INVENTORY_GRID_COLUMNS = 20; /* default columns used for some UI logic */
export const INVENTORY_GRID_SLOTS = 20; /* initial slot limit before server override */
export const CRACK_ATLAS_SRC = "/assets/atlases/cracks_atlas.svg";
export const CRACK_ATLAS_COLUMNS = 4;
export const CRACK_ATLAS_ROWS = 1;
export const GEM_ATLAS_ID = "gems";
export const GEM_TILE_SIZE = 16;
export const GEM_BOB_BASE_AMPLITUDE_PX = 1.4;
export const GEM_BOB_AMPLITUDE_VARIANCE_PX = 1.1;
export const GEM_BOB_BASE_SPEED = 0.0015;
export const GEM_BOB_SPEED_VARIANCE = 0.002;
export const DEBUG_PING_INTERVAL_MS = 2000;
export const DEBUG_INFO_REFRESH_MS = 120;
export const GEM_VALUE_TO_FRAME = {
  1: 0,
  5: 1,
  10: 2,
  50: 3,
  100: 4,
};

export const TEXTURE47_COLS = 8;
export const TEXTURE47_ROWS = 6;
export const DEFAULT_TEXTURE47_VALID_MASKS = [
  255, 248, 31, 115, 206, 112, 200, 19, 14, 66, 64, 2, 0, 251, 254, 127, 223, 250, 95, 123,
  222, 219, 126, 94, 91, 218, 122, 90, 24, 16, 8, 114, 83, 82, 202, 78, 74, 120, 216, 88, 27,
  30, 26, 18, 10, 80, 72, 255,
];
