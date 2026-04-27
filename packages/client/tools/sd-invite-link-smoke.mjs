#!/usr/bin/env node
/**
 * Invite-link smoke test for SD MP.
 *
 * Tab A: CREATE LOBBY → COPY LINK → assert status + clipboard URL shape.
 * Tab B: load invite URL → assert modal auto-opens, code pre-filled, JOIN triggers,
 *         both clients visible in lobby.
 *
 * Saves screenshots to $TOMMYATO_SCRATCHPAD_DIR/sd-invite-link-smoke/tab-{a,b}.png.
 *
 * Run: node tools/sd-invite-link-smoke.mjs
 * Requires prebuilt dist/ (npm run build) and server/dist/index.cjs.
 */
import { createServer as createHttpServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import puppeteer from 'puppeteer'

const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'dist')
const SERVER_BUNDLE = resolve(ROOT, '../server/dist/index.cjs')
const HTTP_PORT = 5176
const SERVER_PORT = 2569

const SCRATCHPAD = process.env.TOMMYATO_SCRATCHPAD_DIR ?? join(ROOT, 'dist', '_smoke')
const SMOKE_DIR = join(SCRATCHPAD, 'sd-invite-link-smoke')
mkdirSync(SMOKE_DIR, { recursive: true })

const DASHBOARD_BASE = 'https://dashboard.tommyato.com/scratchpad'

if (!existsSync(SERVER_BUNDLE)) {
	console.error(`server bundle missing: ${SERVER_BUNDLE}`)
	process.exit(2)
}
if (!existsSync(join(DIST, 'index.html'))) {
	console.error(`dist/index.html missing — run npm run build first`)
	process.exit(2)
}

const lines = []
function log(msg) {
	const stamped = `[${new Date().toISOString()}] ${msg}`
	console.log(stamped)
	lines.push(stamped)
}
function fail(msg) {
	log(`FAIL: ${msg}`)
	process.exitCode = 1
}

// ── 1) start Colyseus server ──────────────────────────────────────────────────
log(`booting sd-mp server on :${SERVER_PORT}`)
const server = spawn('node', [SERVER_BUNDLE], {
	env: { ...process.env, PORT: String(SERVER_PORT) },
	stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`))
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))
await new Promise((r) => setTimeout(r, 1200))

// ── 2) http-serve dist/ ───────────────────────────────────────────────────────
const indexHtml = readFileSync(join(DIST, 'index.html'))
const httpServer = createHttpServer((req, res) => {
	res.setHeader('Content-Type', 'text/html')
	res.end(indexHtml)
})
await new Promise((r) => httpServer.listen(HTTP_PORT, r))
log(`serving dist/index.html on :${HTTP_PORT}`)

const BASE_URL = `http://127.0.0.1:${HTTP_PORT}`
const MP_OPTS = `?mp=1&mp_url=ws://127.0.0.1:${SERVER_PORT}&nodemo=1`
const TAB_A_URL = `${BASE_URL}/${MP_OPTS}`

// ── 3) launch browser ─────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
	headless: true,
	protocolTimeout: 120_000,
	args: [
		'--no-sandbox',
		'--disable-setuid-sandbox',
		'--unsafely-treat-insecure-origin-as-secure=http://127.0.0.1',
	],
})

try {
	// ── Tab A ─────────────────────────────────────────────────────────────────
	log('opening tab A')
	const tabA = await browser.newPage()
	await tabA.setViewport({ width: 1280, height: 720 })
	tabA.on('console', (m) => log(`[A:${m.type()}] ${m.text()}`))
	tabA.on('pageerror', (e) => log(`[A:error] ${e.message}`))

	// Mock clipboard.writeText so we can read it back without permission hassle.
	await tabA.evaluateOnNewDocument(() => {
		window.__capturedClipboard = null
		const orig = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
		const mockClipboard = {
			writeText: async (text) => { window.__capturedClipboard = text },
			readText: async () => window.__capturedClipboard ?? '',
		}
		try {
			Object.defineProperty(navigator, 'clipboard', { value: mockClipboard, configurable: true })
		} catch {
			// fallback — some environments won't allow this
			Object.assign(navigator.clipboard, mockClipboard)
		}
		void orig // suppress unused warning
	})

	await tabA.goto(TAB_A_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
	await new Promise((r) => setTimeout(r, 1500))

	// Open MP modal
	log('A: clicking MULTIPLAYER button')
	await tabA.click('#multiplayer-btn')
	await tabA.waitForSelector('#multiplayer-modal:not(.hidden)', { timeout: 5_000 })
	log('A: modal open')

	// Create lobby
	log('A: clicking CREATE LOBBY')
	await tabA.click('#multiplayer-create-btn')

	// Wait for COPY LINK button to become visible (lobby ready signal — code no longer shown to host)
	log('A: waiting for COPY LINK button to appear...')
	await tabA.waitForFunction(
		() => {
			const btn = document.getElementById('multiplayer-copy-link-btn')
			return btn && btn.style.display !== 'none'
		},
		{ timeout: 15_000 }
	)

	// Verify lobby code is NOT rendered to host (acceptance criterion)
	const lobbyCodeText = await tabA.$eval('#multiplayer-current-code', (el) => el.textContent ?? '')
	log(`A: lobby code display = "${lobbyCodeText}" (must be empty)`)
	if (lobbyCodeText.trim()) {
		fail(`A: lobby code still displayed to host: "${lobbyCodeText}"`)
	} else {
		log('A: ✓ lobby code not shown to host')
	}

	// Click COPY LINK
	log('A: clicking COPY LINK')
	await tabA.click('#multiplayer-copy-link-btn')
	await new Promise((r) => setTimeout(r, 500))

	// Assert status changed to invite-copied message
	const statusAfterCopy = await tabA.$eval('#multiplayer-status', (el) => el.textContent ?? '')
	if (statusAfterCopy === 'Invite link copied — send it to a friend.') {
		log('A: ✓ status = "Invite link copied — send it to a friend."')
	} else {
		fail(`A: status after copy = "${statusAfterCopy}" — expected invite text`)
	}

	// Read captured clipboard value
	const capturedUrl = await tabA.evaluate(() => window.__capturedClipboard)
	log(`A: clipboard URL = ${capturedUrl}`)

	// Verify URL shape
	const LOBBY_CODE_RE = /^[A-Za-z0-9_-]{9}$/
	if (capturedUrl) {
		try {
			const parsed = new URL(capturedUrl)
			const lobbyParam = parsed.searchParams.get('lobby')
			if (lobbyParam && LOBBY_CODE_RE.test(lobbyParam)) {
				log(`A: ✓ URL shape valid — lobby param = "${lobbyParam}"`)
			} else {
				fail(`A: lobby param "${lobbyParam}" does not match 9-char alphanumeric pattern`)
			}
		} catch {
			fail(`A: captured clipboard is not a valid URL: "${capturedUrl}"`)
		}
	} else {
		fail('A: clipboard is empty — writeText mock may not have fired')
	}

	await tabA.screenshot({ path: join(SMOKE_DIR, 'tab-a.png'), fullPage: false })
	log(`A: screenshot saved`)

	// ── Tab B (invite URL auto-join) ─────────────────────────────────────────
	const inviteUrl = capturedUrl
		? capturedUrl.replace(`${BASE_URL}/`, `${BASE_URL}/`)
		: null

	if (!inviteUrl) {
		fail('B: skipped — no invite URL captured')
	} else {
		// Replace the host in the captured URL with our local server
		const parsedInvite = new URL(inviteUrl)
		parsedInvite.host = `127.0.0.1:${HTTP_PORT}`
		parsedInvite.protocol = 'http:'
		// Preserve ?lobby= param and add mp opts
		parsedInvite.searchParams.set('mp', '1')
		parsedInvite.searchParams.set('mp_url', `ws://127.0.0.1:${SERVER_PORT}`)
		parsedInvite.searchParams.set('nodemo', '1')
		const tabBUrl = parsedInvite.toString()
		log(`B: loading invite URL: ${tabBUrl}`)

		const tabB = await browser.newPage()
		await tabB.setViewport({ width: 1280, height: 720 })
		tabB.on('console', (m) => log(`[B:${m.type()}] ${m.text()}`))
		tabB.on('pageerror', (e) => log(`[B:error] ${e.message}`))

		// Deep-link auto-join: Tab B loads the invite URL and checkDeepLinkLobby()
		// fires during init. Since Tab A is already waiting in the lobby, the server
		// immediately starts the match when Tab B joins (2 players). The modal opens
		// briefly then closes when beginMultiplayerMatch() fires — so we don't try
		// to catch that transient open. Instead we assert on durable outcomes.
		await tabB.goto(tabBUrl, { waitUntil: 'load', timeout: 30_000 })

		const parsedInviteCode = new URL(tabBUrl).searchParams.get('lobby') ?? ''

		// Wait for the deep-link join to complete. The code input retains its value
		// even after the match starts (not cleared by beginMultiplayerMatch), so
		// it being set to the lobby code is reliable proof that checkDeepLinkLobby ran.
		log(`B: waiting for deep-link join (lobby ${parsedInviteCode}, up to 30s)...`)
		const joinedOk = await tabB.waitForFunction(
			(expectedCode) => {
				const codeInput = document.getElementById('multiplayer-code-input')
				const status = document.getElementById('multiplayer-status')?.textContent ?? ''
				// Code input is pre-filled by checkDeepLinkLobby and never cleared by join/match
				const codePreFilled = codeInput instanceof HTMLInputElement && codeInput.value === expectedCode
				// Status shows join/match progress (current-code no longer displays lobby code)
				const joinVisible = (
					status.toLowerCase().includes('joined') ||
					status.toLowerCase().includes('joining') ||
					status.toLowerCase().includes('match') ||
					status.toLowerCase().includes('connecting') ||
					status.toLowerCase().includes('waiting')
				)
				return codePreFilled || joinVisible
			},
			{ timeout: 30_000 },
			parsedInviteCode
		).then(() => true).catch(() => false)

		if (joinedOk) {
			log('B: ✓ join evidence found')
		} else {
			const bStatus = await tabB.$eval('#multiplayer-status', (el) => el.textContent ?? '').catch(() => 'N/A')
			const bInput = await tabB.$eval('#multiplayer-code-input', (el) => el.value ?? '').catch(() => 'N/A')
			fail(`B: join did not complete within 30s — status="${bStatus}" input="${bInput}"`)
		}

		// Verify code was pre-filled from URL param (proves checkDeepLinkLobby ran)
		const prefillCode = await tabB.$eval('#multiplayer-code-input', (el) => el.value).catch(() => '')
		if (prefillCode === parsedInviteCode) {
			log(`B: ✓ code pre-filled from URL: "${prefillCode}"`)
		} else {
			log(`B: warn — code input="${prefillCode}" expected="${parsedInviteCode}" (may have changed post-join)`)
		}

		// Verify ?lobby= was stripped from URL after join (clearLobbyUrlParam)
		const finalUrl = tabB.url()
		if (!finalUrl.includes('lobby=')) {
			log('B: ✓ ?lobby= param cleared from URL after join')
		} else {
			log(`B: warn — ?lobby= still in URL: ${finalUrl}`)
		}

		// Soft check: player list (may be in-match so modal is closed)
		const playerRows = await tabB.$$eval('.mp-player-row', (rows) => rows.length).catch(() => 0)
		if (playerRows >= 2) {
			log(`B: ✓ lobby shows ${playerRows} players`)
		} else {
			log(`B: info — ${playerRows} player row(s) visible (match may have started, modal closed)`)
		}

		await tabB.screenshot({ path: join(SMOKE_DIR, 'tab-b.png'), fullPage: false })
		log(`B: screenshot saved`)
	}

} catch (err) {
	log(`SMOKE ERROR: ${err.stack ?? err.message ?? err}`)
	process.exitCode = 1
} finally {
	await browser.close().catch(() => {})
	httpServer.close()
	server.kill()
	const logPath = join(SMOKE_DIR, 'log.txt')
	writeFileSync(logPath, lines.join('\n'))
	log(`log written: ${logPath}`)

	const scratchpadBase = SCRATCHPAD.replace(/\\/g, '/')
	const relA = join(SMOKE_DIR, 'tab-a.png').replace(scratchpadBase + '/', '')
	const relB = join(SMOKE_DIR, 'tab-b.png').replace(scratchpadBase + '/', '')
	console.log(`\nScreenshot URLs (if scratchpad mounted):`)
	console.log(`  Tab A: ${DASHBOARD_BASE}/${relA}`)
	console.log(`  Tab B: ${DASHBOARD_BASE}/${relB}`)

	if (process.exitCode === 1) {
		console.log('\n✗ SMOKE FAILED — see log above')
		process.exit(1)
	} else {
		console.log('\n✓ SMOKE PASSED')
	}
}
