---
phase: 1
parent: multiplayer-survival
title: Lobby + WebRTC mesh transport
created: 2026-04-25
status: planned
---

# Phase 1 — Lobby + WebRTC Mesh Transport

## Goal

Players can create or join a lobby via 6-char code, see other players in the lobby, and exchange action frames over WebRTC. The transport layer is end-to-end working: each peer can send and receive action ints + ack timestamps. **No game logic changes** — Phase 1 ships a transport substrate that the singleplayer sim ignores. SD remains fully playable as singleplayer; lobby is a button on the title screen.

## Carryover Context (for cold-read sessions)

- SD is at HEAD `da442e2` as of plan creation. Fully ECS-refactored, deterministic sim, action int per tick.
- CC's `gamedevjs-2026-entry/src/multiplayer.ts` has the working WebRTC + Firebase signaling pattern. Read it first; this phase is largely a port.
- Plans 1 and 2 (`seeded-ghost-racing-plan.md`, `boost-brake-gamepad-plan.md`) ship before this. By the time this phase runs, ghost racing is seeded and boost/brake are in the action int.

## Sprints

- [ ] **Sprint 1.1 — Signaling client.** Reuse CC's Firebase signaling. Implement `LobbyClient` with `createLobby() → code`, `joinLobby(code) → peerList`, `leaveLobby()`. Verify two browsers can find each other via the same code.
- [ ] **Sprint 1.2 — WebRTC peer connections.** Mesh: each peer creates RTCPeerConnections to every other peer in the lobby. Use SCTP data channels (ordered, reliable). Verify message round-trip between two peers.
- [ ] **Sprint 1.3 — Lobby UI.** Title screen "MULTIPLAYER" button (next to existing buttons in the adjacency table — extend `applyTitleMenuScope()` if needed). Modal with: CREATE LOBBY (shows code + player list), JOIN (text input for code), LEAVE.
- [ ] **Sprint 1.4 — Action frame protocol.** Define `InputFrame { tick: number, action: number, playerIndex: number }`. Send your own each tick; queue received frames by tick + index. Don't connect to sim yet — just verify queues fill correctly.
- [ ] **Sprint 1.5 — Build version handshake.** Embed `import.meta.env.BUILD_HASH` (or git short-sha at build time) in the lobby join handshake. Reject join on mismatch with clear message. Avoids sneaky desync bugs from stale clients.

## Verification

- Sprint 1.1: open two browsers in incognito, create lobby in one, join in the other — see each other's player names.
- Sprint 1.2: console-log message round-trip between peers.
- Sprint 1.3: navigate the lobby with keyboard / gamepad, verify button states.
- Sprint 1.4: log received-frame queue depth — should accumulate while no peer is consuming, drain when consumed.
- Sprint 1.5: deploy two different builds, attempt to join, expect graceful rejection.

## Files

| File | Change |
|---|---|
| `src/multiplayer.ts` | **NEW** — `LobbyClient`, `MeshTransport`, `InputFrame` |
| `src/game.ts` | Lobby modal UI + title button |
| `src/menu-navigation.ts` | Lobby modal scope (push/pop) |
| `vite.config.ts` | Inject `BUILD_HASH` env var at build |

## Acceptance for Phase Done

- [ ] Two browsers can join the same lobby and exchange `InputFrame` messages
- [ ] Lobby UI is keyboard- and gamepad-navigable
- [ ] Singleplayer game still works identically (no regressions)
- [ ] Build hash mismatch is detected and refuses join cleanly
