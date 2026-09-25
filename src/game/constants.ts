/**
 * 泰拉瑞亚 Web 复刻 — 全局常量定义
 * 方块 / 物品 / 配方 / 敌怪 / 世界尺寸 / 群系 / 宝箱战利品
 *
 * 注意：旧 ID(方块 0-26 / 物品 1-27)保持不变以兼容既有引擎与存档；
 * 新内容一律追加在尾部。
 */

// ==================== 基础配置 ====================
export const TILE = 16;                 // 每格像素
export const DAY_LENGTH = 300;          // 白天秒数
export const NIGHT_LENGTH = 180;        // 黑夜秒数
export const CYCLE = DAY_LENGTH + NIGHT_LENGTH;
export const DAY_END = DAY_LENGTH / CYCLE; // dayT 白天结束点 0.625
export const REACH = 6.5 * TILE;        // 玩家操作半径
export const SAVE_KEY = 'tw-save-v2';  // v2 存档(带盔甲/宝箱/地图探索)
export const SAVE_KEY_V1 = 'tw-save-v1';
export const MAX_HP = 100;              // 初始生命
export const HP_CAP = 200;              // 生命水晶上限

// 世界尺寸预设(格)
export type WorldSize = 'small' | 'medium' | 'large';
export const WORLD_SIZES: Record<WorldSize, { w: number; h: number; label: string }> = {
  small: { w: 1100, h: 340, label: '小' },
  medium: { w: 1500, h: 400, label: '中' },
  large: { w: 1900, h: 460, label: '大' },
};
export const WORLD_W = WORLD_SIZES.small.w;   // 默认(兼容旧引用)
export const WORLD_H = WORLD_SIZES.small.h;

// 群系 ID(按列存储)
export const BIOME = {
  FOREST: 0,
  DESERT: 1,
  SNOW: 2,
  CORRUPTION: 3,
  JUNGLE: 4,
  MUSHROOM: 5,
} as const;
export const BIOME_NAMES: Record<number, string> = {
  0: '森林', 1: '沙漠', 2: '雪原', 3: '腐化之地', 4: '丛林', 5: '蘑菇地',
};

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
  // ---- 群系扩展 ----
  SAND: 27,          // 沙漠沙
  SNOW: 28,          // 雪块
  ICE: 29,           // 冰(滑!)
  MUD: 30,             // 丛林泥
  JUNGLE_GRASS: 31,  // 丛林草
  CORRUPT_STONE: 32, // 黑檀石(硬)
  CORRUPT_GRASS: 33, // 腐化草(紫)
  ASH: 34,           // 地狱灰烬
  HELLSTONE: 35,     // 狱岩(发光, 需梦魇镐)
  LAVA: 36,          // 岩浆(伤害+发光)
  OBSIDIAN: 37,      // 黑曜石(水+岩浆)
  MUSH_STEM: 38,     // 巨型蘑菇柄
  MUSH_CAP: 39,      // 巨型蘑菇伞盖(发光)
  CACTUS: 40,        // 仙人掌(实心)
  DOOR_C_T: 41,      // 关闭的门(上)
  DOOR_C_B: 42,      // 关闭的门(下) — 实心
  DOOR_O_T: 43,      // 打开的门(上)
  DOOR_O_B: 44,      // 打开的门(下) — 非实心
  CHEST_TL: 45,
  CHEST_TR: 46,
  CHEST_BL: 47,
  CHEST_BR: 48,
  ALTAR_TL: 49,      // 恶魔祭坛(不可破坏)
  ALTAR_TR: 50,
  ALTAR_BL: 51,
  ALTAR_BR: 52,
  TABLE_L: 53,
  TABLE_R: 54,
  CHAIR: 55,
  LIFE_CRYSTAL: 56,  // 生命水晶
  SAPLING: 57,       // 树苗(橡子种的)
  VINE: 58,          // 藤蔓(装饰)
  LEAF_SNOW: 59,     // 雪原树冠
  LEAF_JUNGLE: 60,   // 丛林树冠
  LEAF_CORRUPT: 61,  // 腐化树冠
} as const;

export type StationKind = 'workbench' | 'furnace' | 'anvil' | 'altar';

export interface TileDef {
  name: string;
  solid: boolean;                 // 是否阻挡移动
  platform: boolean;              // 单向平台
  hardness: number;               // 挖掘耐久(0=一击碎, -1=不可破坏)
  tool: 'pick' | 'axe' | 'any';   // 有效工具
  drop: number | null;            // 掉落物品 id
  decay: number;                  // 每格光衰减
  station?: StationKind;
  light?: number;                 // 自发光强度(0-1)
  furnitureGroup?: string;        // 同组多格家具
  mapColor: string;               // 小地图颜色
  particleColor: string;          // 破碎粒子色
  minPower?: number;              // 需要的最低镐力(默认 0)
}

const tile = (o: Partial<TileDef> & { name: string }): TileDef => ({
  solid: true, platform: false, hardness: 50, tool: 'pick',
  drop: null, decay: 0.28, mapColor: '#888888', particleColor: '#888888', ...o,
});

export const TILE_COUNT = 62;
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
  [T.WATER]: tile({ name: '水', solid: false, hardness: -1, tool: 'pick', decay: 0.17, mapColor: '#3a60c8', particleColor: '#5a8ae0' }),
  // ---- 群系扩展 ----
  [T.SAND]: tile({ name: '沙块', hardness: 25, drop: 28, decay: 0.26, mapColor: '#d8c078', particleColor: '#d8c078' }),
  [T.SNOW]: tile({ name: '雪块', hardness: 20, drop: 29, decay: 0.24, mapColor: '#e8f0f4', particleColor: '#e8f0f4' }),
  [T.ICE]: tile({ name: '冰块', hardness: 45, drop: 30, decay: 0.2, mapColor: '#a8d0e8', particleColor: '#b8e0f0' }),
  [T.MUD]: tile({ name: '泥块', hardness: 28, drop: 31, decay: 0.26, mapColor: '#6a5a48', particleColor: '#6a5a48' }),
  [T.JUNGLE_GRASS]: tile({ name: '丛林草', hardness: 30, drop: 31, decay: 0.28, mapColor: '#4e8f3a', particleColor: '#5ca848' }),
  [T.CORRUPT_STONE]: tile({ name: '黑檀石', hardness: 300, drop: 35, minPower: 55, decay: 0.3, mapColor: '#5a4a72', particleColor: '#6a5a82' }),
  [T.CORRUPT_GRASS]: tile({ name: '腐化草', hardness: 30, drop: 35, decay: 0.3, mapColor: '#7a5a9a', particleColor: '#8a6aaa' }),
  [T.ASH]: tile({ name: '灰烬块', hardness: 35, drop: 32, decay: 0.28, mapColor: '#4a4448', particleColor: '#4a4448' }),
  [T.HELLSTONE]: tile({ name: '狱岩', hardness: 999, drop: 33, minPower: 100, decay: 0.22, light: 0.4, mapColor: '#e85820', particleColor: '#f06830' }),
  [T.LAVA]: tile({ name: '岩浆', solid: false, hardness: -1, tool: 'pick', decay: 0.1, light: 0.85, mapColor: '#ff6a20', particleColor: '#ff8a40' }),
  [T.OBSIDIAN]: tile({ name: '黑曜石', hardness: 400, drop: 34, minPower: 65, decay: 0.24, mapColor: '#2a2438', particleColor: '#3a3450' }),
  [T.MUSH_STEM]: tile({ name: '蘑菇柄', solid: false, hardness: 30, tool: 'axe', decay: 0.1, mapColor: '#c8d8e8', particleColor: '#c8d8e8' }),
  [T.MUSH_CAP]: tile({ name: '蘑菇盖', solid: false, hardness: 20, tool: 'any', decay: 0.08, light: 0.7, mapColor: '#4aa0e8', particleColor: '#6ab8f0' }),
  [T.CACTUS]: tile({ name: '仙人掌', hardness: 40, tool: 'axe', drop: 36, decay: 0.1, mapColor: '#5a9a4a', particleColor: '#6aaa5a' }),
  [T.DOOR_C_T]: tile({ name: '木门', solid: false, hardness: 25, tool: 'any', drop: 67, decay: 0.09, furnitureGroup: 'doorc', mapColor: '#8a6a42', particleColor: '#8a6a42' }),
  [T.DOOR_C_B]: tile({ name: '木门', solid: true, hardness: 25, tool: 'any', drop: 67, decay: 0.09, furnitureGroup: 'doorc', mapColor: '#8a6a42', particleColor: '#8a6a42' }),
  [T.DOOR_O_T]: tile({ name: '木门(开)', solid: false, hardness: 25, tool: 'any', drop: 67, decay: 0.09, furnitureGroup: 'dooro', mapColor: '#8a6a42', particleColor: '#8a6a42' }),
  [T.DOOR_O_B]: tile({ name: '木门(开)', solid: false, hardness: 25, tool: 'any', drop: 67, decay: 0.09, furnitureGroup: 'dooro', mapColor: '#8a6a42', particleColor: '#8a6a42' }),
  [T.CHEST_TL]: tile({ name: '宝箱', solid: false, hardness: 45, tool: 'any', decay: 0.09, drop: 68, furnitureGroup: 'chest', mapColor: '#b08840', particleColor: '#b08840' }),
  [T.CHEST_TR]: tile({ name: '宝箱', solid: false, hardness: 45, tool: 'any', decay: 0.09, drop: 68, furnitureGroup: 'chest', mapColor: '#b08840', particleColor: '#b08840' }),
  [T.CHEST_BL]: tile({ name: '宝箱', solid: false, hardness: 45, tool: 'any', decay: 0.09, drop: 68, furnitureGroup: 'chest', mapColor: '#b08840', particleColor: '#b08840' }),
  [T.CHEST_BR]: tile({ name: '宝箱', solid: false, hardness: 45, tool: 'any', decay: 0.09, drop: 68, furnitureGroup: 'chest', mapColor: '#b08840', particleColor: '#b08840' }),
  [T.ALTAR_TL]: tile({ name: '恶魔祭坛', solid: false, hardness: -1, tool: 'any', decay: 0.06, light: 0.35, station: 'altar', furnitureGroup: 'altar', mapColor: '#6a3a5a', particleColor: '#7a4a6a' }),
  [T.ALTAR_TR]: tile({ name: '恶魔祭坛', solid: false, hardness: -1, tool: 'any', decay: 0.06, light: 0.35, station: 'altar', furnitureGroup: 'altar', mapColor: '#6a3a5a', particleColor: '#7a4a6a' }),
  [T.ALTAR_BL]: tile({ name: '恶魔祭坛', solid: false, hardness: -1, tool: 'any', decay: 0.06, light: 0.35, station: 'altar', furnitureGroup: 'altar', mapColor: '#6a3a5a', particleColor: '#7a4a6a' }),
  [T.ALTAR_BR]: tile({ name: '恶魔祭坛', solid: false, hardness: -1, tool: 'any', decay: 0.06, light: 0.35, station: 'altar', furnitureGroup: 'altar', mapColor: '#6a3a5a', particleColor: '#7a4a6a' }),
  [T.TABLE_L]: tile({ name: '木桌', solid: false, hardness: 30, tool: 'any', drop: 69, decay: 0.09, furnitureGroup: 'table', mapColor: '#a97d4b', particleColor: '#a97d4b' }),
  [T.TABLE_R]: tile({ name: '木桌', solid: false, hardness: 30, tool: 'any', drop: 69, decay: 0.09, furnitureGroup: 'table', mapColor: '#a97d4b', particleColor: '#a97d4b' }),
  [T.CHAIR]: tile({ name: '木椅', solid: false, hardness: 20, tool: 'any', drop: 70, decay: 0.09, mapColor: '#a97d4b', particleColor: '#a97d4b' }),
  [T.LIFE_CRYSTAL]: tile({ name: '生命水晶', solid: false, hardness: 60, tool: 'any', decay: 0.09, drop: 41, light: 0.5, mapColor: '#f070a0', particleColor: '#f090b0' }),
  [T.SAPLING]: tile({ name: '树苗', solid: false, hardness: 0, tool: 'any', decay: 0.09, mapColor: '#5cb85c', particleColor: '#6cc25a' }),
  [T.VINE]: tile({ name: '藤蔓', solid: false, hardness: 0, tool: 'any', decay: 0.12, mapColor: '#3a7a3a', particleColor: '#4a8a4a' }),
  [T.LEAF_SNOW]: tile({ name: '雪松叶', solid: false, hardness: 0, tool: 'any', decay: 0.14, mapColor: '#b8d8c8', particleColor: '#c8e8d8' }),
  [T.LEAF_JUNGLE]: tile({ name: '丛林叶', solid: false, hardness: 0, tool: 'any', decay: 0.14, mapColor: '#3aa04e', particleColor: '#4ab85e' }),
  [T.LEAF_CORRUPT]: tile({ name: '腐化叶', solid: false, hardness: 0, tool: 'any', decay: 0.14, mapColor: '#8a6aa8', particleColor: '#9a7ab8' }),
};

// 背景墙 ID
export const W_NONE = 0;
export const W_DIRT = 1;
export const W_STONE = 2;
export const W_SAND = 3;
export const W_SNOW = 4;
export const W_MUD = 5;
export const W_EBON = 6;

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
  // ---- 群系方块 ----
  SAND: 28,
  SNOW: 29,
  ICE: 30,
  MUD: 31,
  ASH: 32,
  HELLSTONE_ORE: 33,
  OBSIDIAN: 34,
  EBONSTONE: 35,
  CACTUS: 36,
  // ---- 武器/弹药/消耗 ----
  BOW: 37,
  ARROW: 38,
  BOMB: 39,
  LENS: 40,
  LIFE_CRYSTAL: 41,
  EYE_SUMMON: 42,
  // ---- 高阶金属 ----
  DEMONITE_ORE: 43,
  DEMONITE_BAR: 44,
  NIGHTMARE_PICK: 45,
  LIGHTS_BANE: 46,
  HELLSTONE_BAR: 47,
  MOLTEN_PICK: 48,
  VOLCANO: 49,
  COPPER_BAR: 50,
  // ---- 盔甲 (头/身/腿 × 铜/铁/银/金/暗影) ----
  COPPER_HELM: 51,
  COPPER_MAIL: 52,
  COPPER_LEGS: 53,
  IRON_HELM: 54,
  IRON_MAIL: 55,
  IRON_LEGS: 56,
  SILVER_HELM: 57,
  SILVER_MAIL: 58,
  SILVER_LEGS: 59,
  GOLD_HELM: 60,
  GOLD_MAIL: 61,
  GOLD_LEGS: 62,
  SHADOW_HELM: 63,
  SHADOW_MAIL: 64,
  SHADOW_LEGS: 65,
  // ---- 家具/杂项 ----
  ACORN: 66,
  WOODEN_DOOR: 67,
  CHEST: 68,
  TABLE: 69,
  CHAIR: 70,
} as const;

export type ItemKind = 'block' | 'material' | 'tool' | 'weapon' | 'station' | 'armor';
export type ArmorSlot = 'head' | 'body' | 'legs';

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
  armorSlot?: ArmorSlot;                // 盔甲部位
  defense?: number;                     // 防御值(盔甲)
  ranged?: 'arrow' | 'bomb';            // 远程类型
  desc: string;
}

const item = (o: Partial<ItemDef> & { name: string; kind: ItemKind }): ItemDef => ({
  maxStack: 999, desc: '', ...o,
});

/** 盔甲配色(渲染用): [头盔, 胸甲, 腿甲] 主色 */
export const ARMOR_COLORS: Record<number, [string, string, string]> = {
  [IT.COPPER_HELM]: ['#c87f42', '#b06a34', '#98582c'],
  [IT.IRON_HELM]: ['#a89484', '#8a7466', '#6e5a4e'],
  [IT.SILVER_HELM]: ['#d8dde2', '#b8c2cc', '#98a6b4'],
  [IT.GOLD_HELM]: ['#e5c443', '#d4ae2e', '#b8941f'],
  [IT.SHADOW_HELM]: ['#5a4a72', '#453a5e', '#332b48'],
};

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
  // ---- 群系方块 ----
  [IT.SAND]: item({ name: '沙块', kind: 'block', tile: T.SAND, desc: '会烫脚的细沙。' }),
  [IT.SNOW]: item({ name: '雪块', kind: 'block', tile: T.SNOW, desc: '冰凉的雪。' }),
  [IT.ICE]: item({ name: '冰块', kind: 'block', tile: T.ICE, desc: '走在上面会打滑！' }),
  [IT.MUD]: item({ name: '泥块', kind: 'block', tile: T.MUD, desc: '丛林里的湿泥。' }),
  [IT.ASH]: item({ name: '灰烬块', kind: 'block', tile: T.ASH, desc: '来自地狱的灰。' }),
  [IT.HELLSTONE_ORE]: item({ name: '狱石', kind: 'material', desc: '滚烫的地狱矿石，烫手但珍贵。' }),
  [IT.OBSIDIAN]: item({ name: '黑曜石', kind: 'block', tile: T.OBSIDIAN, desc: '水与火的结晶，坚硬无比。' }),
  [IT.EBONSTONE]: item({ name: '黑檀石', kind: 'block', tile: T.CORRUPT_STONE, desc: '散发着不祥的气息。' }),
  [IT.CACTUS]: item({ name: '仙人掌', kind: 'block', tile: T.CACTUS, desc: '扎手的沙漠植物，种在沙子上。' }),
  // ---- 武器/弹药/消耗 ----
  [IT.BOW]: item({ name: '木弓', kind: 'weapon', maxStack: 1, dmg: 9, useTime: 24, ranged: 'arrow', desc: '远程武器，消耗木箭。' }),
  [IT.ARROW]: item({ name: '木箭', kind: 'material', maxStack: 250, desc: '弓的弹药。' }),
  [IT.BOMB]: item({ name: '炸弹', kind: 'weapon', maxStack: 50, dmg: 60, useTime: 30, ranged: 'bomb', desc: '投掷后爆炸，能炸毁方块！小心别炸到自己。' }),
  [IT.LENS]: item({ name: '晶状体', kind: 'material', maxStack: 99, desc: '恶魔眼掉落的黑色晶状体。' }),
  [IT.LIFE_CRYSTAL]: item({ name: '生命水晶', kind: 'material', maxStack: 9, desc: '使用后永久增加 20 点生命上限（最高 200）。' }),
  [IT.EYE_SUMMON]: item({ name: '可疑的眼球', kind: 'material', maxStack: 5, desc: '在夜晚使用，召唤克苏鲁之眼……' }),
  // ---- 高阶金属 ----
  [IT.DEMONITE_ORE]: item({ name: '魔金矿石', kind: 'material', desc: '蕴含黑暗力量的矿石。' }),
  [IT.DEMONITE_BAR]: item({ name: '魔金锭', kind: 'material', desc: '熔炼后的魔金，寒气逼人。' }),
  [IT.NIGHTMARE_PICK]: item({ name: '梦魇镐', kind: 'tool', tool: 'pick', maxStack: 1, power: 100, dmg: 10, useTime: 10, swing: 'arc', desc: '可以开采狱岩与黑曜石的噩梦之镐。' }),
  [IT.LIGHTS_BANE]: item({ name: '灾厄之刃', kind: 'weapon', maxStack: 1, dmg: 24, useTime: 16, swing: 'arc', desc: '散发着黑暗气息的魔金大剑。' }),
  [IT.HELLSTONE_BAR]: item({ name: '狱岩锭', kind: 'material', desc: '用狱石和黑曜石锻造的炽热金属。' }),
  [IT.MOLTEN_PICK]: item({ name: '熔岩镐', kind: 'tool', tool: 'pick', maxStack: 1, power: 130, dmg: 12, useTime: 9, swing: 'arc', desc: '世上最强大的镐子。' }),
  [IT.VOLCANO]: item({ name: '火山', kind: 'weapon', maxStack: 1, dmg: 32, useTime: 18, swing: 'arc', desc: '燃烧着地狱之火的传说巨剑。' }),
  [IT.COPPER_BAR]: item({ name: '铜锭', kind: 'material', desc: '熔炼过的铜。' }),
  // ---- 盔甲 ----
  [IT.COPPER_HELM]: item({ name: '铜头盔', kind: 'armor', armorSlot: 'head', defense: 1, maxStack: 1, desc: '防御+1' }),
  [IT.COPPER_MAIL]: item({ name: '铜链甲', kind: 'armor', armorSlot: 'body', defense: 2, maxStack: 1, desc: '防御+2' }),
  [IT.COPPER_LEGS]: item({ name: '铜护腿', kind: 'armor', armorSlot: 'legs', defense: 1, maxStack: 1, desc: '防御+1' }),
  [IT.IRON_HELM]: item({ name: '铁头盔', kind: 'armor', armorSlot: 'head', defense: 2, maxStack: 1, desc: '防御+2' }),
  [IT.IRON_MAIL]: item({ name: '铁链甲', kind: 'armor', armorSlot: 'body', defense: 3, maxStack: 1, desc: '防御+3' }),
  [IT.IRON_LEGS]: item({ name: '铁护腿', kind: 'armor', armorSlot: 'legs', defense: 2, maxStack: 1, desc: '防御+2' }),
  [IT.SILVER_HELM]: item({ name: '银头盔', kind: 'armor', armorSlot: 'head', defense: 3, maxStack: 1, desc: '防御+3' }),
  [IT.SILVER_MAIL]: item({ name: '银链甲', kind: 'armor', armorSlot: 'body', defense: 4, maxStack: 1, desc: '防御+4' }),
  [IT.SILVER_LEGS]: item({ name: '银护腿', kind: 'armor', armorSlot: 'legs', defense: 3, maxStack: 1, desc: '防御+3' }),
  [IT.GOLD_HELM]: item({ name: '金头盔', kind: 'armor', armorSlot: 'head', defense: 4, maxStack: 1, desc: '防御+4' }),
  [IT.GOLD_MAIL]: item({ name: '金链甲', kind: 'armor', armorSlot: 'body', defense: 5, maxStack: 1, desc: '防御+5' }),
  [IT.GOLD_LEGS]: item({ name: '金护腿', kind: 'armor', armorSlot: 'legs', defense: 4, maxStack: 1, desc: '防御+4' }),
  [IT.SHADOW_HELM]: item({ name: '暗影头盔', kind: 'armor', armorSlot: 'head', defense: 5, maxStack: 1, desc: '防御+5，套装由魔金锻造。' }),
  [IT.SHADOW_MAIL]: item({ name: '暗影链甲', kind: 'armor', armorSlot: 'body', defense: 7, maxStack: 1, desc: '防御+7，暗影包裹全身。' }),
  [IT.SHADOW_LEGS]: item({ name: '暗影护腿', kind: 'armor', armorSlot: 'legs', defense: 5, maxStack: 1, desc: '防御+5' }),
  // ---- 家具/杂项 ----
  [IT.ACORN]: item({ name: '橡子', kind: 'material', maxStack: 99, desc: '种在草地上会长成大树。' }),
  [IT.WOODEN_DOOR]: item({ name: '木门', kind: 'station', tile: T.DOOR_C_T, maxStack: 99, desc: '右键点击开关的门。' }),
  [IT.CHEST]: item({ name: '宝箱', kind: 'station', tile: T.CHEST_TL, maxStack: 99, desc: '存放物品，右键打开。' }),
  [IT.TABLE]: item({ name: '木桌', kind: 'station', tile: T.TABLE_L, maxStack: 99, desc: '三件套之一。' }),
  [IT.CHAIR]: item({ name: '木椅', kind: 'station', tile: T.CHAIR, maxStack: 99, desc: '坐下来歇歇脚。' }),
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
  { out: IT.BOW, count: 1, ins: [{ id: IT.WOOD, n: 10 }], station: 'workbench' },
  { out: IT.ARROW, count: 25, ins: [{ id: IT.WOOD, n: 3 }, { id: IT.STONE, n: 1 }], station: 'workbench' },
  { out: IT.BOMB, count: 3, ins: [{ id: IT.GEL, n: 2 }, { id: IT.STONE, n: 2 }], station: 'workbench' },
  { out: IT.FURNACE, count: 1, ins: [{ id: IT.STONE, n: 20 }, { id: IT.WOOD, n: 4 }, { id: IT.TORCH, n: 3 }], station: 'workbench' },
  { out: IT.ANVIL, count: 1, ins: [{ id: IT.BAR_IRON, n: 5 }], station: 'workbench' },
  { out: IT.WOODEN_DOOR, count: 1, ins: [{ id: IT.WOOD, n: 6 }], station: 'workbench' },
  { out: IT.CHEST, count: 1, ins: [{ id: IT.WOOD, n: 8 }, { id: IT.BAR_IRON, n: 2 }], station: 'workbench' },
  { out: IT.TABLE, count: 1, ins: [{ id: IT.WOOD, n: 8 }], station: 'workbench' },
  { out: IT.CHAIR, count: 1, ins: [{ id: IT.WOOD, n: 4 }], station: 'workbench' },
  // 熔炼
  { out: IT.COPPER_BAR, count: 1, ins: [{ id: IT.ORE_COPPER, n: 3 }], station: 'furnace' },
  { out: IT.BAR_IRON, count: 1, ins: [{ id: IT.ORE_IRON, n: 3 }], station: 'furnace' },
  { out: IT.BAR_SILVER, count: 1, ins: [{ id: IT.ORE_SILVER, n: 3 }], station: 'furnace' },
  { out: IT.BAR_GOLD, count: 1, ins: [{ id: IT.ORE_GOLD, n: 3 }], station: 'furnace' },
  { out: IT.DEMONITE_BAR, count: 1, ins: [{ id: IT.DEMONITE_ORE, n: 3 }], station: 'furnace' },
  { out: IT.HELLSTONE_BAR, count: 1, ins: [{ id: IT.HELLSTONE_ORE, n: 3 }, { id: IT.OBSIDIAN, n: 1 }], station: 'furnace' },
  // 铁砧: 工具武器
  { out: IT.IRON_PICK, count: 1, ins: [{ id: IT.BAR_IRON, n: 10 }, { id: IT.WOOD, n: 3 }], station: 'anvil' },
  { out: IT.IRON_SWORD, count: 1, ins: [{ id: IT.BAR_IRON, n: 8 }, { id: IT.WOOD, n: 3 }], station: 'anvil' },
  { out: IT.SILVER_PICK, count: 1, ins: [{ id: IT.BAR_SILVER, n: 12 }, { id: IT.WOOD, n: 3 }], station: 'anvil' },
  { out: IT.SILVER_SWORD, count: 1, ins: [{ id: IT.BAR_SILVER, n: 10 }, { id: IT.WOOD, n: 3 }], station: 'anvil' },
  { out: IT.GOLD_PICK, count: 1, ins: [{ id: IT.BAR_GOLD, n: 12 }, { id: IT.WOOD, n: 3 }], station: 'anvil' },
  { out: IT.GOLD_SWORD, count: 1, ins: [{ id: IT.BAR_GOLD, n: 10 }, { id: IT.WOOD, n: 3 }], station: 'anvil' },
  { out: IT.NIGHTMARE_PICK, count: 1, ins: [{ id: IT.DEMONITE_BAR, n: 12 }, { id: IT.WOOD, n: 4 }], station: 'anvil' },
  { out: IT.LIGHTS_BANE, count: 1, ins: [{ id: IT.DEMONITE_BAR, n: 10 }], station: 'anvil' },
  { out: IT.MOLTEN_PICK, count: 1, ins: [{ id: IT.HELLSTONE_BAR, n: 20 }], station: 'anvil' },
  { out: IT.VOLCANO, count: 1, ins: [{ id: IT.HELLSTONE_BAR, n: 25 }], station: 'anvil' },
  // 铁砧: 盔甲 (铜/铁/银/金/暗影)
  { out: IT.COPPER_HELM, count: 1, ins: [{ id: IT.COPPER_BAR, n: 12 }], station: 'anvil' },
  { out: IT.COPPER_MAIL, count: 1, ins: [{ id: IT.COPPER_BAR, n: 18 }], station: 'anvil' },
  { out: IT.COPPER_LEGS, count: 1, ins: [{ id: IT.COPPER_BAR, n: 14 }], station: 'anvil' },
  { out: IT.IRON_HELM, count: 1, ins: [{ id: IT.BAR_IRON, n: 14 }], station: 'anvil' },
  { out: IT.IRON_MAIL, count: 1, ins: [{ id: IT.BAR_IRON, n: 22 }], station: 'anvil' },
  { out: IT.IRON_LEGS, count: 1, ins: [{ id: IT.BAR_IRON, n: 18 }], station: 'anvil' },
  { out: IT.SILVER_HELM, count: 1, ins: [{ id: IT.BAR_SILVER, n: 14 }], station: 'anvil' },
  { out: IT.SILVER_MAIL, count: 1, ins: [{ id: IT.BAR_SILVER, n: 22 }], station: 'anvil' },
  { out: IT.SILVER_LEGS, count: 1, ins: [{ id: IT.BAR_SILVER, n: 18 }], station: 'anvil' },
  { out: IT.GOLD_HELM, count: 1, ins: [{ id: IT.BAR_GOLD, n: 14 }], station: 'anvil' },
  { out: IT.GOLD_MAIL, count: 1, ins: [{ id: IT.BAR_GOLD, n: 22 }], station: 'anvil' },
  { out: IT.GOLD_LEGS, count: 1, ins: [{ id: IT.BAR_GOLD, n: 18 }], station: 'anvil' },
  { out: IT.SHADOW_HELM, count: 1, ins: [{ id: IT.DEMONITE_BAR, n: 10 }], station: 'anvil' },
  { out: IT.SHADOW_MAIL, count: 1, ins: [{ id: IT.DEMONITE_BAR, n: 16 }], station: 'anvil' },
  { out: IT.SHADOW_LEGS, count: 1, ins: [{ id: IT.DEMONITE_BAR, n: 12 }], station: 'anvil' },
  // 恶魔祭坛: Boss 召唤物
  { out: IT.EYE_SUMMON, count: 1, ins: [{ id: IT.LENS, n: 6 }], station: 'altar' },
];

// 多格家具放置形状(相对主格)
export const FURNITURE_SHAPE: Record<number, [number, number][]> = {
  [T.WORKBENCH_L]: [[0, 0], [1, 0]],
  [T.FURNACE_TL]: [[0, 0], [1, 0], [0, 1], [1, 1]],
  [T.ANVIL_L]: [[0, 0], [1, 0]],
  [T.DOOR_C_T]: [[0, 0], [0, 1]],
  [T.DOOR_O_T]: [[0, 0], [0, 1]],
  [T.CHEST_TL]: [[0, 0], [1, 0], [0, 1], [1, 1]],
  [T.ALTAR_TL]: [[0, 0], [1, 0], [0, 1], [1, 1]],
  [T.TABLE_L]: [[0, 0], [1, 0]],
};

// ==================== 宝箱战利品 ====================
export interface ChestLootEntry { id: number; min: number; max: number; chance: number }
/** tier: 'surface' 地表 | 'cave' 洞穴 | 'deep' 深层 | 'island' 空岛 | 'hell' 地狱 */
export const CHEST_LOOT: Record<string, ChestLootEntry[]> = {
  surface: [
    { id: IT.TORCH, min: 5, max: 12, chance: 0.9 },
    { id: IT.ARROW, min: 25, max: 60, chance: 0.6 },
    { id: IT.WOOD, min: 15, max: 40, chance: 0.5 },
    { id: IT.BOMB, min: 3, max: 6, chance: 0.35 },
    { id: IT.GEL, min: 3, max: 8, chance: 0.4 },
    { id: IT.LIFE_CRYSTAL, min: 1, max: 1, chance: 0.08 },
  ],
  cave: [
    { id: IT.TORCH, min: 6, max: 15, chance: 0.9 },
    { id: IT.BOMB, min: 3, max: 8, chance: 0.6 },
    { id: IT.ARROW, min: 30, max: 80, chance: 0.5 },
    { id: IT.BAR_IRON, min: 2, max: 5, chance: 0.5 },
    { id: IT.ORE_SILVER, min: 4, max: 10, chance: 0.4 },
    { id: IT.LIFE_CRYSTAL, min: 1, max: 1, chance: 0.12 },
    { id: IT.ACORN, min: 2, max: 5, chance: 0.3 },
  ],
  deep: [
    { id: IT.TORCH, min: 8, max: 18, chance: 0.9 },
    { id: IT.BOMB, min: 5, max: 10, chance: 0.7 },
    { id: IT.BAR_GOLD, min: 2, max: 4, chance: 0.4 },
    { id: IT.ORE_GOLD, min: 5, max: 12, chance: 0.5 },
    { id: IT.LIFE_CRYSTAL, min: 1, max: 1, chance: 0.15 },
    { id: IT.OBSIDIAN, min: 4, max: 10, chance: 0.3 },
  ],
  island: [
    { id: IT.BAR_GOLD, min: 3, max: 6, chance: 0.8 },
    { id: IT.ORE_GOLD, min: 8, max: 15, chance: 0.7 },
    { id: IT.LIFE_CRYSTAL, min: 1, max: 1, chance: 0.35 },
    { id: IT.ARROW, min: 40, max: 80, chance: 0.4 },
  ],
  hell: [
    { id: IT.OBSIDIAN, min: 8, max: 20, chance: 0.8 },
    { id: IT.HELLSTONE_ORE, min: 10, max: 25, chance: 0.6 },
    { id: IT.BOMB, min: 6, max: 12, chance: 0.6 },
    { id: IT.LIFE_CRYSTAL, min: 1, max: 1, chance: 0.15 },
  ],
};

// ==================== 玩家参数 ====================
export const PLAYER_CONF = {
  w: 12, h: 42,   // 15-a: 高度对齐原版(42); 宽度保持 12 以兼容 1 格宽门洞(原版 20)
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
  iceFricMul: 0.12,  // 冰面摩擦系数倍率(滑)
  iceAccelMul: 0.55, // 冰面加速倍率
  lavaDmg: 28,       // 岩浆每秒伤害(帧间隔触发)
  lavaTick: 30,
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
  boss?: boolean;
  lensDrop?: number;      // 晶状体掉落概率
  def?: number;           // 防御(减伤)
}

export const ENEMY_DEFS: Record<string, EnemyConf> = {
  // 15-a: 判定盒与原生精灵对齐(旧版 32x24 精灵記 16x12 判定 → 剑打不到怪身体/怪碰不到人)
  gslime: { name: '绿史莱姆', w: 22, h: 18, hp: 16, dmg: 7, kb: 0.1, gelDrop: [0, 1], night: false, fly: false, mapColor: '#5cd05c' },
  bslime: { name: '蓝史莱姆', w: 26, h: 20, hp: 45, dmg: 12, kb: 0.25, gelDrop: [1, 2], night: false, fly: false, mapColor: '#5c8ee0' },
  zombie: { name: '僵尸', w: 16, h: 40, hp: 55, dmg: 15, kb: 0.15, night: true, fly: false, mapColor: '#7a9b6a' },
  eye: { name: '恶魔眼', w: 26, h: 16, hp: 38, dmg: 13, kb: 0.3, night: true, fly: true, mapColor: '#c05050', lensDrop: 0.5 },
  // ---- 新敌怪 ----
  bat: { name: '洞穴蝙蝠', w: 18, h: 16, hp: 18, dmg: 10, kb: 0.2, night: false, fly: true, mapColor: '#6a4a5a' },
  skel: { name: '骷髅', w: 16, h: 40, hp: 65, dmg: 18, kb: 0.15, night: false, fly: false, mapColor: '#c8c8c8', def: 4 },
  lslime: { name: '熔岩史莱姆', w: 24, h: 18, hp: 40, dmg: 22, kb: 0.2, gelDrop: [1, 2], night: false, fly: false, mapColor: '#f07030' },
  eos: { name: '噬魂者', w: 22, h: 44, hp: 30, dmg: 15, kb: 0.25, night: false, fly: true, mapColor: '#8a5aaa', lensDrop: 0.15 },
  eoc: { name: '克苏鲁之眼', w: 96, h: 52, hp: 1800, dmg: 24, kb: 0.9, night: true, fly: true, mapColor: '#d04040', boss: true, def: 8 },
};

// ==================== 向导台词 ====================
export const GUIDE_LINES: string[] = [
  '你好！我是向导。用铜镐挖矿、铜斧砍树吧。',
  '先砍树收集木材，做个工作台，然后做一把木剑。',
  '火把需要凝胶——打史莱姆就能拿到！',
  '晚上很危险，僵尸和恶魔眼会出没，记得建个庇护所。',
  '用熔炉把矿石熔炼成锭，铁砧能锻造盔甲。',
  '听说地下深处藏着粉色的生命水晶……',
  '腐化之地的恶魔祭坛可以合成可疑的眼球。夜里使用它，会发生可怕的事……',
  '要是挖到黑曜石，说明你找到了水和岩浆的交界处。',
  '地狱在世界的最底层，狱石可是好东西——就是有点烫。',
  '丛林、沙漠、雪原……这个世界很大，多探索探索！',
];
