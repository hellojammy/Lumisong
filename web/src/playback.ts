// 播放器：进度时钟权威源（spec playback-flare）
// iOS 混合架构 A1：原生模式下出声交 AVAudioEngine，进度由原生锚点 + 本地外推（替代 ctx.currentTime）。
// 回退模式（非原生壳 / 暂未原生化的 buffer 源）仍走 WebAudio，保持桌面与过渡可用。
import {
  hasNativeAudio, nativePlayDefault, nativePlay, nativePause, nativeSeek,
  nativeNow, nativeIsPlaying, nativeBusy, setLocalPaused, isRecordingReady,
} from './audioNative';

/** 播放源：
 *  bundle   = 原生从 App 包内直读（默认音频）；
 *  external = 原生持 UIDocumentPicker 选中文件 URL；Web 分析完成后回到 0 秒对齐开播；
 *  buffer   = WebAudio 出声（过渡：录音回放） */
export type PlaybackSource =
  | { kind: 'bundle'; file: string }
  | { kind: 'external' }
  | { kind: 'recording' }
  | { kind: 'buffer' };

export class Playback {
  private src: AudioBufferSourceNode | null = null;
  private startCtxTime = 0;
  private startOffset = 0;
  private _playing = false;
  /** external 源：首次接管时把原生播放头拉回 0，避免分析耗时造成声画错位 */
  private _externalStarted = false;

  readonly ctx: AudioContext;
  readonly buffer: AudioBuffer;
  private readonly source: PlaybackSource;
  /** 是否走原生出声（bundle 源 + 运行在原生壳内） */
  private readonly useNative: boolean;

  constructor(ctx: AudioContext, buffer: AudioBuffer, source: PlaybackSource = { kind: 'buffer' }) {
    this.ctx = ctx;
    this.buffer = buffer;
    this.source = source;
    this.useNative = source.kind !== 'buffer' && hasNativeAudio();
  }

  get playing(): boolean {
    return this.useNative ? nativeIsPlaying() : this._playing;
  }

  get busy(): boolean {
    return this.useNative ? nativeBusy() : false;
  }

  get duration(): number {
    return this.buffer.duration;
  }

  /** 当前播放进度（秒）——原生模式走锚点外推，回退模式走 ctx 权威时钟 */
  now(): number {
    if (this.useNative) {
      return Math.min(nativeNow(), this.duration);
    }
    return this._playing
      ? this.startOffset + (this.ctx.currentTime - this.startCtxTime)
      : this.startOffset;
  }

  /** 必须在用户手势回调内调用（BV-sh-01 由 main.ts 保证） */
  async play(): Promise<boolean> {
    if (this.useNative) {
      if (nativeBusy()) return false;
      if (this.startOffset >= this.duration - 0.01) this.startOffset = 0;
      if (this.source.kind === 'bundle' && this.startOffset <= 0.01) {
        // 默认音频：原生从 Bundle 直读开播
        nativePlayDefault(this.source.file);
      } else if (this.source.kind === 'external' && !this._externalStarted) {
        // 上传：原生选中文件后可能已播放了一段；Web 分析完成时必须回到 0 秒，
        // 让解析出的音节时间轴和实际声音重新对齐。
        this.startOffset = 0;
        nativeSeek(0);
        nativePlay();
        this._externalStarted = true;
      } else if (this.source.kind === 'recording' && !isRecordingReady()) {
        // 录音分片传输尚未完成，忽略播放请求
        return false;
      } else {
        // 暂停后续播 / 末尾重播 / 录音回放首次播放
        nativePlay();
      }
      return true;
    }
    if (this._playing) return true;
    if (this.startOffset >= this.duration - 0.01) this.startOffset = 0; // 014：停在末尾时重播从头
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    if (this.ctx.state !== 'running') return false;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.ctx.destination);
    this.startCtxTime = this.ctx.currentTime;
    src.start(0, this.startOffset);
    this.src = src;
    this._playing = true;
    return true;
  }

  pause(): void {
    if (this.useNative) {
      if (nativeBusy()) return;
      this.startOffset = nativeNow();
      nativePause();
      return;
    }
    if (!this._playing) return;
    this.startOffset = this.now();
    this.stopSource();
  }

  /**
   * 自然播完（BV-sh-05 由 main.ts 主循环触发）：停在末尾、不归零——
   * 全图保持点亮状态供观察（014）；再次 play() 自动从头开始。
   */
  finish(): void {
    if (this.useNative) {
      this.startOffset = this.duration;
      setLocalPaused(this.duration);
      return;
    }
    this.stopSource();
    this.startOffset = this.duration;
  }

  /** 跳转到指定秒（保留接口，当前主流程未用） */
  seek(pos: number): void {
    this.startOffset = Math.max(0, Math.min(pos, this.duration));
    if (this.useNative) {
      nativeSeek(this.startOffset);
    }
  }

  private stopSource(): void {
    this._playing = false;
    if (this.src) {
      try {
        this.src.stop();
      } catch {
        /* 已停止 */
      }
      this.src.disconnect();
      this.src = null;
    }
  }
}
