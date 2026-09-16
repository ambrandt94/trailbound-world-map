# Trailbound World Map

Kingdom-scale camera prototype: zoom from a biome overworld into street-level places. Standalone Angular app in `world-map/`. Hub visual style matches `json-viewer/` (see `../.cursor/rules/ui-style.mdc`).

Canvas renderer for the overworld and street zoom (Pixel Kingdom grasslands atlas). Far zoom is a raw WebGL globe (`src/app/engine/globe.ts`), not Three.js. Engine code in `src/app/engine/` stays free of Angular imports.

## Live site

https://ambrandt94.github.io/trailbound-world-map/

Deployed from `main` via GitHub Actions (`.github/workflows/deploy-pages.yml`). In the repo **Settings → Pages**, set **Source** to **GitHub Actions** (not “Deploy from a branch”).

Commit, push, and deploy in one step (message required when the tree is dirty):

```bash
npm run ship -- "Commit message"
```

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

- Scroll to zoom — with **Planet view** on, you stay on the globe from space down to street on **explored** land; clouds cover the rest. Off, and in adventure mode, the map is flat.
- Drag to pan the map or orbit the globe
- **Start adventure**: remakes the kingdom, turns on adventure mode, and zooms to Close (32×) in the starting town
- **Planet view** (Settings): a globe you can zoom all the way into (on explored land). Off keeps a flat continent map.
- Click a traveler in explored land to zoom in
- Toolbar: Room (PIN lobby), Adventure, sim clock, recenter, zoom, settings, theme
- In **sync** sim mode, Space waits a turn

## Online rooms

**Room** opens a peer-to-peer lobby (Trystero over MQTT). Create a room to get a 4-digit PIN, or join with one. Members share the host’s world seed and all start in Ashfen. Walkers see each other on the map; the bottom chat bar sends short speech bubbles over sprites. No dedicated game server yet (fine for prototypes; NAT can flake).

## Camera and nodes

The overworld is a biome map. With **Planet view** on, you stay on the globe (`x` → longitude, `y` → latitude) from space down to street; the same tiles, places, and people as the flat map wrap around the sphere. Off, and in adventure mode, the map stays flat. **Zoom is node-based**, not “every world tile is playable.” Diving into a place loads (or generates) a zone and **saves it**; diving there again returns the same layout.

- Nodes are **irregular tile blobs** (`MapNode.tiles`), not circles or freeform polygons. Each world tile in the blob is a detail **chunk** (`ZONE_SCALE` inner tiles). Adjacent chunks inform edges.
- Dive uses the world tile under the camera (or walker). If that tile belongs to a **visited** place, that place loads at your actual position, including edge cells. Uncharted land is under **clouds**; scrolling in while standing there generates a new region. In adventure mode a place only initializes if the walker is on that tile.
- At street scale the place is isolated with a shadowed fog border. Inside a place you can zoom in close, or zoom out until the whole instance fits. One extra zoom-out past that fitted view returns to the overworld map.
- **Authored** cities/towns are pre-marked (Ashfen, Goldmere, and Saltgate are cities; Ironmarch and Sunspire are towns; Shadowglen / Mythwood / Jadewild groves; Dunharrow camp). Generated places pick a kind-based size, with 2× / 4× / 8× (and occasional shrink) rolls plus rotated/lobed outlines.
- **POIs** are pre-placed and steer generation (ruins, wizard towers, dragon lairs, temples, orc forts, and more). Author overlay (map dock) shows every marker when on. In adventure mode with the overlay off, a POI only appears after you walk through it or zoom into a detail chunk on/adjacent to it. Diving a POI creates a settlement-sized zone around it.
- Default: **8×** continent, adventure mode **on**, camera at **Close (32×)**. **Start adventure** rolls a new seed and dives in again.

Do not go back to continuous rectangle/polygon streaming that broke zoom isolation.

## Adventure mode

On by default (persisted). **Start adventure** remakes the map and zooms to Close (32×).

- Off: map viewer — pan and zoom, no player character. Planet view is a globe you can zoom into.
- On: a walker appears at the starting town, already at Close zoom. WASD to move, **Shift** to sprint. Scroll zoom matches map view (through to street and character). A place only loads if the walker is on that tile; zooming in on wilderness generates a region underfoot. Zoom-out stays on the fitted continent (no globe).
- Walk off the edge while zoomed in to generate a new region (zoom stays put). That punches a hole in the clouds.
- Clouds still mark land you have not visited; they do not block scroll zoom while you are standing there.
- **Load adjacent regions**: off loads only the current place (neighbors stay behind fog until you walk in); on streams touching mapped places together.

## Simulation

World clock: pause, play, fast forward (8×), **sync** (others move when you move; Space waits a turn). Placeholder people, caravans, and armies use `public/assets/characters/` (tf_animals sheets).

## World setup

Overlay panel: continent scale (`1×`–`16×` of a 192-tile base), land shape (continent, isles, isthmus, lakes, highlands, **custom**), POI/traveler/caravan/host counts. **Rebuild** keeps the seed; **New seed** rolls a new kingdom. Custom shows a sketch pad (draw, erase, undo/redo). Blank ink stays ocean; coasts are warped a little so the result follows the silhouette without tracing it.

## Persist

`localStorage`: seed, generated nodes per seed, visited authored places, outline/POI toggles, sim mode, world setup, theme, planet view, adventure flags. Chunks are in-memory for the session. **Clear detail** forgets generated places and baked tiles; authored nodes stay. A prefs version bump clears stale setup/adventure/planet keys once, then keeps saving new choices.

## Layout

- `src/app/models/world.models.ts` — types, zoom constants, wrap / globe scale helpers, tile-blob / adventure-region helpers
- `src/app/services/world.service.ts` — world, player, chunks, entities, sim
- `src/app/services/preferences.service.ts` — theme, planet view, and adventure toggles
- `src/app/components/map-viewport/` — canvas + WebGL globe layer, camera, dive / adventure confirm
- `src/app/components/shell/` — toolbar chrome
- `src/app/components/location-panel/` — status overlay (View band includes Globe)
- `src/app/components/world-setup/` — generation settings
- `src/app/components/settings-panel/` — planet view and adventure options
- `src/app/engine/` — world-gen, land-sketch, chunk-gen, renderer, globe, projection, tileset, entities, POIs, names, assets (no Angular)

Pixel Kingdom tiles and sprites live under `public/assets/`.
