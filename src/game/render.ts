/**
 * 世界渲染管线：天空 -> [树林剪影/深度分层背景] -> 墙/瓦片(含描边/液体/家具/发光块) -> 掉落物
 *            -> 敌怪/NPC/玩家 -> 粒子/投射物 -> 光照罩 -> 光晕 -> 伤害数字/血条
 *            -> 光标高亮 -> 屏幕特效 -> 小地图 -> 全屏地图
 */

import { T, TileDefs, ItemDefs, IT, ARMOR_COLORS, BIOME_NAMES, ENEMY_DEFS, TILE_COUNT, W_DIRT, BIOME } from './constants';
import { drawSkyBackground } from './sky';
import { mulberry32 } from './textures';
import {
  drawHumanoid, drawSlime, drawEye, drawBat, drawEos, drawEoC, drawArrow, drawBomb,
  PLAYER_PALETTE, ZOMBIE_PALETTE, GUIDE_PALETTE, SKELETON_PALETTE,
  SLIME_GREEN, SLIME_BLUE, LAVA_SLIME,
} from './sprites';
import {
  getAssets, loadAssets, TILE_SHEET, tileFamily, frameFor, LAYOUT,
  drawImgPlayer, drawImgZombie, drawImgSkeleton, drawImgGuide, drawImgSlime, drawImgEye,
  drawImgBat, drawImgEos, drawImgEoC, drawTreeSprite, drawTallGrass, drawImgTorch, applyItemIcons,
  itemDrawSize, type Assets,
} from './assets';
import type { ExtraLight } from './lighting';
import type { GameEngine } from './engine';
import { net, type RemotePlayer } from './net';
import type { World } from './world';
import type { Slot } from './store';

function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }

/** 稳定坐标哈希(与帧无关, 用于按格决定装饰/抽稀) */
function cellHash(x: number, y: number): number {
  return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
}

/** 盔甲三槽(物品 id) -> drawHumanoid 的 armor 三色; 空槽回退玩家原色, 全空返回 null */
function armorColorsOf(
  armor: { head: Slot | null; body: Slot | null; legs: Slot | null } | null | undefined,
): { head: string; body: string; legs: string } | null {
  if (!armor || (!armor.head && !armor.body && !armor.legs)) return null;
  const pick = (s: Slot | null, idx: 0 | 1 | 2, fallback: string): string => {
    if (!s) return fallback;
    const as = ItemDefs[s.id]?.armorSlot;
    // ARMOR_COLORS 以头盔 id 为 key(铜盔 51/甲 52/腿 53): 头+0 / 身+1 / 腿+2
    const off = as === 'head' ? 0 : as === 'body' ? 1 : as === 'legs' ? 2 : idx;
    const set = ARMOR_COLORS[s.id - off];
    return set ? set[off] : fallback;
  };
  return {
    head: pick(armor.head, 0, PLAYER_PALETTE.hair),
    body: pick(armor.body, 1, PLAYER_PALETTE.shirt),
    legs: pick(armor.legs, 2, PLAYER_PALETTE.pants),
  };
}

// ==================== 12-b: 原版素材接入 ====================

/** applyItemIcons(用原版 PNG 覆盖 tex.icons/iconURL/anchors) 只需在素材首次就绪后执行一次 */
let itemIconsApplied = false;

/**
 * drawImg* 实体绘制框的锚点偏移: 传给 assets.ts 的 (x, y) = 实体点 + 偏移 = 绘制框左上角。
 * 对齐约定沿 sprites.ts 头部注释的"底部中心"锚: 图像底边 = 实体脚底/判定盒底(Body.y = 底),
 * 水平居中(Body.x = 中心), 故偏移 = (-drawW/2, -drawH)(drawW/H 见 assets.LAYOUT)。
 * 若 12-a 实现的锚点语义不同, 只需统一调整本表。
 */
const IMG_OFF = {
  player: [-20, -60],   // 40x60(半尺寸帧 2x, 原版玩家 40x56)
  zombie: [-17, -46],   // 原生 34x46
  skel: [-15, -48],     // 原生 30x48
  guide: [-16, -48],    // 帧宽可变, drawImgGuide 内部按帧宽居中(参考 16 还原)
  slime: [-16, -24],    // 原生 32x24
  eye: [-18, -22],      // 原生 37x22
  bat: [-14, -24],      // 原生 28x24
  eos: [-21, -78],      // 原生 42x78
  // eoc: drawImgEoC 直接接收实体中心坐标, 无需偏移
} as const;

/** 盔甲套装(以头盔 id 为 key, 同 armorColorsOf 的 +offset 规则) → 原版 ingame 贴图三件套名 */
const ARMOR_IMG: Partial<Record<number, readonly [string, string, string]>> = {
  [IT.COPPER_HELM]: ['copper_helmet_ingame', 'copper_chainmail_ingame', 'copper_greaves_ingame'],
  [IT.IRON_HELM]: ['helmet_ingame', 'Iron_chainmail_ingame', 'Iron_greaves_ingame'],
  [IT.SILVER_HELM]: ['Silver_Helmet_ingame', 'Silver_Chainmail_ingame', 'Silver_Greaves_ingame'],
  [IT.GOLD_HELM]: ['Gold_Helmet_Ingame', 'Gold_Chainmail_Ingame', 'Gold_Greaves_Ingame'],
  [IT.SHADOW_HELM]: ['Shadow_helmet_ingame', 'Shadow_scalemail_ingame', 'Shadow_Greaves_ingame'],
  // 熔岩套(Molten_Helmet_ingame / Molten_Breastplate_ingame / Molten_Greaves_ingame):
  // constants.ts 尚无熔岩盔甲物品 id, 待后续版本接入后在此补一行
};

/** 盔甲三槽 → 原版 ingame 素材名(无映射槽位 = null 跳过该件, 不影响其余槽位) */
function armorImgsOf(
  armor: { head: Slot | null; body: Slot | null; legs: Slot | null } | null | undefined,
): { head: string | null; body: string | null; legs: string | null } | null {
  if (!armor || (!armor.head && !armor.body && !armor.legs)) return null;
  const pick = (s: Slot | null, idx: 0 | 1 | 2): string | null => {
    if (!s) return null;
    const as = ItemDefs[s.id]?.armorSlot;
    const off = as === 'head' ? 0 : as === 'body' ? 1 : as === 'legs' ? 2 : idx;
    return ARMOR_IMG[s.id - off]?.[off] ?? null;
  };
  return { head: pick(armor.head, 0), body: pick(armor.body, 1), legs: pick(armor.legs, 2) };
}

/** 玩家原版帧号(参考站编号): 0 站立 / 1-4 挥击 / 5 跳跃 / 6-18 走路 13 帧(周期 2π 与程序化同步) */
function playerImgFrame(p: {
  swing: { t: number; dur: number } | null;
  onGround: boolean; vx: number; walkT: number;
}): number {
  if (p.swing) return 1 + Math.min(3, Math.floor((p.swing.t / p.swing.dur) * 4));
  if (!p.onGround) return 5;
  if (Math.abs(p.vx) > 0.3) {
    return 6 + (((Math.round(p.walkT / ((Math.PI * 2) / 13)) % 13) + 13) % 13);
  }
  return 0;
}

/** 整树精灵条目(视口内树基扫描结果) */
interface TreeEntry { x: number; baseY: number; heightTiles: number; variant: number }

/** 该 TRUNK 格属于某棵已扫描树(同列且在树干范围内) → 瓦片循环跳过程序化绘制 */
function trunkInTree(trees: TreeEntry[], x: number, y: number): boolean {
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    if (t.x === x && y <= t.baseY && y > t.baseY - t.heightTiles) return true;
  }
  return false;
}

/** 该 LEAF 格落在某棵树冠包围盒内(±5 列; 树冠最多探出树干顶 5 行 / 树基下 1 行) */
function leafInTree(trees: TreeEntry[], x: number, y: number): boolean {
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    if (x >= t.x - 5 && x <= t.x + 5 && y <= t.baseY + 1 && y >= t.baseY - t.heightTiles - 7) return true;
  }
  return false;
}

/** 树基旁草类型 → 整树色调(优先级: 雪 > 丛林 > 腐化; 邻格 = 树基 ±1 列 / 基行与下一行) */
const TREE_TINTS: readonly (readonly [readonly number[], string])[] = [
  [[T.SNOW], 'snow'],
  [[T.JUNGLE_GRASS, T.MUD], 'jungle'],
  [[T.CORRUPT_GRASS, T.CORRUPT_STONE], 'corrupt'],
];
function treeTintAt(wld: World, x: number, baseY: number): string | null {
  for (const [ids, name] of TREE_TINTS) {
    if (ids.indexOf(wld.get(x - 1, baseY + 1)) >= 0 || ids.indexOf(wld.get(x + 1, baseY + 1)) >= 0
      || ids.indexOf(wld.get(x - 1, baseY)) >= 0 || ids.indexOf(wld.get(x + 1, baseY)) >= 0) return name;
  }
  return null;
}

/** 圆角矩形路径(手绘 arcTo, 不依赖 ctx.roundRect) */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ==================== 10-c A: 地形边缘描边 (ART-SPEC §4) ====================

/**
 * 视觉整块：实心方块 + 非实心但画满整格的草皮/树干/树冠/蘑菇柄/门。
 * 描边“暴露”判定用——邻格为此类时该侧不画描边(否则草地/树干内部会出现断续暗缝)。
 */
const VISUAL_FULL: Uint8Array = (() => {
  const a = new Uint8Array(TILE_COUNT);
  for (let i = 0; i < TILE_COUNT; i++) a[i] = TileDefs[i].solid ? 1 : 0;
  const full = [
    T.GRASS, T.JUNGLE_GRASS, T.CORRUPT_GRASS,          // 草皮方块(非实心但视觉整块)
    T.TRUNK, T.MUSH_STEM,                              // 树干/蘑菇柄
    T.LEAF, T.LEAF_SNOW, T.LEAF_JUNGLE, T.LEAF_CORRUPT, // 树冠
    T.DOOR_C_T, T.DOOR_C_B, T.DOOR_O_T, T.DOOR_O_B,    // 门
  ];
  for (const id of full) a[id] = 1;
  return a;
})();

interface EdgeStyle {
  top: string;       // 顶边 2px (alpha 0.55)
  bottom: string;    // 底边 2px (alpha 0.40)
  side: string;      // 侧边 2px (alpha 0.50)
  skipTop: boolean;  // 草系方块顶面已有草皮覆层/烘焙草, 不叠普通顶描边
}

/** 材质 → 描边 RGB (ART-SPEC §4: 泥土系#49393f 石头系#292c30 沙#a08040 雪#b8ccd8 泥#3a2c22
 *  黑檀石#2a2534 狱岩#4a1408 黑曜石#151122 木#291e15 冰#6a9eb8;
 *  未列出的灰烬/仙人掌取同系暗色) */
const EDGE_MATS: [number[], string][] = [
  [[T.DIRT, T.CLAY, T.GRASS], '73,57,63'],                       // 泥土系 #49393f
  [[T.STONE, T.ORE_COPPER, T.ORE_IRON, T.ORE_SILVER, T.ORE_GOLD], '41,44,48'], // 石头系 #292c30
  [[T.SAND], '160,128,64'],                                     // 沙 #a08040
  [[T.SNOW], '184,204,216'],                                    // 雪 #b8ccd8
  [[T.MUD, T.JUNGLE_GRASS], '58,44,34'],                        // 泥 #3a2c22
  [[T.CORRUPT_STONE, T.CORRUPT_GRASS], '42,37,52'],             // 黑檀石 #2a2534
  [[T.HELLSTONE], '74,20,8'],                                   // 狱岩 #4a1408
  [[T.OBSIDIAN], '21,17,34'],                                   // 黑曜石 #151122
  [[T.WOOD], '41,30,21'],                                       // 木板/木系 #291e15
  [[T.ICE], '106,158,184'],                                     // 冰 #6a9eb8
  [[T.ASH], '42,38,51'],                                        // 灰烬(地狱系暗紫灰 #2a2633)
  [[T.CACTUS], '29,64,32'],                                     // 仙人掌(深绿 #1d4020)
];

/** 方块 id → 描边样式(模块级常量表, 零每帧字符串分配); undefined = 不描边(家具/装饰/液体) */
const EDGE_STYLES: (EdgeStyle | undefined)[] = (() => {
  const t: (EdgeStyle | undefined)[] = new Array(TILE_COUNT).fill(undefined);
  for (const [ids, rgb] of EDGE_MATS) {
    for (const id of ids) {
      t[id] = {
        top: `rgba(${rgb},0.55)`,
        bottom: `rgba(${rgb},0.40)`,
        side: `rgba(${rgb},0.50)`,
        skipTop: id === T.GRASS || id === T.JUNGLE_GRASS || id === T.CORRUPT_GRASS,
      };
    }
  }
  return t;
})();

/**
 * 四邻描边(在方块绘制后同循环内调用)：
 * 上/下/侧邻暴露 → 2px 暗色条；暴露角(两相邻方向皆空)→ 2×2 缺角切口(L 形双臂各 4px)。
 * 每屏仅地表/洞穴壁的暴露面会触发 fillRect, 被完整包围的方块 4 次查表后立即返回。
 */
function drawTileEdges(
  ctx: CanvasRenderingContext2D, wld: World, x: number, y: number, px: number, py: number, es: EdgeStyle,
): void {
  const up = VISUAL_FULL[wld.get(x, y - 1)] === 0;
  const dn = VISUAL_FULL[wld.get(x, y + 1)] === 0;
  const lf = VISUAL_FULL[wld.get(x - 1, y)] === 0;
  const rt = VISUAL_FULL[wld.get(x + 1, y)] === 0;
  if (!up && !dn && !lf && !rt) return;
  if (up && !es.skipTop) { ctx.fillStyle = es.top; ctx.fillRect(px, py, 16, 2); }
  if (dn) { ctx.fillStyle = es.bottom; ctx.fillRect(px, py + 14, 16, 2); }
  if (lf || rt) {
    ctx.fillStyle = es.side;
    if (lf) ctx.fillRect(px, py, 2, 16);
    if (rt) ctx.fillRect(px + 14, py, 2, 16);
    // 暴露角 L 形切口(侧色; 与顶/侧条叠加后角点最暗 → 圆角轮廓感)
    if (!es.skipTop && up && (lf || rt)) {
      if (lf) { ctx.fillRect(px, py, 2, 4); ctx.fillRect(px, py, 4, 2); }
      if (rt) { ctx.fillRect(px + 14, py, 2, 4); ctx.fillRect(px + 12, py, 4, 2); }
    }
    if (dn && (lf || rt)) {
      if (lf) { ctx.fillRect(px, py + 12, 2, 4); ctx.fillRect(px, py + 14, 4, 2); }
      if (rt) { ctx.fillRect(px + 14, py + 12, 2, 4); ctx.fillRect(px + 12, py + 14, 4, 2); }
    }
  }
}

// ==================== 10-c B: 墙缘暗边 ====================

/** 贴图内已烘焙 rgba(0,0,0,0.42) 墙体暗化(textures.wallFrom), 此处只补墙-空气交界的深色描边 */
const WALL_EDGE = 'rgba(0,0,0,0.30)';

/** 原版墙贴图(dirt_wall_tileset)是未暗化原图, 绘制后叠 0.45 黑(参考站取值, 比程序化烘焙 0.42 略深) */
const WALL_DIM = 'rgba(0,0,0,0.45)';

// ==================== 10-c C: 深度分层背景 (程序化, 预生成一次) ====================

/** 平滑阶梯(交叠渐变用) */
function ss01(v: number): number {
  const c = v < 0 ? 0 : v > 1 ? 1 : v;
  return c * c * (3 - 2 * c);
}

/** 量化 alpha → rgba 字符串表(模块级预生成, 每帧零字符串分配) */
function mkRamp(rgb: string): string[] {
  const a: string[] = new Array(101);
  for (let i = 0; i <= 100; i++) a[i] = `rgba(${rgb},${(i / 100).toFixed(2)})`;
  return a;
}
const DIRT_RAMP = mkRamp('20,14,10');    // 土层整体暗化(最深 0.55)
const STONE_RAMP = mkRamp('10,10,16');   // 石层/洞穴(最深 0.70)
const HELL_RAMP = mkRamp('40,8,4');      // 地狱暗红(最深 0.80)
const GLOW_RAMP = mkRamp('122,32,8');    // 地狱底部岩浆光晕 #7a2008

/** 远处树林剪影层: 800×200, 底部对齐地表线; 圆弧树冠 + 主干, 环绕无缝平铺 */
function makeForestLayer(seed: number, color: string, hMin: number, hMax: number): HTMLCanvasElement {
  const W = 800, H = 200;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d')!;
  const r = mulberry32(seed);
  x.fillStyle = color;
  x.fillRect(0, H - 4, W, 4);                       // 贴合地表的连续地被带(防树间露缝悬空)
  const n = 24 + ((r() * 8) | 0);
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(r() * W);
    const th = hMin + r() * (hMax - hMin);          // 树整体高度
    const tw = 2 + ((r() * 2) | 0);                 // 主干宽 2-3px
    const trunkH = th * (0.45 + r() * 0.2);         // 主干露出高度
    const topY = H - 4 - th;
    const blobs = 2 + ((r() * 3) | 0);              // 2-4 团圆弧树冠
    // 树冠参数先定稿再绘制, 保证环绕副本与本体完全一致(接缝无缝)
    const crown: number[][] = [];
    let rw = th * (0.30 + r() * 0.15);
    let cy = topY + rw * 0.5;
    for (let b = 0; b < blobs; b++) {
      crown.push([(r() - 0.5) * rw * 1.5, cy - topY, rw]);
      cy += rw * 0.62;
      rw *= 0.78;
    }
    const ext = th * 0.5 + 4;
    const xs = cx < ext ? [cx, cx + W] : cx > W - ext ? [cx, cx - W] : [cx];
    for (const bx of xs) {
      x.fillRect(bx - (tw >> 1), H - 4 - trunkH, tw, trunkH + 4);
      for (const c of crown) {
        x.beginPath();
        x.arc(bx + c[0], topY + c[1], c[2], 0, Math.PI * 2);
        x.fill();
      }
    }
  }
  return cv;
}

/** 洞穴大石暗斑 pattern 512×512: 稀疏 #16181e 大石剪影(3-6 团圆弧聚合), 九宫平铺保证无缝 */
function makeCaveRocks(): HTMLCanvasElement {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const x = cv.getContext('2d')!;
  const r = mulberry32(91551);
  x.fillStyle = '#16181e';
  for (let i = 0; i < 13; i++) {
    const bx = r() * S, by = r() * S;
    const parts = 3 + ((r() * 4) | 0);
    let rad = 16 + r() * 30;
    for (let j = 0; j < parts; j++) {
      const px = bx + (r() - 0.5) * rad * 2.4;
      const py = by + (r() - 0.5) * rad * 2.4;
      const pr = rad * (0.55 + r() * 0.5);
      for (let ox = -S; ox <= S; ox += S) {
        for (let oy = -S; oy <= S; oy += S) {
          x.beginPath();
          x.arc(px + ox, py + oy, pr, 0, Math.PI * 2);
          x.fill();
        }
      }
      rad *= 0.92;
    }
  }
  return cv;
}

let silFar: HTMLCanvasElement | null = null;    // 远层剪影 #2a4535 (视差 0.25)
let silNear: HTMLCanvasElement | null = null;   // 近层剪影 #1d3328 (视差 0.35)
let caveRocks: HTMLCanvasElement | null = null; // 洞穴大石斑(视差 0.5)

/**
 * 地表树林剪影(屏幕空间, 山峦之上/地形之下)：两层深浅圆弧树冠,
 * 底部对齐地表线, 随相机入地淡出; 夜间随阳光强度压暗。
 */
function drawForestBackdrop(g: GameEngine, ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const fade = 1 - clamp(g.sky.depthPx / 460, 0, 1);   // 相机入地后渐隐(山峦同此节奏)
  if (fade <= 0.02) return;
  // 懒初始化(局部变量窄化类型, 模块级缓存)
  const far = silFar ?? (silFar = makeForestLayer(10011, '#2a4535', 46, 96));
  const near = silNear ?? (silNear = makeForestLayer(10012, '#1d3328', 64, 132));
  const zoom = g.zoom;
  const patW = 800 * zoom, patH = 200 * zoom;
  const surfY = Math.round((g.surfaceYpx() - g.camY) * zoom);   // 地表线(相机中心列)屏幕 y
  const dim = 0.5 + 0.5 * g.sky.skyLight;                       // 夜间压暗剪影
  ctx.imageSmoothingEnabled = false;
  // 远层: 视差 0.25
  let y = surfY - patH + 2 * zoom;
  if (y < H && y + patH > -8) {
    const scroll = (g.camX * 0.25) % patW;
    ctx.globalAlpha = 0.62 * fade * dim;
    for (let sx = -scroll; sx < W; sx += patW) ctx.drawImage(far, Math.round(sx), y, patW, patH);
  }
  // 近层: 视差 0.35, 锚点略低/树更高
  y = surfY - patH + 5 * zoom;
  if (y < H && y + patH > -8) {
    const scroll = (g.camX * 0.35) % patW;
    ctx.globalAlpha = 0.85 * fade * dim;
    for (let sx = -scroll; sx < W; sx += patW) ctx.drawImage(near, Math.round(sx), y, patW, patH);
  }
  ctx.globalAlpha = 1;
}

/**
 * 深度分层背景(世界空间, 墙之上/方块之下)：
 * 土层(地表下 40 格→35%) 整体叠棕暗; 石层/洞穴(35%→75%) 叠蓝黑 + 大石斑 pattern(视差 0.5);
 * 地狱(85%+) 叠暗红 + 屏底岩浆光晕。区间交叠 10% 平滑插值, 深度按玩家 y 相对地表线归一。
 */
function drawDepthBackdrop(g: GameEngine, ctx: CanvasRenderingContext2D, wld: World): void {
  const p = g.player;
  const pgx = clamp(Math.floor(p.x / 16), 0, wld.w - 1);
  const surf = wld.surface[pgx];
  const span = Math.max(80, wld.hellY - surf);       // 地表→地狱的地下跨度(格)
  const nd = (p.y / 16 - surf) / span;                // 归一化深度(0=地表, 1≈地狱顶)
  const nd0 = 40 / span;                              // 土层起点(+40 格)
  const aDirt = 0.55 * ss01((nd - nd0) / Math.max(0.04, 0.35 - nd0)) * (1 - ss01((nd - 0.35) / 0.10));
  const aStone = 0.70 * ss01((nd - 0.35) / 0.10) * (1 - ss01((nd - 0.75) / 0.10));
  const aHell = 0.80 * ss01((nd - 0.75) / 0.10);
  if (aDirt <= 0.004 && aStone <= 0.004 && aHell <= 0.004) return;
  const vx = g.camX - 16, vy = g.camY - 16;           // 视口(世界像素, 外扩 1 格防震动露边)
  const vw = g.viewW() + 32, vh = g.viewH() + 32;
  if (aDirt > 0.004) {
    ctx.fillStyle = DIRT_RAMP[Math.round(aDirt * 100)];
    ctx.fillRect(vx, vy, vw, vh);
  }
  if (aStone > 0.004) {
    ctx.fillStyle = STONE_RAMP[Math.round(aStone * 100)];
    ctx.fillRect(vx, vy, vw, vh);
    // 洞穴大石暗斑: 预生成 512×512 pattern, 视差 0.5 世界坐标平铺
    const rocks = caveRocks ?? (caveRocks = makeCaveRocks());
    ctx.globalAlpha = clamp(aStone / 0.7, 0, 1) * 0.9;
    const S = 512;
    const sx0 = Math.floor((vx * 0.5) / S) * S;
    const sy0 = Math.floor((vy * 0.5) / S) * S;
    for (let yy = sy0; yy < vy + vh; yy += S) {
      for (let xx = sx0; xx < vx + vw; xx += S) ctx.drawImage(rocks, xx, yy);
    }
    ctx.globalAlpha = 1;
  }
  if (aHell > 0.004) {
    ctx.fillStyle = HELL_RAMP[Math.round(aHell * 100)];
    ctx.fillRect(vx, vy, vw, vh);
    // 屏底岩浆光晕渐变 #7a2008
    const gy = vy + vh * 0.5;
    const grad = ctx.createLinearGradient(0, gy, 0, vy + vh);
    grad.addColorStop(0, 'rgba(122,32,8,0)');
    grad.addColorStop(1, GLOW_RAMP[Math.round(aHell * 60)]);
    ctx.fillStyle = grad;
    ctx.fillRect(vx, gy, vw, vh - vh * 0.5);
  }
}

// ==================== 12-b: 原版分层背景图(屏幕空间) ====================

/**
 * 原版背景系统(素材就绪时替代 drawForestBackdrop + drawDepthBackdrop):
 * 按玩家深度选层 —— 地表(森林双图按相机 x 交替 / 腐化群系用 bg_corruption_1) → 地下 → 洞穴 →
 * 熔岩 → 地狱; 整屏铺满(背景图自带天空), 0.5 视差横向平铺; 地下层叠 0.15→0.5 深度暗化(越深越暗)。
 * 层界锚定: 参考站阈值(y<15%/30%/50%/70% 世界高)按其地表位置标定; 我方地表在 ~0.28h
 * (world.ts baseSurf = min(96, h*0.283)), 故改用"玩家列地表线 + hellY"锚定, 语义等价
 * (地表=森林 / 地狱起点=underworld)。
 */
function drawImgBackdrop(g: GameEngine, ctx: CanvasRenderingContext2D, W: number, H: number, A: Assets, wld: World): void {
  const p = g.player;
  const pgx = clamp(Math.floor(p.x / 16), 0, wld.w - 1);
  const ty = (p.y - p.h / 2) / 16;                 // 玩家中心所在格 y
  const surf = wld.surface[pgx];
  const span = Math.max(60, wld.hellY - surf);     // 地表→地狱 跨度(格)
  let name: string;
  let deep = false;                                // 森林层不叠暗化
  if (ty < surf + 6) {
    if (wld.biomeAt(pgx) === BIOME.CORRUPTION) {
      name = 'bg_corruption_1';
    } else {
      const camTX = (g.camX + g.viewW() / 2) / 16; // 相机中心格 x, 每 100 格交替双图
      name = Math.floor(camTX / 100) % 2 === 0 ? 'bg_forest_1' : 'bg_forest_2';
    }
  } else if (ty < surf + span * 0.28) {
    name = 'bg_underground_2'; deep = true;
  } else if (ty < surf + span * 0.58) {
    name = 'bg_cavern_4'; deep = true;
  } else if (ty < wld.hellY) {
    name = 'bg_lava_4'; deep = true;
  } else {
    name = 'bg_underworld_2'; deep = true;
  }
  const img = A.img(name);
  if (!img) return;                                // 单图缺失: 保留天空, 不画背景
  // 未加载完成的 HTMLImageElement naturalWidth=0 → 跳过(不产生 Infinity 缩放)
  const iw = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const ih = 'naturalHeight' in img ? img.naturalHeight : img.height;
  if (!(iw > 0) || !(ih > 0)) return;
  const scale = H / ih;                            // 高度铺满视口(屏幕像素)
  const w = iw * scale;
  const par = (g.camX * g.zoom * 0.5) % w;         // 0.5 视差(世界移动速率的一半, 折算屏幕像素)
  ctx.imageSmoothingEnabled = true;                // 背景图大幅放大, 保持平滑(参考站观感)
  for (let sx = -par; sx < W; sx += w) ctx.drawImage(img, sx, 0, w, H);
  if (deep) {
    const d01 = clamp((ty - surf - 6) / (wld.hellY - surf), 0, 1);
    ctx.fillStyle = `rgba(0,0,0,${(0.15 + 0.35 * d01).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.imageSmoothingEnabled = false;
}

export function renderGame(g: GameEngine): void {
  if (!g.world || !g.player) return;
  const ctx = g.ctx;
  const W = g.vw, H = g.vh;
  const playing = g.screen === 'playing';
  const showPlayer = playing && !g.player.dead;

  // ---- 12-b: 原版素材就绪状态(未就绪 → 触发幂等加载, 全部走程序化回退) ----
  const A = getAssets();
  const useAssets = A.ready;
  if (!useAssets) loadAssets();
  else if (!itemIconsApplied) {
    applyItemIcons(g.tex);      // 用原版 PNG 覆盖物品图标/挥舞锚点(仅首次就绪时一次)
    itemIconsApplied = true;
  }

  // ---- 天空(屏幕空间) ----
  g.sky.dayT = g.dayT();
  g.sky.skyLight = g.skyLightNow();
  g.sky.camX = g.camX + g.viewW() / 2;
  g.sky.camY = g.camY + g.viewH() / 2;
  g.sky.depthPx = g.sky.camY - g.surfaceYpx();
  g.sky.timeSec = g.timeSec;
  ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  drawSkyBackground(ctx, W, H, g.sky);
  // ---- 背景(屏幕空间, 天空之后瓦片之前): 原版分层背景图 / 程序化树林剪影 ----
  if (useAssets) drawImgBackdrop(g, ctx, W, H, A, g.world);
  else drawForestBackdrop(g, ctx, W, H);

  // ---- 世界空间 ----
  // 14-a 关键修复: 基础变换已是 dpr(506 行 setTransform), 这里只需再乘 zoom。
  // 旧代码 zoom*dpr 会把世界放大 dpr² 倍 —— 手机/retina(dpr≥2)上视野只剩一半,
  // 玩家(相机按 vw/zoom 计算)随之"不在画面中心/跑出画面/消失"。
  ctx.save();
  ctx.scale(g.zoom, g.zoom);
  // 屏幕震动: 相机偏移(世界像素, zoom 后即屏幕抖动); cull 范围外扩 1 格防止抖动露出边缘空隙
  ctx.translate(
    -Math.round((g.camX + g.shakeX) * 2) / 2,
    -Math.round((g.camY + g.shakeY) * 2) / 2,
  );
  ctx.imageSmoothingEnabled = false;

  const x0 = Math.max(0, Math.floor(g.camX / 16) - 1);
  const x1 = Math.min(g.world.w - 1, Math.ceil((g.camX + g.viewW()) / 16) + 1);
  const y0 = Math.max(0, Math.floor(g.camY / 16) - 1);
  const y1 = Math.min(g.world.h - 1, Math.ceil((g.camY + g.viewH()) / 16) + 1);
  const wld = g.world;
  const tex = g.tex;

  // ---- 全屏地图迷雾缓存增量维护(世界变更时全量重建一次, 平时仅坐标比较) ----
  updateFog(g);

  // ---- 背景墙 (程序化: 贴图已烘焙 0.42 暗化 / 原版: dirt_wall 未暗化原图 + 0.45 叠暗)
  //      + 墙缘暗边(与无墙空气交界 2px, 洞穴纵深) ----
  const dirtWallImg = useAssets ? A.img('dirt_wall_tileset') : null;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const id = wld.tiles[y * wld.w + x];
      if (TileDefs[id].solid) continue;
      const wall = wld.walls[y * wld.w + x];
      if (!wall) continue;
      const px = x * 16, py = y * 16;
      if (wall === W_DIRT && dirtWallImg) {
        ctx.drawImage(dirtWallImg, 0, 0, 16, 16, px, py, 16, 16);
        ctx.fillStyle = WALL_DIM;                       // 原版墙图未烘焙暗化, 叠 0.45(参考站值)
        ctx.fillRect(px, py, 16, 16);
      } else {
        const arr = tex.walls.get(wall);
        if (arr) ctx.drawImage(arr[(x * 7 + y * 11) % arr.length], px, py);
      }
      // 墙缘: 邻格无墙且邻格非实心方块(实心方块会盖住描边) → 该侧 2px 深色
      const wU = !wld.getWall(x, y - 1) && !TileDefs[wld.get(x, y - 1)].solid;
      const wD = !wld.getWall(x, y + 1) && !TileDefs[wld.get(x, y + 1)].solid;
      const wL = !wld.getWall(x - 1, y) && !TileDefs[wld.get(x - 1, y)].solid;
      const wR = !wld.getWall(x + 1, y) && !TileDefs[wld.get(x + 1, y)].solid;
      if (wU || wD || wL || wR) {
        ctx.fillStyle = WALL_EDGE;
        if (wU) ctx.fillRect(px, py, 16, 2);
        if (wD) ctx.fillRect(px, py + 14, 16, 2);
        if (wL) ctx.fillRect(px, py, 2, 16);
        if (wR) ctx.fillRect(px + 14, py, 2, 16);
      }
    }
  }

  // ---- 深度分层背景(墙之上/方块之下; 原版素材时已由屏幕空间背景图替代) ----
  if (!useAssets) drawDepthBackdrop(g, ctx, wld);

  // ---- 瓦片 ----
  const glows: { c: HTMLCanvasElement; x: number; y: number; s: number }[] = [];
  const roots: { c: HTMLCanvasElement; x: number; y: number }[] = [];
  const flameFrame = (g.frame >> 3) & 3;

  // ---- 12-b: 整树精灵扫描(原版素材) ----
  // 树基 = TRUNK 列最底格(下方实心或草); 基准行向下多扫 24 行: 视口下缘以下的树,
  // 其树干/树冠仍可能探入视口(树最高约 16 干 + 7 行冠); 左右多扫 6 列盖住冠幅溢出。
  // 瓦片循环里 TRUNK/LEAF* 命中已扫描树则跳过, 循环后统一画整树精灵。
  const treeImg = useAssets ? A.img('tree_example') : null;
  const trees: TreeEntry[] = [];
  if (treeImg) {
    const scanBottom = Math.min(wld.h - 1, y1 + 24);
    const scanL = Math.max(0, x0 - 6), scanR = Math.min(wld.w - 1, x1 + 6);
    for (let x = scanL; x <= scanR; x++) {
      for (let y = y0; y <= scanBottom; y++) {
        if (wld.tiles[y * wld.w + x] !== T.TRUNK) continue;
        if (wld.get(x, y + 1) === T.TRUNK) continue;   // 非树干段底 → 跳过
        const below = wld.get(x, y + 1);
        if (!TileDefs[below].solid && below !== T.GRASS && below !== T.JUNGLE_GRASS && below !== T.CORRUPT_GRASS) continue; // 浮空干: 无树基
        let heightTiles = 1;
        while (heightTiles < 64 && wld.get(x, y - heightTiles) === T.TRUNK) heightTiles++;
        trees.push({ x, baseY: y, heightTiles, variant: cellHash(x, y) });
      }
    }
    trees.sort((a, b) => a.x - b.x);                   // 按 x 排序绘制(参考站顺序)
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const id = wld.tiles[y * wld.w + x];
      if (id === T.AIR) continue;
      const px = x * 16, py = y * 16;

      if (useAssets) {
        // ---- 12-b: 原版贴图瓦片(TILE_SHEET 映射): 邻接同族选帧, 不再程序化绘制/描边(贴图自带边缘) ----
        const conf = TILE_SHEET[id];
        if (conf) {
          const sheet = A.img(conf.name);
          if (sheet) {
            const fam = tileFamily(id);
            const fr = frameFor(
              tileFamily(wld.get(x, y - 1)) === fam,
              tileFamily(wld.get(x + 1, y)) === fam,
              tileFamily(wld.get(x, y + 1)) === fam,
              tileFamily(wld.get(x - 1, y)) === fam,
              conf.table, conf.step,
            );
            if (fr.flipY) {
              // 上同下不同时帧上下互换 + 垂直翻转(参考站 rN 规则)
              ctx.save();
              ctx.translate(px + 8, py + 8);
              ctx.scale(1, -1);
              ctx.translate(-8, -8);
              ctx.drawImage(sheet, fr.sx, 0, 16, 16, 0, 0, 16, 16);
              ctx.restore();
            } else {
              ctx.drawImage(sheet, fr.sx, 0, 16, 16, px, py, 16, 16);
            }
            if (id === T.HELLSTONE) {
              // 狱岩: 贴图路径保留余烬闪烁 + 红光
              const h = cellHash(x, y);
              if (h % 100 < 6) {
                const tw = 0.5 + 0.5 * Math.sin(g.timeSec * 3 + x);
                ctx.fillStyle = `rgba(255,150,60,${(0.3 + 0.6 * tw).toFixed(2)})`;
                ctx.fillRect(px + ((h >>> 7) % 14) + 1, py + ((h >>> 11) % 14) + 1, 1, 1);
              }
              if (h % 8 === 0) glows.push({ c: tex.glowRed, x: px + 8, y: py + 8, s: 60 });
            }
            continue;
          }
        }
        // ---- 12-b: 整树精灵: TRUNK/LEAF* 属于已扫描树则跳过逐格绘制(循环后画整树);
        //      浮空干 / 孤立树冠回退程序化 ----
        if (treeImg) {
          if (id === T.TRUNK) {
            if (trunkInTree(trees, x, y)) continue;
          } else if (id === T.LEAF || id === T.LEAF_SNOW || id === T.LEAF_JUNGLE || id === T.LEAF_CORRUPT) {
            if (leafInTree(trees, x, y)) continue;
          }
        }
      }

      if (id === T.GRASS) {
        const arr = tex.tiles.get(T.DIRT)!;
        ctx.drawImage(arr[(x * 13 + y * 7) % arr.length], px, py);
        ctx.drawImage(tex.grassTop, px, py - 4);
        if (!wld.isSolid(x - 1, y) && wld.get(x - 1, y) !== T.GRASS) ctx.drawImage(tex.grassSideL, px, py);
        if (!wld.isSolid(x + 1, y) && wld.get(x + 1, y) !== T.GRASS) ctx.drawImage(tex.grassSideR, px, py);
        // 草方块: 顶面由 grassTop 覆层负责(skipTop), 侧/底仍叠泥土系描边
        drawTileEdges(ctx, wld, x, y, px, py, EDGE_STYLES[T.GRASS]!);
        continue;
      }
      if (id === T.LEAF) {
        let mask = 0;
        const isFoliage = (tx: number, ty: number): boolean => {
          const t2 = wld.get(tx, ty);
          return t2 === T.LEAF || t2 === T.TRUNK;
        };
        if (isFoliage(x, y - 1)) mask |= 1;
        if (isFoliage(x, y + 1)) mask |= 2;
        if (isFoliage(x - 1, y)) mask |= 4;
        if (isFoliage(x + 1, y)) mask |= 8;
        const leaf = tex.leaves.get(mask);
        if (leaf) ctx.drawImage(leaf, px, py);
        continue;
      }
      if (id === T.TRUNK) {
        const arr = tex.tiles.get(T.TRUNK)!;
        ctx.drawImage(arr[(x * 13 + y * 7) % arr.length], px, py);
        if (wld.get(x - 1, y) === T.LEAF && (x + y) % 3 === 0) ctx.drawImage(tex.branchL, px, py);
        if (wld.get(x + 1, y) === T.LEAF && (x + y) % 3 === 1) ctx.drawImage(tex.branchR, px, py);
        // 树干底部(下一格不是树干): 根须覆盖层扎入两侧草地(纯视觉, 不参与碰撞/挖掘)
        if (wld.get(x, y + 1) !== T.TRUNK) {
          // 侧邻草地与树干同排(比树基高一格)时上移 8px, 平地草地(下一排)时下移 4px,
          // 使根须恰好横跨草皮表面线, 起点疙瘩贴住树干/树基侧缘
          if (wld.get(x - 1, y) === T.GRASS) roots.push({ c: tex.rootL, x: px - 16, y: py - 8 });
          else if (wld.get(x - 1, y + 1) === T.GRASS) roots.push({ c: tex.rootL, x: px - 16, y: py + 4 });
          if (wld.get(x + 1, y) === T.GRASS) roots.push({ c: tex.rootR, x: px + 16, y: py - 8 });
          else if (wld.get(x + 1, y + 1) === T.GRASS) roots.push({ c: tex.rootR, x: px + 16, y: py + 4 });
        }
        continue;
      }
      if (id === T.WORKBENCH_L) {
        const im = useAssets ? A.img('Work_Bench') : null;
        if (im) ctx.drawImage(im, px, py - 2);            // 原版 32x18, 底对齐 2x1 格
        else ctx.drawImage(tex.sprites.workbench, px, py);
        continue;
      }
      if (id === T.ANVIL_L) {
        const im = useAssets ? A.img('Iron_Anvil_placed') : null;
        if (im) ctx.drawImage(im, px, py - 2);            // 原版 32x18, 底对齐格顶
        else ctx.drawImage(tex.sprites.anvil, px, py);
        continue;
      }
      if (id === T.FURNACE_TL) {
        const im = useAssets ? A.img('Furnace_placed') : null;
        if (im) ctx.drawImage(im, px - 7, py - 2);        // 原版 46x34, 2x2 格水平居中(每侧溢出 7px), 底对齐
        else ctx.drawImage(tex.sprites.furnace, px, py);
        glows.push({ c: tex.glowWarm, x: px + 16, y: py + 18, s: 220 });
        continue;
      }
      // ---- 9-f: 新家具主格(整图绘制, 覆盖多格) ----
      if (id === T.DOOR_C_T) {
        const im = useAssets ? A.img('Wooden_door_closed') : null;
        // 原版门 3 格高(16x48), 我方门占 2 格(DOOR_C_T/B) → 纵向压缩画 16x32
        if (im) ctx.drawImage(im, 0, 0, 16, 48, px, py, 16, 32);
        else ctx.drawImage(tex.sprites.doorC, px, py);
        continue;
      }
      if (id === T.DOOR_O_T) {
        // 开门门板贴左(默认); 左邻实心且右侧空时贴右, 避免门板埋进墙里
        const rightSide = useAssets && wld.isSolid(x - 1, y) && !wld.isSolid(x + 1, y);
        const im = useAssets ? A.img(rightSide ? 'Wooden_door_open_right' : 'Wooden_door_open_left') : null;
        if (im) ctx.drawImage(im, 0, 0, 6, 48, rightSide ? px + 10 : px, py, 6, 32);
        else ctx.drawImage(tex.sprites.doorO, px, py);
        continue;
      }
      if (id === T.CHEST_TL) {
        const im = useAssets ? A.img('Chest') : null;
        if (im) ctx.drawImage(im, px, py + 4);            // 原版 32x28, 底对齐 2x2 格
        else ctx.drawImage(tex.sprites.chest, px, py);
        // 已开启的宝箱: 箱体上方金色微光
        if (g.chestOpen === y * wld.w + x) glows.push({ c: tex.glowWarm, x: px + 16, y: py + 5, s: 120 });
        continue;
      }
      if (id === T.ALTAR_TL) {
        const im = useAssets ? A.img('Demon_Altar') : null;
        // 原版 48x34; 我方祭坛 FURNITURE_SHAPE 实际 2x2 格(非 3x2) → 32px 组宽水平居中 x=px-8, 底对齐 y=py-2
        if (im) ctx.drawImage(im, px - 8, py - 2);
        else ctx.drawImage(tex.sprites.altar, px, py);
        glows.push({ c: tex.glowRed, x: px + 16, y: py + 14, s: 150 });
        // 祭坛上方 3 个红色浮动符文点(sin 浮动)
        ctx.fillStyle = 'rgba(255,70,70,0.9)';
        for (let i = 0; i < 3; i++) {
          const rx = px + 5 + i * 11 + Math.round(Math.sin(g.timeSec * 1.7 + i * 2.1) * 2);
          const ry = py - 3 - i * 3 + Math.round(Math.sin(g.timeSec * 2.4 + i * 1.3) * 2);
          ctx.fillRect(rx, ry, 1, 1);
        }
        continue;
      }
      if (id === T.TABLE_L) { ctx.drawImage(tex.sprites.table, px, py); continue; }
      if (id === T.CHAIR) {
        const im = useAssets ? A.img('Wooden_Chair') : null;
        if (im) ctx.drawImage(im, px, py - 16);           // 原版 16x32, 椅背向上溢出 1 格
        else ctx.drawImage(tex.sprites.chair, px, py);
        continue;
      }
      // ---- 家具子格跳过(主格整图已覆盖): 旧 21-25 + 门底/宝箱/祭坛/桌右 ----
      if (
        (id > T.FURNACE_TL && id <= T.ANVIL_R)
        || id === T.DOOR_C_B || id === T.DOOR_O_B
        || (id >= T.CHEST_TR && id <= T.CHEST_BR)
        || (id >= T.ALTAR_TR && id <= T.ALTAR_BR)
        || id === T.TABLE_R
      ) continue;
      if (id === T.WATER) {
        ctx.fillStyle = 'rgba(44,90,196,0.62)';
        ctx.fillRect(px, py, 16, 16);
        if (wld.get(x, y - 1) !== T.WATER) {
          // 波纹动画: 4 段高光小矩形各自随 sin 起伏(像素阶梯感) + 随时间漂移的白色高光点
          const ph = g.timeSec * 2.2;
          ctx.fillStyle = 'rgba(150,196,255,0.5)';
          for (let s = 0; s < 4; s++) {
            const wy = Math.round(Math.sin(ph + (x + s * 0.25) * 0.9) * 1.2);
            ctx.fillRect(px + s * 4, py + wy, 4, 2);
          }
          ctx.fillStyle = 'rgba(220,240,255,0.6)';
          const spx = (x * 7 + Math.floor(g.timeSec * 8)) % 16;
          const spx2 = (spx + 8) % 16;
          ctx.fillRect(px + spx, py + Math.round(Math.sin(ph + (x + spx / 16) * 0.9) * 1.2), 1, 1);
          ctx.fillRect(px + spx2, py + Math.round(Math.sin(ph + (x + spx2 / 16) * 0.9) * 1.2), 1, 1);
        }
        continue;
      }
      if (id === T.LAVA) {
        // 岩浆液体: 仿 WATER 画法(橙红半透明 + 顶面波纹 + 随机冒泡), 每格计入红光晕
        ctx.fillStyle = 'rgba(232,88,24,0.88)';
        ctx.fillRect(px, py, 16, 16);
        if (wld.get(x, y - 1) !== T.LAVA) {
          const ph = g.timeSec * 2.2;
          ctx.fillStyle = 'rgba(255,180,80,0.55)';
          for (let s = 0; s < 4; s++) {
            const wy = Math.round(Math.sin(ph + (x + s * 0.25) * 0.9) * 1.2);
            ctx.fillRect(px + s * 4, py + wy, 4, 2);
          }
          // 顶面随机冒泡: 坐标 hash 决定是否冒/位置/相位, 亮黄 1px 点上浮
          const h = cellHash(x, y);
          if (h % 4 !== 0) {
            const cyc = (g.timeSec * 1.3 + (h % 100) / 100) % 1;
            ctx.fillStyle = `rgba(255,224,130,${(0.85 - cyc * 0.45).toFixed(2)})`;
            ctx.fillRect(px + ((h >>> 8) % 15), py + 1 - Math.round(cyc * 5), 1, 1);
          }
        }
        glows.push({ c: tex.glowRed, x: px + 8, y: py + 8, s: 130 });
        continue;
      }
      if (id === T.TORCH) {
        // 原版火把(含火焰动画): 下方实心 = 地面火把, 否则墙火把(右侧实心时镜像)
        const drew = useAssets
          && drawImgTorch(ctx, px, py, wld.isSolid(x, y + 1), wld.isSolid(x + 1, y), performance.now());
        if (!drew) {
          const arr = tex.tiles.get(T.TORCH)!;
          ctx.drawImage(arr[0], px, py);
          ctx.drawImage(tex.flames[flameFrame], px + 4, py - 5);
        }
        glows.push({ c: tex.glowWarm, x: px + 8, y: py + 2, s: 150 });
        continue;
      }
      // ---- 9-f: 发光方块 ----
      if (id === T.HELLSTONE) {
        const arr = tex.tiles.get(T.HELLSTONE)!;
        ctx.drawImage(arr[(x * 13 + y * 7) % arr.length], px, py);
        const h = cellHash(x, y);
        if (h % 100 < 6) {
          // 6% 概率叠 1px 橙色余烬闪烁点
          const tw = 0.5 + 0.5 * Math.sin(g.timeSec * 3 + x);
          ctx.fillStyle = `rgba(255,150,60,${(0.3 + 0.6 * tw).toFixed(2)})`;
          ctx.fillRect(px + ((h >>> 7) % 14) + 1, py + ((h >>> 11) % 14) + 1, 1, 1);
        }
        if (h % 8 === 0) glows.push({ c: tex.glowRed, x: px + 8, y: py + 8, s: 60 });
        drawTileEdges(ctx, wld, x, y, px, py, EDGE_STYLES[T.HELLSTONE]!);
        continue;
      }
      if (id === T.MUSH_CAP) {
        const arr = tex.tiles.get(T.MUSH_CAP)!;
        ctx.drawImage(arr[(x * 13 + y * 7) % arr.length], px, py);
        glows.push({ c: tex.glowBlue, x: px + 8, y: py + 8, s: 110 });
        continue;
      }
      if (id === T.LIFE_CRYSTAL) {
        // 原版生命水晶: 静态完整帧(素材为 5 列×3 行 32x32 心形品阶表, 首格为完整态;
        // 旧版循环 0-4 帧 = 播放"充能-耗尽"序列, 看起来像水晶在抽搐)
        const im = useAssets ? A.img('Life_Crystal_ingame') : null;
        if (im) {
          ctx.drawImage(im, 0, 0, 32, 32, px - 8, py - 8, 32, 32);
        } else {
          // 粉水晶两帧脉动(暖粉光晕)
          ctx.drawImage(tex.crystalFrames[(g.frame >> 4) & 1], px, py);
        }
        glows.push({ c: tex.glowRed, x: px + 8, y: py + 8, s: 140 });
        continue;
      }
      // ---- 12-b: 平台/树苗/高草(原版 PNG, 未就绪回退程序化通用路径) ----
      if (useAssets && id === T.PLATFORM) {
        const im = A.img('Wood_Platform');
        if (im) {
          // 顶对齐格顶(单向平台碰撞落点 = 格顶, moveBody b.y=ty*16); 宽 16 等比缩放(原图 24x14 → 高 9)
          const iw = 'naturalWidth' in im ? im.naturalWidth : im.width;
          const ih = 'naturalHeight' in im ? im.naturalHeight : im.height;
          if (iw > 0 && ih > 0) {
            ctx.drawImage(im, px, py, 16, Math.max(5, Math.round((16 * ih) / iw)));
            continue;
          }
        }
      }
      if (useAssets && id === T.SAPLING) {
        const im = A.img('Sapling');
        if (im) { ctx.drawImage(im, px + 1.5, py - 16, 13, 32); continue; }  // 原版 14x34 → 13x32(贴树基比例)
      }
      if (useAssets && id === T.TGRASS) {
        // 原版高草 24px 随风摆(丛林泥/丛林草上用绿色叠加变体)
        const below = wld.get(x, y + 1);
        if (drawTallGrass(
          ctx, px, py, cellHash(x, y) % 6,
          below === T.JUNGLE_GRASS || below === T.MUD ? 'jungle' : 'grass',
          g.timeSec * 1000, x * 7 + y * 11,
        )) continue;
      }
      // 通用路径: SAND/SNOW/ICE/MUD/JUNGLE_GRASS/CORRUPT_GRASS/CORRUPT_STONE/ASH/OBSIDIAN/
      //          MUSH_STEM/CACTUS/SAPLING/VINE/LEAF_SNOW/LEAF_JUNGLE/LEAF_CORRUPT 等自包含贴图
      const arr = tex.tiles.get(id);
      if (arr) ctx.drawImage(arr[(x * 13 + y * 7) % arr.length], px, py);
      // 实心材质(泥土/石头/矿/沙/雪/冰/泥/黑曜石/木/仙人掌等)四邻描边; 装饰/家具不在表内自动跳过
      const es = EDGE_STYLES[id];
      if (es) drawTileEdges(ctx, wld, x, y, px, py, es);
    }
  }

  // ---- 树根覆盖层(程序化路径; 整树精灵时 TRUNK 被跳过, roots 恒为空) ----
  for (const rt of roots) ctx.drawImage(rt.c, rt.x, rt.y);

  // ---- 12-b: 整树精灵(原版 tree_example, 替代逐格 TRUNK/LEAF; 已按 x 排序) ----
  // drawTreeSprite 契约(assets.ts): baseX/baseY = 树基格世界px(树底对齐树基格底,
  // 内部 dy=baseY+16-h), 故传 (列中心, 树基格顶 y); variant 奇数水平翻转
  if (treeImg) {
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      drawTreeSprite(ctx, t.x * 16 + 8, t.baseY * 16, t.heightTiles, t.variant, treeTintAt(wld, t.x, t.baseY), 0);
    }
  }

  // ---- 挖掘裂纹 ----
  if (g.mineDamage.size > 0) {
    for (const [idx, dmg] of g.mineDamage) {
      const x = idx % wld.w, y = (idx / wld.w) | 0;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const id = wld.tiles[idx];
      const hardness = TileDefs[id].hardness;
      if (hardness <= 0) continue;
      const stage = Math.min(3, Math.floor((dmg / hardness) * 4));
      ctx.drawImage(tex.cracks[stage], x * 16, y * 16);
    }
  }

  // ---- 掉落物 ----
  for (const d of g.drops) {
    const icon = tex.icons[d.id];
    if (!icon) continue;
    // 15-a: 原生物品尺寸(旧版统一 16x18; 铜镦等工具 32px 掉落物应与原版一致可观)
    const bob = Math.sin(d.bob) * 1.6;
    const s = itemDrawSize(d.id);
    ctx.drawImage(icon, d.x - s / 2, d.y - s / 2 + bob, s, s);
  }

  // ---- 敌怪(原版素材优先, 未就绪/无映射回退程序化) ----
  for (const e of g.enemies) {
    const flash = e.flash > 0;
    if (e.kind === 'gslime' || e.kind === 'bslime') {
      if (useAssets
        && drawImgSlime(
          ctx, e.kind === 'gslime' ? 'green' : 'blue',
          e.x + IMG_OFF.slime[0], e.y + IMG_OFF.slime[1], e.anim * 0.06, e.dir, flash, performance.now(),
        )) continue;
      const squish = e.onGround
        ? (Math.abs(e.vx) > 0.3 ? 0.22 : 0.1 + 0.08 * Math.sin(e.anim * 0.08))
        : (e.vy < 0 ? -0.28 : 0.34);
      drawSlime(ctx, e.kind === 'gslime' ? SLIME_GREEN : SLIME_BLUE, e.x, e.y, e.w, e.h, squish, e.dir, flash);
    } else if (e.kind === 'zombie') {
      if (useAssets
        && drawImgZombie(ctx, e.x + IMG_OFF.zombie[0], e.y + IMG_OFF.zombie[1], e.anim * 0.13, e.dir, flash)) continue;
      drawHumanoid(ctx, ZOMBIE_PALETTE, {
        x: e.x, y: e.y, dir: e.dir, walkT: e.anim * 0.13, onGround: e.onGround, vy: e.vy,
        zombieArms: true, flash,
      });
    } else if (e.kind === 'eye') {
      if (useAssets
        && drawImgEye(ctx, e.x + IMG_OFF.eye[0], e.y + IMG_OFF.eye[1], e.anim * 0.1, e.dir, flash)) continue;
      drawEye(ctx, e.x, e.y, e.w, e.h, e.anim, e.dir, flash);
    } else if (e.kind === 'bat') {
      if (useAssets
        && drawImgBat(ctx, e.x + IMG_OFF.bat[0], e.y + IMG_OFF.bat[1], e.anim * 0.15, e.dir, flash)) continue;
      drawBat(ctx, e.x, e.y, e.w, e.h, e.anim, e.dir, flash);
    } else if (e.kind === 'skel') {
      if (useAssets
        && drawImgSkeleton(ctx, e.x + IMG_OFF.skel[0], e.y + IMG_OFF.skel[1], e.anim * 0.13, e.dir, flash)) continue;
      drawHumanoid(ctx, SKELETON_PALETTE, {
        x: e.x, y: e.y, dir: e.dir, walkT: e.anim * 0.13, onGround: e.onGround, vy: e.vy,
        zombieArms: true, flash,
      });
    } else if (e.kind === 'lslime') {
      let drew = false;
      if (useAssets) {
        drew = drawImgSlime(
          ctx, 'lava', e.x + IMG_OFF.slime[0], e.y + IMG_OFF.slime[1], e.anim * 0.06, e.dir, flash, performance.now(),
        );
      }
      if (!drew) {
        const squish = e.onGround
          ? (Math.abs(e.vx) > 0.3 ? 0.22 : 0.1 + 0.08 * Math.sin(e.anim * 0.08))
          : (e.vy < 0 ? -0.28 : 0.34);
        drawSlime(ctx, LAVA_SLIME, e.x, e.y, e.w, e.h, squish, e.dir, flash);
      }
      // 熔岩史莱姆自带红光(仅屏内计入, 避免挤占光晕上限)
      if (e.x > g.camX - 32 && e.x < g.camX + g.viewW() + 32 && e.y > g.camY - 32 && e.y < g.camY + g.viewH() + 32) {
        glows.push({ c: tex.glowRed, x: e.x, y: e.y - e.h / 2, s: 90 });
      }
    } else if (e.kind === 'eos') {
      if (useAssets
        && drawImgEos(ctx, e.x + IMG_OFF.eos[0], e.y + IMG_OFF.eos[1], e.anim * 0.1, e.dir, flash)) continue;
      drawEos(ctx, e.x, e.y, e.w, e.h, e.anim, e.dir, flash);
    } else if (e.kind === 'eoc') {
      // 蓄力/旋转前摇: 整体 ±1.5px 随机抖动; facing = 冲刺方向(素材旋转后瞳孔朝左, 向右时镜像)
      const jitter = e.mode === 'telegraph' || e.mode === 'spin';
      const jx = jitter ? (Math.random() * 2 - 1) * 1.5 : 0;
      const jy = jitter ? (Math.random() * 2 - 1) * 1.5 : 0;
      const eocFacing = e.vx !== 0 ? Math.sign(e.vx) : Math.sign(g.player.x - e.x) || 1;
      if (useAssets && drawImgEoC(
        ctx, e.x + jx, e.y + jy, e.phase ?? 0,
        (g.player.x - e.x) * 0.02, (g.player.y - g.player.h / 2 - e.y) * 0.02,
        e.mode === 'spin' ? performance.now() / 100 % (Math.PI * 2) : 0, flash, eocFacing,
      )) continue;
      drawEoC(
        ctx, e.x + jx, e.y + jy, e.w, e.h, e.phase ?? 0,
        (g.player.x - e.x) * 0.06, (g.player.y - g.player.h / 2 - e.y) * 0.06,
        e.anim, e.flash,
      );
    }
  }

  // ---- 向导 NPC(原版精灵优先, 名牌/气泡保留) ----
  const gd = g.guide;
  if (gd) {
    if (!useAssets || !drawImgGuide(ctx, gd.x + IMG_OFF.guide[0], gd.y + IMG_OFF.guide[1], gd.walkT, gd.dir, false)) {
      drawHumanoid(ctx, GUIDE_PALETTE, {
        x: gd.x, y: gd.y, dir: gd.dir, walkT: gd.walkT, onGround: gd.onGround, vy: gd.vy,
      });
    }
    // 头顶名牌
    ctx.font = '7px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const nw = ctx.measureText('向导').width + 6;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(gd.x - nw / 2, gd.y - gd.h - 14, nw, 10);
    ctx.fillStyle = '#f0e8d8';
    ctx.fillText('向导', gd.x, gd.y - gd.h - 6);
    // 对话气泡(圆角白框 + 黑描边 + 尾巴, 宽度自适应, 随剩余时长淡出)
    if (gd.talkT > 0 && g.guideLine) {
      const alpha = clamp(gd.talkT / 45, 0, 1);
      const tw = ctx.measureText(g.guideLine).width;
      const bw = tw + 12, bh = 16;
      const bx = gd.x - bw / 2, by = gd.y - gd.h - 38;
      ctx.globalAlpha = alpha;
      roundRectPath(ctx, bx, by, bw, bh, 3);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#202020';
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(gd.x - 3, by + bh);
      ctx.lineTo(gd.x + 3, by + bh);
      ctx.lineTo(gd.x, by + bh + 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#202020';
      ctx.fillText(g.guideLine, gd.x, by + 11);
      ctx.globalAlpha = 1;
    }
  }

  // ---- 玩家(原版精灵优先; 盔甲三槽按套装映射 ingame 贴图; 手持物品贴手部锚点常显) ----
  if (showPlayer) {
    const p = g.player;
    const blink = p.iframes > 0 && (g.frame % 6) < 3;
    if (!blink) {
      let swing: { angle: number; icon: HTMLCanvasElement | null; anchor: [number, number] } | null = null;
      if (p.swing) {
        const t = p.swing.t / p.swing.dur;
        const ease = 1 - Math.pow(1 - t, 2);
        swing = {
          angle: -2.05 + ease * 2.9,
          icon: tex.icons[p.swing.itemId] ?? null,
          anchor: tex.anchors[p.swing.itemId] ?? [8, 8],
        };
      }
      let drew = false;
      if (useAssets) {
        drew = drawImgPlayer(
          ctx, p.x + IMG_OFF.player[0], p.y + IMG_OFF.player[1],
          playerImgFrame(p), p.dir, p.walkT, p.onGround, p.vy,
          p.swing ? p.swing.t / p.swing.dur : 0,
          armorImgsOf(p.armor), false,
        );
      }
      if (!drew) {
        drawHumanoid(ctx, PLAYER_PALETTE, {
          x: p.x, y: p.y, dir: p.dir, walkT: p.walkT, onGround: p.onGround, vy: p.vy,
          swing, flash: false, armor: armorColorsOf(p.armor),
        });
      }
      // 15-a: 手持物品常显 + 参考站手部锚点 + 原生物品尺寸(旧版固定 11.2px 相对 40x60 玩家过小)。
      // 锚点 = 精灵左上 + (朝右 0.7 / 朝左 0.3)×宽, 顶部 + 0.4×高;
      // 挥击时旋转 rot = dir × (-0.36 + 0.96·t)(线性); 尺寸 = 物品原生最大边(锦 8..36)。
      if (drew) {
        const held = p.inv[p.hotbar];
        const icon = held ? tex.icons[held.id] : null;
        if (icon) {
          const spriteL = p.x + IMG_OFF.player[0];
          const spriteT = p.y + IMG_OFF.player[1];
          const px = spriteL + (p.dir === 1 ? 0.7 : 0.3) * LAYOUT.player.drawW;
          const py = spriteT + 0.4 * LAYOUT.player.drawH;
          const t = p.swing ? p.swing.t / p.swing.dur : 0;
          const rot = p.swing ? p.dir * (-0.36 + 0.96 * t) : 0;
          const s = itemDrawSize(held!.id);
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(rot);
          ctx.drawImage(icon, -s / 2, -s / 2, s, s);
          ctx.restore();
        }
      }
    }
  }

  // ---- 联机远端玩家(15-b): 同款精灵/盔甲/手持物 + 名牌 + 头顶血条 ----
  if (net.online && net.remotes.size > 0) {
    for (const r of net.remotes.values()) {
      // 屏外裁剪(±80px)
      if (r.x < g.camX - 80 || r.x > g.camX + g.viewW() + 80 || r.y < g.camY - 120 || r.y > g.camY + g.viewH() + 120) continue;
      const armor = armorImgsOf({
        head: r.armorH ? { id: r.armorH, count: 1 } : null,
        body: r.armorB ? { id: r.armorB, count: 1 } : null,
        legs: r.armorL ? { id: r.armorL, count: 1 } : null,
      });
      const drew = drawImgPlayer(
        ctx, r.x + IMG_OFF.player[0], r.y + IMG_OFF.player[1],
        r.frame, r.dir, r.walkT, r.onGround, 0, r.swingT, armor, false,
      );
      if (drew) {
        // 手持物(与本地玩家同公式)
        const icon = r.held ? tex.icons[r.held] : null;
        if (icon) {
          const px = r.x + IMG_OFF.player[0] + (r.dir === 1 ? 0.7 : 0.3) * LAYOUT.player.drawW;
          const py = r.y + IMG_OFF.player[1] + 0.4 * LAYOUT.player.drawH;
          const rot = r.swingT > 0 ? r.dir * (-0.36 + 0.96 * r.swingT) : 0;
          const s = itemDrawSize(r.held);
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(rot);
          ctx.drawImage(icon, -s / 2, -s / 2, s, s);
          ctx.restore();
        }
      }
      // 名牌 + 血条(受伤时显示)
      ctx.font = '7px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const nw = ctx.measureText(r.name).width + 6;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(r.x - nw / 2, r.y - 74, nw, 10);
      ctx.fillStyle = '#8ad8ff';
      ctx.fillText(r.name, r.x, r.y - 66);
      if (r.hp < r.maxHp) {
        const bw = 30;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(r.x - bw / 2 - 1, r.y - 63, bw + 2, 4);
        ctx.fillStyle = '#e04848';
        ctx.fillRect(r.x - bw / 2, r.y - 62, bw * clamp(r.hp / r.maxHp, 0, 1), 2);
      }
    }
  }

  // ---- 粒子 ----
  for (const pt of g.parts) {
    ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - 1, pt.y - 1, pt.size, pt.size);
  }
  ctx.globalAlpha = 1;

  // ---- 投射物(粒子层后): 箭(含插墙) / 炸弹 + 引信火花(原版 PNG 优先) ----
  for (const pr of g.projs) {
    if (pr.kind === 'arrow') {
      const im = useAssets ? A.img('Wooden_Arrow') : null;
      if (im) {
        // 原版箭矢(14x32 图): 旋转后画 10x20 居中
        ctx.save();
        ctx.translate(pr.x, pr.y);
        ctx.rotate(pr.rot + Math.PI / 2);
        ctx.drawImage(im, -5, -10, 10, 20);
        ctx.restore();
      } else {
        drawArrow(ctx, pr.x, pr.y, pr.rot);
      }
    } else {
      const im = useAssets ? A.img('Bomb') : null;
      if (im) ctx.drawImage(im, pr.x - 8, pr.y - 8, 16, 16);   // 原版炸弹(22x30 图)居中画 16x16
      else drawBomb(ctx, pr.x, pr.y, pr.t);
      // 引信火花: 每 6 帧一颗橙色 1px 上飘(纯渲染效果, 不改游戏状态)
      const sf = (g.frame % 6) / 6;
      ctx.globalAlpha = 1 - sf;
      ctx.fillStyle = '#ffb040';
      ctx.fillRect(Math.round(pr.x) + 2, Math.round(pr.y) - 9 - Math.round(sf * 3), 1, 1);
      ctx.globalAlpha = 1;
    }
  }

  // ---- 环境生物: 蝴蝶(受光照罩影响, 白天活动) ----
  for (const b of g.ambient) {
    if (b.kind !== 0) continue;
    const flap = Math.abs(Math.sin(b.phase));          // 扇翅张合 0~1
    const ww = Math.round(1 + flap * 2);               // 翅膀横向展开 1~3px
    const bx = Math.round(b.x), by = Math.round(b.y);
    ctx.fillStyle = '#3a2a20';                         // 身体
    ctx.fillRect(bx - 1, by - 2, 2, 4);
    ctx.fillStyle = '#e8a33c';                         // 双翅(橙)
    ctx.fillRect(bx - 1 - ww, by - 3, ww, 3);
    ctx.fillRect(bx + 1, by - 3, ww, 3);
    ctx.fillStyle = '#f5d78a';                         // 翅尖高光
    ctx.fillRect(bx - 1 - ww, by - 3, 1, 1);
    ctx.fillRect(bx + ww, by - 3, 1, 1);
  }

  // ---- 光照罩(平滑放大) ----
  // 14-a: 玩家自带环境光(0.62) —— 黑暗洞穴里人物与身边数格始终清晰可见,
  // 彻底解决"人物消失"; 手持火把时仍用更强的 0.95(更大照明范围)。
  const extra: ExtraLight[] = [];
  if (showPlayer) {
    const held = g.player.inv[g.player.hotbar];
    extra.push({
      x: Math.floor(g.player.x / 16),
      y: Math.floor((g.player.y - g.player.h / 2) / 16),
      v: held && held.id === IT.TORCH ? 0.95 : 0.62,
    });
  }
  const region = g.computeLightFor(extra);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    g.lightCanvas, region.x0 * 16, region.y0 * 16,
    region.w * 16, region.h * 16,
  );
  ctx.imageSmoothingEnabled = false;

  // ---- 暖光晕(additive): 手持火把单独绘制(不与场景光晕争上限) ----
  if (showPlayer) {
    const held = g.player.inv[g.player.hotbar];
    if (held && held.id === IT.TORCH) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.38;
      const gx = g.player.x, gy = g.player.y - g.player.h / 2;
      ctx.drawImage(tex.glowWarm, gx - 85, gy - 85, 170, 170);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }
  if (glows.length) {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.38;
    for (const gl of glows.slice(0, 32)) {
      ctx.drawImage(gl.c, gl.x - gl.s / 2, gl.y - gl.s / 2, gl.s, gl.s);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // ---- 环境生物: 萤火虫(自发光, 不受光照罩影响, 夜晚活动) ----
  for (const b of g.ambient) {
    if (b.kind !== 1) continue;
    const a = 0.35 + 0.65 * Math.max(0, Math.sin(b.phase));
    const bx = Math.round(b.x), by = Math.round(b.y);
    ctx.globalAlpha = a * 0.35;
    ctx.fillStyle = '#d8e888';                         // 外团微光(像素块晕)
    ctx.fillRect(bx - 2, by - 2, 5, 5);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#f4f8b8';                         // 亮核
    ctx.fillRect(bx - 1, by - 1, 2, 2);
  }
  ctx.globalAlpha = 1;

  // ---- 伤害数字 ----
  ctx.textAlign = 'center';
  for (const d of g.dmgs) {
    ctx.font = d.crit ? 'bold 9px ui-monospace, monospace' : 'bold 7px ui-monospace, monospace';
    ctx.globalAlpha = clamp(d.life / 20, 0, 1);
    ctx.fillStyle = '#000000';
    ctx.fillText(d.text, d.x + 0.8, d.y + 0.8);
    ctx.fillStyle = d.color;
    ctx.fillText(d.text, d.x, d.y);
  }
  ctx.globalAlpha = 1;

  // ---- 敌怪血条(Boss 有专属血条, 不画通用条) ----
  for (const e of g.enemies) {
    if (e.hpShow <= 0) continue;
    if (ENEMY_DEFS[e.kind]?.boss) continue;
    const bw = Math.max(16, e.w);
    const bx = e.x - bw / 2, by = e.y - e.h - 7;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, by, bw, 3);
    ctx.fillStyle = '#d03838';
    ctx.fillRect(bx + 0.5, by + 0.5, (bw - 1) * clamp(e.hp / e.maxHp, 0, 1), 2);
  }

  // ---- 鼠标格子高亮(智能光标开启时改用青色目标格; 地图打开时不画) ----
  if (playing && !g.paused && !g.invOpen && !g.mapOpen) {
    if (g.smart) {
      const st = g.smartTarget;
      if (st) {
        ctx.strokeStyle = 'rgba(80,220,220,0.9)';
        ctx.lineWidth = 1;
        ctx.strokeRect(st.gx * 16 + 0.5, st.gy * 16 + 0.5, 15, 15);
        ctx.fillStyle = 'rgba(80,220,220,0.10)';
        ctx.fillRect(st.gx * 16, st.gy * 16, 16, 16);
      }
    } else {
      const mw = g.getMouseWorld();
      const gx = Math.floor(mw.x / 16), gy = Math.floor(mw.y / 16);
      const pcx = g.player.x, pcy = g.player.y - g.player.h / 2;
      const inReach = Math.hypot((gx * 16 + 8) - pcx, (gy * 16 + 8) - pcy) <= 6.5 * 16;
      ctx.strokeStyle = inReach ? 'rgba(247,208,96,0.9)' : 'rgba(200,80,60,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(gx * 16 + 0.5, gy * 16 + 0.5, 15, 15);
      if (inReach) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(gx * 16, gy * 16, 16, 16);
      }
    }
  }

  ctx.restore();

  // ==================== 屏幕空间特效 ====================
  ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);

  // 水下蓝罩
  if (showPlayer && g.player.headWater) {
    ctx.fillStyle = 'rgba(30,80,180,0.25)';
    ctx.fillRect(0, 0, W, H);
  }

  // 受伤红闪
  if (g.redFlash > 0) {
    ctx.fillStyle = `rgba(255,40,40,${(g.redFlash * 0.26).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  }

  // 低血量红晕
  if (showPlayer && g.player.hp <= 30) {
    const a = ((30 - g.player.hp) / 30) * 0.4 * (0.75 + 0.25 * Math.sin(g.frame * 0.09));
    const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
    grad.addColorStop(0, 'rgba(140,10,10,0)');
    grad.addColorStop(1, `rgba(140,10,10,${a.toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // ---- 小地图(仅游戏中, 全屏地图打开时被整体覆盖, 跳过省事;
  //      14-a: 窄屏背包打开时也跳过 —— 背包面板会向上伸到右上角与小地图重叠) ----
  if (g.screen !== 'title' && !g.mapOpen && !(g.invOpen && W < 768)) {
    drawMinimap(g, ctx, W);
  }

  // ---- 全屏地图叠加层(管线最后) ----
  if (g.mapOpen) {
    drawWorldMap(g, ctx, W, H);
  }
}

function drawMinimap(g: GameEngine, ctx: CanvasRenderingContext2D, W: number): void {
  if (!g.mmCanvas) return;
  // 13-c/14-a: 窄屏(<768px)小地图 168x110, 且下移到 y=50 —— 手机上快捷栏占满整行宽,
  // 顶部再放小地图会盖住快捷栏第 7-10 格(实测重叠); 桌面维持 256x168 @ y=12
  const small = W < 768;
  const mw = small ? 168 : 256, mh = small ? 110 : 168;
  const mx = W - mw - 14, my = small ? 50 : 12;
  ctx.fillStyle = 'rgba(8,10,20,0.55)';
  ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6);
  ctx.strokeStyle = 'rgba(120,140,220,0.8)';
  ctx.lineWidth = 2;
  ctx.strokeRect(mx - 3, my - 3, mw + 6, mh + 6);

  const pgx = clamp(Math.floor(g.player.x / 16), 0, g.world.w - 1);
  const pgy = clamp(Math.floor(g.player.y / 16), 0, g.world.h - 1);
  const sw = 128, sh = 84;
  const sx = clamp(pgx - sw / 2, 0, Math.max(0, g.world.w - sw));
  const sy = clamp(pgy - sh / 2, 0, Math.max(0, g.world.h - sh));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(g.mmCanvas, sx, sy, sw, sh, mx, my, mw, mh);

  // 玩家白点(闪烁)
  if ((g.frame % 30) < 20) {
    ctx.fillStyle = '#ffffff';
    const cx2 = mx + (pgx - sx) * (mw / sw);
    const cy2 = my + (pgy - sy) * (mh / sh);
    ctx.fillRect(cx2 - 2, cy2 - 2, 4, 4);
  }
  // 敌怪红点
  for (const e of g.enemies) {
    const ex = Math.floor(e.x / 16), ey = Math.floor(e.y / 16);
    if (ex < sx || ex >= sx + sw || ey < sy || ey >= sy + sh) continue;
    ctx.fillStyle = '#e05050';
    ctx.fillRect(mx + (ex - sx) * (mw / sw) - 1, my + (ey - sy) * (mh / sh) - 1, 2, 2);
  }
  // 出生点标记
  const spx = Math.floor(g.world.spawnX / 16), spy = Math.floor(g.world.spawnY / 16);
  if (spx >= sx && spx < sx + sw && spy >= sy && spy < sy + sh) {
    ctx.fillStyle = '#6ee06e';
    ctx.fillRect(mx + (spx - sx) * (mw / sw) - 1, my + (spy - sy) * (mh / sh) - 1, 3, 3);
  }
}

// ==================== 全屏地图 + 探索迷雾缓存 ====================

/** 探索迷雾离屏画布(1px=1格): 未探索=不透明黑, 已探索=透明(局部增量维护) */
const FOG_R = 42;                     // 与引擎探索半径一致
let fogCanvas: HTMLCanvasElement | null = null;
let fogWorld: World | null = null;    // 世界身份(变更时全量重建)
let fogGX = -1 << 20;                 // 上次局部重画的玩家格坐标
let fogGY = -1 << 20;
let fogTick = 0;                      // 距上次局部重画的帧数

function rebuildFog(wld: World, explored: Uint8Array): void {
  const c = fogCanvas ?? document.createElement('canvas');
  c.width = wld.w; c.height = wld.h;
  const cx = c.getContext('2d')!;
  const img = cx.createImageData(wld.w, wld.h);
  const d = img.data;
  for (let i = 0, n = wld.w * wld.h; i < n; i++) {
    const p = i * 4;
    d[p] = 5; d[p + 1] = 4; d[p + 2] = 10;
    d[p + 3] = explored[i] ? 0 : 255;
  }
  cx.putImageData(img, 0, 0);
  fogCanvas = c;
  fogWorld = wld;
}

/** 局部重画: 圆心 (ccx,ccy) 半径 r 圆内已探索格 clearRect(逐行连续段, 精确按 explored) */
function clearFogCircle(
  c: HTMLCanvasElement, explored: Uint8Array, w: number, h: number,
  ccx: number, ccy: number, r: number,
): void {
  const fx = c.getContext('2d')!;
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    const y = ccy + dy;
    if (y < 0 || y >= h) continue;
    const span = Math.floor(Math.sqrt(r2 - dy * dy));
    const x0 = Math.max(0, ccx - span), x1 = Math.min(w - 1, ccx + span);
    const base = y * w;
    let run = -1;
    for (let x = x0; x <= x1 + 1; x++) {
      const on = x <= x1 && explored[base + x] === 1;
      if (on && run < 0) run = x;
      else if (!on && run >= 0) { fx.clearRect(run, y, x - run, 1); run = -1; }
    }
  }
}

/** 每帧调用: 世界变更时全量重建一次; 玩家跨 8 格或每 90 帧局部重画玩家探索圆 */
function updateFog(g: GameEngine): void {
  const wld = g.world;
  const explored = g.explored;
  if (!wld || !explored || !g.player) return;
  const pgx = clamp(Math.floor(g.player.x / 16), 0, wld.w - 1);
  const pgy = clamp(Math.floor(g.player.y / 16), 0, wld.h - 1);
  if (!fogCanvas || fogWorld !== wld || fogCanvas.width !== wld.w || fogCanvas.height !== wld.h) {
    rebuildFog(wld, explored);
    fogGX = pgx; fogGY = pgy; fogTick = 0;
    return;
  }
  fogTick++;
  if (Math.abs(pgx - fogGX) >= 8 || Math.abs(pgy - fogGY) >= 8 || fogTick >= 90) {
    clearFogCircle(fogCanvas, explored, wld.w, wld.h, pgx, pgy, FOG_R);
    fogGX = pgx; fogGY = pgy; fogTick = 0;
  }
}

/** 全屏地图叠加层(g.mapOpen 时, 管线最后绘制) */
function drawWorldMap(g: GameEngine, ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const wld = g.world;
  ctx.fillStyle = 'rgba(10,12,24,0.92)';
  ctx.fillRect(0, 0, W, H);
  const map = g.mapCanvas;
  if (!map) return;

  // 中央等比缩放绘制(留边 60px, 关闭平滑保持像素感)
  const availW = Math.max(160, W - 120), availH = Math.max(120, H - 120);
  const scale = Math.min(availW / map.width, availH / map.height);
  const mw = map.width * scale, mh = map.height * scale;
  const mx = Math.round((W - mw) / 2), my = Math.round((H - mh) / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(map, mx, my, mw, mh);

  // 探索迷雾: 未探索处黑色(叠 0.88)
  if (fogCanvas) {
    ctx.globalAlpha = 0.88;
    ctx.drawImage(fogCanvas, mx, my, mw, mh);
    ctx.globalAlpha = 1;
  }

  const toX = (wx: number): number => mx + (wx + 0.5) * scale;
  const toY = (wy: number): number => my + (wy + 0.5) * scale;

  // 出生点绿点
  ctx.fillStyle = '#6ee06e';
  ctx.fillRect(Math.round(toX(wld.spawnX / 16) - 1.5), Math.round(toY(wld.spawnY / 16) - 1.5), 3, 3);

  // Boss 红点(大)
  if (g.boss && !g.boss.dead) {
    ctx.fillStyle = '#e04040';
    ctx.fillRect(Math.round(toX(g.boss.x / 16) - 1.5), Math.round(toY(g.boss.y / 16) - 1.5), 3, 3);
  }

  // 玩家白点(闪烁)
  if ((g.frame % 30) < 20) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(toX(g.player.x / 16) - 1), Math.round(toY(g.player.y / 16) - 1), 2, 2);
  }

  // 顶部标题
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillText('世界地图 (Tab 关闭)', W / 2 + 1, 34);
  ctx.fillStyle = '#e8e8f4';
  ctx.fillText('世界地图 (Tab 关闭)', W / 2, 33);

  // 右下角: 当前坐标 + 群系名
  const pgx = Math.floor(g.player.x / 16), pgy = Math.floor(g.player.y / 16);
  const biome = BIOME_NAMES[wld.biomeAt(clamp(pgx, 0, wld.w - 1))] ?? '森林';
  ctx.font = '12px ui-monospace, monospace';
  ctx.textAlign = 'right';
  const info = `坐标 ${pgx}, ${pgy}  |  ${biome}`;
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillText(info, W - 63, H - 39);
  ctx.fillStyle = '#cfd6ea';
  ctx.fillText(info, W - 64, H - 40);
}
