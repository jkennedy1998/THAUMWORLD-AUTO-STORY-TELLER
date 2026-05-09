import type { CameraSubjectResolver } from '../../engine/camera/camera_subject.js';
import type { WorldPoint3 } from '../../engine/camera/camera_types.js';
import { get_principal_view_plane_axis, type PlaceViewState } from '../../mono_ui/runtime/place_view_projection.js';

export type PainterCameraSubject =
  | { kind: 'document_center' }
  | { kind: 'text_cursor' }
  | { kind: 'tool_anchor' }
  | { kind: 'world_point'; world: WorldPoint3 };

export function create_painter_camera_resolver(deps: {
  resolve_document_center: () => WorldPoint3 | null;
  resolve_text_cursor: () => WorldPoint3 | null;
  resolve_tool_anchor: () => WorldPoint3 | null;
  get_view_state: () => PlaceViewState;
}): CameraSubjectResolver<PainterCameraSubject> {
  function getPreferredFocusPlane(world: WorldPoint3): number {
    const axis = get_principal_view_plane_axis(deps.get_view_state().principal_view);
    if (axis === 'x') return Math.floor(world.x);
    if (axis === 'y') return Math.floor(world.y);
    return Math.floor(world.z);
  }

  return {
    resolveSubject(subject) {
      if (!subject) return null;
      if (subject.kind === 'document_center') {
        const world = deps.resolve_document_center();
        return world ? { world, preferred_focus_plane: getPreferredFocusPlane(world) } : null;
      }
      if (subject.kind === 'text_cursor') {
        const world = deps.resolve_text_cursor();
        return world ? { world, preferred_focus_plane: getPreferredFocusPlane(world) } : null;
      }
      if (subject.kind === 'tool_anchor') {
        const world = deps.resolve_tool_anchor();
        return world ? { world, preferred_focus_plane: getPreferredFocusPlane(world) } : null;
      }
      if (subject.kind === 'world_point') {
        return { world: { ...subject.world }, preferred_focus_plane: getPreferredFocusPlane(subject.world) };
      }
      return null;
    },
  };
}
