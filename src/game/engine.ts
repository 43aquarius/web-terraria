/**
 * 游戏主引擎：主循环 / 输入 / 挖掘放置战斗 / 宝箱 / 门 / 盔甲 / 投射物 /
 * 克苏鲁之眼 Boss / 向导 NPC / 分层群系刷怪 / 智能光标 / 全屏地图 / 存档 v2
 * 渲染拆分到 render.ts
 */

import {
  T, TileDefs, ItemDefs, RECIPES, IT, FURNITURE_SHAPE,
  PLAYER_CONF, ENEMY_DEFS, GUIDE_LINES,
  REACH, CYCLE, DAY_END, SAVE_KEY, SAVE_KEY_V1, MAX_HP, HP_CAP,
  WORLD_SIZES, CHEST_LOOT, BIOME, BIOME_NAMES,
  type WorldSize, type ArmorSlot,
} from './constants';
import { World } from './world';
import { getTextures, mulberry32, type GameTextures } from './textures';
import { makeRegion, computeLight, type LightRegion, type ExtraLight } from './lighting';
import type { SkyState } from './sky';
import {
  mkPlayer, updatePlayer, spawnEnemy, updateEnemy,
  mkDrop, updateDrop, burst, mkGuide, updateGuide,
  mkArrow, mkBomb, updateProj, bodyInLava, bodyInWater, tileAt, moveBody,
  boxClear, unstickBody,
  type Player, type Enemy, type EnemyKind, type Drop, type Particle, type DmgNum, type Body,
  type Guide, type Proj, type PlayerEvents,
} from './entities';
import { SFX, Music } from './sound';
import { ui, type Slot, type UIArmor } from './store';
import { net } from './net';
import { renderGame } from './render';

export type Screen = 'title' | 'playing' | 'dead';

/** 盔甲三槽(head/body/legs)状态, 与 UIState.armor 同构 */
export type ArmorState = UIArmor;

/** 带 armor 扩展的 Player(engine 侧自行扩展, 不动 entities.ts) */
type ArmoredPlayer = Player & { armor: ArmorState };

/** 树苗(橡子种下后登记, 到期尝试长成树) */
interface Sapling { x: number; y: number; t: number; due: number }

/** React UI 可调用的引擎 API(单例) */
export interface EngineAPI {
  enterWorld(): void;
  enterWorldMP(name: string, room: string): void;
  continueGame(): void;
  regenerate(): void;
  newWorld(size: WorldSize, seedStr: string, playerName: string, dev: boolean): void;
  quitToTitle(): void;
  saveGame(): boolean;
  toggleInventory(): void;
  togglePause(): void;
  setPaused(v: boolean): void;
  selectHotbar(i: number): void;
  toggleMute(): void;
  craft(index: number): void;
  clickSlot(i: number, right: boolean): void;
  clickChestSlot(i: number, right: boolean): void;
  clickArmorSlot(slot: ArmorSlot, right: boolean): void;
  toggleMap(): void;
  toggleSmart(): void;
  closeChest(): void;
}

const ZOOM = 2;
const FIXED = 1000 / 60;
const TITLE_DAY_T = 0.545;         // 标题屏定格黄昏
const MAX_ENEMIES_DAY = 4;         // 地表白天上限
const MAX_ENEMIES_NIGHT = 8;       // 地表夜晚上限
const MAX_ENEMIES_CAVE = 5;        // 洞穴上限
const MAX_ENEMIES_HELL = 4;        // 地狱上限
const AUTOSAVE_FRAMES = 60 * 30;
const CHEST_SLOTS = 20;            // 宝箱容量
const SAPLING_MIN = 900;           // 树苗最快成树帧数
const SAPLING_RND = 300;
const MAP_EXPLORE_R = 42;          // 探索半径(格)
const BOMB_DMG = 60;               // 爆炸基础伤害(同 ItemDefs[BOMB].dmg)

function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }

/** 天空光强随 dayT 变化(0-1) */
function skyLightAt(dayT: number): number {
  if (dayT < 0.03) return 0.55 + (dayT / 0.03) * 0.45;
  if (dayT < 0.5) return 1;
  if (dayT < DAY_END) return 1 - ((dayT - 0.5) / (DAY_END - 0.5)) * 0.72;
  if (dayT < 0.9) return 0.28;
  return 0.28 + ((dayT - 0.9) / 0.1) * 0.27;
}

/** FNV-1a 32位字符串哈希 → 数字种子 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 0/1 位图 RLE: [0游程,1游程,0游程,...] */
function rleBits(a: Uint8Array): number[] {
  const runs: number[] = [];
  let cur = 0, n = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === cur) n++;
    else { runs.push(n); cur ^= 1; n = 1; }
  }
  runs.push(n);
  return runs;
}
function unrleBits(runs: number[], len: number): Uint8Array {
  const a = new Uint8Array(len);
  let p = 0, cur = 0;
  for (const n of runs) {
    if (cur) a.fill(1, p, Math.min(len, p + n));
    p += n; cur ^= 1;
    if (p >= len) break;
  }
  return a;
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
  player!: ArmoredPlayer;
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
  /** 触屏输入(TouchControls 写入, 12-c): mx/my ∈ [-1,1] 摇杆向量(死区后), jump=按住跳跃(等同按住空格), mine=世界触摸按住(等同鼠标左键), active=任一触控件激活(信息性) */
  touch = { active: false, mx: 0, my: 0, jump: false, mine: false };
  sky: SkyState = { dayT: TITLE_DAY_T, skyLight: 1, camX: 0, camY: 0, depthPx: 0, timeSec: 0 };
  redFlash = 0;
  shake = 0;                // 屏幕震动强度(世界像素,渲染 zoom=2)
  shakeX = 0; shakeY = 0;   // 本帧随机震动偏移(render 侧 translate 用)
  titleT = 0;
  mmCanvas: HTMLCanvasElement | null = null;

  // ==================== 9-e 新增公共状态(render/HUD 读取) ====================
  projs: Proj[] = [];                       // 投射物(箭/炸弹)
  guide: Guide | null = null;               // 向导 NPC
  guideLine = '';                           // 向导当前台词
  guideLineUntil = 0;                       // 台词过期帧(g.frame < guideLineUntil 时显示气泡)
  boss: Enemy | null = null;                // 克苏鲁之眼(同时也是 enemies 成员)
  smart = false;                            // 智能光标开关(C)
  smartTarget: { gx: number; gy: number } | null = null;  // 智能挖掘目标格
  smartPlace: { gx: number; gy: number } | null = null;   // 智能放置目标格(命中实心前最后一个 AIR)
  mapOpen = false;                          // 全屏地图开关(Tab)
  explored!: Uint8Array;                    // 探索掩码(w*h, 1=已探索)
  mapCanvas: HTMLCanvasElement | null = null; // 全屏地图离屏画布(w*h, 1px=1格)
  chestOpen: number | null = null;          // 打开的宝箱主格(CHEST_TL) tileIdx
  chestContents = new Map<number, (Slot | null)[]>(); // 宝箱战利品(key=主格 tileIdx)
  saplings: Sapling[] = [];                 // 已种树苗
  devMode = false;                          // 开发模式(newWorld 参数)
  devFly = false;                           // dev 模式按住 F 飞行(每帧刷新)
  applyingNet = false;                      // 15-b: 正在应用远端方块编辑(不回广播)
  playerName = '泰拉行者';
  seedStr = '';                             // 创建世界时的种子字符串

  private lightReg: LightRegion = makeRegion();
  private keys = new Set<string>();
  private mineTarget: number | null = null;
  private placeCooldown = 0;
  private useCooldown = 0;
  private spawnTimer = 120;
  private autosaveTimer = AUTOSAVE_FRAMES;
  private stationCache: Record<string, boolean> = { workbench: false, furnace: false, anvil: false, altar: false };
  private stationFrame = -999;
  private pickupAgg = new Map<number, PickupAgg>();
  // 14-a: 消息 id 用时间基起始 — HMR/引擎重挂载后 msgSeq 重置会与 store 里
  // 残留的旧消息 id 撞车(React duplicate key 报错)
  private msgSeq = (Date.now() % 1000000) * 10;
  private uiDirty = true;
  private lastUiHp = -1;
  private raf = 0;
  private lastTs = 0;
  private acc = 0;
  private mounted = false;
  private ro: ResizeObserver | null = null;
  private noPickup = new Map<Drop, number>(); // 13-c: 掉落物引用 → 拾取冷却帧数(修复旧按数组下标在 splice 后错位的问题)
  private mmImg: ImageData | null = null;
  private mmColors: [number, number, number, number][] = [];
  private mapImg: ImageData | null = null;
  private mapDirty = new Set<number>();
  private rightWas = false;      // 右键边沿检测(上一 tick 状态)
  private wasNight = false;      // 音乐场景切换监测
  private bossPhaseWas = 0;      // Boss 阶段跳变监测
  private bossHitTally = 0;      // Boss 受击计数(每 6 次 bossHit 音效)
  private lastMinPowerMsg = -999; // "镐力不足" 消息节流
  private lastNoArrowMsg = -999;  // "没有箭了" 消息节流

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
    this.buildTileColors();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas.parentElement ?? this.canvas);
    this.resize();

    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mouseleave', this.onMouseUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onCtxMenu);
    // capture 阶段监听: Tab(地图)/Esc(关地图/关宝箱) 需要 HUD 不再重复处理
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('beforeunload', this.onUnload);
    // 移动端地址栏收放/旋转屏跟随(12-c): visualViewport 的 resize 比 layout 尺寸变化更及时
    window.visualViewport?.addEventListener('resize', this.onVVResize);

    // 生成世界 -> 标题屏
    ui.set({ loading: true, loadingText: '正在生成世界…' });
    setTimeout(() => {
      this.initWorld(Math.floor(Math.random() * 1e9));
      ui.set({ loading: false, hasSave: this.hasSaveData() });
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
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('beforeunload', this.onUnload);
    window.visualViewport?.removeEventListener('resize', this.onVVResize);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = Math.max(320, Math.round(rect.width));
    const vh = Math.max(240, Math.round(rect.height));
    const p = this.player;
    // 视口尺寸变化超过 1px(旋转屏/地址栏收放)时需要相机立即回中(12-c)
    const moved = !!p && !!this.world && (Math.abs(vw - this.vw) > 1 || Math.abs(vh - this.vh) > 1);
    this.vw = vw;
    this.vh = vh;
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);
    this.ctx.imageSmoothingEnabled = false;
    // 相机立即对准玩家(followCam 目标位), 防止视口变化后玩家跑出画面
    if (moved && p) {
      this.camX = p.x - this.viewW() / 2;
      this.camY = (p.y - p.h / 2) - this.viewH() / 2;
      this.clampCam();
    }
  }

  /** visualViewport resize 入口(12-c) */
  private onVVResize = (): void => { this.resize(); };

  // ==================== 世界创建 ====================

  /** 旧入口: 小世界 + 数字种子(标题屏默认/兼容旧路径) */
  initWorld(seed: number): void {
    this.setupWorld(new World(seed), '', '泰拉行者', false, false);
  }

  /** 新入口: 按尺寸/种子串/玩家名/dev 创建世界(9-g 标题屏表单调用) */
  newWorld(size: WorldSize, seedStr: string, playerName: string, dev: boolean): void {
    const seed = seedStr ? fnv1a(seedStr) : Math.floor(Math.random() * 1e9);
    const sz = WORLD_SIZES[size] ?? WORLD_SIZES.small;
    this.screen = 'title';
    this.paused = false;
    this.invOpen = false;
    this.setupWorld(new World(seed, sz.w, sz.h), seedStr, playerName.trim() || '泰拉行者', dev, true);
    this.uiDirty = true;
    this.syncUI(true);
  }

  /** 世界通用装配: 玩家/向导/宝箱战利品/探索地图/相机 */
  private setupWorld(world: World, seedStr: string, playerName: string, dev: boolean, starter: boolean): void {
    this.world = world;
    this.world.onTileChanged = (x, y, id) => this.onTileChanged(x, y, id);
    this.seedStr = seedStr;
    this.playerName = playerName;
    this.devMode = dev;
    this.smart = false;
    this.devFly = false;
    this.player = mkPlayer(world.spawnX, world.spawnY) as ArmoredPlayer;
    this.player.armor = { head: null, body: null, legs: null };
    this.enemies = [];
    this.drops = [];
    this.parts = [];
    this.dmgs = [];
    this.ambient = [];
    this.projs = [];
    this.boss = null;
    this.bossPhaseWas = 0;
    this.bossHitTally = 0;
    this.guide = mkGuide(world.spawnX + 40, world.spawnY);
    this.guideLine = '';
    this.guideLineUntil = 0;
    this.saplings = [];
    this.chestContents = new Map();
    this.chestOpen = null;
    this.mapOpen = false;
    this.mineDamage.clear();
    this.mineTarget = null;
    this.explored = new Uint8Array(world.w * world.h);
    this.timeSec = 0;
    this.titleT = 0;
    this.wasNight = false;
    this.rightWas = false;
    this.lastMinPowerMsg = -999;
    this.lastNoArrowMsg = -999;
    this.genChestLoot();
    if (starter) this.giveStarterItems();
    this.buildMinimap();
    this.buildMapCanvas();
    this.markExplored(Math.floor(world.spawnX / 16), Math.floor(world.spawnY / 16));
    this.camX = world.spawnX - this.viewW() / 2;
    this.camY = (this.player.y - this.player.h / 2) - this.viewH() / 2;
    this.clampCam();
    this.uiDirty = true;
    this.syncUI(true);
  }

  /** 初始物品: 铜镐/铜斧/铜短剑 + 火把×10 */
  private giveStarterItems(): void {
    if (this.player.inv.some((s) => s)) return;
    this.player.inv[0] = { id: IT.COPPER_PICK, count: 1 };
    this.player.inv[1] = { id: IT.COPPER_AXE, count: 1 };
    this.player.inv[2] = { id: IT.COPPER_SWORD, count: 1 };
    this.player.inv[3] = { id: IT.TORCH, count: 10 };
    this.uiDirty = true;
  }

  /** 宝箱战利品确定性初始化: mulberry32(seed ^ (i*2654435761)) 抽 2-4 项 */
  private genChestLoot(): void {
    this.chestContents.clear();
    const spawns = this.world.chestSpawns;
    for (let i = 0; i < spawns.length; i++) {
      const cs = spawns[i];
      const rng = mulberry32((this.world.seed ^ Math.imul(i, 2654435761)) | 0);
      const table = CHEST_LOOT[cs.tier] ?? CHEST_LOOT.surface;
      const slots: (Slot | null)[] = new Array(CHEST_SLOTS).fill(null);
      let n = 0;
      for (let round = 0; round < 24 && n < 2; round++) {
        for (const entry of table) {
          if (n >= 4) break;
          if (rng() < entry.chance) {
            const count = entry.min + Math.floor(rng() * (entry.max - entry.min + 1));
            if (count > 0) slots[n++] = { id: entry.id, count };
          }
        }
      }
      this.chestContents.set(this.world.idx(cs.x, cs.y), slots);
    }
  }

  /** 读档后按世界 tile 重建树苗登记表 */
  private rebuildSaplings(): void {
    this.saplings = [];
    const t = this.world.tiles, w = this.world.w;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === T.SAPLING) this.saplings.push({ x: i % w, y: (i / w) | 0, t: 0, due: SAPLING_MIN + Math.random() * SAPLING_RND });
    }
  }

  private hasSaveData(): boolean {
    try {
      return !!(localStorage.getItem(SAVE_KEY) || localStorage.getItem(SAVE_KEY_V1));
    } catch {
      return false;
    }
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
    Music.start();
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left;
    this.mouse.y = e.clientY - r.top;
    if (e.button === 0) this.mouse.left = true;
    if (e.button === 2) this.mouse.right = true;
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

  /**
   * 触屏世界交互入口(TouchControls 转发, 12-c):
   * phase='start' 等同鼠标移动+左键按下, 'move' 等同鼠标移动, 'end' 等同左键抬起;
   * 坐标为画布内 CSS px(与 onMouseMove 同单位: clientX - rect.left)
   */
  touchAt(xCss: number, yCss: number, phase: 'start' | 'move' | 'end'): void {
    this.mouse.x = xCss;
    this.mouse.y = yCss;
    if (phase === 'start') {
      SFX.init();
      Music.start();
      this.mouse.left = true;
      this.touch.active = true;
      this.touch.mine = true;
    } else if (phase === 'end') {
      this.mouse.left = false;
      this.touch.mine = false;
      this.touch.active = this.touch.jump;
    }
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
    Music.start();
    if (this.screen !== 'playing') return;
    // Tab = 全屏地图(HUD 旧绑定会重复开背包, 用 stopPropagation 拦截, 9-g 会移除 HUD 侧绑定)
    if (e.code === 'Tab') {
      e.preventDefault();
      this.toggleMap();
      e.stopPropagation();
      return;
    }
    // Esc 优先级: 地图 > 宝箱 > (背包/暂停, 由 HUD 处理)
    if (e.code === 'Escape') {
      if (this.mapOpen) { this.toggleMap(); e.stopPropagation(); return; }
      if (this.chestOpen !== null) { this.closeChest(); e.stopPropagation(); return; }
      return;
    }
    if (e.code === 'KeyC') { this.toggleSmart(); return; }
    // Enter = 聊天输入框(联机时; 单机也可用作文流留音)
    if (e.code === 'Enter' && !this.paused && !this.mapOpen && this.chestOpen === null && !this.invOpen) {
      e.preventDefault();
      ui.set({ chatOpen: true });
      return;
    }
    if (this.devMode && !this.paused) {
      if (e.code === 'KeyG') { this.devSpawn(); return; }
      if (e.code === 'KeyN') { this.devTime(); return; }
    }
  };
  private onKeyUp = (e: KeyboardEvent): void => { this.keys.delete(e.code); };

  private moveInput() {
    const canMove = this.screen === 'playing' && !this.paused && !this.mapOpen;
    // 触屏并集(12-c): 摇杆非零即全速移动(死区 0.15), 摇杆下推 >0.6 触发下平台;
    // touch.jump 持续为 true 期间等同按住空格(保留"按住跳更高")
    const tmx = this.touch.mx;
    const tmy = this.touch.my;
    return {
      left: canMove && (this.keys.has('KeyA') || this.keys.has('ArrowLeft') || tmx < -0.15),
      right: canMove && (this.keys.has('KeyD') || this.keys.has('ArrowRight') || tmx > 0.15),
      jump: canMove && (this.keys.has('Space') || this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.touch.jump),
      down: canMove && (this.keys.has('KeyS') || this.keys.has('ArrowDown') || tmy > 0.6),
    };
  }

  // ==================== API ====================
  enterWorld(): void {
    SFX.init();
    Music.start();
    this.screen = 'playing';
    this.timeSec = CYCLE * 0.06;      // 清晨
    this.enemies = [];
    this.drops = [];
    // 初始装备：铜镐 / 铜斧 / 铜短剑 + 火把×10(泰拉瑞亚新角色标配)
    this.giveStarterItems();
    this.wasNight = false;
    Music.setScene('day');
    // 15-b: 单机也接上聊天回显(Enter 输入 → 消息栏)
    if (!net.online) {
      if (!net.myName) net.myName = this.playerName;
      net.onChat = (n, t) => this.msg(`${n}: ${t}`, '#8ad8ff');
    }
    this.msg(`欢迎来到泰拉瑞亚, ${this.playerName}！砍树挖矿，打造装备吧。`, '#f7d060');
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

  // ==================== 联机(15-b) ====================
  /** 联机入场: 连接 mp-server → welcome(seed+edits) → 同种子生成世界 → 回放编辑 → 进世界 */
  enterWorldMP(name: string, room: string): void {
    const cleanName = (name.trim() || '泰拉行者').slice(0, 12);
    const cleanRoom = (room.trim() || 'lobby').slice(0, 16);
    this.playerName = cleanName;
    ui.set({ loading: true, loadingText: `正在连接联机房间「${cleanRoom}」…` });
    // 联机回调接线
    net.onChat = (n, t) => this.msg(`${n}: ${t}`, '#8ad8ff');
    net.onPlayerJoin = (n) => this.msg(`${n} 加入了房间`, '#a0e8a0');
    net.onPlayerLeave = (n) => this.msg(`${n} 离开了`, '#e0c080');
    net.onStatusChange = () => {
      ui.set({ loading: false });
      this.uiDirty = true;
      this.syncUI(true);
    };
    net.applyRemoteTile = (x, y, id) => {
      if (!this.world) return;
      this.applyingNet = true;
      try { this.world.set(x, y, id); } finally { this.applyingNet = false; }
    };
    let settled = false;
    net.connect(cleanName, cleanRoom, (seed, edits, roster) => {
      settled = true;
      this.setupWorld(new World(seed), cleanRoom, cleanName, false, true);
      // 回放房间历史方块编辑(不回广播)
      this.applyingNet = true;
      try { for (const [x, y, id] of edits) this.world.set(x, y, id); }
      finally { this.applyingNet = false; }
      this.enterWorld();
      this.msg(`已加入联机房间「${cleanRoom}」· 世界种子 ${seed}`, '#8ad8ff');
      this.msg('与好友挖同样的矿、盖同样的家！按 Enter 聊天。', '#8ad8ff');
      if (roster.length) this.msg(`当前在线: ${roster.map((r) => r.name).join(', ')}`, '#a0e8a0');
      this.uiDirty = true;
      this.syncUI(true);
      ui.set({ loading: false });
    });
    // 8 秒未收到 welcome → 报错并解除 loading
    setTimeout(() => {
      if (!settled && !net.online) {
        ui.set({ loading: false });
        this.msg('联机连接失败：无法连接服务器，请稍后重试', '#e07070');
      }
    }, 8000);
  }

  continueGame(): void {
    SFX.init();
    Music.start();
    let raw: string | null = null;
    let legacy = false;
    try {
      raw = localStorage.getItem(SAVE_KEY);
      if (!raw) { raw = localStorage.getItem(SAVE_KEY_V1); legacy = true; }
    } catch { raw = null; }
    if (!raw) { this.msg('没有找到存档', '#e07070'); return; }
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      if (legacy || o.v === 1) this.loadSave(o, true);
      else this.loadSave(o, false);
    } catch {
      this.msg('存档读取失败', '#e07070');
    }
  }

  /** 存档落地(v2 直读 / v1 迁移) */
  private loadSave(o: Record<string, unknown>, legacy: boolean): void {
    const worldStr = o.world as string;
    const po = o.p as { x: number; y: number; hp: number; maxHp?: number; inv?: (Slot | null)[]; hotbar?: number; armor?: UIArmor; name?: string };
    const world = World.decode(worldStr);
    this.world = world;
    this.world.onTileChanged = (x, y, id) => this.onTileChanged(x, y, id);
    this.seedStr = typeof o.seedStr === 'string' ? o.seedStr : '';
    this.playerName = (po?.name ?? '泰拉行者') || '泰拉行者';
    this.devMode = legacy ? false : !!o.devMode;
    this.smart = legacy ? false : !!o.smart;
    this.devFly = false;

    this.player = mkPlayer(po.x, po.y) as ArmoredPlayer;
    const maxHp = legacy ? MAX_HP : clamp(po.maxHp ?? MAX_HP, MAX_HP, HP_CAP);
    this.player.maxHp = maxHp;
    this.player.hp = clamp(po.hp ?? maxHp, 1, maxHp);
    this.player.inv = Array.from({ length: 40 }, (_, i) => po.inv?.[i] ?? null);
    this.player.hotbar = clamp(po.hotbar ?? 0, 0, 9);
    this.player.armor = legacy || !po.armor ? { head: null, body: null, legs: null } : po.armor;

    this.timeSec = typeof o.t === 'number' ? o.t : 0;
    this.enemies = [];
    this.drops = [];
    this.parts = [];
    this.dmgs = [];
    this.ambient = [];
    this.projs = [];
    this.boss = null;
    this.bossPhaseWas = 0;
    this.bossHitTally = 0;
    this.guide = mkGuide(world.spawnX + 40, world.spawnY);
    this.guideLine = '';
    this.guideLineUntil = 0;
    this.mineDamage.clear();
    this.mineTarget = null;
    this.mapOpen = false;
    this.chestOpen = null;

    if (legacy) {
      // v1 迁移: 宝箱按 chestSpawns 重新确定性生成, 探索仅标记出生点
      this.chestContents = new Map();
      this.genChestLoot();
      this.explored = new Uint8Array(world.w * world.h);
      this.markExplored(Math.floor(world.spawnX / 16), Math.floor(world.spawnY / 16));
    } else {
      const chests = o.chests as [number, (Slot | null)[]][] | undefined;
      this.chestContents = new Map(chests ?? []);
      const runs = o.explored as number[] | undefined;
      this.explored = runs && runs.length ? unrleBits(runs, world.w * world.h) : new Uint8Array(world.w * world.h);
      if (this.explored.length !== world.w * world.h) {
        this.explored = new Uint8Array(world.w * world.h);
        this.markExplored(Math.floor(world.spawnX / 16), Math.floor(world.spawnY / 16));
      }
    }
    this.rebuildSaplings();

    this.screen = 'playing';
    this.buildMinimap();
    this.buildMapCanvas();
    this.camX = this.player.x - this.viewW() / 2;
    this.camY = (this.player.y - this.player.h / 2) - this.viewH() / 2;
    this.clampCam();
    this.wasNight = this.isNight();
    Music.setScene(this.wasNight ? 'night' : 'day');
    this.msg(legacy ? '已迁移旧存档, 欢迎回来！' : '欢迎回来！', '#8ee88e');
    this.uiDirty = true;
    this.syncUI(true);
  }

  quitToTitle(): void {
    this.save();
    net.disconnect();      // 15-b: 退出到标题时断开联机
    this.screen = 'title';
    this.ambient = [];
    this.titleT = 0;
    this.paused = false;
    this.invOpen = false;
    this.mapOpen = false;
    if (this.chestOpen !== null) this.closeChest();
    Music.setScene('title');
    this.uiDirty = true;
    this.syncUI(true);
  }

  saveGame(): boolean { return inst?.save() ?? false; }

  save(): boolean {
    if (!this.world || this.screen === 'title') return false;
    try {
      const data = JSON.stringify({
        v: 2,
        world: this.world.encode(),
        p: {
          x: this.player.x, y: this.player.y,
          hp: this.player.hp, maxHp: this.player.maxHp,
          inv: this.player.inv, hotbar: this.player.hotbar,
          armor: this.player.armor, name: this.playerName,
        },
        t: this.timeSec,
        seedStr: this.seedStr,
        chests: Array.from(this.chestContents.entries()),
        explored: rleBits(this.explored),
        devMode: this.devMode,
        smart: this.smart,
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
    // 背包键 E: 宝箱开着时优先关宝箱
    if (this.chestOpen !== null) { this.closeChest(); return; }
    this.invOpen = !this.invOpen;
    this.returnCursorToInv();
    this.uiDirty = true;
  }

  /** 关闭面板时把光标物品放回背包(放不下则掉落) */
  private returnCursorToInv(): void {
    if (!this.invOpen && this.player.cursorItem) {
      const rest = this.addItem(this.player.cursorItem.id, this.player.cursorItem.count);
      if (rest > 0) {
        const d = mkDrop(this.player.cursorItem.id, rest, this.player.x, this.player.y - 20);
        this.drops.push(d);
      }
      this.player.cursorItem = null;
    }
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
    Music.start();
    const m = SFX.toggleMute();
    ui.set({ muted: m });
  }

  /** Tab: 全屏地图开关(打开时输入/挖掘暂停, 世界继续渲染) */
  toggleMap(): void {
    if (this.screen !== 'playing') return;
    this.mapOpen = !this.mapOpen;
    if (this.mapOpen) { this.mouse.left = false; this.mouse.right = false; }
    this.uiDirty = true;
  }

  /** C: 智能光标开关 */
  toggleSmart(): void {
    if (this.screen !== 'playing') return;
    this.smart = !this.smart;
    this.uiDirty = true;
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
    if (r.station === 'altar') SFX.altar();
    const def = ItemDefs[r.out];
    this.msg(`合成了 ${def.name}${r.count > 1 ? ` ×${r.count}` : ''}`, '#8ee88e');
    this.uiDirty = true;
  }

  // ==================== 槽位点击(背包/宝箱/盔甲) ====================

  /** 背包槽点击(左键点击盔甲物品 = 直接穿戴) */
  clickSlot(i: number, right: boolean): void {
    if (this.screen !== 'playing') return;
    const p = this.player;
    const slot = p.inv[i];
    if (!right && slot && ItemDefs[slot.id]?.kind === 'armor') {
      const adef = ItemDefs[slot.id];
      const as = adef.armorSlot;
      if (as) {
        const old = p.armor[as];
        p.armor[as] = slot;
        p.inv[i] = old ?? null; // 旧盔甲回到该槽位
        SFX.click();
        this.uiDirty = true;
        return;
      }
    }
    this.clickSlotIn(p.inv, i, right);
    SFX.click();
    this.uiDirty = true;
  }

  /** 宝箱槽点击(与 clickSlot 同语义, 在宝箱与光标之间搬运) */
  clickChestSlot(i: number, right: boolean): void {
    if (this.screen !== 'playing' || this.chestOpen === null) return;
    const arr = this.chestContents.get(this.chestOpen);
    if (!arr || i < 0 || i >= arr.length) return;
    this.clickSlotIn(arr, i, right);
    SFX.click();
    this.uiDirty = true;
  }

  /** 盔甲槽点击: 空手取出 / 放入类型匹配的盔甲(与光标交换) */
  clickArmorSlot(slot: ArmorSlot, right: boolean): void {
    void right; // 盔甲 maxStack=1, 左右键语义一致
    if (this.screen !== 'playing') return;
    const p = this.player;
    const cur = p.cursorItem;
    const old = p.armor[slot];
    if (!cur) {
      if (old) { p.cursorItem = old; p.armor[slot] = null; }
    } else {
      const def = ItemDefs[cur.id];
      if (def?.kind === 'armor' && def.armorSlot === slot) {
        p.armor[slot] = cur;
        p.cursorItem = old; // 旧盔甲回到光标(可能为 null)
      }
    }
    SFX.click();
    this.uiDirty = true;
  }

  /** 通用槽位交换语义(拿起/放下/右键取半/同类合并) */
  private clickSlotIn(arr: (Slot | null)[], i: number, right: boolean): void {
    const p = this.player;
    const slot = arr[i];
    const cur = p.cursorItem;
    if (!right) {
      if (!cur) {
        if (slot) { p.cursorItem = slot; arr[i] = null; }
      } else if (!slot) {
        arr[i] = cur; p.cursorItem = null;
      } else if (slot.id === cur.id && ItemDefs[slot.id]) {
        const max = ItemDefs[slot.id].maxStack;
        const move = Math.min(max - slot.count, cur.count);
        slot.count += move; cur.count -= move;
        if (cur.count <= 0) p.cursorItem = null;
      } else {
        arr[i] = cur; p.cursorItem = slot;
      }
    } else {
      if (!cur) {
        if (slot) {
          const half = Math.ceil(slot.count / 2);
          p.cursorItem = { id: slot.id, count: half };
          slot.count -= half;
          if (slot.count <= 0) arr[i] = null;
        }
      } else if (!slot) {
        arr[i] = { id: cur.id, count: 1 };
        cur.count--;
        if (cur.count <= 0) p.cursorItem = null;
      } else if (slot.id === cur.id && slot.count < ItemDefs[slot.id].maxStack) {
        slot.count++; cur.count--;
        if (cur.count <= 0) p.cursorItem = null;
      }
    }
  }

  /** 三件盔甲防御之和 */
  defense(): number {
    const a = this.player?.armor;
    if (!a) return 0;
    let d = 0;
    if (a.head) d += ItemDefs[a.head.id]?.defense ?? 0;
    if (a.body) d += ItemDefs[a.body.id]?.defense ?? 0;
    if (a.legs) d += ItemDefs[a.legs.id]?.defense ?? 0;
    return d;
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
    const st = { workbench: false, furnace: false, anvil: false, altar: false };
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
      this.flushMap();
      return;
    }

    if (this.player.dead) {
      this.tickDead();
      this.flushMap();
      return;
    }

    if (!this.paused) this.tickGame();
    this.flushMap();
    this.syncUI(false);
    // ---- 联机: 12Hz 广播自身状态 + 远端玩家插值/方块批次冲刷(15-b) ----
    if (net.online && this.screen === 'playing') {
      net.tickInterp();
      net.flushTiles();
      const p = this.player;
      const held = p.inv[p.hotbar];
      // 帧号推导(与 render.playerImgFrame 同规则: 1-4 挥击 / 5 跳 / 6-18 走)
      let frame = 0;
      if (p.swing) frame = 1 + Math.min(3, Math.floor((p.swing.t / p.swing.dur) * 4));
      else if (!p.onGround) frame = 5;
      else if (Math.abs(p.vx) > 0.3) frame = 6 + (((Math.round(p.walkT / ((Math.PI * 2) / 13)) % 13) + 13) % 13);
      net.sendState({
        x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
        dir: p.dir, frame, walkT: Math.round(p.walkT * 100) / 100, onGround: p.onGround,
        hp: p.hp, maxHp: p.maxHp,
        held: held?.id ?? 0,
        swingT: p.swing ? p.swing.t / p.swing.dur : 0,
        armorH: p.armor?.head?.id ?? 0,
        armorB: p.armor?.body?.id ?? 0,
        armorL: p.armor?.legs?.id ?? 0,
      });
    }
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
    for (const e of this.enemies) {
      updateEnemy(this.world, e, p.x, p.y, this.isNight(), this.frame);
      unstickBody(this.world, e);
    }
    this.enemies = this.enemies.filter((e) => !e.dead && (ENEMY_DEFS[e.kind].boss || Math.hypot(e.x - p.x, e.y - p.y) < 70 * 16));
    if (p.deadTimer <= 0) {
      p.dead = false;
      p.hp = p.maxHp;
      p.breath = PLAYER_CONF.breathMax;
      p.x = this.world.spawnX;
      p.y = this.world.spawnY;
      p.vx = 0; p.vy = 0;
      p.iframes = 0;
      p.spawnProt = 600;
      // 清除出生点附近的敌怪,防止"重生即被围杀"的死循环(Boss 豁免 —— Boss 战不应因玩家死亡重生而终结)
      this.enemies = this.enemies.filter(
        (e) => ENEMY_DEFS[e.kind].boss || Math.hypot(e.x - p.x, e.y - p.y) > 20 * 16,
      );
      this.screen = 'playing';
      this.wasNight = this.isNight();
      Music.setScene(this.wasNight ? 'night' : 'day');
      this.uiDirty = true;
    }
    this.followCam();
  }

  private tickGame(): void {
    const p = this.player;
    this.timeSec += 1 / 60;
    // 音乐场景: 入夜/清晨切换
    const night = this.isNight();
    if (night !== this.wasNight) {
      Music.setScene(night ? 'night' : 'day');
      this.wasNight = night;
    }
    if (this.useCooldown > 0) this.useCooldown--;
    if (this.placeCooldown > 0) this.placeCooldown--;
    if (p.swing) { p.swing.t++; if (p.swing.t >= p.swing.dur) p.swing = null; }
    this.devFly = this.devMode && this.keys.has('KeyF');

    // ---- 玩家 ----
    const prevVy = p.vy; // 落地冲击速度 ≈ prevVy + 重力(重力在 updatePlayer 内施加)
    const ev = this.devFly ? this.tickPlayerFly() : updatePlayer(this.world, p, this.moveInput(), this.frame);
    // 13-c: 防卡死安全网(旧档/极端情况嵌进方块时向上冒出, 正常时 no-op)
    if (unstickBody(this.world, p)) p.fallStart = null;
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

    // ---- 岩浆伤害(每 lavaTick 帧一次, 走无敌帧管线自带红闪+震动) ----
    if (!p.dead && this.frame % PLAYER_CONF.lavaTick === 0 && bodyInLava(this.world, p)) {
      this.hurtPlayer(PLAYER_CONF.lavaDmg, 0, true);
      burst(this.parts, p.x, p.y - p.h / 2, '#ff8a40', 6, 2, 0.05);
    }

    // ---- 智能光标目标 ----
    if (this.smart) this.computeSmart();
    else { this.smartTarget = null; this.smartPlace = null; }

    // ---- 使用手中物品(左键: 挖/放/武器) ----
    if (this.mouse.left && !this.invOpen && !this.mapOpen) this.useHeld();
    // 14-a: 挖掘裂纹残留清理 —— 未持续挖掘的进度逐渐回退归零移除(旧版永久残留);
    // 松开左键时清掉当前目标标记, 所有裂纹统一衰减
    if (!this.mouse.left) this.mineTarget = null;
    if (this.frame % 6 === 0 && this.mineDamage.size > 0) {
      const cur = this.mineTarget;
      for (const [idx, dmg] of this.mineDamage) {
        if (idx === cur && this.mouse.left) continue;
        const nd = dmg * 0.86;
        if (nd < 0.5) this.mineDamage.delete(idx);
        else this.mineDamage.set(idx, nd);
      }
    }

    // ---- 右键交互(边沿触发: 门 > 宝箱 > 向导 > 使用物品) ----
    if (this.mouse.right && !this.rightWas && !this.invOpen && !this.mapOpen) this.interactRight();
    this.rightWas = this.mouse.right;

    // ---- 投射物 ----
    this.tickProjs();

    // ---- 敌怪 ----
    this.tickEnemies();

    // ---- 向导 NPC ----
    if (this.guide) {
      updateGuide(this.world, this.guide, p.x, this.frame);
      unstickBody(this.world, this.guide);
    }

    // ---- 树苗生长 ----
    this.tickSaplings();

    // ---- 掉落物 ----
    this.tickDrops();

    // ---- 粒子/伤害数字 ----
    this.tickParticles();

    // ---- 环境生物(蝴蝶/萤火虫) ----
    this.tickAmbient();

    // ---- 宝箱距离检查 ----
    this.checkChestDistance();

    // ---- 世界 ----
    this.world.tickWater(420);
    this.world.tickGrass(26);

    // ---- 探索标记(每 60 帧一次局部圆) ----
    if (this.frame % 60 === 0) {
      this.markExplored(
        clamp(Math.floor(p.x / 16), 0, this.world.w - 1),
        clamp(Math.floor(p.y / 16), 0, this.world.h - 1),
      );
    }

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

  /** dev 飞行(F 按住): 无重力, W/S ±3.0 升降, A/D ×1.6 */
  private tickPlayerFly(): PlayerEvents {
    const p = this.player;
    const ev: PlayerEvents = { fell: 0, jumped: false, splash: false, landed: false };
    p.wasInWater = p.inWater;
    p.inWater = bodyInWater(this.world, p);
    p.headWater = tileAt(this.world, p.x, p.y - p.h + 6) === T.WATER;
    const canMove = !this.paused && !this.mapOpen;
    const left = canMove && (this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const right = canMove && (this.keys.has('KeyD') || this.keys.has('ArrowRight'));
    const up = canMove && (this.keys.has('KeyW') || this.keys.has('Space') || this.keys.has('ArrowUp'));
    const down = canMove && (this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const spd = PLAYER_CONF.runSpeed * 1.6;
    if (left && !right) { p.vx = Math.max(-spd, p.vx - 0.6); p.dir = -1; }
    else if (right && !left) { p.vx = Math.min(spd, p.vx + 0.6); p.dir = 1; }
    else { p.vx *= p.onGround ? 0.55 : 0.92; if (Math.abs(p.vx) < 0.04) p.vx = 0; }
    p.vy = up ? -3.0 : down ? 3.0 : 0;
    p.fallStart = null; // 飞行不计摔落
    moveBody(this.world, p, { platforms: true, dropThrough: down && !up, stepUp: true });
    if (p.onGround && Math.abs(p.vx) > 0.3) p.walkT += 0.16 + Math.abs(p.vx) * 0.06;
    else if (p.onGround) p.walkT = 0;
    return ev;
  }

  private followCam(): void {
    const p = this.player;
    // 14-a: 参考站相机 —— 玩家身体中心居于画面正中(50%/50%), lerp 0.15
    // (旧版 p.y - viewH*0.62 把人物压到画面下 1/3, 视觉上"不居中")
    const tx = p.x - this.viewW() / 2;
    const ty = (p.y - p.h / 2) - this.viewH() / 2;
    // 兜底(12-c): 玩家越出相机中心 0.5 视口范围(旋转屏/地址栏变化/异常传送) → 插值系数取 1 瞬移回中
    const outX = Math.abs(p.x - (this.camX + this.viewW() / 2)) > this.viewW() * 0.5;
    const outY = Math.abs((p.y - p.h / 2) - (this.camY + this.viewH() / 2)) > this.viewH() * 0.5;
    const k = outX || outY ? 1 : 0.15;
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
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

  // ==================== 使用物品(左键) ====================
  private useHeld(): void {
    const p = this.player;
    const held = p.inv[p.hotbar];
    const def = held ? ItemDefs[held.id] : null;
    const mw = this.getMouseWorld();
    const mgx = Math.floor(mw.x / 16), mgy = Math.floor(mw.y / 16);
    // 智能光标开 → 用 ray-march 目标; 关 → 用鼠标格
    const aim: { gx: number; gy: number } | null = this.smart ? this.smartTarget : { gx: mgx, gy: mgy };
    const pAim: { gx: number; gy: number } | null = this.smart ? this.smartPlace : { gx: mgx, gy: mgy };
    const pcx = p.x, pcy = p.y - p.h / 2;
    const inReach = (a: { gx: number; gy: number }): boolean =>
      Math.hypot((a.gx * 16 + 8) - pcx, (a.gy * 16 + 8) - pcy) <= REACH;

    if (!def || def.kind === 'tool') {
      // 挖掘(含工具挥砍命中敌人); 智能光标无目标时不挥
      if (this.smart && !aim) return;
      this.doSwing(held?.id ?? 0, def, mw);
      if (aim && (this.smart || inReach(aim))) {
        const cx = clamp(aim.gx, 0, this.world.w - 1), cy = clamp(aim.gy, 0, this.world.h - 1);
        this.mine(cx, cy, this.world.idx(cx, cy), def);
      } else this.mineTarget = null;
    } else if (def.kind === 'weapon') {
      this.mineTarget = null;
      if (def.ranged === 'arrow') this.shootArrow(held!, mw);
      else if (def.ranged === 'bomb') this.throwBomb(held!, mw);
      else this.doSwing(held!.id, def, mw);
    } else if ((def.kind === 'block' || def.kind === 'station') && def.tile !== undefined) {
      this.mineTarget = null;
      if (pAim && this.placeCooldown <= 0 && (this.smart || inReach(pAim))) this.place(pAim.gx, pAim.gy, held!, def.tile);
    } else {
      this.mineTarget = null;
    }
  }

  /** 射箭(消耗木箭) */
  private shootArrow(held: Slot, mw: { x: number; y: number }): void {
    if (this.useCooldown > 0) return;
    const p = this.player;
    if (this.countItem(IT.ARROW) <= 0) {
      if (this.frame - this.lastNoArrowMsg >= 120) {
        this.lastNoArrowMsg = this.frame;
        this.msg('没有箭了！', '#e07070');
      }
      return;
    }
    this.removeItems(IT.ARROW, 1);
    this.useCooldown = ItemDefs[held.id]?.useTime ?? 24;
    p.dir = mw.x >= p.x ? 1 : -1;
    p.swing = { itemId: held.id, t: 0, dur: 12, hits: new Set(), kind: 'arc' };
    this.projs.push(mkArrow(p.x, p.y - p.h / 2, mw.x, mw.y));
    SFX.bowShoot();
  }

  /** 投掷炸弹(消耗 1) */
  private throwBomb(held: Slot, mw: { x: number; y: number }): void {
    if (this.useCooldown > 0) return;
    const p = this.player;
    this.useCooldown = ItemDefs[held.id]?.useTime ?? 30;
    p.dir = mw.x >= p.x ? 1 : -1;
    p.swing = { itemId: held.id, t: 0, dur: 12, hits: new Set(), kind: 'arc' };
    this.projs.push(mkBomb(p.x, p.y - p.h / 2, mw.x, mw.y));
    held.count--;
    if (held.count <= 0) p.inv[p.hotbar] = null;
    SFX.bombThrow();
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

  /** 挖掘(含 minPower 镐力门槛) */
  private mine(gx: number, gy: number, idx: number, def: { power?: number; tool?: 'pick' | 'axe' } | null): void {
    const id = this.world.get(gx, gy);
    if (id === T.AIR || gy >= this.world.h - 3) { this.mineTarget = null; return; }
    const td = TileDefs[id];
    if (td.hardness < 0) { this.mineTarget = null; return; } // 水/岩浆/祭坛不可挖
    if (td.hardness <= 0) {
      // 一击碎(草丛/花/火把等)
      this.breakTile(gx, gy);
      return;
    }
    if (this.mineTarget !== idx) {
      // 14-a: 换目标时旧目标进度立即作废(裂纹由 tickGame 衰减清理)
      if (this.mineTarget !== null) this.mineDamage.delete(this.mineTarget);
      this.mineTarget = idx;
    }
    let power = def?.power ?? 3;
    if (def?.tool && td.tool !== 'any' && def.tool !== td.tool) power = Math.max(3, power * 0.25);
    const need = td.minPower ?? 0;
    if (power < need) {
      // 镐力不足: 进度缓慢衰减 + 节流提示
      const cur = this.mineDamage.get(idx) ?? 0;
      if (cur > 0.5) this.mineDamage.set(idx, cur * 0.92);
      else this.mineDamage.delete(idx);
      if (this.frame - this.lastMinPowerMsg >= 45) {
        this.lastMinPowerMsg = this.frame;
        this.msg('镐力不足！', '#e07070');
      }
      return;
    }
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
      let woods = 0, leaves = 0;
      for (const c of cells) {
        if (c.trunk) woods++;
        else leaves++;
        if (Math.random() < 0.35) burst(this.parts, c.x * 16 + 8, c.y * 16 + 8, '#5cb85c', 2, 1.8, 0.15);
      }
      for (let i = 0; i < woods; i++) {
        this.drops.push(mkDrop(IT.WOOD, 1, gx * 16 + 8 + (Math.random() - 0.5) * 20, gy * 16 + 4));
      }
      // 树叶 8% 掉橡子
      for (let i = 0; i < leaves; i++) {
        if (Math.random() < 0.08) this.drops.push(mkDrop(IT.ACORN, 1, gx * 16 + 8 + (Math.random() - 0.5) * 24, gy * 16 + 4));
      }
      this.mineDamage.delete(this.world.idx(gx, gy));
      return;
    }

    if (td.furnitureGroup) {
      if (td.furnitureGroup === 'chest') this.spillChestAt(gx, gy);
      const cells = this.world.clearFurniture(gx, gy);
      for (const c of cells) this.mineDamage.delete(this.world.idx(c.x, c.y));
      if (td.drop) this.drops.push(mkDrop(td.drop, 1, gx * 16 + 8, gy * 16 + 8));
      return;
    }

    if (id === T.SAPLING) {
      this.saplings = this.saplings.filter((s) => s.x !== gx || s.y !== gy);
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
    // 木门特殊: 需 (x,y)与(x,y+1) 均 AIR 且 (x,y+2) 实心, 底格不夹实体
    if (tileId === T.DOOR_C_T) {
      if (gx < 1 || gx >= this.world.w - 1 || gy < 1 || gy >= this.world.h - 4) return;
      if (this.world.get(gx, gy) !== T.AIR || this.world.get(gx, gy + 1) !== T.AIR) return;
      if (!this.world.isSolid(gx, gy + 2)) return;
      if (this.cellBlocked(gx, gy + 1)) return;
      this.world.set(gx, gy, T.DOOR_C_T);
      this.world.set(gx, gy + 1, T.DOOR_C_B);
      this.consumeHeld(held);
      this.placeCooldown = 10;
      SFX.place();
      burst(this.parts, gx * 16 + 8, gy * 16 + 16, '#8a6a42', 4, 1.2, 0.15);
      this.uiDirty = true;
      return;
    }
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
    // 实心方块不能与玩家/敌怪/向导重叠
    if (TileDefs[tileId].solid) {
      const boxes: Body[] = [this.player, ...this.enemies];
      if (this.guide) boxes.push(this.guide);
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
    // 玩家放的宝箱 = 空箱
    if (tileId === T.CHEST_TL) {
      this.chestContents.set(this.world.idx(gx, gy), new Array(CHEST_SLOTS).fill(null));
    }
    this.consumeHeld(held);
    this.placeCooldown = 10;
    SFX.place();
    burst(this.parts, gx * 16 + 8, gy * 16 + 8, TileDefs[tileId].particleColor, 4, 1.2, 0.15);
    this.uiDirty = true;
  }

  private consumeHeld(held: Slot): void {
    held.count--;
    if (held.count <= 0) this.player.inv[this.player.hotbar] = null;
  }

  /** 多格家具的子格 ID */
  private placeTileId(main: number, dx: number, dy: number): number {
    if (main === T.WORKBENCH_L) return dx === 0 ? T.WORKBENCH_L : T.WORKBENCH_R;
    if (main === T.ANVIL_L) return dx === 0 ? T.ANVIL_L : T.ANVIL_R;
    if (main === T.FURNACE_TL) {
      if (dy === 0) return dx === 0 ? T.FURNACE_TL : T.FURNACE_TR;
      return dx === 0 ? T.FURNACE_BL : T.FURNACE_BR;
    }
    if (main === T.CHEST_TL) {
      if (dy === 0) return dx === 0 ? T.CHEST_TL : T.CHEST_TR;
      return dx === 0 ? T.CHEST_BL : T.CHEST_BR;
    }
    if (main === T.TABLE_L) return dx === 0 ? T.TABLE_L : T.TABLE_R;
    if (main === T.DOOR_C_T) return dy === 0 ? T.DOOR_C_T : T.DOOR_C_B;
    return main;
  }

  // ==================== 右键交互(门 > 宝箱 > 向导 > 使用物品) ====================
  private interactRight(): void {
    if (this.screen !== 'playing' || this.paused || this.player.dead) return;
    const p = this.player;
    const mw = this.getMouseWorld();
    const gx = clamp(Math.floor(mw.x / 16), 0, this.world.w - 1);
    const gy = clamp(Math.floor(mw.y / 16), 0, this.world.h - 1);
    const id = this.world.get(gx, gy);
    const pcx = p.x, pcy = p.y - p.h / 2;
    const inReach = Math.hypot((gx * 16 + 8) - pcx, (gy * 16 + 8) - pcy) <= REACH;

    // 1) 门
    if (id >= T.DOOR_C_T && id <= T.DOOR_O_B) {
      if (inReach) this.tryToggleDoor(gx, gy);
      return;
    }
    // 2) 宝箱
    if (id >= T.CHEST_TL && id <= T.CHEST_BR) {
      if (inReach) this.openChestAt(gx, gy);
      return;
    }
    // 3) 向导(点击其附近 48px —— 半径收窄,避免站在向导身边时右键使用物品被频繁拦截)
    if (this.guide) {
      const g = this.guide;
      if (Math.hypot(mw.x - g.x, mw.y - (g.y - g.h / 2)) < 48) {
        this.talkGuide();
        return;
      }
    }
    // 4) 手持可使用物品(生命水晶/召唤物/橡子)
    this.useItem();
  }

  /** 开关门: 主格=DOOR_*_T; 关门需目标格无实体 */
  private tryToggleDoor(gx: number, gy: number): boolean {
    let x = gx, y = gy;
    const hit = this.world.get(x, y);
    if (hit === T.DOOR_C_B || hit === T.DOOR_O_B) y -= 1; // 主格是上格
    const t0 = this.world.get(x, y), t1 = this.world.get(x, y + 1);
    if (t0 === T.DOOR_C_T && t1 === T.DOOR_C_B) {
      // 关 → 开
      this.world.set(x, y, T.DOOR_O_T);
      this.world.set(x, y + 1, T.DOOR_O_B);
      SFX.doorOpen();
      return true;
    }
    if (t0 === T.DOOR_O_T && t1 === T.DOOR_O_B) {
      // 开 → 关: 两格无实体才合法(防夹)
      if (this.cellBlocked(x, y) || this.cellBlocked(x, y + 1)) {
        this.msg('门被挡住了！', '#e07070');
        return false;
      }
      this.world.set(x, y, T.DOOR_C_T);
      this.world.set(x, y + 1, T.DOOR_C_B);
      SFX.doorClose();
      return true;
    }
    return false; // 半扇门/被破坏 → 拒绝
  }

  /** 格子(16x16)是否被玩家/敌怪/向导占据 */
  private cellBlocked(x: number, y: number): boolean {
    const bx = x * 16 + 8, top = y * 16 + 1, bot = (y + 1) * 16 - 1;
    const boxes: Body[] = [this.player, ...this.enemies.filter((e) => !e.dead)];
    if (this.guide) boxes.push(this.guide);
    for (const b of boxes) {
      if (Math.abs(b.x - bx) < 8 + b.w / 2 && b.y > top && b.y - b.h < bot) return true;
    }
    return false;
  }

  // ==================== 宝箱 ====================
  /** 从任意宝箱格定位主格(TL) */
  private chestMainCell(gx: number, gy: number): { x: number; y: number } | null {
    const isChest = (x: number, y: number): boolean => {
      const id = this.world.get(x, y);
      return id >= T.CHEST_TL && id <= T.CHEST_BR;
    };
    if (!isChest(gx, gy)) return null;
    while (isChest(gx - 1, gy)) gx--;
    while (isChest(gx, gy - 1)) gy--;
    return { x: gx, y: gy };
  }

  private openChestAt(gx: number, gy: number): void {
    const m = this.chestMainCell(gx, gy);
    if (!m) return;
    const idx = this.world.idx(m.x, m.y);
    if (this.chestOpen === idx) { this.closeChest(); return; } // 再右键 = 关闭
    if (!this.chestContents.has(idx)) {
      this.chestContents.set(idx, new Array(CHEST_SLOTS).fill(null));
    }
    this.chestOpen = idx;
    SFX.chestOpen();
    this.uiDirty = true;
  }

  closeChest(): void {
    if (this.chestOpen === null) return;
    this.chestOpen = null;
    this.returnCursorToInv();
    this.uiDirty = true;
  }

  /** 每帧检查: 玩家离宝箱太远自动关闭 */
  private checkChestDistance(): void {
    if (this.chestOpen === null) return;
    const w = this.world;
    const x = this.chestOpen % w.w, y = (this.chestOpen / w.w) | 0;
    const cx = x * 16 + 16, cy = y * 16 + 16;
    const p = this.player;
    if (Math.hypot(cx - p.x, cy - (p.y - p.h / 2)) > REACH) this.closeChest();
  }

  /** 挖掉/炸掉宝箱: 撒出全部内容并删除登记 */
  private spillChestAt(gx: number, gy: number): void {
    const m = this.chestMainCell(gx, gy);
    if (!m) return;
    const idx = this.world.idx(m.x, m.y);
    const slots = this.chestContents.get(idx);
    if (slots) {
      for (const s of slots) {
        if (s) this.drops.push(mkDrop(s.id, s.count, m.x * 16 + 16 + (Math.random() - 0.5) * 20, m.y * 16 + 14 + (Math.random() - 0.5) * 12));
      }
      this.chestContents.delete(idx);
    }
    if (this.chestOpen === idx) this.closeChest();
  }

  // ==================== 向导 ====================
  private talkGuide(): void {
    const g = this.guide;
    if (!g) return;
    g.talkT = 180;
    SFX.guideTalk();
    let line = this.guideLine;
    if (GUIDE_LINES.length > 1) {
      while (line === this.guideLine) line = GUIDE_LINES[(Math.random() * GUIDE_LINES.length) | 0];
    }
    this.guideLine = line;
    this.guideLineUntil = this.frame + 180;
  }

  // ==================== 右键使用类物品 ====================
  private useItem(): void {
    const held = this.player.inv[this.player.hotbar];
    if (!held) return;
    if (held.id === IT.LIFE_CRYSTAL) this.useLifeCrystal(held);
    else if (held.id === IT.EYE_SUMMON) this.useEyeSummon(held);
    else if (held.id === IT.ACORN) this.useAcorn(held);
  }

  private useLifeCrystal(held: Slot): void {
    const p = this.player;
    if (p.maxHp >= HP_CAP) {
      this.msg(`生命上限已达 ${HP_CAP}！`, '#e0c060');
      return;
    }
    p.maxHp = Math.min(HP_CAP, p.maxHp + 20);
    p.hp = Math.min(p.maxHp, p.hp + 20);
    SFX.crystal();
    this.msg(`生命上限提升至 ${p.maxHp}！`, '#f090b0');
    this.consumeHeld(held);
    this.uiDirty = true;
  }

  private useEyeSummon(held: Slot): void {
    const p = this.player;
    if (!this.isNight()) {
      this.msg('它只在黑夜回应……', '#9a8ab8');
      return;
    }
    if (this.boss && !this.boss.dead) {
      this.msg('克苏鲁之眼已经在这里了！', '#e07070');
      return;
    }
    // 13-c: 找一个无遮挡的召唤位(玩家后方高处优先, 依次尝试偏移), 防止 Boss 卡进地形
    const bd = ENEMY_DEFS.eoc;
    const cand: [number, number][] = [
      [p.x - p.dir * 260, p.y - 240],
      [p.x + p.dir * 260, p.y - 240],
      [p.x - p.dir * 340, p.y - 320],
      [p.x + p.dir * 340, p.y - 320],
      [p.x, p.y - 360],
    ];
    let sx = cand[0][0], sy = cand[0][1];
    for (const [cx2, cy2] of cand) {
      if (boxClear(this.world, cx2, cy2, bd.w / 2, bd.h)) { sx = cx2; sy = cy2; break; }
    }
    const e = spawnEnemy('eoc', sx, sy);
    this.enemies.push(e);
    this.boss = e;
    this.bossPhaseWas = 0;
    this.bossHitTally = 0;
    SFX.bossRoar();
    this.shake = 6;
    this.msg('克苏鲁之眼苏醒了！！', '#e07070');
    this.consumeHeld(held);
    this.uiDirty = true;
  }

  private useAcorn(held: Slot): void {
    const p = this.player;
    const mw = this.getMouseWorld();
    const aim = this.smart ? this.smartPlace : { gx: Math.floor(mw.x / 16), gy: Math.floor(mw.y / 16) };
    if (!aim) return;
    const gx = clamp(aim.gx, 0, this.world.w - 1), gy = clamp(aim.gy, 0, this.world.h - 1);
    if (Math.hypot((gx * 16 + 8) - p.x, (gy * 16 + 8) - (p.y - p.h / 2)) > REACH) return;
    if (this.world.get(gx, gy) !== T.AIR) return;
    const below = this.world.get(gx, gy + 1);
    if (below !== T.GRASS && below !== T.JUNGLE_GRASS && below !== T.CORRUPT_GRASS && below !== T.SNOW) return;
    this.world.set(gx, gy, T.SAPLING);
    this.saplings.push({ x: gx, y: gy, t: 0, due: SAPLING_MIN + Math.random() * SAPLING_RND });
    SFX.plant();
    burst(this.parts, gx * 16 + 8, gy * 16 + 8, '#6cc25a', 5, 1.2, 0.1);
    this.consumeHeld(held);
    this.uiDirty = true;
  }

  // ==================== 智能光标 ====================
  /** 从玩家中心朝鼠标方向 ray-march(步长 8px, 上限 REACH): 命中实心/可挖格 = 挖掘目标; 命中前最后一个 AIR = 放置目标 */
  private computeSmart(): void {
    const p = this.player;
    const ox = p.x, oy = p.y - p.h / 2;
    const mw = this.getMouseWorld();
    const dx = mw.x - ox, dy = mw.y - oy;
    const d = Math.hypot(dx, dy);
    this.smartTarget = null;
    this.smartPlace = null;
    if (d < 1) return;
    const ux = dx / d, uy = dy / d;
    let lastAir: { gx: number; gy: number } | null = null;
    for (let t = 0; t <= REACH; t += 8) {
      const px = ox + ux * t, py = oy + uy * t;
      const gx = Math.floor(px / 16), gy = Math.floor(py / 16);
      if (gx < 0 || gy < 0 || gx >= this.world.w || gy >= this.world.h) break;
      const id = this.world.get(gx, gy);
      if (id === T.AIR) { lastAir = { gx, gy }; continue; }
      const td = TileDefs[id];
      if (td.solid || (td.hardness > 0 && id !== T.WATER && id !== T.LAVA)) {
        this.smartTarget = { gx, gy };
        this.smartPlace = lastAir;
        return;
      }
      // 液体/装饰 → 穿过(不作为放置候选)
    }
    this.smartPlace = lastAir;
  }

  // ==================== 投射物 ====================
  private tickProjs(): void {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const pr = this.projs[i];
      const res = updateProj(this.world, pr);
      if (res === 'gone') { this.projs.splice(i, 1); continue; }
      if (res === 'explode') {
        const { x, y } = pr;
        this.projs.splice(i, 1);
        this.explode(x, y);
        continue;
      }
      // 飞行中的箭: 命中敌怪(含 Boss)
      if (pr.kind === 'arrow' && !pr.stuck) {
        for (const e of this.enemies) {
          if (e.dead) continue;
          const cy = e.y - e.h / 2;
          if (Math.abs(pr.x - e.x) < e.w / 2 + 3 && Math.abs(pr.y - cy) < e.h / 2 + 3) {
            this.hitEnemy(e, ItemDefs[IT.BOW].dmg ?? 9, pr.vx >= 0 ? 1 : -1, 'arrow');
            this.projs.splice(i, 1);
            break;
          }
        }
      }
    }
  }

  /** 爆炸: 半径 3.5 格破坏(hardness∈[0,600)) + 实体伤害 + 震动/粒子/音效 */
  private explode(x: number, y: number): void {
    const w = this.world;
    const cx = x / 16, cy = y / 16;
    const gx0 = Math.max(1, Math.floor(cx) - 4), gx1 = Math.min(w.w - 2, Math.floor(cx) + 4);
    const gy0 = Math.max(1, Math.floor(cy) - 4), gy1 = Math.min(w.h - 3, Math.floor(cy) + 4);
    const broken: { x: number; y: number; color: string }[] = [];
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const d = Math.hypot(gx + 0.5 - cx, gy + 0.5 - cy);
        if (d > 3.5) continue;
        const id = w.get(gx, gy);
        if (id === T.AIR) continue;
        const td = TileDefs[id];
        if (td.hardness < 0 || td.hardness >= 600) continue; // 岩浆/祭坛/狱岩不动
        if (td.furnitureGroup === 'chest') {
          this.spillChestAt(gx, gy);
          const cells = w.clearFurniture(gx, gy);
          for (const c of cells) this.mineDamage.delete(w.idx(c.x, c.y));
          if (Math.random() < 0.6 && td.drop) this.drops.push(mkDrop(td.drop, 1, gx * 16 + 8, gy * 16 + 8));
          continue;
        }
        if (id === T.TRUNK) {
          const cells = w.fellTree(gx, gy);
          let woods = 0;
          for (const c of cells) { if (c.trunk) woods++; this.mineDamage.delete(w.idx(c.x, c.y)); }
          for (let k = 0; k < woods; k++) {
            if (Math.random() < 0.6) this.drops.push(mkDrop(IT.WOOD, 1, gx * 16 + 8 + (Math.random() - 0.5) * 20, gy * 16 + 4));
          }
          continue;
        }
        if (td.furnitureGroup) {
          const cells = w.clearFurniture(gx, gy);
          for (const c of cells) this.mineDamage.delete(w.idx(c.x, c.y));
          if (Math.random() < 0.6 && td.drop) this.drops.push(mkDrop(td.drop, 1, gx * 16 + 8, gy * 16 + 8));
          continue;
        }
        w.set(gx, gy, T.AIR);
        this.mineDamage.delete(w.idx(gx, gy));
        if (td.drop && Math.random() < 0.6) this.drops.push(mkDrop(td.drop, 1, gx * 16 + 8, gy * 16 + 8));
        broken.push({ x: gx, y: gy, color: td.particleColor });
      }
    }
    for (let i = 0; i < broken.length && i < 14; i++) {
      burst(this.parts, broken[i].x * 16 + 8, broken[i].y * 16 + 8, broken[i].color, 2, 2, 0.2);
    }
    // 敌怪伤害(80px 内 60*(1-d/90), 含防御减伤)
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, (e.y - e.h / 2) - y);
      if (d > 80) continue;
      const raw = BOMB_DMG * (1 - d / 90);
      const dmg = Math.max(1, Math.round(raw - (ENEMY_DEFS[e.kind].def ?? 0)));
      e.hp -= dmg;
      e.flash = 8;
      e.hpShow = 160;
      e.vx += (e.x >= x ? 1 : -1) * 4 * (1 - e.kb * 0.6);
      e.vy = Math.min(e.vy, -3);
      this.dmgs.push({
        x: e.x + (Math.random() - 0.5) * 8, y: e.y - e.h - 6,
        vy: -1.1, text: String(dmg), color: '#ffb060', life: 46, crit: false,
      });
      if (e.hp <= 0) this.killEnemy(e);
    }
    // 玩家自伤 ×0.5(走 hurtPlayer 无敌帧)
    const p = this.player;
    if (!p.dead) {
      const d = Math.hypot(p.x - x, (p.y - p.h / 2) - y);
      if (d <= 80) {
        this.hurtPlayer(Math.max(1, Math.round(BOMB_DMG * (1 - d / 90) * 0.5)), p.x >= x ? 1 : -1, true);
      }
    }
    this.shake = 8;
    SFX.explosion();
    burst(this.parts, x, y, '#ff9a3c', 20, 4.2, 0.06);   // 火橙
    burst(this.parts, x, y, '#6a6a6a', 14, 2.4, -0.02);  // 烟灰
    burst(this.parts, x, y, '#ffd75e', 8, 3, 0.1);
  }

  // ==================== 敌怪 ====================
  private hitEnemy(e: Enemy, dmg: number, dir: 1 | -1, sfx: 'melee' | 'arrow' = 'melee'): void {
    const def = ENEMY_DEFS[e.kind];
    const crit = Math.random() < 0.1;
    const raw = dmg * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1);
    const final = Math.max(1, Math.round(raw - (def.def ?? 0)));
    e.hp -= final;
    e.flash = 8;
    e.hpShow = 160;
    e.vx += dir * 3.2 * (1 - e.kb * 0.6);
    e.vy = Math.min(e.vy, -2.4);
    this.dmgs.push({
      x: e.x + (Math.random() - 0.5) * 8, y: e.y - e.h - 6,
      vy: -1.1, text: String(final), color: crit ? '#ffd75e' : '#ffffff', life: 46, crit,
    });
    if (def.boss) {
      this.bossHitTally++;
      if (this.bossHitTally % 6 === 0) SFX.bossHit();
    } else if (sfx === 'arrow') {
      SFX.arrowHit();
    } else {
      SFX.enemyHit();
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy): void {
    e.dead = true;
    const def = ENEMY_DEFS[e.kind];
    burst(this.parts, e.x, e.y - e.h / 2, def.mapColor, 16, 3, 0.2);
    if (def.boss) {
      SFX.bossDie();
      this.msg('你击败了克苏鲁之眼！', '#f7d060');
      this.boss = null;
      this.bossPhaseWas = 0;
      this.bossHitTally = 0;
      const ore = 18 + ((Math.random() * 13) | 0);   // 18-30 魔金
      const lens = 3 + ((Math.random() * 3) | 0);    // 3-5 晶状体
      this.drops.push(mkDrop(IT.DEMONITE_ORE, ore, e.x, e.y - 12));
      this.drops.push(mkDrop(IT.LENS, lens, e.x, e.y - 12));
      this.shake = 10;
      this.uiDirty = true;
      return;
    }
    SFX.enemyDie();
    if (def.gelDrop) {
      const [a, b] = def.gelDrop;
      const n = a + Math.floor(Math.random() * (b - a + 1));
      if (n > 0) this.drops.push(mkDrop(IT.GEL, n, e.x, e.y - 8));
    }
    if (e.kind === 'zombie' && Math.random() < 0.35) {
      this.drops.push(mkDrop(Math.random() < 0.5 ? IT.TORCH : IT.STONE, 1 + (Math.random() * 2 | 0), e.x, e.y - 8));
    }
    if (def.lensDrop && Math.random() < def.lensDrop) {
      this.drops.push(mkDrop(IT.LENS, 1, e.x, e.y - 8));
    }
  }

  private tickEnemies(): void {
    const p = this.player;
    const night = this.isNight();
    for (const e of this.enemies) {
      updateEnemy(this.world, e, p.x, p.y, night, this.frame);
      const def = ENEMY_DEFS[e.kind];
      // 13-c: 防卡死安全网 + 长期嵌死敌怪静默移除(10s 仍出不来则消散, 防止"卡死+黑暗中隐形"的僵尸)
      unstickBody(this.world, e);
      if (!boxClear(this.world, e.x, e.y, e.w / 2, e.h)) {
        e.stuck = (e.stuck ?? 0) + 1;
        if (!def.boss && (e.stuck ?? 0) > 600) {
          burst(this.parts, e.x, e.y - e.h / 2, '#6a6a8a', 8, 1.6, -0.02);
          e.dead = true;
          continue;
        }
      } else {
        e.stuck = 0;
      }
      // 白天夜怪消散(Boss 豁免 — 由 flee 机制处理)
      if (!night && e.night && !def.boss && Math.random() < 0.012) {
        burst(this.parts, e.x, e.y - e.h / 2, '#6a6a8a', 8, 1.6, -0.02);
        e.dead = true;
        continue;
      }
      // Boss 管理: 阶段跳变狂怒音效 / flee 出屏移除
      if (def.boss && this.boss === e) {
        const ph = e.phase ?? 0;
        if (ph === 1 && this.bossPhaseWas === 0) SFX.bossRoar();
        this.bossPhaseWas = ph;
        if (e.mode === 'flee' && e.y < this.camY - 300) {
          e.dead = true;
          this.boss = null;
          this.msg('克苏鲁之眼逃走了……', '#9a8ab8');
          this.uiDirty = true;
          continue;
        }
      }
      // 岩浆伤害(lslime 免疫; 每 30 帧扣 30)
      if (e.kind !== 'lslime' && this.frame % 30 === 0 && bodyInLava(this.world, e)) {
        e.hp -= 30;
        e.flash = 6;
        e.hpShow = 160;
        this.dmgs.push({
          x: e.x, y: e.y - e.h - 6, vy: -1, text: '30', color: '#ff9040', life: 40, crit: false,
        });
        if (e.hp <= 0) { this.killEnemy(e); continue; }
      }
      // flee 状态不造成接触伤害
      if (e.mode === 'flee') continue;
      // 碰撞玩家(14-a: 精确 AABB —— 旧版上下各膨胀 e.h/2, 隔一格也能打到人)
      if (!p.dead && p.iframes <= 0 && p.spawnProt <= 0) {
        if (Math.abs(e.x - p.x) < (e.w + p.w) / 2
          && e.y > p.y - p.h && e.y - e.h < p.y) {
          const dmg = Math.max(1, Math.round(e.dmg * (0.9 + Math.random() * 0.2)));
          this.hurtPlayer(dmg, e.x > p.x ? -1 : 1, false);
        }
      }
    }
    if (this.boss && (this.boss.dead || !this.enemies.includes(this.boss))) this.boss = null;
    this.enemies = this.enemies.filter(
      (e) => !e.dead && (ENEMY_DEFS[e.kind].boss || Math.hypot(e.x - p.x, e.y - p.y) < 70 * 16),
    );
  }

  private hurtPlayer(raw: number, dir: number, noKb: boolean): void {
    const p = this.player;
    if (p.dead || p.iframes > 0) return;
    const dmg = Math.max(1, Math.round(raw - this.defense() * 0.5)); // 盔甲减伤
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
    if (this.chestOpen !== null) this.closeChest();
    this.mapOpen = false;
    burst(this.parts, p.x, p.y - p.h / 2, '#c03030', 26, 3.4, 0.22);
    burst(this.parts, p.x, p.y - p.h / 2, '#f0c8a0', 14, 2.6, 0.22);
    SFX.death();
    this.shake = 8; // 死亡更震撼
    this.screen = 'dead';
    Music.setScene('title');
    this.uiDirty = true;
  }

  /** 分层群系刷怪: 地表(昼夜+群系池) / 洞穴(bat+skel) / 地狱(lslime+bat) */
  private tickSpawn(): void {
    this.spawnTimer--;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = 80 + Math.random() * 80;
    const w = this.world;
    const p = this.player;
    // Boss 不占普通刷怪上限
    let count = 0;
    for (const e of this.enemies) if (!ENEMY_DEFS[e.kind].boss) count++;
    const pgx = clamp(Math.floor(p.x / 16), 2, w.w - 3);
    const pgy = clamp(Math.floor(p.y / 16), 2, w.h - 3);
    const dl = w.dirtLine[pgx] ?? w.surface[pgx] + 15;
    const hellY = w.hellY;
    const night = this.isNight();
    const biome = w.biomeAt(pgx);

    let cap: number;
    let pool: EnemyKind[];
    let layer: 'surface' | 'cave' | 'hell';
    if (pgy < dl + 10) {
      layer = 'surface';
      if (night) {
        cap = MAX_ENEMIES_NIGHT;
        pool = biome === BIOME.CORRUPTION ? ['zombie', 'eye', 'eos'] : ['zombie', 'eye'];
      } else {
        cap = MAX_ENEMIES_DAY;
        pool = biome === BIOME.JUNGLE ? ['bslime', 'bslime', 'gslime']
          : biome === BIOME.CORRUPTION ? ['eos']
            : ['gslime', 'bslime'];
      }
    } else if (pgy < hellY) {
      layer = 'cave';
      cap = MAX_ENEMIES_CAVE;
      pool = pgy > dl + 40 ? ['bat', 'skel'] : ['bat'];
    } else {
      layer = 'hell';
      cap = MAX_ENEMIES_HELL;
      pool = ['lslime', 'bat'];
    }
    if (count >= cap) return;
    const kind = pool[(Math.random() * pool.length) | 0];
    const def = ENEMY_DEFS[kind];

    // 屏幕边缘列 + 不在视野内
    const side = Math.random() < 0.5 ? -1 : 1;
    const gx = clamp(pgx + side * (26 + Math.floor(Math.random() * 14)), 2, w.w - 3);
    const camL = this.camX / 16 - 2, camR = (this.camX + this.viewW()) / 16 + 2;
    if (gx > camL && gx < camR) return;
    const x = gx * 16 + 8;
    let y = 0;
    if (layer === 'surface') {
      if (def.fly) {
        y = p.y - (12 + Math.random() * 10) * 16;
        if (y < 32) return;
        // 13-c: 飞行敌怪整身盒须无实心(防在山体/悬崖内出生 → 卡死+黑暗中隐形)
        if (!boxClear(w, x, y - 1, def.w / 2, def.h)) return;
      } else {
        const sy = w.surface[gx];
        y = sy * 16; // 出生脚底 = 地面顶(spawnEnemy 内部 -1px 悬空)
        // 13-c: 整身高度所在列须全 AIR(旧检查只查 2 格, 僵尸/骷髅 3 格高会头嵌悬崖/树冠)
        const topK = Math.ceil(def.h / 16) + 1;
        for (let k = 1; k <= topK; k++) {
          if (w.get(gx, sy - k) !== T.AIR) return;
        }
        if (!boxClear(w, x, y, def.w / 2, def.h)) return;
      }
    } else {
      // 洞穴/地狱: 在对应层内找合法空腔(地面敌怪需脚下实心; 避开岩浆正上方)
      const y0 = layer === 'cave' ? dl + 10 : hellY;
      const y1 = layer === 'cave' ? hellY - 1 : w.h - 3;
      let found = -1;
      for (let tries = 0; tries < 24; tries++) {
        const yy = clamp(pgy + ((Math.random() * 29) | 0) - 14, y0, y1);
        if (w.get(gx, yy) !== T.AIR) continue;
        if (w.get(gx, yy - 1) === T.LAVA || w.get(gx, yy + 1) === T.LAVA) continue;
        if (def.fly) { found = yy; break; }
        if (w.isSolid(gx, yy + 1)) { found = yy; break; }
      }
      if (found < 0) return;
      if (def.fly) {
        y = found * 16;
        // 13-c: 飞行敌怪整身 clearance(蝙蝠/噬魂者可能宽于 1 列)
        if (!boxClear(w, x, y - 1, def.w / 2, def.h)) return;
      } else {
        y = (found + 1) * 16; // 13-c: 直接站上 found+1 实心格顶(旧版出生高 17px 且只查 1 格 → 头嵌顶棚)
        if (!boxClear(w, x, y, def.w / 2, def.h)) return;
      }
    }
    this.enemies.push(spawnEnemy(kind, x, y));
  }

  // ==================== dev 工具 ====================
  /** dev G: 鼠标处随机刷一只普通敌怪 */
  private devSpawn(): void {
    const kinds: EnemyKind[] = ['gslime', 'bslime', 'zombie', 'eye', 'bat', 'skel', 'lslime', 'eos'];
    const kind = kinds[(Math.random() * kinds.length) | 0];
    const mw = this.getMouseWorld();
    this.enemies.push(spawnEnemy(kind, mw.x, mw.y));
    this.msg(`[dev] 生成 ${ENEMY_DEFS[kind].name}`, '#8ee8e8');
  }

  /** dev N: 昼夜取反跳转(白天正午 0.3 / 午夜 0.7) */
  private devTime(): void {
    const d = this.dayT();
    const target = d < 0.5 ? 0.7 : 0.3;
    this.timeSec = this.timeSec - (this.timeSec % CYCLE) + CYCLE * target;
    this.msg(`[dev] 时间跳转至${target === 0.3 ? '正午' : '午夜'}`, '#8ee8e8');
  }

  // ==================== 树苗生长 ====================
  private tickSaplings(): void {
    for (let i = this.saplings.length - 1; i >= 0; i--) {
      const s = this.saplings[i];
      s.t++;
      if (s.t >= s.due) {
        if (this.growSapling(s.x, s.y)) this.saplings.splice(i, 1);
        else { s.t = 0; s.due = SAPLING_MIN + Math.random() * SAPLING_RND; } // 被堵 → 稍后重试
      }
    }
  }

  /** 尝试长成树: 按下方草类型决定树冠; 上方 6-10 格须为空 */
  private growSapling(x: number, y: number): boolean {
    if (this.world.get(x, y) !== T.SAPLING) return true; // 已被破坏/移走
    const below = this.world.get(x, y + 1);
    let leaf: number = T.LEAF;
    if (below === T.JUNGLE_GRASS) leaf = T.LEAF_JUNGLE;
    else if (below === T.CORRUPT_GRASS) leaf = T.LEAF_CORRUPT;
    else if (below === T.SNOW) leaf = T.LEAF_SNOW;
    else if (below !== T.GRASS) return false; // 下方不再是草 → 不长
    const h = 5 + ((Math.random() * 4) | 0); // 树干 5-8
    // 需要上方 h+1 格空(树干 + 2 行树冠余量)
    for (let k = 1; k <= h + 1; k++) {
      if (this.world.get(x, y - k) !== T.AIR) return false;
    }
    const top = y - h + 1; // 树干顶格
    for (let k = 0; k < h; k++) this.world.set(x, y - k, T.TRUNK);
    // 树冠: top-2 行 3 宽, top-1 行 5 宽, top 行 5 宽(中间是树干)
    for (let dy = -2; dy <= 0; dy++) {
      const ty = top + dy;
      const half = dy === -2 ? 1 : 2;
      for (let dx = -half; dx <= half; dx++) {
        if (dx === 0 && dy >= -1) continue; // 树干列
        if (this.world.get(x + dx, ty) === T.AIR) this.world.set(x + dx, ty, leaf);
      }
    }
    burst(this.parts, x * 16 + 8, top * 16, '#5cb85c', 10, 1.8, 0.1);
    return true;
  }

  // ==================== 掉落物 ====================
  private tickDrops(): void {
    const p = this.player;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      // 13-c: 掉进岩浆的物品烧毁(原版行为, 防止掉落物永远卡在岩浆里)
      if (tileAt(this.world, d.x, d.y - 4) === T.LAVA) {
        this.drops.splice(i, 1);
        this.noPickup.delete(d);
        burst(this.parts, d.x, d.y - 4, '#ff8a40', 6, 1.8, 0.02);
        continue;
      }
      updateDrop(this.world, d);
      const noPick = this.noPickup.get(d) ?? 0;
      if (noPick > 0) { this.noPickup.set(d, noPick - 1); continue; }
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
          this.noPickup.delete(d);
        } else {
          d.count = rest;
          this.noPickup.set(d, 60);
        }
      } else if (d.age > 60 * 300) {
        this.drops.splice(i, 1);
        this.noPickup.delete(d);
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

  // ==================== 小地图 + 全屏地图 ====================
  private buildTileColors(): void {
    this.mmColors = [];
    for (let i = 0; i < 64; i++) {
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
      else if (wall > 0) { data[p] = 40; data[p + 1] = 38; data[p + 2] = 40; data[p + 3] = 255; }
      else { data[p] = 0; data[p + 1] = 0; data[p + 2] = 0; data[p + 3] = 0; }
    } else {
      const c = this.mmColors[id] ?? [128, 128, 128, 255];
      data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
    }
  }

  /** 全屏地图离屏画布(1px=1格): AIR+无墙=深天蓝 / AIR+有墙=近黑 / 其他=mapColor */
  buildMapCanvas(): void {
    const c = this.mapCanvas ?? document.createElement('canvas');
    c.width = this.world.w;
    c.height = this.world.h;
    const cx = c.getContext('2d')!;
    const img = cx.createImageData(this.world.w, this.world.h);
    for (let y = 0; y < this.world.h; y++) {
      for (let x = 0; x < this.world.w; x++) {
        this.paintMapCell(img.data, x, y);
      }
    }
    cx.putImageData(img, 0, 0);
    this.mapCanvas = c;
    this.mapImg = img;
    this.mapDirty.clear();
  }

  private paintMapCell(data: Uint8ClampedArray, x: number, y: number): void {
    const i = y * this.world.w + x;
    const id = this.world.tiles[i];
    const p = i * 4;
    let r = 0, g = 0, b = 0;
    if (id === T.AIR) {
      if (this.world.walls[i] > 0) { r = 16; g = 14; b = 18; }
      else { r = 52; g = 84; b = 138; }
    } else {
      const c = this.mmColors[id];
      if (c) { r = c[0]; g = c[1]; b = c[2]; }
      else { r = 110; g = 110; b = 110; }
    }
    data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
  }

  /** 瓦片变化时更新小地图(立即) + 全屏地图(脏格, 每帧批量重画) + 联机广播(15-b) */
  private onTileChanged = (x: number, y: number, id: number): void => {
    // 联机: 玩家操作引发的变更广播给房间(液体由各端本地模拟; 远端回放不重播)
    if (net.online && !this.applyingNet && id !== T.WATER && id !== T.LAVA) {
      net.queueTile(x, y, id, false);
    }
    if (this.mmCanvas && this.mmImg) {
      this.paintMMCell(this.mmImg.data, x, y);
      this.mmCanvas.getContext('2d')!.putImageData(this.mmImg, 0, 0, x, y, 1, 1);
    }
    if (this.mapImg && x >= 0 && y >= 0 && x < this.world.w && y < this.world.h) {
      this.mapDirty.add(y * this.world.w + x);
    }
  };

  /** 每帧 flush 全屏地图脏格(单次 putImageData) */
  private flushMap(): void {
    if (!this.mapCanvas || !this.mapImg || this.mapDirty.size === 0) return;
    const w = this.world.w;
    let minX = 1 << 30, minY = 1 << 30, maxX = -1, maxY = -1;
    for (const idx of this.mapDirty) {
      const x = idx % w, y = (idx / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      this.paintMapCell(this.mapImg.data, x, y);
    }
    this.mapDirty.clear();
    this.mapCanvas.getContext('2d')!.putImageData(
      this.mapImg, 0, 0, minX, minY, maxX - minX + 1, maxY - minY + 1,
    );
  }

  /** 探索标记: 以 (cx,cy) 为圆心半径 42 格(局部圆, 每 60 帧一次) */
  private markExplored(cx: number, cy: number): void {
    if (!this.explored) return;
    const w = this.world.w, h = this.world.h;
    const r = MAP_EXPLORE_R, r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= h) continue;
      const span = Math.floor(Math.sqrt(r2 - dy * dy));
      const x0 = Math.max(0, cx - span), x1 = Math.min(w - 1, cx + span);
      this.explored.fill(1, y * w + x0, y * w + x1 + 1);
    }
  }

  // ==================== UI 同步 ====================
  private syncUI(force: boolean): void {
    if (!this.uiDirty && !force && this.frame % 12 !== 0) return;
    const p = this.player;
    if (!p) return;
    const st = ui.getSnapshot();
    const depth = Math.round((p.y / 16 - this.world.surface[clamp(Math.floor(p.x / 16), 0, this.world.w - 1)]));
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
    // ---- 9-e 新字段 ----
    put('defense', this.defense());
    const ar = p.armor ?? { head: null, body: null, legs: null };
    if (st.armor.head !== ar.head || st.armor.body !== ar.body || st.armor.legs !== ar.legs) {
      patch.armor = { head: ar.head, body: ar.body, legs: ar.legs };
    }
    put('chestOpen', this.chestOpen !== null);
    if (this.uiDirty || force) {
      put('chestSlots', this.chestOpen !== null
        ? [...(this.chestContents.get(this.chestOpen) ?? new Array(CHEST_SLOTS).fill(null))]
        : st.chestSlots);
    }
    const b = this.boss && !this.boss.dead
      ? { name: ENEMY_DEFS[this.boss.kind].name, hp: Math.max(0, Math.round(this.boss.hp)), maxHp: this.boss.maxHp }
      : null;
    if ((st.boss?.name ?? null) !== (b?.name ?? null)
      || (st.boss?.hp ?? -1) !== (b?.hp ?? -1)
      || (st.boss?.maxHp ?? -1) !== (b?.maxHp ?? -1)) {
      patch.boss = b;
    }
    put('mapOpen', this.mapOpen);
    put('smart', this.smart);
    put('devMode', this.devMode);
    put('playerName', this.playerName);
    put('seed', this.seedStr);
    // ---- 联机状态(15-b) ----
    put('mpOnline', net.online);
    put('mpRoom', net.room);
    put('mpCount', net.online ? net.remotes.size + 1 : 0);
    put('biomeName', BIOME_NAMES[this.world.biomeAt(clamp(Math.floor(p.x / 16), 0, this.world.w - 1))] ?? '森林');
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
  enterWorldMP: (name, room) => inst?.enterWorldMP(name, room),
  continueGame: () => inst?.continueGame(),
  regenerate: () => inst?.regenerate(),
  newWorld: (size, seedStr, playerName, dev) => inst?.newWorld(size, seedStr, playerName, dev),
  quitToTitle: () => inst?.quitToTitle(),
  saveGame: () => inst?.saveGame() ?? false,
  toggleInventory: () => inst?.toggleInventory(),
  togglePause: () => inst?.togglePause(),
  setPaused: (v) => inst?.setPaused(v),
  selectHotbar: (i) => inst?.selectHotbar(i),
  toggleMute: () => inst?.toggleMute(),
  craft: (i) => inst?.craft(i),
  clickSlot: (i, r) => inst?.clickSlot(i, r),
  clickChestSlot: (i, r) => inst?.clickChestSlot(i, r),
  clickArmorSlot: (slot, r) => inst?.clickArmorSlot(slot, r),
  toggleMap: () => inst?.toggleMap(),
  toggleSmart: () => inst?.toggleSmart(),
  closeChest: () => inst?.closeChest(),
};
