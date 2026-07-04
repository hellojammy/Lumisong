// 实时录音滑窗的逐帧分析纯函数（Meyda 频谱特征 + pitchy 音高 + 能量 onset）。
// 022：逐帧/onset/聚合/percentiles 抽为导出纯函数，供 streamAnalyzer.ts「边录边出」预览复用。
// 上传文件 / 录后重析已迁至 analyzerEssentia.ts（essentia.js v4，高精度）。
import Meyda from 'meyda';
import { PitchDetector } from 'pitchy';
import type { SyllableData, FeatureRange, RangeKey } from './data';

export const BUFFER = 2048;
export const HOP = 1024; // 浏览器内为性能取 1024（23ms@44.1k，对 ~190ms 音节足够）；方案 A 离线用 512
const ONSET_MIN_GAP_MS = 50;
const ONSET_RISE = 1.6; // rms 超局部均值倍数才算 onset
const F0_MIN = 1500;
const F0_MAX = 10000;
const CLARITY_MIN = 0.8;

export interface Frame {
  t: number;
  centroidHz: number;
  spreadHz: number;
  flatness: number;
  rms: number;
  f0Hz: number | null;
}

export function percentiles(vals: number[]): FeatureRange {
  const a = vals.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (a.length === 0) return { p01: 0, p50: 0, p99: 0, min: 0, max: 0 };
  const q = (p: number): number => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
  return { p01: q(1), p50: q(50), p99: q(99), min: a[0], max: a[a.length - 1] };
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * 逐帧特征提取（022 共享）：对一段 PCM 跑 Meyda + pitchy。
 * tOffset = 该段 PCM 起点在整段录音中的绝对时间（秒），用于流式滑窗对齐绝对 onset 时间。
 */
export function extractFrames(pcm: Float32Array, sr: number, tOffset = 0): Frame[] {
  const binToHz = sr / BUFFER; // Meyda centroid/spread 单位是 bin（BV-ba-01）
  Meyda.bufferSize = BUFFER;
  Meyda.sampleRate = sr;
  const detector = PitchDetector.forFloat32Array(BUFFER);

  const frames: Frame[] = [];
  const nFrames = Math.max(0, Math.floor((pcm.length - BUFFER) / HOP) + 1);
  const window = new Float32Array(BUFFER);

  for (let f = 0; f < nFrames; f++) {
    const start = f * HOP;
    window.set(pcm.subarray(start, start + BUFFER));

    const feat = Meyda.extract(
      ['rms', 'spectralCentroid', 'spectralSpread', 'spectralFlatness'],
      window,
    ) as { rms: number; spectralCentroid: number; spectralSpread: number; spectralFlatness: number };

    const [pitch, clarity] = detector.findPitch(window, sr);
    const f0 = clarity > CLARITY_MIN && pitch >= F0_MIN && pitch <= F0_MAX ? pitch : null;

    frames.push({
      t: tOffset + start / sr,
      centroidHz: (feat.spectralCentroid || 0) * binToHz,
      spreadHz: (feat.spectralSpread || 0) * binToHz,
      flatness: feat.spectralFlatness || 0,
      rms: feat.rms || 0,
      f0Hz: f0,
    });
  }
  return frames;
}

/** 能量 onset 切分（022 共享）：返回 onset 所在帧索引数组 */
export function detectOnsets(frames: Frame[], sr: number): number[] {
  const minGapFrames = Math.ceil((ONSET_MIN_GAP_MS / 1000) * sr / HOP);
  const rmsArr = frames.map((fr) => fr.rms);
  if (rmsArr.length === 0) return [];
  const meanRms = rmsArr.reduce((a, b) => a + b, 0) / rmsArr.length;
  const onsets: number[] = [];
  let last = -minGapFrames;
  for (let i = 1; i < frames.length; i++) {
    const rising = rmsArr[i] > rmsArr[i - 1];
    const loud = rmsArr[i] > meanRms * ONSET_RISE;
    if (rising && loud && i - last >= minGapFrames) {
      onsets.push(i);
      last = i;
    }
  }
  return onsets;
}

/**
 * 逐音节聚合（022 共享）：把帧 + onset 索引聚合成音节。
 * startIndex = 输出音节的起始编号（流式追加时延续全局计数）。
 * lastSegmentToEnd=false 时，最后一个 onset 段落不闭合（流式滑窗末段可能被切断，留待下个窗口）。
 */
export function aggregateSyllables(
  frames: Frame[],
  onsets: number[],
  sr: number,
  startIndex = 0,
  lastSegmentToEnd = true,
): SyllableData[] {
  const syllables: SyllableData[] = [];
  const limit = lastSegmentToEnd ? onsets.length : onsets.length - 1;
  for (let k = 0; k < limit; k++) {
    const a = onsets[k];
    const b = k + 1 < onsets.length ? onsets[k + 1] : frames.length;
    const seg = frames.slice(a, b);
    if (seg.length === 0) continue;
    const voiced = seg.map((s) => s.f0Hz).filter((v): v is number => v != null);
    syllables.push({
      i: startIndex + syllables.length,
      t: +frames[a].t.toFixed(3),
      dur: +(frames[b - 1].t - frames[a].t + HOP / sr).toFixed(3),
      centroidHz: +median(seg.map((s) => s.centroidHz)).toFixed(1),
      spreadHz: +median(seg.map((s) => s.spreadHz)).toFixed(1),
      flatness: +median(seg.map((s) => s.flatness)).toFixed(5),
      rms: +Math.max(...seg.map((s) => s.rms)).toFixed(4),
      f0Hz: voiced.length ? +median(voiced).toFixed(1) : null,
    });
  }
  return syllables;
}

/** 从一组音节算 ranges（022 共享） */
export function computeRanges(syllables: SyllableData[]): Record<RangeKey, FeatureRange> {
  const col = (key: keyof SyllableData): number[] =>
    syllables.map((s) => s[key]).filter((v): v is number => typeof v === 'number');
  return {
    centroidHz: percentiles(col('centroidHz')),
    spreadHz: percentiles(col('spreadHz')),
    flatness: percentiles(col('flatness')),
    rms: percentiles(col('rms')),
    f0Hz: percentiles(col('f0Hz')),
    durSec: percentiles(col('dur')),
  } as Record<RangeKey, FeatureRange>;
}
