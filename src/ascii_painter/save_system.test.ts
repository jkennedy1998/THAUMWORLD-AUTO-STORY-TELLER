import { create_painter_document, clone_painter_document, create_painter_voxel_record } from './painter_document.js';
import { detectFileFormat, exportPainterDocumentToJSON, importPainterDocumentFromJSON } from './save_system.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const document = create_painter_document(4, 3, { min_z: 0, max_z: 1, default_group_name: 'Test' });
const firstGroup = document.groups[document.group_order[0]!]!;
const firstRaster = firstGroup.properties[firstGroup.property_ids[0]!]!;
if (firstRaster.blocks[0]?.type === 'blank') {
  firstRaster.blocks = [{
    id: 'content_0',
    type: 'content',
    start: 0,
    end: 0,
    value: {
      kind: 'raster',
      voxels: [create_painter_voxel_record({
        x: 1,
        y: 1,
        z: 0,
        char: '@',
        graphic: { graphic_id: 'text_@', view_direction: 'south', weight_index: 2 },
        appearance_slots: { 1: { kind: 'flat_rgb', rgb: { r: 12, g: 34, b: 56 } } },
        materials: { 1: 'STONE_PALE' },
        rgb: { r: 12, g: 34, b: 56 },
        weight_index: 2,
      })],
    },
  }];
}
const v6Json = exportPainterDocumentToJSON(document);
const importedV6 = importPainterDocumentFromJSON(v6Json);
assert(importedV6.version === 6, 'v6 painter document should import successfully');
assert(detectFileFormat(v6Json) === 'painter_document', 'detectFileFormat should recognize v6 painter document');
const importedVoxel = importedV6.groups[importedV6.group_order[0]!]!.properties[importedV6.groups[importedV6.group_order[0]!]!.property_ids[0]!]!.blocks[0];
assert(importedVoxel?.type === 'content', 'imported raster block should remain content');
if (importedVoxel?.type === 'content' && importedVoxel.value.kind === 'raster') {
  const voxel = importedVoxel.value.voxels[0]!;
  assert(voxel.graphic?.graphic_id === 'text_@', 'graphic payload should survive painter document save/load');
  assert(voxel.appearance_slots?.[1]?.kind === 'flat_rgb', 'appearance slots should survive painter document save/load');
  assert(voxel.materials?.[1] === 'STONE_PALE', 'legacy material payload should survive painter document save/load');
}

const v4Document = { ...clone_painter_document(document), version: 4 as const };
const v4Json = JSON.stringify(v4Document);
const importedV4 = importPainterDocumentFromJSON(v4Json);
assert(importedV4.version === 6, 'v4 painter document should normalize to v6 on import');
assert(detectFileFormat(v4Json) === 'painter_document', 'detectFileFormat should recognize v4 painter document');

console.log('save_system tests passed');
