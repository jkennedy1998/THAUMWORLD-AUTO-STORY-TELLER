import type { ControlActionDefinition } from './controls_registry.js';

export const PAINTER_CONTROLS_PROFILE: ControlActionDefinition[] = [
  { id: 'painter.tool_assign.pencil', label: 'Assign Pencil Tool', category: 'Tools', system: 'painter', default_binding: { kind: 'keyboard', code: 'KeyP' } },
  { id: 'painter.tool_assign.eraser', label: 'Assign Eraser Tool', category: 'Tools', system: 'painter', default_binding: { kind: 'keyboard', code: 'KeyE' } },
  { id: 'painter.tool_assign.bucket', label: 'Assign Bucket Tool', category: 'Tools', system: 'painter', default_binding: { kind: 'keyboard', code: 'KeyB' } },
  { id: 'painter.tool_assign.eyedropper', label: 'Assign Eyedropper Tool', category: 'Tools', system: 'painter', default_binding: { kind: 'keyboard', code: 'KeyI' } },
  { id: 'painter.tool_assign.line', label: 'Assign Line Tool', category: 'Tools', system: 'painter', default_binding: { kind: 'keyboard', code: 'KeyL' } },
  { id: 'painter.tool_assign.rect_stroke', label: 'Assign Rect Stroke Tool', category: 'Tools', system: 'painter', default_binding: { kind: 'keyboard', code: 'KeyR' } },
  { id: 'painter.tool_assign.rect_fill', label: 'Assign Rect Fill Tool', category: 'Tools', system: 'painter', default_binding: { kind: 'keyboard', code: 'KeyS' } },
  { id: 'painter.tool_assign.text', label: 'Assign Text Tool', category: 'Tools', system: 'painter', default_binding: { kind: 'keyboard', code: 'KeyT' } },
  { id: 'painter.tool_assign.selectangle', label: 'Assign Rect Selection Tool', category: 'Tools', system: 'painter', default_binding: { kind: 'keyboard', code: 'KeyM' } },
  { id: 'painter.tool_assign.lassoselect', label: 'Assign Lasso Selection Tool', category: 'Tools', system: 'painter', default_binding: { kind: 'keyboard', code: 'KeyN' } },
  { id: 'painter.tool_assign.copy', label: 'Assign Copy Tool', category: 'Tools', system: 'painter', default_binding: { kind: 'keyboard', code: 'KeyC' } },
  { id: 'painter.tool_assign.paste', label: 'Assign Paste Tool', category: 'Tools', system: 'painter', default_binding: { kind: 'keyboard', code: 'KeyV' } },
];
