export type AudioProfileKey = 'bird' | 'music' | 'voice' | 'generic';

export interface AudioProfileConfig {
  key: AudioProfileKey;
  label: string;
  description: string;
  fmin: number;
  fmaxCap: number;
  onsetDelta: number;
  onsetWait: number;
}

export interface AudioProfileSummary {
  duration: number;
  zeroCrossingRate: number;
  transientRate: number;
  dynamicRange: number;
  lowEnergyRatio: number;
  midEnergyRatio: number;
  highEnergyRatio: number;
  voicedStability: number;
}

export interface AudioProfileGuess {
  profile: AudioProfileKey;
  confidence: number;
  summary: AudioProfileSummary;
}

export const AUDIO_PROFILES: Record<AudioProfileKey, AudioProfileConfig> = {
  bird: {
    key: 'bird',
    label: '鸟鸣',
    description: '高频、短促、密集的鸣叫或类似声音事件',
    fmin: 1500,
    fmaxCap: 10000,
    onsetDelta: 0.07,
    onsetWait: 2,
  },
  music: {
    key: 'music',
    label: '音乐',
    description: '歌曲、器乐、节拍和低频层次较明显的音频',
    fmin: 55,
    fmaxCap: 5000,
    onsetDelta: 0.08,
    onsetWait: 3,
  },
  voice: {
    key: 'voice',
    label: '人声',
    description: '讲话、旁白、单人声或人声占主导的音频',
    fmin: 70,
    fmaxCap: 1200,
    onsetDelta: 0.1,
    onsetWait: 5,
  },
  generic: {
    key: 'generic',
    label: '通用',
    description: '环境声、混合素材或无法可靠识别的音频',
    fmin: 80,
    fmaxCap: 8000,
    onsetDelta: 0.08,
    onsetWait: 3,
  },
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export function profileLabel(profile: AudioProfileKey): string {
  return AUDIO_PROFILES[profile].label;
}

function confidenceFromScore(score: number): number {
  return Math.round(clamp01(score) * 100) / 100;
}

export function classifyAudioSummary(summary: AudioProfileSummary): AudioProfileGuess {
  const high = summary.highEnergyRatio;
  const mid = summary.midEnergyRatio;
  const low = summary.lowEnergyRatio;
  const transient = summary.transientRate;
  const zcr = summary.zeroCrossingRate;
  const stable = summary.voicedStability;

  const birdScore = clamp01((high - 0.42) * 1.5)
    + clamp01((transient - 3.5) / 4)
    + clamp01((zcr - 0.1) * 4)
    + clamp01((summary.dynamicRange - 0.35) * 1.2);
  const voiceScore = clamp01((mid - 0.48) * 1.8)
    + clamp01((stable - 0.55) * 2)
    + clamp01((1.9 - transient) / 1.9)
    + clamp01((0.13 - zcr) * 4);
  const musicScore = clamp01((low - 0.18) * 1.4)
    + clamp01((mid - 0.3) * 1.2)
    + clamp01((transient - 1.4) / 2.8)
    + clamp01((summary.dynamicRange - 0.22) * 1.4);

  const ranked = ([
    ['bird', birdScore],
    ['voice', voiceScore],
    ['music', musicScore],
    ['generic', 0.75],
  ] as [AudioProfileKey, number][]).sort((a, b) => b[1] - a[1]);

  const [profile, score] = ranked[0];
  return { profile, confidence: confidenceFromScore(score / 3), summary };
}

export function chooseAudioProfile(guess: AudioProfileGuess, override?: AudioProfileKey | null): AudioProfileKey {
  return override ?? guess.profile;
}

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))];
}

export function summarizePcm(pcm: Float32Array, sr: number, maxSeconds = 20): AudioProfileSummary {
  const usable = pcm.subarray(0, Math.min(pcm.length, Math.max(1, Math.floor(sr * maxSeconds))));
  const frame = 2048;
  const hop = 1024;
  const nFrames = Math.max(0, Math.floor((usable.length - frame) / hop) + 1);
  if (nFrames === 0) {
    return {
      duration: usable.length / Math.max(sr, 1),
      zeroCrossingRate: 0,
      transientRate: 0,
      dynamicRange: 0,
      lowEnergyRatio: 0.33,
      midEnergyRatio: 0.34,
      highEnergyRatio: 0.33,
      voicedStability: 0,
    };
  }

  const rms: number[] = [];
  const zcrs: number[] = [];
  let low = 0;
  let mid = 0;
  let high = 0;

  for (let f = 0; f < nFrames; f++) {
    const start = f * hop;
    let sumSq = 0;
    let zc = 0;
    let prev = usable[start];
    let slow = 0;
    let midDiff = 0;
    let hiDiff = 0;
    for (let i = 0; i < frame; i++) {
      const v = usable[start + i] ?? 0;
      sumSq += v * v;
      if ((v >= 0) !== (prev >= 0)) zc++;
      slow += Math.abs(v);
      if (i >= 8) midDiff += Math.abs(v - (usable[start + i - 8] ?? 0));
      if (i >= 1) hiDiff += Math.abs(v - prev);
      prev = v;
    }
    rms.push(Math.sqrt(sumSq / frame));
    zcrs.push(zc / frame);
    low += slow / frame;
    mid += midDiff / frame;
    high += hiDiff / frame;
  }

  const total = low + mid + high || 1;
  const sortedRms = [...rms].sort((a, b) => a - b);
  const p10 = quantile(sortedRms, 0.1);
  const p90 = quantile(sortedRms, 0.9);
  const meanRms = rms.reduce((a, b) => a + b, 0) / rms.length;
  let transients = 0;
  for (let i = 1; i < rms.length; i++) {
    if (rms[i] > rms[i - 1] * 1.35 && rms[i] > meanRms * 1.15) transients++;
  }
  const meanZcr = zcrs.reduce((a, b) => a + b, 0) / zcrs.length;
  const zcrStd = Math.sqrt(zcrs.reduce((a, b) => a + (b - meanZcr) ** 2, 0) / zcrs.length);

  return {
    duration: usable.length / sr,
    zeroCrossingRate: meanZcr,
    transientRate: transients / Math.max(usable.length / sr, 0.001),
    dynamicRange: p90 > 0 ? clamp01((p90 - p10) / p90) : 0,
    lowEnergyRatio: low / total,
    midEnergyRatio: mid / total,
    highEnergyRatio: high / total,
    voicedStability: clamp01(1 - zcrStd * 18),
  };
}

export function classifyAudioBuffer(audioBuffer: AudioBuffer): AudioProfileGuess {
  return classifyAudioSummary(summarizePcm(audioBuffer.getChannelData(0), audioBuffer.sampleRate));
}
