/**
 * 世界渲染管线：天空 -> 墙/瓦片(含液体/家具/发光块) -> 掉落物 -> 敌怪/NPC/玩家 -> 粒子/投射物
 *            -> 光照罩 -> 光晕 -> 伤害数字/血条 -> 光标高亮 -> 屏幕特效 -> 小地图 -> 全屏地图
 */

import { T, TileDefs, ItemDefs, IT, ARMOR_COLORS, BIOME_NAMES, ENEMY_DEFS } from './constants';
import { drawSkyBackground } from './sky';
import {
  drawHumanoid, drawSlime, drawEye, drawBat, drawEos, drawEoC, drawArrow, drawBomb,
  PLAYER_PALETTE, ZOMBIE_PALETTE, GUIDE_PALETTE, SKELETON_PALETTE,
  SLIME_GREEN, SLIME_BLUE, LAVA_SLIME,
} from './sprites';
import type { ExtraLight } from './lighting';
import type { GameEngine } from './engine';
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

export function renderGame(g: GameEngine): void {
  if (!g.world || !g.player) return;
  const ctx = g.ctx;
  const W = g.vw, H = g.vh;
  const playing = g.screen === 'playing';
  const showPlayer = playing && !g.player.dead;

  // ---- 天空(屏幕空间) ----
  g.sky.dayT = g.dayT();
  g.sky.skyLight = g.skyLightNow();
  g.sky.camX = g.camX + g.viewW() / 2;
  g.sky.camY = g.camY + g.viewH() / 2;
  g.sky.depthPx = g.sky.camY - g.surfaceYpx();
  g.sky.timeSec = g.timeSec;
  ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  drawSkyBackground(ctx, W, H, g.sky);

  // ---- 世界空间 ----
  ctx.save();
  ctx.scale(g.zoom * g.dpr, g.zoom * g.dpr);
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

  // ---- 背景墙 ----
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const id = wld.tiles[y * wld.w + x];
      if (TileDefs[id].solid) continue;
      const wall = wld.walls[y * wld.w + x];
      if (!wall) continue;
      const arr = tex.walls.get(wall);
      if (arr) ctx.drawImage(arr[(x * 7 + y * 11) % arr.length], x * 16, y * 16);
    }
  }

  // ---- 瓦片 ----
  const glows: { c: HTMLCanvasElement; x: number; y: number; s: number }[] = [];
  const roots: { c: HTMLCanvasElement; x: number; y: number }[] = [];
  const flameFrame = (g.frame >> 3) & 3;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const id = wld.tiles[y * wld.w + x];
      if (id === T.AIR) continue;
      const px = x * 16, py = y * 16;

      if (id === T.GRASS) {
        const arr = tex.tiles.get(T.DIRT)!;
        ctx.drawImage(arr[(x * 13 + y * 7) % arr.length], px, py);
        ctx.drawImage(tex.grassTop, px, py - 4);
        if (!wld.isSolid(x - 1, y) && wld.get(x - 1, y) !== T.GRASS) ctx.drawImage(tex.grassSideL, px, py);
        if (!wld.isSolid(x + 1, y) && wld.get(x + 1, y) !== T.GRASS) ctx.drawImage(tex.grassSideR, px, py);
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
      if (id === T.WORKBENCH_L) { ctx.drawImage(tex.sprites.workbench, px, py); continue; }
      if (id === T.ANVIL_L) { ctx.drawImage(tex.sprites.anvil, px, py); continue; }
      if (id === T.FURNACE_TL) {
        ctx.drawImage(tex.sprites.furnace, px, py);
        glows.push({ c: tex.glowWarm, x: px + 16, y: py + 18, s: 220 });
        continue;
      }
      // ---- 9-f: 新家具主格(整图绘制, 覆盖多格) ----
      if (id === T.DOOR_C_T) { ctx.drawImage(tex.sprites.doorC, px, py); continue; }
      if (id === T.DOOR_O_T) { ctx.drawImage(tex.sprites.doorO, px, py); continue; }
      if (id === T.CHEST_TL) {
        ctx.drawImage(tex.sprites.chest, px, py);
        // 已开启的宝箱: 箱体上方金色微光
        if (g.chestOpen === y * wld.w + x) glows.push({ c: tex.glowWarm, x: px + 16, y: py + 5, s: 120 });
        continue;
      }
      if (id === T.ALTAR_TL) {
        ctx.drawImage(tex.sprites.altar, px, py);
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
      if (id === T.CHAIR) { ctx.drawImage(tex.sprites.chair, px, py); continue; }
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
        const arr = tex.tiles.get(T.TORCH)!;
        ctx.drawImage(arr[0], px, py);
        ctx.drawImage(tex.flames[flameFrame], px + 4, py - 5);
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
        continue;
      }
      if (id === T.MUSH_CAP) {
        const arr = tex.tiles.get(T.MUSH_CAP)!;
        ctx.drawImage(arr[(x * 13 + y * 7) % arr.length], px, py);
        glows.push({ c: tex.glowBlue, x: px + 8, y: py + 8, s: 110 });
        continue;
      }
      if (id === T.LIFE_CRYSTAL) {
        // 粉水晶两帧脉动(暖粉光晕)
        ctx.drawImage(tex.crystalFrames[(g.frame >> 4) & 1], px, py);
        glows.push({ c: tex.glowRed, x: px + 8, y: py + 8, s: 140 });
        continue;
      }
      // 通用路径: SAND/SNOW/ICE/MUD/JUNGLE_GRASS/CORRUPT_GRASS/CORRUPT_STONE/ASH/OBSIDIAN/
      //          MUSH_STEM/CACTUS/SAPLING/VINE/LEAF_SNOW/LEAF_JUNGLE/LEAF_CORRUPT 等自包含贴图
      const arr = tex.tiles.get(id);
      if (arr) ctx.drawImage(arr[(x * 13 + y * 7) % arr.length], px, py);
    }
  }

  // ---- 树根覆盖层 ----
  for (const rt of roots) ctx.drawImage(rt.c, rt.x, rt.y);

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
    const bob = Math.sin(d.bob) * 1.6;
    ctx.drawImage(icon, d.x - 8, d.y - 9 + bob);
  }

  // ---- 敌怪 ----
  for (const e of g.enemies) {
    const flash = e.flash > 0;
    if (e.kind === 'gslime' || e.kind === 'bslime') {
      const squish = e.onGround
        ? (Math.abs(e.vx) > 0.3 ? 0.22 : 0.1 + 0.08 * Math.sin(e.anim * 0.08))
        : (e.vy < 0 ? -0.28 : 0.34);
      drawSlime(ctx, e.kind === 'gslime' ? SLIME_GREEN : SLIME_BLUE, e.x, e.y, e.w, e.h, squish, e.dir, flash);
    } else if (e.kind === 'zombie') {
      drawHumanoid(ctx, ZOMBIE_PALETTE, {
        x: e.x, y: e.y, dir: e.dir, walkT: e.anim * 0.13, onGround: e.onGround, vy: e.vy,
        zombieArms: true, flash,
      });
    } else if (e.kind === 'eye') {
      drawEye(ctx, e.x, e.y, e.w, e.h, e.anim, e.dir, flash);
    } else if (e.kind === 'bat') {
      drawBat(ctx, e.x, e.y, e.w, e.h, e.anim, e.dir, flash);
    } else if (e.kind === 'skel') {
      drawHumanoid(ctx, SKELETON_PALETTE, {
        x: e.x, y: e.y, dir: e.dir, walkT: e.anim * 0.13, onGround: e.onGround, vy: e.vy,
        zombieArms: true, flash,
      });
    } else if (e.kind === 'lslime') {
      const squish = e.onGround
        ? (Math.abs(e.vx) > 0.3 ? 0.22 : 0.1 + 0.08 * Math.sin(e.anim * 0.08))
        : (e.vy < 0 ? -0.28 : 0.34);
      drawSlime(ctx, LAVA_SLIME, e.x, e.y, e.w, e.h, squish, e.dir, flash);
      // 熔岩史莱姆自带红光(仅屏内计入, 避免挤占光晕上限)
      if (e.x > g.camX - 32 && e.x < g.camX + g.viewW() + 32 && e.y > g.camY - 32 && e.y < g.camY + g.viewH() + 32) {
        glows.push({ c: tex.glowRed, x: e.x, y: e.y - e.h / 2, s: 90 });
      }
    } else if (e.kind === 'eos') {
      drawEos(ctx, e.x, e.y, e.w, e.h, e.anim, e.dir, flash);
    } else if (e.kind === 'eoc') {
      // 蓄力/旋转前摇: 整体 ±1.5px 随机抖动
      const jitter = e.mode === 'telegraph' || e.mode === 'spin';
      const jx = jitter ? (Math.random() * 2 - 1) * 1.5 : 0;
      const jy = jitter ? (Math.random() * 2 - 1) * 1.5 : 0;
      drawEoC(
        ctx, e.x + jx, e.y + jy, e.w, e.h, e.phase ?? 0,
        (g.player.x - e.x) * 0.06, (g.player.y - g.player.h / 2 - e.y) * 0.06,
        e.anim, e.flash,
      );
    }
  }

  // ---- 向导 NPC ----
  const gd = g.guide;
  if (gd) {
    drawHumanoid(ctx, GUIDE_PALETTE, {
      x: gd.x, y: gd.y, dir: gd.dir, walkT: gd.walkT, onGround: gd.onGround, vy: gd.vy,
    });
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

  // ---- 玩家 ----
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
      drawHumanoid(ctx, PLAYER_PALETTE, {
        x: p.x, y: p.y, dir: p.dir, walkT: p.walkT, onGround: p.onGround, vy: p.vy,
        swing, flash: false, armor: armorColorsOf(p.armor),
      });
    }
  }

  // ---- 粒子 ----
  for (const pt of g.parts) {
    ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - 1, pt.y - 1, pt.size, pt.size);
  }
  ctx.globalAlpha = 1;

  // ---- 投射物(粒子层后): 箭(含插墙) / 炸弹 + 引信火花 ----
  for (const pr of g.projs) {
    if (pr.kind === 'arrow') {
      drawArrow(ctx, pr.x, pr.y, pr.rot);
    } else {
      drawBomb(ctx, pr.x, pr.y, pr.t);
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
  const extra: ExtraLight[] = [];
  if (showPlayer) {
    const held = g.player.inv[g.player.hotbar];
    if (held && held.id === IT.TORCH) {
      extra.push({
        x: Math.floor(g.player.x / 16),
        y: Math.floor((g.player.y - g.player.h / 2) / 16),
        v: 0.95,
      });
    }
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

  // ---- 小地图(仅游戏中, 全屏地图打开时被整体覆盖, 跳过省事) ----
  if (g.screen !== 'title' && !g.mapOpen) {
    drawMinimap(g, ctx, W);
  }

  // ---- 全屏地图叠加层(管线最后) ----
  if (g.mapOpen) {
    drawWorldMap(g, ctx, W, H);
  }
}

function drawMinimap(g: GameEngine, ctx: CanvasRenderingContext2D, W: number): void {
  if (!g.mmCanvas) return;
  const mw = 256, mh = 168;
  const mx = W - mw - 14, my = 12;
  ctx.fillStyle = 'rgba(8,10,20,0.55)';
  ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6);
  ctx.strokeStyle = 'rgba(106,118,184,0.8)';
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
