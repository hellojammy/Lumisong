import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/rhythmFloor.ts', import.meta.url), 'utf8');

test('rhythm floor is a dense 3D terrain driven by sampled audio bands', () => {
  assert.match(source, /const GROUND_GRID = 144/);
  assert.match(source, /new THREE\.ShaderMaterial/);
  assert.match(source, /new THREE\.InstancedMesh\(geometry, this\.material, GROUND_GRID \* GROUND_GRID\)/);
  assert.match(source, /uBands/);
  assert.match(source, /sampleRhythmBands\(this\.analysis, time\)/);
  assert.match(source, /this\.mesh\.instanceMatrix\.needsUpdate = true/);
});

test('rhythm floor uses simplex noise and beat-triggered ripples', () => {
  assert.match(source, /float snoise\(vec2 v\)/);
  assert.match(source, /uRippleStrength/);
  assert.match(source, /sampleRhythmFlux\(this\.analysis, time\)/);
});

test('rhythm floor freezes when playback is paused', () => {
  // 非播放态完全冻结：不推进 idle、不改 bands（律动严格跟随播放）
  assert.match(source, /if \(!active\) return;/);
  assert.match(source, /this\.idleTime \+= dt;/);
  assert.doesNotMatch(source, /active \? 1 : 0\.35/);
});

test('rhythm floor lives in the main 3D scene (no separate camera or viewport)', () => {
  // 已并入主场景：不再有独立 scene / 相机 / scissor 视口渲染
  assert.doesNotMatch(source, /new THREE\.PerspectiveCamera/);
  assert.doesNotMatch(source, /setScissorTest/);
  assert.doesNotMatch(source, /VIEWPORT_HEIGHT_RATIO/);
  assert.match(source, /readonly group = new THREE\.Group\(\)/);
});

test('main scene adds the rhythm floor group and shares the main camera', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /scene\.add\(rhythmFloor\.group\)/);
  assert.match(main, /scene\.remove\(rhythmFloor\.group\)/);
  assert.doesNotMatch(main, /rhythmFloor\?\.render\(renderer\)/);
  assert.match(main, /const t = playback\.now\(\);/);
  assert.match(main, /rhythmFloor\?\.update\(t, dt, playback\.playing\)/);
});
