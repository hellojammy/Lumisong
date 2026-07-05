# Lumisong 技术白皮书

## 摘要

Lumisong（鸣光）是一个面向个人学习、研究和非商业创作的三维音频可视化项目。它将音乐、人声、鸟鸣和环境声解析为一组离散的声音事件，并把这些事件映射到三维空间中，形成可播放、可观察、可切换形态的“声音图谱”。

项目的核心不是音频识别，也不是传统播放器，而是一个声学特征到空间视觉体验的转译系统。每个声音事件包含起始时间、持续时间、频谱质心、频谱宽度、频谱平坦度、能量、基频等字段；渲染层根据这些字段确定节点位置、大小、颜色、形态、发光包络、连线与镜头行为。播放时，音频时钟驱动对应节点爆亮，并由尾迹、辉光与智能运镜共同形成“声音在空间中移动”的观看体验。

当前实现采用浏览器内分析与浏览器内渲染的静态 Web 架构：上传音频后，先进行轻量音频画像判断，再由用户确认分析类型，随后以 Essentia.js v4 提取声学特征并生成统一的 `SyllablesJson v1` 数据结构。三维渲染基于 Three.js WebGLRenderer，并通过实例化网格、HDR 自发光、后期辉光、流光拖尾、确定性布局和自适应相机完成实时可视化。

## 项目定位

Lumisong 的当前定位是“三维声音图谱”工具，而不是鸟鸣专用分析器。早期默认样本和部分视觉语言来自鸟鸣可视化场景，但当前产品需要同时服务音乐、人声、鸟鸣和环境声等更广泛素材。

因此，系统设计采用以下边界：

- 输入对象是本地音频，而不是特定物种、特定乐器或特定语言的识别任务。
- 输出对象是视觉化的声音事件序列，而不是声学测量报告、医学诊断、版权鉴定或司法证据。
- 用户上传后可以看到自动推断的音频类型，并可手动覆盖；最终分析参数以用户选择为准。
- 同一份分析结果可以用不同形态、配色和运镜方式观察，但数据语义保持不变。
- 所有视觉变量都应有可追溯的数据来源，不编造音高或不存在的特征。

项目开发过程中使用 OpenSpec 作为本地规格与变更治理工具（`openspec/` 目录未纳入公开仓库）。对外读者应以**本白皮书与源码**为准理解系统行为；OpenSpec 主要用于维护者内部收敛需求、设计与实现，不在 GitHub 上单独分发。

## 设计原则

**数据真实**

视觉节点必须来自分析结果。`f0Hz` 为 `null` 时不显示音高标签，不用估计值补齐；归一化范围来自 `meta.ranges`，不在渲染层临时猜测。

**语义稳定**

位置、颜色、大小、形态和播放爆亮分别承载不同声学含义。切换形态或配色不应改变数据本身，也不应破坏播放进度和相机状态。

**端上闭环**

上传音频、分析、生成图谱、播放同步和可视化全部在浏览器侧完成。这样可以降低部署复杂度，也避免把用户素材发送到远端服务。

**确定性表达**

布局抖动、形态朝向、星尘分布等视觉随机性使用基于索引或种子的确定性伪随机函数，不使用运行时 `Math.random`。同一份数据在同一版本中应稳定复现。

**主视觉优先**

项目的主视觉是三维声音事件图谱。环境、网格、星尘、云雾、连击、尾迹和运镜用于增强空间感与节奏感，不应喧宾夺主。

## 总体架构

Lumisong 的 Web 核心可以分为六层：

```text
音频输入
  ↓
音频画像与分析参数选择
  ↓
浏览器端声学分析
  ↓
SyllablesJson v1 数据契约
  ↓
Three.js 三维声音图谱
  ↓
播放时钟、爆亮包络、流光、运镜与交互控制
```

主要模块如下：

| 层级 | 关键模块 | 职责 |
|---|---|---|
| 应用编排 | `web/src/main.ts` | 启动、加载默认数据、上传/录音流程、重建场景、UI 事件、渲染循环 |
| 数据契约 | `web/src/data.ts` | `SyllablesJson`、`SyllableData`、`FeatureRange`、分位数归一化 |
| 音频画像 | `web/src/audioProfile.ts` | 判断鸟鸣、音乐、人声、通用 profile，提供不同分析参数 |
| 正式分析 | `web/src/analyzerEssentia.ts` | Essentia.js v4 特征提取、onset 检测、基频估计、分位数统计 |
| 实时预览 | `web/src/analyzer.ts`、`web/src/streamAnalyzer.ts` | 录音中滑窗预览，使用 Meyda 与 Pitchy |
| 三维映射 | `web/src/layout.ts`、`web/src/colormap.ts` | 声学特征到空间位置、色谱和图例的映射 |
| 声音事件图谱 | `web/src/syllableCloud.ts`、`web/src/formBuilders.ts` | 节点实例化、形态构建、连线、标签、爆亮、谢幕状态 |
| 播放同步 | `web/src/playback.ts`、`web/src/envelope.ts`、`web/src/visualTiming.ts` | 播放时钟、attack-decay 包络、填充节奏 |
| 运镜系统 | `web/src/camera.ts`、`web/src/cameraDirector*.ts` | 智能运镜、匀速运镜、自由运镜、飞船类镜头 |
| 场景与后期 | `web/src/scene.ts`、`web/src/environment.ts`、`web/src/postfx.ts` | WebGL 渲染器、深空环境、网格、星尘、Bloom、TrailPass、降级策略 |
| 辅助视觉 | `web/src/messenger.ts`、`web/src/combo.ts`、`web/src/legend.ts` | 哨箭流光、连击浮字、频谱宽度图例 |

架构的关键是渲染层只消费 `SyllablesJson`，不关心该数据来自默认文件、上传分析还是录音重析。这样可以保证上传音频、默认音频和录音路径共享同一套视觉系统。

## 数据契约

Lumisong 的核心数据结构是 `SyllablesJson v1`：

```ts
interface SyllablesJson {
  meta: {
    version: 1;
    audioFile: string;
    sampleRate: number;
    duration: number;
    nSyllables: number;
    analysis: { nFft: number; hop: number; onset: string };
    ranges: Record<RangeKey, FeatureRange>;
  };
  syllables: SyllableData[];
}

interface SyllableData {
  i: number;
  t: number;
  dur: number;
  centroidHz: number;
  spreadHz: number;
  flatness: number;
  rms: number;
  f0Hz: number | null;
  pos?: [number, number, number];
}
```

字段语义：

- `t`：声音事件起始时间，单位秒，是播放同步的主键。
- `dur`：事件持续时间，用于形态填充、光针长度和节奏判断。
- `centroidHz`：频谱质心，反映频率能量中心。
- `spreadHz`：频谱宽度，反映频谱离散程度，也是当前默认颜色映射依据。
- `flatness`：频谱平坦度，用于估计“噪声性”和“音调性”。
- `rms`：均方根能量，用于节点半径、峰值判断和部分镜头逻辑。
- `f0Hz`：基频或音高估计，无法可靠估计时为 `null`。
- `pos`：可选三维坐标，用于未来接入更高阶嵌入或外部预处理结果。

`meta.ranges` 存储各特征的 p01、p50、p99、min、max。渲染层统一使用 p01-p99 min-max 归一化：

```text
norm(v, r) = clamp((v - r.p01) / (r.p99 - r.p01), 0, 1)
```

使用分位数而不是原始 min/max，是为了避免极端值压缩色域、尺寸和布局变化。若 `p99 - p01 <= 0`，归一化回退为 `0.5`，保证退化输入不会导致除零或布局崩溃。

## 音频画像与分析策略

上传音频后，系统先对前 20 秒以内 PCM 做轻量摘要，再给出初步 profile：

| Profile | 中文名 | 适用素材 | 核心参数倾向 |
|---|---|---|---|
| `bird` | 鸟鸣 | 高频、短促、密集鸣叫或类似声音事件 | 较高 fmin/fmax，较敏感 onset |
| `music` | 音乐 | 歌曲、器乐、节拍明显的音频 | 覆盖低频基频，保留节拍瞬态 |
| `voice` | 人声 | 讲话、旁白、人声主导音频 | 较低基频范围，较保守 onset |
| `generic` | 通用 | 环境声、混合素材或无法可靠识别的音频 | 折中参数 |

画像依据包括：

- 零交叉率 `zeroCrossingRate`
- 瞬态密度 `transientRate`
- 动态范围 `dynamicRange`
- 低/中/高频近似能量比例
- 有声稳定度 `voicedStability`

该判断不是分类模型，也不代表语义识别，只是为声学分析参数提供初值。UI 会把初步结果展示给用户，并允许用户修改。正式分析调用 `chooseAudioProfile` 后，以用户最终选择为准。

这种设计解决了一个关键问题：早期鸟鸣参数对音乐和人声并不总是合适。音乐可能需要更低的基频下限和更稳定的节拍分割；人声需要避免把连续语音切成过多碎片；鸟鸣则需要保留高频和密集 onset 的敏感度。

## 浏览器端正式分析

正式分析由 `analyzerEssentia.ts` 完成，基于 Essentia.js v4。该模块采用懒加载单例：首次分析时动态加载 `essentia-wasm` 与 `essentia.js-core`，等待 WASM runtime 初始化，之后复用同一个 Essentia 实例。

当前核心参数：

- `N_FFT = 2048`
- `HOP = 512`
- `PitchYinFFT` 音高估计
- spectral flux onset
- onset peak-picking
- onset backtracking
- p01/p50/p99 分位数统计

分析流程：

1. 使用 `AudioContext.decodeAudioData` 解码用户上传的音频。
2. 取第一个声道 PCM 与实际采样率。
3. 使用 Essentia `FrameGenerator` 切帧。
4. 对每帧计算 Hann window、Spectrum、PowerSpectrum、Flatness、RMS。
5. 从频谱计算 spectral centroid 与 spectral spread。
6. 用 `PitchYinFFT` 估计基频，并按 profile 的 fmin/fmax 与 confidence 过滤。
7. 基于相邻帧谱差计算 spectral flux。
8. 对谱通量做归一化 peak-picking，再回溯到能量谷底作为 onset。
9. 以相邻 onset 为边界，将帧级特征聚合为声音事件。
10. 计算每个字段的分位数范围，生成 `SyllablesJson v1`。

聚合策略偏向鲁棒而不是过度精细：质心、宽度、平坦度和基频取片段中位数，能量取片段峰值 RMS。这样可以降低局部噪声对视觉位置和颜色的影响，同时保留事件强度。

## 实时录音预览

录音中的实时预览不是正式分析结果，而是为了让用户在采集过程中尽快看到空间图谱生长。

实时路径由 `Recorder`、`StreamAnalyzer`、`analyzer.ts` 共同完成：

- `Recorder` 通过 `getUserMedia` 获取麦克风输入。
- 优先使用 `AudioWorklet` 逐块获取 PCM，不可用时降级到 `ScriptProcessorNode`。
- `StreamAnalyzer` 维护 5 秒滑窗。
- `analyzer.ts` 使用 Meyda 提取 RMS、spectral centroid、spectral spread、spectral flatness，用 Pitchy 估计 pitch。
- 滑窗结果通过 onset 去重和增量追加写入 `SyllableCloud`。

停止录音后，完整 PCM 会重新进入正式分析路径，生成更稳定的数据再用于回放。也就是说，录音中“边录边出”的结果强调低延迟，录音后回放强调一致性和精度。

## 三维视觉映射

默认布局采用可解释三轴：

```text
x = time
y = spectral centroid
z = tonality = 1 - normalized(flatness)
```

具体实现：

- X 轴表示音频时间推进，范围由 `t / duration` 映射到固定跨度。
- Y 轴表示频率能量中心，来自 `centroidHz`。
- Z 轴表示音调性，频谱越平坦越偏噪声，频谱越不平坦越偏有音高结构。
- 每轴叠加确定性微抖动，避免大量节点重叠。
- 如果 `syllables[].pos` 存在，则优先使用外部坐标。

颜色来自 `spreadHz` 的归一化值，并在预设色谱中线性插值。当前内置配色包括：

- 冰蓝 `ice`
- 融金 `magma`
- 翠序 `viridis`
- 琥珀 `amber`

节点大小来自 `rms`。响度越高，基础半径越大；播放爆亮时再叠加 attack-decay scale 增益。

音高标签来自 `f0Hz`。如果 `f0Hz == null`，标签隐藏；存在时显示为千赫格式，例如 `1.08K`。

## 形态系统

同一份声音事件数据可以使用五种几何语言呈现：

| Key | 中文名 | 视觉含义 |
|---|---|---|
| `orb` | 玻璃球 | 外层玻璃壳 + 内层发光核，噪声性事件可显示为多面晶核 |
| `spire` | 光针 | 竖向光柱，长度强调持续时间 |
| `ripple` | 涟漪 | 水平光环，强调扩散和节奏波动 |
| `gem` | 晶钻 | 八面体碎钻，强调棱角和瞬态 |
| `planet` | 星环 | 球核 + 倾斜环，形成微型天体感 |

形态切换通过重建 `SyllableCloud` 完成，但播放对象、相机状态和用户设置不应因此丢失。形态系统的关键是“同一语义，不同几何表达”：位置、颜色、爆亮、连线和标签仍遵守同一数据契约。

为了保证性能，节点主体使用 `InstancedUniformsMesh` 与 `InstancedMesh`。不同形态在构造期选择合适的几何和材质；播放循环中只更新必要的矩阵、发光颜色和少量状态。

## 播放同步与爆亮包络

播放同步的核心是 `Playback.now()`。Web 回退路径以 `AudioContext.currentTime` 为权威时钟，通过 `startCtxTime + startOffset` 计算当前播放位置。可视化不直接依赖 `Date.now` 或 UI 计时器来决定音符是否发声。

每帧渲染时，`SyllableCloud.updateFlare(now)` 根据当前播放时间找出活跃窗口内的声音事件，并计算：

```text
dt = now - syllable.t

flare(dt) =
  0,                         dt < 0
  dt / ATTACK,               0 <= dt < ATTACK
  exp(-(dt - ATTACK) / DECAY), dt >= ATTACK
```

当前常量：

- `ATTACK = 0.03s`
- `DECAY = 0.35s`
- `FLARE_WINDOW = 1.0s`
- 基态发光 `EMISSIVE_BASE = 1.15`
- 爆亮增益 `EMISSIVE_GAIN = 5.5`
- 缩放增益 `SCALE_GAIN = 1.6`

发声前节点处于幽灵态，亮度和尺寸较低；发声后进入正式态，并在短时间内完成填充成型。这样既能表现瞬态打击感，也能让已播放的声音事件逐步构成完整图谱。

播放结束后，如果开启谢幕效果，系统会经历全图浮现、高亮悬停、粒子消散和幽灵态回归。谢幕之后进入巡航观察状态，用户仍可以切换形态和运镜。

## 流光、辉光与后期

Lumisong 的“声音在空间中飞行”的感受来自三层叠加：

1. 声音事件本身的爆亮。
2. `Messenger` 光点向当前最强爆亮节点移动，并留下加性混合尾迹。
3. `PostFX` 中的 HDR TrailPass 和 Bloom 把高亮像素转化为屏幕级流光。

后期链路：

```text
RenderPass
  → TrailPass
  → BloomEffect
  → ToneMappingEffect
  → VignetteEffect
  → SMAAEffect（低 DPR 时启用）
```

`TrailPass` 只累积亮度超过阈值的 HDR 像素，避免普通场景产生拖影。不同形态有不同拖尾参数：细长或环状形态需要更短、更少的尾影，球形和星环可以保留更明显的流光。

渲染器关闭原生 antialias，由后期 SMAA 在需要时处理边缘。帧缓冲使用 HalfFloatType，以保留 HDR 发光信息供 Bloom 和 TrailPass 消费。

## 运镜系统

当前主要运镜模式包括：

- 智能运镜 `director2`
- 匀速运镜 `orbit`
- 自由运镜 `free`
- 飞船驾驶 `pilot`
- 飞船穿梭 `ship`
- 呼吸环绕 `breath`

默认模式是智能运镜。旧版自动运镜命名已经被路由到当前智能运镜，不再作为用户侧主名称出现。

智能运镜分为两类策略：

**空间型策略**

适合空间分布较明显的声音图谱。系统根据短语片段、当前播放焦点、未来短时间窗口和整体中心，计算相机位置与 look-at 目标，并用指数平滑减少密集段抖动。

**紧凑型策略**

适合长语音、音乐或集中云团。系统会判断音频时长、事件数量、密度、有基频比例、声学带宽以及空间轴向紧凑度。如果命中 compact profile，就不再完全依赖空间中心移动，而是按时间段落分配不同肩位、高度和距离，避免长时间固定单一镜头。

播放结束后的巡航由相机 rig 的 cruise override 承接。这个状态不改变数据，只让用户以更稳定的速度观察已经形成的图谱。

## 场景环境

三维环境由 `environment.ts` 构建：

- 深空背景 `#05070d`
- 指数雾 `FogExp2`
- 星尘点云
- 距离渐隐网格地面
- 可开关的低透明云雾层

网格地面在每次数据重建后根据图谱中心和包络半径重新定位到图谱下方。云雾默认关闭，避免遮挡主视觉；星尘和网格用于提供空间尺度、纵深和运动参照。

## 性能策略

Lumisong 的性能策略集中在以下方面：

- 声音事件节点使用实例化渲染，避免每个节点独立 draw call。
- 播放循环只更新活跃窗口和必要状态，不全量重算声学数据。
- 文本标签只为部分高价值节点构建，避免大量文字造成排版和渲染负担。
- Renderer DPR 限制在较低范围，移动设备上避免像素数量过高。
- 后期效果合并到少量 pass，并通过亮度阈值限制 TrailPass 工作量。
- `AutoDegrade` 持续观察帧时间，在持续超预算时逐级降低 DPR、Bloom 强度或关闭 Bloom。
- 资源重建时调用 `dispose()` 释放几何、材质和文本对象，避免多次上传或形态切换产生显存泄漏。

当前渲染循环还限制在约 45 FPS 的节奏，目的是在视觉流畅度和移动端能耗之间取得平衡。

## 交互与原生壳

Web 应用提供底部 dock 控制区与进度条：支持播放/暂停、进度拖动（`seekTo` → `Playback.seek`）、全屏沉浸（`body.is-immersive`，隐藏品牌与 dock，保留进度条与居中播放键）、刷新、读图标注（频谱宽度色条与刻度，由 `guides` 开关控制）、云雾、连击、渐隐谢幕与余韵呼吸等。键盘快捷键：`Space` 或 `K` 切换播放/暂停；飞船驾驶模式下 `Space` 保留为加速键。

首次启动或版本迁移时，`appDefaults.ts` 写入以下默认设置（可通过设置面板与 `localStorage` 覆盖）：

| 设置 | 默认值 |
|---|---|
| 形态 `form` | `ripple`（涟漪） |
| 配色 `palette` | `magma`（融金） |
| 运镜 `cameraMode` | `director2`（智能运镜） |
| 渐隐谢幕 `fxFade` | 开 |
| 连击 `combo` | 开 |
| 读图标注 `guides` | 开 |
| 云雾 `mist` | 关 |
| 余韵呼吸 `fxBreath` | 关 |

**macOS 桌面壳**（`macos/`）用 SwiftUI 嵌入 `WKWebView`，通过自定义 `app://` scheme 加载打包后的 Web 产物；麦克风与文件选择走原生权限与 `NSOpenPanel`。当前 macOS 版播放仍走 Web `AudioContext` 时钟，与浏览器版共享同一套分析/渲染逻辑。

**iOS 壳**（`ios/`，仍在调试）在 `WKWebView` 中注册 `audioBridge` message handler；`web/src/audioNative.ts` 与 `playback.ts` 在检测到原生桥接时，把默认/外部文件的出声交给 `AVAudioPlayer`，进度由原生锚点回传并在 Web 侧外推，以保证移动端音频 I/O 稳定。录音回放等 buffer 源仍暂用 WebAudio 过渡路径。

## OpenSpec 治理（内部）

OpenSpec 是维护者本地的规格与变更治理体系，`openspec/` **不在公开仓库中**。本白皮书与源码构成对外技术说明；下列文档路径仅供克隆完整工作区的维护者参考，GitHub 读者无需也无法直接访问：

- `openspec/project.md`：项目上下文、技术栈、质量红线、协作规范。
- `openspec/design/data-schema.md`：数据契约。
- `openspec/design/visual-mapping.md`：视觉映射、归一化、颜色、大小、爆亮和形态契约。
- `openspec/design/art-direction.md`：空间容器、材质、HUD 和视觉语言。
- `openspec/specs/browser-analysis/spec.md`：上传分析、profile 判断和浏览器端分析要求。
- `openspec/specs/playback-flare/spec.md`：播放同步、爆亮、流光和尾迹要求。
- `openspec/specs/cinematic-fx/spec.md`：相机和后期效果要求。

开发模式为 flexible：小修可直接实现；用户可见流程、状态机、数据契约或阈值策略发生实质变化时，维护者先在 OpenSpec 层记录再改代码，以保持内部规格与实现一致。

## 安全、隐私与使用限制

Lumisong 是本地可视化工具。当前 Web 核心设计不要求把用户上传音频发送到服务器；分析在浏览器内完成。但使用者仍需注意：

- 上传、录制或演示的音频素材需自行确认版权和授权。
- 分析结果是视觉表达，不应作为医学、司法、版权鉴定、声学测量或其他严肃判定依据。
- 项目采用非商业授权，未经作者明确授权不得用于商业产品、商业演出、商业宣传、付费服务、SaaS 或企业内部商业流程。
- 麦克风录音需要浏览器权限，用户应明确知道何时开始和停止采集。

## 已知边界与后续方向

当前边界：

- 浏览器端分析受设备性能影响，长音频首次分析可能需要等待 WASM 初始化和全量特征计算。
- 音频 profile 是启发式判断，不是机器学习分类器。
- `SyllablesJson v1` 表达的是离散事件，不适合直接描述连续频谱或逐帧可视化。
- 三维位置当前以可解释特征轴为主，尚未启用高维音色嵌入。
- iOS 相关体验仍在调试阶段，本文不把它作为稳定技术能力描述。

后续方向：

- 引入更稳健的音乐段落和节拍结构分析。
- 为人声素材优化短句边界与连续语音聚合。
- 支持更高阶的 timbre embedding，把音色相近事件组织到更自然的空间邻域。
- 增加更清晰的导出能力，例如截图、短视频或可复现的可视化参数快照。
- 维护者继续在本地 OpenSpec 中记录重要变更，并与本白皮书、源码保持同步。

## 术语对照

| 中文 | English | 说明 |
|---|---|---|
| 三维声音图谱 | 3D audio atlas | 项目核心输出形态 |
| 声音事件 | audio event | 一个被 onset 分割出来的可视化单元 |
| 音频画像 | audio profile | 分析前对素材类型的启发式判断 |
| 频谱质心 | spectral centroid | 频率能量中心 |
| 频谱宽度 | spectral spread | 频谱围绕质心的离散程度 |
| 频谱平坦度 | spectral flatness | 接近噪声或音调结构的指标 |
| 均方根能量 | RMS energy | 响度/能量近似 |
| 起音点 | onset | 声音事件开始位置 |
| 基频/音高 | fundamental frequency / pitch | `f0Hz` 字段 |
| 音色 | timbre | 声音质感，不等同于音高 |
| 分位数归一化 | percentile normalization | 使用 p01-p99 做稳健归一化 |
| 自发光 | emissive lighting | 节点发光颜色和强度 |
| 辉光 | bloom | 高亮像素扩散形成光晕 |
| 流光拖尾 | light trail | 声音焦点移动留下的视觉轨迹 |
| 智能运镜 | adaptive camera choreography | 根据声音结构自动调整镜头 |
| 谢幕 | finale | 播放结束后的全图浮现与消散 |
| 巡航观察 | cruise observation | 播放结束后匀速观察图谱 |
| 原生壳 | native shell | 包裹 Web 产物的桌面或移动端容器；macOS 见 `macos/`，iOS 见 `ios/` |
| OpenSpec | OpenSpec | 维护者本地规格与变更治理（未公开分发） |
