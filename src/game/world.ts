/**
 * 世界：生成 / 访问 / 水模拟 / 草蔓延 / 砍树 / RLE 存档
 */

import { T, W_NONE, W_DIRT, W_STONE, WORLD_W, WORLD_H, TileDefs } from './constants';
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

  constructor(seed?: number) {
    if (seed !== undefined) this.generate(seed);
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

  activateAround(x: number, y: number): void {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.get(x + dx, y + dy) === T.WATER) this.waterActive.add(this.idx(x + dx, y + dy));
      }
    }
  }

  // ==================== 世界生成 ====================
  generate(seed: number): void {
    this.seed = seed;
    const rng = mulberry32(seed);
    const w = this.w, h = this.h;
    const s1 = (seed ^ 0x1f2e3d) & 0xffff, s2 = (seed * 7 + 11) & 0xffff;
    const s3 = (seed * 13 + 29) & 0xffff, s4 = (seed * 17 + 71) & 0xffff;
    const s5 = (seed * 23 + 113) & 0xffff, s6 = (seed * 31 + 211) & 0xffff;
    const s7 = (seed * 43 + 307) & 0xffff, s8 = (seed * 59 + 401) & 0xffff;

    // 1) 地表高度 & 泥土层
    for (let x = 0; x < w; x++) {
      const n = (vnoise1(x / 26, s1) * 2 - 1) * 24
        + (vnoise1(x / 9, s2) * 2 - 1) * 10
        + (vnoise1(x / 4.2, s3) * 2 - 1) * 4;
      const edge = Math.min(x, w - 1 - x);
      const damp = edge < 28 ? smoothstep(edge / 28) : 1;
      this.surface[x] = Math.round(96 + n * damp);
      this.dirtLine[x] = this.surface[x] + 15 + Math.round((vnoise1(x / 13, s4) * 2 - 1) * 7);
    }

    // 2) 基础柱状填充 + 黏土/ dirt夹层
    for (let x = 0; x < w; x++) {
      const sy = this.surface[x], dy = this.dirtLine[x];
      for (let y = 0; y < h; y++) {
        const i = y * w + x;
        let id: number = T.AIR;
        if (y === sy) id = T.GRASS;
        else if (y > sy && y < dy) {
          id = T.DIRT;
          if (vnoise2(x / 12, y / 9, s5) > 0.68) id = T.CLAY;
        } else if (y >= dy) {
          id = T.STONE;
          if (y < dy + 16 && vnoise2(x / 9 + 40, y / 7 + 40, s6) > 0.68) id = T.DIRT;
        }
        this.tiles[i] = id;
      }
    }

    // 3) 洞穴
    for (let x = 0; x < w; x++) {
      const sy = this.surface[x], dy = this.dirtLine[x];
      for (let y = sy + 7; y < h; y++) {
        const blob = vnoise2(x / 8.5, y / 6.2, s7);
        const worm = vnoise2(x / 30 + 99, y / 20 + 7, s8);
        const depth = Math.min(1, Math.max(0, (y - dy) / (h - dy)));
        const isCave = blob > 0.625 || Math.abs(worm - 0.5) < 0.03 + depth * 0.022;
        if (isCave) this.tiles[y * w + x] = T.AIR;
      }
    }

    // 4) 矿脉
    const vein = (count: number, y0: number, y1: number, ore: number) => {
      for (let v = 0; v < count; v++) {
        let x = 2 + ((rng() * (w - 4)) | 0);
        let y = y0 + ((rng() * (y1 - y0)) | 0);
        const len = 5 + ((rng() * 9) | 0);
        for (let s = 0; s < len; s++) {
          if (x > 1 && x < w - 1 && y > 1 && y < h - 4 && this.tiles[y * w + x] === T.STONE) {
            this.tiles[y * w + x] = ore;
          }
          x += (rng() * 3 | 0) - 1;
          y += (rng() * 3 | 0) - 1;
        }
      }
    };
    vein(240, 104, 175, T.ORE_COPPER);
    vein(190, 145, 260, T.ORE_IRON);
    vein(140, 205, 320, T.ORE_SILVER);
    vein(110, 255, h - 40, T.ORE_GOLD);

    // 5) 地表水塘
    const mid = w >> 1;
    for (let p = 0; p < 6; p++) {
      const cx = 30 + ((rng() * (w - 60)) | 0);
      if (Math.abs(cx - mid) < 34) continue;
      const rx = 5 + ((rng() * 6) | 0);
      const ry = 2 + ((rng() * 2) | 0);
      const cy = this.surface[cx] + ry;
      for (let dx = -rx; dx <= rx; dx++) {
        for (let dy = -ry; dy <= ry; dy++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 1 || nx >= w - 1 || ny < 1 || ny >= h - 2) continue;
          if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
            this.tiles[ny * w + nx] = dy > 0 ? T.WATER : T.AIR;
          }
        }
        // 封底防止漏到洞穴
        let by = cy + ry;
        while (by < h - 3 && this.tiles[by * w + cx + dx] === T.AIR) {
          this.tiles[by * w + cx + dx] = T.DIRT;
          by++;
        }
      }
    }

    // 6) 洞穴湖
    for (let p = 0; p < 10; p++) {
      const px = 10 + ((rng() * (w - 20)) | 0);
      const py = this.dirtLine[px] + 50 + ((rng() * (h - 90 - this.dirtLine[px])) | 0);
      if (py >= h - 6 || this.tiles[py * w + px] !== T.AIR) continue;
      let ground = -1;
      for (let q = 0; q < 7; q++) {
        if (TileDefs[this.tiles[(py + q) * w + px]].solid) { ground = py + q - 1; break; }
      }
      if (ground < 0) continue;
      // BFS 填水(有界)
      const cap = 100 + ((rng() * 90) | 0);
      const queue: number[] = [ground * w + px];
      const seen = new Set<number>(queue);
      let filled = 0;
      while (queue.length && filled < cap) {
        const cur = queue.shift()!;
        if (this.tiles[cur] !== T.AIR) continue;
        this.tiles[cur] = T.WATER;
        filled++;
        const cx2 = cur % w, cy2 = (cur / w) | 0;
        const push = (nx: number, ny: number) => {
          if (nx < 1 || nx >= w - 1 || ny < 1 || ny >= h - 4) return;
          const ni = ny * w + nx;
          if (!seen.has(ni) && this.tiles[ni] === T.AIR) { seen.add(ni); queue.push(ni); }
        };
        push(cx2, cy2 - 1); push(cx2 - 1, cy2); push(cx2 + 1, cy2);
      }
    }

    // 7) 树
    let tx = 6;
    while (tx < w - 6) {
      tx += 4 + ((rng() * 8) | 0);
      if (tx >= w - 6) break;
      const sy = this.surface[tx];
      if (this.tiles[sy * w + tx] !== T.GRASS) continue;
      if (Math.abs(this.surface[tx - 1] - sy) > 1 || Math.abs(this.surface[tx + 1] - sy) > 1) continue;
      const th = 7 + ((rng() * 8) | 0);
      let ok = true;
      for (let i = 1; i <= th; i++) {
        if (this.tiles[(sy - i) * w + tx] !== T.AIR) { ok = false; break; }
      }
      if (!ok) continue;
      for (let i = 1; i <= th; i++) this.tiles[(sy - i) * w + tx] = T.TRUNK;
      const topY = sy - th;
      const radii = [1, 2, 2, 1, 1];
      for (let dy = -3; dy <= 1; dy++) {
        const r = dy === -3 ? 1 : radii[dy + 3];
        for (let dx = -r; dx <= r; dx++) {
          if (dy === -3 && Math.abs(dx) === r) continue;
          if (Math.abs(dx) === r && rng() < 0.25) continue;
          const nx = tx + dx, ny = topY + dy;
          if (nx < 1 || nx >= w - 1 || ny < 1) continue;
          if (this.tiles[ny * w + nx] === T.AIR) this.tiles[ny * w + nx] = T.LEAF;
        }
      }
    }

    // 8) 地表装饰
    for (let x = 2; x < w - 2; x++) {
      const sy = this.surface[x];
      if (this.tiles[sy * w + x] === T.GRASS && this.tiles[(sy - 1) * w + x] === T.AIR) {
        const r = rng();
        if (r < 0.30) this.tiles[(sy - 1) * w + x] = T.TGRASS;
        else if (r < 0.345) {
          const f = [T.FLW_R, T.FLW_Y, T.FLW_B][(rng() * 3) | 0];
          this.tiles[(sy - 1) * w + x] = f;
        }
      }
    }

    // 9) 背景墙
    for (let x = 0; x < w; x++) {
      const sy = this.surface[x], dy = this.dirtLine[x];
      for (let y = sy + 4; y < h; y++) {
        this.walls[y * w + x] = y < dy + 4 ? W_DIRT : W_STONE;
      }
    }

    // 10) 基岩
    for (let x = 0; x < w; x++) {
      for (let y = h - 3; y < h; y++) this.tiles[y * w + x] = T.STONE;
    }

    // 11) 出生点
    const sx = mid;
    this.spawnX = sx * 16 + 8;
    this.spawnY = (this.surface[sx] - 3) * 16;
    for (let dx = -3; dx <= 3; dx++) {
      const nx = sx + dx;
      const above = this.surface[nx] - 1;
      const id = this.tiles[above * w + nx];
      if (id === T.TGRASS || (id >= T.FLW_R && id <= T.FLW_B)) this.tiles[above * w + nx] = T.AIR;
    }

    // 12) skyTop 与水体激活
    for (let x = 0; x < w; x++) this.updateSkyColumn(x);
    this.waterActive.clear();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (this.tiles[y * w + x] === T.WATER) {
          if (this.tiles[(y + 1) * w + x] === T.AIR
            || this.tiles[y * w + x - 1] === T.AIR || this.tiles[y * w + x + 1] === T.AIR) {
            this.waterActive.add(y * w + x);
          }
        }
      }
    }
  }

  // ==================== 水模拟 ====================
  tickWater(budget = 420): void {
    if (this.waterActive.size === 0) return;
    let ops = 0;
    const w = this.w;
    const list = Array.from(this.waterActive);
    for (const idx of list) {
      if (ops >= budget) break;
      if (this.tiles[idx] !== T.WATER) { this.waterActive.delete(idx); continue; }
      const x = idx % w, y = (idx / w) | 0;
      // 1. 直落
      if (this.get(x, y + 1) === T.AIR) { this.swapWater(idx, idx + w); ops++; continue; }
      // 2. 斜落
      const d = Math.random() < 0.5 ? 1 : -1;
      if (this.get(x + d, y) === T.AIR && this.get(x + d, y + 1) === T.AIR) {
        this.swapWater(idx, idx + d + w); ops++; continue;
      }
      if (this.get(x - d, y) === T.AIR && this.get(x - d, y + 1) === T.AIR) {
        this.swapWater(idx, idx - d + w); ops++; continue;
      }
      // 3. 无法流动 → 静息
      this.waterActive.delete(idx);
    }
  }

  private swapWater(a: number, b: number): void {
    this.tiles[a] = T.AIR;
    this.tiles[b] = T.WATER;
    const w = this.w;
    const ax = a % w, ay = (a / w) | 0;
    const bx = b % w, by = (b / w) | 0;
    this.activateAround(ax, ay);
    this.activateAround(bx, by);
    this.waterActive.add(b);
    if (this.onTileChanged) {
      this.onTileChanged(ax, ay, T.AIR);
      this.onTileChanged(bx, by, T.WATER);
    }
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
      } else if (id === T.DIRT && y < this.dirtLine[x] + 6) {
        if (this.get(x, y - 1) === T.AIR) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (this.get(x + dx, y + dy) === T.GRASS) {
                this.set(x, y, T.GRASS);
                if (Math.random() < 0.22 && this.get(x, y - 1) === T.AIR) {
                  this.set(x, y - 1, T.TGRASS);
                }
                dy = 2; break;
              }
            }
          }
        }
      }
    }
  }

  // ==================== 砍树 ====================
  /** 砍断(x,y)处的树干，返回被清除的格子 */
  fellTree(x: number, y: number): Cell[] {
    const cells: Cell[] = [];
    let ty = y;
    while (this.get(x, ty) === T.TRUNK) {
      cells.push({ x, y: ty, trunk: true });
      ty--;
    }
    const topY = ty + 1;
    for (let dy = -3; dy <= 2; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (this.get(x + dx, topY + dy) === T.LEAF) {
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
      tiles: rleEncode(this.tiles),
      walls: rleEncode(this.walls),
    });
  }

  static decode(json: string): World {
    const o = JSON.parse(json) as {
      v: number; seed: number; w: number; h: number; spawnX: number; spawnY: number;
      surface: number[]; dirtLine: number[]; tiles: string; walls: string;
    };
    if (o.v !== 1) throw new Error('存档版本不匹配');
    const wd = new World();
    wd.seed = o.seed;
    wd.w = o.w; wd.h = o.h;
    wd.spawnX = o.spawnX; wd.spawnY = o.spawnY;
    wd.surface = Int16Array.from(o.surface);
    wd.dirtLine = Int16Array.from(o.dirtLine);
    wd.tiles = rleDecode(o.tiles, o.w * o.h);
    wd.walls = rleDecode(o.walls, o.w * o.h);
    for (let x = 0; x < wd.w; x++) wd.updateSkyColumn(x);
    wd.waterActive.clear();
    for (let y = 1; y < wd.h - 1; y++) {
      for (let x = 1; x < wd.w - 1; x++) {
        if (wd.tiles[y * wd.w + x] === T.WATER) wd.activateAround(x, y);
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
