import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraRig } from '../src/camera.ts';

function createShipStub() {
  return {
    group: new THREE.Group(),
    pilotActive: null,
    resetCount: 0,
    setPilotActive(active) {
      this.pilotActive = active;
    },
    resetPilot() {
      this.resetCount += 1;
    },
    update() {},
    updatePilot() {},
  };
}

test('ship model is visible only in ship cruise and ship pilot camera modes', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  const ship = createShipStub();
  const rig = new CameraRig(
    camera,
    new THREE.Vector3(0, 0, 0),
    { horizRadius: 6, vertRadius: 3 },
    'director',
    null,
    null,
    ship,
    null,
  );

  assert.equal(ship.group.visible, false);

  rig.setMode('ship');
  assert.equal(ship.group.visible, true);

  rig.setMode('orbit');
  assert.equal(ship.group.visible, false);

  rig.setMode('pilot');
  assert.equal(ship.group.visible, true);

  rig.setMode('director2');
  assert.equal(ship.group.visible, false);
});
