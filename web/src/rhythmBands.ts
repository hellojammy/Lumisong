export const RHYTHM_BAND_COUNT = 8;

export interface RhythmFrame {
  t: number;
  bands: number[];
  energy: number;
  flux: number;
}

export interface RhythmAnalysis {
  duration: number;
  frameRate: number;
  frames: RhythmFrame[];
}

const FFT_SIZE = 1024;
const FFT_BINS = FFT_SIZE / 2;
const RHYTHM_BIN_RANGES = [
  [0, 1],
  [2, 3],
  [4, 7],
  [8, 18],
  [19, 46],
  [47, 93],
  [94, 186],
  [187, 372],
];

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function hann(n: number, size: number): number {
  return size <= 1 ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * 2 * n) / (size - 1));
}

function frameStats(pcm: Float32Array, start: number, size: number, previousAbs: Float32Array | null): {
  energy: number;
  flux: number;
  nextAbs: Float32Array;
} {
  let sumSq = 0;
  let flux = 0;
  const nextAbs = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const sample = pcm[start + i] ?? 0;
    const abs = Math.abs(sample);
    nextAbs[i] = abs;
    sumSq += sample * sample;
    if (previousAbs) flux += Math.max(0, abs - previousAbs[i]);
  }
  return {
    energy: clamp01(Math.sqrt(sumSq / size) * 2.4),
    flux: clamp01((flux / size) * 12),
    nextAbs,
  };
}

function fft(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = real[i]; real[i] = real[j]; real[j] = tr;
      const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wLenR = Math.cos(angle);
    const wLenI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = real[i + j];
        const uI = imag[i + j];
        const vR = real[i + j + len / 2] * wr - imag[i + j + len / 2] * wi;
        const vI = real[i + j + len / 2] * wi + imag[i + j + len / 2] * wr;
        real[i + j] = uR + vR;
        imag[i + j] = uI + vI;
        real[i + j + len / 2] = uR - vR;
        imag[i + j + len / 2] = uI - vI;
        const nextWr = wr * wLenR - wi * wLenI;
        wi = wr * wLenI + wi * wLenR;
        wr = nextWr;
      }
    }
  }
}

function fftBands(pcm: Float32Array, start: number, sampleRate: number): { bands: number[]; energy: number } {
  const real = new Float32Array(FFT_SIZE);
  const imag = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    real[i] = (pcm[start + i] ?? 0) * hann(i, FFT_SIZE);
  }
  fft(real, imag);

  const mags = new Float32Array(FFT_BINS);
  let maxMag = 1e-9;
  let energySum = 0;
  for (let i = 0; i < FFT_BINS; i++) {
    const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    mags[i] = mag;
    maxMag = Math.max(maxMag, mag);
    energySum += mag / FFT_BINS;
  }

  const nyquistBin = Math.min(FFT_BINS - 1, Math.floor((sampleRate * 0.48 / sampleRate) * FFT_SIZE));
  const bands = RHYTHM_BIN_RANGES.map(([startBin, endBin]) => {
    const lo = Math.min(startBin, nyquistBin);
    const hi = Math.min(endBin, nyquistBin);
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += mags[i] / maxMag;
    return clamp01(Math.pow(sum / Math.max(1, hi - lo + 1), 0.56));
  });
  return {
    bands,
    energy: clamp01(Math.pow(energySum / maxMag, 0.5) * 2.6),
  };
}

export function analyzeRhythmPcm(
  pcm: Float32Array,
  sampleRate: number,
  duration = pcm.length / sampleRate,
  frameRate = 30,
): RhythmAnalysis {
  const frameSize = FFT_SIZE;
  const hop = Math.max(1, Math.round(sampleRate / frameRate));
  const frameCount = Math.max(1, Math.floor(Math.max(0, pcm.length - frameSize) / hop) + 1);
  const frames: RhythmFrame[] = [];
  let previousAbs: Float32Array | null = null;

  for (let frame = 0; frame < frameCount; frame++) {
    const start = Math.min(frame * hop, Math.max(0, pcm.length - frameSize));
    const spectral = fftBands(pcm, start, sampleRate);
    const stats = frameStats(pcm, start, frameSize, previousAbs);
    previousAbs = stats.nextAbs;

    const bands = spectral.bands.map((v, index) => {
      const transientLift = stats.flux * (index >= 3 ? 0.18 : 0.08);
      return clamp01(v * (0.25 + stats.energy * 0.75) + transientLift);
    });

    frames.push({
      t: start / sampleRate,
      bands,
      energy: clamp01((stats.energy + spectral.energy) * 0.5),
      flux: stats.flux,
    });
  }

  return { duration, frameRate, frames };
}

export function analyzeRhythmBuffer(buffer: AudioBuffer): RhythmAnalysis {
  const mixed = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < mixed.length; i++) mixed[i] += data[i] / buffer.numberOfChannels;
  }
  return analyzeRhythmPcm(mixed, buffer.sampleRate, buffer.duration);
}

/** 取最近帧的谱通量（瞬态强度），供涟漪打点 */
export function sampleRhythmFlux(analysis: RhythmAnalysis, time: number): number {
  const frames = analysis.frames;
  if (!frames.length) return 0;
  if (time <= frames[0].t) return frames[0].flux;
  const last = frames[frames.length - 1];
  if (time >= last.t) return last.flux;
  const approx = Math.max(0, Math.min(frames.length - 1, Math.round(time * analysis.frameRate)));
  let i = approx;
  while (i > 0 && frames[i].t > time) i--;
  while (i < frames.length - 1 && frames[i + 1].t <= time) i++;
  return frames[i].flux;
}

export function sampleRhythmBands(analysis: RhythmAnalysis, time: number): number[] {
  if (!analysis.frames.length) return new Array(RHYTHM_BAND_COUNT).fill(0);
  if (time <= analysis.frames[0].t) return analysis.frames[0].bands.slice();
  const last = analysis.frames[analysis.frames.length - 1];
  if (time >= last.t) return last.bands.slice();

  const approx = Math.max(0, Math.min(analysis.frames.length - 2, Math.floor(time * analysis.frameRate)));
  let i = approx;
  while (i > 0 && analysis.frames[i].t > time) i--;
  while (i < analysis.frames.length - 2 && analysis.frames[i + 1].t < time) i++;
  const a = analysis.frames[i];
  const b = analysis.frames[i + 1];
  const span = Math.max(1e-6, b.t - a.t);
  const k = clamp01((time - a.t) / span);
  return a.bands.map((v, band) => v + (b.bands[band] - v) * k);
}
