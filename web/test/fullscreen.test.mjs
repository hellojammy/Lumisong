import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const style = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

test('page exposes immersive fullscreen control at bottom-left', () => {
  assert.match(html, /id="immersivePlayBtn"/);
  assert.match(main, /togglePlayback/);
  assert.match(main, /KeyK/);
  assert.match(main, /requestFullscreen\(\)/);
  assert.match(main, /is-immersive/);
  assert.match(style, /\.hud-fullscreen\s*\{/);
  assert.match(style, /body\.is-immersive \.hud-dock/);
});
