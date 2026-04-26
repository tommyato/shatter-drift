/**
 * @sd/server entrypoint — Colyseus match server for Shatter Drift.
 *
 * Defines the `shatter-drift` room and listens on PORT (default 2568).
 * Deployed to `sd-mp.tommyato.com` via Caddy → :2568.
 */
import { Server } from 'colyseus'
import express from 'express'
import { createServer } from 'node:http'

import { ShatterDriftRoom } from './ShatterDriftRoom'

const PORT = Number(process.env.PORT ?? 2568)

const app = express()
app.get('/health', (_req, res) => {
	res.json({ ok: true, service: 'sd-mp' })
})

const httpServer = createServer(app)
const gameServer = new Server({ server: httpServer })
gameServer.define('shatter-drift', ShatterDriftRoom)

gameServer.listen(PORT)
console.log(`[sd-mp] server listening on :${PORT}`)
