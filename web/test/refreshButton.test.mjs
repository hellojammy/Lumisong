import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const htmlSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mainSource = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const styleSource = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

test('page exposes a HUD refresh button for native shells', () => {
  assert.match(htmlSource, /<button id="refreshBtn"[^>]*aria-label="refresh"[^>]*>/);
  assert.match(mainSource, /const refreshBtn = \$<HTMLButtonElement>\('refreshBtn'\)/);
  assert.match(mainSource, /refreshBtn\.addEventListener\('click', \(\) => window\.location\.reload\(\)\)/);
  assert.match(styleSource, /#refreshBtn\s*\{/);
  assert.match(styleSource, /#refreshBtn:hover:not\(:disabled\)/);
});
