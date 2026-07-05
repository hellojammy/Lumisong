import type { CameraMode } from './camera';
import type { FormKey } from './syllableCloud';

export const DEFAULT_APP_SETTINGS = {
  cameraMode: 'director2' as CameraMode,
  mist: false,
  combo: true,
  fxFade: true,
  fxBreath: false,
  guides: true,
  form: 'ripple' as FormKey,
  palette: 'magma',
} as const;

const DEFAULT_SETTINGS_VERSION = '2026-07-04-defaults-v1';
const DEFAULT_SETTINGS_VERSION_KEY = 'defaultSettingsVersion';

export type BooleanSettingKey = 'mist' | 'combo' | 'fxFade' | 'fxBreath' | 'guides';

export function storedBooleanSetting(key: BooleanSettingKey): boolean {
  const saved = localStorage.getItem(key);
  if (saved != null) return saved === '1';
  return DEFAULT_APP_SETTINGS[key];
}

export function storedSetting(key: 'cameraMode' | 'form' | 'palette'): string {
  return localStorage.getItem(key) ?? DEFAULT_APP_SETTINGS[key];
}

export function applyDefaultSettingsMigration(): void {
  if (localStorage.getItem(DEFAULT_SETTINGS_VERSION_KEY) === DEFAULT_SETTINGS_VERSION) return;
  localStorage.setItem('cameraMode', DEFAULT_APP_SETTINGS.cameraMode);
  localStorage.setItem('mist', DEFAULT_APP_SETTINGS.mist ? '1' : '0');
  localStorage.setItem('combo', DEFAULT_APP_SETTINGS.combo ? '1' : '0');
  localStorage.setItem('fxFade', DEFAULT_APP_SETTINGS.fxFade ? '1' : '0');
  localStorage.setItem('fxBreath', DEFAULT_APP_SETTINGS.fxBreath ? '1' : '0');
  localStorage.setItem('guides', DEFAULT_APP_SETTINGS.guides ? '1' : '0');
  localStorage.setItem('form', DEFAULT_APP_SETTINGS.form);
  localStorage.setItem('palette', DEFAULT_APP_SETTINGS.palette);
  localStorage.setItem(DEFAULT_SETTINGS_VERSION_KEY, DEFAULT_SETTINGS_VERSION);
}
