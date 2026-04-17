/**
 * Daily Challenge — seeded PRNG and date utilities.
 * Every player gets the same procedurally-generated world for a given day.
 */

/**
 * mulberry32 — fast, deterministic, good distribution.
 * Returns a function that behaves like Math.random() (returns [0, 1))
 * but is fully deterministic for the same seed.
 */
export function createSeededRNG(seed: number): () => number {
  let s = seed >>> 0; // force unsigned 32-bit
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert a date string like "2026-04-17" to a numeric seed.
 * Uses a simple hash of the string for good dispersion across days.
 */
export function dateSeed(dateStr?: string): number {
  const str = dateStr ?? todayUTC();
  let hash = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0; // unsigned 32-bit
}

/**
 * Get today's date string in UTC (YYYY-MM-DD).
 */
export function todayUTC(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Format a date string like "2026-04-17" to "April 17, 2026".
 */
export function formatDateLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Get a daily challenge descriptor for UI display.
 */
export function getDailyInfo(): {
  dateStr: string;
  seed: number;
  label: string;
  nextResetMs: number;
} {
  const dateStr = todayUTC();
  const seed = dateSeed(dateStr);
  const label = formatDateLabel(dateStr);

  // ms until next midnight UTC
  const now = new Date();
  const nextMidnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  const nextResetMs = nextMidnight.getTime() - now.getTime();

  return { dateStr, seed, label, nextResetMs };
}

/**
 * Format milliseconds to HH:MM:SS countdown string.
 */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Daily best localStorage key for a given date string.
 */
export function dailyBestKey(dateStr: string): string {
  return `shatterDriftDailyBest_${dateStr}`;
}

/**
 * Get the daily best score for a given date, or null if not played.
 */
export function getDailyBest(dateStr: string): { score: number; grade: string } | null {
  try {
    const raw = localStorage.getItem(dailyBestKey(dateStr));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save the daily best score for a given date.
 */
export function saveDailyBest(dateStr: string, score: number, grade: string) {
  const existing = getDailyBest(dateStr);
  if (existing && existing.score >= score) return; // don't overwrite with worse score
  localStorage.setItem(dailyBestKey(dateStr), JSON.stringify({ score, grade }));
}
