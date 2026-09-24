/**
 * 彩色平滑光照：天空直射 + 火把/熔炉泛洪传播
 * 输出到低分辨率光照画布，由引擎放大混合(泰拉瑞亚式平滑渐变)
 */

import { TileDefs } from './constants';
import { World } from './world';

export interface LightRegion {
  w: number; h: number;
  light: Float32Array;
  decay: Float32Array;   // 每格衰减(按 tile id 预备)
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  img: ImageData | null;
}

export interface ExtraLight { x: number; y: number; v: number }

export function makeRegion(): LightRegion {
  const canvas = document.createElement('canvas');
  canvas.width = 8; canvas.height = 8;
  const ctx = canvas.getContext('2d')!;
  const decay = new Float32Array(64);
  for (let i = 0; i < 32; i++) {
    if (TileDefs[i]) decay[i] = TileDefs[i].decay;
  }
  return { w: 8, h: 8, light: new Float32Array(64), decay, canvas, ctx, img: null };
}

/**
 * 计算区域光照并写入 reg.canvas
 * @param x0,y0,w,h 区域(世界格坐标)
 * @param skyI 天空光强 0-1
 * @param tSec 世界时间(火焰闪烁)
 * @param extra 额外光源(手持火把等)
 */
export function computeLight(
  world: World, reg: LightRegion,
  x0: number, y0: number, w: number, h: number,
  skyI: number, tSec: number, extra: ExtraLight[],
): void {
  if (reg.w !== w || reg.h !== h) {
    reg.w = w; reg.h = h;
    reg.light = new Float32Array(w * h);
    reg.canvas.width = w; reg.canvas.height = h;
    reg.img = null;
  }
  const light = reg.light;
  light.fill(0);
  const decay = reg.decay;

  // ---- 种子: 天空直射 ----
  for (let x = x0; x < x0 + w; x++) {
    if (x < 0 || x >= world.w) continue;
    const st = world.skyTop[x];
    const yTop = Math.max(y0, 0);
    const yBot = Math.min(y0 + h - 1, st - 1);
    for (let y = yTop; y <= yBot; y++) {
      light[(y - y0) * w + (x - x0)] = skyI;
    }
    // 水面下衰减起算
    if (st < world.h && world.get(x, st) === 26) { // T.WATER
      if (st >= y0 && st < y0 + h) {
        const i = (st - y0) * w + (x - x0);
        if (light[i] < skyI * 0.75) light[i] = skyI * 0.75;
      }
    }
  }

  // ---- 种子: 自发光方块 ----
  for (let y = y0; y < y0 + h; y++) {
    if (y < 0 || y >= world.h) continue;
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || x >= world.w) continue;
      const id = world.tiles[y * world.w + x];
      const lum = TileDefs[id].light;
      if (lum) {
        let v = lum;
        if (id === 16) { // T.TORCH 火把闪烁
          v = lum * (0.9 + 0.1 * Math.sin(tSec * 9 + x * 2.7 + y * 1.3));
        }
        const i = (y - y0) * w + (x - x0);
        if (light[i] < v) light[i] = v;
      }
    }
  }

  // ---- 种子: 额外光源 ----
  for (const e of extra) {
    const lx = e.x - x0, ly = e.y - y0;
    if (lx >= 0 && lx < w && ly >= 0 && ly < h) {
      const i = ly * w + lx;
      if (light[i] < e.v) light[i] = e.v;
    }
  }

  // ---- 传播(4 向扫掠 x2 迭代) ----
  for (let iter = 0; iter < 2; iter++) {
    // 正向: 左→右, 上→下
    for (let y = 0; y < h; y++) {
      const rowBase = world.w * (y + y0);
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const id = world.tiles[rowBase + x0 + x] ?? 0;
        const d = decay[id] || 0.09;
        let v = light[i];
        if (x > 0) { const c = light[i - 1] - d; if (c > v) v = c; }
        if (y > 0) { const c = light[i - w] - d; if (c > v) v = c; }
        light[i] = v;
      }
    }
    // 反向: 右→左, 下→上
    for (let y = h - 1; y >= 0; y--) {
      const rowBase = world.w * (y + y0);
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        const id = world.tiles[rowBase + x0 + x] ?? 0;
        const d = decay[id] || 0.09;
        let v = light[i];
        if (x < w - 1) { const c = light[i + 1] - d; if (c > v) v = c; }
        if (y < h - 1) { const c = light[i + w] - d; if (c > v) v = c; }
        light[i] = v;
      }
    }
  }

  // ---- 写入画布(暗度 alpha) ----
  if (!reg.img) reg.img = reg.ctx.createImageData(w, h);
  const data = reg.img.data;
  for (let i = 0; i < w * h; i++) {
    const l = light[i];
    let a = 1 - l;
    if (a < 0) a = 0;
    a = Math.pow(a, 1.25);
    const p = i * 4;
    data[p] = 5; data[p + 1] = 6; data[p + 2] = 12;
    data[p + 3] = (a * 255) | 0;
  }
  reg.ctx.putImageData(reg.img, 0, 0);
}
