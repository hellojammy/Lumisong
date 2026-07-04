import * as THREE from 'three';

export type DirectorStyle = 'overview' | 'timeline' | 'overhead' | 'push';

/** 智能运镜 focus 指数低通速率（比飞船兴趣区略慢，减少密集段抖动） */
export const DIRECTOR_FOCUS_SMOOTH_K = 0.32;

export const DEFAULT_DIRECTOR_SMOOTH_POS = 0.36;
export const DEFAULT_DIRECTOR_SMOOTH_TARGET = 0.52;

/** 按 phrase 风格与是否跟焦返回 Rig 分档平滑系数 */
export function directorSmoothHints(
  style: DirectorStyle,
  hasPlayFocus: boolean,
): { smoothPos: number; smoothTarget: number } {
  let smoothPos = 0.28;
  let smoothTarget = 0.38;
  if (style === 'timeline' || style === 'overhead') {
    smoothPos = 0.30;
    smoothTarget = 0.42;
  } else if (style === 'push') {
    smoothPos = 0.40;
    smoothTarget = 0.55;
  }
  if (hasPlayFocus) {
    smoothPos = Math.max(smoothPos, 0.38);
    smoothTarget = Math.max(smoothTarget, 0.58);
  }
  return { smoothPos, smoothTarget };
}

/** 单步 focus 低通（供 Rig 与单测） */
export function lerpDirectorFocus(
  out: THREE.Vector3,
  hasValue: boolean,
  raw: THREE.Vector3 | null,
  dt: number,
): { value: THREE.Vector3 | null; hasValue: boolean } {
  if (!raw) return { value: null, hasValue: false };
  if (!hasValue) {
    out.copy(raw);
    return { value: out, hasValue: true };
  }
  out.lerp(raw, 1 - Math.exp(-dt * DIRECTOR_FOCUS_SMOOTH_K));
  return { value: out, hasValue: true };
}
