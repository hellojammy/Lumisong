// 场景基础：渲染器/灯光/相机（spec constellation-view / cinematic-fx）
// 背景与雾由 environment.ts（深空容器）负责。
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface SceneCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

export function createScene(canvas: HTMLCanvasElement): SceneCtx {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // AA 由 postfx 的 SMAA 承担（cinematic-fx）
    stencil: false,
    powerPreference: 'high-performance',
  });
  // B2 DPR cap（移动端能效）：真机 DPR=3 时全屏渲染像素是逻辑分辨率的 9 倍，
  // cap 到 1.5 大幅降低 GPU 负载与发热；高 DPR 下边缘本已锐利，视觉损失小。
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  // HDR 流水线：场景输出线性 HDR，色调映射由 postfx 的 ToneMappingEffect 收尾
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();

  // 环境反射（能量体质感的关键）：PMREM RoomEnvironment 只作 IBL，不作背景
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
  pmrem.dispose();

  // 深空下灯光收暗：造型主要靠 envMap 反射 + 自发光，方向光只给轮廓
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x0a0f18, 0.35));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(4, 6, 3);
  scene.add(dir);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    160, // 远平面覆盖星尘壳（r≤60）
  );
  camera.position.set(0, 0, 10);

  return { renderer, scene, camera };
}
