# Trailbound World Map

Kingdom-scale camera prototype: zoom from overworld into street-level places. Lives in `world-map/` as its own Angular app. Hub style still applies (json-viewer / `.cursor/rules/ui-style.mdc`).

## Stack

Angular 19 standalone + Material. Canvas renderer for kingdom and street scales; far zoom is a raw WebGL globe in `src/app/engine/globe.ts` (**not** Three.js). `npm start` serves on port **4202**. Engine code in `src/app/engine/` stays free of Angular imports.

## Camera and nodes

The overworld is a biome map. Zooming out past the fitted continent curves the square onto a wrapped globe (equirectangular: `x` → longitude, `y` → latitude). Zooming in flattens back into the canvas map, then into places. **Zoom is node-based**, not “every world tile is playable.” Diving into a place loads (or generates) a zone and **saves it**; diving there again returns the same layout.

- Nodes are **irregular tile blobs** (`MapNode.tiles`), not circles or freeform polygons. Each world tile in the blob is a detail **chunk** (`ZONE_SCALE` inner tiles). Adjacent chunks inform edges.
- Zooming near a node but outside it still dives: the walker stays on overworld coords; the camera presents them at the **edge** of that zone. Outside fades away at street scale.
- **Authored** cities/towns are pre-marked. Small settlements generate on first dive in uncharted land.
- **POIs** are pre-placed and steer generation. Hidden from players; author view is on by default.

Do not go back to continuous rectangle/polygon streaming that broke zoom isolation.

## Simulation

World clock: pause, play, fast forward (8×), **sync** (others move when you move; Space waits a turn). Placeholder people/caravans/armies use `public/assets/characters/` (tf_animals sheets).

## Persist

`localStorage`: seed, generated nodes per seed, outline/POI toggles, sim mode, theme. Chunks are in-memory for the session. “Clear detail” forgets generated places and baked tiles; authored nodes stay.

## Assets and layout

Pixel Kingdom tiles/sprites under `public/assets/`. Models in `src/app/models/world.models.ts`. `WorldService` owns world, player, chunks, entities. Viewport is `map-viewport`; chrome is `shell` + `location-panel`.

## Controls

Scroll zoom (out to globe, in to street), drag pan / orbit, WASD walk, click a traveler to zoom in. Toolbar: node outlines, POI author view, sim, recenter, new seed, clear detail.
