/**
 * Puppeteer smoke test for the ?_harness=1 QA harness.
 *
 * Usage:
 *   npm run test:harness
 *
 * Exits 0 on success, 1 with a diagnostic dump on any failure.
 */

import { execSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST_DIR = resolve(ROOT, 'dist')

const MIME = {
	'.html': 'text/html',
	'.js': 'application/javascript',
	'.mjs': 'application/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.wasm': 'application/wasm',
}

// ---------------------------------------------------------------------------
// 1. Build
// ---------------------------------------------------------------------------
console.log('[harness-test] Building project...')
try {
	execSync('npm run build', { cwd: ROOT, stdio: 'inherit' })
} catch {
	console.error('[harness-test] Build failed')
	process.exit(1)
}
console.log('[harness-test] Build complete.')

// ---------------------------------------------------------------------------
// 2. Start a static HTTP server for dist/
//    Serves actual files from dist/ — needed so harness.js can be fetched
//    as a dynamic import alongside index.html.
// ---------------------------------------------------------------------------
function startServer() {
	return new Promise((resolveP, rejectP) => {
		const server = createServer((req, res) => {
			// Strip query string from URL
			const pathname = req.url?.split('?')[0] ?? '/'
			// Resolve to a real file; fall back to index.html for SPA routing
			let filePath = resolve(DIST_DIR, pathname.replace(/^\//, '') || 'index.html')
			if (!existsSync(filePath)) filePath = resolve(DIST_DIR, 'index.html')

			try {
				const data = readFileSync(filePath)
				const mime = MIME[extname(filePath)] ?? 'application/octet-stream'
				res.writeHead(200, { 'Content-Type': mime })
				res.end(data)
			} catch (err) {
				res.writeHead(500)
				res.end(String(err))
			}
		})

		let port = 14173
		const tryListen = () => {
			server.once('error', (err) => {
				if (err.code === 'EADDRINUSE') {
					port++
					tryListen()
				} else {
					rejectP(err)
				}
			})
			server.listen(port, '127.0.0.1', () => resolveP({ server, port }))
		}
		tryListen()
	})
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let browser
let server

try {
	const { server: srv, port } = await startServer()
	server = srv
	console.log(`[harness-test] Serving dist/ on http://127.0.0.1:${port}/`)

	browser = await puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	})
	const page = await browser.newPage()

	// Capture console output from the page for diagnostics
	const consoleLogs = []
	page.on('console', (msg) => consoleLogs.push(`[page:${msg.type()}] ${msg.text()}`))
	page.on('pageerror', (err) => consoleLogs.push(`[page:error] ${err.message}`))

	// ---------------------------------------------------------------------------
	// 3. Open with ?_harness=1
	// ---------------------------------------------------------------------------
	const url = `http://127.0.0.1:${port}/?_harness=1`
	console.log(`[harness-test] Opening ${url}`)
	await page.goto(url, { waitUntil: 'load' })

	// ---------------------------------------------------------------------------
	// 4. Wait for window.__harnessReady
	// ---------------------------------------------------------------------------
	console.log('[harness-test] Waiting for __harnessReady...')
	try {
		await page.waitForFunction(() => window.__harnessReady === true, { timeout: 10_000 })
	} catch {
		console.error('[harness-test] FAIL: window.__harnessReady never became true (10s timeout)')
		console.error('Page console output:')
		consoleLogs.forEach((l) => console.error(' ', l))
		process.exit(1)
	}
	console.log('[harness-test] Harness ready.')

	// ---------------------------------------------------------------------------
	// 5. Run assertions
	// ---------------------------------------------------------------------------
	const failures = []

	function assert(label, cond, detail = '') {
		if (!cond) {
			failures.push(`FAIL: ${label}${detail ? ' — ' + detail : ''}`)
			console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`)
		} else {
			console.log(`  ✓ ${label}`)
		}
	}

	// 5a. listScripts returns the three expected scripts
	console.log('\n[harness-test] Checking listScripts()...')
	const scripts = await page.evaluate(() => window.__harness.listScripts())
	const EXPECTED_SCRIPTS = ['idle-60s', 'survive-30s', 'determinism']
	for (const s of EXPECTED_SCRIPTS) {
		assert(`listScripts includes "${s}"`, scripts.includes(s), `got: ${JSON.stringify(scripts)}`)
	}

	// 5b. determinism script — all invariants ok
	console.log('\n[harness-test] Running script "determinism" (30s sim × 2)...')
	const detResult = await page.evaluate(() => window.__harness.runScript('determinism'))
	console.log(`  ticks: ${detResult.ticks}`)
	for (const inv of detResult.invariants) {
		assert(`determinism.${inv.name}`, inv.ok, inv.msg)
	}
	assert('determinism: all invariants ok', detResult.invariants.every((i) => i.ok))

	// 5c. idle-60s — all invariants ok; state.distance > 0
	console.log('\n[harness-test] Running script "idle-60s" (60s sim)...')
	const idleResult = await page.evaluate(() => window.__harness.runScript('idle-60s'))
	console.log(`  ticks: ${idleResult.ticks}, distance: ${idleResult.state.distance}`)
	for (const inv of idleResult.invariants) {
		assert(`idle-60s.${inv.name}`, inv.ok, inv.msg)
	}
	assert('idle-60s: all invariants ok', idleResult.invariants.every((i) => i.ok))
	assert(
		'idle-60s: distance > 0',
		idleResult.state.distance > 0,
		`got ${idleResult.state.distance}`,
	)

	// 5d. survive-30s — all invariants ok
	console.log('\n[harness-test] Running script "survive-30s" (30s sim)...')
	const surviveResult = await page.evaluate(() => window.__harness.runScript('survive-30s'))
	console.log(`  ticks: ${surviveResult.ticks}`)
	for (const inv of surviveResult.invariants) {
		assert(`survive-30s.${inv.name}`, inv.ok, inv.msg)
	}
	assert('survive-30s: all invariants ok', surviveResult.invariants.every((i) => i.ok))

	// 5e. Normal mode: window.__harness is undefined without ?_harness=1
	console.log('\n[harness-test] Verifying normal mode (no ?_harness=1)...')
	await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })
	// Give a moment for any sync code to run
	await new Promise((r) => setTimeout(r, 1000))
	const normalHarness = await page.evaluate(() => window.__harness)
	assert('normal mode: window.__harness is undefined', normalHarness === undefined)

	// ---------------------------------------------------------------------------
	// Results
	// ---------------------------------------------------------------------------
	console.log('\n---')
	if (failures.length > 0) {
		console.error(`[harness-test] ${failures.length} assertion(s) failed:`)
		failures.forEach((f) => console.error(' ', f))
		console.error('\nPage console output:')
		consoleLogs.forEach((l) => console.error(' ', l))
		process.exit(1)
	} else {
		console.log(`[harness-test] All assertions passed. ✓`)
	}
} finally {
	if (browser) await browser.close().catch(() => {})
	if (server) server.close()
}
