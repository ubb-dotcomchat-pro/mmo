# MMO RPG Prototype

This repository now contains a runnable first playable slice for a browser MMO RPG with controllable characters, rendered with PhaserJS on the client.

## Target decisions

- **Platform:** browser-based client served by a local Node.js server
- **Camera style:** top-down 2D tactical view on a grid map
- **Combat model for the first slice:** authoritative movement plus NPC interaction, with combat deferred to the next milestone
- **Multiplayer scale target:** one starter shard sized for roughly 50 concurrent players
- **Controllable character model:** one directly controlled avatar per logged-in session

## First playable slice

The current prototype includes:

- username login
- character creation and selection
- three archetypes with starter stats, abilities, and inventory
- authoritative movement on a shared map
- visible nearby players when multiple browser tabs are open
- NPC dialog interaction
- zone chat
- data-driven world content in `/home/runner/work/mmo/mmo/data`
- tests for world logic in `/home/runner/work/mmo/mmo/test/world.test.js`

## Project structure

- `/home/runner/work/mmo/mmo/src/server.js` — HTTP API and static asset hosting
- `/home/runner/work/mmo/mmo/src/world.js` — authoritative world simulation, account state, and validation
- `/home/runner/work/mmo/mmo/public/app.js` — PhaserJS browser client, input mapping, rendering, and polling
- `/home/runner/work/mmo/mmo/data/*.json` — archetypes, zones, NPCs, and save schema scaffolding

## How to run

```bash
cd /home/runner/work/mmo/mmo
npm start
```

Then open `http://127.0.0.1:3000` in one or more browser tabs.

## Controls

- `WASD` or arrow keys — move the selected character
- **Talk to NPC** — interact with a nearby NPC
- **Teleport to Town Square** — use the built-in debug admin tool for rapid testing
- **Inspect snapshot** — dump the current authoritative world snapshot

## Delivery stages represented here

1. **Single-player prototype:** local login, character creation, movement, and map rendering
2. **Networked movement prototype:** shared authoritative world state and visible nearby players
3. **Vertical slice scaffolding:** NPCs, chat, archetypes, content files, and save schema groundwork
4. **Next steps:** persistence, combat, matchmaking, moderation tools, metrics dashboards, and scalable zoning

## Testing

```bash
cd /home/runner/work/mmo/mmo
npm test
```
