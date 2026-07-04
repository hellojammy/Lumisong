import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  directorSmoothHints,
  lerpDirectorFocus,
  DIRECTOR_FOCUS_SMOOTH_K,
} from '../src/cameraDirectorRig.ts';

test('directorSmoothHints tiers by style and focus', () => {
  assert.deepEqual(directorSmoothHints('overview', false), { smoothPos: 0.28, smoothTarget: 0.38 });
  assert.deepEqual(directorSmoothHints('timeline', false), { smoothPos: 0.30, smoothTarget: 0.42 });
  assert.deepEqual(directorSmoothHints('overhead', false), { smoothPos: 0.30, smoothTarget: 0.42 });
  assert.deepEqual(directorSmoothHints('push', false), { smoothPos: 0.40, smoothTarget: 0.55 });
  assert.deepEqual(directorSmoothHints('overview', true), { smoothPos: 0.38, smoothTarget: 0.58 });
  assert.deepEqual(directorSmoothHints('push', true), { smoothPos: 0.40, smoothTarget: 0.58 });
});

test('lerpDirectorFocus snaps first sample then low-passes', () => {
  const out = new THREE.Vector3();
  const raw = new THREE.Vector3(10, 0, 0);
  const dt = 1 / 60;

  const first = lerpDirectorFocus(out, false, raw, dt);
  assert.equal(first.hasValue, true);
  assert.ok(first.value.distanceTo(raw) < 1e-6);

  const moved = new THREE.Vector3(20, 0, 0);
  const second = lerpDirectorFocus(out, true, moved, dt);
  assert.ok(second.value.x > 10 && second.value.x < 20);
  assert.equal(DIRECTOR_FOCUS_SMOOTH_K, 0.32);
});

test('lerpDirectorFocus clears when raw is null', () => {
  const out = new THREE.Vector3(1, 2, 3);
  const cleared = lerpDirectorFocus(out, true, null, 1 / 60);
  assert.equal(cleared.value, null);
  assert.equal(cleared.hasValue, false);
});
