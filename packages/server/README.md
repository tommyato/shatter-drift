# @sd/server

Placeholder. The Shatter Drift authoritative multiplayer server lands in
**step 2 of the SD MP rewrite**.

This package exists in the monorepo so the workspace wiring already has a real
consumer of `@sd/sim`, and so the layout for the upcoming Colyseus integration
is in place.

## Step 2 (next task) will add

- `colyseus` server with an SD match room
- Authoritative simulation tick driven by `@sd/sim`
- Room schema (player state, obstacle/orb projection, score)
- Build/deploy wiring (Dockerfile, fly.io / DO config)
- Replacement of the current Firestore + WebRTC stack in `@sd/client`

For now the entry point is a single `console.log` — implementation pending.
