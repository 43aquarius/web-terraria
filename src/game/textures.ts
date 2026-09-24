/**
 * 程序化像素美术生成器 v2 — 泰拉瑞亚风格 2×2 块状纹理系统
 *
 * 核心结构 (ART-SPEC §1): 所有地形贴图在 8×8 逻辑网格上绘制, 再 ×2 放大到 16×16,
 * 产生"块状但精致"的原版观感。调色板色值严格取自 ART-SPEC.md §2/§3。
 * 边缘描边由 render.ts 运行时叠加 (§4), 不烘焙进贴图。
 */

import { T, IT, ARMOR_COLORS, W_SAND, W_SNOW, W_MUD, W_EBON } from './constants';

// ==================== 基础工具 ====================

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mk(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  return [c, x];
}

function px(x: CanvasRenderingContext2D, px_: number, py: number, w: number, h: number, color: string): void {
  x.fillStyle = color;
  x.fillRect(px_, py, w, h);
}

function cloneTex(src: HTMLCanvasElement): HTMLCanvasElement {
  const [c, x] = mk(src.width, src.height);
  x.drawImage(src, 0, 0);
  return c;
}

/** 十六进制颜色乘法变亮/变暗(f>1 变亮, <1 变暗) */
function shadeHex(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((n & 0xff) * f));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ==================== 2×2 块状纹理核心 ====================

/** 逻辑网格画点: fn 在逻辑坐标上调用 p(lx,ly,color[,w,h]), 内部 fillRect(lx*2, ly*2, w*2, h*2) */
type Dot = (lx: number, ly: number, color: string, w?: number, h?: number) => void;

function logical(x: CanvasRenderingContext2D, fn: (p: Dot) => void): void {
  fn((lx, ly, color, w = 1, h = 1) => px(x, lx * 2, ly * 2, w * 2, h * 2, color));
}

/** 8×8 逻辑网格整面填充 */
const fill8 = (p: Dot, color: string): void => { p(0, 0, color, 8, 8); };

// ==================== 调色板 (ART-SPEC §2 精确色值) ====================

const C = {
  dirt: { base: '#976b4b', dark: '#725138', deepest: '#49393f', light: '#ac7a66', light2: '#bf8f6f' },
  stone: { base: '#616772', dark: '#36393f', deepest: '#292c30', light: '#adb8cd', light2: '#d4e0f7' },
  grass: { base: '#1e9648', dark: '#0d6524', deepest: '#0a4a1b', light: '#1cd85e' },
  wood: { face: '#bf8f6f', base: '#976b4b', dark: '#78553c', deepest: '#563e2c', grain: '#a97d5d', edge: '#291e15' },
  trunk: { base: '#78553c', dark: '#563e2c', deepest: '#3a302a', light: '#976b4b', light2: '#bf8f6f', grain: '#a97d5d' },
  leaf: { base: '#197b3c', dark: '#0c6123', deepest: '#0a4a1b', light: '#1d9045', light2: '#22a851', light3: '#1bcf5a', edge: '#17331c' },
  dirtWall: { base: '#563d30', dark: '#4a3428', deepest: '#423630', light: '#684938', light2: '#614333' },
  stoneWall: { base: '#4d5158', dark: '#43474e', deepest: '#3a3e44', light: '#575c63' },
};

/** 矿石调色板 (ART-SPEC §2 矿石表: 石底 + 矿粒 = 深描边 + 主体 + 亮闪) */
interface OrePal { main: string; mid: string; edge: string; flash: string; flash2: string }

const ORES: Record<string, OrePal> = {
  copper: { main: '#cd8647', mid: '#b75819', edge: '#71391f', flash: '#ffe5b7', flash2: '#ff9261' },
  iron: { main: '#bd9f8b', mid: '#696969', edge: '#573c3c', flash: '#eae6e2', flash2: '#eae6e2' },
  silver: { main: '#abb6b7', mid: '#7a8c90', edge: '#545d60', flash: '#f6f9fa', flash2: '#f6f9fa' },
  gold: { main: '#b9a417', mid: '#947e18', edge: '#4e4d36', flash: '#e7d541', flash2: '#fff9b7' },
  demonite: { main: '#6a4d8e', mid: '#4a3358', edge: '#2e2240', flash: '#9a7ec2', flash2: '#9a7ec2' },
};

/** 树叶调色板 (森林 + 三群系) */
interface LeafPal { base: string; dark: string; deepest: string; light: string; light2: string; light3: string; edge: string }

const LEAF_PALS: Record<string, LeafPal> = {
  forest: { base: '#197b3c', dark: '#0c6123', deepest: '#0a4a1b', light: '#1d9045', light2: '#22a851', light3: '#1bcf5a', edge: '#17331c' },
  snow: { base: '#b8d8c8', dark: '#9cbfae', deepest: '#8ab2a0', light: '#c8e8d8', light2: '#dcefe4', light3: '#e8f8f0', edge: '#7aa894' },
  jungle: { base: '#3aa04e', dark: '#2e8040', deepest: '#246634', light: '#58c468', light2: '#78e088', light3: '#8ef0a0', edge: '#1c5a2c' },
  corrupt: { base: '#8a6aa8', dark: '#6e5488', deepest: '#5a4270', light: '#a68ac2', light2: '#c098dc', light3: '#d0ace4', edge: '#4a3660' },
};

// ==================== 地形贴图 (8×8 逻辑网格, ART-SPEC §3) ====================

/** 泥土: #976b4b 基底 + 5-7 亮斑(#ac7a66/#bf8f6f 3:1, 1×1/1×2) + 4-6 暗斑(#725138, 1×1/2×1) + 偶尔深斑 */
function drawDirt(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, C.dirt.base);
    const nB = 5 + ((r() * 3) | 0);
    for (let i = 0; i < nB; i++) {
      const col = r() < 0.75 ? C.dirt.light : C.dirt.light2;
      const h = r() < 0.5 ? 1 : 2;                       // 1×1 / 1×2 竖斑
      p((r() * 8) | 0, (r() * (8 - h)) | 0, col, 1, h);
    }
    const nD = 4 + ((r() * 3) | 0);
    for (let i = 0; i < nD; i++) {
      const w = r() < 0.5 ? 1 : 2;                       // 1×1 / 2×1 横斑
      p((r() * (8 - w)) | 0, (r() * 8) | 0, C.dirt.dark, w, 1);
    }
    if (r() < 0.6) p((r() * 8) | 0, (r() * 8) | 0, C.dirt.deepest);
  });
}

/** 石头: #616772 基底 + 3-4 个互不相连斑块(#36393f/#adb8cd, 2-4 逻辑px), 每斑块内 1 点缀(#292c30/#d4e0f7) */
function drawStone(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, C.stone.base);
    const taken: boolean[] = new Array<boolean>(64).fill(false);
    const near = (cx: number, cy: number): boolean => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && taken[ny * 8 + nx]) return true;
      }
      return false;
    };
    const nPatch = 3 + (r() < 0.5 ? 1 : 0);
    for (let k = 0; k < nPatch; k++) {
      // 前两块强制一暗一亮, 保证四档色齐全
      const light = k === 0 ? false : k === 1 ? true : r() < 0.5;
      let cx = (r() * 8) | 0, cy = (r() * 8) | 0, ok = false;
      for (let t = 0; t < 24 && !ok; t++) {
        cx = (r() * 8) | 0; cy = (r() * 8) | 0; ok = !near(cx, cy);
      }
      if (!ok) continue;
      const cells: number[] = [cy * 8 + cx];
      const target = 2 + ((r() * 3) | 0);                // 2-4 逻辑px 不规则斑块
      let guard = 0;
      while (cells.length < target && guard++ < 12) {
        const from = cells[(r() * cells.length) | 0];
        const dir = (r() * 4) | 0;
        const nx = Math.max(0, Math.min(7, (from % 8) + [1, -1, 0, 0][dir]));
        const ny = Math.max(0, Math.min(7, ((from / 8) | 0) + [0, 0, 1, -1][dir]));
        if (!cells.includes(ny * 8 + nx) && !near(nx, ny)) cells.push(ny * 8 + nx);
      }
      const col = light ? C.stone.light : C.stone.dark;
      const accent = light ? C.stone.light2 : C.stone.deepest;
      cells.forEach((idc) => { p(idc % 8, (idc / 8) | 0, col); taken[idc] = true; });
      const a = cells[(r() * cells.length) | 0];
      p(a % 8, (a / 8) | 0, accent);
    }
  });
}

/** 黏土: 泥土规则换红棕调 */
function drawClay(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, '#b0664a');
    for (let i = 0, n = 4 + ((r() * 3) | 0); i < n; i++) {
      p((r() * 7) | 0, (r() * 8) | 0, '#974f36', 1 + ((r() * 2) | 0), 1);
    }
    for (let i = 0, n = 3 + ((r() * 2) | 0); i < n; i++) {
      p((r() * 7) | 0, (r() * 8) | 0, '#c98264', 2, 1);
    }
    for (let i = 0; i < 3; i++) p((r() * 8) | 0, (r() * 8) | 0, '#8f4f37');
  });
}

/** 矿石: 石头底 + 2-3 个矿粒团(2×2~3×3, 边缘 1px 描边 + 主体 + 左上闪光) */
function drawOre(x: CanvasRenderingContext2D, r: () => number, ore: OrePal): void {
  drawStone(x, r);
  logical(x, (p) => {
    const taken: boolean[] = new Array<boolean>(64).fill(false);
    const n = 2 + (r() < 0.55 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const w = 2 + (r() < 0.4 ? 1 : 0);
      const h = 2 + (r() < 0.4 ? 1 : 0);
      let cx = 0, cy = 0, ok = false;
      for (let t = 0; t < 20 && !ok; t++) {
        cx = (r() * (8 - w)) | 0; cy = (r() * (8 - h)) | 0;
        ok = true;
        for (let yy = 0; yy < h && ok; yy++) {
          for (let xx = 0; xx < w && ok; xx++) if (taken[(cy + yy) * 8 + cx + xx]) ok = false;
        }
      }
      if (!ok) continue;
      const cells: [number, number][] = [];
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          // 不规则: 35% 抠掉右下角
          if (xx === w - 1 && yy === h - 1 && w > 2 && r() < 0.35) continue;
          cells.push([cx + xx, cy + yy]);
        }
      }
      cells.forEach(([ox, oy]) => { taken[oy * 8 + ox] = true; });
      // 描边: 团 + 外扩 1 逻辑px 全铺描边色, 再覆主体
      const rim: number[] = [];
      cells.forEach(([ox, oy]) => {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = ox + dx, ny = oy + dy;
            if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) rim.push(ny * 8 + nx);
          }
        }
      });
      rim.forEach((idc) => p(idc % 8, (idc / 8) | 0, ore.edge));
      cells.forEach(([ox, oy]) => p(ox, oy, ore.main));
      const midC = cells[1 + ((r() * Math.max(1, cells.length - 1)) | 0)];
      if (midC) p(midC[0], midC[1], ore.mid);
      p(cells[0][0], cells[0][1], r() < 0.6 ? ore.flash : ore.flash2);   // 左上闪光
    }
  });
}

/** 木板: 横向板条分色 + #563e2c 板缝 + 错位竖缝 + #a97d5d 纹理点 */
function drawWoodBlock(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    p(0, 0, C.wood.face, 8, 2);                          // 亮板 0-1 行
    p(0, 2, C.wood.base, 8, 2);                          // 板 2-3 行
    p(0, 4, C.wood.dark, 8, 2);                          // 板 4-5 行
    p(0, 6, C.wood.base, 8, 2);                          // 板 6-7 行
    p(0, 2, C.wood.deepest, 8, 1);                       // 板缝行 2
    p(0, 4, C.wood.deepest, 8, 1);                       // 板缝行 4
    p(0, 6, C.wood.deepest, 8, 1);                       // 板缝行 6
    // 竖向板缝错位
    const seams = [5, 2, 6, 3];
    seams.forEach((sx, i) => { p(sx, [0, 3, 5, 7][i], C.wood.deepest, 1, i === 0 ? 2 : 1); });
    // 每板条 1-2 个纹理点
    [0, 3, 5, 7].forEach((sy) => {
      const n = 1 + ((r() * 2) | 0);
      for (let i = 0; i < n; i++) p((r() * 8) | 0, sy, C.wood.grain);
    });
  });
}

/** 树皮: 8 列竖纹(马尔可夫 60% 延续) + 3-4 结疤点 */
function drawTrunk(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    let prev = C.trunk.base;
    for (let col = 0; col < 8; col++) {
      if (col === 0) prev = C.trunk.dark;                 // 左缘深色起手
      else if (col === 1) prev = C.trunk.base;
      else if (r() >= 0.6) {                              // 40% 重抽 (60% 延续)
        const t = r();
        prev = t < 0.375 ? C.trunk.base : t < 0.625 ? C.trunk.light : t < 0.875 ? C.trunk.dark : C.trunk.light2;
      }
      p(col, 0, prev, 1, 8);
    }
    const nK = 3 + (r() < 0.5 ? 1 : 0);
    for (let i = 0; i < nK; i++) p(1 + ((r() * 6) | 0), (r() * 8) | 0, C.trunk.grain);
  });
}

/** 树叶(单格) 通用: 基底 + 亮斑偏上 + 暗斑偏下 + 左上最亮点 + 边缘 30% 最暗 */
function paintLeaf(p: Dot, r: () => number, L: LeafPal): void {
  fill8(p, L.base);
  const nB = 3 + (r() < 0.5 ? 1 : 0);
  for (let i = 0; i < nB; i++) p((r() * 8) | 0, (r() * 5) | 0, r() < 0.5 ? L.light : L.light2);
  const nD = 2 + (r() < 0.5 ? 1 : 0);
  for (let i = 0; i < nD; i++) p((r() * 8) | 0, 3 + ((r() * 5) | 0), L.dark);
  p(3 + ((r() * 2) | 0), 1 + ((r() * 2) | 0), L.light3);       // 最亮点(左上, 避开 mask 描边/切角)
  for (let i = 0; i < 8; i++) {
    if (r() < 0.3) p(i, 0, L.deepest);
    if (r() < 0.3) p(i, 7, L.deepest);
    if (r() < 0.3) p(0, i, L.deepest);
    if (r() < 0.3) p(7, i, L.deepest);
  }
}

function drawLeafBiome(x: CanvasRenderingContext2D, r: () => number, pal: LeafPal): void {
  logical(x, (p) => paintLeaf(p, r, pal));
}

// ---- 群系扩展方块 ----

/** 沙漠沙: #d8c078 基底 + #c4a850/#e8d498 斑点 */
function drawSand(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, '#d8c078');
    for (let i = 0, n = 4 + ((r() * 3) | 0); i < n; i++) {
      p((r() * 7) | 0, (r() * 8) | 0, '#c4a850', 1 + ((r() * 2) | 0), 1);
    }
    for (let i = 0, n = 3 + ((r() * 3) | 0); i < n; i++) {
      p((r() * 7) | 0, (r() * 8) | 0, '#e8d498', 1 + ((r() * 2) | 0), 1);
    }
  });
}

/** 雪: #e8f0f4 + #d0dce4 暗斑 + #ffffff 亮斑 */
function drawSnow(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, '#e8f0f4');
    for (let i = 0, n = 4 + ((r() * 3) | 0); i < n; i++) {
      p((r() * 7) | 0, (r() * 7) | 0, '#d0dce4', 1 + ((r() * 2) | 0), 1 + ((r() * 2) | 0));
    }
    for (let i = 0, n = 3 + ((r() * 2) | 0); i < n; i++) p((r() * 8) | 0, (r() * 8) | 0, '#ffffff');
  });
}

/** 冰: #a8d8e8 基底 + 斜亮纹(#c8ecf5) + 暗斑(#8ec4dc) + 左上高光角 */
function drawIce(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, '#a8d8e8');
    for (let s = 0; s < 2; s++) {                        // 斜向亮纹
      const off = 1 + s * 4 + ((r() * 2) | 0);
      for (let i = 0; i < 8; i++) {
        if (i % 2 === 0 || r() < 0.5) p((off + i) % 8, i, '#c8ecf5');
      }
    }
    for (let i = 0; i < 3; i++) p((r() * 7) | 0, (r() * 7) | 0, '#8ec4dc', 2, 1);
    p(0, 0, '#c8ecf5', 2, 1);                            // 左上高光角
    p(0, 1, '#c8ecf5');
  });
}

/** 泥: #5a4638 系 */
function drawMud(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, '#5a4638');
    for (let i = 0, n = 4 + ((r() * 3) | 0); i < n; i++) {
      p((r() * 8) | 0, (r() * 8) | 0, '#4a3a2c', 1, 1 + ((r() * 2) | 0));
    }
    for (let i = 0, n = 3 + ((r() * 2) | 0); i < n; i++) {
      p((r() * 7) | 0, (r() * 8) | 0, '#6a5644', 1 + ((r() * 2) | 0), 1);
    }
    if (r() < 0.5) p((r() * 8) | 0, (r() * 8) | 0, '#3e3024');
  });
}

/** 丛林草: 自包含(上丛林绿草皮/下泥) + 交界过渡 + 顶缘草须 */
function drawJungleGrass(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    p(0, 3, '#5a4638', 8, 5);                            // 下部泥
    for (let i = 0; i < 3; i++) p((r() * 7) | 0, 4 + ((r() * 4) | 0), '#6a5644', 2, 1);
    for (let i = 0; i < 3; i++) p((r() * 8) | 0, 4 + ((r() * 4) | 0), '#4a3a2c', 1, 2);
    p(0, 0, '#4c9e3a', 8, 3);                            // 上部丛林草
    for (let i = 0; i < 3; i++) p((r() * 8) | 0, (r() * 2) | 0, '#6cc44e');
    for (let col = 0; col < 8; col++) {                  // 交界过渡 + 草根下探
      if (r() < 0.5) p(col, 3, '#367428');
      else if (r() < 0.4) p(col, 3, '#4c9e3a');
    }
    for (let col = 0; col < 8; col++) {                  // 顶缘草须
      if (r() < 0.55) p(col, 0, r() < 0.6 ? '#6cc44e' : '#4c9e3a');
    }
  });
}

/** 黑檀石: #4a4553 基底 + #353040 暗斑 + 硬朗裂纹 */
function drawCorruptStone(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, '#4a4553');
    for (let i = 0, n = 3 + ((r() * 2) | 0); i < n; i++) {
      p((r() * 7) | 0, (r() * 7) | 0, '#353040', 1 + ((r() * 2) | 0), 1 + ((r() * 2) | 0));
    }
    for (let i = 0; i < 3; i++) p((r() * 7) | 0, (r() * 7) | 0, '#5a5568', 1 + ((r() * 2) | 0), 1);
    for (let n = 0; n < 2; n++) {                        // 两条近直线裂纹
      let cx = 1 + ((r() * 5) | 0), cy = 1 + ((r() * 4) | 0);
      const dx = r() < 0.5 ? 1 : -1;
      const len = 4 + ((r() * 3) | 0);
      for (let i = 0; i < len; i++) {
        p(cx, cy, '#2a2635');
        cx = Math.max(0, Math.min(7, cx + dx));
        cy = Math.min(7, cy + (r() < 0.6 ? 1 : 0));
      }
    }
  });
}

/** 腐化草: 自包含(上紫草 #7a5a96 / 下泥土) + #5a4270 过渡 */
function drawCorruptGrass(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    p(0, 3, C.dirt.base, 8, 5);                          // 下部泥土
    for (let i = 0; i < 3; i++) p((r() * 7) | 0, 4 + ((r() * 4) | 0), C.dirt.light, 2, 1);
    for (let i = 0; i < 3; i++) p((r() * 8) | 0, 4 + ((r() * 4) | 0), C.dirt.dark, 1, 2);
    p(0, 0, '#7a5a96', 8, 3);                            // 上部紫草
    for (let i = 0; i < 3; i++) p((r() * 8) | 0, (r() * 2) | 0, '#9a7ac0');
    for (let col = 0; col < 8; col++) {                  // 交界 #5a4270 过渡 + 草根下探
      if (r() < 0.5) p(col, 3, '#5a4270');
      else if (r() < 0.4) p(col, 3, '#7a5a96');
    }
    for (let col = 0; col < 8; col++) {                  // 顶缘草须
      if (r() < 0.55) p(col, 0, r() < 0.6 ? '#9a7ac0' : '#7a5a96');
    }
  });
}

/** 灰烬: #4a4448 系软斑 */
function drawAsh(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, '#4a4448');
    for (let i = 0, n = 4 + ((r() * 3) | 0); i < n; i++) {
      p((r() * 7) | 0, (r() * 7) | 0, '#3e383c', 1 + ((r() * 2) | 0), 1 + ((r() * 2) | 0));
    }
    for (let i = 0, n = 3 + ((r() * 2) | 0); i < n; i++) {
      p((r() * 7) | 0, (r() * 7) | 0, '#565054', 2, 1);
    }
  });
}

/** 狱岩: #9c2e10 基底 + #4a1408 暗斑 + #ff6a2a 亮粒 */
function drawHellstone(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, '#9c2e10');
    for (let i = 0, n = 3 + ((r() * 2) | 0); i < n; i++) {
      p((r() * 7) | 0, (r() * 7) | 0, '#4a1408', 1 + ((r() * 2) | 0), 1 + ((r() * 2) | 0));
    }
    const n = 4 + ((r() * 3) | 0);                       // 4-6 处亮粒
    for (let i = 0; i < n; i++) {
      const lx = (r() * 8) | 0, ly = (r() * 8) | 0;
      p(lx, ly, '#ff6a2a');
      if (r() < 0.3) p(Math.min(7, lx + 1), ly, '#ff6a2a');
    }
  });
}

/** 岩浆: #e85410 基底 + #ff7a1e 波纹带 + #ffb02e 波峰 + #a83008 暗斑 */
function drawLavaTile(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, '#e85410');
    for (let s = 0; s < 2; s++) {                        // 两条横向波动亮带
      const base = 1 + s * 4 + ((r() * 2) | 0);
      for (let lx = 0; lx < 8; lx++) {
        const ly = Math.min(7, base + (Math.sin(lx * 1.2 + s * 2) > 0.3 ? 1 : 0));
        p(lx, ly, '#ff7a1e');
      }
    }
    for (let i = 0; i < 3; i++) p((r() * 7) | 0, (r() * 7) | 0, '#a83008', 2, 1);
    for (let i = 0, n = 3 + ((r() * 2) | 0); i < n; i++) p((r() * 8) | 0, (r() * 8) | 0, '#ffb02e');
  });
}

/** 黑曜石: #241f33 基底 + #3a3352 紫高光斜纹 + #151122 暗斑 */
function drawObsidian(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, '#241f33');
    for (let i = 0, n = 2 + ((r() * 2) | 0); i < n; i++) {
      p((r() * 7) | 0, (r() * 7) | 0, '#151122', 1 + ((r() * 2) | 0), 1 + ((r() * 2) | 0));
    }
    for (let s = 0; s < 2; s++) {                        // 紫高光斜纹
      const off = 1 + s * 4 + ((r() * 2) | 0);
      for (let i = 0; i < 8; i++) {
        if (i % 2 === 0 || r() < 0.4) p((off + i) % 8, i, '#3a3352');
      }
    }
    p(0, 0, '#3a3352', 2, 1);                            // 玻璃质高光角
    p(0, 1, '#3a3352');
  });
}

/** 蘑菇柄: 苍白蓝白竖纹 */
function drawMushStem(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    p(0, 0, '#a8bcd0', 1, 8);
    p(1, 0, '#d8e6f2', 1, 8);
    p(2, 0, '#c8d8e8', 4, 8);
    p(6, 0, '#b0c4d8', 1, 8);
    p(7, 0, '#a8bcd0', 1, 8);
    for (let i = 0; i < 5; i++) p(2 + ((r() * 4) | 0), (r() * 7) | 0, '#b4c8da', 1, 1 + ((r() * 2) | 0));
    for (let i = 0; i < 3; i++) p(1 + ((r() * 6) | 0), (r() * 8) | 0, '#e4eef8');
  });
}

/** 蘑菇盖: 亮蓝伞盖 + 顶亮面 + 底深蓝边 + 白色发光点 */
function drawMushCap(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, '#4aa0e8');
    p(0, 0, '#6ab8f0', 8, 1);
    p(0, 6, '#3a82cc', 8, 1);
    p(0, 7, '#2a6ac0', 8, 1);
    for (let i = 0; i < 4; i++) p((r() * 8) | 0, 1 + ((r() * 4) | 0), '#3a8ad8');
    for (let i = 0; i < 3; i++) p((r() * 8) | 0, 1 + ((r() * 4) | 0), '#e8f6ff');
  });
}

/** 仙人掌: 绿柱 + 左右深边 + 白刺 */
function drawCactus(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    p(0, 0, '#3e7a36', 1, 8);
    p(7, 0, '#3e7a36', 1, 8);
    p(1, 0, '#6cae58', 1, 8);
    p(2, 0, '#5a9a4a', 4, 8);
    p(6, 0, '#4e8c42', 1, 8);
    for (let i = 0; i < 4; i++) p(3 + ((r() * 2) | 0), (r() * 8) | 0, '#4e8c42');
    for (let i = 0; i < 5; i++) {                        // 边缘白刺
      p(0, (r() * 8) | 0, '#e8f0d8');
      if (r() < 0.8) p(7, (r() * 8) | 0, '#e8f0d8');
    }
    for (let i = 0; i < 2; i++) p(1 + ((r() * 6) | 0), (r() * 8) | 0, '#d8e8c8');
  });
}

/** 树苗: 透明底小树芽(树皮茎 + 树叶冠) */
function drawSapling(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    const sx = 3 + ((r() * 2) | 0);
    p(sx, 4, C.trunk.base, 1, 4);                        // 茎
    p(sx, 7, C.trunk.dark);
    p(sx - 1, 1, C.leaf.base, 3, 3);                     // 树冠
    p(sx, 0, C.leaf.base);
    p(sx - 2, 2, C.leaf.base);
    p(sx + 2, 2, C.leaf.base);
    p(sx - 1, 1, C.leaf.light3);
    p(sx, 1, C.leaf.light2);
    p(sx + 1, 3, C.leaf.dark);
    p(sx - 1, 3, C.leaf.dark);
  });
}

/** 藤蔓: 透明底, 2px 摆动绿藤 + 侧叶 */
function drawVine(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    let vx = 3 + ((r() * 2) | 0);
    for (let ly = 0; ly < 8; ly++) {
      p(vx, ly, C.grass.base);
      if (r() < 0.25) p(Math.max(0, Math.min(7, vx + (r() < 0.5 ? -1 : 1))), ly, C.grass.dark);
      if (ly % 2 === 1 && r() < 0.6) vx = 3 + ((r() * 2) | 0);   // 轻微摆动
    }
    for (let i = 0; i < 3; i++) {                        // 侧叶
      const ly = 1 + ((r() * 6) | 0);
      const left = r() < 0.5;
      p(Math.max(0, Math.min(7, left ? vx - 1 : vx + 1)), ly, C.grass.base);
      if (r() < 0.6) p(Math.max(0, Math.min(7, left ? vx - 1 : vx + 1)), Math.max(0, ly - 1), C.grass.light);
    }
  });
}

/** 高草: 透明底草束, 顶端亮尖 */
function drawTallGrass(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    const n = 4 + ((r() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const col = (r() * 8) | 0;
      const h = 3 + ((r() * 4) | 0);
      const lean = r() < 0.3 ? (r() < 0.5 ? -1 : 1) : 0;
      for (let j = 0; j < h; j++) {
        const lx = j >= h - 2 ? Math.max(0, Math.min(7, col + lean)) : col;
        p(lx, 7 - j, j >= h - 2 ? C.grass.light : C.grass.base);
      }
      if (r() < 0.4) p(Math.max(0, Math.min(7, col - lean)), 8 - h + 1, C.grass.dark);
    }
  });
}

/** 花: 透明底, 绿茎 + 十字花瓣 */
function drawFlower(x: CanvasRenderingContext2D, r: () => number, petal: string, center: string): void {
  logical(x, (p) => {
    const bx = 2 + ((r() * 4) | 0);
    const h = 2 + ((r() * 3) | 0);
    p(bx, 8 - h, C.grass.dark, 1, h);                    // 茎
    if (r() < 0.5) p(Math.max(0, bx - 1), 6, C.grass.dark);
    else p(Math.min(7, bx + 1), 5, C.grass.dark);        // 叶
    const cy = 8 - h - 2;
    p(bx - 1, cy - 1, petal, 3, 3);                      // 花瓣团
    p(bx, cy - 2, petal);
    p(bx, cy + 1, petal);
    p(bx - 2, cy, petal);
    p(bx + 2, cy, petal);
    p(bx, cy, center);                                   // 花心
  });
}

/** 火把静态贴图: 火焰(2 帧感) + #976b4b 木柄竖纹(#725138/#bb8838) + #291510 描边 */
function drawTorchStatic(x: CanvasRenderingContext2D): void {
  // 静态火焰: 外 #ffdd33 / 中 #fee722 / 芯 #aee886, 偏摆火舌(2 帧感)
  px(x, 6, 2, 4, 4, '#ffdd33');
  px(x, 6, 0, 2, 2, '#ffdd33');
  px(x, 7, 3, 2, 2, '#fee722');
  px(x, 8, 4, 2, 2, '#aee886');
  // 木柄竖纹
  px(x, 6, 6, 2, 10, '#976b4b');
  px(x, 8, 6, 2, 10, '#725138');
  px(x, 6, 8, 2, 2, '#bb8838');
  px(x, 8, 12, 2, 2, '#725138');
  // 1px 描边
  px(x, 5, 6, 1, 10, '#291510');
  px(x, 10, 6, 1, 10, '#291510');
  px(x, 6, 15, 4, 1, '#291510');
}

/** 木平台 (ART-SPEC §3): 上 6 逻辑行木板横纹 + 底部 #291e15 描边行 + 下方支柱点 */
function drawPlatform(x: CanvasRenderingContext2D): void {
  logical(x, (p) => {
    p(0, 0, C.wood.face, 8, 2);                          // 亮板
    p(0, 2, C.wood.base, 8, 2);
    p(0, 4, C.wood.dark, 8, 1);
    p(0, 5, C.wood.edge, 8, 1);                          // 底部描边行
    p(2, 0, C.wood.deepest, 1, 2);                       // 错位竖缝
    p(5, 2, C.wood.deepest, 1, 2);
    p(3, 4, C.wood.deepest);
    p(1, 1, C.wood.grain);
    p(6, 3, C.wood.grain);
    p(0, 6, C.wood.dark);                                // 下方悬空支柱点
    p(7, 6, C.wood.dark);
    p(0, 7, C.wood.deepest);
    p(7, 7, C.wood.deepest);
  });
}

// ==================== 背景墙 (暗调色板低对比, wallFrom 统一叠 rgba(0,0,0,0.42)) ====================

function drawDirtWall(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, C.dirtWall.base);
    const n = 2 + ((r() * 2) | 0);                       // 2-3 个低对比斑块
    for (let i = 0; i < n; i++) {
      const t = r();
      const col = t < 0.34 ? C.dirtWall.dark : t < 0.67 ? C.dirtWall.light : C.dirtWall.light2;
      p((r() * 7) | 0, (r() * 7) | 0, col, 1 + ((r() * 2) | 0), 1 + ((r() * 2) | 0));
    }
    if (r() < 0.5) p((r() * 8) | 0, (r() * 8) | 0, C.dirtWall.deepest);
  });
}

function drawStoneWall(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, C.stoneWall.base);
    const n = 2 + ((r() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const t = r();
      const col = t < 0.4 ? C.stoneWall.dark : t < 0.7 ? C.stoneWall.deepest : C.stoneWall.light;
      p((r() * 7) | 0, (r() * 7) | 0, col, 1 + ((r() * 2) | 0), 1 + ((r() * 2) | 0));
    }
  });
}

function drawSandWall(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, '#8a7448');
    const n = 2 + ((r() * 2) | 0);
    for (let i = 0; i < n; i++) {
      p((r() * 7) | 0, (r() * 7) | 0, r() < 0.6 ? '#6e5c38' : '#9c8656', 1 + ((r() * 2) | 0), 1 + ((r() * 2) | 0));
    }
  });
}

function drawSnowWall(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, '#8e9aa6');
    const n = 2 + ((r() * 2) | 0);
    for (let i = 0; i < n; i++) {
      p((r() * 7) | 0, (r() * 7) | 0, r() < 0.6 ? '#76828e' : '#a0acb8', 1 + ((r() * 2) | 0), 1 + ((r() * 2) | 0));
    }
  });
}

function drawMudWall(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, '#4e3e32');
    const n = 2 + ((r() * 2) | 0);
    for (let i = 0; i < n; i++) {
      p((r() * 7) | 0, (r() * 7) | 0, r() < 0.6 ? '#3e3026' : '#5a4838', 1 + ((r() * 2) | 0), 1 + ((r() * 2) | 0));
    }
  });
}

function drawEbonWall(x: CanvasRenderingContext2D, r: () => number): void {
  logical(x, (p) => {
    fill8(p, '#423c4c');
    const n = 2 + ((r() * 2) | 0);
    for (let i = 0; i < n; i++) {
      p((r() * 7) | 0, (r() * 7) | 0, r() < 0.6 ? '#342f40' : '#4e485e', 1 + ((r() * 2) | 0), 1 + ((r() * 2) | 0));
    }
  });
}

// ==================== 覆盖层 ====================

/**
 * 草顶覆层 16×16 (render 画在 py-4): 每 2px 列草齿高 2/4/6px,
 * #1e9648 主 + 顶部 #1cd85e 亮边(齿间 #0d6524 阴影) + 下缘泥土过渡
 */
function drawGrassTop(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const r = mulberry32(77);
  logical(x, (p) => {
    const hs: number[] = [];
    for (let col = 0; col < 8; col++) hs.push(1 + ((r() * 3) | 0));      // 1-3 逻辑行 = 2/4/6px
    if (hs.every((h) => h === hs[0])) hs[(r() * 8) | 0] = (hs[0] % 3) + 1;   // 保证参差
    for (let col = 0; col < 8; col++) {
      const h = hs[col];
      p(col, 3 - h, C.grass.base, 1, h + 3);             // 齿 + 主体(至第 5 行)
      const taller = (col > 0 && hs[col - 1] > h) || (col < 7 && hs[col + 1] > h);
      p(col, 3 - h, taller ? C.grass.dark : C.grass.light);   // 齿间阴影 / 亮边
    }
    for (let col = 0; col < 8; col++) {                  // 下缘与泥土过渡
      if (r() < 0.35) p(col, 5, C.grass.dark);
      const t = r();
      if (t < 0.4) p(col, 6, C.grass.dark);
      else if (t < 0.6) p(col, 6, C.dirt.base);
      if (r() < 0.2) p(col, 7, C.dirt.dark);
    }
  });
  return c;
}

/** 侧垂草皮 4px 宽(2 逻辑列), 从上往下渐短 */
function drawGrassSide(left: boolean): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const r = mulberry32(left ? 78 : 79);
  const X = (lx: number): number => (left ? lx : 7 - lx);
  logical(x, (p) => {
    p(X(0), 0, C.grass.base, 1, 8);                      // 外列全高
    p(X(0), 0, C.grass.light, 1, 1);
    p(X(1), 0, C.grass.base, 1, 6);                      // 内列渐短(至上部 6 行)
    p(X(1), 0, C.grass.light, 1, 1);
    p(X(1), 4, C.grass.dark, 1, 2);                      // 内缘过渡阴影
    if (r() < 0.7) p(X(1), 6, C.grass.dark);
    for (let i = 0; i < 2; i++) {                        // 外列底部草须
      if (r() < 0.5) p(X(0), 7 - ((r() * 2) | 0), C.grass.dark);
    }
  });
  return c;
}

/** 树枝覆盖: 树皮色斜向短枝 + 1px #3a302a 描边 */
function drawBranch(left: boolean): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const put = (bx: number, by: number, w: number, h: number, color: string): void => {
    px(x, left ? bx : 16 - bx - w, by, w, h, color);
  };
  // 主枝(从树干一侧斜出) + 枝梢, 树皮三段
  put(8, 8, 6, 2, C.trunk.base);                         // 基段
  put(12, 7, 2, 1, C.trunk.grain);                       // 结疤高光
  put(4, 5, 6, 2, C.trunk.base);                         // 中段
  put(4, 5, 6, 1, C.trunk.light);                        // 上面受光
  put(1, 2, 4, 2, C.trunk.light2);                       // 枝梢(亮)
  put(0, 3, 2, 1, C.trunk.dark);                         // 梢端暗
  put(13, 6, 2, 2, C.trunk.dark);                        // 与树干相接的疙瘩
  // 1px 下描边
  put(8, 10, 6, 1, C.trunk.deepest);
  put(4, 7, 6, 1, C.trunk.deepest);
  put(1, 4, 4, 1, C.trunk.deepest);
  put(13, 5, 2, 1, C.trunk.deepest);
  return c;
}

/** 树根覆盖: 起点疙瘩贴树干, 根须向侧下延伸扎入草地, 1px #3a302a 描边 */
function drawRoot(left: boolean): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const put = (bx: number, by: number, w: number, h: number, color: string): void => {
    px(x, left ? bx : 16 - bx - w, by, w, h, color);
  };
  put(13, 6, 3, 2, C.trunk.dark);                        // 起点疙瘩(连接树干底部)
  put(10, 8, 4, 2, C.trunk.base);                        // 主根
  put(6, 10, 4, 2, C.trunk.base);
  put(3, 12, 4, 2, C.trunk.light);                       // 渐细根梢
  put(8, 12, 2, 2, C.trunk.light2);                      // 分叉小根
  put(10, 6, 2, 1, C.trunk.grain);                       // 浅层小根
  // 1px 描边
  put(13, 8, 3, 1, C.trunk.deepest);
  put(10, 10, 4, 1, C.trunk.deepest);
  put(6, 12, 4, 1, C.trunk.deepest);
  put(3, 14, 4, 1, C.trunk.deepest);
  put(8, 14, 2, 1, C.trunk.deepest);
  return c;
}

/** 树叶 mask 变体: bit 1=上 2=下 4=左 8=右 (邻格是树叶/树干); 暴露边画 #17331c 描边 + 切角 */
function leafVariant(mask: number): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const r = mulberry32(1000 + mask * 17);
  logical(x, (p) => paintLeaf(p, r, LEAF_PALS.forest));
  const up = !(mask & 1), down = !(mask & 2), left = !(mask & 4), right = !(mask & 8);
  const E = C.leaf.edge;
  if (up) px(x, 0, 0, 16, 2, E);
  if (down) px(x, 0, 14, 16, 2, E);
  if (left) px(x, 0, 0, 2, 16, E);
  if (right) px(x, 14, 0, 2, 16, E);
  // 两相邻边都暴露 → 切 4×4 角 + L 形描边
  const cut = (cx: number, cy: number): void => {
    x.clearRect(cx, cy, 4, 4);
    px(x, cx === 0 ? 4 : 10, cy, 2, 4, E);
    px(x, cx, cy === 0 ? 4 : 10, 4, 2, E);
    px(x, cx === 0 ? 4 : 10, cy === 0 ? 4 : 10, 2, 2, E);
  };
  if (up && left) cut(0, 0);
  if (up && right) cut(12, 0);
  if (down && left) cut(0, 12);
  if (down && right) cut(12, 12);
  return c;
}

/** 挖掘裂纹: 2px 宽折线, 4 阶段渐深 */
function drawCrack(stage: number): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const r = mulberry32(4000 + stage * 13);
  x.fillStyle = `rgba(0,0,0,${(0.5 + stage * 0.08).toFixed(2)})`;
  for (let i = 0; i <= stage; i++) {
    let cx = 5 + ((r() * 5) | 0), cy = 5 + ((r() * 5) | 0);
    const dx = r() < 0.5 ? 2 : -2, dy = r() < 0.5 ? 2 : -2;
    const len = 2 + stage + ((r() * 2) | 0);
    for (let j = 0; j < len; j++) {
      x.fillRect(cx, cy, 2, 2);
      cx = Math.max(0, Math.min(14, cx + (r() < 0.75 ? dx : 0)));
      cy = Math.max(0, Math.min(14, cy + (r() < 0.75 ? dy : 0)));
    }
  }
  return c;
}

/** 火把火焰 4 帧 (8×12 = 4×6 逻辑): 外 #ffdd33 / 中 #fee722 / 芯 #aee886, 每帧微摆 */
function drawFlame(frame: number): HTMLCanvasElement {
  const [c, x] = mk(8, 12);
  const sway = [1, 0, -1, 0][frame];
  const widths = [1, frame % 2 === 1 ? 1 : 2, 2, 3, 3, frame === 3 ? 3 : 2];
  const swayF = [1, 1, 0.5, 0.25, 0, 0];
  logical(x, (p) => {
    const lefts: number[] = [];
    for (let ly = 0; ly < 6; ly++) {
      const w = widths[ly];
      const left = Math.max(0, Math.min(4 - w, Math.round(1.5 + sway * swayF[ly] - w / 2)));
      lefts.push(left);
      for (let i = 0; i < w; i++) p(left + i, ly, '#ffdd33');
    }
    // 中焰(内圈) + 芯(底部中心)
    for (let ly = 2; ly <= 4; ly++) {
      const w = widths[ly];
      for (let i = 1; i < w - 1; i++) p(lefts[ly] + i, ly, '#fee722');
    }
    p(lefts[4] + ((widths[4] - 1) >> 1), 4, '#aee886');
    p(lefts[5] + (widths[5] >= 2 ? 1 : 0), 5, '#aee886');
  });
  return c;
}

// ==================== 家具精灵 (2x 块风格 + 描边) ====================

/** 工作台 32×16: 木板色桌面(#bf8f6f 面/#976b4b 侧) + #78553c 桌腿 + #291e15 描边 */
function drawWorkbench(): HTMLCanvasElement {
  const [c, x] = mk(32, 16);
  logical(x, (p) => {
    p(1, 1, C.wood.face, 14, 1);                          // 桌面(亮面)
    p(1, 2, C.wood.base, 14, 1);                          // 侧板
    p(1, 3, C.wood.dark, 14, 1);                          // 底缘
    p(5, 2, C.wood.deepest);                              // 板缝点
    p(11, 2, C.wood.deepest);
    p(3, 2, C.wood.grain);
    p(9, 2, C.wood.grain);
    p(1, 4, C.wood.dark, 2, 4);                           // 桌腿
    p(13, 4, C.wood.dark, 2, 4);
    p(2, 4, C.wood.deepest, 1, 4);
    p(14, 4, C.wood.deepest, 1, 4);
  });
  px(x, 6, 8, 20, 1, C.wood.edge);                        // 桌面下阴影描边
  px(x, 1, 2, 1, 6, C.wood.edge);                         // 左描边
  px(x, 30, 2, 1, 6, C.wood.edge);                        // 右描边
  px(x, 2, 15, 4, 1, C.wood.edge);                        // 腿底
  px(x, 26, 15, 4, 1, C.wood.edge);
  return c;
}

/** 熔炉 32×32: 石头拱炉 + 中部火口(#ff9261/#ffe5b7 发光) + 顶部烟囱 */
function drawFurnace(): HTMLCanvasElement {
  const [c, x] = mk(32, 32);
  logical(x, (p) => {
    p(5, 0, C.stone.dark, 6, 1);                          // 烟囱
    p(5, 1, C.stone.base, 6, 3);
    p(5, 1, C.stone.dark, 1, 3);
    p(10, 1, C.stone.dark, 1, 3);
    p(1, 4, C.stone.base, 14, 11);                        // 炉体
    p(2, 5, C.stone.light, 3, 1);                         // 左上高光
    p(1, 7, C.stone.dark, 14, 1);                         // 砖缝
    p(4, 5, C.stone.deepest); p(8, 5, C.stone.deepest); p(12, 5, C.stone.deepest);
    p(3, 8, C.stone.deepest); p(10, 8, C.stone.deepest); p(13, 8, C.stone.deepest);
    p(4, 9, C.stone.deepest, 8, 1);                       // 拱顶
    p(3, 10, C.stone.deepest, 1, 5);                      // 拱边柱
    p(12, 10, C.stone.deepest, 1, 5);
    p(4, 10, C.stone.deepest, 8, 5);                      // 洞内暗底
    p(5, 12, '#ff9261', 6, 3);                            // 炉火
    p(5, 11, '#ff9261', 2, 1);
    p(9, 11, '#ff9261', 2, 1);
    p(6, 11, '#ffe5b7', 3, 1);
    p(6, 13, '#ffe5b7', 3, 1);
    p(7, 13, '#ffdd33', 2, 2);
    p(1, 15, C.stone.dark, 4, 1);                         // 底脚
    p(11, 15, C.stone.dark, 4, 1);
    p(5, 15, C.stone.dark, 6, 1);                         // 底排补齐(火口下方基座)
  });
  px(x, 1, 8, 30, 1, C.stone.deepest);                    // 炉体左/右描边
  px(x, 1, 8, 1, 23, C.stone.deepest);
  px(x, 30, 8, 1, 23, C.stone.deepest);
  px(x, 1, 31, 30, 1, C.stone.deepest);                   // 底描边
  px(x, 9, 1, 1, 7, C.stone.deepest);                     // 烟囱描边
  px(x, 22, 1, 1, 7, C.stone.deepest);
  return c;
}

/** 铁砧 32×16: #616772 铁砧形(上宽下窄) + #adb8cd 高光 */
function drawAnvil(): HTMLCanvasElement {
  const [c, x] = mk(32, 16);
  logical(x, (p) => {
    p(1, 1, C.stone.light, 13, 1);                        // 顶面高光
    p(1, 2, C.stone.base, 13, 1);                         // 顶梁
    p(0, 2, C.stone.base, 2, 1);                          // 左砧角
    p(14, 2, C.stone.base, 2, 1);                         // 右砧角
    p(0, 3, C.stone.dark, 2, 1);
    p(14, 3, C.stone.dark, 2, 1);
    p(6, 3, C.stone.dark, 4, 1);                          // 腰
    p(6, 4, C.stone.base, 4, 1);
    p(5, 5, C.stone.dark, 6, 1);                          // 砧座
    p(3, 6, C.stone.base, 10, 1);
    p(2, 7, C.stone.deepest, 12, 1);                      // 底板
    p(2, 2, C.stone.light2);                              // 砧面亮点
    p(6, 6, C.stone.light);                               // 座面高光
  });
  return c;
}

/** 木门关闭 16×32: 木板竖门 + #291e15 描边 + 门把手 #ffd75e */
function drawDoorC(): HTMLCanvasElement {
  const [c, x] = mk(16, 32);
  logical(x, (p) => {
    p(0, 0, C.wood.deepest, 8, 16);                       // 门框
    p(1, 1, C.wood.base, 6, 15);                          // 门板(竖板)
    p(1, 1, C.wood.face, 6, 1);                           // 门板顶亮
    p(2, 1, C.wood.dark, 1, 15);                          // 板缝
    p(4, 1, C.wood.dark, 1, 15);
    p(1, 1, C.wood.grain, 1, 15);                         // hmm 板面纹理列
    p(5, 1, C.wood.grain, 1, 15);
    p(1, 5, C.wood.deepest, 6, 1);                        // 横档
    p(1, 10, C.wood.deepest, 6, 1);
    p(1, 15, C.wood.edge, 6, 1);                          // 底描边
    p(6, 7, '#ffd75e');                                   // 门把手
    p(6, 8, '#b8941f');
  });
  px(x, 12, 13, 2, 2, '#fff0a0');                         // 把手高光
  return c;
}

/** 木门打开 16×32: 门框 + 贴左薄门板(其余透空) */
function drawDoorO(): HTMLCanvasElement {
  const [c, x] = mk(16, 32);
  logical(x, (p) => {
    p(0, 0, C.wood.deepest, 8, 16);                       // 门框
    p(1, 1, C.wood.base, 2, 15);                          // 薄门板(贴左)
    p(1, 1, C.wood.face, 1, 15);
    p(2, 5, C.wood.deepest, 1, 1);                        // 板档
    p(2, 10, C.wood.deepest, 1, 1);
    p(2, 7, '#ffd75e');                                   // 把手
  });
  return c;
}

/** 宝箱 32×32: #976b4b 箱体 + #ffd75e 金属包边(角+中央锁扣) + #291e15 描边 */
function drawChest(): HTMLCanvasElement {
  const [c, x] = mk(32, 32);
  logical(x, (p) => {
    p(4, 2, '#976b4b', 8, 1);                             // 顶盖拱
    p(3, 3, '#976b4b', 10, 3);
    p(4, 2, C.wood.face, 8, 1);                           // 盖顶亮面
    p(3, 6, C.wood.edge, 10, 1);                          // 开合缝
    p(2, 7, '#976b4b', 12, 8);                            // 下箱体
    p(3, 10, C.wood.dark, 10, 1);                         // 前板木纹
    p(3, 12, C.wood.dark, 10, 1);
    p(2, 14, C.wood.dark, 12, 1);                         // 箱底
    // 金色包边(角)
    p(2, 7, '#ffd75e', 2, 2); p(12, 7, '#ffd75e', 2, 2);
    p(2, 13, '#ffd75e', 2, 2); p(12, 13, '#ffd75e', 2, 2);
    p(3, 4, '#ffd75e', 2, 2); p(11, 4, '#ffd75e', 2, 2);
    p(2, 9, '#b8941f', 2, 1); p(12, 9, '#b8941f', 2, 1);  // 包边暗缘
    // 中央锁扣(跨开合缝)
    p(6, 5, '#ffd75e', 4, 4);
    p(6, 5, '#fff0a0', 4, 1);
    p(7, 7, '#8a6a1a', 2, 1);                             // 锁孔
    p(6, 8, '#b8941f', 4, 1);
    // 描边
    p(3, 1, C.wood.edge, 10, 1);
    p(2, 2, C.wood.edge, 1, 5); p(13, 2, C.wood.edge, 1, 5);
    p(1, 7, C.wood.edge, 1, 8); p(14, 7, C.wood.edge, 1, 8);
    p(2, 15, C.wood.edge, 12, 1);
  });
  return c;
}

/** 恶魔祭坛 32×32: #4a4553 魔石祭坛 + 紫 #8a6ab0 发光纹 */
function drawAltar(): HTMLCanvasElement {
  const [c, x] = mk(32, 32);
  logical(x, (p) => {
    p(2, 4, '#4a4553', 12, 3);                            // 台面顶板
    p(2, 4, '#5a5568', 12, 1);                            // 台面亮
    p(0, 5, '#353040', 2, 2); p(14, 5, '#353040', 2, 2);  // 顶板双角
    p(6, 7, '#4a4553', 4, 5);                             // 台柱
    p(6, 7, '#5a5568', 1, 5);
    p(9, 7, '#353040', 1, 5);
    p(3, 12, '#353040', 10, 1);                           // 座
    p(2, 13, '#4a4553', 12, 2);
    p(4, 15, '#2a2635', 8, 1);
    // 紫 #8a6ab0 发光纹
    p(4, 5, '#8a6ab0', 2, 1); p(10, 5, '#8a6ab0', 2, 1);
    p(7, 8, '#8a6ab0', 2, 1);
    p(7, 10, '#8a6ab0', 2, 1);
    p(5, 13, '#8a6ab0', 2, 1); p(9, 13, '#8a6ab0', 2, 1);
    p(5, 5, '#a68ac2'); p(11, 5, '#a68ac2');
    p(7, 8, '#a68ac2');
    p(7, 12, 'rgba(138,106,176,0.4)', 2, 1);              // 台面微光
  });
  return c;
}

/** 木桌 32×16: 桌板 + 双腿 + 下横撑 */
function drawTable(): HTMLCanvasElement {
  const [c, x] = mk(32, 16);
  logical(x, (p) => {
    p(1, 1, C.wood.face, 14, 1);                          // 桌面
    p(1, 2, C.wood.base, 14, 1);
    p(1, 3, C.wood.dark, 14, 1);
    p(7, 2, C.wood.deepest); p(12, 2, C.wood.deepest);
    p(4, 2, C.wood.grain); p(10, 2, C.wood.grain);
    p(1, 4, C.wood.dark, 2, 4);                           // 桌腿
    p(13, 4, C.wood.dark, 2, 4);
    p(2, 4, C.wood.deepest, 1, 4);
    p(14, 4, C.wood.deepest, 1, 4);
    p(5, 6, C.wood.dark, 6, 1);                           // 下横撑
    p(5, 6, C.wood.grain, 1, 1);
  });
  px(x, 6, 8, 20, 1, C.wood.edge);                        // 描边(同工作台)
  px(x, 1, 2, 1, 6, C.wood.edge);
  px(x, 30, 2, 1, 6, C.wood.edge);
  px(x, 2, 15, 4, 1, C.wood.edge);
  px(x, 26, 15, 4, 1, C.wood.edge);
  return c;
}

/** 木椅 16×16(8×8 逻辑): 椅背 + 座面 + 椅腿 */
function drawChair(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  logical(x, (p) => {
    p(2, 0, C.wood.base, 1, 7);                           // 椅背(通到底)
    p(2, 0, C.wood.face, 1, 1);                           // 背顶亮
    p(3, 0, C.wood.dark, 1, 6);                           // 背内影
    p(2, 2, C.wood.dark, 2, 1);                           // 背部横档
    p(1, 5, C.wood.face, 6, 1);                           // 座面
    p(1, 6, C.wood.base, 6, 1);                           // 座沿
    p(1, 7, C.wood.dark);                                 // 椅腿
    p(6, 7, C.wood.dark);
    p(2, 7, C.wood.edge, 4, 1);                           // 座下阴影描边
  });
  return c;
}

// ==================== 心形 / 生命水晶 ====================

/** 8×8 逻辑心形 (闭区间行段) */
const HEART_ROWS: [number, number, number][] = [
  [1, 2, 1], [5, 6, 1],
  [0, 7, 2], [0, 7, 3],
  [1, 6, 4], [2, 5, 5], [3, 4, 6],
];

function heartCells(): [number, number][] {
  const cells: [number, number][] = [];
  HEART_ROWS.forEach(([a, b, y]) => { for (let i = a; i <= b; i++) cells.push([i, y]); });
  return cells;
}

/** 心形 UI (ART-SPEC §2: #e03c3c 主 / #ff8080 高光 / #a02020 暗) */
function drawHeart(main: string, shine: string, dark: string): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  logical(x, (p) => {
    heartCells().forEach(([hx, hy]) => p(hx, hy, main));
    p(1, 2, shine, 2, 1);                                 // 左上高光
    p(1, 3, shine);
    p(2, 5, dark); p(5, 5, dark);                         // 下缘暗
    p(3, 6, dark, 2, 1);
  });
  return c;
}

/** 生命水晶 2 帧脉动: #e03c68/#ff7d9e/#8a1030 心形晶体 + 微光 */
function drawLifeCrystal(frame: number): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const bright = frame === 1;
  logical(x, (p) => {
    const cells = heartCells();
    if (bright) {                                         // 微光: 半透明外扩一圈
      cells.forEach(([hx, hy]) => {
        p(Math.max(0, hx - 1), hy, 'rgba(255,125,158,0.30)', 3, 1);
        p(hx, Math.max(0, hy - 1), 'rgba(255,125,158,0.30)', 1, 3);
      });
    }
    cells.forEach(([hx, hy]) => p(hx, hy, bright ? '#f05580' : '#e03c68'));
    p(3, 1, '#8a1030', 2, 6);                             // 晶面切缝
    p(1, 4, '#8a1030'); p(6, 4, '#8a1030');
    p(1, 2, '#ff7d9e', 2, 1);                             // 高光
    p(1, 3, bright ? '#ffb3cc' : '#ff7d9e');
    p(2, 5, '#8a1030'); p(5, 5, '#8a1030');               // 底部暗面
    if (bright) { p(5, 2, '#ff7d9e'); p(6, 3, '#ff7d9e'); }
  });
  return c;
}

function drawBubble(): HTMLCanvasElement {
  const [c, x] = mk(12, 12);
  x.strokeStyle = '#a8d0f0';
  x.lineWidth = 1;
  x.beginPath();
  x.arc(6, 6, 4.5, 0, Math.PI * 2);
  x.stroke();
  px(x, 4, 3, 2, 2, '#d8ecff');
  return c;
}

// ==================== 光晕 ====================

function radialGlow(size: number, inner: string, mid: string, edge: string): HTMLCanvasElement {
  const [c, x] = mk(size, size);
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, mid);
  g.addColorStop(1, edge);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

// ==================== 物品图标 (2x 块风格) ====================

interface MetalColors { main: string; light: string; dark: string }

const METALS: Record<string, MetalColors> = {
  copper: { main: '#cd8647', light: '#ff9261', dark: '#71391f' },
  iron: { main: '#bd9f8b', light: '#eae6e2', dark: '#573c3c' },
  silver: { main: '#abb6b7', light: '#f6f9fa', dark: '#545d60' },
  gold: { main: '#b9a417', light: '#e7d541', dark: '#4e4d36' },
  demonite: { main: '#6a4d8e', light: '#9a7ec2', dark: '#2e2240' },
  hellstone: { main: '#ff6a2a', light: '#ffd75e', dark: '#7a2410' },
  nightmare: { main: '#4a3358', light: '#8a6ab0', dark: '#2a1e38' },
  wood: { main: '#976b4b', light: '#bf8f6f', dark: '#563e2c' },
};

/** 盔甲三件套 item id (头/身/腿) × 5 套 */
const ARMOR_SETS: [number, number, number][] = [
  [IT.COPPER_HELM, IT.COPPER_MAIL, IT.COPPER_LEGS],
  [IT.IRON_HELM, IT.IRON_MAIL, IT.IRON_LEGS],
  [IT.SILVER_HELM, IT.SILVER_MAIL, IT.SILVER_LEGS],
  [IT.GOLD_HELM, IT.GOLD_MAIL, IT.GOLD_LEGS],
  [IT.SHADOW_HELM, IT.SHADOW_MAIL, IT.SHADOW_LEGS],
];

/** 斜握木柄 #78553c (左下 → 右上) */
function toolHandle(p: Dot): void {
  [[2, 6], [3, 5], [3, 4], [4, 3], [4, 2]].forEach(([hx, hy]) => p(hx, hy, '#78553c'));
  p(2, 6, '#563e2c');                                     // 端头
  p(3, 5, '#976b4b');                                     // 握柄高光
}

/** T 形镐: 金属弧梁头 + 木柄斜握 */
function pickIcon(m: MetalColors): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  logical(x, (p) => {
    toolHandle(p);
    p(2, 0, m.light, 4, 1);                               // 顶棱高光
    p(1, 1, m.main, 6, 1);                                // 主梁
    p(0, 2, m.main);                                      // 左镐尖
    p(7, 2, m.main);                                      // 右镐尖
    p(0, 3, m.dark);
    p(7, 3, m.dark);
    p(2, 2, m.dark, 4, 1);                                // 梁下暗部
  });
  return c;
}

/** 斧: 单侧刃 + 木柄斜握 */
function axeIcon(m: MetalColors): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  logical(x, (p) => {
    toolHandle(p);
    p(1, 0, m.light, 3, 1);                               // 刃顶亮
    p(0, 1, m.main, 4, 2);                                // 刃体(单侧)
    p(0, 3, m.dark, 3, 1);                                // 刃底暗
    p(4, 1, m.dark);                                      // 背
  });
  return c;
}

/** 剑: 斜置刃 + 短柄 + 十字护手 (#ffd75e) */
function swordIcon(m: MetalColors, long: boolean): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  logical(x, (p) => {
    const n = long ? 6 : 4;
    for (let i = 0; i < n; i++) {                         // 斜刃 ↗
      const bx = 2 + i, by = 5 - i;
      p(bx, by, m.main);
      if (i < n - 1) p(bx + 1, by, m.light);              // 上缘亮
      if (long && i > 0 && i < n - 1) p(bx, by + 1, m.dark);   // 宽刃下缘
    }
    p(1, 4, '#ffd75e');                                   // 十字护手
    p(2, 5, '#ffd75e');
    p(3, 6, '#ffd75e');
    p(1, 6, '#78553c');                                   // 短柄
    p(0, 7, '#ffd75e');                                   // 柄尾
  });
  return c;
}

/** 3 块堆叠金属锭: 梯形(主体+顶面亮色+描边) */
function barIcon(m: MetalColors): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  logical(x, (p) => {
    const ingot = (ox: number, oy: number): void => {
      p(ox, oy, m.light, 2, 1);                           // 顶面亮
      p(ox, oy + 1, m.main, 3, 1);                        // 主体(梯形下宽)
      p(ox, oy + 2, m.dark, 3, 1);                        // 描边/阴影
      p(ox + 2, oy, m.dark);                              // 顶描边
    };
    ingot(1, 4);                                          // 底层两锭
    ingot(4, 4);
    ingot(2, 2);                                          // 顶层一锭(叠在两锭之上)
  });
  return c;
}

/** 凝胶: #4ec44e 半透明凝胶块 + 亮斑 */
function gelIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  x.globalAlpha = 0.85;
  logical(x, (p) => {
    p(3, 2, '#4ec44e', 2, 1);
    p(2, 3, '#4ec44e', 4, 3);
    p(3, 6, '#4ec44e', 2, 1);
    p(2, 5, '#389a38', 1, 1);
    p(5, 5, '#389a38', 1, 1);
    p(3, 6, '#389a38', 2, 1);
  });
  x.globalAlpha = 1;
  logical(x, (p) => {
    p(3, 3, '#8ee88e', 2, 1);                             // 亮斑(不透明)
    p(2, 4, '#8ee88e');
  });
  return c;
}

/** 木弓: 弓臂弧 + 竖弦 */
function bowIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  logical(x, (p) => {
    [[5, 0], [4, 1], [3, 2], [3, 3], [3, 4], [4, 5], [5, 6]].forEach(([bx, by]) => p(bx, by, '#976b4b'));
    p(3, 3, '#563e2c');                                   // 弓把
    p(4, 1, '#bf8f6f');
    p(4, 5, '#bf8f6f');
    p(6, 0, '#e8e8e0', 1, 7);                             // 竖弦
  });
  return c;
}

/** 斜放箭矢 */
function arrowIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  logical(x, (p) => {
    for (let i = 0; i < 6; i++) p(1 + i, 6 - i, '#976b4b');   // 斜杆
    p(6, 0, '#abb6b7');                                   // 箭头
    p(7, 0, '#f6f9fa');
    p(7, 1, '#abb6b7');
    p(0, 6, '#e8e8e0');                                   // 尾羽
    p(1, 7, '#e8e8e0');
    p(0, 7, '#c8ccd4');
  });
  return c;
}

/** 炸弹: 黑球 + 高光 + 引线火花 */
function bombIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  logical(x, (p) => {
    p(3, 3, '#1e1e28', 2, 1);
    p(2, 4, '#1e1e28', 4, 2);
    p(3, 6, '#1e1e28', 2, 1);
    p(2, 4, '#44444f', 2, 1);                             // 高光
    p(3, 4, '#66666f');
    p(4, 2, '#8a6a42');                                   // 引线
    p(5, 1, '#8a6a42');
    p(6, 0, '#ffd75e');                                   // 火花
    p(5, 0, '#ff6a2a');
  });
  return c;
}

/** 晶状体: 黑色圆球 + 高光 */
function lensIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  logical(x, (p) => {
    p(3, 2, '#1c1c24', 2, 1);
    p(2, 3, '#1c1c24', 4, 3);
    p(3, 6, '#1c1c24', 2, 1);
    p(3, 3, '#4a4a58', 2, 1);                             // 高光
    p(2, 4, '#8a8a98');
    p(5, 5, '#3a3a48');                                   // 底部微光
  });
  return c;
}

/** 可疑的眼球: 红巩膜血丝 + 竖瞳 */
function eyeSummonIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  logical(x, (p) => {
    p(2, 2, '#e8d8d8', 4, 1);                             // 巩膜
    p(1, 3, '#e8d8d8', 6, 3);
    p(2, 6, '#e8d8d8', 4, 1);
    p(1, 4, '#b04040');                                   // 血丝
    p(6, 4, '#b04040');
    p(2, 6, '#b04040');
    p(3, 3, '#b02828', 2, 3);                             // 红虹膜
    p(3, 4, '#101018', 2, 1);                             // 竖瞳
    p(3, 3, '#d84848');                                   // 高光
  });
  return c;
}

/** 橡子 */
function acornIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  logical(x, (p) => {
    p(3, 1, '#3a302a', 2, 1);                             // 蒂
    p(2, 2, '#563e2c', 4, 2);                             // 帽
    p(2, 2, '#78553c', 4, 1);
    p(2, 4, '#976b4b', 4, 2);                             // 果身
    p(3, 6, '#725138', 2, 1);
    p(2, 4, '#bf8f6f');                                   // 高光
  });
  return c;
}

/** 魔金矿石图标 */
function demoniteOreIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  drawOre(x, mulberry32(913), ORES.demonite);
  return c;
}

/** 熔岩镐: 炽橙镐 + 火星点 */
function moltenPickIcon(): HTMLCanvasElement {
  const c = pickIcon(METALS.hellstone);
  const x = c.getContext('2d')!;
  px(x, 12, 2, 2, 2, '#ffd75e');
  px(x, 4, 6, 2, 2, '#ffb02e');
  px(x, 10, 10, 2, 2, '#ff9261');
  return c;
}

/** 灾厄之刃: 暗紫宽剑 + 紫光边 */
function lightsBaneIcon(): HTMLCanvasElement {
  const c = swordIcon(METALS.nightmare, true);
  const x = c.getContext('2d')!;
  px(x, 8, 4, 2, 2, '#9a7ec2');
  px(x, 12, 2, 2, 2, '#8a6ab0');
  px(x, 6, 8, 2, 2, '#9a7ec2');
  return c;
}

/** 火山: 橙红巨剑 + 火焰纹 */
function volcanoIcon(): HTMLCanvasElement {
  const c = swordIcon(METALS.hellstone, true);
  const x = c.getContext('2d')!;
  px(x, 8, 2, 2, 2, '#ffd75e');
  px(x, 10, 4, 2, 2, '#ffb02e');
  px(x, 12, 2, 2, 2, '#ffd75e');
  px(x, 14, 0, 2, 2, '#fff0a0');
  return c;
}

/** 头盔图标(侧视, 描边轮廓清晰) */
function helmetIcon(col: string, edge?: string): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const dark = shadeHex(col, 0.62);
  const line = shadeHex(col, 0.42);
  const hi = shadeHex(col, 1.3);
  logical(x, (p) => {
    p(2, 1, col, 4, 2);                                   // 盔顶圆顶
    p(1, 2, col, 6, 2);                                   // 盔体(含面甲)
    p(1, 4, dark, 6, 1);                                  // 盔沿
    p(2, 1, line, 4, 1);                                  // 顶描边(后画避免被覆盖)
    p(1, 2, line, 1, 3); p(6, 2, line, 1, 3);             // 侧描边
    p(2, 2, hi, 2, 1);                                    // 顶高光
    p(5, 3, dark, 1, 1);                                  // 面甲缝
    if (edge) { p(3, 1, edge); p(6, 3, edge); }
  });
  return c;
}

/** 胸甲图标(肩甲+躯干, 中缝/臂缝) */
function mailIcon(col: string, edge?: string): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const dark = shadeHex(col, 0.62);
  const line = shadeHex(col, 0.42);
  const hi = shadeHex(col, 1.3);
  logical(x, (p) => {
    p(2, 1, col, 4, 1);                                   // 肩
    p(1, 2, col, 6, 1);                                   // 肩甲
    p(1, 3, col, 6, 3);                                   // 躯干
    p(1, 6, dark, 6, 1);                                  // 下摆
    p(2, 1, line, 4, 1);                                  // 肩线描边(后画)
    p(1, 2, line, 1, 4); p(6, 2, line, 1, 4);             // 侧描边
    p(3, 2, dark, 2, 4);                                  // 中缝
    p(1, 4, dark); p(6, 4, dark);                         // 臂缝
    p(2, 2, hi, 2, 1);                                    // 领口高光
    if (edge) { p(3, 1, edge); p(5, 5, edge); }
  });
  return c;
}

/** 护腿图标(裤形, 膝盖高光) */
function legsIcon(col: string, edge?: string): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const dark = shadeHex(col, 0.62);
  const line = shadeHex(col, 0.42);
  const hi = shadeHex(col, 1.35);
  logical(x, (p) => {
    p(2, 1, line, 4, 1);                                  // 腰线描边
    p(1, 2, line, 1, 4); p(6, 2, line, 1, 4);
    p(2, 1, col, 4, 1);                                   // 腰
    p(1, 2, col, 6, 1);
    p(2, 2, col, 2, 4);                                   // 左腿
    p(4, 2, col, 2, 4);                                   // 右腿
    p(3, 3, dark, 2, 3);                                  // 裤缝
    p(2, 6, dark, 2, 1); p(4, 6, dark, 2, 1);             // 裤脚
    p(2, 4, hi); p(5, 4, hi);                             // 膝盖高光
    if (edge) { p(1, 2, edge); p(6, 5, edge); }
  });
  return c;
}

function torchIcon(flame: HTMLCanvasElement): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  px(x, 6, 8, 2, 8, '#976b4b');                           // 木柄
  px(x, 8, 8, 2, 8, '#725138');
  px(x, 5, 8, 1, 8, '#291510');                           // 描边
  px(x, 10, 8, 1, 8, '#291510');
  px(x, 6, 15, 4, 1, '#291510');
  x.drawImage(flame, 4, -1);
  return c;
}

function scaledIcon(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  x.imageSmoothingEnabled = false;
  const s = Math.min(16 / w, 16 / h);
  const dw = Math.round(w * s), dh = Math.round(h * s);
  x.drawImage(src, Math.floor((16 - dw) / 2), Math.floor((16 - dh) / 2), dw, dh);
  return c;
}

// ==================== 汇总 ====================

export interface GameTextures {
  tiles: Map<number, HTMLCanvasElement[]>;
  walls: Map<number, HTMLCanvasElement[]>;
  grassTop: HTMLCanvasElement;
  grassSideL: HTMLCanvasElement;
  grassSideR: HTMLCanvasElement;
  branchL: HTMLCanvasElement;
  branchR: HTMLCanvasElement;
  rootL: HTMLCanvasElement;
  rootR: HTMLCanvasElement;
  leaves: Map<number, HTMLCanvasElement>;
  cracks: HTMLCanvasElement[];
  flames: HTMLCanvasElement[];
  glowWarm: HTMLCanvasElement;
  glowWhite: HTMLCanvasElement;
  glowBlue: HTMLCanvasElement;                // 蓝紫光晕(蘑菇盖/水晶)
  glowRed: HTMLCanvasElement;                 // 红橙光晕(岩浆/地狱)
  sprites: Record<string, HTMLCanvasElement>;
  crystalFrames: HTMLCanvasElement[];         // 生命水晶 2 帧脉动
  icons: Record<number, HTMLCanvasElement>;
  iconURL: Record<number, string>;
  anchors: Record<number, [number, number]>;
  heartURL: string;
  heartEmptyURL: string;
  bubbleURL: string;
}

let cache: GameTextures | null = null;

export function getTextures(): GameTextures {
  if (cache) return cache;

  const tiles = new Map<number, HTMLCanvasElement[]>();
  const variants = (n: number, fn: (x: CanvasRenderingContext2D, r: () => number) => void, seed: number): HTMLCanvasElement[] => {
    const arr: HTMLCanvasElement[] = [];
    for (let i = 0; i < n; i++) {
      const [c, x] = mk(16, 16);
      fn(x, mulberry32(seed + i * 131));
      arr.push(c);
    }
    return arr;
  };

  tiles.set(T.DIRT, variants(3, drawDirt, 11));
  tiles.set(T.STONE, variants(3, drawStone, 22));
  tiles.set(T.CLAY, variants(3, drawClay, 33));
  tiles.set(T.WOOD, variants(3, drawWoodBlock, 44));
  tiles.set(T.TRUNK, variants(3, drawTrunk, 55));
  {
    const [c, x] = mk(16, 16); drawTorchStatic(x);
    tiles.set(T.TORCH, [c]);
  }
  {
    const [c, x] = mk(16, 16); drawPlatform(x);
    tiles.set(T.PLATFORM, [c]);
  }
  // 草方块: 泥土底 + render 叠 grassTop 覆层
  tiles.set(T.GRASS, tiles.get(T.DIRT)!);
  tiles.set(T.ORE_COPPER, variants(3, (x, r) => drawOre(x, r, ORES.copper), 66));
  tiles.set(T.ORE_IRON, variants(3, (x, r) => drawOre(x, r, ORES.iron), 77));
  tiles.set(T.ORE_SILVER, variants(3, (x, r) => drawOre(x, r, ORES.silver), 88));
  tiles.set(T.ORE_GOLD, variants(3, (x, r) => drawOre(x, r, ORES.gold), 99));
  tiles.set(T.TGRASS, variants(3, drawTallGrass, 111));
  tiles.set(T.FLW_R, variants(3, (x, r) => drawFlower(x, r, '#e05555', '#f7e07a'), 122));
  tiles.set(T.FLW_Y, variants(3, (x, r) => drawFlower(x, r, '#e8c94a', '#d8a020'), 133));
  tiles.set(T.FLW_B, variants(3, (x, r) => drawFlower(x, r, '#5a7ae0', '#f7e07a'), 144));

  // ---- 群系扩展方块 ----
  tiles.set(T.SAND, variants(3, drawSand, 201));
  tiles.set(T.SNOW, variants(3, drawSnow, 202));
  tiles.set(T.ICE, variants(3, drawIce, 203));
  tiles.set(T.MUD, variants(3, drawMud, 204));
  tiles.set(T.JUNGLE_GRASS, variants(3, drawJungleGrass, 205));
  tiles.set(T.CORRUPT_STONE, variants(3, drawCorruptStone, 206));
  tiles.set(T.CORRUPT_GRASS, variants(3, drawCorruptGrass, 207));
  tiles.set(T.ASH, variants(3, drawAsh, 208));
  tiles.set(T.HELLSTONE, variants(3, drawHellstone, 209));
  tiles.set(T.LAVA, variants(3, drawLavaTile, 210));
  tiles.set(T.OBSIDIAN, variants(3, drawObsidian, 211));
  tiles.set(T.MUSH_STEM, variants(3, drawMushStem, 212));
  tiles.set(T.MUSH_CAP, variants(3, drawMushCap, 213));
  tiles.set(T.CACTUS, variants(3, drawCactus, 214));
  tiles.set(T.SAPLING, variants(3, drawSapling, 215));
  tiles.set(T.VINE, variants(3, drawVine, 216));
  tiles.set(T.LEAF_SNOW, variants(3, (x, r) => drawLeafBiome(x, r, LEAF_PALS.snow), 217));
  tiles.set(T.LEAF_JUNGLE, variants(3, (x, r) => drawLeafBiome(x, r, LEAF_PALS.jungle), 218));
  tiles.set(T.LEAF_CORRUPT, variants(3, (x, r) => drawLeafBiome(x, r, LEAF_PALS.corrupt), 219));

  // ---- 背景墙 (暗调色板 + 统一 0.42 罩) ----
  const WALL_SHADE = 'rgba(0,0,0,0.42)';
  const walls = new Map<number, HTMLCanvasElement[]>();
  const wallFrom = (base: (x: CanvasRenderingContext2D, r: () => number) => void, seed: number): HTMLCanvasElement[] => {
    const arr: HTMLCanvasElement[] = [];
    for (let i = 0; i < 3; i++) {
      const [c, x] = mk(16, 16);
      base(x, mulberry32(seed + i * 71));
      px(x, 0, 0, 16, 16, WALL_SHADE);
      arr.push(c);
    }
    return arr;
  };
  walls.set(1, wallFrom(drawDirtWall, 300));                              // 泥土墙
  walls.set(2, wallFrom(drawStoneWall, 400));                             // 石头墙
  walls.set(W_SAND, wallFrom(drawSandWall, 500));                         // 沙墙
  walls.set(W_SNOW, wallFrom(drawSnowWall, 600));                         // 雪墙
  walls.set(W_MUD, wallFrom(drawMudWall, 700));                           // 泥墙(丛林)
  walls.set(W_EBON, wallFrom(drawEbonWall, 800));                         // 黑檀墙(腐化)

  // ---- 树叶变体 (16 mask) ----
  const leaves = new Map<number, HTMLCanvasElement>();
  for (let m = 0; m < 16; m++) leaves.set(m, leafVariant(m));

  const cracks: HTMLCanvasElement[] = [0, 1, 2, 3].map(drawCrack);
  const flames: HTMLCanvasElement[] = [0, 1, 2, 3].map(drawFlame);

  const sprites: Record<string, HTMLCanvasElement> = {
    workbench: drawWorkbench(),
    furnace: drawFurnace(),
    anvil: drawAnvil(),
    doorC: drawDoorC(),
    doorO: drawDoorO(),
    chest: drawChest(),
    altar: drawAltar(),
    table: drawTable(),
    chair: drawChair(),
  };
  const crystalFrames: HTMLCanvasElement[] = [drawLifeCrystal(0), drawLifeCrystal(1)];

  // ---- 物品图标 ----
  const icons: Record<number, HTMLCanvasElement> = {};
  const pick1 = (id: number, arr: HTMLCanvasElement[]): HTMLCanvasElement => { const c = cloneTex(arr[0]); icons[id] = c; return c; };
  pick1(IT.DIRT, tiles.get(T.DIRT)!);
  pick1(IT.STONE, tiles.get(T.STONE)!);
  pick1(IT.CLAY, tiles.get(T.CLAY)!);
  pick1(IT.WOOD, tiles.get(T.WOOD)!);
  pick1(IT.ORE_COPPER, tiles.get(T.ORE_COPPER)!);
  pick1(IT.ORE_IRON, tiles.get(T.ORE_IRON)!);
  pick1(IT.ORE_SILVER, tiles.get(T.ORE_SILVER)!);
  pick1(IT.ORE_GOLD, tiles.get(T.ORE_GOLD)!);
  icons[IT.GEL] = gelIcon();
  icons[IT.TORCH] = torchIcon(flames[0]);
  pick1(IT.PLATFORM, tiles.get(T.PLATFORM)!);
  icons[IT.WORKBENCH] = scaledIcon(sprites.workbench, 32, 16);
  icons[IT.FURNACE] = scaledIcon(sprites.furnace, 32, 32);
  icons[IT.ANVIL] = scaledIcon(sprites.anvil, 32, 16);
  icons[IT.BAR_IRON] = barIcon(METALS.iron);
  icons[IT.BAR_SILVER] = barIcon(METALS.silver);
  icons[IT.BAR_GOLD] = barIcon(METALS.gold);
  icons[IT.COPPER_PICK] = pickIcon(METALS.copper);
  icons[IT.COPPER_AXE] = axeIcon(METALS.copper);
  icons[IT.COPPER_SWORD] = swordIcon(METALS.copper, false);
  icons[IT.WOOD_SWORD] = swordIcon(METALS.wood, true);
  icons[IT.IRON_PICK] = pickIcon(METALS.iron);
  icons[IT.IRON_SWORD] = swordIcon(METALS.iron, true);
  icons[IT.SILVER_PICK] = pickIcon(METALS.silver);
  icons[IT.SILVER_SWORD] = swordIcon(METALS.silver, true);
  icons[IT.GOLD_PICK] = pickIcon(METALS.gold);
  icons[IT.GOLD_SWORD] = swordIcon(METALS.gold, true);

  // ---- 群系方块图标: 直接复用 tiles 贴图 ----
  pick1(IT.SAND, tiles.get(T.SAND)!);
  pick1(IT.SNOW, tiles.get(T.SNOW)!);
  pick1(IT.ICE, tiles.get(T.ICE)!);
  pick1(IT.MUD, tiles.get(T.MUD)!);
  pick1(IT.ASH, tiles.get(T.ASH)!);
  pick1(IT.OBSIDIAN, tiles.get(T.OBSIDIAN)!);
  pick1(IT.EBONSTONE, tiles.get(T.CORRUPT_STONE)!);
  pick1(IT.CACTUS, tiles.get(T.CACTUS)!);
  pick1(IT.HELLSTONE_ORE, tiles.get(T.HELLSTONE)!);
  // ---- 绘制类图标 ----
  icons[IT.BOW] = bowIcon();
  icons[IT.ARROW] = arrowIcon();
  icons[IT.BOMB] = bombIcon();
  icons[IT.LENS] = lensIcon();
  icons[IT.LIFE_CRYSTAL] = cloneTex(crystalFrames[0]);
  icons[IT.EYE_SUMMON] = eyeSummonIcon();
  icons[IT.DEMONITE_ORE] = demoniteOreIcon();
  icons[IT.DEMONITE_BAR] = barIcon(METALS.demonite);
  icons[IT.HELLSTONE_BAR] = barIcon(METALS.hellstone);
  icons[IT.COPPER_BAR] = barIcon(METALS.copper);
  icons[IT.NIGHTMARE_PICK] = pickIcon(METALS.nightmare);
  icons[IT.MOLTEN_PICK] = moltenPickIcon();
  icons[IT.LIGHTS_BANE] = lightsBaneIcon();
  icons[IT.VOLCANO] = volcanoIcon();
  icons[IT.ACORN] = acornIcon();
  icons[IT.WOODEN_DOOR] = scaledIcon(sprites.doorC, 16, 32);
  icons[IT.CHEST] = scaledIcon(sprites.chest, 32, 32);
  icons[IT.TABLE] = scaledIcon(sprites.table, 32, 16);
  icons[IT.CHAIR] = scaledIcon(sprites.chair, 16, 16);
  // ---- 盔甲 15 件: 三种基础形 × 五套配色 (暗影套加紫光边) ----
  const shadowEdge = '#8a6ab0';
  ARMOR_SETS.forEach(([h, m, l]) => {
    const [hc, bc, lc] = ARMOR_COLORS[h];
    const edge = h === IT.SHADOW_HELM ? shadowEdge : undefined;
    icons[h] = helmetIcon(hc, edge);
    icons[m] = mailIcon(bc, edge);
    icons[l] = legsIcon(lc, edge);
  });

  const iconURL: Record<number, string> = {};
  Object.entries(icons).forEach(([k, c]) => { iconURL[Number(k)] = c.toDataURL(); });

  const anchors: Record<number, [number, number]> = {};
  [
    IT.COPPER_PICK, IT.COPPER_AXE, IT.IRON_PICK, IT.SILVER_PICK, IT.GOLD_PICK,
    IT.NIGHTMARE_PICK, IT.MOLTEN_PICK,
  ].forEach((id) => { anchors[id] = [4, 12]; });
  [
    IT.COPPER_SWORD, IT.WOOD_SWORD, IT.IRON_SWORD, IT.SILVER_SWORD, IT.GOLD_SWORD,
    IT.LIGHTS_BANE, IT.VOLCANO,
  ].forEach((id) => { anchors[id] = [3, 11]; });
  anchors[IT.TORCH] = [8, 14];

  const heart = drawHeart('#e03c3c', '#ff8080', '#a02020');
  const heartEmpty = drawHeart('#3a3a44', '#4a4a56', '#26262e');

  cache = {
    tiles, walls,
    grassTop: drawGrassTop(),
    grassSideL: drawGrassSide(true),
    grassSideR: drawGrassSide(false),
    branchL: drawBranch(true),
    branchR: drawBranch(false),
    rootL: drawRoot(true),
    rootR: drawRoot(false),
    leaves, cracks, flames,
    glowWarm: radialGlow(64, 'rgba(255,190,110,0.9)', 'rgba(255,190,110,0.55)', 'rgba(255,190,110,0)'),
    glowWhite: radialGlow(64, 'rgba(255,255,240,0.9)', 'rgba(255,255,240,0.55)', 'rgba(255,255,240,0)'),
    glowBlue: radialGlow(64, 'rgba(150,170,255,0.9)', 'rgba(120,140,245,0.55)', 'rgba(100,120,235,0)'),
    glowRed: radialGlow(64, 'rgba(255,140,70,0.9)', 'rgba(255,100,55,0.55)', 'rgba(255,80,40,0)'),
    sprites, crystalFrames, icons, iconURL, anchors,
    heartURL: heart.toDataURL(),
    heartEmptyURL: heartEmpty.toDataURL(),
    bubbleURL: drawBubble().toDataURL(),
  };
  return cache;
}
