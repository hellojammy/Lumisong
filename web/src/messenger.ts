// 「哨箭」飞行光迹（DEVELOPMENT.md §2.4 修正 / §8.9.1 做法 A）
// 一个 HDR 光点，每帧飞向当前最强爆亮音节，拖一条渐隐光尾。
// 头与尾都是 HDR（>1），经 postfx 的 bloom 过曝成流光——这才是「勇度哨箭」的飞行感来源。
import * as THREE from 'three';
import type { FormKey } from './syllableCloud';
import { createMessengerHeadGeometry } from './visualProfiles';

const TRAIL_LEN = 36;       // 45fps 下稍加长采样，尾迹更连贯（克制：不加粗线宽）
const FOLLOW = 14;          // 指数跟随速度：越大越快贴近目标，越慢则高速段拖得越长
const HEAD_HDR = 6.0;       // 头部 HDR 强度（> bloom 阈值 1.0）

export class Messenger {
  readonly group = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly trail: THREE.Line;
  private readonly headMat: THREE.MeshStandardMaterial;
  private readonly pos = new THREE.Vector3();
  private readonly history: THREE.Vector3[] = [];
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly trailTint = new THREE.Color(1, 1, 1);
  private initialized = false;
  private currentForm: FormKey = 'orb';

  constructor() {
    this.headMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: new THREE.Color(1, 1, 1),
      emissiveIntensity: HEAD_HDR,
      toneMapped: true,
    });
    this.head = new THREE.Mesh(createMessengerHeadGeometry(this.currentForm), this.headMat);
    this.head.frustumCulled = false;
    this.group.add(this.head);

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

  reset(): void {
    this.initialized = false;
    this.setVisible(false);
  }

  setForm(form: FormKey): void {
    if (form === this.currentForm) return;
    this.currentForm = form;
    this.head.geometry.dispose();
    this.head.geometry = createMessengerHeadGeometry(form);
  }

  /**
   * @param focus 当前最强爆亮音节的世界坐标；null = 悬停
   * @param tint 焦点音节本色（B2：尾迹/头部微染色，仍保持克制 HDR）
   */
  update(focus: THREE.Vector3 | null, dt: number, tint?: THREE.Color | null): void {
    if (tint) {
      this.trailTint.copy(tint);
      this.headMat.emissive.copy(tint).lerp(new THREE.Color(1, 1, 1), 0.35);
    } else {
      this.trailTint.set(1, 1, 1);
      this.headMat.emissive.set(1, 1, 1);
    }
    if (focus) {
      if (!this.initialized) {
        this.pos.copy(focus);
        for (const h of this.history) h.copy(focus);
        this.initialized = true;
        this.setVisible(true);
      }
      this.pos.lerp(focus, 1 - Math.exp(-FOLLOW * dt));
    }
    if (!this.initialized) return;

    const recycled = this.history.pop() as THREE.Vector3;
    recycled.copy(this.pos);
    this.history.unshift(recycled);

    const p = this.posAttr.array as Float32Array;
    const c = this.colAttr.array as Float32Array;
    for (let i = 0; i < TRAIL_LEN; i++) {
      const h = this.history[i];
      p[i * 3] = h.x; p[i * 3 + 1] = h.y; p[i * 3 + 2] = h.z;
      const f = 1 - i / (TRAIL_LEN - 1);
      const hdr = f * f * f * HEAD_HDR;
      c[i * 3] = this.trailTint.r * hdr;
      c[i * 3 + 1] = this.trailTint.g * hdr;
      c[i * 3 + 2] = this.trailTint.b * hdr;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.head.position.copy(this.pos);
  }
}
