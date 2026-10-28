# AreaExport v0.5

World-map is the authority for a place. The Trailbound controller does not invent geography. The TypeScript types in `src/app/engine/area-export.ts` are the schema. This note is the field guide; if they disagree, the types win.

`buildAreaExport(world, place, opts)` returns one `AreaExport`. Version is `0.5.0`. Every new field is optional for readers: a missing `borderWorldTiles` means 0, a missing `grid.borderMask` means no ring, and `layers.height.sampling` of `world-tile-corners` is the 0.2 lattice. v0.3 and later always write the ring. v0.4 adds optional `npcs` (zone metres) and `session` (`{ sid, live: 1 }` only while a live link is open). v0.5 adds optional `population` on a city, town, or hamlet. Older readers ignore every field they do not know. A grove or camp omits `population`.

The playable place is still `MapNode.tiles` (`grid.mask`). Around that AABB the grids add a visual border ring of `area.borderWorldTiles` world tiles (4, which is 32 inner tiles, 32 m) on each side. The ring is not walkable. Neighbour names stay metadata. “Load adjacent regions” does not add those places’ buildings.

## Transport

**Play in 3D** (visible while a place is isolated) opens the controller and hands off the payload:

1. Resolve the controller URL (below) and append `?bridge=1`.
2. `window.open` that URL as `tb-controller`.
3. Post `{ type: 'tb-area-hello', version, live: [1] }` to the controller origin, and repeat until it answers or the window closes. A room omits `live` and stays one-shot.
4. On `{ type: 'tb-area-ready' }` from that window, post `{ type: 'tb-area', payload }` where `payload` is the `AreaExport`.
5. On `{ type: 'tb-area-ack', hash }`, compare `hash` to `meta.hash` (the `sha1:` prefix is optional). If both sides set `live: 1`, the channel stays open (`tb-session-open`, then `tb-sim` / `tb-player`). The named window `tb-controller` is reused on the next Play in 3D. Download JSON includes `npcs` and `population` and omits `session`.

Every `postMessage` uses the controller origin as `targetOrigin`. Incoming messages must come from that same window and from an allowlisted origin. `'*'` is never used.

**Download area JSON** saves the same object.

### Controller URL

| Where the map runs | Controller |
| --- | --- |
| `localhost` or `127.0.0.1` | `http://localhost:8787/` |
| anywhere else (GitHub Pages) | `https://trailbound-controller.ambrandt94.workers.dev/` |

Set `localStorage['tb-controller-url']` to override (for example `http://127.0.0.1:8790/`). The default allowlist is the production origin plus `http://localhost:8787` and `http://127.0.0.1:8787`. An override’s origin is added to the allowlist for that click.

## Units

- 1 inner tile = 1 metre (`METERS_PER_TILE`).
- `ZONE_SCALE` is 8 inner tiles per world tile.
- Grid index `i = x + y * w`, x right, y down. Absolute inner coords match `buildings.ts` (door sill is south-centre).
- Controller mapping: `three.x = (innerX - innerOrigin.x) * metersPerTile`, `three.z = (innerY - innerOrigin.y) * metersPerTile`.
- `area.innerOrigin` and `grid.originInner` are the same point: the north-west inner tile of the **expanded** grid (the playable AABB shifted out by the ring). Buildings, props, and entries stay in absolute inner tiles, so a v0.2 spawn coordinate does not move.

`MapNode.x1` / `y1` are exclusive. `area.worldBounds` is the inclusive **playable** bounds, so a single tile at world `(5, 9)` is `{ x0: 5, y0: 9, x1: 5, y1: 9 }`. The grid extends `borderWorldTiles` past that box. The playable north-west inner tile is `innerOrigin + borderWorldTiles * zoneScale`.

## What is baked

Chunks are regenerated inside the exporter, not copied from the session. Tiles are sorted by `(y, x)` and `generateChunk` runs twice (`AREA_CHUNK_PASSES`) so each edge is stitched against neighbours from that same order. Visit order cannot change the hash.

`meta.hash` is `sha1:` plus the SHA-1 of the canonical JSON (keys sorted, UTF-8). `meta.exportedAt`, `meta.timeOfDayHours`, `meta.hash`, `npcs`, and `session` are left out, so the clock and a live snapshot do not change the hash. `population` is included: changing the resident count changes the hash. The same seed, place, and resident settings hash the same twice. A v0.4 reader that ignores `population` still loads the geography. Stripping `population` (and the population note) and setting `version` back to `0.4.0` is a compatible payload; it is a different hash.

### Ground classes

`layers.ground` is one byte per inner tile. `legend` is the index order.

| Value | Class | Source |
| --- | --- | --- |
| 0 | grass | everything else, including snow |
| 1 | dirt | chunk path that is not a world-grid road |
| 2 | road | chunk path on a world tile flagged in `WorldData.paths` |
| 3 | lot | chunk cobble `1` (building front) |
| 4 | plaza | chunk cobble `2` |
| 5 | water | biome Water, after paths and cobble |
| 6 | sand | biome Sand or Desert |
| 7 | rock | biome Mountain |
| 8 | yard | building plot that is not structure (cobble `3`). Streets and plaza are left in place |

`lot` (3) is the old front-apron value. v0.2 yards use `yard` (8) so the earlier indexes stay put.

`layers.biome` on a playable cell is the chunk biome id. `grid.mask` is 1 on inner cells that belong to the place and 0 otherwise (AABB holes and the ring included). Grids are base64 (`enc: "b64u8"`). Index is `ix + iy * grid.w`.

### Border ring (v0.3)

`area.borderWorldTiles` is 4. The grid’s world-tile rectangle is the place AABB expanded by that many tiles on every side. `grid.w` / `grid.h` count inner tiles of that rectangle (`(span + 8) * 8` when the border is 4 and `ZONE_SCALE` is 8).

`grid.originInner` is `{ x, y }` in absolute inner tiles (metres). Cell `(0, 0)` is that point. It equals `area.innerOrigin`.

`grid.borderMask` uses the same encoding as `mask`:

| Byte | Meaning |
| --- | --- |
| 1 | Border-ring cell with real terrain. Not walkable. |
| 0 | Not ring: either playable (`mask` 1) or void |

A cell is never 1 in both masks. Void (both 0) is only where the expanded rectangle leaves the world map. Ignore biome and ground on void cells; byte 0 there is padding, not a Water biome. In-world holes inside the place AABB are ring cells (visual terrain, not walkable).

Ring cells take the world-tile biome from `WorldData.biomes` (flat across that tile’s 8×8) and a simplified ground: grass, sand (Sand or Desert), rock (Mountain), water, dirt, or road. Roads are a straight hub-to-gate stamp on world-path tiles, using the same hub and gate hashes as street chunks, so a path meets the place at the shared edge. There are no lots, plazas, yards, buildings, or props in the ring. Playable cells are still baked from `generateChunk` (two passes, place tiles only) and can use every ground class.

Walkable = `grid.mask`. The ring is visual only. `meta.notes` says that, and that the controller should use Catmull-Rom.

### Height

`WorldData.heights` is the normalized elevation `generateWorld` stores (0 deep, 1 peak), one sample per world tile. It is not the continental ×3200 m readout.

v0.3 does not bilinear those stored samples. `layers.height.sampling` is `world-subdiv`. `subdivMeters` is 2. `heightUnit` is `normalized`. `raw` is the same FBM + land-mask formula as `world-gen.ts` (`worldHeightSampler`), evaluated at fractional world-tile coordinates.

The lattice covers the expanded grid plus **one** subdiv sample of apron on each side:

```
height.w = grid.w / subdivMeters + 3
height.h = grid.h / subdivMeters + 3
height.originInner = {
  x: grid.originInner.x - subdivMeters,
  y: grid.originInner.y - subdivMeters
}
height.originCorner = height.originInner
```

`originCorner` kept its name from 0.2. In 0.3 it is inner-tile metres of sample `[0]`, not a world-tile index. Sample `(i, j)` is index `i + j * height.w` at inner metres:

```
innerX = height.originInner.x + i * subdivMeters
innerY = height.originInner.y + j * subdivMeters
worldX = innerX / zoneScale
worldY = innerY / zoneScale
```

Controller remap (Catmull-Rom across the lattice, not bilinear):

```
t = clamp((raw - minRaw) / (maxRaw - minRaw), 0, 1)
y = t * reliefMeters
```

`minRaw` / `maxRaw` are not the raw extrema. They are the 2nd–98th percentile window of `raw`, widened so the span is at least `HEIGHT_SOFT_MIN_SPAN` (0.12), then padded by 5% of that span on each side. A place sitting on a tiny continental delta therefore does not become a multi-metre cliff. Samples outside the window clamp.

`detailMeters` is 0.4. It is optional micro-relief amplitude for the controller and is not baked into `raw`.

`RELIEF_METERS` is **15**. `reliefMeters` is `15 × reliefBiomeMultiplier`. The multiplier is the highest entry below among the place’s own biome and the biomes of its world tiles (the playable tiles, not the ring). Both values are named constants (`RELIEF_METERS`, `RELIEF_BIOME_MULT`).

| Biome | Multiplier |
| --- | --- |
| Water, Sand, Plains, Meadow, Marsh | 1 |
| Forest, DarkForest, Desert, Jungle | 1.15 |
| Heath, Taiga | 1.35 |
| Ashlands | 1.5 |
| Hills | 2 |
| Snow | 2.25 |
| Mountain | 3 |

On seed 7741, Dunharrow is Hills and exports `reliefMeters: 30`. Ironmarch’s site landed on Plains, so that town stays at 15 m. The check script asserts the Hills case. Play in 3D and Download area JSON use these defaults; the map UI has no separate relief slider.

### Water level

There is no stored water line. `layers.water` is derived:

- `present` is true when any **playable** (`mask` 1) cell’s ground class is water. Ring water does not set `present`.
- `raw` is the lowest `WorldData.heights` sample on a Water world tile inside the exported grid (place plus border ring).
- `level` is that raw value remapped with `height.minRaw`, `height.maxRaw`, and `reliefMeters` (metres above the remap zero). Use `level` as already-computed metres.
- If no Water world tile is in range, `raw` falls back to `units.seaLevel` (`0.36`, the contract value; world-gen’s hard water cutoff is height &lt; 0.33 before style overrides) and the note says so.

Water cells should stay flat at `level`.

### Spawn and edges

Spawn is not the live walker, so two peers with the same seed export the same point. It is the road cell nearest the mask centroid, then dirt, plaza, lot, grass, sand, rock, and water. `facing` points from that cell toward the centroid (or `N` when it is already central). Y down, so increasing y is south.

Edge entries are road or dirt cells on the mask boundary, one per side (`edge-n`, `edge-e`, `edge-s`, `edge-w`), each with `toWorldTile`. `roads.polylines` is empty in 0.1.0. `roads.worldTiles` is the coarse flag list. `roads.floors` is the place’s street and plaza floor ids.

Props are the non-building sprites. `class` is `tree`, `rock`, `plant`, or `prop` from the sprite name.

### Buildings (v0.2)

v0.1 fields are still present: `id`, `type`, `x`, `y`, `footW`, `footD`, `shape`, `rotation`, `door`, `label`.

`x, y` is the south-centre of the **structure** axis-aligned box, in absolute inner tiles. The v0.1 rectangle `x ± footW/2`, `y - footD .. y` is that box. `footW` and `footD` are the structure size in metres, not the plot. A reader that ignores every new key still gets a human-scale box.

The plot is larger. `plotX, plotY` is its north-west corner (minimum x, minimum y). `plotW, plotD` is its size. `structureX, structureY, structureW, structureD` is the structure box with the same corner rule. `structureW`/`structureD` match `footW`/`footD`.

`rotation` is `0`, `90`, `180`, or `270` (clockwise). The stamp is rotated before export, so `tiles` is already world-aligned. `door` is the primary door's side after that rotation. `doorCell` is that door's absolute inner tile. `templateId` names the stamp. `storeys` and `wallHeightM` (`storeys × 2.8`) are the wall. `roof` is `{ style, ridge }` with `ridge` of `E-W` or `N-S` after rotation.

`tiles` is `{ w, h, enc: "b64u8", data, legend }`. `w`/`h` match the plot. Each byte is a part:

| Value | Part |
| --- | --- |
| 0 | void |
| 1 | yard |
| 2 | floor |
| 3 | wall |
| 4 | door |
| 5 | window |
| 6 | tower |

`shape` is `rect` when the structure box is solid, and `mask` when it has a yard notch (L, T, wings). When `tiles` is present, the mask is the plan. Tower cells are one storey above `storeys`.

Cottage structure is about 6×5 and one storey. A shop is about 7×6. Church, inn, and town hall stay within 10×8 and are two storeys. Rotation can swap the two sides.

## Population (v0.5)

Only a city, town, or hamlet writes `population`. It is the town census, not a list of people. The controller spawns the crowd locally from this block. Named residents are unchanged: each settlement still has 3–8 real map entities (home, routine, chatter, talk, and the live link). They are not crowd members and they are not repeated inside `population`.

```
count = round(avg × (dwelling count when mode is perHouse, otherwise 1) × jitter)
jitter = seededJitter(worldSeed, placeId)   // in [0.75, 1.25], ±25%
crowd = max(0, count − named)
```

`jitter` is a hash of the world seed and the place id. It does not draw from the sim RNG, so reloading the same seed returns the same count. `named` is `residentCountFor` (3–8). The crowd is everyone else.

World defaults live with the other world settings: `residentsMode` is `perPlace` (average 24) or `perHouse` (average 2.5). A place panel can store an override (`mode` + `avg`) keyed by place id. That override is not inside the seed-scoped node list, so it survives a new seed. The export's `mode` and `avg` are the values after the override.

| Field | Meaning |
| --- | --- |
| `count` | Census from the formula above |
| `mode` | `perPlace` or `perHouse` |
| `avg` | Average used for that mode |
| `seed` | World seed mixed into the jitter |
| `homes` | Building indexes of cottages, houses, and farms. A dwelling is repeated once per 30 m² of structure (at least once) so a larger house is chosen more often |
| `hotspots` | Plaza centre, market stands, tavern doors, and wells. Area metres: offset from `area.innerOrigin`, x right, y down. `three.x = hotspot.x`, `three.z = hotspot.y` |

Pool the crowd at `max(0, count − named)`, not at `count`. On seed 7741, Ironmarch's default census is 18 with 6 named residents, so the crowd is 12. A missing `population` means spawn no crowd.

```json
{
  "count": 18,
  "mode": "perPlace",
  "avg": 24,
  "seed": 7741,
  "homes": [2, 2, 3, 3, 5, 5, 6, 6, 7, 8, 8, 9, 10, 11, 11],
  "hotspots": [
    { "x": 92.5, "y": 93 },
    { "x": 51.5, "y": 36.5 },
    { "x": 93.44, "y": 94.8 }
  ]
}
```

## Fixtures

Seed **7741**, default continent settings, `exportedAt` fixed at `2026-10-26T00:00:00.000Z` (not part of the hash). Regenerate with:

```
AREA_EXPORT_WRITE=1 npx tsx scripts/area-export-check.ts
```

Two back-to-back runs of the check script write identical bytes. `meta.exportedAt` is fixed in that script and is not part of the hash.

| File | Place | Bytes | Hash |
| --- | --- | --- | --- |
| `fixtures/area-veldcross.json` | Ironmarch, town, streets and buildings, population | 369590 | `sha1:0d274d4a5a7d6c2eb91bd2d0fd89980684fdff13` |
| `fixtures/area-veldcross-v05.json` | Same Ironmarch payload, kept under the v0.5 name | 369590 | `sha1:0d274d4a5a7d6c2eb91bd2d0fd89980684fdff13` |
| `fixtures/area-hollowmere.json` | Shadowglen, grove, trees, no buildings, no population | 215203 | `sha1:a426f8ce4218a4c4777161d084e0b578a7888207` |
| `fixtures/area-jadewild.json` | Jadewild, forest grove with water, no population | 231452 | `sha1:2953aab5536436a680206b833e6b098024bd280a` |
| `fixtures/area-hollowmere-v04.json` | Shadowglen plus a forced NPC snapshot (hash unchanged) | 217160 | `sha1:a426f8ce4218a4c4777161d084e0b578a7888207` |

Most of the growth versus 0.2 is the expanded base64 grids (mask, borderMask, biome, ground). The height `raw` array is about 40–70 KB of the file. No extra quantization.

Jadewild header (grids and `raw` omitted):

```json
{
  "type": "trailbound.area",
  "version": "0.5.0",
  "source": { "app": "world-map", "build": "2026-10-27", "seed": 7741, "worldScale": 8, "mapStyle": "continent", "zoneScale": 8 },
  "area": {
    "id": "jadewild",
    "name": "Jadewild",
    "kind": "grove",
    "origin": "authored",
    "biome": "Forest",
    "worldBounds": { "x0": 351, "y0": 615, "x1": 358, "y1": 626 },
    "innerOrigin": { "x": 2776, "y": 4888 },
    "borderWorldTiles": 4
  },
  "grid": { "w": 128, "h": 160, "originInner": { "x": 2776, "y": 4888 } },
  "units": { "zoneScale": 8, "metersPerTile": 1, "upAxis": "y", "gridAxes": "x-right,y-down", "seaLevel": 0.36 },
  "layers": {
    "height": {
      "sampling": "world-subdiv",
      "subdivMeters": 2,
      "w": 67,
      "h": 83,
      "originCorner": { "x": 2774, "y": 4886 },
      "originInner": { "x": 2774, "y": 4886 },
      "heightUnit": "normalized",
      "minRaw": 0.31173,
      "maxRaw": 0.44373,
      "reliefBaseMeters": 15,
      "reliefBiomeMultiplier": 1.15,
      "reliefBiome": "Forest",
      "reliefMeters": 17.25,
      "detailMeters": 0.4
    },
    "water": { "level": 8.2709, "raw": 0.37502, "fromBiome": true, "present": true }
  },
  "entries": [{ "id": "player", "kind": "spawn", "x": 2843.5, "y": 4977.5, "facing": "E" }],
  "meta": { "hash": "sha1:2953aab5536436a680206b833e6b098024bd280a" }
}
```
