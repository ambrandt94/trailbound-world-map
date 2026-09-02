# Trailbound World Map

Kingdom-scale camera prototype: zoom from a biome overworld into street-level places. Standalone Angular app in `world-map/`. Hub visual style matches `json-viewer/` (see `../.cursor/rules/ui-style.mdc`).

Canvas renderer for the overworld and street zoom. Far zoom is a raw WebGL globe (`src/app/engine/globe.ts`), not Three.js. Engine code in `src/app/engine/` stays free of Angular imports.

## Live site

https://ambrandt94.github.io/trailbound-world-map/

Deployed from `main` via GitHub Actions (`.github/workflows/deploy-pages.yml`). In the repo **Settings → Pages**, set **Source** to **GitHub Actions** (not “Deploy from a branch”).

## Run

```bash
npm install
npm start
```

Open `http://localhost:4202/`.

Production / Pages build:

```bash
npm run build:pages
```

## Controls

- Scroll to zoom — past the fitted continent the map curves onto a globe; zoom in to flatten, then dive into places
- Drag to pan the map or orbit the globe; WASD to walk
- Click a traveler to zoom in
- Toolbar: node outlines, POI author view, sim clock, recenter, zoom, new seed, clear detail, settings, theme
- In **sync** sim mode, Space waits a turn

## Camera and nodes

The overworld is a biome map. Zooming out past the fitted continent wraps the square onto a globe (`x` → longitude, `y` → latitude). Zooming in flattens back to the canvas map. **Zoom is node-based**, not “every world tile is playable.” Diving into a place loads (or generates) a zone and **saves it**; diving there again returns the same layout.

- Nodes are **irregular tile blobs** (`MapNode.tiles`), not circles or freeform polygons. Each world tile in the blob is a detail **chunk** (`ZONE_SCALE` inner tiles). Adjacent chunks inform edges.
- Zooming near a node but outside it still dives: the walker stays on overworld coords; the camera presents them at the **edge** of that zone. At street scale the place is isolated with a shadowed fog border — panning does not spawn new zones or stream wilderness.
- **Authored** cities/towns are pre-marked (Ashfen, Goldmere, Saltgate, Veldcross, plus groves/camps). Small settlements generate on first dive in uncharted land and are saved.
- **POIs** are pre-placed and steer generation. Hidden from players; author view is on by default. Diving a POI creates a settlement-sized zone around it, not a tiny marker blob.

Do not go back to continuous rectangle/polygon streaming that broke zoom isolation.

## Adventure mode

Debug toggle in **Settings**. Off by default (persisted).

- Zoom into a mapped place to isolate it.
- Walk off the edge while zoomed in to generate a new region (zoom stays put).
- Zooming into uncharted land from the overworld asks first, then dives in close.
- **Load adjacent regions**: off loads only the current place (neighbors stay behind fog until you walk in); on streams touching mapped places together.

## Simulation

World clock: pause, play, fast forward (8×), **sync** (others move when you move; Space waits a turn). Placeholder people, caravans, and armies use `public/assets/characters/` (tf_animals sheets).

## World setup

Overlay panel: continent scale (`1×`–`8×` of a 192-tile base), land shape (continent, isles, isthmus, lakes, highlands), POI/traveler/caravan/host counts. **Rebuild** keeps the seed; **New seed** rolls a new kingdom.

## Persist

`localStorage`: seed, generated nodes per seed, outline/POI toggles, sim mode, world setup, theme, adventure flags. Chunks are in-memory for the session. **Clear detail** forgets generated places and baked tiles; authored nodes stay.

## Layout

- `src/app/models/world.models.ts` — types, zoom constants, wrap / globe scale helpers, tile-blob / adventure-region helpers
- `src/app/services/world.service.ts` — world, player, chunks, entities, sim
- `src/app/services/preferences.service.ts` — theme and adventure toggles
- `src/app/components/map-viewport/` — canvas + WebGL globe layer, camera, dive / adventure confirm
- `src/app/components/shell/` — toolbar chrome
- `src/app/components/location-panel/` — status overlay (View band includes Globe)
- `src/app/components/world-setup/` — generation settings
- `src/app/components/settings-panel/` — adventure debug options
- `src/app/engine/` — world-gen, chunk-gen, renderer, globe, projection, tileset, entities, POIs, names, assets (no Angular)

Pixel Kingdom tiles and sprites live under `public/assets/`.
