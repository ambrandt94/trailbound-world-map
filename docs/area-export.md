# AreaExport v0.8

World-map is the authority for a place. The Trailbound controller does not invent geography. The TypeScript types in `src/app/engine/area-export.ts` are the schema. This note is the field guide; if they disagree, the types win.

`buildAreaExport(world, place, opts)` returns one `AreaExport`. Version is `0.8.0`. Every new field is optional for readers: a missing `borderWorldTiles` means 0, a missing `grid.borderMask` means no ring, and `layers.height.sampling` of `world-tile-corners` is the 0.2 lattice. v0.3 and later always write the ring. v0.4 adds optional `npcs` (zone metres) and `session` (`{ sid, live: 1 }` only while a live link is open). v0.5 adds optional `population` on a city, town, village, or hamlet. v0.6 adds settlement layout, a surface layer, kit fields, zones, fence segments, and minigame slots. v0.7 adds world metres beside that normalized height. v0.8 adds `population.crowd` on those same places. Older readers ignore every field they do not know. A grove or camp omits `population`. A camp still writes `area.settlement`.

## v0.8 crowd

v0.8 is additive. A reader that only understands 0.7 keeps the census fields and ignores `population.crowd`. Every 0.7 field is still written and means the same thing. The version string is `0.8.0`; the major version is still 0. The census formula is unchanged: `count`, `named`, and the crowd size `max(0, count − named)` do not read `crowd`.

`crowd` is world data for the Character Forge generator. It names a profile, a seed, role weights, and a tier. It does not carry recipes, slot lists, or any other engine field. `culture` is always `null`: region and culture are still an open question. A grove or camp still omits `population`, so it omits `crowd`.

Ironmarch on seed 7741, inland, default residents:

```
population.crowd = {
  profile: "trailbound",
  seed: 3689121389,
  mix: [
    { role: "farmer", w: 0.108 },
    { role: "merchant", w: 0.257 },
    { role: "smith", w: 0.084 },
    { role: "guard", w: 0.132 },
    { role: "noble", w: 0.131 },
    { role: "pioneer", w: 0.048 },
    { role: "laborer", w: 0.114 },
    { role: "crafter", w: 0.126 }
  ],
  culture: null,
  tier: "town"
}
```

`profile` is always `"trailbound"`. `tier` is the place's existing tier id (`hamlet`, `village`, `town`, `city`, `capital`). A city node stays `city` even though its layout still uses the town row. `mix` is `{ role, w }` in the role order below. Each `w` is a multiple of 0.001, and the thousandths sum to 1000. Roles with weight 0 are omitted.

The rule table is `src/app/engine/crowd-mix.ts`. There is no place-level industry field. The mix starts from the tier, then adds the catalog specialty of each building that was actually placed (`smithy`, `tavern`, `barn`, …), then adds a water row. Weights are thousandths. After the adds, they are normalized with the largest-remainder method so the thousandths sum to 1000. Tune the tables; do not scatter the numbers.

### Base mix

Guards rise with the tier. Nobles exist only from town upward, and they rise too. Hamlets and villages are mostly farmer, laborer, and pioneer. Camps are in the table for completeness; a camp does not write `population`.

| Tier | farmer | laborer | pioneer | crafter | merchant | smith | guard | noble |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hamlet | 0.48 | 0.24 | 0.22 | 0.04 | 0.02 | | | |
| village | 0.38 | 0.20 | 0.16 | 0.10 | 0.10 | 0.03 | 0.03 | |
| town | 0.18 | 0.16 | 0.08 | 0.12 | 0.16 | 0.06 | 0.14 | 0.10 |
| city | 0.10 | 0.14 | 0.04 | 0.12 | 0.20 | 0.05 | 0.18 | 0.17 |
| capital | 0.05 | 0.10 | 0.03 | 0.10 | 0.18 | 0.04 | 0.24 | 0.26 |

### Building bumps

Added once per placed building, before normalize, and capped so a row of market stalls cannot erase the town. The number is the weight of one building. Homes (`tent`, `hovel`, `cottage`, `townhouse`) and the healer are not listed: the tier base covers ordinary residents, and healer is not a crowd role. A manor below town does not add nobles.

| Specialty | Role | Weight | Cap |
| --- | --- | --- | --- |
| general_store, tavern | merchant | 0.04 | 1 |
| bakery | merchant | 0.03 | 1 |
| bank | merchant | 0.04 | 1 |
| apothecary, cartographer | merchant | 0.02 | 1 |
| market_stall | merchant | 0.02 | 4 |
| smithy | smith | 0.08 | 2 |
| carpenter | crafter | 0.05 | 2 |
| wagonwright | crafter | 0.04 | 2 |
| stables | laborer | 0.03 | 1 |
| barn | farmer | 0.08 | 2 |
| manor | noble | 0.04 | 3 |
| town_hall, guildhall | guard | 0.03 | 1 |
| temple | guard | 0.02 | 1 |
| temple_small | guard | 0.01 | 1 |

### Water

Sailor and fisher are written only when the place has water access. Otherwise both weights stay 0 and the roles are omitted.

| Signal | What counts | Roles |
| --- | --- | --- |
| shore | a place tile is Water, is below 0 m, or shares a side with Water | sailor and fisher |
| coast | the site or a place tile is Sand (the coast biome, within about 72 m of the sea) | sailor and fisher |
| harbour | a specialty or kit token is `dock`, `wharf`, `quay`, `harbour`, `harbor`, `pier`, or `port` | sailor and fisher, plus an extra 0.10 sailor and 0.03 fisher |
| river | the site or a place tile is Marsh, and none of the rows above match | fisher only |

Hydrology, named rivers, and docks are not in the payload yet. Marsh is the river stand-in. The P0 catalog has no dock kit; the harbour row is there for when one is placed. Open water and a Sand coast use one shared row (a harbour adds the extra on top):

| Tier | fisher | sailor |
| --- | --- | --- |
| hamlet | 0.18 | 0.06 |
| village | 0.14 | 0.08 |
| town | 0.08 | 0.12 |
| city | 0.06 | 0.16 |
| capital | 0.04 | 0.18 |

A river-only place adds fisher only: hamlet 0.14, village 0.12, town 0.07, city 0.04, capital 0.03.

Seed 7741 does not put a settlement on the water. Saltgate is authored toward Sand and resolves to Plains. No settlement tile is Water, Sand, or Marsh, and none shares a side with open water. The fixture mixes omit sailor and fisher. The check still runs Ironmarch's buildings against a Sand site, a Marsh site, an adjacent Water tile, and a `quay` kit.

Miner and woodcutter are not v1 roles. No settlement specialty, kit, or industry field names a mine or a timber camp. A carpenter is a crafter. The place panel lists the four heaviest roles while you stand in a settlement.

### Seeds

`crowd.seed` is an unsigned 32-bit integer. It is a hash of the world seed and the place id. It does not draw from the sim RNG, and it is not the resident jitter.

Byte string, in order:

1. UTF-8 of `crowd`
2. a `0x00` byte
3. the world seed as a little-endian uint32
4. a `0x00` byte
5. UTF-8 of the place id

Hash that string with FNV-1a 32: offset basis `2166136261` (`0x811c9dc5`), prime `16777619` (`0x01000193`). Then xor-fold `h = (h ^ (h >>> 16))` as a uint32. If the fold is 0, the seed is 1.

Crowd member `i` (i starts at 0) is the same FNV-1a and the same xor-fold, over eight bytes: little-endian `crowd.seed`, then little-endian `i`. The member seed depends only on those two integers, so the same town always yields the same people. `crowdMemberSeed` in `crowd-mix.ts` is that function.

On seed 7741, Ironmarch (`veldcross`) has `crowd.seed` `3689121389`. Member 0 is `2634054944`, member 1 is `3979211292`, member 2 is `1029268251`. Sunspire's `crowd.seed` is `1713742167`.

`population` is inside `meta.hash`, and `crowd` is inside `population`, so a different mix changes the hash. `meta.exportedAt`, `meta.timeOfDayHours`, `meta.hash`, `npcs`, and `session` stay outside it. The same seed, place, and resident settings hash the same twice. Resident settings change `count` and `avg`; they do not change the mix.

## v0.7 height (controller contract)

v0.7 is additive. A reader that only understands 0.6 keeps using `layers.height` and `units.seaLevel` and ignores the fields below. Every 0.6 field is still written and means the same thing. The version string is `0.7.0`; the major version is still 0.

World height is stored in **metres above sea level**. Sea level is **0 m everywhere** (`units.seaLevelM`, `units.heightDatum: "sea"`). The same zero is the world-gen water line: a sample below 0 m is water, and its normalized `layers.height.raw` is below `units.seaLevel` (0.36). There is no second threshold. That is what removes the old Sunspire class of bug, where land between the world-gen water line (0.33) and the export sea level (0.36) was treated as flooded.

| Field | Type | Meaning |
| --- | --- | --- |
| `units.seaLevel` | number | Normalized sea level, `0.36`. v0.6 readers compare `layers.height.raw` to this. |
| `units.seaLevelM` | number | `0`. Metres. |
| `units.heightDatum` | `"sea"` | Datum for `seaLevelM` and `layers.heightM`. |
| `units.verticalExaggeration` | number | `0.1`. One playable scale for every area. |
| `units.detailSeed` | number | Detail noise seed. Derived from the world seed, never from the area id. The same on every area of a world. |
| `layers.heightM` | object | The same lattice as `layers.height`, in world metres, detail and the settlement pad included. |

`layers.heightM` is `{ sampling, subdivMeters, w, h, originInner, enc, quantM, data, note }`. `sampling` is `world-subdiv`. `subdivMeters`, `w`, `h`, and `originInner` match `layers.height`. `enc` is `b64i16le`: little-endian int16 samples, **metres = int16 × quantM**. `quantM` is `0.2`. Int16 decimetres only reach ±3,276.8 m, and trench floors are about −4,000 m, so the lattice uses 0.2 m steps instead of decimetres. 0.2 m divides the 0.6 m settlement pad exactly.

Decode:

```
bytes = base64(data)
sample = int16le(bytes, i) * quantM
```

Index `i + j * w` is the same point as `layers.height.raw[i + j * w]`:

```
innerX = originInner.x + i * subdivMeters
innerY = originInner.y + j * subdivMeters
worldX = innerX / zoneScale
worldY = innerY / zoneScale
```

Each sample is a Catmull-Rom read of `WorldData.heightM` (one value per 8 m world tile) plus detail noise. The detail function is seeded with `units.detailSeed` and the absolute world coordinate, so two areas that cover the same point encode the same metres. A settlement pad is the exception: it only lifts the area that owns the lots, roads, zones, spawn, and respawn anchor, to at least **0.6 m** above sea level, then blends back over 16 m. Neighbouring unpadded samples still match.

**Playable height.** Do not refit each area to its own min/max. Use the one factor on the payload:

```
renderedY = heightM * units.verticalExaggeration
```

`verticalExaggeration` is `0.1` (a gentle compression of true metres, so a 2,000 m face reads as 200 m). Sea level stays at rendered Y = 0. Apply this same factor in every area, including far terrain. `layers.height.raw`, `minRaw`, `maxRaw`, and `reliefMeters` are the legacy per-area remap for v0.6 readers. They are not the metre heights, and a v0.7 controller should not stretch by them.

The world range is about **−4,000 m** (trench floors) to **+3,000 m** (peaks). Ocean runs shelf (0 to −120 m), slope, abyssal plain (about −2,500 m), then occasional trenches. Climate is cold in the north and warm in the south, and snow follows a snowline that drops toward the north plus altitude. The default world scale is **16×** (192 × 16 = 3,072 tiles, 24.6 km). `source.worldScale` records the scale used for that export.

Hydrology (`layers.water.bodies`), coasts, and docks are not in this payload. `layers.water` is still the v0.6 flat sheet.

## v0.6

Layout v2 places roads, a wagon yard, districts, and 3 m lots before kit buildings. Doors face the lot's road. The stage seed is `hash(placeSeed, stageName)`, so props do not reshuffle buildings. Towns and cities are no longer flattened to Plains; `area.settlement.style` is the site biome's material style (`temperate`, `arid`, `coastal`, `tropical`, `alpine`, `wetland`, `volcanic`). `variant` is `default` until region data exists. City and capital rows are stubbed: a city node is labeled `city` and placed with the town row.

`buildings[].type` stays the legacy sprite (`shop`, `tavern`, `church`, `cottage-1`, …) so a v0.5 reader keeps working. `specialty` is the catalog id (`general_store`, `tavern`, `healer`, …) and `kit` is the manifest name. `shape: "kit"` means the mask is a rectangular shell. Hand-authored stamps stay within 10×8 m. Kit shells go up to 15×15 m (town temple and guildhall). A market stall's 1.5 m depth is stored as 2 m in the 1 m mask; the kit name still says `3x1.5`.

`layers.biome` legend is 27 names. Index 7 is `Badlands`. `legendAliases` is `{ "Heath": "Badlands" }` for one version. Ids 15–26 are reserved names and are not written into cells yet. `layers.ground` appends `9 park` and `10 field`. `layers.surface` is a new byte layer (0 none, 1 path, 2 lane_gravel, 3 street_cobble, 4 avenue_flagstone, 5 avenue_sandstone, 6 processional, 7 plaza_flagstone, 8 farmland, 9 park_grass, 10 boardwalk, 11 oasis_grass, 12 ice, 13 hotspring_rim). A 4.5 m street is painted 5 m wide on the 1 m grid.

`roads.polylines[]` is `{ id, kind, rank, width, widthM, surface, points }`. Points are north-west corners of 3 m road cells, so every coordinate is divisible by 3. `width` copies `widthM`.

`roads.worldTiles` is only the coarse `WorldData.paths` flags inside the place. It is not derived from polylines. Overworld paths are stamped between cities and towns, so a village such as Sunspire can export local polylines and an empty `worldTiles` list. That empty list is expected.

`area.settlement` is `{ tier, style, variant, buildingCount, dropped, districts, respawnAnchor: { x, y, kind } }`. `kind` is `healer`, `temple`, `shrine`, or `campfire`. Towns respawn at the healer. Villages respawn at the shrine or small temple. Camps and hamlets respawn at the campfire. `dropped` counts catalog ids that did not fit, and `meta.notes` lists them.

`zones[]` includes `wagon_yard` (`subtype` `yard` or `circle`, `slots` of 3×6 m on a full yard), `plaza` or `green`, and `district`. `segments[]` are 3 m fence chains. `meta.kitVersion` is `0.1-draft`.

`zones[].rect` is the zone's top-left corner plus size, in absolute inner-tile metres (`x` right, `y` down). `zones[].slots[].x/y` are the **centre** of that slot, the same convention as building anchors and props. `slots[].w/d` stay the slot size, so the slot's top-left corner is `(x - w/2, y - d/2)`. A wagon slot is not stored on the yard corner.

Detached houses (`tent`, `hovel`, `cottage`, `manor`) keep at least 1.5 m (one module) between their structure boxes. Townhouses may touch other townhouses. Houses on the same frontage that sit closer than 6 m still count as one row, and that run stops at 3 unless the tier sets `rowhouses`. Doors still face the lot's road.

`minigameSlots[]` come from `src/app/engine/minigame-spawn-rules.json`. Schedules are hours. Unknown `gameId`s are emitted unchanged. `peeloff` is true on every `scope: "wild"` slot and on `ford_crossing`. The games themselves are not implemented.

Wild props carry kit names. Forest and Mountain (and the other existing biomes) use the §3.1 lists. Trees get yaw and a scale in 0.9–1.1. Settlement interiors do not get that scatter; the border ring does. `props[].class` may also be `deco`, `civic`, `host`, `hero`, or `fence_post`.

Tiers live in `src/app/engine/settlement-tiers.ts`: camp 0–3, hamlet 3–8, village 8–25, town 25–80. `NodeKind` includes `village`. Sunspire is a village.

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

`meta.hash` is `sha1:` plus the SHA-1 of the canonical JSON (keys sorted, UTF-8). `meta.exportedAt`, `meta.timeOfDayHours`, `meta.hash`, `npcs`, and `session` are left out, so the clock and a live snapshot do not change the hash. `population` is included, and `population.crowd` is part of it: changing the resident count or the role mix changes the hash. The same seed, place, and resident settings hash the same twice. A v0.4 reader that ignores `population` still loads the geography. Stripping `population` (and the population note) and setting `version` back to `0.4.0` is a compatible payload; it is a different hash. Stripping only `crowd` is also a different hash. A v0.7 reader ignores `crowd` and keeps the census.

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

`WorldData.heightM` is metres above sea level (0), one sample per world tile. `WorldData.heights` is the normalized copy of that field: 0 m maps to `0.36`, trench floors toward 0, peaks toward 1. v0.7 controllers read `layers.heightM`. The normalized lattice below is what a v0.6 reader still uses.

v0.3 does not bilinear those stored samples. `layers.height.sampling` is `world-subdiv`. `subdivMeters` is 2. `heightUnit` is `normalized`. `raw` is the normalized mapping of the same metres as `layers.heightM` (Catmull-Rom of `heightM`, plus the world-anchored detail, plus the settlement pad). Integer world tiles match `WorldData.heights`. A fractional sample is not a bilinear of that grid.

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
| Badlands (was Heath), Taiga | 1.35 |
| Ashlands | 1.5 |
| Hills | 2 |
| Snow | 2.25 |
| Mountain | 3 |

On seed 7741, Dunharrow is Hills and exports `reliefMeters: 30`. The check script asserts the Hills case. Towns keep the biome they were sited on. Play in 3D and Download area JSON use these defaults; the map UI has no separate relief slider.

### Water level

There is no stored water line. `layers.water` is derived:

- `present` is true when any **playable** (`mask` 1) cell’s ground class is water. Ring water does not set `present`.
- `raw` is the lowest `WorldData.heights` sample on a Water world tile inside the exported grid (place plus border ring).
- `level` is that raw value remapped with `height.minRaw`, `height.maxRaw`, and `reliefMeters` (metres above the remap zero). Use `level` as already-computed metres.
- If no Water world tile is in range, `raw` falls back to `units.seaLevel` (`0.36`, which is 0 m) and the note says so.

Water cells should stay flat at `level` for a v0.6 reader. v0.7 depth is the `layers.heightM` sample (negative metres). There is one sea level: world-gen treats `heightM < 0` as water, and that is the same line as `raw < units.seaLevel`.

A playable or border cell whose height is below 0 m is tagged `layers.ground` water and `layers.biome` Water, and `layers.water.present` is true when any playable cell has that ground class. Settlement lots, roads, zones, the spawn, and `respawnAnchor` are lifted to at least **0.6 m** above sea level and blended back over 16 m, so those features stay dry land. The pad is part of both `layers.height.raw` and `layers.heightM`. Samples outside the blend are the world height plus detail.

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

Only a city, town, village, or hamlet writes `population`. It is the town census, not a list of people. The controller spawns the crowd locally from this block. Named residents are unchanged: each settlement still has 3–8 real map entities (home, routine, chatter, talk, and the live link). They are not crowd members and they are not repeated inside `population`. v0.8 adds `population.crowd` on these same places. The fields in this section are unchanged.

```
count = round(avg × (dwelling count when mode is perHouse, otherwise 1) × jitter)
jitter = seededJitter(worldSeed, placeId)   // in [0.75, 1.25], ±25%
crowd = max(0, count − named)
```

`jitter` is a hash of the world seed and the place id. It does not draw from the sim RNG, so reloading the same seed returns the same count. `named` is `residentCountFor` (3–8), stored on the population block so the controller does not have to count the `npcs` list. The crowd is everyone else.

World defaults live with the other world settings: `residentsMode` is `perPlace` (average 24) or `perHouse` (average 2.5). A place panel can store an override (`mode` + `avg`) keyed by place id. That override is not inside the seed-scoped node list, so it survives a new seed. The export's `mode` and `avg` are the values after the override.

| Field | Meaning |
| --- | --- |
| `count` | Census from the formula above |
| `named` | Named residents for this place (real map entities). Crowd = max(0, count − named) |
| `mode` | `perPlace` or `perHouse` |
| `avg` | Average used for that mode |
| `seed` | World seed mixed into the jitter |
| `homes` | Building indexes of cottages, houses, and farms. A dwelling is repeated once per 30 m² of structure (at least once) so a larger house is chosen more often |
| `hotspots` | Plaza centre, market stands, tavern doors, and wells. Area metres: offset from `area.innerOrigin`, x right, y down. `three.x = hotspot.x`, `three.z = hotspot.y` |

Pool the crowd at `max(0, count − named)`, not at `count`. On seed 7741, Ironmarch's default census is 18 with 6 named residents, so the crowd is 12. A missing `population` means spawn no crowd.

```json
{
  "count": 18,
  "named": 6,
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

`buildAreaExport` leaves `npcs` and `session` off. They are a clock snapshot, not part of `meta.hash`. **Download area JSON** adds that snapshot and still omits `session`. `fixtures/area-veldcross.json` is the builder payload. `fixtures/area-veldcross-v05.json` is the download for Ironmarch: the same hash, plus `npcs` and no `session`. The player in that snapshot stands at the place centroid with people freshly spawned at hour 8, which is the isolated-download case before the sim has stepped. All six named Ironmarch residents are in `npcs.list`.

| File | Place | Bytes | Hash |
| --- | --- | --- | --- |
| `fixtures/area-veldcross.json` | Ironmarch builder payload, population.named = 6, inland town crowd | 648854 | `sha1:b5a9163f115a2aec390a3d357719843cb97e00fe` |
| `fixtures/area-veldcross-v05.json` | Ironmarch download: same payload plus `npcs`, no `session` | 654061 | `sha1:b5a9163f115a2aec390a3d357719843cb97e00fe` |
| `fixtures/area-sunspire.json` | Sunspire village. Land sits above sea level; the 0.6 m pad keeps lots, roads, and the spawn dry. Inland village crowd | 517378 | `sha1:38be72f7c1f524c450db8479a401d32dbff9cb4c` |
| `fixtures/area-hollowmere.json` | Shadowglen, grove, trees, no buildings, no population | 335402 | `sha1:600c66d77774c44480efe80837c13e12699a6697` |
| `fixtures/area-jadewild.json` | Jadewild, grove, no population | 407767 | `sha1:ec34a078db1ef62170ad6e45a6b7ba1539018291` |
| `fixtures/area-hollowmere-v04.json` | Shadowglen plus a forced NPC snapshot (hash unchanged) | 337359 | `sha1:600c66d77774c44480efe80837c13e12699a6697` |
| `fixtures/area-peak.json` | Generated patch on a snowy peak (seed 7741). `layers.heightM` reaches about +2,953 m | 243585 | `sha1:62c07b1ae47deb8137044a2204663eab8dff1070` |
| `fixtures/area-deep.json` | Generated patch on a trench floor (seed 7741). `layers.heightM` reaches about −3,977 m | 195755 | `sha1:56e225fd433f3bb072b208bd568a1637946800a5` |

Seed 7741 at the default 16× scale. A shifted copy of Shadowglen shares 3,905 lattice samples with the original and every unpadded sample matches, so neighbouring areas agree. `units.detailSeed` is the same number on every fixture above. The check also times generation: scale 16 (3,072 tiles, 24.6 km) is about 2.1 s and scale 8 is about 0.6 s in the fixture run.

Most of the growth versus 0.2 is the expanded base64 grids (mask, borderMask, biome, ground). The height `raw` array is about 40–70 KB of the file. No extra quantization.

Jadewild header from before v0.7 (grids and `raw` omitted). The current payload is `0.8.0` at world scale 16 and adds the fields in the v0.7 and v0.8 sections above. Coordinates in this snippet are the old 8× world:

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
  "meta": { "hash": "sha1:e2682534c614f3ebd1f0090fea96e5931cee0f2a" }
}
```
