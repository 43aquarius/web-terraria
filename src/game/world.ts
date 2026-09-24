/**
 * 世界：生成(六大群系 + 空岛 + 地狱 + 宝箱/生命水晶/祭坛) / 访问 /
 *      液体模拟(水 + 岩浆 + 黑曜石) / 草蔓延 / 砍树 / RLE 存档
 *
 * 生成完全确定性: 同 seed + 同尺寸 → 完全相同的世界(generate 内禁止 Math.random)。
 */

import { T, W_NONE, W_DIRT, W_STONE, WORLD_W, WORLD_H, BIOME, TileDefs } from './constants';
import { mulberry32 } from './textures';

// ==================== 噪声 ====================
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smoothstep(t: number): number { return t * t * (3 - 2 * t); }
function vnoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smoothstep(x - ix), fy = smoothstep(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function vnoise1(x: number, seed: number): number { return vnoise2(x, 0.5, seed); }

export interface Cell { x: number; y: number; trunk: boolean }

/** 宝箱生成点(主格 = CHEST_TL 左上) */
export interface ChestSpawn { x: number; y: number; tier: 'surface' | 'cave' | 'deep' | 'island' | 'hell' }

/** 地狱层厚度(基岩 2 行之上) */
const HELL_DEPTH = 42;
/** 熔岩海所在带: [h-16, h-4] */
const LAVA_SEA_TOP = 16;
const LAVA_SEA_BOT = 4;

export class World {
  w = WORLD_W;
  h = WORLD_H;
  tiles = new Uint8Array(WORLD_W * WORLD_H);
  walls = new Uint8Array(WORLD_W * WORLD_H);
  surface = new Int16Array(WORLD_W);
  dirtLine = new Int16Array(WORLD_W);
  skyTop = new Int16Array(WORLD_W);
  spawnX = 0;
  spawnY = 0;
  seed = 0;
  waterActive = new Set<number>();
  onTileChanged: ((x: number, y: number, id: number) => void) | null = null;
  // ---- 群系扩展 ----
  biome = new Uint8Array(WORLD_W);                 // 每列群系 id(BIOME.*)
  hellY = WORLD_H - HELL_DEPTH;                    // 地狱层起始行
  chestSpawns: ChestSpawn[] = [];                  // 宝箱生成点(主格=TL)
  altarSpawns: { x: number; y: number }[] = [];    // 恶魔祭坛生成点(主格=TL)
  lavaActive = new Set<number>();                  // 活跃岩浆格
  private lavaPhase = 0;                           // 岩浆节拍(每 3 次 tickWater 处理一轮)

  constructor(seed?: number, w?: number, h?: number) {
    if (w !== undefined || h !== undefined) this.initSize(w ?? this.w, h ?? this.h);
    if (seed !== undefined) this.generate(seed, this.w, this.h);
  }

  /** 按尺寸重建全部数组 */
  private initSize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.walls = new Uint8Array(w * h);
    this.surface = new Int16Array(w);
    this.dirtLine = new Int16Array(w);
    this.skyTop = new Int16Array(w);
    this.biome = new Uint8Array(w);
    this.hellY = Math.max(20, h - HELL_DEPTH);
  }

  idx(x: number, y: number): number { return y * this.w + x; }

  get(x: number, y: number): number {
    if (x < 0 || x >= this.w) return T.STONE;
    if (y < 0) return T.AIR;
    if (y >= this.h) return T.STONE;
    return this.tiles[y * this.w + x];
  }

  getWall(x: number, y: number): number {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return W_NONE;
    return this.walls[y * this.w + x];
  }

  set(x: number, y: number, id: number): void {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    this.tiles[y * this.w + x] = id;
    this.updateSkyColumn(x);
    this.activateAround(x, y);
    if (this.onTileChanged) this.onTileChanged(x, y, id);
  }

  isSolidTile(id: number): boolean { return TileDefs[id].solid; }
  isSolid(x: number, y: number): boolean { return this.isSolidTile(this.get(x, y)); }

  /** 该列群系 id(越界视为森林) */
  biomeAt(x: number): number {
    if (x < 0 || x >= this.w) return BIOME.FOREST;
    return this.biome[x];
  }

  /** 天空直射深度(首个实心/水) */
  updateSkyColumn(x: number): void {
    if (x < 0 || x >= this.w) return;
    let y = 0;
    for (; y < this.h; y++) {
      const id = this.tiles[y * this.w + x];
      if (TileDefs[id].solid || id === T.WATER) break;
    }
    this.skyTop[x] = y;
  }

  /** 激活 (x,y) 周围的水与岩浆 */
  activateAround(x: number, y: number): void {
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= this.h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= this.w) continue;
        const id = this.tiles[ny * this.w + nx];
        if (id === T.WATER) this.waterActive.add(ny * this.w + nx);
        else if (id === T.LAVA) this.lavaActive.add(ny * this.w + nx);
      }
    }
  }

  // ==================== 世界生成 ====================
  generate(seed: number, w?: number, h?: number): void {
    const gw = w ?? this.w, gh = h ?? this.h;
    if (gw !== this.w || gh !== this.h || this.tiles.length !== gw * gh) this.initSize(gw, gh);
    this.seed = seed;
    const rng = mulberry32(seed);
    const ww = this.w, hh = this.h, hellY = this.hellY;
    const s1 = (seed ^ 0x1f2e3d) & 0xffff, s2 = (seed * 7 + 11) & 0xffff;
    const s3 = (seed * 13 + 29) & 0xffff, s4 = (seed * 17 + 71) & 0xffff;
    const s5 = (seed * 23 + 113) & 0xffff, s6 = (seed * 31 + 211) & 0xffff;
    const s7 = (seed * 43 + 307) & 0xffff, s8 = (seed * 59 + 401) & 0xffff;
    const s9 = (seed * 61 + 509) & 0xffff;
    const ri = (lo: number, hi: number): number => lo + ((rng() * (hi - lo + 1)) | 0);
    this.chestSpawns = [];
    this.altarSpawns = [];
    this.waterActive.clear();
    this.lavaActive.clear();
    this.lavaPhase = 0;

    // ---- 1) 群系布局: [边森林|腐化|雪原|缓冲|中央森林(出生)|沙漠|丛林|蘑菇|缓冲|边森林] ----
    // 顺序: 腐化/雪原/缓冲/中央/沙漠/丛林/蘑菇/缓冲
    const parts = [ri(150, 240), ri(150, 240), ri(30, 60), ri(90, 130), ri(140, 220), ri(170, 260), ri(110, 180), ri(30, 60)];
    let total = 0;
    for (const p of parts) total += p;
    if (total > ww - 30) {
      // 超宽 → 按比例压缩(保底 60% 下限), 再从最宽块扣; 两侧至少留 15 列边缘森林
      const mins = [90, 90, 18, 54, 84, 102, 66, 18];
      const scale = (ww - 30) / total;
      for (let i = 0; i < parts.length; i++) parts[i] = Math.max(mins[i], Math.round(parts[i] * scale));
      let t2 = 0;
      for (const p of parts) t2 += p;
      while (t2 > ww - 30) {
        let mi = 0;
        for (let i = 1; i < parts.length; i++) if (parts[i] > parts[mi]) mi = i;
        parts[mi]--; t2--;
      }
      total = t2;
    }
    const edgeL = (ww - total) >> 1; // 剩余列 → 两侧边缘森林
    const b: number[] = new Array(10);
    b[0] = edgeL; b[9] = ww;
    let acc = edgeL;
    for (let i = 0; i < 8; i++) { acc += parts[i]; b[i + 1] = acc; }
    // 边界渗透: 每条内部边界 ±3 列随机偏移(两遍夹紧保证单调)
    for (let i = 1; i <= 8; i++) b[i] += ((rng() * 7) | 0) - 3;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i <= 8; i++) {
        const lo = b[i - 1] + 6, hi = (i === 8 ? ww : b[i + 1]) - 6;
        if (b[i] < lo) b[i] = lo;
        if (b[i] > hi) b[i] = hi;
      }
    }
    const segBiome = [BIOME.FOREST, BIOME.CORRUPTION, BIOME.SNOW, BIOME.FOREST, BIOME.FOREST,
      BIOME.DESERT, BIOME.JUNGLE, BIOME.MUSHROOM, BIOME.FOREST, BIOME.FOREST];
    this.biome.fill(0);
    for (let k = 0; k < 10; k++) {
      const s = k === 0 ? 0 : b[k - 1];
      const e = k === 9 ? ww : b[k];
      for (let x = Math.max(0, s); x < Math.min(ww, e); x++) this.biome[x] = segBiome[k];
    }
    const spawnCol = Math.min(ww - 8, Math.max(8, (b[3] + b[4]) >> 1));
    // 各群系实际范围
    let corrX0 = -1, corrX1 = -1, jungX0 = -1, jungX1 = -1;
    for (let x = 0; x < ww; x++) {
      const bi = this.biome[x];
      if (bi === BIOME.CORRUPTION) { if (corrX0 < 0) corrX0 = x; corrX1 = x; }
      else if (bi === BIOME.JUNGLE) { if (jungX0 < 0) jungX0 = x; jungX1 = x; }
    }
    if (corrX0 < 0) { corrX0 = 0; corrX1 = 0; }
    if (jungX0 < 0) { jungX0 = 0; jungX1 = 0; }

    // ---- 2) 地表高度 & 泥土线(沙漠振幅×0.5 / 丛林×1.5, 交界 8-12 列平滑) ----
    const ampRaw = new Float32Array(ww);
    for (let x = 0; x < ww; x++) {
      const bi = this.biome[x];
      ampRaw[x] = bi === BIOME.DESERT ? 0.5 : bi === BIOME.JUNGLE ? 1.5 : 1;
    }
    const smoothW = 8 + ((rng() * 5) | 0); // 8-12 列过渡
    const half = smoothW >> 1;
    const amp = new Float32Array(ww);
    const baseSurf = Math.min(96, Math.floor(hh * 0.283)); // 地表基准(小世界相应抬高)
    for (let x = 0; x < ww; x++) {
      let s = 0, n = 0;
      for (let k = -half; k <= half; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= ww) continue;
        s += ampRaw[xx]; n++;
      }
      amp[x] = s / n;
    }
    for (let x = 0; x < ww; x++) {
      const n = (vnoise1(x / 26, s1) * 2 - 1) * 24
        + (vnoise1(x / 9, s2) * 2 - 1) * 10
        + (vnoise1(x / 4.2, s3) * 2 - 1) * 4;
      const edge = Math.min(x, ww - 1 - x);
      const damp = edge < 28 ? smoothstep(edge / 28) : 1;
      this.surface[x] = Math.round(baseSurf + n * amp[x] * damp);
      this.dirtLine[x] = this.surface[x] + 15 + Math.round((vnoise1(x / 13, s4) * 2 - 1) * 7);
    }

    // ---- 3) 柱状填充: 按群系材质 + 地狱 ASH + 底部基岩 ----
    for (let x = 0; x < ww; x++) {
      const bi = this.biome[x];
      const sy = this.surface[x], dy = this.dirtLine[x];
      // 表层厚度(连续噪声, 按群系)
      let sandD = 0, snowD = 0, dirtD = 0, ebonD = 0, mudD = 0;
      if (bi === BIOME.DESERT) sandD = 8 + Math.round(vnoise1(x / 9, s5) * 6);        // 8-14 沙
      else if (bi === BIOME.SNOW) snowD = 4 + Math.round(vnoise1(x / 9, s5) * 4);     // 4-8 雪
      else if (bi === BIOME.CORRUPTION) {
        dirtD = 4 + Math.round(vnoise1(x / 9, s5) * 2);                               // 4-6 泥
        ebonD = 6 + Math.round(vnoise1(x / 7, s6) * 4);                               // 6-10 黑檀石
      } else if (bi === BIOME.JUNGLE) mudD = 15 + Math.round(vnoise1(x / 11, s5) * 10); // 15-25 泥
      const snowBlob = bi === BIOME.SNOW, mudBlob = bi === BIOME.JUNGLE, ebonBlob = bi === BIOME.CORRUPTION;
      for (let y = 0; y < hh; y++) {
        const i = y * ww + x;
        let id: number;
        if (y >= hellY) {
          id = y >= hh - 2 ? T.STONE : T.ASH; // 地狱灰烬 + 底部 2 行基岩
        } else if (y < sy) {
          id = T.AIR;
        } else if (y === sy) {
          id = bi === BIOME.DESERT ? T.SAND
            : bi === BIOME.SNOW ? T.SNOW
            : bi === BIOME.CORRUPTION ? T.CORRUPT_GRASS
            : bi === BIOME.JUNGLE ? T.JUNGLE_GRASS
            : T.GRASS;
        } else if (y < dy) {
          if (bi === BIOME.DESERT) {
            id = y < sy + sandD ? T.SAND : T.STONE; // 沙丘下直接石头
          } else if (bi === BIOME.SNOW) {
            if (y < sy + snowD) id = T.SNOW;
            else {
              id = T.DIRT;
              if (vnoise2(x / 12, y / 9, s5) > 0.68) id = T.CLAY;
            }
          } else if (bi === BIOME.CORRUPTION) {
            if (y < sy + dirtD) id = T.DIRT;
            else if (y < sy + dirtD + ebonD) id = T.CORRUPT_STONE;
            else id = T.STONE;
          } else if (bi === BIOME.JUNGLE) {
            id = y < sy + mudD ? T.MUD : T.STONE;
          } else {
            id = T.DIRT;
            if (vnoise2(x / 12, y / 9, s5) > 0.68) id = T.CLAY;
          }
        } else {
          id = T.STONE;
          if (y < dy + 16 && vnoise2(x / 9 + 40, y / 7 + 40, s6) > 0.68) id = T.DIRT;
          else if (snowBlob && y >= sy + 12 && y < dy + 40 && vnoise2(x / 10, y / 8, s9) > 0.66) id = T.ICE;
          else if (mudBlob && y >= sy + 8 && vnoise2(x / 10, y / 8, s9) > 0.6) id = T.MUD;
          else if (ebonBlob && y >= sy + 20 && vnoise2(x / 10, y / 8, s9) > 0.7) id = T.CORRUPT_STONE;
        }
        this.tiles[i] = id;
      }
    }

    // ---- 4) 洞穴(地表层以下, 地狱以上) ----
    for (let x = 0; x < ww; x++) {
      const sy = this.surface[x], dy = this.dirtLine[x];
      for (let y = sy + 7; y < hellY; y++) {
        const blob = vnoise2(x / 8.5, y / 6.2, s7);
        const worm = vnoise2(x / 30 + 99, y / 20 + 7, s8);
        const depth = Math.min(1, Math.max(0, (y - dy) / (hh - dy)));
        const isCave = blob > 0.625 || Math.abs(worm - 0.5) < 0.03 + depth * 0.022;
        if (isCave) this.tiles[y * ww + x] = T.AIR;
      }
    }

    // ---- 5) 矿脉(数量按 w/1100 缩放, 深度覆盖到新尺寸) ----
    let dlSum = 0;
    for (let x = 0; x < ww; x++) dlSum += this.dirtLine[x];
    const dlAvg = dlSum / ww;
    const oreScale = ww / 1100;
    const vein = (count: number, y0: number, y1: number, ore: number) => {
      for (let v = 0; v < count; v++) {
        let x = 2 + ((rng() * (ww - 4)) | 0);
        let y = y0 + ((rng() * Math.max(1, y1 - y0)) | 0);
        const len = 5 + ((rng() * 9) | 0);
        for (let s = 0; s < len; s++) {
          if (x > 1 && x < ww - 1 && y > 1 && y < hh - 4 && this.tiles[y * ww + x] === T.STONE) {
            this.tiles[y * ww + x] = ore;
          }
          x += (rng() * 3 | 0) - 1;
          y += (rng() * 3 | 0) - 1;
        }
      }
    };
    vein(Math.max(1, Math.round(240 * oreScale)), Math.round(dlAvg - 7), Math.round(dlAvg + 64), T.ORE_COPPER);
    vein(Math.max(1, Math.round(190 * oreScale)), Math.round(dlAvg + 34), Math.round(dlAvg + 149), T.ORE_IRON);
    vein(Math.max(1, Math.round(140 * oreScale)), Math.round(dlAvg + 94), hh - 20, T.ORE_SILVER);
    vein(Math.max(1, Math.round(110 * oreScale)), Math.round(dlAvg + 144), hh - 40, T.ORE_GOLD);

    // ---- 6) 地狱: 大空腔丘陵 + 狱岩矿脉 + 岩浆海 + 小岩浆池 ----
    for (let x = 0; x < ww; x++) {
      for (let y = hellY + 2; y < hh - 2; y++) {
        const blob = vnoise2(x / 10, y / 7, s7);
        const worm = vnoise2(x / 34 + 55, y / 22 + 13, s8);
        if (blob > 0.58 || Math.abs(worm - 0.5) < 0.085) this.tiles[y * ww + x] = T.AIR;
      }
    }
    {
      const hvCount = 30 + ((rng() * 31) | 0); // 30-60 条
      const yTop = hellY + 3, yBot = hh - 20; // 避开底部岩浆海, 深处(靠近海)更多
      for (let v = 0; v < hvCount; v++) {
        // 起点重试找 ASH(最多 8 次), 提高成矿率
        let x = 0, y = 0, found = false;
        for (let a = 0; a < 8; a++) {
          x = 2 + ((rng() * (ww - 4)) | 0);
          // pow(r,0.6) 偏向深部 → 越深越多
          y = yTop + Math.floor(Math.pow(rng(), 0.6) * Math.max(1, yBot - yTop));
          if (this.tiles[y * ww + x] === T.ASH) { found = true; break; }
        }
        if (!found) continue;
        const len = 4 + ((rng() * 5) | 0); // 4-8 格
        for (let s = 0; s < len; s++) {
          if (x > 1 && x < ww - 1 && y > hellY && y < hh - 3 && this.tiles[y * ww + x] === T.ASH) {
            this.tiles[y * ww + x] = T.HELLSTONE;
          }
          x += (rng() * 3 | 0) - 1;
          y += (rng() * 3 | 0) - 1;
        }
      }
    }
    // 岩浆海: 底部大空腔(h-16..h-4)的空气 → 岩浆
    for (let y = hh - LAVA_SEA_TOP; y <= hh - LAVA_SEA_BOT; y++) {
      for (let x = 0; x < ww; x++) {
        if (this.tiles[y * ww + x] === T.AIR) this.tiles[y * ww + x] = T.LAVA;
      }
    }
    // 岩浆海下封底, 防止悬空
    for (let x = 0; x < ww; x++) {
      if (this.tiles[(hh - 3) * ww + x] === T.AIR) this.tiles[(hh - 3) * ww + x] = T.ASH;
    }
    // hellY 附近小岩浆池
    {
      const poolN = 4 + ((rng() * 5) | 0); // 4-8 个
      for (let p = 0; p < poolN; p++) {
        const px = 6 + ((rng() * (ww - 12)) | 0);
        let fy = -1;
        for (let q = 0; q < 14; q++) {
          const yy = hellY + 2 + q;
          if (yy >= hh - 4) break;
          if (this.tiles[yy * ww + px] === T.AIR && this.isSolid(px, yy + 1)) { fy = yy; break; }
        }
        if (fy < 0) continue;
        const rx = 2 + ((rng() * 3) | 0);
        const ry = 1 + ((rng() * 2) | 0);
        for (let dx = -rx; dx <= rx; dx++) {
          for (let dy = 0; dy >= -ry; dy--) {
            const nx = px + dx, ny = fy + dy;
            if (nx < 1 || nx >= ww - 1 || ny < 1 || ny >= hh - 3) continue;
            if (this.tiles[ny * ww + nx] === T.AIR) this.tiles[ny * ww + nx] = T.LAVA;
          }
        }
      }
    }

    // ---- 7) 腐化裂隙(正弦摆动竖井 + 井底空腔 + 祭坛) ----
    {
      const nChasm = 2 + ((rng() * 2) | 0); // 2-3 条
      const altarChasms = 1 + ((rng() * 2) | 0); // 其中 1-2 条带祭坛
      const corrW = Math.max(8, corrX1 - corrX0);
      for (let c = 0; c < nChasm; c++) {
        const seg = corrW / nChasm;
        let cx = Math.round(corrX0 + seg * (c + 0.2) + rng() * seg * 0.6);
        if (cx < corrX0 + 4) cx = corrX0 + 4;
        if (cx > corrX1 - 4) cx = corrX1 - 4;
        const wid = 4 + ((rng() * 3) | 0);      // 4-6 宽
        const depth = 60 + ((rng() * 51) | 0);  // 60-110 深
        const sway = 5 + rng() * 9;
        const swayP = 1.2 + rng() * 1.6;
        const sy = this.surface[cx];
        const hw = wid >> 1;
        const botY = Math.min(hh - 40, sy + depth);
        let lastCx = cx;
        for (let d = 0; d <= botY - sy; d++) {
          const ccx = Math.round(cx + Math.sin((d / depth) * Math.PI * swayP) * sway);
          lastCx = ccx;
          const y = sy + d;
          for (let dx = -hw; dx <= hw; dx++) {
            const nx = ccx + dx;
            if (nx > 0 && nx < ww - 1 && y < hh - 2) this.tiles[y * ww + nx] = T.AIR;
          }
          // 井壁镶 1-2 格黑檀石
          for (let k = 1; k <= 2; k++) {
            for (let side = -1; side <= 1; side += 2) {
              const nx = ccx + side * (hw + k);
              if (nx > 0 && nx < ww - 1 && y < hh - 2 && this.tiles[y * ww + nx] !== T.AIR) {
                this.tiles[y * ww + nx] = T.CORRUPT_STONE;
              }
            }
          }
        }
        // 井底平坦 5x3 空腔 + 恶魔祭坛
        const cavY = Math.min(botY + 3, hh - 6); // 空腔最底行
        for (let dy = -2; dy <= 0; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = lastCx + dx, ny = cavY + dy;
            if (nx > 0 && nx < ww - 1) this.tiles[ny * ww + nx] = T.AIR;
          }
        }
        for (let dx = -2; dx <= 2; dx++) {
          const nx = lastCx + dx;
          if (nx > 0 && nx < ww - 1 && !this.isSolidTile(this.tiles[(cavY + 1) * ww + nx])) {
            this.tiles[(cavY + 1) * ww + nx] = T.CORRUPT_STONE; // 腔底垫平
          }
        }
        if (c < altarChasms) {
          const ax = lastCx - 1, ay = cavY - 1; // 2x2 占 cavY-1, cavY 两行
          this.tiles[ay * ww + ax] = T.ALTAR_TL;
          this.tiles[ay * ww + ax + 1] = T.ALTAR_TR;
          this.tiles[(ay + 1) * ww + ax] = T.ALTAR_BL;
          this.tiles[(ay + 1) * ww + ax + 1] = T.ALTAR_BR;
          this.altarSpawns.push({ x: ax, y: ay });
        }
      }
    }

    // ---- 8) 地表水塘(群系感知) + 洞穴湖 ----
    // 基础 6 个(避开沙漠/出生点) + 丛林专属 6 个(密度翻倍); 雪原池面结冰
    for (let p = 0; p < 12; p++) {
      const forceJungle = p >= 6;
      let cx: number;
      if (forceJungle) {
        cx = jungX0 + 4 + ((rng() * Math.max(1, jungX1 - jungX0 - 8)) | 0);
      } else {
        cx = 30 + ((rng() * (ww - 60)) | 0);
        if (Math.abs(cx - spawnCol) < 34) continue;
      }
      if (this.biome[cx] === BIOME.DESERT) continue; // 沙漠不放水塘
      const rx = 5 + ((rng() * 6) | 0);
      const ry = 2 + ((rng() * 2) | 0);
      const cy = this.surface[cx] + ry;
      const iceLayers = this.biome[cx] === BIOME.SNOW ? 1 + ((rng() * 2) | 0) : 0;
      for (let dx = -rx; dx <= rx; dx++) {
        for (let dy = -ry; dy <= ry; dy++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 1 || nx >= ww - 1 || ny < 1 || ny >= hh - 2) continue;
          if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
            this.tiles[ny * ww + nx] = dy > 0 ? (dy <= iceLayers ? T.ICE : T.WATER) : T.AIR;
          }
        }
        // 封底防止漏到洞穴
        let by = cy + ry;
        while (by < hh - 3 && this.tiles[by * ww + cx + dx] === T.AIR) {
          this.tiles[by * ww + cx + dx] = T.DIRT;
          by++;
        }
      }
    }
    // 洞穴湖(BFS 有界填水)
    {
      const lakeN = Math.max(4, Math.round(10 * oreScale));
      for (let p = 0; p < lakeN; p++) {
        const px = 10 + ((rng() * (ww - 20)) | 0);
        const py = this.dirtLine[px] + 50 + ((rng() * Math.max(1, hh - 90 - this.dirtLine[px])) | 0);
        if (py >= hellY - 6 || this.tiles[py * ww + px] !== T.AIR) continue;
        let ground = -1;
        for (let q = 0; q < 7; q++) {
          if (TileDefs[this.tiles[(py + q) * ww + px]].solid) { ground = py + q - 1; break; }
        }
        if (ground < 0) continue;
        const cap = 100 + ((rng() * 90) | 0);
        const queue: number[] = [ground * ww + px];
        const seen = new Set<number>(queue);
        let filled = 0;
        while (queue.length && filled < cap) {
          const cur = queue.shift()!;
          if (this.tiles[cur] !== T.AIR) continue;
          this.tiles[cur] = T.WATER;
          filled++;
          const cx2 = cur % ww, cy2 = (cur / ww) | 0;
          const push = (nx: number, ny: number) => {
            if (nx < 1 || nx >= ww - 1 || ny < 1 || ny >= hh - 4) return;
            const ni = ny * ww + nx;
            if (!seen.has(ni) && this.tiles[ni] === T.AIR) { seen.add(ni); queue.push(ni); }
          };
          push(cx2, cy2 - 1); push(cx2 - 1, cy2); push(cx2 + 1, cy2);
        }
      }
    }

    // ---- 9) 植被: 树/仙人掌/巨型蘑菇 + 丛林藤蔓 ----
    let tx = 6;
    while (tx < ww - 6) {
      const biStep = this.biome[tx]; // 当前群系决定步距
      let step: number;
      if (biStep === BIOME.DESERT) step = 8 + ((rng() * 11) | 0);        // 仙人掌间距 8-18
      else if (biStep === BIOME.MUSHROOM) step = 6 + ((rng() * 7) | 0);  // 蘑菇间距 6-12
      else if (biStep === BIOME.CORRUPTION) step = 10 + ((rng() * 11) | 0); // 稀疏
      else if (biStep === BIOME.JUNGLE) step = 5 + ((rng() * 8) | 0);
      else step = 4 + ((rng() * 8) | 0);
      tx += step;
      if (tx >= ww - 6) break;
      if (Math.abs(tx - spawnCol) <= 8) continue; // 出生点周围不长树
      const bi = this.biome[tx]; // 落点群系决定植物种类
      const sy = this.surface[tx];
      if (sy < 2 || Math.abs(this.surface[tx - 1] - sy) > 1 || Math.abs(this.surface[tx + 1] - sy) > 1) continue;
      const surf = this.tiles[sy * ww + tx];
      if (bi === BIOME.DESERT) {
        if (surf !== T.SAND) continue;
        const ch = 2 + ((rng() * 4) | 0); // 2-5 高
        let ok = true;
        for (let i = 1; i <= ch; i++) {
          if (this.tiles[(sy - i) * ww + tx] !== T.AIR) { ok = false; break; }
        }
        if (!ok) continue;
        for (let i = 1; i <= ch; i++) this.tiles[(sy - i) * ww + tx] = T.CACTUS;
      } else if (bi === BIOME.MUSHROOM) {
        if (surf !== T.GRASS) continue;
        this.plantMushroom(tx, sy, rng);
      } else {
        const wantSurf = bi === BIOME.CORRUPTION ? T.CORRUPT_GRASS
          : bi === BIOME.JUNGLE ? T.JUNGLE_GRASS
          : bi === BIOME.SNOW ? T.SNOW
          : T.GRASS;
        if (surf !== wantSurf) continue;
        const th = bi === BIOME.CORRUPTION ? 5 + ((rng() * 4) | 0)  // 5-8 矮
          : bi === BIOME.JUNGLE ? 10 + ((rng() * 7) | 0)            // 10-16 大树
          : 7 + ((rng() * 8) | 0);
        const leaf = bi === BIOME.CORRUPTION ? T.LEAF_CORRUPT
          : bi === BIOME.JUNGLE ? T.LEAF_JUNGLE
          : bi === BIOME.SNOW ? T.LEAF_SNOW
          : T.LEAF;
        this.plantTree(tx, sy, th, leaf, bi === BIOME.JUNGLE, rng);
      }
    }
    // 丛林藤蔓: 丛林草/泥下方为空气的边缘 → 10% 垂下 2-6 格
    for (let x = 1; x < ww - 1; x++) {
      if (this.biome[x] !== BIOME.JUNGLE) continue;
      for (let y = this.surface[x], yEnd = hellY - 2; y < yEnd; y++) {
        const id = this.tiles[y * ww + x];
        if ((id === T.JUNGLE_GRASS || id === T.MUD) && this.tiles[(y + 1) * ww + x] === T.AIR) {
          if (rng() < 0.1) {
            const len = 2 + ((rng() * 5) | 0);
            for (let k = 1; k <= len; k++) {
              const ny = y + k;
              if (ny >= hh - 2 || this.tiles[ny * ww + x] !== T.AIR) break;
              this.tiles[ny * ww + x] = T.VINE;
            }
          }
        }
      }
    }

    // ---- 10) 空岛: 椭圆泥土团 + 草皮 + 金矿 + 宝箱 + 小树 ----
    {
      const nIsle = 3 + ((rng() * 4) | 0); // 3-6 个
      let minSurf = hh;
      for (let x = 0; x < ww; x++) if (this.surface[x] < minSurf) minSurf = this.surface[x];
      const zones: [number, number][] = [];
      if (spawnCol - 60 - 12 >= 26) zones.push([12, spawnCol - 60]);
      if (ww - 12 - (spawnCol + 60) >= 26) zones.push([spawnCol + 60, ww - 12]);
      if (!zones.length) zones.push([12, Math.max(26, ww - 12)]);
      const counts = zones.map(() => 0);
      for (let i = 0; i < nIsle; i++) counts[i % zones.length]++;
      for (let zi = 0; zi < zones.length; zi++) {
        const n = counts[zi];
        if (n === 0) continue;
        const z0 = zones[zi][0], z1 = zones[zi][1];
        const slot = (z1 - z0) / n;
        for (let k = 0; k < n; k++) {
          const iw = 12 + ((rng() * 9) | 0);  // 12-20 宽
          const ih = 5 + ((rng() * 4) | 0);   // 5-8 高
          let iy = 22 + ((rng() * 25) | 0);   // 22-46
          const maxBottom = minSurf - 25;     // 必须高于所有地表 25 行
          if (iy + ih > maxBottom) iy = Math.max(6, maxBottom - ih);
          const cx = Math.round(z0 + slot * (k + 0.5) + (rng() - 0.5) * slot * 0.4);
          const rx = iw / 2, ry = ih / 2, cy = iy + ry - 0.5;
          const x0 = Math.max(2, Math.round(cx - rx)), x1 = Math.min(ww - 3, Math.round(cx + rx));
          for (let x = x0; x <= x1; x++) {
            const fx = (x - cx) / rx;
            for (let y = Math.max(1, iy - 1); y <= Math.min(hh - 3, iy + ih); y++) {
              const fy = (y - cy) / ry;
              if (fx * fx + fy * fy <= 1.05) this.tiles[y * ww + x] = T.DIRT;
            }
          }
          // 顶面草皮
          for (let x = x0; x <= x1; x++) {
            for (let y = Math.max(1, iy - 2); y < hh; y++) {
              if (this.tiles[y * ww + x] !== T.AIR) { this.tiles[y * ww + x] = T.GRASS; break; }
            }
          }
          // 内部金矿 3-6
          const nGold = 3 + ((rng() * 4) | 0);
          for (let g = 0; g < nGold; g++) {
            const gx = x0 + ((rng() * (x1 - x0 + 1)) | 0);
            const gy = iy + ((rng() * ih) | 0);
            if (gy < hh && this.tiles[gy * ww + gx] === T.DIRT) this.tiles[gy * ww + gx] = T.ORE_GOLD;
          }
          // 顶上宝箱(主格=TL)
          let chestTop = -1;
          for (let y = 1; y < hh; y++) {
            if (this.tiles[y * ww + cx] !== T.AIR) { chestTop = y; break; }
          }
          if (chestTop > 2) {
            if (!this.placeChest(cx - 1, chestTop - 2, 'island')) this.placeChest(cx, chestTop - 2, 'island');
          }
          // 小树(40%)
          if (rng() < 0.4) {
            const treeX = cx + (rng() < 0.5 ? -1 : 1) * (2 + ((rng() * 3) | 0));
            if (treeX > 2 && treeX < ww - 3) {
              let topY = -1;
              for (let y = 1; y < hh; y++) {
                if (this.tiles[y * ww + treeX] !== T.AIR) { topY = y; break; }
              }
              if (topY > 2 && this.tiles[topY * ww + treeX] === T.GRASS) {
                this.plantTree(treeX, topY, 5 + ((rng() * 3) | 0), T.LEAF, false, rng);
              }
            }
          }
        }
      }
    }

    // ---- 11) 地表装饰(草丛/小花, 仅草地) ----
    for (let x = 2; x < ww - 2; x++) {
      const sy = this.surface[x];
      if (this.tiles[sy * ww + x] === T.GRASS && this.tiles[(sy - 1) * ww + x] === T.AIR) {
        const r = rng();
        if (r < 0.30) this.tiles[(sy - 1) * ww + x] = T.TGRASS;
        else if (r < 0.345) {
          const f = [T.FLW_R, T.FLW_Y, T.FLW_B][(rng() * 3) | 0];
          this.tiles[(sy - 1) * ww + x] = f;
        }
      }
    }

    // ---- 12) 生命水晶: 洞穴底(上方空气 + 下方实心), 避开水/岩浆 ----
    {
      const want = 12 + ((rng() * 7) | 0); // 12-18
      let placed = 0, tries = 0;
      while (placed < want && tries < want * 80) {
        tries++;
        const x = 4 + ((rng() * (ww - 8)) | 0);
        const y0 = this.dirtLine[x] + 35, y1 = hh - 50;
        if (y1 <= y0) continue;
        const y = y0 + ((rng() * (y1 - y0)) | 0);
        if (y >= hellY - 4) continue;
        if (this.tiles[y * ww + x] !== T.AIR) continue;
        if (this.tiles[(y - 1) * ww + x] !== T.AIR) continue;
        if (!this.isSolidTile(this.tiles[(y + 1) * ww + x])) continue;
        if (this.tiles[y * ww + x - 1] === T.WATER || this.tiles[y * ww + x + 1] === T.WATER
          || this.tiles[y * ww + x - 1] === T.LAVA || this.tiles[y * ww + x + 1] === T.LAVA) continue;
        this.tiles[y * ww + x] = T.LIFE_CRYSTAL;
        placed++;
      }
    }

    // ---- 13) 宝箱: 地表 5-8 / 洞穴+深层 18-26 / 地狱 3-5 ----
    {
      // 地表(找平地, 避开出生点)
      const wantS = 5 + ((rng() * 4) | 0);
      let placed = 0, tries = 0;
      while (placed < wantS && tries < wantS * 40) {
        tries++;
        const x = 6 + ((rng() * (ww - 14)) | 0);
        if (Math.abs(x - spawnCol) <= 8) continue;
        const sy = this.surface[x];
        if (Math.abs(this.surface[x + 1] - sy) > 1) continue;
        if (this.placeChest(x, sy - 2, 'surface')) placed++;
      }
      // 洞穴/深层(dirtLine+50 分界)
      const wantC = 18 + ((rng() * 9) | 0);
      placed = 0; tries = 0;
      while (placed < wantC && tries < wantC * 80) {
        tries++;
        const x = 4 + ((rng() * (ww - 10)) | 0);
        const y0 = this.dirtLine[x] + 12, y1 = hh - 58;
        if (y1 <= y0) continue;
        const y = y0 + ((rng() * (y1 - y0)) | 0);
        if (y >= hellY - 8) continue;
        const tier: ChestSpawn['tier'] = y < this.dirtLine[x] + 50 ? 'cave' : 'deep';
        if (this.placeChest(x, y, tier)) placed++;
      }
      // 地狱
      const wantH = 3 + ((rng() * 3) | 0);
      placed = 0; tries = 0;
      while (placed < wantH && tries < wantH * 80) {
        tries++;
        const x = 4 + ((rng() * (ww - 10)) | 0);
        const y0 = hellY + 4, y1 = hh - 18;
        if (y1 <= y0) continue;
        const y = y0 + ((rng() * (y1 - y0)) | 0);
        if (this.placeChest(x, y, 'hell')) placed++;
      }
    }

    // ---- 14) 深层洞穴恶魔祭坛 4-6 ----
    {
      const want = 4 + ((rng() * 3) | 0);
      let placed = 0, tries = 0;
      while (placed < want && tries < want * 100) {
        tries++;
        const x = 4 + ((rng() * (ww - 10)) | 0);
        const y0 = this.dirtLine[x] + 60, y1 = hellY - 12;
        if (y1 <= y0) continue;
        const y = y0 + ((rng() * (y1 - y0)) | 0);
        if (this.placeAltar(x, y)) placed++;
      }
    }

    // ---- 15) 出生点整平(±6 列无裂隙/无树/无装饰) ----
    {
      const sy0 = this.surface[spawnCol];
      for (let dx = -6; dx <= 6; dx++) {
        const x = spawnCol + dx;
        if (x < 1 || x >= ww - 1) continue;
        for (let y = Math.max(1, sy0 - 24); y < sy0; y++) this.tiles[y * ww + x] = T.AIR;
        for (let y = sy0; y < this.dirtLine[x]; y++) this.tiles[y * ww + x] = T.DIRT;
        this.tiles[sy0 * ww + x] = T.GRASS;
        this.surface[x] = sy0;
      }
      this.spawnX = spawnCol * 16 + 8;
      this.spawnY = (sy0 - 3) * 16;
    }

    // ---- 16) 背景墙(地表上无墙; 地狱用 W_STONE) ----
    for (let x = 0; x < ww; x++) {
      const sy = this.surface[x], dy = this.dirtLine[x];
      for (let y = 0; y < Math.min(sy + 4, hh); y++) this.walls[y * ww + x] = W_NONE;
      for (let y = sy + 4; y < hh; y++) {
        this.walls[y * ww + x] = y < dy + 4 ? W_DIRT : W_STONE;
      }
    }

    // ---- 17) skyTop 与液体激活(仅激活可流动的) ----
    for (let x = 0; x < ww; x++) this.updateSkyColumn(x);
    this.waterActive.clear();
    this.lavaActive.clear();
    for (let y = 1; y < hh - 1; y++) {
      for (let x = 1; x < ww - 1; x++) {
        const id = this.tiles[y * ww + x];
        if (id !== T.WATER && id !== T.LAVA) continue;
        if (this.tiles[(y + 1) * ww + x] === T.AIR
          || this.tiles[y * ww + x - 1] === T.AIR || this.tiles[y * ww + x + 1] === T.AIR) {
          if (id === T.WATER) this.waterActive.add(y * ww + x);
          else this.lavaActive.add(y * ww + x);
        }
      }
    }
  }

  // ==================== 生成辅助 ====================

  /** 种一棵树(big=true 为丛林大树冠) */
  private plantTree(x: number, sy: number, th: number, leaf: number, big: boolean, rng: () => number): void {
    for (let i = 1; i <= th; i++) {
      if (this.get(x, sy - i) !== T.AIR) return;
    }
    for (let i = 1; i <= th; i++) this.tiles[(sy - i) * this.w + x] = T.TRUNK;
    const topY = sy - th;
    if (big) {
      // 丛林树冠: 半径 3
      const radii = [1, 2, 3, 3, 3, 2, 1]; // dy=-5..1
      for (let dy = -5; dy <= 1; dy++) {
        const r = radii[dy + 5];
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) === r && rng() < 0.25) continue;
          const nx = x + dx, ny = topY + dy;
          if (nx >= 1 && nx < this.w - 1 && ny >= 1 && this.tiles[ny * this.w + nx] === T.AIR) {
            this.tiles[ny * this.w + nx] = leaf;
          }
        }
      }
    } else {
      const radii = [1, 2, 2, 1, 1]; // dy=-2..1
      for (let dy = -3; dy <= 1; dy++) {
        const r = dy === -3 ? 1 : radii[dy + 3];
        for (let dx = -r; dx <= r; dx++) {
          if (dy === -3 && Math.abs(dx) === r) continue;
          if (Math.abs(dx) === r && rng() < 0.25) continue;
          const nx = x + dx, ny = topY + dy;
          if (nx >= 1 && nx < this.w - 1 && ny >= 1 && this.tiles[ny * this.w + nx] === T.AIR) {
            this.tiles[ny * this.w + nx] = leaf;
          }
        }
      }
    }
  }

  /** 巨型发光蘑菇: 柄 6-12 + 椭圆伞盖(宽 3-5 / 厚 2-3, 中心对齐柄顶) */
  private plantMushroom(x: number, sy: number, rng: () => number): void {
    const stemH = 6 + ((rng() * 7) | 0);
    for (let i = 1; i <= stemH; i++) {
      if (this.get(x, sy - i) !== T.AIR) return;
    }
    for (let i = 1; i <= stemH; i++) this.tiles[(sy - i) * this.w + x] = T.MUSH_STEM;
    const capW = 3 + 2 * ((rng() * 2) | 0); // 3 或 5
    const capT = 2 + ((rng() * 2) | 0);     // 2-3
    const hw = capW >> 1;
    const topY = sy - stemH; // 最高一节柄
    for (let dy = 0; dy < capT; dy++) {
      const inset = capT >= 3 && (dy === 0 || dy === capT - 1) ? 1 : 0;
      for (let dx = -(hw - inset); dx <= hw - inset; dx++) {
        const nx = x + dx, ny = topY - 1 - dy;
        if (nx >= 1 && nx < this.w - 1 && ny >= 1 && this.tiles[ny * this.w + nx] === T.AIR) {
          this.tiles[ny * this.w + nx] = T.MUSH_CAP;
        }
      }
    }
  }

  /** (x,y)=TL 的 2x2 是否可放家具(允许覆盖地表装饰), 且 BL/BR 下方为实心 */
  private canPlaceBox2x2(x: number, y: number, allowDeco: boolean): boolean {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const id = this.get(x + dx, y + dy);
        if (id === T.AIR) continue;
        if (allowDeco && (id === T.TGRASS || (id >= T.FLW_R && id <= T.FLW_B))) continue;
        return false;
      }
    }
    return this.isSolid(x, y + 2) && this.isSolid(x + 1, y + 2);
  }

  /** 放置 2x2 宝箱(主格=TL), 成功则记录 chestSpawns */
  private placeChest(x: number, y: number, tier: ChestSpawn['tier']): boolean {
    if (x < 1 || x + 1 >= this.w - 1 || y < 1 || y + 2 >= this.h) return false;
    if (!this.canPlaceBox2x2(x, y, true)) return false;
    const w = this.w;
    this.tiles[y * w + x] = T.CHEST_TL;
    this.tiles[y * w + x + 1] = T.CHEST_TR;
    this.tiles[(y + 1) * w + x] = T.CHEST_BL;
    this.tiles[(y + 1) * w + x + 1] = T.CHEST_BR;
    this.chestSpawns.push({ x, y, tier });
    return true;
  }

  /** 放置 2x2 恶魔祭坛(主格=TL), 成功则记录 altarSpawns */
  private placeAltar(x: number, y: number): boolean {
    if (x < 1 || x + 1 >= this.w - 1 || y < 1 || y + 2 >= this.h) return false;
    if (!this.canPlaceBox2x2(x, y, false)) return false;
    const w = this.w;
    this.tiles[y * w + x] = T.ALTAR_TL;
    this.tiles[y * w + x + 1] = T.ALTAR_TR;
    this.tiles[(y + 1) * w + x] = T.ALTAR_BL;
    this.tiles[(y + 1) * w + x + 1] = T.ALTAR_BR;
    this.altarSpawns.push({ x, y });
    return true;
  }

  /** x 列是否在腐化群系 ±12 列范围内(限制腐化草蔓延) */
  private nearCorruption(x: number): boolean {
    const lo = Math.max(0, x - 12), hi = Math.min(this.w - 1, x + 12);
    for (let i = lo; i <= hi; i++) {
      if (this.biome[i] === BIOME.CORRUPTION) return true;
    }
    return false;
  }

  // ==================== 液体模拟(水 + 岩浆 + 黑曜石) ====================
  tickWater(budget = 420): void {
    // --- 水: 每次调用处理 ---
    if (this.waterActive.size) {
      let ops = 0;
      const list = Array.from(this.waterActive);
      for (const idx of list) {
        if (ops >= budget) break;
        if (this.tiles[idx] !== T.WATER) { this.waterActive.delete(idx); continue; }
        const x = idx % this.w, y = (idx / this.w) | 0;
        // 1. 直落
        if (this.get(x, y + 1) === T.AIR) { this.swapLiquid(idx, idx + this.w, T.WATER); ops++; continue; }
        // 2. 斜落
        const d = Math.random() < 0.5 ? 1 : -1;
        if (this.get(x + d, y) === T.AIR && this.get(x + d, y + 1) === T.AIR) {
          this.swapLiquid(idx, idx + d + this.w, T.WATER); ops++; continue;
        }
        if (this.get(x - d, y) === T.AIR && this.get(x - d, y + 1) === T.AIR) {
          this.swapLiquid(idx, idx - d + this.w, T.WATER); ops++; continue;
        }
        // 3. 无法流动 → 静息
        this.waterActive.delete(idx);
      }
    }
    // --- 水火相遇 → 黑曜石(岩浆格变 OBSIDIAN, 水格蒸发) ---
    this.fuseObsidian();
    // --- 岩浆: 每 3 次调用处理一轮(流速慢), 规则同水 ---
    this.lavaPhase = (this.lavaPhase + 1) % 3;
    if (this.lavaPhase === 0 && this.lavaActive.size) {
      let ops = 0;
      const list = Array.from(this.lavaActive);
      for (const idx of list) {
        if (ops >= budget) break;
        if (this.tiles[idx] !== T.LAVA) { this.lavaActive.delete(idx); continue; }
        const x = idx % this.w, y = (idx / this.w) | 0;
        if (this.get(x, y + 1) === T.AIR) { this.swapLiquid(idx, idx + this.w, T.LAVA); ops++; continue; }
        const d = Math.random() < 0.5 ? 1 : -1;
        if (this.get(x + d, y) === T.AIR && this.get(x + d, y + 1) === T.AIR) {
          this.swapLiquid(idx, idx + d + this.w, T.LAVA); ops++; continue;
        }
        if (this.get(x - d, y) === T.AIR && this.get(x - d, y + 1) === T.AIR) {
          this.swapLiquid(idx, idx - d + this.w, T.LAVA); ops++; continue;
        }
        this.lavaActive.delete(idx);
      }
    }
  }

  private swapLiquid(a: number, b: number, id: number): void {
    this.tiles[a] = T.AIR;
    this.tiles[b] = id;
    const w = this.w;
    const ax = a % w, ay = (a / w) | 0;
    const bx = b % w, by = (b / w) | 0;
    this.activateAround(ax, ay);
    this.activateAround(bx, by);
    if (id === T.WATER) this.waterActive.add(b);
    else this.lavaActive.add(b);
    if (this.onTileChanged) {
      this.onTileChanged(ax, ay, T.AIR);
      this.onTileChanged(bx, by, id);
    }
  }

  /** 相遇的活跃水/岩浆 → 黑曜石 + 空气 */
  private fuseObsidian(): void {
    const w = this.w;
    if (this.waterActive.size) {
      const list = Array.from(this.waterActive);
      for (const idx of list) {
        if (this.tiles[idx] !== T.WATER) continue;
        const x = idx % w, y = (idx / w) | 0;
        if (this.get(x - 1, y) === T.LAVA) { this.fusePair(x - 1, y, x, y); continue; }
        if (this.get(x + 1, y) === T.LAVA) { this.fusePair(x + 1, y, x, y); continue; }
        if (this.get(x, y - 1) === T.LAVA) { this.fusePair(x, y - 1, x, y); continue; }
        if (this.get(x, y + 1) === T.LAVA) { this.fusePair(x, y + 1, x, y); continue; }
      }
    }
    if (this.lavaActive.size) {
      const list = Array.from(this.lavaActive);
      for (const idx of list) {
        if (this.tiles[idx] !== T.LAVA) continue;
        const x = idx % w, y = (idx / w) | 0;
        if (this.get(x - 1, y) === T.WATER) { this.fusePair(x, y, x - 1, y); continue; }
        if (this.get(x + 1, y) === T.WATER) { this.fusePair(x, y, x + 1, y); continue; }
        if (this.get(x, y - 1) === T.WATER) { this.fusePair(x, y, x, y - 1); continue; }
        if (this.get(x, y + 1) === T.WATER) { this.fusePair(x, y, x, y + 1); continue; }
      }
    }
  }

  /** 岩浆格(lx,ly)→OBSIDIAN, 水格(wx,wy)→AIR */
  private fusePair(lx: number, ly: number, wx: number, wy: number): void {
    this.set(lx, ly, T.OBSIDIAN);
    this.set(wx, wy, T.AIR);
    this.waterActive.delete(wy * this.w + wx);
    this.lavaActive.delete(ly * this.w + lx);
  }

  // ==================== 草蔓延 ====================
  tickGrass(count = 22): void {
    const w = this.w, h = this.h;
    for (let i = 0; i < count; i++) {
      const x = 1 + ((Math.random() * (w - 2)) | 0);
      const y = 1 + ((Math.random() * (h - 2)) | 0);
      const id = this.tiles[y * w + x];
      if (id === T.GRASS) {
        // 被盖住 → 退化为泥土
        if (this.isSolidTile(this.get(x, y - 1)) && Math.random() < 0.5) this.set(x, y, T.DIRT);
      } else if (id === T.JUNGLE_GRASS) {
        // 被盖住 → 退化为泥
        if (this.isSolidTile(this.get(x, y - 1)) && Math.random() < 0.5) this.set(x, y, T.MUD);
      } else if (id === T.CORRUPT_GRASS) {
        // 被盖住 → 退化为泥土
        if (this.isSolidTile(this.get(x, y - 1)) && Math.random() < 0.5) this.set(x, y, T.DIRT);
      } else if (id === T.MUD) {
        // 丛林草蔓延: 8 邻域有丛林草 + 顶面空气
        if (this.get(x, y - 1) === T.AIR) {
          let jg = false;
          for (let dy = -1; dy <= 1 && !jg; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (this.get(x + dx, y + dy) === T.JUNGLE_GRASS) { jg = true; break; }
            }
          }
          if (jg) this.set(x, y, T.JUNGLE_GRASS);
        }
      } else if (id === T.DIRT && y < this.dirtLine[x] + 6) {
        if (this.get(x, y - 1) === T.AIR) {
          let grassNear = false, corruptNear = false;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const n = this.get(x + dx, y + dy);
              if (n === T.GRASS) grassNear = true;
              else if (n === T.CORRUPT_GRASS) corruptNear = true;
            }
          }
          if (corruptNear && this.nearCorruption(x)) {
            // 腐化草只在腐化群系 ±12 列内蔓延
            this.set(x, y, T.CORRUPT_GRASS);
          } else if (grassNear) {
            this.set(x, y, T.GRASS);
            if (Math.random() < 0.22 && this.get(x, y - 1) === T.AIR) {
              this.set(x, y - 1, T.TGRASS);
            }
          }
        }
      }
    }
  }

  // ==================== 砍树 ====================
  /** 砍断(x,y)处的树干，返回被清除的格子(清理所有类型树冠) */
  fellTree(x: number, y: number): Cell[] {
    const cells: Cell[] = [];
    let ty = y;
    while (this.get(x, ty) === T.TRUNK) {
      cells.push({ x, y: ty, trunk: true });
      ty--;
    }
    const topY = ty + 1;
    // 清理顶部周围所有树冠类型(含丛林大树冠, 窗口下沿多留一行)
    for (let dy = -5; dy <= 2; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const id = this.get(x + dx, topY + dy);
        if (id === T.LEAF || id === T.LEAF_SNOW || id === T.LEAF_JUNGLE || id === T.LEAF_CORRUPT) {
          cells.push({ x: x + dx, y: topY + dy, trunk: false });
        }
      }
    }
    for (const c of cells) this.set(c.x, c.y, T.AIR);
    return cells;
  }

  /** 清除多格家具(组)，返回格子列表 */
  clearFurniture(x: number, y: number): Cell[] {
    const id = this.get(x, y);
    const group = TileDefs[id].furnitureGroup;
    if (!group) return [{ x, y, trunk: false }];
    const cells: Cell[] = [];
    const stack: [number, number][] = [[x, y]];
    const seen = new Set<number>([this.idx(x, y)]);
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (TileDefs[this.get(cx, cy)].furnitureGroup !== group) continue;
      cells.push({ x: cx, y: cy, trunk: false });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const nx = cx + dx, ny = cy + dy;
        const ni = this.idx(nx, ny);
        if (nx < 0 || nx >= this.w || ny < 0 || ny >= this.h || seen.has(ni)) continue;
        if (TileDefs[this.get(nx, ny)].furnitureGroup === group) {
          seen.add(ni);
          stack.push([nx, ny]);
        }
      }
    }
    for (const c of cells) this.set(c.x, c.y, T.AIR);
    return cells;
  }

  // ==================== 存档 ====================
  encode(): string {
    return JSON.stringify({
      v: 1,
      seed: this.seed,
      w: this.w,
      h: this.h,
      spawnX: this.spawnX,
      spawnY: this.spawnY,
      surface: Array.from(this.surface),
      dirtLine: Array.from(this.dirtLine),
      biome: Array.from(this.biome),
      hellY: this.hellY,
      chestSpawns: this.chestSpawns,
      altarSpawns: this.altarSpawns,
      tiles: rleEncode(this.tiles),
      walls: rleEncode(this.walls),
    });
  }

  static decode(json: string): World {
    const o = JSON.parse(json) as {
      v: number; seed: number; w: number; h: number; spawnX: number; spawnY: number;
      surface: number[]; dirtLine: number[]; tiles: string; walls: string;
      biome?: number[]; hellY?: number; chestSpawns?: ChestSpawn[]; altarSpawns?: { x: number; y: number }[];
    };
    if (o.v !== 1) throw new Error('存档版本不匹配');
    const wd = new World(undefined, o.w, o.h);
    wd.seed = o.seed;
    wd.spawnX = o.spawnX; wd.spawnY = o.spawnY;
    wd.surface = Int16Array.from(o.surface);
    wd.dirtLine = Int16Array.from(o.dirtLine);
    // 新字段缺省容忍(旧档: 全森林/无宝箱)
    wd.biome = o.biome && o.biome.length === o.w ? Uint8Array.from(o.biome) : new Uint8Array(o.w);
    wd.hellY = o.hellY ?? Math.max(20, o.h - HELL_DEPTH);
    wd.chestSpawns = o.chestSpawns ?? [];
    wd.altarSpawns = o.altarSpawns ?? [];
    wd.tiles = rleDecode(o.tiles, o.w * o.h);
    wd.walls = rleDecode(o.walls, o.w * o.h);
    for (let x = 0; x < wd.w; x++) wd.updateSkyColumn(x);
    wd.waterActive.clear();
    wd.lavaActive.clear();
    for (let y = 1; y < wd.h - 1; y++) {
      for (let x = 1; x < wd.w - 1; x++) {
        const id = wd.tiles[y * wd.w + x];
        if (id === T.WATER || id === T.LAVA) wd.activateAround(x, y);
      }
    }
    return wd;
  }
}

// ==================== RLE ====================
function rleEncode(arr: Uint8Array): string {
  const out: number[] = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v && n < 65535) n++;
    out.push(n & 255, (n >> 8) & 255, v);
    i += n;
  }
  let s = '';
  const CH = 4096;
  for (let j = 0; j < out.length; j += CH) {
    const end = Math.min(j + CH, out.length);
    s += String.fromCharCode(...out.slice(j, end));
  }
  return btoa(s);
}

function rleDecode(b64: string, len: number): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const arr = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < s.length; i += 3) {
    const n = s.charCodeAt(i) | (s.charCodeAt(i + 1) << 8);
    const v = s.charCodeAt(i + 2);
    arr.fill(v, p, p + n);
    p += n;
  }
  return arr;
}

export { W_DIRT, W_STONE };
