// 实时录音采集（022 / proposal 022-realtime-recording）
// getUserMedia → AudioWorklet（不可用时降级 ScriptProcessor）逐块吐 PCM。
// 同时累计完整 PCM，停止时拼成 AudioBuffer 供录后回放（复用上传的 Playback 路径）。

export interface RecorderCallbacks {
  /** 每到达一块 PCM（单声道 Float32，采样率 = ctx.sampleRate）回调一次 */
  onChunk: (pcm: Float32Array) => void;
  onError?: (err: Error) => void;
}

export class Recorder {
  private ctx: AudioContext;
  private cb: RecorderCallbacks;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silent: GainNode | null = null; // 静音汇点，stop 时须一并断开
  private chunks: Float32Array[] = []; // 累计完整 PCM
  private totalSamples = 0;
  private running = false;

  constructor(ctx: AudioContext, cb: RecorderCallbacks) {
    this.ctx = ctx;
    this.cb = cb;
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  /** 申请麦克风并开始采集。抛错由调用方区分权限拒绝 / 其他。 */
  async start(): Promise<void> {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(this.stream);

    const useWorklet = await this.trySetupWorklet();
    if (!useWorklet) this.setupScriptProcessor();

    this.running = true;
  }

  private async trySetupWorklet(): Promise<boolean> {
    if (!this.ctx.audioWorklet) return false;
    try {
      const code = `
        class PCMTap extends AudioWorkletProcessor {
          process(inputs) {
            const ch = inputs[0] && inputs[0][0];
            if (ch && ch.length) this.port.postMessage(ch.slice(0));
            return true;
          }
        }
        registerProcessor('pcm-tap', PCMTap);
      `;
      const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.worklet = new AudioWorkletNode(this.ctx, 'pcm-tap');
      this.worklet.port.onmessage = (e: MessageEvent<Float32Array>) => this.handlePcm(e.data);
      this.source!.connect(this.worklet);
      // worklet 不接 destination，避免回授；但需保持节点活跃，连到静音增益
      this.silent = this.ctx.createGain();
      this.silent.gain.value = 0;
      this.worklet.connect(this.silent).connect(this.ctx.destination);
      return true;
    } catch {
      this.worklet = null;
      return false;
    }
  }

  private setupScriptProcessor(): void {
    const BUF = 4096;
    this.processor = this.ctx.createScriptProcessor(BUF, 1, 1);
    this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
      this.handlePcm(e.inputBuffer.getChannelData(0).slice(0));
    };
    this.source!.connect(this.processor);
    this.silent = this.ctx.createGain();
    this.silent.gain.value = 0;
    this.processor.connect(this.silent).connect(this.ctx.destination);
  }

  private handlePcm(pcm: Float32Array): void {
    if (!this.running) return;
    this.chunks.push(pcm);
    this.totalSamples += pcm.length;
    try {
      this.cb.onChunk(pcm);
    } catch (err) {
      this.cb.onError?.(err as Error);
    }
  }

  /** 停止采集，释放设备，返回累计的完整录音 AudioBuffer（用于回放）。 */
  stop(): AudioBuffer {
    this.running = false;
    // 清回调：avoid worklet 处理器空转后仍 postMessage 占用主线程 / processor 主线程回调残留
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.port.close();
    }
    if (this.processor) this.processor.onaudioprocess = null;
    this.worklet?.disconnect();
    this.processor?.disconnect();
    this.silent?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.worklet = null;
    this.processor = null;
    this.silent = null;
    this.source = null;
    this.stream = null;

    const buffer = this.ctx.createBuffer(1, Math.max(1, this.totalSamples), this.ctx.sampleRate);
    const out = buffer.getChannelData(0);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    this.chunks = [];
    this.totalSamples = 0;
    return buffer;
  }
}
