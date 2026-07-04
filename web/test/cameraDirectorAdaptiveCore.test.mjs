import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompactSegments,
  classifyAdaptiveProfile,
  assignCompactShots,
} from '../src/cameraDirectorAdaptiveCore.ts';

const makeData = ({ duration, count, voiced = true, wide = false }) => {
  const syllables = Array.from({ length: count }, (_, i) => {
    const u = count <= 1 ? 0 : i / (count - 1);
    return {
      i,
      t: u * duration,
      dur: 0.12,
      centroidHz: wide ? 600 + 6400 * ((i * 37) % count) / count : 2600 + 180 * Math.sin(i * 0.13),
      spreadHz: wide ? 500 + 5200 * ((i * 19) % count) / count : 900 + 90 * Math.cos(i * 0.17),
      flatness: wide ? ((i * 23) % count) / count : 0.22 + 0.04 * Math.sin(i * 0.11),
      rms: 0.25 + 0.55 * Math.abs(Math.sin(i * 0.31)),
      f0Hz: voiced ? 130 + 22 * Math.sin(i * 0.09) : null,
      pos: wide
        ? [(u - 0.5) * 8, Math.sin(i * 0.47) * 2.6, Math.cos(i * 0.41) * 2.5]
        : [(u - 0.5) * 8, Math.sin(i * 0.21) * 0.42, Math.cos(i * 0.19) * 0.38],
    };
  });
  return {
    meta: {
      version: 1,
      audioFile: 'test.wav',
      sampleRate: 48000,
      duration,
      nSyllables: count,
      analysis: { nFft: 2048, hop: 512, onset: 'test' },
      ranges: {
        centroidHz: { p01: wide ? 600 : 2400, p50: 2600, p99: wide ? 7000 : 2800, min: 500, max: 7200 },
        spreadHz: { p01: wide ? 500 : 760, p50: 900, p99: wide ? 5700 : 1040, min: 400, max: 5900 },
        flatness: { p01: wide ? 0.02 : 0.18, p50: 0.23, p99: wide ? 0.98 : 0.28, min: 0, max: 1 },
        rms: { p01: 0.2, p50: 0.45, p99: 0.82, min: 0.1, max: 0.9 },
        f0Hz: { p01: 90, p50: 130, p99: 180, min: 80, max: 200 },
        durSec: { p01: 0.08, p50: 0.12, p99: 0.22, min: 0.04, max: 0.3 },
      },
    },
    syllables,
  };
};

test('classifies long concentrated voiced speech as compact', () => {
  const data = makeData({ duration: 1000, count: 2800 });
  const profile = classifyAdaptiveProfile(data);
  assert.equal(profile.kind, 'compact');
  assert.ok(profile.score >= 0.65);
});

test('keeps short wide recordings on the spatial director path', () => {
  const data = makeData({ duration: 72, count: 280, voiced: false, wide: true });
  const profile = classifyAdaptiveProfile(data);
  assert.equal(profile.kind, 'spatial');
  assert.ok(profile.score < 0.65);
});

test('assigns varied compact shots even when phrase centers barely move', () => {
  const data = makeData({ duration: 180, count: 900 });
  const segments = buildCompactSegments(data);
  const shots = assignCompactShots(segments);
  const firstAngles = shots.slice(0, 8).map((shot) => Number(shot.shoulder.toFixed(2)));
  assert.ok(new Set(firstAngles).size >= 4);
  assert.ok(shots.some((shot) => shot.shoulder < 0));
  assert.ok(shots.some((shot) => shot.shoulder > 0));
});

test('compact shot grammar keeps candidate cameras off the future side of the timeline', () => {
  const data = makeData({ duration: 240, count: 960 });
  const segments = buildCompactSegments(data);
  const shots = assignCompactShots(segments);
  for (const shot of shots.slice(0, 10)) {
    const futureSide = Math.cos(Math.PI * 0.5 + shot.shoulder);
    assert.ok(futureSide <= 0.12);
  }
});

test('compact shot grammar inserts sparse overview shots for long speech', () => {
  const data = makeData({ duration: 420, count: 1680 });
  const segments = buildCompactSegments(data);
  const shots = assignCompactShots(segments);
  const overviewCount = shots.filter((shot) => shot.scope === 'overview').length;
  assert.ok(overviewCount >= 2);
  assert.ok(overviewCount < shots.length / 3);
});
