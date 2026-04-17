/**
 * Shatter Drift API server — full updated file.
 *
 * Deploy to /root/shatter-drift-api/index.js on the droplet (67.205.167.181).
 *
 * Changes from original:
 *   + GET  /daily-scores?date=YYYY-MM-DD&limit=N
 *   + POST /daily-scores  { date, name, score, distance, grade, biome }
 *     Scores are stored in scores-daily-YYYY-MM-DD.json (one file per day).
 *     Same rate-limiting and validation as regular scores.
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) reject(new Error("Body too large"));
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

// ---------------------------------------------------------------------------
// Score file I/O
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
// Route handlers
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
// Ghost endpoints
// ---------------------------------------------------------------------------

const GHOST_MAX_FRAMES = 18000; // ~5 min at 60fps

// GET /ghosts?limit=N
function handleGetGhosts(req, res, params) {
  const limit = parseLimit(params.get("limit"), 10);
  const file = scoresFile("ghosts");
  const ghosts = readScores(file);
  ghosts.sort((a, b) => b.score - a.score);
  sendJSON(res, 200, { ghosts: ghosts.slice(0, limit) });
}

// POST /ghosts
async function handlePostGhost(req, res) {
  const ip = getClientIP(req);
  if (isRateLimited(ip)) return sendJSON(res, 429, { error: "Rate limited" });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJSON(res, 400, { error: "Invalid JSON" });
  }

  const { name, score, distance, grade, frames } = body;
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
  };

  const file = scoresFile("ghosts");
  let ghosts = readScores(file);
  ghosts.push(ghost);
  ghosts.sort((a, b) => b.score - a.score);
  if (ghosts.length > 20) ghosts.length = 20; // keep top 20 ghosts
  writeScores(file, ghosts);

  sendJSON(res, 200, { id });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

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

    if (pathname === "/ghosts") {
      if (req.method === "GET") return handleGetGhosts(req, res, params);
      if (req.method === "POST") return await handlePostGhost(req, res);
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
});
