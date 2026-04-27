/**
 * 2D Spatial Hash Broadphase
 *
 * Partitions 2D space into fixed-size cells for efficient proximity queries.
 * Converts O(n²) all-pairs collision checks into O(n) local neighborhood checks.
 *
 * Cell size is tuned for Shatter Drift obstacle scale (~2× max entity radius).
 * Typical SD obstacle halfWidth is 1-3 units; player collision radius is 0.4.
 * Default cell size of 6 units provides good balance between false positives
 * and spatial resolution.
 *
 * Hot-path allocation policy: zero per-call allocations after warmup.
 * - Cell keys are bit-packed integers (no string allocation).
 * - querySeen dedup set is instance-scoped and .clear()ed per query.
 * - Cell loop is inlined into insert/remove (no helper array).
 */

export interface SpatialHashEntry {
	id: number
	x: number
	z: number
	radius: number
}

export class SpatialHash {
	private cellSize: number
	private cells: Map<number, number[]>
	private entries: Map<number, SpatialHashEntry>
	private queryResult: number[]
	private querySeen: Set<number>

	/**
	 * @param cellSize Grid cell dimension. Default 6.0 is tuned for SD obstacle scale.
	 *                 Rule of thumb: ~2× max entity radius for best performance.
	 */
	constructor(cellSize: number = 6.0) {
		this.cellSize = cellSize
		this.cells = new Map()
		this.entries = new Map()
		this.queryResult = []
		this.querySeen = new Set()
	}

	/**
	 * Pack cell coordinates into a single integer key.
	 * Bias +32768 maps the ±32k cell range into unsigned 16-bit halves.
	 * SD world fits comfortably within ±32k cells at the default cell size.
	 * Result is a signed Int32 (bitwise ops in JS use Int32); valid as a Map key.
	 */
	private getCellKey(cx: number, cz: number): number {
		return ((cx + 32768) << 16) | ((cz + 32768) & 0xffff)
	}

	/**
	 * Insert or update an entity in the hash.
	 */
	insert(id: number, x: number, z: number, radius: number): void {
		this.remove(id)

		const entry: SpatialHashEntry = { id, x, z, radius }
		this.entries.set(id, entry)

		const minCellX = Math.floor((x - radius) / this.cellSize)
		const maxCellX = Math.floor((x + radius) / this.cellSize)
		const minCellZ = Math.floor((z - radius) / this.cellSize)
		const maxCellZ = Math.floor((z + radius) / this.cellSize)

		for (let cx = minCellX; cx <= maxCellX; cx++) {
			for (let cz = minCellZ; cz <= maxCellZ; cz++) {
				const key = this.getCellKey(cx, cz)
				let cell = this.cells.get(key)
				if (!cell) {
					cell = []
					this.cells.set(key, cell)
				}
				cell.push(id)
			}
		}
	}

	/**
	 * Remove an entity from the hash.
	 */
	remove(id: number): void {
		const entry = this.entries.get(id)
		if (!entry) return

		const minCellX = Math.floor((entry.x - entry.radius) / this.cellSize)
		const maxCellX = Math.floor((entry.x + entry.radius) / this.cellSize)
		const minCellZ = Math.floor((entry.z - entry.radius) / this.cellSize)
		const maxCellZ = Math.floor((entry.z + entry.radius) / this.cellSize)

		for (let cx = minCellX; cx <= maxCellX; cx++) {
			for (let cz = minCellZ; cz <= maxCellZ; cz++) {
				const key = this.getCellKey(cx, cz)
				const cell = this.cells.get(key)
				if (cell) {
					const index = cell.indexOf(id)
					if (index !== -1) {
						cell.splice(index, 1)
					}
					if (cell.length === 0) {
						this.cells.delete(key)
					}
				}
			}
		}

		this.entries.delete(id)
	}

	/**
	 * Query entities within a circle.
	 * Returns a reused array reference — copy if you need to keep results across frames.
	 * Results are sorted by ID for deterministic iteration order.
	 */
	queryCircle(x: number, z: number, radius: number): readonly number[] {
		this.queryResult.length = 0
		this.querySeen.clear()

		const minCellX = Math.floor((x - radius) / this.cellSize)
		const maxCellX = Math.floor((x + radius) / this.cellSize)
		const minCellZ = Math.floor((z - radius) / this.cellSize)
		const maxCellZ = Math.floor((z + radius) / this.cellSize)

		for (let cx = minCellX; cx <= maxCellX; cx++) {
			for (let cz = minCellZ; cz <= maxCellZ; cz++) {
				const key = this.getCellKey(cx, cz)
				const cell = this.cells.get(key)
				if (!cell) continue

				for (const id of cell) {
					if (this.querySeen.has(id)) continue
					this.querySeen.add(id)

					const entry = this.entries.get(id)
					if (!entry) continue

					// Broadphase: circle-circle overlap check
					const dx = entry.x - x
					const dz = entry.z - z
					const distSq = dx * dx + dz * dz
					const radiusSum = entry.radius + radius
					if (distSq <= radiusSum * radiusSum) {
						this.queryResult.push(id)
					}
				}
			}
		}

		// Sort for deterministic iteration order (required for sim determinism)
		this.queryResult.sort((a, b) => a - b)

		return this.queryResult
	}

	/**
	 * Query entities within an axis-aligned bounding box.
	 * Returns a reused array reference — copy if you need to keep results across frames.
	 * Results are sorted by ID for deterministic iteration order.
	 */
	queryAABB(minX: number, minZ: number, maxX: number, maxZ: number): readonly number[] {
		this.queryResult.length = 0
		this.querySeen.clear()

		const minCellX = Math.floor(minX / this.cellSize)
		const maxCellX = Math.floor(maxX / this.cellSize)
		const minCellZ = Math.floor(minZ / this.cellSize)
		const maxCellZ = Math.floor(maxZ / this.cellSize)

		for (let cx = minCellX; cx <= maxCellX; cx++) {
			for (let cz = minCellZ; cz <= maxCellZ; cz++) {
				const key = this.getCellKey(cx, cz)
				const cell = this.cells.get(key)
				if (!cell) continue

				for (const id of cell) {
					if (this.querySeen.has(id)) continue
					this.querySeen.add(id)

					const entry = this.entries.get(id)
					if (!entry) continue

					// Broadphase: circle-AABB overlap check
					const entryMinX = entry.x - entry.radius
					const entryMaxX = entry.x + entry.radius
					const entryMinZ = entry.z - entry.radius
					const entryMaxZ = entry.z + entry.radius

					if (entryMaxX >= minX && entryMinX <= maxX && entryMaxZ >= minZ && entryMinZ <= maxZ) {
						this.queryResult.push(id)
					}
				}
			}
		}

		// Sort for deterministic iteration order (required for sim determinism)
		this.queryResult.sort((a, b) => a - b)

		return this.queryResult
	}

	/**
	 * Clear all entries from the hash.
	 */
	clear(): void {
		this.cells.clear()
		this.entries.clear()
		this.queryResult.length = 0
	}
}
