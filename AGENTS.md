# Trailbound World Map

Kingdom-scale camera prototype: zoom from overworld into street-level places. Lives in `world-map/` as its own Angular app. Hub style still applies (json-viewer / `.cursor/rules/ui-style.mdc`).

## Stack

Angular 19 standalone + Material. Canvas renderer for kingdom and street scales; far zoom is a raw WebGL globe in `src/app/engine/globe.ts` (**not** Three.js). `npm start` serves on port **4202**. Engine code in `src/app/engine/` stays free of Angular imports.

## Camera and nodes

The overworld is a biome map. **Planet view** (Settings, on by default) is a separate globe mode: zoom from space down to street on the sphere, with the same tiles, places, and people as the flat map. Off (and adventure mode) is a flat continent; zoom-out stops when the map fits. **Zoom is node-based**, not “every world tile is playable.” Diving into a place loads (or generates) a zone and **saves it**; diving there again returns the same layout. Unexplored land is covered in **clouds**; street/character zoom is blocked there until you adventure in (walk from a known place).

- Nodes are **irregular tile blobs** (`MapNode.tiles`), not circles or freeform polygons. Each world tile in the blob is a detail **chunk** (`ZONE_SCALE` inner tiles). Adjacent chunks inform edges. On the globe, those blobs show as county-colored patches (Zone overlay slider).
- Dive uses the world tile under the walker (adventure) or camera (map view). If that tile belongs to a visited place, that place loads at your actual position, including edge cells. If it is uncharted land, scrolling in generates a new region there. Walking off an isolated place into uncharted land leaves isolation (zoom back to the map); zoom in again to mint a **new** place there, rather than growing the one you left. Clouds still mark land you have not visited.
- At street scale the current place is isolated with a shadowed fog border.
- **Authored** cities/towns are pre-marked (cities are large blobs, towns and groves smaller). Generated places use a kind-based radius; a 2× / 4× / 8× roll (or a shrink) plus rotated lobes so some wilderness pockets are mini open-world maps and some stay small.
- **POIs** are pre-placed and steer generation. Author overlay (map dock / settings) shows every marker. In adventure mode with the overlay off, a POI only appears after you enter its site or form a neighboring place.
- **World markers** (default on) keep travelers, caravans, and hosts on the map even through isolation fog or unexplored land.
- Default load: **8×** continent, **adventure mode on**, camera at **Close (32×)** in the starting town. **Adventure** opens a name + look picker, then remakes the map and dives in. The walker is a named Time Fantasy sprite so a later hosted session can reuse the same player shape.

Do not go back to continuous rectangle/polygon streaming that broke zoom isolation.

## Simulation

World clock: pause, play (slow), fast forward, fastest, **sync** (others move when you move; Space waits a turn). People use Time Fantasy character sheets under `public/assets/characters/` (townsfolk, knights, dwarves, elves, animals, horses). On water they switch to a boat (one hull for the whole party) and sail until they beach. Armies carry a large marching roster; far zoom shows a compact marker/trail, and street zoom fills in many soldiers in formation.

## Persist

`localStorage`: seed, generated nodes per seed, visited authored places (fog of war), outline/POI/world-marker toggles, zone overlay, cloud fog, sim mode, planet view, adventure flags, world setup, hero name/look, theme. Chunks are in-memory for the session. “Clear detail” forgets generated places and baked tiles; authored nodes stay (visited holes remain). A prefs version bump resets stale setup/adventure/planet keys once, then keeps persisting new choices.

## Assets and layout

Pixel Kingdom tiles/sprites under `public/assets/`. Models in `src/app/models/world.models.ts`. `WorldService` owns world, player, chunks, entities. Viewport is `map-viewport`; chrome is `shell` + `location-panel`.

## Controls

Scroll zoom (out to space in planet view, in to street on explored land), drag pan / orbit. Adventure mode adds a walker (WASD, **Shift** to sprint) and stays on the fitted continent. Toolbar: **Adventure**, clock, zoom, settings (overlays + clear/new seed), theme. Map dock: outlines, POIs, world markers.
