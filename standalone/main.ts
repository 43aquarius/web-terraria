/**
 * 泰拉瑞亚 Web — 单文件版入口
 * 用原生 DOM 复刻 React UI 层(HUD/Overlays),引擎代码直接复用 src/game/*
 * 由 standalone/build.ts 打包内联为 public/terraria.html(零依赖、零网络请求)
 *
 * 同步 9-e/9-f/9-g 大升级: 世界生成对话框 / 盔甲三槽 / 宝箱面板 / Boss 血条 /
 * 心形两行+防御 / 信息条群系名 / 智能光标按钮 / 暂停菜单玩家名+种子 / 帮助面板 dev 行 /
 * tooltip 增强(盔甲防御/远程/炸弹) / Tab 归引擎开地图(此处只绑 E)
 */

import { GameEngine, getEngine } from '../src/game/engine';
import { ui, type UIState, type Slot } from '../src/game/store';
import {
  ItemDefs, RECIPES, WORLD_SIZES,
  type ArmorSlot, type ItemKind, type StationKind, type WorldSize,
} from '../src/game/constants';
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
#hud{position:fixed;inset:0;pointer-events:none;display:none;z-index:35}
#hud.on{display:block}

@keyframes fadein{from{opacity:0}to{opacity:1}}
@keyframes heartpulse{0%{transform:scale(1)}45%{transform:scale(1.22)}100%{transform:scale(1)}}
@keyframes msgfade{0%{opacity:0;transform:translateX(-8px)}6%{opacity:1;transform:translateX(0)}72%{opacity:1}100%{opacity:0}}
@keyframes selglow{0%,100%{box-shadow:inset 0 0 10px rgba(247,208,96,.25)}50%{box-shadow:inset 0 0 10px rgba(247,208,96,.5)}}
@keyframes spin8{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}

/* ---- 心形血条(两行) / 气泡 / 防御 ---- */
#hearts-wrap{position:absolute;left:8px;top:56px;display:flex;flex-direction:column}
@media(min-width:1024px){#hearts-wrap{left:12px;top:8px}}
#hearts{display:flex;flex-direction:column;gap:2px}
#hearts.pulse{animation:heartpulse .3s ease-out}
#hearts .hrow{display:flex;gap:2px}
.heart{position:relative;width:22px;height:22px}
.heart>img{position:absolute;inset:0;width:22px;height:22px}
.heart .fill{position:absolute;inset:0;overflow:hidden}
.heart .fill img{width:22px;height:22px;display:block}
#breath{display:flex;gap:2px;margin-top:4px}
#breath .bub{width:16px;height:16px}
#defense{display:flex;align-items:center;gap:4px;margin-top:4px;font-size:13px;font-weight:700;
  line-height:1;color:#9ab8e0;text-shadow:1px 1px 0 #000;cursor:default}
#defense svg{width:14px;height:14px}

/* ---- 槽位 ---- */
.slot{position:relative;display:flex;align-items:center;justify-content:center;
  border:2px solid #6a76b8;background:rgba(28,34,66,.85);width:32px;height:32px;cursor:pointer;padding:0;
  transition:border-color .15s ease,background-color .15s ease}
.slot:hover{border-color:#8a96cc}
.slot.sel{border-color:#f7d060;background:rgba(38,34,20,.88);animation:selglow 1.6s ease-in-out infinite}
.slot img.icon{width:20px;height:20px;pointer-events:none}
.slot .badge{position:absolute;left:2px;top:0;font-size:9px;font-weight:700;line-height:1;
  color:rgba(255,255,255,.5);text-shadow:1px 1px 0 #000;pointer-events:none}
.slot.sel .badge{color:#fcd34d}
.slot .cnt{position:absolute;bottom:0;right:4px;font-size:11px;font-weight:700;line-height:1;
  color:#fff;text-shadow:1px 1px 0 #000;pointer-events:none}
.slot .cnt.big{font-size:8px;right:2px}
/* 盔甲三槽(40px) */
.slot.armor{width:40px;height:40px}
.slot.armor img.icon{width:26px;height:26px}
/* 宝箱格(金边) */
.slot.gold{border-color:#c0a050;background:rgba(40,34,18,.88)}
.slot.gold:hover{border-color:#f7d060}

/* ---- 快捷栏 ---- */
#hotbar{position:absolute;left:50%;transform:translateX(-50%);display:flex;gap:2px;top:8px;
  pointer-events:auto;transition:top .2s ease,opacity .2s ease}
#hotbar.inv-open{top:16px;opacity:.8}
@media(min-width:400px){#hotbar{gap:4px}.slot{width:36px;height:36px}}
@media(min-width:640px){.slot{width:44px;height:44px}.slot img.icon{width:28px;height:28px}
  .slot.armor{width:40px;height:40px}.slot.armor img.icon{width:26px;height:26px}}

/* ---- Boss 血条(顶部中央,快捷栏下方) ---- */
#bossbar{position:absolute;left:50%;transform:translateX(-50%);top:56px;display:none;
  flex-direction:column;align-items:center;gap:4px;z-index:10}
@media(min-width:640px){#bossbar{top:72px}}
#bossbar.open{display:flex}
#bossbar h2{font-size:clamp(18px,2.4vw,24px);font-weight:900;letter-spacing:.15em;color:#f7d060;
  text-shadow:2px 2px 0 #000,-1px -1px 0 #000,0 0 14px rgba(247,208,96,.5);text-align:center}
#bossbar .bar{position:relative;height:14px;width:min(80vw,560px);border:2px solid #f7d060;
  background:#2a0a0a;box-shadow:0 0 0 1px #000,0 2px 8px rgba(0,0,0,.7)}
#bossbar .bar .fill{position:absolute;left:2px;top:2px;bottom:2px;
  background:linear-gradient(to bottom,#ff6a5a,#e03c3c 50%,#8a1616)}
#bossbar .bar .tick{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,.45)}
#bossbar .num{font-size:11px;font-weight:700;color:#e8e4d8;font-variant-numeric:tabular-nums;
  text-shadow:1px 1px 0 #000}

/* ---- 信息条(小地图下方) + 智能光标按钮 ---- */
#infobar{position:absolute;right:8px;top:176px;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
#infobar .box{background:rgba(0,0,0,.3);border-radius:2px;padding:4px 8px;font-size:11px;line-height:1.3;
  color:#e8e4d8;text-align:right;text-shadow:1px 1px 0 #000}
#infobar .biome{font-size:10px;color:#9ab8e0}
#infobar .depth{font-variant-numeric:tabular-nums;margin-top:2px}
#infobar .dn{display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:2px}
#infobar .dn svg{width:14px;height:14px}
#infobar .dn.day svg{color:#fcd34d}
#infobar .dn.night svg{color:#e2e8f0}
#smart-btn{display:flex;align-items:center;gap:4px;border:2px solid #6a76b8;background:rgba(28,34,66,.85);
  padding:4px 8px;font-size:11px;font-weight:700;line-height:1;color:#e8e4d8;cursor:pointer;
  pointer-events:auto;text-shadow:1px 1px 0 #000;transition:border-color .15s ease,background-color .15s ease}
#smart-btn:hover{border-color:#8a96cc}
#smart-btn svg{width:12px;height:12px}
#smart-btn.on{border-color:#f7d060;background:rgba(60,48,16,.9);color:#f7d060}

/* ---- 背包 + 宝箱 + 合成 ---- */
#inv{position:absolute;bottom:48px;left:50%;transform:translateX(-50%);display:none;
  max-height:calc(100vh - 8rem);max-width:calc(100vw - 12px);overflow-y:auto;
  border:2px solid #6a76b8;border-radius:6px;background:rgba(16,20,40,.92);padding:12px;
  pointer-events:auto;animation:fadein .25s ease-out}
#inv.open{display:block}
#inv .inner{display:flex;flex-direction:column;gap:12px}
.inv-cols{display:flex;flex-direction:column;gap:12px}
@media(min-width:1024px){.inv-cols{flex-direction:row;align-items:flex-start;gap:16px}
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
.grid.chest{grid-template-columns:repeat(5,32px)}
@media(min-width:640px){.grid.chest{grid-template-columns:repeat(5,44px)}}
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

/* ---- 盔甲行(背包面板顶部) ---- */
#armor-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px}
#armor-row .lft{display:flex;align-items:center;gap:6px}
#armor-slots{display:flex;gap:6px}
#armor-row .alabel{font-size:12px;font-weight:700;letter-spacing:.15em;color:rgba(240,232,200,.8);
  text-shadow:1px 1px 0 #000}
#armor-row .adef{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:700;line-height:1;
  color:#9ab8e0;text-shadow:1px 1px 0 #000;cursor:default}
#armor-row .adef svg{width:13px;height:13px}

/* ---- 宝箱面板(背包上方,金边) ---- */
#chest-panel{display:none;border-bottom:2px solid rgba(192,160,80,.4);padding-bottom:12px}
#chest-panel.open{display:block}
#chest-panel .chest-head{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:8px}
#chest-panel .inv-title{color:#f7d060}

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
.dev-line{display:none;margin-top:8px;align-items:center;justify-content:space-between;gap:12px;
  border:2px solid rgba(247,208,96,.5);background:rgba(60,48,16,.45);padding:6px 8px}
.dev-line.on{display:flex}
.dev-line .dk{font-size:10px;font-weight:700;letter-spacing:.1em;color:#f7d060;text-shadow:1px 1px 0 #000}
.dev-line .dv{font-size:11px;color:#e8c878;text-align:right}
.panel .tip{margin-top:12px;border-top:1px solid rgba(106,118,184,.4);padding-top:8px;
  font-size:10px;line-height:1.7;color:#8a8a9a}
.x-btn{border:1px solid #6a76b8;background:rgba(28,34,66,.85);padding:2px 8px;font-size:12px;
  color:#e8e4d8;cursor:pointer}
.x-btn:hover{border-color:#f7d060}
.x-btn:disabled{opacity:.5;cursor:default}

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
  letter-spacing:.05em;padding:12px 32px;font-size:16px;cursor:pointer;text-shadow:1px 1px 0 #000;
  transition:background-color .15s ease}
.mbtn:hover{background:#3a6a40}
.mbtn:active{transform:translateY(2px)}
.mbtn.gold{border-color:#f7e07a;background:#b8912e;color:#fff6d8;text-shadow:1px 1px 0 rgba(0,0,0,.5)}
.mbtn.gold:hover{background:#d0a83e}
.mbtn.small{padding:8px 24px;font-size:13px}
.mbtn:disabled{opacity:.6;cursor:default;transform:none}
.mbtn .row{display:flex;align-items:center;justify-content:center;gap:8px}
.mbtn svg{width:15px;height:15px}

/* ---- 世界生成对话框 ---- */
#gen{background:rgba(0,0,0,.6);z-index:55;pointer-events:auto}
#gen.open{display:flex;align-items:center;justify-content:center;padding:16px;animation:fadein .3s ease-out}
.gen-box{width:22rem;max-width:100%;border:2px solid #6a76b8;border-radius:6px;
  background:rgba(16,20,40,.97);padding:16px;box-shadow:0 0 0 1px #000,0 8px 32px rgba(0,0,0,.8)}
@media(min-width:640px){.gen-box{width:24rem}}
.gen-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}
.gen-title{font-size:16px;font-weight:700;letter-spacing:.15em;color:#f7d060;text-shadow:1px 1px 0 #000}
.field{margin-bottom:12px}
.flabel{display:block;font-size:12px;font-weight:700;color:#f0e8c8;text-shadow:1px 1px 0 #000;
  margin-bottom:6px;line-height:1}
.sizes{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.size-btn{display:flex;flex-direction:column;align-items:center;gap:1px;border:2px solid #6a76b8;
  background:rgba(28,34,66,.85);padding:6px 4px;cursor:pointer;transition:border-color .15s ease,background-color .15s ease}
.size-btn:hover{border-color:#8a96cc}
.size-btn.on{border-color:#f7d060;background:rgba(60,48,16,.9)}
.size-btn .nm{font-size:14px;font-weight:700;line-height:1.2;color:#e8e4d8;text-shadow:1px 1px 0 #000}
.size-btn.on .nm{color:#f7d060}
.size-btn .dim{font-size:9px;line-height:1.2;color:#9ab8e0;font-variant-numeric:tabular-nums}
.size-btn:disabled{opacity:.6;cursor:default}
.gen-input{width:100%;border:2px solid #6a76b8;background:rgba(10,12,26,.9);padding:6px 8px;
  font-size:14px;color:#e8e4d8;outline:none;border-radius:0;-webkit-appearance:none}
.gen-input::placeholder{color:#6a6a7a}
.gen-input:focus{border-color:#f7d060}
.gen-input:disabled{opacity:.6}
.dev-check{display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:16px;
  font-size:12px;line-height:1.4;color:#e8e4d8}
.dev-check input{width:16px;height:16px;flex-shrink:0;accent-color:#f7d060}
.gen-btns{display:flex;gap:8px}
.gen-btns .mbtn{flex:1}
.gen-spin{display:none;margin-top:8px;align-items:center;justify-content:center;gap:8px}
.gen-spin.on{display:flex}
.gen-spin .mini{width:16px;height:16px;border:2px solid #f7d060;animation:spin8 1.2s steps(8) infinite}
.gen-spin p{font-size:11px;letter-spacing:.2em;color:#9ab8e0}

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
#dead h2{font-size:clamp(30px,6vw,60px);font-weight:900;color:#e03c3c;text-align:center;max-width:90vw;
  text-shadow:0 3px 0 #5a0f0f,0 6px 0 rgba(0,0,0,.6)}
#dead p{font-size:14px;letter-spacing:.3em;color:#e8c8c8;text-shadow:1px 1px 0 #000;
  animation:pulse 1.6s ease-in-out infinite}

#paused{background:rgba(0,0,0,.5);z-index:40;padding:16px}
#paused.open{display:flex;align-items:center;justify-content:center;animation:fadein .3s ease-out}
#paused .box{width:288px;max-width:100%;border:2px solid #6a76b8;border-radius:6px;
  background:rgba(16,20,40,.95);padding:20px}
#paused h2{margin-bottom:8px;text-align:center;font-size:18px;font-weight:700;letter-spacing:.2em;
  color:#f7d060;text-shadow:1px 1px 0 #000}
#paused .meta{margin-bottom:16px;display:flex;flex-direction:column;align-items:center;gap:6px}
#paused .who{font-size:11px;line-height:1.6;color:#9ab8e0;text-shadow:1px 1px 0 #000;text-align:center}
#paused .who .mono{font-family:ui-monospace,monospace}
#paused .dev-badge{display:none;border:1px solid rgba(247,208,96,.7);background:rgba(60,48,16,.6);
  padding:2px 8px;font-size:10px;font-weight:700;letter-spacing:.1em;color:#f7d060;
  text-shadow:1px 1px 0 #000}
#paused .dev-badge.on{display:inline-block}
#paused .col{display:flex;flex-direction:column;gap:10px}

/* ---- tooltip / 光标物品 ---- */
#tooltip{position:fixed;left:0;top:0;z-index:70;max-width:240px;border:2px solid #6a76b8;
  background:rgba(12,15,32,.94);padding:8px;opacity:0;pointer-events:none;transition:opacity .12s ease-out}
#tooltip .tname{font-size:14px;font-weight:700;color:#f7d060;text-shadow:1px 1px 0 #000}
#tooltip .tkind{font-size:10px;color:#9ab8e0}
#tooltip .tstat{font-size:11px;color:#e8e4d8;line-height:1.5}
#tooltip .tdesc{font-size:11px;line-height:1.4;color:#b8b4a8;max-width:208px}
#tooltip .gap{height:4px}
#cursor-item{position:fixed;left:0;top:0;z-index:70;pointer-events:none}
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

/* ---- 触屏控制层(仅触屏设备+游戏中显示; 桌面 pointer:fine 隐藏) ---- */
#tc-world,#tc-joy,#tc-jump{display:none}
@media (pointer:coarse){
  body.playing #tc-world{display:block;position:fixed;inset:0;pointer-events:auto;touch-action:none;z-index:30}
  body.playing #tc-joy{display:flex;position:fixed;left:max(16px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));width:116px;height:116px;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(255,255,255,.08);backdrop-filter:blur(2px);align-items:center;justify-content:center;pointer-events:auto;touch-action:none;z-index:40}
  #tc-joy-knob{width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,.3);border:2px solid rgba(255,255,255,.45);pointer-events:none;transform:translate(0,0)}
  body.playing #tc-jump{display:flex;position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(24px,env(safe-area-inset-bottom));width:84px;height:84px;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(255,255,255,.1);color:rgba(255,255,255,.75);font-size:26px;align-items:center;justify-content:center;pointer-events:auto;touch-action:none;z-index:40;-webkit-tap-highlight-color:transparent}
  body.playing #tc-jump:active{background:rgba(255,255,255,.22)}
  /* 跳跃钮让位: 右下按钮组/消息上移, 避开摇杆与跳跃区 */
  body.playing #hud-btns{bottom:118px}
  body.playing #msgs{left:148px}
}
`;

/* ==================== SVG 图标 ==================== */

const svg = (d: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const I_SUN = svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>');
const I_MOON = svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>');
const I_VOL = svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>');
const I_VOLX = svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>');
const I_HELP = svg('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>');
const I_SHIELD = svg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>');
const I_CROSSHAIR = svg('<circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/>');

/* ==================== 静态数据 ==================== */

const STATION_NAMES: Record<StationKind, string> = {
  workbench: '工作台', furnace: '熔炉', anvil: '铁砧', altar: '恶魔祭坛',
};
const KIND_LABEL: Record<ItemKind, string> = {
  block: '方块', material: '材料', tool: '工具', weapon: '武器', station: '工作站', armor: '盔甲',
};
const ARMOR_SLOT_LABEL: Record<ArmorSlot, string> = { head: '头', body: '身', legs: '腿' };
const DEV_CONTROLS_LINE = 'F 飞行 · G 刷怪 · N 昼夜切换';

/** 操作说明列表(与 React 版 GAME_CONTROLS 一致: Tab 归引擎开地图, E 开背包) */
const CONTROLS: [string, string][] = [
  ['A / D / ←→', '左右移动'],
  ['W / 空格', '跳跃'],
  ['S', '下平台'],
  ['鼠标左键', '挖掘 / 放置 / 攻击'],
  ['滚轮 / 1~0', '切换物品'],
  ['E', '打开背包'],
  ['Tab', '全屏地图'],
  ['C', '智能光标'],
  ['Esc', '暂停 / 关闭界面'],
  ['M', '静音'],
  ['H', '操作说明'],
];

/* ==================== DOM 模板 ==================== */

const helpListHTML = CONTROLS.map(([k, d]) =>
  `<li><span class="k">${k}</span><span class="d">${d}</span></li>`).join('');

const devLineHTML = `<div class="dev-line"><span class="dk">开发者</span><span class="dv">${DEV_CONTROLS_LINE}</span></div>`;

const bossTicksHTML = Array.from({ length: 9 }, (_, i) =>
  `<span class="tick" style="left:${(i + 1) * 10}%"></span>`).join('');

const sizeBtnHTML = (Object.keys(WORLD_SIZES) as WorldSize[]).map((s) => {
  const sz = WORLD_SIZES[s];
  return `<button type="button" class="size-btn" role="radio" aria-checked="false" data-size="${s}">
    <span class="nm">${sz.label}</span><span class="dim">${sz.w}×${sz.h}</span>
  </button>`;
}).join('');

const BODY_HTML = `
<canvas id="game" aria-label="泰拉瑞亚游戏画面"></canvas>

<div id="hud">
  <div id="hearts-wrap">
    <div id="hearts"></div>
    <div id="breath" style="display:none"></div>
    <div id="defense" title="防御 0">${I_SHIELD}<span class="num">0</span></div>
  </div>

  <div id="hotbar"></div>

  <div id="bossbar">
    <h2 id="boss-name"></h2>
    <div class="bar" role="progressbar" aria-label="Boss 生命值" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
      <div class="fill" id="boss-fill"></div>${bossTicksHTML}
    </div>
    <span class="num" id="boss-num"></span>
  </div>

  <div id="infobar">
    <div class="box">
      <div class="biome">森林</div>
      <div class="depth"></div>
      <div class="dn day">${I_SUN}<span class="dn-txt">白天</span></div>
    </div>
    <button type="button" id="smart-btn" aria-pressed="false" title="智能光标 (C)">${I_CROSSHAIR}<span>智能 关</span></button>
  </div>

  <div id="inv"><div class="inner">
    <div id="chest-panel">
      <div class="chest-head">
        <h2 class="inv-title">宝箱</h2>
        <button type="button" class="x-btn" id="btn-close-chest" aria-label="关闭宝箱">✕</button>
      </div>
      <div class="grid chest" id="chest-grid"></div>
    </div>
    <div class="inv-cols">
      <div class="inv-main">
        <div id="armor-row">
          <div class="lft">
            <span class="alabel">盔甲</span>
            <div class="armor-slots" id="armor-slots"></div>
          </div>
          <span class="adef" title="护甲防御值">${I_SHIELD}防御 <span class="num">0</span></span>
        </div>
        <div class="inv-head">
          <h2 class="inv-title">背包</h2>
          <div class="stations">
            <span class="station" data-st="workbench" title="工作台"><span class="dot"></span><span class="sname">工作台</span></span>
            <span class="station" data-st="furnace" title="熔炉"><span class="dot"></span><span class="sname">熔炉</span></span>
            <span class="station" data-st="anvil" title="铁砧"><span class="dot"></span><span class="sname">铁砧</span></span>
            <span class="station" data-st="altar" title="恶魔祭坛"><span class="dot"></span><span class="sname">祭坛</span></span>
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
    </div>
  </div></div>

  <div id="msgs"></div>

  <div id="hud-btns">
    <span class="hint">C 智能 · M 静音 · H 帮助</span>
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
    <button type="button" class="mbtn" id="btn-title-help">操作指南</button>
  </nav>
  <p class="ver">泰拉瑞亚 Web 复刻 v0.1 · 致敬 Re-Logic 的伟大作品</p>
</div>

<div class="ovl" id="gen">
  <div class="gen-box" role="dialog" aria-label="生成新世界">
    <div class="gen-head">
      <h2 class="gen-title">生成新世界</h2>
      <button type="button" class="x-btn" id="btn-gen-close" aria-label="关闭世界生成对话框">✕</button>
    </div>
    <div class="field">
      <span class="flabel">世界大小</span>
      <div class="sizes" role="radiogroup" aria-label="世界大小">${sizeBtnHTML}</div>
    </div>
    <label class="field" style="display:block">
      <span class="flabel">世界种子</span>
      <input type="text" class="gen-input" id="gen-seed" maxlength="32" placeholder="留空随机"
        autocomplete="off" spellcheck="false">
    </label>
    <label class="field" style="display:block">
      <span class="flabel">角色名</span>
      <input type="text" class="gen-input" id="gen-name" maxlength="12" value="泰拉行者"
        autocomplete="off" spellcheck="false">
    </label>
    <label class="dev-check">
      <input type="checkbox" id="gen-dev">
      <span>开发者模式（飞行 / 刷怪 / 昼夜切换）</span>
    </label>
    <div class="gen-btns">
      <button type="button" class="mbtn small gold" id="btn-gen-start">开始冒险</button>
      <button type="button" class="mbtn small" id="btn-gen-back">返回</button>
    </div>
    <div class="gen-spin" id="gen-spin" role="status">
      <div class="mini" aria-hidden="true"></div>
      <p>正在生成世界…</p>
    </div>
  </div>
</div>

<div class="ovl" id="dead">
  <h2><span id="dead-name">泰拉行者</span>死亡了…</h2>
  <p>即将重生</p>
</div>

<div class="ovl" id="paused">
  <div class="box">
    <h2>已暂停</h2>
    <div class="meta">
      <p class="who">玩家：<span id="paused-name">泰拉行者</span><span id="paused-seed-wrap" style="display:none"> · 种子：<span class="mono" id="paused-seed"></span></span></p>
      <span class="dev-badge" id="paused-dev">开发者模式已开启</span>
    </div>
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
    ${devLineHTML}
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
    ${devLineHTML}
    <p class="tip">本作为键盘 + 鼠标游戏：先砍树取木材制作工作台，再挖矿造更好的工具。夜晚会有敌怪出没！</p>
    <div style="margin-top:16px">
      <button type="button" class="mbtn small gold" data-close-help="1">开始冒险</button>
    </div>
  </div>
</div>

<div id="tooltip" role="tooltip"></div>
<div id="cursor-item"></div>

<!-- 触屏控制层(仅触屏设备显示) -->
<div id="tc-world" aria-hidden="true"></div>
<div id="tc-joy" aria-label="移动摇杆">
  <div id="tc-joy-knob"></div>
</div>
<button id="tc-jump" aria-label="跳跃">▲</button>
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
let lastArmorKey = '';
let lastChestKey = '';
let lastBossKey = '';
let lastSmartKey = '';
let lastDefenseKey = '';
let lastPausedKey = '';
let lastDeadKey = '';
let lastHelpDevKey = '';

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 通用槽位: dataAttrs 决定交互(背包格/盔甲槽/宝箱格), cls 追加样式(armor/gold/sel) */
function slotHTML(slot: Slot | null, dataAttrs: string, cls: string, badge: string): string {
  const icon = slot && tex.iconURL[slot.id]
    ? `<img class="icon" src="${tex.iconURL[slot.id]}" alt="" draggable="false">` : '';
  const cnt = slot && slot.count > 1
    ? `<span class="cnt${slot.count >= 100 ? ' big' : ''}">${slot.count}</span>` : '';
  const b = badge ? `<span class="badge">${badge}</span>` : '';
  return `<button type="button" class="slot${cls ? ` ${cls}` : ''}" ${dataAttrs}${
    slot ? ` data-tip-item="${slot.id}" ` : ''
  }aria-label="${slot ? esc(ItemDefs[slot.id]?.name ?? '') : '空槽位'}">${b}${icon}${cnt}</button>`;
}

/** 心形血条: 每颗 10 HP, 每行 10 颗(maxHp 200 → 两行) */
function heartsHTML(hp: number, maxHp: number): string {
  const n = Math.max(1, Math.ceil(maxHp / 10));
  let out = '';
  for (let i = 0; i < n; i += 10) {
    let row = '';
    const len = Math.min(10, n - i);
    for (let j = 0; j < len; j++) {
      const v = hp - (i + j) * 10;
      const pct = v <= 0 ? 0 : v >= 10 ? 100 : v * 10;
      row += `<div class="heart">
        <img src="${tex.heartEmptyURL}" alt="" draggable="false" aria-hidden="true">
        ${pct > 0 ? `<div class="fill" style="width:${pct}%"><img src="${tex.heartURL}" alt="" draggable="false" aria-hidden="true"></div>` : ''}
      </div>`;
    }
    out += `<div class="hrow">${row}</div>`;
  }
  return out;
}

function itemTipHTML(id: number): string {
  const d = ItemDefs[id];
  if (!d) return '';
  const stats: string[] = [];
  if (d.ranged === 'arrow' && d.dmg !== undefined) stats.push(`<span style="color:#a8d8a8">远程 · 伤害 ${d.dmg}</span>`);
  else if (d.ranged === 'bomb') stats.push(`<span style="color:#f0b090">爆炸物${d.dmg !== undefined ? ` · 伤害 ${d.dmg}` : ''}</span>`);
  else if (d.dmg !== undefined) stats.push(`伤害 ${d.dmg}`);
  if (d.kind === 'armor' && d.defense !== undefined) stats.push(`<span style="color:#9ab8e0">防御 +${d.defense}</span>`);
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
  /** 背包/宝箱任一打开时展示中下面板(打开宝箱时引擎不置 invOpen, 由 UI 合并展示) */
  const panelOpen = st.invOpen || st.chestOpen;

  // ---- 覆盖层可见性 ----
  $('hud').classList.toggle('on', playing);
  document.body.classList.toggle('playing', playing);   // 触屏控制层仅在游戏中显示
  $('title').classList.toggle('open', st.screen === 'title' && !st.loading);
  $('gen').classList.toggle('open', st.screen === 'title' && !st.loading && genOpen);
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

  // ---- 心形血条(两行) ----
  const hk = `${st.hp}/${st.maxHp}`;
  if (hk !== lastHeartsKey) {
    lastHeartsKey = hk;
    const hearts = $('hearts');
    hearts.innerHTML = heartsHTML(st.hp, st.maxHp);
    // 重放缩放动画(等价 React key={hp} 重挂载)
    hearts.classList.remove('pulse');
    void hearts.offsetWidth;
    hearts.classList.add('pulse');
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

  // ---- 防御徽章(心条旁 + 盔甲行) ----
  const dk = String(st.defense);
  if (dk !== lastDefenseKey) {
    lastDefenseKey = dk;
    const badge = $('defense');
    badge.title = `防御 ${st.defense}`;
    badge.querySelector('.num')!.textContent = String(st.defense);
    const adef = document.querySelector<HTMLElement>('#armor-row .adef');
    if (adef) adef.querySelector('.num')!.textContent = String(st.defense);
  }

  // ---- 快捷栏 + 背包格 ----
  const sk = JSON.stringify(st.slots) + '|' + st.hotbar + '|' + panelOpen;
  if (sk !== lastSlotsKey) {
    lastSlotsKey = sk;
    const hb = $('hotbar');
    hb.classList.toggle('inv-open', panelOpen);
    let hh = '';
    for (let i = 0; i < 10; i++) {
      hh += slotHTML(st.slots[i], `data-slot="${i}"`, st.hotbar === i ? 'sel' : '', String((i + 1) % 10));
    }
    hb.innerHTML = hh;
    if (panelOpen) {
      let hi = '';
      for (let i = 0; i < 10; i++) {
        hi += slotHTML(st.slots[i], `data-slot="${i}" data-inv="1"`, st.hotbar === i ? 'sel' : '', '');
      }
      $('inv-hot').innerHTML = hi;
      let bi = '';
      for (let i = 10; i < 40; i++) {
        bi += slotHTML(st.slots[i], `data-slot="${i}" data-inv="1"`, '', '');
      }
      $('inv-bag').innerHTML = bi;
    }
    $('inv').classList.toggle('open', panelOpen);
  }

  // ---- 盔甲三槽(头/身/腿) ----
  const ak = JSON.stringify(st.armor);
  if (ak !== lastArmorKey) {
    lastArmorKey = ak;
    let ah = '';
    for (const s of ['head', 'body', 'legs'] as ArmorSlot[]) {
      ah += slotHTML(st.armor[s], `data-armor="${s}"`, 'armor', ARMOR_SLOT_LABEL[s]);
    }
    $('armor-slots').innerHTML = ah;
  }

  // ---- 宝箱面板(5x4 金边格) ----
  const chk = (st.chestOpen ? '1' : '0') + JSON.stringify(st.chestSlots);
  if (chk !== lastChestKey) {
    lastChestKey = chk;
    $('chest-panel').classList.toggle('open', st.chestOpen);
    let ch = '';
    for (let i = 0; i < 20; i++) {
      ch += slotHTML(st.chestSlots[i] ?? null, `data-chest="${i}"`, 'gold', '');
    }
    $('chest-grid').innerHTML = ch;
  }

  // ---- Boss 血条(顶部中央) ----
  const bk = st.boss && st.boss.maxHp > 0
    ? `${st.boss.name}|${st.boss.hp}|${st.boss.maxHp}` : '';
  if (bk !== lastBossKey) {
    lastBossKey = bk;
    const bar = $('bossbar');
    bar.classList.toggle('open', bk !== '');
    if (bk !== '' && st.boss) {
      $('boss-name').textContent = st.boss.name;
      $('boss-num').textContent = `${st.boss.hp} / ${st.boss.maxHp}`;
      const ratio = Math.max(0, Math.min(1, st.boss.hp / st.boss.maxHp));
      ($('boss-fill') as HTMLElement).style.width = `calc((100% - 4px) * ${ratio})`;
      const track = bar.querySelector<HTMLElement>('.bar')!;
      track.setAttribute('aria-label', `${st.boss.name} 生命值`);
      track.setAttribute('aria-valuemax', String(st.boss.maxHp));
      track.setAttribute('aria-valuenow', String(st.boss.hp));
    }
  }

  // ---- 智能光标按钮 ----
  const smk = String(st.smart);
  if (smk !== lastSmartKey) {
    lastSmartKey = smk;
    const btn = $('smart-btn');
    btn.classList.toggle('on', st.smart);
    btn.setAttribute('aria-pressed', String(st.smart));
    btn.setAttribute('aria-label', st.smart ? '关闭智能光标' : '开启智能光标');
    btn.innerHTML = `${I_CROSSHAIR}<span>智能 ${st.smart ? '开' : '关'}</span>`;
  }

  // ---- 工作站指示 ----
  for (const s of ['workbench', 'furnace', 'anvil', 'altar'] as StationKind[]) {
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

  // ---- 信息条(群系/深度/昼夜) / 声音按钮 ----
  const ik = `${st.biomeName}|${st.depth}|${st.isNight}|${st.muted}`;
  if (ik !== lastInfoKey) {
    lastInfoKey = ik;
    const box = $('infobar');
    box.querySelector<HTMLElement>('.biome')!.textContent = st.biomeName;
    box.querySelector<HTMLElement>('.depth')!.textContent = st.depth >= 0 ? `${st.depth} 米` : '地表上';
    const dn = box.querySelector<HTMLElement>('.dn')!;
    dn.className = `dn ${st.isNight ? 'night' : 'day'}`;
    dn.innerHTML = `${st.isNight ? I_MOON : I_SUN}<span class="dn-txt">${st.isNight ? '夜晚' : '白天'}</span>`;
    $('btn-mute').innerHTML = st.muted ? I_VOLX : I_VOL;
    $('btn-mute').setAttribute('aria-label', st.muted ? '取消静音' : '静音');
    $('btn-sound').innerHTML =
      `<span class="row">${st.muted ? I_VOLX : I_VOL}声音：${st.muted ? '关' : '开'}</span>`;
  }

  // ---- 暂停菜单(玩家名 / 种子 / Dev 徽标) ----
  const pk = `${st.playerName}|${st.seed}|${st.devMode}`;
  if (pk !== lastPausedKey) {
    lastPausedKey = pk;
    $('paused-name').textContent = st.playerName;
    $('paused-seed').textContent = st.seed;
    $('paused-seed-wrap').style.display = st.seed ? 'inline' : 'none';
    $('paused-dev').classList.toggle('on', st.devMode);
  }

  // ---- 死亡屏玩家名 ----
  if (st.playerName !== lastDeadKey) {
    lastDeadKey = st.playerName;
    $('dead-name').textContent = st.playerName;
  }

  // ---- 帮助面板 dev 行(两个弹窗共用) ----
  const hd = String(st.devMode);
  if (hd !== lastHelpDevKey) {
    lastHelpDevKey = hd;
    for (const id of ['help-modal', 'title-help']) {
      $(id).querySelector('.dev-line')?.classList.toggle('on', st.devMode);
    }
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

/* ==================== 世界生成对话框 ==================== */

let genOpen = false;
let genSize: WorldSize = 'small';
let generating = false;

function updateGenSizes(): void {
  document.querySelectorAll<HTMLElement>('.size-btn').forEach((b) => {
    const on = b.dataset.size === genSize;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
}

function setGenGenerating(v: boolean): void {
  generating = v;
  ($('btn-gen-start') as HTMLButtonElement).disabled = v;
  ($('btn-gen-start') as HTMLButtonElement).textContent = v ? '正在生成…' : '开始冒险';
  ($('btn-gen-close') as HTMLButtonElement).disabled = v;
  ($('gen-seed') as HTMLInputElement).disabled = v;
  ($('gen-name') as HTMLInputElement).disabled = v;
  ($('gen-dev') as HTMLInputElement).disabled = v;
  document.querySelectorAll<HTMLButtonElement>('.size-btn').forEach((b) => { b.disabled = v; });
  $('gen-spin').classList.toggle('on', v);
}

function openGen(): void {
  genOpen = true;
  updateGenSizes();
  render(ui.getSnapshot());
}

function closeGen(): void {
  if (generating) return;
  genOpen = false;
  render(ui.getSnapshot());
}

/** 生成新世界并直接进入(世界生成为同步阻塞, 先让按钮状态绘制一帧再执行) */
function startGenWorld(): void {
  if (generating) return;
  setGenGenerating(true);
  const seedStr = ($('gen-seed') as HTMLInputElement).value.trim();
  const name = ($('gen-name') as HTMLInputElement).value.trim() || '泰拉行者';
  const dev = ($('gen-dev') as HTMLInputElement).checked;
  window.setTimeout(() => {
    const eng = getEngine();
    if (eng) {
      eng.newWorld(genSize, seedStr, name, dev);
      eng.enterWorld();
    }
    setGenGenerating(false);
    genOpen = false;
    render(ui.getSnapshot());
  }, 60);
}

/* ==================== 交互 ==================== */

function bindEvents(): void {
  // 槽位点击(委托: 背包格/盔甲槽/宝箱格 左右键取放, 快捷栏左键选中)
  document.addEventListener('mousedown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-slot],[data-armor],[data-chest]');
    if (!el) return;
    if (e.button !== 0 && e.button !== 2) return;
    const eng = getEngine();
    if (!eng) return;
    const right = e.button === 2;
    if (el.dataset.armor) {
      eng.clickArmorSlot(el.dataset.armor as ArmorSlot, right);
    } else if (el.dataset.chest !== undefined) {
      eng.clickChestSlot(Number(el.dataset.chest), right);
    } else {
      const i = Number(el.dataset.slot);
      if (el.dataset.inv === '1') eng.clickSlot(i, right);
      else if (e.button === 0) eng.selectHotbar(i);
    }
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // 合成点击 / 帮助关闭(委托)
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const craft = target.closest<HTMLElement>('[data-craft]');
    if (craft) getEngine()?.craft(Number(craft.dataset.craft));
    const size = target.closest<HTMLElement>('[data-size]');
    if (size) {
      genSize = size.dataset.size as WorldSize;
      updateGenSizes();
    }
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
  $('btn-regen').addEventListener('click', openGen);
  $('btn-title-help').addEventListener('click', () => { titleHelpOpen = true; render(ui.getSnapshot()); });
  $('btn-resume').addEventListener('click', () => getEngine()?.togglePause());
  $('btn-save').addEventListener('click', () => {
    const ok = getEngine()?.saveGame() ?? false;
    getEngine()?.msg(ok ? '已保存：世界与背包已写入本地存档' : '保存失败：请重试', ok ? '#8ee88e' : '#e07070');
  });
  $('btn-sound').addEventListener('click', () => getEngine()?.toggleMute());
  $('btn-quit').addEventListener('click', () => { helpOpen = false; getEngine()?.quitToTitle(); });
  $('btn-close-chest').addEventListener('click', () => getEngine()?.closeChest());

  // 世界生成对话框
  $('btn-gen-start').addEventListener('click', startGenWorld);
  $('btn-gen-back').addEventListener('click', closeGen);
  $('btn-gen-close').addEventListener('click', closeGen);

  // 键盘(UI 层按键; Tab 地图/C 智能/dev 功能由引擎 capture 阶段处理)
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const st = ui.getSnapshot();
    if (st.screen !== 'playing') return;
    const k = e.key.toLowerCase();
    if (k === 'e') {
      e.preventDefault();
      getEngine()?.toggleInventory();
    } else if (e.key === 'Escape') {
      if (helpOpen) { helpOpen = false; render(st); }
      else if (st.invOpen || st.chestOpen) getEngine()?.toggleInventory();
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

  // ---- 触屏控制: 世界触摸转发 / 虚拟摇杆 / 跳跃钮(仅触屏设备; CSS 隐藏桌面) ----
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (isTouch) {
    const eng = () => getEngine();
    // 世界触摸: 单指按住 = 该处持续使用物品(挖/攻/放)
    const world = $('tc-world') as HTMLElement;
    let worldId = -1;
    const rectOf = () => (document.querySelector('#game') as HTMLCanvasElement).getBoundingClientRect();
    world.addEventListener('pointerdown', (e) => {
      if (worldId !== -1) return;                      // 第二指忽略
      worldId = e.pointerId;
      world.setPointerCapture(e.pointerId);
      const r = rectOf();
      eng()?.touchAt(e.clientX - r.left, e.clientY - r.top, 'start');
    });
    world.addEventListener('pointermove', (e) => {
      if (e.pointerId !== worldId) return;
      const r = rectOf();
      eng()?.touchAt(e.clientX - r.left, e.clientY - r.top, 'move');
    });
    const worldUp = (e: PointerEvent): void => {
      if (e.pointerId !== worldId) return;
      worldId = -1;
      eng()?.touchAt(-1, -1, 'end');
    };
    world.addEventListener('pointerup', worldUp);
    world.addEventListener('pointercancel', worldUp);

    // 虚拟摇杆
    const joy = $('tc-joy') as HTMLElement;
    const knob = $('tc-joy-knob') as HTMLElement;
    let joyId = -1;
    const joyCenter = (): { cx: number; cy: number } => {
      const jr = joy.getBoundingClientRect();
      return { cx: jr.left + jr.width / 2, cy: jr.top + jr.height / 2 };
    };
    joy.addEventListener('pointerdown', (e) => {
      if (joyId !== -1) return;
      joyId = e.pointerId;
      joy.setPointerCapture(e.pointerId);
    });
    joy.addEventListener('pointermove', (e) => {
      if (e.pointerId !== joyId) return;
      const { cx, cy } = joyCenter();
      const max = 38;                                   // 摇杆活动半径
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const len = Math.hypot(dx, dy) || 1;
      const cl = Math.min(len, max);
      dx = (dx / len) * cl; dy = (dy / len) * cl;
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      const g = eng();
      if (g) {
        const nx = dx / max, ny = dy / max;
        g.touch.mx = Math.abs(nx) > 0.13 ? nx : 0;      // 死区
        g.touch.my = Math.abs(ny) > 0.13 ? ny : 0;
      }
    });
    const joyUp = (e: PointerEvent): void => {
      if (e.pointerId !== joyId) return;
      joyId = -1;
      knob.style.transform = 'translate(0,0)';
      const g = eng();
      if (g) { g.touch.mx = 0; g.touch.my = 0; }
    };
    joy.addEventListener('pointerup', joyUp);
    joy.addEventListener('pointercancel', joyUp);

    // 跳跃按钮
    const jump = $('tc-jump') as HTMLElement;
    let jumpId = -1;
    jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      jumpId = e.pointerId;
      const g = eng();
      if (g) g.touch.jump = true;
    });
    const jumpUp = (e: PointerEvent): void => {
      if (e.pointerId !== jumpId) return;
      jumpId = -1;
      const g = eng();
      if (g) g.touch.jump = false;
    };
    jump.addEventListener('pointerup', jumpUp);
    jump.addEventListener('pointercancel', jumpUp);
    // 切屏/隐藏时清触屏状态防卡死
    document.addEventListener('visibilitychange', () => {
      const g = eng();
      if (g && document.hidden) { g.touch.mx = 0; g.touch.my = 0; g.touch.jump = false; }
    });
  }
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
