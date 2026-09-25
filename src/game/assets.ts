/**
 * 原版素材系统 — 加载 terraria.space-z.ai 同款原版 PNG 资源并提供绘制能力
 *
 * 素材位于 /assets/*.png(197 个, 已转换为真 PNG)
 * 渲染逻辑 100% 复刻参考站(terraria.space-z.ai)的贴图帧选择/精灵布局
 *
 * 使用方式: 引擎 mount 时调用 loadAssets()(幂等, 异步); 渲染层通过
 * getAssets() 读取; 所有绘制函数在素材未就绪时静默返回 false, 调用方
 * 应回退到程序化渲染。
 *
 * ── 帧步长勘误(12-a 实现时逐字节复核参考站渲染 chunk a22f92d3a5720574.js) ──
 * 参考站渲染循环顶部 `let n=18` 即帧步长默认值: dirt/grass/corrupt_grass/stone
 * (S 表)、wood(内联表)、iron_ore(C 表)与 obsidian/ash/mud/jungle/hellstone 等
 * (_ 表)全部用 step **18**(贴图为 16px 帧 + 2px 网格缝), copper/silver/gold
 * 矿与 sand 用 step **17**(16px 帧 + 1px 缝)。
 * 任务书 12-0 节所记 "S/16、wood C/16、iron _/17" 为转录笔误——按 16 采样会
 * 跨网格缝取到半空帧(如 wood C[12]→sx192 落在 178-231 全透明区, 木块会隐形),
 * 本文件按参考站真实值实现; 对 public/assets PNG 实测网格间距(18px/17px)与
 * 参考站调用完全吻合, 详见 worklog 12-a 节。
 */

import { T, IT } from './constants';

// ==================== 帧查找表(参考站逐字节提取) ====================
// idx = up | right<<1 | down<<2 | left<<3  (邻格同族)
export const FRAME_S = [6, 2, 9, 2, 6, 5, 9, 0, 12, 12, 5, 1, 12, 4, 2, 10] as const;   // 泥土/草/石 (step18)
export const FRAME_C = [12, 1, 9, 1, 12, 5, 9, 0, 12, 12, 5, 1, 12, 4, 1, 0] as const;  // 铁矿(参考站 step18)
export const FRAME__ = [0, 1, 2, 1, 0, 3, 2, 4, 5, 5, 3, 4, 5, 4, 1, 3] as const;       // 铜/银/金矿/沙 (step17) 腐化草/黑檀石/灰烬/泥/丛林草等 (step18)

/** 参考站 wood_tileset 内联帧表(渲染循环原文 [1,6,4,1,1,1,4,1,4,6,1,1,4,1,1,1], step18) */
const FRAME_WOOD: FrameTable = [1, 6, 4, 1, 1, 1, 4, 1, 4, 6, 1, 1, 4, 1, 1, 1];

export type FrameTable = readonly number[];

/** 邻接 → 帧坐标(参考站 rN 逻辑复刻, 含 flipY 翻转规则) */
export function frameFor(up: boolean, right: boolean, down: boolean, left: boolean, table: FrameTable, step: number): { sx: number; flipY: boolean } {
  // 参考站原始代码: up 有邻而 down 无邻时, 上下互换(互换后的值参与索引)并垂直翻转
  let u = up, d = down, flip = false;
  if (u && !d) { const tmp = u; u = d; d = tmp; flip = true; }
  const idx = (u ? 1 : 0) | (right ? 2 : 0) | (d ? 4 : 0) | (left ? 8 : 0);
  return { sx: (table[idx] ?? 0) * step, flipY: flip };
}

// ==================== 瓦片 → 贴图表配置 ====================
export interface TileSheetConf { name: string; table: FrameTable; step: number }
/** 我方 T.* id → 原版贴图(含派生雪/冰/粘土); 无映射的材质走程序化回退 */
export const TILE_SHEET: Record<number, TileSheetConf> = {
  [T.DIRT]: { name: 'dirt_tile_set', table: FRAME_S, step: 18 },
  [T.GRASS]: { name: 'GrassTilesetTerraria', table: FRAME_S, step: 18 },
  [T.STONE]: { name: 'stone_tile_set', table: FRAME_S, step: 18 },
  [T.WOOD]: { name: 'wood_tileset', table: FRAME_WOOD, step: 18 },
  [T.ORE_COPPER]: { name: 'Copper_ore_tileset', table: FRAME__, step: 17 },
  [T.ORE_IRON]: { name: 'Iron_Ore_tileset', table: FRAME_C, step: 18 },
  [T.ORE_SILVER]: { name: 'silver_ore_tileset', table: FRAME__, step: 17 },
  [T.ORE_GOLD]: { name: 'Gold_ore_tileset', table: FRAME__, step: 17 },
  [T.SAND]: { name: 'sand_block_tileset', table: FRAME__, step: 17 },
  [T.CORRUPT_GRASS]: { name: 'Corrupt_grass_tileset', table: FRAME__, step: 18 },
  [T.CORRUPT_STONE]: { name: 'Ebonstone_tileset', table: FRAME__, step: 18 },
  [T.OBSIDIAN]: { name: 'Obsidian_tileset', table: FRAME__, step: 18 },
  [T.ASH]: { name: 'Ash_block_tileset', table: FRAME__, step: 18 },
  [T.HELLSTONE]: { name: 'Hellstone_tileset', table: FRAME__, step: 18 },
  [T.MUD]: { name: 'Mud_tileset', table: FRAME__, step: 18 },
  [T.JUNGLE_GRASS]: { name: 'Jungle_grass_tileset', table: FRAME__, step: 18 },
  // 派生贴图(加载后由 dirt/stone 整图像素变换生成, 网格间距与源一致 → 同 S/18)
  [T.SNOW]: { name: 'snow_tileset', table: FRAME_S, step: 18 },
  [T.ICE]: { name: 'ice_tileset', table: FRAME_S, step: 18 },
  [T.CLAY]: { name: 'clay_tileset', table: FRAME_S, step: 18 },
};

/** 瓦片同族判定(参考站 rG: 族内互相融合绘制边缘)
 *  注: 未列出的瓦片返回 id 本身(自身独立); 少数 id 恰与族号相同(如 T.LEAF=11
 *  与 HELLSTONE 族 11)属规格固有编号, 两者在世界生成中永不相邻, 无碍。 */
const TILE_FAMILY: Record<number, number> = {
  [T.DIRT]: 1, [T.GRASS]: 1, [T.CORRUPT_GRASS]: 1,
  [T.STONE]: 2, [T.ORE_COPPER]: 2, [T.ORE_IRON]: 2, [T.ORE_SILVER]: 2, [T.ORE_GOLD]: 2, [T.CORRUPT_STONE]: 2,
  [T.WOOD]: 3,
  [T.SAND]: 4,
  [T.SNOW]: 5, [T.ICE]: 6, [T.CLAY]: 7,
  [T.MUD]: 8, [T.JUNGLE_GRASS]: 8,
  [T.OBSIDIAN]: 9, [T.ASH]: 10, [T.HELLSTONE]: 11,
};

export function tileFamily(id: number): number {
  return TILE_FAMILY[id] ?? id;
}

// ==================== 精灵表布局常量(参考站提取) ====================
export const LAYOUT = {
  player: { fw: 20, fh: 30, frames: 19, drawW: 40, drawH: 60 },       // 帧宽20x30, 绘制40x60世界px(玩家2x3格)
  zombie: { fw: 34, fh: 46, frames: 3, drawW: 40, drawH: 60 },
  skeleton: { fw: 60, fh: 48, frames: 7, drawW: 40, drawH: 60, offX: -5 },
  guide: { frames: [[0,26],[29,30],[66,28],[97,32],[130,32],[163,32],[198,30],[231,28],[264,28],[297,28],[330,26],[363,24],[396,24],[429,26],[462,28]] as [number,number][], drawW: 40, drawH: 60, offX: 5 },
  slime: { fw: 32, fh: 24, frames: 2, drawW: 40, drawH: 30 },
  eye: { fw: 37, fh: 22, frames: 2, drawW: 40, drawH: 30 },
  bat: { fw: 28, fh: 24, frames: 4, drawW: 30, drawH: 20 },
  eos: { fw: 42, fh: 78, frames: 2, drawW: 40, drawH: 40 },
  eoc1: { drawW: 80, drawH: 80 },
  eoc2: { drawW: 80, drawH: 80 },
  eowHead: { drawW: 60, drawH: 60 },
  eowBody: { drawW: 60, drawH: 60 },
  eowTail: { drawW: 60, drawH: 60 },
  tree: { srcW: 76, srcH: 142 },                                       // 按树高拉伸
} as const;

// ==================== 加载 ====================
export interface Assets {
  ready: boolean;
  /** 原始图片(name 不带路径与扩展名) */
  img(name: string): HTMLImageElement | HTMLCanvasElement | null;
}

// ---- 私有: 加载清单(全部存在于 public/assets/, 名单与 TILE_SHEET/精灵/盔甲/图标映射一一对应) ----
const TILESET_PNG: readonly string[] = [
  'dirt_tile_set', 'GrassTilesetTerraria', 'stone_tile_set', 'wood_tileset',
  'Copper_ore_tileset', 'Iron_Ore_tileset', 'silver_ore_tileset', 'Gold_ore_tileset',
  'sand_block_tileset', 'Corrupt_grass_tileset', 'Ebonstone_tileset', 'Obsidian_tileset',
  'Ash_block_tileset', 'Hellstone_tileset', 'Mud_tileset', 'Jungle_grass_tileset',
];
const SPRITE_PNG: readonly string[] = [
  'player_spritesheet', 'Zombie', 'Skeleton', 'guide_spritesheet',
  'Green_Slimey_spritesheet', 'Blue_slime_animation', 'Lava_slime',
  'Demon_eye', 'Cave_Bat', 'Eater_of_souls_spritesheet',
  'Eye_of_Cthulhu_Phase_1', 'Eye_of_Cthulhu_Phase_2',
  'Eater_of_Worlds_Head', 'Eater_of_Worlds_Body', 'Eater_of_Worlds_Tail',
  'tree_example', 'Tall_Grass_1', 'Tall_Grass_2', 'Tall_Grass_3',
  'Tall_Grass_4', 'Tall_Grass_5', 'Tall_Grass_6',
  'Torch_ground', 'Torch_wall',
];
/** 家具/多格物件整图(render.ts 直接 A.img 引用) */
const FURNITURE_PNG: readonly string[] = [
  'Work_Bench', 'Iron_Anvil_placed', 'Furnace_placed',
  'Wooden_door_closed', 'Wooden_door_open_left', 'Wooden_door_open_right',
  'Chest', 'Demon_Altar', 'Wooden_Chair', 'Wood_Platform',
  'Life_Crystal_ingame', 'Sapling',
];
/** 墙体贴图(16x16 帧取左上角) */
const WALL_PNG: readonly string[] = ['dirt_wall_tileset'];
/** 深度分层背景图(整屏平铺) */
const BG_PNG: readonly string[] = [
  'bg_forest_1', 'bg_forest_2', 'bg_corruption_1', 'bg_underground_2',
  'bg_cavern_4', 'bg_lava_4', 'bg_underworld_2',
];
/** 盔甲 ingame 叠绘三件套(铜/铁/银/金/暗影/熔岩 × 头/身/腿) */
const ARMOR_INGAME_PNG: readonly string[] = [
  'copper_helmet_ingame', 'copper_chainmail_ingame', 'copper_greaves_ingame',
  'helmet_ingame', 'Iron_chainmail_ingame', 'Iron_greaves_ingame',
  'Silver_Helmet_ingame', 'Silver_Chainmail_ingame', 'Silver_Greaves_ingame',
  'Gold_Helmet_Ingame', 'Gold_Chainmail_Ingame', 'Gold_Greaves_ingame',
  'Shadow_helmet_ingame', 'Shadow_scalemail_ingame', 'Shadow_Greaves_ingame',
  'Molten_Helmet_ingame', 'Molten_Breastplate_ingame', 'Molten_Greaves_ingame',
];
const ICON_PNG: readonly string[] = [
  'Dirt_item', 'Stone_item', 'wood_item', 'Copper_Ore_item', 'Iron_Ore_item',
  'Silver_Ore_Item', 'Gold_Ore_item', 'Gel', 'Wood_Platform', 'Work_Bench',
  'Furnace_item', 'Iron_Anvil_item', 'Iron_Bar', 'Silver_Bar', 'Gold_Bar', 'Copper_Bar',
  'Copper_Pickaxe', 'Copper_Axe', 'Copper_Shortsword',
  'Iron_Pickaxe', 'Iron_Shortsword', 'Silver_Pickaxe', 'Silver_Shortsword',
  'Gold_Pickaxe', 'Gold_Shortsword',
  'Sand_Block_item', 'Mud_item', 'Ash_Block_item', 'Hellstone', 'Obsidian', 'Ebonstone_item',
  'Wooden_Bow', 'Wooden_Arrow', 'Bomb', 'Lens', 'Life_Crystal_inventory', 'Suspicious_Looking_Eye',
  'Demonite_Ore', 'Demonite_Bar', 'Nightmare_Pickaxe', 'Light_Bane', 'HellstoneBar',
  'Molten_Pickaxe', 'Volcano',
  'Copper_Helmet_item', 'Copper_Chainmail_item', 'Copper_Greaves_item',
  'Iron_Helmet', 'Iron_Chainmail_item', 'Iron_Greaves_item',
  'Silver_Helmet_item', 'Silver_Chainmail_item', 'Silver_Greaves_inventory',
  'Gold_Helmet_inventory', 'Gold_Chainmail_inventory', 'Gold_Greaves_inventory',
  'Shadow_Helmet_inventory', 'Shadow_Scalemail_inventory', 'Shadow_Greaves_inventory',
  'Acorn', 'Wooden_Door_item', 'Chest', 'Wooden_Chair',
];

/** 完整清单(standalone 构建内嵌用; 与上方各组并集一致, 放末尾避免 TDZ) */
export const ASSET_MANIFEST: readonly string[] = [
  ...TILESET_PNG, ...SPRITE_PNG, ...ARMOR_INGAME_PNG, ...ICON_PNG, ...FURNITURE_PNG, ...WALL_PNG, ...BG_PNG,
];

// ---- 私有: 素材仓库 ----
type Img = HTMLImageElement | HTMLCanvasElement;
const images = new Map<string, Img>();
let loadStarted = false;   // 幂等: 一旦开始(含已完成)不再重入
let assetsReady = false;

function store(): Assets { return assetsObj; }

const assetsObj: Assets = {
  get ready() { return assetsReady; },
  img(name) { return assetsReady ? images.get(name) ?? null : null; },
};

export function getAssets(): Assets { return assetsObj; }

export function loadAssets(): void {
  if (loadStarted || typeof window === 'undefined') return;
  loadStarted = true;
  const manifest = ASSET_MANIFEST;
  // 单文件版(standalone)由构建脚本注入 base64 数据 URI 映射; 网页版走 /assets/*.png
  const embedded = (globalThis as Record<string, unknown>).__TERRARIA_ASSETS__ as Record<string, string> | undefined;
  void (async () => {
    // 逐个加载; 失败的文件跳过, 不阻塞整体就绪
    await Promise.allSettled(manifest.map(async (name) => {
      const img = new Image();
      img.src = embedded?.[name] ?? `/assets/${name}.png`;
      try {
        await img.decode();
      } catch {
        return;   // 加载失败 → 跳过(调用方走程序化回退)
      }
      if ((img.naturalWidth || img.width) > 0) images.set(name, img);
    }));
    try {
      buildDerivedTilesets();
    } catch {
      /* 派生失败不阻塞就绪 */
    }
    assetsReady = true;
  })();
}

// ---- 私有: 派生贴图(雪/冰/粘土, 整图像素色相偏移; 透明像素跳过) ----
type PixelFn = (d: Uint8ClampedArray, i: number) => void;

/** 雪: 棕色系(r>g>b) → 灰白蓝系 — r=g=min(明度+6,235) 保持明度比例, 蓝通道再 +8 偏蓝 */
function snowPixel(d: Uint8ClampedArray, i: number): void {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  if (r > g && g > b) {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const m = Math.min(235, Math.round(lum) + 6);
    d[i] = m; d[i + 1] = m; d[i + 2] = Math.min(255, m + 8);
  }
}

/** 冰: 灰色系(通道差小) → 蓝青系 — r=g*0.72, b=min(255, g*1.45+40) */
function icePixel(d: Uint8ClampedArray, i: number): void {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn <= 40) {
    d[i] = Math.round(g * 0.72);
    d[i + 2] = Math.min(255, Math.round(g * 1.45 + 40));
  }
}

/** 粘土: 棕色系 → 红棕 — 提 r 降 g/b: r=min(255,r*1.15+18), g*=0.82, b*=0.72 */
function clayPixel(d: Uint8ClampedArray, i: number): void {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  if (r > g && g > b) {
    d[i] = Math.min(255, Math.round(r * 1.15 + 18));
    d[i + 1] = Math.round(g * 0.82);
    d[i + 2] = Math.round(b * 0.72);
  }
}

function deriveTileset(dst: string, src: string, fn: PixelFn): void {
  const img = images.get(src);
  if (!img) return;
  const w = srcW(img), h = srcH(img);
  if (!w || !h) return;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return;
  x.drawImage(img, 0, 0);
  const id = x.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;   // 透明像素跳过
    fn(d, i);
  }
  x.putImageData(id, 0, 0);
  images.set(dst, c);
}

function buildDerivedTilesets(): void {
  deriveTileset('snow_tileset', 'dirt_tile_set', snowPixel);
  deriveTileset('ice_tileset', 'stone_tile_set', icePixel);
  deriveTileset('clay_tileset', 'dirt_tile_set', clayPixel);
}

// ==================== 图像化绘制(世界像素坐标, 16px=1格) ====================
// 全部返回 boolean: false=素材未就绪(调用方走程序化回退)
// flash: true 时叠加发白(用 'lighter' 二次绘制)

// ---- 私有小工具 ----
// naturalWidth 仅图片有(canvas 无该属性→回退 width), 兼容无 DOM 环境的打桩测试
function srcW(img: Img): number { return (img as HTMLImageElement).naturalWidth || img.width; }
function srcH(img: Img): number { return (img as HTMLImageElement).naturalHeight || img.height; }
function mod(n: number, m: number): number { return ((n % m) + m) % m; }

/** 通用镜像+受击白闪帧绘制(facing=1 朝右 → 水平翻转; 素材默认朝左) */
function blit(ctx: CanvasRenderingContext2D, img: Img, sx: number, sw: number, sh: number,
  x: number, y: number, dw: number, dh: number, facing: number, flash: boolean): void {
  ctx.save();
  if (facing === 1) {
    ctx.translate(x + dw, y);
    ctx.scale(-1, 1);
    x = 0;
  }
  ctx.drawImage(img, sx, 0, sw, sh, x, y, dw, dh);
  if (flash) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.75;
    ctx.drawImage(img, sx, 0, sw, sh, x, y, dw, dh);
  }
  ctx.restore();
}

/** 半透明染色副本缓存(source-atop 只作用于精灵本身, 不污染主画布) */
const tintCache = new Map<string, HTMLCanvasElement>();
function tinted(img: Img, name: string, color: string): Img {
  const key = `${name}|${color}`;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const w = srcW(img), h = srcH(img);
  if (!w || !h) return img;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (!x) return img;
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = color;
  x.fillRect(0, 0, w, h);
  tintCache.set(key, c);
  return c;
}

/** 玩家: frame 参考站编号(0站/1-4挥击/5跳跃/6-18走路13帧); armor 传 ingame 贴图三件套名 */
export function drawImgPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number, facing: number, walkT: number, onGround: boolean, vy: number, swingT: number, armor: { head: string | null; body: string | null; legs: string | null } | null, heldIcon: string | null, flash: boolean): boolean {
  const A = store(); if (!A.ready) return false;
  const img = A.img('player_spritesheet'); if (!img) return false;
  const L = LAYOUT.player;
  // 帧选择(参考站): 挥击(swingT∈(0,1] 为挥舞进度) > 跳跃 > 走路 > 站立。
  // 行走判定: 引擎 walkT(站立时归零)>0, 或调用方以参考站编号 6..18 提示。
  let f = 0;
  if (swingT > 0 && swingT <= 1) f = Math.min(4, Math.max(1, 1 + Math.floor(swingT * 4)));
  else if (!onGround) f = 5;
  else if (Math.abs(walkT) > 0.001 || (frame >= 6 && frame <= 18)) f = 6 + mod(Math.floor(walkT), 13);
  ctx.save();
  let bx = x;
  if (facing === 1) { ctx.translate(x + L.drawW, y); ctx.scale(-1, 1); bx = 0; }
  ctx.drawImage(img, f * L.fw, 0, L.fw, L.fh, bx, y, L.drawW, L.drawH);
  // 盔甲三件套叠绘: 保持纵横比, 高度铺满玩家 40x60 框并水平居中(参考站逻辑)
  if (armor) {
    for (const part of [armor.head, armor.body, armor.legs]) {
      if (!part) continue;
      const im = A.img(part);
      if (!im) continue;
      const sw = srcW(im), sh = srcH(im);
      if (!sw || !sh) continue;
      const ah = L.drawH;
      const aw = ah * (sw / sh);
      ctx.drawImage(im, 0, 0, sw, sh, bx + (L.drawW - aw) / 2, y, aw, ah);
    }
  }
  if (flash) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.75;
    ctx.drawImage(img, f * L.fw, 0, L.fw, L.fh, bx, y, L.drawW, L.drawH);
  }
  ctx.restore();
  // 手持物品图标: 手部 (x+facing*10, y+24), 挥击时旋转 -30°..+60°(按 swingT), 14px
  if (heldIcon) {
    const ic = A.img(heldIcon);
    if (ic) {
      const sw = srcW(ic), sh = srcH(ic);
      if (sw && sh) {
        const deg = swingT > 0 && swingT <= 1 ? -30 + 90 * swingT : 0;
        ctx.save();
        ctx.translate(x + facing * 10, y + 24);
        ctx.rotate((deg * Math.PI / 180) * facing);
        ctx.drawImage(ic, 0, 0, sw, sh, -7, -7, 14, 14);
        ctx.restore();
      }
    }
  }
  return true;
}

export function drawImgZombie(ctx: CanvasRenderingContext2D, x: number, y: number, walkT: number, facing: number, flash: boolean): boolean {
  const A = store(); if (!A.ready) return false;
  const img = A.img('Zombie'); if (!img) return false;
  const L = LAYOUT.zombie;
  blit(ctx, img, mod(Math.floor(walkT), L.frames) * L.fw, L.fw, L.fh, x, y, L.drawW, L.drawH, facing, flash);
  return true;
}

export function drawImgSkeleton(ctx: CanvasRenderingContext2D, x: number, y: number, walkT: number, facing: number, flash: boolean): boolean {
  const A = store(); if (!A.ready) return false;
  const img = A.img('Skeleton'); if (!img) return false;
  const L = LAYOUT.skeleton;
  blit(ctx, img, mod(Math.floor(walkT), L.frames) * L.fw, L.fw, L.fh, x + L.offX, y, L.drawW, L.drawH, facing, flash);
  return true;
}

export function drawImgGuide(ctx: CanvasRenderingContext2D, x: number, y: number, walkT: number, facing: number, sitting: boolean): boolean {
  const A = store(); if (!A.ready) return false;
  const img = A.img('guide_spritesheet'); if (!img) return false;
  const L = LAYOUT.guide;
  // 帧选择(参考站): sitting→14; 行走→1+(floor(walkT)%13); 否则 0
  let f = 0;
  if (sitting) f = 14;
  else if (Math.abs(walkT) > 0.001) f = 1 + mod(Math.floor(walkT), 13);
  const fr = L.frames[f] ?? [0, 26];
  // 参考站: drawImage(img, sx, 0, fw, 48, x-8÷2, y, 40, 60) — 向导帧自带左侧留白, 向左偏 offX
  blit(ctx, img, fr[0], fr[1], 48, x - L.offX, y, L.drawW, L.drawH, facing, false);
  return true;
}

export function drawImgSlime(ctx: CanvasRenderingContext2D, kind: 'green' | 'blue' | 'lava', x: number, y: number, walkT: number, facing: number, flash: boolean, t: number): boolean {
  const A = store(); if (!A.ready) return false;
  const name = kind === 'green' ? 'Green_Slimey_spritesheet' : kind === 'blue' ? 'Blue_slime_animation' : 'Lava_slime';
  const img = A.img(name); if (!img) return false;
  const L = LAYOUT.slime;
  blit(ctx, img, mod(Math.floor(walkT), L.frames) * L.fw, L.fw, L.fh, x, y, L.drawW, L.drawH, facing, flash);
  if (kind === 'lava') {
    // 熔岩史莱姆红光叠层(参考站同款整格叠色)
    ctx.save();
    ctx.fillStyle = `rgba(255,80,20,${(0.12 + 0.05 * Math.sin(t / 250)).toFixed(4)})`;
    ctx.fillRect(x, y, L.drawW, L.drawH);
    ctx.restore();
  }
  return true;
}

export function drawImgEye(ctx: CanvasRenderingContext2D, x: number, y: number, walkT: number, facing: number, flash: boolean): boolean {
  const A = store(); if (!A.ready) return false;
  const img = A.img('Demon_eye'); if (!img) return false;
  const L = LAYOUT.eye;
  blit(ctx, img, mod(Math.floor(walkT), L.frames) * L.fw, L.fw, L.fh, x, y, L.drawW, L.drawH, facing, flash);
  return true;
}

export function drawImgBat(ctx: CanvasRenderingContext2D, x: number, y: number, walkT: number, facing: number, flash: boolean): boolean {
  const A = store(); if (!A.ready) return false;
  const img = A.img('Cave_Bat'); if (!img) return false;
  const L = LAYOUT.bat;
  blit(ctx, img, mod(Math.floor(walkT), L.frames) * L.fw, L.fw, L.fh, x, y, L.drawW, L.drawH, facing, flash);
  return true;
}

export function drawImgEos(ctx: CanvasRenderingContext2D, x: number, y: number, walkT: number, facing: number, flash: boolean): boolean {
  const A = store(); if (!A.ready) return false;
  const img = A.img('Eater_of_souls_spritesheet'); if (!img) return false;
  const L = LAYOUT.eos;
  blit(ctx, img, mod(Math.floor(walkT), L.frames) * L.fw, L.fw, L.fh, x, y, L.drawW, L.drawH, facing, flash);
  return true;
}

/** EoC: phase1/2, lookX/Y ±1 目光偏移, spin 旋转弧度 */
export function drawImgEoC(ctx: CanvasRenderingContext2D, x: number, y: number, phase: number, lookX: number, lookY: number, spin: number, flash: boolean): boolean {
  const A = store(); if (!A.ready) return false;
  const img = A.img(phase === 2 ? 'Eye_of_Cthulhu_Phase_2' : 'Eye_of_Cthulhu_Phase_1'); if (!img) return false;
  // 素材为 3 帧横排(每帧 ~110px, 帧间瞳位微差), 取中间帧; 中心对齐 80x80
  const sw = srcW(img), sh = srcH(img);
  if (!sw || !sh) return false;
  const fw = Math.floor(sw / 3);
  const L = LAYOUT.eoc1;
  ctx.save();
  ctx.translate(x + L.drawW / 2 + lookX * 2, y + L.drawH / 2 + lookY * 2);   // 目光偏移 ±2px
  if (spin > 0) ctx.rotate(spin);                                             // 旋转绕中心
  ctx.drawImage(img, fw, 0, fw, sh, -L.drawW / 2, -L.drawH / 2, L.drawW, L.drawH);
  if (flash) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.75;
    ctx.drawImage(img, fw, 0, fw, sh, -L.drawW / 2, -L.drawH / 2, L.drawW, L.drawH);
  }
  ctx.restore();
  return true;
}

/** EoW 段: kind=head/body/tail, facing ±1 */
export function drawImgEoW(ctx: CanvasRenderingContext2D, kind: 'head' | 'body' | 'tail', x: number, y: number, facing: number, flash: boolean): boolean {
  const A = store(); if (!A.ready) return false;
  const name = kind === 'head' ? 'Eater_of_Worlds_Head' : kind === 'tail' ? 'Eater_of_Worlds_Tail' : 'Eater_of_Worlds_Body';
  const img = A.img(name); if (!img) return false;
  const sw = srcW(img), sh = srcH(img);
  if (!sw || !sh) return false;
  const L = kind === 'head' ? LAYOUT.eowHead : kind === 'tail' ? LAYOUT.eowTail : LAYOUT.eowBody;
  blit(ctx, img, 0, sw, sh, x, y, L.drawW, L.drawH, facing, flash);
  return true;
}

/** 整树精灵: baseX/baseY=树基(世界px), heightTiles=树干格数, variant 决定水平翻转, tint=null|'snow'|'jungle'|'corrupt' */
export function drawTreeSprite(ctx: CanvasRenderingContext2D, baseX: number, baseY: number, heightTiles: number, variant: number, tint: string | null, chop: number): boolean {
  const A = store(); if (!A.ready) return false;
  const img = A.img('tree_example'); if (!img) return false;
  // 高度=(树干格数+3)*16 世界px, 宽 76/142*高; 树底对齐树基格底, 水平居中于树干列
  const h = (heightTiles + 3) * 16;
  const w = (LAYOUT.tree.srcW / LAYOUT.tree.srcH) * h;
  const dx = baseX - w / 2;
  const dy = baseY + 16 - h;
  const TINT: Record<string, string> = {
    snow: 'rgba(200,220,255,0.45)',
    jungle: 'rgba(60,180,60,0.42)',
    corrupt: 'rgba(140,60,190,0.4)',
  };
  const src = tint && TINT[tint] ? tinted(img, 'tree_example', TINT[tint]) : img;
  ctx.save();
  if (variant % 2 === 1) {   // 奇数 variant 水平翻转(绕树中心, 参考站同款)
    ctx.translate(dx + w / 2, 0);
    ctx.scale(-1, 1);
    ctx.translate(-dx - w / 2, 0);
  }
  ctx.drawImage(src, 0, 0, LAYOUT.tree.srcW, LAYOUT.tree.srcH, dx, dy, w, h);
  ctx.restore();
  if (chop > 0) {            // 挖掘进度暗化
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.5, chop * 0.5).toFixed(4)})`;
    ctx.fillRect(dx, dy, w, h);
    ctx.restore();
  }
  return true;
}

/** 高草: 24px 高, 随风摆动, kind='grass'|'jungle'(丛林绿色叠加) */
export function drawTallGrass(ctx: CanvasRenderingContext2D, x: number, y: number, variant: number, kind: 'grass' | 'jungle', t: number, seed: number): boolean {
  const A = store(); if (!A.ready) return false;
  const name = `Tall_Grass_${variant + 1}`;
  const img = A.img(name); if (!img) return false;
  const sw = srcW(img), sh = srcH(img);
  if (!sw || !sh) return false;
  // 高 24px, 宽=24*naturalW/naturalH; 格内水平居中, 底对齐格底; 风摆剪切
  const n = 24;
  const a = n * sw / sh;
  const cx = x + 8;          // 格中心
  const bottom = y + 16;     // 格底
  const src = kind === 'jungle' ? tinted(img, name, 'rgba(80, 200, 60, 0.45)') : img;
  const shear = 0.35 * Math.sin(t / 700 + seed);
  ctx.save();
  ctx.translate(cx, bottom);            // 锚点移到 底部中心
  ctx.transform(1, 0, shear, 1, 0, 0);  // 风摆剪切
  ctx.translate(-a / 2, -n);            // 回平移到左上
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, a, n);
  ctx.restore();
  return true;
}

/** 火把: ground=下方实心(地面火把) 否则墙火把(右侧实心时镜像) */
export function drawImgTorch(ctx: CanvasRenderingContext2D, x: number, y: number, ground: boolean, wallRight: boolean, t: number): boolean {
  const A = store(); if (!A.ready) return false;
  if (ground) {
    const img = A.img('Torch_ground'); if (!img) return false;
    // 本体 10x20, 水平居中于格, 底对齐格底
    const w = 10, h = 20;
    const dx = x + (16 - w) / 2;
    const dy = y + 16 - h;
    ctx.drawImage(img, 0, 0, w, h, dx, dy, w, h);
    drawTorchFlame(ctx, dx + w / 2, dy, t);
  } else {
    const img = A.img('Torch_wall'); if (!img) return false;
    // 墙火把 14x16 → 14x32, 顶端对齐格顶, 水平居中; 右侧实心时镜像
    const w = 14, h = 32;
    const dx = x + (16 - w) / 2;
    const dy = y;
    ctx.save();
    if (wallRight) {
      ctx.translate(dx + w, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, 14, 16, 0, 0, w, h);
    } else {
      ctx.drawImage(img, 0, 0, 14, 16, dx, dy, w, h);
    }
    ctx.restore();
    drawTorchFlame(ctx, dx + w / 2, dy, t);
  }
  return true;
}

/** 火把顶部 3x4 橙黄闪烁火苗(t 驱动 alpha; 光晕由 render 层负责) */
function drawTorchFlame(ctx: CanvasRenderingContext2D, cx: number, top: number, t: number): void {
  const a = 0.7 + 0.3 * Math.sin(t / 80 + Math.sin(t / 130) * 1.7);
  ctx.save();
  ctx.fillStyle = `rgba(255,150,40,${(0.55 * a).toFixed(4)})`;
  ctx.fillRect(cx - 1.5, top - 3, 3, 4);
  ctx.fillStyle = `rgba(255,230,120,${(0.8 * a).toFixed(4)})`;
  ctx.fillRect(cx - 0.5, top - 2, 1, 2);
  ctx.restore();
}

// ==================== 物品图标 ====================
// ---- 私有: 物品 id → 素材名(crop=true 表示从派生贴图裁 (0,0,16,16) 帧) ----
const ICON_MAP: Readonly<Record<number, { name: string; crop?: boolean }>> = {
  [IT.DIRT]: { name: 'Dirt_item' },
  [IT.STONE]: { name: 'Stone_item' },
  [IT.CLAY]: { name: 'clay_tileset', crop: true },
  [IT.WOOD]: { name: 'wood_item' },
  [IT.ORE_COPPER]: { name: 'Copper_Ore_item' },
  [IT.ORE_IRON]: { name: 'Iron_Ore_item' },
  [IT.ORE_SILVER]: { name: 'Silver_Ore_Item' },
  [IT.ORE_GOLD]: { name: 'Gold_Ore_item' },
  [IT.GEL]: { name: 'Gel' },
  [IT.TORCH]: { name: 'Torch_wall' },
  [IT.PLATFORM]: { name: 'Wood_Platform' },
  [IT.WORKBENCH]: { name: 'Work_Bench' },
  [IT.FURNACE]: { name: 'Furnace_item' },
  [IT.ANVIL]: { name: 'Iron_Anvil_item' },
  [IT.BAR_IRON]: { name: 'Iron_Bar' },
  [IT.BAR_SILVER]: { name: 'Silver_Bar' },
  [IT.BAR_GOLD]: { name: 'Gold_Bar' },
  [IT.COPPER_BAR]: { name: 'Copper_Bar' },
  [IT.COPPER_PICK]: { name: 'Copper_Pickaxe' },
  [IT.COPPER_AXE]: { name: 'Copper_Axe' },
  [IT.COPPER_SWORD]: { name: 'Copper_Shortsword' },
  [IT.IRON_PICK]: { name: 'Iron_Pickaxe' },
  [IT.IRON_SWORD]: { name: 'Iron_Shortsword' },
  [IT.SILVER_PICK]: { name: 'Silver_Pickaxe' },
  [IT.SILVER_SWORD]: { name: 'Silver_Shortsword' },
  [IT.GOLD_PICK]: { name: 'Gold_Pickaxe' },
  [IT.GOLD_SWORD]: { name: 'Gold_Shortsword' },
  [IT.SAND]: { name: 'Sand_Block_item' },
  [IT.SNOW]: { name: 'snow_tileset', crop: true },
  [IT.ICE]: { name: 'ice_tileset', crop: true },
  [IT.MUD]: { name: 'Mud_item' },
  [IT.ASH]: { name: 'Ash_Block_item' },
  [IT.HELLSTONE_ORE]: { name: 'Hellstone' },
  [IT.OBSIDIAN]: { name: 'Obsidian' },
  [IT.EBONSTONE]: { name: 'Ebonstone_item' },
  [IT.BOW]: { name: 'Wooden_Bow' },
  [IT.ARROW]: { name: 'Wooden_Arrow' },
  [IT.BOMB]: { name: 'Bomb' },
  [IT.LENS]: { name: 'Lens' },
  [IT.LIFE_CRYSTAL]: { name: 'Life_Crystal_inventory' },
  [IT.EYE_SUMMON]: { name: 'Suspicious_Looking_Eye' },
  [IT.DEMONITE_ORE]: { name: 'Demonite_Ore' },
  [IT.DEMONITE_BAR]: { name: 'Demonite_Bar' },
  [IT.NIGHTMARE_PICK]: { name: 'Nightmare_Pickaxe' },
  [IT.LIGHTS_BANE]: { name: 'Light_Bane' },
  [IT.HELLSTONE_BAR]: { name: 'HellstoneBar' },
  [IT.MOLTEN_PICK]: { name: 'Molten_Pickaxe' },
  [IT.VOLCANO]: { name: 'Volcano' },
  [IT.COPPER_HELM]: { name: 'Copper_Helmet_item' },
  [IT.COPPER_MAIL]: { name: 'Copper_Chainmail_item' },
  [IT.COPPER_LEGS]: { name: 'Copper_Greaves_item' },
  [IT.IRON_HELM]: { name: 'Iron_Helmet' },
  [IT.IRON_MAIL]: { name: 'Iron_Chainmail_item' },
  [IT.IRON_LEGS]: { name: 'Iron_Greaves_item' },
  [IT.SILVER_HELM]: { name: 'Silver_Helmet_item' },
  [IT.SILVER_MAIL]: { name: 'Silver_Chainmail_item' },
  [IT.SILVER_LEGS]: { name: 'Silver_Greaves_inventory' },
  [IT.GOLD_HELM]: { name: 'Gold_Helmet_inventory' },
  [IT.GOLD_MAIL]: { name: 'Gold_Chainmail_inventory' },
  [IT.GOLD_LEGS]: { name: 'Gold_Greaves_inventory' },
  [IT.SHADOW_HELM]: { name: 'Shadow_Helmet_inventory' },
  [IT.SHADOW_MAIL]: { name: 'Shadow_Scalemail_inventory' },
  [IT.SHADOW_LEGS]: { name: 'Shadow_Greaves_inventory' },
  [IT.ACORN]: { name: 'Acorn' },
  [IT.WOODEN_DOOR]: { name: 'Wooden_Door_item' },
  [IT.CHEST]: { name: 'Chest' },
  [IT.CHAIR]: { name: 'Wooden_Chair' },
  // 无原版素材, 保持程序化图标: WOOD_SWORD / CACTUS / TABLE
};

export function applyItemIcons(tex: { icons: Record<number, HTMLCanvasElement>; iconURL: Record<number, string>; anchors: Record<number, [number, number]> }): void {
  const A = store();
  if (!A.ready) return;
  for (const key of Object.keys(ICON_MAP)) {
    const id = Number(key);
    const m = ICON_MAP[id];
    const img = A.img(m.name);
    if (!img) continue;
    // 源区域: crop → 派生贴图 (0,0,16,16); 否则整图
    const sw = m.crop ? 16 : srcW(img);
    const sh = m.crop ? 16 : srcH(img);
    if (!sw || !sh) continue;
    // 16x16 画布; 保持纵横比缩到 ≤16(工具 32x32 → 16x16), 居中
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const x = c.getContext('2d');
    if (!x) continue;
    x.imageSmoothingEnabled = false;
    const scale = Math.min(1, 16 / sw, 16 / sh);
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    x.drawImage(img, 0, 0, sw, sh, Math.round((16 - dw) / 2), Math.round((16 - dh) / 2), dw, dh);
    tex.icons[id] = c;
    tex.iconURL[id] = c.toDataURL();
    tex.anchors[id] = [8, 8];
  }
}
