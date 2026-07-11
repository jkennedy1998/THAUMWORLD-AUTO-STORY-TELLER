import { create_painter_document, clone_painter_document, create_painter_voxel_record } from './painter_document.js';
import { detectFileFormat, exportPainterAssetToJSON, exportPainterDocumentToJSON, getPainterAssetExportFilename, getPainterAssetExportPath, importPainterDocumentFromJSON } from './save_system.js';

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
document.metadata = {
  created_at: new Date().toISOString(),
  modified_at: new Date().toISOString(),
  time_assets: {
    schema_version: 1,
    particle_effects: [
      {
        schema_version: 1,
        kind: 'single_play_particle_effect',
        id: 'spark_late',
        name: 'Spark Late',
        spawn_breath: 9,
        window_start: 9,
        window_end: 11,
        processed_breaths: 0,
        is_complete: false,
        is_deleted: false,
        visual: { char: '*', display_color: '#ffcc00', render_index: 3, weight_index: 1 },
      },
      {
        schema_version: 1,
        kind: 'single_play_particle_effect',
        id: 'spark_early',
        name: 'Spark Early',
        spawn_breath: 2,
        window_start: 2,
        window_end: 4,
        processed_breaths: 0,
        is_complete: false,
        is_deleted: false,
        visual: { char: '+', display_color: '#ff8800', render_index: 3, weight_index: 1 },
      },
    ],
  },
};
const v6Json = exportPainterDocumentToJSON(document);
const assetJson = exportPainterAssetToJSON(document, 'C:\\tmp\\mage.json');
const assetExport = JSON.parse(assetJson) as any;
assert(assetExport.schema_version === 6, 'asset export should stay version-locked to the painter savefile');
assert(assetExport.asset_id === 'mage' && assetExport.asset_name === 'mage', 'asset export should derive identity from the source file name');
assert(assetExport.kind === 'thaum_asset_export', 'asset export should use the compact asset envelope');
assert(Array.isArray(assetExport.strata?.glyph?.groups) && Array.isArray(assetExport.strata?.sprite?.groups) && Array.isArray(assetExport.strata?.game_object?.groups), 'asset export should preserve all strata');
assert(assetExport.strata.glyph.groups[0]?.cells[0]?.char === '@', 'glyph strata should preserve raster cell data');
assert(assetExport.strata.sprite.groups[0]?.cells[0]?.graphic?.graphic_id === 'text_@', 'sprite strata should preserve graphic data');
assert(assetExport.strata.game_object.groups[0]?.properties?.[document.groups[document.group_order[0]!]!.property_ids[0]!]?.kind === 'raster', 'game object strata should preserve authored properties');
assert(getPainterAssetExportFilename('mage.json') === 'mage_asset.json', 'asset export filename should use the standard sibling suffix');
assert(getPainterAssetExportPath('C:\\tmp\\mage.json') === 'C:\\tmp\\mage_asset.json', 'asset export path should stay beside the painter save file');
const importedV6 = importPainterDocumentFromJSON(v6Json);
assert(importedV6.version === 6, 'v6 painter document should import successfully');
assert(detectFileFormat(v6Json) === 'painter_document', 'detectFileFormat should recognize v6 painter document');
assert(importedV6.metadata?.time_assets?.particle_effects[0]?.id === 'spark_early', 'time assets should normalize into a deterministic order on save/load');
assert(importedV6.metadata?.time_assets?.particle_effects[1]?.id === 'spark_late', 'time assets should preserve later effects on save/load');
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
