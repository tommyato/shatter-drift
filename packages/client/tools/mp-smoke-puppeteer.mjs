#!/usr/bin/env node
/**
 * Two-tab Colyseus smoke for SD MP.
 *
 * Boots the @sd/server bundle on :2568, serves the prebuilt @sd/client dist on
 * :5174, drives two headless Chromium tabs through the lobby flow, rams them
 * together, and screenshots the result. Captures console + ws activity for
 * post-mortem.
 *
 * Run: `npm -w @sd/client run mp-smoke:puppeteer` (or directly: `node tools/mp-smoke-puppeteer.mjs`)
 *
 * Outputs:
 *   - dist/_smoke/tab-1.png, dist/_smoke/tab-2.png  (after ~10s of MP play)
 *   - dist/_smoke/sp.png                            (single-player title)
 *   - dist/_smoke/log.txt                           (per-tab console + summary)
 */
import { createServer as createHttpServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import puppeteer from 'puppeteer'

const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'dist')
const SMOKE_DIR = join(DIST, '_smoke')
const SERVER_BUNDLE = resolve(ROOT, '../server/dist/index.cjs')
const HTTP_PORT = 5174
const SERVER_PORT = 2568
const PLAY_SECONDS = 10

mkdirSync(SMOKE_DIR, { recursive: true })

if (!existsSync(SERVER_BUNDLE)) {
	console.error(`server bundle missing: ${SERVER_BUNDLE} — run \`npm -w @sd/server run build\` first.`)
	process.exit(2)
}

const lines = []
function log(msg) {
	const stamped = `[${new Date().toISOString()}] ${msg}`
	console.log(stamped)
	lines.push(stamped)
}

// ---- 1) start server ----
log(`booting sd-mp server on :${SERVER_PORT}`)
const server = spawn('node', [SERVER_BUNDLE], {
	env: { ...process.env, PORT: String(SERVER_PORT) },
	stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`))
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))
await new Promise((r) => setTimeout(r, 1000))

// ---- 2) http-serve dist/ ----
const indexHtml = readFileSync(join(DIST, 'index.html'))
const httpServer = createHttpServer((req, res) => {
	res.setHeader('Content-Type', 'text/html')
	res.end(indexHtml)
})
await new Promise((r) => httpServer.listen(HTTP_PORT, r))
log(`http-serving dist/index.html on :${HTTP_PORT}`)

// ---- 3) launch puppeteer ----
const browser = await puppeteer.launch({
	headless: true,
	protocolTimeout: 240_000,
	args: ['--no-sandbox', '--disable-setuid-sandbox'],
})

let exitCode = 0
try {
	// ---- 3a) single-player smoke (no regression) ----
	const sp = await browser.newPage()
	await sp.setViewport({ width: 1280, height: 720 })
	sp.on('console', (msg) => log(`[sp:${msg.type()}] ${msg.text()}`))
	await sp.goto(`http://127.0.0.1:${HTTP_PORT}/?nodemo=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
	await new Promise((r) => setTimeout(r, 1500))
	await sp.screenshot({ path: join(SMOKE_DIR, 'sp.png'), fullPage: false })
	log(`single-player screenshot saved: ${join(SMOKE_DIR, 'sp.png')}`)
	await sp.close()

	// ---- 3b) two-tab MP smoke ----
	const t1 = await browser.newPage()
	const t2 = await browser.newPage()
	await t1.setViewport({ width: 1280, height: 720 })
	await t2.setViewport({ width: 1280, height: 720 })
	t1.on('console', (msg) => log(`[t1:${msg.type()}] ${msg.text()}`))
	t2.on('console', (msg) => log(`[t2:${msg.type()}] ${msg.text()}`))
	t1.on('pageerror', (err) => log(`[t1:error] ${err.message}`))
	t2.on('pageerror', (err) => log(`[t2:error] ${err.message}`))

	const url = `http://127.0.0.1:${HTTP_PORT}/?mp=1&mp_auto=1&mp_url=ws://127.0.0.1:${SERVER_PORT}&nodemo=1`
	log('opening tab 1 with auto-quickmatch')
	await t1.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
	await new Promise((r) => setTimeout(r, 2500))
	log('opening tab 2 with auto-quickmatch')
	await t2.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
	await new Promise((r) => setTimeout(r, 4000))

	// Both tabs should now be in match (server auto-starts at 2 players).
	// Drive both: tab 1 holds left, tab 2 holds right — they should ram in the middle.
	log('driving both tabs for 10s — t1=ArrowRight, t2=ArrowLeft (ram in the middle)')
	await t1.bringToFront()
	await t1.keyboard.down('ArrowRight')
	await t2.bringToFront()
	await t2.keyboard.down('ArrowLeft')

	for (let s = 0; s < PLAY_SECONDS; s++) {
		await new Promise((r) => setTimeout(r, 1000))
		const t1State = await t1.evaluate(() => ({
			matchState: window.__sd_game?.matchState,
			lobbyCode: document.getElementById('multiplayer-current-code')?.textContent ?? null,
		})).catch(() => ({ matchState: 'unknown' }))
		log(`tick ${s + 1}/${PLAY_SECONDS}: t1.matchState=${t1State.matchState}`)
	}

	await t1.keyboard.up('ArrowRight')
	await t2.keyboard.up('ArrowLeft')

	const t1Path = join(SMOKE_DIR, 'tab-1.png')
	const t2Path = join(SMOKE_DIR, 'tab-2.png')
	await t1.screenshot({ path: t1Path, fullPage: false })
	await t2.screenshot({ path: t2Path, fullPage: false })
	log(`tab 1 screenshot: ${t1Path}`)
	log(`tab 2 screenshot: ${t2Path}`)
} catch (err) {
	log(`SMOKE FAILED: ${err.stack ?? err.message ?? err}`)
	exitCode = 1
} finally {
	await browser.close()
	httpServer.close()
	server.kill()
	writeFileSync(join(SMOKE_DIR, 'log.txt'), lines.join('\n'))
	log(`log.txt written`)
	process.exit(exitCode)
}
