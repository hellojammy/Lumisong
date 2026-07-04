// 形态几何规格（视觉精修 C 档）—— syllableCloud 与 messenger 共用，避免分叉漂移
import * as THREE from 'three';
import type { FormKey } from './syllableCloud';

export const GEO = {
  orb: {
    shell: { w: 32, h: 20 },
    coreSmooth: { r: 0.72, w: 28, h: 18 },
    coreFacet: { r: 0.8, detail: 0 },
  },
  recording: {
    shell: { w: 32, h: 20 },
    core: { r: 0.72, w: 28, h: 18 },
  },
  spire: { radial: 16, shellRadial: 16, shellRadius: 0.058, coreRadius: 0.05 },
  ripple: { radial: 8, tubular: 48, tube: 0.07 },
  gem: { r: 0.8, shellR: 0.93, detail: 0 },
  planet: {
    core: { r: 0.85, w: 28, h: 18 },
    ring: { major: 1.7, tube: 0.05, radial: 12, tubular: 40 },
    shell: { w: 32, h: 20 },
  },
} as const;

const MESSENGER_R = 0.13;

/** 哨箭头几何（与音节形态分段对齐） */
export function createMessengerHeadGeometry(form: FormKey): THREE.BufferGeometry {
  const g = GEO;
  switch (form) {
    case 'ripple':
      return new THREE.TorusGeometry(MESSENGER_R, MESSENGER_R * 0.16, g.ripple.radial, g.ripple.tubular);
    case 'spire':
      return new THREE.CylinderGeometry(
        MESSENGER_R * 0.34, MESSENGER_R * 0.34, MESSENGER_R * 2.6, g.spire.radial,
      );
    case 'gem':
      return new THREE.OctahedronGeometry(MESSENGER_R * 1.15, g.gem.detail);
    case 'orb':
    case 'planet':
    default:
      return new THREE.SphereGeometry(MESSENGER_R, g.planet.core.w, g.planet.core.h);
  }
}
