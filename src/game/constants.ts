/**
 * 泰拉瑞亚 Web 复刻 — 全局常量定义
 * 方块 / 物品 / 配方 / 世界配置
 */

// ==================== 基础配置 ====================
export const TILE = 16;                 // 每格像素
export const WORLD_W = 1100;            // 世界宽(格)
export const WORLD_H = 340;             // 世界高(格)
export const DAY_LENGTH = 300;          // 白天秒数
export const NIGHT_LENGTH = 180;        // 黑夜秒数
export const CYCLE = DAY_LENGTH + NIGHT_LENGTH;
export const DAY_END = DAY_LENGTH / CYCLE; // dayT 白天结束点 0.625
export const REACH = 6.5 * TILE;        // 玩家操作半径
export const MAX_HP = 100;
export const SAVE_KEY = 'tw-save-v1';

// ==================== 方块 ID ====================
export const T = {
  AIR: 0,
  DIRT: 1,
  GRASS: 2,
  STONE: 3,
  CLAY: 4,
  ORE_COPPER: 5,
  ORE_IRON: 6,
  ORE_SILVER: 7,
  ORE_GOLD: 8,
  WOOD: 9,       // 放置的木块
  TRUNK: 10,     // 树干(不阻挡移动)
  LEAF: 11,      // 树叶
  TGRASS: 12,    // 草丛装饰
  FLW_R: 13,     // 红花
  FLW_Y: 14,     // 黄花
  FLW_B: 15,     // 蓝花
  TORCH: 16,
  PLATFORM: 17,  // 木平台(单向)
  WORKBENCH_L: 18,
  WORKBENCH_R: 19,
  FURNACE_TL: 20,
  FURNACE_TR: 21,
  FURNACE_BL: 22,
  FURNACE_BR: 23,
  ANVIL_L: 24,
  ANVIL_R: 25,
  WATER: 26,
} as const;

export type StationKind = 'workbench' | 'furnace' | 'anvil';

export interface TileDef {
  name: string;
  solid: boolean;                 // 是否阻挡移动
  platform: boolean;              // 单向平台
  hardness: number;               // 挖掘耐久(0=一击碎)
  tool: 'pick' | 'axe' | 'any';   // 有效工具
  drop: number | null;            // 掉落物品 id
  decay: number;                  // 每格光衰减
  station?: StationKind;
  light?: number;                 // 自发光强度(0-1)
  furnitureGroup?: string;        // 同组多格家具
  mapColor: string;               // 小地图颜色
  particleColor: string;          // 破碎粒子色
}

const tile = (o: Partial<TileDef> & { name: string }): TileDef => ({
  solid: true, platform: false, hardness: 50, tool: 'pick',
  drop: null, decay: 0.28, mapColor: '#888888', particleColor: '#888888', ...o,
});

export const TILE_COUNT = 27;
export const TileDefs: Record<number, TileDef> = {
  [T.AIR]: tile({ name: '空气', solid: false, hardness: 0, decay: 0.088, mapColor: '#000000', particleColor: '#ffffff' }),
  [T.DIRT]: tile({ name: '泥土', hardness: 30, drop: 1, mapColor: '#976b49', particleColor: '#976b49' }),
  [T.GRASS]: tile({ name: '草', hardness: 30, drop: 1, mapColor: '#4ea44e', particleColor: '#5cb85c' }),
  [T.STONE]: tile({ name: '石头', hardness: 100, drop: 2, mapColor: '#7d7d85', particleColor: '#7d7d85' }),
  [T.CLAY]: tile({ name: '黏土', hardness: 40, drop: 3, mapColor: '#b0664a', particleColor: '#b0664a' }),
  [T.ORE_COPPER]: tile({ name: '铜矿', hardness: 110, drop: 5, mapColor: '#c87f42', particleColor: '#c87f42' }),
  [T.ORE_IRON]: tile({ name: '铁矿', hardness: 125, drop: 6, mapColor: '#a89484', particleColor: '#a89484' }),
  [T.ORE_SILVER]: tile({ name: '银矿', hardness: 140, drop: 7, mapColor: '#d8dde2', particleColor: '#d8dde2' }),
  [T.ORE_GOLD]: tile({ name: '金矿', hardness: 155, drop: 8, mapColor: '#e5c443', particleColor: '#e5c443' }),
  [T.WOOD]: tile({ name: '木块', hardness: 60, drop: 4, mapColor: '#a97d4b', particleColor: '#a97d4b' }),
  [T.TRUNK]: tile({ name: '树干', solid: false, hardness: 150, tool: 'axe', decay: 0.11, mapColor: '#8a5a2b', particleColor: '#9a6b39' }),
  [T.LEAF]: tile({ name: '树叶', solid: false, hardness: 0, tool: 'any', decay: 0.14, mapColor: '#4e9b41', particleColor: '#5cb85c' }),
  [T.TGRASS]: tile({ name: '草丛', solid: false, hardness: 0, tool: 'any', decay: 0.09, mapColor: '#5cb85c', particleColor: '#6cc25a' }),
  [T.FLW_R]: tile({ name: '红花', solid: false, hardness: 0, tool: 'any', decay: 0.09, mapColor: '#e05555', particleColor: '#e05555' }),
  [T.FLW_Y]: tile({ name: '黄花', solid: false, hardness: 0, tool: 'any', decay: 0.09, mapColor: '#e0c94a', particleColor: '#e0c94a' }),
  [T.FLW_B]: tile({ name: '蓝花', solid: false, hardness: 0, tool: 'any', decay: 0.09, mapColor: '#5a7ae0', particleColor: '#5a7ae0' }),
  [T.TORCH]: tile({ name: '火把', solid: false, hardness: 0, tool: 'any', decay: 0.09, drop: 10, light: 1.0, mapColor: '#ffd75e', particleColor: '#ffd75e' }),
  [T.PLATFORM]: tile({ name: '木平台', solid: false, platform: true, hardness: 15, decay: 0.1, drop: 11, mapColor: '#a97d4b', particleColor: '#a97d4b' }),
  [T.WORKBENCH_L]: tile({ name: '工作台', solid: false, hardness: 40, tool: 'any', decay: 0.1, drop: 12, station: 'workbench', furnitureGroup: 'workbench', mapColor: '#a97d4b', particleColor: '#a97d4b' }),
  [T.WORKBENCH_R]: tile({ name: '工作台', solid: false, hardness: 40, tool: 'any', decay: 0.1, drop: 12, station: 'workbench', furnitureGroup: 'workbench', mapColor: '#a97d4b', particleColor: '#a97d4b' }),
  [T.FURNACE_TL]: tile({ name: '熔炉', solid: false, hardness: 50, tool: 'any', decay: 0.1, drop: 13, station: 'furnace', light: 0.85, furnitureGroup: 'furnace', mapColor: '#77777d', particleColor: '#77777d' }),
  [T.FURNACE_TR]: tile({ name: '熔炉', solid: false, hardness: 50, tool: 'any', decay: 0.1, drop: 13, station: 'furnace', light: 0.85, furnitureGroup: 'furnace', mapColor: '#77777d', particleColor: '#77777d' }),
  [T.FURNACE_BL]: tile({ name: '熔炉', solid: false, hardness: 50, tool: 'any', decay: 0.1, drop: 13, station: 'furnace', light: 0.85, furnitureGroup: 'furnace', mapColor: '#77777d', particleColor: '#77777d' }),
  [T.FURNACE_BR]: tile({ name: '熔炉', solid: false, hardness: 50, tool: 'any', decay: 0.1, drop: 13, station: 'furnace', light: 0.85, furnitureGroup: 'furnace', mapColor: '#77777d', particleColor: '#77777d' }),
  [T.ANVIL_L]: tile({ name: '铁砧', solid: false, hardness: 50, tool: 'any', decay: 0.1, drop: 14, station: 'anvil', furnitureGroup: 'anvil', mapColor: '#5a5a62', particleColor: '#5a5a62' }),
  [T.ANVIL_R]: tile({ name: '铁砧', solid: false, hardness: 50, tool: 'any', decay: 0.1, drop: 14, station: 'anvil', furnitureGroup: 'anvil', mapColor: '#5a5a62', particleColor: '#5a5a62' }),
  [T.WATER]: tile({ name: '水', solid: false, hardness: 0, tool: 'pick', decay: 0.17, mapColor: '#3a60c8', particleColor: '#5a8ae0' }),
};

// 背景墙 ID
export const W_NONE = 0;
export const W_DIRT = 1;
export const W_STONE = 2;

// ==================== 物品 ID ====================
export const IT = {
  DIRT: 1,
  STONE: 2,
  CLAY: 3,
  WOOD: 4,
  ORE_COPPER: 5,
  ORE_IRON: 6,
  ORE_SILVER: 7,
  ORE_GOLD: 8,
  GEL: 9,
  TORCH: 10,
  PLATFORM: 11,
  WORKBENCH: 12,
  FURNACE: 13,
  ANVIL: 14,
  BAR_IRON: 15,
  BAR_SILVER: 16,
  BAR_GOLD: 17,
  COPPER_PICK: 18,
  COPPER_AXE: 19,
  COPPER_SWORD: 20,
  WOOD_SWORD: 21,
  IRON_PICK: 22,
  IRON_SWORD: 23,
  SILVER_PICK: 24,
  SILVER_SWORD: 25,
  GOLD_PICK: 26,
  GOLD_SWORD: 27,
} as const;

export type ItemKind = 'block' | 'material' | 'tool' | 'weapon' | 'station';

export interface ItemDef {
  name: string;
  kind: ItemKind;
  maxStack: number;
  tile?: number;                        // 放置成的方块(主格)
  tool?: 'pick' | 'axe';                // 工具类型
  power?: number;                       // 挖掘力
  dmg?: number;                         // 攻击伤害
  useTime?: number;                     // 使用间隔(帧@60fps)
  swing?: 'arc' | 'stab';               // 挥舞方式
  desc: string;
}

const item = (o: Partial<ItemDef> & { name: string; kind: ItemKind }): ItemDef => ({
  maxStack: 999, desc: '', ...o,
});

export const ItemDefs: Record<number, ItemDef> = {
  [IT.DIRT]: item({ name: '泥土块', kind: 'block', tile: T.DIRT, desc: '最普通不过的泥土。' }),
  [IT.STONE]: item({ name: '石块', kind: 'block', tile: T.STONE, desc: '坚固的石头。' }),
  [IT.CLAY]: item({ name: '黏土块', kind: 'block', tile: T.CLAY, desc: '红色的黏土。' }),
  [IT.WOOD]: item({ name: '木材', kind: 'block', tile: T.WOOD, desc: '用途广泛的基础材料。' }),
  [IT.ORE_COPPER]: item({ name: '铜矿石', kind: 'material', desc: '闪烁着橙色光泽的矿石。' }),
  [IT.ORE_IRON]: item({ name: '铁矿石', kind: 'material', desc: '灰褐色的铁矿。' }),
  [IT.ORE_SILVER]: item({ name: '银矿石', kind: 'material', desc: '银光闪闪的矿石。' }),
  [IT.ORE_GOLD]: item({ name: '金矿石', kind: 'material', desc: '人人都爱黄金。' }),
  [IT.GEL]: item({ name: '凝胶', kind: 'material', desc: '史莱姆掉落的黏性凝胶，可以制作火把。' }),
  [IT.TORCH]: item({ name: '火把', kind: 'block', tile: T.TORCH, desc: '照亮黑暗。手持时也能发光。' }),
  [IT.PLATFORM]: item({ name: '木平台', kind: 'block', tile: T.PLATFORM, desc: '可以从下方跳上来的平台，按 S 落下。' }),
  [IT.WORKBENCH]: item({ name: '工作台', kind: 'station', tile: T.WORKBENCH_L, maxStack: 99, desc: '解锁更多合成配方。' }),
  [IT.FURNACE]: item({ name: '熔炉', kind: 'station', tile: T.FURNACE_TL, maxStack: 99, desc: '将矿石熔炼成金属锭。' }),
  [IT.ANVIL]: item({ name: '铁砧', kind: 'station', tile: T.ANVIL_L, maxStack: 99, desc: '锻造金属工具与武器。' }),
  [IT.BAR_IRON]: item({ name: '铁锭', kind: 'material', desc: '熔炼过的铁。' }),
  [IT.BAR_SILVER]: item({ name: '银锭', kind: 'material', desc: '熔炼过的银。' }),
  [IT.BAR_GOLD]: item({ name: '金锭', kind: 'material', desc: '熔炼过的金子。' }),
  [IT.COPPER_PICK]: item({ name: '铜镐', kind: 'tool', tool: 'pick', maxStack: 1, power: 35, dmg: 5, useTime: 15, swing: 'arc', desc: '初始挖掘工具。' }),
  [IT.COPPER_AXE]: item({ name: '铜斧', kind: 'tool', tool: 'axe', maxStack: 1, power: 40, dmg: 5, useTime: 17, swing: 'arc', desc: '用来砍树。' }),
  [IT.COPPER_SWORD]: item({ name: '铜短剑', kind: 'weapon', maxStack: 1, dmg: 8, useTime: 16, swing: 'stab', desc: '快速突刺的短剑。' }),
  [IT.WOOD_SWORD]: item({ name: '木剑', kind: 'weapon', maxStack: 1, dmg: 8, useTime: 21, swing: 'arc', desc: '挥舞范围更大的木剑。' }),
  [IT.IRON_PICK]: item({ name: '铁镐', kind: 'tool', tool: 'pick', maxStack: 1, power: 55, dmg: 6, useTime: 13, swing: 'arc', desc: '挖掘更快的铁镐。' }),
  [IT.IRON_SWORD]: item({ name: '铁阔剑', kind: 'weapon', maxStack: 1, dmg: 12, useTime: 19, swing: 'arc', desc: '大范围挥砍。' }),
  [IT.SILVER_PICK]: item({ name: '银镐', kind: 'tool', tool: 'pick', maxStack: 1, power: 65, dmg: 7, useTime: 12, swing: 'arc', desc: '银光闪闪的好镐子。' }),
  [IT.SILVER_SWORD]: item({ name: '银阔剑', kind: 'weapon', maxStack: 1, dmg: 14, useTime: 18, swing: 'arc', desc: '锋利的银剑。' }),
  [IT.GOLD_PICK]: item({ name: '金镐', kind: 'tool', tool: 'pick', maxStack: 1, power: 75, dmg: 8, useTime: 11, swing: 'arc', desc: '顶级的挖掘效率。' }),
  [IT.GOLD_SWORD]: item({ name: '金阔剑', kind: 'weapon', maxStack: 1, dmg: 17, useTime: 17, swing: 'arc', desc: '闪闪发光的利刃。' }),
};

// ==================== 合成配方 ====================
export interface Recipe {
  out: number;
  count: number;
  ins: { id: number; n: number }[];
  station: StationKind | null;
}

export const RECIPES: Recipe[] = [
  { out: IT.TORCH, count: 3, ins: [{ id: IT.WOOD, n: 1 }, { id: IT.GEL, n: 1 }], station: null },
  { out: IT.PLATFORM, count: 2, ins: [{ id: IT.WOOD, n: 1 }], station: null },
  { out: IT.WORKBENCH, count: 1, ins: [{ id: IT.WOOD, n: 10 }], station: null },
  { out: IT.WOOD_SWORD, count: 1, ins: [{ id: IT.WOOD, n: 7 }], station: 'workbench' },
  { out: IT.FURNACE, count: 1, ins: [{ id: IT.STONE, n: 20 }, { id: IT.WOOD, n: 4 }, { id: IT.TORCH, n: 3 }], station: 'workbench' },
  { out: IT.ANVIL, count: 1, ins: [{ id: IT.BAR_IRON, n: 5 }], station: 'workbench' },
  { out: IT.BAR_IRON, count: 1, ins: [{ id: IT.ORE_IRON, n: 3 }], station: 'furnace' },
  { out: IT.BAR_SILVER, count: 1, ins: [{ id: IT.ORE_SILVER, n: 3 }], station: 'furnace' },
  { out: IT.BAR_GOLD, count: 1, ins: [{ id: IT.ORE_GOLD, n: 3 }], station: 'furnace' },
  { out: IT.IRON_PICK, count: 1, ins: [{ id: IT.BAR_IRON, n: 10 }, { id: IT.WOOD, n: 3 }], station: 'anvil' },
  { out: IT.IRON_SWORD, count: 1, ins: [{ id: IT.BAR_IRON, n: 8 }, { id: IT.WOOD, n: 3 }], station: 'anvil' },
  { out: IT.SILVER_PICK, count: 1, ins: [{ id: IT.BAR_SILVER, n: 12 }, { id: IT.WOOD, n: 3 }], station: 'anvil' },
  { out: IT.SILVER_SWORD, count: 1, ins: [{ id: IT.BAR_SILVER, n: 10 }, { id: IT.WOOD, n: 3 }], station: 'anvil' },
  { out: IT.GOLD_PICK, count: 1, ins: [{ id: IT.BAR_GOLD, n: 12 }, { id: IT.WOOD, n: 3 }], station: 'anvil' },
  { out: IT.GOLD_SWORD, count: 1, ins: [{ id: IT.BAR_GOLD, n: 10 }, { id: IT.WOOD, n: 3 }], station: 'anvil' },
];

// 多格家具放置形状(相对主格)
export const FURNITURE_SHAPE: Record<number, [number, number][]> = {
  [T.WORKBENCH_L]: [[0, 0], [1, 0]],
  [T.FURNACE_TL]: [[0, 0], [1, 0], [0, 1], [1, 1]],
  [T.ANVIL_L]: [[0, 0], [1, 0]],
};

// ==================== 玩家参数 ====================
export const PLAYER_CONF = {
  w: 12, h: 38,
  runSpeed: 3.1,
  accel: 0.35,
  airAccel: 0.22,
  fric: 0.55,
  airFric: 0.04,
  jumpVel: -7.5,
  gravity: 0.34,
  maxFall: 10.5,
  swimFall: 1.4,
  fallDamageTiles: 23,
  iframes: 45,
  respawnTime: 5,
  regenDelay: 480,   // 受伤后恢复间隔(帧)
  regenRate: 100,    // 每多少帧回 1 HP
  breathMax: 600,    // 水下呼吸帧数
};

// ==================== 敌怪参数 ====================
export interface EnemyConf {
  name: string;
  w: number; h: number;
  hp: number; dmg: number;
  kb: number;             // 击退抗性 0-1
  gelDrop?: [number, number];
  night: boolean;         // 仅夜间存在/生成
  fly: boolean;
  mapColor: string;
}

export const ENEMY_DEFS: Record<string, EnemyConf> = {
  gslime: { name: '绿史莱姆', w: 16, h: 12, hp: 16, dmg: 7, kb: 0.1, gelDrop: [0, 1], night: false, fly: false, mapColor: '#5cd05c' },
  bslime: { name: '蓝史莱姆', w: 22, h: 16, hp: 45, dmg: 12, kb: 0.25, gelDrop: [1, 2], night: false, fly: false, mapColor: '#5c8ee0' },
  zombie: { name: '僵尸', w: 14, h: 36, hp: 55, dmg: 15, kb: 0.15, night: true, fly: false, mapColor: '#7a9b6a' },
  eye: { name: '恶魔眼', w: 18, h: 14, hp: 38, dmg: 13, kb: 0.3, night: true, fly: true, mapColor: '#c05050' },
};
