// 布局：可解释三轴 + 确定性抖动；pos 字段优先（visual-mapping §7）
import * as THREE from 'three';
import { norm, type SyllableData, type SyllablesJson } from './data';

export const SPAN_X = 8;
export const SPAN_Y = 5;
export const SPAN_Z = 5;
const JITTER = 0.4;

/** 确定性伪随机（禁 Math.random，BV-cv-04） */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function layoutPosition(
  s: SyllableData,
  meta: SyllablesJson['meta'],
  out = new THREE.Vector3(),
): THREE.Vector3 {
  if (s.pos) return out.set(s.pos[0], s.pos[1], s.pos[2]); // 方案二直通

  const r = meta.ranges;
  const x = (s.t / meta.duration - 0.5) * SPAN_X;
  const y = (norm(s.centroidHz, r.centroidHz) - 0.5) * SPAN_Y;
  const tonality = 1 - norm(s.flatness, r.flatness);
  const z = (tonality - 0.5) * SPAN_Z;
  return out.set(
    x + (hash01(s.i * 3 + 0) - 0.5) * JITTER,
    y + (hash01(s.i * 3 + 1) - 0.5) * JITTER,
    z + (hash01(s.i * 3 + 2) - 0.5) * JITTER,
  );
}
