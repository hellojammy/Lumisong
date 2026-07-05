import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_APP_SETTINGS,
  applyDefaultSettingsMigration,
  storedBooleanSetting,
  storedSetting,
} from '../src/appDefaults.ts';
import { PALETTES } from '../src/colormap.ts';

const mainSource = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

test('all app shells share the requested default settings from the web layer', () => {
  assert.deepEqual(DEFAULT_APP_SETTINGS, {
    cameraMode: 'director2',
    mist: false,
    combo: true,
    fxFade: true,
    fxBreath: false,
    guides: true,
    form: 'ripple',
    palette: 'magma',
  });
});

test('default palette label is 融金', () => {
  assert.equal(PALETTES.find((p) => p.key === DEFAULT_APP_SETTINGS.palette)?.label, '融金');
});

test('main uses centralized defaults instead of legacy inline fallbacks', () => {
  assert.match(mainSource, /applyDefaultSettingsMigration\(\);/);
  assert.match(mainSource, /setPalette\(storedSetting\('palette'\)\)/);
  assert.match(mainSource, /storedBooleanSetting\('mist'\)/);
  assert.match(mainSource, /storedBooleanSetting\('combo'\)/);
  assert.doesNotMatch(mainSource, /localStorage\.getItem\('palette'\) \?\? 'ice'/);
  assert.doesNotMatch(mainSource, /localStorage\.getItem\('form'\)[\s\S]*?'orb'/);
  assert.doesNotMatch(mainSource, /localStorage\.getItem\('mist'\) !== '0'/);
});

test('default settings migration applies the new baseline once', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
  };

  store.set('palette', 'ice');
  applyDefaultSettingsMigration();
  assert.equal(storedSetting('palette'), 'magma');
  assert.equal(storedSetting('form'), 'ripple');
  assert.equal(storedSetting('cameraMode'), 'director2');
  assert.equal(storedBooleanSetting('mist'), false);
  assert.equal(storedBooleanSetting('combo'), true);
  assert.equal(storedBooleanSetting('fxFade'), true);
  assert.equal(storedBooleanSetting('fxBreath'), false);
  assert.equal(storedBooleanSetting('guides'), true);

  store.set('palette', 'viridis');
  applyDefaultSettingsMigration();
  assert.equal(storedSetting('palette'), 'viridis');
  delete globalThis.localStorage;
});
