const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;

// MP is on by default for shipped builds (Vibe Jam 2026 differentiator).
// `?mp=0` kill-switches it (hide button, skip Colyseus init) if the
// server is degraded or for clean single-player smoke runs.
export const MULTIPLAYER_ENABLED = params?.get("mp") !== "0";
export const MULTIPLAYER_HASH_DEBUG = params?.get("hash") === "1";
export const MULTIPLAYER_INPUT_DELAY_TICKS = 3;
/** Dev hook: when `?mp_auto=1`, the client calls LobbyClient.quickMatch on boot. Used by the puppeteer smoke. */
export const MULTIPLAYER_AUTO_QUICKMATCH = params?.get("mp_auto") === "1";

/**
 * URL of the Colyseus match server. Defaults to the public droplet endpoint;
 * `?mp_url=ws://localhost:2568` (or VITE_SD_MP_URL env at build time) lets
 * developers point at a local server for two-tab smoke testing.
 *
 * Resolution order: `?mp_url=` query param → `VITE_SD_MP_URL` env at build →
 * production default.
 */
declare const __SD_MP_URL__: string | undefined;
export const SD_MP_URL =
  params?.get("mp_url") ||
  (typeof __SD_MP_URL__ !== "undefined" && __SD_MP_URL__) ||
  "wss://sd-mp.tommyato.com";
