// 原生音频桥（Web 侧，iOS 混合架构 A1）
// 所有出声交给原生 AVAudioEngine（见 ios/Lumisong/AudioBridge.swift）。
// Web 仅发播放/控制指令，并接收原生回传的播放进度锚点，用本地时钟外推进度。

interface AudioBridgeMessage {
  cmd: 'playDefault' | 'pickAndPlay' | 'play' | 'pause' | 'seek'
    | 'recStart' | 'recChunk' | 'recEnd';
  file?: string;
  pos?: number;
  id?: string;
  data?: string;
}

type WebkitWindow = Window & {
  webkit?: {
    messageHandlers?: {
      audioBridge?: { postMessage: (msg: AudioBridgeMessage) => void };
    };
  };
  __onAudioAnchor?: (anchorMs: number, offset: number, rate: number) => void;
  __onAudioState?: (state: string, offset: number) => void;
  __onUploadFile?: (name: string, base64: string) => void;
};

/** base64 → ArrayBuffer（接收原生回传的上传文件 bytes） */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** 当前播放锚点：原生回传，Web 本地外推用 */
interface Anchor {
  anchorMs: number; // 原生回传时刻（epoch ms）
  offset: number;   // 该时刻的播放位置（秒）
  rate: number;     // 播放速率（0=暂停，1=播放）
}

let anchor: Anchor = { anchorMs: performance.timeOrigin, offset: 0, rate: 0 };
export type NativeAudioState =
  | 'idle'
  | 'starting'
  | 'started'
  | 'playing'
  | 'pausing'
  | 'paused'
  | 'ended'
  | 'stopped'
  | 'seeked'
  | 'error';
let lastState: NativeAudioState = 'idle';

function isActivePlaybackState(state: NativeAudioState): boolean {
  return state === 'started' || state === 'playing';
}

/** 是否运行在原生壳内（存在 audioBridge message handler） */
export function hasNativeAudio(): boolean {
  const w = window as WebkitWindow;
  return !!w.webkit?.messageHandlers?.audioBridge;
}

function post(msg: AudioBridgeMessage): void {
  const w = window as WebkitWindow;
  w.webkit?.messageHandlers?.audioBridge?.postMessage(msg);
}

/** 安装原生→Web 的锚点 / 状态回调（应用启动时调用一次） */
export function installNativeAudioCallbacks(onEnded: () => void): void {
  const w = window as WebkitWindow;
  w.__onAudioAnchor = (anchorMs, offset, rate) => {
    anchor = { anchorMs, offset, rate };
  };
  w.__onAudioState = (state, offset) => {
    const next = state as NativeAudioState;
    lastState = next === 'started' ? 'playing' : next;
    anchor = { anchorMs: Date.now(), offset, rate: isActivePlaybackState(next) ? 1 : 0 };
    if (next === 'paused') recordingPending = false;
    if (next === 'ended') onEnded();
  };
}

/** 安装原生→Web 的上传文件回调：原生选中音频后回传 bytes 供 Web 可视化分析 */
export function installUploadCallback(onUpload: (name: string, bytes: ArrayBuffer) => void): void {
  const w = window as WebkitWindow;
  w.__onUploadFile = (name, base64) => {
    onUpload(name, base64ToArrayBuffer(base64));
  };
}

/** 触发原生文件选择器（UIDocumentPicker），选中后原生直接播放并回传 bytes */
export function nativePickAndPlay(): void {
  lastState = 'starting';
  post({ cmd: 'pickAndPlay' });
}

/** AudioBuffer → 16-bit PCM WAV（单声道，回放够用，体积比 Float32 小一半） */
function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const sr = buffer.sampleRate;
  const ch0 = buffer.getChannelData(0);
  const n = ch0.length;
  const out = new ArrayBuffer(44 + n * 2);
  const view = new DataView(out);
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);      // PCM chunk size
  view.setUint16(20, 1, true);       // PCM format
  view.setUint16(22, 1, true);       // mono
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);  // byte rate
  view.setUint16(32, 2, true);       // block align
  view.setUint16(34, 16, true);      // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, ch0[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return out;
}

/** ArrayBuffer 切片 → base64（按 chunk 避免栈溢出） */
function chunkToBase64(bytes: Uint8Array): string {
  let bin = '';
  const sub = 0x8000;
  for (let i = 0; i < bytes.length; i += sub) {
    bin += String.fromCharCode(...bytes.subarray(i, i + sub));
  }
  return btoa(bin);
}

/** 录音回放：编码 WAV → 整段 base64 传原生落盘（不自动播放，用户点播放才播）。
 *  一次性传输避免分片 base64 padding 导致的数据错乱。 */
let recordingPending = false;

export function nativePlayRecording(buffer: AudioBuffer): Promise<void> {
  const wav = new Uint8Array(encodeWav(buffer));
  const id = `rec-${Date.now()}`;
  recordingPending = true;
  // 整段 base64 一次性传输（录音通常几秒~几十秒，不会太大）
  const b64 = chunkToBase64(wav);
  post({ cmd: 'recStart', id });
  post({ cmd: 'recChunk', id, data: b64 });
  post({ cmd: 'recEnd', id });
  return (async () => {
    // 等待原生 emit paused（prepare 完成）；超时 5s 兜底
    const start = Date.now();
    while (recordingPending && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 50));
    }
  })();
}

/** 录音文件是否已在原生侧 prepare 完成（可播放） */
export function isRecordingReady(): boolean {
  return !recordingPending;
}

/** 当前外推播放位置（秒）——本地时钟外推，定期被原生锚点校正 */
export function nativeNow(): number {
  const elapsed = anchor.rate > 0 ? (Date.now() - anchor.anchorMs) / 1000 : 0;
  return anchor.offset + elapsed * anchor.rate;
}

/** 当前原生音频状态 */
export function nativeState(): NativeAudioState {
  return lastState;
}

/** 是否处于异步命令中间态，期间应忽略重复点击 */
export function nativeBusy(): boolean {
  return lastState === 'starting' || lastState === 'pausing';
}

/** 是否正在/即将播放：starting 也视为播放，避免快点重复发 play */
export function nativeIsPlaying(): boolean {
  return lastState === 'starting' || (anchor.rate > 0 && lastState !== 'ended' && lastState !== 'stopped');
}

// —— 控制指令 ——

/** 播放 App Bundle 内默认音频（原生从 WebContent/data/<file> 直读） */
export function nativePlayDefault(file: string): void {
  if (nativeBusy()) return;
  lastState = 'starting';
  post({ cmd: 'playDefault', file });
}

export function nativePlay(): void {
  if (nativeBusy()) return;
  lastState = 'starting';
  post({ cmd: 'play' });
}

export function nativePause(): void {
  if (nativeBusy()) return;
  lastState = 'pausing';
  post({ cmd: 'pause' });
}

export function nativeSeek(pos: number): void {
  post({ cmd: 'seek', pos });
}

/** 暂停态本地置位（供 Playback 在外推未及更新时立即反映 UI） */
export function setLocalPaused(offset: number): void {
  anchor = { anchorMs: Date.now(), offset, rate: 0 };
}

/** 重置原生音频状态到初始（mount 新数据时调用，避免旧锚点驱动 flare 产生白球） */
export function resetNativeAudio(): void {
  lastState = 'idle';
  recordingPending = false;
  anchor = { anchorMs: performance.timeOrigin, offset: 0, rate: 0 };
}
