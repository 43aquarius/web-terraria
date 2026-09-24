/**
 * 程序化像素美术生成器
 * 全部贴图用代码绘制(泰拉瑞亚风格 16x16 像素画)，无外部素材
 */

import { T, IT } from './constants';

// ==================== 工具函数 ====================
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

// ==================== 方块纹理绘制 ====================

function drawDirt(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#976b49');
  for (let i = 0; i < 7; i++) px(x, (r() * 15) | 0, (r() * 15) | 0, 2, 2, '#6e4a33');
  for (let i = 0; i < 5; i++) px(x, (r() * 15) | 0, (r() * 15) | 0, 2, 2, '#b58a5f');
  for (let i = 0; i < 16; i++) px(x, (r() * 16) | 0, (r() * 16) | 0, 1, 1, r() < 0.5 ? '#6e4a33' : '#a87d54');
}

function drawStone(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#7d7d85');
  for (let i = 0; i < 6; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 2, '#5c5c66');
  for (let i = 0; i < 4; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 2, '#9c9ca6');
  for (let i = 0; i < 14; i++) px(x, (r() * 16) | 0, (r() * 16) | 0, 1, 1, '#666670');
  // 裂纹
  const cx = 2 + (r() * 11) | 0, cy = 2 + (r() * 11) | 0;
  for (let i = 0; i < 3; i++) px(x, cx + i, cy + i - 1, 1, 1, '#4a4a54');
}

function drawClay(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#b0664a');
  for (let i = 0; i < 4; i++) px(x, (r() * 10) | 0, 5, 6, 1, '#974f36');
  for (let i = 0; i < 4; i++) px(x, (r() * 10) | 0, 11, 6, 1, '#974f36');
  for (let i = 0; i < 8; i++) px(x, (r() * 15) | 0, (r() * 15) | 0, 2, 1, '#c98264');
  for (let i = 0; i < 6; i++) px(x, (r() * 16) | 0, (r() * 16) | 0, 1, 1, '#8f4f37');
}

function drawOre(x: CanvasRenderingContext2D, r: () => number, mid: string, light: string): void {
  drawStone(x, r);
  const n = 3 + ((r() * 2) | 0);
  for (let i = 0; i < n; i++) {
    const ox = 1 + ((r() * 12) | 0), oy = 1 + ((r() * 12) | 0);
    px(x, ox, oy, 2, 2, mid);
    px(x, ox, oy, 1, 1, light);
    if (r() < 0.6) px(x, ox + 2, oy + 1, 2, 2, mid);
    if (r() < 0.4) px(x, ox - 1, oy + 2, 1, 1, mid);
  }
}

function drawWoodBlock(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#a97d4b');
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    px(x, 0, y, 16, 1, '#c49a67');
    px(x, 0, y + 3, 16, 1, '#7a5733');
    const seam = [11, 3, 13, 6][row];
    px(x, seam, y, 1, 3, '#7a5733');
  }
  for (let i = 0; i < 5; i++) px(x, (r() * 16) | 0, (r() * 16) | 0, 1, 1, '#8a6538');
}

function drawTrunk(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#9a6b39');
  px(x, 0, 0, 2, 16, '#6e4523');
  px(x, 14, 0, 2, 16, '#6e4523');
  px(x, 2, 0, 1, 16, '#7a5027');
  px(x, 13, 0, 1, 16, '#7a5027');
  // 纵向纹理
  for (let i = 0; i < 8; i++) {
    const gx = 4 + ((r() * 8) | 0);
    const gy = (r() * 12) | 0;
    px(x, gx, gy, 1, 2 + ((r() * 3) | 0), '#7a5027');
  }
  if (r() < 0.5) px(x, 5 + ((r() * 6) | 0), 3 + ((r() * 9) | 0), 2, 2, '#6e4523');
}

function drawLeaf(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#438c3c');
  for (let i = 0; i < 8; i++) px(x, (r() * 15) | 0, (r() * 15) | 0, 2, 2, '#337030');
  for (let i = 0; i < 6; i++) px(x, (r() * 15) | 0, (r() * 15) | 0, 2, 1, '#61b552');
}

function drawTallGrass(x: CanvasRenderingContext2D, r: () => number): void {
  for (let i = 0; i < 6; i++) {
    const bx = 1 + ((r() * 13) | 0);
    const h = 5 + ((r() * 7) | 0);
    const lean = r() < 0.5 ? 0 : (r() < 0.5 ? 1 : -1);
    for (let j = 0; j < h; j++) {
      const y = 15 - j;
      const xx = j > h - 3 ? bx + lean : bx;
      px(x, xx, y, 1, 1, j > h - 3 ? '#7fc27e' : '#4fa84f');
    }
  }
}

function drawFlower(x: CanvasRenderingContext2D, r: () => number, petal: string, center: string): void {
  const bx = 6 + ((r() * 3) | 0);
  const h = 5 + ((r() * 3) | 0);
  px(x, bx, 16 - h, 1, h, '#3a7a2e');
  px(x, bx - 1, 16 - h + 2, 1, 1, '#3a7a2e');
  px(x, bx + 1, 16 - h + 3, 1, 1, '#3a7a2e');
  const cy = 16 - h - 2;
  px(x, bx - 1, cy - 1, 3, 3, petal);
  px(x, bx, cy - 2, 1, 1, petal);
  px(x, bx, cy + 1, 1, 1, petal);
  px(x, bx - 2, cy, 1, 1, petal);
  px(x, bx + 2, cy, 1, 1, petal);
  px(x, bx, cy, 1, 1, center);
}

function drawTorchStatic(x: CanvasRenderingContext2D): void {
  px(x, 7, 6, 2, 10, '#7a5733');
  px(x, 8, 6, 1, 10, '#5e4023');
  px(x, 6, 5, 4, 2, '#3a3a3a');
  px(x, 7, 4, 2, 1, '#2a2a2a');
}

function drawPlatform(x: CanvasRenderingContext2D): void {
  px(x, 0, 0, 16, 5, '#a97d4b');
  px(x, 0, 0, 16, 1, '#c49a67');
  px(x, 0, 4, 16, 1, '#7a5733');
  px(x, 5, 0, 1, 4, '#7a5733');
  px(x, 11, 0, 1, 4, '#7a5733');
  px(x, 2, 5, 2, 4, '#7a5733');
  px(x, 12, 5, 2, 4, '#7a5733');
}

// ==================== 家具整体贴图 ====================

function drawWorkbench(): HTMLCanvasElement {
  const [c, x] = mk(32, 16);
  // 桌面
  px(x, 0, 4, 32, 4, '#a97d4b');
  px(x, 0, 4, 32, 1, '#c49a67');
  px(x, 0, 7, 32, 1, '#7a5733');
  px(x, 9, 4, 1, 4, '#7a5733');
  px(x, 22, 4, 1, 4, '#7a5733');
  // 桌腿
  px(x, 2, 8, 3, 8, '#7a5733');
  px(x, 27, 8, 3, 8, '#7a5733');
  px(x, 3, 8, 1, 8, '#5e4023');
  // 桌上的锤子
  px(x, 13, 1, 4, 2, '#6e6e78');
  px(x, 17, 1, 1, 2, '#8a8a92');
  px(x, 15, 3, 1, 2, '#7a5733');
  return c;
}

function drawFurnace(): HTMLCanvasElement {
  const [c, x] = mk(32, 32);
  // 砖石主体
  px(x, 0, 4, 32, 26, '#6a6a72');
  px(x, 0, 4, 32, 1, '#8a8a92');
  px(x, 0, 29, 32, 1, '#4e4e56');
  // 砖缝
  for (let by = 6; by < 28; by += 5) {
    px(x, 0, by, 32, 1, '#4e4e56');
    const off = (((by / 5) | 0) % 2) * 4;
    for (let bx = 0; bx < 32; bx += 8) px(x, (bx + off) % 32, by, 1, 5, '#4e4e56');
  }
  // 顶部炉口
  px(x, 10, 0, 12, 4, '#1c1c22');
  px(x, 9, 0, 1, 4, '#4e4e56');
  px(x, 22, 0, 1, 4, '#4e4e56');
  // 前面火口
  px(x, 8, 16, 16, 12, '#141418');
  px(x, 7, 15, 18, 1, '#4e4e56');
  px(x, 7, 16, 1, 12, '#4e4e56');
  px(x, 24, 16, 1, 12, '#4e4e56');
  // 火口红光边缘
  px(x, 9, 16, 14, 1, '#8a4a20');
  // 底脚
  px(x, 2, 28, 4, 4, '#4e4e56');
  px(x, 26, 28, 4, 4, '#4e4e56');
  return c;
}

function drawAnvil(): HTMLCanvasElement {
  const [c, x] = mk(32, 16);
  // 顶面
  px(x, 4, 2, 24, 4, '#4a4a52');
  px(x, 4, 2, 24, 1, '#6e6e78');
  px(x, 0, 3, 4, 3, '#4a4a52');          // 尖角
  px(x, 28, 3, 4, 3, '#4a4a52');
  px(x, 0, 3, 4, 1, '#5e5e68');
  // 腰
  px(x, 11, 6, 10, 5, '#3c3c44');
  // 底座
  px(x, 8, 11, 16, 5, '#4a4a52');
  px(x, 8, 11, 16, 1, '#5e5e68');
  px(x, 6, 13, 20, 3, '#3c3c44');
  return c;
}

// ==================== 草的覆盖层 ====================

function drawGrassTop(): HTMLCanvasElement {
  const [c, x] = mk(16, 8);
  const r = mulberry32(77);
  px(x, 0, 1, 16, 3, '#3f8f3a');
  for (let i = 0; i < 16; i += 2) px(x, i, 0, 2, 1, r() < 0.75 ? '#75c455' : '#3f8f3a');
  for (let i = 0; i < 16; i++) if (r() < 0.4) px(x, i, 1, 1, 1, '#75c455');
  px(x, 0, 4, 16, 1, '#367c31');
  for (let i = 0; i < 5; i++) px(x, (r() * 16) | 0, 5 + ((r() * 2) | 0), 1, 2, '#337030');
  return c;
}

function drawGrassSide(left: boolean): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const r = mulberry32(left ? 78 : 79);
  const ex = left ? 0 : 13;
  px(x, ex, 0, 3, 16, '#3f8f3a');
  px(x, left ? 0 : 15, 0, 1, 16, '#75c455');
  px(x, ex + (left ? 3 : -1), 0, 1, 16, '#337030');
  for (let i = 0; i < 4; i++) px(x, ex + 1, (r() * 16) | 0, 1, 2, '#75c455');
  return c;
}

// 树枝覆盖
function drawBranch(left: boolean): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  if (left) {
    px(x, 0, 8, 5, 2, '#7a5027');
    px(x, 3, 6, 2, 2, '#7a5027');
    px(x, 0, 5, 3, 2, '#438c3c');
    px(x, 1, 3, 2, 2, '#438c3c');
    px(x, 0, 7, 1, 1, '#61b552');
  } else {
    px(x, 11, 8, 5, 2, '#7a5027');
    px(x, 11, 6, 2, 2, '#7a5027');
    px(x, 13, 5, 3, 2, '#438c3c');
    px(x, 13, 3, 2, 2, '#438c3c');
    px(x, 15, 7, 1, 1, '#61b552');
  }
  return c;
}

// ==================== 树根覆盖层 ====================
// left=true: 起点疙瘩在贴图右缘(紧贴树干一侧), 根须向左下延伸扎入草地; right 为水平镜像
function drawRoot(left: boolean): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const put = (rx: number, ry: number, w: number, h: number, color: string): void => {
    px(x, left ? rx : 16 - rx - w, ry, w, h, color);
  };
  put(14, 9, 2, 2, '#6e4523');     // 起点疙瘩(连接树干底部)
  put(12, 10, 2, 2, '#9a6b39');    // 主根(2px 宽)
  put(10, 11, 2, 2, '#9a6b39');
  put(8, 12, 2, 1, '#7a5027');     // 渐细为 1px 高
  put(6, 13, 2, 1, '#7a5027');
  put(11, 13, 1, 1, '#7a5027');    // 陡分叉小根
  put(10, 14, 1, 1, '#7a5027');
  put(12, 8, 2, 1, '#9a6b39');     // 浅层近水平小根
  put(10, 8, 2, 1, '#7a5027');
  return c;
}

// ==================== 树叶 mask 变体 ====================
// bit: 1=上 2=下 4=左 8=右 (邻格是树叶/树干)
function leafVariant(mask: number): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const r = mulberry32(1000 + mask * 17);
  drawLeaf(x, r);
  const up = !(mask & 1), down = !(mask & 2), left = !(mask & 4), right = !(mask & 8);
  if (up) {
    px(x, 0, 0, 16, 1, '#72c05e');
    for (let i = 0; i < 6; i++) px(x, (r() * 16) | 0, 1, 1, 1, '#72c05e');
    if (left) x.clearRect(0, 0, 3, 2);
    if (right) x.clearRect(13, 0, 3, 2);
  }
  if (down) {
    px(x, 0, 15, 16, 1, '#337030');
    if (left) x.clearRect(0, 14, 3, 2);
    if (right) x.clearRect(13, 14, 3, 2);
  }
  if (left) {
    px(x, 0, 0, 1, 16, '#3d8234');
    if (down) x.clearRect(0, 13, 2, 3);
    if (up) x.clearRect(0, 0, 2, 3);
  }
  if (right) {
    px(x, 15, 0, 1, 16, '#3d8234');
    if (down) x.clearRect(14, 13, 2, 3);
    if (up) x.clearRect(14, 0, 2, 3);
  }
  return c;
}

// ==================== 裂纹 ====================
function drawCrack(stage: number): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const r = mulberry32(4000 + stage);
  x.fillStyle = 'rgba(0,0,0,0.62)';
  const n = stage + 2;
  for (let i = 0; i < n; i++) {
    let cx = 6 + ((r() * 4) | 0), cy = 6 + ((r() * 4) | 0);
    const dx = r() < 0.5 ? 1 : -1, dy = r() < 0.5 ? 1 : -1;
    const len = 2 + ((r() * 3) | 0);
    for (let j = 0; j < len; j++) {
      x.fillRect(cx, cy, 1, 1);
      cx += r() < 0.7 ? dx : 0;
      cy += r() < 0.7 ? dy : 0;
    }
  }
  return c;
}

// ==================== 火焰动画帧 ====================
function drawFlame(frame: number): HTMLCanvasElement {
  const [c, x] = mk(8, 12);
  const r = mulberry32(5000 + frame);
  const wob = Math.sin(frame * 1.7) * 1.2;
  for (let y = 11; y >= 2; y--) {
    const t = (11 - y) / 9;
    let w = Math.max(1, Math.round(3.2 * (1 - t * 0.75) + (y < 5 ? 0.5 : 0)));
    if (y < 5) w = Math.max(1, w - 1);
    const cx = 3 + Math.round(Math.sin(frame * 2.1 + y * 0.55) * (0.6 + t * 0.9)) + (wob * t > 0.8 ? 1 : 0);
    let col: string;
    if (y >= 8) col = '#ff9a3c';
    else if (y >= 5) col = '#ffb84a';
    else col = '#ffe08a';
    px(x, cx - (w >> 1), y, w, 1, col);
    if (y === 3 || y === 2) px(x, cx, y, 1, 1, '#fff6c8');
  }
  if (r() < 0.7) px(x, 2 + ((r() * 4) | 0), 0 + ((r() * 2) | 0), 1, 1, '#ffb84a');
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

// ==================== 物品图标 ====================

interface MetalColors { dark: string; mid: string; light: string }

const METALS: Record<string, MetalColors> = {
  copper: { dark: '#8a5426', mid: '#c87f42', light: '#eaa96a' },
  iron: { dark: '#7c6a5a', mid: '#a89484', light: '#cbb9a6' },
  silver: { dark: '#a8b2bc', mid: '#d8dde2', light: '#f4f8fb' },
  gold: { dark: '#b8952a', mid: '#e5c443', light: '#f7e07a' },
  wood: { dark: '#6e4523', mid: '#a97d4b', light: '#c49a67' },
};

function drawHandle(x: CanvasRenderingContext2D): void {
  // 从(3,13)到(10,6)的斜柄
  for (let i = 0; i < 8; i++) px(x, 3 + i - 1, 13 - i, 2, 2, '#7a5733');
  px(x, 2, 13, 2, 2, '#5e4023');
}

function pickIcon(m: MetalColors): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  drawHandle(x);
  // 镐头弧线
  for (let a = 200; a <= 340; a += 12) {
    const rad = (a * Math.PI) / 180;
    const hx = 9.5 + Math.cos(rad) * 6.2;
    const hy = 7.5 + Math.sin(rad) * 4.2;
    px(x, Math.round(hx), Math.round(hy), 2, 2, m.mid);
  }
  for (let a = 220; a <= 320; a += 20) {
    const rad = (a * Math.PI) / 180;
    px(x, Math.round(9.5 + Math.cos(rad) * 6.2) - 1, Math.round(7.5 + Math.sin(rad) * 4.2) - 1, 1, 1, m.light);
  }
  px(x, 9, 6, 2, 2, m.dark);
  return c;
}

function axeIcon(m: MetalColors): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  drawHandle(x);
  px(x, 7, 1, 6, 5, m.mid);
  px(x, 5, 2, 2, 4, m.mid);
  px(x, 7, 1, 6, 1, m.light);
  px(x, 12, 1, 1, 5, m.light);
  px(x, 7, 5, 6, 1, m.dark);
  px(x, 5, 5, 2, 1, m.dark);
  return c;
}

function shortSwordIcon(m: MetalColors): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  for (let i = 0; i < 7; i++) {
    px(x, 10 - i, 2 + i, 2, 2, m.mid);
    px(x, 10 - i, 2 + i, 1, 1, m.light);
  }
  px(x, 4, 9, 3, 1, '#d4a017');
  px(x, 4, 10, 2, 1, '#d4a017');
  px(x, 2, 11, 2, 3, '#7a5733');
  px(x, 1, 13, 2, 2, '#d4a017');
  return c;
}

function broadSwordIcon(m: MetalColors): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  for (let i = 0; i < 8; i++) {
    px(x, 12 - i, 1 + i, 3, 2, m.mid);
    px(x, 12 - i, 1 + i, 1, 2, m.light);
  }
  px(x, 12, 1, 2, 1, m.light);
  px(x, 3, 9, 4, 1, '#d4a017');
  px(x, 4, 8, 1, 3, '#d4a017');
  px(x, 2, 11, 2, 3, '#7a5733');
  px(x, 1, 13, 2, 2, '#d4a017');
  return c;
}

function barIcon(m: MetalColors): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  px(x, 3, 7, 10, 5, m.mid);
  px(x, 4, 6, 8, 1, m.mid);
  px(x, 4, 6, 8, 1, m.light);
  px(x, 3, 11, 10, 1, m.dark);
  px(x, 4, 7, 2, 1, m.light);
  return c;
}

function gelIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  x.globalAlpha = 0.88;
  px(x, 3, 6, 10, 8, '#4a7ae0');
  px(x, 4, 5, 8, 1, '#4a7ae0');
  px(x, 5, 4, 6, 1, '#4a7ae0');
  px(x, 4, 13, 8, 1, '#3558b0');
  x.globalAlpha = 1;
  px(x, 5, 6, 3, 2, '#8ab0f0');
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

function torchIcon(flame: HTMLCanvasElement): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  px(x, 7, 7, 2, 8, '#7a5733');
  px(x, 8, 7, 1, 8, '#5e4023');
  px(x, 6, 6, 4, 2, '#3a3a3a');
  x.drawImage(flame, 4, -1);
  return c;
}

// ==================== 心形 / 气泡 ====================

const HEART_ROWS: [number, number][] = [
  [5, 10], [3, 12], [2, 13], [2, 13], [2, 13], [2, 13], [3, 12], [5, 10], [7, 8],
];

function drawHeart(main: string, shine: string, dark: string): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  HEART_ROWS.forEach(([a, b], i) => px(x, a, 3 + i, b - a, 1, main));
  px(x, 4, 4, 2, 2, shine);
  px(x, 3, 5, 1, 3, shine);
  px(x, 6, 10, 4, 1, dark);
  px(x, 5, 9, 1, 2, dark);
  px(x, 10, 9, 1, 2, dark);
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
  sprites: Record<string, HTMLCanvasElement>;
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
  const variants = (n: number, fn: (x: CanvasRenderingContext2D, r: () => number, i: number) => void, seed: number): HTMLCanvasElement[] => {
    const arr: HTMLCanvasElement[] = [];
    for (let i = 0; i < n; i++) {
      const [c, x] = mk(16, 16);
      fn(x, mulberry32(seed + i * 131), i);
      arr.push(c);
    }
    return arr;
  };

  tiles.set(T.DIRT, variants(3, drawDirt, 11));
  tiles.set(T.STONE, variants(3, drawStone, 22));
  tiles.set(T.CLAY, variants(3, drawClay, 33));
  tiles.set(T.WOOD, variants(1, drawWoodBlock, 44));
  tiles.set(T.TRUNK, variants(3, drawTrunk, 55));
  {
    const [c, x] = mk(16, 16); drawTorchStatic(x);
    tiles.set(T.TORCH, [c]);
  }
  {
    const [c, x] = mk(16, 16); drawPlatform(x);
    tiles.set(T.PLATFORM, [c]);
  }
  // 草方块: 覆盖层模式
  tiles.set(T.GRASS, tiles.get(T.DIRT)!);
  tiles.set(T.ORE_COPPER, variants(3, (x, r) => drawOre(x, r, '#c87f42', '#eaa96a'), 66));
  tiles.set(T.ORE_IRON, variants(3, (x, r) => drawOre(x, r, '#a89484', '#cbb9a6'), 77));
  tiles.set(T.ORE_SILVER, variants(3, (x, r) => drawOre(x, r, '#d8dde2', '#f4f8fb'), 88));
  tiles.set(T.ORE_GOLD, variants(3, (x, r) => drawOre(x, r, '#e5c443', '#f7e07a'), 99));
  tiles.set(T.TGRASS, variants(3, drawTallGrass, 111));
  tiles.set(T.FLW_R, variants(2, (x, r) => drawFlower(x, r, '#e05555', '#f7e07a'), 122));
  tiles.set(T.FLW_Y, variants(2, (x, r) => drawFlower(x, r, '#e8c94a', '#d8a020'), 133));
  tiles.set(T.FLW_B, variants(2, (x, r) => drawFlower(x, r, '#5a7ae0', '#f7e07a'), 144));

  // 背景墙
  const walls = new Map<number, HTMLCanvasElement[]>();
  const wallFrom = (base: (x: CanvasRenderingContext2D, r: () => number) => void, seed: number, shade: string): HTMLCanvasElement[] => {
    const arr: HTMLCanvasElement[] = [];
    for (let i = 0; i < 2; i++) {
      const [c, x] = mk(16, 16);
      base(x, mulberry32(seed + i * 71));
      px(x, 0, 0, 16, 16, shade);
      arr.push(c);
    }
    return arr;
  };
  walls.set(1, wallFrom(drawDirt, 300, 'rgba(28,18,12,0.52)'));   // 泥土墙
  walls.set(2, wallFrom(drawStone, 400, 'rgba(14,14,20,0.52)'));   // 石头墙

  // 树叶变体
  const leaves = new Map<number, HTMLCanvasElement>();
  for (let m = 0; m < 16; m++) leaves.set(m, leafVariant(m));

  const cracks: HTMLCanvasElement[] = [0, 1, 2, 3].map(drawCrack);
  const flames: HTMLCanvasElement[] = [0, 1, 2, 3].map(drawFlame);

  const sprites: Record<string, HTMLCanvasElement> = {
    workbench: drawWorkbench(),
    furnace: drawFurnace(),
    anvil: drawAnvil(),
  };

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
  icons[IT.COPPER_SWORD] = shortSwordIcon(METALS.copper);
  icons[IT.WOOD_SWORD] = broadSwordIcon(METALS.wood);
  icons[IT.IRON_PICK] = pickIcon(METALS.iron);
  icons[IT.IRON_SWORD] = broadSwordIcon(METALS.iron);
  icons[IT.SILVER_PICK] = pickIcon(METALS.silver);
  icons[IT.SILVER_SWORD] = broadSwordIcon(METALS.silver);
  icons[IT.GOLD_PICK] = pickIcon(METALS.gold);
  icons[IT.GOLD_SWORD] = broadSwordIcon(METALS.gold);

  const iconURL: Record<number, string> = {};
  Object.entries(icons).forEach(([k, c]) => { iconURL[Number(k)] = c.toDataURL(); });

  const anchors: Record<number, [number, number]> = {};
  [
    IT.COPPER_PICK, IT.COPPER_AXE, IT.IRON_PICK, IT.SILVER_PICK, IT.GOLD_PICK,
  ].forEach((id) => { anchors[id] = [4, 12]; });
  [
    IT.COPPER_SWORD, IT.WOOD_SWORD, IT.IRON_SWORD, IT.SILVER_SWORD, IT.GOLD_SWORD,
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
    sprites, icons, iconURL, anchors,
    heartURL: heart.toDataURL(),
    heartEmptyURL: heartEmpty.toDataURL(),
    bubbleURL: drawBubble().toDataURL(),
  };
  return cache;
}
