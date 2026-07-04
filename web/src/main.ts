// 入口与主循环（spec app-shell / browser-analysis）
import './style.css';
import { loadData, type SyllablesJson } from './data';
import { createScene } from './scene';
import { SyllableCloud, FORMS, type FormKey } from './syllableCloud';
import { createPostFX, AutoDegrade } from './postfx';
import {
  CameraRig,
  CAMERA_MODES_PRIMARY,
  CAMERA_MODES_MORE,
  normalizeCameraMode,
  cameraModeLabel,
  isCameraModeInMore,
  type CameraMode,
  type CameraModeEntry,
} from './camera';
import { shouldUseFinaleCruise } from './cameraModePolicy';
import { CameraDirector } from './cameraDirector';
import { CameraDirectorV2 } from './cameraDirectorV2';
import { ShipCruise } from './shipCruise';
import { buildLegend } from './legend';
import { Messenger } from './messenger';
import { analyzeBuffer } from './analyzerEssentia';
import {
  AUDIO_PROFILES,
  classifyAudioBuffer,
  profileLabel,
  type AudioProfileGuess,
  type AudioProfileKey,
} from './audioProfile';
import { Recorder } from './recorder';
import { StreamAnalyzer } from './streamAnalyzer';
import { createEnvironment } from './environment';
import { setPalette, nextPalette, getPalette } from './colormap';
import { ComboPopups } from './combo';
import { Playback, type PlaybackSource } from './playback';
import { analyzeRhythmBuffer } from './rhythmBands';
import { RhythmFloor } from './rhythmFloor';
import {
  installNativeAudioCallbacks, installUploadCallback,
  hasNativeAudio, nativePickAndPlay, nativePlayRecording, resetNativeAudio,
} from './audioNative';

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const overlay = $('overlay');
const overlayMsg = $('overlayMsg');
const retryBtn = $<HTMLButtonElement>('retryBtn');
const playBtn = $<HTMLButtonElement>('playBtn');
const uploadBtn = $<HTMLButtonElement>('uploadBtn');
const recordBtn = $<HTMLButtonElement>('recordBtn');
const refreshBtn = $<HTMLButtonElement>('refreshBtn');
const paletteBtn = $<HTMLButtonElement>('paletteBtn');
const formBtn = $<HTMLButtonElement>('formBtn');
const cameraBtn = $<HTMLButtonElement>('cameraBtn');
const cameraMenu = $('cameraMenu');
const settingsBtn = $<HTMLButtonElement>('settingsBtn');
const settingsPanel = $('settingsPanel');
const mistRow = $<HTMLButtonElement>('mistRow');
const comboRow = $<HTMLButtonElement>('comboRow');
const fadeRow = $<HTMLButtonElement>('fadeRow');
const breathRow = $<HTMLButtonElement>('breathRow');
const floorRow = $<HTMLButtonElement>('floorRow');
const fxOn = (key: string): boolean => localStorage.getItem(key) === '1'; // 特效默认关（含地形频谱 rhythmFloor）
const fileInput = $<HTMLInputElement>('fileInput');
const titleEl = $('title');
const statsEl = $('stats');
const infoBtn = $<HTMLButtonElement>('infoBtn');
const infoPanel = $('infoPanel');
const profileDialog = $('profileDialog');
const profileGuessText = $('profileGuessText');
const profileOptions = $('profileOptions');
const profileConfirmBtn = $<HTMLButtonElement>('profileConfirmBtn');
const profileCancelBtn = $<HTMLButtonElement>('profileCancelBtn');

// 说明面板（010）：默认隐藏，点击开关
infoBtn.addEventListener('click', () => {
  infoPanel.hidden = !infoPanel.hidden;
  infoBtn.classList.toggle('active', !infoPanel.hidden);
});

/** uupm 式数据卡：蓝色大数字 + 灰色小标签（009） */
function renderStats(meta: SyllablesJson['meta']): void {
  const rate = (meta.nSyllables / meta.duration).toFixed(1);
  const items: [string, string][] = [
    [String(meta.nSyllables), '声音事件 EVENTS'],
    [`${meta.duration.toFixed(1)}s`, '时长 DURATION'],
    [`${(meta.sampleRate / 1000).toFixed(1)}k`, '采样率 RATE'],
    [`${rate}/s`, '密度 DENSITY'],
  ];
  statsEl.innerHTML = items
    .map(([num, lab]) => `<div class="stat"><span class="num">${num}</span><span class="lab">${lab}</span></div>`)
    .join('');
}
const canvas = $<HTMLCanvasElement>('gl') as unknown as HTMLCanvasElement;

let onRetry: () => void = () => window.location.reload();
retryBtn.addEventListener('click', () => onRetry());
refreshBtn.addEventListener('click', () => window.location.reload());

const showOverlay = (msg: string, retry = false): void => {
  overlayMsg.textContent = msg;
  retryBtn.hidden = !retry;
  overlay.classList.remove('hidden');
};
const hideOverlay = (): void => overlay.classList.add('hidden');

let audioUnlocked = false;
function unlockAudio(ctx: AudioContext): void {
  void ctx.resume();
  if (audioUnlocked) return;
  const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
  audioUnlocked = true;
}

function cloneAudioBuffer(ctx: AudioContext, src: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    out.copyToChannel(src.getChannelData(ch), ch);
  }
  return out;
}

function chooseProfile(guess: AudioProfileGuess): Promise<AudioProfileKey | null> {
  return new Promise((resolve) => {
    let selected: AudioProfileKey = guess.profile;
    const render = (): void => {
      profileGuessText.textContent = `初步识别为「${profileLabel(guess.profile)}」，你可以按素材实际内容修改。`;
      profileOptions.replaceChildren(...Object.values(AUDIO_PROFILES).map((profile) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `profile-option${profile.key === selected ? ' active' : ''}`;
        btn.innerHTML = `<strong>${profile.label}</strong><span>${profile.description}</span>`;
        btn.addEventListener('click', () => {
          selected = profile.key;
          render();
        });
        return btn;
      }));
    };
    const close = (value: AudioProfileKey | null): void => {
      profileDialog.hidden = true;
      profileConfirmBtn.onclick = null;
      profileCancelBtn.onclick = null;
      resolve(value);
    };
    profileConfirmBtn.onclick = () => close(selected);
    profileCancelBtn.onclick = () => close(null);
    render();
    profileDialog.hidden = false;
  });
}

async function boot(): Promise<void> {
  let ctx: AudioContext;
  try {
    setPalette(localStorage.getItem('palette') ?? 'ice'); // 006：配色持久化，默认冰蓝
    const data = await loadData('/data/syllables.json');
    const audioRes = await fetch(`/data/${data.meta.audioFile}`);
    if (!audioRes.ok) throw new Error(`音频加载失败：HTTP ${audioRes.status}`);
    const audioBytes = await audioRes.arrayBuffer();
    ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(audioBytes);

    // 原生音频回调（A1）：接收原生播放进度锚点 / 结束状态；播完由主循环 now()>=duration 兜底
    installNativeAudioCallbacks(() => {});

    // —— 单例：渲染器 / 场景 / 相机 / 信使 / 后期 / 降级 —— 跨数据重建复用
    const { renderer, scene, camera } = createScene(canvas);
    const env = createEnvironment(scene); // 深空容器（003）
    const messenger = new Messenger();
    scene.add(messenger.group);
    const fx = createPostFX(renderer, scene, camera);
    const degrade = new AutoDegrade(renderer, fx);

    // —— 可变当前态：随数据重建 ——
    let cloud: SyllableCloud | null = null;
    let rig: CameraRig | null = null;
    let ship: ShipCruise | null = null;
    let playback: Playback | null = null;
    let combo: ComboPopups | null = null;
    let rhythmFloor: RhythmFloor | null = null;
    let currentAudioBuffer: AudioBuffer | null = null; // 当前可视化的音频，供地形频谱按需重建
    let currentSpreadP99 = data.meta.ranges.spreadHz.p99;
    let currentData: SyllablesJson = data;
    // 015 形态：持久化 + 校验
    let currentForm: FormKey = (() => {
      const saved = localStorage.getItem('form');
      return FORMS.some((f) => f.key === saved) ? (saved as FormKey) : 'orb';
    })();
    let currentCameraMode: CameraMode = (() => {
      const saved = localStorage.getItem('cameraMode');
      const mode = normalizeCameraMode(saved);
      if (saved !== mode) localStorage.setItem('cameraMode', mode);
      return mode;
    })();
    let finaleCruisePending = false;

    const setBtn = (playing: boolean): void => {
      playBtn.innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
      playBtn.setAttribute('aria-label', playing ? 'pause' : 'play');
    };

    // —— 地形频谱（可选，设置开关，默认关；关时不入场景、不影响原效果）——
    const buildFloor = (): void => {
      if (!cloud || !currentAudioBuffer || rhythmFloor) return;
      rhythmFloor = new RhythmFloor(analyzeRhythmBuffer(currentAudioBuffer));
      rhythmFloor.fit(cloud.center, cloud.vertRadius, cloud.horizRadius);
      scene.add(rhythmFloor.group); // 并入主场景：随主相机 orbit/zoom
    };
    const removeFloor = (): void => {
      if (!rhythmFloor) return;
      scene.remove(rhythmFloor.group);
      rhythmFloor.dispose();
      rhythmFloor = null;
    };

    /** 用一份数据 + 音频（重）建可视化（BV-ba-06：先释放旧场景）
     *  source：默认音频走原生 bundle 直读；上传/录音回放暂走 buffer（WebAudio 过渡） */
    const mount = (
      d: SyllablesJson,
      audioBuffer: AudioBuffer,
      source: PlaybackSource = { kind: 'buffer' },
    ): void => {
      playback?.pause();
      // 重置原生音频锚点，避免旧播放的锚点残留驱动 flare 产生白球
      if (hasNativeAudio()) resetNativeAudio();
      if (cloud) {
        scene.remove(cloud.group);
        cloud.dispose();
      }
      rig?.dispose();
      if (ship) {
        scene.remove(ship.group);
        ship.dispose();
      }
      removeFloor();
      currentData = d;
      cloud = new SyllableCloud(d, currentForm);
      cloud.setEffects(fxOn('fxFade'), fxOn('fxBreath')); // 020
      scene.add(cloud.group);
      // 016 连击：阈值随这段录音的中位间隔自适应；017 开关持久化
      if (combo) scene.remove(combo.group);
      combo = new ComboPopups(cloud.medianGap);
      combo.setEnabled(localStorage.getItem('combo') !== '0');
      scene.add(combo.group);
      cloud.onSyllableStart = (_i, t, pos) => combo?.onSyllable(t, pos);
      env.fit(cloud.center, cloud.vertRadius, cloud.horizRadius); // 网格/云雾带随新数据归位
      currentAudioBuffer = audioBuffer;
      if (fxOn('rhythmFloor')) buildFloor(); // 仅在设置开启时显示地形频谱（默认关）
      ship = new ShipCruise(cloud.center, {
        horizRadius: cloud.horizRadius,
        vertRadius: cloud.vertRadius,
      }, `${d.meta.audioFile}-${d.meta.duration}-${d.meta.nSyllables}`);
      scene.add(ship.group);
      rig = new CameraRig(camera, cloud.center, {
        horizRadius: cloud.horizRadius,
        vertRadius: cloud.vertRadius,
      }, currentCameraMode, new CameraDirector(d), new CameraDirectorV2(d), ship, renderer.domElement);
      finaleCruisePending = false;
      rig.setCruiseOverride(false);
      playback = new Playback(ctx, audioBuffer, source);
      messenger.reset();
      currentSpreadP99 = d.meta.ranges.spreadHz.p99;
      buildLegend($('legend'), currentSpreadP99);
      renderStats(d.meta);
      fx.setTrail(currentForm); // 尾影随形态差异化
      messenger.setForm(currentForm); // 哨箭头随形态（尾影=头残影）
      setBtn(false);
    };

    // 默认音频走原生 bundle 直读（原生从 WebContent/data/<audioFile> 读播）
    mount(data, buffer, { kind: 'bundle', file: data.meta.audioFile });
    playBtn.disabled = false;
    uploadBtn.disabled = false;

    // —— 006 配色探索器：一键轮换、原地重着色、不打断播放 ——
    const syncPaletteUI = (): void => {
      paletteBtn.textContent = `◧ 配色 · ${getPalette().label}`;
    };
    syncPaletteUI();
    paletteBtn.disabled = false;
    paletteBtn.addEventListener('click', () => {
      const p = nextPalette();
      localStorage.setItem('palette', p.key);
      cloud?.recolor();
      buildLegend($('legend'), currentSpreadP99);
      syncPaletteUI();
    });

    // —— 015 形态切换：仅重建 cloud，播放/相机/环境不动 ——
    const syncFormUI = (): void => {
      const f = FORMS.find((x) => x.key === currentForm) ?? FORMS[0];
      formBtn.textContent = `◇ 形态 · ${f.label}`;
    };
    syncFormUI();
    formBtn.disabled = false;
    formBtn.addEventListener('click', () => {
      const i = FORMS.findIndex((x) => x.key === currentForm);
      currentForm = FORMS[(i + 1) % FORMS.length].key;
      localStorage.setItem('form', currentForm);
      if (cloud) {
        scene.remove(cloud.group);
        cloud.dispose();
        cloud = new SyllableCloud(currentData, currentForm);
        scene.add(cloud.group);
        // 019：暂停时 updateFlare 不再每帧驱动，重建后须主动灌一次进度并落定
        cloud.updateFlare(playback?.now() ?? 0);
        if (!playback?.playing) cloud.settle();
        cloud.setEffects(fxOn('fxFade'), fxOn('fxBreath')); // 020 特效随重建恢复
        cloud.onSyllableStart = (_i, t, pos) => combo?.onSyllable(t, pos); // 016 重接连击（灌进度之后，避免补发连击）
        rhythmFloor?.fit(cloud.center, cloud.vertRadius, cloud.horizRadius);
      }
      fx.setTrail(currentForm); // 尾影随形态差异化
      messenger.setForm(currentForm); // 哨箭头随形态（尾影=头残影）
      syncFormUI();
    });

    // —— 022 运镜：一级菜单 + 「更多」二级（默认收起）——
    let cameraMoreOpen = false;
    const closeCameraMenu = (): void => {
      cameraMenu.hidden = true;
      cameraMoreOpen = false;
      cameraBtn.classList.remove('active');
      cameraBtn.setAttribute('aria-expanded', 'false');
    };
    const selectCameraMode = (key: CameraMode): void => {
      currentCameraMode = key;
      localStorage.setItem('cameraMode', currentCameraMode);
      rig?.setMode(currentCameraMode);
      syncCameraUI();
      closeCameraMenu();
    };
    const makeCameraRow = (mode: CameraModeEntry, nested = false): HTMLButtonElement => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `row${nested ? ' nested' : ''}${mode.key === currentCameraMode ? ' active' : ''}`;
      row.textContent = mode.label;
      row.addEventListener('click', () => selectCameraMode(mode.key));
      return row;
    };
    const renderCameraMenu = (): void => {
      const moreToggle = document.createElement('button');
      moreToggle.type = 'button';
      moreToggle.className = `row more-toggle${cameraMoreOpen ? ' open' : ''}`;
      moreToggle.innerHTML = `更多<span class="chev">${cameraMoreOpen ? '▾' : '▸'}</span>`;
      moreToggle.addEventListener('click', (event) => {
        event.stopPropagation();
        cameraMoreOpen = !cameraMoreOpen;
        renderCameraMenu();
      });

      const moreGroup = document.createElement('div');
      moreGroup.className = 'camera-more';
      moreGroup.hidden = !cameraMoreOpen;
      moreGroup.append(...CAMERA_MODES_MORE.map((mode) => makeCameraRow(mode, true)));

      cameraMenu.replaceChildren(
        ...CAMERA_MODES_PRIMARY.map((mode) => makeCameraRow(mode)),
        moreToggle,
        moreGroup,
      );
    };
    const syncCameraUI = (): void => {
      cameraBtn.textContent = `◎ 运镜 · ${cameraModeLabel(currentCameraMode)}`;
      renderCameraMenu();
    };
    syncCameraUI();
    cameraBtn.disabled = false;
    cameraBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      settingsPanel.hidden = true;
      settingsBtn.classList.remove('active');
      const willOpen = cameraMenu.hasAttribute('hidden');
      cameraMenu.hidden = !willOpen;
      if (willOpen) {
        cameraMoreOpen = isCameraModeInMore(currentCameraMode);
        renderCameraMenu();
      }
      cameraBtn.classList.toggle('active', willOpen);
      cameraBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    cameraMenu.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', closeCameraMenu);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeCameraMenu();
    });

    // —— 017 设置折叠面板：开关类配置收纳（云雾 008 / 连击 016），形态与配色留在外 ——
    const syncRows = (): void => {
      const mistOn = env.mistEnabled();
      (mistRow.querySelector('.state') as HTMLElement).textContent = mistOn ? '开' : '关';
      mistRow.classList.toggle('off', !mistOn);
      const comboOn = combo?.isEnabled() ?? true;
      (comboRow.querySelector('.state') as HTMLElement).textContent = comboOn ? '开' : '关';
      comboRow.classList.toggle('off', !comboOn);
      // 020 两个特效行
      const fadeOn = fxOn('fxFade');
      (fadeRow.querySelector('.state') as HTMLElement).textContent = fadeOn ? '开' : '关';
      fadeRow.classList.toggle('off', !fadeOn);
      const breathOn = fxOn('fxBreath');
      (breathRow.querySelector('.state') as HTMLElement).textContent = breathOn ? '开' : '关';
      breathRow.classList.toggle('off', !breathOn);
      const floorOn = fxOn('rhythmFloor');
      (floorRow.querySelector('.state') as HTMLElement).textContent = floorOn ? '开' : '关';
      floorRow.classList.toggle('off', !floorOn);
    };
    env.setMist(localStorage.getItem('mist') !== '0');
    syncRows();
    settingsBtn.disabled = false;
    settingsBtn.addEventListener('click', () => {
      closeCameraMenu();
      settingsPanel.hidden = !settingsPanel.hidden;
      settingsBtn.classList.toggle('active', !settingsPanel.hidden);
    });
    mistRow.addEventListener('click', () => {
      env.setMist(!env.mistEnabled());
      localStorage.setItem('mist', env.mistEnabled() ? '1' : '0');
      syncRows();
    });
    comboRow.addEventListener('click', () => {
      const on = !(combo?.isEnabled() ?? true);
      combo?.setEnabled(on);
      localStorage.setItem('combo', on ? '1' : '0');
      syncRows();
    });
    const fxToggle = (key: string): void => {
      localStorage.setItem(key, fxOn(key) ? '0' : '1');
      cloud?.setEffects(fxOn('fxFade'), fxOn('fxBreath'));
      syncRows();
    };
    fadeRow.addEventListener('click', () => fxToggle('fxFade'));
    breathRow.addEventListener('click', () => fxToggle('fxBreath'));
    floorRow.addEventListener('click', () => {
      const on = !fxOn('rhythmFloor');
      localStorage.setItem('rhythmFloor', on ? '1' : '0');
      if (on) buildFloor(); else removeFloor(); // 即时显隐，无需重载
      syncRows();
    });

    // —— 播放控制 ——
    playBtn.addEventListener('click', () => {
      void (async () => {
        if (!playback) return;
        if (playback.busy) return; // 原生播放/暂停确认中，忽略快点，避免状态交错
        if (!playback.playing) {
          unlockAudio(ctx); // iOS/Safari：用户手势内同步解锁 WebAudio 输出（BV-sh-01）
          finaleCruisePending = false;
          rig?.setCruiseOverride(false);
          const started = await playback.play();
          setBtn(started);
        } else {
          playback.pause();
          cloud?.settle();    // 019：爆亮落定，画面真正「停」下来
          messenger.reset();
          setBtn(false);
        }
      })();
    });

    // —— 上传：浏览器内分析 → 重建 → 自动播放（spec browser-analysis）——
    const ingest = async (
      bytes: ArrayBuffer,
      name: string,
      source: PlaybackSource = { kind: 'buffer' },
    ): Promise<number | null> => {
      unlockAudio(ctx);
      showOverlay('识别音频类型…');
      const audioBuffer = await ctx.decodeAudioData(bytes.slice(0));
      const guess = classifyAudioBuffer(audioBuffer);
      hideOverlay();
      const profile = await chooseProfile(guess);
      if (!profile) return null;
      showOverlay('分析中… 0%');
      const d = await analyzeBuffer(
        audioBuffer,
        name,
        (p) => showOverlay(`分析中… ${Math.round(p * 100)}%`),
        profile,
      );
      mount(d, audioBuffer, source);
      titleEl.textContent = `${name} · ${profileLabel(profile)}`;
      hideOverlay();
      const started = await playback?.play() ?? false;
      setBtn(started);
      return d.meta.nSyllables;
    };
    const handleFile = (file: File): void => {
      void (async () => {
        try {
          showOverlay('分析中… 0%');
          await ingest(await file.arrayBuffer(), file.name);
        } catch (e) {
          onRetry = hideOverlay; // 失败保留当前画面，可重选
          showOverlay(e instanceof Error ? e.message : '分析失败', true);
        }
      })();
    };
    // 上传入口：原生壳内走 UIDocumentPicker（原生直读播放 + 回传 bytes 供可视化）；
    // 非原生环境（桌面浏览器）回退 Web <input type=file>。
    if (hasNativeAudio()) {
      installUploadCallback((name, bytes) => {
        void (async () => {
          try {
            showOverlay('分析中… 0%');
            // 原生已开播该文件，可视化走 external 源（Web 不再出声）
            await ingest(bytes, name, { kind: 'external' });
          } catch (e) {
            onRetry = hideOverlay;
            showOverlay(e instanceof Error ? e.message : '分析失败', true);
          }
        })();
      });
      uploadBtn.addEventListener('click', () => nativePickAndPlay());
    } else {
      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const f = fileInput.files?.[0];
        if (f) handleFile(f);
        fileInput.value = '';
      });
    }

    // —— 022 实时录音：边录边出（capacity=15000 预分配 + 滑窗增量 append）——
    const RECORD_CAPACITY = 15000;
    type RecState = 'idle' | 'recording';
    let recState: RecState = 'idle';
    let recorder: Recorder | null = null;
    let streamer: StreamAnalyzer | null = null;
    let recData: SyllablesJson | null = null;
    let chunkBuf: Float32Array[] = []; // 攒够 ~500ms 再分析一次
    let chunkSamples = 0;

    const setRecordBtn = (recording: boolean): void => {
      // 图标(●/■)与文字由 CSS ::before 按 .active 切换，这里只切状态类，避免 innerHTML 覆盖丢字
      recordBtn.classList.toggle('active', recording);
      recordBtn.setAttribute('aria-label', recording ? 'stop recording' : 'record');
    };

    const setNonRecordUIDisabled = (disabled: boolean): void => {
      playBtn.disabled = disabled;
      uploadBtn.disabled = disabled;
      paletteBtn.disabled = disabled;
      formBtn.disabled = disabled;
    };

    /** 录音模式建场景：空 cloud（capacity 预分配），无 playback；rig/ship/env 按初始小包络 fit */
    const mountRecording = (sr: number): void => {
      playback?.pause();
      if (cloud) { scene.remove(cloud.group); cloud.dispose(); }
      rig?.dispose();
      if (ship) { scene.remove(ship.group); ship.dispose(); }
      removeFloor();
      playback = null;

      recData = {
        meta: {
          version: 1, audioFile: '录音', sampleRate: sr, duration: 0, nSyllables: 0,
          analysis: { nFft: 2048, hop: 1024, onset: 'energy' },
          ranges: streamer!.snapshotRanges(),
        },
        syllables: [],
      };
      currentData = recData;
      cloud = new SyllableCloud(recData, currentForm, RECORD_CAPACITY);
      cloud.setEffects(fxOn('fxFade'), fxOn('fxBreath'));
      scene.add(cloud.group);
      if (combo) scene.remove(combo.group);
      combo = new ComboPopups(cloud.medianGap);
      combo.setEnabled(localStorage.getItem('combo') !== '0');
      scene.add(combo.group);
      cloud.onSyllableStart = (_i, t, pos) => combo?.onSyllable(t, pos);
      env.fit(cloud.center, cloud.vertRadius, cloud.horizRadius);
      ship = new ShipCruise(cloud.center, {
        horizRadius: cloud.horizRadius, vertRadius: cloud.vertRadius,
      }, 'recording');
      scene.add(ship.group);
      rig = new CameraRig(camera, cloud.center, {
        horizRadius: cloud.horizRadius, vertRadius: cloud.vertRadius,
      }, currentCameraMode, new CameraDirector(recData), new CameraDirectorV2(recData),
        ship, renderer.domElement);
      messenger.reset();
      renderStats(recData.meta);
      fx.setTrail('orb'); // 录音态强制 orb 形态（见 SyllableCloud capacity 分支）
      messenger.setForm('orb');
      titleEl.textContent = '录音中…';
    };

    const onRecordChunk = (pcm: Float32Array): void => {
      if (recState !== 'recording' || !streamer || !cloud || !recData) return;
      chunkBuf.push(pcm);
      chunkSamples += pcm.length;
      if (chunkSamples < streamer.sampleRate * 0.5) return; // 攒够 ~500ms
      const merged = new Float32Array(chunkSamples);
      let off = 0;
      for (const c of chunkBuf) { merged.set(c, off); off += c.length; }
      chunkBuf = [];
      chunkSamples = 0;

      const { newSyllables, ranges } = streamer.push(merged);
      recData.meta.ranges = ranges;
      recData.meta.duration = streamer.elapsedSec;
      if (newSyllables.length) {
        cloud.appendSyllables(newSyllables, recData.meta);
        recData.meta.nSyllables = cloud.syllableCount;
        renderStats(recData.meta);
        env.fit(cloud.center, cloud.vertRadius, cloud.horizRadius);
        rig?.setBounds(cloud.center, {
          horizRadius: cloud.horizRadius, vertRadius: cloud.vertRadius,
        });
        // 022 录音运镜：智能运镜随增长的时间线重建，使录音中也能自动成相
        if (currentCameraMode === 'director' || currentCameraMode === 'director2') {
          rig?.refreshDirectors(new CameraDirector(recData), new CameraDirectorV2(recData));
        }
      }
    };

    const startRecording = async (): Promise<void> => {
      try {
        // 复用主 ctx：iOS WKWebView 下新建 AudioContext 会抢占音频硬件路由，
        // 把回放用的主 ctx 挤成静默；全程单一 ctx 可彻底规避。
        unlockAudio(ctx);
        streamer = new StreamAnalyzer(ctx.sampleRate);
        recorder = new Recorder(ctx, { onChunk: onRecordChunk });
        recState = 'recording';
        mountRecording(ctx.sampleRate);
        await recorder.start();
        setRecordBtn(true);
        setNonRecordUIDisabled(true);
      } catch (e) {
        recState = 'idle';
        recorder = null;
        streamer = null;
        const denied = e instanceof DOMException
          && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
        showOverlay(denied ? '麦克风被拒绝，请前往系统设置开启后重试' : '录音启动失败', true);
        onRetry = hideOverlay;
        setRecordBtn(false);
        setNonRecordUIDisabled(false);
      }
    };

    const stopRecording = async (): Promise<void> => {
      if (!recorder || !streamer || !cloud || !recData) return;
      // 收尾：闭合滑窗末段 + 处理残余 chunk
      if (chunkSamples > 0) {
        const merged = new Float32Array(chunkSamples);
        let off = 0;
        for (const c of chunkBuf) { merged.set(c, off); off += c.length; }
        streamer.push(merged);
      }
      chunkBuf = [];
      chunkSamples = 0;
      const tail = streamer.flush();
      recData.meta.ranges = tail.ranges;
      recData.meta.duration = streamer.elapsedSec;
      if (tail.newSyllables.length) cloud.appendSyllables(tail.newSyllables, recData.meta);

      const recordedBuffer = recorder.stop();
      const audioBuffer = cloneAudioBuffer(ctx, recordedBuffer);
      // 录音复用主 ctx，stop() 已断开所有采集节点；绝不 close（会关闭整个 WKWebView 音频管线）。
      recState = 'idle';
      recorder = null;
      streamer = null;

      // Meyda 实时累积结果作为兜底（绝不丢录音）
      const fallback = recData;
      fallback.meta.duration = +audioBuffer.duration.toFixed(2);
      fallback.meta.nSyllables = fallback.syllables.length;

      // 录后用 essentia v4 对完整音频重析一遍（高精度回放）；失败/0 音节回退实时累积结果
      recordBtn.disabled = true;
      setNonRecordUIDisabled(true);
      showOverlay('分析中… 0%');
      let playData: SyllablesJson = fallback;
      try {
        playData = await analyzeBuffer(audioBuffer, '录音',
          (p) => showOverlay(`分析中… ${Math.round(p * 100)}%`));
      } catch {
        playData = fallback; // essentia 失败（如音节过少）回退实时累积结果
      }
      hideOverlay();

      // 原生壳内：录音 PCM 整段传原生落盘播放（recording 源，Web 不出声）；
      // 非原生环境回退 buffer（WebAudio 出声）。可视化数据统一用 essentia 重析结果。
      if (hasNativeAudio()) {
        void nativePlayRecording(audioBuffer);
        mount(playData, audioBuffer, { kind: 'recording' });
      } else {
        mount(playData, audioBuffer);
      }
      titleEl.textContent = '录音回放';
      recordBtn.disabled = false;
      setRecordBtn(false);
      setNonRecordUIDisabled(false);
    };

    recordBtn.disabled = false;
    recordBtn.addEventListener('click', () => {
      if (recState === 'idle') void startRecording();
      else void stopRecording();
    });
    // 回前台刷新麦克风权限状态（被拒后用户去系统设置开启）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && recState === 'idle') hideOverlay();
    });
    // 测试钩子：从 URL 走完整分析路径（供预览验证浏览器内管线）
    (window as unknown as { __analyzeUrl?: (u: string) => Promise<number | null> }).__analyzeUrl =
      async (url: string) => {
        const res = await fetch(url);
        return ingest(await res.arrayBuffer(), url.split('/').pop() ?? 'upload');
      };

    // —— 主循环：时钟 → 爆亮 → 信使 → 相机 → 降级 → render（BV-sh-03）——
    // B1 限帧（移动端能效）：rAF 每帧回调，但仅在达到目标帧间隔时才更新+render，
    // 跳过的帧只重新挂 rAF。压住 ProMotion 120Hz 满帧导致的 GPU 持续满载发烫。
    const FRAME_INTERVAL_MS = 1000 / 45; // 目标 45fps
    let last = performance.now();
    let lastFrame = last; // 上次实际渲染的时间戳（限帧门控用）
    let wall = 0; // 020：挂钟（呼吸/谢幕驱动，暂停也走）
    const loop = (ts: number): void => {
      if (ts - lastFrame < FRAME_INTERVAL_MS) {
        requestAnimationFrame(loop);
        return;
      }
      lastFrame = ts;
      const dt = Math.min((ts - last) / 1000, 0.1);
      last = ts;
      wall += dt;
      if (cloud && rig && recState === 'recording') {
        // 录音中：无 playback 时钟，球随 append 渐入出现；用最新落点+录制时长驱动智能运镜跟随生长
        cloud.updateEffects(wall);
        messenger.update(cloud.recMessengerFocus(), dt); // 022⑤：哨箭飞向新生球
        combo?.update(dt, camera);
        const recFocus = cloud.hasRecFocus ? cloud.recFocus : null;
        rig.update(dt, recFocus, streamer?.elapsedSec ?? 0);
      } else if (cloud && playback && rig) {
        const t = playback.now();
        if (playback.playing && t >= playback.duration) {
          playback.finish(); // 014：停在末尾保持全图点亮，再按播放从头
          cloud.settle();    // 019：终曲落定
          finaleCruisePending = shouldUseFinaleCruise(currentCameraMode) && cloud.startFinale(); // 020：自由运镜不接管为巡航
          rig.setCruiseOverride(shouldUseFinaleCruise(currentCameraMode) && !finaleCruisePending);
          messenger.reset();
          setBtn(false);
        }
        if (playback.playing) cloud.updateFlare(t); // 019：暂停时不再驱动爆亮
        cloud.updateEffects(wall); // 020：呼吸/渐隐/谢幕（暂停也驱动）
        if (finaleCruisePending && !cloud.isFinaleActive()) {
          finaleCruisePending = false;
          rig.setCruiseOverride(shouldUseFinaleCruise(currentCameraMode));
        }
        messenger.update(playback.playing && cloud.hasFocus ? cloud.focus : null, dt);
        combo?.update(dt, camera); // 016 连击浮字动画
        rhythmFloor?.update(t, dt, playback.playing);
        rig.update(dt, playback.playing && cloud.hasFocus ? cloud.focus : null, t);
      }
      env.update(dt); // 云雾漂移（008）
      degrade.tick(dt * 1000);
      fx.composer.render(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      fx.setSize(window.innerWidth, window.innerHeight);
    });

    onRetry = hideOverlay;
    hideOverlay();
  } catch (e) {
    showOverlay(e instanceof Error ? e.message : '加载失败', true);
  }
}

void boot();
