import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mainSource = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const playbackSource = fs.readFileSync(new URL('../src/playback.ts', import.meta.url), 'utf8');
const htmlSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styleSource = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

test('upload playback waits for AudioContext resume before showing pause state', () => {
  assert.match(playbackSource, /async play\(\): Promise<boolean>/);
  assert.match(playbackSource, /await this\.ctx\.resume\(\)/);
  assert.match(playbackSource, /if \(this\.ctx\.state !== 'running'\) return false/);
  assert.match(mainSource, /const started = await playback\?\.play\(\) \?\? false/);
  assert.match(mainSource, /setBtn\(started\)/);
});

test('uploaded audio is classified before formal analysis and user profile choice wins', () => {
  assert.match(htmlSource, /id="profileDialog"/);
  assert.match(styleSource, /#profileDialog/);
  assert.match(mainSource, /classifyAudioBuffer\(audioBuffer\)/);
  assert.match(mainSource, /await chooseProfile\(guess\)/);
  assert.match(mainSource, /analyzeBuffer\(\s*audioBuffer,\s*name,\s*\(p\) => showOverlay\(`分析中… \$\{Math\.round\(p \* 100\)\}%`\),\s*profile,\s*\)/s);
  assert.doesNotMatch(mainSource, /await analyzeAudio\(\s*bytes,\s*ctx,\s*name/s);
});

test('uploaded playback uses one frame clock for notes and camera', () => {
  assert.match(mainSource, /const t = playback\.now\(\);/);
  assert.match(mainSource, /if \(playback\.playing\) cloud\.updateFlare\(t\)/);
  assert.match(mainSource, /rig\.update\(dt, playback\.playing && cloud\.hasFocus \? cloud\.focus : null, t\)/);
});
