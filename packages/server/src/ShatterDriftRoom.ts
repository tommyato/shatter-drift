/**
 * ShatterDriftRoom — Colyseus room for Shatter Drift multiplayer.
 *
 * Server-authoritative for the player slice (positions + collisions). World,
 * obstacles, and crystals stay client-side and agree by shared seed + tick.
 *
 * Tick rate: 30 Hz. Each tick the room runs `PlayerMovementSystem` and
 * `PlayerCollisionSystem` from `@sd/sim` against its own world+inputs, then
 * snapshots player state into the Colyseus schema (which auto-diffs to
 * connected clients).
 */
import { Client, Room } from 'colyseus'
import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema'

import { mulberry32 } from '@sd/sim'
import { createSimulationWorld } from '@sd/sim'
import { createAgentInput } from '@sd/sim/input/agent-input'
import { createPlayerMovementSystem } from '@sd/sim/systems/player-movement-system'
import { createPlayerCollisionSystem } from '@sd/sim/systems/player-collision-system'
import type {
	MatchPlayerInfo,
	SimulationInput,
} from '@sd/sim'
import type { SimulationWorld } from '@sd/sim'

const MAX_PLAYERS = 4
const TICK_HZ = 30
const TICK_DT = 1 / TICK_HZ
const PATCH_HZ = 30 // schema patch broadcast rate

// Phase 3 spawn-stagger lateral offsets — match `sd-client` SD spawn lanes.
// Slot 0 = center, slots fan out in pairs to keep the local player feeling
// "centered" relative to others when joining first.
const SPAWN_LATERAL_OFFSETS = [0, 4, -4, 8] as const
// MP palette — matches `pickPlayerColor` in client multiplayer module.
const MP_COLOR_PALETTE = [0x4be1ff, 0xff5fa2, 0xffd24b, 0x7bff5f] as const

// Drop input frames more than this many ticks behind the current server tick.
const INPUT_STALENESS_TICKS = 6

class PlayerSchema extends Schema {
	@type('string') sessionId = ''
	@type('string') name = 'Player'
	@type('uint8') slot = 0
	@type('uint32') color = 0
	@type('number') x = 0
	@type('number') y = 0
	@type('number') z = 0
	@type('number') vx = 0
	@type('number') vy = 0
	@type('number') vz = 0
	@type('number') bumpVelX = 0
	@type('boolean') boostActive = false
	@type('boolean') alive = true
	@type('uint32') lastInputTick = 0
}

class SlotSchema extends Schema {
	@type('string') sessionId = ''
	@type('uint8') slot = 0
	@type('uint32') color = 0
	@type('string') name = ''
	@type('uint8') playerIndex = 0
}

class MatchState extends Schema {
	@type('uint32') tick = 0
	@type('string') seed = '0'
	@type('number') startedAt = 0
	@type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>()
	@type([SlotSchema]) slots = new ArraySchema<SlotSchema>()
}

type InputMessage = {
	tick: number
	throttle?: number
	brake?: number
	lateral?: number
	boost?: boolean
	shatter?: boolean
	/**
	 * Pre-encoded action int (0-5 legacy, 6+ bitflag — see agent-input.ts).
	 * If present, takes precedence over the per-button fields.
	 */
	action?: number
}

type ServerPlayer = {
	sessionId: string
	slot: number
	playerIndex: number
	color: number
	name: string
	input: SimulationInput
	/** Pending input messages, keyed by tick. Drained on the next sim tick. */
	pendingInputs: Map<number, number>
	/** Highest tick from this client we have applied. */
	lastAppliedTick: number
}

export class ShatterDriftRoom extends Room<MatchState> {
	override maxClients = MAX_PLAYERS

	private world!: SimulationWorld
	private playerMovementSystem!: (dt: number) => void
	private playerCollisionSystem!: (dt: number) => void
	private inputs: SimulationInput[] = []
	private serverPlayers = new Map<string, ServerPlayer>()
	private freeSlots: number[] = []
	private freeColors: number[] = []
	private currentTick = 0
	private startBroadcastSent = false

	override onCreate(_options?: Record<string, unknown>): void {
		this.setState(new MatchState())

		// Seed the deterministic world. Math.random() is fine here — runs once
		// at room creation, never on the tick path. The seed is broadcast to
		// every client via the schema so all peers generate the same world.
		const seedNum = Math.floor(Math.random() * 0x7fffffff) + 1
		this.state.seed = String(seedNum)
		const random = mulberry32(seedNum)

		// Pre-allocate inputs for MAX_PLAYERS so the world's player array is
		// stable across joins/leaves. Empty slots get neutral inputs.
		this.inputs = Array.from({ length: MAX_PLAYERS }, () => createAgentInput())

		this.world = createSimulationWorld(this.inputs, random, {
			seed: seedNum,
			playerCount: MAX_PLAYERS,
			localPlayerIndex: 0,
		})
		// Mark all players dead until they actually join — keeps movement +
		// collision systems from acting on phantom slots.
		for (const player of this.world.state.players) player.alive = false

		this.playerMovementSystem = createPlayerMovementSystem(this.world)
		this.playerCollisionSystem = createPlayerCollisionSystem(this.world)

		this.freeSlots = Array.from({ length: MAX_PLAYERS }, (_, i) => i)
		this.freeColors = MP_COLOR_PALETTE.slice() as unknown as number[]

		this.setPatchRate(1000 / PATCH_HZ)
		this.setSimulationInterval((deltaMs) => this.tick(deltaMs / 1000), 1000 / TICK_HZ)

		this.onMessage('input', (client, message: InputMessage) => {
			const player = this.serverPlayers.get(client.sessionId)
			if (!player) return
			if (typeof message?.tick !== 'number' || !Number.isFinite(message.tick)) return
			const incomingTick = Math.trunc(message.tick)
			if (incomingTick < this.currentTick - INPUT_STALENESS_TICKS) return
			const action = encodeAction(message)
			player.pendingInputs.set(incomingTick, action)
		})

		this.onMessage('start', (_client) => {
			// Optional manual start trigger — auto-start fires when the second
			// player joins, but a host may also push the button.
			this.maybeBroadcastStart()
		})
	}

	override onJoin(client: Client, options: { name?: string } = {}): void {
		if (this.freeSlots.length === 0) {
			throw new Error('Room full')
		}
		const slot = this.freeSlots.shift()!
		const color = this.freeColors.shift()!
		const playerIndex = slot
		const name = sanitizeName(options.name)
		const lateralX = SPAWN_LATERAL_OFFSETS[slot] ?? 0

		const worldPlayer = this.world.state.players[playerIndex]!
		worldPlayer.alive = true
		worldPlayer.x = lateralX
		worldPlayer.z = 0
		worldPlayer.bumpVelX = 0
		worldPlayer.color = color
		worldPlayer.name = name

		const sp: ServerPlayer = {
			sessionId: client.sessionId,
			slot,
			playerIndex,
			color,
			name,
			input: this.inputs[playerIndex]!,
			pendingInputs: new Map(),
			lastAppliedTick: this.currentTick,
		}
		this.serverPlayers.set(client.sessionId, sp)

		const playerSchema = new PlayerSchema()
		playerSchema.sessionId = client.sessionId
		playerSchema.name = name
		playerSchema.slot = slot
		playerSchema.color = color
		playerSchema.x = lateralX
		playerSchema.z = 0
		playerSchema.alive = true
		this.state.players.set(client.sessionId, playerSchema)

		this.rebuildSlotsArray()
		this.maybeBroadcastStart()

		console.log(
			`[sd-mp] ${client.sessionId} joined slot ${slot} color #${color.toString(16)} (now ${this.serverPlayers.size}/${MAX_PLAYERS})`,
		)
	}

	override onLeave(client: Client, _consented?: boolean): void {
		const sp = this.serverPlayers.get(client.sessionId)
		if (!sp) return

		const worldPlayer = this.world.state.players[sp.playerIndex]
		if (worldPlayer) {
			worldPlayer.alive = false
			worldPlayer.x = 0
			worldPlayer.z = 0
			worldPlayer.bumpVelX = 0
		}
		sp.input.reset()

		this.freeSlots.push(sp.slot)
		this.freeSlots.sort((a, b) => a - b)
		this.freeColors.push(sp.color)

		this.serverPlayers.delete(client.sessionId)
		this.state.players.delete(client.sessionId)
		this.rebuildSlotsArray()

		console.log(`[sd-mp] ${client.sessionId} left slot ${sp.slot} (now ${this.serverPlayers.size}/${MAX_PLAYERS})`)

		if (this.serverPlayers.size === 0) {
			this.disconnect().catch(() => undefined)
		}
	}

	override onDispose(): void {
		console.log(`[sd-mp] room ${this.roomId} disposed`)
	}

	// -------------------------------------------------------------------------
	// Tick
	// -------------------------------------------------------------------------

	private tick(dt: number): void {
		// Apply latest pending input per player at the current server tick.
		for (const sp of this.serverPlayers.values()) {
			let appliedTick = -1
			let appliedAction = 0
			for (const [tick, action] of sp.pendingInputs) {
				if (tick > this.currentTick) continue
				if (tick > appliedTick) {
					appliedTick = tick
					appliedAction = action
				}
			}
			if (appliedTick >= 0) {
				sp.input.setAction(appliedAction)
				sp.lastAppliedTick = appliedTick
			}
			// Garbage collect stale buckets
			for (const tick of sp.pendingInputs.keys()) {
				if (tick <= appliedTick || tick < this.currentTick - INPUT_STALENESS_TICKS) {
					sp.pendingInputs.delete(tick)
				}
			}
		}

		// Advance only the player-authoritative systems. Other systems (world
		// scroll, obstacle spawn, etc.) stay client-side and agree by seed.
		this.playerMovementSystem(dt)
		this.playerCollisionSystem(dt)

		// Snapshot into schema (auto-diffed by Colyseus to connected clients).
		this.state.tick = this.currentTick
		for (const sp of this.serverPlayers.values()) {
			const wp = this.world.state.players[sp.playerIndex]
			if (!wp) continue
			const ps = this.state.players.get(sp.sessionId)
			if (!ps) continue
			ps.x = wp.x
			ps.y = 0
			ps.z = wp.z
			ps.vx = 0
			ps.vy = 0
			ps.vz = wp.speed * wp.speedMod
			ps.bumpVelX = wp.bumpVelX
			ps.boostActive = wp.boostTimer > 0
			ps.alive = wp.alive
			ps.lastInputTick = sp.lastAppliedTick
		}
		// Drain events the systems pushed (player_bumped). The bumpVelX and x
		// deltas in the schema patch are enough for clients to play their own
		// bump VFX/audio, so we don't re-broadcast — but we do log bumps so the
		// puppeteer smoke can prove `PlayerCollisionSystem` is doing real work
		// over the wire.
		const events = this.world.drainEvents()
		for (const ev of events) {
			if (ev.type === 'player_bumped') {
				console.log(
					`[sd-mp] player_bumped tick=${this.currentTick} pA=${ev.playerA} pB=${ev.playerB} contact=(${ev.contactX.toFixed(2)}, ${ev.contactZ.toFixed(2)})`,
				)
			}
		}

		this.currentTick += 1
	}

	// -------------------------------------------------------------------------
	// Match start
	// -------------------------------------------------------------------------

	private maybeBroadcastStart(): void {
		if (this.startBroadcastSent) return
		if (this.serverPlayers.size < 2) return
		this.startBroadcastSent = true
		this.state.startedAt = Date.now()

		const slotInfos: MatchPlayerInfo[] = []
		for (const sp of this.serverPlayers.values()) {
			slotInfos.push({
				peerId: sp.sessionId,
				name: sp.name,
				color: sp.color,
				playerIndex: sp.playerIndex,
			})
		}
		slotInfos.sort((a, b) => a.playerIndex - b.playerIndex)

		this.broadcast('start', {
			seed: this.state.seed,
			startedAt: this.state.startedAt,
			tick: this.currentTick,
			slots: slotInfos,
		})

		console.log(
			`[sd-mp] match start broadcast — seed=${this.state.seed} startedAt=${this.state.startedAt} slots=${slotInfos.length}`,
		)
	}

	private rebuildSlotsArray(): void {
		this.state.slots.clear()
		const sps = Array.from(this.serverPlayers.values()).sort((a, b) => a.playerIndex - b.playerIndex)
		for (const sp of sps) {
			const s = new SlotSchema()
			s.sessionId = sp.sessionId
			s.slot = sp.slot
			s.color = sp.color
			s.name = sp.name
			s.playerIndex = sp.playerIndex
			this.state.slots.push(s)
		}
	}
}

function sanitizeName(raw: string | undefined): string {
	const cleaned = (raw ?? '').toString().replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 32)
	return cleaned || 'Player'
}

function encodeAction(message: InputMessage): number {
	if (typeof message.action === 'number' && Number.isFinite(message.action)) {
		return Math.trunc(message.action)
	}
	const lateral = message.lateral ?? 0
	const left = lateral < -0.25
	const right = lateral > 0.25
	const shatter = !!message.shatter
	const boost = !!message.boost
	const brake = !!message.brake
	let action = 0
	if (left) action |= 0x01
	if (right) action |= 0x02
	if (shatter) action |= 0x04
	if (boost) action |= 0x08
	if (brake) action |= 0x10
	return action
}
