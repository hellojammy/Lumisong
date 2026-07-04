import * as THREE from 'three';
import {
  RHYTHM_BAND_COUNT, type RhythmAnalysis, sampleRhythmBands, sampleRhythmFlux,
} from './rhythmBands';

const GROUND_GRID = 144;
const FLOOR_SIZE = 96;
/** 与 environment.ts 格网下沉量一致 */
const GRID_GAP_BELOW_CLOUD = 1.2;
/** 地形紧贴格网下方略沉，保证在画面最底可见，且仍在音符层之下 */
const FLOOR_GAP_BELOW_GRID = 0.55;
const RIPPLE_SLOTS = 8;
const FLUX_THRESHOLD = 0.16;   // 谱通量超此值且上升 → 打一个涟漪
const RIPPLE_COOLDOWN = 0.11;  // 涟漪最小间隔（秒，挡住连击刷屏）
const TAU = Math.PI * 2;
const tmpObject = new THREE.Object3D();

// 2D simplex 噪声（移植自参考 sonic-topography），用于有机"海面"起伏与频段位移
const SIMPLEX_GLSL = `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0; vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox; m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
`;

const vertexShader = `
  uniform float uTime;
  uniform float uBands[8];
  uniform float uEnergy;
  uniform float uMaxHeight;
  uniform float uRadius;
  uniform vec2 uRipplePos[8];
  uniform float uRippleBirth[8];
  uniform float uRippleStrength[8];
  uniform float uRippleSpeed;
  uniform float uRippleWidth;
  uniform float uRippleFade;
  uniform float uRippleLift;

  varying float vElevation;
  varying float vDistance;
  varying float vWarmth;
  varying float vBrightness;
  varying float vRelativeY;
  varying float vRipple;
  varying float vScatter;
  varying vec2 vUv;
  varying vec2 vCell;
  varying vec3 vNormal;

  ${SIMPLEX_GLSL}

  void main() {
    vUv = uv;
    vNormal = normal;
    vRelativeY = position.y + 0.5;

    vec4 instanceOrigin = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec2 p = instanceOrigin.xz;
    vCell = p;
    float dist = length(p);
    vDistance = dist;
    float nd = clamp(dist / max(0.001, uRadius), 0.0, 1.0);
    float edgeFade = 1.0 - smoothstep(0.82, 1.0, nd); // 仅边缘淡出，不做中心火山岛
    float rnd = hash2(floor(p * 1.0));

    // 有机 idle：极微起伏，整片铺底
    vec2 mp = p * 0.06 + vec2(uTime * 0.08, uTime * 0.05);
    float idleElevation = (snoise(mp) + 1.0) * 0.5 * 0.12 * edgeFade;

    // 频段抬升：均匀铺在底面，不往中心聚
    float subLift = uBands[0] * 0.55;
    float bassN = snoise(p * 0.08 - vec2(0.0, uTime * 0.15));
    float bassLift = uBands[1] * (0.45 + bassN * 0.2 + rnd * 0.15) * 0.55;
    float lowMidN = snoise(p * 0.05 + vec2(uTime * 0.1, 0.0));
    float lowMidLift = uBands[2] * (lowMidN * 0.5 + 0.5) * 0.42;
    float riverFlow = sin((p.x + p.y) * 0.16 + snoise(p * 0.08) * 2.2 - uTime * 1.1);
    float midLift = uBands[3] * max(0.0, riverFlow) * 0.38;
    float island = (subLift + bassLift + lowMidLift + midLift) * edgeFade;

    // 外圈散块：压低高度，避免从底面戳出
    float ring = smoothstep(0.35, 1.0, nd);
    float ringFade = 1.0 - smoothstep(0.96, 1.06, nd);
    float scatter = step(0.88, fract(rnd * 13.3)) * ring * ringFade
      * (uBands[4] + uBands[5] * 0.7) * (0.25 + fract(rnd * 7.7) * 0.35);
    float twinkleCube = step(0.95, fract(rnd * 53.0)) * ring * ringFade * (uBands[6] + uBands[7]) * 0.22;

    float elevation = idleElevation + island + scatter + twinkleCube;
    elevation += uEnergy * step(0.985, fract(rnd * 97.0)) * 0.35 * edgeFade;
    vScatter = clamp((scatter + twinkleCube) * 2.0, 0.0, 1.0);

    // 扩散涟漪环：每个活跃 ripple 贡献一圈高斯波峰随时间外扩、随距离衰减
    float rippleElev = 0.0;
    float rippleGlow = 0.0;
    for (int i = 0; i < 8; i++) {
      float strength = uRippleStrength[i];
      float age = uTime - uRippleBirth[i];
      if (strength > 0.001 && age >= 0.0) {
        float wr = age * uRippleSpeed;
        float d = length(p - uRipplePos[i]) - wr;
        float wave = exp(-d * d / uRippleWidth);
        float fade = exp(-wr / uRippleFade);
        float pulse = wave * fade * strength;
        rippleElev += pulse;
        rippleGlow += pulse;
      }
    }
    elevation += rippleElev * uRippleLift * edgeFade;
    vRipple = clamp(rippleGlow, 0.0, 1.0);

    elevation = min(elevation, 0.45);
    vElevation = elevation;
    vWarmth = clamp((uBands[0] + uBands[1] + uBands[2] + uBands[3]) / max(0.001, uEnergy * 4.0), 0.0, 1.0);
    vBrightness = clamp((uBands[5] + uBands[6] + uBands[7]) / max(0.001, uEnergy * 3.0), 0.0, 1.0);

    vec3 pos = position;
    float totalHeight = 0.05 + elevation * uMaxHeight;
    pos.y = -0.5 + vRelativeY * totalHeight;
    vec4 worldPosition = instanceMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform float uRadius;
  varying float vElevation;
  varying float vDistance;
  varying float vWarmth;
  varying float vBrightness;
  varying float vRelativeY;
  varying float vRipple;
  varying float vScatter;
  varying vec2 vUv;
  varying vec2 vCell;
  varying vec3 vNormal;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  // ⚠️ 根治 bloom 过曝：钳到完全低于 bloom 拐点(threshold 1.0 - smoothing 0.2 = 0.8)，地形永不喂 bloom、不炸白
  const float MAX_LUM = 0.78;

  void main() {
    // 暖色火山岛调色板：暖金心 → 橙红边 / 暗红底；冷青仅给散落小方块（钳制保色相，只压亮度）
    vec3 baseLow  = vec3(0.020, 0.012, 0.012);
    vec3 baseHigh = vec3(0.070, 0.032, 0.022);
    vec3 warmCore = vec3(1.00, 0.60, 0.16);   // 暖金
    vec3 warmMid  = vec3(0.95, 0.34, 0.09);   // 橙红
    vec3 warmEdge = vec3(0.66, 0.22, 0.10);   // 红（提亮，避免发棕）
    vec3 coolSpark = vec3(0.55, 0.92, 1.0);   // 青白散块

    float nd = clamp(vDistance / max(0.001, uRadius), 0.0, 1.0);
    float rnd = hash(vCell);
    float normElev = clamp(vElevation / 2.4, 0.0, 1.0);

    // 暖色：中心金、向外橙红→暗红（径向 + 高度）；给个暖底避免发棕
    float warmT = clamp(0.22 + (1.0 - nd) * 0.6 + normElev * 0.5, 0.0, 1.0);
    vec3 warm = mix(warmEdge, warmMid, smoothstep(0.0, 0.55, warmT));
    warm = mix(warm, warmCore, smoothstep(0.5, 1.0, warmT));
    warm = mix(warm, mix(warm, vec3(0.95, 0.82, 0.55), 0.6), vBrightness * 0.4); // 高频微提亮

    // 散落小方块走青白
    vec3 glow = mix(warm, coolSpark, vScatter);

    // 体素面光影：顶面最亮、侧面按朝向衰减（假定向光）
    float faceLight = 0.5 + 0.5 * max(vNormal.y, 0.0);
    faceLight += 0.14 * vNormal.x + 0.07 * vNormal.z;
    faceLight = clamp(faceLight, 0.32, 1.0);

    float distFade = 1.0 - smoothstep(uRadius * 0.5, uRadius * 1.0, vDistance);

    bool isTop = vNormal.y > 0.5;
    float distFromTop = 1.0 - vRelativeY;
    vec3 body = mix(baseLow, baseHigh, vRelativeY);
    vec3 color;

    if (isTop) {
      float topI = smoothstep(0.0, 0.4, normElev) + vScatter;
      color = mix(baseHigh, glow, clamp(topI, 0.0, 1.0));
      float edgeX = smoothstep(0.07, 0.02, vUv.x) + smoothstep(0.93, 0.98, vUv.x);
      float edgeY = smoothstep(0.07, 0.02, vUv.y) + smoothstep(0.93, 0.98, vUv.y);
      float edge = min(edgeX + edgeY, 1.0);
      color += glow * edge * 0.5 * (topI + 0.25);
    } else {
      float sideGlow = smoothstep(0.55, 0.0, distFromTop) * (normElev + vScatter);
      color = mix(body, glow, clamp(sideGlow, 0.0, 1.0));
    }

    color *= faceLight;

    // 涟漪：波峰处微微压向青、形成扫过的浅色环（克制，不抢戏）
    color = mix(color, coolSpark, vRipple * 0.35);

    color *= 0.55 + distFade * 0.95;

    // 钳制亮度：保证地形不喂 bloom（不炸白），暖色可辨
    float lum = max(color.r, max(color.g, color.b));
    if (lum > MAX_LUM) color *= MAX_LUM / lum;

    // 底部频谱带：可见但不抢音符
    float alpha = (0.09 + normElev * 0.52 + vScatter * 0.32 + vRipple * 0.24) * distFade;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`;

export class RhythmFloor {
  // 普通主场景对象：把 group 加进主 scene，随主相机 orbit/zoom（不再独立视口渲染）
  readonly group = new THREE.Group();

  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly smoothBands = new Array(RHYTHM_BAND_COUNT).fill(0);
  private idleTime = 0;
  private size = FLOOR_SIZE;
  private maxHeight = 1.0;
  private readonly analysis: RhythmAnalysis;

  // 涟漪环形缓冲 + 打点状态
  private readonly ripplePos: THREE.Vector2[] = [];
  private readonly rippleBirth: number[] = new Array(RIPPLE_SLOTS).fill(-1000);
  private readonly rippleStrength: number[] = new Array(RIPPLE_SLOTS).fill(0);
  private rippleHead = 0;
  private prevFlux = 0;
  private lastRippleTime = -1000;
  private spawnSeed = 1;

  constructor(analysis: RhythmAnalysis) {
    this.analysis = analysis;
    for (let i = 0; i < RIPPLE_SLOTS; i++) this.ripplePos.push(new THREE.Vector2());
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false, // 远距雾会把最底频谱带吃掉，须关闭
      uniforms: {
        uTime: { value: 0 },
        uBands: { value: new Array(RHYTHM_BAND_COUNT).fill(0) },
        uEnergy: { value: 0 },
        uMaxHeight: { value: this.maxHeight },
        uRadius: { value: this.size * 0.46 },
        uRipplePos: { value: this.ripplePos },
        uRippleBirth: { value: this.rippleBirth },
        uRippleStrength: { value: this.rippleStrength },
        uRippleSpeed: { value: 1 },
        uRippleWidth: { value: 1 },
        uRippleFade: { value: 1 },
        uRippleLift: { value: 0.18 },
      },
    });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, GROUND_GRID * GROUND_GRID);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -2; // 先于音符绘制，读作底部地面
    this.group.add(this.mesh);
    this.group.name = 'RhythmFloor';
    this.applyRippleScale();
    this.rebuildInstances();
  }

  fit(center: THREE.Vector3, vertRadius: number, horizRadius: number): void {
    // 底部频谱带：格网正下方、极扁宽铺，纵向顺序 音符 → 格网 → 地形
    this.size = Math.max(34, Math.min(84, horizRadius * 4.0));
    this.maxHeight = Math.max(0.08, Math.min(0.14, vertRadius * 0.04));
    const cloudBottom = center.y - vertRadius;
    const gridY = cloudBottom - GRID_GAP_BELOW_CLOUD;
    this.group.position.set(center.x, gridY - FLOOR_GAP_BELOW_GRID, center.z);
    this.group.scale.set(1, 0.5, 1);
    this.material.uniforms.uMaxHeight.value = this.maxHeight;
    this.material.uniforms.uRadius.value = this.size * 0.46;
    this.applyRippleScale();
    this.rebuildInstances();
  }

  update(time: number, dt: number, active: boolean): void {
    // 暂停同步：非播放态完全冻结（不推进 idle 动画、不改 bands），地形静止
    if (!active) return;
    this.idleTime += dt;
    const sourceBands = sampleRhythmBands(this.analysis, time);
    const response = 0.15;
    let energy = 0;
    for (let i = 0; i < RHYTHM_BAND_COUNT; i++) {
      this.smoothBands[i] += (sourceBands[i] - this.smoothBands[i]) * response;
      energy += this.smoothBands[i];
    }
    energy /= RHYTHM_BAND_COUNT;

    // 涟漪打点：谱通量峰值（上升沿 + 阈值 + 冷却）触发一圈扩散波
    const flux = sampleRhythmFlux(this.analysis, time);
    if (flux > FLUX_THRESHOLD && flux > this.prevFlux
      && this.idleTime - this.lastRippleTime > RIPPLE_COOLDOWN) {
      this.spawnRipple(flux);
      this.lastRippleTime = this.idleTime;
    }
    this.prevFlux = flux;

    this.material.uniforms.uTime.value = this.idleTime;
    this.material.uniforms.uBands.value = this.smoothBands;
    this.material.uniforms.uEnergy.value = energy;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  /** 涟漪传播参数随地板尺寸缩放（速度/宽度/衰减都按 size 归一） */
  private applyRippleScale(): void {
    const r = this.size;
    this.material.uniforms.uRippleSpeed.value = r * 0.50;          // 单位/秒
    this.material.uniforms.uRippleWidth.value = (r * 0.040) ** 2;  // 高斯分母（距离²）
    this.material.uniforms.uRippleFade.value = r * 0.50;           // 半幅衰减距离
  }

  /** 打一个涟漪：低频重时靠近中心，否则随机半径；确定性伪随机定方位 */
  private spawnRipple(flux: number): void {
    const idx = this.rippleHead;
    this.rippleHead = (this.rippleHead + 1) % RIPPLE_SLOTS;
    this.spawnSeed = (this.spawnSeed * 9301 + 49297) % 233280;
    const u = this.spawnSeed / 233280;
    const bass = this.smoothBands[0] + this.smoothBands[1];
    const mids = this.smoothBands[2] + this.smoothBands[3] + this.smoothBands[4];
    const central = bass > mids;
    const radius = central ? this.size * 0.04 : this.size * (0.12 + u * 0.34);
    const angle = u * TAU;
    this.ripplePos[idx].set(Math.cos(angle) * radius, Math.sin(angle) * radius);
    this.rippleBirth[idx] = this.idleTime;
    this.rippleStrength[idx] = Math.min(0.25 + flux * 0.8, 0.85);
  }

  private rebuildInstances(): void {
    const spacing = this.size / GROUND_GRID;
    const offset = (GROUND_GRID - 1) * spacing * 0.5;
    let index = 0;
    for (let x = 0; x < GROUND_GRID; x++) {
      for (let z = 0; z < GROUND_GRID; z++) {
        tmpObject.position.set(x * spacing - offset, 0.025, z * spacing - offset);
        tmpObject.scale.set(spacing * 0.62, 1, spacing * 0.62);
        tmpObject.updateMatrix();
        this.mesh.setMatrixAt(index, tmpObject.matrix);
        index++;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
