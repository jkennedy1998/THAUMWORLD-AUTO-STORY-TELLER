import { create_painter_voxel_record, type PainterPropertyValue, type PainterVoxelRecord } from '../ascii_painter/painter_document.js';
import { clone_appearance_slot_assignments } from '../ascii_painter/types.js';

function clampChannel(value: unknown): number {
  return Math.max(0, Math.min(255, Math.floor(Number(value ?? 0)) || 0));
}

function clampWeight(value: unknown): 0 | 1 | 2 | 3 {
  return Math.max(0, Math.min(3, Math.floor(Number(value ?? 0)) || 0)) as 0 | 1 | 2 | 3;
}

function normalizeGraphic(graphic: any, fallbackWeight: unknown): PainterVoxelRecord['graphic'] {
  if (!graphic || typeof graphic !== 'object') return undefined;
  const graphic_id = String(graphic.graphic_id ?? '').trim();
  if (!graphic_id) return undefined;
  return {
    graphic_id,
    view_direction: String(graphic.view_direction ?? 'south') as any,
    weight_index: clampWeight(graphic.weight_index ?? fallbackWeight ?? 0),
  };
}

function normalizeRgb(rgb: any): { r: number; g: number; b: number } {
  return {
    r: clampChannel(rgb?.r),
    g: clampChannel(rgb?.g),
    b: clampChannel(rgb?.b),
  };
}

export function normalize_painter_command_voxel_record(voxel: any): PainterVoxelRecord {
  return create_painter_voxel_record({
    x: Math.floor(Number(voxel?.x ?? 0)),
    y: Math.floor(Number(voxel?.y ?? 0)),
    z: Math.floor(Number(voxel?.z ?? 0)),
    char: typeof voxel?.char === 'string' && voxel.char.length > 0 ? voxel.char[0]! : ' ',
    graphic: normalizeGraphic(voxel?.graphic, voxel?.weight_index),
    appearance_slots: clone_appearance_slot_assignments(voxel?.appearance_slots),
    materials: voxel?.materials && typeof voxel.materials === 'object' ? { ...voxel.materials } : undefined,
    rgb: normalizeRgb(voxel?.rgb),
    weight_index: clampWeight(voxel?.weight_index),
  });
}

export function normalize_painter_command_apply_group_voxels(voxels: any): Array<{ x: number; y: number; z: number; cell: Pick<PainterVoxelRecord, 'char' | 'graphic' | 'appearance_slots' | 'materials' | 'rgb' | 'weight_index'> }> {
  return Array.isArray(voxels)
    ? voxels.map((voxel: any) => {
        const record = normalize_painter_command_voxel_record(voxel);
        return {
          x: record.x,
          y: record.y,
          z: record.z,
          cell: {
            char: record.char,
            graphic: record.graphic,
            appearance_slots: clone_appearance_slot_assignments(record.appearance_slots),
            materials: record.materials ? { ...record.materials } : undefined,
            rgb: { ...record.rgb },
            weight_index: record.weight_index,
          },
        };
      })
    : [];
}

export function normalize_painter_command_voxel_records(voxels: any): PainterVoxelRecord[] {
  return Array.isArray(voxels)
    ? voxels.map((voxel: any) => normalize_painter_command_voxel_record(voxel))
    : [];
}

export function normalize_painter_command_property_value(value: any): PainterPropertyValue {
  const valueKind = String(value?.kind ?? 'vec3');
  if (valueKind === 'scalar') {
    return { kind: 'scalar', value: Math.floor(Number(value?.value ?? 0)) || 0 };
  }
  if (valueKind === 'raster') {
    return {
      kind: 'raster',
      voxels: normalize_painter_command_voxel_records(value?.voxels),
    };
  }
  return {
    kind: 'vec3',
    x: Math.floor(Number(value?.x ?? 0)) || 0,
    y: Math.floor(Number(value?.y ?? 0)) || 0,
    z: Math.floor(Number(value?.z ?? 0)) || 0,
  };
}
