const AUTH_TOKEN_STORAGE_KEY = "pixelverse_auth_token";
const AUTH_USER_STORAGE_KEY = "pixelverse_auth_user";
const GUEST_DEVICE_STORAGE_KEY = "pixelverse_guest_device_id";
const GUEST_DEVICE_ID_REGEX = /^[a-z0-9_-]{12,128}$/;

export function saveAuthSession(token, user) {
  if (!token || !user) {
    return;
  }

  try {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
  }
}

export function clearAuthSession() {
  try {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  } catch {
  }
}

export function loadAuthSession() {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    const userRaw = localStorage.getItem(AUTH_USER_STORAGE_KEY);
    if (!token || !userRaw) {
      return null;
    }

    const user = JSON.parse(userRaw);
    if (!user || typeof user.username !== "string") {
      return null;
    }

    return { token, user };
  } catch {
    return null;
  }
}

export function isGuestUser(user) {
  if (!user) {
    return false;
  }

  const id = Number(user.id);
  if (Number.isFinite(id) && id < 0) {
    return true;
  }

  return String(user.username || "").toLowerCase().startsWith("guest_");
}

function createGuestDeviceId() {
  try {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID().replaceAll("-", "").toLowerCase();
    }

    const bytes = new Uint8Array(16);
    window.crypto?.getRandomValues?.(bytes);
    const hasEntropy = bytes.some((value) => value !== 0);
    if (hasEntropy) {
      return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    }
  } catch {
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 16)}`.toLowerCase();
}

export function getGuestDeviceId() {
  try {
    const existing = (localStorage.getItem(GUEST_DEVICE_STORAGE_KEY) || "").trim().toLowerCase();
    if (GUEST_DEVICE_ID_REGEX.test(existing)) {
      return existing;
    }

    const created = createGuestDeviceId();
    localStorage.setItem(GUEST_DEVICE_STORAGE_KEY, created);
    return created;
  } catch {
    return createGuestDeviceId();
  }
}
