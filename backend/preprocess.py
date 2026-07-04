#!/usr/bin/env python3
"""
音频 -> syllables.json 离线预处理（方案 A）。

把一段音频切分成可视化声音事件，并为每个事件提取声学特征，输出符合
DEVELOPMENT.md §6 数据契约的 JSON，供 Three.js 前端加载。

用法:
    python -m venv .venv && source .venv/bin/activate
    pip install "librosa==0.11.0" soundfile numpy
    python backend/preprocess.py reference/birdsong_44k.wav -o public/data/syllables.json

默认参数沿用最初鸟鸣样本的调参依据，见 DEVELOPMENT.md §3.3 / §7.3：
  - 绝不把采样率降到 16k（会丢约 31% 音节、压低高频）；保留原始 >=44.1k。
  - pyin fmin/fmax 提到鸟鸣频段（默认 1500/10000）。
  - onset 用 backtrack 贴合音节真实起点，wait 不宜过大（密集 chirp）。
"""
import argparse
import json
import sys

import numpy as np
import librosa


def percentiles(a, scale=1.0):
    """返回 min/p01/p50/p99/max（按 scale 缩放后），用于前端归一化区间。"""
    a = np.asarray(a, dtype=float)
    a = a[np.isfinite(a)]
    if a.size == 0:
        return {"p01": 0.0, "p50": 0.0, "p99": 0.0, "min": 0.0, "max": 0.0}
    return {
        "p01": round(float(np.percentile(a, 1)) * scale, 4),
        "p50": round(float(np.percentile(a, 50)) * scale, 4),
        "p99": round(float(np.percentile(a, 99)) * scale, 4),
        "min": round(float(a.min()) * scale, 4),
        "max": round(float(a.max()) * scale, 4),
    }


def main():
    ap = argparse.ArgumentParser(description="Audio -> syllables.json")
    ap.add_argument("audio", help="输入音频（建议 >=44.1kHz）")
    ap.add_argument("-o", "--out", default="syllables.json", help="输出 JSON 路径")
    ap.add_argument("--n-fft", type=int, default=2048)
    ap.add_argument("--hop", type=int, default=512)
    ap.add_argument("--fmin", type=float, default=1500.0, help="pyin 最低基频（默认偏高频鸟鸣样本，可按音乐/语音调低）")
    ap.add_argument("--fmax", type=float, default=10000.0, help="pyin 最高基频（默认覆盖鸟鸣高频，可按素材调整）")
    ap.add_argument("--onset-delta", type=float, default=None,
                    help="onset 峰值阈值偏移，背景噪声大时调高")
    ap.add_argument("--onset-wait", type=int, default=2,
                    help="相邻 onset 最小间隔（帧），密集 chirp 不宜过大")
    ap.add_argument("--no-pyin", action="store_true",
                    help="跳过 pyin（快速预览；f0 全置 null）")
    args = ap.parse_args()

    # 保留原始采样率（sr=None）。高频素材降采样会丢失可视化事件。
    y, sr = librosa.load(args.audio, sr=None, mono=True)
    dur = len(y) / sr
    if sr < 44100:
        print(f"[warn] 采样率仅 {sr}Hz，Nyquist={sr/2:.0f}Hz 会截断高频内容，"
              f"声音事件数可能偏少。建议用 >=44.1kHz 原始音频。", file=sys.stderr)

    n_fft, hop = args.n_fft, args.hop
    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop))

    # 逐帧特征
    cent = librosa.feature.spectral_centroid(S=S, sr=sr)[0]
    bw = librosa.feature.spectral_bandwidth(S=S, sr=sr)[0]      # = spectral spread
    flat = librosa.feature.spectral_flatness(S=S)[0]            # tonality 代理 ∈ [0,1]
    rms = librosa.feature.rms(S=S, frame_length=n_fft)[0]

    # 逐帧 f0（pyin）。慢，可 --no-pyin 跳过。
    f0 = None
    if not args.no_pyin:
        fmax = min(args.fmax, sr / 2 - 100)
        f0, _, _ = librosa.pyin(y, sr=sr, fmin=args.fmin, fmax=fmax,
                                frame_length=n_fft, hop_length=hop)

    # onset 切分音节
    onset_kw = {"backtrack": True, "wait": args.onset_wait}
    if args.onset_delta is not None:
        onset_kw["delta"] = args.onset_delta
    onset_t = librosa.onset.onset_detect(y=y, sr=sr, hop_length=hop,
                                          units="time", **onset_kw)
    if len(onset_t) == 0:
        print("[error] 未检测到 onset，请检查音频或调低 --onset-delta", file=sys.stderr)
        sys.exit(1)

    n_frames = S.shape[1]
    bounds = np.concatenate([onset_t, [dur]])

    def frame_idx(t):
        return int(np.clip(round(t / dur * n_frames), 0, n_frames - 1))

    syllables = []
    for i in range(len(onset_t)):
        t0, t1 = float(bounds[i]), float(bounds[i + 1])
        a, b = frame_idx(t0), max(frame_idx(t1), frame_idx(t0) + 1)
        seg_rms = rms[a:b]
        if seg_rms.size == 0:
            continue
        rec = {
            "i": len(syllables),
            "t": round(t0, 3),
            "dur": round(t1 - t0, 3),
            "centroidHz": round(float(np.median(cent[a:b])), 1),
            "spreadHz": round(float(np.median(bw[a:b])), 1),
            "flatness": round(float(np.median(flat[a:b])), 5),
            "rms": round(float(np.max(seg_rms)), 4),
            "f0Hz": None,
        }
        if f0 is not None:
            seg_f0 = f0[a:b]
            voiced = seg_f0[np.isfinite(seg_f0)]
            rec["f0Hz"] = round(float(np.median(voiced)), 1) if voiced.size else None
        syllables.append(rec)

    # meta.ranges：用逐音节值（而非逐帧）算分位数，与前端使用口径一致
    def col(key):
        return [s[key] for s in syllables if s[key] is not None]

    ranges = {
        "centroidHz": percentiles(col("centroidHz")),
        "spreadHz": percentiles(col("spreadHz")),
        "flatness": percentiles(col("flatness")),
        "rms": percentiles(col("rms")),
        "f0Hz": percentiles(col("f0Hz")),
        "durSec": percentiles(col("dur")),
    }

    out = {
        "meta": {
            "version": 1,
            "audioFile": args.audio.split("/")[-1],
            "sampleRate": int(sr),
            "duration": round(dur, 2),
            "nSyllables": len(syllables),
            "analysis": {"nFft": n_fft, "hop": hop, "onset": "backtrack"},
            "ranges": ranges,
        },
        "syllables": syllables,
    }

    with open(args.out, "w") as f:
        json.dump(out, f, indent=1)

    print(f"[ok] sr={sr} dur={dur:.1f}s  syllables={len(syllables)}  "
          f"rate={len(syllables)/dur:.1f}/s  -> {args.out}")
    print(f"     centroid p99={ranges['centroidHz']['p99']:.0f}Hz  "
          f"spread p99={ranges['spreadHz']['p99']:.0f}Hz  "
          f"f0 p50={ranges['f0Hz']['p50']:.0f}Hz")


if __name__ == "__main__":
    main()
