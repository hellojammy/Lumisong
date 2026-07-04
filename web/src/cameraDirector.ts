import * as THREE from 'three';
import { norm, type SyllableData, type SyllablesJson } from './data';
import { layoutPosition } from './layout';

type DirectorStyle = 'overview' | 'timeline' | 'overhead' | 'push';

interface Phrase {
  start: number;
  end: number;
  count: number;
  center: THREE.Vector3;
  peak: THREE.Vector3;
  direction: THREE.Vector3;
  radius: number;
  density: number;
  peakRms: number;
  spread: number;
  style: DirectorStyle;
}

interface PlayheadPoint {
  t: number;
  dur: number;
  pos: THREE.Vector3;
}

export interface DirectorPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

const MIN_HOLD = 2.4;
const MAX_PHRASE_DUR = 3.8;
const LOOK_AHEAD_MIN = 2.0;
const LOOK_AHEAD_MAX = 4.0;
const FUTURE_MAX_BLEND = 0.32;
const DIRECTOR_FRONT_ANGLE = Math.PI * 0.5;
const FOCUS_TARGET_WEIGHT = 0.55;
const FOCUS_CONTEXT_WEIGHT = 0.32;
const FOCUS_MIN_HEIGHT = 0.58;
const FOCUS_RADIUS_SCALE = 0.68;
const FOCUS_SHOULDER_ANGLE = 0.64;
const PLAYHEAD_HOLD = 0.65;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const smoothstep = (x: number): number => x * x * (3 - 2 * x);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const a = [...values].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function weightedCenter(
  items: SyllableData[],
  positions: THREE.Vector3[],
  meta: SyllablesJson['meta'],
): THREE.Vector3 {
  const out = new THREE.Vector3();
  let wSum = 0;
  for (const s of items) {
    const w = 0.35 + norm(s.rms, meta.ranges.rms) * 0.65;
    out.addScaledVector(positions[s.i], w);
    wSum += w;
  }
  return wSum > 0 ? out.multiplyScalar(1 / wSum) : out;
}

function phraseStyle(p: Omit<Phrase, 'style'>, globalDensity: number): DirectorStyle {
  if (p.density > globalDensity * 1.45 || p.count >= 18) return 'overhead';
  if (p.spread > 0.58 || p.radius > 2.2) return 'timeline';
  if (p.peakRms > 0.72 && p.density < globalDensity * 1.15) return 'push';
  return 'overview';
}

export class CameraDirector {
  private readonly phrases: Phrase[];
  private readonly playhead: PlayheadPoint[];
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(data: SyllablesJson) {
    const syllables = data.syllables;
    const gaps: number[] = [];
    for (let i = 1; i < syllables.length; i++) gaps.push(syllables[i].t - syllables[i - 1].t);
    const medianGap = median(gaps) || 0.2;
    const gapBreak = clamp(medianGap * 2.4, 0.35, 0.9);
    const globalDensity = syllables.length / Math.max(data.meta.duration, 0.1);
    const positions = syllables.map((s) => layoutPosition(s, data.meta).clone());
    this.playhead = syllables.map((s) => ({ t: s.t, dur: s.dur, pos: positions[s.i].clone() }));

    const chunks: SyllableData[][] = [];
    let chunk: SyllableData[] = [];
    for (const s of syllables) {
      const prev = chunk[chunk.length - 1];
      const startsNew = prev
        && (s.t - prev.t > gapBreak || s.t - chunk[0].t > MAX_PHRASE_DUR);
      if (startsNew) {
        chunks.push(chunk);
        chunk = [];
      }
      chunk.push(s);
    }
    if (chunk.length) chunks.push(chunk);

    this.phrases = chunks.map((items) => {
      const start = items[0].t;
      const last = items[items.length - 1];
      const end = Math.max(last.t + last.dur, start + 0.18);
      const center = weightedCenter(items, positions, data.meta);
      let radius = 0;
      let peak = items[0];
      let yMin = Infinity;
      let yMax = -Infinity;
      for (const s of items) {
        const p = positions[s.i];
        radius = Math.max(radius, p.distanceTo(center));
        if (s.rms > peak.rms) peak = s;
        yMin = Math.min(yMin, p.y);
        yMax = Math.max(yMax, p.y);
      }
      const firstPos = positions[items[0].i];
      const lastPos = positions[last.i];
      const direction = lastPos.clone().sub(firstPos);
      if (direction.lengthSq() < 0.01) direction.set(1, 0, 0);
      direction.normalize();
      const base = {
        start,
        end,
        count: items.length,
        center,
        peak: positions[peak.i].clone(),
        direction,
        radius,
        density: items.length / Math.max(end - start, 0.18),
        peakRms: norm(peak.rms, data.meta.ranges.rms),
        spread: clamp((yMax - yMin) / 5, 0, 1),
      };
      return { ...base, style: phraseStyle(base, globalDensity) };
    });
  }

  poseAt(
    playTime: number,
    baseR: number,
    center: THREE.Vector3,
    vertR: number,
    focus: THREE.Vector3 | null,
    out: DirectorPose,
  ): DirectorPose {
    if (this.phrases.length === 0) {
      out.position.set(center.x, center.y + vertR * 0.35, center.z + baseR * 1.12);
      out.target.copy(center);
      return out;
    }

    const active = this.phraseAt(playTime);
    const lead = clamp(LOOK_AHEAD_MIN + active.density * 0.08, LOOK_AHEAD_MIN, LOOK_AHEAD_MAX);
    const future = this.phraseAt(playTime + lead);
    const activeDur = Math.max(active.end - active.start, 0.18);
    const prepWindow = clamp(activeDur * 0.42, 0.45, 1.1);
    const prepStart = active.end - prepWindow;
    const blend = active === future
      ? 0
      : FUTURE_MAX_BLEND * smoothstep(clamp((playTime - prepStart) / prepWindow, 0, 1));
    const phrase = this.blendedPhrase(active, future, blend);
    const playFocus = focus ?? this.playheadFocus(playTime);

    const focusVec = playFocus ? this.tmp2.copy(playFocus).sub(phrase.center) : null;
    const focusDist = focusVec ? focusVec.length() : 0;
    const angle = this.angleFor(phrase);
    const radiusScale = phrase.style === 'push' ? 0.96
      : phrase.style === 'overhead' ? 1.18
      : phrase.style === 'timeline' ? 1.1
      : 1.14;
    let safeScale = phrase.density > active.density * 1.2 ? Math.max(radiusScale, 1.08) : radiusScale;
    let height = phrase.style === 'overhead' ? 0.72
      : phrase.style === 'timeline' ? 0.32
      : phrase.style === 'push' ? 0.18
      : 0.42;
    if (playFocus) {
      height = Math.max(height, FOCUS_MIN_HEIGHT);
      safeScale = Math.min(safeScale, FOCUS_RADIUS_SCALE);
    }

    out.target.copy(phrase.center);
    if (phrase.style === 'push') {
      out.target.lerp(phrase.peak, 0.18);
    }
    if (playFocus) {
      out.target.lerp(playFocus, FOCUS_TARGET_WEIGHT);
      this.tmp.copy(phrase.center).sub(playFocus).multiplyScalar(FOCUS_CONTEXT_WEIGHT);
      out.target.add(this.tmp);
      this.tmp.copy(phrase.direction).multiplyScalar(Math.min(0.55, 0.18 + phrase.radius * 0.08));
      out.target.add(this.tmp);
    }

    let finalAngle = angle;
    if (playFocus) {
      this.tmp.copy(out.target).sub(center);
      if (this.tmp.lengthSq() > 0.05) {
        const outward = Math.atan2(this.tmp.z, this.tmp.x);
        const phraseSide = phrase.direction.x * 0.7 + phrase.direction.z * 0.3;
        const shoulderSign = phraseSide >= 0 ? 1 : -1;
        const shoulder = shoulderSign * FOCUS_SHOULDER_ANGLE
          + clamp(phrase.direction.z * 0.08 - phrase.direction.x * 0.04, -0.12, 0.12);
        finalAngle = outward + shoulder;
      }
    }

    const phraseContext = Math.min(phrase.radius, 2.8) * (playFocus ? 0.3 : 0.18);
    const focusContext = Math.min(focusDist, 3.5) * (playFocus ? 0.16 : 0.26);
    const radius = baseR * safeScale + phraseContext + focusContext;
    const anchor = playFocus ? out.target : center;
    out.position.set(
      anchor.x + radius * Math.cos(finalAngle),
      Math.max(center.y + vertR * height, out.target.y + vertR * 0.24),
      anchor.z + radius * Math.sin(finalAngle),
    );
    return out;
  }

  private playheadFocus(t: number): THREE.Vector3 | null {
    let best: PlayheadPoint | null = null;
    let bestDt = Infinity;
    for (const p of this.playhead) {
      if (p.t > t + PLAYHEAD_HOLD) break;
      const end = p.t + Math.max(p.dur, 0.08) + PLAYHEAD_HOLD;
      if (t < p.t - 0.08 || t > end) continue;
      const dt = Math.abs(t - p.t);
      if (dt < bestDt) {
        best = p;
        bestDt = dt;
      }
    }
    return best?.pos ?? null;
  }

  private phraseAt(t: number): Phrase {
    let best = this.phrases[0];
    for (const p of this.phrases) {
      if (t >= p.start - MIN_HOLD * 0.25) best = p;
      if (t < p.end) break;
    }
    return best;
  }

  private blendedPhrase(a: Phrase, b: Phrase, k: number): Phrase {
    if (k <= 0) return a;
    if (k >= 1) return b;
    const center = a.center.clone().lerp(b.center, k);
    const peak = a.peak.clone().lerp(b.peak, k);
    const direction = this.tmp.copy(a.direction).lerp(b.direction, k);
    if (direction.lengthSq() < 0.01) direction.set(1, 0, 0);
    direction.normalize();
    const density = a.density > b.density ? a.density : b.density;
    const style = a.style === 'overhead' || b.style === 'overhead'
      ? 'overhead'
      : k < 0.5 ? a.style : b.style;
    return {
      start: a.start,
      end: b.end,
      count: Math.max(a.count, b.count),
      center,
      peak,
      direction: direction.clone(),
      radius: Math.max(a.radius, b.radius),
      density,
      peakRms: Math.max(a.peakRms, b.peakRms),
      spread: Math.max(a.spread, b.spread),
      style,
    };
  }

  private angleFor(p: Phrase): number {
    const sideBias = clamp(p.direction.z * 0.22 - p.direction.x * 0.1, -0.26, 0.26);
    let base = DIRECTOR_FRONT_ANGLE + sideBias;
    if (p.style === 'timeline') base = DIRECTOR_FRONT_ANGLE + 0.08;
    if (p.style === 'overhead') base = DIRECTOR_FRONT_ANGLE - 0.16 + sideBias * 0.35;
    if (p.style === 'push') {
      this.tmp2.copy(p.peak).sub(p.center);
      if (this.tmp2.lengthSq() > 0.01) {
        base = DIRECTOR_FRONT_ANGLE + clamp(this.tmp2.z * 0.08 - this.tmp2.x * 0.035, -0.18, 0.18);
      }
    }
    return base;
  }
}
