import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const {
  RHYTHM_BAND_COUNT,
  analyzeRhythmPcm,
  sampleRhythmBands,
} = await import('../src/rhythmBands.ts');

const rhythmBandsSource = readFileSync(new URL('../src/rhythmBands.ts', import.meta.url), 'utf8');

function sine(freq, sampleRate = 44100, seconds = 1, amp = 0.8) {
  const pcm = new Float32Array(Math.round(sampleRate * seconds));
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = Math.sin((i / sampleRate) * freq * Math.PI * 2) * amp;
  }
  return pcm;
}

test('extracts bounded eight-band rhythm frames from uploaded audio PCM', () => {
  const analysis = analyzeRhythmPcm(sine(220), 44100, 1);
  assert.equal(RHYTHM_BAND_COUNT, 8);
  assert.ok(analysis.frames.length > 20);
  assert.equal(analysis.frames[0].bands.length, RHYTHM_BAND_COUNT);
  for (const frame of analysis.frames) {
    assert.ok(frame.t >= 0);
    assert.ok(frame.energy >= 0 && frame.energy <= 1);
    for (const band of frame.bands) {
      assert.ok(band >= 0 && band <= 1, `band out of range: ${band}`);
    }
  }
});

test('low and high pitched audio emphasize different terrain bands', () => {
  const low = analyzeRhythmPcm(sine(110), 44100, 1);
  const high = analyzeRhythmPcm(sine(4200), 44100, 1);
  const lowBands = sampleRhythmBands(low, 0.5);
  const highBands = sampleRhythmBands(high, 0.5);
  const lowSide = lowBands[0] + lowBands[1] + lowBands[2];
  const lowHighSide = lowBands[5] + lowBands[6] + lowBands[7];
  const highSide = highBands[5] + highBands[6] + highBands[7];
  const highLowSide = highBands[0] + highBands[1] + highBands[2];

  assert.ok(lowSide > lowHighSide, `expected low tone to lift lower bands: ${lowBands}`);
  assert.ok(highSide > highLowSide, `expected high tone to lift upper bands: ${highBands}`);
});

test('samples rhythm bands with interpolation and duration clamping', () => {
  const analysis = analyzeRhythmPcm(sine(440), 44100, 1);
  const before = sampleRhythmBands(analysis, -2);
  const middle = sampleRhythmBands(analysis, 0.5);
  const after = sampleRhythmBands(analysis, 99);

  assert.deepEqual(before, analysis.frames[0].bands);
  assert.deepEqual(after, analysis.frames.at(-1).bands);
  assert.equal(middle.length, RHYTHM_BAND_COUNT);
  assert.ok(middle.some((v, i) => Math.abs(v - before[i]) > 1e-6));
});

test('uses sonic-topography style 1024 FFT bin ranges for terrain bands', () => {
  assert.match(rhythmBandsSource, /const FFT_SIZE = 1024/);
  assert.match(rhythmBandsSource, /const RHYTHM_BIN_RANGES = \[/);
  assert.match(rhythmBandsSource, /\[0, 1\]/);
  assert.match(rhythmBandsSource, /\[2, 3\]/);
  assert.match(rhythmBandsSource, /\[4, 7\]/);
  assert.match(rhythmBandsSource, /\[8, 18\]/);
  assert.match(rhythmBandsSource, /\[19, 46\]/);
  assert.match(rhythmBandsSource, /\[47, 93\]/);
  assert.match(rhythmBandsSource, /\[94, 186\]/);
  assert.match(rhythmBandsSource, /\[187, 372\]/);
});
