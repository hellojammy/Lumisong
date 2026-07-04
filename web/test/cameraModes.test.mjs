import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_MODES,
  CAMERA_MODES_MORE,
  CAMERA_MODES_PRIMARY,
  cameraModeLabel,
  normalizeCameraMode,
  isCameraModeInMore,
} from '../src/camera.ts';

test('removed camera modes migrate to director2', () => {
  assert.equal(normalizeCameraMode('reactive'), 'director2');
  assert.equal(normalizeCameraMode('cinematic'), 'director2');
  assert.equal(normalizeCameraMode('director'), 'director2');
});

test('camera menu labels expose smart camera and hide legacy director', () => {
  assert.deepEqual(
    CAMERA_MODES_PRIMARY.map((m) => m.key),
    ['director2', 'orbit', 'free', 'pilot'],
  );
  assert.equal(cameraModeLabel('director2'), '智能运镜');
  assert.deepEqual(
    CAMERA_MODES_MORE.map((m) => m.key),
    ['ship', 'breath'],
  );
  assert.equal(CAMERA_MODES.length, 6);
  assert.equal(CAMERA_MODES.some((m) => m.key === 'director'), false);
  assert.equal(isCameraModeInMore('ship'), true);
  assert.equal(isCameraModeInMore('director2'), false);
});
