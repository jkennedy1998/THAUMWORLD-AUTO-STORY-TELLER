import type { WorldPoint3 } from './camera_types.js';

export type CameraResolvedSubject = {
  world: WorldPoint3;
  preferred_focus_plane?: number | null;
};

export interface CameraSubjectResolver<TSubject> {
  resolveSubject(subject: TSubject | null): CameraResolvedSubject | null;
}
