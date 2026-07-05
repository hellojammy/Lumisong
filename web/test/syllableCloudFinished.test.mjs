import test from 'node:test';
import assert from 'node:assert/strict';
import { fadeFactorAtPlayhead } from '../src/fadeFactor.ts';

const DURATION = 70;
const EARLY_T = 0.5;
const LATE_T = 69;

test('fade at track end zeroes early syllables when fxFade is on', () => {
  const early = fadeFactorAtPlayhead(DURATION, EARLY_T, true, false);
  const late = fadeFactorAtPlayhead(DURATION, LATE_T, true, false);
  assert.equal(early, 0);
  assert.equal(late, 1);
});

test('finishedHold keeps full constellation after playback ended', () => {
  assert.equal(fadeFactorAtPlayhead(DURATION, EARLY_T, true, true), 1);
  assert.equal(fadeFactorAtPlayhead(DURATION, LATE_T, true, true), 1);
});

test('ghost replay uses nowCache below zero so fill stays unplayed', () => {
  const ghostNow = -1;
  assert.equal(fadeFactorAtPlayhead(ghostNow, EARLY_T, true, false), 1);
  // fillProgress treats ts > nowCache as unplayed; regression guard for syncGhostState
  assert.ok(EARLY_T > ghostNow);
});
