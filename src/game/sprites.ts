/**
 * 角色与敌怪的像素画绘制(程序化，泰拉瑞亚风格小人)
 * 坐标约定：x=脚底中心, y=脚底
 */

export interface HumanoidPalette {
  skin: string; skinDark: string;
  hair: string;
  shirt: string; shirtDark: string;
  pants: string; shoe: string;
  eye: string;
}

export const PLAYER_PALETTE: HumanoidPalette = {
  skin: '#f0c8a0', skinDark: '#d8a878',
  hair: '#7a4a22',
  shirt: '#4a8f5c', shirtDark: '#3a7a4a',
  pants: '#3d5a9e', shoe: '#6e5a43',
  eye: '#3a66aa',
};

export const ZOMBIE_PALETTE: HumanoidPalette = {
  skin: '#7a9b6a', skinDark: '#628250',
  hair: '#3a4a34',
  shirt: '#5a5148', shirtDark: '#463f38',
  pants: '#3a3f4a', shoe: '#2e3238',
  eye: '#c03838',
};

/** 向导: 棕发 + 蓝上衣 + 卡其裤 */
export const GUIDE_PALETTE: HumanoidPalette = {
  skin: '#f0c8a0', skinDark: '#d8a878',
  hair: '#6e4a26',
  shirt: '#4a72b8', shirtDark: '#3a5a94',
  pants: '#a8986a', shoe: '#6e5a43',
  eye: '#3a66aa',
};

/** 骷髅: 骨白肤色 + 灰白衣 + 深灰裤 + 黑眼窝 */
export const SKELETON_PALETTE: HumanoidPalette = {
  skin: '#e8e8dc', skinDark: '#c4c4b4',
  hair: '#c4c4b4',
  shirt: '#c8c8c0', shirtDark: '#a8a89c',
  pants: '#4a4a52', shoe: '#2e2e34',
  eye: '#101014',
};

export interface DrawHumanoidOpts {
  x: number; y: number;
  dir: 1 | -1;
  walkT: number;
  onGround: boolean;
  vy: number;
  zombieArms?: boolean;
  swing?: { angle: number; icon: HTMLCanvasElement | null; anchor: [number, number] } | null;
  flash?: boolean;
  blinkHidden?: boolean;
  /** 盔甲三色(头/身/腿), null 或缺省 = 不穿盔甲 */
  armor?: { head: string; body: string; legs: string } | null;
}

/** 十六进制颜色乘法变亮/变暗(f>1 变亮, <1 变暗) */
function shadeHex(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((n & 0xff) * f));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function clampN(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }

/** 绘制类人角色(玩家/僵尸/骷髅/向导共用); armor 非空时叠加盔甲层 */
export function drawHumanoid(ctx: CanvasRenderingContext2D, pal: HumanoidPalette, o: DrawHumanoidOpts): void {
  ctx.save();
  ctx.translate(Math.round(o.x), Math.round(o.y));
  ctx.scale(o.dir, 1);
  const C = o.flash ? '#ff5040' : null;
  const col = (c: string): string => C ?? c;
  const px = (x_: number, y_: number, w: number, h: number, c: string): void => {
    ctx.fillStyle = col(c);
    ctx.fillRect(x_, y_, w, h);
  };
  const ar = o.armor ?? null;
  const aHeadD = ar ? shadeHex(ar.head, 0.62) : '';
  const aBodyD = ar ? shadeHex(ar.body, 0.62) : '';
  const aLegL = ar ? shadeHex(ar.legs, 1.35) : '';

  const walking = o.onGround && Math.abs(o.walkT) > 0.001;
  const phase = o.walkT;
  const s1 = walking ? Math.sin(phase) : 0;
  const s2 = walking ? Math.sin(phase + Math.PI) : 0;

  // ---- 腿 ----
  if (o.onGround) {
    const bl = -6 + Math.round(s2 * 3);     // 后腿 x
    const fl = 1 + Math.round(s1 * 3);      // 前腿 x
    px(bl, -14, 5, 14 - Math.abs(s2) * 2, ar ? ar.legs : pal.pants);
    px(bl, -3, 5, 3, pal.shoe);
    px(fl, -14, 5, 14 - Math.abs(s1) * 2, ar ? ar.legs : pal.pants);
    px(fl, -3, 5, 3, pal.shoe);
    if (ar) { px(bl + 2, -8, 1, 1, aLegL); px(fl + 2, -8, 1, 1, aLegL); }   // 膝盖高光
  } else {
    px(-8, -14, 5, 12, ar ? ar.legs : pal.pants);
    px(-8, -4, 5, 3, pal.shoe);
    px(3, -13, 5, 11, ar ? ar.legs : pal.pants);
    px(3, -4, 5, 3, pal.shoe);
    if (ar) { px(-7, -10, 1, 1, aLegL); px(4, -9, 1, 1, aLegL); }
  }

  // ---- 后臂 ----
  if (o.zombieArms) {
    px(-8, -25, 9, 3, pal.shirtDark);
    px(-9, -26, 2, 4, pal.skinDark);
  } else if (!o.swing) {
    px(-7, -25, 3, 9, pal.shirtDark);
    px(-7, -17, 3, 3, pal.skinDark);
    if (ar) { px(-7, -25, 3, 4, ar.body); px(-7, -21, 3, 1, aBodyD); }      // 上臂甲
  }

  // ---- 躯干 ----
  px(-6, -26, 12, 12, pal.shirt);
  px(-6, -16, 12, 2, pal.shirtDark);
  if (ar) {
    px(-6, -26, 12, 10, ar.body);           // 胸甲
    px(-6, -21, 12, 1, aBodyD);             // 甲片暗缝
    px(-6, -26, 1, 10, aBodyD);
    px(5, -26, 1, 10, aBodyD);
    px(-5, -26, 10, 1, shadeHex(ar.body, 1.3));   // 领口高光
  }

  // ---- 头 ----
  px(-5, -36, 10, 10, pal.skin);
  px(-6, -38, 12, 4, pal.hair);       // 头发顶
  px(-7, -36, 3, 7, pal.hair);        // 后脑勺头发
  px(-5, -27, 3, 2, pal.skinDark);    // 下巴阴影
  if (ar) {
    // 头盔: 覆盖头部上 1/3(原发区), 保留眼睛
    px(-6, -38, 12, 4, ar.head);
    px(-7, -36, 3, 7, ar.head);
    px(-6, -34, 12, 1, aHeadD);       // 盔沿
    px(-7, -30, 3, 1, aHeadD);        // 后沿
    px(4, -33, 1, 3, aHeadD);         // 护鼻(眼前 1px 竖线)
    px(-6, -38, 11, 1, shadeHex(ar.head, 1.3));   // 盔顶高光
  }
  // 眼睛
  px(2, -33, 2, 3, '#ffffff');
  px(3, -33, 1, 3, pal.eye);
  if (o.zombieArms) { px(1, -30, 2, 1, pal.skinDark); } // 嘴

  // ---- 前臂 + 手持物品 ----
  if (o.swing && o.swing.icon) {
    const ang = o.swing.angle;
    // 前臂从肩(3,-24)旋转
    ctx.save();
    ctx.translate(3, -24);
    ctx.rotate(ang);
    px(0, -1, 3, 11, pal.shirt);
    if (ar) { px(0, -1, 3, 4, ar.body); px(0, 3, 3, 1, aBodyD); }          // 上臂甲
    px(0, 9, 3, 3, pal.skin);
    // 手持物品
    const [ax, ay] = o.swing.anchor;
    ctx.translate(1, 11);
    ctx.rotate(-Math.PI / 2 + 0.5);
    ctx.drawImage(o.swing.icon, -ax, -ay);
    ctx.restore();
  } else if (o.zombieArms) {
    px(5, -25, 9, 3, pal.shirt);
    px(12, -26, 2, 4, pal.skin);
  } else {
    px(4, -25, 3, 9, pal.shirt);
    px(4, -17, 3, 3, pal.skin);
    if (ar) { px(4, -25, 3, 4, ar.body); px(4, -21, 3, 1, aBodyD); }       // 上臂甲
  }

  ctx.restore();
  void o.blinkHidden;
}

// ==================== 史莱姆 ====================
export interface SlimePalette { body: string; dark: string; light: string }
export const SLIME_GREEN: SlimePalette = { body: '#4ec44e', dark: '#389a38', light: '#8ee88e' };
export const SLIME_BLUE: SlimePalette = { body: '#4a7ae0', dark: '#3558b0', light: '#8ab0f0' };
/** 熔岩史莱姆 */
export const LAVA_SLIME: SlimePalette = { body: '#f07030', dark: '#c04010', light: '#ffd060' };

export function drawSlime(
  ctx: CanvasRenderingContext2D, pal: SlimePalette,
  x: number, y: number, w: number, h: number,
  squish: number, dir: 1 | -1, flash: boolean,
): void {
  const bw = w * (1 + squish * 0.3);
  const bh = Math.max(4, h * (1 - squish * 0.42));
  const body = flash ? '#ff5040' : pal.body;
  const dark = flash ? '#ff5040' : pal.dark;
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = body;
  ctx.beginPath();
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;              // 0=底 1=顶
    const hw = (bw / 2) * Math.sqrt(Math.max(0, 1 - Math.pow(t * 2 - 1, 2)));
    const py = y - t * bh;
    if (i === 0) ctx.moveTo(x - hw, py);
    else ctx.lineTo(x - hw, py);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const hw = (bw / 2) * Math.sqrt(Math.max(0, 1 - Math.pow(t * 2 - 1, 2)));
    ctx.lineTo(x + hw, y - t * bh);
  }
  ctx.closePath();
  ctx.fill();
  // 内核
  ctx.fillStyle = dark;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.ellipse(x, y - bh * 0.34, bw * 0.26, bh * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.82;
  // 眼睛
  const ex = x + dir * bw * 0.16;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(ex - 4, y - bh * 0.72, 2, 3);
  ctx.fillRect(ex + 2, y - bh * 0.72, 2, 3);
  ctx.fillStyle = '#101018';
  ctx.fillRect(ex - 4 + dir, y - bh * 0.72 + 1, 1, 2);
  ctx.fillRect(ex + 2 + dir, y - bh * 0.72 + 1, 1, 2);
  // 顶部高光
  ctx.fillStyle = flash ? '#ff8070' : pal.light;
  ctx.globalAlpha = 0.6;
  ctx.fillRect(x - bw * 0.2, y - bh * 0.94, 3, 2);
  ctx.restore();
}

// ==================== 恶魔眼 ====================
export function drawEye(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  t: number, dir: 1 | -1, flash: boolean,
): void {
  const cx = x, cy = y - h / 2;
  ctx.save();
  // 翅膀(扑动)
  const flap = Math.sin(t * 0.35) * 4;
  ctx.fillStyle = flash ? '#ff5040' : '#8a7a9a';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.35, cy - 2);
  ctx.lineTo(cx - w * 0.95, cy - 6 - flap);
  ctx.lineTo(cx - w * 0.85, cy + 3 - flap * 0.5);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.35, cy - 2);
  ctx.lineTo(cx + w * 0.95, cy - 6 - flap);
  ctx.lineTo(cx + w * 0.85, cy + 3 - flap * 0.5);
  ctx.closePath(); ctx.fill();
  // 眼球
  ctx.fillStyle = flash ? '#ff5040' : '#e8e0e8';
  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.42, h * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // 血丝
  ctx.strokeStyle = flash ? '#ff5040' : '#c05050';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.3, cy + 2); ctx.lineTo(cx - w * 0.12, cy - 1);
  ctx.moveTo(cx + w * 0.28, cy - 3); ctx.lineTo(cx + w * 0.12, cy + 1);
  ctx.stroke();
  // 虹膜+瞳孔(朝向玩家)
  const io = dir * w * 0.1;
  ctx.fillStyle = flash ? '#ff2020' : '#b02828';
  ctx.beginPath();
  ctx.arc(cx + io, cy, w * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#101018';
  ctx.beginPath();
  ctx.arc(cx + io, cy, w * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ==================== 洞穴蝙蝠 ====================
// (x, y) = 判定盒底部中心; 双翼按 sin(anim*0.35) 两帧上下扑
export function drawBat(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  anim: number, dir: 1 | -1, flash: boolean,
): void {
  const cx = Math.round(x);
  const cy = Math.round(y - h / 2);
  const up = Math.sin(anim * 0.35) > 0;    // 两帧扑翼
  const wy = up ? -3 : 2;                  // 翼根高度
  ctx.save();
  const wingC = flash ? '#ff5040' : '#6e4f3e';
  const bodyC = flash ? '#ff5040' : '#523a2e';
  // 左右膜翼(三角)
  ctx.fillStyle = wingC;
  for (const s of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + s * 2, cy + wy);
    ctx.lineTo(cx + s * (w / 2 + 1), cy + wy - 3);
    ctx.lineTo(cx + s * w / 2, cy + wy + 2);
    ctx.closePath();
    ctx.fill();
  }
  // 翼膜内层色
  ctx.fillStyle = flash ? '#ff7060' : '#7e5c48';
  ctx.fillRect(cx - w / 2 + 1, cy + wy + 1, 2, 1);
  ctx.fillRect(cx + w / 2 - 3, cy + wy + 1, 2, 1);
  // 身体 + 耳朵
  ctx.fillStyle = bodyC;
  ctx.fillRect(cx - 2, cy - 3, 4, 6);
  ctx.fillRect(cx - 2, cy - 5, 1, 2);
  ctx.fillRect(cx + 1, cy - 5, 1, 2);
  // 红眼 1px(朝向前方偏移)
  const eo = dir > 0 ? 1 : 0;
  ctx.fillStyle = '#e04040';
  ctx.fillRect(cx - 2 + eo, cy - 2, 1, 1);
  ctx.fillRect(cx + eo, cy - 2, 1, 1);
  ctx.restore();
}

// ==================== 噬魂者 ====================
// (x, y) = 判定盒底部中心; 破烂翼两帧 + 中央单只红眼 + 尾鳍
export function drawEos(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  anim: number, dir: 1 | -1, flash: boolean,
): void {
  const cx = Math.round(x);
  const cy = Math.round(y - h / 2);
  const up = Math.sin(anim * 0.3) > 0;     // 破烂翼两帧
  const wy = up ? -4 : 1;
  ctx.save();
  const wingC = flash ? '#ff5040' : '#6e5488';
  const bodyC = flash ? '#ff5040' : '#5a4470';
  const darkC = flash ? '#d04040' : '#42305a';
  // 破烂双翼(锯齿膜)
  ctx.fillStyle = wingC;
  for (const s of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + s * 3, cy - 1);
    ctx.lineTo(cx + s * (w / 2), cy + wy - 2);
    ctx.lineTo(cx + s * (w / 2 - 2), cy + wy + 1);
    ctx.lineTo(cx + s * (w / 2 - 1), cy + wy + 3);
    ctx.lineTo(cx + s * 2, cy + 2);
    ctx.closePath();
    ctx.fill();
  }
  // 圆滚身体
  ctx.fillStyle = bodyC;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 1, w * 0.3, h * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  // 尾部小尾鳍(-dir 一侧)
  ctx.fillStyle = darkC;
  ctx.beginPath();
  ctx.moveTo(cx - dir * w * 0.24, cy);
  ctx.lineTo(cx - dir * w * 0.48, cy - 3);
  ctx.lineTo(cx - dir * w * 0.48, cy + 3);
  ctx.closePath();
  ctx.fill();
  // 中央单只红眼(瞳孔朝向 dir)
  ctx.fillStyle = '#d83030';
  ctx.fillRect(cx - 1, cy - 2, 2, 2);
  ctx.fillStyle = '#f0a8a0';
  ctx.fillRect(cx - 1, cy - 2, 1, 1);                  // 高光
  ctx.fillStyle = '#28080c';
  ctx.fillRect(dir > 0 ? cx : cx - 1, cy - 1, 1, 1);   // 瞳孔
  ctx.restore();
}

// ==================== 克苏鲁之眼 (Boss) ====================
// 坐标约定同 drawEye/drawSlime: (x, y) = 判定盒底部中心
// phase: 0=大虹膜阶段, 1=巨口阶段
// lookX/lookY: 虹膜朝向偏移(px, 内部 clamp ±6)
// animT: 动画计时; flash>0: 整体覆盖半透明白
export function drawEoC(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  phase: number, lookX: number, lookY: number,
  animT: number, flash: number,
): void {
  const cx = x;
  const cy = y - h / 2;
  const pulse = phase === 1 ? Math.round(Math.sin(animT * 0.22)) : 0;   // 巨口阶段 ±1px 脉动
  const rw = w / 2 + pulse;
  const rh = h * 0.42 + pulse * 0.5;
  const ox = clampN(lookX, -6, 6);
  const oy = clampN(lookY, -6, 6);

  ctx.save();

  // ---- 底部短触须(2px 锯齿块, 随 animT 摆动) ----
  ctx.fillStyle = '#c8b4be';
  for (let i = 0; i < 5; i++) {
    const tx = cx - 14 + i * 7;
    const len = 3 + ((i * 5) % 3);
    for (let j = 0; j < len; j++) {
      const wig = Math.round(Math.sin(animT * 0.3 + j * 0.9 + i * 1.7) * 1.5);
      ctx.fillRect(tx + wig, cy + rh - 2 + j * 2, 2, 2);
    }
  }

  // ---- 眼体(外圈 1px 暗边 + 白巩膜) ----
  ctx.fillStyle = '#8a7080';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rw + 1, rh + 1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8e0e4';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
  ctx.fill();

  // ---- 血丝(4 条从边缘向中心的细线) ----
  ctx.strokeStyle = '#c04848';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - rw * 0.92, cy - 2); ctx.lineTo(cx - rw * 0.42, cy - 4);
  ctx.moveTo(cx - rw * 0.72, cy + 6); ctx.lineTo(cx - rw * 0.3, cy + 3);
  ctx.moveTo(cx + rw * 0.88, cy + 1); ctx.lineTo(cx + rw * 0.38, cy - 2);
  ctx.moveTo(cx + rw * 0.62, cy - 8); ctx.lineTo(cx + rw * 0.32, cy - 4);
  ctx.stroke();

  if (phase === 1) {
    // ---- 巨口: 弧形黑口腔 + 上下各 5 颗白三角牙 ----
    const mx = cx + ox * 0.5, my = cy + oy * 0.5;
    ctx.fillStyle = '#1a0a10';
    ctx.beginPath();
    ctx.ellipse(mx, my, rw * 0.52, rh * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#efe6e6';
    for (let i = 0; i < 5; i++) {
      const txx = mx - rw * 0.38 + (i * rw * 0.76) / 4;
      const th = 5 + (i % 2);
      ctx.beginPath();                     // 上牙(向下三角)
      ctx.moveTo(txx - 2, my - rh * 0.52);
      ctx.lineTo(txx + 2, my - rh * 0.52);
      ctx.lineTo(txx, my - rh * 0.52 + th);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();                     // 下牙(向上三角)
      ctx.moveTo(txx - 2, my + rh * 0.52);
      ctx.lineTo(txx + 2, my + rh * 0.52);
      ctx.lineTo(txx, my + rh * 0.52 - th);
      ctx.closePath(); ctx.fill();
    }
  } else {
    // ---- 大面积红虹膜 + 黑瞳(朝 lookX/lookY 偏移) ----
    ctx.fillStyle = '#b02828';
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy + oy, rw * 0.46, rh * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#101018';
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy + oy, rw * 0.21, rh * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d86060';
    ctx.fillRect(cx + ox - rw * 0.3, cy + oy - rh * 0.34, 2, 2);   // 高光
  }

  // ---- 受击白闪(整体半透明白) ----
  if (flash > 0) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(cx, cy + rh * 0.3, rw + 2, rh + 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ==================== 投射物 ====================

/** 8px 箭矢, 按 angle 旋转(angle=0 朝 +x); (x, y) = 箭矢中心 */
export function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate(angle);
  ctx.imageSmoothingEnabled = false;     // 保持像素感
  ctx.fillStyle = '#a0743e';
  ctx.fillRect(-3, 0, 5, 1);             // 木杆
  ctx.fillStyle = '#8a909a';
  ctx.fillRect(2, -1, 2, 3);             // 箭头
  ctx.fillRect(4, 0, 1, 1);
  ctx.fillStyle = '#e8e8e0';
  ctx.fillRect(-4, -1, 2, 1);            // 尾羽
  ctx.fillRect(-4, 1, 2, 1);
  ctx.restore();
}

/** 6px 炸弹黑球 + 引线, 火花随 t 闪烁; (x, y) = 球心 */
export function drawBomb(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const bx = Math.round(x);
  const by = Math.round(y);
  ctx.fillStyle = '#26262e';
  ctx.fillRect(bx - 2, by - 3, 4, 1);    // 黑球(像素圆)
  ctx.fillRect(bx - 3, by - 2, 6, 4);
  ctx.fillRect(bx - 2, by + 2, 4, 1);
  ctx.fillStyle = '#4a4a56';
  ctx.fillRect(bx - 2, by - 2, 1, 1);    // 高光
  ctx.fillStyle = '#8a6a42';
  ctx.fillRect(bx + 1, by - 5, 1, 2);    // 引线
  ctx.fillRect(bx + 2, by - 6, 1, 1);
  if (Math.sin(t * 0.8) > -0.25) {       // 火花闪烁
    ctx.fillStyle = '#ffd75e';
    ctx.fillRect(bx + 2, by - 8, 2, 2);
    ctx.fillStyle = '#ff9a3c';
    ctx.fillRect(bx + 3, by - 7, 1, 1);
    if (Math.sin(t * 1.7) > 0) {
      ctx.fillStyle = '#fff2b0';
      ctx.fillRect(bx + 1, by - 9, 1, 1);
    }
  }
}
