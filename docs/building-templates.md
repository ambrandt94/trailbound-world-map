# Building templates

Street buildings are stamps in `src/app/engine/building-templates.ts`. Each stamp is one plot. Placement picks a stamp that fits, rotates it in 90° steps so the door faces the nearest street or plaza, and treats every non-yard cell as the structure. 1 cell = 1 metre.

Edit the `ascii` rows. Do not hand-edit the compiled `parts` array; it is built when the file loads.

## Legend

North is the first row. East is to the right.

| Character | Part | Meaning |
| --- | --- | --- |
| `#` | yard | Outdoor plot. Drawn and exported as yard ground. |
| `.` | floor | Indoor ground, under the roof. |
| `W` | wall | Exterior or interior wall. |
| `D` | door | Perimeter opening. Needs a yard or void neighbour. |
| `o` | window | Perimeter opening hint. Same neighbour rule as a door. |
| `T` | tower | Structure cell one storey taller than the rest. |
| space | void | Outside the stamp. Prefer `#` for owned ground. |

A door or window that sits in the middle of the floor, with walls or floor on every side, fails to load. Put `D` and `o` on the outer edge.

The bounding box of the stamp is the plot. The bounding box of the structure cells (floor, wall, door, window, tower) is the building. Keep that box human-scale:

| Kind | Structure | Storeys |
| --- | --- | --- |
| Cottage, farmhouse | about 6×5 | 1 |
| Shop, smithy | about 7×6 | 1 |
| Church, inn, town hall | at most 10×8 | 2 |

L, T, wings, and a tower are just the shape of the characters. A notch of `#` inside the box is a yard, not a room.

## Fields next to the picture

```ts
{
  id: 'cottage-1-b',     // unique. The export writes this as templateId.
  type: 'cottage-1',     // roster key. Must match a key in BUILDINGS.
  label: 'Cottage',
  storeys: 1,            // wall height is storeys × 2.8 m
  roof: { style: 'gable', ridge: 'E-W' },
  ascii: [ /* rows */ ],
}
```

`roof.style` is `gable`, `hip`, `shed`, `flat`, or `cross-gable`. `ridge` is the axis **before** rotation: `E-W` or `N-S`. Placement swaps the axis on 90° and 270°.

Doors and windows are read from `D` and `o`. You do not list them separately. The side with the most doors is the front. Rotation turns that side toward the street.

## Adding a variant

1. Copy a stamp of the same `type`.
2. Give it a new `id` (`cottage-1-d`).
3. Change the rows, storeys, or roof.
4. Keep every row the same length.
5. Load the map, or run `npx tsx scripts/area-export-check.ts`. A bad stamp throws on import.

Common types already have two or three stamps (`cottage-1`, `cottage-2`, `cottage-3`, `house-1`, `house-2`, `shop`). Placement chooses one that fits the lot. The choice and the rotation both come from the place seed, so the same seed rebuilds the same town.

Sprite buildings in Settings draws the old Town Tale PNG on the structure instead of the tile roof. The stamp is still the footprint either way.
