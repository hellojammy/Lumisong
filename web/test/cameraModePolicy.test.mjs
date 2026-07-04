import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldUseFinaleCruise } from '../src/cameraModePolicy.ts';

test('free camera mode keeps manual control after finale', () => {
  assert.equal(shouldUseFinaleCruise('free'), false);
  assert.equal(shouldUseFinaleCruise('pilot'), false);
});

test('automatic camera modes keep finale cruise behavior', () => {
  for (const mode of ['director', 'director2', 'ship', 'orbit', 'breath']) {
    assert.equal(shouldUseFinaleCruise(mode), true);
  }
});
