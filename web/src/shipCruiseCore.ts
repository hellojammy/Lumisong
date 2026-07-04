export type ShipManeuver =
  | '远景巡航'
  | '掠边飞行'
  | '穿云通道'
  | '俯冲拉起'
  | '横向扫掠'
  | '回望星云';

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface ShipLeg {
  kind: ShipManeuver;
  start: number;
  duration: number;
  speed: number;
  roll: number;
  p0: Vec3Tuple;
  p1: Vec3Tuple;
  p2: Vec3Tuple;
  p3: Vec3Tuple;
}

export interface ShipRoute {
  duration: number;
  legs: ShipLeg[];
}

export interface ShipRouteSample {
  position: Vec3Tuple;
  forward: Vec3Tuple;
  speed: number;
  roll: number;
  legKind: ShipManeuver;
}

interface Extent {
  horizRadius: number;
  vertRadius: number;
}

const MANEUVERS: ShipManeuver[] = [
  '穿云通道',
  '掠边飞行',
  '穿云通道',
  '横向扫掠',
  '掠边飞行',
  '远景巡航',
  '穿云通道',
  '俯冲拉起',
  '掠边飞行',
  '穿云通道',
  '回望星云',
  '横向扫掠',
];

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function hash01(seed: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= Math.imul(n + 101, 374761393);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function add(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: Vec3Tuple, s: number): Vec3Tuple {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function len(v: Vec3Tuple): number {
  return Math.hypot(v.x, v.y, v.z);
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v: Vec3Tuple): Vec3Tuple {
  const l = len(v);
  return l > 0.0001 ? scale(v, 1 / l) : { x: 1, y: 0, z: 0 };
}

function radial(angle: number): Vec3Tuple {
  return { x: Math.cos(angle), y: 0, z: Math.sin(angle) };
}

function tangent(angle: number, sign: number): Vec3Tuple {
  return { x: -Math.sin(angle) * sign, y: 0, z: Math.cos(angle) * sign };
}

function point(center: Vec3Tuple, angle: number, radius: number, y: number): Vec3Tuple {
  const r = radial(angle);
  return {
    x: center.x + r.x * radius,
    y: center.y + y,
    z: center.z + r.z * radius,
  };
}

function constrainToCloud(pos: Vec3Tuple, center: Vec3Tuple, extent: Extent, maxH: number): Vec3Tuple {
  const dx = pos.x - center.x;
  const dz = pos.z - center.z;
  const r = Math.hypot(dx, dz);
  const k = r > maxH ? maxH / r : 1;
  const maxY = Math.max(extent.vertRadius, 0.8) * 0.92;
  return {
    x: center.x + dx * k,
    y: center.y + clamp(pos.y - center.y, -maxY, maxY),
    z: center.z + dz * k,
  };
}

function bezier(a: Vec3Tuple, b: Vec3Tuple, c: Vec3Tuple, d: Vec3Tuple, t: number): Vec3Tuple {
  const ab = add(scale(a, 1 - t), scale(b, t));
  const bc = add(scale(b, 1 - t), scale(c, t));
  const cd = add(scale(c, 1 - t), scale(d, t));
  const abbc = add(scale(ab, 1 - t), scale(bc, t));
  const bccd = add(scale(bc, 1 - t), scale(cd, t));
  return add(scale(abbc, 1 - t), scale(bccd, t));
}

function targetFor(kind: ShipManeuver, center: Vec3Tuple, extent: Extent, angle: number, leg: number, seed: string): Vec3Tuple {
  const h = Math.max(extent.horizRadius, 1.2);
  const v = Math.max(extent.vertRadius, 0.8);
  const wobble = (hash01(seed, leg * 7 + 1) - 0.5) * 0.34;
  if (kind === '穿云通道') return point(center, angle + Math.PI + wobble, h * (0.22 + hash01(seed, leg * 7 + 2) * 0.32), (hash01(seed, leg * 7 + 3) - 0.5) * v * 0.42);
  if (kind === '掠边飞行') return point(center, angle + 0.95 + wobble, h * (0.74 + hash01(seed, leg * 7 + 2) * 0.26), (hash01(seed, leg * 7 + 3) - 0.5) * v * 0.72);
  if (kind === '俯冲拉起') return point(center, angle + 1.15 + wobble, h * (0.62 + hash01(seed, leg * 7 + 2) * 0.36), (hash01(seed, leg * 7 + 3) > 0.5 ? -0.52 : 0.72) * v);
  if (kind === '横向扫掠') return point(center, angle + Math.PI * 0.78 + wobble, h * (0.78 + hash01(seed, leg * 7 + 2) * 0.28), (hash01(seed, leg * 7 + 3) - 0.5) * v * 0.48);
  if (kind === '回望星云') return point(center, angle + 0.72 + wobble, h * (1.55 + hash01(seed, leg * 7 + 2) * 0.35), (0.32 + hash01(seed, leg * 7 + 3) * 0.42) * v);
  return point(center, angle + 0.82 + wobble, h * (1.32 + hash01(seed, leg * 7 + 2) * 0.36), (hash01(seed, leg * 7 + 3) - 0.35) * v * 0.62);
}

function speedFor(kind: ShipManeuver, seed: string, i: number): number {
  const jitter = hash01(seed, i * 5 + 9) * 0.18;
  if (kind === '穿云通道') return 1.08 + jitter;
  if (kind === '掠边飞行') return 0.9 + jitter;
  if (kind === '横向扫掠') return 0.82 + jitter;
  if (kind === '俯冲拉起') return 0.74 + jitter;
  if (kind === '回望星云') return 0.36 + jitter;
  return 0.42 + jitter;
}

function durationFor(kind: ShipManeuver, seed: string, i: number): number {
  const r = hash01(seed, i * 5 + 12);
  if (kind === '穿云通道') return 4.2 + r * 2.4;
  if (kind === '掠边飞行') return 5.2 + r * 2.6;
  if (kind === '回望星云') return 7.2 + r * 3.2;
  if (kind === '远景巡航') return 7.5 + r * 3.5;
  return 5.8 + r * 3.1;
}

export function buildShipRoute(seedValue: string | number, center: Vec3Tuple, extent: Extent): ShipRoute {
  const seed = String(seedValue);
  const h = Math.max(extent.horizRadius, 1.2);
  const startAngle = hash01(seed, 1) * Math.PI * 2;
  let p0 = point(center, startAngle, h * (0.82 + hash01(seed, 2) * 0.25), extent.vertRadius * 0.12);
  let incoming = normalize(sub(center, p0));
  let angle = startAngle;
  let time = 0;
  const legs: ShipLeg[] = [];
  for (let i = 0; i < MANEUVERS.length; i++) {
    const kind = MANEUVERS[(i + Math.floor(hash01(seed, 33) * 3)) % MANEUVERS.length];
    const sign = hash01(seed, i * 11 + 4) > 0.5 ? 1 : -1;
    angle += sign * (0.42 + hash01(seed, i * 11 + 5) * 0.62);
    let p3 = targetFor(kind, center, extent, angle, i, seed);
    let chord = normalize(sub(p3, p0));
    let alignment = dot(chord, incoming);
    if (alignment < -0.35) {
      const cruiseDir = normalize(add(scale(incoming, 0.86), scale(tangent(angle, sign), 0.28)));
      const travel = h * (0.78 + hash01(seed, i * 17 + 21) * 0.32);
      p3 = constrainToCloud(add(p0, scale(cruiseDir, travel)), center, extent, h * 1.06);
      chord = normalize(sub(p3, p0));
      alignment = dot(chord, incoming);
    }
    const dist = Math.max(len(sub(p3, p0)), h * 0.65);
    const out = normalize(add(scale(tangent(angle, sign), 0.72), scale(sub(center, p3), kind === '回望星云' ? 0.4 : 0.18)));
    const inheritK = alignment > 0.35 ? 0.68 : alignment > -0.25 ? 0.78 : 0.9;
    const startDir = normalize(add(scale(chord, 1 - inheritK), scale(incoming, inheritK)));
    const endDir = normalize(add(scale(chord, 0.72), scale(out, 0.28)));
    const p1 = add(p0, scale(startDir, dist * (alignment < -0.25 ? 0.3 : 0.4)));
    const p2 = sub(p3, scale(endDir, dist * 0.38));
    const speed = speedFor(kind, seed, i);
    const duration = durationFor(kind, seed, i);
    legs.push({
      kind,
      start: time,
      duration,
      speed,
      roll: clamp(sign * speed * 0.22, -0.26, 0.26),
      p0,
      p1,
      p2,
      p3,
    });
    p0 = p3;
    incoming = endDir;
    time += duration;
  }
  return { duration: time, legs };
}

function legAt(route: ShipRoute, time: number): { leg: ShipLeg; rawU: number; wrapped: number } {
  const wrapped = ((time % route.duration) + route.duration) % route.duration;
  let leg = route.legs[route.legs.length - 1];
  for (const item of route.legs) {
    if (wrapped >= item.start && wrapped < item.start + item.duration) {
      leg = item;
      break;
    }
  }
  const rawU = clamp((wrapped - leg.start) / leg.duration, 0, 1);
  return { leg, rawU, wrapped };
}

function positionAt(route: ShipRoute, time: number): Vec3Tuple {
  const { leg, rawU } = legAt(route, time);
  return bezier(leg.p0, leg.p1, leg.p2, leg.p3, rawU);
}

export function sampleShipRoute(route: ShipRoute, time: number): ShipRouteSample {
  const { leg, rawU, wrapped } = legAt(route, time);
  const position = positionAt(route, wrapped);
  const lookAhead = Math.min(0.34, Math.max(0.16, leg.duration * 0.035));
  const forward = normalize(sub(positionAt(route, wrapped + lookAhead), position));
  const speedPulse = 0.88 + Math.sin(rawU * Math.PI) * 0.12;
  return {
    position,
    forward,
    speed: leg.speed * speedPulse,
    roll: leg.roll * Math.sin(rawU * Math.PI),
    legKind: leg.kind,
  };
}
