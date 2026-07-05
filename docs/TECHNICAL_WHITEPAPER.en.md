# Lumisong Technical Whitepaper

## Executive Summary

Lumisong is a non-commercial 3D audio visualization project for personal learning, research, and creative exploration. It transforms music, voice, birdsong, and ambient sound into a set of discrete audio events, then renders those events as a playable spatial atlas.

The project is not an audio recognizer and not merely a media player. It is a translation layer from acoustic features to spatial visual experience. Each event carries onset time, duration, spectral centroid, spectral spread, spectral flatness, RMS energy, and optional pitch. The rendering layer uses these fields to drive node position, size, color, form, glow envelope, temporal connections, labels, light trails, and camera motion.

The current implementation is a browser-side analysis and rendering pipeline. After an audio file is uploaded, Lumisong first derives a lightweight audio profile, asks the user to confirm or override it, then runs Essentia.js v4 to extract acoustic features and produce a unified `SyllablesJson v1` data model. The 3D scene is rendered with Three.js WebGLRenderer using instanced geometry, HDR emissive lighting, bloom, light trails, deterministic layout, and adaptive camera choreography.

## Product Positioning

Lumisong is currently positioned as a 3D audio atlas tool, not as a birdsong-only analyzer. Early samples and parts of the visual language came from birdsong visualization, but the product now targets a broader set of materials: music, voice, birdsong, and ambient sound.

The system is designed around these boundaries:

- The input is local audio, not a species, instrument, or language recognition task.
- The output is a visualized audio-event sequence, not an acoustic measurement report, medical diagnosis, legal record, or copyright proof.
- After upload, users can review the automatically inferred audio profile and override it before formal analysis starts.
- The same analysis result can be observed through different forms, palettes, and camera modes without changing the underlying data.
- Every visual variable should be traceable to data. Missing pitch is represented as `null`, not fabricated.

During development, OpenSpec serves as a local specification and change-governance tool (`openspec/` is not published in the public repository). External readers should treat **this whitepaper and the source code** as the authoritative description of system behavior. OpenSpec helps maintainers align requirements, design, and implementation internally and is not distributed separately on GitHub.

## Design Principles

**Data truthfulness**

Rendered nodes must come from analysis results. When `f0Hz` is `null`, pitch labels are hidden. Normalization ranges come from `meta.ranges`; the renderer does not invent temporary feature ranges.

**Stable semantics**

Position, color, size, form, and playback flare carry distinct acoustic meanings. Switching form or palette should not mutate the underlying audio-event data or break playback and camera state.

**On-device loop**

Audio upload, analysis, atlas generation, playback synchronization, and visualization are completed in the browser. This reduces deployment complexity and avoids sending user audio to a remote service.

**Deterministic expression**

Layout jitter, form orientation, star-field placement, and similar pseudo-random details use deterministic hash functions based on event indices or seeds. The runtime does not depend on `Math.random` for visual state.

**Primary visual first**

The primary visual is the 3D audio-event atlas. Environment, grid, stars, mist, combo popups, light trails, and camera motion enhance depth and rhythm, but must not overtake the main visual.

## System Architecture

The Web core can be described as six layers:

```text
Audio input
  ↓
Audio profiling and analysis-parameter selection
  ↓
Browser-side acoustic analysis
  ↓
SyllablesJson v1 data contract
  ↓
Three.js 3D audio atlas
  ↓
Playback clock, flare envelope, light trail, camera choreography, and interaction
```

Main modules:

| Layer | Key modules | Responsibility |
|---|---|---|
| Application orchestration | `web/src/main.ts` | boot, default data loading, upload/recording flows, scene rebuild, UI events, render loop |
| Data contract | `web/src/data.ts` | `SyllablesJson`, `SyllableData`, `FeatureRange`, percentile normalization |
| Audio profiling | `web/src/audioProfile.ts` | bird/music/voice/generic profile inference and parameter selection |
| Formal analysis | `web/src/analyzerEssentia.ts` | Essentia.js v4 feature extraction, onset detection, pitch estimation, percentile ranges |
| Real-time preview | `web/src/analyzer.ts`, `web/src/streamAnalyzer.ts` | low-latency recording preview using Meyda and Pitchy |
| 3D mapping | `web/src/layout.ts`, `web/src/colormap.ts` | acoustic-feature mapping to position, palette, and legend |
| Audio-event atlas | `web/src/syllableCloud.ts`, `web/src/formBuilders.ts` | instanced nodes, forms, connections, labels, flares, finale state |
| Playback synchronization | `web/src/playback.ts`, `web/src/envelope.ts`, `web/src/visualTiming.ts` | playback clock, attack-decay envelope, fill timing |
| Camera system | `web/src/camera.ts`, `web/src/cameraDirector*.ts` | adaptive camera, orbit, free camera, flight-style camera modes |
| Scene and post-processing | `web/src/scene.ts`, `web/src/environment.ts`, `web/src/postfx.ts` | renderer, deep-space environment, grid, stars, bloom, TrailPass, degradation |
| Auxiliary visuals | `web/src/messenger.ts`, `web/src/combo.ts`, `web/src/legend.ts` | flying light marker, combo popups, spectral-spread legend |

The central architectural constraint is that the renderer consumes only `SyllablesJson`. It does not need to know whether the data came from the bundled sample, uploaded audio, or a recording reanalysis. This keeps the visualization system shared across all input paths.

## Data Contract

The core data model is `SyllablesJson v1`:

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

Field semantics:

- `t`: event onset time in seconds, the primary key for playback synchronization.
- `dur`: event duration, used by form filling, spire length, and rhythm logic.
- `centroidHz`: spectral centroid, the center of spectral energy.
- `spreadHz`: spectral spread, the dispersion of spectral energy and the default color-mapping feature.
- `flatness`: spectral flatness, used as a proxy for noise-like versus tonal structure.
- `rms`: RMS energy, used for radius, peak selection, and some camera decisions.
- `f0Hz`: fundamental frequency or pitch estimate; `null` when not reliable.
- `pos`: optional 3D coordinate for future external embeddings or preprocessing pipelines.

`meta.ranges` stores p01, p50, p99, min, and max for each feature. The renderer uses p01-p99 min-max normalization:

```text
norm(v, r) = clamp((v - r.p01) / (r.p99 - r.p01), 0, 1)
```

Percentiles are used instead of raw min/max to prevent outliers from compressing color, size, and layout variation. If `p99 - p01 <= 0`, normalization falls back to `0.5`.

## Audio Profiling and Analysis Strategy

After upload, Lumisong computes a lightweight summary over up to the first 20 seconds of PCM data, then derives an initial profile:

| Profile | Label | Target material | Parameter tendency |
|---|---|---|---|
| `bird` | Birdsong | high-frequency, short, dense calls or similar events | higher fmin/fmax, sensitive onset detection |
| `music` | Music | songs, instruments, rhythmically structured audio | lower pitch range, transient-aware segmentation |
| `voice` | Voice | speech, narration, voice-dominant material | lower pitch range, more conservative onset detection |
| `generic` | Generic | ambient, mixed, or uncertain audio | balanced fallback parameters |

The heuristic uses:

- zero-crossing rate
- transient rate
- dynamic range
- approximate low/mid/high energy ratios
- voiced stability

This is not semantic classification. It is an analysis-parameter preselection step. The UI shows the inferred result and lets the user override it. Formal analysis uses the final user-selected profile.

This design addresses a core limitation of birdsong-oriented defaults. Music often needs a lower pitch floor and more rhythm-aware segmentation. Voice needs fewer false cuts across continuous speech. Birdsong needs to retain high-frequency sensitivity and dense onset detection.

## Browser-Side Formal Analysis

Formal analysis is implemented in `analyzerEssentia.ts` with Essentia.js v4. The module uses lazy singleton initialization: on first analysis, it dynamically imports `essentia-wasm` and `essentia.js-core`, waits for the WASM runtime, and then reuses the initialized Essentia instance.

Current core parameters:

- `N_FFT = 2048`
- `HOP = 512`
- `PitchYinFFT` for pitch estimation
- spectral-flux onset detection
- onset peak-picking
- onset backtracking
- p01/p50/p99 percentile ranges

Pipeline:

1. Decode the uploaded file through `AudioContext.decodeAudioData`.
2. Use the first channel PCM and the actual sample rate.
3. Generate frames with Essentia `FrameGenerator`.
4. For each frame, compute Hann window, Spectrum, PowerSpectrum, Flatness, and RMS.
5. Compute spectral centroid and spectral spread from the spectrum.
6. Estimate pitch with `PitchYinFFT`, then filter by profile fmin/fmax and confidence.
7. Compute spectral flux from positive differences between adjacent spectra.
8. Normalize flux, pick peaks, and backtrack each peak to an energy valley as the onset.
9. Aggregate frame-level features between adjacent onsets into audio events.
10. Compute percentile ranges and emit `SyllablesJson v1`.

Aggregation favors robustness over excessive detail: centroid, spread, flatness, and pitch use segment medians; energy uses peak RMS. This reduces the effect of local noise while preserving event intensity.

## Real-Time Recording Preview

The real-time recording path is a preview pipeline rather than the final analysis pipeline.

It is composed of `Recorder`, `StreamAnalyzer`, and `analyzer.ts`:

- `Recorder` obtains microphone input through `getUserMedia`.
- It prefers `AudioWorklet` for PCM chunks and falls back to `ScriptProcessorNode` when needed.
- `StreamAnalyzer` keeps a 5-second sliding window.
- `analyzer.ts` uses Meyda for RMS, spectral centroid, spectral spread, and spectral flatness, and Pitchy for pitch.
- New events are deduplicated by onset time and appended incrementally to `SyllableCloud`.

When recording stops, the complete PCM buffer is reanalyzed through the formal analysis path to produce a more stable playback dataset. In other words, live recording prioritizes latency, while post-recording playback prioritizes consistency and accuracy.

## 3D Visual Mapping

The default layout uses interpretable axes:

```text
x = time
y = spectral centroid
z = tonality = 1 - normalized(flatness)
```

Implementation details:

- X represents temporal progression, based on `t / duration`.
- Y represents the spectral-energy center, based on `centroidHz`.
- Z represents tonality: flatter spectra are more noise-like, less-flat spectra are more tonal.
- Each axis gets deterministic jitter to reduce overlap.
- If `syllables[].pos` exists, external coordinates take precedence.

Color is mapped from normalized `spreadHz` through a selected palette. Built-in palettes include:

- Ice `ice`
- Magma `magma`
- Viridis `viridis`
- Amber `amber`

Node size is mapped from `rms`. Louder events have larger base radii; playback flares add a short-lived attack-decay scale gain.

Pitch labels come from `f0Hz`. When `f0Hz == null`, the label is hidden. Otherwise it is displayed in kilohertz format, such as `1.08K`.

## Form System

The same audio-event data can be rendered through five geometric forms:

| Key | Name | Visual meaning |
|---|---|---|
| `orb` | Glass Orb | colored glass shell plus emissive core; noise-like events may use faceted cores |
| `spire` | Light Spire | vertical light column; duration is emphasized through length |
| `ripple` | Ripple | horizontal torus; emphasizes expansion and rhythmic waves |
| `gem` | Gem | octahedral shard; emphasizes edges and transients |
| `planet` | Planet | spherical core plus tilted ring; creates a miniature celestial look |

Form switching rebuilds `SyllableCloud`, but should preserve playback state, camera state, and user settings. The key rule is “same semantics, different geometry”: position, color, flare, connections, and labels still follow the same data contract.

For performance, the node bodies use `InstancedUniformsMesh` and `InstancedMesh`. Geometry and materials are selected during construction; during playback, the loop updates only the required matrices, emissive colors, and lightweight state.

## Playback Synchronization and Flare Envelope

The synchronization anchor is `Playback.now()`. In the Web fallback path, it uses `AudioContext.currentTime` as the authoritative clock and computes the playhead from `startCtxTime + startOffset`. Visual timing does not use `Date.now` or UI timers to determine which event is sounding.

On every render frame, `SyllableCloud.updateFlare(now)` finds events within the active window and computes:

```text
dt = now - syllable.t

flare(dt) =
  0,                           dt < 0
  dt / ATTACK,                 0 <= dt < ATTACK
  exp(-(dt - ATTACK) / DECAY), dt >= ATTACK
```

Current constants:

- `ATTACK = 0.03s`
- `DECAY = 0.35s`
- `FLARE_WINDOW = 1.0s`
- base emissive intensity `EMISSIVE_BASE = 1.15`
- flare gain `EMISSIVE_GAIN = 5.5`
- scale gain `SCALE_GAIN = 1.6`

Before onset, nodes stay in a ghost state with lower brightness and smaller size. After onset, they enter the played state and fill into their stable form. This preserves transient impact while letting the completed atlas accumulate over time.

At the end of playback, if finale is enabled, the scene goes through full-atlas reveal, highlight hold, particle dissolve, and return to ghost state. After the finale, cruise observation lets the user continue examining the formed atlas.

## Light Trails, Bloom, and Post-Processing

The perception of “sound flying through space” comes from three layers:

1. The audio event itself flares.
2. `Messenger` moves a bright marker toward the strongest active event and leaves an additive trail.
3. `PostFX` uses HDR TrailPass and Bloom to turn high-intensity pixels into screen-space light trails.

Post-processing chain:

```text
RenderPass
  → TrailPass
  → BloomEffect
  → ToneMappingEffect
  → VignetteEffect
  → SMAAEffect (enabled at lower DPR)
```

`TrailPass` accumulates only HDR pixels above a brightness threshold, preventing the base scene from smearing. Trail parameters vary by form: thin and ring-like forms use shorter, sparser trails; orb-like forms can carry a more visible trail.

The renderer disables native antialiasing and uses SMAA only when useful. The effect composer uses HalfFloatType frame buffers to preserve HDR data for bloom and trails.

## Camera System

Main camera modes include:

- Adaptive Camera `director2`
- Uniform Orbit `orbit`
- Free Camera `free`
- Flight Pilot `pilot`
- Ship Cruise `ship`
- Breathing Orbit `breath`

The default is Adaptive Camera. Historical “director” naming is routed to the current adaptive camera and is no longer the primary user-facing name.

The adaptive camera has two strategies:

**Spatial strategy**

This works best when the audio atlas has meaningful spatial distribution. It derives phrase segments, active focus, short-term future context, and global center, then computes camera position and look-at targets with exponential smoothing.

**Compact strategy**

This works better for long voice recordings, music, or compact point clouds. The system scores duration, event count, density, voiced ratio, acoustic bandwidth, and spatial-axis compactness. If the compact profile is selected, the camera relies less on spatial-center changes and more on temporal segments, assigning shoulder angles, height, and distance per segment. This avoids a long fixed shot for dense materials.

After playback, cruise override can take over for stable observation. This changes only camera motion, not the underlying data.

## Scene Environment

`environment.ts` builds the spatial container:

- deep-space background `#05070d`
- exponential fog
- deterministic star field
- distance-faded ground grid
- optional low-opacity mist layer

The grid is fitted below the atlas after each data rebuild. Mist is off by default to avoid obscuring the main visual. Stars and grid lines provide scale, depth, and motion reference.

## Performance Strategy

Lumisong uses several performance controls:

- Audio-event nodes are rendered with instancing to avoid one draw call per node.
- The playback loop updates only active windows and necessary state.
- Text labels are built only for selected high-value nodes.
- Renderer DPR is capped to avoid excessive pixel cost on mobile screens.
- Post-processing is consolidated into a small number of passes.
- TrailPass is brightness-thresholded so normal scene pixels do not accumulate.
- `AutoDegrade` observes frame time and progressively lowers DPR, bloom intensity, or bloom availability when performance remains over budget.
- Scene rebuild paths call `dispose()` for geometry, materials, and text objects to avoid GPU memory leaks.

The render loop also targets a moderated frame cadence around 45 FPS, balancing visual continuity and energy use.

## Interaction and Native Shell

The Web app exposes a bottom dock and progress bar: play/pause, seeking (`seekTo` → `Playback.seek`), fullscreen immersion (`body.is-immersive`, hiding brand and dock while keeping the progress bar and centered play control), refresh, spectral legend (spread color bar and tick labels, toggled by `guides`), mist, combo popups, finale fade, and breathing glow. Keyboard shortcuts: `Space` or `K` toggles playback; in Flight Pilot mode, `Space` remains bound to throttle.

On first launch or settings migration, `appDefaults.ts` seeds these defaults (overridable via the settings panel and `localStorage`):

| Setting | Default |
|---|---|
| Form `form` | `ripple` |
| Palette `palette` | `magma` |
| Camera `cameraMode` | `director2` (Adaptive Camera) |
| Finale fade `fxFade` | on |
| Combo `combo` | on |
| Legend `guides` | on |
| Mist `mist` | off |
| Breathing glow `fxBreath` | off |

The **macOS desktop shell** (`macos/`) embeds the packaged Web build in `WKWebView`, served through a custom `app://` scheme handler; microphone and file picking use native permission and `NSOpenPanel`. macOS playback currently uses the Web `AudioContext` clock, sharing the same analysis and rendering path as the browser build.

The **iOS shell** (`ios/`, still under debugging) registers an `audioBridge` message handler in `WKWebView`. When detected, `web/src/audioNative.ts` and `playback.ts` delegate playback of bundled or external files to `AVAudioPlayer`, with progress anchored by native callbacks and extrapolated on the Web side for stable mobile audio I/O. Buffer sources such as recording playback still use a WebAudio fallback path for now.

## OpenSpec Governance (Internal)

OpenSpec is a maintainer-local specification and change-governance system; `openspec/` is **not included in the public repository**. This whitepaper and the source code form the external technical reference. The paths below are for maintainers with a full working copy only—GitHub readers cannot access them directly:

- `openspec/project.md`: project context, technical stack, quality requirements, collaboration rules.
- `openspec/design/data-schema.md`: data contract.
- `openspec/design/visual-mapping.md`: visual mapping, normalization, color, size, flare, and form contracts.
- `openspec/design/art-direction.md`: spatial container, materials, HUD, and visual language.
- `openspec/specs/browser-analysis/spec.md`: upload analysis, profile inference, and browser-side analysis requirements.
- `openspec/specs/playback-flare/spec.md`: playback synchronization, flare, light trail, and trail behavior.
- `openspec/specs/cinematic-fx/spec.md`: camera and post-processing requirements.

Development mode is flexible: small fixes may land directly; substantive changes to user-visible workflows, state machines, data contracts, or threshold strategies should be recorded in OpenSpec before code changes, so internal specs stay aligned with implementation.

## Safety, Privacy, and Usage Limits

Lumisong is a local visualization tool. The current Web-core design does not require user audio to be uploaded to a server; analysis runs in the browser. Users should still observe the following:

- They are responsible for copyright and authorization of uploaded, recorded, or demonstrated audio.
- Analysis output is visual expression and should not be used for medical, legal, copyright, forensic, or precision acoustic decisions.
- The project is licensed for non-commercial use only unless the author grants explicit permission.
- Microphone recording requires browser permission and should be clearly initiated and stopped by the user.

## Known Boundaries and Future Work

Current boundaries:

- Browser-side analysis is device-dependent; long audio may take time due to WASM initialization and full feature extraction.
- Audio profile inference is heuristic, not a trained classifier.
- `SyllablesJson v1` represents discrete events, not continuous spectrogram frames.
- 3D positioning currently uses interpretable feature axes; high-dimensional timbre embedding is not enabled yet.
- iOS experience is still being debugged and is not described as a stable technical capability in this document.

Possible directions:

- More robust music section and beat-structure analysis.
- Better phrase-boundary handling for voice.
- Higher-order timbre embedding so similar-sounding events occupy more natural spatial neighborhoods.
- Export capabilities such as screenshots, short videos, or reproducible visualization parameter snapshots.
- Maintainers continue to record substantive changes in local OpenSpec and keep this whitepaper and the source code aligned.

## Terminology

| Chinese | English | Notes |
|---|---|---|
| 三维声音图谱 | 3D audio atlas | Core output of the project |
| 声音事件 | audio event | One visual unit segmented by onset detection |
| 音频画像 | audio profile | Heuristic material-type inference before analysis |
| 频谱质心 | spectral centroid | Center of spectral energy |
| 频谱宽度 | spectral spread | Dispersion of the spectrum around the centroid |
| 频谱平坦度 | spectral flatness | Indicator of noise-like versus tonal structure |
| 均方根能量 | RMS energy | Approximation of loudness or energy |
| 起音点 | onset | Start point of an audio event |
| 基频/音高 | fundamental frequency / pitch | The `f0Hz` field |
| 音色 | timbre | Sound quality, distinct from pitch |
| 分位数归一化 | percentile normalization | Robust p01-p99 normalization |
| 自发光 | emissive lighting | Node color and glow intensity |
| 辉光 | bloom | Glow around bright pixels |
| 流光拖尾 | light trail | Visual trace left by the moving sound focus |
| 智能运镜 | adaptive camera choreography | Camera motion driven by audio structure |
| 谢幕 | finale | End-of-playback reveal and dissolve |
| 巡航观察 | cruise observation | Stable post-playback observation |
| 原生壳 | native shell | Native wrapper around Web assets; macOS in `macos/`, iOS in `ios/` |
| OpenSpec | OpenSpec | Maintainer-local specification and change governance (not publicly distributed) |
