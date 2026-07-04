// 实时录音滑窗分析（022 / proposal 022-realtime-recording）
// 持续接收录音 PCM（绝对时间连续），用 5s 滑窗跑 analyzer 共享纯函数，
// 输出去重后的增量音节 + 累计 ranges。已渲染音节绝不重算。
// 与上传一致使用 Meyda + pitchy（analyzer.ts 共享函数），后续如需可切 PoC essentia。
import {
  extractFrames,
  detectOnsets,
  aggregateSyllables,
  percentiles,
} from './analyzer';
import type { SyllableData, FeatureRange, RangeKey } from './data';

const WINDOW_SEC = 5; // 滑窗时长
const ONSET_DEDUP_MS = 50; // 跨窗去重：onset 绝对时间 ±50ms 视为同一音节
const PROBE_COUNT = 30; // 探测期阈值：<30 音节用默认 ranges，≥30 用累计 percentiles

// 探测期默认 ranges：保守经验范围，避免样本太少时 p01≈p99 导致 span=0 退化
const DEFAULT_RANGES: Record<RangeKey, FeatureRange> = {
  centroidHz: { p01: 1500, p50: 4000, p99: 9000, min: 1500, max: 10000 },
  spreadHz: { p01: 200, p50: 1200, p99: 3000, min: 0, max: 5000 },
  flatness: { p01: 0.02, p50: 0.15, p99: 0.6, min: 0, max: 1 },
  rms: { p01: 0.01, p50: 0.08, p99: 0.4, min: 0, max: 1 },
  f0Hz: { p01: 1800, p50: 4000, p99: 8500, min: 1500, max: 10000 },
  durSec: { p01: 0.04, p50: 0.15, p99: 0.5, min: 0, max: 2 },
};

export interface StreamResult {
  /** 本次新确认的音节（已延续全局编号 i），可能为空 */
  newSyllables: SyllableData[];
  /** 当前累计 ranges（探测期为默认值，积累期为累计 percentiles） */
  ranges: Record<RangeKey, FeatureRange>;
}

/**
 * 流式滑窗分析器。每次 push 一段新到达的 PCM，内部维护一个 5s 滑窗缓冲。
 * - 末段不闭合（lastSegmentToEnd=false）：滑窗末尾的音节可能被切断，留待下一窗。
 * - 跨窗去重：用已确认音节的 onset 绝对时间 ±50ms 过滤重复。
 * - 已确认音节只追加、不重算。
 */
export class StreamAnalyzer {
  private sr: number;
  private windowSamples: number;
  private buf: Float32Array; // 当前滑窗 PCM
  private bufAbsStart = 0; // buf[0] 在整段录音中的绝对起始样本数
  private nextIndex = 0; // 下一个音节全局编号
  private confirmedTimes: number[] = []; // 已确认音节的绝对 onset 时间（秒），升序，用于去重
  // 累计特征列（用于积累期 ranges）
  private cols: Record<RangeKey, number[]> = {
    centroidHz: [], spreadHz: [], flatness: [], rms: [], f0Hz: [], durSec: [],
  };

  private totalPushed = 0; // 累计推入样本数（用于 elapsedSec）

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    this.windowSamples = Math.round(WINDOW_SEC * sampleRate);
    this.buf = new Float32Array(0);
  }

  get sampleRate(): number {
    return this.sr;
  }

  /** 已录入时长（秒） */
  get elapsedSec(): number {
    return this.totalPushed / this.sr;
  }

  /** 当前 ranges 快照（建场景初始用，探测期为默认值） */
  snapshotRanges(): Record<RangeKey, FeatureRange> {
    return this.currentRanges();
  }

  /** 追加一段新到达的 PCM，返回本次新确认的增量音节与当前 ranges。 */
  push(chunk: Float32Array): StreamResult {
    this.totalPushed += chunk.length;
    // 拼到滑窗缓冲尾部
    const merged = new Float32Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;

    return this.analyzeWindow();
  }

  /** 录音停止：闭合滑窗末段，吐出剩余音节。 */
  flush(): StreamResult {
    return this.analyzeWindow(true);
  }

  private analyzeWindow(final = false): StreamResult {
    const tOffset = this.bufAbsStart / this.sr;
    const frames = extractFrames(this.buf, this.sr, tOffset);
    if (frames.length === 0) return { newSyllables: [], ranges: this.currentRanges() };

    const onsets = detectOnsets(frames, this.sr);
    // 非 final：末段不闭合，留给下个窗口
    const raw = aggregateSyllables(frames, onsets, this.sr, 0, final);

    // 去重：按绝对 onset 时间过滤已确认过的音节
    const fresh = raw.filter((s) => !this.isDuplicate(s.t));

    // 延续全局编号，并累计特征列
    const newSyllables: SyllableData[] = fresh.map((s) => {
      const out: SyllableData = { ...s, i: this.nextIndex++ };
      this.confirmedTimes.push(out.t);
      this.accumulate(out);
      return out;
    });
    this.confirmedTimes.sort((a, b) => a - b);

    // 滑窗：保留尾部 windowSamples 长度，前面已分析的丢弃
    if (!final && this.buf.length > this.windowSamples) {
      const drop = this.buf.length - this.windowSamples;
      this.buf = this.buf.slice(drop);
      this.bufAbsStart += drop;
    }
    if (final) {
      this.buf = new Float32Array(0);
    }

    return { newSyllables, ranges: this.currentRanges() };
  }

  /** onset 绝对时间 ±ONSET_DEDUP_MS 内已存在则视为重复 */
  private isDuplicate(t: number): boolean {
    const tol = ONSET_DEDUP_MS / 1000;
    for (const ct of this.confirmedTimes) {
      if (Math.abs(ct - t) <= tol) return true;
      if (ct - t > tol) break; // 升序，超出容差可提前退出
    }
    return false;
  }

  private accumulate(s: SyllableData): void {
    this.cols.centroidHz.push(s.centroidHz);
    this.cols.spreadHz.push(s.spreadHz);
    this.cols.flatness.push(s.flatness);
    this.cols.rms.push(s.rms);
    if (s.f0Hz != null) this.cols.f0Hz.push(s.f0Hz);
    this.cols.durSec.push(s.dur);
  }

  /** 两阶段归一化：<PROBE_COUNT 用默认 ranges，否则用累计 percentiles */
  private currentRanges(): Record<RangeKey, FeatureRange> {
    if (this.nextIndex < PROBE_COUNT) return DEFAULT_RANGES;
    return {
      centroidHz: percentiles(this.cols.centroidHz),
      spreadHz: percentiles(this.cols.spreadHz),
      flatness: percentiles(this.cols.flatness),
      rms: percentiles(this.cols.rms),
      f0Hz: percentiles(this.cols.f0Hz),
      durSec: percentiles(this.cols.durSec),
    };
  }

  get count(): number {
    return this.nextIndex;
  }
}
