// 色谱系统（006 配色探索器）：多套预置方案运行时可切，颜色经逐实例 emissive 全纯度直出。
// 映射语义恒定：t=0 低 spread → t=1 高 spread；数据契约见 design/visual-mapping.md §2。
import * as THREE from 'three';

export interface Palette {
  key: string;
  label: string;
  stops: [number, string][];
}

export const PALETTES: Palette[] = [
  {
    key: 'ice',
    label: '冰蓝',
    // 单色系：深海蓝 → 冰白。极简高级，低 spread 沉、高 spread 亮
    stops: [
      [0.0, '#1E3A8A'], [0.3, '#2563EB'], [0.55, '#0EA5E9'],
      [0.8, '#67E8F9'], [1.0, '#E0F2FE'],
    ],
  },
  {
    key: 'magma',
    label: '熔金',
    // magma 科学色谱：紫 → 绯红 → 橙 → 淡金，暗底华丽
    stops: [
      [0.0, '#3B0F70'], [0.25, '#8C2981'], [0.5, '#DE4968'],
      [0.75, '#FE9F6D'], [1.0, '#FCFDBF'],
    ],
  },
  {
    key: 'viridis',
    label: '翠序',
    // viridis：紫 → 青绿 → 明黄，科学可视化标准
    stops: [
      [0.0, '#440154'], [0.25, '#3B528B'], [0.5, '#21918C'],
      [0.75, '#5EC962'], [1.0, '#FDE725'],
    ],
  },
  {
    key: 'amber',
    label: '琥珀',
    // 017：暖单色系（深琥珀 → 金 → 暖白），与冰蓝冷暖对仗，呼应 uupm 橙强调色
    stops: [
      [0.0, '#7C2D12'], [0.28, '#C2410C'], [0.55, '#F97316'],
      [0.8, '#FBBF24'], [1.0, '#FEF3C7'],
    ],
  },
];

let active: Palette = PALETTES[0];
// r184 颜色管理默认开启：new Color(hex) 自动转入线性工作空间，Color.lerp 即线性插值（BV-cv-06）
let stopColors: THREE.Color[] = active.stops.map(([, hex]) => new THREE.Color(hex));

export function getPalette(): Palette {
  return active;
}

export function setPalette(key: string): Palette {
  active = PALETTES.find((p) => p.key === key) ?? PALETTES[0];
  stopColors = active.stops.map(([, hex]) => new THREE.Color(hex));
  return active;
}

export function nextPalette(): Palette {
  const i = PALETTES.findIndex((p) => p.key === active.key);
  return setPalette(PALETTES[(i + 1) % PALETTES.length].key);
}

export function sampleColormap(t: number, out = new THREE.Color()): THREE.Color {
  const stops = active.stops;
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  let idx = 0;
  while (idx < stops.length - 2 && x > stops[idx + 1][0]) idx++;
  const t0 = stops[idx][0];
  const t1 = stops[idx + 1][0];
  const local = (x - t0) / (t1 - t0);
  return out.copy(stopColors[idx]).lerp(stopColors[idx + 1], Math.min(Math.max(local, 0), 1));
}

/** 供图例 DOM 使用的 CSS 渐变（sRGB 原值，方向自下而上） */
export function legendCssGradient(): string {
  const segs = active.stops.map(([t, hex]) => `${hex} ${(t * 100).toFixed(0)}%`);
  return `linear-gradient(to top, ${segs.join(', ')})`;
}
