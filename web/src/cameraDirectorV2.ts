import * as THREE from 'three';
import { CameraDirector, type DirectorPose } from './cameraDirector';
import type { SyllablesJson } from './data';
import {
  adaptivePosition,
  assignCompactShots,
  buildCompactSegments,
  classifyAdaptiveProfile,
  type CompactSegment,
  type CompactShot,
} from './cameraDirectorAdaptiveCore';

interface PlayheadPoint {
  t: number;
  dur: number;
  pos: THREE.Vector3;
}

const PLAYHEAD_HOLD = 0.72;
const FUTURE_BLEND = 0.08;
const SHOT_BLEND_WINDOW = 1.15;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const smoothstep = (x: number): number => x * x * (3 - 2 * x);

function toVec3(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function blendShot(a: CompactShot, b: CompactShot, k: number): CompactShot {
  if (k <= 0) return a;
  if (k >= 1) return b;
  return {
    scope: k < 0.55 ? a.scope : b.scope,
    shoulder: a.shoulder + (b.shoulder - a.shoulder) * k,
    height: a.height + (b.height - a.height) * k,
    radiusScale: a.radiusScale + (b.radiusScale - a.radiusScale) * k,
    lead: a.lead + (b.lead - a.lead) * k,
  };
}

export class CameraDirectorV2 {
  readonly adaptiveKind: 'spatial' | 'compact';
  readonly adaptiveScore: number;
  private readonly spatial: CameraDirector;
  private readonly segments: CompactSegment[];
  private readonly shots: CompactShot[];
  private readonly playhead: PlayheadPoint[];
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(data: SyllablesJson) {
    const profile = classifyAdaptiveProfile(data);
    this.adaptiveKind = profile.kind;
    this.adaptiveScore = profile.score;
    this.spatial = new CameraDirector(data);
    this.segments = buildCompactSegments(data);
    this.shots = assignCompactShots(this.segments);
    this.playhead = data.syllables.map((s) => ({
      t: s.t,
      dur: s.dur,
      pos: toVec3(adaptivePosition(s, data.meta)),
    }));
  }

  poseAt(
    playTime: number,
    baseR: number,
    center: THREE.Vector3,
    vertR: number,
    focus: THREE.Vector3 | null,
    out: DirectorPose,
  ): DirectorPose {
    if (this.adaptiveKind !== 'compact' || this.segments.length === 0) {
      return this.spatial.poseAt(playTime, baseR, center, vertR, focus, out);
    }
    const activeIndex = this.segmentIndexAt(playTime);
    const active = this.segments[activeIndex];
    const next = this.segments[Math.min(activeIndex + 1, this.segments.length - 1)];
    const activeShot = this.shots[activeIndex];
    const nextShot = this.shots[Math.min(activeIndex + 1, this.shots.length - 1)];
    const prepStart = Math.max(active.start, active.end - SHOT_BLEND_WINDOW);
    const k = active === next ? 0 : smoothstep(clamp((playTime - prepStart) / SHOT_BLEND_WINDOW, 0, 1));
    const shot = blendShot(activeShot, nextShot, k);
    const playFocus = focus ?? this.playheadFocus(playTime);

    out.target.copy(shot.scope === 'overview' ? center : toVec3(active.center));
    this.tmp.copy(toVec3(next.center)).sub(out.target).multiplyScalar(FUTURE_BLEND * k);
    out.target.add(this.tmp);
    if (playFocus) {
      out.target.lerp(playFocus, shot.scope === 'overview' ? 0.2 : 0.72);
      this.tmp.copy(toVec3(active.center)).sub(playFocus).multiplyScalar(0.12);
      out.target.add(this.tmp);
    }
    this.tmp.copy(toVec3(active.direction)).multiplyScalar(Math.min(shot.scope === 'overview' ? 0.18 : 0.38, 0.1 + active.radius * shot.lead));
    out.target.add(this.tmp);

    const flowAngle = Math.atan2(active.direction.z, active.direction.x);
    const cameraAngle = flowAngle + Math.PI * 0.5 + shot.shoulder;
    const focusDist = playFocus ? this.tmp2.copy(playFocus).sub(toVec3(active.center)).length() : 0;
    const radius = baseR * shot.radiusScale
      + Math.min(active.radius, 3.2) * 0.24
      + Math.min(focusDist, 3.5) * 0.14;
    out.position.set(
      out.target.x + radius * Math.cos(cameraAngle),
      Math.max(center.y + vertR * shot.height, out.target.y + vertR * 0.2),
      out.target.z + radius * Math.sin(cameraAngle),
    );
    return out;
  }

  private segmentIndexAt(t: number): number {
    let idx = 0;
    for (let i = 0; i < this.segments.length; i++) {
      if (t >= this.segments[i].start) idx = i;
      if (t < this.segments[i].end) break;
    }
    return idx;
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
}
