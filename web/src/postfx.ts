// 后期链：流光拖尾 + 选择性辉光 + DOF + SMAA + 色调映射 + 降级阶梯
// 规格：spec cinematic-fx / playback-flare；HDR 契约见 design/visual-mapping.md §6
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, Pass, Effect,
  BloomEffect, SMAAEffect, VignetteEffect,
  ToneMappingEffect, ToneMappingMode, BlendFunction,
} from 'postprocessing';
import type { FormKey } from './syllableCloud';

// 尾影（流光拖尾）按形态差异化：damp 控长度（每帧历史衰减系数，越低越短）、
// threshold 控数量（亮度超此值的爆亮才拖尾，越高越少）。
// 整体较旧值（damp 0.85 / thr 3.0）收敛，避免颤音密集段尾影过长过多；
// 细长/环状形态尾影更短更少（涂抹感更明显），大球形态适中。
const TRAIL_BY_FORM: Record<FormKey, { damp: number; threshold: number }> = {
  orb:    { damp: 0.78, threshold: 3.6 },
  spire:  { damp: 0.70, threshold: 4.4 }, // 细长柱 → 短而少
  ripple: { damp: 0.72, threshold: 4.2 }, // 环状 → 弱尾
  gem:    { damp: 0.76, threshold: 3.8 },
  planet: { damp: 0.78, threshold: 3.6 }, // 同 orb
};
const TRAIL_DEFAULT = TRAIL_BY_FORM.orb;

/**
 * 流光拖尾（playback-flare 做法 B，BV-pf-06）：
 * 仅对亮度 ≥1.0 的 HDR 像素（即爆亮）做衰减累积——流光保留、
 * 普通场景零残影（保证运动中画面锐利）。置于 bloom 之前，拖尾被辉光过曝成流光。
 */
class TrailPass extends Pass {
  private historyA: THREE.WebGLRenderTarget;
  private historyB: THREE.WebGLRenderTarget;

  constructor() {
    super('TrailPass');
    this.fullscreenMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tNew: { value: null },
        tOld: { value: null },
        damp: { value: TRAIL_DEFAULT.damp },
        lumThreshold: { value: TRAIL_DEFAULT.threshold },
        writeHistory: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tNew;
        uniform sampler2D tOld;
        uniform float damp;
        uniform float lumThreshold;
        uniform float writeHistory;
        varying vec2 vUv;
        void main() {
          vec4 n = texture2D(tNew, vUv);
          vec4 o = texture2D(tOld, vUv) * damp;
          float lum = max(n.r, max(n.g, n.b));
          float brightMask = smoothstep(lumThreshold - 0.35, lumThreshold + 0.15, lum);
          vec4 bright = n * brightMask;
          vec4 hist = max(bright, o);                // 历史缓冲：纯流光轨迹
          vec4 composite = max(n, o);                // 输出：场景 + 流光
          gl_FragColor = mix(composite, hist, writeHistory);
        }`,
      depthWrite: false,
      depthTest: false,
    });
    const mk = () =>
      new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType, // HDR 拖尾，供下游 bloom 阈值使用
        depthBuffer: false,
      });
    this.historyA = mk();
    this.historyB = mk();
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    const u = (this.fullscreenMaterial as THREE.ShaderMaterial).uniforms;
    u.tNew.value = inputBuffer.texture;
    u.tOld.value = this.historyA.texture;
    u.writeHistory.value = 1;
    renderer.setRenderTarget(this.historyB);
    renderer.render(this.scene, this.camera);
    u.writeHistory.value = 0;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
    const tmp = this.historyA;
    this.historyA = this.historyB;
    this.historyB = tmp;
  }

  override setSize(width: number, height: number): void {
    this.historyA.setSize(width, height);
    this.historyB.setSize(width, height);
  }

  /** 按当前形态切换尾影长度/数量（damp/threshold） */
  setTrail(form: FormKey): void {
    const cfg = TRAIL_BY_FORM[form] ?? TRAIL_DEFAULT;
    const u = (this.fullscreenMaterial as THREE.ShaderMaterial).uniforms;
    u.damp.value = cfg.damp;
    u.lumThreshold.value = cfg.threshold;
  }
}

export interface PostFX {
  composer: EffectComposer;
  bloom: BloomEffect;
  setSize(w: number, h: number): void;
  /** 按形态切换尾影参数（playback-flare 做法 B 的差异化调参） */
  setTrail(form: FormKey): void;
}

export function createPostFX(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostFX {
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType, // BV-fx-01：HDR 必需
  });
  composer.addPass(new RenderPass(scene, camera));
  const trail = new TrailPass();
  composer.addPass(trail);

  // 005 光体版：基态 emissive 1.15 略过阈值 → 全员霓虹微光；爆亮 6.65 仍是绝对主角
  const bloom = new BloomEffect({
    luminanceThreshold: 1.0,
    luminanceSmoothing: 0.2,
    intensity: 1.15,
    mipmapBlur: true,
  });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.62 }); // 轻微暗角收边

  // BV-fx-03：效果合并进单个 EffectPass。
  // SMAA 仅在低 dpr 启用——高分屏下几何边缘本已锐利，SMAA 反而软化画面。
  const effects: Effect[] = [bloom, tone, vignette];
  if (renderer.getPixelRatio() < 1.5) effects.push(new SMAAEffect());
  composer.addPass(new EffectPass(camera, ...effects));

  return {
    composer,
    bloom,
    setSize: (w, h) => composer.setSize(w, h),
    setTrail: (form) => trail.setTrail(form),
  };
}

/**
 * 降级阶梯（BV-fx-04，004 起无 DOF）：连续 60 帧均值 >33ms 依次触发
 * dpr 1.5 → dpr 1 → bloom 减半 → 关 bloom；每步 console.info 留痕。
 */
export class AutoDegrade {
  private samples: number[] = [];
  private cooldown = 0;
  private step = 0;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly fx: PostFX;

  constructor(renderer: THREE.WebGLRenderer, fx: PostFX) {
    this.renderer = renderer;
    this.fx = fx;
  }

  tick(dtMs: number): void {
    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }
    this.samples.push(dtMs);
    if (this.samples.length < 60) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.samples.length = 0;
    if (avg <= 33.4 || this.step >= 4) return;

    this.step++;
    this.cooldown = 120;
    switch (this.step) {
      case 1:
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        break;
      case 2:
        this.renderer.setPixelRatio(1);
        break;
      case 3:
        this.fx.bloom.intensity *= 0.5;
        break;
      case 4:
        this.fx.bloom.blendMode.setBlendFunction(BlendFunction.SKIP);
        break;
    }
    console.info(`[AutoDegrade] step ${this.step} (avg frame ${avg.toFixed(1)}ms)`);
  }
}
