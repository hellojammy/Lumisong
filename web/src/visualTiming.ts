export const PLAYBACK_FILL_FACTOR = 0.25;
export const PLAYBACK_FILL_MIN = 0.035;
export const PLAYBACK_FILL_MAX = 0.18;

/** Keep parsed-upload playback visuals close to the audible onset. */
export function playbackFillDuration(gapSec: number): number {
  return Math.min(
    Math.max(gapSec * PLAYBACK_FILL_FACTOR, PLAYBACK_FILL_MIN),
    PLAYBACK_FILL_MAX,
  );
}
