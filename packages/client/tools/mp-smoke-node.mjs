#!/usr/bin/env node
/**
 * Node-only Colyseus collision smoke for SD MP.
 *
 * Boots the @sd/server bundle on :2568, connects two `colyseus.js` clients,
 * sends opposing lateral inputs at the simulated client tick rate (30 Hz), and
 * watches the server's PlayerSchema patches for non-zero `bumpVelX` — the
 * authoritative signal that `PlayerCollisionSystem` is firing over the wire.
 *
 * Distinct from `mp-smoke-puppeteer.mjs`, which proves "two browser tabs
 * spawn, drive, and render correctly." This script proves "the server-side
 * collision math is producing real bump impulses on real input messages."
 *
 * Outputs to stdout. Exits 0 on bump observed, 1 otherwise.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'colyseus.js'

const SERVER_BUNDLE = resolve(import.meta.dirname, '../../server/dist/index.cjs')
const SERVER_URL = 'ws://127.0.0.1:2568'
const TICK_HZ = 30
const TICK_MS = 1000 / TICK_HZ
const RAM_DURATION_MS = 6000

if (!existsSync(SERVER_BUNDLE)) {
	console.error(`server bundle missing: ${SERVER_BUNDLE} — run \`npm -w @sd/server run build\` first.`)
	process.exit(2)
}

console.log('booting server')
const server = spawn('node', [SERVER_BUNDLE], {
	env: { ...process.env, PORT: '2568' },
	stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`))
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))
await new Promise((r) => setTimeout(r, 1000))

const client = new Client(SERVER_URL)
let bumpsObserved = 0
let exitCode = 1

try {
	console.log('connecting tab A (slot 0 — will hold right)')
	const a = await client.joinOrCreate('shatter-drift', { name: 'TAB-A' })
	console.log(`  sessionId=${a.sessionId} roomId=${a.roomId}`)

	console.log('connecting tab B (slot 1 — will hold left)')
	const b = await client.joinById(a.roomId, { name: 'TAB-B' })
	console.log(`  sessionId=${b.sessionId} roomId=${b.roomId}`)

	let serverTick = 0

	a.onMessage('start', (payload) => {
		console.log(`[a] start broadcast tick=${payload.tick} seed=${payload.seed} slots=${payload.slots.length}`)
	})
	b.onMessage('start', (payload) => {
		console.log(`[b] start broadcast tick=${payload.tick} seed=${payload.seed} slots=${payload.slots.length}`)
	})

	a.onStateChange((state) => {
		serverTick = state.tick ?? serverTick
		const players = state.players
		if (!players) return
		const localPlayer = players.get?.(a.sessionId) ?? players[a.sessionId]
		const remotePlayer = players.get?.(b.sessionId) ?? players[b.sessionId]
		if (localPlayer && Math.abs(localPlayer.bumpVelX ?? 0) > 0.01) {
			bumpsObserved += 1
			if (bumpsObserved <= 5) {
				console.log(
					`[a] bumpVelX=${localPlayer.bumpVelX.toFixed(3)} x=${localPlayer.x.toFixed(2)} tick=${state.tick} (remote x=${remotePlayer?.x?.toFixed?.(2) ?? '?'} bumpVelX=${remotePlayer?.bumpVelX?.toFixed?.(3) ?? '?'})`,
				)
			}
		}
	})

	// Wait for both players to be fully joined and start broadcast received.
	await new Promise((r) => setTimeout(r, 1500))
	console.log(`server tick at ram-start: ${serverTick}`)

	// Drive opposing inputs — A holds right (action 2), B holds left (action 1) — at 30 Hz.
	// Use the live server tick so messages don't get dropped by the staleness filter.
	console.log(`ramming for ${RAM_DURATION_MS}ms — A=right(2), B=left(1)`)
	const start = Date.now()
	while (Date.now() - start < RAM_DURATION_MS) {
		a.send('input', { tick: serverTick, action: 2 })
		b.send('input', { tick: serverTick, action: 1 })
		await new Promise((r) => setTimeout(r, TICK_MS))
	}

	console.log(`bumps observed (snapshots with |bumpVelX| > 0.01 on tab A): ${bumpsObserved}`)
	if (bumpsObserved > 0) {
		console.log('PASS: server PlayerCollisionSystem fired bumpVelX over the wire')
		exitCode = 0
	} else {
		console.log('FAIL: no bumps observed — check spawn distance vs. ram duration')
	}

	await a.leave().catch(() => undefined)
	await b.leave().catch(() => undefined)
} catch (err) {
	console.error(`SMOKE FAILED: ${err.stack ?? err.message ?? err}`)
} finally {
	server.kill()
	await new Promise((r) => setTimeout(r, 200))
	process.exit(exitCode)
}
