export const FADE_DELAY = 2;
export const FADE_DUR = 1.8;
export const FADE_FLOOR = 0;

/** 渐隐因子：播完定格时 finishedHold 跳过时间轴渐隐 */
export function fadeFactorAtPlayhead(
  nowCache: number,
  syllableT: number,
  fxFade: boolean,
  finishedHold: boolean,
): number {
  if (finishedHold) return 1;
  if (!fxFade || syllableT > nowCache) return 1;
  const dt = nowCache - syllableT - FADE_DELAY;
  if (dt <= 0) return 1;
  const k = Math.min(dt / FADE_DUR, 1);
  return 1 - (1 - FADE_FLOOR) * (k * k * (3 - 2 * k));
}
