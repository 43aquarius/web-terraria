/**
 * sky.ts — 天空 / 昼夜 / 视差背景渲染模块（纯 Canvas 2D，无依赖，无 React）
 *
 * 每帧由引擎调用 drawSkyBackground()，把完整天空背景画满整个画布 (0,0,W,H)。
 * 绘制顺序：天空渐变 → 星星 → 太阳/月亮 → 三层视差云 → 两层远山剪影 → 地下渐隐黑罩。
 *
 * 性能约定：
 * - 星星 / 云 sprite / 山脊噪声等随机内容全部用固定种子伪随机（mulberry32）
 *   在首次调用时懒初始化一次，之后每帧复用，无大数组/大对象分配；
 * - 渐变对象每帧创建（开销可接受），颜色数据缓存在模块级 palette 中就地写改；
 * - 不使用 shadowBlur 等昂贵 API；一律用矩形 / 实心圆绘制，保持像素感。
 */

// ============================================================================
// 对外 API
// ============================================================================

/** 引擎传入的天空渲染状态 */
export interface SkyState {
  /** 0..1 整个昼夜周期。白天=[0,0.625)，黑夜=[0.625,1)。0=黎明开始 */
  dayT: number;
  /** 0..1 当前阳光强度（引擎已算好；本模块用它压制星星可见度） */
  skyLight: number;
  /** 摄像机中心（世界像素） */
  camX: number;
  /** 摄像机中心（世界像素）。垂直方向的背景视差统一由 depthPx 表达 */
  camY: number;
  /** 摄像机中心在地表以下的深度（像素，>=0 表示地下；地下时天空渐隐） */
  depthPx: number;
  /** 世界累计秒数，用于星星闪烁/云漂移的相位 */
  timeSec: number;
}

// ============================================================================
// 基础工具
// ============================================================================

/** 固定种子伪随机数生成器（mulberry32），返回 [0,1) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** RGB 颜色（模块级复用对象，避免每帧分配） */
interface RGB {
  r: number;
  g: number;
  b: number;
}

const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });

function lerpRGB(dst: RGB, a: RGB, b: RGB, k: number): void {
  dst.r = a.r + (b.r - a.r) * k;
  dst.g = a.g + (b.g - a.g) * k;
  dst.b = a.b + (b.b - a.b) * k;
}

function rgbStr(c: RGB): string {
  return `rgb(${c.r | 0},${c.g | 0},${c.b | 0})`;
}

// ============================================================================
// 昼夜调色板关键帧
// 按 dayT 在关键帧之间线性 lerp RGB，实现自然过渡；
// t=1.00 与 t=0.00 同为黎明色，保证 0/1 环绕处无缝。
// ============================================================================

interface SkyKey {
  t: number;
  top: RGB; // 天空顶部色
  hor: RGB; // 地平线色
  cloud: RGB; // 云染色
  cloudA: number; // 云基础透明度
  far: RGB; // 远山剪影色
  near: RGB; // 近山剪影色
}

/** 关键帧表（t 升序）。黎明山色取偏紫的中间调，衔接黄昏与白天 */
const SKY_KEYS: readonly SkyKey[] = [
  // 黎明 0~0.08：橙红地平线 #35486e → #f4a05a
  { t: 0.0, top: rgb(53, 72, 110), hor: rgb(244, 160, 90), cloud: rgb(255, 216, 176), cloudA: 0.8, far: rgb(125, 111, 156), near: rgb(78, 66, 102) },
  { t: 0.08, top: rgb(53, 72, 110), hor: rgb(244, 160, 90), cloud: rgb(255, 216, 176), cloudA: 0.8, far: rgb(125, 111, 156), near: rgb(78, 66, 102) },
  // 白天 0.12~0.5：#4a9be8 → #a8d8f0
  { t: 0.12, top: rgb(74, 155, 232), hor: rgb(168, 216, 240), cloud: rgb(255, 255, 255), cloudA: 0.85, far: rgb(125, 168, 201), near: rgb(74, 122, 94) },
  { t: 0.5, top: rgb(74, 155, 232), hor: rgb(168, 216, 240), cloud: rgb(255, 255, 255), cloudA: 0.85, far: rgb(125, 168, 201), near: rgb(74, 122, 94) },
  // 黄昏 0.55~0.625：#3a3a6e → #f08040（0.5→0.57 由白天渐入）
  { t: 0.57, top: rgb(58, 58, 110), hor: rgb(240, 128, 64), cloud: rgb(255, 216, 176), cloudA: 0.8, far: rgb(107, 90, 142), near: rgb(74, 61, 102) },
  { t: 0.625, top: rgb(58, 58, 110), hor: rgb(240, 128, 64), cloud: rgb(255, 216, 176), cloudA: 0.75, far: rgb(107, 90, 142), near: rgb(74, 61, 102) },
  // 深夜 0.75~0.95：#050810 → #0d1526
  { t: 0.75, top: rgb(5, 8, 16), hor: rgb(13, 21, 38), cloud: rgb(26, 34, 51), cloudA: 0.5, far: rgb(20, 27, 44), near: rgb(13, 20, 32) },
  { t: 0.95, top: rgb(5, 8, 16), hor: rgb(13, 21, 38), cloud: rgb(26, 34, 51), cloudA: 0.5, far: rgb(20, 27, 44), near: rgb(13, 20, 32) },
  // 0.95→1.0：深夜平滑过渡回黎明（黎明前的微光），与 t=0 衔接
  { t: 1.0, top: rgb(53, 72, 110), hor: rgb(244, 160, 90), cloud: rgb(255, 216, 176), cloudA: 0.8, far: rgb(125, 111, 156), near: rgb(78, 66, 102) },
];

/** 当前帧调色板（模块级复用对象，samplePalette 就地写入） */
const palette = {
  top: rgb(0, 0, 0),
  hor: rgb(0, 0, 0),
  cloud: rgb(0, 0, 0),
  far: rgb(0, 0, 0),
  near: rgb(0, 0, 0),
  cloudA: 0,
};

/** 采样 dayT 对应的调色板并写入 palette（零分配） */
function samplePalette(dayT: number): void {
  const t = clamp01(dayT);
  const ks = SKY_KEYS;
  let a = ks[0];
  let b = ks[ks.length - 1];
  for (let i = 0; i < ks.length - 1; i++) {
    if (t >= ks[i].t && t <= ks[i + 1].t) {
      a = ks[i];
      b = ks[i + 1];
      break;
    }
  }
  const span = b.t - a.t;
  const k = span > 0 ? (t - a.t) / span : 0;
  lerpRGB(palette.top, a.top, b.top, k);
  lerpRGB(palette.hor, a.hor, b.hor, k);
  lerpRGB(palette.cloud, a.cloud, b.cloud, k);
  lerpRGB(palette.far, a.far, b.far, k);
  lerpRGB(palette.near, a.near, b.near, k);
  palette.cloudA = a.cloudA + (b.cloudA - a.cloudA) * k;
}

// ============================================================================
// 星星（约 140 颗，固定种子懒初始化，camX 视差 0.02）
// ============================================================================

interface Star {
  x: number; // 0..1（屏幕横向比例）
  y: number; // 0..0.75（避开地平线以下）
  size: number; // 1~2 px
  phase: number; // 闪烁相位
}

let stars!: Star[];

function makeStars(): Star[] {
  const rnd = mulberry32(12345);
  const list: Star[] = [];
  for (let i = 0; i < 140; i++) {
    list.push({
      x: rnd(),
      y: 0.02 + rnd() * 0.73,
      size: rnd() < 0.72 ? 1 : 2,
      phase: rnd() * Math.PI * 2,
    });
  }
  return list;
}

/**
 * 黑夜程度 0..1：
 * dayT 0.625→0.75 平滑升到 1（入夜），0.75~0.95 全亮，0.95→1 平滑降回 0（黎明前）；
 * 再乘上 (1 - skyLight*1.5) 作为保险——引擎给出的阳光强度高时压制星星。
 */
function nightFactor(dayT: number, skyLight: number): number {
  let f: number;
  if (dayT < 0.625 || dayT >= 1) {
    f = 0;
  } else if (dayT < 0.75) {
    const k = (dayT - 0.625) / 0.125;
    f = k * k * (3 - 2 * k); // smoothstep
  } else if (dayT < 0.95) {
    f = 1;
  } else {
    const k = (dayT - 0.95) / 0.05;
    f = 1 - k * k * (3 - 2 * k);
  }
  return f * clamp01(1 - skyLight * 1.5);
}

// ============================================================================
// 云（低分辨率像素 sprite ×2 最近邻放大；三层视差 0.04 / 0.08 / 0.14）
// ============================================================================

const CLOUD_W = 96; // sprite 原始尺寸（低分辨率，绘制时 ×2 最近邻放大出像素块）
const CLOUD_H = 36;
const CLOUD_PARALLAX: readonly number[] = [0.04, 0.08, 0.14]; // 远→近
const CLOUD_LAYER_ALPHA: readonly number[] = [0.6, 0.8, 1.0]; // 远层更透明（大气感）

interface Cloud {
  spr: HTMLCanvasElement;
  layer: number; // 0 远 / 1 中 / 2 近
  yFrac: number; // 云中心相对画布高度（0.05..0.45，远层偏上）
  speed: number; // 4..10 px/s 向右漂移
  scale: number; // 绘制缩放（远层更小）
  baseX: number; // 0..1 平铺相位（保证云均匀铺满整屏宽度）
}

let clouds!: Cloud[];
let scratch!: HTMLCanvasElement; // 染色用暂存画布（与 sprite 同尺寸，复用）
let scratchCtx!: CanvasRenderingContext2D;

/** 生成一朵蓬松像素云 sprite：多组重叠白色椭圆 + 底部扁平化 */
function makeCloudSprite(rnd: () => number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = CLOUD_W;
  cv.height = CLOUD_H;
  const c = cv.getContext('2d')!;
  const baseY = CLOUD_H - 3; // 扁平底边所在行
  const blobs = 6 + Math.floor(rnd() * 4); // 6~9 个椭圆
  let minX = CLOUD_W;
  let maxX = 0;
  c.fillStyle = 'rgba(255,255,255,0.92)'; // 边缘略带透明，叠出蓬松感
  for (let i = 0; i < blobs; i++) {
    const tx = (i + 0.5) / blobs; // 从左到右铺开
    const mid = 1 - Math.abs(tx - 0.45) * 1.15; // 中间大、两端小
    const rx = CLOUD_W * (0.09 + 0.12 * Math.max(0.15, mid)) * (0.8 + rnd() * 0.4);
    const ry = rx * (0.55 + rnd() * 0.3);
    const cx = CLOUD_W * (0.1 + 0.8 * tx) + (rnd() - 0.5) * 6;
    const cy = baseY - ry * (0.45 + rnd() * 0.35);
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
    if (cx - rx < minX) minX = cx - rx;
    if (cx + rx > maxX) maxX = cx + rx;
  }
  // 底部扁平化：清掉底线以下，再补一条平直底边
  c.clearRect(0, baseY, CLOUD_W, CLOUD_H - baseY);
  const slabX = Math.max(0, minX + 3);
  const slabW = Math.min(CLOUD_W, maxX - 3) - slabX;
  if (slabW > 4) c.fillRect(slabX, baseY - 4, slabW, 4);
  return cv;
}

/** 生成 10 朵云：均匀分布到三层（远/中/近 ≈ 4/3/3 朵） */
function makeClouds(): Cloud[] {
  const rnd = mulberry32(20240601);
  const list: Cloud[] = [];
  for (let i = 0; i < 10; i++) {
    const layer = i % 3;
    list.push({
      spr: makeCloudSprite(rnd),
      layer,
      yFrac: 0.05 + rnd() * (0.22 + layer * 0.09), // 远层偏上，近层可低到 0.45
      speed: 4 + rnd() * 6, // 4~10 px/s
      scale: layer === 0 ? 0.55 + rnd() * 0.25 : layer === 1 ? 0.8 + rnd() * 0.3 : 1.0 + rnd() * 0.4,
      baseX: rnd(),
    });
  }
  return list;
}

/** 把白色 sprite 染成指定颜色（source-in 保留原 alpha，输出到 scratch） */
function tintSprite(spr: HTMLCanvasElement, tint: RGB): void {
  const c = scratchCtx;
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, CLOUD_W, CLOUD_H);
  c.drawImage(spr, 0, 0);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = rgbStr(tint);
  c.fillRect(0, 0, CLOUD_W, CLOUD_H);
}

/** 画三层视差云：随 camX 反向滚动 + timeSec 向右漂移，对 W 取模无缝平铺 */
function drawClouds(ctx: CanvasRenderingContext2D, W: number, H: number, s: SkyState): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false; // ×2 最近邻放大，保持像素块感
  for (let i = 0; i < clouds.length; i++) {
    const cl = clouds[i];
    const dw = CLOUD_W * 2 * cl.scale;
    const dh = CLOUD_H * 2 * cl.scale;
    let x = (cl.baseX * W - s.camX * CLOUD_PARALLAX[cl.layer] + s.timeSec * cl.speed) % W;
    if (x < 0) x += W;
    const y = cl.yFrac * H - dh * 0.5;
    tintSprite(cl.spr, palette.cloud);
    ctx.globalAlpha = palette.cloudA * CLOUD_LAYER_ALPHA[cl.layer];
    const dx = x - dw * 0.5;
    ctx.drawImage(scratch, 0, 0, CLOUD_W, CLOUD_H, dx, y, dw, dh);
    if (dx + dw > W) ctx.drawImage(scratch, 0, 0, CLOUD_W, CLOUD_H, dx - W, y, dw, dh); // 右溢出→左补
    if (dx < 0) ctx.drawImage(scratch, 0, 0, CLOUD_W, CLOUD_H, dx + W, y, dw, dh); // 左溢出→右补
  }
  ctx.restore();
}

// ============================================================================
// 远山剪影（两层，512 采样点多正弦叠加山脊，固定种子）
// ============================================================================

const RIDGE_N = 512; // 山脊采样点数
const RIDGE_SPAN = 5120; // 山脊在滚动坐标下的重复周期（世界像素）
const RIDGE_STEP = 4; // 屏幕列采样步进（像素，块感）

let ridgeFar!: Float32Array;
let ridgeNear!: Float32Array;

/**
 * 生成 1D 山脊噪声：多个正弦叠加出起伏 + 尖峰感，clamp 到 0..1。
* 形如 y = 0.5 + 0.28*sin(u+s1) + 0.18*sin(u*1.7+s2) + 0.09*sin(u*3.1+s3)，
 * u 在整个采样跨度上转 cycles 个基础周期；三层相位各自随机。
 */
function genRidge(seed: number, cycles: number): Float32Array {
  const rnd = mulberry32(seed);
  const s1 = rnd() * Math.PI * 2;
  const s2 = rnd() * Math.PI * 2;
  const s3 = rnd() * Math.PI * 2;
  const arr = new Float32Array(RIDGE_N);
  for (let i = 0; i < RIDGE_N; i++) {
    const u = (i / RIDGE_N) * Math.PI * 2 * cycles;
    const v = 0.5 + 0.28 * Math.sin(u + s1) + 0.18 * Math.sin(u * 1.7 + s2) + 0.09 * Math.sin(u * 3.1 + s3);
    arr[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return arr;
}

/** 画一层山脊剪影多边形：4px 列步进，采样点间线性插值，填充到画布底部 */
function drawRidge(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  ridge: Float32Array,
  scroll: number, // camX * parallax
  baseY: number, // 山基线（屏幕像素）
  amp: number, // 山最大高度（像素）
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-4, H + 4);
  for (let x = 0; x <= W; x += RIDGE_STEP) {
    const f = ((x + scroll) / RIDGE_SPAN) * RIDGE_N;
    const i0 = Math.floor(f);
    const fr = f - i0;
    const ia = ((i0 % RIDGE_N) + RIDGE_N) % RIDGE_N; // 兼容负 scroll
    const ib = (ia + 1) % RIDGE_N;
    const v = ridge[ia] + (ridge[ib] - ridge[ia]) * fr;
    ctx.lineTo(x, baseY - v * amp);
  }
  ctx.lineTo(W + 4, H + 4);
  ctx.closePath();
  ctx.fill();
}

// ============================================================================
// 太阳 / 月亮（沿圆弧从左地平线→天顶→右地平线）
// ============================================================================

const TAU = Math.PI * 2;

/** 月亮陨石坑：[相对月心 dx, dy, 半径]，全部落在 r=13 月面内 */
const MOON_CRATERS: readonly (readonly [number, number, number])[] = [
  [-4, -3, 3],
  [4, 3, 2.5],
  [2, -5, 2],
  [-6, 4, 2],
  [5, -2, 1.8],
];

// ============================================================================
// 主入口
// ============================================================================

/** 模块级懒初始化：首次调用 drawSkyBackground 时执行一次 */
let inited = false;

function ensureInit(): void {
  if (inited) return;
  stars = makeStars(); // 星星（种子 12345）
  clouds = makeClouds(); // 10 朵云 sprite + 运动参数
  ridgeFar = genRidge(1337, 4); // 远层山脊：4 个基础起伏，更绵延
  ridgeNear = genRidge(9527, 6); // 近层山脊：更细碎
  scratch = document.createElement('canvas');
  scratch.width = CLOUD_W;
  scratch.height = CLOUD_H;
  scratchCtx = scratch.getContext('2d')!;
  inited = true;
}

/** 每帧调用：把完整天空背景画满整个画布 (0,0,W,H) */
export function drawSkyBackground(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  s: SkyState,
): void {
  if (W <= 0 || H <= 0) return;
  ensureInit();
  samplePalette(s.dayT);

  // ---- 1) 天空竖向渐变：顶部色 → 地平线色 ----
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, rgbStr(palette.top));
  sky.addColorStop(1, rgbStr(palette.hor));
  ctx.globalAlpha = 1;
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // ---- 2) 星星（黑夜可见；alpha = night * (0.55 + 0.45*sin(t*2+phase))） ----
  const night = nightFactor(s.dayT, s.skyLight);
  if (night > 0.01) {
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < stars.length; i++) {
      const st = stars[i];
      const a = night * (0.55 + 0.45 * Math.sin(s.timeSec * 2 + st.phase));
      if (a < 0.05) continue;
      ctx.globalAlpha = a > 1 ? 1 : a;
      let sx = (st.x * W - s.camX * 0.02) % W; // 极小视差 0.02，取模平铺
      if (sx < 0) sx += W;
      ctx.fillRect(sx, st.y * H, st.size, st.size);
    }
    ctx.globalAlpha = 1;
  }

  // ---- 3) 太阳（白天）或月亮（黑夜）----
  if (s.dayT < 0.625) {
    // 太阳：progress = dayT/0.625，angle = PI*(1-progress)
    const ang = Math.PI * (1 - s.dayT / 0.625);
    const cx = W * 0.5 + Math.cos(ang) * W * 0.55;
    const cy = H * 0.62 - Math.sin(ang) * H * 0.5;
    // 径向光晕（中心 #fffbe8 → 边缘透明，半径 ~70px）
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, 70);
    halo.addColorStop(0, 'rgba(255,251,232,0.85)');
    halo.addColorStop(0.5, 'rgba(255,240,190,0.25)');
    halo.addColorStop(1, 'rgba(255,251,232,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(cx - 70, cy - 70, 140, 140);
    // 本体：外圈 #ffd75e + 中心 #fff3c0
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath();
    ctx.arc(cx, cy, 19, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff3c0';
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, TAU);
    ctx.fill();
  } else {
    // 月亮：progress = (dayT-0.625)/0.375，同一圆弧
    const ang = Math.PI * (1 - (s.dayT - 0.625) / 0.375);
    const cx = W * 0.5 + Math.cos(ang) * W * 0.55;
    const cy = H * 0.62 - Math.sin(ang) * H * 0.5;
    // 微弱冷光晕
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40);
    halo.addColorStop(0, 'rgba(190,205,228,0.35)');
    halo.addColorStop(1, 'rgba(190,205,228,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(cx - 40, cy - 40, 80, 80);
    // 灰白月面 + 浅灰陨石坑
    ctx.fillStyle = '#e8ecf0';
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#b8c0cc';
    for (let i = 0; i < MOON_CRATERS.length; i++) {
      const cr = MOON_CRATERS[i];
      ctx.beginPath();
      ctx.arc(cx + cr[0], cy + cr[1], cr[2], 0, TAU);
      ctx.fill();
    }
  }

  // ---- 4) 三层视差云 ----
  drawClouds(ctx, W, H, s);

  // ---- 5) 两层远山剪影（颜色随昼夜插值；基线随 depthPx 上移，地下配合黑罩渐隐） ----
  drawRidge(ctx, W, H, ridgeFar, s.camX * 0.06, H * 0.74 - s.depthPx * 0.08, H * 0.26, rgbStr(palette.far));
  drawRidge(ctx, W, H, ridgeNear, s.camX * 0.13, H * 0.9 - s.depthPx * 0.12, H * 0.36, rgbStr(palette.near));

  // ---- 6) 地下渐隐：depthPx 0→600 整体淡出到近黑 #030408（洞穴壁叠加显得自然） ----
  const fade = clamp01(s.depthPx / 600);
  if (fade > 0) {
    ctx.globalAlpha = fade * 0.92;
    ctx.fillStyle = '#030408';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}
