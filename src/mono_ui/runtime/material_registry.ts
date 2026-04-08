import { get_color_by_name, type ColorName } from '../colors.js';

export type MaterialDef = {
  id: string;
  name: string;
  render: {
    colors: {
      darkest: ColorName;
      '2nd_darkest': ColorName;
      '2nd_lightest': ColorName;
      lightest: ColorName;
    };
  };
  rules: {
    hardness_mag?: number;
    weight_mag?: number;
    flammability_mag?: number;
  };
  contributes_tags?: string[];
};

const MATERIAL_DEFS = new Map<string, MaterialDef>([
  ['FOLIAGE_GREEN', {
    id: 'FOLIAGE_GREEN',
    name: 'Green Foliage',
    render: {
      colors: {
        darkest: 'deep_green',
        '2nd_darkest': 'gray_green',
        '2nd_lightest': 'medium_green',
        lightest: 'pale_green',
      },
    },
    rules: { hardness_mag: 1, weight_mag: 1, flammability_mag: 3 },
    contributes_tags: ['FLORA', 'FLAMMABLE'],
  }],
  ['WOOD_LIVE', {
    id: 'WOOD_LIVE',
    name: 'Live Wood',
    render: {
      colors: {
        darkest: 'deep_red',
        '2nd_darkest': 'vivid_brown',
        '2nd_lightest': 'light_brown',
        lightest: 'pale_orange',
      },
    },
    rules: { hardness_mag: 2, weight_mag: 2, flammability_mag: 3 },
    contributes_tags: ['WOOD', 'FLAMMABLE'],
  }],
  ['BRONZE', {
    id: 'BRONZE',
    name: 'Bronze',
    render: {
      colors: {
        darkest: 'vivid_brown',
        '2nd_darkest': 'light_brown',
        '2nd_lightest': 'light_orange',
        lightest: 'vivid_yellow',
      },
    },
    rules: { hardness_mag: 3, weight_mag: 3, flammability_mag: 0 },
    contributes_tags: ['METAL'],
  }],
  ['STONE_PALE', {
    id: 'STONE_PALE',
    name: 'Pale Stone',
    render: {
      colors: {
        darkest: 'dark_gray',
        '2nd_darkest': 'medium_gray',
        '2nd_lightest': 'light_gray',
        lightest: 'pale_gray',
      },
    },
    rules: { hardness_mag: 3, weight_mag: 4, flammability_mag: 0 },
    contributes_tags: ['STONE'],
  }],
  ['IRON_PALE', {
    id: 'IRON_PALE',
    name: 'Pale Iron',
    render: {
      colors: {
        darkest: 'dark_gray',
        '2nd_darkest': 'medium_gray',
        '2nd_lightest': 'light_gray',
        lightest: 'off_white',
      },
    },
    rules: { hardness_mag: 4, weight_mag: 4, flammability_mag: 0 },
    contributes_tags: ['METAL'],
  }],
]);

export function get_material_def(id: string | null | undefined): MaterialDef | null {
  if (typeof id !== 'string' || id.trim().length <= 0) return null;
  return MATERIAL_DEFS.get(id.trim().toUpperCase()) ?? null;
}

export function resolve_material_rgb(id: string | null | undefined, value: 'darkest' | '2nd_darkest' | '2nd_lightest' | 'lightest') {
  const material = get_material_def(id);
  if (!material) return null;
  return get_color_by_name(material.render.colors[value]).rgb;
}
