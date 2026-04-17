/**
 * Lightweight global leaderboard — no SDK, just fetch().
 * Scores stored on tommyato's droplet.
 */

const API_URL = "https://api.tommyato.com";

export interface LeaderboardEntry {
  name: string;
  score: number;
  distance: number;
  grade: string;
  biome: string;
  ts: number;
}

export interface SubmitResult {
  rank: number;
  total: number;
}

export interface LeaderboardOptions {
  mode?: "daily";
  date?: string; // YYYY-MM-DD
}

/** Get the player's saved name */
export function getPlayerName(): string {
  return localStorage.getItem("shatterDriftName") || "";
}

/** Save the player's name */
export function setPlayerName(name: string) {
  localStorage.setItem("shatterDriftName", name.slice(0, 16));
}

/** Fetch top scores. Pass options for daily mode: { mode: "daily", date: "YYYY-MM-DD" } */
export async function fetchLeaderboard(limit = 10, options?: LeaderboardOptions): Promise<LeaderboardEntry[]> {
  try {
    let url = `${API_URL}/scores?limit=${limit}`;
    if (options?.mode) url += `&mode=${options.mode}`;
    if (options?.date) url += `&date=${options.date}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.scores || [];
  } catch {
    return [];
  }
}

/** Submit a score, returns rank or null on failure. Pass options for daily mode. */
export async function submitScore(
  entry: {
    name: string;
    score: number;
    distance: number;
    grade: string;
    biome: string;
  },
  options?: LeaderboardOptions
): Promise<SubmitResult | null> {
  try {
    const body = options ? { ...entry, ...options } : entry;
    const res = await fetch(`${API_URL}/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// --- Ghost racing ---

import type { GhostFrame, GhostRecord } from "./ghost";

/** Fetch up to N top-ranked ghost recordings. Silent on failure. */
export async function fetchGhosts(limit = 3): Promise<GhostRecord[]> {
  try {
    const res = await fetch(`${API_URL}/ghosts?limit=${limit}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.ghosts || []) as GhostRecord[];
  } catch {
    return [];
  }
}

/** Upload a ghost recording tied to a just-finished run. Returns ghost id or null. */
export async function submitGhost(entry: {
  name: string;
  score: number;
  distance: number;
  grade: string;
  frames: GhostFrame[];
}): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/ghosts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.id || null;
  } catch {
    return null;
  }
}

/** Fetch current score threshold (top N cutoff) so client can decide whether to upload a ghost. */
export async function fetchGhostUploadThreshold(): Promise<number> {
  try {
    const scores = await fetchLeaderboard(20);
    if (scores.length < 10) return 0; // not enough data, upload anything
    // Upload if we're in the top 50% of the leaderboard.
    const sorted = scores.slice().sort((a, b) => b.score - a.score);
    const idx = Math.max(0, Math.floor(sorted.length / 2) - 1);
    return sorted[idx]?.score || 0;
  } catch {
    return 0;
  }
}
