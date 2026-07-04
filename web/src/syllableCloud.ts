// 球云 + 连线 + 标签 + 爆亮更新（spec constellation-view / playback-flare）
// 007 分层玻璃球：外层着色玻璃壳 + 内层发光核（光体），核形态按音调性分化——
// 纯音=光滑球核、噪音=多面晶核；每颗带确定性椭球比例与朝向，打破「完美圆」的单调。
import * as THREE from 'three';
import { InstancedUniformsMesh } from 'three-instanced-uniforms-mesh';
import * as troika from 'troika-three-text';
import { norm, type SyllablesJson, type SyllableData } from './data';
import { sampleColormap } from './colormap';
import { layoutPosition } from './layout';
import {
  flare, FLARE_WINDOW, EMISSIVE_BASE, EMISSIVE_GAIN, SCALE_GAIN,
  EMISSIVE_UNPLAYED, SHELL_UNPLAYED, SCALE_UNPLAYED,
} from './envelope';
import { playbackFillDuration } from './visualTiming';
import { buildFormMeshes, NOISY_FLATNESS, type CoreRef } from './formBuilders';

export const R_MIN = 0.06;
export const R_MAX = 0.28;
const LABEL_COUNT = 40;
const LABEL_BASE_SIZE = 0.072; // 012：弱化标签——比球小一档，静息时只是注脚
const LABEL_FLARE_GAIN = 1.4;  // 爆亮时放大到可读（弱化静息态的补偿）
const LABEL_BASE_OPACITY = 0.55;
const LABEL_SYNC_EPS = 0.05; // 字号相对变化 >5% 才写（troika 排版是异步 worker）
const ANISO = 0.12;          // 椭球比例抖动幅度（±12%）

interface LabelEntry {
  text: {
    fontSize: number;
    fillOpacity: number;
    sync(): void;
  };
  lastSize: number;
}

// —— 015/018 展示形态系统：同一数据语义，多种几何表达 ——
export type FormKey = 'orb' | 'spire' | 'ripple' | 'gem' | 'planet';
export const FORMS: { key: FormKey; label: string }[] = [
  { key: 'orb', label: '玻璃球' },
  { key: 'spire', label: '光针' },   // 长度 = 时长 dur（棒棒糖字形，启用未用通道）
  { key: 'ripple', label: '涟漪' },  // 水平光环，半径 = 响度（声=涟漪隐喻）
  { key: 'gem', label: '晶钻' },     // 018：竖向拉伸八面体碎钻，随机倾角
  { key: 'planet', label: '星环' },  // 018：球核 + 随机倾斜光环（微型土星）
];
// 018 填充动效：播放态用快速贴合，录音态保留慢生长语义（爆亮脉冲保持瞬时=打击感）
const REC_FILL_FACTOR = 0.8;   // rec fillDur = 到上一声的间隔 × 此系数
const REC_FILL_MIN = 0.12;     // 连射段最快也要可感知
const REC_FILL_MAX = 0.9;      // 须 ≤ FLARE_WINDOW，保证离开活跃窗口前完成填充
const REC_FILL_DEFAULT = 0.3; // 022 录音态首颗（无上一间隔可参考）的默认渐入时长
const LINE_PULSE_GAIN = 1.2;  // 022 录音态新连线段诞生时的高亮峰值增益（按 flare 衰减回 1）

// 020 可选特效（设置开关，默认关）
const FADE_DELAY = 2;      // 渐隐：发声后停留时长（「记忆拖尾」长度）
const FADE_DUR = 1.8;      // 渐隐：淡出耗时
const FADE_FLOOR = 0;      // 渐隐终点：已播音符彻底淡尽，不留残点
const BREATH_AMP = 0.22;   // 呼吸：发光振幅 ±22%（021 增强；峰值过辉光阈值=微辉光脉动）
const BREATH_FREQ = 2.4;   // 呼吸：角频率（周期 ≈ 2.6s）
const FINALE_APPEAR = 0.85;   // 谢幕：全体浮现耗时
const FINALE_HOLD = 0.35;     // 谢幕：高亮悬停
const FINALE_DISSOLVE = 1.6;  // 021 谢幕：粒子消散耗时（取代一帧瞬灭）
const FINALE_RESET = FINALE_APPEAR + FINALE_HOLD + FINALE_DISSOLVE + 0.4;
const DUST_PER = 2;           // 021：每音节的消散光尘数
const SPIRE_THICK = 0.6;   // 光针粗细 = baseRadius × 此系数（细针在幽灵态像素太少，须偏粗）
const SPIRE_LEN_MIN = 0.5;
const SPIRE_LEN_MAX = 2.2;
const RIPPLE_SCALE = 2.2;  // 涟漪环半径 = baseRadius × 此系数

/** 确定性伪随机（项目规约：禁 Math.random） */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class SyllableCloud {
  readonly group = new THREE.Group();
  readonly center = new THREE.Vector3();
  boundingRadius = 5;
  // 取景用：绕 Y 轴旋转时的水平包络半径 / 垂直半径（点云 X 向细长，需各向异性 fit）
  horizRadius = 5;
  vertRadius = 5;
  // 当前最强爆亮音节的位置（驱动 messenger 飞行光迹）；hasFocus 为 false 时无活跃焦点
  readonly focus = new THREE.Vector3();
  /** 当前焦点音节本色（供哨箭尾迹继承，B2） */
  readonly focusColor = new THREE.Color(1, 1, 1);
  hasFocus = false;
  // 022 录音态焦点：最近一颗 append 球的位置（无 playback flare，供录音运镜跟随生长）
  readonly recFocus = new THREE.Vector3();
  /** 录音态最新球本色（哨箭染色） */
  readonly recFocusColor = new THREE.Color(1, 1, 1);
  hasRecFocus = false;
  // 016：音节发声瞬间回调（连击系统消费）；medianGap = 中位音节间隔（连击阈值自适应依据）
  onSyllableStart: ((i: number, onsetT: number, pos: THREE.Vector3) => void) | null = null;
  readonly medianGap: number;

  private readonly form: FormKey;
  private shell: THREE.InstancedMesh | null = null; // 玻璃壳（orb + 非 orb 轻量壳 C4）
  private ring: InstancedUniformsMesh<THREE.MeshStandardMaterial> | null = null; // 仅 planet 形态
  private readonly instMeshes: InstancedUniformsMesh<THREE.MeshStandardMaterial>[] = [];
  private readonly coreOf: CoreRef[] = []; // 每音节的 emissive/矩阵路由（各形态通用）
  private stemLen: Float32Array; // spire：长度=时长
  private fillDur: Float32Array; // 018：每音节的填充时长（节奏自适应）
  private readonly positions: THREE.Vector3[] = [];
  private readonly colors: THREE.Color[] = [];
  private baseRadius: Float32Array;
  private readonly quats: THREE.Quaternion[] = [];
  private readonly aniso: THREE.Vector3[] = [];
  private readonly ts: number[];
  // 022 录音流式模式：capacity>0 表示预分配 capacity 个实例槽、单核 orb、增量 append；
  // count = 当前逻辑可见音节数（≤ capacity）。上传/默认路径 capacity=0，行为不变。
  private readonly capacity: number;
  private count: number;
  // 022 录音态浮现：每颗新球记录出现挂钟时刻与自适应浮现时长（用上一间隔预测）；
  // recAppearWall[i] = 该球 append 时的挂钟，recFillDur[i] = 渐入耗时；recLastOnset 记上一 onset 绝对时间。
  private recAppearWall: Float32Array | null = null;
  private recFillDur: Float32Array | null = null;
  private recLastOnset = -1;
  private recWall = 0; // 录音态挂钟（驱动浮现进度）
  // 录音模式：连线缓冲按 capacity 预分配，append 时只移动 drawRange，不重建几何
  private linePts: Float32Array | null = null;
  private lineDist: Float32Array | null = null;
  // 录音模式：solid/dashed 共享的两条 LineSegments，用于 append 后更新 boundingSphere
  private solidLine: THREE.LineSegments | null = null;
  private dashedLine: THREE.LineSegments | null = null;
  private batchedText: (THREE.Object3D & { sync(): void }) | null = null;
  private readonly labels = new Map<number, LabelEntry>();
  private active = new Set<number>();
  private nowCache = 0; // 013：渐进点亮的时间基准（writeEmissive 据此判断已播/未播）
  // 020 特效状态
  private fxFade = false;
  private fxBreath = false;
  private wallT = 0;         // 挂钟（呼吸/谢幕驱动，暂停也走）
  private finaleStart = -1;  // ≥0 表示谢幕动画进行中（挂钟时刻）
  private finaleLineK = 1;   // 021：谢幕期间连线亮度系数
  private dust: THREE.Points | null = null;       // 021：谢幕消散光尘（懒建）
  private dustVel: Float32Array | null = null;    // 光尘速度（确定性）
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();
  private lineColors: THREE.BufferAttribute | null = null;
  private lineSolidGeo: THREE.BufferGeometry | null = null;
  private lineDashedGeo: THREE.BufferGeometry | null = null;

  private readonly data: SyllablesJson;

  constructor(data: SyllablesJson, form: FormKey = 'orb', capacity = 0) {
    this.data = data;
    // 022：录音流式模式强制单核 orb（无法预知 noisy/smooth 比例，不做形态分化）
    this.form = capacity > 0 ? 'orb' : form;
    form = this.form;
    const { meta, syllables } = data;
    const n = syllables.length;
    this.capacity = capacity;
    this.count = n;
    // 实例与并行数组按容量分配（录音模式 = capacity，否则 = n）
    const cap = capacity > 0 ? capacity : n;
    this.baseRadius = new Float32Array(cap);
    this.stemLen = new Float32Array(cap);
    this.ts = syllables.map((s) => s.t);
    const gaps = this.ts.slice(1).map((t, k) => t - this.ts[k]).sort((a, b) => a - b);
    this.medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0.3;
    // 018：填充时长 = 到下一声的间隔×系数（最后一声用中位间隔），连射快凝固、舒缓慢成型
    this.fillDur = new Float32Array(cap);
    for (let i = 0; i < n; i++) {
      const gap = i < n - 1 ? this.ts[i + 1] - this.ts[i] : this.medianGap;
      this.fillDur[i] = playbackFillDuration(gap);
    }

    if (capacity > 0) {
      this.recAppearWall = new Float32Array(cap).fill(-1);
      this.recFillDur = new Float32Array(cap).fill(REC_FILL_DEFAULT);
    }

    const built = buildFormMeshes({
      form,
      capacity,
      n,
      syllables,
      isNoisy: (i) => norm(syllables[i].flatness, meta.ranges.flatness) > NOISY_FLATNESS,
    });
    this.shell = built.shell;
    this.ring = built.ring;
    this.instMeshes.push(...built.instMeshes);
    const routeNext = built.routeNext;
    built.addTo(this.group);

    const flatQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const bbox = new THREE.Box3();
    const color = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const s = syllables[i];
      const pos = layoutPosition(s, meta, new THREE.Vector3());
      this.positions.push(pos);
      bbox.expandByPoint(pos);
      this.baseRadius[i] = R_MIN + norm(s.rms, meta.ranges.rms) * (R_MAX - R_MIN);
      this.stemLen[i] = SPIRE_LEN_MIN
        + norm(s.dur, meta.ranges.durSec) * (SPIRE_LEN_MAX - SPIRE_LEN_MIN);

      // 朝向/比例按形态：orb/gem/planet=随机朝向；spire=竖直；ripple=水平
      if (form === 'orb' || form === 'gem' || form === 'planet') {
        this.quats.push(new THREE.Quaternion().setFromEuler(new THREE.Euler(
          hash01(i * 7 + 1) * Math.PI * 2,
          hash01(i * 7 + 2) * Math.PI * 2,
          hash01(i * 7 + 3) * Math.PI * 2,
        )));
        this.aniso.push(form === 'gem'
          ? new THREE.Vector3(1, 1.55, 1) // 碎钻：竖向拉伸再随机旋转
          : form === 'planet'
            ? new THREE.Vector3(1, 1, 1)  // 星环：核不变形，倾角给光环
            : new THREE.Vector3(
              1 + (hash01(i * 7 + 4) - 0.5) * 2 * ANISO,
              1 + (hash01(i * 7 + 5) - 0.5) * 2 * ANISO,
              1 + (hash01(i * 7 + 6) - 0.5) * 2 * ANISO,
            ));
      } else {
        this.quats.push(form === 'ripple' ? flatQuat.clone() : new THREE.Quaternion());
        this.aniso.push(new THREE.Vector3(1, 1, 1));
      }

      this.coreOf.push(routeNext(i));

      this.writeInstance(i, 0);
      sampleColormap(norm(s.spreadHz, meta.ranges.spreadHz), color);
      this.colors.push(color.clone());
      this.writeShellColor(i); // 初始全部未播放 → 幽灵态壳色（仅 orb）
      this.writeEmissive(i, 0);
    }
    this.markMatricesDirty();
    if (this.shell?.instanceColor) this.shell.instanceColor.needsUpdate = true;

    bbox.getCenter(this.center);
    // 各向异性取景半径：水平=绕 Y 旋转的最大 √(dx²+dz²)，垂直=最大 |dy|
    let maxD = 0;
    let maxH = 0;
    let maxV = 0;
    for (const p of this.positions) {
      maxD = Math.max(maxD, p.distanceTo(this.center));
      const dx = p.x - this.center.x;
      const dz = p.z - this.center.z;
      maxH = Math.max(maxH, Math.hypot(dx, dz));
      maxV = Math.max(maxV, Math.abs(p.y - this.center.y));
    }
    this.boundingRadius = Math.max(maxD + R_MAX, 1);
    this.horizRadius = Math.max(maxH + R_MAX, 1);
    this.vertRadius = Math.max(maxV + R_MAX, 1);

    this.buildLines();
    this.buildLabels();
  }

  /**
   * 022 录音流式增量追加：把 batch 写入下一段空槽位，不重算旧音节。
   * meta 由调用方在 data 上滚动更新（duration 增长、ranges 切换），新音节按当前 meta 着色/定位。
   * 仅录音模式（capacity>0）可用。
   */
  appendSyllables(batch: SyllableData[], meta: SyllablesJson['meta']): void {
    if (this.capacity <= 0 || batch.length === 0) return;
    const core = this.instMeshes[0];
    const color = new THREE.Color();

    for (const s of batch) {
      if (this.count >= this.capacity) {
        console.warn(`[SyllableCloud] 已达 capacity=${this.capacity}，停止追加`);
        break;
      }
      const i = this.count;
      // 写回 data.syllables（保持 i 连续，供标签池/连线一致引用）
      this.data.syllables[i] = { ...s, i };
      this.ts[i] = s.t;

      const pos = layoutPosition(this.data.syllables[i], meta, new THREE.Vector3());
      this.positions.push(pos);
      this.baseRadius[i] = R_MIN + norm(s.rms, meta.ranges.rms) * (R_MAX - R_MIN);
      this.stemLen[i] = SPIRE_LEN_MIN
        + norm(s.dur, meta.ranges.durSec) * (SPIRE_LEN_MAX - SPIRE_LEN_MIN);
      // 022 录音态浮现：渐入时长 = 上一 onset 间隔（流式无法预知下一声，用上一段预测）；
      //   间隔短→渐入快（连射感），间隔长→渐入慢（舒缓感）。首颗用默认。
      const interval = this.recLastOnset >= 0 ? s.t - this.recLastOnset : -1;
      const dur = interval >= 0
        ? Math.min(Math.max(interval * REC_FILL_FACTOR, REC_FILL_MIN), REC_FILL_MAX)
        : REC_FILL_DEFAULT;
      this.recLastOnset = s.t;
      if (this.recAppearWall && this.recFillDur) {
        this.recAppearWall[i] = this.recWall;
        this.recFillDur[i] = dur;
      }
      this.fillDur[i] = dur;

      this.quats.push(new THREE.Quaternion().setFromEuler(new THREE.Euler(
        hash01(i * 7 + 1) * Math.PI * 2,
        hash01(i * 7 + 2) * Math.PI * 2,
        hash01(i * 7 + 3) * Math.PI * 2,
      )));
      this.aniso.push(new THREE.Vector3(
        1 + (hash01(i * 7 + 4) - 0.5) * 2 * ANISO,
        1 + (hash01(i * 7 + 5) - 0.5) * 2 * ANISO,
        1 + (hash01(i * 7 + 6) - 0.5) * 2 * ANISO,
      ));
      this.coreOf.push({ mesh: core, idx: i });

      sampleColormap(norm(s.spreadHz, meta.ranges.spreadHz), color);
      this.colors.push(color.clone());

      this.count++;
      core.count = this.count;
      if (this.shell) this.shell.count = this.count;

      this.writeInstance(i, 0);
      this.writeShellColor(i);
      this.writeEmissive(i, 0);

      // 022 录音连击：每颗球诞生即视为「发声」，补发回调（播放态由 updateFlare 触发，
      //   录音态不跑 updateFlare，须在此手动触发，否则边录边连击完全失效）。
      this.onSyllableStart?.(i, s.t, this.positions[i]);

      // 连线：新增段 i-1 → i（写入预分配缓冲）
      if (i >= 1 && this.linePts && this.lineDist) {
        const a = this.positions[i - 1];
        const b = this.positions[i];
        this.linePts.set([a.x, a.y, a.z, b.x, b.y, b.z], (i - 1) * 6);
        this.lineDist[(i - 1) * 2] = 0;
        this.lineDist[(i - 1) * 2 + 1] = a.distanceTo(b);
      }
    }

    this.markMatricesDirty();
    if (this.shell?.instanceColor) this.shell.instanceColor.needsUpdate = true;
    // 连线缓冲变更 → 标记更新 + drawRange 随 count 增长
    if (this.lineSolidGeo) {
      (this.lineSolidGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.lineDashedGeo!.getAttribute('lineDistance') as THREE.BufferAttribute).needsUpdate = true;
    }
    this.writeLineColors();
    // 022 录音态：已生成的段都是「已发生的过去」，全部按实线渲染（对齐播放态已唱段），
    //   而非随 nowCache(=0) 全归虚线。虚线在录音中无意义（流式无未来段）。
    this.updateLineProgress(Infinity);

    // 022 录音运镜焦点 = 最新落点（驱动智能运镜/牵引等 focus 系模式跟随生长）
    if (this.count > 0) {
      const last = this.count - 1;
      this.recFocus.copy(this.positions[last]);
      this.recFocusColor.copy(this.colors[last]);
      this.hasRecFocus = true;
    }

    // 标签重选 Top40（按全量 rms）
    this.rebuildLabels();

    // 重算中心与取景半径（相机/环境跟随生长）
    this.recomputeBounds();
  }

  /** 当前逻辑可见音节数（录音模式随 append 增长） */
  get syllableCount(): number {
    return this.count;
  }

  /**
   * 022⑤ 录音态哨箭目标：最新球仍在爆亮窗口内时返回其位置（哨箭飞向新生球），
   * 否则 null（哨箭归位）。对齐播放态「哨箭飞向最强活跃球」的语义。
   */
  recMessengerFocus(): THREE.Vector3 | null {
    if (!this.recAppearWall || this.count === 0) return null;
    const last = this.count - 1;
    const age = this.recWall - this.recAppearWall[last];
    if (age < 0 || age > FLARE_WINDOW) return null;
    return this.positions[last];
  }

  /** 022：录音增量后重算中心 / 包络半径，并刷新连线 boundingSphere */
  private recomputeBounds(): void {
    const bbox = new THREE.Box3();
    for (const p of this.positions) bbox.expandByPoint(p);
    bbox.getCenter(this.center);
    let maxD = 0;
    let maxH = 0;
    let maxV = 0;
    for (const p of this.positions) {
      maxD = Math.max(maxD, p.distanceTo(this.center));
      maxH = Math.max(maxH, Math.hypot(p.x - this.center.x, p.z - this.center.z));
      maxV = Math.max(maxV, Math.abs(p.y - this.center.y));
    }
    this.boundingRadius = Math.max(maxD + R_MAX, 1);
    this.horizRadius = Math.max(maxH + R_MAX, 1);
    this.vertRadius = Math.max(maxV + R_MAX, 1);
    // drawRange 已限制可见段，但 boundingSphere 需重算避免被错误剔除
    this.solidLine?.geometry.computeBoundingSphere();
    this.dashedLine?.geometry.computeBoundingSphere();
  }

  /**
   * 相邻音节时序连线 —— 能量丝（003）+ 时间渐进（011）：
   * 已唱过的段落 = 实线，未唱到的 = 虚线。实/虚两个 LineSegments 共享同一份
   * 顶点与颜色缓冲，每帧只按播放进度移动 drawRange 分界（零拷贝）。
   */
  private buildLines(): void {
    // 录音模式：连线缓冲按 capacity 预分配（capacity-1 段），用 drawRange 控制可见段数。
    const recording = this.capacity > 0;
    const n = this.positions.length;
    const segCap = recording ? this.capacity - 1 : n - 1;
    if (segCap < 1) return;
    if (!recording && n < 2) return;
    const pts = new Float32Array(segCap * 6);
    const dist = new Float32Array(segCap * 2); // LineDashedMaterial 需要 lineDistance
    const filled = Math.max(n - 1, 0);
    for (let i = 0; i < filled; i++) {
      const a = this.positions[i];
      const b = this.positions[i + 1];
      pts.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
      dist[i * 2] = 0;
      dist[i * 2 + 1] = a.distanceTo(b);
    }
    if (recording) { this.linePts = pts; this.lineDist = dist; }
    const posAttr = new THREE.BufferAttribute(pts, 3).setUsage(THREE.DynamicDrawUsage);
    this.lineColors = new THREE.BufferAttribute(new Float32Array(segCap * 6), 3)
      .setUsage(THREE.DynamicDrawUsage) as THREE.BufferAttribute;
    this.writeLineColors();

    const solidGeo = new THREE.BufferGeometry();
    solidGeo.setAttribute('position', posAttr);
    solidGeo.setAttribute('color', this.lineColors);
    const dashedGeo = new THREE.BufferGeometry();
    dashedGeo.setAttribute('position', posAttr);
    dashedGeo.setAttribute('color', this.lineColors);
    dashedGeo.setAttribute('lineDistance', new THREE.BufferAttribute(dist, 1)
      .setUsage(THREE.DynamicDrawUsage));
    this.lineSolidGeo = solidGeo;
    this.lineDashedGeo = dashedGeo;

    const solid = new THREE.LineSegments(solidGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const dashed = new THREE.LineSegments(dashedGeo, new THREE.LineDashedMaterial({
      vertexColors: true, transparent: true, opacity: 0.13,
      dashSize: 0.07, gapSize: 0.08,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    solid.frustumCulled = false;
    dashed.frustumCulled = false;
    this.solidLine = solid;
    this.dashedLine = dashed;
    this.group.add(solid, dashed);
    this.updateLineProgress(0);
  }

  /** 011：实/虚分界随播放推进——段 j 在其后一颗音节(j+1)发声后变实线 */
  private updateLineProgress(now: number): void {
    if (!this.lineSolidGeo || !this.lineDashedGeo) return;
    const segs = this.positions.length - 1;
    const played = Math.min(Math.max(upperBound(this.ts, now) - 1, 0), segs);
    this.lineSolidGeo.setDrawRange(0, played * 2);
    this.lineDashedGeo.setDrawRange(played * 2, (segs - played) * 2);
  }

  /** 021：连线端点亮度系数——谢幕期间统一受 finaleLineK，否则随端点渐隐因子 */
  private lineFactor(i: number): number {
    if (this.finaleStart >= 0) return this.finaleLineK;
    return this.fadeFactor(i);
  }

  private writeLineColors(): void {
    if (!this.lineColors) return;
    const arr = this.lineColors.array as Float32Array;
    for (let i = 0; i < this.positions.length - 1; i++) {
      // 022 录音态：段 i（连 i→i+1）在终点球诞生时高亮一下再回落（脉冲沿路径推进）
      const pulse = this.recLinePulse(i);
      const fa = this.lineFactor(i) * pulse;
      const fb = this.lineFactor(i + 1) * pulse;
      const ca = this.colors[i];
      const cb = this.colors[i + 1];
      arr[i * 6] = ca.r * fa; arr[i * 6 + 1] = ca.g * fa; arr[i * 6 + 2] = ca.b * fa;
      arr[i * 6 + 3] = cb.r * fb; arr[i * 6 + 4] = cb.g * fb; arr[i * 6 + 5] = cb.b * fb;
    }
    this.lineColors.needsUpdate = true;
  }

  /** 022 录音态连线脉冲：段终点球诞生瞬间 1+LINE_PULSE_GAIN，按 flare 衰减回 1（非录音恒为 1） */
  private recLinePulse(seg: number): number {
    if (!this.recAppearWall) return 1;
    const born = this.recAppearWall[seg + 1];
    if (born < 0) return 1;
    return 1 + LINE_PULSE_GAIN * flare(this.recWall - born);
  }

  /** 006 配色探索器：按当前激活色谱原地重着色（不重建场景、不打断播放） */
  recolor(): void {
    const { meta, syllables } = this.data;
    const c = new THREE.Color();
    for (let i = 0; i < syllables.length; i++) {
      sampleColormap(norm(syllables[i].spreadHz, meta.ranges.spreadHz), c);
      this.colors[i].copy(c);
    }
    this.resyncPlayed(); // 013：新色谱按已播/未播两档重写发光与壳色
    this.writeLineColors();
  }

  /** 前 K 响亮且 f0 非 null 的音节加频率标签（BV-cv-05） */
  private buildLabels(): void {
    troika.preloadFont({ font: undefined, characters: '0123456789.K' }, () => {});

    // 录音模式按当前已生成音节（前 count 个）选标签；上传模式用全量 syllables
    const pool = this.capacity > 0
      ? this.data.syllables.slice(0, this.count)
      : this.data.syllables;
    const candidates = pool
      .filter((s) => s.f0Hz != null)
      .sort((a, b) => b.rms - a.rms)
      .slice(0, LABEL_COUNT);

    const BatchedText = (troika as Record<string, unknown>).BatchedText as
      | (new () => THREE.Object3D & { sync(): void })
      | undefined;
    const batch = BatchedText ? new BatchedText() : null;
    this.batchedText = batch;

    for (const s of candidates) {
      const text = new troika.Text();
      text.text = `${((s.f0Hz as number) / 1000).toFixed(2)}K`;
      text.fontSize = LABEL_BASE_SIZE;
      text.anchorX = 'center';
      text.anchorY = 'bottom';
      text.color = 0x8fa3bd;      // 012：哑光蓝灰，不抢球体
      text.fillOpacity = LABEL_BASE_OPACITY;
      const p = this.positions[s.i];
      text.position.set(p.x, p.y + this.baseRadius[s.i] + 0.06, p.z);
      this.labels.set(s.i, { text, lastSize: LABEL_BASE_SIZE });
      if (batch) batch.add(text);
      else {
        text.sync();
        this.group.add(text);
      }
    }
    if (batch) {
      batch.sync();
      this.group.add(batch);
    }
  }

  /** 022 录音模式：销毁旧标签（重选 Top40 时调用） */
  private rebuildLabels(): void {
    for (const { text } of this.labels.values()) {
      const t = text as unknown as THREE.Object3D & { dispose?: () => void };
      this.group.remove(t);
      t.dispose?.();
    }
    this.labels.clear();
    if (this.batchedText) {
      this.group.remove(this.batchedText);
      (this.batchedText as unknown as { dispose?: () => void }).dispose?.();
      this.batchedText = null;
    }
    this.buildLabels();
  }

  /**
   * 每帧爆亮更新（spec playback-flare）：
   * 活跃窗口 [now-FLARE_WINDOW, now] 二分定位（BV-pf-03），离开窗口复位（BV-pf-04）。
   */
  updateFlare(now: number): void {
    this.cancelFinale(); // 020/021：任何播放推进都取消谢幕（含光尘/连线复原）
    // 013：回跳（重播/复位）或大幅前跳（标签页休眠）→ 全量重同步已播/未播状态
    if (now < this.nowCache || now - this.nowCache > FLARE_WINDOW) {
      this.nowCache = now;
      this.resyncPlayed();
    }
    this.nowCache = now;

    const lo = lowerBound(this.ts, now - FLARE_WINDOW);
    const hi = upperBound(this.ts, now) - 1;

    const next = new Set<number>();
    let maxEnv = 0;
    let focusIdx = -1;
    let shellDirty = false;
    for (let i = lo; i <= hi; i++) {
      const env = flare(now - this.ts[i]);
      if (env > maxEnv) { maxEnv = env; focusIdx = i; }
      if (!this.active.has(i)) {
        this.onSyllableStart?.(i, this.ts[i], this.positions[i]); // 016：连击计数
      }
      this.writeShellColor(i); // 018：壳色随填充进度逐帧渐变
      shellDirty = true;
      this.writeInstance(i, env);
      this.writeEmissive(i, env);
      this.updateLabel(i, env);
      next.add(i);
    }
    if (shellDirty && this.shell?.instanceColor) this.shell.instanceColor.needsUpdate = true;
    // 取最强活跃音节作飞行焦点（多音节并发时哨箭飞向最响者）
    this.hasFocus = focusIdx >= 0 && maxEnv > 0.12;
    if (this.hasFocus) {
      this.focus.copy(this.positions[focusIdx]);
      this.focusColor.copy(this.colors[focusIdx]);
    }

    this.updateLineProgress(now); // 011：已唱实线/未唱虚线

    let dirty = next.size > 0;
    for (const i of this.active) {
      if (!next.has(i)) {
        this.writeInstance(i, 0);
        this.writeEmissive(i, 0);
        this.writeShellColor(i); // 离窗终值（g=1 全色）
        this.updateLabel(i, 0);
        shellDirty = true;
        dirty = true;
      }
    }
    this.active = next;
    if (dirty) this.markMatricesDirty(); // BV-pf-05
  }

  private markMatricesDirty(): void {
    if (this.shell) this.shell.instanceMatrix.needsUpdate = true;
    for (const m of this.instMeshes) m.instanceMatrix.needsUpdate = true;
  }

  /** 018：填充进度 g∈[0,1]——onset 后在 fillDur 内 smoothstep 浮现（节奏自适应） */
  private fillProgress(i: number): number {
    // 022 录音态：用 append 起的挂钟驱动渐入（无 playback 时钟），时长按上一间隔自适应
    if (this.recAppearWall && this.recAppearWall[i] >= 0) {
      const e = this.recWall - this.recAppearWall[i];
      if (e <= 0) return 0;
      const g = Math.min(e / this.recFillDur![i], 1);
      return g * g * (3 - 2 * g);
    }
    if (this.ts[i] > this.nowCache) return 0;
    const g = Math.min((this.nowCache - this.ts[i]) / this.fillDur[i], 1);
    return g * g * (3 - 2 * g);
  }

  /** 020 渐隐因子：发声后停留 FADE_DELAY，再于 FADE_DUR 内淡至 FADE_FLOOR */
  private fadeFactor(i: number): number {
    if (!this.fxFade || this.ts[i] > this.nowCache) return 1;
    const dt = this.nowCache - this.ts[i] - FADE_DELAY;
    if (dt <= 0) return 1;
    const k = Math.min(dt / FADE_DUR, 1);
    return 1 - (1 - FADE_FLOOR) * (k * k * (3 - 2 * k));
  }

  /** 020 呼吸因子：已播形状的常亮微脉动（错相），随填充进度 g 渐入 */
  private breathFactor(i: number, g: number): number {
    if (!this.fxBreath || g <= 0) return 1;
    return 1 + BREATH_AMP * g * Math.sin(this.wallT * BREATH_FREQ + i * 1.7);
  }

  /** 同一矩阵驱动该音节的全部网格层；014 未播缩小；015 按形态组合缩放；018 填充；020 渐隐 */
  private writeInstance(i: number, env: number): void {
    const g = this.fillProgress(i);
    const ps = (SCALE_UNPLAYED + (1 - SCALE_UNPLAYED) * g) * this.fadeFactor(i);
    const flareS = 1 + SCALE_GAIN * env;
    this.dummy.position.copy(this.positions[i]);
    this.dummy.quaternion.copy(this.quats[i]);
    if (this.form === 'spire') {
      // 光针：xz=粗细（响度×爆亮），y=长度（时长）
      const thick = this.baseRadius[i] * SPIRE_THICK * ps * flareS;
      this.dummy.scale.set(thick, this.stemLen[i] * ps, thick);
    } else if (this.form === 'ripple') {
      // 涟漪：均匀缩放（半径=响度×爆亮，爆亮即扩张）
      const s = this.baseRadius[i] * RIPPLE_SCALE * ps * flareS;
      this.dummy.scale.set(s, s, s);
    } else {
      const s = this.baseRadius[i] * ps * flareS;
      const a = this.aniso[i];
      this.dummy.scale.set(a.x * s, a.y * s, a.z * s);
    }
    this.dummy.updateMatrix();
    this.shell?.setMatrixAt(i, this.dummy.matrix);
    this.ring?.setMatrixAt(i, this.dummy.matrix);
    const c = this.coreOf[i];
    c.mesh.setMatrixAt(c.idx, this.dummy.matrix);
  }

  /**
   * HDR 契约（visual-mapping §6）：emissive = 本色 × (基态 + 增益×包络)。
   * 013/018：基态在未播 EMISSIVE_UNPLAYED 与已播 EMISSIVE_BASE 间按填充进度 g 渐变。
   */
  private writeEmissive(i: number, env: number): void {
    const g = this.fillProgress(i);
    const base = (EMISSIVE_UNPLAYED + (EMISSIVE_BASE - EMISSIVE_UNPLAYED) * g)
      * this.fadeFactor(i) * this.breathFactor(i, g);
    this.tmpColor
      .copy(this.colors[i])
      .multiplyScalar(base + EMISSIVE_GAIN * env);
    const c = this.coreOf[i];
    c.mesh.setUniformAt('emissive', c.idx, this.tmpColor);
    if (this.ring) {
      this.tmpColor.multiplyScalar(0.55); // 星环：光环弱于球核
      this.ring.setUniformAt('emissive', i, this.tmpColor);
    }
  }

  /** 013/018/020：玻璃壳着色随填充进度渐变 × 渐隐（C4：全形态有壳时生效） */
  private writeShellColor(i: number): void {
    if (!this.shell) return;
    const f = (SHELL_UNPLAYED + (1 - SHELL_UNPLAYED) * this.fillProgress(i)) * this.fadeFactor(i);
    this.tmpColor.copy(this.colors[i]).multiplyScalar(f);
    this.shell.setColorAt(i, this.tmpColor);
  }

  /** 020：设置特效开关（切换后全量刷新使其立即生效/失效） */
  setEffects(fade: boolean, breath: boolean): void {
    this.fxFade = fade;
    this.fxBreath = breath;
    if (!fade) this.cancelFinale();
    this.resyncPlayed();
    this.writeLineColors(); // 021：渐隐开关切换时连线亮度立即同步
  }

  /** 021：取消谢幕（播放推进/关特效时），并复原光尘与连线 */
  private cancelFinale(): void {
    if (this.finaleStart < 0) return;
    this.finaleStart = -1;
    this.finaleLineK = 1;
    if (this.dust) this.dust.visible = false;
    this.writeLineColors();
    this.writeLabelsOpacity();
  }

  /** 020：每帧环境更新（暂停也驱动）——呼吸/渐隐作用于活跃窗口之外的已播形状；谢幕优先 */
  updateEffects(wallT: number): void {
    this.wallT = wallT;
    // 022 录音态：推进挂钟，对刚诞生的新球做「渐入 + 播放同款爆亮」，二者都完成后停笔。
    //   env=flare(出生后耗时)：诞生瞬间闪一下亮+微微变大，再衰减回常亮（与播放发声一致）。
    if (this.recAppearWall) {
      this.recWall = wallT;
      let dirty = false;
      let lineDirty = false;
      for (let i = 0; i < this.count; i++) {
        if (this.recAppearWall[i] < 0) continue;
        const age = this.recWall - this.recAppearWall[i];
        // 渐入完成（age>fillDur）且爆亮衰减完（age>FLARE_WINDOW）才停止重绘该球
        if (age > this.recFillDur![i] && age > FLARE_WINDOW) continue;
        const env = flare(age);
        this.writeInstance(i, env);
        this.writeEmissive(i, env);
        this.writeShellColor(i);
        this.updateLabel(i, env); // 022④：录音标签随诞生爆亮放大（对齐播放态）
        dirty = true;
        if (age <= FLARE_WINDOW) lineDirty = true; // 连线段脉冲期间需刷新亮度
      }
      if (lineDirty) this.writeLineColors();
      if (dirty) {
        this.markMatricesDirty();
        if (this.shell?.instanceColor) this.shell.instanceColor.needsUpdate = true;
      }
      // 022③：录音态故意只走「诞生爆亮+渐入」，不接 fxFade/fxBreath/finale——
      //   录音是实时生长语义，渐隐/呼吸/谢幕在「正在生成」阶段无意义；停录后转标准
      //   播放态（mount, capacity=0）这些特效自然恢复。故此处提前 return。
      return;
    }
    if (this.finaleStart >= 0) {
      this.driveFinale(wallT - this.finaleStart);
      return;
    }
    if (!this.fxFade && !this.fxBreath) return;
    const played = upperBound(this.ts, this.nowCache);
    let dirty = false;
    for (let i = 0; i < played; i++) {
      if (this.active.has(i)) continue; // 窗口内由 updateFlare 路径负责
      this.writeEmissive(i, 0);
      if (this.fxFade) {
        this.writeInstance(i, 0);
        this.writeShellColor(i);
        dirty = true;
      }
    }
    if (dirty) {
      this.markMatricesDirty();
      if (this.shell?.instanceColor) this.shell.instanceColor.needsUpdate = true;
    }
    if (this.fxFade) this.writeLineColors(); // 021：连线随所属形状一起淡出
    if (this.fxFade) this.writeLabelsOpacity();
  }

  /** 020/021 谢幕（渐隐开关附带）：全体浮现 → 高亮悬停 → 粒子消散 → 回归幽灵态待重播 */
  startFinale(): boolean {
    if (!this.fxFade) return false;
    this.active.clear();
    this.hasFocus = false;
    this.ensureDust();
    this.finaleStart = this.wallT;
    return true;
  }

  isFinaleActive(): boolean {
    return this.finaleStart >= 0;
  }

  /** 021：消散光尘（懒建，每音节 DUST_PER 颗，确定性速度、略向上飘） */
  private ensureDust(): void {
    if (this.dust) return;
    const n = this.positions.length * DUST_PER;
    this.dustVel = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const u = hash01(k * 9 + 1) * 2 - 1;
      const phi = hash01(k * 9 + 2) * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const speed = 0.5 + hash01(k * 9 + 3) * 1.1;
      this.dustVel[k * 3] = s * Math.cos(phi) * speed;
      this.dustVel[k * 3 + 1] = (u * 0.8 + 0.45) * speed;
      this.dustVel[k * 3 + 2] = s * Math.sin(phi) * speed;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color',
      new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.06,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending, // 加性：颜色趋零即熄灭
      depthWrite: false,
      sizeAttenuation: true,
    }));
    this.dust.visible = false;
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  private driveFinale(t: number): void {
    const n = this.positions.length;
    const tVanish = FINALE_APPEAR + FINALE_HOLD;
    let scaleK: number;
    let emisK: number;
    let dustQ = -1; // ≥0 表示消散阶段进度
    if (t < FINALE_APPEAR) {
      const k = t / FINALE_APPEAR;
      const e = k * k * (3 - 2 * k);
      scaleK = 0.55 + 0.45 * e;
      emisK = 0.03 + (1.7 - 0.03) * e; // 浮现并略过常亮（辉光涌起，谢幕初值独立于 FADE_FLOOR）
      this.finaleLineK = e;
    } else if (t < tVanish) {
      scaleK = 1;
      emisK = 2.1; // 高亮悬停一拍
      this.finaleLineK = 1;
    } else if (t < FINALE_RESET) {
      // 021 粒子消散：形状快速塌缩，光尘携本色飘散熄灭，连线同步淡出
      dustQ = Math.min((t - tVanish) / FINALE_DISSOLVE, 1);
      scaleK = Math.max(1 - dustQ * 3.2, 0.001);
      emisK = Math.max(1.4 * (1 - dustQ * 2.5), 0.01);
      this.finaleLineK = Math.max(1 - dustQ * 1.6, 0);
    } else {
      // 回归幽灵态：nowCache 置 -1 → 全部按未播渲染；重播时 updateFlare 前跳触发 resync
      this.finaleStart = -1;
      this.finaleLineK = 1;
      if (this.dust) this.dust.visible = false;
      this.nowCache = -1;
      this.resyncPlayed();
      this.updateLineProgress(0); // 连线同步归虚（与幽灵态一致）
      this.writeLineColors();
      this.writeLabelsOpacity();
      return;
    }
    for (let i = 0; i < n; i++) {
      const a = this.aniso[i];
      const s = this.baseRadius[i] * scaleK;
      this.dummy.position.copy(this.positions[i]);
      this.dummy.quaternion.copy(this.quats[i]);
      this.dummy.scale.set(a.x * s, a.y * s, a.z * s);
      this.dummy.updateMatrix();
      this.shell?.setMatrixAt(i, this.dummy.matrix);
      this.ring?.setMatrixAt(i, this.dummy.matrix);
      const c = this.coreOf[i];
      c.mesh.setMatrixAt(c.idx, this.dummy.matrix);
      this.tmpColor.copy(this.colors[i]).multiplyScalar(EMISSIVE_BASE * emisK);
      c.mesh.setUniformAt('emissive', c.idx, this.tmpColor);
      if (this.ring) {
        this.tmpColor.multiplyScalar(0.55);
        this.ring.setUniformAt('emissive', i, this.tmpColor);
      }
      if (this.shell) {
        this.tmpColor.copy(this.colors[i]).multiplyScalar(Math.min(emisK, 1));
        this.shell.setColorAt(i, this.tmpColor);
      }
    }
    // 光尘飘散：位置 = 形状位 + 速度×行程，颜色 = 本色×(1-q)^1.5（加性趋零即熄灭）
    if (this.dust && this.dustVel) {
      this.dust.visible = dustQ >= 0;
      if (dustQ >= 0) {
        const pa = (this.dust.geometry.getAttribute('position') as THREE.BufferAttribute);
        const ca = (this.dust.geometry.getAttribute('color') as THREE.BufferAttribute);
        const pArr = pa.array as Float32Array;
        const cArr = ca.array as Float32Array;
        const glow = Math.pow(1 - dustQ, 1.5) * 1.6;
        const travel = dustQ * 1.5;
        for (let k = 0; k < n * DUST_PER; k++) {
          const si = (k / DUST_PER) | 0;
          const p = this.positions[si];
          pArr[k * 3] = p.x + this.dustVel[k * 3] * travel;
          pArr[k * 3 + 1] = p.y + this.dustVel[k * 3 + 1] * travel;
          pArr[k * 3 + 2] = p.z + this.dustVel[k * 3 + 2] * travel;
          const col = this.colors[si];
          cArr[k * 3] = col.r * glow;
          cArr[k * 3 + 1] = col.g * glow;
          cArr[k * 3 + 2] = col.b * glow;
        }
        pa.needsUpdate = true;
        ca.needsUpdate = true;
      }
    }
    this.writeLineColors(); // 谢幕全程驱动连线亮度
    this.writeLabelsOpacity(); // 谢幕全程驱动标签亮度
    this.markMatricesDirty();
    if (this.shell?.instanceColor) this.shell.instanceColor.needsUpdate = true;
  }

  /** 019：暂停/播完时把活跃爆亮立刻「落定」为常亮态（否则白热球冻结在半空像卡死） */
  settle(): void {
    for (const i of this.active) {
      this.writeInstance(i, 0);
      this.writeEmissive(i, 0);
      this.writeShellColor(i);
      this.updateLabel(i, 0);
    }
    this.active.clear();
    this.hasFocus = false;
    if (this.shell?.instanceColor) this.shell.instanceColor.needsUpdate = true;
    this.markMatricesDirty();
  }

  /** 013：全量重同步已播/未播（回跳、重播、休眠恢复、换色谱时调用）；014 含尺寸 */
  private resyncPlayed(): void {
    for (let i = 0; i < this.positions.length; i++) {
      this.writeInstance(i, 0);
      this.writeEmissive(i, 0);
      this.writeShellColor(i);
      this.writeLabelOpacity(i);
    }
    if (this.shell?.instanceColor) this.shell.instanceColor.needsUpdate = true;
    this.markMatricesDirty();
  }

  private updateLabel(i: number, env: number): void {
    const entry = this.labels.get(i);
    if (!entry) return;
    const size = LABEL_BASE_SIZE * (1 + LABEL_FLARE_GAIN * env);
    if (Math.abs(size - entry.lastSize) / LABEL_BASE_SIZE > LABEL_SYNC_EPS) {
      entry.text.fontSize = size;
      entry.text.sync();
      entry.lastSize = size;
    }
    this.writeLabelOpacity(i);
  }

  /** 020/021：标签数字跟随渐隐/谢幕淡出，与线和形状保持同一时间轴 */
  private labelFactor(i: number): number {
    if (this.finaleStart >= 0) return this.finaleLineK;
    return this.fadeFactor(i);
  }

  private writeLabelOpacity(i: number): void {
    const entry = this.labels.get(i);
    if (!entry) return;
    entry.text.fillOpacity = LABEL_BASE_OPACITY * this.labelFactor(i);
  }

  private writeLabelsOpacity(): void {
    for (const i of this.labels.keys()) this.writeLabelOpacity(i);
  }

  /** 释放 GL 资源（重建场景前调用，避免多次上传内存泄漏，BV-ba-06） */
  dispose(): void {
    this.group.traverse((obj) => {
      const any = obj as unknown as {
        geometry?: { dispose?: () => void };
        material?: { dispose?: () => void } | { dispose?: () => void }[];
        dispose?: () => void;
      };
      any.geometry?.dispose?.();
      if (Array.isArray(any.material)) any.material.forEach((m) => m.dispose?.());
      else any.material?.dispose?.();
      any.dispose?.(); // InstancedMesh/troika Text 均有安全的 dispose
    });
    this.labels.clear();
  }
}

function lowerBound(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

function upperBound(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= v) lo = m + 1;
    else hi = m;
  }
  return lo;
}
