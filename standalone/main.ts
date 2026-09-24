/**
 * 泰拉瑞亚 Web — 单文件版入口
 * 用原生 DOM 复刻 React UI 层(HUD/Overlays),引擎代码直接复用 src/game/*
 * 由 standalone/build.ts 打包内联为 public/terraria.html(零依赖、零网络请求)
 */

import { GameEngine, getEngine } from '../src/game/engine';
import { ui, type UIState, type Slot } from '../src/game/store';
import { ItemDefs, RECIPES } from '../src/game/constants';
import { getTextures, type GameTextures } from '../src/game/textures';

/* ==================== 样式 ==================== */

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;overflow:hidden;background:#000}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
img{image-rendering:pixelated}
button{font:inherit}
#game{position:fixed;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
#hud{position:fixed;inset:0;pointer-events:none;display:none}
#hud.on{display:block}

@keyframes fadein{from{opacity:0}to{opacity:1}}
@keyframes heartpulse{0%{transform:scale(1)}45%{transform:scale(1.22)}100%{transform:scale(1)}}
@keyframes msgfade{0%{opacity:0;transform:translateX(-8px)}6%{opacity:1;transform:translateX(0)}72%{opacity:1}100%{opacity:0}}
@keyframes selglow{0%,100%{box-shadow:inset 0 0 10px rgba(247,208,96,.25)}50%{box-shadow:inset 0 0 10px rgba(247,208,96,.5)}}
@keyframes spin8{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}

/* ---- 心形血条 / 气泡 ---- */
#hearts-wrap{position:absolute;left:8px;top:56px;display:flex;flex-direction:column}
@media(min-width:1024px){#hearts-wrap{left:12px;top:8px}}
#hearts{display:flex;flex-wrap:wrap;gap:2px;max-width:248px;animation:heartpulse .3s ease-out}
.heart{position:relative;width:22px;height:22px}
.heart>img{position:absolute;inset:0;width:22px;height:22px}
.heart .fill{position:absolute;inset:0;overflow:hidden}
.heart .fill img{width:22px;height:22px;display:block}
#breath{display:flex;gap:2px;margin-top:4px}
#breath .bub{width:16px;height:16px}

/* ---- 槽位 ---- */
.slot{position:relative;display:flex;align-items:center;justify-content:center;
  border:2px solid #6a76b8;background:rgba(28,34,66,.85);width:32px;height:32px;cursor:pointer;padding:0}
.slot:hover{border-color:#8a96cc}
.slot.sel{border-color:#f7d060;background:rgba(38,34,20,.88);animation:selglow 1.6s ease-in-out infinite}
.slot img.icon{width:20px;height:20px;pointer-events:none}
.slot .badge{position:absolute;left:2px;top:0;font-size:9px;font-weight:700;line-height:1;
  color:rgba(255,255,255,.5);text-shadow:1px 1px 0 #000;pointer-events:none}
.slot.sel .badge{color:#fcd34d}
.slot .cnt{position:absolute;bottom:0;right:4px;font-size:11px;font-weight:700;line-height:1;
  color:#fff;text-shadow:1px 1px 0 #000;pointer-events:none}
.slot .cnt.big{font-size:8px;right:2px}

/* ---- 快捷栏 ---- */
#hotbar{position:absolute;left:50%;transform:translateX(-50%);display:flex;gap:2px;top:8px;
  pointer-events:auto;transition:top .2s ease,opacity .2s ease}
#hotbar.inv-open{top:16px;opacity:.8}
@media(min-width:400px){#hotbar{gap:4px}.slot{width:36px;height:36px}}
@media(min-width:640px){.slot{width:44px;height:44px}.slot img.icon{width:28px;height:28px}}

/* ---- 信息条(小地图下方) ---- */
#infobar{position:absolute;right:8px;top:176px}
#infobar .box{background:rgba(0,0,0,.3);border-radius:2px;padding:4px 8px;font-size:11px;line-height:1.3;
  color:#e8e4d8;text-align:right;text-shadow:1px 1px 0 #000}
#infobar .depth{font-variant-numeric:tabular-nums}
#infobar .dn{display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:2px}
#infobar .dn svg{width:14px;height:14px}
#infobar .dn.day svg{color:#fcd34d}
#infobar .dn.night svg{color:#e2e8f0}

/* ---- 背包 + 合成 ---- */
#inv{position:absolute;bottom:48px;left:50%;transform:translateX(-50%);display:none;
  max-height:calc(100vh - 8rem);max-width:calc(100vw - 12px);overflow-y:auto;
  border:2px solid #6a76b8;border-radius:6px;background:rgba(16,20,40,.92);padding:12px;
  pointer-events:auto;animation:fadein .25s ease-out}
#inv.open{display:block}
#inv .inner{display:flex;flex-direction:column;gap:12px}
@media(min-width:1024px){#inv .inner{flex-direction:row;align-items:flex-start;gap:16px}
  #inv{padding:16px}}
.inv-title{font-size:13px;font-weight:700;letter-spacing:.15em;color:#f0e8c8;text-shadow:1px 1px 0 #000}
.inv-head{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:8px}
.stations{display:flex;align-items:center;gap:10px}
.station{display:flex;align-items:center;gap:4px}
.dot{width:8px;height:8px;border-radius:50%;background:#3a3a48}
.dot.on{background:#f7d060;box-shadow:0 0 4px rgba(247,208,96,.8)}
.sname{font-size:10px;line-height:1;color:#6a6a7a}
.sname.on{color:#f7d060}
.grid{display:grid;grid-template-columns:repeat(10,32px);gap:2px}
@media(min-width:640px){.grid{grid-template-columns:repeat(10,44px);gap:4px}}
.sep{height:1px;background:rgba(106,118,184,.5);margin:6px 0}
.craft-wrap{width:100%}
@media(min-width:1024px){.craft-wrap{width:224px;flex-shrink:0}}
.craft-list{display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto;padding-right:4px}
@media(min-width:1024px){.craft-list{max-height:288px}}
.craft-empty{padding:16px 0;text-align:center;font-size:12px;line-height:1.7;color:#8a8a9a}
.craft-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;cursor:pointer;
  border:2px solid rgba(106,118,184,.6);background:rgba(28,34,66,.85);padding:6px 8px}
.craft-item:hover{border-color:#f7d060;background:rgba(38,34,20,.85)}
.craft-item img{width:24px;height:24px;flex-shrink:0}
.craft-item .nm{flex:1;font-size:12px;color:#e8e4d8;text-shadow:1px 1px 0 #000;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.craft-item .x{font-size:11px;font-weight:700;color:#f7d060;text-shadow:1px 1px 0 #000}

/* ---- 消息 ---- */
#msgs{position:absolute;left:12px;bottom:12px;display:flex;flex-direction:column;gap:4px;max-width:70vw}
.msg{width:max-content;max-width:100%;overflow-wrap:break-word;border-radius:2px;
  border-left:2px solid rgba(251,191,36,.7);background:rgba(0,0,0,.45);padding:2px 8px;
  font-size:13px;line-height:1.35;color:#fff;text-shadow:1px 1px 0 #000;
  backdrop-filter:blur(1px);animation:msgfade 3.5s linear forwards}

/* ---- 右下按钮 ---- */
#hud-btns{position:absolute;right:8px;bottom:8px;display:flex;align-items:center;gap:8px}
#hud-btns .hint{font-size:11px;color:rgba(232,228,216,.6);text-shadow:1px 1px 0 #000}
.icon-btn{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;
  border:1px solid #6a76b8;background:rgba(28,34,66,.85);color:#e8e4d8;pointer-events:auto}
.icon-btn:hover{border-color:#f7d060}
.icon-btn svg{width:15px;height:15px}

/* ---- 帮助面板 ---- */
.panel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:19rem;max-width:calc(100vw - 24px);
  border:2px solid #6a76b8;border-radius:6px;background:rgba(16,20,40,.96);padding:16px;
  pointer-events:auto;animation:fadein .25s ease-out;z-index:50}
.panel .p-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.ctl-list{list-style:none;display:flex;flex-direction:column;gap:6px}
.ctl-list li{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px}
.ctl-list .k{white-space:nowrap;border:1px solid #6a76b8;background:#262c50;padding:2px 6px;
  font-family:ui-monospace,monospace;font-size:10px;color:#f0e8c8}
.ctl-list .d{text-align:right;color:#b8b4a8}
.panel .tip{margin-top:12px;border-top:1px solid rgba(106,118,184,.4);padding-top:8px;
  font-size:10px;line-height:1.7;color:#8a8a9a}
.x-btn{border:1px solid #6a76b8;background:rgba(28,34,66,.85);padding:2px 8px;font-size:12px;
  color:#e8e4d8;cursor:pointer}
.x-btn:hover{border-color:#f7d060}

/* ---- 覆盖层 ---- */
.ovl{position:fixed;inset:0;display:none}
#title{background:rgba(0,0,0,.3);z-index:40;pointer-events:none}
#title.open{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:32px;
  animation:fadein .3s ease-out;padding:16px}
#title h1{font-size:clamp(48px,9vw,96px);font-weight:900;letter-spacing:.03em;color:#4ec44e;
  text-shadow:0 4px 0 #1d5c1d,0 8px 0 rgba(0,0,0,.6)}
#title .sub{margin-top:16px;font-size:clamp(12px,1.4vw,14px);letter-spacing:.35em;
  color:rgba(232,228,216,.85);text-shadow:1px 1px 0 #000;text-align:center}
#title nav{display:flex;width:256px;flex-direction:column;gap:12px;pointer-events:auto}
@media(min-width:640px){#title nav{width:288px}}
#title .ver{position:absolute;inset-inline:0;bottom:12px;text-align:center;padding:0 16px;
  font-size:11px;color:rgba(232,228,216,.5);text-shadow:1px 1px 0 #000}
.mbtn{width:100%;border:2px solid #6a76b8;background:#2a4a2e;color:#f0e8c8;font-weight:700;
  letter-spacing:.05em;padding:12px 32px;font-size:16px;cursor:pointer;text-shadow:1px 1px 0 #000}
.mbtn:hover{background:#3a6a40}
.mbtn:active{transform:translateY(2px)}
.mbtn.gold{border-color:#f7e07a;background:#b8912e;color:#fff6d8;text-shadow:1px 1px 0 rgba(0,0,0,.5)}
.mbtn.gold:hover{background:#d0a83e}
.mbtn.small{padding:8px 24px;font-size:13px}
.mbtn .row{display:flex;align-items:center;justify-content:center;gap:8px}
.mbtn svg{width:15px;height:15px}

#loading{background:rgba(0,0,0,.9);z-index:60}
#loading.open{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;
  animation:fadein .3s ease-out}
.spin{width:40px;height:40px;border:4px solid #f7d060;position:relative;animation:spin8 1.2s steps(8) infinite}
.spin::after{content:'';position:absolute;left:50%;top:50%;width:12px;height:12px;
  transform:translate(-50%,-50%);background:#6a76b8}
#loading p{font-size:14px;letter-spacing:.3em;color:#e8e4d8;text-shadow:1px 1px 0 #000}

#dead{background:rgba(64,10,16,.6);z-index:40}
#dead.open{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;
  animation:fadein .3s ease-out}
#dead h2{font-size:clamp(36px,6vw,60px);font-weight:900;color:#e03c3c;
  text-shadow:0 3px 0 #5a0f0f,0 6px 0 rgba(0,0,0,.6)}
#dead p{font-size:14px;letter-spacing:.3em;color:#e8c8c8;text-shadow:1px 1px 0 #000;
  animation:pulse 1.6s ease-in-out infinite}

#paused{background:rgba(0,0,0,.5);z-index:40;padding:16px}
#paused.open{display:flex;align-items:center;justify-content:center;animation:fadein .3s ease-out}
#paused .box{width:288px;max-width:100%;border:2px solid #6a76b8;border-radius:6px;
  background:rgba(16,20,40,.95);padding:20px}
#paused h2{margin-bottom:16px;text-align:center;font-size:18px;font-weight:700;letter-spacing:.2em;
  color:#f7d060;text-shadow:1px 1px 0 #000}
#paused .col{display:flex;flex-direction:column;gap:10px}

/* ---- tooltip / 光标物品 ---- */
#tooltip{position:fixed;left:0;top:0;z-index:50;max-width:240px;border:2px solid #6a76b8;
  background:rgba(12,15,32,.94);padding:8px;opacity:0;pointer-events:none;transition:opacity .12s ease-out}
#tooltip .tname{font-size:14px;font-weight:700;color:#f7d060;text-shadow:1px 1px 0 #000}
#tooltip .tkind{font-size:10px;color:#9ab8e0}
#tooltip .tstat{font-size:11px;color:#e8e4d8;line-height:1.5}
#tooltip .tdesc{font-size:11px;line-height:1.4;color:#b8b4a8;max-width:208px}
#tooltip .gap{height:4px}
#cursor-item{position:fixed;left:0;top:0;z-index:50;pointer-events:none}
#cursor-item img{width:32px;height:32px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.8))}
#cursor-item .cnt{position:absolute;right:-4px;bottom:-4px;font-size:11px;font-weight:700;
  color:#fff;text-shadow:1px 1px 0 #000}
#cursor-item .cnt.big{font-size:8px}

/* ---- 滚动条 ---- */
.craft-list::-webkit-scrollbar,#inv::-webkit-scrollbar{width:6px}
.craft-list::-webkit-scrollbar-track,#inv::-webkit-scrollbar-track{background:rgba(10,12,26,.8)}
.craft-list::-webkit-scrollbar-thumb,#inv::-webkit-scrollbar-thumb{background:#6a76b8}
.craft-list::-webkit-scrollbar-thumb:hover,#inv::-webkit-scrollbar-thumb:hover{background:#8a96cc}
.craft-list{scrollbar-width:thin;scrollbar-color:#6a76b8 rgba(10,12,26,.8)}
#inv{scrollbar-width:thin;scrollbar-color:#6a76b8 rgba(10,12,26,.8)}
`;

/* ==================== SVG 图标 ==================== */

const svg = (d: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const I_SUN = svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>');
const I_MOON = svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>');
const I_VOL = svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>');
const I_VOLX = svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>');
const I_HELP = svg('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>');

/* ==================== 静态数据 ==================== */

const STATION_NAMES: Record<string, string> = { workbench: '工作台', furnace: '熔炉', anvil: '铁砧' };
const KIND_LABEL: Record<string, string> = {
  block: '方块', material: '材料', tool: '工具', weapon: '武器', station: '工作站',
};

const CONTROLS: [string, string][] = [
  ['A / D / ←→', '左右移动'],
  ['W / 空格', '跳跃'],
  ['S', '下平台'],
  ['鼠标左键', '挖掘 / 放置 / 攻击'],
  ['滚轮 / 1~0', '切换物品'],
  ['E / Tab', '打开背包'],
  ['Esc', '暂停 / 关闭界面'],
  ['M', '静音'],
  ['H', '操作说明'],
];

/* ==================== DOM 模板 ==================== */

const helpListHTML = CONTROLS.map(([k, d]) =>
  `<li><span class="k">${k}</span><span class="d">${d}</span></li>`).join('');

const BODY_HTML = `
<canvas id="game" aria-label="泰拉瑞亚游戏画面"></canvas>

<div id="hud">
  <div id="hearts-wrap">
    <div id="hearts"></div>
    <div id="breath" style="display:none"></div>
  </div>

  <div id="hotbar"></div>

  <div id="infobar"><div class="box">
    <div class="depth"></div>
    <div class="dn day">${I_SUN}<span class="dn-txt">白天</span></div>
  </div></div>

  <div id="inv"><div class="inner">
    <div class="inv-main">
      <div class="inv-head">
        <h2 class="inv-title">背包</h2>
        <div class="stations">
          <span class="station" data-st="workbench"><span class="dot"></span><span class="sname">工作台</span></span>
          <span class="station" data-st="furnace"><span class="dot"></span><span class="sname">熔炉</span></span>
          <span class="station" data-st="anvil"><span class="dot"></span><span class="sname">铁砧</span></span>
        </div>
      </div>
      <div class="grid" id="inv-hot"></div>
      <div class="sep"></div>
      <div class="grid" id="inv-bag"></div>
    </div>
    <div class="craft-wrap">
      <h2 class="inv-title" style="margin-bottom:8px">合成</h2>
      <div class="craft-list" id="craft"></div>
    </div>
  </div></div>

  <div id="msgs"></div>

  <div id="hud-btns">
    <span class="hint">M 静音 · H 帮助</span>
    <button type="button" class="icon-btn" id="btn-mute" aria-label="静音"></button>
    <button type="button" class="icon-btn" id="btn-help" aria-label="操作说明">${I_HELP}</button>
  </div>
</div>

<div class="ovl" id="title">
  <div style="text-align:center">
    <h1>TERRARIA</h1>
    <p class="sub">WEB 复刻版 · 程序化像素世界</p>
  </div>
  <nav aria-label="主菜单">
    <button type="button" class="mbtn gold" id="btn-enter">进入世界</button>
    <button type="button" class="mbtn" id="btn-continue" style="display:none">继续上次冒险</button>
    <button type="button" class="mbtn" id="btn-regen">生成新世界</button>
    <button type="button" class="mbtn" id="btn-title-help">操作说明</button>
  </nav>
  <p class="ver">泰拉瑞亚 Web 复刻 v0.1 · 致敬 Re-Logic 的伟大作品</p>
</div>

<div class="ovl" id="dead">
  <h2>你已死亡…</h2>
  <p>即将重生</p>
</div>

<div class="ovl" id="paused">
  <div class="box">
    <h2>已暂停</h2>
    <div class="col">
      <button type="button" class="mbtn small" id="btn-resume">继续游戏</button>
      <button type="button" class="mbtn small" id="btn-save">保存游戏</button>
      <button type="button" class="mbtn small" id="btn-sound"></button>
      <button type="button" class="mbtn small" id="btn-quit">回到标题</button>
    </div>
  </div>
</div>

<div class="ovl" id="loading" style="z-index:60">
  <div class="spin" aria-hidden="true"></div>
  <p id="loading-text" role="status">正在生成世界…</p>
</div>

<div id="help-modal" style="display:none">
  <div class="panel">
    <div class="p-head">
      <h2 class="inv-title">操作说明</h2>
      <button type="button" class="x-btn" data-close-help="1" aria-label="关闭操作说明">✕</button>
    </div>
    <ul class="ctl-list">${helpListHTML}</ul>
    <p class="tip">键盘 + 鼠标游戏：先砍树取木材制作工作台，再挖矿造更好的工具。夜晚会有敌怪出没！</p>
  </div>
</div>

<div id="title-help" style="display:none">
  <div class="panel">
    <div class="p-head">
      <h2 class="inv-title">操作说明</h2>
      <button type="button" class="x-btn" data-close-help="1" aria-label="关闭操作说明">✕</button>
    </div>
    <ul class="ctl-list">${helpListHTML}</ul>
    <p class="tip">本作为键盘 + 鼠标游戏：先砍树取木材制作工作台，再挖矿造更好的工具。夜晚会有敌怪出没！</p>
    <div style="margin-top:16px">
      <button type="button" class="mbtn small gold" data-close-help="1">开始冒险</button>
    </div>
  </div>
</div>

<div id="tooltip" role="tooltip"></div>
<div id="cursor-item"></div>
`;

/* ==================== 渲染 ==================== */

let tex: GameTextures;
let helpOpen = false;
let titleHelpOpen = false;
let lastSlotsKey = '';
let lastHeartsKey = '';
let lastMsgKey = '';
let lastCraftKey = '';
let lastInfoKey = '';
let lastCursorKey = '';

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slotHTML(slot: Slot | null, i: number, sel: boolean, badge: string, inInv: boolean): string {
  const cls = ['slot', sel ? 'sel' : ''].filter(Boolean).join(' ');
  const attrs = `class="${cls}" data-slot="${i}" ${inInv ? 'data-inv="1" ' : ''}${slot ? `data-tip-item="${slot.id}" ` : ''}aria-label="${slot ? esc(ItemDefs[slot.id]?.name ?? '') : '空槽位'}"`;
  const icon = slot && tex.iconURL[slot.id]
    ? `<img class="icon" src="${tex.iconURL[slot.id]}" alt="" draggable="false">` : '';
  const cnt = slot && slot.count > 1
    ? `<span class="cnt${slot.count >= 100 ? ' big' : ''}">${slot.count}</span>` : '';
  const b = badge ? `<span class="badge">${badge}</span>` : '';
  return `<button type="button" ${attrs}>${b}${icon}${cnt}</button>`;
}

function heartsHTML(hp: number, maxHp: number): string {
  const n = Math.max(1, Math.ceil(maxHp / 10));
  let out = '';
  for (let i = 0; i < n; i++) {
    const v = hp - i * 10;
    const pct = v <= 0 ? 0 : v >= 10 ? 100 : v * 10;
    out += `<div class="heart">
      <img src="${tex.heartEmptyURL}" alt="" draggable="false" aria-hidden="true">
      ${pct > 0 ? `<div class="fill" style="width:${pct}%"><img src="${tex.heartURL}" alt="" draggable="false" aria-hidden="true"></div>` : ''}
    </div>`;
  }
  return out;
}

function itemTipHTML(id: number): string {
  const d = ItemDefs[id];
  if (!d) return '';
  const stats: string[] = [];
  if (d.dmg !== undefined) stats.push(`伤害 ${d.dmg}`);
  if (d.power !== undefined) stats.push(`挖掘力 ${d.power}`);
  if (d.useTime !== undefined) stats.push(`使用间隔 ${(d.useTime / 60).toFixed(2)} 秒`);
  return `<div class="tname">${esc(d.name)}</div>
    <div class="tkind">${KIND_LABEL[d.kind] ?? ''}${d.kind === 'tool' && d.tool ? ` · ${d.tool === 'pick' ? '镐' : '斧'}` : ''}</div>
    ${stats.length ? `<div class="gap"></div><div class="tstat">${stats.join('<br>')}</div>` : ''}
    ${d.desc ? `<div class="gap"></div><div class="tdesc">${esc(d.desc)}</div>` : ''}`;
}

function recipeTipHTML(index: number): string {
  const r = RECIPES[index];
  if (!r) return '';
  const mats = r.ins.map((m) => `${esc(ItemDefs[m.id]?.name ?? String(m.id))} × ${m.n}`).join('<br>');
  return `<div class="tname">合成 ${esc(ItemDefs[r.out]?.name ?? '?')}</div>
    <div class="gap"></div><div class="tstat"><span class="tkind">需要材料</span><br>${mats}</div>
    <div class="gap"></div><div class="tdesc">${r.station ? `需要${STATION_NAMES[r.station]}` : '无需工作站'}</div>`;
}

function render(st: UIState): void {
  const playing = st.screen === 'playing' || st.screen === 'dead';

  // ---- 覆盖层可见性 ----
  $('hud').classList.toggle('on', playing);
  $('title').classList.toggle('open', st.screen === 'title' && !st.loading);
  $('dead').classList.toggle('open', st.screen === 'dead');
  $('paused').classList.toggle('open', st.paused && st.screen === 'playing' && !st.loading);
  $('loading').classList.toggle('open', st.loading);
  if (st.loading) {
    const t = $('loading-text');
    const want = st.loadingText || '正在生成世界…';
    if (t.textContent !== want) t.textContent = want;
  }
  $('title-help').style.display = (st.screen === 'title' && titleHelpOpen) ? 'block' : 'none';
  $('help-modal').style.display = (playing && helpOpen) ? 'block' : 'none';
  const cont = $('btn-continue');
  if (cont.style.display === '' && !st.hasSave) cont.style.display = 'none';
  else if (cont.style.display === 'none' && st.hasSave) cont.style.display = '';

  if (!playing) return;

  // ---- 心形血条 ----
  const hk = `${st.hp}/${st.maxHp}`;
  if (hk !== lastHeartsKey) {
    lastHeartsKey = hk;
    $('hearts').innerHTML = heartsHTML(st.hp, st.maxHp);
  }
  const breath = $('breath');
  if (st.breath === null) {
    breath.style.display = 'none';
  } else {
    breath.style.display = 'flex';
    let bh = '';
    for (let i = 0; i < 8; i++) {
      bh += `<span class="bub">${st.breath * 8 >= i + 1 ? `<img src="${tex.bubbleURL}" alt="" draggable="false">` : ''}</span>`;
    }
    breath.innerHTML = bh;
  }

  // ---- 快捷栏 + 背包格 ----
  const sk = JSON.stringify(st.slots) + '|' + st.hotbar + '|' + st.invOpen;
  if (sk !== lastSlotsKey) {
    lastSlotsKey = sk;
    const hb = $('hotbar');
    hb.classList.toggle('inv-open', st.invOpen);
    let hh = '';
    for (let i = 0; i < 10; i++) {
      hh += slotHTML(st.slots[i], i, st.hotbar === i, String((i + 1) % 10), false);
    }
    hb.innerHTML = hh;
    if (st.invOpen) {
      let hi = '';
      for (let i = 0; i < 10; i++) {
        hi += slotHTML(st.slots[i], i, st.hotbar === i, '', true);
      }
      $('inv-hot').innerHTML = hi;
      let bi = '';
      for (let i = 10; i < 40; i++) {
        bi += slotHTML(st.slots[i], i, false, '', true);
      }
      $('inv-bag').innerHTML = bi;
    }
    $('inv').classList.toggle('open', st.invOpen);
  }

  // ---- 工作站指示 ----
  for (const s of ['workbench', 'furnace', 'anvil'] as const) {
    const el = document.querySelector<HTMLElement>(`.station[data-st="${s}"]`);
    if (el) {
      el.querySelector('.dot')?.classList.toggle('on', st.stations[s]);
      el.querySelector('.sname')?.classList.toggle('on', st.stations[s]);
    }
  }

  // ---- 合成列表 ----
  const ck = JSON.stringify(st.craftables);
  if (ck !== lastCraftKey) {
    lastCraftKey = ck;
    const list = st.craftables.filter((c) => c.can && RECIPES[c.index] !== undefined);
    $('craft').innerHTML = list.length === 0
      ? `<p class="craft-empty">暂无可合成物品<br>收集材料或靠近工作台试试</p>`
      : list.map((c) => {
        const r = RECIPES[c.index];
        const url = tex.iconURL[r.out];
        return `<button type="button" class="craft-item" data-craft="${c.index}" data-tip-recipe="${c.index}">
          ${url ? `<img src="${url}" alt="" draggable="false">` : ''}
          <span class="nm">${esc(ItemDefs[r.out]?.name ?? '')}</span>
          ${r.count > 1 ? `<span class="x">×${r.count}</span>` : ''}
        </button>`;
      }).join('');
  }

  // ---- 消息 ----
  const mk = st.messages.map((m) => m.id).join(',');
  if (mk !== lastMsgKey) {
    lastMsgKey = mk;
    $('msgs').innerHTML = st.messages.slice(-6).map((m) =>
      `<p class="msg" style="color:${m.color}">${esc(m.text)}</p>`).join('');
  }

  // ---- 信息条 / 声音按钮 ----
  const ik = `${st.depth}|${st.isNight}|${st.muted}`;
  if (ik !== lastInfoKey) {
    lastInfoKey = ik;
    const box = $('infobar');
    box.querySelector<HTMLElement>('.depth')!.textContent = st.depth >= 0 ? `${st.depth} 米` : '地表上';
    const dn = box.querySelector<HTMLElement>('.dn')!;
    dn.className = `dn ${st.isNight ? 'night' : 'day'}`;
    dn.innerHTML = `${st.isNight ? I_MOON : I_SUN}<span class="dn-txt">${st.isNight ? '夜晚' : '白天'}</span>`;
    $('btn-mute').innerHTML = st.muted ? I_VOLX : I_VOL;
    $('btn-sound').innerHTML =
      `<span class="row">${st.muted ? I_VOLX : I_VOL}声音：${st.muted ? '关' : '开'}</span>`;
  }

  // ---- 光标物品 ----
  const ck2 = st.cursorItem ? `${st.cursorItem.id}x${st.cursorItem.count}` : '';
  if (ck2 !== lastCursorKey) {
    lastCursorKey = ck2;
    const ci = $('cursor-item');
    if (st.cursorItem) {
      const url = tex.iconURL[st.cursorItem.id];
      ci.innerHTML = `${url ? `<img src="${url}" alt="" draggable="false">` : ''}${
        st.cursorItem.count > 1 ? `<span class="cnt${st.cursorItem.count >= 100 ? ' big' : ''}">${st.cursorItem.count}</span>` : ''}`;
    } else {
      ci.innerHTML = '';
    }
  }
}

/* ==================== 交互 ==================== */

function bindEvents(): void {
  // 槽位点击(委托: 背包格左右键都取/放, 快捷栏左键选中)
  document.addEventListener('mousedown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
    if (!el) return;
    const i = Number(el.dataset.slot);
    const right = e.button === 2;
    const eng = getEngine();
    if (!eng) return;
    if (el.dataset.inv === '1') {
      if (e.button === 0 || e.button === 2) eng.clickSlot(i, right);
    } else if (e.button === 0) {
      eng.selectHotbar(i);
    }
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // 合成点击 / 帮助关闭(委托)
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const craft = target.closest<HTMLElement>('[data-craft]');
    if (craft) getEngine()?.craft(Number(craft.dataset.craft));
    if (target.closest('[data-close-help]')) {
      helpOpen = false;
      titleHelpOpen = false;
      render(ui.getSnapshot());
    }
  });

  // tooltip 跟随
  const tip = $('tooltip');
  document.addEventListener('mouseover', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip-item],[data-tip-recipe]');
    if (!t) { tip.style.opacity = '0'; return; }
    if (t.dataset.tipItem !== undefined) tip.innerHTML = itemTipHTML(Number(t.dataset.tipItem));
    else tip.innerHTML = recipeTipHTML(Number(t.dataset.tipRecipe));
    tip.style.opacity = '1';
  });
  const place = (x: number, y: number): void => {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + 16, top = y + 18;
    if (left + w > window.innerWidth - 8) left = Math.max(8, x - w - 16);
    if (top + h > window.innerHeight - 8) top = Math.max(8, y - h - 18);
    tip.style.transform = `translate(${left}px,${top}px)`;
  };
  document.addEventListener('mousemove', (e) => {
    place(e.clientX, e.clientY);
    $('cursor-item').style.transform = `translate(${e.clientX + 12}px,${e.clientY + 12}px)`;
  });

  // 按钮
  $('btn-mute').addEventListener('click', () => getEngine()?.toggleMute());
  $('btn-help').addEventListener('click', () => { helpOpen = !helpOpen; render(ui.getSnapshot()); });
  $('btn-enter').addEventListener('click', () => getEngine()?.enterWorld());
  $('btn-continue').addEventListener('click', () => getEngine()?.continueGame());
  $('btn-regen').addEventListener('click', () => getEngine()?.regenerate());
  $('btn-title-help').addEventListener('click', () => { titleHelpOpen = true; render(ui.getSnapshot()); });
  $('btn-resume').addEventListener('click', () => getEngine()?.togglePause());
  $('btn-save').addEventListener('click', () => {
    const ok = getEngine()?.saveGame() ?? false;
    getEngine()?.msg(ok ? '已保存：世界与背包已写入本地存档' : '保存失败：请重试', ok ? '#8ee88e' : '#e07070');
  });
  $('btn-sound').addEventListener('click', () => getEngine()?.toggleMute());
  $('btn-quit').addEventListener('click', () => { helpOpen = false; getEngine()?.quitToTitle(); });

  // 键盘(UI 层按键; 移动/挖掘由引擎处理)
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const st = ui.getSnapshot();
    if (st.screen !== 'playing') return;
    const k = e.key.toLowerCase();
    if (k === 'e' || e.key === 'Tab') {
      e.preventDefault();
      getEngine()?.toggleInventory();
    } else if (e.key === 'Escape') {
      if (helpOpen) { helpOpen = false; render(st); }
      else if (st.invOpen) getEngine()?.toggleInventory();
      else getEngine()?.togglePause();
    } else if (k === 'm') {
      getEngine()?.toggleMute();
    } else if (k === 'h') {
      helpOpen = !helpOpen;
      render(st);
    } else if (/^[0-9]$/.test(k)) {
      if (!st.paused) getEngine()?.selectHotbar(k === '0' ? 9 : Number(k) - 1);
    }
  });
}

/* ==================== 启动 ==================== */

function boot(): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  document.body.insertAdjacentHTML('beforeend', BODY_HTML);
  document.body.style.background = '#000';

  tex = getTextures();

  bindEvents();

  const canvas = $('game') as HTMLCanvasElement;
  const eng = new GameEngine(canvas);
  eng.mount();

  ui.subscribe(() => render(ui.getSnapshot()));
  render(ui.getSnapshot());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
