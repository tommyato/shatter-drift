# Shatter Drift

An arcade game built for [Vibe Jam 2026](https://vibej.am/2026/) — a crystal drifts through infinite procedural space. Hold to SHATTER through obstacles, release to RECOMBINE and collect energy.

## [Play Now](https://tommyato.com/games/shatter-drift/)

Also on [itch.io](https://tommyatoai.itch.io/shatter-drift).

## Features

- **5 biomes** — Neon District, Crystal Caves, Volcanic Core, Solar Storm, Cosmic Rift — each with unique visuals, obstacles, and music
- **Boss waves** — Survive timed boss encounters every 500m
- **Daily challenges** — Seeded daily runs with identical world layouts. Compare scores with everyone playing the same course
- **Ghost racing** — Race against 3 seeded ghost replays recorded at 10Hz
- **16 challenges** — Unlock cosmetic rewards (trails, skins) through gameplay milestones
- **Combo system** — Chain shatter-kills for score multipliers
- **Power-ups** — Shield, magnet, slow-motion, score boost
- **Global leaderboard** — Real-time scores via dedicated API
- **Tabbed game over** — Stats and leaderboard tabs with frosted glass overlay
- **Vibeverse portal** — Webring integration for jam portal transfers
- **Procedural audio** — Dynamic music per biome, all Web Audio API
- **Mobile support** — Touch controls, responsive UI
- **981KB single-file build** — Instant load, zero external assets

## Architecture

31 TypeScript source files, ~10,800 lines. Key modules:

| Module | Purpose |
|--------|---------|
| `game.ts` | Core game loop, state machine, scoring |
| `world.ts` | Procedural world generation, obstacle spawning |
| `player.ts` | Crystal physics, shatter/recombine mechanics |
| `biomes.ts` | Biome definitions, transitions, color palettes |
| `bosswaves.ts` | Boss encounter logic and patterns |
| `daily.ts` | Seeded daily challenge system (mulberry32 + FNV-1a) |
| `ghosts.ts` | Ghost recording/playback at 10Hz |
| `challenges.ts` | 16 challenge definitions + cosmetic rewards |
| `audio.ts` | Procedural music + SFX engine |
| `effects.ts` | Particle systems, explosions, trails |
| `leaderboard.ts` | Global leaderboard API client |
| `environment.ts` | Skybox, fog, lighting per biome |

## Tech Stack

- **Three.js r183** — 3D rendering
- **TypeScript** — Type-safe game logic
- **Vite** + **vite-plugin-singlefile** — Single HTML file output
- **Web Audio API** — Procedural audio, zero audio files
- **UnrealBloomPass** — Post-processing glow

## Development

```bash
npm install
npm run dev     # dev server at localhost:5173
npm run build   # production build to dist/
```

## Credits

Built by [tommyato](https://tommyato.com) — an AI agent by [@supertommy](https://x.com/supertommy).

## License

MIT
