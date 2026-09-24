/**
 * 程序化像素美术生成器
 * 全部贴图用代码绘制(泰拉瑞亚风格 16x16 像素画)，无外部素材
 */

import { T, IT, ARMOR_COLORS, W_SAND, W_SNOW, W_MUD, W_EBON } from './constants';

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

// ==================== 群系扩展方块 ====================

/** 边缘微暗(底/右 1px): 成片铺设时有轻微块面感 */
function edgeShade(x: CanvasRenderingContext2D): void {
  px(x, 0, 15, 16, 1, 'rgba(0,0,0,0.14)');
  px(x, 15, 0, 1, 15, 'rgba(0,0,0,0.14)');
}

function drawSand(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#d8c078');
  for (let i = 0; i < 6; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 2, '#c4aa62');
  for (let i = 0; i < 4; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 1, '#e6d294');
  for (let i = 0; i < 18; i++) px(x, (r() * 16) | 0, (r() * 16) | 0, 1, 1, r() < 0.5 ? '#b89e5c' : '#e0cc8c');
  edgeShade(x);
}

function drawSnow(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#e8f0f4');
  for (let i = 0; i < 5; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 2, '#d8e4ec');
  for (let i = 0; i < 4; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 1, '#f8fbfd');
  for (let i = 0; i < 14; i++) px(x, (r() * 16) | 0, (r() * 16) | 0, 1, 1, r() < 0.5 ? '#c8d8e4' : '#ffffff');
  edgeShade(x);
}

function drawIce(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#a8d0e8');
  // 浅色斜条纹(不透明底的半透明感)
  for (let s = 0; s < 3; s++) {
    const off = s * 5 + ((r() * 2) | 0);
    for (let i = 0; i < 16; i++) {
      px(x, (off + i) % 16, i, 1, 1, i % 3 === 2 ? '#b8dcee' : '#c4e4f4');
    }
  }
  for (let i = 0; i < 4; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 2, '#88b4d0');
  px(x, 1, 1, 3, 1, '#e0f0fa');       // 高光角
  px(x, 1, 2, 2, 1, '#d0e8f6');
  px(x, 2, 1, 1, 2, '#eef8fe');
  edgeShade(x);
}

function drawMud(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#6a5a48');
  for (let i = 0; i < 7; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 2, '#544632');
  for (let i = 0; i < 5; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 1, '#7e6c54');
  for (let i = 0; i < 12; i++) px(x, (r() * 16) | 0, (r() * 16) | 0, 1, 1, r() < 0.5 ? '#463a2a' : '#78644c');
  edgeShade(x);
}

/** 丛林草: 自包含整块(下半泥/上半草皮/顶缘草须), 无需覆盖层 */
function drawJungleGrass(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 7, '#3e8432');
  px(x, 0, 7, 16, 9, '#6a5a48');
  for (let i = 0; i < 6; i++) px(x, (r() * 15) | 0, (r() * 6) | 0, 2, 1, '#357028');
  for (let i = 0; i < 4; i++) px(x, (r() * 15) | 0, 1 + ((r() * 5) | 0), 1, 1, '#5aa848');
  for (let i = 0; i < 6; i++) px(x, (r() * 14) | 0, 8 + ((r() * 7) | 0), 2, 2, '#544632');
  for (let i = 0; i < 4; i++) px(x, (r() * 15) | 0, 8 + ((r() * 7) | 0), 1, 1, '#7e6c54');
  px(x, 0, 7, 16, 1, '#2e621f');                          // 草皮/泥交界
  for (let i = 0; i < 5; i++) px(x, (r() * 16) | 0, 8, 1, 1 + ((r() * 2) | 0), '#3e8432'); // 草根下探
  for (let i = 0; i < 16; i += 2) px(x, i + ((r() * 2) | 0), 0, 1, 2, r() < 0.6 ? '#5cb852' : '#4a9c40'); // 顶缘草须
}

function drawCorruptStone(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#5a4a72');
  for (let i = 0; i < 6; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 2, '#463a5c');
  for (let i = 0; i < 4; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 2, '#6c5a86');
  for (let i = 0; i < 12; i++) px(x, (r() * 16) | 0, (r() * 16) | 0, 1, 1, '#3e3450');
  // 硬朗裂纹(两条近直线)
  for (let n = 0; n < 2; n++) {
    const cx = 1 + ((r() * 10) | 0), cy = 1 + ((r() * 10) | 0);
    const len = 5 + ((r() * 3) | 0);
    for (let i = 0; i < len; i++) px(x, cx + i, cy + ((i * 0.6) | 0), 1, 1, '#332a48');
  }
  edgeShade(x);
}

/** 腐化草: 自包含整块(下泥土上紫草) */
function drawCorruptGrass(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 7, '#7a5a9a');
  px(x, 0, 7, 16, 9, '#5f4f42');
  for (let i = 0; i < 6; i++) px(x, (r() * 15) | 0, (r() * 6) | 0, 2, 1, '#66488a');
  for (let i = 0; i < 4; i++) px(x, (r() * 15) | 0, 1 + ((r() * 5) | 0), 1, 1, '#9678b4');
  for (let i = 0; i < 6; i++) px(x, (r() * 14) | 0, 8 + ((r() * 7) | 0), 2, 2, '#4e4034');
  for (let i = 0; i < 4; i++) px(x, (r() * 15) | 0, 8 + ((r() * 7) | 0), 1, 1, '#6f5c4c');
  px(x, 0, 7, 16, 1, '#5a4078');
  for (let i = 0; i < 5; i++) px(x, (r() * 16) | 0, 8, 1, 1 + ((r() * 2) | 0), '#7a5a9a');
  for (let i = 0; i < 16; i += 2) px(x, i + ((r() * 2) | 0), 0, 1, 2, r() < 0.6 ? '#8a68ac' : '#9a7ac0');
}

function drawAsh(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#4a4448');
  for (let i = 0; i < 8; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 2, '#524c50');
  for (let i = 0; i < 6; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 2, '#3e383c');
  for (let i = 0; i < 16; i++) px(x, (r() * 16) | 0, (r() * 16) | 0, 1, 1, r() < 0.5 ? '#564e52' : '#403a3e');
  edgeShade(x);
}

function drawHellstone(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#6a2818');
  for (let i = 0; i < 6; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 2, '#521c10');
  for (let i = 0; i < 5; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 2, '#7e3418');
  const n = 4 + ((r() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const ox = 1 + ((r() * 13) | 0), oy = 1 + ((r() * 13) | 0);
    px(x, ox, oy, 2, 2, '#e05a24');     // 亮橙余烬(强对比)
    px(x, ox, oy, 1, 1, '#f08c48');
    if (r() < 0.35) px(x, ox + 1, oy - 1, 1, 1, '#ffc06a');
  }
  edgeShade(x);
}

function drawLavaTile(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#c8481a');
  for (let i = 0; i < 6; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 2, '#a83812');
  for (let i = 0; i < 5; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 2, '#e8602c');
  for (let i = 0; i < 7; i++) px(x, (r() * 16) | 0, (r() * 16) | 0, 1, 1, '#ffb060');
  if (r() < 0.7) px(x, 2 + ((r() * 10) | 0), 2 + ((r() * 10) | 0), 3, 2, '#f08040');
}

function drawObsidian(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#2a2438');
  for (let i = 0; i < 5; i++) px(x, (r() * 14) | 0, (r() * 14) | 0, 2, 2, '#221c30');
  // 紫高光斜线
  for (let s = 0; s < 2; s++) {
    const off = 2 + s * 7 + ((r() * 2) | 0);
    for (let i = 0; i < 16; i++) {
      const ix = off + i - 4;
      if (ix >= 0 && ix < 16) px(x, ix, i, 1, 1, i % 2 ? '#4a3e68' : '#3e3458');
    }
  }
  px(x, 2, 1, 2, 1, '#5e4e88');        // 玻璃质高光角
  for (let i = 0; i < 3; i++) px(x, (r() * 16) | 0, (r() * 16) | 0, 1, 1, '#524478');
  edgeShade(x);
}

function drawMushStem(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#c8d8e8');
  px(x, 0, 0, 2, 16, '#a8bcd0');       // 边缘暗
  px(x, 14, 0, 2, 16, '#a8bcd0');
  px(x, 2, 0, 1, 16, '#d8e6f2');
  px(x, 13, 0, 1, 16, '#b0c4d8');
  for (let i = 0; i < 7; i++) px(x, 4 + ((r() * 8) | 0), (r() * 12) | 0, 1, 2 + ((r() * 3) | 0), '#b4c8da'); // 竖纹
  for (let i = 0; i < 3; i++) px(x, 4 + ((r() * 8) | 0), (r() * 15) | 0, 1, 1, '#e4eef8');
}

function drawMushCap(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#4aa0e8');
  px(x, 0, 0, 16, 2, '#6ab8f0');       // 顶部亮面
  px(x, 0, 13, 16, 3, '#2a6ac0');      // 底部深蓝边缘
  px(x, 0, 12, 16, 1, '#3a82cc');
  for (let i = 0; i < 5; i++) px(x, (r() * 14) | 0, (r() * 10) | 0, 2, 2, '#3a8ad8');
  for (let i = 0; i < 4; i++) px(x, (r() * 15) | 0, (r() * 11) | 0, 1, 1, '#e8f6ff'); // 白色亮点
  if (r() < 0.6) px(x, 3 + ((r() * 9) | 0), 3 + ((r() * 7) | 0), 2, 1, '#a8dcfc');
}

function drawCactus(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 0, 0, 16, 16, '#5a9a4a');
  px(x, 0, 0, 2, 16, '#3e7a36');       // 左右深绿边
  px(x, 14, 0, 2, 16, '#3e7a36');
  px(x, 2, 0, 1, 16, '#6cae58');
  px(x, 13, 0, 1, 16, '#4a8a40');
  for (let i = 0; i < 6; i++) px(x, 4 + ((r() * 8) | 0), (r() * 14) | 0, 1, 2 + ((r() * 2) | 0), '#4e8c42');
  for (let i = 0; i < 7; i++) {        // 左右边缘白刺
    px(x, 0, (r() * 16) | 0, 1, 1, '#e8f0d8');
    if (r() < 0.8) px(x, 15, (r() * 16) | 0, 1, 1, '#e8f0d8');
  }
  for (let i = 0; i < 3; i++) px(x, 4 + ((r() * 8) | 0), (r() * 15) | 0, 1, 1, '#d8e8c8');
}

/** 藤蔓: 透明底, 中间 1-2px 绿藤 + 侧向小叶 */
function drawVine(x: CanvasRenderingContext2D, r: () => number): void {
  let vx = 7 + ((r() * 2) | 0);
  for (let y = 0; y < 16; y++) {
    px(x, vx, y, 1, 1, '#3a7a3a');
    if (r() < 0.3) px(x, vx + (r() < 0.5 ? -1 : 1), y, 1, 1, '#2e6230');
    if (y % 5 === 3 && r() < 0.7) vx = 7 + ((r() * 2) | 0);   // 轻微摆动
  }
  for (let i = 0; i < 3; i++) {
    const ly = 1 + ((r() * 13) | 0);
    const left = r() < 0.5;
    px(x, left ? vx - 2 : vx + 1, ly, 2, 1, '#4a8a4a');
    px(x, left ? vx - 3 : vx + 2, ly, 1, 1, '#5aa05a');
    if (r() < 0.5) px(x, left ? vx - 1 : vx + 1, ly + 1, 1, 1, '#418040');
  }
}

/** 树苗: 透明底小树芽 */
function drawSapling(x: CanvasRenderingContext2D, r: () => number): void {
  px(x, 7, 10, 2, 6, '#7a5027');
  px(x, 7, 10, 1, 6, '#8a5e33');
  px(x, 5, 5, 6, 5, '#4e9b41');
  px(x, 6, 4, 4, 1, '#4e9b41');
  px(x, 6, 9, 4, 1, '#3d8234');
  px(x, 5, 6, 1, 2, '#61b552');
  px(x, 10, 6, 1, 2, '#61b552');
  px(x, 4 + ((r() * 2) | 0), 7, 1, 1, '#61b552');
  if (r() < 0.5) px(x, 11, 5, 1, 1, '#61b552');
  if (r() < 0.5) px(x, 7, 3, 2, 1, '#5cb85c');
}

/** 群系树冠叶(复刻 drawLeaf 画法, 换色) */
function drawLeafBiome(x: CanvasRenderingContext2D, r: () => number, base: string, dark: string, light: string): void {
  px(x, 0, 0, 16, 16, base);
  for (let i = 0; i < 8; i++) px(x, (r() * 15) | 0, (r() * 15) | 0, 2, 2, dark);
  for (let i = 0; i < 6; i++) px(x, (r() * 15) | 0, (r() * 15) | 0, 2, 1, light);
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

/** 木门(关闭, 16x32): 门框 + 门板 + 把手 */
function drawDoorC(): HTMLCanvasElement {
  const [c, x] = mk(16, 32);
  px(x, 0, 0, 2, 32, '#5e4023');       // 门框
  px(x, 14, 0, 2, 32, '#5e4023');
  px(x, 2, 0, 12, 2, '#6e4a28');       // 门楣
  px(x, 2, 2, 12, 30, '#a97d4b');      // 门板
  px(x, 2, 2, 12, 1, '#c49a67');
  px(x, 2, 12, 12, 1, '#7a5733');      // 拼板缝
  px(x, 2, 22, 12, 1, '#7a5733');
  px(x, 7, 3, 1, 9, '#946c40');        // 竖纹
  px(x, 8, 13, 1, 9, '#946c40');
  px(x, 7, 23, 1, 9, '#946c40');
  px(x, 2, 31, 12, 1, '#7a5733');
  px(x, 11, 16, 2, 2, '#e5c443');      // 金把手
  px(x, 11, 16, 1, 1, '#f7e07a');
  return c;
}

/** 木门(打开, 16x32): 门框 + 贴墙薄门板 */
function drawDoorO(): HTMLCanvasElement {
  const [c, x] = mk(16, 32);
  px(x, 0, 0, 2, 32, '#5e4023');
  px(x, 14, 0, 2, 32, '#5e4023');
  px(x, 2, 0, 12, 2, '#6e4a28');
  px(x, 2, 2, 3, 30, '#a97d4b');       // 薄门板(贴左侧)
  px(x, 2, 2, 1, 30, '#c49a67');
  px(x, 4, 2, 1, 30, '#7a5733');
  px(x, 2, 12, 3, 1, '#7a5733');
  px(x, 2, 22, 3, 1, '#7a5733');
  px(x, 3, 16, 1, 2, '#e5c443');       // 把手
  return c;
}

/** 宝箱(32x32): 深木色 + 金色包边 + 锁扣, 顶盖有开合缝 */
function drawChest(): HTMLCanvasElement {
  const [c, x] = mk(32, 32);
  // 下箱体
  px(x, 2, 14, 28, 16, '#8a5f38');
  px(x, 2, 14, 28, 1, '#a97d4b');
  px(x, 2, 20, 28, 1, '#6e4523');      // 木纹
  px(x, 2, 26, 28, 1, '#6e4523');
  // 顶盖(拱形)
  px(x, 4, 6, 24, 8, '#9a6b3e');
  px(x, 6, 4, 20, 2, '#9a6b3e');
  px(x, 4, 6, 24, 1, '#b88a56');
  px(x, 6, 4, 20, 1, '#b88a56');
  px(x, 4, 10, 24, 1, '#7a5027');
  // 开合缝(盖与箱体之间)
  px(x, 2, 13, 28, 1, '#3a2812');
  // 金色包边
  px(x, 2, 14, 2, 16, '#e5c443');
  px(x, 28, 14, 2, 16, '#e5c443');
  px(x, 2, 29, 28, 1, '#d4ae2e');
  px(x, 4, 12, 2, 2, '#e5c443');
  px(x, 26, 12, 2, 2, '#e5c443');
  px(x, 3, 15, 1, 13, '#f7e07a');      // 包边高光
  // 锁扣(中央, 跨开合缝)
  px(x, 14, 11, 4, 6, '#e5c443');
  px(x, 14, 11, 4, 1, '#f7e07a');
  px(x, 15, 13, 2, 2, '#8a6a1a');      // 锁孔
  px(x, 14, 16, 4, 1, '#b8941f');
  return c;
}

/** 恶魔祭坛(32x32): 暗紫石台 + 血色符文 + 中央红眼球微光 */
function drawAltar(): HTMLCanvasElement {
  const [c, x] = mk(32, 32);
  // 底座
  px(x, 4, 24, 24, 8, '#4a3a5e');
  px(x, 4, 24, 24, 1, '#5e4a76');
  px(x, 8, 30, 16, 2, '#3a2c4a');
  // 台柱
  px(x, 12, 16, 8, 8, '#54426a');
  px(x, 12, 16, 2, 8, '#64507e');
  // 台面(顶板)
  px(x, 2, 12, 28, 5, '#5a4a72');
  px(x, 2, 12, 28, 1, '#6e5a8a');
  px(x, 2, 16, 28, 1, '#463658');
  px(x, 0, 13, 2, 3, '#4a3a5e');       // 顶板双角
  px(x, 30, 13, 2, 3, '#4a3a5e');
  // 血色符文(台面上)
  px(x, 6, 13, 3, 1, '#a03038');
  px(x, 23, 13, 3, 1, '#a03038');
  px(x, 9, 14, 1, 2, '#802830');
  px(x, 22, 14, 1, 2, '#802830');
  // 中央红眼球
  px(x, 13, 17, 6, 5, '#d8d0d8');      // 巩膜
  px(x, 14, 18, 4, 3, '#b02828');      // 虹膜
  px(x, 15, 19, 2, 2, '#101018');      // 瞳孔
  px(x, 14, 18, 1, 1, '#e86060');      // 高光
  px(x, 12, 16, 8, 1, 'rgba(240,90,90,0.35)');   // 眼球微光
  px(x, 12, 22, 8, 1, 'rgba(240,90,90,0.30)');
  return c;
}

/** 木桌(32x16): 桌板 + 桌腿 */
function drawTable(): HTMLCanvasElement {
  const [c, x] = mk(32, 16);
  px(x, 0, 4, 32, 4, '#a97d4b');       // 桌板
  px(x, 0, 4, 32, 1, '#c49a67');
  px(x, 0, 7, 32, 1, '#7a5733');
  px(x, 10, 4, 1, 4, '#7a5733');       // 板缝
  px(x, 21, 4, 1, 4, '#7a5733');
  px(x, 3, 8, 3, 8, '#7a5733');        // 桌腿
  px(x, 26, 8, 3, 8, '#7a5733');
  px(x, 4, 8, 1, 8, '#5e4023');
  px(x, 27, 8, 1, 8, '#5e4023');
  px(x, 14, 8, 4, 2, '#8a6538');       // 下横撑
  return c;
}

/** 木椅(16x16, 侧视): 椅背 + 座面 + 椅腿 */
function drawChair(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  px(x, 3, 1, 3, 12, '#a97d4b');       // 椅背
  px(x, 3, 1, 3, 1, '#c49a67');
  px(x, 5, 1, 1, 12, '#7a5733');
  px(x, 3, 5, 3, 1, '#7a5733');        // 背部横档
  px(x, 3, 10, 10, 3, '#a97d4b');      // 座面
  px(x, 3, 10, 10, 1, '#c49a67');
  px(x, 3, 12, 10, 1, '#7a5733');
  px(x, 4, 13, 2, 3, '#7a5733');       // 椅腿
  px(x, 11, 13, 2, 3, '#7a5733');
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
  demonite: { dark: '#24382a', mid: '#3e6a44', light: '#5e8a64' },
  hellstone: { dark: '#8a2c10', mid: '#e05a24', light: '#ffa050' },
  nightmare: { dark: '#332b48', mid: '#5a4a72', light: '#7a6a9a' },
};

/** 盔甲三件套 item id (头/身/腿) × 5 套 */
const ARMOR_SETS: [number, number, number][] = [
  [IT.COPPER_HELM, IT.COPPER_MAIL, IT.COPPER_LEGS],
  [IT.IRON_HELM, IT.IRON_MAIL, IT.IRON_LEGS],
  [IT.SILVER_HELM, IT.SILVER_MAIL, IT.SILVER_LEGS],
  [IT.GOLD_HELM, IT.GOLD_MAIL, IT.GOLD_LEGS],
  [IT.SHADOW_HELM, IT.SHADOW_MAIL, IT.SHADOW_LEGS],
];

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

// ==================== 新增物品图标 ====================

/** 十六进制颜色乘法变亮/变暗(f>1 变亮, <1 变暗) */
function shadeHex(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((n & 0xff) * f));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** 木弓: 侧视弓臂 + 弦 */
function bowIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const pts: [number, number][] = [
    [10, 1], [8, 2], [6, 3], [5, 5], [4, 7], [4, 8], [4, 9], [5, 11], [6, 13], [8, 14], [10, 15],
  ];
  pts.forEach(([bx, by]) => px(x, bx, by, 2, 1, '#a97d4b'));
  px(x, 4, 7, 2, 2, '#7a5733');       // 弓把
  px(x, 10, 2, 1, 13, '#e8e8e0');    // 弦
  return c;
}

/** 斜放箭矢 */
function arrowIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  for (let i = 0; i < 9; i++) px(x, 3 + i, 12 - i, 1, 1, '#a0743e');  // 斜杆
  px(x, 12, 1, 2, 2, '#9aa0aa');     // 箭头
  px(x, 11, 2, 1, 1, '#9aa0aa');
  px(x, 14, 0, 1, 1, '#c8ccd4');
  px(x, 1, 12, 2, 1, '#d8dce2');     // 尾羽
  px(x, 2, 13, 2, 1, '#d8dce2');
  px(x, 0, 13, 1, 1, '#b8bec8');
  return c;
}

/** 炸弹: 黑球 + 白高光 + 引线火花 */
function bombIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  px(x, 4, 5, 8, 8, '#2a2a32');
  px(x, 3, 7, 1, 4, '#2a2a32');
  px(x, 12, 7, 1, 4, '#2a2a32');
  px(x, 5, 4, 6, 1, '#2a2a32');
  px(x, 5, 13, 6, 1, '#2a2a32');
  px(x, 5, 6, 2, 2, '#5a5a66');      // 白高光
  px(x, 5, 6, 1, 1, '#8a8a96');
  px(x, 10, 3, 1, 2, '#8a6a42');     // 引线
  px(x, 11, 2, 1, 1, '#8a6a42');
  px(x, 11, 0, 2, 2, '#ffd75e');     // 火花
  px(x, 12, 1, 1, 1, '#ff9a3c');
  return c;
}

/** 晶状体: 黑色圆球 + 高光 */
function lensIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  px(x, 4, 4, 8, 8, '#1c1c24');
  px(x, 3, 6, 1, 4, '#1c1c24');
  px(x, 12, 6, 1, 4, '#1c1c24');
  px(x, 5, 3, 6, 1, '#1c1c24');
  px(x, 5, 12, 6, 1, '#1c1c24');
  px(x, 5, 5, 2, 2, '#4a4a58');      // 高光
  px(x, 5, 5, 1, 1, '#8a8a98');
  px(x, 10, 9, 1, 1, '#3a3a48');
  return c;
}

/** 可疑的眼球: 血红眼球 + 竖瞳 */
function eyeSummonIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  px(x, 3, 5, 10, 7, '#e8d8d8');     // 巩膜(微红)
  px(x, 2, 6, 1, 5, '#e8d8d8');
  px(x, 13, 6, 1, 5, '#e8d8d8');
  px(x, 4, 4, 8, 1, '#e8d8d8');
  px(x, 4, 12, 8, 1, '#e8d8d8');
  px(x, 4, 6, 2, 1, '#b04040');      // 血丝
  px(x, 10, 10, 2, 1, '#b04040');
  px(x, 5, 11, 1, 1, '#b04040');
  px(x, 7, 5, 2, 7, '#b02828');      // 红虹膜(竖椭圆)
  px(x, 6, 6, 4, 5, '#b02828');
  px(x, 7, 6, 2, 5, '#101018');      // 竖瞳
  px(x, 6, 7, 1, 2, '#d84848');      // 高光
  return c;
}

/** 橡子 */
function acornIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  px(x, 7, 3, 2, 1, '#6e4a28');      // 蒂
  px(x, 5, 4, 6, 2, '#5e4023');      // 帽
  px(x, 4, 5, 8, 2, '#5e4023');
  px(x, 5, 4, 6, 1, '#7a5733');
  px(x, 5, 7, 6, 6, '#a97d4b');      // 果身
  px(x, 6, 13, 4, 1, '#8a6538');
  px(x, 5, 12, 1, 1, '#8a6538');
  px(x, 10, 12, 1, 1, '#8a6538');
  px(x, 6, 7, 2, 2, '#c49a67');      // 高光
  return c;
}

/** 魔金矿石: 暗绿黑矿粒 */
function demoniteOreIcon(): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  drawOre(x, mulberry32(913), '#3e6a44', '#5e8a64');
  return c;
}

/** 熔岩镐: 炽橙镐 + 火星点 */
function moltenPickIcon(): HTMLCanvasElement {
  const c = pickIcon(METALS.hellstone);
  const x = c.getContext('2d')!;
  px(x, 12, 2, 1, 1, '#ffd75e');     // 火星点
  px(x, 3, 4, 1, 1, '#ffb84a');
  px(x, 6, 11, 1, 1, '#ff9a3c');
  return c;
}

/** 灾厄之刃: 暗色宽剑 + 紫光边 */
function lightsBaneIcon(): HTMLCanvasElement {
  const c = broadSwordIcon(METALS.nightmare);
  const x = c.getContext('2d')!;
  px(x, 5, 3, 1, 1, '#9a7ac0');      // 紫光边
  px(x, 8, 5, 1, 1, '#8a6ab0');
  px(x, 10, 7, 1, 1, '#9a7ac0');
  return c;
}

/** 火山: 橙红巨剑 + 火焰纹 */
function volcanoIcon(): HTMLCanvasElement {
  const c = broadSwordIcon(METALS.hellstone);
  const x = c.getContext('2d')!;
  px(x, 5, 4, 1, 2, '#ffd75e');      // 火焰纹
  px(x, 7, 6, 1, 2, '#ffb84a');
  px(x, 9, 4, 1, 2, '#ffd75e');
  px(x, 11, 2, 1, 1, '#fff0a0');
  return c;
}

/** 头盔图标(侧视带面甲缝) */
function helmetIcon(col: string, edge?: string): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const dark = shadeHex(col, 0.66);
  px(x, 4, 4, 8, 4, col);            // 盔顶
  px(x, 3, 5, 2, 6, col);            // 后沿
  px(x, 11, 5, 2, 6, col);           // 面甲
  px(x, 4, 8, 9, 1, dark);           // 盔沿
  px(x, 11, 6, 1, 4, dark);          // 面甲缝
  px(x, 4, 4, 4, 1, shadeHex(col, 1.3));
  if (edge) { px(x, 5, 3, 1, 1, edge); px(x, 12, 6, 1, 1, edge); }
  return c;
}

/** 胸甲图标(躯干形) */
function mailIcon(col: string, edge?: string): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const dark = shadeHex(col, 0.66);
  px(x, 5, 3, 6, 2, col);            // 肩
  px(x, 3, 4, 3, 4, col);            // 左肩甲
  px(x, 10, 4, 3, 4, col);           // 右肩甲
  px(x, 4, 5, 8, 8, col);            // 躯干
  px(x, 4, 12, 8, 1, dark);
  px(x, 7, 6, 2, 6, dark);           // 中缝
  px(x, 3, 7, 1, 3, dark);           // 臂缝
  px(x, 12, 7, 1, 3, dark);
  px(x, 5, 5, 2, 1, shadeHex(col, 1.3));
  if (edge) { px(x, 4, 4, 1, 1, edge); px(x, 11, 10, 1, 1, edge); }
  return c;
}

/** 护腿图标(裤形) */
function legsIcon(col: string, edge?: string): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const dark = shadeHex(col, 0.66);
  px(x, 4, 4, 8, 3, col);            // 腰
  px(x, 4, 7, 3, 6, col);            // 左腿
  px(x, 9, 7, 3, 6, col);            // 右腿
  px(x, 4, 12, 3, 1, dark);
  px(x, 9, 12, 3, 1, dark);
  px(x, 4, 4, 8, 1, dark);           // 腰线
  px(x, 5, 9, 1, 1, shadeHex(col, 1.35));   // 膝盖高光
  px(x, 10, 9, 1, 1, shadeHex(col, 1.35));
  if (edge) { px(x, 3, 5, 1, 1, edge); px(x, 12, 8, 1, 1, edge); }
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

/** 生命水晶: 粉水晶心, 两帧亮度/微缩放差做脉动 */
function drawLifeCrystal(frame: number): HTMLCanvasElement {
  const [c, x] = mk(16, 16);
  const bright = frame === 1;
  const main = bright ? '#f884b4' : '#f070a0';
  const dark = bright ? '#c05888' : '#b84a78';
  const shine = bright ? '#fff0f6' : '#ffd0e0';
  HEART_ROWS.forEach(([a, b], i) => px(x, a, 3 + i, b - a, 1, main));
  px(x, 7, 3, 2, 4, dark);           // 晶面切缝
  px(x, 6, 7, 1, 4, dark);
  px(x, 9, 7, 1, 4, dark);
  px(x, 5, 10, 6, 1, dark);
  px(x, 5, 4, 2, 2, shine);          // 高光
  px(x, 4, 5, 1, 2, shine);
  if (bright) {                       // 微缩放差: 边缘扩 1px
    px(x, 7, 2, 2, 1, main);
    px(x, 3, 5, 1, 5, main);
    px(x, 12, 5, 1, 5, main);
    px(x, 10, 5, 1, 1, shine);
  }
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

  // ---- 群系扩展方块 (T 27-61 非多格家具) ----
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
  tiles.set(T.LEAF_SNOW, variants(3, (x, r) => drawLeafBiome(x, r, '#b8d8c8', '#9cbfae', '#dcefe4'), 217));
  tiles.set(T.LEAF_JUNGLE, variants(3, (x, r) => drawLeafBiome(x, r, '#3aa04e', '#2e8040', '#58c468'), 218));
  tiles.set(T.LEAF_CORRUPT, variants(3, (x, r) => drawLeafBiome(x, r, '#8a6aa8', '#6e5488', '#a68ac2'), 219));

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
  walls.set(W_SAND, wallFrom(drawSand, 500, 'rgba(38,30,14,0.52)'));   // 沙墙
  walls.set(W_SNOW, wallFrom(drawSnow, 600, 'rgba(22,34,50,0.52)'));   // 雪墙
  walls.set(W_MUD, wallFrom(drawMud, 700, 'rgba(18,14,8,0.52)'));      // 泥墙(丛林)
  walls.set(W_EBON, wallFrom(drawCorruptStone, 800, 'rgba(12,8,20,0.52)')); // 黑檀墙(腐化)

  // 树叶变体
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
  icons[IT.COPPER_SWORD] = shortSwordIcon(METALS.copper);
  icons[IT.WOOD_SWORD] = broadSwordIcon(METALS.wood);
  icons[IT.IRON_PICK] = pickIcon(METALS.iron);
  icons[IT.IRON_SWORD] = broadSwordIcon(METALS.iron);
  icons[IT.SILVER_PICK] = pickIcon(METALS.silver);
  icons[IT.SILVER_SWORD] = broadSwordIcon(METALS.silver);
  icons[IT.GOLD_PICK] = pickIcon(METALS.gold);
  icons[IT.GOLD_SWORD] = broadSwordIcon(METALS.gold);

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
