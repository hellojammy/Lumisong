import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { playbackFillDuration } from '../src/visualTiming.ts';

const cloudSource = fs.readFileSync(new URL('../src/syllableCloud.ts', import.meta.url), 'utf8');

test('playback visual fill resolves close to the audio onset', () => {
  assert.equal(playbackFillDuration(0.04), 0.035);
  assert.equal(playbackFillDuration(0.4), 0.1);
  assert.equal(playbackFillDuration(3), 0.18);
});

test('SyllableCloud uses fast playback fill without changing recording fill semantics', () => {
  assert.match(cloudSource, /import \{ playbackFillDuration \} from '\.\/visualTiming';/);
  assert.match(cloudSource, /this\.fillDur\[i\] = playbackFillDuration\(gap\);/);
  assert.match(cloudSource, /REC_FILL_FACTOR = 0\.8/);
});
