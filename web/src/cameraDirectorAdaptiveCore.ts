import type { FeatureRange, SyllableData, SyllablesJson } from './data';

export type AdaptiveDirectorKind = 'spatial' | 'compact';

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface AdaptiveProfile {
  kind: AdaptiveDirectorKind;
  score: number;
  durationScore: number;
  countScore: number;
  densityScore: number;
  voicedScore: number;
  acousticCompactScore: number;
  axisCompactScore: number;
}

export interface CompactSegment {
  index: number;
  start: number;
  end: number;
  count: number;
  center: Vec3Tuple;
  peak: Vec3Tuple;
  direction: Vec3Tuple;
  radius: number;
  density: number;
  peakRms: number;
  pauseBefore: number;
}

export interface CompactShot {
  scope: 'near' | 'overview';
  shoulder: number;
  height: number;
  radiusScale: number;
  lead: number;
}

const SPAN_X = 8;
const SPAN_Y = 5;
const SPAN_Z = 5;
const JITTER = 0.4;
const COMPACT_THRESHOLD = 0.65;

const clamp = (v: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, v));

function norm(v: number, r: FeatureRange): number {
  const span = r.p99 - r.p01;
  if (span <= 0) return 0.5;
  return clamp((v - r.p01) / span);
}

function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const a = [...values].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function dist(a: Vec3Tuple, b: Vec3Tuple): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function normalize(v: Vec3Tuple): Vec3Tuple {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return len > 0.001 ? { x: v.x / len, y: v.y / len, z: v.z / len } : { x: 1, y: 0, z: 0 };
}

function std(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
}

export function adaptivePosition(s: SyllableData, meta: SyllablesJson['meta']): Vec3Tuple {
  if (s.pos) return { x: s.pos[0], y: s.pos[1], z: s.pos[2] };
  const r = meta.ranges;
  const x = (s.t / meta.duration - 0.5) * SPAN_X;
  const y = (norm(s.centroidHz, r.centroidHz) - 0.5) * SPAN_Y;
  const tonality = 1 - norm(s.flatness, r.flatness);
  const z = (tonality - 0.5) * SPAN_Z;
  return {
    x: x + (hash01(s.i * 3 + 0) - 0.5) * JITTER,
    y: y + (hash01(s.i * 3 + 1) - 0.5) * JITTER,
    z: z + (hash01(s.i * 3 + 2) - 0.5) * JITTER,
  };
}

export function classifyAdaptiveProfile(data: SyllablesJson): AdaptiveProfile {
  const syllables = data.syllables;
  const duration = Math.max(data.meta.duration, 0.1);
  const density = syllables.length / duration;
  const positions = syllables.map((s) => adaptivePosition(s, data.meta));
  const sx = std(positions.map((p) => p.x));
  const sy = std(positions.map((p) => p.y));
  const sz = std(positions.map((p) => p.z));
  const yz = Math.sqrt(sy * sy + sz * sz);
  const axisCompactScore = clamp(1 - yz / Math.max(sx * 0.95, 0.8));
  const voicedScore = syllables.length === 0
    ? 0
    : syllables.filter((s) => s.f0Hz !== null && Number.isFinite(s.f0Hz)).length / syllables.length;

  const centroidBand = data.meta.ranges.centroidHz.p99 - data.meta.ranges.centroidHz.p01;
  const spreadBand = data.meta.ranges.spreadHz.p99 - data.meta.ranges.spreadHz.p01;
  const flatnessBand = data.meta.ranges.flatness.p99 - data.meta.ranges.flatness.p01;
  const acousticCompactScore = (
    clamp(1 - (centroidBand - 700) / 4200)
    + clamp(1 - (spreadBand - 500) / 3600)
    + clamp(1 - (flatnessBand - 0.18) / 0.7)
  ) / 3;

  const durationScore = clamp((duration - 140) / 360);
  const countScore = clamp((syllables.length - 420) / 1600);
  const densityScore = clamp(1 - Math.abs(density - 3.2) / 4.8);
  const score = clamp(
    durationScore * 0.18
    + countScore * 0.16
    + densityScore * 0.13
    + voicedScore * 0.13
    + acousticCompactScore * 0.21
    + axisCompactScore * 0.19,
  );

  return {
    kind: score >= COMPACT_THRESHOLD ? 'compact' : 'spatial',
    score,
    durationScore,
    countScore,
    densityScore,
    voicedScore,
    acousticCompactScore,
    axisCompactScore,
  };
}

export function buildCompactSegments(data: SyllablesJson): CompactSegment[] {
  const syllables = data.syllables;
  if (syllables.length === 0) return [];
  const positions = syllables.map((s) => adaptivePosition(s, data.meta));
  const gaps: number[] = [];
  for (let i = 1; i < syllables.length; i++) gaps.push(syllables[i].t - syllables[i - 1].t);
  const medianGap = median(gaps) || 0.25;
  const gapBreak = clamp(medianGap * 3.1, 0.72, 1.55);
  const maxDur = clamp(7.2 - (syllables.length / Math.max(data.meta.duration, 1)) * 0.38, 4.8, 7.2);
  const chunks: SyllableData[][] = [];
  let chunk: SyllableData[] = [];
  for (const s of syllables) {
    const prev = chunk[chunk.length - 1];
    const startsNew = prev
      && (s.t - prev.t > gapBreak || s.t - chunk[0].t > maxDur);
    if (startsNew) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(s);
  }
  if (chunk.length) chunks.push(chunk);

  return chunks.map((items, index) => {
    const start = items[0].t;
    const last = items[items.length - 1];
    const end = Math.max(last.t + last.dur, start + 0.18);
    let weightSum = 0;
    const center = { x: 0, y: 0, z: 0 };
    let peak = items[0];
    for (const s of items) {
      const p = positions[s.i];
      const w = 0.4 + norm(s.rms, data.meta.ranges.rms) * 0.6;
      center.x += p.x * w;
      center.y += p.y * w;
      center.z += p.z * w;
      weightSum += w;
      if (s.rms > peak.rms) peak = s;
    }
    center.x /= weightSum;
    center.y /= weightSum;
    center.z /= weightSum;
    let radius = 0;
    for (const s of items) radius = Math.max(radius, dist(positions[s.i], center));
    const firstPos = positions[items[0].i];
    const lastPos = positions[last.i];
    const direction = normalize({
      x: lastPos.x - firstPos.x,
      y: lastPos.y - firstPos.y,
      z: lastPos.z - firstPos.z,
    });
    return {
      index,
      start,
      end,
      count: items.length,
      center,
      peak: positions[peak.i],
      direction,
      radius,
      density: items.length / Math.max(end - start, 0.18),
      peakRms: norm(peak.rms, data.meta.ranges.rms),
      pauseBefore: index === 0 ? 0 : start - chunks[index - 1][chunks[index - 1].length - 1].t,
    };
  });
}

export function assignCompactShots(segments: CompactSegment[]): CompactShot[] {
  const motifs: CompactShot[] = [
    { scope: 'near', shoulder: -0.08, height: 0.5, radiusScale: 0.66, lead: 0.14 },
    { scope: 'near', shoulder: 0.52, height: 0.58, radiusScale: 0.7, lead: 0.12 },
    { scope: 'near', shoulder: 1.08, height: 0.72, radiusScale: 0.8, lead: 0.1 },
    { scope: 'near', shoulder: 2.05, height: 0.48, radiusScale: 0.64, lead: 0.16 },
    { scope: 'near', shoulder: 2.62, height: 0.62, radiusScale: 0.76, lead: 0.1 },
    { scope: 'near', shoulder: 0.86, height: 0.68, radiusScale: 0.72, lead: 0.14 },
  ];
  const overviewMotifs: CompactShot[] = [
    { scope: 'overview', shoulder: 0.18, height: 0.9, radiusScale: 1.06, lead: 0.08 },
    { scope: 'overview', shoulder: 2.34, height: 0.82, radiusScale: 1.12, lead: 0.06 },
  ];
  return segments.map((segment) => {
    if (segment.index > 0 && (segment.index % 9 === 0 || segment.pauseBefore > 1.35)) {
      return overviewMotifs[Math.floor(segment.index / 9) % overviewMotifs.length];
    }
    const energyBias = segment.peakRms > 0.72 ? 1 : 0;
    const pauseBias = segment.pauseBefore > 0.9 ? 2 : 0;
    const motifIndex = (Math.floor(segment.index / 2) + energyBias + pauseBias) % motifs.length;
    return motifs[motifIndex];
  });
}
