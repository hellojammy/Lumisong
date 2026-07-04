// 浏览器内音频分析（essentia.js v4 / openspec 022-offline-analysis）
// 上传音频 / 录后重析 → essentia.js（wasm）频谱特征 + PitchYinFFT 音高 +
// spectral-flux onset → 同构 SyllablesJson。算法链逐字复刻 PoC v4：
//   分析/poc-essentia-vs-librosa/run-essentia-v4-as-syllables.mjs
// 实时录音「边录边出」仍用 analyzer.ts（Meyda），见 streamAnalyzer.ts。
//
// essentia.js 0.1.3 是 ~2MB wasm，启动 ~1s：懒加载（首次分析才动态 import）、单例复用。
// 浏览器禁止主线程同步编译 >4KB wasm，运行时为异步初始化，须等 onRuntimeInitialized。
import type { SyllableData, SyllablesJson, FeatureRange, RangeKey } from './data';
import { AUDIO_PROFILES, type AudioProfileKey } from './audioProfile.ts';

const N_FFT = 2048;
const HOP = 512; // 与 librosa / PoC v4 对齐（离线整段分析，非实时，取密集 hop）
const ONSET_PRE_AVG = 10;
const ONSET_POST_AVG = 10;
const PITCH_CONF_MIN = 0.5;
const PITCH_TOLERANCE = 0.15;

export interface AnalysisParams {
  profile: AudioProfileKey;
  fmin: number;
  fmax: number;
  onsetDelta: number;
  onsetWait: number;
  onsetPreAvg: number;
  onsetPostAvg: number;
  pitchConfidenceMin: number;
  pitchTolerance: number;
}

export function analysisParamsForProfile(profile: AudioProfileKey = 'bird', sr: number): AnalysisParams {
  const p = AUDIO_PROFILES[profile] ?? AUDIO_PROFILES.bird;
  return {
    profile: p.key,
    fmin: p.fmin,
    fmax: Math.min(p.fmaxCap, sr / 2 - 100),
    onsetDelta: p.onsetDelta,
    onsetWait: p.onsetWait,
    onsetPreAvg: ONSET_PRE_AVG,
    onsetPostAvg: ONSET_POST_AVG,
    pitchConfidenceMin: PITCH_CONF_MIN,
    pitchTolerance: PITCH_TOLERANCE,
  };
}

// —— 纯 helper（与 wasm 解耦，可单测；逐字复刻 PoC v4）——

export function percentiles(arr: number[]): FeatureRange {
  const xs = arr.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return { p01: 0, p50: 0, p99: 0, min: 0, max: 0 };
  const q = (p: number): number =>
    xs[Math.min(xs.length - 1, Math.max(0, Math.floor((p / 100) * (xs.length - 1))))];
  // 7 位精度：避免极小值（如 flatness ~1e-6）被截断为 0 导致归一化 span=0（PoC §5.1）
  const r = (v: number): number => Math.round(v * 10000000) / 10000000;
  return { p01: r(q(1)), p50: r(q(50)), p99: r(q(99)), min: r(xs[0]), max: r(xs[xs.length - 1]) };
}

export function median(xs: number[]): number | null {
  const a = xs.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export interface PeakOpts {
  preMax?: number; postMax?: number; preAvg?: number; postAvg?: number; delta?: number; wait?: number;
}

/** 归一化谱通量后做峰值挑选（复刻 librosa onset peak-picking） */
export function pickPeaks(nv: Float32Array | number[], opts: PeakOpts = {}): number[] {
  const { preMax = 3, postMax = 3, preAvg = 10, postAvg = 10, delta = 0.07, wait = 2 } = opts;
  const peaks: number[] = [];
  let prev = -Infinity;
  let mn = Infinity, mx = -Infinity;
  for (const v of nv) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const range = mx - mn || 1;
  const n01 = Array.from(nv, (v) => (v - mn) / range);
  for (let i = 1; i < n01.length - 1; i++) {
    if (i - prev < wait) continue;
    let isMax = true;
    for (let k = Math.max(0, i - preMax); k <= Math.min(n01.length - 1, i + postMax); k++) {
      if (k !== i && n01[k] >= n01[i]) { isMax = false; break; }
    }
    if (!isMax) continue;
    let sum = 0, cnt = 0;
    for (let k = Math.max(0, i - preAvg); k <= Math.min(n01.length - 1, i + postAvg); k++) { sum += n01[k]; cnt++; }
    if (n01[i] < sum / cnt + delta) continue;
    peaks.push(i);
    prev = i;
  }
  return peaks;
}

/** onset 回溯到能量谷底（复刻 librosa backtrack） */
export function backtrack(peakIdx: number[], nv: Float32Array | number[]): number[] {
  return peakIdx.map((p) => {
    let i = p;
    while (i > 0 && nv[i - 1] <= nv[i]) i--;
    return i;
  });
}

// —— essentia wasm 懒加载单例 ——

interface EssentiaVec { size(): number; get(i: number): number; delete(): void }
interface FrameVec { size(): number; get(i: number): Float32Array; delete(): void }
interface EssentiaApi {
  FrameGenerator(pcm: Float32Array, frameSize: number, hopSize: number): FrameVec;
  Windowing(frame: Float32Array, normalized: boolean, size: number, type: string, zeroPadding: number, zeroPhase: boolean): { frame: Float32Array };
  Spectrum(frame: Float32Array, size: number): { spectrum: EssentiaVec };
  PowerSpectrum(signal: Float32Array, size: number): { powerSpectrum: EssentiaVec };
  Flatness(array: EssentiaVec): { flatness: number };
  RMS(array: Float32Array): { rms: number };
  PitchYinFFT(spectrum: EssentiaVec, frameSize: number, interpolate: boolean, maxFrequency: number, minFrequency: number, sampleRate: number, tolerance: number): { pitch: number; pitchConfidence: number };
  vectorToArray(vec: EssentiaVec): Float32Array;
}

let essentiaPromise: Promise<EssentiaApi> | null = null;

function waitForRuntime(wasm: { EssentiaJS?: unknown; calledRun?: boolean; onRuntimeInitialized?: () => void }): Promise<void> {
  return new Promise((resolve) => {
    if (wasm.EssentiaJS || wasm.calledRun) { resolve(); return; }
    const prev = wasm.onRuntimeInitialized;
    wasm.onRuntimeInitialized = () => {
      if (typeof prev === 'function') prev();
      resolve();
    };
  });
}

async function getEssentia(): Promise<EssentiaApi> {
  if (!essentiaPromise) {
    essentiaPromise = (async () => {
      const [{ EssentiaWASM }, { default: Essentia }] = await Promise.all([
        import('essentia.js/dist/essentia-wasm.es.js'),
        import('essentia.js/dist/essentia.js-core.es.js'),
      ]);
      await waitForRuntime(EssentiaWASM as Parameters<typeof waitForRuntime>[0]);
      return new Essentia(EssentiaWASM) as unknown as EssentiaApi;
    })();
  }
  return essentiaPromise;
}

const yieldToUI = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// —— 核心分析（上传 / 录后重析共用）——

async function runCore(
  pcm: Float32Array,
  sr: number,
  fileName: string,
  onProgress?: (p: number) => void,
  profile: AudioProfileKey = 'bird',
): Promise<SyllablesJson> {
  const ess = await getEssentia();
  const dur = pcm.length / sr;
  const params = analysisParamsForProfile(profile, sr);

  const halfBin = N_FFT / 2 + 1;
  const freqBins = new Float32Array(halfBin);
  for (let k = 0; k < halfBin; k++) freqBins[k] = (k * sr) / N_FFT;

  const frames = ess.FrameGenerator(pcm, N_FFT, HOP);
  const nFrames = frames.size();
  const specStore: Float32Array[] = new Array(nFrames);
  const centroid = new Float32Array(nFrames);
  const spread = new Float32Array(nFrames);
  const flatness = new Float32Array(nFrames);
  const rms = new Float32Array(nFrames);
  const f0 = new Float32Array(nFrames);

  for (let i = 0; i < nFrames; i++) {
    const frame = frames.get(i);
    const windowed = ess.Windowing(frame, true, N_FFT, 'hann', 0, true).frame;
    const spec = ess.Spectrum(windowed, N_FFT).spectrum;
    const specArr = ess.vectorToArray(spec);
    specStore[i] = specArr;
    const pspec = ess.PowerSpectrum(windowed, N_FFT).powerSpectrum;
    let num = 0, den = 0;
    for (let k = 0; k < halfBin; k++) { num += freqBins[k] * specArr[k]; den += specArr[k]; }
    const c = den > 0 ? num / den : 0;
    centroid[i] = c;
    let s = 0;
    if (den > 0) for (let k = 0; k < halfBin; k++) { const dd = freqBins[k] - c; s += specArr[k] * dd * dd; }
    spread[i] = Math.sqrt(s / Math.max(den, 1e-9));
    flatness[i] = ess.Flatness(pspec).flatness;
    rms[i] = ess.RMS(frame).rms;
    const r = ess.PitchYinFFT(spec, N_FFT, true, params.fmax, params.fmin, sr, params.pitchTolerance);
    f0[i] = r.pitchConfidence > params.pitchConfidenceMin ? r.pitch : NaN;
    // 释放本帧中间 wasm 向量（值已提取），避免浏览器内存随帧数增长
    spec.delete();
    pspec.delete();
    if (i % 256 === 0) {
      onProgress?.(i / Math.max(nFrames, 1));
      await yieldToUI();
    }
  }
  frames.delete();

  // 谱通量 + backtrack onset
  const flux = new Float32Array(nFrames);
  for (let i = 1; i < nFrames; i++) {
    let s = 0;
    const cur = specStore[i], prev = specStore[i - 1];
    for (let k = 0; k < halfBin; k++) {
      const dd = cur[k] - prev[k];
      if (dd > 0) s += dd;
    }
    flux[i] = s;
  }
  const peakIdx = pickPeaks(flux, {
    preMax: 3,
    postMax: 3,
    preAvg: params.onsetPreAvg,
    postAvg: params.onsetPostAvg,
    delta: params.onsetDelta,
    wait: params.onsetWait,
  });
  const onsetTimes = backtrack(peakIdx, flux).map((i) => (i * HOP) / sr);

  const bounds = [...onsetTimes, dur];
  const frameIdx = (t: number): number => Math.max(0, Math.min(nFrames - 1, Math.round((t * sr) / HOP)));
  const inBand = (v: number): boolean => Number.isFinite(v) && v >= params.fmin && v <= params.fmax;
  const r1 = (v: number | null): number => (v == null ? 0 : Math.round(v * 10) / 10);

  const syllables: SyllableData[] = [];
  for (let i = 0; i < onsetTimes.length; i++) {
    const t0 = bounds[i], t1 = bounds[i + 1];
    const a = frameIdx(t0), b = Math.max(frameIdx(t1), a + 1);
    const segRms: number[] = [];
    for (let k = a; k < b; k++) segRms.push(rms[k]);
    if (!segRms.length) continue;
    const segF0: number[] = [];
    for (let k = a; k < b; k++) if (inBand(f0[k])) segF0.push(f0[k]);
    syllables.push({
      i: syllables.length,
      t: Math.round(t0 * 1000) / 1000,
      dur: Math.round((t1 - t0) * 1000) / 1000,
      centroidHz: r1(median(Array.from(centroid.slice(a, b)))),
      spreadHz: r1(median(Array.from(spread.slice(a, b)))),
      flatness: Math.round((median(Array.from(flatness.slice(a, b))) ?? 0) * 10000000) / 10000000,
      rms: Math.round(Math.max(...segRms) * 10000) / 10000,
      f0Hz: segF0.length ? (median(segF0) == null ? null : Math.round((median(segF0) as number) * 10) / 10) : null,
    });
  }
  if (syllables.length === 0) throw new Error('未检测到可视化的声音事件（onset 为 0）');

  const col = (k: RangeKey): number[] =>
    syllables.map((sy) => (k === 'durSec' ? sy.dur : (sy[k as keyof SyllableData] as number | null)))
      .filter((v): v is number => v != null);
  const ranges: Record<RangeKey, FeatureRange> = {
    centroidHz: percentiles(col('centroidHz')),
    spreadHz: percentiles(col('spreadHz')),
    flatness: percentiles(col('flatness')),
    rms: percentiles(col('rms')),
    f0Hz: percentiles(col('f0Hz')),
    durSec: percentiles(col('durSec')),
  };

  onProgress?.(1);
  return {
    meta: {
      version: 1,
      audioFile: fileName,
      sampleRate: sr,
      duration: Math.round(dur * 100) / 100,
      nSyllables: syllables.length,
      analysis: { nFft: N_FFT, hop: HOP, onset: `essentia-v4-${params.profile}-spectral-flux+backtrack` },
      ranges,
    },
    syllables,
  };
}

/** 上传文件分析：decode → essentia v4。签名与原 analyzer.analyzeAudio 一致（调用方零感知）。 */
export async function analyzeAudio(
  arrayBuffer: ArrayBuffer,
  ctx: AudioContext,
  fileName: string,
  onProgress?: (p: number) => void,
  profile: AudioProfileKey = 'bird',
): Promise<{ data: SyllablesJson; audioBuffer: AudioBuffer }> {
  // decodeAudioData 会 detach 入参，传副本
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const data = await runCore(audioBuffer.getChannelData(0), audioBuffer.sampleRate, fileName, onProgress, profile);
  return { data, audioBuffer };
}

/** 录后重析：对已解码的完整录音 AudioBuffer 跑 essentia v4，得高精度数据用于回放。 */
export async function analyzeBuffer(
  audioBuffer: AudioBuffer,
  fileName: string,
  onProgress?: (p: number) => void,
  profile: AudioProfileKey = 'bird',
): Promise<SyllablesJson> {
  return runCore(audioBuffer.getChannelData(0), audioBuffer.sampleRate, fileName, onProgress, profile);
}
