import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const playback = fs.readFileSync(new URL('../src/playback.ts', import.meta.url), 'utf8');

test('dock exposes a seekable playback progress scrubber', () => {
  assert.match(html, /id="progressBar"/);
  assert.match(main, /seekTo\(/);
  assert.match(main, /playback\.seek\(/);
  assert.match(playback, /wasPlaying && !this\._finished/);
});
