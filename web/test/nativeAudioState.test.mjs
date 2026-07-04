import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const playbackSource = fs.readFileSync(new URL('../src/playback.ts', import.meta.url), 'utf8');

test('native playing state advances the visual playback clock', async () => {
  let posted = [];
  globalThis.window = {
    webkit: {
      messageHandlers: {
        audioBridge: { postMessage: (msg) => posted.push(msg) },
      },
    },
  };

  const nativeAudio = await import(`../src/audioNative.ts?case=${Date.now()}`);

  let ended = false;
  nativeAudio.installNativeAudioCallbacks(() => {
    ended = true;
  });

  const startedAt = nativeAudio.nativeNow();
  globalThis.window.__onAudioState('playing', 1.25);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(nativeAudio.hasNativeAudio(), true);
  assert.equal(nativeAudio.nativeIsPlaying(), true);
  assert.equal(ended, false);
  assert.ok(nativeAudio.nativeNow() > Math.max(startedAt, 1.25));
  assert.deepEqual(posted, []);
});

test('native upload playback reads native playing state and clock', () => {
  assert.match(playbackSource, /get playing\(\): boolean \{\n    return this\.useNative \? nativeIsPlaying\(\) : this\._playing;/);
  assert.match(playbackSource, /if \(this\.useNative\) \{\n      return Math\.min\(nativeNow\(\), this\.duration\);/);
  assert.match(playbackSource, /this\.source\.kind === 'external' && !this\._externalStarted/);
});

test('native upload playback restarts from zero after analysis completes', () => {
  assert.match(
    playbackSource,
    /this\.source\.kind === 'external' && !this\._externalStarted[\s\S]*nativeSeek\(0\)[\s\S]*nativePlay\(\)/,
  );
});
