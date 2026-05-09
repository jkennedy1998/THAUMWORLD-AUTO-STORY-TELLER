import type { CameraSubjectResolver } from '../../engine/camera/camera_subject.js';
import type { WorldPoint3 } from '../../engine/camera/camera_types.js';

export type ThaumworldPlaceCameraSubject =
  | { kind: 'entity_ref'; entity_ref: string }
  | { kind: 'place_center'; place_id?: string | null }
  | { kind: 'world_point'; world: WorldPoint3 };

export function create_thaumworld_place_camera_resolver(deps: {
  resolve_entity_world: (entity_ref: string) => WorldPoint3 | null;
  resolve_place_center_world: (place_id?: string | null) => WorldPoint3 | null;
}): CameraSubjectResolver<ThaumworldPlaceCameraSubject> {
  return {
    resolveSubject(subject) {
      if (!subject) return null;
      if (subject.kind === 'entity_ref') {
        const world = deps.resolve_entity_world(subject.entity_ref);
        return world ? { world, preferred_focus_plane: Math.floor(world.z) } : null;
      }
      if (subject.kind === 'place_center') {
        const world = deps.resolve_place_center_world(subject.place_id);
        return world ? { world, preferred_focus_plane: Math.floor(world.z) } : null;
      }
      if (subject.kind === 'world_point') {
        return { world: { ...subject.world }, preferred_focus_plane: Math.floor(subject.world.z) };
      }
      return null;
    },
  };
}
