// 运镜相机（spec cinematic-fx：匀速运镜 + 三种可切换预设，BV-fx-05）
// 计时用 rAF 累计挂钟（与播放进度无关，暂停时继续环绕）。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CameraDirector, DirectorPose } from './cameraDirector';
import type { CameraDirectorV2 } from './cameraDirectorV2';
import type { ShipCruise } from './shipCruise';
import {
  DEFAULT_DIRECTOR_SMOOTH_POS,
  DEFAULT_DIRECTOR_SMOOTH_TARGET,
  lerpDirectorFocus,
} from './cameraDirectorRig.ts';

const ORBIT_PERIOD = 45;
const OMEGA = (2 * Math.PI) / ORBIT_PERIOD;

const FIT_MARGIN = 1.32;

export type CameraMode = 'director' | 'director2' | 'ship' | 'pilot' | 'free' | 'orbit' | 'breath';

export interface CameraModeEntry {
  key: CameraMode;
  label: string;
}

/** 运镜一级菜单（按优先级排序） */
export const CAMERA_MODES_PRIMARY: CameraModeEntry[] = [
  { key: 'director2', label: '智能运镜' },
  { key: 'orbit', label: '匀速运镜' },
  { key: 'free', label: '自由运镜' },
  { key: 'pilot', label: '飞船驾驶' },
];

/** 运镜二级菜单（收纳在「更多」下，默认收起） */
export const CAMERA_MODES_MORE: CameraModeEntry[] = [
  { key: 'ship', label: '飞船穿梭' },
  { key: 'breath', label: '呼吸环绕' },
];

export const CAMERA_MODES: CameraModeEntry[] = [
  ...CAMERA_MODES_PRIMARY,
  ...CAMERA_MODES_MORE,
];

const REMOVED_CAMERA_MODES = new Set(['reactive', 'cinematic', 'director']);

export function normalizeCameraMode(saved: string | null): CameraMode {
  if (saved && REMOVED_CAMERA_MODES.has(saved)) return 'director2';
  return CAMERA_MODES.some((m) => m.key === saved) ? (saved as CameraMode) : 'director2';
}

export function cameraModeLabel(key: CameraMode): string {
  return CAMERA_MODES.find((m) => m.key === key)?.label ?? '智能运镜';
}

export function isCameraModeInMore(key: CameraMode): boolean {
  return CAMERA_MODES_MORE.some((m) => m.key === key);
}

const showsShipModel = (mode: CameraMode): boolean => mode === 'ship' || mode === 'pilot';

interface DirectorController {
  poseAt(
    playTime: number,
    baseR: number,
    center: THREE.Vector3,
    vertR: number,
    focus: THREE.Vector3 | null,
    out: DirectorPose,
  ): DirectorPose;
}

export class CameraRig {
  private t = 0;
  private mode: CameraMode;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly center: THREE.Vector3;
  private horizR: number;
  private vertR: number;
  private directorReady = false;
  private cruiseOverride = false;
  private readonly directorFocusSmooth = new THREE.Vector3();
  private hasDirectorFocusSmooth = false;
  private readonly directorPos = new THREE.Vector3();
  private readonly directorTarget = new THREE.Vector3();
  private readonly directorPose: DirectorPose = {
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
  };
  // 022 录音态可重建：随音节增长替换导播实例（上传/播放态构造后不变）
  private director: CameraDirector | null;
  private director2: CameraDirectorV2 | null;
  private readonly shipCruise: ShipCruise | null;
  private readonly controls: OrbitControls | null;
  private readonly target = new THREE.Vector3();
  private readonly drift = new THREE.Vector3();

  constructor(
    camera: THREE.PerspectiveCamera,
    center: THREE.Vector3,
    extent: { horizRadius: number; vertRadius: number },
    mode: CameraMode = 'director2',
    director: CameraDirector | null = null,
    director2: CameraDirectorV2 | null = null,
    shipCruise: ShipCruise | null = null,
    domElement: HTMLElement | null = null,
  ) {
    this.camera = camera;
    this.center = center;
    this.horizR = extent.horizRadius;
    this.vertR = extent.vertRadius;
    this.mode = mode;
    this.director = director;
    this.director2 = director2;
    this.shipCruise = shipCruise;
    this.syncShipVisibility();
    this.shipCruise?.setPilotActive(mode === 'pilot');
    if (mode === 'pilot') this.shipCruise?.resetPilot();
    this.controls = domElement ? new OrbitControls(camera, domElement) : null;
    if (this.controls) {
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.enablePan = true;
      this.controls.enableZoom = true;
      this.controls.rotateSpeed = 0.58;
      this.controls.zoomSpeed = 0.85;
      this.controls.panSpeed = 0.55;
      this.controls.minDistance = Math.max(0.8, Math.min(this.horizR, this.vertR) * 0.18);
      this.controls.maxDistance = Math.max(this.horizR, this.vertR) * 6;
      this.controls.target.copy(center);
      this.controls.enabled = mode === 'free';
      if (mode === 'free') this.resetFreeView();
    }
  }

  /** 022 录音生长：用增长后的时间线重建导播，使智能运镜在录音中也能成相 */
  refreshDirectors(director: CameraDirector | null, director2: CameraDirectorV2 | null): void {
    this.director = director;
    this.director2 = director2;
    this.resetDirectorState();
  }

  /** 022 录音生长：中心随 cloud.center 引用自动更新，这里同步取景半径 */
  setBounds(center: THREE.Vector3, extent: { horizRadius: number; vertRadius: number }): void {
    this.center.copy(center);
    this.horizR = extent.horizRadius;
    this.vertR = extent.vertRadius;
    this.resetDirectorState();
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    if (mode === 'director' || mode === 'director2') this.resetDirectorState();
    this.syncShipVisibility();
    if (mode === 'free' || mode === 'pilot') this.cruiseOverride = false;
    if (mode === 'pilot') this.shipCruise?.resetPilot();
    this.shipCruise?.setPilotActive(mode === 'pilot');
    if (this.controls) {
      this.controls.enabled = mode === 'free';
      if (mode === 'free') this.controls.target.copy(this.center);
    }
  }

  private syncShipVisibility(): void {
    if (this.shipCruise) this.shipCruise.group.visible = showsShipModel(this.mode);
  }

  private resetDirectorState(): void {
    this.directorReady = false;
    this.hasDirectorFocusSmooth = false;
  }

  setCruiseOverride(enabled: boolean): void {
    this.cruiseOverride = this.mode === 'free' || this.mode === 'pilot' ? false : enabled;
  }

  dispose(): void {
    this.controls?.dispose();
  }

  update(dt: number, focus: THREE.Vector3 | null = null, playTime = 0): void {
    this.t += dt;
    // 分别按水平/垂直投影范围求最小距离，取 max 保证两轴都不裁切（桌面横屏/移动竖屏通吃）
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const R = Math.max(this.horizR / Math.tan(hHalf), this.vertR / Math.tan(vHalf)) * FIT_MARGIN;
    if (this.mode === 'free') {
      this.controls?.update();
    } else if (this.mode === 'pilot' && this.shipCruise) {
      this.shipCruise.updatePilot(dt, this.camera);
    } else if (this.cruiseOverride) {
      this.updateOrbit(R);
    } else if (this.mode === 'director' && this.director) {
      this.updateDirector(this.director, R, playTime, focus, dt);
    } else if (this.mode === 'director2' && this.director2) {
      this.updateDirector(this.director2, R, playTime, focus, dt);
    } else if (this.mode === 'ship' && this.shipCruise) {
      this.shipCruise.update(dt, this.camera, focus);
    } else if (this.mode === 'breath') {
      this.updateBreath(R);
    } else {
      this.updateOrbit(R);
    }
  }

  private resetFreeView(): void {
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const R = Math.max(this.horizR / Math.tan(hHalf), this.vertR / Math.tan(vHalf)) * FIT_MARGIN;
    this.camera.position.set(
      this.center.x,
      this.center.y + this.vertR * 0.36,
      this.center.z + R * 0.92,
    );
    this.controls?.target.copy(this.center);
    this.controls?.update();
  }

  private updateOrbit(R: number): void {
    const ang = this.t * OMEGA;
    this.camera.position.set(
      this.center.x + R * Math.cos(ang),
      this.center.y + 0.22 * this.vertR * Math.sin(this.t * 0.1),
      this.center.z + R * Math.sin(ang),
    );
    this.camera.lookAt(this.center);
  }

  private breathPose(R: number): { ang: number; radius: number; y: number; target: THREE.Vector3 } {
    const ang = this.t * OMEGA + 0.18 * Math.sin(this.t * 0.19) + 0.06 * Math.sin(this.t * 0.43 + 1.7);
    const radius = R * (1 + 0.055 * Math.sin(this.t * 0.17) + 0.025 * Math.sin(this.t * 0.31 + 1.2));
    const y = this.center.y
      + this.vertR * (0.2 * Math.sin(this.t * 0.13) + 0.09 * Math.sin(this.t * 0.37 + 1.1));
    this.drift.set(
      this.horizR * 0.05 * Math.sin(this.t * 0.11 + 0.6),
      this.vertR * 0.05 * Math.sin(this.t * 0.23 + 2.1),
      this.horizR * 0.04 * Math.cos(this.t * 0.09),
    );
    this.target.copy(this.center).add(this.drift);
    return { ang, radius, y, target: this.target };
  }

  private updateBreath(R: number): void {
    const p = this.breathPose(R);
    this.camera.position.set(
      this.center.x + p.radius * Math.cos(p.ang),
      p.y,
      this.center.z + p.radius * Math.sin(p.ang),
    );
    this.camera.lookAt(p.target);
  }

  private updateDirector(
    director: DirectorController,
    R: number,
    playTime: number,
    focus: THREE.Vector3 | null,
    dt: number,
  ): void {
    const smoothed = this.smoothDirectorFocus(focus, dt);
    director.poseAt(playTime, R, this.center, this.vertR, smoothed, this.directorPose);
    if (!this.directorReady) {
      this.directorPos.copy(this.directorPose.position);
      this.directorTarget.copy(this.directorPose.target);
      this.directorReady = true;
    } else {
      const posK = this.directorPose.smoothPos ?? DEFAULT_DIRECTOR_SMOOTH_POS;
      const tgtK = this.directorPose.smoothTarget ?? DEFAULT_DIRECTOR_SMOOTH_TARGET;
      this.directorPos.lerp(this.directorPose.position, 1 - Math.exp(-dt * posK));
      this.directorTarget.lerp(this.directorPose.target, 1 - Math.exp(-dt * tgtK));
    }
    this.camera.position.copy(this.directorPos);
    this.camera.lookAt(this.directorTarget);
  }

  private smoothDirectorFocus(focus: THREE.Vector3 | null, dt: number): THREE.Vector3 | null {
    const step = lerpDirectorFocus(
      this.directorFocusSmooth,
      this.hasDirectorFocusSmooth,
      focus,
      dt,
    );
    this.hasDirectorFocusSmooth = step.hasValue;
    return step.value;
  }
}
