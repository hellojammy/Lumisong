import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisParamsForProfile, percentiles, median, pickPeaks, backtrack } from '../src/analyzerEssentia.ts';

test('percentiles: 等距 1..100 的分位点', () => {
  const r = percentiles(Array.from({ length: 100 }, (_, i) => i + 1));
  assert.deepEqual(r, { p01: 1, p50: 50, p99: 99, min: 1, max: 100 });
});

test('percentiles: 极小值保留 7 位精度、不被截断为 0（PoC §5.1）', () => {
  const r = percentiles([1e-6, 2e-6, 3e-6]);
  assert.notEqual(r.p01, 0);
  assert.equal(r.p01, 1e-6);
  assert.equal(r.max, 3e-6);
});

test('percentiles: 过滤 NaN / 空数组', () => {
  assert.deepEqual(percentiles([]), { p01: 0, p50: 0, p99: 0, min: 0, max: 0 });
  assert.equal(percentiles([NaN, 5, NaN]).min, 5);
});

test('median: 奇偶 / 空 / NaN', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([NaN, 1, 3]), 2);
});

test('pickPeaks: 双峰、满足 wait 与 delta 约束', () => {
  const nv = [0, 0, 0, 5, 0, 0, 0, 0, 5, 0, 0, 0];
  assert.deepEqual(pickPeaks(nv), [3, 8]);
});

test('pickPeaks: 间隔小于 wait 的相邻峰被抑制', () => {
  // 两个相邻高点 idx3/idx4，wait=2 下只取第一个
  const nv = [0, 0, 0, 5, 5, 0, 0, 0];
  const peaks = pickPeaks(nv, { wait: 2 });
  assert.ok(!(peaks.includes(3) && peaks.includes(4)));
});

test('backtrack: 回溯到能量谷底', () => {
  assert.deepEqual(backtrack([3], [0, 1, 2, 3, 1]), [0]);
  assert.deepEqual(backtrack([2], [5, 3, 4]), [1]);
});

test('analysisParamsForProfile: bird keeps the existing high-frequency analysis behavior', () => {
  const bird = analysisParamsForProfile('bird', 48000);
  assert.equal(bird.fmin, 1500);
  assert.equal(bird.fmax, 10000);
  assert.equal(bird.onsetDelta, 0.07);
  assert.equal(bird.onsetWait, 2);
});

test('analysisParamsForProfile: music and voice lower f0 range for general audio', () => {
  const music = analysisParamsForProfile('music', 48000);
  const voice = analysisParamsForProfile('voice', 48000);
  assert.ok(music.fmin < 1500);
  assert.ok(voice.fmin < 1500);
  assert.ok(music.onsetWait >= 2);
  assert.ok(voice.onsetWait > music.onsetWait);
});
