// 爆亮包络与 HDR 契约常量，唯一出处：openspec/design/visual-mapping.md §5/§6

export const ATTACK = 0.03;
export const DECAY = 0.35;

// 005 光体展示：基态 1.15 略过 bloom 阈值(1.0) → 静息即霓虹微光；
// 爆亮峰值 1.15+5.5=6.65 仍数倍于基态，「哨箭」对比保留
export const EMISSIVE_BASE = 1.15;
export const EMISSIVE_GAIN = 5.5;
// 013/014 渐进点亮：未播放的球 = 幽灵蓄势态（暗+小），发声后转正式态并保持。
// 014 加强对比：亮度差会被 ACES 压缩，叠加尺寸差（不受色调映射影响的强线索）
export const EMISSIVE_UNPLAYED = 0.18;
export const SHELL_UNPLAYED = 0.3;   // 未播放球的玻璃壳着色衰减
export const SCALE_UNPLAYED = 0.78;  // 未播放球的尺寸衰减
export const SCALE_GAIN = 1.6;

/** attack-decay 包络（纯函数，BV-pf-02） */
export function flare(dt: number, attack = ATTACK, decay = DECAY): number {
  if (dt < 0) return 0;
  if (dt < attack) return dt / attack;
  return Math.exp(-(dt - attack) / decay);
}

/** 包络衰减到可忽略所需的窗口长度（活跃窗口边界用） */
export const FLARE_WINDOW = 1.0;
