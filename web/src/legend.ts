// 色条图例 DOM（spec constellation-view；刻度 0 → spread p99）
import { legendCssGradient } from './colormap';

const TICKS = 6;

export function buildLegend(el: HTMLElement, p99SpreadHz: number): void {
  const ticks: string[] = [];
  for (let k = TICKS - 1; k >= 0; k--) {
    const v = (p99SpreadHz * k) / (TICKS - 1);
    ticks.push(`<span>${(v / 1000).toFixed(1)} KHz</span>`);
  }
  el.innerHTML = `
    <div class="vtitle">SPECTRAL SPREAD</div>
    <div class="bar" style="background:${legendCssGradient()}"></div>
    <div class="ticks">${ticks.join('')}</div>`;
}
