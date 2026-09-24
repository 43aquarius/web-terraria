/**
 * 游戏主引擎：主循环 / 输入 / 挖掘放置战斗 / 敌怪生成 / 背包合成 / 存档 / 小地图
 * 渲染拆分到 render.ts
 */

import {
  T, TileDefs, ItemDefs, RECIPES, IT, FURNITURE_SHAPE,
  PLAYER_CONF, ENEMY_DEFS,
  REACH, CYCLE, DAY_END, SAVE_KEY, MAX_HP,
} from './constants';
import { World } from './world';
import { getTextures, type GameTextures } from './textures';
import { makeRegion, computeLight, type LightRegion, type ExtraLight } from './lighting';
import type { SkyState } from './sky';
import {
  mkPlayer, updatePlayer, spawnEnemy, updateEnemy,
  mkDrop, updateDrop, burst,
  type Player, type Enemy, type EnemyKind, type Drop, type Particle, type DmgNum, type Body,
} from './entities';
import { SFX } from './sound';
import { ui, type Slot } from './store';
import { renderGame } from './render';

export type Screen = 'title' | 'playing' | 'dead';

/** React UI 可调用的引擎 API(单例) */
export interface EngineAPI {
  enterWorld(): void;
  continueGame(): void;
  regenerate(): void;
  quitToTitle(): void;
  saveGame(): boolean;
  toggleInventory(): void;
  togglePause(): void;
  setPaused(v: boolean): void;
  selectHotbar(i: number): void;
  toggleMute(): void;
  craft(index: number): void;
  clickSlot(i: number, right: boolean): void;
}

const ZOOM = 2;
const FIXED = 1000 / 60;
const TITLE_DAY_T = 0.545;         // 标题屏定格黄昏
const MAX_ENEMIES_DAY = 4;
const MAX_ENEMIES_NIGHT = 8;
const AUTOSAVE_FRAMES = 60 * 30;

function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }

/** 天空光强随 dayT 变化(0-1) */
function skyLightAt(dayT: number): number {
  if (dayT < 0.03) return 0.55 + (dayT / 0.03) * 0.45;
  if (dayT < 0.5) return 1;
  if (dayT < DAY_END) return 1 - ((dayT - 0.5) / (DAY_END - 0.5)) * 0.72;
  if (dayT < 0.9) return 0.28;
  return 0.28 + ((dayT - 0.9) / 0.1) * 0.27;
}

interface PickupAgg { id: number; count: number; until: number; msgId: number }

/** 环境生物粒子(渲染由 render.ts 读取 engine.ambient 完成): kind 0=蝴蝶(白天) 1=萤火虫(夜晚) */
export interface AmbientBug {
  x: number; y: number;       // 世界坐标(中心)
  vx: number; vy: number;     // 速度(px/帧),蝴蝶 vx 正负即朝向
  kind: 0 | 1;                // 0=蝴蝶(白天) 1=萤火虫(夜晚)
  t: number;                  // 已存活帧数(>2000 移除)
  phase: number;              // 动画相位:蝴蝶=扇翅(每帧+0.32) 萤火虫=亮度闪烁(每帧+0.06,建议 sin(phase))
}

export class GameEngine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dpr = 1;
  vw = 0;
  vh = 0;
  zoom = ZOOM;
  world!: World;
  tex!: GameTextures;
  player!: Player;
  enemies: Enemy[] = [];
  drops: Drop[] = [];
  parts: Particle[] = [];
  dmgs: DmgNum[] = [];
  ambient: AmbientBug[] = [];  // 环境生物(蝴蝶/萤火虫),render.ts 渲染
  camX = 0;
  camY = 0;
  timeSec = 0;
  frame = 0;
  screen: Screen = 'title';
  paused = false;
  invOpen = false;
  mineDamage = new Map<number, number>();
  mouse = { x: 0, y: 0, left: false, right: false };
  sky: SkyState = { dayT: TITLE_DAY_T, skyLight: 1, camX: 0, camY: 0, depthPx: 0, timeSec: 0 };
  redFlash = 0;
  shake = 0;                // 屏幕震动强度(世界像素,渲染 zoom=2)
  shakeX = 0; shakeY = 0;   // 本帧随机震动偏移(render 侧 translate 用)
  titleT = 0;
  mmCanvas: HTMLCanvasElement | null = null;

  private lightReg: LightRegion = makeRegion();
  private keys = new Set<string>();
  private mineTarget: number | null = null;
  private placeCooldown = 0;
  private useCooldown = 0;
  private spawnTimer = 120;
  private autosaveTimer = AUTOSAVE_FRAMES;
  private stationCache: Record<string, boolean> = { workbench: false, furnace: false, anvil: false };
  private stationFrame = -999;
  private pickupAgg = new Map<number, PickupAgg>();
  private msgSeq = 1;
  private uiDirty = true;
  private lastUiHp = -1;
  private raf = 0;
  private lastTs = 0;
  private acc = 0;
  private mounted = false;
  private ro: ResizeObserver | null = null;
  private noPickup = new Map<number, number>(); // drop 引用暂用 index 标记
  private mmImg: ImageData | null = null;
  private mmColors: [number, number, number, number][] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  // ==================== 生命周期 ====================
  mount(): void {
    if (this.mounted) return;
    setEngine(this);
    (window as unknown as Record<string, unknown>).__game = this; // 调试后门
    this.mounted = true;
    this.tex = getTextures();
    this.buildMinimapColors();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas.parentElement ?? this.canvas);
    this.resize();

    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mouseleave', this.onMouseUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onCtxMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('beforeunload', this.onUnload);

    // 生成世界 -> 标题屏
    ui.set({ loading: true, loadingText: '正在生成世界…' });
    setTimeout(() => {
      this.initWorld(Math.floor(Math.random() * 1e9));
      ui.set({ loading: false, hasSave: !!localStorage.getItem(SAVE_KEY) });
    }, 50);

    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  unmount(): void {
    this.mounted = false;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mouseleave', this.onMouseUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onCtxMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('beforeunload', this.onUnload);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.vw = Math.max(320, Math.round(rect.width));
    this.vh = Math.max(240, Math.round(rect.height));
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);
    this.ctx.imageSmoothingEnabled = false;
  }

  // ==================== 世界 ====================
  initWorld(seed: number): void {
    this.world = new World(seed);
    this.world.onTileChanged = (x, y) => this.onTileChanged(x, y);
    this.player = mkPlayer(this.world.spawnX, this.world.spawnY);
    this.enemies = [];
    this.drops = [];
    this.parts = [];
    this.dmgs = [];
    this.ambient = [];
    this.mineDamage.clear();
    this.mineTarget = null;
    this.timeSec = 0;
    this.titleT = 0;
    this.buildMinimap();
    this.camX = this.world.spawnX - this.viewW() / 2;
    this.camY = this.surfaceYpx() - this.viewH() * 0.72;
    this.clampCam();
    this.uiDirty = true;
    this.syncUI(true);
  }

  viewW(): number { return this.vw / this.zoom; }
  viewH(): number { return this.vh / this.zoom; }

  isNight(): boolean { return this.dayT() >= DAY_END; }
  dayT(): number {
    if (this.screen === 'title') return TITLE_DAY_T;
    return (this.timeSec % CYCLE) / CYCLE;
  }
  skyLightNow(): number { return skyLightAt(this.dayT()); }
  surfaceYpx(): number {
    const gx = clamp(Math.floor((this.camX + this.viewW() / 2) / 16), 0, this.world.w - 1);
    return this.world.surface[gx] * 16;
  }
  getMouseWorld(): { x: number; y: number } {
    return { x: this.mouse.x / this.zoom + this.camX, y: this.mouse.y / this.zoom + this.camY };
  }
  heldItem(): Slot | null { return this.player?.inv[this.player.hotbar] ?? null; }
  get lightCanvas(): HTMLCanvasElement { return this.lightReg.canvas; }

  // ==================== 输入 ====================
  private onCtxMenu = (e: Event): void => { e.preventDefault(); };
  private onBlur = (): void => { this.keys.clear(); this.mouse.left = false; this.mouse.right = false; };
  private onUnload = (): void => { if (this.screen !== 'title') this.save(); };

  private onMouseDown = (e: MouseEvent): void => {
    SFX.init();
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left;
    this.mouse.y = e.clientY - r.top;
    if (e.button === 0) this.mouse.left = true;
    if (e.button === 2) this.mouse.right = true;
    if (this.invOpen && this.screen === 'playing') {
      // 背包打开时点击画布区域不触发使用
    }
  };
  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouse.left = false;
    if (e.button === 2) this.mouse.right = false;
    if (e.type === 'mouseleave') { this.mouse.left = false; this.mouse.right = false; }
  };
  private onMouseMove = (e: MouseEvent): void => {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left;
    this.mouse.y = e.clientY - r.top;
  };
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.screen !== 'playing' || this.paused) return;
    const d = e.deltaY > 0 ? 1 : -1;
    this.selectHotbar((this.player.hotbar + d + 10) % 10);
  };
  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    this.keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
    SFX.init();
  };
  private onKeyUp = (e: KeyboardEvent): void => { this.keys.delete(e.code); };

  private moveInput() {
    const canMove = this.screen === 'playing' && !this.paused;
    return {
      left: canMove && (this.keys.has('KeyA') || this.keys.has('ArrowLeft')),
      right: canMove && (this.keys.has('KeyD') || this.keys.has('ArrowRight')),
      jump: canMove && (this.keys.has('Space') || this.keys.has('KeyW') || this.keys.has('ArrowUp')),
      down: canMove && (this.keys.has('KeyS') || this.keys.has('ArrowDown')),
    };
  }

  // ==================== API ====================
  enterWorld(): void {
    SFX.init();
    this.screen = 'playing';
    this.timeSec = CYCLE * 0.06;      // 清晨
    this.enemies = [];
    this.drops = [];
    // 初始装备：铜镐 / 铜斧 / 铜短剑(泰拉瑞亚新角色标配)
    if (!this.player.inv.some((s) => s)) {
      this.player.inv[0] = { id: IT.COPPER_PICK, count: 1 };
      this.player.inv[1] = { id: IT.COPPER_AXE, count: 1 };
      this.player.inv[2] = { id: IT.COPPER_SWORD, count: 1 };
    }
    this.msg('欢迎来到泰拉瑞亚！砍树挖矿，打造装备吧。', '#f7d060');
    this.uiDirty = true;
    this.syncUI(true);
  }

  regenerate(): void {
    ui.set({ loading: true, loadingText: '正在生成新世界…' });
    setTimeout(() => {
      this.screen = 'title';
      this.initWorld(Math.floor(Math.random() * 1e9));
      ui.set({ loading: false });
    }, 50);
  }

  continueGame(): void {
    SFX.init();
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) { this.msg('没有找到存档', '#e07070'); return; }
      const o = JSON.parse(raw) as {
        world: string; p: { x: number; y: number; hp: number; inv: (Slot | null)[]; hotbar: number }; t: number;
      };
      this.world = World.decode(o.world);
      this.world.onTileChanged = (x, y) => this.onTileChanged(x, y);
      this.player = mkPlayer(o.p.x, o.p.y);
      this.player.hp = o.p.hp;
      this.player.inv = o.p.inv;
      this.player.hotbar = o.p.hotbar;
      this.timeSec = o.t;
      this.enemies = [];
      this.drops = [];
      this.parts = [];
      this.dmgs = [];
      this.ambient = [];
      this.mineDamage.clear();
      this.screen = 'playing';
      this.buildMinimap();
      this.camX = this.player.x - this.viewW() / 2;
      this.camY = this.player.y - this.viewH() * 0.6;
      this.clampCam();
      this.msg('欢迎回来！', '#8ee88e');
      this.uiDirty = true;
      this.syncUI(true);
    } catch {
      this.msg('存档读取失败', '#e07070');
    }
  }

  quitToTitle(): void {
    this.save();
    this.screen = 'title';
    this.ambient = [];
    this.titleT = 0;
    this.paused = false;
    this.invOpen = false;
    this.uiDirty = true;
    this.syncUI(true);
  }

  saveGame(): boolean { return inst?.save() ?? false; }

  save(): boolean {
    if (!this.world || this.screen === 'title') return false;
    try {
      const data = JSON.stringify({
        v: 1,
        world: this.world.encode(),
        p: {
          x: this.player.x, y: this.player.y, hp: this.player.hp,
          inv: this.player.inv, hotbar: this.player.hotbar,
        },
        t: this.timeSec,
      });
      localStorage.setItem(SAVE_KEY, data);
      ui.set({ hasSave: true });
      return true;
    } catch {
      return false;
    }
  }

  toggleInventory(): void {
    if (this.screen !== 'playing') return;
    this.invOpen = !this.invOpen;
    if (!this.invOpen && this.player.cursorItem) {
      const rest = this.addItem(this.player.cursorItem.id, this.player.cursorItem.count);
      if (rest > 0) {
        const d = mkDrop(this.player.cursorItem.id, rest, this.player.x, this.player.y - 20);
        this.drops.push(d);
      }
      this.player.cursorItem = null;
    }
    this.uiDirty = true;
  }

  togglePause(): void {
    if (this.screen !== 'playing') return;
    this.paused = !this.paused;
    this.mouse.left = false;
    this.uiDirty = true;
  }

  setPaused(v: boolean): void {
    if (this.screen !== 'playing') return;
    this.paused = v;
    if (v) this.mouse.left = false;
    this.uiDirty = true;
  }

  selectHotbar(i: number): void {
    if (i < 0 || i > 9) return;
    this.player.hotbar = i;
    this.uiDirty = true;
  }

  toggleMute(): void {
    SFX.init();
    const m = SFX.toggleMute();
    ui.set({ muted: m });
  }

  craft(index: number): void {
    if (this.screen !== 'playing') return;
    const r = RECIPES[index];
    if (!r || !this.canCraft(index)) return;
    // 扣材料
    for (const need of r.ins) this.removeItems(need.id, need.n);
    const rest = this.addItem(r.out, r.count);
    if (rest > 0) this.drops.push(mkDrop(r.out, rest, this.player.x, this.player.y - 20));
    SFX.craft();
    const def = ItemDefs[r.out];
    this.msg(`合成了 ${def.name}${r.count > 1 ? ` ×${r.count}` : ''}`, '#8ee88e');
    this.uiDirty = true;
  }

  clickSlot(i: number, right: boolean): void {
    if (this.screen !== 'playing') return;
    const p = this.player;
    const slot = p.inv[i];
    const cur = p.cursorItem;
    if (!right) {
      if (!cur) {
        if (slot) { p.cursorItem = slot; p.inv[i] = null; }
      } else if (!slot) {
        p.inv[i] = cur; p.cursorItem = null;
      } else if (slot.id === cur.id && ItemDefs[slot.id]) {
        const max = ItemDefs[slot.id].maxStack;
        const move = Math.min(max - slot.count, cur.count);
        slot.count += move; cur.count -= move;
        if (cur.count <= 0) p.cursorItem = null;
      } else {
        p.inv[i] = cur; p.cursorItem = slot;
      }
    } else {
      if (!cur) {
        if (slot) {
          const half = Math.ceil(slot.count / 2);
          p.cursorItem = { id: slot.id, count: half };
          slot.count -= half;
          if (slot.count <= 0) p.inv[i] = null;
        }
      } else if (!slot) {
        p.inv[i] = { id: cur.id, count: 1 };
        cur.count--;
        if (cur.count <= 0) p.cursorItem = null;
      } else if (slot.id === cur.id && slot.count < ItemDefs[slot.id].maxStack) {
        slot.count++; cur.count--;
        if (cur.count <= 0) p.cursorItem = null;
      }
    }
    SFX.click();
    this.uiDirty = true;
  }

  // ==================== 背包 ====================
  addItem(id: number, n: number): number {
    const p = this.player;
    const max = ItemDefs[id]?.maxStack ?? 999;
    for (let i = 0; i < p.inv.length && n > 0; i++) {
      const s = p.inv[i];
      if (s && s.id === id && s.count < max) {
        const add = Math.min(max - s.count, n);
        s.count += add; n -= add;
      }
    }
    for (let i = 0; i < p.inv.length && n > 0; i++) {
      if (!p.inv[i]) {
        const add = Math.min(max, n);
        p.inv[i] = { id, count: add }; n -= add;
      }
    }
    this.uiDirty = true;
    return n;
  }

  removeItems(id: number, n: number): void {
    const p = this.player;
    for (let i = p.inv.length - 1; i >= 0 && n > 0; i--) {
      const s = p.inv[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, n);
        s.count -= take; n -= take;
        if (s.count <= 0) p.inv[i] = null;
      }
    }
    this.uiDirty = true;
  }

  countItem(id: number): number {
    let n = 0;
    for (const s of this.player.inv) if (s && s.id === id) n += s.count;
    return n;
  }

  canCraft(index: number): boolean {
    const r = RECIPES[index];
    if (!r) return false;
    if (r.station && !this.stations()[r.station]) return false;
    for (const need of r.ins) if (this.countItem(need.id) < need.n) return false;
    return true;
  }

  stations(): Record<string, boolean> {
    if (this.frame - this.stationFrame < 30) return this.stationCache;
    this.stationFrame = this.frame;
    const p = this.player;
    const gx = Math.floor(p.x / 16), gy = Math.floor(p.y / 16);
    const st = { workbench: false, furnace: false, anvil: false };
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const s = TileDefs[this.world.get(gx + dx, gy + dy)].station;
        if (s) st[s] = true;
      }
    }
    this.stationCache = st;
    return st;
  }

  // ==================== 消息 ====================
  msg(text: string, color = '#e8e4d8'): void {
    const ms = ui.getSnapshot().messages;
    const next = [...ms, { id: this.msgSeq++, text, color, born: Date.now() }];
    ui.set({ messages: next.slice(-8) });
  }

  // ==================== 主循环 ====================
  private loop = (ts: number): void => {
    if (!this.mounted) return;
    this.raf = requestAnimationFrame(this.loop);
    this.acc += Math.min(ts - this.lastTs, 120);
    this.lastTs = ts;
    let steps = 0;
    while (this.acc >= FIXED && steps < 3) {
      this.tick();
      this.acc -= FIXED;
      steps++;
    }
    if (steps === 3) this.acc = 0;
    renderGame(this);
  };

  private tick(): void {
    this.frame++;
    if (this.redFlash > 0) this.redFlash = Math.max(0, this.redFlash - 0.04);
    // 屏幕震动:指数衰减 + 每帧刷新随机偏移(shake 归零时偏移同步归零)
    if (this.shake > 0) {
      this.shake *= 0.88;
      if (this.shake < 0.15) this.shake = 0;
      this.shakeX = (Math.random() * 2 - 1) * this.shake;
      this.shakeY = (Math.random() * 2 - 1) * this.shake;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }

    if (!this.world) return;

    if (this.screen === 'title') {
      this.titleT++;
      this.tickTitleCam();
      this.world.tickWater(80);
      this.tickParticles();
      return;
    }

    if (this.player.dead) {
      this.tickDead();
      return;
    }

    if (!this.paused) this.tickGame();
    this.syncUI(false);
  }

  private tickTitleCam(): void {
    const t = this.titleT / 60;
    const span = 260;
    this.camX = this.world.spawnX - this.viewW() / 2 + Math.sin(t * 0.14) * span;
    this.camY = this.surfaceYpx() - this.viewH() * 0.72 + Math.sin(t * 0.09) * 40;
    this.clampCam();
  }

  private clampCam(): void {
    const maxX = this.world.w * 16 - this.viewW();
    const maxY = this.world.h * 16 - this.viewH();
    this.camX = maxX > 0 ? clamp(this.camX, 0, maxX) : (this.world.w * 16 - this.viewW()) / 2;
    this.camY = maxY > 0 ? clamp(this.camY, 0, maxY) : 0;
  }

  private tickDead(): void {
    const p = this.player;
    p.deadTimer--;
    this.tickParticles();
    this.dmgs = this.dmgs.filter((d) => --d.life > 0);
    for (const e of this.enemies) updateEnemy(this.world, e, p.x, p.y, this.isNight(), this.frame);
    this.enemies = this.enemies.filter((e) => !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 70 * 16);
    if (p.deadTimer <= 0) {
      p.dead = false;
      p.hp = MAX_HP;
      p.breath = PLAYER_CONF.breathMax;
      p.x = this.world.spawnX;
      p.y = this.world.spawnY;
      p.vx = 0; p.vy = 0;
      p.iframes = 0;
      p.spawnProt = 600;
      // 清除出生点附近的敌怪,防止"重生即被围杀"的死循环
      this.enemies = this.enemies.filter(
        (e) => Math.hypot(e.x - p.x, e.y - p.y) > 20 * 16,
      );
      this.screen = 'playing';
      this.uiDirty = true;
    }
    this.followCam();
  }

  private tickGame(): void {
    const p = this.player;
    this.timeSec += 1 / 60;
    if (this.useCooldown > 0) this.useCooldown--;
    if (this.placeCooldown > 0) this.placeCooldown--;
    if (p.swing) { p.swing.t++; if (p.swing.t >= p.swing.dur) p.swing = null; }

    // ---- 玩家 ----
    const prevVy = p.vy; // 落地冲击速度 ≈ prevVy + 重力(重力在 updatePlayer 内施加)
    const ev = updatePlayer(this.world, p, this.moveInput(), this.frame);
    if (ev.jumped) SFX.jump();
    if (ev.landed) {
      // 落地尘土:速度越快越多;小跳(vy<1.5)不喷;水中落地不喷(另有水花)
      const landVy = prevVy + PLAYER_CONF.gravity;
      if (landVy >= 1.5 && !p.inWater) {
        const n = Math.min(10, 2 + Math.floor(landVy / 1.2));
        burst(this.parts, p.x - 3, p.y, '#b99b76', Math.ceil(n / 2), 1.8, 0.18);
        burst(this.parts, p.x + 3, p.y, '#b99b76', Math.floor(n / 2), 1.8, 0.18);
      }
    }
    if (ev.splash) { SFX.splash(); burst(this.parts, p.x, p.y - 4, '#6a9ae8', 8, 2.4, 0.14); }
    if (ev.fell > 0) {
      this.hurtPlayer(ev.fell, p.vx > 0 ? -1 : 1, true);
      burst(this.parts, p.x, p.y, '#c8c8d0', 10, 2.6, 0.2);
    }
    if (p.iframes > 0) p.iframes--;
    if (p.spawnProt > 0) p.spawnProt--;

    // 呼吸
    if (p.headWater) {
      p.breath--;
      if (p.breath <= 0) {
        p.breath = 0;
        if (this.frame % 45 === 0) this.hurtPlayer(8, 0, true);
      }
      if (this.frame % 90 === 0) {
        burst(this.parts, p.x, p.y - p.h, '#cfe8ff', 3, 0.8, -0.05);
      }
    } else if (p.breath < PLAYER_CONF.breathMax) {
      p.breath = Math.min(PLAYER_CONF.breathMax, p.breath + 5);
    }

    // 再生
    if (this.frame - p.lastHurt > PLAYER_CONF.regenDelay && p.hp < p.maxHp) {
      p.regenAcc++;
      if (p.regenAcc >= PLAYER_CONF.regenRate) { p.regenAcc = 0; p.hp++; }
    } else if (p.hp >= p.maxHp) {
      p.regenAcc = 0;
    }

    // ---- 使用手中物品 ----
    if (this.mouse.left && !this.invOpen) this.useHeld();

    // ---- 敌怪 ----
    this.tickEnemies();

    // ---- 掉落物 ----
    this.tickDrops();

    // ---- 粒子/伤害数字 ----
    this.tickParticles();

    // ---- 环境生物(蝴蝶/萤火虫) ----
    this.tickAmbient();

    // ---- 世界 ----
    this.world.tickWater(420);
    this.world.tickGrass(26);

    // ---- 生成 ----
    this.tickSpawn();

    // ---- 相机 ----
    this.followCam();

    // ---- 自动存档 ----
    this.autosaveTimer--;
    if (this.autosaveTimer <= 0) {
      this.autosaveTimer = AUTOSAVE_FRAMES;
      this.save();
    }
  }

  private followCam(): void {
    const p = this.player;
    const tx = p.x - this.viewW() / 2;
    const ty = p.y - this.viewH() * 0.62;
    this.camX += (tx - this.camX) * 0.14;
    this.camY += (ty - this.camY) * 0.14;
    this.clampCam();
  }

  private tickParticles(): void {
    this.parts = this.parts.filter((pt) => {
      pt.life--;
      pt.x += pt.vx; pt.y += pt.vy;
      pt.vy += pt.grav;
      return pt.life > 0;
    });
    if (this.parts.length > 400) this.parts.splice(0, this.parts.length - 400);
    this.dmgs = this.dmgs.filter((d) => {
      d.life--; d.y += d.vy; d.vy *= 0.92;
      return d.life > 0;
    });
  }

  // ==================== 环境生物(蝴蝶/萤火虫) ====================
  /** 仅 playing 未暂停时由 tickGame 调用;数据公共可读,供 render.ts 渲染 */
  private tickAmbient(): void {
    const night = this.isNight();
    // 生成:每 30 帧掷骰一次,上限 6 只,平均几秒出一只
    if (this.frame % 30 === 0 && this.ambient.length < 6 && Math.random() < 0.16) {
      const x = this.camX + Math.random() * this.viewW();
      const gx = clamp(Math.floor(x / 16), 0, this.world.w - 1);
      const y = this.world.surface[gx] * 16 - 8 - Math.random() * 32; // 地表上方 8~40px
      const gy = clamp(Math.floor(y / 16), 0, this.world.h - 1);
      // 玩家在地下(地表不在视野)或生成点水下 → 跳过
      if (y >= this.camY - 80 && y <= this.camY + this.viewH() + 80
        && this.world.get(gx, gy) !== T.WATER) {
        this.ambient.push({
          x, y,
          vx: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.35),
          vy: 0,
          kind: night ? 1 : 0,
          t: 0,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
    // 更新与移除
    const camL = this.camX - 100, camR = this.camX + this.viewW() + 100;
    const camT = this.camY - 100, camB = this.camY + this.viewH() + 100;
    for (let i = this.ambient.length - 1; i >= 0; i--) {
      const b = this.ambient[i];
      b.t++;
      b.phase += b.kind === 0 ? 0.32 : 0.06; // 蝴蝶扇翅快相位 / 萤火虫慢闪烁
      const gx = clamp(Math.floor(b.x / 16), 0, this.world.w - 1);
      const baseY = this.world.surface[gx] * 16;
      if (b.kind === 0) {
        // 蝴蝶:水平随机游走(±0.85),偶尔改向;沿地表 sin 上下飘 ±3px
        b.vx += (Math.random() - 0.5) * 0.1;
        if (Math.random() < 0.006) b.vx = (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.45);
        b.vx = clamp(b.vx, -0.85, 0.85);
        b.x += b.vx;
        b.vy = (baseY - 24 + Math.sin(b.t * 0.07 + b.phase) * 3 - b.y) * 0.03;
        b.y += b.vy;
      } else {
        // 萤火虫:缓慢漂移,亮度闪烁由渲染侧 sin(phase) 完成
        b.vx += (Math.random() - 0.5) * 0.05;
        b.vy += (Math.random() - 0.5) * 0.05;
        b.vx = clamp(b.vx, -0.3, 0.3);
        b.vy = clamp(b.vy, -0.18, 0.18);
        b.x += b.vx;
        b.y += b.vy + (baseY - 20 - b.y) * 0.004; // 缓慢贴近地表
      }
      // 昼夜切换后旧种类渐次消散(约 1s 内)
      if ((b.kind === 0) === night && Math.random() < 0.02) {
        this.ambient.splice(i, 1);
        continue;
      }
      // 超时(约 33s)或走出相机视野 100px → 移除
      if (b.t > 2000 || b.x < camL || b.x > camR || b.y < camT || b.y > camB) {
        this.ambient.splice(i, 1);
      }
    }
  }

  // ==================== 使用物品 ====================
  private useHeld(): void {
    const p = this.player;
    const held = p.inv[p.hotbar];
    const def = held ? ItemDefs[held.id] : null;
    const mw = this.getMouseWorld();
    const gx = Math.floor(mw.x / 16), gy = Math.floor(mw.y / 16);
    const idx = this.world.idx(clamp(gx, 0, this.world.w - 1), clamp(gy, 0, this.world.h - 1));
    const pcx = p.x, pcy = p.y - p.h / 2;
    const inReach = Math.hypot((gx * 16 + 8) - pcx, (gy * 16 + 8) - pcy) <= REACH;

    if (!def || def.kind === 'tool') {
      // 挖掘(含工具挥砍命中敌人)
      this.doSwing(held?.id ?? 0, def, mw);
      if (inReach) this.mine(gx, gy, idx, def);
      else this.mineTarget = null;
    } else if (def.kind === 'weapon') {
      this.doSwing(held!.id, def, mw);
      this.mineTarget = null;
    } else if ((def.kind === 'block' || def.kind === 'station') && def.tile !== undefined) {
      this.mineTarget = null;
      if (this.placeCooldown <= 0 && inReach) this.place(gx, gy, held!, def.tile);
    } else {
      this.mineTarget = null;
    }
  }

  /** 挥动(工具/武器视觉 + 命中敌人；空手也有基础挥动) */
  private doSwing(itemId: number, def: { useTime?: number; dmg?: number } | null, mw: { x: number; y: number }): void {
    const p = this.player;
    const useTime = def?.useTime ?? 24;
    if (this.useCooldown > 0) return;
    this.useCooldown = useTime;
    p.dir = mw.x >= p.x ? 1 : -1;
    p.swing = { itemId, t: 0, dur: useTime, hits: new Set(), kind: 'arc' };
    SFX.swing();
    // 攻击判定(工具也可命中)
    const dmg = def?.dmg ?? 3;
    const cx = p.x + p.dir * 22;
    const hitW = 30, hitH = 44;
    const pcy = p.y - p.h / 2;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (Math.abs(e.x - cx) < hitW + e.w / 2
        && e.y - e.h < pcy + hitH / 2 && e.y > pcy - hitH / 2) {
        this.hitEnemy(e, dmg, p.dir);
      }
    }
  }

  /** 挖掘 */
  private mine(gx: number, gy: number, idx: number, def: { power?: number; tool?: 'pick' | 'axe' } | null): void {
    const id = this.world.get(gx, gy);
    if (id === T.AIR || gy >= this.world.h - 3) { this.mineTarget = null; return; }
    const td = TileDefs[id];
    if (td.hardness <= 0) {
      // 一击碎(草丛/花/火把等)
      this.breakTile(gx, gy);
      return;
    }
    if (this.mineTarget !== idx) { this.mineTarget = idx; }
    let power = def?.power ?? 3;
    if (def?.tool && td.tool !== 'any' && def.tool !== td.tool) power = Math.max(3, power * 0.25);
    const dmg = (this.mineDamage.get(idx) ?? 0) + power * 0.55;
    if (this.frame % 13 === 0) SFX.dig();
    if (dmg >= td.hardness) {
      this.breakTile(gx, gy);
    } else {
      this.mineDamage.set(idx, dmg);
      if (this.frame % 5 === 0) {
        burst(this.parts, gx * 16 + 8, gy * 16 + 8, td.particleColor, 2, 1.4, 0.2);
      }
    }
  }

  /** 破坏方块 */
  private breakTile(gx: number, gy: number): void {
    const id = this.world.get(gx, gy);
    if (id === T.AIR) return;
    const td = TileDefs[id];
    burst(this.parts, gx * 16 + 8, gy * 16 + 8, td.particleColor, 12, 2.4, 0.2);
    SFX.breakBlock();

    if (id === T.TRUNK) {
      const cells = this.world.fellTree(gx, gy);
      let woods = 0;
      for (const c of cells) {
        if (c.trunk) woods++;
        if (Math.random() < 0.35) burst(this.parts, c.x * 16 + 8, c.y * 16 + 8, '#5cb85c', 2, 1.8, 0.15);
      }
      for (let i = 0; i < woods; i++) {
        this.drops.push(mkDrop(IT.WOOD, 1, gx * 16 + 8 + (Math.random() - 0.5) * 20, gy * 16 + 4));
      }
      this.mineDamage.delete(this.world.idx(gx, gy));
      return;
    }

    if (td.furnitureGroup) {
      const cells = this.world.clearFurniture(gx, gy);
      for (const c of cells) this.mineDamage.delete(this.world.idx(c.x, c.y));
      if (td.drop) this.drops.push(mkDrop(td.drop, 1, gx * 16 + 8, gy * 16 + 8));
      return;
    }

    this.world.set(gx, gy, T.AIR);
    this.mineDamage.delete(this.world.idx(gx, gy));
    if (td.drop) {
      this.drops.push(mkDrop(td.drop, 1, gx * 16 + 8, gy * 16 + 8));
    }
    // 上方装饰物失去支撑则破坏
    const above = this.world.get(gx, gy - 1);
    if (above === T.TGRASS || (above >= T.FLW_R && above <= T.FLW_B)) {
      this.world.set(gx, gy - 1, T.AIR);
      burst(this.parts, gx * 16 + 8, (gy - 1) * 16 + 8, TileDefs[above].particleColor, 5, 1.6, 0.18);
    }
  }

  /** 放置方块 */
  private place(gx: number, gy: number, held: Slot, tileId: number): void {
    const shape = FURNITURE_SHAPE[tileId] ?? [[0, 0]];
    // 越界/占用检查
    for (const [dx, dy] of shape) {
      const x = gx + dx, y = gy + dy;
      if (x < 1 || x >= this.world.w - 1 || y < 1 || y >= this.world.h - 3) return;
      const cur = this.world.get(x, y);
      if (cur !== T.AIR && cur !== T.WATER) return;
    }
    // 支撑检查(邻格非空气/水 或 背后有墙)
    let supported = false;
    for (const [dx, dy] of shape) {
      const x = gx + dx, y = gy + dy;
      if (this.world.getWall(x, y) > 0) { supported = true; break; }
      for (const [nx, ny] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const nid = this.world.get(x + nx, y + ny);
        if (nid !== T.AIR && nid !== T.WATER) { supported = true; break; }
      }
      if (supported) break;
    }
    if (!supported) return;
    // 实心方块不能与玩家/敌怪重叠
    if (TileDefs[tileId].solid) {
      const boxes: Body[] = [this.player, ...this.enemies];
      for (const [dx, dy] of shape) {
        const x = gx + dx, y = gy + dy;
        for (const b of boxes) {
          if (Math.abs(b.x - (x * 16 + 8)) < 8 + b.w / 2
            && b.y > y * 16 + 1 && b.y - b.h < (y + 1) * 16 - 1) return;
        }
      }
    }
    for (const [dx, dy] of shape) {
      this.world.set(gx + dx, gy + dy, this.placeTileId(tileId, dx, dy));
    }
    held.count--;
    if (held.count <= 0) this.player.inv[this.player.hotbar] = null;
    this.placeCooldown = 10;
    SFX.place();
    burst(this.parts, gx * 16 + 8, gy * 16 + 8, TileDefs[tileId].particleColor, 4, 1.2, 0.15);
    this.uiDirty = true;
  }

  /** 多格家具的子格 ID */
  private placeTileId(main: number, dx: number, dy: number): number {
    if (main === T.WORKBENCH_L) return dx === 0 ? T.WORKBENCH_L : T.WORKBENCH_R;
    if (main === T.ANVIL_L) return dx === 0 ? T.ANVIL_L : T.ANVIL_R;
    if (main === T.FURNACE_TL) {
      if (dy === 0) return dx === 0 ? T.FURNACE_TL : T.FURNACE_TR;
      return dx === 0 ? T.FURNACE_BL : T.FURNACE_BR;
    }
    return main;
  }

  // ==================== 敌怪 ====================
  private hitEnemy(e: Enemy, dmg: number, dir: 1 | -1): void {
    const crit = Math.random() < 0.1;
    const final = Math.max(1, Math.round(dmg * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1)));
    e.hp -= final;
    e.flash = 8;
    e.hpShow = 160;
    e.vx += dir * 3.2 * (1 - e.kb * 0.6);
    e.vy = Math.min(e.vy, -2.4);
    this.dmgs.push({
      x: e.x + (Math.random() - 0.5) * 8, y: e.y - e.h - 6,
      vy: -1.1, text: String(final), color: crit ? '#ffd75e' : '#ffffff', life: 46, crit,
    });
    SFX.enemyHit();
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy): void {
    e.dead = true;
    const def = ENEMY_DEFS[e.kind];
    burst(this.parts, e.x, e.y - e.h / 2, def.mapColor, 16, 3, 0.2);
    SFX.enemyDie();
    if (def.gelDrop) {
      const [a, b] = def.gelDrop;
      const n = a + Math.floor(Math.random() * (b - a + 1));
      if (n > 0) this.drops.push(mkDrop(IT.GEL, n, e.x, e.y - 8));
    }
    if (e.kind === 'zombie' && Math.random() < 0.35) {
      this.drops.push(mkDrop(Math.random() < 0.5 ? IT.TORCH : IT.STONE, 1 + (Math.random() * 2 | 0), e.x, e.y - 8));
    }
    if (e.kind === 'eye' && Math.random() < 0.5) {
      this.drops.push(mkDrop(IT.ORE_IRON, 1, e.x, e.y - 8));
    }
  }

  private tickEnemies(): void {
    const p = this.player;
    const night = this.isNight();
    for (const e of this.enemies) {
      updateEnemy(this.world, e, p.x, p.y, night, this.frame);
      // 白天夜怪消散
      if (!night && e.night && Math.random() < 0.012) {
        burst(this.parts, e.x, e.y - e.h / 2, '#6a6a8a', 8, 1.6, -0.02);
        e.dead = true;
        continue;
      }
      // 碰撞玩家
      if (!p.dead && p.iframes <= 0 && p.spawnProt <= 0) {
        if (Math.abs(e.x - p.x) < e.w / 2 + p.w / 2
          && e.y > p.y - p.h - e.h / 2 && e.y - e.h < p.y + e.h / 2) {
          const dmg = Math.max(1, Math.round(e.dmg * (0.9 + Math.random() * 0.2)));
          this.hurtPlayer(dmg, e.x > p.x ? -1 : 1, false);
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 70 * 16);
  }

  private hurtPlayer(dmg: number, dir: number, noKb: boolean): void {
    const p = this.player;
    if (p.dead || p.iframes > 0) return;
    p.hp -= dmg;
    p.lastHurt = this.frame;
    p.iframes = noKb ? 20 : PLAYER_CONF.iframes;
    if (!noKb) {
      p.vx = dir * 3.4;
      p.vy = Math.min(p.vy, -3.2);
    }
    this.redFlash = 1;
    this.shake = Math.min(7, 3 + dmg * 0.15); // 受击屏幕震动:伤害越大越狠,封顶 7 世界像素
    SFX.hurt();
    this.dmgs.push({
      x: p.x, y: p.y - p.h - 8, vy: -1.2,
      text: String(dmg), color: '#ff6060', life: 50, crit: false,
    });
    burst(this.parts, p.x, p.y - p.h / 2, '#c03030', 10, 2.4, 0.2);
    if (p.hp <= 0) this.diePlayer();
  }

  private diePlayer(): void {
    const p = this.player;
    p.hp = 0;
    p.dead = true;
    p.deadTimer = PLAYER_CONF.respawnTime * 60;
    p.cursorItem = null;
    burst(this.parts, p.x, p.y - p.h / 2, '#c03030', 26, 3.4, 0.22);
    burst(this.parts, p.x, p.y - p.h / 2, '#f0c8a0', 14, 2.6, 0.22);
    SFX.death();
    this.shake = 8; // 死亡更震撼
    this.screen = 'dead';
    this.uiDirty = true;
  }

  private tickSpawn(): void {
    this.spawnTimer--;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = 80 + Math.random() * 80;
    const night = this.isNight();
    const max = night ? MAX_ENEMIES_NIGHT : MAX_ENEMIES_DAY;
    if (this.enemies.length >= max) return;
    const p = this.player;
    const side = Math.random() < 0.5 ? -1 : 1;
    const gx = clamp(Math.floor(p.x / 16) + side * (26 + Math.floor(Math.random() * 14)), 2, this.world.w - 3);
    // 不在视野内生成
    const camL = this.camX / 16 - 2, camR = (this.camX + this.viewW()) / 16 + 2;
    if (gx > camL && gx < camR) return;
    let kind: EnemyKind;
    const r = Math.random();
    if (night) kind = r < 0.5 ? 'zombie' : r < 0.75 ? 'eye' : 'bslime';
    else kind = r < 0.8 ? 'gslime' : 'bslime';
    const def = ENEMY_DEFS[kind];
    let x = gx * 16 + 8, y: number;
    if (def.fly) {
      y = p.y - (12 + Math.random() * 10) * 16;
      if (y < 32) return;
    } else {
      const sy = this.world.surface[gx];
      y = (sy - 1) * 16;
      if (this.world.get(gx, sy - 1) !== T.AIR || this.world.get(gx, sy - 2) !== T.AIR) return;
    }
    this.enemies.push(spawnEnemy(kind, x, y));
  }

  // ==================== 掉落物 ====================
  private tickDrops(): void {
    const p = this.player;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      updateDrop(this.world, d);
      const noPick = this.noPickup.get(i) ?? 0;
      if (noPick > 0) { this.noPickup.set(i, noPick - 1); continue; }
      const dist = Math.hypot(p.x - d.x, p.y - p.h / 2 - d.y);
      if (dist < 52 && !p.dead) {
        const s = 0.18 + Math.max(0, (52 - dist) / 52) * 0.2;
        d.x += (p.x - d.x) * s;
        d.y += (p.y - p.h / 2 - d.y) * s;
      }
      if (dist < 14 && !p.dead) {
        const rest = this.addItem(d.id, d.count);
        const got = d.count - rest;
        if (got > 0) {
          SFX.pickup();
          this.aggPickup(d.id, got);
        }
        if (rest <= 0) {
          this.drops.splice(i, 1);
          this.noPickup.delete(i);
        } else {
          d.count = rest;
          this.noPickup.set(i, 60);
        }
      } else if (d.age > 60 * 300) {
        this.drops.splice(i, 1);
      }
    }
  }

  private aggPickup(id: number, n: number): void {
    const now = Date.now();
    const cur = this.pickupAgg.get(id);
    if (cur && now < cur.until) {
      cur.count += n;
      const def = ItemDefs[id];
      // 更新已存在的消息?简单起见:更新末条
      const ms = ui.getSnapshot().messages;
      const last = ms[ms.length - 1];
      if (last && last.id === (this.pickupAgg.get(id)?.msgId ?? -1)) {
        last.text = `拾取 ${def.name} ×${cur.count}`;
        ui.set({ messages: [...ms] });
        return;
      }
    }
    const msgId = this.msgSeq++;
    const def = ItemDefs[id];
    this.pickupAgg.set(id, { id, count: n, until: now + 900, msgId });
    const ms = ui.getSnapshot().messages;
    ui.set({ messages: [...ms, { id: msgId, text: `拾取 ${def.name} ×${n}`, color: '#c8e8ff', born: now }].slice(-8) });
  }

  // ==================== 小地图 ====================
  private buildMinimapColors(): void {
    this.mmColors = [];
    for (let i = 0; i < 32; i++) {
      const td = TileDefs[i];
      if (!td) { this.mmColors.push([0, 0, 0, 0]); continue; }
      const m = /^#([0-9a-f]{6})$/i.exec(td.mapColor);
      if (m) {
        this.mmColors.push([parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 255]);
      } else {
        this.mmColors.push([0, 0, 0, 0]);
      }
    }
  }

  buildMinimap(): void {
    const c = this.mmCanvas ?? document.createElement('canvas');
    c.width = this.world.w; c.height = this.world.h;
    const cx = c.getContext('2d')!;
    const img = cx.createImageData(this.world.w, this.world.h);
    for (let y = 0; y < this.world.h; y++) {
      for (let x = 0; x < this.world.w; x++) {
        this.paintMMCell(img.data, x, y);
      }
    }
    cx.putImageData(img, 0, 0);
    this.mmCanvas = c;
    this.mmImg = img;
  }

  private paintMMCell(data: Uint8ClampedArray, x: number, y: number): void {
    const id = this.world.tiles[y * this.world.w + x];
    const p = (y * this.world.w + x) * 4;
    if (id === T.AIR) {
      const wall = this.world.walls[y * this.world.w + x];
      if (wall === 1) { data[p] = 52; data[p + 1] = 36; data[p + 2] = 24; data[p + 3] = 255; }
      else if (wall === 2) { data[p] = 34; data[p + 1] = 34; data[p + 2] = 42; data[p + 3] = 255; }
      else { data[p] = 0; data[p + 1] = 0; data[p + 2] = 0; data[p + 3] = 0; }
    } else {
      const c = this.mmColors[id] ?? [128, 128, 128, 255];
      data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
    }
  }

  /** 瓦片变化时更新小地图(由 world.onTileChanged 调) */
  private onTileChanged = (x: number, y: number): void => {
    if (!this.mmCanvas || !this.mmImg) return;
    this.paintMMCell(this.mmImg.data, x, y);
    this.mmCanvas.getContext('2d')!.putImageData(this.mmImg, 0, 0, x, y, 1, 1);
  };

  // ==================== UI 同步 ====================
  private syncUI(force: boolean): void {
    if (!this.uiDirty && !force && this.frame % 12 !== 0) return;
    const p = this.player;
    if (!p) return;
    const st = ui.getSnapshot();
    const depth = Math.round((p.y / 16 - this.world.surface[clamp(Math.floor(p.x / 16), 0, this.world.w - 1)]) );
    const patch: Record<string, unknown> = {};
    const put = (k: string, v: unknown): void => {
      const sv = (st as unknown as Record<string, unknown>)[k];
      if (sv !== v) patch[k] = v;
    };
    put('screen', this.screen);
    put('paused', this.paused);
    put('invOpen', this.invOpen);
    put('hp', Math.max(0, p.hp));
    put('maxHp', p.maxHp);
    put('breath', p.headWater ? p.breath / PLAYER_CONF.breathMax : null);
    put('slots', this.uiDirty ? [...p.inv] : st.slots);
    put('hotbar', p.hotbar);
    put('cursorItem', p.cursorItem);
    put('stations', { ...this.stations() });
    put('depth', depth);
    put('isNight', this.isNight());
    if (this.uiDirty || force) {
      const craftables = RECIPES.map((r, i) => ({
        index: i, out: r.out, count: r.count, can: this.canCraft(i),
      }));
      put('craftables', craftables);
    }
    this.uiDirty = false;
    this.lastUiHp = p.hp;
    if (Object.keys(patch).length > 0) ui.set(patch as Partial<typeof st>);
    void this.lastUiHp;
  }

  // ==================== 光照(渲染用) ====================
  computeLightFor(extra: ExtraLight[]): { x0: number; y0: number; w: number; h: number } {
    const pad = 8;
    const x0 = Math.max(0, Math.floor(this.camX / 16) - pad);
    const y0 = Math.max(0, Math.floor(this.camY / 16) - pad);
    const w = Math.min(this.world.w - x0, Math.ceil(this.viewW() / 16) + pad * 2);
    const h = Math.min(this.world.h - y0, Math.ceil(this.viewH() / 16) + pad * 2);
    computeLight(this.world, this.lightReg, x0, y0, w, h, this.skyLightNow(), this.timeSec, extra);
    return { x0, y0, w, h };
  }
}

let inst: GameEngine | null = null;
function setEngine(g: GameEngine): void { inst = g; }
export function getEngine(): GameEngine | null { return inst; }

export const engine: EngineAPI = {
  enterWorld: () => inst?.enterWorld(),
  continueGame: () => inst?.continueGame(),
  regenerate: () => inst?.regenerate(),
  quitToTitle: () => inst?.quitToTitle(),
  saveGame: () => inst?.saveGame() ?? false,
  toggleInventory: () => inst?.toggleInventory(),
  togglePause: () => inst?.togglePause(),
  setPaused: (v) => inst?.setPaused(v),
  selectHotbar: (i) => inst?.selectHotbar(i),
  toggleMute: () => inst?.toggleMute(),
  craft: (i) => inst?.craft(i),
  clickSlot: (i, r) => inst?.clickSlot(i, r),
};
