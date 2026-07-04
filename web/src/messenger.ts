// 「哨箭」飞行光迹（DEVELOPMENT.md §2.4 修正 / §8.9.1 做法 A）
// 一个 HDR 白热光点，每帧飞向当前最强爆亮音节，拖一条渐隐光尾。
// 头与尾都是 HDR（>1），经 postfx 的 bloom 过曝成流光——这才是「勇度哨箭」的飞行感来源。
import * as THREE from 'three';
import type { FormKey } from './syllableCloud';

const TRAIL_LEN = 30;       // 轨迹采样点数（@60fps ≈ 0.5s 轨迹）
const HEAD_RADIUS = 0.13;   // 略小于音节球 R_MAX(0.28)，呈亮点
const FOLLOW = 14;          // 指数跟随速度：越大越快贴近目标，越慢则高速段拖得越长
const HEAD_HDR = 6.0;       // 头部 HDR 白热强度（> bloom 阈值 1.0）

/** 哨箭头几何随形态变（尾影=头的屏幕残影，须与 SyllableCloud 形态一致） */
function makeHeadGeometry(form: FormKey): THREE.BufferGeometry {
  switch (form) {
    // 细环：管径仅占外径 ~16%（贴近音节环的纤细感），径向/周向高分段去棱角
    case 'ripple': return new THREE.TorusGeometry(HEAD_RADIUS, HEAD_RADIUS * 0.16, 16, 64);
    case 'spire':  return new THREE.CylinderGeometry(HEAD_RADIUS * 0.34, HEAD_RADIUS * 0.34, HEAD_RADIUS * 2.6, 12);
    case 'gem':    return new THREE.OctahedronGeometry(HEAD_RADIUS * 1.15, 0);
    case 'orb':
    case 'planet':
    default:       return new THREE.SphereGeometry(HEAD_RADIUS, 20, 14);
  }
}

export class Messenger {
  readonly group = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly trail: THREE.Line;
  private readonly pos = new THREE.Vector3();
  private readonly history: THREE.Vector3[] = [];
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private initialized = false;
  private currentForm: FormKey = 'orb';

  constructor() {
    // —— 头：自发光小球，无光照靠 emissive 出 HDR 白热 ——
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: new THREE.Color(1, 1, 1),
      emissiveIntensity: HEAD_HDR,
      toneMapped: true,
    });
    this.head = new THREE.Mesh(makeHeadGeometry(this.currentForm), headMat);
    this.head.frustumCulled = false;
    this.group.add(this.head);

    // —— 尾：polyline + 逐顶点 HDR 颜色（Float 不被 clamp），additive 叠加 ——
    const positions = new Float32Array(TRAIL_LEN * 3);
    const colors = new Float32Array(TRAIL_LEN * 3);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    const trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.trail = new THREE.Line(geo, trailMat);
    this.trail.frustumCulled = false;
    this.group.add(this.trail);

    for (let i = 0; i < TRAIL_LEN; i++) this.history.push(new THREE.Vector3());
    this.setVisible(false);
  }

  private setVisible(v: boolean): void {
    this.head.visible = v;
    this.trail.visible = v;
  }

  /** 换数据重建时复位：隐藏并清空轨迹，下次有焦点从该点重新起飞 */
  reset(): void {
    this.initialized = false;
    this.setVisible(false);
  }

  /** 哨箭头几何与当前形态对齐（其屏幕残影即「尾影」，须随形态变） */
  setForm(form: FormKey): void {
    if (form === this.currentForm) return;
    this.currentForm = form;
    this.head.geometry.dispose();
    this.head.geometry = makeHeadGeometry(form);
  }

  /**
   * @param focus 当前最强爆亮音节的世界坐标；null = 当前无活跃焦点（悬停，拖尾收缩）
   */
  update(focus: THREE.Vector3 | null, dt: number): void {
    if (focus) {
      if (!this.initialized) {
        this.pos.copy(focus);
        for (const h of this.history) h.copy(focus);
        this.initialized = true;
        this.setVisible(true);
      }
      this.pos.lerp(focus, 1 - Math.exp(-FOLLOW * dt)); // 帧率无关的指数平滑
    }
    if (!this.initialized) return;

    // 环形滚动：把当前位置插到头部，最旧点回收
    const recycled = this.history.pop() as THREE.Vector3;
    recycled.copy(this.pos);
    this.history.unshift(recycled);

    const p = this.posAttr.array as Float32Array;
    const c = this.colAttr.array as Float32Array;
    for (let i = 0; i < TRAIL_LEN; i++) {
      const h = this.history[i];
      p[i * 3] = h.x; p[i * 3 + 1] = h.y; p[i * 3 + 2] = h.z;
      const f = 1 - i / (TRAIL_LEN - 1);     // 头=1 → 尾=0
      const hdr = f * f * f * HEAD_HDR;       // 立方衰减：尾巴细长发暗，更像流光
      c[i * 3] = hdr; c[i * 3 + 1] = hdr; c[i * 3 + 2] = hdr;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.head.position.copy(this.pos);
  }
}
