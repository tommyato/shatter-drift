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
 */

export interface SpatialHashEntry {
	id: number
	x: number
	z: number
	radius: number
}

export class SpatialHash {
	private cellSize: number
	private cells: Map<string, number[]>
	private entries: Map<number, SpatialHashEntry>
	private queryResult: number[]

	/**
	 * @param cellSize Grid cell dimension. Default 6.0 is tuned for SD obstacle scale.
	 *                 Rule of thumb: ~2× max entity radius for best performance.
	 */
	constructor(cellSize: number = 6.0) {
		this.cellSize = cellSize
		this.cells = new Map()
		this.entries = new Map()
		this.queryResult = []
	}

	private getCellKey(x: number, z: number): string {
		const cx = Math.floor(x / this.cellSize)
		const cz = Math.floor(z / this.cellSize)
		return `${cx},${cz}`
	}

	private getCellsForEntry(entry: SpatialHashEntry): string[] {
		const minX = entry.x - entry.radius
		const maxX = entry.x + entry.radius
		const minZ = entry.z - entry.radius
		const maxZ = entry.z + entry.radius

		const minCellX = Math.floor(minX / this.cellSize)
		const maxCellX = Math.floor(maxX / this.cellSize)
		const minCellZ = Math.floor(minZ / this.cellSize)
		const maxCellZ = Math.floor(maxZ / this.cellSize)

		const keys: string[] = []
		for (let cx = minCellX; cx <= maxCellX; cx++) {
			for (let cz = minCellZ; cz <= maxCellZ; cz++) {
				keys.push(`${cx},${cz}`)
			}
		}
		return keys
	}

	/**
	 * Insert or update an entity in the hash.
	 */
	insert(id: number, x: number, z: number, radius: number): void {
		this.remove(id)

		const entry: SpatialHashEntry = { id, x, z, radius }
		this.entries.set(id, entry)

		const cellKeys = this.getCellsForEntry(entry)
		for (const key of cellKeys) {
			let cell = this.cells.get(key)
			if (!cell) {
				cell = []
				this.cells.set(key, cell)
			}
			cell.push(id)
		}
	}

	/**
	 * Remove an entity from the hash.
	 */
	remove(id: number): void {
		const entry = this.entries.get(id)
		if (!entry) return

		const cellKeys = this.getCellsForEntry(entry)
		for (const key of cellKeys) {
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

		this.entries.delete(id)
	}

	/**
	 * Query entities within a circle.
	 * Returns a reused array reference — copy if you need to keep results across frames.
	 * Results are sorted by ID for deterministic iteration order.
	 */
	queryCircle(x: number, z: number, radius: number): readonly number[] {
		this.queryResult.length = 0

		const minX = x - radius
		const maxX = x + radius
		const minZ = z - radius
		const maxZ = z + radius

		const minCellX = Math.floor(minX / this.cellSize)
		const maxCellX = Math.floor(maxX / this.cellSize)
		const minCellZ = Math.floor(minZ / this.cellSize)
		const maxCellZ = Math.floor(maxZ / this.cellSize)

		const seen = new Set<number>()

		for (let cx = minCellX; cx <= maxCellX; cx++) {
			for (let cz = minCellZ; cz <= maxCellZ; cz++) {
				const key = `${cx},${cz}`
				const cell = this.cells.get(key)
				if (!cell) continue

				for (const id of cell) {
					if (seen.has(id)) continue
					seen.add(id)

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

		const minCellX = Math.floor(minX / this.cellSize)
		const maxCellX = Math.floor(maxX / this.cellSize)
		const minCellZ = Math.floor(minZ / this.cellSize)
		const maxCellZ = Math.floor(maxZ / this.cellSize)

		const seen = new Set<number>()

		for (let cx = minCellX; cx <= maxCellX; cx++) {
			for (let cz = minCellZ; cz <= maxCellZ; cz++) {
				const key = `${cx},${cz}`
				const cell = this.cells.get(key)
				if (!cell) continue

				for (const id of cell) {
					if (seen.has(id)) continue
					seen.add(id)

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
