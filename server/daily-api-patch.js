/**
 * Shatter Drift API server — full updated file.
 *
 * Deploy to /root/shatter-drift-api/index.js on the droplet (67.205.167.181).
 *
 * Routes:
 *   GET/POST  /scores                       (flat-file, SD only)
 *   GET/POST  /daily-scores                 (flat-file, SD only, per-day)
 *   GET/POST  /games/:gameId/ghosts         (SQLite, multi-game, canonical)
 *   GET/POST  /ghosts                       (DEPRECATED — thin alias for /games/shatter-drift/ghosts)
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Rate limiting — simple in-memory per-IP bucket
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX = 10; // max requests per window

const rateBuckets = new Map(); // ip => { count, windowStart }

function isRateLimited(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count > RATE_MAX;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClientIP(req) {
  return (
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

function sendJSON(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

// Ghost POSTs carry frame arrays — allow a much larger body than score POSTs.
const GHOST_BODY_MAX = 4 * 1024 * 1024; // 4 MiB

function readBody(req, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) reject(new Error("Body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseLimit(val, max = 100) {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < 1) return 10;
  return Math.min(n, max);
}

function validateDate(val) {
  if (!val || typeof val !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(val);
}

function sanitizeName(name) {
  if (typeof name !== "string") return "";
  return name.replace(/[^\w\s\-_.!]/g, "").slice(0, 16).trim() || "ANON";
}

const GAME_ID_RE = /^[a-z0-9-]{1,32}$/;
function isValidGameId(id) {
  return typeof id === "string" && GAME_ID_RE.test(id);
}

// ---------------------------------------------------------------------------
// Score file I/O (flat-file — /scores and /daily-scores only)
// ---------------------------------------------------------------------------

function scoresFile(name) {
  return path.join(DATA_DIR, name + ".json");
}

function readScores(filename) {
  try {
    const raw = fs.readFileSync(filename, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeScores(filename, scores) {
  fs.writeFileSync(filename, JSON.stringify(scores, null, 2), "utf8");
}

/** Keep top N scores, deduplicating by name (keep their best). */
function upsertScore(scores, entry, keepTop = 1000) {
  const idx = scores.findIndex((s) => s.name === entry.name);
  if (idx >= 0) {
    if (entry.score > scores[idx].score) {
      scores[idx] = entry;
    }
  } else {
    scores.push(entry);
  }
  scores.sort((a, b) => b.score - a.score);
  if (scores.length > keepTop) scores.length = keepTop;
  return scores;
}

function getRank(scores, name, score) {
  // Rank = position in the sorted list (1-indexed)
  const sorted = scores.slice().sort((a, b) => b.score - a.score);
  const pos = sorted.findIndex((s) => s.name === name && s.score === score);
  return pos === -1 ? sorted.length : pos + 1;
}

// ---------------------------------------------------------------------------
// SQLite ghost storage (multi-game, canonical)
// ---------------------------------------------------------------------------

const GHOSTS_DB_PATH = path.join(DATA_DIR, "ghosts.sqlite");
const ghostsDb = new Database(GHOSTS_DB_PATH);
ghostsDb.pragma("journal_mode = WAL");
ghostsDb.exec(`
  CREATE TABLE IF NOT EXISTS ghosts (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    name TEXT NOT NULL,
    score INTEGER NOT NULL,
    distance INTEGER NOT NULL DEFAULT 0,
    grade TEXT DEFAULT '',
    frames TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ghosts_game_score ON ghosts(game_id, score DESC);
`);

// Additive migration: add `seed` column for per-game tower-layout playback
// (CC needs it; SD ignores it). NULL on existing rows — clients fall back
// to their own default seed when the column is absent.
const ghostCols = ghostsDb.prepare(`PRAGMA table_info(ghosts)`).all();
if (!ghostCols.some((c) => c.name === "seed")) {
  ghostsDb.exec(`ALTER TABLE ghosts ADD COLUMN seed INTEGER`);
}

const GHOST_MAX_FRAMES = 18000; // ~5 min at 60fps
const GHOSTS_PER_GAME = 20;     // keep top N per game_id

const stmtInsertGhost = ghostsDb.prepare(`
  INSERT INTO ghosts (id, game_id, name, score, distance, grade, frames, ts, seed)
  VALUES (@id, @game_id, @name, @score, @distance, @grade, @frames, @ts, @seed)
`);
const stmtSelectTopGhosts = ghostsDb.prepare(`
  SELECT id, game_id, name, score, distance, grade, frames, ts, seed
  FROM ghosts
  WHERE game_id = ?
  ORDER BY score DESC, ts DESC
  LIMIT ?
`);
const stmtCountGhostsForGame = ghostsDb.prepare(`
  SELECT COUNT(*) AS n FROM ghosts WHERE game_id = ?
`);
const stmtDeleteOverflow = ghostsDb.prepare(`
  DELETE FROM ghosts
  WHERE game_id = ?
    AND id NOT IN (
      SELECT id FROM ghosts
      WHERE game_id = ?
      ORDER BY score DESC, ts DESC
      LIMIT ?
    )
`);

function rowToGhost(row) {
  let frames;
  try {
    frames = JSON.parse(row.frames);
  } catch {
    frames = [];
  }
  return {
    id: row.id,
    name: row.name,
    score: row.score,
    distance: row.distance,
    grade: row.grade,
    frames,
    ts: row.ts,
    // Pass through seed when the row has one (CC ghosts); omit for legacy rows
    // so clients can apply their own fallback (CHALLENGE_SEED for CC).
    ...(row.seed != null ? { seed: row.seed } : {}),
  };
}

function getTopGhosts(gameId, limit) {
  const rows = stmtSelectTopGhosts.all(gameId, limit);
  return rows.map(rowToGhost);
}

function insertGhostAndTrim(ghost, gameId) {
  // Single transaction: insert then prune overflow for this game_id.
  const tx = ghostsDb.transaction(() => {
    stmtInsertGhost.run({
      id: ghost.id,
      game_id: gameId,
      name: ghost.name,
      score: ghost.score,
      distance: ghost.distance,
      grade: ghost.grade,
      frames: JSON.stringify(ghost.frames),
      ts: ghost.ts,
      seed: ghost.seed,
    });
    stmtDeleteOverflow.run(gameId, gameId, GHOSTS_PER_GAME);
  });
  tx();
}

// ---------------------------------------------------------------------------
// One-time migration from legacy ghosts.json → sqlite (game_id='shatter-drift')
// ---------------------------------------------------------------------------

function migrateLegacyGhostsJson() {
  const legacyFile = scoresFile("ghosts");
  if (!fs.existsSync(legacyFile)) return;
  const existing = stmtCountGhostsForGame.get("shatter-drift").n;
  if (existing > 0) {
    console.log(
      `[ghosts] legacy ghosts.json found but SD already has ${existing} rows — leaving legacy file in place, skipping import.`,
    );
    return;
  }
  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
  } catch (err) {
    console.warn("[ghosts] legacy ghosts.json unreadable:", err.message);
    return;
  }
  if (!Array.isArray(legacy) || legacy.length === 0) {
    console.log("[ghosts] legacy ghosts.json is empty — nothing to migrate.");
  } else {
    const tx = ghostsDb.transaction((rows) => {
      for (const g of rows) {
        if (!g || typeof g !== "object") continue;
        const frames = Array.isArray(g.frames) ? g.frames : [];
        const id = typeof g.id === "string" && g.id
          ? g.id
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        stmtInsertGhost.run({
          id,
          game_id: "shatter-drift",
          name: sanitizeName(g.name),
          score: Math.round(Number(g.score) || 0),
          distance: Math.round(Number(g.distance) || 0),
          grade: typeof g.grade === "string" ? g.grade.slice(0, 4) : "",
          frames: JSON.stringify(frames),
          ts: Number.isFinite(g.ts) ? g.ts : Date.now(),
          seed: typeof g.seed === "number" && isFinite(g.seed) ? Math.trunc(g.seed) : null,
        });
      }
      stmtDeleteOverflow.run("shatter-drift", "shatter-drift", GHOSTS_PER_GAME);
    });
    try {
      tx(legacy);
      console.log(`[ghosts] migrated ${legacy.length} entries from ghosts.json → sqlite (game_id=shatter-drift).`);
    } catch (err) {
      console.warn("[ghosts] migration failed:", err.message);
      return;
    }
  }
  // Rename the legacy file so it's not re-imported. Idempotency guard above
  // also protects against re-runs, but renaming keeps DATA_DIR clean.
  const today = new Date().toISOString().slice(0, 10);
  const renamed = `${legacyFile}.migrated-${today}`;
  try {
    fs.renameSync(legacyFile, renamed);
    console.log(`[ghosts] renamed legacy file → ${path.basename(renamed)}`);
  } catch (err) {
    console.warn("[ghosts] failed to rename legacy file:", err.message);
  }
}

migrateLegacyGhostsJson();

// ---------------------------------------------------------------------------
// Score route handlers
// ---------------------------------------------------------------------------

// GET /scores?limit=N
function handleGetScores(req, res, params) {
  const limit = parseLimit(params.get("limit"), 100);
  const file = scoresFile("scores");
  const scores = readScores(file);
  scores.sort((a, b) => b.score - a.score);
  sendJSON(res, 200, { scores: scores.slice(0, limit) });
}

// POST /scores
async function handlePostScore(req, res) {
  const ip = getClientIP(req);
  if (isRateLimited(ip)) return sendJSON(res, 429, { error: "Rate limited" });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJSON(res, 400, { error: "Invalid JSON" });
  }

  const { name, score, distance, grade, biome } = body;
  if (
    typeof score !== "number" ||
    !isFinite(score) ||
    score < 0 ||
    score > 1e9
  ) {
    return sendJSON(res, 400, { error: "Invalid score" });
  }

  const entry = {
    name: sanitizeName(name),
    score: Math.round(score),
    distance: Math.round(distance) || 0,
    grade: typeof grade === "string" ? grade.slice(0, 4) : "",
    biome: typeof biome === "string" ? biome.slice(0, 32) : "",
    ts: Date.now(),
  };

  const file = scoresFile("scores");
  const scores = readScores(file);
  upsertScore(scores, entry);
  writeScores(file, scores);

  const rank = getRank(scores, entry.name, entry.score);
  sendJSON(res, 200, { rank, total: scores.length });
}

// GET /daily-scores?date=YYYY-MM-DD&limit=N
function handleGetDailyScores(req, res, params) {
  const date = params.get("date");
  if (!validateDate(date)) {
    return sendJSON(res, 400, { error: "Invalid date" });
  }
  const limit = parseLimit(params.get("limit"), 100);
  const file = scoresFile(`scores-daily-${date}`);
  const scores = readScores(file);
  scores.sort((a, b) => b.score - a.score);
  sendJSON(res, 200, { scores: scores.slice(0, limit) });
}

// POST /daily-scores
async function handlePostDailyScore(req, res) {
  const ip = getClientIP(req);
  if (isRateLimited(ip)) return sendJSON(res, 429, { error: "Rate limited" });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJSON(res, 400, { error: "Invalid JSON" });
  }

  const { date, name, score, distance, grade, biome } = body;

  if (!validateDate(date)) {
    return sendJSON(res, 400, { error: "Invalid date" });
  }
  if (
    typeof score !== "number" ||
    !isFinite(score) ||
    score < 0 ||
    score > 1e9
  ) {
    return sendJSON(res, 400, { error: "Invalid score" });
  }

  // Don't allow scores for future dates
  const today = new Date().toISOString().slice(0, 10);
  if (date > today) {
    return sendJSON(res, 400, { error: "Future date not allowed" });
  }

  const entry = {
    name: sanitizeName(name),
    score: Math.round(score),
    distance: Math.round(distance) || 0,
    grade: typeof grade === "string" ? grade.slice(0, 4) : "",
    biome: typeof biome === "string" ? biome.slice(0, 32) : "",
    ts: Date.now(),
  };

  const file = scoresFile(`scores-daily-${date}`);
  const scores = readScores(file);
  upsertScore(scores, entry);
  writeScores(file, scores);

  const rank = getRank(scores, entry.name, entry.score);
  sendJSON(res, 200, { rank, total: scores.length });
}

// ---------------------------------------------------------------------------
// Ghost endpoints — multi-game (canonical)
// ---------------------------------------------------------------------------

// GET /games/:gameId/ghosts?limit=N
function handleGetGhostsForGame(req, res, params, gameId) {
  if (!isValidGameId(gameId)) {
    return sendJSON(res, 400, { error: "Invalid gameId" });
  }
  const limit = parseLimit(params.get("limit"), 20);
  const ghosts = getTopGhosts(gameId, limit);
  sendJSON(res, 200, { ghosts });
}

// POST /games/:gameId/ghosts
async function handlePostGhostForGame(req, res, gameId) {
  if (!isValidGameId(gameId)) {
    return sendJSON(res, 400, { error: "Invalid gameId" });
  }
  const ip = getClientIP(req);
  if (isRateLimited(ip)) return sendJSON(res, 429, { error: "Rate limited" });

  let body;
  try {
    body = JSON.parse(await readBody(req, GHOST_BODY_MAX));
  } catch {
    return sendJSON(res, 400, { error: "Invalid JSON" });
  }

  const { name, score, distance, grade, frames, seed } = body;
  if (!Array.isArray(frames) || frames.length > GHOST_MAX_FRAMES) {
    return sendJSON(res, 400, { error: "Invalid frames" });
  }
  if (typeof score !== "number" || !isFinite(score) || score < 0) {
    return sendJSON(res, 400, { error: "Invalid score" });
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ghost = {
    id,
    name: sanitizeName(name),
    score: Math.round(score),
    distance: Math.round(distance) || 0,
    grade: typeof grade === "string" ? grade.slice(0, 4) : "",
    frames,
    ts: Date.now(),
    // Optional per-ghost seed for tower-layout playback (CC). Coerced to a
    // safe 32-bit integer; null when client omits the field (SD).
    seed:
      typeof seed === "number" && isFinite(seed)
        ? Math.trunc(seed)
        : null,
  };

  try {
    insertGhostAndTrim(ghost, gameId);
  } catch (err) {
    console.error("[ghosts] insert failed:", err);
    return sendJSON(res, 500, { error: "Insert failed" });
  }

  sendJSON(res, 200, { id });
}

// -----------------------------------------------------------------
// DEPRECATED: legacy /ghosts endpoints (SD-only, pre-multi-game).
// Kept alive until 2026-07-23 to let cached clients drain.
// New clients should use /games/:gameId/ghosts.
// REMOVE this block and its handlers after 2026-07-23.
// -----------------------------------------------------------------

function handleGetGhostsLegacy(req, res, params) {
  // Thin alias for /games/shatter-drift/ghosts
  return handleGetGhostsForGame(req, res, params, "shatter-drift");
}

async function handlePostGhostLegacy(req, res) {
  // Thin alias for /games/shatter-drift/ghosts
  return handlePostGhostForGame(req, res, "shatter-drift");
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

// /games/:gameId/ghosts — capture gameId.
const GAMES_GHOSTS_RE = /^\/games\/([^/]+)\/ghosts$/;

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;
  const params = url.searchParams;

  try {
    if (pathname === "/scores") {
      if (req.method === "GET") return handleGetScores(req, res, params);
      if (req.method === "POST") return await handlePostScore(req, res);
    }

    if (pathname === "/daily-scores") {
      if (req.method === "GET") return handleGetDailyScores(req, res, params);
      if (req.method === "POST") return await handlePostDailyScore(req, res);
    }

    const ghostsMatch = pathname.match(GAMES_GHOSTS_RE);
    if (ghostsMatch) {
      const gameId = ghostsMatch[1];
      if (req.method === "GET") return handleGetGhostsForGame(req, res, params, gameId);
      if (req.method === "POST") return await handlePostGhostForGame(req, res, gameId);
    }

    if (pathname === "/ghosts") {
      if (req.method === "GET") return handleGetGhostsLegacy(req, res, params);
      if (req.method === "POST") return await handlePostGhostLegacy(req, res);
    }

    sendJSON(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("Unhandled error:", err);
    sendJSON(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Shatter Drift API listening on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Ghosts DB: ${GHOSTS_DB_PATH}`);
});
