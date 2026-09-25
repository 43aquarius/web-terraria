/**
 * 实体系统：AABB 物理 / 玩家 / 敌怪 AI / 掉落物 / 粒子 / 伤害数字
 */

import { T, TileDefs, PLAYER_CONF, ENEMY_DEFS, IT } from './constants';
import { World } from './world';
import type { Slot } from './store';

// ==================== 通用物理 ====================
export interface Body {
  x: number; y: number;       // x=中心 y=脚底
  vx: number; vy: number;
  w: number; h: number;
  onGround: boolean;
}

export interface MoveOpts {
  platforms: boolean;   // 是否与单向平台碰撞
  dropThrough: boolean; // 按住下键穿过平台
  stepUp: boolean;      // 自动上一格台阶
}

export interface MoveResult { blockedX: boolean; landed: boolean; headBump: boolean }

/**
 * 判定身体盒(x=中心, y=脚底, half=半宽, h=高)覆盖的所有瓦片均非实心。
 * 13-c: 抽出为公共工具(stepUp 全盒检查 / 出生点 clearance / 防卡死安全网共用)。
 */
export function boxClear(world: World, x: number, y: number, half: number, h: number): boolean {
  const x0 = Math.floor((x - half + 0.01) / 16);
  const x1 = Math.floor((x + half - 0.01) / 16);
  const y0 = Math.floor((y - h + 0.01) / 16);
  const y1 = Math.floor((y - 0.01) / 16);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (world.isSolid(tx, ty)) return false;
    }
  }
  return true;
}

/**
 * 防卡死安全网(13-c): 身体盒与实心格重叠时, 把它推到最近的无重叠位置。
 * 优先向上(最多 2 格, 原版在方块内会向上冒出), 再左右, 最后向下。
 * 无重叠时为纯查询 no-op, 每帧调用也无开销。返回是否发生了推移。
 */
export function unstickBody(world: World, b: Body): boolean {
  const half = b.w / 2;
  if (boxClear(world, b.x, b.y, half, b.h)) return false;
  for (let dy = 2; dy <= 34; dy += 2) {
    if (boxClear(world, b.x, b.y - dy, half, b.h)) {
      b.y -= dy;
      if (b.vy < 0) b.vy = 0;
      return true;
    }
  }
  for (let d = 2; d <= 34; d += 2) {
    if (boxClear(world, b.x + d, b.y, half, b.h)) { b.x += d; b.vx = 0; return true; }
    if (boxClear(world, b.x - d, b.y, half, b.h)) { b.x -= d; b.vx = 0; return true; }
  }
  for (let dy = 2; dy <= 34; dy += 2) {
    if (boxClear(world, b.x, b.y + dy, half, b.h)) { b.y += dy; b.vy = 0; return true; }
  }
  return false;
}

export function moveBody(world: World, b: Body, o: MoveOpts): MoveResult {
  const res: MoveResult = { blockedX: false, landed: false, headBump: false };
  const half = b.w / 2;

  // ---- X 轴 ----
  if (b.vx !== 0) {
    const nx = b.x + b.vx;
    const dirX = b.vx > 0 ? 1 : -1;
    const edge = nx + dirX * half;
    const tx = Math.floor(edge / 16);
    const ty0 = Math.floor((b.y - b.h + 0.01) / 16);
    const ty1 = Math.floor((b.y - 0.01) / 16);
    let collides = false;
    for (let ty = ty0; ty <= ty1; ty++) {
      if (world.isSolid(tx, ty)) { collides = true; break; }
    }
    if (collides) {
      let stepped = false;
      if (o.stepUp && b.onGround) {
        // 13-c: 台阶抬升后整身盒(所有跨越列×整高)必须无实心。
        // 旧实现只查目标列的抬升区间, 漏查当前列头部上方 → 低顶棚下自动上台阶
        // 会把头嵌进天花板, 造成"卡在方块里+黑暗中隐形"。
        const sy = b.y - 16;
        if (boxClear(world, nx, sy, half, b.h)) {
          b.y = sy; b.x = nx; stepped = true;
        }
      }
      if (!stepped) { res.blockedX = true; b.vx = 0; }
    } else {
      b.x = nx;
    }
  }

  // ---- Y 轴 ----
  const prevBot = b.y;
  const ny = b.y + b.vy;
  const tx0 = Math.floor((b.x - half + 0.01) / 16);
  const tx1 = Math.floor((b.x + half - 0.01) / 16);
  if (b.vy >= 0) {
    // 下落/站立
    const ty = Math.floor((ny - 0.01) / 16);
    let hit = false;
    if (b.vy > 0) {
      for (let txx = tx0; txx <= tx1; txx++) {
        if (world.isSolid(txx, ty)) { hit = true; break; }
      }
      if (!hit && o.platforms && !o.dropThrough) {
        for (let txx = tx0; txx <= tx1; txx++) {
          const id = world.get(txx, ty);
          if (TileDefs[id].platform && prevBot <= ty * 16 + 0.05) { hit = true; break; }
        }
      }
    }
    if (hit) {
      b.y = ty * 16;
      if (b.vy > 0) res.landed = true;
      b.vy = 0;
      b.onGround = true;
    } else {
      b.y = ny;
      b.onGround = false;
    }
  } else {
    // 上升
    const ty = Math.floor((ny - b.h) / 16);
    let hit = false;
    for (let txx = tx0; txx <= tx1; txx++) {
      if (world.isSolid(txx, ty)) { hit = true; break; }
    }
    if (hit) {
      b.y = (ty + 1) * 16 + b.h;
      b.vy = 0;
      res.headBump = true;
    } else {
      b.y = ny;
      b.onGround = false;
    }
  }
  return res;
}

export function tileAt(world: World, px: number, py: number): number {
  return world.get(Math.floor(px / 16), Math.floor(py / 16));
}

export function bodyInWater(world: World, b: Body): boolean {
  return tileAt(world, b.x, b.y - b.h * 0.5) === T.WATER
    || tileAt(world, b.x, b.y - 2) === T.WATER;
}

/** 身体是否泡在岩浆里(脚底格或身体中心格) */
export function bodyInLava(world: World, b: Body): boolean {
  return tileAt(world, b.x, b.y) === T.LAVA
    || tileAt(world, b.x, b.y - b.h * 0.5) === T.LAVA;
}

// ==================== 玩家 ====================
export interface SwingState {
  itemId: number;
  t: number;
  dur: number;
  hits: Set<number>;
  kind: 'arc' | 'stab';
}

export interface Player extends Body {
  dir: 1 | -1;
  walkT: number;
  hp: number; maxHp: number;
  breath: number;
  lastHurt: number;
  iframes: number;
  dead: boolean; deadTimer: number;
  fallStart: number | null;
  inWater: boolean; headWater: boolean; wasInWater: boolean;
  hotbar: number;
  inv: (Slot | null)[];
  cursorItem: Slot | null;
  regenAcc: number;
  swing: SwingState | null;
  spawnProt: number;
}

export interface InputState { left: boolean; right: boolean; jump: boolean; down: boolean }

export interface PlayerEvents { fell: number; jumped: boolean; splash: boolean; landed: boolean }

export function mkPlayer(x: number, y: number): Player {
  return {
    x, y, vx: 0, vy: 0, w: PLAYER_CONF.w, h: PLAYER_CONF.h, onGround: false,
    dir: 1, walkT: 0,
    hp: PLAYER_CONF_MAXHP(), maxHp: 100,
    breath: PLAYER_CONF.breathMax,
    lastHurt: -99999, iframes: 0, dead: false, deadTimer: 0,
    fallStart: null, inWater: false, headWater: false, wasInWater: false,
    hotbar: 0, inv: new Array(40).fill(null), cursorItem: null,
    regenAcc: 0, swing: null, spawnProt: 120,
  };
}
function PLAYER_CONF_MAXHP(): number { return 100; }

export function updatePlayer(world: World, p: Player, input: InputState, frame: number): PlayerEvents {
  const c = PLAYER_CONF;
  const ev: PlayerEvents = { fell: 0, jumped: false, splash: false, landed: false };

  // 水检测
  p.wasInWater = p.inWater;
  p.inWater = bodyInWater(world, p);
  p.headWater = tileAt(world, p.x, p.y - p.h + 6) === T.WATER;
  if (p.inWater && !p.wasInWater && p.vy > 3) ev.splash = true;

  // 冰面检测: 脚下 1-2px 处的方块是冰且在地面 → 摩擦/加速乘冰面系数(很滑)
  const onIce = p.onGround && (
    tileAt(world, p.x, p.y + 1) === T.ICE || tileAt(world, p.x, p.y + 2) === T.ICE
  );

  // 水平移动
  const inWaterSlow = p.inWater ? 0.62 : 1;
  const maxV = c.runSpeed * inWaterSlow;
  const acc = (p.onGround ? c.accel : c.airAccel) * (p.inWater ? 0.7 : 1) * (onIce ? c.iceAccelMul : 1);
  if (input.left && !input.right) {
    p.vx = Math.max(-maxV, p.vx - acc);
    p.dir = -1;
  } else if (input.right && !input.left) {
    p.vx = Math.min(maxV, p.vx + acc);
    p.dir = 1;
  } else {
    const f = p.onGround ? c.fric * (onIce ? c.iceFricMul : 1) : c.airFric;
    if (p.vx > 0) p.vx = Math.max(0, p.vx - f);
    else if (p.vx < 0) p.vx = Math.min(0, p.vx + f);
  }

  // 跳跃/游泳
  if (input.jump) {
    if (p.inWater) {
      p.vy = Math.max(p.vy - 0.45, -2.6);
    } else if (p.onGround) {
      p.vy = c.jumpVel;
      ev.jumped = true;
      p.fallStart = null;
    }
  } else if (p.vy < -2.8 && !p.inWater) {
    p.vy = -2.8; // 松开跳跃提前减速上升
  }

  // 重力
  const grav = p.inWater ? 0.1 : c.gravity;
  const maxFall = p.inWater ? c.swimFall : c.maxFall;
  p.vy = Math.min(maxFall, p.vy + grav);

  // 摔落追踪
  if (p.vy > 0 && p.fallStart === null) p.fallStart = p.y;
  if (p.inWater) p.fallStart = null;

  // 移动
  const prevGround = p.onGround;
  const prevVy = p.vy;
  const r = moveBody(world, p, { platforms: true, dropThrough: input.down, stepUp: true });
  if (r.landed && !prevGround) {
    ev.landed = true;
    if (p.fallStart !== null && prevVy > 3) {
      const dist = (p.y - p.fallStart) / 16;
      if (dist > c.fallDamageTiles) ev.fell = Math.round((dist - c.fallDamageTiles) * 7);
    }
    p.fallStart = null;
  }
  if (p.onGround) p.fallStart = null;

  // 动画相位
  if (p.onGround && Math.abs(p.vx) > 0.3) p.walkT += 0.16 + Math.abs(p.vx) * 0.06;
  else if (p.onGround) p.walkT = 0;

  void frame;
  return ev;
}

// ==================== 敌怪 ====================
export type EnemyKind = 'gslime' | 'bslime' | 'zombie' | 'eye' | 'bat' | 'skel' | 'lslime' | 'eos' | 'eoc';
let enemySeq = 1;

export interface Enemy extends Body {
  id: number;
  kind: EnemyKind;
  hp: number; maxHp: number; dmg: number; kb: number;
  dir: 1 | -1;
  anim: number;
  flash: number;
  hopTimer: number;
  hpShow: number;
  fly: boolean;
  night: boolean;
  dead: boolean;
  // ---- Boss / 蓄力状态字段(可选, 不影响旧敌怪) ----
  mode?: 'hover' | 'telegraph' | 'dash' | 'spin' | 'flee'; // eoc 状态机(eos 只用 aiT)
  aiT?: number;        // 状态计时(帧)
  dashLeft?: number;   // 剩余冲刺次数(eoc)
  phase?: 0 | 1;       // eoc 阶段(0=hover/3冲, 1=spin后4连冲)
  stuck?: number;      // 13-c: 连续嵌入实心格的帧数(长期卡死敌怪静默移除用)
}

export function spawnEnemy(kind: EnemyKind, x: number, y: number): Enemy {
  const c = ENEMY_DEFS[kind];
  const e: Enemy = {
    id: enemySeq++, kind,
    x, y: y - 1, vx: 0, vy: 0, w: c.w, h: c.h, onGround: false,
    hp: c.hp, maxHp: c.hp, dmg: c.dmg, kb: c.kb,
    dir: Math.random() < 0.5 ? 1 : -1,
    anim: Math.random() * 100, flash: 0,
    hopTimer: 30 + Math.random() * 50, hpShow: 0,
    fly: c.fly, night: c.night, dead: false,
  };
  if (kind === 'eoc') { e.mode = 'hover'; e.aiT = 0; e.dashLeft = 0; e.phase = 0; }
  if (kind === 'eos') e.aiT = (Math.random() * 120) | 0; // 错开蓄力节奏
  return e;
}

/** 飞行敌怪撞墙处理(eye 原有逻辑, bat/eos 复用) */
function flyWallBounce(e: Enemy, r: MoveResult): void {
  if (r.blockedX) e.vx = -e.vx * 0.6;
  if (r.landed) e.vy = -Math.abs(e.vy) * 0.6 - 0.5;
  if (r.headBump) e.vy = Math.abs(e.vy) * 0.6 + 0.5;
}

export function updateEnemy(world: World, e: Enemy, px: number, py: number, isNight: boolean, frame: number): void {
  const dx = px - e.x;
  const dy = py - e.y + 20;
  const dist = Math.hypot(dx, dy);
  e.anim += 1;
  if (e.flash > 0) e.flash--;
  if (e.hpShow > 0) e.hpShow--;

  const inWater = bodyInWater(world, e);

  if (e.kind === 'gslime' || e.kind === 'bslime') {
    if (e.onGround) {
      e.vx *= 0.82;
      e.hopTimer--;
      if (e.hopTimer <= 0 && dist < 560 && !isNightOnlyIssue(e)) {
        e.dir = dx > 0 ? 1 : -1;
        const spd = e.kind === 'bslime' ? 1.35 : 1.05;
        e.vx = e.dir * (spd * (0.85 + Math.random() * 0.5));
        e.vy = -(3.1 + Math.random() * 1.6);
        e.hopTimer = 55 + Math.random() * 55;
      } else if (e.hopTimer <= 0) {
        e.hopTimer = 40 + Math.random() * 60;
      }
    }
    e.vy = Math.min(9, e.vy + (inWater ? 0.14 : 0.3));
    moveBody(world, e, { platforms: false, dropThrough: false, stepUp: false });
  } else if (e.kind === 'zombie') {
    if (dist < 700) {
      e.dir = dx > 0 ? 1 : -1;
      e.vx += (e.dir * 1.05 - e.vx) * 0.07;
    } else {
      e.vx *= 0.9;
    }
    e.vy = Math.min(10, e.vy + (inWater ? 0.15 : 0.34));
    const r = moveBody(world, e, { platforms: false, dropThrough: false, stepUp: true });
    if (r.blockedX && e.onGround) e.vy = -6.6;
    if (r.headBump) e.vy = 0.5;
  } else if (e.kind === 'eye') {
    // 飞行: 追踪 + 正弦摆动
    if (dist > 1) {
      const nx = dx / dist, ny = dy / dist;
      const wob = Math.sin(frame * 0.055 + e.id) * 0.55;
      e.vx += (nx * 0.075 - ny * wob * 0.05);
      e.vy += (ny * 0.075 + nx * wob * 0.05);
      const sp = Math.hypot(e.vx, e.vy);
      const maxSp = 2.5;
      if (sp > maxSp) { e.vx = e.vx / sp * maxSp; e.vy = e.vy / sp * maxSp; }
    }
    e.dir = dx > 0 ? 1 : -1;
    const r = moveBody(world, e, { platforms: false, dropThrough: false, stepUp: false });
    flyWallBounce(e, r);
  } else if (e.kind === 'bat') {
    // 洞穴蝙蝠: 飞行追击 + 强不规则抖动(x/y 独立相位)
    if (dist > 1) {
      const nx = dx / dist, ny = dy / dist;
      e.vx += nx * 0.09 + Math.sin(frame * 0.31 + e.id) * 0.14;
      e.vy += ny * 0.09 + Math.sin(frame * 0.31 + e.id * 2.7 + 1.9) * 0.14;
      const sp = Math.hypot(e.vx, e.vy);
      const maxSp = 2.6;
      if (sp > maxSp) { e.vx = e.vx / sp * maxSp; e.vy = e.vy / sp * maxSp; }
    }
    e.dir = dx > 0 ? 1 : -1;
    const r = moveBody(world, e, { platforms: false, dropThrough: false, stepUp: false });
    flyWallBounce(e, r);
  } else if (e.kind === 'skel') {
    // 骷髅: 同僵尸走地 AI, 速度略慢跳跃稍弱, 近距离加速逼近
    if (dist < 700) {
      e.dir = dx > 0 ? 1 : -1;
      const spd = dist < 350 ? 1.2 : 0.9;
      e.vx += (e.dir * spd - e.vx) * 0.07;
    } else {
      e.vx *= 0.9;
    }
    e.vy = Math.min(10, e.vy + (inWater ? 0.15 : 0.34));
    const r = moveBody(world, e, { platforms: false, dropThrough: false, stepUp: true });
    if (r.blockedX && e.onGround) e.vy = -6.1;
    if (r.headBump) e.vy = 0.5;
  } else if (e.kind === 'lslime') {
    // 熔岩史莱姆: 跳得更高更快, 岩浆里不受伤(引擎处理)
    if (e.onGround) {
      e.vx *= 0.82;
      e.hopTimer--;
      if (e.hopTimer <= 0 && dist < 560) {
        e.dir = dx > 0 ? 1 : -1;
        e.vx = e.dir * 1.7;
        e.vy = -(3.4 + Math.random() * 1.6); // -4.2 ± 0.8
        e.hopTimer = 55 + Math.random() * 55;
      } else if (e.hopTimer <= 0) {
        e.hopTimer = 40 + Math.random() * 60;
      }
    }
    e.vy = Math.min(9, e.vy + (inWater ? 0.14 : 0.3));
    moveBody(world, e, { platforms: false, dropThrough: false, stepUp: false });
  } else if (e.kind === 'eos') {
    // 噬魂者: 飞行追击 + 蓄力扑咬(计 120 帧 → 冲刺 26 帧 → 循环)
    e.aiT = (e.aiT ?? 0) + 1;
    if (e.aiT <= 120) {
      if (dist > 1) {
        const nx = dx / dist, ny = dy / dist;
        e.vx += nx * 0.045;
        e.vy += ny * 0.045;
        const sp = Math.hypot(e.vx, e.vy);
        if (sp > 1.4) { e.vx = e.vx / sp * 1.4; e.vy = e.vy / sp * 1.4; }
      }
      if (e.aiT === 120 && dist > 1) {
        // 蓄力完成 → 扑咬(朝玩家冲刺)
        e.vx = (dx / dist) * 4.2;
        e.vy = (dy / dist) * 4.2;
      }
    } else if (e.aiT >= 146) {
      e.aiT = 0; // 扑咬结束, 回到缓慢逼近
    }
    e.dir = dx > 0 ? 1 : -1;
    const r = moveBody(world, e, { platforms: false, dropThrough: false, stepUp: false });
    flyWallBounce(e, r);
  } else if (e.kind === 'eoc') {
    updateEoc(world, e, px, py, isNight, dx);
  }
}

/** 克苏鲁之眼 Boss 状态机(挂在 updateEnemy 内, 不单独导出) */
function updateEoc(world: World, e: Enemy, px: number, py: number, isNight: boolean, dx: number): void {
  if (e.mode === undefined) { e.mode = 'hover'; e.aiT = 0; e.dashLeft = 0; e.phase = 0; }
  e.aiT = (e.aiT ?? 0) + 1;
  const ph = e.phase ?? 0;

  // 阶段切换: hp ≤ 45% → 原地旋转蓄力(engine 可观察 phase 变化触发音效)
  if (ph === 0 && e.hp <= e.maxHp * 0.45) {
    e.phase = 1;
    e.mode = 'spin';
    e.aiT = 1;
    e.dashLeft = 0;
  }
  // 天亮 → 逃走(不再造成伤害, 引擎负责出屏后移除)
  if (!isNight) e.mode = 'flee';

  // 朝玩家当前位置(身体中心)设冲刺速度
  const aim = (speed: number) => {
    const cy = e.y - e.h / 2;
    const ddx = px - e.x, ddy = (py - 20) - cy;
    const d = Math.hypot(ddx, ddy) || 1;
    e.vx = (ddx / d) * speed;
    e.vy = (ddy / d) * speed;
  };

  if (e.mode === 'flee') {
    e.vy = -4;
    e.vx *= 0.98;
  } else if (e.mode === 'hover') {
    // 悬停在玩家上方 130px, 转向加速 0.08 限速 2.3(速度平滑)
    const cy = e.y - e.h / 2;
    const tdx = px - e.x, tdy = (py - 130) - cy;
    const d = Math.hypot(tdx, tdy) || 1;
    e.vx += (tdx / d) * 0.08;
    e.vy += (tdy / d) * 0.08;
    const sp = Math.hypot(e.vx, e.vy);
    if (sp > 2.3) { e.vx = e.vx / sp * 2.3; e.vy = e.vy / sp * 2.3; }
    if ((e.aiT ?? 0) >= (ph === 0 ? 150 : 70)) {
      if (ph === 0) { e.mode = 'telegraph'; e.aiT = 0; }
      else { e.mode = 'dash'; e.dashLeft = 4; e.aiT = 0; aim(8.0); }
    }
  } else if (e.mode === 'telegraph') {
    // 原地震颤 30 帧
    e.vx = e.vx * 0.8 + Math.sin(e.anim * 0.9) * 0.4;
    e.vy = e.vy * 0.8 + Math.cos(e.anim * 1.13) * 0.35;
    if ((e.aiT ?? 0) >= 30) { e.mode = 'dash'; e.dashLeft = 3; e.aiT = 0; aim(6.5); }
  } else if (e.mode === 'dash') {
    // 冲刺: 每次维持 dur 帧后重瞄下一次
    if ((e.aiT ?? 0) >= (ph === 0 ? 42 : 36)) {
      e.dashLeft = (e.dashLeft ?? 1) - 1;
      if (e.dashLeft <= 0) { e.mode = 'hover'; e.aiT = 0; }
      else { e.aiT = 0; aim(ph === 0 ? 6.5 : 8.0); }
    }
  } else if (e.mode === 'spin') {
    // 原地旋转蓄力 60 帧, 位置缓停
    e.vx = e.vx * 0.85 + Math.sin(e.anim * 0.55) * 0.25;
    e.vy = e.vy * 0.85 + Math.cos(e.anim * 0.67) * 0.2;
    if ((e.aiT ?? 0) >= 60) { e.mode = 'hover'; e.aiT = 0; }
  }

  e.dir = dx > 0 ? 1 : -1;
  // 不受重力; 撞墙轻反弹(速度×-0.5, 用碰撞前速度)
  const pvx = e.vx, pvy = e.vy;
  const r = moveBody(world, e, { platforms: false, dropThrough: false, stepUp: false });
  if (r.blockedX) e.vx = -pvx * 0.5;
  if (r.landed) e.vy = -pvy * 0.5;
  if (r.headBump) e.vy = -pvy * 0.5;
}

function isNightOnlyIssue(_e: Enemy): boolean { return false; }

// ==================== 掉落物 ====================
export interface Drop {
  id: number; count: number;
  x: number; y: number; vx: number; vy: number;
  bob: number; age: number;
}

export function mkDrop(id: number, count: number, x: number, y: number): Drop {
  return {
    id, count, x, y,
    vx: (Math.random() - 0.5) * 1.6,
    vy: -1.5 - Math.random(),
    bob: Math.random() * Math.PI * 2, age: 0,
  };
}

export function updateDrop(world: World, d: Drop): void {
  d.age++;
  const b: Body = { x: d.x, y: d.y, vx: d.vx, vy: d.vy, w: 8, h: 8, onGround: false };
  if (tileAt(world, d.x, d.y - 4) === T.WATER) {
    b.vy = Math.min(0.8, b.vy + 0.06);
  } else {
    b.vy = Math.min(9, b.vy + 0.25);
  }
  moveBody(world, b, { platforms: true, dropThrough: false, stepUp: false });
  if (b.onGround) b.vx *= 0.8;
  d.x = b.x; d.y = b.y; d.vx = b.vx; d.vy = b.vy;
  d.bob += 0.06;
}

// ==================== 粒子 / 伤害数字 ====================
export interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number; grav: number;
}

export interface DmgNum {
  x: number; y: number; vy: number;
  text: string; color: string; life: number; crit: boolean;
}

export function burst(parts: Particle[], x: number, y: number, color: string, n: number, spd = 2.2, grav = 0.18): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = spd * (0.4 + Math.random() * 0.8);
    parts.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1,
      life: 22 + Math.random() * 18, maxLife: 40,
      color, size: 2 + ((Math.random() * 2) | 0), grav,
    });
  }
}

// ==================== 向导 NPC ====================
export interface Guide extends Body {
  dir: 1 | -1;
  walkT: number;        // 走路动画相位
  anim: number;         // 通用动画计时
  homeX: number;        // 徘徊中心(世界px)
  decideT: number;      // 决策计时
  moving: boolean;      // 当前决策是否在走
  talkT: number;        // >0 = 正在说话(头顶气泡时长, 引擎/渲染用)
}

export function mkGuide(x: number, y: number): Guide {
  return {
    x, y, vx: 0, vy: 0, w: 12, h: 36, onGround: false,
    dir: 1, walkT: 0, anim: 0,
    homeX: x,
    decideT: 60 + Math.random() * 120,
    moving: false, talkT: 0,
  };
}

export function updateGuide(world: World, g: Guide, px: number, frame: number): void {
  g.anim++;
  if (g.talkT > 0) g.talkT--;

  // 决策: 每 90-240 帧(40% 停、60% 随机方向走; 离家太远必朝家走)
  g.decideT--;
  if (g.decideT <= 0) {
    g.decideT = 90 + Math.random() * 150;
    const off = g.x - g.homeX;
    if (Math.abs(off) > 260) {
      g.moving = true;
      g.dir = off > 0 ? -1 : 1;
    } else if (Math.random() < 0.4) {
      g.moving = false;
    } else {
      g.moving = true;
      g.dir = Math.random() < 0.5 ? 1 : -1;
    }
  }

  // 玩家在 60px 内 → 停下面向玩家(玩家离开后恢复原决策)
  let wantMove = g.moving;
  if (Math.abs(px - g.x) < 60) {
    wantMove = false;
    g.dir = px > g.x ? 1 : -1;
  }

  // 徘徊硬边界: 走出 homeX ±260 且还在朝外走 → 掉头
  const off = g.x - g.homeX;
  if (g.moving && Math.abs(off) > 260 && Math.sign(g.vx !== 0 ? g.vx : g.dir) === Math.sign(off)) {
    g.dir = off > 0 ? -1 : 1;
  }

  // 悬崖检测: 前方 2 格那一列、脚下 4 格均无实心 → 掉头
  if (g.onGround && wantMove) {
    const fx = Math.floor((g.x + g.dir * 32) / 16);
    const fy = Math.floor((g.y + 1) / 16);
    let ground = false;
    for (let i = 0; i < 4; i++) {
      if (world.isSolid(fx, fy + i)) { ground = true; break; }
    }
    if (!ground) g.dir = (g.dir * -1) as 1 | -1;
  }

  // 水平移动(速度 0.9)
  if (wantMove) {
    g.vx += (g.dir * 0.9 - g.vx) * 0.2;
  } else {
    g.vx *= g.onGround ? 0.7 : 0.96;
    if (Math.abs(g.vx) < 0.04) g.vx = 0;
  }

  // 重力(水中减衰)
  const inWater = bodyInWater(world, g);
  g.vy = Math.min(10, g.vy + (inWater ? 0.15 : 0.34));

  const r = moveBody(world, g, { platforms: false, dropThrough: false, stepUp: true });
  if (r.blockedX && g.onGround) g.vy = -6.8; // 撞墙跳
  if (r.headBump) g.vy = 0.5;

  // 走路动画相位
  if (g.onGround && Math.abs(g.vx) > 0.3) g.walkT += 0.16 + Math.abs(g.vx) * 0.06;
  else if (g.onGround) g.walkT = 0;

  void frame;
}

// ==================== 投射物 ====================
export interface Proj {
  kind: 'arrow' | 'bomb';
  x: number; y: number;    // 中心
  vx: number; vy: number;
  t: number;               // 已存活帧(arrow 插墙时重置计 60 帧消失)
  rot: number;             // arrow 朝向角
  stuck: boolean;          // arrow 插墙
}

/** 箭: 初速 11 朝目标方向 */
export function mkArrow(x: number, y: number, tx: number, ty: number): Proj {
  const dx = tx - x, dy = ty - y;
  const d = Math.hypot(dx, dy) || 1;
  const vx = (dx / d) * 11, vy = (dy / d) * 11;
  return { kind: 'arrow', x, y, vx, vy, t: 0, rot: Math.atan2(vy, vx), stuck: false };
}

/** 炸弹: 抛物线初速, vx=clamp(dx/28,±4.5), vy=-(3.2+dist/55) 下限 -7 */
export function mkBomb(x: number, y: number, tx: number, ty: number): Proj {
  const dx = tx - x, dy = ty - y;
  const dist = Math.hypot(dx, dy);
  return {
    kind: 'bomb', x, y,
    vx: Math.max(-4.5, Math.min(4.5, dx / 28)),
    vy: Math.max(-7, -(3.2 + dist / 55)),
    t: 0, rot: 0, stuck: false,
  };
}

/** 像素坐标处是否实心 */
function solidPx(world: World, px: number, py: number): boolean {
  return world.isSolid(Math.floor(px / 16), Math.floor(py / 16));
}

/**
 * 每帧推进投射物。
 * 返回: 'fly' 继续 | 'stuck' 箭插着等消失 | 'explode' 引擎执行爆炸 | 'gone' 移除
 */
export function updateProj(world: World, p: Proj): 'fly' | 'stuck' | 'explode' | 'gone' {
  p.t++;

  if (p.kind === 'arrow') {
    if (p.stuck) {
      return p.t > 60 ? 'gone' : 'stuck';
    }
    if (p.t > 300) return 'gone';

    const inWater = tileAt(world, p.x, p.y) === T.WATER;
    if (inWater) {
      // 水中减速下沉
      p.vx *= 0.96;
      p.vy = Math.min(p.vy + 0.06, 0.8);
    } else {
      p.vy += 0.16;
    }
    p.rot = Math.atan2(p.vy, p.vx);

    // 下一位置(半步+整步)所在格 solid → 插墙
    const nx = p.x + p.vx, ny = p.y + p.vy;
    if (solidPx(world, nx, ny) || solidPx(world, (p.x + nx) / 2, (p.y + ny) / 2)) {
      p.stuck = true;
      p.vx = 0; p.vy = 0;
      p.t = 0; // 插墙后另计 60 帧消失
      return 'stuck';
    }
    p.x = nx; p.y = ny;
    return 'fly';
  }

  // ---- 炸弹 ----
  if (p.t >= 150) return 'explode';
  const here = tileAt(world, p.x, p.y);
  if (here === T.LAVA) return 'explode';  // 岩浆里立即爆炸
  if (here === T.WATER) return 'gone';    // 入水熄灭

  const b: Body = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, w: 6, h: 6, onGround: false };
  b.vy = Math.min(9, b.vy + 0.22); // 重力
  const pvx = b.vx, pvy = b.vy;    // 碰撞前速度(反弹用)
  const r = moveBody(world, b, { platforms: false, dropThrough: false, stepUp: false });
  if (r.landed) { b.vy = -pvy * 0.42; b.vx = pvx * 0.72; }  // 落地反弹
  if (r.blockedX) b.vx = -pvx * 0.6;                        // 水平撞墙
  if (r.headBump) b.vy = -pvy * 0.42;
  p.x = b.x; p.y = b.y; p.vx = b.vx; p.vy = b.vy;

  const now = tileAt(world, p.x, p.y);
  if (now === T.LAVA) return 'explode';
  if (now === T.WATER) return 'gone';
  return 'fly';
}

export { IT };
