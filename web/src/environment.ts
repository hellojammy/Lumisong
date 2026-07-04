// 三维空间容器（changes/003：深空背景 + 指数雾 + 星尘 + 渐隐网格地面）
// 给星座一个有纵深的「数据空间」，而非悬浮在虚空里。
import * as THREE from 'three';

export const SPACE_BG = '#05070d';
const FOG_DENSITY = 0.022;
const STAR_COUNT = 1600;
const GRID_SIZE = 90;
const GRID_STEP = 1.0; // 005：恢复 003 的网格存在感（用户点名保留）

/** 确定性伪随机（项目规约：禁 Math.random） */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function buildStars(): THREE.Points {
  const pos = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    // 球壳分布 r ∈ [28, 60]，避开星座所在的中心区
    const u = hash01(i * 3 + 1) * 2 - 1;
    const phi = hash01(i * 3 + 2) * Math.PI * 2;
    const r = 28 + hash01(i * 3 + 3) * 32;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = r * s * Math.cos(phi);
    pos[i * 3 + 1] = r * u;
    pos[i * 3 + 2] = r * s * Math.sin(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x9fb8d8,
    size: 0.07,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    fog: false, // 星星是「无限远」，不参与雾
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/** 距离渐隐网格地面：PlaneGeometry + 自定义 shader（fwidth 抗锯齿细线，按半径淡出） */
function buildGrid(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color('#274a66') },
      uStep: { value: GRID_STEP },
      uRadius: { value: GRID_SIZE * 0.42 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vXZ;
      void main() {
        vXZ = position.xy; // plane 本地坐标（旋转前 xy = 世界 xz）
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStep;
      uniform float uRadius;
      varying vec2 vXZ;
      void main() {
        vec2 g = abs(fract(vXZ / uStep - 0.5) - 0.5) / fwidth(vXZ / uStep);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        float fade = 1.0 - smoothstep(uRadius * 0.25, uRadius, length(vXZ));
        float a = line * fade * 0.5;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = -1;
  return mesh;
}

// —— 008 云雾层：程序生成柔边雾片，绕星座缓慢漂移 + 呼吸明暗 ——
const MIST_COUNT = 26;
const MIST_COLOR = '#8fa9cc';

function mistTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.32)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

interface MistSprite {
  sprite: THREE.Sprite;
  base: THREE.Vector3;
  baseOpacity: number;
  phase: number;
  speed: number;
  amp: number;
}

function buildMist(): { group: THREE.Group; items: MistSprite[] } {
  const tex = mistTexture();
  const group = new THREE.Group();
  const items: MistSprite[] = [];
  for (let i = 0; i < MIST_COUNT; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: new THREE.Color(MIST_COLOR),
      transparent: true,
      opacity: 0.035 + hash01(i * 11 + 5) * 0.035, // 0.035–0.07，雾要「缥缈」不要「糊」
      depthWrite: false,
      rotation: hash01(i * 11 + 6) * Math.PI * 2,
    });
    const sprite = new THREE.Sprite(mat);
    const scale = 4.5 + hash01(i * 11 + 7) * 6;
    sprite.scale.set(scale, scale * (0.6 + hash01(i * 11 + 8) * 0.5), 1);
    group.add(sprite);
    items.push({
      sprite,
      base: new THREE.Vector3(),
      baseOpacity: mat.opacity,
      phase: hash01(i * 11 + 9) * Math.PI * 2,
      speed: 0.05 + hash01(i * 11 + 10) * 0.08, // 极慢漂移
      amp: 0.35 + hash01(i * 11 + 11) * 0.5,
    });
  }
  return { group, items };
}

export interface SpaceEnvironment {
  /** 数据重建后调用：网格地面放到星座下方、云雾带环绕星座分布 */
  fit(center: THREE.Vector3, vertRadius: number, horizRadius: number): void;
  /** 每帧调用：云雾漂移与呼吸（rAF 挂钟，与播放时钟无关） */
  update(dt: number): void;
  setMist(on: boolean): void;
  mistEnabled(): boolean;
}

export function createEnvironment(scene: THREE.Scene): SpaceEnvironment {
  scene.background = new THREE.Color(SPACE_BG);
  scene.fog = new THREE.FogExp2(SPACE_BG, FOG_DENSITY);
  scene.add(buildStars());
  const grid = buildGrid();
  scene.add(grid);
  const mist = buildMist();
  scene.add(mist.group);
  let t = 0;

  return {
    fit(center, vertRadius, horizRadius) {
      grid.position.set(center.x, center.y - vertRadius - 1.2, center.z);
      // 云雾带：环绕星座的中远景分布（半径 0.5–1.4 × 水平包络）
      for (let i = 0; i < mist.items.length; i++) {
        const m = mist.items[i];
        const ang = hash01(i * 13 + 1) * Math.PI * 2;
        const r = horizRadius * (0.5 + hash01(i * 13 + 2) * 0.9);
        m.base.set(
          center.x + Math.cos(ang) * r,
          center.y + (hash01(i * 13 + 3) - 0.4) * 2 * vertRadius,
          center.z + Math.sin(ang) * r,
        );
        m.sprite.position.copy(m.base);
      }
    },
    update(dt) {
      if (!mist.group.visible) return;
      t += dt;
      for (const m of mist.items) {
        m.sprite.position.set(
          m.base.x + Math.sin(t * m.speed + m.phase) * m.amp,
          m.base.y + Math.sin(t * m.speed * 0.7 + m.phase * 2) * m.amp * 0.5,
          m.base.z + Math.cos(t * m.speed * 0.85 + m.phase) * m.amp,
        );
        const mat = m.sprite.material;
        mat.opacity = m.baseOpacity * (0.7 + 0.3 * Math.sin(t * 0.13 + m.phase * 3));
        mat.rotation += dt * 0.01;
      }
    },
    setMist(on) {
      mist.group.visible = on;
    },
    mistEnabled() {
      return mist.group.visible;
    },
  };
}
