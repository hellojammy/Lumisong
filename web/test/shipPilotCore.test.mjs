import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPilotState,
  updatePilotState,
} from '../src/shipPilotCore.ts';

test('pilot input changes heading and accelerates smoothly', () => {
  let state = createPilotState({ x: 0, y: 0, z: 0 }, { horizRadius: 6, vertRadius: 3 });
  state = updatePilotState(state, { throttle: 1, yaw: 1, pitch: 0.4, roll: 0 }, 0.5);
  assert.ok(state.speed > 0.45);
  assert.ok(state.forward.x > 0.05);
  assert.ok(state.forward.y > 0.01);
});

test('pilot state remains bounded around the nebula', () => {
  let state = createPilotState({ x: 0, y: 0, z: 0 }, { horizRadius: 5, vertRadius: 2 });
  for (let i = 0; i < 200; i++) {
    state = updatePilotState(state, { throttle: 1, yaw: 0.3, pitch: 0.2, roll: 0 }, 0.1);
  }
  const dist = Math.hypot(state.position.x, state.position.y, state.position.z);
  assert.ok(dist <= 5 * 2.4 + 2);
});
