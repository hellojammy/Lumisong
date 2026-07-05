import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mainSource = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const cloudSource = fs.readFileSync(new URL('../src/SyllableCloud.ts', import.meta.url), 'utf8');

test('form switch preserves finale and finished cruise state instead of replaying flare', () => {
  assert.match(mainSource, /let playbackFinished = false;/);
  assert.match(mainSource, /playbackFinished = true;[\s\S]*?playback\.finish\(\)/);
  assert.match(mainSource, /playbackFinished = false;[\s\S]*?const started = await playback\.play\(\)/);
  assert.match(mainSource, /const wasFinaleActive = cloud\.isFinaleActive\(\);/);
  assert.match(mainSource, /const wasGhostReplay = cloud\.isGhostReplayState\(\);/);
  assert.match(mainSource, /const playbackEnded = playbackFinished[\s\S]*\|\| playback\?\.finished/);
  assert.match(mainSource, /if \(!playbackFinished && \(playback\.finished \|\| \(playback\.playing && t >= playback\.duration\)\)\)/);
  assert.match(mainSource, /if \(wasFinaleActive\) \{\s*\/\/ 播完谢幕中切形态[\s\S]*?cloud\.startFinale\(\)/);
  assert.match(mainSource, /if \(wasGhostReplay\) cloud\.syncGhostState\(\);/);
  assert.match(mainSource, /else cloud\.syncFinished\(finishedTime\);/);
  assert.match(mainSource, /else \{\s*\/\/ 019：暂停时 updateFlare[\s\S]*?cloud\.updateFlare\(playbackTime\);/);
});

test('SyllableCloud exposes an explicit finished-state sync for shape rebuilds', () => {
  assert.match(cloudSource, /syncFinished\(now: number\): void/);
  assert.match(cloudSource, /syncGhostState\(\): void/);
  assert.match(cloudSource, /finishedHold = true;/);
  assert.match(cloudSource, /const fade = this\.fxFade;[\s\S]*?this\.fxFade = false;[\s\S]*?this\.resyncPlayed\(\);[\s\S]*?this\.updateLineProgress\(now\);[\s\S]*?this\.writeLineColors\(\);[\s\S]*?this\.writeLabelsOpacity\(\);[\s\S]*?this\.fxFade = fade;/);
});
