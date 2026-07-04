import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_PROFILES,
  chooseAudioProfile,
  classifyAudioSummary,
  profileLabel,
} from '../src/audioProfile.ts';

test('audio profiles expose stable labels and analysis ranges', () => {
  assert.equal(profileLabel('bird'), '鸟鸣');
  assert.equal(profileLabel('music'), '音乐');
  assert.equal(profileLabel('voice'), '人声');
  assert.equal(profileLabel('generic'), '通用');
  assert.equal(AUDIO_PROFILES.bird.fmin, 1500);
  assert.equal(AUDIO_PROFILES.bird.fmaxCap, 10000);
  assert.ok(AUDIO_PROFILES.music.fmin < AUDIO_PROFILES.bird.fmin);
  assert.ok(AUDIO_PROFILES.voice.fmin < AUDIO_PROFILES.bird.fmin);
});

test('classifyAudioSummary detects high transient high-frequency material as birdsong', () => {
  const guess = classifyAudioSummary({
    duration: 12,
    zeroCrossingRate: 0.22,
    transientRate: 7.5,
    dynamicRange: 0.72,
    lowEnergyRatio: 0.05,
    midEnergyRatio: 0.2,
    highEnergyRatio: 0.75,
    voicedStability: 0.25,
  });
  assert.equal(guess.profile, 'bird');
});

test('classifyAudioSummary separates music and voice', () => {
  assert.equal(classifyAudioSummary({
    duration: 30,
    zeroCrossingRate: 0.08,
    transientRate: 2.8,
    dynamicRange: 0.42,
    lowEnergyRatio: 0.33,
    midEnergyRatio: 0.46,
    highEnergyRatio: 0.21,
    voicedStability: 0.4,
  }).profile, 'music');

  assert.equal(classifyAudioSummary({
    duration: 18,
    zeroCrossingRate: 0.05,
    transientRate: 1.0,
    dynamicRange: 0.26,
    lowEnergyRatio: 0.18,
    midEnergyRatio: 0.68,
    highEnergyRatio: 0.14,
    voicedStability: 0.82,
  }).profile, 'voice');
});

test('chooseAudioProfile lets the user override auto classification', () => {
  const auto = classifyAudioSummary({
    duration: 10,
    zeroCrossingRate: 0.2,
    transientRate: 6,
    dynamicRange: 0.6,
    lowEnergyRatio: 0.04,
    midEnergyRatio: 0.21,
    highEnergyRatio: 0.75,
    voicedStability: 0.1,
  });
  assert.equal(auto.profile, 'bird');
  assert.equal(chooseAudioProfile(auto, 'music'), 'music');
  assert.equal(chooseAudioProfile(auto), 'bird');
});
