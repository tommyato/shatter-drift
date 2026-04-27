#!/usr/bin/env node
/**
 * Unit tests for SpatialHash broadphase.
 *
 * Covers the dedup path specifically: entities spanning multiple cells must
 * appear exactly once in query results regardless of how many cells they touch.
 *
 * Usage: node verify-spatial-hash.mjs [--verbose]
 */

import { pathToFileURL } from 'node:url'

const verbose = process.argv.includes('--verbose')
const url = pathToFileURL(new URL('./dist/spatial-hash.mjs', import.meta.url).pathname).href
const mod = await import(url)
const { SpatialHash } = mod

let passed = 0
let failed = 0

function assert(cond, msg) {
	if (cond) {
		passed++
		if (verbose) console.log(`  ✓ ${msg}`)
	} else {
		failed++
		console.error(`  ✗ FAIL: ${msg}`)
	}
}

// ==========================================================================
// Test 1: Large-radius entity spans multiple cells — returned exactly once
// ==========================================================================
console.log('\n▶ Dedup: large entity spanning multiple cells')
{
	const sh = new SpatialHash(6.0)
	// radius=10 at origin spans at least 9 cells (3×3 in cell space)
	sh.insert(0, 0, 0, 10)

	const result = sh.queryCircle(0, 0, 10)
	assert(result.length === 1, `Entity returned exactly once (got ${result.length})`)
	assert(result[0] === 0, 'Correct id returned')
}

// ==========================================================================
// Test 2: Multiple entities in adjacent cells all returned, no duplicates
// ==========================================================================
console.log('\n▶ Multi-entity query: all found, no duplicates')
{
	const sh = new SpatialHash(6.0)
	// Place 5 entities in a cluster; some will share cells
	for (let i = 0; i < 5; i++) {
		sh.insert(i, i * 3, 0, 4) // radius 4 means adjacent entities share cells
	}

	const result = sh.queryCircle(6, 0, 20) // query wide enough to hit all
	assert(result.length === 5, `All 5 entities returned (got ${result.length})`)
	// Check no duplicates by verifying sorted unique ids
	const unique = [...new Set(result)]
	assert(unique.length === result.length, 'No duplicate ids in result')
}

// ==========================================================================
// Test 3: Entities outside radius not returned
// ==========================================================================
console.log('\n▶ Out-of-range entities excluded')
{
	const sh = new SpatialHash(6.0)
	sh.insert(0, 0, 0, 1)   // inside query
	sh.insert(1, 100, 0, 1) // far away

	const result = sh.queryCircle(0, 0, 5)
	assert(result.length === 1, `Only near entity returned (got ${result.length})`)
	assert(result[0] === 0, 'Near entity id=0 returned')
}

// ==========================================================================
// Test 4: Remove actually removes from all cells
// ==========================================================================
console.log('\n▶ Remove clears entity from all cells')
{
	const sh = new SpatialHash(6.0)
	sh.insert(7, 0, 0, 10) // spans multiple cells
	sh.remove(7)

	const result = sh.queryCircle(0, 0, 15)
	assert(result.length === 0, `Removed entity not found (got ${result.length})`)
}

// ==========================================================================
// Test 5: queryAABB dedup — large entity spans multiple cells, returned once
// ==========================================================================
console.log('\n▶ queryAABB dedup: large entity spans multiple cells')
{
	const sh = new SpatialHash(6.0)
	sh.insert(42, 0, 0, 10) // spans ≥9 cells
	const result = sh.queryAABB(-20, -20, 20, 20)
	assert(result.length === 1, `AABB: entity returned exactly once (got ${result.length})`)
	assert(result[0] === 42, 'Correct id returned via AABB query')
}

// ==========================================================================
// Test 6: Integer key uniqueness — cells at ±32k boundary don't collide
// ==========================================================================
console.log('\n▶ Key uniqueness at coordinate extremes')
{
	const sh = new SpatialHash(1.0) // 1-unit cells so cell coord ≈ world coord
	// Insert at opposite corners of the ±32k range
	sh.insert(0,  32000,  32000, 0.4)
	sh.insert(1, -32000, -32000, 0.4)
	sh.insert(2,  32000, -32000, 0.4)
	sh.insert(3, -32000,  32000, 0.4)

	// Each should only appear in their own query.
	// queryCircle returns a reused array — copy before the next query call.
	const r0 = [...sh.queryCircle( 32000,  32000, 1)]
	const r1 = [...sh.queryCircle(-32000, -32000, 1)]
	assert(r0.length === 1 && r0[0] === 0, 'Corner (+,+) finds only id=0')
	assert(r1.length === 1 && r1[0] === 1, 'Corner (-,-) finds only id=1')
}

// ==========================================================================
// Test 7: Determinism — results sorted by id
// ==========================================================================
console.log('\n▶ Results sorted by id (determinism)')
{
	const sh = new SpatialHash(6.0)
	// Insert in reverse id order so insertion order != id order
	for (let i = 9; i >= 0; i--) {
		sh.insert(i, 0, 0, 1)
	}

	const result = sh.queryCircle(0, 0, 5)
	assert(result.length === 10, `All 10 entities returned (got ${result.length})`)
	let sorted = true
	for (let i = 1; i < result.length; i++) {
		if (result[i] < result[i - 1]) { sorted = false; break }
	}
	assert(sorted, 'Results are sorted ascending by id')
}

console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
