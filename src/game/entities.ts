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
        // 抬高一格后能否通过
        let ok = true;
        for (let ty = ty0 - 1; ty <= ty1 - 1; ty++) {
          if (world.isSolid(tx, ty)) { ok = false; break; }
        }
        if (ok && !world.isSolid(tx, ty0 - 2)) {
          b.y -= 16; b.x = nx; stepped = true;
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

  // 水平移动
  const inWaterSlow = p.inWater ? 0.62 : 1;
  const maxV = c.runSpeed * inWaterSlow;
  const acc = (p.onGround ? c.accel : c.airAccel) * (p.inWater ? 0.7 : 1);
  if (input.left && !input.right) {
    p.vx = Math.max(-maxV, p.vx - acc);
    p.dir = -1;
  } else if (input.right && !input.left) {
    p.vx = Math.min(maxV, p.vx + acc);
    p.dir = 1;
  } else {
    const f = p.onGround ? c.fric : c.airFric;
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
export type EnemyKind = 'gslime' | 'bslime' | 'zombie' | 'eye';
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
}

export function spawnEnemy(kind: EnemyKind, x: number, y: number): Enemy {
  const c = ENEMY_DEFS[kind];
  return {
    id: enemySeq++, kind,
    x, y: y - 1, vx: 0, vy: 0, w: c.w, h: c.h, onGround: false,
    hp: c.hp, maxHp: c.hp, dmg: c.dmg, kb: c.kb,
    dir: Math.random() < 0.5 ? 1 : -1,
    anim: Math.random() * 100, flash: 0,
    hopTimer: 30 + Math.random() * 50, hpShow: 0,
    fly: c.fly, night: c.night, dead: false,
  };
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
    if (r.blockedX) e.vx = -e.vx * 0.6;
    if (r.landed) e.vy = -Math.abs(e.vy) * 0.6 - 0.5;
    if (r.headBump) e.vy = Math.abs(e.vy) * 0.6 + 0.5;
  }
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

export { IT };
