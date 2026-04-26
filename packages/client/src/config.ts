const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;

export const MULTIPLAYER_ENABLED = params?.get("mp") === "1";
export const MULTIPLAYER_HASH_DEBUG = params?.get("hash") === "1";
export const MULTIPLAYER_INPUT_DELAY_TICKS = 3;
