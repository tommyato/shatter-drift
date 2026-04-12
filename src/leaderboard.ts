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

/** Get the player's saved name */
export function getPlayerName(): string {
  return localStorage.getItem("shatterDriftName") || "";
}

/** Save the player's name */
export function setPlayerName(name: string) {
  localStorage.setItem("shatterDriftName", name.slice(0, 16));
}

/** Fetch top scores */
export async function fetchLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  try {
    const res = await fetch(`${API_URL}/scores?limit=${limit}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.scores || [];
  } catch {
    return [];
  }
}

/** Submit a score, returns rank or null on failure */
export async function submitScore(entry: {
  name: string;
  score: number;
  distance: number;
  grade: string;
  biome: string;
}): Promise<SubmitResult | null> {
  try {
    const res = await fetch(`${API_URL}/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
