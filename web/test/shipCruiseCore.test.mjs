import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShipRoute,
  sampleShipRoute,
} from '../src/shipCruiseCore.ts';

const center = { x: 1, y: 0.5, z: -0.5 };
const extent = { horizRadius: 6, vertRadius: 3 };

test('ship route mixes fly-through and orbit-style maneuvers around the nebula', () => {
  const route = buildShipRoute('speech-nebula', center, extent);
  const kinds = new Set(route.legs.map((leg) => leg.kind));
  assert.ok(kinds.has('穿云通道'));
  assert.ok(kinds.has('远景巡航'));
  assert.ok(kinds.has('掠边飞行'));
  assert.ok(route.legs.every((leg) => leg.duration >= 4 && leg.duration <= 12));
});

test('ship route has visible speed variation without teleporting outside the scene', () => {
  const route = buildShipRoute('speed-profile', center, extent);
  const speeds = route.legs.map((leg) => leg.speed);
  assert.ok(Math.max(...speeds) - Math.min(...speeds) >= 0.45);

  for (let t = 0; t < route.duration; t += 1.25) {
    const sample = sampleShipRoute(route, t);
    const dx = sample.position.x - center.x;
    const dy = sample.position.y - center.y;
    const dz = sample.position.z - center.z;
    const dist = Math.hypot(dx, dy, dz);
    assert.ok(dist <= extent.horizRadius * 2.45 + extent.vertRadius);
  }
});

test('ship route spends most maneuvers inside or near the note cloud', () => {
  const route = buildShipRoute('inside-cloud', center, extent);
  const nearCount = route.legs.filter((leg) => {
    const dx = leg.p3.x - center.x;
    const dz = leg.p3.z - center.z;
    return Math.hypot(dx, dz) <= extent.horizRadius * 1.12;
  }).length;
  assert.ok(nearCount >= Math.ceil(route.legs.length * 0.62));
});

test('ship route sampling keeps heading changes smooth enough for chase camera', () => {
  const route = buildShipRoute('smooth-turns', center, extent);
  let prev = sampleShipRoute(route, 0).forward;
  for (let t = 0.3; t < Math.min(route.duration, 28); t += 0.3) {
    const next = sampleShipRoute(route, t).forward;
    const dot = prev.x * next.x + prev.y * next.y + prev.z * next.z;
    assert.ok(dot > 0.45);
    prev = next;
  }
});

test('ship route keeps moving through leg boundaries instead of easing to a stop', () => {
  const route = buildShipRoute('boundary-speed', center, extent);
  for (const leg of route.legs.slice(1, 7)) {
    const before = sampleShipRoute(route, leg.start - 0.12).position;
    const at = sampleShipRoute(route, leg.start).position;
    const after = sampleShipRoute(route, leg.start + 0.12).position;
    const inbound = Math.hypot(before.x - at.x, before.y - at.y, before.z - at.z);
    const outbound = Math.hypot(after.x - at.x, after.y - at.y, after.z - at.z);
    assert.ok(Math.min(inbound, outbound) > extent.horizRadius * 0.0025);
  }
});
