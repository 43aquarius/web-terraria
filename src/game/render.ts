/**
 * 世界渲染管线：天空 -> 墙/瓦片/水 -> 实体 -> 光照罩 -> 光晕 -> 特效 -> 小地图
 */

import { T, TileDefs, ItemDefs, IT } from './constants';
import { drawSkyBackground } from './sky';
import { drawHumanoid, drawSlime, drawEye, PLAYER_PALETTE, ZOMBIE_PALETTE, SLIME_GREEN, SLIME_BLUE } from './sprites';
import type { ExtraLight } from './lighting';
import type { GameEngine } from './engine';

function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }

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
  const glows: { x: number; y: number; s: number }[] = [];
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
        glows.push({ x: px + 16, y: py + 18, s: 220 });
        continue;
      }
      if (id > T.FURNACE_TL && id <= T.ANVIL_R) continue; // 家具子格
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
      if (id === T.TORCH) {
        const arr = tex.tiles.get(T.TORCH)!;
        ctx.drawImage(arr[0], px, py);
        ctx.drawImage(tex.flames[flameFrame], px + 4, py - 5);
        glows.push({ x: px + 8, y: py + 2, s: 150 });
        continue;
      }
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
        swing, flash: false,
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

  // ---- 暖光晕(additive) ----
  if (showPlayer) {
    const held = g.player.inv[g.player.hotbar];
    if (held && held.id === IT.TORCH) glows.push({ x: g.player.x, y: g.player.y - g.player.h / 2, s: 170 });
  }
  if (glows.length) {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.38;
    for (const gl of glows.slice(0, 32)) {
      ctx.drawImage(tex.glowWarm, gl.x - gl.s / 2, gl.y - gl.s / 2, gl.s, gl.s);
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

  // ---- 敌怪血条 ----
  for (const e of g.enemies) {
    if (e.hpShow <= 0) continue;
    const bw = Math.max(16, e.w);
    const bx = e.x - bw / 2, by = e.y - e.h - 7;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, by, bw, 3);
    ctx.fillStyle = '#d03838';
    ctx.fillRect(bx + 0.5, by + 0.5, (bw - 1) * clamp(e.hp / e.maxHp, 0, 1), 2);
  }

  // ---- 鼠标格子高亮 ----
  if (playing && !g.paused && !g.invOpen) {
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

  // ---- 小地图(仅游戏中) ----
  if (g.screen !== 'title') {
    drawMinimap(g, ctx, W);
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

// ItemDefs 仅供类型一致性引用(避免 tree-shaking 后引用丢失提示)
void ItemDefs;
