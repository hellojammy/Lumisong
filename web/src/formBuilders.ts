// 按形态组装几何 + 壳 + 核（构造期一次完成，播放循环无 quality 分支）
import * as THREE from 'three';
import { InstancedUniformsMesh } from 'three-instanced-uniforms-mesh';
import type { FormKey } from './syllableCloud';
import type { SyllablesJson } from './data';
import { GEO } from './visualProfiles';
import { coreMaterial, makeShellMesh, prepInstancedMesh } from './formMaterials';

const NOISY_FLATNESS = 0.45;

export interface CoreRef {
  mesh: InstancedUniformsMesh<THREE.MeshStandardMaterial>;
  idx: number;
}

export interface FormMeshes {
  instMeshes: InstancedUniformsMesh<THREE.MeshStandardMaterial>[];
  shell: THREE.InstancedMesh | null;
  ring: InstancedUniformsMesh<THREE.MeshStandardMaterial> | null;
  routeNext: (i: number) => CoreRef;
  addTo: (group: THREE.Group) => void;
}

export interface BuildFormOpts {
  form: FormKey;
  capacity: number;
  n: number;
  syllables: SyllablesJson['syllables'];
  isNoisy: (i: number) => boolean;
}

export function buildFormMeshes(opts: BuildFormOpts): FormMeshes {
  const { form, capacity, n, syllables, isNoisy } = opts;
  const instMeshes: InstancedUniformsMesh<THREE.MeshStandardMaterial>[] = [];
  let shell: THREE.InstancedMesh | null = null;
  let ring: InstancedUniformsMesh<THREE.MeshStandardMaterial> | null = null;
  let routeNext: (i: number) => CoreRef;

  if (capacity > 0) {
    const g = GEO.recording;
    shell = makeShellMesh(new THREE.SphereGeometry(1, g.shell.w, g.shell.h), capacity);
    shell.count = n;
    const core = new InstancedUniformsMesh(
      new THREE.SphereGeometry(g.core.r, g.core.w, g.core.h),
      coreMaterial(),
      capacity,
    );
    core.count = n;
    prepInstancedMesh(core);
    instMeshes.push(core);
    routeNext = (i) => ({ mesh: core, idx: i });
    return pack(instMeshes, shell, ring, routeNext);
  }

  if (form === 'orb') {
    const g = GEO.orb;
    const nFacet = syllables.filter((_, i) => isNoisy(i)).length;
    shell = makeShellMesh(new THREE.SphereGeometry(1, g.shell.w, g.shell.h), n);
    const coreSmooth = new InstancedUniformsMesh(
      new THREE.SphereGeometry(g.coreSmooth.r, g.coreSmooth.w, g.coreSmooth.h),
      coreMaterial(),
      Math.max(n - nFacet, 1),
    );
    const coreFacet = new InstancedUniformsMesh(
      new THREE.IcosahedronGeometry(g.coreFacet.r, g.coreFacet.detail),
      coreMaterial({ flatShading: true }),
      Math.max(nFacet, 1),
    );
    prepInstancedMesh(coreSmooth);
    prepInstancedMesh(coreFacet);
    instMeshes.push(coreSmooth, coreFacet);
    let si = 0;
    let fi = 0;
    routeNext = (i) => (isNoisy(i)
      ? { mesh: coreFacet, idx: fi++ }
      : { mesh: coreSmooth, idx: si++ });
    return pack(instMeshes, shell, ring, routeNext);
  }

  const gSpire = GEO.spire;
  const gRip = GEO.ripple;
  const gGem = GEO.gem;
  const gPla = GEO.planet;

  if (form === 'spire') {
    const coreGeo = new THREE.CylinderGeometry(gSpire.coreRadius, gSpire.coreRadius, 1, gSpire.radial);
    const shellGeo = new THREE.CylinderGeometry(
      gSpire.shellRadius, gSpire.shellRadius, 1.04, gSpire.shellRadial,
    );
    shell = makeShellMesh(shellGeo, n);
    const core = new InstancedUniformsMesh(coreGeo, coreMaterial({ spireTip: true }), n);
    prepInstancedMesh(core);
    instMeshes.push(core);
    routeNext = (i) => ({ mesh: core, idx: i });
    return pack(instMeshes, shell, ring, routeNext);
  }

  if (form === 'ripple') {
    const coreGeo = new THREE.TorusGeometry(1, gRip.tube, gRip.radial, gRip.tubular);
    const core = new InstancedUniformsMesh(coreGeo, coreMaterial(), n);
    prepInstancedMesh(core);
    instMeshes.push(core);
    routeNext = (i) => ({ mesh: core, idx: i });
    return pack(instMeshes, shell, ring, routeNext);
  }

  if (form === 'gem') {
    const coreGeo = new THREE.OctahedronGeometry(gGem.r, gGem.detail);
    // 壳与核同形八面体，略大一圈（非球体包裹）
    const shellGeo = new THREE.OctahedronGeometry(gGem.shellR, gGem.detail);
    shell = makeShellMesh(shellGeo, n);
    const core = new InstancedUniformsMesh(
      coreGeo, coreMaterial({ flatShading: true, rim: 0.38, gemFacet: true }), n,
    );
    prepInstancedMesh(core);
    instMeshes.push(core);
    routeNext = (i) => ({ mesh: core, idx: i });
    return pack(instMeshes, shell, ring, routeNext);
  }

  // planet
  shell = makeShellMesh(new THREE.SphereGeometry(1, gPla.shell.w, gPla.shell.h), n);
  const core = new InstancedUniformsMesh(
    new THREE.SphereGeometry(gPla.core.r, gPla.core.w, gPla.core.h),
    coreMaterial({ rim: 0.28 }),
    n,
  );
  ring = new InstancedUniformsMesh(
    new THREE.TorusGeometry(gPla.ring.major, gPla.ring.tube, gPla.ring.radial, gPla.ring.tubular),
    coreMaterial({ rim: 0.18 }),
    n,
  );
  prepInstancedMesh(core);
  prepInstancedMesh(ring);
  instMeshes.push(core);
  instMeshes.push(ring);
  routeNext = (i) => ({ mesh: core, idx: i });
  return pack(instMeshes, shell, ring, routeNext);
}

function pack(
  instMeshes: InstancedUniformsMesh<THREE.MeshStandardMaterial>[],
  shell: THREE.InstancedMesh | null,
  ring: InstancedUniformsMesh<THREE.MeshStandardMaterial> | null,
  routeNext: (i: number) => CoreRef,
): FormMeshes {
  return {
    instMeshes,
    shell,
    ring,
    routeNext,
    addTo(group) {
      for (const m of instMeshes) group.add(m);
      if (shell) group.add(shell);
    },
  };
}

export { NOISY_FLATNESS };
