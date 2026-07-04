// 形态材质工厂（玻璃壳 / 光体核 / rim 边缘光 / 光针顶端渐亮）
import * as THREE from 'three';

const SHELL = {
  transparent: true,
  opacity: 0.16,
  roughness: 0.12,
  metalness: 0.0,
  envMapIntensity: 0.5,
  depthWrite: false,
} as const;

export interface CoreMatOpts {
  flatShading?: boolean;
  /** C3：碎钻/星环核 rim 边缘光强度 */
  rim?: number;
  /** C1：光针轴向顶端渐亮 */
  spireTip?: boolean;
}

/** 外层着色玻璃壳（orb 及非 orb 轻量壳 C4） */
export function shellMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ ...SHELL });
}

/** 005 光体核 + 可选 rim / 光针顶端 shader 补丁 */
export function coreMaterial(opts: CoreMatOpts = {}): THREE.MeshStandardMaterial {
  const { flatShading = false, rim = 0, spireTip = false } = opts;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    roughness: 1.0,
    metalness: 0.0,
    envMapIntensity: 0.0,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 1.0,
    toneMapped: true,
    flatShading,
  });
  if (rim > 0 || spireTip) {
    mat.onBeforeCompile = (shader) => {
      if (spireTip) {
        shader.vertexShader = shader.vertexShader.replace(
          'void main() {',
          'varying float vSpireY;\nvoid main() {',
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vSpireY = position.y + 0.5;`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          'void main() {',
          'varying float vSpireY;\nvoid main() {',
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance *= 1.0 + smoothstep(0.35, 1.0, vSpireY) * 0.4;`,
        );
      }
      if (rim > 0) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
            totalEmissiveRadiance += (1.0 - ndv) * ${rim.toFixed(3)};
          }`,
        );
      }
    };
  }
  return mat;
}

/** 玻璃壳 InstancedMesh 通用装配 */
export function makeShellMesh(
  geometry: THREE.BufferGeometry,
  count: number,
): THREE.InstancedMesh {
  const shell = new THREE.InstancedMesh(geometry, shellMaterial(), count);
  shell.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shell.renderOrder = 2;
  shell.frustumCulled = false;
  return shell;
}

/** InstancedUniformsMesh 通用装配 */
export function prepInstancedMesh<T extends THREE.MeshStandardMaterial>(
  mesh: import('three-instanced-uniforms-mesh').InstancedUniformsMesh<T>,
): void {
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
}
