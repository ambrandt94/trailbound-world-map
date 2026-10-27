# AreaExport v0.2

World-map is the authority for a place. The Trailbound controller does not invent geography. The TypeScript types in `src/app/engine/area-export.ts` are the schema. This note is the field guide; if they disagree, the types win.

`buildAreaExport(world, place, opts)` returns one `AreaExport`. It covers the isolated place only (`MapNode.tiles`). Neighbours are metadata. “Load adjacent regions” does not enlarge the grids.

## Transport

**Play in 3D** (visible while a place is isolated) opens the controller and hands off the payload:

1. Resolve the controller URL (below) and append `?bridge=1`.
2. `window.open` that URL as `tb-controller`.
3. Post `{ type: 'tb-area-hello', version }` to the controller origin, and repeat until it answers or the window closes.
4. On `{ type: 'tb-area-ready' }` from that window, post `{ type: 'tb-area', payload }` where `payload` is the `AreaExport`.
5. On `{ type: 'tb-area-ack', hash }`, compare `hash` to `meta.hash` (the `sha1:` prefix is optional).

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

`MapNode.x1` / `y1` are exclusive. `area.worldBounds` is inclusive, so a single tile at world `(5, 9)` is `{ x0: 5, y0: 9, x1: 5, y1: 9 }`.

## What is baked

Chunks are regenerated inside the exporter, not copied from the session. Tiles are sorted by `(y, x)` and `generateChunk` runs twice (`AREA_CHUNK_PASSES`) so each edge is stitched against neighbours from that same order. Visit order cannot change the hash.

`meta.hash` is `sha1:` plus the SHA-1 of the canonical JSON (keys sorted, UTF-8). `meta.exportedAt`, `meta.timeOfDayHours`, and `meta.hash` are left out, so the clock does not change the hash. The same seed and place hash the same twice.

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

`layers.biome` is the chunk biome id. `grid.mask` is 1 on inner cells that belong to the place and 0 in the bounding box outside the blob. Grids are base64 (`enc: "b64u8"`).

### Height

`WorldData.heights` is the normalized elevation sample `generateWorld` already computes (0 deep, 1 peak). It is not the continental ×3200 m readout.

`layers.height.raw` is those samples averaged onto world-tile corners, plus a one-tile apron. Sample `[0]` is `originCorner`. Local metres:

```
y = (raw - min) / (max - min) * reliefMeters
```

bilinear between corners. `RELIEF_METERS` is **15**. `reliefMeters` is `15 × reliefBiomeMultiplier`. The multiplier is the highest entry below among the place’s own biome and the biomes of its world tiles. Both values are named constants (`RELIEF_METERS`, `RELIEF_BIOME_MULT`). Those height fields were already on the export, so the relief change does not bump the version. Buildings do: the schema is **0.2.0**.

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

- `present` is true when any masked cell’s ground class is water.
- `raw` is the lowest `heights` sample on a Water world tile in the area plus the one-tile apron.
- `level` is that raw value remapped with the formula above (metres above the area’s lowest corner).
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

## Fixtures

Seed **7741**, default continent settings, `exportedAt` fixed at `2026-10-26T00:00:00.000Z` (not part of the hash). Regenerate with:

```
AREA_EXPORT_WRITE=1 npx tsx scripts/area-export-check.ts
```

| File | Place | What it is |
| --- | --- | --- |
| `fixtures/area-veldcross.json` | Ironmarch | Town, streets and buildings. `sha1:06bc6667a87a957d81dcc79990700179eacc04d5` |
| `fixtures/area-hollowmere.json` | Shadowglen | Grove, trees, no buildings. `sha1:30311fc2070ce03e3e04f9661942e4ad28cd8410` |
| `fixtures/area-jadewild.json` | Jadewild | Forest grove with water cells. `sha1:549079628cb80cc48f7d92846419a892308b806d` |

Jadewild header (grids omitted):

```json
{
  "type": "trailbound.area",
  "version": "0.2.0",
  "source": { "app": "world-map", "build": "2026-10-27", "seed": 7741, "worldScale": 8, "mapStyle": "continent", "zoneScale": 8 },
  "area": { "id": "jadewild", "name": "Jadewild", "kind": "grove", "origin": "authored", "biome": "Forest", "worldBounds": { "x0": 351, "y0": 615, "x1": 358, "y1": 626 }, "innerOrigin": { "x": 2808, "y": 4920 } },
  "units": { "zoneScale": 8, "metersPerTile": 1, "upAxis": "y", "gridAxes": "x-right,y-down", "seaLevel": 0.36 },
  "layers": {
    "height": { "sampling": "world-tile-corners", "reliefBaseMeters": 15, "reliefBiomeMultiplier": 1.15, "reliefBiome": "Forest", "reliefMeters": 17.25 },
    "water": { "level": 5.6024, "raw": 0.37502, "fromBiome": true, "present": true }
  },
  "entries": [{ "id": "player", "kind": "spawn", "x": 2843.5, "y": 4977.5, "facing": "E" }],
  "meta": { "hash": "sha1:549079628cb80cc48f7d92846419a892308b806d" }
}
```
