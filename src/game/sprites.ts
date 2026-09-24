/**
 * 角色与敌怪的像素画绘制 — 2x 块状像素风(对齐 ART-SPEC.md)
 *
 * 核心约定:
 * - 所有精灵以 2x2 像素块作画: 1 逻辑像素 = 一次 fillRect(x*2, y*2, 2, 2)
 * - 类人角色: 10x15 逻辑 = 20x30 帧; (x, y) = 脚底中心
 * - 史莱姆/眼球/蝙蝠/噬魂者/克苏鲁之眼: (x, y) = 判定盒底部中心, 锚点吸附 2px 网格
 * - 全部 fillRect 整数坐标(块对齐), 禁止抗锯齿路径
 */

export interface HumanoidPalette {
  skin: string; skinDark: string;
  hair: string;
  shirt: string; shirtDark: string;
  pants: string; shoe: string;
  eye: string;
  /** 扩展色阶(可选; 缺省时按乘法自动推导, 规格调色板提供精确值) */
  hairLight?: string; hairDark?: string;
  shirtShade?: string;
  pantsDark?: string; shoeDark?: string;
  inner?: string;
}

/** 玩家: ART-SPEC 精确色值 — 棕发/肤色/米上衣/蓝灰裤/深棕鞋 */
export const PLAYER_PALETTE: HumanoidPalette = {
  skin: '#ff7d5a', skinDark: '#be5d43',
  hair: '#873822', hairLight: '#c25132', hairDark: '#542316',
  shirt: '#e3cd9c', shirtDark: '#beab82', shirtShade: '#afa58c', inner: '#6e634b',
  pants: '#8494b1', pantsDark: '#7786a0',
  shoe: '#321812', shoeDark: '#190c08',
  eye: '#1f232a',
};

/** 僵尸: 腐烂绿皮 + 破衣 + 暗绿发 */
export const ZOMBIE_PALETTE: HumanoidPalette = {
  skin: '#7a9a5a', skinDark: '#5a7a40',
  hair: '#4a5a38', hairLight: '#5a6e44', hairDark: '#39472c',
  shirt: '#6e634b', shirtDark: '#4a4438', shirtShade: '#5a5442', inner: '#4a4438',
  pants: '#4a4438', pantsDark: '#3a352c',
  shoe: '#2a2018', shoeDark: '#1a1410',
  eye: '#c03838',
};

/** 向导: 金发 + 蓝裤 + 米上衣 */
export const GUIDE_PALETTE: HumanoidPalette = {
  skin: '#ff7d5a', skinDark: '#be5d43',
  hair: '#e8c860', hairLight: '#f0d87e', hairDark: '#c8a040',
  shirt: '#e8e0c8', shirtDark: '#c8bfa2', shirtShade: '#b8b090', inner: '#8a7a58',
  pants: '#5a7ab0', pantsDark: '#4a6494',
  shoe: '#321812', shoeDark: '#190c08',
  eye: '#1f232a',
};

/** 骷髅: 骨白三阶 + 黑眼窝 */
export const SKELETON_PALETTE: HumanoidPalette = {
  skin: '#d8d8d0', skinDark: '#a8a8a0',
  hair: '#d8d8d0', hairLight: '#e8e8e0', hairDark: '#a8a8a0',
  shirt: '#d8d8d0', shirtDark: '#787870', shirtShade: '#a8a8a0', inner: '#787870',
  pants: '#c8c8c0', pantsDark: '#a8a8a0',
  shoe: '#787870', shoeDark: '#5a5a54',
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

/** 吸附到 2px 块网格(保证块对齐渲染) */
function snap2(v: number): number { return Math.round(v / 2) * 2; }

/**
 * 绘制类人角色(玩家/僵尸/骷髅/向导共用) — 10x15 逻辑像素, 2x 放大为 20x30 帧
 * 纵向布局(逻辑行 0-14): 头 0-4(发 0-1 + 脸 2-4) / 躯干 5-8 / 髋 9 / 腿 10-13 / 鞋 14
 */
export function drawHumanoid(ctx: CanvasRenderingContext2D, pal: HumanoidPalette, o: DrawHumanoidOpts): void {
  ctx.save();
  ctx.translate(Math.round(o.x), Math.round(o.y));
  ctx.scale(o.dir, 1);
  const C = o.flash ? '#ff5040' : null;
  const P = (c: number, r: number, w: number, h: number, col: string): void => {
    ctx.fillStyle = C ?? col;
    ctx.fillRect(c * 2 - 10, r * 2 - 30, w * 2, h * 2);
  };

  // ---- 扩展色阶解析(缺省推导) ----
  const hairLt = pal.hairLight ?? shadeHex(pal.hair, 1.4);
  const hairDk = pal.hairDark ?? shadeHex(pal.hair, 0.6);
  const shirtSd = pal.shirtShade ?? shadeHex(pal.shirt, 0.82);
  const pantsDk = pal.pantsDark ?? shadeHex(pal.pants, 0.85);
  const shoeDk = pal.shoeDark ?? shadeHex(pal.shoe, 0.6);
  const innerC = pal.inner ?? shadeHex(pal.shirt, 0.62);

  const ar = o.armor ?? null;
  const aHeadD = ar ? shadeHex(ar.head, 0.62) : '';
  const aHeadL = ar ? shadeHex(ar.head, 1.3) : '';
  const aBodyD = ar ? shadeHex(ar.body, 0.62) : '';
  const aBodyL = ar ? shadeHex(ar.body, 1.3) : '';
  const aLegL = ar ? shadeHex(ar.legs, 1.35) : '';
  const legCol = ar ? ar.legs : pal.pants;
  const hemCol = ar ? shadeHex(ar.legs, 0.62) : pantsDk;

  // ---- 走路 8 帧抬腿表: [前腿 dx/抬升, 后腿 dx/抬升](逻辑 px) ----
  const WALK_F: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [1, 1], [2, 0], [1, 0], [0, 0], [-1, 0], [-2, 0], [-1, 1],
  ];
  const WALK_B: ReadonlyArray<readonly [number, number]> = [
    [0, 0], [-1, 0], [-2, 0], [-1, 1], [0, 1], [1, 1], [2, 0], [1, 0],
  ];
  const walking = o.onGround && Math.abs(o.walkT) > 0.001;
  const wf = ((Math.round(o.walkT / (Math.PI / 4)) % 8) + 8) % 8;
  let fdx = walking ? WALK_F[wf][0] : 0;
  let flift = walking ? WALK_F[wf][1] : 0;
  let bdx = walking ? WALK_B[wf][0] : 0;
  let blift = walking ? WALK_B[wf][1] : 0;
  if (!o.onGround) {
    // 空中: 前腿前伸收起(上升时收得更紧), 后腿后抬
    bdx = -1; blift = 1;
    fdx = 1; flift = o.vy < -0.5 ? 2 : 1;
  }
  // 手臂反相摆动(同侧手臂与同侧腿相反)
  const afdx = o.onGround ? -fdx : 1;
  const abdx = o.onGround ? -bdx : -1;

  // ---- 腿(2 宽, 裤 3 行 + 裤脚暗行 + 底 1 行鞋) ----
  const drawLeg = (baseC: number, dx: number, lift: number): void => {
    const c = baseC + dx;
    const shoeR = 14 - lift;
    const hemR = shoeR - 1;
    const pantH = hemR - 10;
    if (pantH > 0) P(c, 10, 2, pantH, legCol);
    P(c, hemR, 2, 1, hemCol);
    P(c, shoeR, 1, 1, pal.shoe);
    P(c + 1, shoeR, 1, 1, shoeDk);
    if (ar) P(c, pantH >= 2 ? 11 : 10, 1, 1, aLegL);   // 膝盖高光
  };
  P(3, 9, 4, 1, legCol);                               // 髋部连接行
  drawLeg(2, bdx, blift);                              // 后腿(列 2-3)
  drawLeg(5, fdx, flift);                              // 前腿(列 5-6)

  // ---- 后臂(2x3: 上 1 行袖 + 2 行皮肤, 随走路 ±1px 摆动) ----
  if (o.zombieArms) {
    P(2, 5, 1, 1, pal.shirtDark);                      // 肩袖
    P(3, 5, 7, 1, pal.skinDark);                       // 平举前伸(从躯干后穿出)
  } else {
    const aC = ar ? shadeHex(ar.body, 0.7) : pal.shirtDark;
    P(1, 5, 2, 1, aC);
    P(1 + abdx, 6, 2, 1, aC);
    P(1 + abdx, 7, 2, 1, pal.skinDark);
  }

  // ---- 躯干 6x4(行 5-8): 主色 + 胸口暗纹 + 领口 + 腰部 1 行内衬 ----
  if (ar) {
    P(2, 5, 6, 4, ar.body);
    P(2, 5, 1, 3, aBodyD);                             // 侧缝
    P(7, 5, 1, 3, aBodyD);
    P(3, 5, 4, 1, aBodyL);                             // 领口高光
    P(2, 7, 6, 1, aBodyD);                             // 甲片暗缝
    P(2, 8, 6, 1, shadeHex(ar.body, 0.55));            // 腰带行
  } else {
    P(2, 5, 6, 4, pal.shirt);
    P(3, 6, 2, 1, pal.shirtDark);                      // 胸口暗纹 1
    P(5, 7, 2, 1, pal.shirtDark);                      // 胸口暗纹 2
    P(7, 5, 1, 3, shirtSd);                            // 前侧阴影列
    P(4, 5, 2, 1, shadeHex(innerC, 0.45));             // 领口
    P(2, 8, 6, 1, innerC);                             // 腰部内衬行
  }

  // ---- 头 6x5(行 0-4): 发帽 2 行 + 脸 3 行(眼 = 1px 白 + 朝向侧瞳) ----
  P(2, 0, 6, 2, pal.hair);                             // 头发主体
  P(5, 0, 3, 1, hairLt);                               // 顶部亮侧
  P(2, 0, 1, 5, hairDk);                               // 后侧暗发(含后脑勺)
  P(3, 2, 5, 3, pal.skin);                             // 脸
  P(3, 2, 1, 3, pal.skinDark);                         // 脸侧阴影列
  P(7, 2, 1, 1, hairLt);                               // 前额发丝亮斑
  P(2, 5, 1, 2, hairDk);                               // 头后垂发 1px
  P(7, 5, 1, 1, hairDk);                               // 头前鬓角 1px
  P(5, 3, 1, 1, '#f1f1f1');                            // 眼白(朝向侧)
  P(6, 3, 1, 1, pal.eye);                              // 瞳
  if (o.zombieArms) P(5, 4, 2, 1, shadeHex(pal.skin, 0.55));   // 僵尸嘴
  if (ar) {
    // 头盔: 覆盖发区 + 面甲沿 + 护鼻(保留眼睛)
    P(2, 0, 6, 2, ar.head);
    P(3, 0, 4, 1, aHeadL);                             // 盔顶高光
    P(2, 2, 6, 1, aHeadD);                             // 面甲沿
    P(2, 3, 1, 2, ar.head);                            // 盔后板
    P(2, 5, 1, 2, ar.head);                            // 盔后裙
    P(2, 6, 1, 1, aHeadD);                             // 后沿暗缝
    P(7, 3, 1, 1, aHeadD);                             // 护鼻(眼前 1px)
  }

  // ---- 前臂 + 手持物品 ----
  if (o.swing && o.swing.icon) {
    // 前臂以肩(逻辑(7,5) = 本地(4,-20))为轴旋转, 3 阶段(下/前/上举)由 angle 连续驱动
    ctx.save();
    ctx.translate(4, -20);
    ctx.rotate(o.swing.angle);
    ctx.fillStyle = C ?? (ar ? aBodyL : pal.shirt);
    ctx.fillRect(0, 0, 2, 2);                          // 袖
    if (ar) {
      ctx.fillStyle = C ?? ar.body;
      ctx.fillRect(0, 2, 2, 4);                        // 上臂甲
      ctx.fillStyle = C ?? aBodyD;
      ctx.fillRect(0, 6, 2, 2);                        // 甲片暗缝
      ctx.fillStyle = C ?? pal.skin;
      ctx.fillRect(0, 8, 2, 2);                        // 手
    } else {
      ctx.fillStyle = C ?? pal.skin;
      ctx.fillRect(0, 2, 2, 6);                        // 手臂+手
    }
    // 手持物品
    ctx.translate(1, 10);
    ctx.rotate(-Math.PI / 2 + 0.5);
    ctx.drawImage(o.swing.icon, -o.swing.anchor[0], -o.swing.anchor[1]);
    ctx.restore();
  } else if (o.zombieArms) {
    P(3, 6, 1, 1, pal.shirt);                          // 肩袖
    P(4, 6, 5, 1, pal.skin);                           // 前臂平举
    P(8, 7, 1, 1, pal.skinDark);                       // 下垂的手
  } else {
    P(7, 5, 2, 1, ar ? aBodyL : pal.shirt);            // 袖
    P(7 + afdx, 6, 2, 1, ar ? ar.body : pal.skin);
    P(7 + afdx, 7, 2, 1, ar ? aBodyD : pal.skin);
  }

  ctx.restore();
  void o.blinkHidden;
}

// ==================== 史莱姆 ====================
export interface SlimePalette { body: string; dark: string; light: string; line?: string }
/** 绿史莱姆(ART-SPEC: 主体 #4ec44e 暗 #389a38 亮 #8ee88e 描边 #1d5a1d) */
export const SLIME_GREEN: SlimePalette = { body: '#4ec44e', dark: '#389a38', light: '#8ee88e', line: '#1d5a1d' };
/** 蓝史莱姆(ART-SPEC: 主体 #205ad4 暗 #1a49ac 亮 #4074e2 描边 #0a1c42) */
export const SLIME_BLUE: SlimePalette = { body: '#205ad4', dark: '#1a49ac', light: '#4074e2', line: '#0a1c42' };
/** 熔岩史莱姆(ART-SPEC: #f07030/#c04010/#ffd060/描边 #6b1e08) */
export const LAVA_SLIME: SlimePalette = { body: '#f07030', dark: '#c04010', light: '#ffd060', line: '#6b1e08' };

/**
 * 史莱姆: 水滴椭圆体(顶部圆弧收窄 → 中部最宽 → 底部平), 全周 1 逻辑 px 描边,
 * 左上 1x2 高光斑, 两颗深色竖椭圆眼(带白点高光, 看向移动方向); squish 受压时宽+1 高-1
 */
export function drawSlime(
  ctx: CanvasRenderingContext2D, pal: SlimePalette,
  x: number, y: number, w: number, h: number,
  squish: number, dir: 1 | -1, flash: boolean,
): void {
  const cx = snap2(x);
  const by = snap2(y);
  const dw = clampN(Math.round(squish * 2.5), -1, 1);  // 受压宽+1高-1 / 拉伸窄+高
  const lw = Math.max(3, Math.round(w / 2) + dw);      // 逻辑宽
  const lh = Math.max(3, Math.round(h / 2) - dw);      // 逻辑高
  const maxHW = Math.max(1, Math.floor(lw / 2));
  // 水滴逐行半宽(逻辑, 顶→底): 顶 1px 圆弧 → 鼓出 → 底部全宽
  const hw: number[] = [];
  for (let r = 0; r < lh; r++) {
    if (r === 0) hw.push(1);
    else if (r === 1) hw.push(Math.max(2, Math.round(maxHW * 0.55)));
    else if (r === 2 && lh > 4) hw.push(Math.max(3, Math.round(maxHW * 0.85)));
    else hw.push(maxHW);
  }
  const lineC = flash ? '#ff5040' : (pal.line ?? shadeHex(pal.dark, 0.4));
  const bodyC = flash ? '#ff5040' : pal.body;
  const darkC = flash ? '#ff5040' : pal.dark;
  const lightC = flash ? '#ff8070' : pal.light;
  const eyeC = flash ? '#ff5040' : (pal.line ?? '#101018');
  const topY = by - lh * 2;
  const rect = (rx: number, ry: number, rw: number, rh: number, col: string): void => {
    ctx.fillStyle = col;
    ctx.fillRect(rx, ry, rw, rh);
  };
  ctx.save();
  ctx.globalAlpha = 0.88;
  // 全周 1 逻辑 px 描边(轮廓膨胀一圈)
  for (let r = -1; r <= lh; r++) {
    const e = hw[Math.max(0, Math.min(lh - 1, r))] + 1;
    rect(cx - e * 2, topY + r * 2, e * 4, 2, lineC);
  }
  // 主体(底 1 行更暗)
  for (let r = 0; r < lh; r++) {
    rect(cx - hw[r] * 2, topY + r * 2, hw[r] * 4, 2, r === lh - 1 ? darkC : bodyC);
  }
  // 左上 1x2 高光斑
  if (lh >= 4 && hw[1] >= 2) rect(cx - (hw[1] - 1) * 2, topY + 2, 2, 4, lightC);
  // 两颗眼睛: 深色竖椭圆 + 顶部白点高光, 随 dir 偏移看向移动方向
  const eyR = Math.max(1, Math.round(lh * 0.33));
  const eh = Math.min(lh >= 6 ? 6 : 4, (lh - eyR) * 2);
  const e1 = Math.round(lw / 2) - 2 + (dir > 0 ? 1 : 0);
  for (const ec of [e1, e1 + 2]) {
    const ex = snap2(cx + (ec - lw / 2) * 2);
    const ey = topY + eyR * 2;
    rect(ex, ey, 2, eh, eyeC);
    rect(ex, ey, 2, 2, '#f1f1f1');
  }
  ctx.restore();
}

// ==================== 恶魔眼 ====================
/**
 * 恶魔眼: 像素圆球(白 #f1f1f1 + 边缘血丝 #d05050 + 大虹膜 #c03030 朝向 dir
 * + 瞳 #1a1a2a + 顶部高光 #ffffff); 背后 2-3 条 #b04040 触须随 t 摆动
 */
export function drawEye(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  t: number, dir: 1 | -1, flash: boolean,
): void {
  const cx = snap2(x);
  const cy = snap2(y - h / 2);
  const rows = Math.max(4, Math.round(Math.min(w, h + 2) / 4) * 2);   // 逻辑行数(h=14 → 8 → 16x16 球)
  const a = rows / 2;
  const hw: number[] = [];
  for (let r = 0; r < rows; r++) {
    const dy = ((r + 0.5) / rows) * 2 - 1;
    hw.push(Math.max(1, Math.round(a * Math.sqrt(Math.max(0, 1 - dy * dy)))));
  }
  const topY = cy - rows;
  const ballC = flash ? '#ff5040' : '#f1f1f1';
  const tentC = flash ? '#ff5040' : '#b04040';
  const vesC = flash ? '#ff5040' : '#d05050';
  const irisC = flash ? '#ff2020' : '#c03030';
  const rect = (rx: number, ry: number, rw: number, rh: number, col: string): void => {
    ctx.fillStyle = col;
    ctx.fillRect(rx, ry, rw, rh);
  };
  ctx.save();
  // 背后触须 3 条(折线块, 随 t 摆动)
  const backX = (j: number): number => (dir > 0 ? cx - 6 - j * 4 : cx + 4 + j * 4);
  for (let i = 0; i < 3; i++) {
    const ty = cy - 4 + i * 4;
    for (let j = 0; j < 3; j++) {
      const wig = snap2(Math.sin(t * 0.35 + j * 0.9 + i * 2.1) * 1.5);
      rect(backX(j) + wig, ty, 2, 2, tentC);
    }
  }
  // 眼球
  for (let r = 0; r < rows; r++) rect(cx - hw[r] * 2, topY + r * 2, hw[r] * 4, 2, ballC);
  // 边缘血丝(确定性分布, 每条 2 块向内)
  const EV: ReadonlyArray<readonly [number, number]> = [[1, -1], [2, 1], [4, -1], [5, 1], [rows - 2, -1], [rows - 1, 1]];
  for (const [vr, vs] of EV) {
    if (vr >= 0 && vr < rows && hw[vr] >= 2) {
      rect(cx + vs * (hw[vr] - 1) * 2, topY + vr * 2, 2, 2, vesC);
      if (hw[vr] >= 3) rect(cx + vs * (hw[vr] - 3) * 2, topY + vr * 2 + 2, 2, 2, vesC);
    }
  }
  // 大虹膜(朝向 dir 偏移) + 瞳 + 顶部高光
  const ix = cx + dir * 2;
  rect(ix - 2, cy - 2, 4, 4, irisC);
  rect(ix - 2 + (dir > 0 ? 2 : 0), cy - 2, 2, 2, flash ? '#ff2020' : '#1a1a2a');
  rect(cx - hw[1] * 2 + 2, topY + 2, 2, 2, '#ffffff');
  ctx.restore();
}

// ==================== 洞穴蝙蝠 ====================
// (x, y) = 判定盒底部中心; 翅膀两帧(上展/下收)按 sin(anim*0.35)
export function drawBat(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  anim: number, dir: 1 | -1, flash: boolean,
): void {
  const cx = snap2(x);
  const cy = snap2(y - h / 2);
  const up = Math.sin(anim * 0.35) > 0;    // 两帧扑翼
  const wingC = flash ? '#ff5040' : '#3a2818';
  const bodyC = flash ? '#ff5040' : '#4a3628';
  const rect = (rx: number, ry: number, rw: number, rh: number, col: string): void => {
    ctx.fillStyle = col;
    ctx.fillRect(rx, ry, rw, rh);
  };
  ctx.save();
  // 双翼 3 段折线(上展/下收)
  const ys = up ? [cy - 4, cy - 6, cy - 4] : [cy, cy + 2, cy];
  const ws = [4, 4, 2];
  for (const s of [-1, 1] as const) {
    const xs = s > 0 ? [cx + 2, cx + 6, cx + 10] : [cx - 6, cx - 10, cx - 12];
    for (let i = 0; i < 3; i++) rect(xs[i], ys[i], ws[i], 2, wingC);
  }
  // 身体 3x3 + 耳朵
  rect(cx - 4, cy - 4, 6, 6, bodyC);
  rect(cx - 4, cy - 6, 2, 2, bodyC);
  rect(cx, cy - 6, 2, 2, bodyC);
  // 红眼 1px(朝向前侧)
  rect(dir > 0 ? cx : cx - 4, cy - 2, 2, 2, flash ? '#ff5040' : '#e03030');
  ctx.restore();
}

// ==================== 噬魂者 ====================
// (x, y) = 判定盒底部中心; 分节虫体(头/身节/尾), 节间随 anim 起伏
export function drawEos(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  anim: number, dir: 1 | -1, flash: boolean,
): void {
  const cx = snap2(x);
  const cy = snap2(y - h / 2);
  const und = snap2(Math.sin(anim * 0.25) * 1.5);   // 分节起伏 ±2px
  const headC = flash ? '#ff5040' : '#6a4d8e';
  const lineC = flash ? '#ff5040' : '#4a3568';
  const segC = flash ? '#ff5040' : '#5a4278';
  const rect = (rx: number, ry: number, rw: number, rh: number, col: string): void => {
    ctx.fillStyle = col;
    ctx.fillRect(rx, ry, rw, rh);
  };
  ctx.save();
  // x 镜像助手: ox 为 dir=+1 时的左上角偏移
  const mr = (ox: number, ww: number): number => (dir > 0 ? cx + ox : cx - ox - ww);
  // 尾(细尖)
  rect(mr(-12, 2), cy - 2 - und, 2, 4, lineC);
  // 身节 x2(圆段 + 底部暗边)
  rect(mr(-8, 6), cy - 4 - und, 6, 6, segC);
  rect(mr(-8, 6), cy - und, 6, 2, lineC);
  rect(mr(-4, 6), cy - 4 + und, 6, 6, segC);
  rect(mr(-4, 6), cy + und, 6, 2, lineC);
  // 头: 大颚(描边 + 主体) + 白牙 + 红眼
  rect(mr(-2, 12), cy - 6, 12, 12, lineC);
  rect(mr(0, 8), cy - 4, 8, 8, headC);
  rect(mr(8, 2), cy - 4, 2, 2, flash ? '#ff5040' : '#f1f1f1');   // 白牙上
  rect(mr(6, 2), cy, 2, 2, flash ? '#ff5040' : '#f1f1f1');       // 白牙中
  rect(mr(8, 2), cy + 2, 2, 2, flash ? '#ff5040' : '#f1f1f1');   // 白牙下
  rect(mr(2, 2), cy - 4, 2, 2, flash ? '#ff5040' : '#d83030');   // 红眼
  ctx.restore();
}

// ==================== 克苏鲁之眼 (Boss) ====================
// 坐标约定同 drawEye/drawSlime: (x, y) = 判定盒底部中心
// phase: 0=大虹膜阶段, 1=巨口阶段; lookX/lookY: 虹膜朝向偏移(内部 clamp ±6)
// animT: 动画计时; flash>0: 整体覆盖半透明白
export function drawEoC(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  phase: number, lookX: number, lookY: number,
  animT: number, flash: number,
): void {
  const cx = snap2(x);
  const cy = snap2(y - h / 2);
  const bob = phase === 1 ? snap2(Math.sin(animT * 0.22) * 1.5) : 0;   // 巨口阶段 ±2px 脉动
  const rows = Math.max(8, Math.round((h - 6) / 2));    // 逻辑行数(h=38 → 16 → 32px 高)
  const maxHW = Math.max(4, Math.round((w - 2) / 4));   // 逻辑半宽(w=46 → 11 → 44px 宽)
  const hw: number[] = [];
  for (let r = 0; r < rows; r++) {
    const dy = ((r + 0.5) / rows) * 2 - 1;
    hw.push(Math.max(1, Math.round(maxHW * Math.sqrt(Math.max(0, 1 - dy * dy)))));
  }
  const topY = cy + bob - rows;
  const ballC = '#f1f1f1';
  const vesC = '#d05050';
  const irisC = '#c03030';
  const tentC = '#b04040';
  const rect = (rx: number, ry: number, rw: number, rh: number, col: string): void => {
    ctx.fillStyle = col;
    ctx.fillRect(rx, ry, rw, rh);
  };
  ctx.save();
  // ---- 后部触须 5 条(2px 块, 随 animT 摆动) ----
  for (let i = 0; i < 5; i++) {
    const tx = cx - 16 + i * 8;
    const len = 3 + (i % 3);
    for (let j = 0; j < len; j++) {
      const wig = snap2(Math.sin(animT * 0.3 + j * 0.9 + i * 1.7) * 1.5);
      rect(tx + wig, cy + bob + rows - 4 + j * 2, 2, 2, tentC);
    }
  }
  // ---- 眼体(像素椭圆) ----
  for (let r = 0; r < rows; r++) rect(cx - hw[r] * 2, topY + r * 2, hw[r] * 4, 2, ballC);
  // ---- 边缘血丝(确定性分布) ----
  const VES: ReadonlyArray<readonly [number, number]> = [
    [1, -1], [3, 1], [5, -1], [7, 1], [8, -1], [10, 1], [12, -1], [14, 1],
  ];
  for (const [vr, vs] of VES) {
    if (vr < rows && hw[vr] >= 2) {
      rect(cx + vs * (hw[vr] - 1) * 2, topY + vr * 2, 2, 2, vesC);
      if (hw[vr] >= 3) rect(cx + vs * (hw[vr] - 3) * 2, topY + vr * 2 + 2, 2, 2, vesC);
    }
  }
  // 视线偏移(偶数量化, clamp ±6)
  const iox = clampN(snap2(lookX), -6, 6);
  const ioy = clampN(snap2(lookY), -6, 6);
  if (phase === 1) {
    // ---- 巨口: 暗口腔 + 红 #a02020 锯齿牙 ----
    const mx = cx + clampN(Math.round(iox / 2) * 2, -4, 4);
    const my = cy + bob + clampN(Math.round(ioy / 2) * 2, -4, 4);
    const MW = [4, 8, 10, 10, 8, 4];
    for (let i = 0; i < MW.length; i++) rect(mx - MW[i], my - 6 + i * 2, MW[i] * 2, 2, '#3a0a0a');
    for (let i = 0; i < 5; i++) {
      const tx = mx - 8 + i * 4;
      const th = 2 + (i % 2) * 2;
      rect(tx, my - 6, 2, th, '#a02020');            // 上牙(向下)
      rect(tx, my + 6 - th, 2, th, '#a02020');       // 下牙(向上)
    }
  } else {
    // ---- 大虹膜 + 瞳(朝 lookX/lookY) + 顶部高光 ----
    rect(cx + iox - 6, cy + bob + ioy - 6, 12, 10, irisC);
    rect(cx + iox - 2, cy + bob + ioy - 2, 4, 4, '#1a1a2a');
    rect(cx - 4, topY + 4, 4, 4, '#ffffff');
  }
  // ---- 受击白闪(整体半透明白) ----
  if (flash > 0) {
    ctx.globalAlpha = 0.55;
    for (let r = 0; r < rows; r++) rect(cx - hw[r] * 2 - 2, topY + r * 2, hw[r] * 4 + 4, 2, '#ffffff');
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ==================== 投射物 ====================

/** 像素箭矢(杆 #976b4b + 头 #adb8cd + 尾羽 #e8e8e8), 按 angle 旋转(angle=0 朝 +x); (x, y) = 箭矢中心 */
export function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate(angle);
  ctx.imageSmoothingEnabled = false;     // 保持像素感
  ctx.fillStyle = '#976b4b';
  ctx.fillRect(-6, -1, 9, 2);            // 木杆
  ctx.fillStyle = '#adb8cd';
  ctx.fillRect(3, -2, 3, 4);             // 箭头
  ctx.fillRect(6, -1, 2, 2);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(-8, -3, 2, 2);            // 尾羽(上下各 2 片)
  ctx.fillRect(-6, -3, 2, 2);
  ctx.fillRect(-8, 1, 2, 2);
  ctx.fillRect(-6, 1, 2, 2);
  ctx.restore();
}

/** 像素圆黑球炸弹(#2a2a30 + 高光 #55555f + 引线 #78553c), 火花随 t 双频闪烁; (x, y) = 球心 */
export function drawBomb(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const bx = snap2(x);
  const by = snap2(y);
  ctx.fillStyle = '#2a2a30';             // 黑球(8x8 像素圆)
  ctx.fillRect(bx - 2, by - 4, 4, 2);
  ctx.fillRect(bx - 4, by - 2, 8, 4);
  ctx.fillRect(bx - 2, by + 2, 4, 2);
  ctx.fillStyle = '#55555f';
  ctx.fillRect(bx - 2, by - 2, 2, 2);    // 高光
  ctx.fillStyle = '#78553c';
  ctx.fillRect(bx, by - 8, 2, 4);        // 引线
  ctx.fillRect(bx + 2, by - 10, 2, 2);
  if (Math.sin(t * 0.8) > -0.25) {       // 火花闪烁
    ctx.fillStyle = '#ffd75e';
    ctx.fillRect(bx + 2, by - 12, 4, 2);
    ctx.fillStyle = '#ff9a3c';
    ctx.fillRect(bx + 4, by - 10, 2, 2);
    if (Math.sin(t * 1.7) > 0) {
      ctx.fillStyle = '#fff2b0';
      ctx.fillRect(bx, by - 14, 2, 2);
    }
  }
}
