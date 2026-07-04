import * as THREE from 'three';
import { buildShipRoute, sampleShipRoute, type ShipRoute, type Vec3Tuple } from './shipCruiseCore';
import { focusBiasedShipPose, shouldTriggerFlyby } from './shipCruiseFxCore';
import { createPilotState, updatePilotState, type PilotInput, type PilotState } from './shipPilotCore';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const SHIP_FORWARD = new THREE.Vector3(0, 0, 1);
const PILOT_KEY_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'KeyR',
  'KeyF',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ShiftLeft',
  'ShiftRight',
]);

function toVec3(v: Vec3Tuple): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const m of material) m.dispose();
    } else if (material) {
      material.dispose();
    }
  });
}

interface FlamePart {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  baseOpacity: number;
  baseRadius: number;
  baseLength: number;
  phase: number;
}

interface Shockwave {
  group: THREE.Group;
  mats: THREE.MeshBasicMaterial[];
  age: number;
  duration: number;
}

export class ShipCruise {
  readonly group = new THREE.Group();
  private readonly route: ShipRoute;
  private readonly ship = new THREE.Group();
  private readonly flybyFx = new THREE.Group();
  private readonly desiredCamera = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly smoothTarget = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly rollQuat = new THREE.Quaternion();
  private readonly centerTuple: Vec3Tuple;
  private readonly extent: { horizRadius: number; vertRadius: number };
  private readonly keys = new Set<string>();
  private readonly flames: FlamePart[] = [];
  private readonly engineGlowMats: THREE.MeshBasicMaterial[] = [];
  private readonly shockwaves: Shockwave[] = [];
  private readonly lastWorldPos = new THREE.Vector3();
  private readonly interestFocus = new THREE.Vector3();
  private pilot: PilotState;
  private pilotActive = false;
  private hasLastWorldPos = false;
  private hasInterestFocus = false;
  private lastFlybyT = -10;
  private t = 0;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.pilotActive) return;
    if (!PILOT_KEY_CODES.has(event.code)) return;
    this.keys.add(event.code);
    event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!this.pilotActive) return;
    if (!PILOT_KEY_CODES.has(event.code)) return;
    this.keys.delete(event.code);
    event.preventDefault();
  };

  constructor(
    center: THREE.Vector3,
    extent: { horizRadius: number; vertRadius: number },
    seed: string,
  ) {
    this.centerTuple = { x: center.x, y: center.y, z: center.z };
    this.extent = extent;
    this.route = buildShipRoute(seed, this.centerTuple, extent);
    this.pilot = createPilotState(this.centerTuple, extent);
    this.group.add(this.ship);
    this.group.add(this.flybyFx);
    this.buildShip(Math.max(extent.horizRadius, extent.vertRadius));

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, focus: THREE.Vector3 | null = null): void {
    this.t += dt;
    const sample = sampleShipRoute(this.route, this.t);
    const interest = this.updateInterestFocus(focus, dt);
    const pose = focusBiasedShipPose({
      position: sample.position,
      forward: sample.forward,
      speed: sample.speed,
    }, interest ? { x: interest.x, y: interest.y, z: interest.z } : null, this.extent, this.t);
    const pos = toVec3(pose.position);
    this.maybeTriggerFlyby(pos, interest, pose.speed);
    this.applyPose(
      pos,
      toVec3(pose.forward),
      pose.speed,
      sample.roll,
      dt,
      camera,
    );
    this.updateFlybyFx(dt);
  }

  private updateInterestFocus(focus: THREE.Vector3 | null, dt: number): THREE.Vector3 | null {
    if (!focus) {
      this.hasInterestFocus = false;
      return null;
    }
    if (!this.hasInterestFocus) {
      this.interestFocus.copy(focus);
      this.hasInterestFocus = true;
      return this.interestFocus;
    }
    this.interestFocus.lerp(focus, 1 - Math.exp(-dt * 0.42));
    return this.interestFocus;
  }

  updatePilot(dt: number, camera: THREE.PerspectiveCamera): void {
    this.t += dt;
    this.pilot = updatePilotState(this.pilot, this.pilotInput(), dt);
    this.applyPose(
      toVec3(this.pilot.position),
      toVec3(this.pilot.forward),
      this.pilot.speed,
      this.pilot.roll,
      dt,
      camera,
    );
    this.updateFlybyFx(dt);
  }

  resetPilot(): void {
    this.pilot = createPilotState(this.centerTuple, this.extent);
    this.keys.clear();
  }

  setPilotActive(active: boolean): void {
    this.pilotActive = active;
    if (!active) this.keys.clear();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    disposeObject(this.group);
  }

  private pilotInput(): PilotInput {
    const down = (code: string): boolean => this.keys.has(code);
    return {
      throttle: (down('KeyW') || down('Space') || down('ShiftLeft') || down('ShiftRight') ? 1 : 0)
        + (down('KeyS') ? -0.75 : 0),
      yaw: (down('KeyD') || down('ArrowRight') ? 1 : 0) - (down('KeyA') || down('ArrowLeft') ? 1 : 0),
      pitch: (down('ArrowUp') || down('KeyR') ? 1 : 0) - (down('ArrowDown') || down('KeyF') ? 1 : 0),
      roll: (down('KeyE') ? 1 : 0) - (down('KeyQ') ? 1 : 0),
    };
  }

  private applyPose(
    pos: THREE.Vector3,
    forward: THREE.Vector3,
    speed: number,
    roll: number,
    dt: number,
    camera: THREE.PerspectiveCamera,
  ): void {
    this.forward.copy(forward).normalize();
    this.quat.setFromUnitVectors(SHIP_FORWARD, this.forward);
    this.rollQuat.setFromAxisAngle(this.forward, roll);
    this.ship.position.copy(pos);
    this.ship.quaternion.copy(this.rollQuat).multiply(this.quat);

    this.side.crossVectors(this.forward, WORLD_UP);
    if (this.side.lengthSq() < 0.001) this.side.set(1, 0, 0);
    this.side.normalize();
    this.up.crossVectors(this.side, this.forward).normalize();

    const view = this.cameraView();
    const chase = (1.55 + speed * 1.55) * view.back;
    const height = (0.58 + speed * 0.32) * view.height;
    this.desiredCamera.copy(pos)
      .addScaledVector(this.forward, -chase)
      .addScaledVector(this.up, height)
      .addScaledVector(this.side, roll * 0.9 + view.side * (0.45 + speed * 0.38));
    this.desiredTarget.copy(pos)
      .addScaledVector(this.forward, (2.8 + speed * 1.8) * view.lead)
      .addScaledVector(this.up, 0.18 * view.targetUp);

    camera.position.lerp(this.desiredCamera, 1 - Math.exp(-dt * 2.45));
    this.smoothTarget.lerp(this.desiredTarget, 1 - Math.exp(-dt * 3.35));
    camera.lookAt(this.smoothTarget);
    this.updateExhaust(speed);
  }

  private cameraView(): { back: number; height: number; side: number; lead: number; targetUp: number } {
    const profiles = [
      { back: 1.0, height: 1.0, side: 0.05, lead: 1.0, targetUp: 1.0 },
      { back: 0.74, height: 0.86, side: 1.55, lead: 0.92, targetUp: 0.8 },
      { back: 0.58, height: 0.52, side: -0.72, lead: 0.76, targetUp: 0.45 },
      { back: 1.72, height: 1.85, side: 0.38, lead: 1.28, targetUp: 1.35 },
    ];
    const segment = 8.5;
    const raw = (((this.t / segment) % profiles.length) + profiles.length) % profiles.length;
    const idx = Math.min(profiles.length - 1, Math.floor(raw));
    const u = raw - idx;
    const k = u * u * (3 - 2 * u);
    const a = profiles[idx];
    const b = profiles[(idx + 1) % profiles.length];
    return {
      back: a.back + (b.back - a.back) * k,
      height: a.height + (b.height - a.height) * k,
      side: a.side + (b.side - a.side) * k,
      lead: a.lead + (b.lead - a.lead) * k,
      targetUp: a.targetUp + (b.targetUp - a.targetUp) * k,
    };
  }

  private maybeTriggerFlyby(pos: THREE.Vector3, focus: THREE.Vector3 | null, speed: number): void {
    if (!this.hasLastWorldPos) {
      this.lastWorldPos.copy(pos);
      this.hasLastWorldPos = true;
      return;
    }
    const radius = Math.max(0.54, Math.min(1.08, this.extent.horizRadius * 0.085));
    const hit = shouldTriggerFlyby(
      { x: this.lastWorldPos.x, y: this.lastWorldPos.y, z: this.lastWorldPos.z },
      { x: pos.x, y: pos.y, z: pos.z },
      focus ? { x: focus.x, y: focus.y, z: focus.z } : null,
      radius,
      this.t,
      this.lastFlybyT,
      1.25,
    );
    if (hit && focus) {
      this.lastFlybyT = this.t;
      this.addShockwave(focus, speed);
    }
    this.lastWorldPos.copy(pos);
  }

  private addShockwave(focus: THREE.Vector3, speed: number): void {
    const group = new THREE.Group();
    group.position.copy(focus);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.forward);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xa8f7ff,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.012, 8, 56), ringMat);
    group.add(ring);

    const glowMat = new THREE.MeshBasicMaterial({
      color: speed > 0.95 ? 0xff9a42 : 0x66dfff,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.32, 18, 10), glowMat);
    group.add(glow);

    this.flybyFx.add(group);
    this.shockwaves.push({
      group,
      mats: [ringMat, glowMat],
      age: 0,
      duration: 0.72 + Math.min(speed, 1.4) * 0.18,
    });
  }

  private updateFlybyFx(dt: number): void {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const wave = this.shockwaves[i];
      wave.age += dt;
      const k = Math.min(wave.age / wave.duration, 1);
      const easeOut = 1 - (1 - k) * (1 - k);
      const scale = 0.62 + easeOut * 2.35;
      wave.group.scale.setScalar(scale);
      wave.mats[0].opacity = 0.62 * (1 - k);
      wave.mats[1].opacity = 0.2 * (1 - k) * (1 - k);
      if (k >= 1) {
        this.flybyFx.remove(wave.group);
        disposeObject(wave.group);
        this.shockwaves.splice(i, 1);
      }
    }
  }

  private buildShip(radius: number): void {
    const s = Math.max(0.22, Math.min(0.68, radius * 0.065));
    this.ship.scale.setScalar(s);

    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x263241,
      metalness: 0.82,
      roughness: 0.24,
      emissive: 0x061522,
      emissiveIntensity: 0.38,
    });
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x0e131b,
      metalness: 0.86,
      roughness: 0.28,
      emissive: 0x050a10,
      emissiveIntensity: 0.26,
    });
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x8fa1b4,
      metalness: 0.74,
      roughness: 0.34,
      emissive: 0x06111a,
      emissiveIntensity: 0.22,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xe0703a,
      metalness: 0.42,
      roughness: 0.32,
      emissive: 0x4b1507,
      emissiveIntensity: 0.35,
    });
    const canopyMat = new THREE.MeshPhysicalMaterial({
      color: 0x75ddff,
      metalness: 0.05,
      roughness: 0.08,
      transmission: 0.32,
      transparent: true,
      opacity: 0.62,
      emissive: 0x0fb8ff,
      emissiveIntensity: 0.88,
    });
    const seamMat = new THREE.MeshBasicMaterial({
      color: 0x07101a,
      transparent: true,
      opacity: 0.88,
    });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.29, 1.18, 14), hullMat);
    body.rotation.x = Math.PI / 2;
    body.position.z = -0.08;
    this.ship.add(body);

    const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.82), armorMat);
    lowerBody.position.set(0, -0.08, -0.12);
    this.ship.add(lowerBody);

    const bellyPlate = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.028, 0.54), panelMat);
    bellyPlate.position.set(0, -0.155, -0.1);
    this.ship.add(bellyPlate);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.5, 14), hullMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.74;
    this.ship.add(nose);

    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.18, 18, 10), canopyMat);
    canopy.scale.set(0.88, 0.42, 1.18);
    canopy.position.set(0, 0.16, 0.36);
    this.ship.add(canopy);

    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.9), panelMat);
    spine.position.set(0, 0.23, -0.08);
    this.ship.add(spine);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.014, 0.78), accentMat);
    stripe.position.set(0, 0.274, -0.08);
    this.ship.add(stripe);

    for (const side of [-1, 1] as const) {
      const wing = this.wingMesh(armorMat, side);
      const stabilizer = this.stabilizerMesh(panelMat, side);
      this.ship.add(wing, stabilizer);

      const sidePanel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.56), panelMat);
      sidePanel.position.set(side * 0.22, 0.02, -0.12);
      sidePanel.rotation.z = side * 0.12;
      this.ship.add(sidePanel);

      const colorBar = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.03, 0.42), accentMat);
      colorBar.position.set(side * 0.275, 0.07, -0.12);
      colorBar.rotation.z = side * 0.16;
      this.ship.add(colorBar);

      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.11, 0.58, 14), armorMat);
      nacelle.rotation.x = Math.PI / 2;
      nacelle.position.set(side * 0.42, -0.05, -0.42);
      this.ship.add(nacelle);

      const nacelleSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.122, 0.12, 16), panelMat);
      nacelleSleeve.rotation.x = Math.PI / 2;
      nacelleSleeve.position.set(side * 0.42, -0.05, -0.66);
      this.ship.add(nacelleSleeve);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 8, 18), panelMat);
      ring.position.set(side * 0.42, -0.05, -0.74);
      this.ship.add(ring);

      const glowMat = this.engineGlowMaterial(0x55d8ff, 0.82);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.075, 18), glowMat);
      glow.position.set(side * 0.42, -0.05, -0.755);
      glow.rotation.y = Math.PI;
      this.engineGlowMats.push(glowMat);
      this.ship.add(glow);

      this.addFlame(new THREE.Vector3(side * 0.42, -0.05, -1.02), 0.088, 0.72, 0.5, 0.7 + side * 0.6);
    }

    const centerRing = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 8, 22), panelMat);
    centerRing.position.set(0, -0.02, -0.75);
    this.ship.add(centerRing);

    const coreGlowMat = this.engineGlowMaterial(0xb4f7ff, 1);
    const coreGlow = new THREE.Mesh(new THREE.CircleGeometry(0.105, 22), coreGlowMat);
    coreGlow.position.set(0, -0.02, -0.77);
    coreGlow.rotation.y = Math.PI;
    this.engineGlowMats.push(coreGlowMat);
    this.ship.add(coreGlow);

    this.addFlame(new THREE.Vector3(0, -0.02, -1.08), 0.14, 0.88, 0.64, 2.2);

    for (const x of [-0.105, 0.105]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.92), seamMat);
      seam.position.set(x, 0.168, -0.09);
      this.ship.add(seam);
    }
  }

  private engineGlowMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  private wingMesh(mat: THREE.Material, side: -1 | 1): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      0.08 * side, -0.025, 0.2,
      0.92 * side, -0.045, -0.24,
      0.24 * side, -0.08, -0.62,
      0.08 * side, -0.025, 0.2,
      0.24 * side, -0.08, -0.62,
      0.0, -0.06, -0.48,
    ], 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  }

  private stabilizerMesh(mat: THREE.Material, side: -1 | 1): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      0.13 * side, 0.04, -0.42,
      0.46 * side, 0.18, -0.68,
      0.16 * side, -0.02, -0.74,
    ], 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  }

  private addFlame(position: THREE.Vector3, radius: number, length: number, opacity: number, phase: number): void {
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0xff8b32,
      transparent: true,
      opacity: opacity * 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const outer = new THREE.Mesh(new THREE.ConeGeometry(radius * 1.45, length * 1.16, 18, 1, true), outerMat);
    outer.rotation.x = -Math.PI / 2;
    outer.position.copy(position);
    this.flames.push({ mesh: outer, material: outerMat, baseOpacity: opacity * 0.42, baseRadius: radius * 1.45, baseLength: length * 1.16, phase });
    this.ship.add(outer);

    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xbffaff,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const core = new THREE.Mesh(new THREE.ConeGeometry(radius, length, 16, 1, true), coreMat);
    core.rotation.x = -Math.PI / 2;
    core.position.copy(position).add(new THREE.Vector3(0, 0, -length * 0.06));
    this.flames.push({ mesh: core, material: coreMat, baseOpacity: opacity, baseRadius: radius, baseLength: length, phase: phase + 1.7 });
    this.ship.add(core);
  }

  private updateExhaust(speed: number): void {
    const kSpeed = THREE.MathUtils.clamp((speed - 0.18) / 1.1, 0, 1);
    for (const [index, item] of this.flames.entries()) {
      const flicker = 0.88 + Math.sin(this.t * (9.5 + index * 0.8) + item.phase) * 0.09;
      const lengthScale = (0.62 + kSpeed * 1.55) * flicker;
      const radiusScale = 0.78 + kSpeed * 0.54 + Math.sin(this.t * 13 + item.phase) * 0.03;
      item.mesh.scale.set(radiusScale, lengthScale, radiusScale);
      item.material.opacity = item.baseOpacity * (0.52 + kSpeed * 0.82) * flicker;
    }

    for (const mat of this.engineGlowMats) {
      mat.opacity = 0.48 + kSpeed * 0.52 + Math.sin(this.t * 14.5) * 0.04;
    }
  }
}
