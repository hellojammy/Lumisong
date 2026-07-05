import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mainSource = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const iosProject = fs.readFileSync(new URL('../../ios/Lumisong.xcodeproj/project.pbxproj', import.meta.url), 'utf8');

test('production build does not expose browser-only analysis test hook', () => {
  assert.match(mainSource, /if \(import\.meta\.env\.DEV\) \{[\s\S]*?__analyzeUrl/);
});

test('iOS build synchronizes latest web dist before copying WebContent resources', () => {
  assert.match(iosProject, /PBXShellScriptBuildPhase/);
  assert.match(iosProject, /Sync WebContent/);
  assert.match(iosProject, /npm run build/);
  assert.match(iosProject, /sync-web\.sh/);

  const buildPhases = iosProject.match(/buildPhases = \(([\s\S]*?)\);/)?.[1] ?? '';
  const syncIndex = buildPhases.indexOf('Sync WebContent');
  const resourceIndex = buildPhases.indexOf('Resources');
  assert.ok(syncIndex >= 0, 'missing Sync WebContent build phase');
  assert.ok(resourceIndex >= 0, 'missing Resources build phase');
  assert.ok(syncIndex < resourceIndex, 'WebContent sync must run before Resources are copied');
});
