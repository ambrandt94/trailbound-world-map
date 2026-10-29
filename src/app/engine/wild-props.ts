/**
 * Wild kit props (proposal §7). Forest and Mountain are tuned first; the other
 * 13 existing biomes use the same placement with their §3.1 lists.
 * Poisson-ish: one sample per 3 m cell, accepted by density. Trees yaw and
 * scale ±10%. Modules snap to 90°. No scale except `class: tree`.
 */
import { Biome } from '../models/world.models';
import { hash2 } from './noise';
import type { PropClass } from './layout-v2';

export interface WildProp {
  kit: string;
  propClass: PropClass;
  rot: number;
  scale?: number;
  variant: 'default';
}

interface Species {
  kit: string;
  propClass: PropClass;
  weight: number;
}

interface BiomeDress {
  /** Trees per 100 m². */
  density: number;
  trees: Species[];
  cover: Species[];
  rocks: Species[];
}

const tree = (kit: string, weight = 1): Species => ({ kit, propClass: 'tree', weight });
const plant = (kit: string, weight = 1): Species => ({ kit, propClass: 'plant', weight });
const rock = (kit: string, weight = 1): Species => ({ kit, propClass: 'rock', weight });
const prop = (kit: string, weight = 1): Species => ({ kit, propClass: 'prop', weight });

/** Signature species are listed first and weighted ×3. */
export const WILD_DRESS: Record<number, BiomeDress> = {
  [Biome.Water]: {
    density: 0,
    trees: [],
    cover: [],
    rocks: [rock('rock_sea_stack_cool_l', 1)],
  },
  [Biome.Sand]: {
    density: 0.05,
    trees: [tree('tree_pine_coastal_m', 3)],
    cover: [plant('beach_grass_s', 3), plant('prop_shell_cluster_s', 1)],
    rocks: [rock('rock_boulder_cool_m', 1), prop('prop_driftwood_m', 2)],
  },
  [Biome.Plains]: {
    density: 0.15,
    trees: [tree('tree_oak_m', 3), tree('tree_oak_l', 3), tree('tree_birch_m', 1)],
    cover: [plant('bush_round_s', 2), plant('bush_round_m', 1), plant('flower_patch_daisy', 2)],
    rocks: [rock('rock_boulder_cool_s', 1), prop('prop_haystack', 1)],
  },
  [Biome.Meadow]: {
    density: 0.2,
    trees: [tree('tree_oak_m', 3), tree('tree_fruit_apple_s', 1)],
    cover: [plant('flower_patch_daisy', 3), plant('flower_patch_blue', 2), plant('bush_round_s', 1)],
    rocks: [rock('rock_boulder_cool_s', 1), prop('prop_beehive_skep', 1)],
  },
  [Biome.Forest]: {
    density: 1.2,
    trees: [tree('tree_oak_l', 3), tree('tree_beech_l', 3), tree('tree_birch_m', 1), tree('tree_pine_m', 1)],
    cover: [plant('bush_fern_m', 3), plant('mushroom_cluster_red', 1)],
    rocks: [rock('rock_mossy_cool_m', 1), prop('log_fallen_m', 2), prop('stump_s', 1)],
  },
  [Biome.DarkForest]: {
    density: 1.6,
    trees: [tree('tree_shadowoak_l', 3), tree('tree_yew_m', 1), tree('tree_spruce_l', 1)],
    cover: [plant('bush_fern_m', 2), plant('mushroom_cluster_red', 2)],
    rocks: [prop('log_fallen_mossy_l', 2), prop('roots_arch_m', 1)],
  },
  [Biome.Hills]: {
    density: 0.25,
    trees: [tree('tree_oak_m', 3), tree('tree_hawthorn_s', 1)],
    cover: [plant('bush_gorse_s', 2)],
    rocks: [rock('rock_boulder_cool_m', 2), rock('rock_outcrop_cool_l', 1), prop('prop_cairn', 1)],
  },
  [Biome.Heath]: {
    density: 0.04,
    trees: [tree('tree_dead_snag_m', 3), tree('tree_juniper_s', 1)],
    cover: [plant('bush_dry_s', 2), plant('cactus_paddle_s', 1)],
    rocks: [rock('rock_hoodoo_red_m', 2), rock('rock_boulder_red_m', 1), prop('prop_bones_ribcage_m', 1)],
  },
  [Biome.Marsh]: {
    density: 0.2,
    trees: [tree('tree_willow_m', 3), tree('tree_cypress_swamp_l', 1), tree('tree_dead_snag_m', 1)],
    cover: [plant('reeds_cattail_m', 3), plant('lilypad_s', 1)],
    rocks: [prop('log_fallen_mossy_l', 1)],
  },
  [Biome.Mountain]: {
    density: 0.1,
    trees: [tree('tree_pine_m', 3), tree('tree_juniper_s', 1)],
    cover: [plant('bush_alpine_s', 2)],
    rocks: [rock('rock_outcrop_cool_l', 3), rock('rock_scree_s', 2), rock('rock_boulder_cool_l', 1), prop('prop_cairn', 1)],
  },
  [Biome.Snow]: {
    density: 0.1,
    trees: [tree('tree_fir_snow_m', 3), tree('tree_fir_snow_l', 1), tree('tree_dead_snag_m', 1)],
    cover: [],
    rocks: [rock('rock_boulder_snowcap_m', 2), prop('prop_snowdrift_m', 2), prop('prop_ice_shard_s', 1)],
  },
  [Biome.Taiga]: {
    density: 1.2,
    trees: [tree('tree_spruce_l', 3), tree('tree_pine_m', 1), tree('tree_birch_m', 1)],
    cover: [plant('bush_berry_s', 2)],
    rocks: [prop('log_fallen_m', 1), prop('stump_s', 1), rock('rock_mossy_cool_m', 1)],
  },
  [Biome.Desert]: {
    density: 0.02,
    trees: [tree('tree_acacia_s', 3)],
    cover: [plant('cactus_column_m', 2), plant('cactus_paddle_s', 1), plant('bush_dry_s', 1)],
    rocks: [rock('rock_mesa_sandstone_l', 1), prop('prop_bones_skull_s', 1)],
  },
  [Biome.Jungle]: {
    density: 1.8,
    trees: [tree('tree_kapok_l', 3), tree('tree_jungle_broadleaf_m', 1), tree('tree_palm_coconut_m', 1)],
    cover: [plant('bush_tropical_fan_m', 2), plant('flower_tropical_s', 1), plant('vine_hanging_m', 1)],
    rocks: [prop('log_fallen_mossy_l', 1)],
  },
  [Biome.Ashlands]: {
    density: 0.05,
    trees: [tree('tree_dead_snag_m', 3), tree('tree_charred_m', 1)],
    cover: [plant('bush_ashfern_s', 2)],
    rocks: [rock('rock_basalt_column_basalt_m', 2), rock('rock_boulder_basalt_m', 1), prop('prop_ember_vent_s', 1)],
  },
};

const VEGETATION_CAP = 2000;
const OTHER_CAP = 600;

export function dressCell(biome: number, x: number, y: number, salt: number): WildProp | null {
  const table = WILD_DRESS[biome];
  if (!table) return null;
  const roll = hash2(Math.floor(x), Math.floor(y), salt);
  const cellM2 = 9;
  const treeP = Math.min(0.85, (table.density * cellM2) / 100);
  if (table.trees.length && roll < treeP) {
    return finish(pick(table.trees, hash2(Math.floor(x) + 3, Math.floor(y), salt + 1)), x, y, salt, true);
  }
  const coverP = treeP + Math.min(0.9, treeP * 4 + (table.density === 0 ? 0.02 : 0.04));
  if (table.cover.length && roll < coverP) {
    return finish(pick(table.cover, hash2(Math.floor(x) + 5, Math.floor(y), salt + 2)), x, y, salt, false);
  }
  const rockP = coverP + 0.04 + (biome === Biome.Mountain || biome === Biome.Hills ? 0.08 : 0);
  if ((table.rocks.length && roll < rockP) || (biome === Biome.Water && roll > 0.92 && table.rocks.length)) {
    return finish(pick(table.rocks, hash2(Math.floor(x) + 7, Math.floor(y), salt + 3)), x, y, salt, false);
  }
  return null;
}

function pick(list: Species[], roll: number): Species {
  const sum = list.reduce((n, item) => n + item.weight, 0);
  let cursor = roll * sum;
  for (const item of list) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return list[list.length - 1]!;
}

function finish(species: Species, x: number, y: number, salt: number, isTree: boolean): WildProp {
  const yaw = hash2(Math.floor(x) + 11, Math.floor(y) + 13, salt + 9);
  if (isTree || species.propClass === 'tree') {
    const scale = Math.round((0.9 + yaw * 0.2) * 100) / 100;
    return {
      kit: species.kit,
      propClass: 'tree',
      rot: Math.round(yaw * 359),
      scale,
      variant: 'default',
    };
  }
  if (species.propClass === 'rock') {
    return { kit: species.kit, propClass: 'rock', rot: Math.round(yaw * 359), variant: 'default' };
  }
  const snapped = [0, 90, 180, 270][Math.floor(yaw * 4) % 4]!;
  return { kit: species.kit, propClass: species.propClass, rot: snapped, variant: 'default' };
}

export function vegetationBudget(): { vegetation: number; other: number } {
  return { vegetation: VEGETATION_CAP, other: OTHER_CAP };
}

export function isVegetation(propClass: PropClass): boolean {
  return propClass === 'tree' || propClass === 'plant';
}

/** Kit label for a legacy sprite prop. Always returns a species when the biome has one. */
export function labelLegacy(biome: number, x: number, y: number, kind: 'tree' | 'rock' | 'plant' | 'prop'): WildProp | null {
  const table = WILD_DRESS[biome];
  if (!table) return null;
  const list = kind === 'tree' ? table.trees : kind === 'plant' ? table.cover : kind === 'rock' ? table.rocks : [];
  if (!list.length) return null;
  const species = pick(list, hash2(Math.floor(x) + 17, Math.floor(y) + 19, biome + 41));
  return finish(species, x, y, biome + 3, kind === 'tree' || species.propClass === 'tree');
}
