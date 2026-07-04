import test from 'node:test';
import assert from 'node:assert/strict';
import {
  focusBiasedShipPose,
  shouldTriggerFlyby,
} from '../src/shipCruiseFxCore.ts';

test('focus attraction nudges the ship toward the playing area without hard locking', () => {
  const base = {
    position: { x: 8, y: 0.8, z: 0 },
    forward: { x: -1, y: 0, z: 0 },
    speed: 1,
  };
  const focus = { x: 1.5, y: 0.2, z: 0.3 };
  const result = focusBiasedShipPose(base, focus, { horizRadius: 8, vertRadius: 3 }, 12.5);

  const before = Math.hypot(base.position.x - focus.x, base.position.y - focus.y, base.position.z - focus.z);
  const after = Math.hypot(result.position.x - focus.x, result.position.y - focus.y, result.position.z - focus.z);
  assert.ok(after < before * 0.96);
  assert.ok(after > before * 0.82);
  assert.ok(result.influence > 0.04 && result.influence < 0.2);
});

test('focus attraction is gentler when the route is far from the playing area', () => {
  const far = focusBiasedShipPose({
    position: { x: 12, y: 0.8, z: 0 },
    forward: { x: -1, y: 0, z: 0 },
    speed: 1,
  }, { x: -2, y: 0.2, z: 0.3 }, { horizRadius: 8, vertRadius: 3 }, 12.5);
  const near = focusBiasedShipPose({
    position: { x: 2.3, y: 0.4, z: 0.2 },
    forward: { x: -1, y: 0, z: 0 },
    speed: 1,
  }, { x: 1.5, y: 0.2, z: 0.3 }, { horizRadius: 8, vertRadius: 3 }, 12.5);

  assert.ok(far.influence < near.influence);
  assert.ok(far.influence < 0.12);
});

test('focus attraction leaves cruise pose unchanged without active playback focus', () => {
  const base = {
    position: { x: 3, y: 1, z: -2 },
    forward: { x: 0, y: 0, z: 1 },
    speed: 0.8,
  };
  const result = focusBiasedShipPose(base, null, { horizRadius: 6, vertRadius: 2 }, 5);
  assert.deepEqual(result.position, base.position);
  assert.deepEqual(result.forward, base.forward);
  assert.equal(result.influence, 0);
});

test('flyby trigger fires only when the flight segment crosses the playing note and respects cooldown', () => {
  const prev = { x: -1.2, y: 0, z: 0 };
  const next = { x: 1.2, y: 0, z: 0 };
  const focus = { x: 0.05, y: 0.02, z: 0 };
  assert.equal(shouldTriggerFlyby(prev, next, focus, 0.18, 0, -10, 1), true);
  assert.equal(shouldTriggerFlyby(prev, next, focus, 0.18, 0.3, 0, 1), false);
  assert.equal(shouldTriggerFlyby(prev, next, { x: 0, y: 1, z: 0 }, 0.18, 2, 0, 1), false);
});
