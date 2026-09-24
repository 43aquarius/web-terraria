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
}

/** 绘制类人角色(玩家/僵尸共用) */
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

  const walking = o.onGround && Math.abs(o.walkT) > 0.001;
  const phase = o.walkT;
  const s1 = walking ? Math.sin(phase) : 0;
  const s2 = walking ? Math.sin(phase + Math.PI) : 0;

  // ---- 腿 ----
  if (o.onGround) {
    // 后腿
    px(-6 + Math.round(s2 * 3), -14, 5, 14 - Math.abs(s2) * 2, pal.pants);
    px(-6 + Math.round(s2 * 3), -3, 5, 3, pal.shoe);
    // 前腿
    px(1 + Math.round(s1 * 3), -14, 5, 14 - Math.abs(s1) * 2, pal.pants);
    px(1 + Math.round(s1 * 3), -3, 5, 3, pal.shoe);
  } else {
    // 跳跃姿势: 前后分腿
    px(-8, -14, 5, 12, pal.pants);
    px(-8, -4, 5, 3, pal.shoe);
    px(3, -13, 5, 11, pal.pants);
    px(3, -4, 5, 3, pal.shoe);
  }

  // ---- 后臂 ----
  if (o.zombieArms) {
    px(-8, -25, 9, 3, pal.shirtDark);
    px(-9, -26, 2, 4, pal.skinDark);
  } else if (!o.swing) {
    px(-7, -25, 3, 9, pal.shirtDark);
    px(-7, -17, 3, 3, pal.skinDark);
  }

  // ---- 躯干 ----
  px(-6, -26, 12, 12, pal.shirt);
  px(-6, -16, 12, 2, pal.shirtDark);

  // ---- 头 ----
  px(-5, -36, 10, 10, pal.skin);
  px(-6, -38, 12, 4, pal.hair);       // 头发顶
  px(-7, -36, 3, 7, pal.hair);        // 后脑勺头发
  px(-5, -27, 3, 2, pal.skinDark);    // 下巴阴影
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
  }

  ctx.restore();
  void o.blinkHidden;
}

// ==================== 史莱姆 ====================
export interface SlimePalette { body: string; dark: string; light: string }
export const SLIME_GREEN: SlimePalette = { body: '#4ec44e', dark: '#389a38', light: '#8ee88e' };
export const SLIME_BLUE: SlimePalette = { body: '#4a7ae0', dark: '#3558b0', light: '#8ab0f0' };

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
