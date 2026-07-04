import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('visible product copy is positioned for general audio, not only birdsong', () => {
  const index = read('index.html');
  assert.match(index, /音乐、语音、鸟鸣或环境声|任意音频|声音事件/);
  assert.doesNotMatch(index, /鸟鸣录音|鸟叫|每声鸣叫|鸟在重复/);
});

test('app labels and permission text use generic audio language', () => {
  const main = read('src/main.ts');
  const analyzer = read('src/analyzerEssentia.ts');
  const iosInfo = read('../ios/Lumisong/Info.plist');

  assert.match(main, /声音事件 EVENTS/);
  assert.doesNotMatch(main, /音节 SYLLABLES/);
  assert.doesNotMatch(analyzer, /未检测到鸣叫音节/);
  assert.doesNotMatch(iosInfo, /采集鸟鸣/);
});
