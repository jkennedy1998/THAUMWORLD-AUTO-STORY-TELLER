import { create_painter_document, clone_painter_document } from './painter_document.js';
import { detectFileFormat, exportPainterDocumentToJSON, importPainterDocumentFromJSON } from './save_system.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const document = create_painter_document(4, 3, { min_z: 0, max_z: 1, default_group_name: 'Test' });
const v5Json = exportPainterDocumentToJSON(document);
const importedV5 = importPainterDocumentFromJSON(v5Json);
assert(importedV5.version === 5, 'v5 painter document should import successfully');
assert(detectFileFormat(v5Json) === 'painter_document', 'detectFileFormat should recognize v5 painter document');

const v4Document = { ...clone_painter_document(document), version: 4 as const };
const v4Json = JSON.stringify(v4Document);
const importedV4 = importPainterDocumentFromJSON(v4Json);
assert(importedV4.version === 5, 'v4 painter document should normalize to v5 on import');
assert(detectFileFormat(v4Json) === 'painter_document', 'detectFileFormat should recognize v4 painter document');

console.log('save_system tests passed');
