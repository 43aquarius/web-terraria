/**
 * 泰拉瑞亚 Web — 单文件版入口
 * 用原生 DOM 复刻 React UI 层(HUD/Overlays),引擎代码直接复用 src/game/*
 * (13-c 物理/刷怪修复随 src/game/entities+engine 自动带上),由 standalone/build.ts
 * 打包内联为 public/terraria.html(素材全内嵌,仅 Google Fonts 一条外部请求)
 *
 * 13-d 同步主版 13-a/13-b UI 原版化:
 * - HUD: 快捷栏移到左上(原版蓝槽位/金色选中放大)+ 右侧物品名; 背包面板紧贴快捷栏向下
 *   展开(4x10 同列网格, 无底板); 心形 20 颗/行(小屏 10 颗换行); Boss 血条底部中央
 *   (黑底红条金边); 右上裸文字信息(小地图下方); 消息纯黑底白字; 按钮组原版蓝
 * - 标题屏: 官方 terraria_logo + 石质菜单按钮(渐变字) + 版本号/版权行 + GitHub 入口
 * - 世界生成/暂停/帮助: 原版蓝面板; 死亡屏 "{玩家名} 被杀死了…" 大红字
 * - 字体: Baloo 2 + Noto Sans SC(build 注入 Google Fonts link, 离线回退系统字体)
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
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;overscroll-behavior:none}
img{image-rendering:pixelated}
button{font:inherit}
#game{position:fixed;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
#hud{position:fixed;inset:0;pointer-events:none;display:none;z-index:35}
#hud.on{display:block}

/* ---- 原版 UI 字体(Baloo 2 近似 Andy Bold + 中文回退; Google Fonts 由 build 注入) ---- */
.terraria-font{font-family:'Baloo 2','Noto Sans SC',ui-sans-serif,system-ui,sans-serif}
/* ---- 白字黑描边(原版版本号/版权行/面板文字) ---- */
.t-stroke{text-shadow:1px 1px 0 #000,-1px 1px 0 #000,1px -1px 0 #000,-1px -1px 0 #000,
  1px 0 0 #000,-1px 0 0 #000,0 1px 0 #000,0 -1px 0 #000}

@keyframes fadein{from{opacity:0}to{opacity:1}}
@keyframes heartpulse{0%{transform:scale(1)}45%{transform:scale(1.22)}100%{transform:scale(1)}}
@keyframes msgfade{0%{opacity:0;transform:translateX(-8px)}6%{opacity:1;transform:translateX(0)}72%{opacity:1}100%{opacity:0}}
@keyframes selglow{0%,100%{box-shadow:inset 0 0 10px rgba(247,208,96,.25)}50%{box-shadow:inset 0 0 10px rgba(247,208,96,.5)}}
@keyframes spin8{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}

/* ---- 左上纵向列: 快捷栏行 → 背包面板(展开) → 心形/呼吸/防御 ---- */
#topleft{position:absolute;left:6px;top:6px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;z-index:10}
@media(min-width:1024px){#topleft{left:12px;top:12px}}
#hotbar-row{display:flex;align-items:flex-start;gap:8px;pointer-events:auto}
#hotbar{display:flex;gap:2px}
#held-name{display:none;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  padding-top:6px;font-size:14px;font-weight:700;line-height:1.25;color:#f0e8d8;text-shadow:1px 1px 0 #000}
@media(min-width:720px){#held-name.show{display:inline-block}}

/* ---- 槽位(原版经典半透明蓝 + 亮蓝边; 选中金色微放大; 宝箱金边) ---- */
.slot{position:relative;display:flex;align-items:center;justify-content:center;width:32px;height:32px;
  padding:0;border:2px solid rgba(120,140,220,.9);border-radius:3px;background:rgba(63,82,151,.8);
  cursor:pointer;transition:border-color .12s ease,background-color .12s ease,transform .12s ease}
.slot:hover{border-color:#a8bcf0}
.slot.sel{z-index:10;border-color:#f7d060;background:rgba(63,82,151,.8);
  transform:translateY(-2px) scale(1.12);animation:selglow 1.6s ease-in-out infinite}
.slot img.icon{width:20px;height:20px;pointer-events:none}
.slot .badge{position:absolute;left:3px;top:1px;font-size:9px;font-weight:700;line-height:1;
  color:rgba(255,255,255,.8);text-shadow:1px 1px 0 #000;pointer-events:none}
.slot.sel .badge{color:#fcd34d}
.slot .cnt{position:absolute;bottom:0;right:4px;font-size:11px;font-weight:700;line-height:1;
  color:#fff;text-shadow:1px 1px 0 #000;pointer-events:none}
.slot .cnt.big{font-size:8px;right:2px}
.slot.gold{border-color:#c0a050;background:rgba(40,34,18,.88)}
.slot.gold:hover{border-color:#f7d060}
.slot.gold.sel{border-color:#f7d060;background:rgba(60,48,16,.88);transform:none}
@media(min-width:1024px){.slot{width:44px;height:44px}.slot img.icon{width:28px;height:28px}}

/* ---- 背包面板(原版无底板, 槽位直浮世界; 左上锚定向下展开) ---- */
#inv{display:none;flex-direction:column;align-items:flex-start;gap:8px;max-height:calc(100vh - 13rem);
  max-width:calc(100vw - 12px);overflow-y:auto;padding-right:4px;touch-action:pan-y;
  pointer-events:auto;animation:fadein .25s ease-out}
#inv.open{display:flex}
.inv-cols{display:flex;flex-direction:column;gap:8px}
@media(min-width:1024px){.inv-cols{flex-direction:row;align-items:flex-start;gap:12px}
  #chest-panel{order:2}}
.grid{display:grid;grid-template-columns:repeat(10,32px);gap:2px;width:max-content}
.grid.chest{grid-template-columns:repeat(5,32px)}
@media(min-width:1024px){.grid{grid-template-columns:repeat(10,44px)}
  .grid.chest{grid-template-columns:repeat(5,44px)}}
#chest-panel{display:none}
#chest-panel.open{display:block}
.chest-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}
.inv-title{font-size:12px;font-weight:700;letter-spacing:.1em;color:#f0e8d8;text-shadow:1px 1px 0 #000}

/* ---- 盔甲行 + 工作站(网格下方) ---- */
#armor-row{display:flex;flex-wrap:wrap;align-items:center;column-gap:12px;row-gap:6px}
#armor-row .lft{display:flex;align-items:center;gap:6px}
#armor-slots{display:flex;gap:6px}
.alabel{font-size:12px;font-weight:700;letter-spacing:.1em;color:rgba(240,232,216,.85);
  text-shadow:1px 1px 0 #000}
.adef{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:700;line-height:1;
  color:#f0e8d8;text-shadow:1px 1px 0 #000;cursor:default;font-variant-numeric:tabular-nums}
.adef svg{width:13px;height:13px}
.stations{display:flex;align-items:center;gap:10px}
.station{display:flex;align-items:center;gap:4px}
.dot{width:8px;height:8px;border-radius:50%;background:#3a3a48}
.dot.on{background:#f7d060;box-shadow:0 0 4px rgba(247,208,96,.8)}
.sname{font-size:10px;line-height:1;color:#8a8a9a}
.sname.on{color:#f7d060}

/* ---- 合成列表(面板底部, 可滚动) ---- */
.craft-wrap{display:flex;flex-direction:column;gap:4px;width:100%}
.craft-list{display:flex;flex-direction:column;gap:4px;max-height:144px;overflow-y:auto;padding-right:4px}
@media(min-width:640px){.craft-list{max-height:176px}}
.craft-empty{padding:12px 0;font-size:12px;line-height:1.6;color:#a8b4d8;text-shadow:1px 1px 0 #000}
.craft-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;cursor:pointer;
  border:2px solid rgba(120,140,220,.55);border-radius:3px;background:rgba(63,82,151,.72);
  padding:4px 8px;transition:border-color .12s ease,background-color .12s ease}
.craft-item:hover{border-color:#f7d060;background:rgba(63,82,151,.95)}
.craft-item img{width:24px;height:24px;flex-shrink:0}
.craft-item .nm{flex:1;font-size:12px;color:#f0e8d8;text-shadow:1px 1px 0 #000;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.craft-item .x{font-size:11px;font-weight:700;color:#f7d060;text-shadow:1px 1px 0 #000}

/* ---- 心形血条(每行 20 颗, 小屏经 max-width 自动 10 颗换行) / 气泡 / 防御 ---- */
#hearts-wrap{display:flex;flex-direction:column;gap:4px}
#hearts{display:flex;flex-wrap:wrap;gap:2px;max-width:238px}
@media(min-width:1024px){#hearts{max-width:none}}
#hearts.pulse{animation:heartpulse .3s ease-out}
.heart{position:relative;width:22px;height:22px}
.heart>img{position:absolute;inset:0;width:22px;height:22px}
.heart .fill{position:absolute;inset:0;overflow:hidden}
.heart .fill img{width:22px;height:22px;display:block}
#breath{display:flex;gap:2px}
#breath .bub{width:16px;height:16px}
#defense{display:flex;align-items:center;gap:4px;font-size:13px;font-weight:700;line-height:1;
  color:#f0e8d8;text-shadow:1px 1px 0 #000;cursor:default;font-variant-numeric:tabular-nums}
#defense svg{width:14px;height:14px}

/* ---- Boss 血条(底部中央: 黑半透明底 + 红条 + 金边) ---- */
#bossbar{position:absolute;left:50%;transform:translateX(-50%);bottom:12px;display:none;
  flex-direction:column;align-items:center;gap:4px;width:min(86vw,560px);z-index:10}
#bossbar.open{display:flex}
#bossbar h2{font-size:16px;font-weight:800;letter-spacing:.1em;color:#f0e8d8;
  text-shadow:2px 2px 0 #000,-1px -1px 0 #000;text-align:center}
@media(min-width:640px){#bossbar h2{font-size:18px}}
#bossbar .bar{position:relative;height:14px;width:100%;border:2px solid #c9a227;border-radius:2px;
  background:rgba(8,6,6,.78);box-shadow:0 0 0 2px rgba(0,0,0,.75),0 2px 10px rgba(0,0,0,.6)}
#bossbar .bar .fill{position:absolute;left:2px;top:2px;bottom:2px;border-radius:1px;
  background:linear-gradient(to bottom,#e05252,#d03838 50%,#7a1414)}
#bossbar .num{font-size:11px;font-weight:700;color:#f0e8d8;font-variant-numeric:tabular-nums;
  text-shadow:1px 1px 0 #000}

/* ---- 右上信息(小地图正下方, 原版信息配件风格裸文字)+ 智能光标按钮 ---- */
#infobar{position:absolute;right:11px;top:128px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;z-index:10}
@media(min-width:768px){#infobar{top:186px}}
#infobar .info{text-align:right;font-size:11px;line-height:1.625;color:#f0e8d8;text-shadow:1px 1px 0 #000}
#infobar .depth{font-variant-numeric:tabular-nums}
#infobar .dn{display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:2px}
#infobar .dn svg{width:12px;height:12px}
#infobar .dn.day svg{color:#fcd34d}
#infobar .dn.night svg{color:#e2e8f0}
#smart-btn{display:flex;align-items:center;gap:4px;border:2px solid rgba(120,140,220,.9);border-radius:3px;
  background:rgba(63,82,151,.85);padding:4px 8px;font-size:11px;font-weight:700;line-height:1;
  color:#f0e8d8;cursor:pointer;pointer-events:auto;text-shadow:1px 1px 0 #000;
  transition:border-color .12s ease}
#smart-btn:hover{border-color:#a8bcf0}
#smart-btn svg{width:12px;height:12px}
#smart-btn.on{border-color:#f7d060;color:#f7d060}

/* ---- 消息(左下: 原版聊天风格纯半透明黑底白字) ---- */
#msgs{position:absolute;left:12px;bottom:12px;display:flex;flex-direction:column;gap:4px;max-width:70vw;z-index:10}
.msg{width:max-content;max-width:100%;overflow-wrap:break-word;background:rgba(0,0,0,.5);
  padding:2px 8px;font-size:13px;line-height:1.375;color:#fff;text-shadow:1px 1px 0 #000;
  animation:msgfade 3.5s linear forwards}

/* ---- 右下按钮组(原版蓝)+ 键盘提示 ---- */
#hud-btns{position:absolute;right:8px;bottom:8px;display:flex;align-items:center;gap:8px;z-index:10}
#hud-btns .hint{font-size:11px;color:rgba(232,228,216,.6);text-shadow:1px 1px 0 #000}
.icon-btn{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;
  border:2px solid rgba(120,140,220,.9);border-radius:3px;background:rgba(63,82,151,.85);
  color:#f0e8d8;pointer-events:auto;transition:border-color .12s ease}
.icon-btn:hover{border-color:#f7d060}
.icon-btn svg{width:15px;height:15px}

/* ---- 操作说明面板(原版蓝底) ---- */
.panel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:19rem;max-width:calc(100vw - 24px);
  border:2px solid rgba(120,140,220,.9);border-radius:6px;background:rgba(22,28,62,.96);padding:16px;
  pointer-events:auto;animation:fadein .25s ease-out;z-index:50}
.panel .p-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.panel .p-title{font-size:14px;font-weight:700;letter-spacing:.1em;color:#f0e8d8;text-shadow:1px 1px 0 #000}
.ctl-list{list-style:none;display:flex;flex-direction:column;gap:6px}
.ctl-list li{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px}
.ctl-list .k{white-space:nowrap;border:1px solid rgba(120,140,220,.6);border-radius:2px;
  background:rgba(63,82,151,.8);padding:2px 6px;font-family:ui-monospace,monospace;font-size:10px;color:#f0e8c8}
.ctl-list .d{text-align:right;color:#b8b4a8}
.dev-line{display:none;margin-top:8px;align-items:center;justify-content:space-between;gap:12px;
  border:2px solid rgba(247,208,96,.5);background:rgba(60,48,16,.45);padding:6px 8px}
.dev-line.on{display:flex}
.dev-line .dk{font-size:10px;font-weight:700;letter-spacing:.1em;color:#f7d060;text-shadow:1px 1px 0 #000}
.dev-line .dv{font-size:11px;color:#e8c878;text-align:right}
.panel .tip{margin-top:12px;border-top:1px solid rgba(120,140,220,.4);padding-top:8px;
  font-size:10px;line-height:1.7;color:#8a8a9a}

/* ---- 石质菜单按钮(原版 Terraria 1.4) ---- */
.t-menu-btn{width:100%;padding:12px 24px;font-size:17px;font-weight:700;letter-spacing:.08em;
  border:2px solid #565e78;border-radius:3px;
  background:linear-gradient(180deg,#3d4355 0%,#2b3040 100%);
  box-shadow:inset 0 2px 0 rgba(255,255,255,.12),inset 0 -3px 0 rgba(0,0,0,.35),0 2px 5px rgba(0,0,0,.45);
  cursor:pointer;transition:filter .07s linear}
.t-menu-btn-sm{padding:8px 18px;font-size:13px;letter-spacing:.06em}
.t-menu-btn:hover:not(:disabled){background:linear-gradient(180deg,#4a5266 0%,#363c50 100%);filter:brightness(1.1)}
.t-menu-btn:active:not(:disabled){transform:translateY(1px);filter:brightness(.92)}
.t-menu-btn:disabled{opacity:.55;cursor:default}
.t-menu-btn .row{display:inline-flex;align-items:center;justify-content:center;gap:8px}
/* 主推按钮(gold): 金边 + 略大 */
.t-menu-btn-gold{border-color:#a8853c;background:linear-gradient(180deg,#4a5266 0%,#333a4e 100%)}
.t-menu-btn-gold:not(.t-menu-btn-sm){padding:14px 24px;font-size:19px}
/* 按钮文字: 原版奶油→橙渐变字(drop-shadow 让渐变字带黑色投影) */
.t-btn-text{background-image:linear-gradient(180deg,#ffe9b0 30%,#f0b840 90%);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(1px 2px 0 rgba(0,0,0,.55))}
.t-btn-text-gold{background-image:linear-gradient(180deg,#fff8d0 25%,#f7c94a 90%)}
.t-menu-btn:hover:not(:disabled) .t-btn-text{background-image:linear-gradient(180deg,#ffffff 25%,#ffe9a8 90%)}
.t-menu-btn:disabled .t-btn-text{background-image:linear-gradient(180deg,#b8bcc8 30%,#8a8e9a 90%)}

/* ---- 原版蓝 UI 面板(世界生成/暂停/帮助弹窗) ---- */
.t-panel{background:rgba(28,36,74,.96);border:2px solid rgba(120,140,220,.8);border-radius:4px;
  box-shadow:0 0 0 1px rgba(0,0,0,.55),0 10px 36px rgba(0,0,0,.7)}
.t-close{background:rgba(63,82,151,.35);border:1px solid rgba(120,140,220,.8);border-radius:2px;
  color:#dfe6ff;cursor:pointer;padding:2px 8px;font-size:12px;
  transition:border-color .1s linear,color .1s linear}
.t-close:hover:not(:disabled){border-color:#f7d060;color:#f7d060}
.t-close:disabled{opacity:.5;cursor:default}
.t-input{width:100%;background:rgba(63,82,151,.35);border:2px solid rgba(120,140,220,.8);border-radius:3px;
  color:#f0f2fa;padding:6px 8px;font-size:14px;outline:none;-webkit-appearance:none;
  transition:border-color .1s linear}
.t-input::placeholder{color:rgba(165,180,225,.55)}
.t-input:focus{border-color:#f7d060}
.t-input:disabled{opacity:.55}
.t-radio{display:flex;flex-direction:column;align-items:center;gap:1px;padding:6px 4px;cursor:pointer;
  border:2px solid rgba(120,140,220,.8);border-radius:3px;background:rgba(63,82,151,.35);
  transition:border-color .1s linear}
.t-radio:hover:not(:disabled){border-color:#9cb0f0}
.t-radio.on{border-color:#f7d060;background:rgba(110,90,40,.4)}
.t-radio .nm{font-size:14px;font-weight:700;line-height:1.2;color:#f0e8c8;text-shadow:1px 1px 0 #000}
.t-radio.on .nm{color:#f7d060}
.t-radio .dim{font-size:9px;line-height:1.2;color:#9ab8e0;font-variant-numeric:tabular-nums}
.t-radio:disabled{opacity:.6;cursor:default}

/* ---- GitHub 仓库入口(标题屏右下 / 暂停菜单底部) ---- */
.gh-link{display:inline-flex;align-items:center;gap:6px;color:rgba(154,184,224,.8);
  transition:color .15s ease;pointer-events:auto;text-decoration:none}
.gh-link:hover{color:#fff}
.gh-link svg{width:16px;height:16px}
.gh-link.sm svg{width:13px;height:13px}
.gh-link span{font-size:11px;letter-spacing:.05em}

/* ---- 覆盖层 ---- */
.ovl{position:fixed;inset:0;display:none}
#title{background:rgba(0,0,0,.2);z-index:40;pointer-events:none}
#title.open{display:flex;flex-direction:column;align-items:center;padding:0 16px;animation:fadein .3s ease-out}
#title-logo{margin-top:min(12vh,80px);width:min(80vw,560px);height:auto;user-select:none;
  -webkit-user-drag:none;filter:drop-shadow(0 5px 10px rgba(0,0,0,.5))}
#title nav{display:flex;width:288px;flex-direction:column;gap:12px;pointer-events:auto;margin-top:min(6vh,48px)}
@media(min-width:640px){#title nav{width:320px}}
#title .ver{position:absolute;left:12px;bottom:8px;font-size:11px;color:#fff}
#title .copyright{position:absolute;right:12px;bottom:8px;display:flex;align-items:center;gap:8px}
#title .copyright p{font-size:10px;color:#fff}
@media(min-width:640px){#title .copyright p{font-size:11px}}

/* ---- 世界生成对话框(原版蓝面板) ---- */
#gen{background:rgba(0,0,0,.6);z-index:55;pointer-events:auto}
#gen.open{display:flex;align-items:center;justify-content:center;padding:16px;animation:fadein .3s ease-out}
.gen-box{width:22rem;max-width:100%;padding:16px}
@media(min-width:640px){.gen-box{width:25rem}}
.gen-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}
.gen-title{font-size:16px;font-weight:700;letter-spacing:.1em;color:#f7d060}
.field{margin-bottom:12px}
.flabel{display:block;font-size:12px;font-weight:700;color:#f0e8c8;margin-bottom:6px;line-height:1}
.sizes{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.dev-check{display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:16px;
  font-size:12px;line-height:1.4;color:#c8d0e8}
.dev-check input{width:16px;height:16px;flex-shrink:0;accent-color:#f7d060}
.gen-btns{display:flex;gap:8px}
.gen-btns .t-menu-btn{flex:1}
.gen-spin{display:none;margin-top:8px;align-items:center;justify-content:center;gap:8px}
.gen-spin.on{display:flex}
.gen-spin .mini{width:16px;height:16px;border:2px solid #f7d060;animation:spin8 1.2s steps(8) infinite}
.gen-spin p{font-size:11px;letter-spacing:.2em;color:#9ab8e0}

#loading{background:rgba(0,0,0,.9);z-index:60}
#loading.open{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;
  animation:fadein .3s ease-out}
.spin{width:40px;height:40px;border:4px solid #f7d060;position:relative;animation:spin8 1.2s steps(8) infinite}
.spin::after{content:'';position:absolute;left:50%;top:50%;width:12px;height:12px;
  transform:translate(-50%,-50%);background:#78a0e0}
#loading p{font-size:14px;letter-spacing:.3em;color:#fff}

/* ---- 死亡屏(原版文案 + 大红字深红描边) ---- */
#dead{background:rgba(69,10,10,.45);z-index:40}
#dead.open{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;
  animation:fadein .3s ease-out}
#dead h2{font-size:36px;font-weight:900;color:#e03c3c;text-align:center;max-width:90vw;
  text-shadow:2px 2px 0 #7a1414,-2px 2px 0 #7a1414,2px -2px 0 #7a1414,-2px -2px 0 #7a1414,
    2px 0 0 #7a1414,-2px 0 0 #7a1414,0 2px 0 #7a1414,0 -2px 0 #7a1414,
    0 6px 16px rgba(0,0,0,.8)}
@media(min-width:640px){#dead h2{font-size:60px}}
#dead p{font-size:14px;letter-spacing:.3em;color:#ffd6d6;animation:pulse 1.6s ease-in-out infinite}

/* ---- 暂停菜单(原版蓝面板 + 石质按钮 + 底部 GitHub 行) ---- */
#paused{background:rgba(0,0,0,.5);z-index:40;padding:16px}
#paused.open{display:flex;align-items:center;justify-content:center;animation:fadein .3s ease-out}
#paused .box{width:288px;max-width:100%;padding:20px}
#paused h2{margin-bottom:8px;text-align:center;font-size:18px;font-weight:700;letter-spacing:.1em;color:#f7d060}
#paused .meta{margin-bottom:16px;display:flex;flex-direction:column;align-items:center;gap:6px}
#paused .who{font-size:11px;line-height:1.6;color:#9ab8e0;text-align:center}
#paused .who .mono{font-family:ui-monospace,monospace}
#paused .dev-badge{display:none;border:1px solid rgba(247,208,96,.7);background:rgba(110,90,40,.5);
  padding:2px 8px;font-size:10px;font-weight:700;letter-spacing:.1em;color:#f7d060}
#paused .dev-badge.on{display:inline-block}
#paused .col{display:flex;flex-direction:column;gap:10px}
#paused .gh-row{margin-top:16px;display:flex;justify-content:center;
  border-top:1px solid rgba(120,140,220,.35);padding-top:12px}

/* ---- tooltip / 光标物品 ---- */
#tooltip{position:fixed;left:0;top:0;z-index:70;max-width:240px;border:2px solid rgba(120,140,220,.9);
  border-radius:3px;background:rgba(12,15,32,.94);padding:8px;opacity:0;pointer-events:none;
  transition:opacity .12s ease-out}
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
.craft-list::-webkit-scrollbar-thumb,#inv::-webkit-scrollbar-thumb{background:#788cd0}
.craft-list::-webkit-scrollbar-thumb:hover,#inv::-webkit-scrollbar-thumb:hover{background:#a8bcf0}
.craft-list{scrollbar-width:thin;scrollbar-color:#788cd0 rgba(10,12,26,.8)}
#inv{scrollbar-width:thin;scrollbar-color:#788cd0 rgba(10,12,26,.8)}

/* ---- 触屏控制层(仅触屏设备+游戏中显示; 桌面 pointer:fine 隐藏) ---- */
#tc-world,#tc-joy,#tc-jump{display:none}
@media (pointer:coarse){
  body.playing #tc-world{display:block;position:fixed;inset:0;pointer-events:auto;touch-action:none;z-index:30}
  body.playing #tc-joy{display:flex;position:fixed;left:max(16px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));width:116px;height:116px;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(255,255,255,.08);backdrop-filter:blur(2px);align-items:center;justify-content:center;pointer-events:auto;touch-action:none;z-index:40}
  #tc-joy-knob{width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,.3);border:2px solid rgba(255,255,255,.45);pointer-events:none;transform:translate(0,0)}
  body.playing #tc-jump{display:flex;position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(24px,env(safe-area-inset-bottom));width:84px;height:84px;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(255,255,255,.1);color:rgba(255,255,255,.75);font-size:26px;align-items:center;justify-content:center;pointer-events:auto;touch-action:none;z-index:40;-webkit-tap-highlight-color:transparent}
  body.playing #tc-jump:active{background:rgba(255,255,255,.22)}
  /* 13-a coarse 让位: 按钮组抬到跳跃钮上方 / 隐藏键盘提示 / 触达≥44px / 消息抬到摇杆上方 / 面板限高 60vh */
  #hud-btns{bottom:calc(env(safe-area-inset-bottom,0px) + 128px)}
  #hud-btns .hint{display:none}
  .icon-btn{min-width:44px;min-height:44px}
  #msgs{bottom:calc(env(safe-area-inset-bottom,0px) + 152px)}
  #inv{max-height:60vh}
}
`;

/* ==================== SVG 图标(lucide 同款 path) ==================== */

const svg = (d: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const I_SUN = svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>');
const I_MOON = svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>');
const I_VOL = svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>');
const I_VOLX = svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>');
const I_HELP = svg('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>');
const I_SHIELD = svg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>');
const I_CROSSHAIR = svg('<circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/>');
const I_BACKPACK = svg('<path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M8 21v-5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v5"/><path d="M8 10h8"/>');
const I_GITHUB = svg('<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>');

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

/** 标题屏 logo(build 注入的 base64 优先, 网页版回退 /assets) */
const EMBEDDED_ASSETS = (typeof window !== 'undefined'
  ? (window as unknown as { __TERRARIA_ASSETS__?: Record<string, string> }).__TERRARIA_ASSETS__
  : undefined);
const LOGO_SRC: string = EMBEDDED_ASSETS?.terraria_logo ?? '/assets/terraria_logo.png';

/* ==================== DOM 模板 ==================== */

const helpListHTML = CONTROLS.map(([k, d]) =>
  `<li><span class="k">${k}</span><span class="d">${d}</span></li>`).join('');

const devLineHTML = `<div class="dev-line"><span class="dk">开发者</span><span class="dv">${DEV_CONTROLS_LINE}</span></div>`;

const sizeBtnHTML = (Object.keys(WORLD_SIZES) as WorldSize[]).map((s) => {
  const sz = WORLD_SIZES[s];
  return `<button type="button" class="t-radio" role="radio" aria-checked="false" data-size="${s}">
    <span class="nm">${sz.label}</span><span class="dim">${sz.w}×${sz.h}</span>
  </button>`;
}).join('');

const GH_REPO_URL = 'https://github.com/43aquarius/web-terraria';
const ghLinkHTML = (small: boolean): string =>
  `<a class="gh-link${small ? ' sm' : ''}" href="${GH_REPO_URL}" target="_blank" rel="noopener noreferrer" aria-label="GitHub 仓库">${I_GITHUB}${small ? '<span>web-terraria</span>' : ''}</a>`;

const BODY_HTML = `
<canvas id="game" aria-label="泰拉瑞亚游戏画面"></canvas>

<div id="hud">
  <div id="topleft">
    <div id="hotbar-row">
      <div id="hotbar"></div>
      <span id="held-name" class="terraria-font"></span>
    </div>

    <div id="inv">
      <div class="inv-cols">
        <div id="chest-panel">
          <div class="chest-head">
            <h2 class="inv-title terraria-font">宝箱</h2>
            <button type="button" class="t-close" id="btn-close-chest" aria-label="关闭宝箱">✕</button>
          </div>
          <div class="grid chest" id="chest-grid"></div>
        </div>
        <div class="grid" id="inv-bag"></div>
      </div>
      <div id="armor-row">
        <div class="lft">
          <span class="alabel terraria-font">盔甲</span>
          <div id="armor-slots"></div>
        </div>
        <span class="adef" title="护甲防御值">${I_SHIELD}<span>防御 </span><span class="num">0</span></span>
        <div class="stations">
          <span class="station" data-st="workbench" title="工作台"><span class="dot"></span><span class="sname">工作台</span></span>
          <span class="station" data-st="furnace" title="熔炉"><span class="dot"></span><span class="sname">熔炉</span></span>
          <span class="station" data-st="anvil" title="铁砧"><span class="dot"></span><span class="sname">铁砧</span></span>
          <span class="station" data-st="altar" title="恶魔祭坛"><span class="dot"></span><span class="sname">祭坛</span></span>
        </div>
      </div>
      <div class="craft-wrap">
        <h2 class="inv-title terraria-font">合成</h2>
        <div class="craft-list" id="craft"></div>
      </div>
    </div>

    <div id="hearts-wrap">
      <div id="hearts"></div>
      <div id="breath" style="display:none"></div>
      <div id="defense" title="防御 0">${I_SHIELD}<span class="num">0</span></div>
    </div>
  </div>

  <div id="bossbar">
    <h2 id="boss-name" class="terraria-font"></h2>
    <div class="bar" role="progressbar" aria-label="Boss 生命值" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
      <div class="fill" id="boss-fill"></div>
    </div>
    <span class="num" id="boss-num"></span>
  </div>

  <div id="infobar">
    <div class="info">
      <div class="biome">森林</div>
      <div class="depth"></div>
      <div class="dn day">${I_SUN}<span class="dn-txt">白天</span></div>
    </div>
    <button type="button" id="smart-btn" class="terraria-font" aria-pressed="false" title="智能光标 (C)">${I_CROSSHAIR}<span>智能 关</span></button>
  </div>

  <div id="msgs"></div>

  <div id="hud-btns">
    <span class="hint">C 智能 · M 静音 · H 帮助</span>
    <button type="button" class="icon-btn" id="btn-inv" aria-label="打开背包">${I_BACKPACK}</button>
    <button type="button" class="icon-btn" id="btn-mute" aria-label="静音"></button>
    <button type="button" class="icon-btn" id="btn-help" aria-label="操作说明">${I_HELP}</button>
  </div>
</div>

<div class="ovl terraria-font" id="title">
  <img id="title-logo" src="${LOGO_SRC}" alt="Terraria" width="628" height="193" draggable="false">
  <nav aria-label="主菜单">
    <button type="button" class="t-menu-btn t-menu-btn-gold" id="btn-enter"><span class="t-btn-text t-btn-text-gold">进入世界</span></button>
    <button type="button" class="t-menu-btn" id="btn-continue" style="display:none"><span class="t-btn-text">继续上次冒险</span></button>
    <button type="button" class="t-menu-btn" id="btn-regen"><span class="t-btn-text">生成新世界</span></button>
    <button type="button" class="t-menu-btn" id="btn-title-help"><span class="t-btn-text">操作指南</span></button>
  </nav>
  <p class="ver t-stroke">Web 复刻版 v0.2</p>
  <div class="copyright">
    <p class="t-stroke">Copyright © Re-Logic — Web 复刻致敬之作</p>
    ${ghLinkHTML(false)}
  </div>
</div>

<div class="ovl terraria-font" id="gen">
  <div class="gen-box t-panel" role="dialog" aria-label="生成新世界">
    <div class="gen-head">
      <h2 class="gen-title t-stroke">生成新世界</h2>
      <button type="button" class="t-close" id="btn-gen-close" aria-label="关闭世界生成对话框">✕</button>
    </div>
    <div class="field">
      <span class="flabel t-stroke">世界大小</span>
      <div class="sizes" role="radiogroup" aria-label="世界大小">${sizeBtnHTML}</div>
    </div>
    <label class="field" style="display:block">
      <span class="flabel t-stroke">世界种子</span>
      <input type="text" class="t-input" id="gen-seed" maxlength="32" placeholder="留空随机"
        autocomplete="off" spellcheck="false">
    </label>
    <label class="field" style="display:block">
      <span class="flabel t-stroke">角色名</span>
      <input type="text" class="t-input" id="gen-name" maxlength="12" value="泰拉行者"
        autocomplete="off" spellcheck="false">
    </label>
    <label class="dev-check">
      <input type="checkbox" id="gen-dev">
      <span>开发者模式（飞行 / 刷怪 / 昼夜切换）</span>
    </label>
    <div class="gen-btns">
      <button type="button" class="t-menu-btn t-menu-btn-gold t-menu-btn-sm" id="btn-gen-start"><span class="t-btn-text t-btn-text-gold">开始冒险</span></button>
      <button type="button" class="t-menu-btn t-menu-btn-sm" id="btn-gen-back"><span class="t-btn-text">返回</span></button>
    </div>
    <div class="gen-spin" id="gen-spin" role="status">
      <div class="mini" aria-hidden="true"></div>
      <p class="t-stroke">正在生成世界…</p>
    </div>
  </div>
</div>

<div class="ovl terraria-font" id="dead">
  <h2><span id="dead-name">泰拉行者</span> 被杀死了…</h2>
  <p class="t-stroke">即将重生…</p>
</div>

<div class="ovl terraria-font" id="paused">
  <div class="box t-panel">
    <h2 class="t-stroke">已暂停</h2>
    <div class="meta">
      <p class="who t-stroke">玩家：<span id="paused-name">泰拉行者</span><span id="paused-seed-wrap" style="display:none"> · 种子：<span class="mono" id="paused-seed"></span></span></p>
      <span class="dev-badge t-stroke" id="paused-dev">开发者模式已开启</span>
    </div>
    <div class="col">
      <button type="button" class="t-menu-btn t-menu-btn-sm" id="btn-resume"><span class="t-btn-text">继续游戏</span></button>
      <button type="button" class="t-menu-btn t-menu-btn-sm" id="btn-save"><span class="t-btn-text">保存游戏</span></button>
      <button type="button" class="t-menu-btn t-menu-btn-sm" id="btn-sound"></button>
      <button type="button" class="t-menu-btn t-menu-btn-sm" id="btn-quit"><span class="t-btn-text">回到标题</span></button>
    </div>
    <div class="gh-row">${ghLinkHTML(true)}</div>
  </div>
</div>

<div class="ovl terraria-font" id="loading" style="z-index:60">
  <div class="spin" aria-hidden="true"></div>
  <p id="loading-text" class="t-stroke" role="status">正在生成世界…</p>
</div>

<div id="help-modal" style="display:none">
  <div class="panel terraria-font">
    <div class="p-head">
      <h2 class="p-title">操作说明</h2>
      <button type="button" class="t-close" data-close-help="1" aria-label="关闭操作说明">✕</button>
    </div>
    <ul class="ctl-list">${helpListHTML}</ul>
    ${devLineHTML}
    <p class="tip">键盘 + 鼠标游戏：先砍树取木材制作工作台，再挖矿造更好的工具。夜晚会有敌怪出没！</p>
  </div>
</div>

<div id="title-help" style="display:none">
  <div class="panel terraria-font">
    <div class="p-head">
      <h2 class="p-title">操作说明</h2>
      <button type="button" class="t-close" data-close-help="1" aria-label="关闭操作说明">✕</button>
    </div>
    <ul class="ctl-list">${helpListHTML}</ul>
    ${devLineHTML}
    <p class="tip">本作为键盘 + 鼠标游戏：先砍树取木材制作工作台，再挖矿造更好的工具。夜晚会有敌怪出没！</p>
    <div style="margin-top:16px">
      <button type="button" class="t-menu-btn t-menu-btn-sm" data-close-help="1"><span class="t-btn-text">开始冒险</span></button>
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

/** 通用槽位: dataAttrs 决定交互(背包格/盔甲槽/宝箱格), cls 追加样式(sel/gold) */
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

/** 心形血条: 每颗 10 HP; 20 颗/行(lg+ 单行, 小屏经 max-width 238px 自动 10 颗换行) */
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
  /** 背包/宝箱任一打开时展示左上面板(打开宝箱时引擎不置 invOpen, 由 UI 合并展示) */
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

  // ---- 心形血条(20 颗/行, 小屏自动换行) ----
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

  // ---- 防御徽章(心条下方 + 盔甲行) ----
  const dk = String(st.defense);
  if (dk !== lastDefenseKey) {
    lastDefenseKey = dk;
    const badge = $('defense');
    badge.title = `防御 ${st.defense}`;
    badge.querySelector('.num')!.textContent = String(st.defense);
    const adef = document.querySelector<HTMLElement>('#armor-row .adef');
    if (adef) adef.querySelector('.num')!.textContent = String(st.defense);
  }

  // ---- 快捷栏(第 0 行, 面板打开时切背包语义)+ 背包 1-3 行 + 手持物品名 ----
  const sk = JSON.stringify(st.slots) + '|' + st.hotbar + '|' + panelOpen;
  if (sk !== lastSlotsKey) {
    lastSlotsKey = sk;
    let hh = '';
    for (let i = 0; i < 10; i++) {
      hh += slotHTML(st.slots[i], `data-slot="${i}"${panelOpen ? ' data-inv="1"' : ''}`,
        st.hotbar === i ? 'sel' : '', String((i + 1) % 10));
    }
    $('hotbar').innerHTML = hh;
    if (panelOpen) {
      let bi = '';
      for (let i = 10; i < 40; i++) {
        bi += slotHTML(st.slots[i], `data-slot="${i}" data-inv="1"`, '', '');
      }
      $('inv-bag').innerHTML = bi;
    }
    $('inv').classList.toggle('open', panelOpen);
    const held = st.slots[st.hotbar] ?? null;
    const heldName = held ? (ItemDefs[held.id]?.name ?? '') : '';
    const hn = $('held-name');
    if (hn.textContent !== heldName) hn.textContent = heldName;
    hn.classList.toggle('show', heldName !== '');
  }

  // ---- 盔甲三槽(头/身/腿) ----
  const ak = JSON.stringify(st.armor);
  if (ak !== lastArmorKey) {
    lastArmorKey = ak;
    let ah = '';
    for (const s of ['head', 'body', 'legs'] as ArmorSlot[]) {
      ah += slotHTML(st.armor[s], `data-armor="${s}"`, '', ARMOR_SLOT_LABEL[s]);
    }
    $('armor-slots').innerHTML = ah;
  }

  // ---- 宝箱面板(5x4 金边格; 小屏在网格上方, lg 在右侧) ----
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

  // ---- Boss 血条(底部中央) ----
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
      ? `<p class="craft-empty">暂无可合成物品,收集材料或靠近工作台试试</p>`
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

  // ---- 右上信息(裸文字) / 声音按钮 / 背包按钮 ----
  const ik = `${st.biomeName}|${st.depth}|${st.isNight}|${st.muted}|${st.invOpen}`;
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
    $('btn-inv').setAttribute('aria-label', st.invOpen ? '关闭背包' : '打开背包');
    $('btn-sound').innerHTML =
      `<span class="t-btn-text"><span class="row"><span style="color:#f0b840;display:inline-flex">${st.muted ? I_VOLX : I_VOL}</span>声音：${st.muted ? '关' : '开'}</span></span>`;
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
  document.querySelectorAll<HTMLElement>('.t-radio[data-size]').forEach((b) => {
    const on = b.dataset.size === genSize;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
}

function setGenGenerating(v: boolean): void {
  generating = v;
  ($('btn-gen-start') as HTMLButtonElement).disabled = v;
  const label = $('btn-gen-start').querySelector('.t-btn-text');
  if (label) label.textContent = v ? '正在生成…' : '开始冒险';
  ($('btn-gen-close') as HTMLButtonElement).disabled = v;
  ($('gen-seed') as HTMLInputElement).disabled = v;
  ($('gen-name') as HTMLInputElement).disabled = v;
  ($('gen-dev') as HTMLInputElement).disabled = v;
  document.querySelectorAll<HTMLButtonElement>('.t-radio[data-size]').forEach((b) => { b.disabled = v; });
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
  // 槽位点击(委托: 背包格/盔甲槽/宝箱格 左右键取放; 快捷栏在面板打开时即背包第 0 行)
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

  // 合成点击 / 尺寸选择 / 帮助关闭(委托)
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
  $('btn-inv').addEventListener('click', () => getEngine()?.toggleInventory());
  $('btn-mute').addEventListener('click', () => getEngine()?.toggleMute());
  $('btn-help').addEventListener('click', () => { helpOpen = !helpOpen; render(ui.getSnapshot()); });
  $('smart-btn').addEventListener('click', () => getEngine()?.toggleSmart());
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
