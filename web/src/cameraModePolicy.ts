import type { CameraMode } from './camera';

export function shouldUseFinaleCruise(mode: CameraMode): boolean {
  return mode !== 'free' && mode !== 'pilot';
}
