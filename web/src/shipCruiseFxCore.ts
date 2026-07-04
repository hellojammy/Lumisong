import type { Vec3Tuple } from './shipCruiseCore';

export interface ShipPoseTuple {
  position: Vec3Tuple;
  forward: Vec3Tuple;
  speed: number;
}

export interface FocusBiasedPose extends ShipPoseTuple {
  influence: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function add(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: Vec3Tuple, s: number): Vec3Tuple {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function len(v: Vec3Tuple): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vec3Tuple): Vec3Tuple {
  const l = len(v);
  return l > 0.0001 ? scale(v, 1 / l) : { x: 0, y: 0, z: 1 };
}

function mix(a: Vec3Tuple, b: Vec3Tuple, k: number): Vec3Tuple {
  return add(scale(a, 1 - k), scale(b, k));
}

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function focusBiasedShipPose(
  base: ShipPoseTuple,
  focus: Vec3Tuple | null,
  extent: { horizRadius: number; vertRadius: number },
  time: number,
): FocusBiasedPose {
  if (!focus) return { ...base, influence: 0 };

  const h = Math.max(extent.horizRadius, 1.2);
  const localRadius = clamp(h * 0.11, 0.48, 1.25);
  const toFocus = sub(focus, base.position);
  const dist = len(toFocus);
  const approach = normalize(toFocus);
  const tangent = normalize(cross({ x: 0, y: 1, z: 0 }, approach));
  const lift = { x: 0, y: Math.sin(time * 0.53) * Math.max(0.22, extent.vertRadius * 0.05), z: 0 };
  const flybySide = Math.sin(time * 0.41) > 0 ? 1 : -1;
  const flybyTarget = add(add(focus, scale(tangent, localRadius * flybySide)), lift);
  const nearK = 1 - clamp((dist - h * 0.16) / Math.max(h * 0.9, 1), 0, 1);
  const cruisePulse = 0.72 + Math.sin(time * 0.23 + 1.1) * 0.18;
  const influence = clamp((0.055 + nearK * 0.095 + base.speed * 0.012) * cruisePulse, 0.04, 0.18);
  const position = mix(base.position, flybyTarget, influence);
  const forward = normalize(mix(base.forward, normalize(sub(flybyTarget, base.position)), 0.08 + influence * 0.35));

  return {
    position,
    forward,
    speed: base.speed,
    influence,
  };
}

function distanceToSegment(a: Vec3Tuple, b: Vec3Tuple, p: Vec3Tuple): number {
  const ab = sub(b, a);
  const abLenSq = Math.max(dot(ab, ab), 0.000001);
  const t = clamp(dot(sub(p, a), ab) / abLenSq, 0, 1);
  const closest = add(a, scale(ab, t));
  return len(sub(p, closest));
}

export function shouldTriggerFlyby(
  prev: Vec3Tuple,
  next: Vec3Tuple,
  focus: Vec3Tuple | null,
  radius: number,
  time: number,
  lastTriggerTime: number,
  cooldown: number,
): boolean {
  if (!focus) return false;
  if (time - lastTriggerTime < cooldown) return false;
  return distanceToSegment(prev, next, focus) <= radius;
}
