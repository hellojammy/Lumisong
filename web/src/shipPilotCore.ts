import type { Vec3Tuple } from './shipCruiseCore';

export interface PilotInput {
  throttle: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export interface PilotState {
  center: Vec3Tuple;
  extent: { horizRadius: number; vertRadius: number };
  position: Vec3Tuple;
  forward: Vec3Tuple;
  speed: number;
  roll: number;
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

function len(v: Vec3Tuple): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vec3Tuple): Vec3Tuple {
  const l = len(v);
  return l > 0.0001 ? scale(v, 1 / l) : { x: 0, y: 0, z: -1 };
}

export function createPilotState(center: Vec3Tuple, extent: { horizRadius: number; vertRadius: number }): PilotState {
  return {
    center,
    extent,
    position: { x: center.x, y: center.y + extent.vertRadius * 0.18, z: center.z + extent.horizRadius * 0.92 },
    forward: { x: 0, y: 0, z: -1 },
    speed: 0.42,
    roll: 0,
  };
}

export function updatePilotState(state: PilotState, input: PilotInput, dt: number): PilotState {
  const turn = 1.25 * dt;
  const yaw = clamp(input.yaw, -1, 1) * turn;
  const pitch = clamp(input.pitch, -1, 1) * turn * 0.72;
  const f0 = state.forward;
  const yawed = normalize({
    x: f0.x * Math.cos(yaw) - f0.z * Math.sin(yaw),
    y: f0.y + pitch,
    z: f0.x * Math.sin(yaw) + f0.z * Math.cos(yaw),
  });
  const maxDist = state.extent.horizRadius * 2.15 + state.extent.vertRadius;
  const toCenter = sub(state.center, state.position);
  const dist = len(toCenter);
  const boundK = clamp((dist - maxDist * 0.72) / (maxDist * 0.28), 0, 1);
  const forward = normalize(add(scale(yawed, 1 - boundK * 0.55), scale(normalize(toCenter), boundK * 0.55)));
  const targetSpeed = 0.34 + clamp(input.throttle, -1, 1) * 0.58 + boundK * 0.12;
  const speed = clamp(state.speed + (targetSpeed - state.speed) * (1 - Math.exp(-dt * 2.6)), 0.18, 1.28);
  let position = add(state.position, scale(forward, speed * dt * Math.max(state.extent.horizRadius, 2.4) * 0.42));
  const newDist = len(sub(position, state.center));
  if (newDist > maxDist) {
    const dir = normalize(sub(position, state.center));
    position = add(state.center, scale(dir, maxDist));
  }
  return {
    ...state,
    position,
    forward,
    speed,
    roll: clamp(state.roll + (clamp(input.roll + input.yaw * 0.45, -1, 1) * 0.36 - state.roll) * (1 - Math.exp(-dt * 3.4)), -0.42, 0.42),
  };
}
