// 016/017 连击系统：游戏式 +N 浮字，规则与录音的真实节奏匹配。
// 判定：相邻 onset 间隔 ≤ 自适应阈值（中位间隔×1.6，夹在 0.25–0.65s）→ 连击延续；
// 显示：≥3 连起弹出，热度分级 蓝(3-5)/橙(6-9)/金(10+)。
// 017 特效（全部零排版开销）：白闪暴击帧 → 倾斜弹出（snappy 过冲）→ 侧向飘移上升 → 金档高频微抖。
import * as THREE from 'three';
import * as troika from 'troika-three-text';

const POOL = 10;
const LIFE = 0.9;
const RISE = 1.15;
const SHOW_FROM = 3;
const GAP_MIN = 0.25;
const GAP_MAX = 0.65;
const GAP_FACTOR = 1.6;
const FLASH = 0.09;       // 出现瞬间的白闪时长（暴击帧）
const TILT_MAX = 0.16;    // 倾斜角（弧度，±）
const DRIFT = 0.45;       // 侧向飘移速度

interface Tier { color: string; size: number; shake: boolean }
function tierOf(count: number): Tier {
  if (count >= 10) return { color: '#FDE047', size: 0.24, shake: true }; // 金：火力全开
  if (count >= 6) return { color: '#F97316', size: 0.19, shake: false }; // 橙：升温
  return { color: '#60A5FA', size: 0.15, shake: false };                 // 蓝：起势
}

/** 确定性伪随机（项目规约：禁 Math.random） */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

interface Popup {
  text: {
    text: string; fontSize: number; color: string;
    fillOpacity: number; outlineWidth: number; outlineColor: string; outlineBlur: number;
    visible: boolean; position: THREE.Vector3; quaternion: THREE.Quaternion;
    scale: THREE.Vector3; sync(): void;
  };
  age: number;
  alive: boolean;
  base: THREE.Vector3;
  tilt: number;
  driftX: number;
  driftZ: number;
  tierColor: string;
  flashed: boolean;
  shake: boolean;
}

export class ComboPopups {
  readonly group = new THREE.Group();
  private readonly pool: Popup[] = [];
  private next = 0;
  private spawnSeq = 0;
  private count = 0;
  private lastOnset = -1;
  private enabled = true;
  private readonly gapThresh: number;
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tiltQ = new THREE.Quaternion();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);

  /** @param medianGap 这段录音的中位音节间隔（秒），连击阈值据此自适应 */
  constructor(medianGap: number) {
    this.gapThresh = Math.min(Math.max(medianGap * GAP_FACTOR, GAP_MIN), GAP_MAX);
    for (let i = 0; i < POOL; i++) {
      const t = new troika.Text();
      t.fontSize = 0.15;
      t.anchorX = 'center';
      t.anchorY = 'middle';
      t.outlineWidth = 0.01;
      t.outlineColor = '#05070d';
      t.visible = false;
      this.group.add(t);
      this.pool.push({
        text: t, age: 0, alive: false, base: new THREE.Vector3(),
        tilt: 0, driftX: 0, driftZ: 0, tierColor: '#fff', flashed: false, shake: false,
      });
    }
  }

  /** 017：开关（设置面板）。关闭时清空在场浮字并断链 */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.reset();
      for (const p of this.pool) {
        p.alive = false;
        p.text.visible = false;
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** 每个音节发声瞬间调用（onset 时间用音节自身的 t，与声音严格对齐） */
  onSyllable(onsetT: number, pos: THREE.Vector3): void {
    if (!this.enabled) return;
    const gap = onsetT - this.lastOnset;
    // gap<0 = 回跳重播，断链重计；gap 超阈 = 停顿断链
    this.count = this.lastOnset >= 0 && gap >= 0 && gap <= this.gapThresh
      ? this.count + 1
      : 1;
    this.lastOnset = onsetT;
    if (this.count >= SHOW_FROM) this.spawn(pos, this.count);
  }

  /** 断链（避免跨停顿误连） */
  reset(): void {
    this.count = 0;
    this.lastOnset = -1;
  }

  private spawn(pos: THREE.Vector3, count: number): void {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % POOL;
    const seq = this.spawnSeq++;
    const tier = tierOf(count);
    p.text.text = `+${count}`;
    p.text.fontSize = tier.size;
    p.text.color = '#FFFFFF'; // 暴击白闪帧，FLASH 后落到档位色
    p.text.outlineBlur = tier.shake ? 0.02 : 0;
    p.text.fillOpacity = 1;
    p.text.visible = true;
    p.base.set(pos.x, pos.y + 0.4, pos.z);
    p.text.position.copy(p.base);
    p.tilt = (hash01(seq * 5 + 1) - 0.5) * 2 * TILT_MAX;
    const ang = hash01(seq * 5 + 2) * Math.PI * 2;
    p.driftX = Math.cos(ang) * DRIFT * 0.5;
    p.driftZ = Math.sin(ang) * DRIFT * 0.5;
    p.tierColor = tier.color;
    p.flashed = false;
    p.shake = tier.shake;
    p.age = 0;
    p.alive = true;
    p.text.sync(); // 仅 spawn 时排版；动画只动 transform/材质 uniform，零 sync
  }

  /** 每帧：弹出过冲 + 侧飘上升 + 白闪落色 + 金档微抖 + billboard 带倾斜 */
  update(dt: number, camera: THREE.Camera): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= LIFE) {
        p.alive = false;
        p.text.visible = false;
        continue;
      }
      const t01 = p.age / LIFE;
      // 暴击帧：前 FLASH 秒纯白，之后落到档位色（材质 uniform，零开销）
      if (!p.flashed && p.age >= FLASH) {
        p.text.color = p.tierColor;
        p.flashed = true;
      }
      // 上升先快后慢 + 侧向飘移；金档前 0.18s 高频微抖
      const ease = 1.6 - t01;
      p.text.position.set(
        p.base.x + p.driftX * p.age + (p.shake && p.age < 0.18 ? Math.sin(p.age * 130) * 0.03 : 0),
        p.base.y + RISE * p.age * ease * 0.7,
        p.base.z + p.driftZ * p.age,
      );
      // snappy 弹出：高过冲快收敛
      p.text.scale.setScalar(1 + 0.9 * Math.exp(-p.age * 14));
      // billboard + 固有倾斜
      this.tiltQ.setFromAxisAngle(this.zAxis, p.tilt);
      this.tmpQ.copy(camera.quaternion).multiply(this.tiltQ);
      p.text.quaternion.copy(this.tmpQ);
      p.text.fillOpacity = t01 < 0.55 ? 1 : 1 - (t01 - 0.55) / 0.45;
    }
  }
}
