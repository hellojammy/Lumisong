// 数据契约与加载，对齐 openspec/design/data-schema.md

export interface FeatureRange {
  p01: number; p50: number; p99: number; min: number; max: number;
}

export type RangeKey = 'centroidHz' | 'spreadHz' | 'flatness' | 'rms' | 'f0Hz' | 'durSec';

export interface SyllableData {
  i: number;
  t: number;
  dur: number;
  centroidHz: number;
  spreadHz: number;
  flatness: number;
  rms: number;
  f0Hz: number | null;
  pos?: [number, number, number]; // 方案二（MFCC 流形）预留
}

export interface SyllablesJson {
  meta: {
    version: 1;
    audioFile: string;
    sampleRate: number;
    duration: number;
    nSyllables: number;
    analysis: { nFft: number; hop: number; onset: string };
    ranges: Record<RangeKey, FeatureRange>;
  };
  syllables: SyllableData[];
}

/** 归一化：p01–p99 min-max + clamp（visual-mapping §1） */
export function norm(v: number, r: FeatureRange): number {
  const span = r.p99 - r.p01;
  if (span <= 0) return 0.5;
  const t = (v - r.p01) / span;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export async function loadData(url = '/data/syllables.json'): Promise<SyllablesJson> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`数据加载失败：HTTP ${res.status}`);
  const json = (await res.json()) as SyllablesJson;
  if (json?.meta?.version !== 1) throw new Error('数据校验失败：version !== 1');
  if (!Array.isArray(json.syllables) || json.syllables.length === 0) {
    throw new Error('数据校验失败：syllables 为空');
  }
  if (!json.meta.ranges?.spreadHz) throw new Error('数据校验失败：缺少 meta.ranges');
  return json;
}
