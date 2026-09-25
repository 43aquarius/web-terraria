# 泰拉瑞亚 Web 复刻 — 共享工作日志

项目：在 Next.js 16 (App Router, / 路由) 上复刻 Web 版泰拉瑞亚（2D 沙盒：世界生成、挖掘/放置、光照、昼夜、敌怪、背包合成等）。

美术方案决策：不抓取网络上的原版素材（版权风险 + 加载不可靠），全部采用**程序化像素美术**（代码生成泰拉瑞亚风格的 16x16 方块贴图、工具图标、角色绘制），风格高度还原且零外部依赖。

---
Task ID: 1
Agent: main
Task: 项目探索与总体规划

Work Log:
- 确认 Next.js 16.1.3 dev server 已运行于 3000 端口（Turbopack）
- 确认 shadcn/ui 齐全、Tailwind 4、TypeScript 5
- 确定架构：纯客户端 Canvas 游戏（src/game/* 引擎模块 + src/components/game/* React UI），无后端需求，localStorage 存档

Stage Summary:
- 模块划分：constants(方块/物品/配方) / textures(程序化像素画) / world(生成+水+存档) / lighting(RGB光照) / sprites(角色绘制) / entities(玩家/敌怪/掉落/粒子) / engine(主循环) / sky(天空背景-子任务) / sound(音效-子任务)
- 世界规格：1100x340 tiles, 16px/tile；昼夜周期 480s（白天300s+黑夜180s）
- 游戏特性清单：地形+洞穴+矿脉+树+水潭生成、彩色平滑光照、昼夜循环、挖掘/放置、砍树、合成链(工作台→熔炉→铁砧→铁/银金工具)、4种敌怪(绿/蓝史莱姆、僵尸、恶魔眼)、背包40格+合成UI、生命/呼吸/摔落伤害、小地图、自动存档

---
Task ID: 2-b
Agent: general-purpose (sky)
Task: 创建 src/game/sky.ts 天空/昼夜/视差背景模块

Work Log:
- 阅读 worklog.md 了解项目背景（纯客户端 Canvas 泰拉瑞亚复刻、程序化像素美术、昼夜 480s = 白天 300s + 黑夜 180s）
- 创建 src/game/sky.ts（本次唯一新增/改动文件），导出 SkyState 接口 + drawSkyBackground(ctx, W, H, s)
- 天空渐变：9 个昼夜关键帧（t=0/0.08 黎明、0.12/0.5 白天、0.57/0.625 黄昏、0.75/0.95 深夜、1.0 回黎明色保证 0/1 环绕无缝），每帧线性 lerp RGB 就地写入模块级 palette（零分配），createLinearGradient 填顶部→地平线
- 星星：mulberry32(12345) 懒初始化 140 颗（x 0..1 / y 0..0.75 / 1-2px / 闪烁相位），alpha = night×(0.55+0.45×sin(timeSec×2+phase))，camX 视差 0.02 取模平铺；nightFactor = dayT smoothstep（0.625→0.75 渐入、0.75~0.95 全亮、0.95→1 渐出）× clamp(1-skyLight×1.5) 保险
- 太阳（dayT 0..0.625）/ 月亮（0.625..1）共用圆弧：angle=π(1-progress)，x=W/2+cos·0.55W，y=0.62H−sin·0.5H；太阳 = 70px 径向光晕(#fffbe8→透明) + 外圈 #ffd75e r19 + 中心 #fff3c0 r16；月亮 = #e8ecf0 r13 + 5 个 #b8c0cc 陨石坑 + 40px 微弱冷光晕（月相不做）
- 云：mulberry32(20240601) 预生成 10 朵 offscreen sprite（96×36 低分辨率 = 6~9 个重叠白椭圆(alpha 0.92)+底部扁平化，绘制时 ×2 最近邻放大保持像素块感），三层视差 0.04/0.08/0.14、层透明系数 0.6/0.8/1.0（远层更小更透明）、速度 4~10px/s 向右、y 0.05~0.45H（远层偏上）；屏幕位置 = (baseX×W − camX×视差 + timeSec×speed) mod W，左右溢出各补一份无缝平铺；染色用共享 scratch 画布 + source-in 合成（白天纯白 α0.85 / 黎明黄昏 #ffd8b0 α0.8 / 黑夜 #1a2233 α0.5）
- 远山：两层各 512 采样点山脊噪声（genRidge 种子 1337/9527：0.5+0.28sin+0.18sin1.7+0.09sin3.1 再 clamp，周期 5120 世界像素），4px 列步进画实心剪影多边形；远层视差 0.06/基线 0.74H/振幅 0.26H，近层 0.13/0.90H/0.36H；基线随 depthPx 上移（×0.08/×0.12，入地时山移出画面，空中时下沉）；颜色随昼夜插值（远：白天 #7da8c9/黄昏 #6b5a8e/夜 #141b2c；近：#4a7a5e/#4a3d66/#0d1420；黎明取过渡紫）
- 地下渐隐：最后叠 #030408 黑罩，alpha = clamp(depthPx/600)×0.92（depth≥600 近全黑，洞穴壁叠加自然）
- 类型检查：bunx tsc --noEmit --strict --skipLibCheck --target es2020 --lib es2020,dom src/game/sky.ts 通过（skipLibCheck 只为跳过 @types/node/react 的环境性 d.ts 报错，sky.ts 本身仍全 strict 检查，无 any、无未使用变量）
- 冒烟测试（临时文件放在项目外 /home/z/sky_smoke.ts，验证后已删除）：mock document/canvas 共 35 项断言全部通过——各关键帧渐变色精确匹配、星星数量/区域/闪烁/白天消失/skyLight 压制、太阳月亮位置半径、云三层透明度与平铺覆盖、山脊采样数与 depthPx 上移、黑罩 α=0.92/0.46、2000 帧随机状态（含 ±100 万像素 camX、负 depth）无 NaN 无异常

Stage Summary:
- 交付：src/game/sky.ts（约 430 行，TypeScript strict，纯 Canvas 2D，无依赖、无 React、无 any、每帧无大数组分配、不用 shadowBlur）
- 导出 API：interface SkyState { dayT; skyLight; camX; camY; depthPx; timeSec }；drawSkyBackground(ctx: CanvasRenderingContext2D, W: number, H: number, s: SkyState): void —— 每帧调用，画满 (0,0,W,H)
- 绘制顺序：天空渐变 → 星星 → 太阳/月亮 → 三层视差云 → 两层远山剪影 → 地下黑罩；星星/云/山脊全部固定种子懒初始化一次，帧间确定性可复现
- 关键决策：① 云用 baseX∈[0,1]×W 而非固定像素 cloudX，任意画布宽度下都能均匀铺满；② 云染色走 96×36 共享 scratch + source-in，每帧最多 10 次小画布操作；③ 山的垂直视差用 depthPx（= camY − 地表Y）表达，SkyState.camY 字段保留给引擎其他系统；④ 0.95→1.0 设计成"黎明前微光"过渡，使昼夜环绕处颜色连续
- 引擎对接提示：白天 = dayT∈[0,0.625)、黑夜 = [0.625,1)；按 480s 周期线性映射 dayT 即可；skyLight 高会额外压制星星；depthPx<0（升空）时无黑罩、山下沉，行为均已处理

---
Task ID: 3-b
Agent: general-purpose (UI)
Task: React UI 层(GameCanvas/HUD/Overlays/page)

Work Log:
- 阅读 worklog 与四个接口文件(store.ts/constants.ts/textures.ts/engine.ts 存根),确认 UIState 字段、ItemDefs/RECIPES、iconURL/heartURL/bubbleURL、EngineAPI 签名
- 创建 src/components/game/GameCanvas.tsx:useEffect 中 new GameEngine(canvas) + mount(),卸载 unmount();canvas 绝对铺满 + cursor-crosshair,DPR/resize 交给引擎
- 创建 src/components/game/HUD.tsx(约 620 行,'use client',仅 screen==='playing'/'dead' 渲染,外层 pointer-events-none):
  - 心形血条 10 颗(每颗 10HP,半心用 overflow-hidden 50% 宽度裁剪),key=hp 重挂载实现血量变化缩放动画;气泡条 8 个按 breath 比例显隐
  - 快捷栏顶部中央 10 格(移动端 32/36px、sm 44px,深蓝底金选中边+内发光,数量角标+数字键角标 1-0,点击 engine.selectHotbar)
  - 背包面板(bottom-12 中下方,4x10 格,第 0 行与 1-3 行之间分隔线,站点状态三点工作台/熔炉/铁砧金色指示);槽位点击用 onMouseDown(button 0/2)路由 engine.clickSlot(i, right) + onContextMenu 仅 preventDefault(右键不会重复触发)
  - 合成面板列 craftables 中 can===true 项(RECIPES 取名/图标,点击 engine.craft(index),max-h-72 自定义细滚动条,空列表有引导文案)
  - 物品/配方 tooltip:fixed 跟随鼠标(直接操作 DOM transform,避免 HUD 整体重渲染),含名称(金)、kind 标签(工具带镐/斧后缀)、伤害/挖掘力/使用间隔、desc、配方材料明细+站点需求
  - 光标物品 cursorItem fixed 跟随鼠标 z-50;消息左下最近 6 条 3.5s CSS 动画淡出;右上信息条(小地图下方 top-176px)深度+昼夜(Sun/Moon lucide 14px);右下 Volume/HelpCircle 按钮 + "M 静音 · H 帮助"
  - 键盘(仅 playing):E/Tab 开关背包(preventDefault Tab)、Esc(先关帮助→关背包→togglePause)、M 静音、H 帮助、数字 1-0(未暂停时 selectHotbar),检查 e.target 非 INPUT/TEXTAREA、e.repeat 忽略
  - 自定义 CSS 注入(style 标签):hud-heart-pulse/hud-msg/hud-fade-in 关键帧 + hud-scroll 细滚动条,不改 globals.css
- 创建 src/components/game/Overlays.tsx:loading(bg-black/90 + steps(8) 像素旋转方块 + loadingText 默认"正在生成世界…")、标题屏(TERRARIA 大标题多层硬阴影 #4ec44e、bg-black/30 暗化、进入世界(金)/继续上次冒险(hasSave)/生成新世界/操作说明、底部版本致敬语)、死亡屏(bg-red-950/60 "你已死亡…"+"即将重生" animate-pulse)、暂停菜单(继续/保存(saveGame 布尔值 toast 已保存/保存失败)/静音(显示 muted 状态)/回标题)、标题屏帮助弹窗(复用 HUD 导出的 GAME_CONTROLS),全部 fade-in
- 重写 src/app/page.tsx 为全屏游戏入口(fixed inset-0 黑底 select-none,GameCanvas/HUD/Overlays 依次叠加,无 footer);layout.tsx 仅改 metadata(title "泰拉瑞亚 Web · Terraria Clone" + 中文 description),其余(字体/Toaster)不动
- 修复两个真实问题:① react-hooks/set-state-in-effect 报错——贴图改模块级 texCache + useSyncExternalStore(subscribe/getSnapshot/getServerSnapshot),effect 内生成后通知监听者;② SSR 500 "Missing getServerSnapshot"(React 19 服务端渲染必需第三参)——导出 useUIState() 钩子(第三参传 ui.getSnapshot 作为 SSR 初始快照,服务端/客户端水合一致),HUD 与 Overlays 共用
- 验证:bun run lint 0 error 0 warning;bunx tsc 对 5 个 UI 文件 0 错误(剩余错误均在主代理并行中的 src/game/* 与 examples/skills,按要求忽略);curl / 路由 HTTP 200,标题/画布/标题屏均正常渲染
- 重要环境发现:工具调用结果的回显会把相邻的"[h"两个字符吞掉(仅影响回显显示,磁盘字节完好,已用十六进制逐字节校验)。若看到源码显示成"const elpOpen"这类缺字符的样子,那是显示层假象,请用 hex/布尔断言校验磁盘真实内容,不要盲目重写文件

Stage Summary:
- 产出文件:src/components/game/GameCanvas.tsx、src/components/game/HUD.tsx、src/components/game/Overlays.tsx、src/app/page.tsx(重写)、src/app/layout.tsx(仅 metadata);另创建 agent-ctx/3-b-general-purpose.md 工作记录
- 关键决策:① HUD 导出 GAME_CONTROLS(操作说明数据)与 useUIState(带 SSR 快照的 store 订阅钩子)供 Overlays 复用,避免双份维护;② tooltip/光标物品位置用 ref 直改 DOM transform,鼠标移动不触发 React 重渲染;③ 槽位交互统一 onMouseDown(button 0/2),onContextMenu 只 preventDefault;④ UI 键盘仅在 playing 屏生效,移动/挖掘/滚轮等输入完全归引擎,避免双处理;⑤ 小屏策略:格子 32px(<400px)/36px/44px(sm+),背包 bottom 锚定 + max-h 滚动,心条在 <lg 屏移到快捷栏下方避免与居中快捷栏重叠
- 引擎对接约定(请主代理注意):① engine.ts 存根中 inst 从未赋值,所有 engine.xxx() 目前是空操作,实现时请在构造或 mount 里 inst = this;② E/Tab/Esc/M/H/数字键归 React UI 层处理,引擎请勿重复响应;滚轮切换物品假定由引擎 canvas 监听;③ Esc 在 invOpen 时 UI 会调 toggleInventory 关背包、否则 togglePause,请保证幂等;④ craft(index)/clickSlot(i,right) 语义按存根注释;⑤ getTextures() 会在 HUD 挂载(标题屏)时生成并缓存,引擎直接命中同一缓存;⑥ 右上角 256x168 为引擎小地图区域,信息条已放在其下方(top-176px)

---
Task ID: 3-a / 3-c / 4
Agent: main
Task: 引擎主逻辑(engine.ts) + 渲染管线(render.ts) + 端到端集成验证

Work Log:
- 阅读 worklog 与全部已有模块(constants/world/textures/lighting/sprites/entities/sound/sky/store),先写 API 存根让 UI 子代理(3-b)并行开工,再写完整实现
- engine.ts(~1160 行):主循环(60Hz fixed timestep + rAF)、输入(WASD/空格/鼠标/滚轮)、挖掘(工具匹配/伤害累积/裂纹/整树砍伐 fellTree/家具组清除)、放置(多格家具 FURNITURE_SHAPE/支撑判定/实体重叠检查)、战斗(挥砍 swing/暴击/击退/敌怪掉落)、敌怪 AI 调度与昼夜生成(白天史莱姆≤4/夜晚僵尸+恶魔眼+蓝史莱姆≤8,白天夜怪消散)、掉落物磁吸拾取(52px 磁吸/14px 拾取/背包满回退)、背包 40 格(addItem/removeItems/点击交换/右键拆半)、合成(站点检测 4 格半径/15 配方)、呼吸溺水/摔落伤害/生命再生/死亡重生(spawnProt 600 帧 + 重生点清怪防死循环)、RLE+localStorage 存档(125KB)、小地图(ImageData 逐像素/onTileChanged 局部更新/玩家敌怪出生点标记)、UI 同步(脏检查 diff patch,useSyncExternalStore)
- render.ts(~300 行):天空(sky.ts)→ 背景墙 → 瓦片(草覆盖层/树叶 16 mask 变体/树枝/家具整图/水面高光/火把火焰 4 帧)→ 挖掘裂纹 4 阶段 → 掉落物浮动 → 敌怪(史莱姆果冻 squish/僵尸/恶魔眼翅膀)→ 玩家(挥武器旋转)→ 粒子 → 彩色平滑光照罩(computeLight 低分辨率画布双线性放大)→ 火把/熔炉 additive 暖光晕 → 伤害数字/血条 → 金色鼠标格高亮 → 水下蓝罩/受伤红闪/低血量 vignette → 小地图
- 修复既有模块类型错误:world.ts(W_NONE 导入/字面量类型/水塘 nx 作用域/RLE 返回类型)、textures.ts(熔炉砖缝 by 作用域/草地 px 少参数)
- agent-browser + VLM 端到端验证:标题屏(黄昏天空/像素云/月亮/TERRARIA 金字)→ 进入世界(初始装备铜镐/斧/剑)→ 键盘移动+相机跟随 → 挖掘→掉落→磁吸拾取→入库→DOM 快捷栏图标同步 → 放置方块(消耗物品)→ 砍树(整树掉 9 木头)→ 合成工作台(徒手)→ 放置工作台(stations 检测)→ 合成木剑(需工作台)→ 战斗(伤害 16→7→死亡/击退/凝胶掉落)→ 存档 125KB → reload → 读档恢复(位置/时间/物品)→ 夜晚快进(僵尸+恶魔眼+蓝史莱姆生成/深色天空/月亮星星/玩家光照)→ 火把放置(火焰动画+光晕)→ 移动端 375x667 无溢出无横向滚动
- 排障记录:中途"slots 不同步/玩家不动/掉落物不拾取"三疑案均查明为 ①HMR 状态错位(旧消息残留+新世界空背包)②玩家被传送进水坑边界+卡坑壁(vx 被碰撞清零属正常物理)③火把测试撞上死亡屏 overlay 拦截鼠标(夜晚围杀→已修重生保护+清怪)
- 游戏性调优:空手挖掘力 9→3(泰拉瑞亚空手几乎不能挖)、初始三件套、磁吸 44→52px
- lint 0 error / tsc 0 error / dev.log 全 200

Stage Summary:
- 游戏完整可玩:世界生成(地形/洞穴/矿脉/树/水塘/黏土)→ 挖矿砍树 → 合成链(徒手→工作台→熔炉→铁砧→铁银金工具)→ 战斗(4 种敌怪)→ 昼夜循环(480s)→ 光照(天空光+火把+平滑插值)→ 存档读档 → 小地图
- 文件:src/game/engine.ts(新)、src/game/render.ts(新)、修复 world.ts/textures.ts;UI 层由 3-b 并行完成(HUD/Overlays/GameCanvas/page)
- 调试后门:window.__game 暴露引擎实例(有注释标注,便于后续维护调试)
- 遗留已知项:无;浏览器全流程验证通过

---
Task ID: 5 (总控)
Agent: main
Task: 细节优化 → GitHub 提交 → 单文件 HTML 复刻

Work Log:
- 浏览器实玩 + VLM 双轮截图评审，确定优化清单：
  A) 草地/树叶配色略荧光 → 微调至更自然的绿
  B) 缺树根贴图（泰拉瑞亚标志性细节）→ 新增 rootL/rootR
  C) 火把/熔炉光晕过于突兀 → 更平滑的双段径向渐变 + 降透明度
  D) 水面高光是静态直线 → 加正弦波纹动画
  E) 受击无屏幕震动 → hurtPlayer 触发 shake（engine 字段 + render translate 集成）
  F) 落地无尘土 → 落地 burst 粒子
  G) 白天/夜晚缺环境生物 → 蝴蝶(白天) / 萤火虫(夜晚) 环境粒子
  H) HUD 消息文字无背景 → 半透明黑底圆角
- 并行派发 5-a(视觉 textures+render) / 5-b(手感 engine+entities) / 5-c(UI HUD) 三个子代理
- 后续：集成验证 → git 推送 github.com/43aquaris/web-terrariab → 单文件 HTML 复刻(public/terraria.html)

---
Task ID: 5-b
Agent: general-purpose (手感打磨)
Task: engine.ts + entities.ts 手感优化

Work Log:
- 只改了 engine.ts（entities.ts 无需改动：updatePlayer 的 PlayerEvents 已带 landed 布尔事件，落地冲击速度用引擎侧 prevVy + PLAYER_CONF.gravity 估算，未动 entities 接口）
- 受击屏幕震动：GameEngine 新增公共字段 shake=0 / shakeX=0 / shakeY=0（L97-98）；hurtPlayer() 内 L1039 触发 this.shake = Math.min(7, 3 + dmg * 0.15)（大伤害震得更狠，封顶 7 世界像素）；tick() 顶部（L560-569，紧邻 redFlash 衰减）每帧 shake *= 0.88、<0.15 归零，并刷新 shakeX/shakeY = (rand*2-1)*shake，shake=0 时两偏移同步归零——所有屏（含死亡屏/暂停）都衰减
- 死亡震撼：diePlayer() L1058 this.shake = 8（覆盖同帧 hurtPlayer 的受击值）
- 落地尘土：tickGame() L639-650，updatePlayer 调用前记录 prevVy，ev.landed 时 landVy = prevVy + 重力；landVy >= 1.5 且非水中才喷（小跳不喷、落水另有水花），n = Math.min(10, 2 + floor(landVy/1.2))，burst 色号 #b99b76 在 p.x±3 两脚各喷一半（spd 1.8 grav 0.18）
- 环境生物系统：新增导出接口 AmbientBug（engine.ts L63-69）+ 公共字段 ambient: AmbientBug[]（L85）；新私有方法 tickAmbient()（L739-796）仅在 tickGame 内调用（即 playing 且未暂停；标题屏/死亡屏/暂停都不跑）；initWorld/continueGame/quitToTitle 均重置 ambient=[]
- tickAmbient 生成规则：每 30 帧掷骰（概率 0.16 ≈ 平均 3s 一只），上限 6 只；白天生成蝴蝶 kind=0、夜晚萤火虫 kind=1；x 在 camX~camX+viewW 随机，y 在 surface[gx]*16-40 ~ -8（地表上方 8~40px）；生成点在水下（tile==WATER）或玩家在地下（地表不在相机垂直视野 ±80px 内）则跳过
- tickAmbient 更新规则：蝴蝶 vx 随机游走（加速度 ±0.05/帧、钳制 ±0.85）+ 0.6% 概率改向，y 用 lerp 0.03 贴向"自身所在列地表-24px + sin(t*0.07+phase)*3"（即沿地形起伏 ±3px 上下飘）；萤火虫 vx/vy 双轴随机游走（钳 ±0.3/±0.18）缓慢漂移并向地表-20px 微弱贴近；蝴蝶 phase 每帧 +0.32（扇翅快相位）、萤火虫 +0.06（闪烁慢相位，周期约 1.75s）
- tickAmbient 移除规则：存活 t > 2000 帧（约 33s）；走出相机视野外 100px（四边）；昼夜切换后旧种类以 2%/帧概率渐次消散（约 1s 清完，避免午夜还有蝴蝶/白天还有萤火虫）
- 验证：bunx tsc --noEmit 过滤 engine|entities 零错误（仅剩 examples/、skills/ 模板文件的既有错误）；bun run lint 0 error 0 warning（exit 0）；dev server / 路由 HTTP 200
- 冒烟测试（临时文件 /home/z/feel_smoke.ts，已删）：stub DOM/localStorage 后 headless 跑 GameEngine 真实 tick 共 1 万+ 帧，28 项断言全过——标题屏 400 帧不生成、白天 30s 生成蝴蝶（kind 全 0、≤6 只、坐标有限、贴合自身列地表上方）、夜晚 25s 全萤火虫且旧蝴蝶清空、受击 shake=6/封顶 7/45 帧衰减归零、死亡 shake=8 且 320 帧后重生、120px 坠落喷 9 颗尘土而 3px 小跳 0 颗、玩家深地下 40s 后 ambient 清空不生成
- 期间修正 3 处测试脚本自身的误判（蝴蝶跟随的是自己所在列地形而非出生列；dmg=100 会直接杀死 100HP 玩家所以正确触发的是死亡 shake=8；传送 600px 掉进洞穴摔死会冻结 tickGame）——引擎行为本身三处全部正确

Stage Summary:
- 交付：仅 src/game/engine.ts 改动（+~120 行），entities.ts 零改动；纯增量字段与方法，render.ts 现有读取不受影响
- ambient 数组最终字段结构（供 render.ts 集成，interface AmbientBug 已从 engine.ts 导出）：
  { x: number; y: number;       // 世界坐标(中心)
    vx: number; vy: number;     // 速度(px/帧)；蝴蝶朝向 = sign(vx)
    kind: 0 | 1;                // 0=蝴蝶(白天) 1=萤火虫(夜晚)
    t: number;                  // 已存活帧数(>2000 移除)
    phase: number }             // 蝴蝶=扇翅相位(每帧+0.32，建议 sin(phase) 控制翅膀张合)；萤火虫=闪烁相位(每帧+0.06，建议亮度 alpha ∝ 0.35+0.65*max(0,sin(phase)))
- 渲染集成要点（render.ts 侧，本任务未改）：① ctx.translate(g.shakeX, g.shakeY) 建议加在世界坐标变换(scale zoom 之后、translate -camX 之前或合并)——单位是世界像素，zoom=2 时最大 8 世界像素 = 16 屏幕像素；② ambient 建议画在瓦片层之后、光照罩之前，蝴蝶颜色自定（参考泰拉瑞亚白蝴蝶 #e8e0d0/翅纹），萤火虫夜晚加 additive 光点；③ ambient 只在 screen==='playing' 且未暂停时更新，死亡/标题/暂停时冻结保留，render 可无脑遍历
- 手感数值备忘：shake 7 世界像素≈14 屏幕像素（受击封顶）/ 死亡 8≈16；尘土 n=2~10 颗按落速线性；蝴蝶活动带 = 地表上方 8~56px，萤火虫 ≈ 地表上方 20px 附近

---
Task ID: 5-c
Agent: general-purpose (UI打磨)
Task: HUD.tsx 细节打磨

Work Log:
- 仅改 src/components/game/HUD.tsx（+32/−11 行）；bunx tsc --noEmit 过滤 HUD 零错误、bun run lint exit 0（0 error 0 warning）、dev server / 路由 HTTP 200；未触碰 Overlays.tsx / GameCanvas.tsx / src/game/*
- ① 消息加背景（VLM 评审项 H）：左下消息（最近 6 条）每条外包圆角底 rounded-sm bg-black/45 backdrop-blur-[1px] px-2 py-0.5，白色文字 + text-shadow 保留；容器 gap-0.5 提升为 gap-1；金色左竖条 border-l-2 border-amber-400/70 营造聊天框感。实现取舍：竖条加在每条消息上而非整个容器——消息淡出后元素仍留在 DOM（引擎只保留最近 8 条、靠新消息挤掉旧的），容器级竖条会在全部消息淡出后残留一根孤条；hud-msg 淡出动画与背景同元素，整条一起消失
- ② 选中格呼吸内发光：HUD_CSS 注入新增 @keyframes hud-sel-glow（inset box-shadow 在 rgba(247,208,96,0.25)~0.5 之间 1.6s ease-in-out 无限循环）+ .hud-sel 类；SlotCell 选中态从静态 shadow-[inset_0_0_10px_rgba(247,208,96,0.5)] 改为 hud-sel 动画（顶部快捷栏与背包第 0 行共用同一组件，同时生效）
- ③ 数字键角标（1-0）：选中时 text-amber-300 金色、未选中 text-white/50（原为固定 #f7d060/90，无选中反馈）
- ④ 右上信息条：白天 Sun 图标改 text-amber-300、夜晚 Moon 图标改 text-slate-200（昼夜色彩区分更直观），深度数字行加 tabular-nums（数字变化时等宽不抖动）。注：UIState 无敌怪计数字段且任务明细未要求展示，未新增
- ⑤ 背包打开时快捷栏过渡：invOpen 时 top-2→top-4 + opacity-80（下移 8px 且变暗，表示焦点转移至背包），配 transition-all duration-200 平滑过渡；背包面板锚定 bottom-12，无遮挡
- ⑥ 数量角标防溢出：物品 count ≥ 100（三位数）时角标字号 text-[11px]→text-[8px]，SlotCell（快捷栏+背包 40 格）与光标物品 CursorItemView 两处统一，避免 32px 小格溢出
- 兼容性保留：消息彩色机制不动（拾取 #c8e8ff 等来自 engine 的 m.color 优先生效，text-white 类仅兜底）；移动端 32/36px 与 sm 44px 格子断点、全部现有响应式行为不变
- 环境坑记录：Edit 工具写入含 "反引号+右花括号" 序列的多行 JSX 时换行位置被重排（语义等价、tsc 可过但格式怪异），已用 node 字节级替换规范化回标准格式；其他模板字符串编辑均完好（已逐段 JSON.stringify 字节校验）

Stage Summary:
- 6 项 HUD 细节优化全部落地：消息黑底金边条、选中格呼吸辉光、数字角标金色选中态、昼夜图标配色 + 等宽数字、背包打开时快捷栏下沉变暗过渡、三位数角标缩字号
- 验收全过：tsc --noEmit 过滤 HUD 无输出；bun run lint 0 error 0 warning（exit 0）；改动范围仅 src/components/game/HUD.tsx 一个文件
- 关键决策：① 金色竖条按每条消息实现（容器级会在消息全部淡出后残留）；② 选中格内发光由静态升级为呼吸动画（同一 .hud-sel 类服务快捷栏与背包两处）；③ 消息保留引擎彩色语义不强制纯白

---
Task ID: 5-a
Agent: general-purpose (视觉打磨, 超时前已完成全部代码, 主代理代为补记)
Task: textures.ts + render.ts 视觉细节优化

Work Log:
- 草地/树叶/高草/树枝/树叶mask变体全套配色微调: #4c9b3f→#3f8f3a, #86d960→#75c455 等, 去荧光感保持明快
- 新增 drawRoot(left) 16x16 树根贴图(根须从树干侧向延伸扎入草地, 末端渐细+起点疙瘩), GameTextures 增加 rootL/rootR
- render.ts TRUNK 渲染分支: 树干底部(下一格非 TRUNK)向两侧草地绘制根须覆盖层, 侧邻同排草地上移8px/下一排草地 下移4px 两种对齐, 纯视觉不参与碰撞
- radialGlow 三段渐变(0/0.35/1), 火把熔炉暖光晕 globalAlpha 0.5→0.38, 边缘衰减平缓不再突兀
- WATER 顶面高光改为 4 段 sin 波纹动画(timeSec*2.2 相位) + 2 个随时间漂移的白色高光点
- 挖掘裂纹对比度 0.55→0.62

Stage Summary:
- 产出: textures.ts/render.ts 全部改动已落盘, tsc/lint 通过, 浏览器+VLM 验证: 树根✅ 自然草色✅ 柔和光晕✅ 水面波纹✅
- 注: 该代理在写 worklog 前超时, 代码已完成, 由主代理验证后补记本条目

---
Task ID: 5-int
Agent: main
Task: shake + ambient 渲染集成与端到端验证

Work Log:
- render.ts 集成 5-b 的接口: translate 加入 shakeX/shakeY 相机偏移, tile cull 范围外扩 1 格防抖动露边
- 蝴蝶(kind 0)渲染在粒子后/光照罩前: 深棕身体 2x4 + 双翅 1~3px 按 |sin(phase)| 扇动(橙#e8a33c+翅尖高光#f5d78a)
- 萤火虫(kind 1)渲染在暖光晕后: 亮度 0.35+0.65*max(0,sin(phase)), 亮核 2x2 #f4f8b8 + 5x5 像素微光晕 #d8e888
- 验证: hurtPlayer(12)→shake=4.8 衰减 45 帧归零✅ 深夜星星月亮✅ 白天蝴蝶✅ 夜晚萤火虫自发光✅ 水塘波纹✅
- VLM 复审 6/6 通过, 无控制台错误, dev.log 全 200, lint/tsc 干净

---
Task ID: 7-a
Agent: main
Task: 单文件 HTML 复刻 (public/terraria.html)

Work Log:
- 关键发现: store.ts 是纯观察者模式(无 React 依赖), src/game/* 全部 11 个模块框架无关, 引擎代码可直接复用
- 新增 standalone/main.ts (~700 行): 原生 DOM 复刻 React UI 层
  - 完整 CSS (~330 行): 心形血条/气泡/槽位/快捷栏/信息条/背包+合成面板/消息/帮助面板/标题屏/死亡屏/暂停菜单/loading + 7 组 keyframes 动画, 响应式断点 400/640/1024px 对齐 React 版
  - 渲染层: ui.subscribe 订阅 + 分区 memo(slots/hearts/messages/craftables/info/cursor 各自脏检查), 避免无关状态重建 DOM 导致动画重放
  - 交互: 事件委托(槽位 mousedown 左右键/合成点击/tooltip hover), tooltip+光标物品 mousemove 跟随, 键盘 E/Tab/Esc/M/H/1-0 与 React 版逻辑一致
  - SVG 内联图标替代 lucide (太阳/月亮/音量/帮助), 零外部请求
- 新增 standalone/build.ts: Bun.build IIFE 打包 + </script> 转义 + HTML 模板内联(data-URI favicon)
- 产物: public/terraria.html 168.3KB 单文件, 零依赖零网络请求, 可 file:// 直接打开
- 验证(agent-browser): 标题屏→进入世界(铜镐/斧/剑三件套)→E 开背包→给木头→合成面板(木平台/工作台)→合成工作台(扣 10 木)→A 移动→Esc 暂停菜单→保存(localStorage 124KB)→reload→继续上次冒险→世界/背包/血量完整还原→tooltip 悬停(铜镐金色名+数值)→375x667 移动端 10 列格子无溢出→无 console 错误
- VLM 双图审查: 世界渲染/心条/快捷栏/小地图/信息条齐全, tooltip 层级清晰, 移动端布局规整
- bun-types 三斜线引用修复 build.ts 的 tsc 报错; tsc 0 错误 / lint 0 错误

Stage Summary:
- 产出: standalone/main.ts + standalone/build.ts + public/terraria.html(168KB)
- 单文件版与 Next.js 版共享同一套引擎代码和同一 localStorage 存档键(tw-save-v1), 存档互通
- 重建命令: bun standalone/build.ts

---
Task ID: 9-0 + 9-1
Agent: main
Task: 调研参考站 terraria.space-z.ai + 大版本内容升级的地基 (constants.ts / store.ts)

Work Log:
- 完整体验参考站: 标题屏→创建角色(输入名)→世界列表→创建世界(尺寸 S/M/L + 种子 + DevMode)→进入游戏; 提取其 JS chunk 分析内容清单
- 参考站内容盘点: 铜铁银金→魔金→狱岩全工具线+盔甲套装(头/身/腿)、弓+箭、炸弹、晶状体、生命水晶、Boss(克苏鲁之眼/世界吞噬者/骷髅王)、NPC(向导/树妖)、群系(森林/腐化/丛林/沙漠/地狱/蘑菇)、门/桌/椅/宝箱/祭坛/平台、智能光标、全屏地图(Tab)、住房检查、通知(F8)、存/读档; 音乐直接用了原版泰拉瑞亚 OST(版权风险, 我们继续程序化)
- 我们现有内容盘点(见 worklog 早期条目): 森林单群系 + 铜铁银金工具 + 4种敌怪 + 工作台/熔炉/铁砧/平台/火把 + 水 + 小地图 + 存档; 核心差距=内容量与系统广度
- 重写 src/game/constants.ts (~600行): 62种方块(新: 沙/雪/冰/泥/丛林草/黑檀石/腐化草/灰烬/狱岩/岩浆/黑曜石/蘑菇柄/蘑菇盖/仙人掌/门×4/宝箱×4/祭坛×4/桌子×2/椅子/生命水晶/树苗/藤蔓/三种群系树冠), 70种物品(新: 群系方块/弓/箭/炸弹/晶状体/生命水晶/可疑眼球/魔金系列/狱岩系列/铜锭/15件盔甲/橡子/门/宝箱/桌/椅), 45条配方, 盔甲ARMOR_COLORS, CHEST_LOOT五档战利品表, WORLD_SIZES三档, BIOME六群系, ENEMY_DEFS新增蝙蝠/骷髅/熔岩史莱姆/噬魂者/克苏鲁之眼(boss), GUIDE_LINES向导台词, PLAYER_CONF新增冰面摩擦/岩浆伤害参数, SAVE_KEY升级tw-save-v2(保留v1键名兼容读取)
- 重写 src/game/store.ts: UIState新增 defense/armor三槽/stations.altar/chestOpen+chestSlots/boss/mapOpen/smart/devMode/playerName/biomeName
- 修 HUD.tsx 两处类型映射(altar/armor label); tsc 0错误
- 注意: 旧引擎尚未使用新常量, 后续任务 9-a/9-b/9-c/9-d/9-e/9-f/9-g 将分别落地

Stage Summary:
- 地基契约已定: constants.ts 是所有后续任务的唯一 ID/数值来源, 旧 ID 完全兼容
- 分派计划: 9-a world.ts群系生成 / 9-b textures+sprites / 9-c entities敌怪Boss NPC投射物 / 9-d sound音效BGM 并行 → 9-e engine集成 → 9-f render + 9-g HUD 并行 → 9-int 集成验证 → 9-h 单文件版 → 9-i 推送GitHub
- 引擎新 API 契约(9-e实现, 9-g消费): newWorld(size,seedStr,name,dev) / toggleMap() / toggleSmart() / closeChest() / clickChestSlot(i,right) / clickArmorSlot(slot,right); 键位: M地图 C智能光标 F飞行(dev) G刷怪(dev)

---
Task ID: 9-d
Agent: sub (general-purpose)
Task: sound.ts 扩展 — 14 个新 SFX + 程序化 BGM（title/day/night 三场景芯片音乐）

Work Log:
- 仅改 src/game/sound.ts（571→1311 行）；现有 13 个音效与 API 原样保留。新音效全部复用既有 playNoise/playTone/envGain/ready/allow(30ms 节流) 路径，峰值音量与现有水平一致（0.05~0.24）
- 基础设施小扩展: AudioCore 增加 music(GainNode, 初始 0) 与 brown(懒创建缓冲); playNoise 加 brown?: boolean 选 brown noise（Paul Kellet 积分式，低频轰鸣质感）
- 新 SFX×14: bowShoot(带通 600→2400 上扫+三角弦振700→380) / arrowHit(方波190+噪声click 各~30ms) / bombThrow(低通 0.15s) / explosion(brown 0.5s+正弦110→38+6ms 弱回响, 峰值 0.42≈1.5倍仍不削波) / doorOpen(失谐双锯齿180/189→260/272 拍频出吱呀颤抖) / doorClose(120Hz 方波+thud) / chestOpen(三角 620/880 错开 60ms+3400Hz 长尾混响感) / crystal(正弦 880/1175/1568 各 90ms 琶音) / bossRoar(双失谐锯齿 260→55 0.7s+lowpass 喉音 0.5s) / bossHit(正弦 150→70+噪声脉冲) / bossDie(怒吼变体+200→30Hz 1.1s 下坠+尾部噪声消散) / guideTalk(方波 300/360 各 40ms 两声"吧吧") / plant(正弦 500→300 70ms) / altar(90+135Hz 拍频 0.6s, 不加抖动保拍频纯净)
- 新增导出 Music: MusicModule {start/stop/setScene('title'|'day'|'night')/setEnabled} + MusicScene 类型。独立 music 总增益 0.55 直连 destination（与 SFX master 0.4 并列）
- note→freq 工具: 正则解析 C4/A#3/Bb2, A4=440 十二平均律
- 三首曲目（写死在代码里的音符表, 8 分音符网格）:
  · Day: C 大调五声 104BPM 4/4 八小节循环(18.46s)。低音 C2 A1 F2 G2×2 每小节全音符(正弦 0.12); 旋律 26 个音(三角波 0.16+4Hz±8音分颤音+0.035s 音尾留白), 按任务规格逐小节录入(E4 G4 A4|G4 E4 D4|...|C4 3拍休止); 打击=每 8 分音符白噪声 highpass(6800Hz) tick 正拍 0.04/反拍 0.024
  · Night: A 小调 66BPM 八小节(29.09s) 无打击。低音 A1 F2 C2 E2 各两小节(慢起音 0.3s); 旋律稀疏长音正弦 0.16+0.4s 长释放(空灵), 按规格逐小节录入
  · Title: Cmaj7→Fmaj7→Am7→G 琶音垫, 每和弦 2s 上行 4 音(0.5s/音), 三角波 0.12+0.65s 释放重叠成垫, 8s 循环, 无旋律无鼓
- 前瞻调度器: setInterval 100ms 轮询 + 提前 0.3s 排音; 时间一律 songStart+步号×步长 推导(AudioContext.currentTime 精确对拍, 长播放零浮点漂移), 步号 mod 循环无缝衔接; 停排期间(切歌淡出/静音/关闭)落后超一整循环时按整循环快进保小节相位续播
- setScene: 立即停排新音符(switching 标志) + music 主增益 linearRamp 0.8s 淡出, 0.83s 后锚定新歌 0.25s 淡入; 连点自动合并(clearTimeout); 未启动/上下文 suspended 时仅记录场景
- 静音联动(未改 engine.ts): SFX.setMuted 内部追加 applyMusicGain() — muted 时 BGM 增益目标 0 且调度器停排, 解除后自动续播; engine.toggleMute→SFX.toggleMute→setMuted 全链路自动生效
- 健壮性: start() 幂等+内部 init()+resume 尝试; 调度器每帧检查 ctx.state!=='running' 即跳过(suspended 安全 no-op, 恢复后自动起拍); stop() 清 interval+switchTimer+淡出, 可重新 start
- 冒烟测试 scratch-9d.ts（已删）: stub AudioContext/Param/Gain/Osc 后 56/56 通过 — 14 新 SFX+13 旧 SFX 回归、suspended no-op、三场景切换排音符、静音联动(music gain 目标 0/0.55 且停排/恢复)、setEnabled/stop 幂等与重启、快速连点 setScene 合并、淡出中途 setEnabled(false)/stop 边界
- tsc --noEmit: 项目源码 0 错误（仅剩并行任务 scratch-9a/9b.ts 临时文件与 examples//skills/ 预存量）; bunx eslint src/ 0 问题（bun run lint 的 12 error 全部来自非项目源码的 agent-ctx/*.js chunk, 与本次改动无关）

Stage Summary:
- 产出: src/game/sound.ts 扩展（14 SFX + Music 模块三场景 BGM）, 零外部文件零依赖; SFX/Music API 完全向后兼容, engine.ts 未动
- 给 9-e 的集成建议: ①首次用户手势处(现有 SFX.init() 调用点)同时调 Music.start(); ②进世界/清晨→Music.setScene('day'), 夜幕降临(timeSec 过黄昏阈值)→setScene('night'), 玩家死亡或返回标题屏→setScene('title'); ③静音无需额外接线——engine.toggleMute() 已有链路自动联动 BGM; ④若要独立"BGM 开关"设置项可直接暴露 Music.setEnabled; ⑤Boss 战可临时 setEnabled(false) 或后续加 'boss' 场景曲目(SONGS 表可扩展)

---
Task ID: 9-c
Agent: general-purpose (实体/AI)
Task: entities.ts 扩展 — 新敌怪 AI + 克苏鲁之眼 Boss + 向导 NPC + 投射物

Work Log:
- 仅改 src/game/entities.ts(+340 行), 所有既有导出签名不变(moveBody/tileAt/bodyInWater/mkPlayer/updatePlayer/spawnEnemy/updateEnemy/mkDrop/updateDrop/burst); gslime/bslime/zombie/eye 原逻辑逐字节保留(eye 撞墙三行抽成私有 flyWallBounce 供 bat/eos 复用, 语义等价)
- updatePlayer: 冰面检测(脚下 1-2px 处 tileAt(p.x, p.y+1/+2)===T.ICE 且 onGround)→ 摩擦×PLAYER_CONF.iceFricMul(0.12)、加速×iceAccelMul(0.55); 新导出 bodyInLava(world, b)(脚底格或身体中心格===T.LAVA)
- EnemyKind 增加 'bat'|'skel'|'lslime'|'eos'|'eoc'; Enemy 接口新增可选 Boss 字段 mode/aiT/dashLeft/phase(旧调用零破坏); spawnEnemy 对 eoc 初始化 mode='hover'/aiT=0/dashLeft=0/phase=0, 对 eos 随机 aiT(0-119)错开蓄力节奏
- bat: 追击加速度 0.09 + sin(frame*0.31+id)*0.14 双轴独立相位抖动, 限速 2.6, 撞墙复用 eye 处理
- skel: 僵尸走地 AI 变体——目标速度 0.9(近距 350px 内加速到 1.2), 撞墙跳 -6.1(僵尸 -6.6), stepUp 保留
- lslime: 史莱姆跳 AI 变体——vy -(3.4~5.0)(≈-4.2±0.8), 水平 1.7, 追击半径 560
- eos: aiT 计数状态机——1..120 帧缓慢逼近(加速 0.045/限速 1.4), 第 120 帧瞬间速度设为朝玩家单位向量×4.2, 121-145 帧(26 帧)保持冲刺不转向, 146 帧重置; 撞墙复用 eye
- eoc(私有 updateEoc): 完整状态机——phase0: hover 150 帧(目标点玩家上方 130px, 转向加速 0.08/限速 2.3)→telegraph 30 帧原地震颤(vx*0.8+sin 抖动)→dash 3 次×42 帧(每次开始瞬间速度=朝玩家当前位置单位向量×6.5, Boss 身体中心瞄准 (px,py-20))→回 hover; phase1(hp≤45%瞬间切入, mode='spin'/aiT=0): spin 60 帧缓停蓄力→循环 hover 70 帧→4 连冲×36 帧×速度 8.0; isNight=false 强制 flee(vy=-4/vx*0.98, 粘性不再回头); 无重力, 撞墙轻反弹(用碰撞前速度×-0.5)
- Guide NPC: mkGuide(x,y)(w12×h36, homeX=x)/updateGuide(world,g,px,frame)——90-240 帧决策(40%停/60%随机向, |x-homeX|>260 必朝家)+每帧硬边界掉头(走出 ±260 且仍朝外即转身); 速度 0.9; 撞墙且 onGround 跳 -6.8; 前方 2 格列脚下 4 格无实心→掉头; 玩家 60px 内停下面向玩家(不覆盖 g.moving, 玩家离开恢复); talkT>0 每帧-1; 水中重力减半; walkT 走路相位同玩家公式
- Proj: mkArrow(初速 11 朝目标)/mkBomb(vx=clamp(dx/28,±4.5), vy=-(3.2+dist/55)下限-7)/updateProj 返回 'fly'|'stuck'|'explode'|'gone'; arrow: 重力 0.16/rot=atan2/下一位置半步+整步 solid 检测插墙(t 清零另计 60 帧消失)/t>300 消失/水中 vx*0.96+vy=min(vy+0.06,0.8) 缓沉; bomb: 重力 0.22/落地 vy=-vy*0.42+vx*0.72/撞墙 vx*-0.6(均用碰撞前速度)/t≥150 爆炸/入水立即 gone/入岩浆立即 explode(移动前后各查一次)
- 测试(临时 scratch-9c.ts, 已删): stub document/localStorage + 真 World 类不 generate 手工摆地板, 52 项断言全过, 共模拟 19661 帧, 连跑 6 次无随机波动——bat 飞近玩家 minDist 6.8px 且 3000 帧无穿墙/密封盒关住; eoc phase0 序列 hover→telegraph→dash→hover、3 冲全 6.50、间隔全 42 帧、hover 悬停误差 17px, hp 压 40% 当帧切 spin、60 帧后 hover(70)→4 连冲全 8.00×36 帧, 天亮 flee 150 帧升 600px vy=-4; skel 400 帧逼近 300px+撞墙跳; lslime 最大跳速 4.44+跳近; eos 冲刺 4.20/平时≤1.4/冲后回慢; guide 6000 帧徘徊 523px 且不出 homeX±270、跨 1 格障碍、会跳、悬崖边掉头(max 1570<坑 1600)、玩家 60px 内面向+停、talkT 递减; arrow 水平 22 帧插墙+61 帧后 gone、t>300 gone、水中 vy≤0.8 缓沉插底; bomb 落地反弹/第 150 帧爆/水平撞墙反弹/入水 57 帧熄灭/入岩浆 63 帧即爆(早于引信); 冰面滑行 60.1px vs 石面 9.5px(6.3×)、12 帧加速 2.34 vs 3.10; bodyInLava 三态正确
- 踩坑记录: ①箭入水过渡帧保留入水速度属正常离散物理(次帧才钳 0.8), 断言需跳过首帧; ②炸弹抛物线水平距离远超直觉(4.3px/f×80 帧≈350px), 水池/岩浆测试需近垂直投放否则飞过池子; ③t>300 判定是严格大于, t=300 当帧不消失
- 环境注意: 并行任务共享仓库——期间 agent-ctx/*.js(9-0 调研的参考站 chunk)导致全局 lint 12 错误+2290 警告(先于本任务存在), src/ 全树 eslint exit 0、entities.ts 单文件 0 错 0 警; 曾观察到 src/game/* 全目录 mtime 被并行任务批量刷新, 已复核 entities.ts 内容完整(713 行)并重跑回归确认行为无损

Stage Summary:
- 交付: 仅 src/game/entities.ts 改动; 新导出 bodyInLava / Guide+mkGuide+updateGuide / Proj+mkArrow+mkBomb+updateProj; EnemyKind 扩至 9 种; Enemy 可选 Boss 字段; 验证 tsc(过滤 examples/skills)零错误 + eslint entities.ts 零错零警 + 52 项 headless 断言全过(19661 帧)
- 给 9-e(引擎集成)的接口备忘:
  1) bodyInLava(world, body): boolean — 玩家/敌怪岩浆判定; 玩家掉血节奏用 PLAYER_CONF.lavaDmg(28)/lavaTick(30)
  2) 敌怪生成: spawnEnemy('bat'|'skel'|'lslime'|'eos', x, y) 正常刷; ENEMY_DEFS 已带 def(减伤)/boss 标志, 引擎结算伤害时读 e 对应 def: ENEMY_DEFS[e.kind].def ?? 0; lslime 免疫岩浆伤害需引擎特判(kind==='lslime' 时跳过岩浆扣血)
  3) eoc: spawnEnemy('eoc', x, y) 夜晚召唤; 引擎每帧 updateEnemy 照常; 观察 e.phase 0→1 跳变可触发狂怒音效; e.mode==='flee'(天亮)时跳过接触伤害并在离屏后 e.dead=true 移除; 注意现有白天夜怪随机消散逻辑(1.2%/帧)会误杀 boss——需对 boss 字段(ENEMY_DEFS[kind].boss)豁免, 改由 flee 兜底
  4) guide: mkGuide(spawnX, spawnY) 出生点附近; updateGuide(world, g, p.x, frame) 每帧; 玩家交互时置 g.talkT=180 左右(头顶气泡), 台词从 GUIDE_LINES 随机取; 不与敌怪互判(引擎侧排除)
  5) 投射物: 弓用 mkArrow(p.x, p.y-18, aimX, aimY)(消耗 IT.ARROW), 炸弹用 mkBomb(同参, 消耗 IT.BOMB); 每帧 updateProj(world, proj) 按 返回值处理: 'fly' 保留 / 'stuck' 保留等其自然 'gone' / 'explode' 移除并执行爆炸(破坏方块+范围伤害 IT.BOMB dmg=60) / 'gone' 移除; arrow 命中敌怪判定引擎自做(圆心距离<12), bomb 引信与碰撞全在 updateProj 内
  6) AI 参数速查: bat 追0.09+抖0.14限2.6 / skel 0.9(近1.2)跳-6.1 / lslime vy-3.4~-5.0 水平1.7 / eos 慢1.4→120帧蓄→4.2×26帧 / eoc hover150(±130px上方,2.3)→颤30→3×42冲6.5 / p1: spin60→hover70→4×36冲8.0 / flee vy-4

---
Task ID: 9-a
Agent: sub (世界生成)
Task: 重写 world.ts 世界生成 — 六大群系 + 空岛 + 地狱 + 宝箱/生命水晶/祭坛 + 岩浆液体系统

Work Log:
- 仅改 src/game/world.ts (852+/166-), constants/engine/entities/render 等未动; 引擎旧 API (get/set/isSolid/updateSkyColumn/activateAround/tickWater/tickGrass/fellTree/clearFurniture/encode/decode + 全部字段) 完整保留, `new World(seed)` 默认小世界行为不变
- 新增 API: biome:Uint8Array(按列) / hellY / chestSpawns:ChestSpawn[](主格=TL) / altarSpawns / lavaActive:Set / biomeAt(x) / generate(seed,w?,h?) 参数化尺寸 / constructor(seed?,w?,h?) 内 initSize 重建全部数组(不再定长)
- 群系布局: [边森林|腐化150-240|雪原150-240|缓冲30-60|中央森林90-130(出生)|沙漠140-220|丛林170-260|蘑菇110-180|缓冲|边森林], 宽度随机、超宽按比例压缩(保底60%下限+扣最大块), 边界±3列渗透, 交界 8-12 列地表振幅滑动平均过渡(沙漠×0.5/丛林×1.5)
- 群系地表: 沙漠=沙8-14层直下石头+仙人掌2-5高(无水塘); 雪原=雪4-8层+泥土+地下ICE团块(噪声>0.66)+池塘结冰1-2格; 腐化=腐化草+泥4-6+黑檀石6-10+地下团块(>0.7)+2-3条正弦摆动裂隙(宽4-6深60-110,井壁黑檀石,井底5x3空腔放祭坛)+矮紫树5-8; 丛林=丛林草+泥15-25+泥团块(>0.6)+大树10-16冠半径3+藤蔓10%垂2-6格+水塘翻倍; 蘑菇地=草地不长树改巨型蘑菇(柄6-12+椭圆伞盖3-5宽2-3厚,间距6-12)
- 植被派发按"落点列群系"判定(修掉了步距群系与落点群系不一致导致蘑菇长进森林的bug)
- 地狱(hellY=h-42): ASH大空腔丘陵(blob>0.58/worm带宽0.085阈值放宽)+狱岩脉30-60条×4-8格(pow0.6偏深+起点8次重试找ASH)+底部h-16..h-4空气→岩浆海+h-3封底防悬空+hellY附近4-8个小岩浆池+底2行基岩, 墙W_STONE
- 空岛3-6个: y22-46且整体高于最低地表≥25行, 左右区避开出生±60列分槽, 椭圆泥土12-20×5-8+顶面草+内埋金矿3-6+顶上宝箱(tier island)+40%小树
- 地下通用: 洞穴/黏土/洞穴湖保留, 4种矿脉数量×w/1100缩放、深度按 dirtLine 均值+h 参数化覆盖新尺寸; 生命水晶12-18(洞穴底AIR+下方实心,深度dirtLine+35..h-50,避液体); 宝箱=地表5-8+洞穴/深层18-26(dirtLine+50分界)+空岛3-6+地狱3-5, 2x2家具组且BL/BR下方必须实心; 祭坛=裂隙底1-2+深层洞穴4-6
- 液体升级: activateAround 同时激活水/岩浆; tickWater 内水每帧、岩浆每3次调用一轮(规则同水直落→斜落); 活跃水/岩浆4邻相遇→岩浆变OBSIDIAN+水变AIR(双active清理+onTileChanged); decode 扫描重建 lavaActive
- tickGrass: JUNGLE_GRASS蔓延MUD顶面(8邻域), CORRUPT_GRASS仅腐化列±12内蔓延DIRT(nearCorruption限制), 被盖住的丛林草/腐化草退化MUD/DIRT; fellTree 清理窗口扩为7x8覆盖全部4种树冠(LEAF/LEAF_SNOW/LEAF_JUNGLE/LEAF_CORRUPT, 丛林冠高7行故比规格7x6多留2行)
- 存档: encode 增加 biome/hellY/chestSpawns/altarSpawns (v=1不变), decode 缺省容忍(旧档 biome全0/空宝箱/hellY=h-42), tiles/walls RLE 不变
- 出生点: 中央森林中心, ±6列整平(上方24行清空+填洼+草皮), 树/宝箱放置时避开±8列

测试 (scratch-9a.ts 用 bun 跑过后已删):
- 三尺寸(1100x340/1500x400/1900x460)全量断言通过: 6群系齐全✓ chestSpawns≥25(实际33/38/34)✓ 生命水晶≥12(15/16/13)✓ altarSpawns≥4(6/6/7)✓ 空岛≥3(4/3/4,全部高于最低地表25行)✓ 同seed两次生成tiles逐格一致✓ 出生点列FOREST+±6列平整+上方无物+下方实心✓ 地狱LAVA(6.6k-14k)与HELLSTONE(135-193)✓ 底2行基岩✓ 雪原ICE✓ 丛林MUD+VINE✓ 腐化CORRUPT_STONE+裂隙✓ 群系植物各归其位(3列冠幅容忍)✓
- 液体冒烟: 水岩浆相邻→OBSIDIAN+水蒸发✓ 岩浆每3tick缓慢下落✓ fellTree清丛林树冠33格✓
- encode/decode roundtrip tiles一致 + 新字段还原 + lavaActive/waterActive重建 + 旧档(无新字段)容忍✓
- 性能: 生成 60-320ms/尺寸(要求1.5s内); 存档 127-282KB
- 稳定性: 额外 5 seed × 3 尺寸 = 15 世界全部通过同套核心断言
- ASCII 全景目检: 群系条带顺序正确, 空岛/裂隙/岩浆海/藤蔓/蘑菇群/矿脉分层均符合预期

Stage Summary:
- 产出: src/game/world.ts 全量重写(1172行), 世界生成确定性(同seed+同尺寸=逐格一致), 全部硬性要求达成
- 已知偏离: ①fellTree 清理窗口 7x8(规格7x6, 为完整覆盖丛林7行树冠) ②地狱墙用 W_STONE(规格如此), 沙漠/雪原/丛林墙也维持 W_DIRT/W_STONE 二色(textures.ts 仅有这两种墙贴图, 属 9-b 范围) ③腐化"魔金矿脉"按规格跳过(魔金只由Boss掉落)
- 衔接: 9-e 引擎集成时用 new World(seed, WORLD_SIZES[size].w, .h) 创建对应尺寸; chestSpawns/altarSpawns 供战利品填充与Boss召唤物合成定位; tsc 0 错误(仅 examples/skills 与并行中 的 textures.ts 有既有错误), eslint src/game/world.ts 0 问题

---
Task ID: 9-b
Agent: general-purpose (像素美术)
Task: textures.ts + sprites.ts — 全部新增内容的程序化像素贴图与精灵

Work Log:
- 仅改 src/game/textures.ts(+630 行)/src/game/sprites.ts(+300 行), GameTextures 既有字段/方法签名全部不变只增; drawHumanoid 腿部坐标抽成局部变量(数学逐字节等价), 其余旧绘制路径零改动
- textures.ts — tiles Map 新增 19 种方块×3 变体(T 27-61 非多格家具全覆盖, 含 LAVA 液体块): SAND 暖沙细颗粒/SNOW 近白闪光点/ICE 不透明底+浅蓝斜条纹+左上高光角/MUD 湿泥深斑/JUNGLE_GRASS 自包含整块(下泥上草皮+顶缘 2px 草须+草根下探)/CORRUPT_STONE 暗紫灰+两条硬朗直线裂纹/CORRUPT_GRASS 自包含(下泥土上紫草)/ASH 软噪点/HELLSTONE 暗红底+4-6 处亮橙余烬(强对比)/LAVA 橙红+亮黄斑点/OBSIDIAN 近黑+紫高光斜线+玻璃质高光角/MUSH_STEM 苍白蓝白竖纹(边暗中亮)/MUSH_CAP 亮蓝伞盖+顶亮面+底 3px 深蓝边+白色发光点/CACTUS 绿柱左右深边+边缘白刺/VINE 透明底 1-2px 摆动绿藤+侧叶/SAPLING 透明底小树芽/LEAF_SNOW(#b8d8c8)/LEAF_JUNGLE(#3aa04e)/LEAF_CORRUPT(#8a6aa8) 复刻 drawLeaf 换色; 实心地形块统一 edgeShade(底/右 1px rgba 0.14 微暗)
- textures.ts — sprites 新增 6 件多格家具整图: doorC(16x32 门框+三段门板+金把手)/doorO(16x32 门框+贴左薄门板)/chest(32x32 拱盖+开合缝+金色包边+中央锁扣跨缝)/altar(32x32 暗紫石台+台面血色符文+中央红眼球+rgba 红微光)/table(32x16 桌板+双腿+下横撑)/chair(16x16 侧视); 新增 GameTextures.crystalFrames(16x16 x2 粉水晶心, 帧亮/暗+晶面切缝+帧 2 边缘扩 1px 微缩放做脉动, 心形轮廓复用 HEART_ROWS)
- textures.ts — icons 补齐 IT 1-70 全部 70 个(此前 1-27 已有): 方块类 9 个复用 tiles(SAND/SNOW/ICE/MUD/ASH/OBSIDIAN/EBONSTONE/CACTUS/HELLSTONE_ORE); 绘制类 19 个: BOW 弓臂弧+竖弦/ARROW 斜杆+箭头+尾羽/BOMB 黑球白高光+引线火花/LENS 黑晶状体+高光/LIFE_CRYSTAL=crystalFrames[0]克隆/EYE_SUMMON 红巩膜血丝+竖瞳/DEMONITE_ORE(drawOre 暗绿)/DEMONITE_BAR+HELLSTONE_BAR+COPPER_BAR(barIcon 新 METALS 锭色)/NIGHTMARE_PICK(pickIcon 紫魔金)/MOLTEN_PICK(炽橙镐+3 火星点)/LIGHTS_BANE(暗紫宽剑+紫光边 3px)/VOLCANO(橙红巨剑+火焰纹)/ACORN/门宝箱桌椅 scaledIcon 缩小版; 盔甲 15 件=helmetIcon(侧视盔顶+面甲缝)/mailIcon(肩甲+躯干+中缝臂缝)/legsIcon(裤形+膝盖高光) × ARMOR_COLORS 五套, 暗影套加 #8a6ab0 紫光边点; shadeHex(hex,f) 颜色乘法工具
- textures.ts — walls Map 新增 W_SAND/W_SNOW/W_MUD/W_EBON(wallFrom 同款暗色罩); anchors 新增 NIGHTMARE_PICK/MOLTEN_PICK=[4,12]、LIGHTS_BANE/VOLCANO=[3,11](并入既有 forEach); glowBlue(蓝紫)/glowRed(红橙) 64px radialGlow 同 glowWarm 规格
- sprites.ts — drawHumanoid opts 新增 armor?: {head,body,legs}|null: 头盔覆盖原发区(盔顶+盔后+盔沿/后沿 1px 深色+护鼻眼前 1px 竖线+盔顶高光, 眼睛保留), 胸甲覆盖躯干+甲片暗缝(-21 行)+侧缝+领口高光, 上臂甲(静止/挥舞两分支均覆盖, 挥舞在旋转坐标系内绘制), 腿甲+膝盖 1px 高光; 暗部用 shadeHex(col,0.62)/高光 1.3, 受击 flash 时统一红闪; 导出 GUIDE_PALETTE(棕发蓝衣卡其裤)/SKELETON_PALETTE(骨白+黑眼窝)/LAVA_SLIME(#f07030/#c04010/#ffd060)
- sprites.ts — 导出 drawEoC(ctx,x,y,w,h,phase,lookX,lookY,animT,flash): (x,y)=判定盒底部中心; phase0 白巩膜(#e8e0e4)+1px 暗边(#8a7080 大椭圆垫底)+4 条血丝 stroke+大虹膜 rw*0.46+黑瞳(朝 lookX/lookY clamp ±6px 偏移)+高光; phase1 虹膜换弧形黑口腔+上下各 5 颗白三角牙+眼体 sin(animT*0.22) ±1px 脉动; 底部 5 根 2px 锯齿触须随 animT 摆动; flash>0 整体半透明白(α0.55)覆盖
- sprites.ts — 导出 drawBat(14x10 深棕身体+双三角膜翼按 sin(anim*0.35) 两帧上下扑+耳朵+1px 红眼朝向偏移)/drawEos(16x16 暗紫圆滚身+五点锯齿破烂翼两帧+中央单红眼瞳孔朝 dir+尾部三角尾鳍)/drawArrow(8px 箭矢 save/translate/rotate 按 angle 旋转+关闭平滑)/drawBomb(6px 像素圆黑球+引线+火花随 t 双频闪烁)
- 测试(临时 scratch-9b.ts, 已删): Bun 无 DOM canvas, 自写 ~200 行最小 Canvas 桩(变换矩阵+fillRect/clearRect 精确标色/arc/ellipse 采样/stroke 包围盒/drawImage 无旋转逐像素复制) —— 205 项断言全过: tiles 27-61 非家具全覆盖且 2-3 变体 16x16 非空/icons 70 个全覆盖非空/sprites 6 新字段尺寸正确/crystalFrames 2 帧内容不同/walls 3-6/glowBlue/glowRed/anchors 齐全/drawEoC(3 相位) drawBat(上下扑+flash) drawEos drawArrow(4 角度) drawBomb(2 相位) drawSlime(LAVA) GUIDE/SKELETON 全部离屏无异常且画非透明像素/盔甲三色+眼白在网格中可见/盔甲+空中挥舞组合无异常; 另 ASCII 目检 17 张关键贴图(丛林草分层/蘑菇盖三段/仙人掌白刺/黑曜石斜纹/宝箱金边锁扣/祭坛眼球/EoC 两相位/盔甲小人头盔眼睛)均符合设计
- 验证: bunx tsc --noEmit 仅 examples/skills 既有错误(src 零错误); bunx eslint src/game/textures.ts src/game/sprites.ts 零问题; 全局 bun run lint 有 12 错误全部来自 agent-ctx/*.js(9-0/9-1 调研下载的参考站 chunk, untracked, 先于本任务存在, 与 9-c 条目记录一致); agent-browser 实测 localhost:3000 标题屏→进入世界→开背包, 无 page error/console 错误, VLM 复审世界图+背包图均"正常"
- 注意: 旧 render.ts 尚未消费新贴图(9-f 落地), 但 getTextures() 在真实浏览器全量构建通过(89 块新 canvas+58 新图标), 存量渲染路径逐像素不变

Stage Summary:
- 交付: 仅 textures.ts/sprites.ts 两文件; 新契约字段: GameTextures.crystalFrames[2]/glowBlue/glowRed, sprites.{doorC,doorO,chest,altar,table,chair}, walls{3,4,5,6}, anchors 补 4 件, icons 全 70 物品, tiles 补 19 方块; sprites.ts 新导出 GUIDE_PALETTE/SKELETON_PALETTE/LAVA_SLIME/drawEoC/drawBat/drawEos/drawArrow/drawBomb, drawHumanoid 支持 armor 参数
- 给 9-e/9-f/9-g 的接口备忘:
  1) 多格家具渲染(9-f): doorC/doorO 画在 DOOR_*_T 主格(门占上格 y 与下格 y+16, 整图 16x32 从主格左上画); chest/altar 32x32 画在 *_TL 主格; table 32x16 画在 TABLE_L; chair 16x16; LIFE_CRYSTAL 用 tex.crystalFrames[(g.frame>>4)&1] 脉动+glowBlue/glowRed 光晕(s=160/220 同熔炉) ; MUSH_CAP/HELLSTONE/LAVA/TORCH 同理挂对应 glow
  2) LAVA 液体建议仍按 WATER 方式 fillRect 渐变绘制, tiles.get(T.LAVA) 备用静态贴图(3 变体)
  3) drawEoC: (x,y)=e.x,e.y 底部中心(与现有 drawEye 同约定), lookX/lookY 传朝玩家的像素偏移(如 (px-e.x)*0.06), 内部 clamp ±6; flash 传 e.flash(>0 即白闪); phase 直接传 e.phase(9-c 已有 0/1 切换)
  4) drawBat/drawEos: (x,y)=e.x,e.y, anim=e.anim, dir=e.dir, flash=e.flash>0; drawSlime(ctx, LAVA_SLIME, ...) 画熔岩史莱姆; drawHumanoid(ctx, SKELETON_PALETTE/GUIDE_PALETTE, {...}) 画骷髅/向导
  5) 玩家盔甲: drawHumanoid 的 armor={head,body,legs} 三色, 从 HUD/store 的 armor 槽 item id 查 ARMOR_COLORS 得 [头,身,腿]; 向导 GUIDE_PALETTE 直接画; 投射物 drawArrow(p.x,p.y,Math.atan2(vy,vx))/drawBomb(p.x,p.y,p.t)
  6) 图标: 全部 70 物品 tex.icons[id]/iconURL[id] 齐备, HUD/掉落物/合成面板可直接用; 挥舞锚点 anchors 含 4 件新武器工具

---
Task ID: 9-e
Agent: general-purpose (引擎集成) + main (收尾验证)
Task: engine.ts 大规模集成 — 17 项新系统

Work Log:
- engine.ts 1265→2389 行: newWorld(尺寸/种子/名字/Dev模式)、盔甲系统(穿戴/防御/三槽UI同步)、宝箱(确定性战利品/开关/搬运/挖掉撒内容)、门交互(开关/夹实体拒绝/放置校验)、智能光标(C键,ray-march首选目标)、全屏地图(Tab,explored半径42格标记+脏格mapCanvas)、生命水晶(+20上限至200)、EYE_SUMMON夜间召唤EoC、橡子种植+树苗成长(按草类型出对应树冠)、投射物(弓耗箭/炸弹抛物线/爆炸7x7破坏+范围伤害+自伤×0.5)、Boss战(EoC两阶段/阶段跳变音效/逃走/击杀掉魔金18-30+晶状体3-5)、向导NPC(出生点生成/右键对话GUIDE_LINES/徘徊AI)、分层刷怪(地表按群系/洞穴bat+skel/地狱lslime+bat/eoc豁免cap与消散)、敌怪岩浆伤害(lslime免疫)、玩家岩浆伤害(30帧/28伤)、minPower挖掘门槛(黑曜石65/黑檀石55/狱岩100,镐力不足消息)、存档v2(盔甲/宝箱/探索/devMode)+v1迁移、键位Tab地图/C智能/F飞行(dev)/G刷怪(dev)/N昼夜(dev)、Music接入(进世界day/入夜night/标题title)
- 主代理收尾: 代理超时于写worklog前; 引擎代码完整, 主代理修复测试用例一处误用(zombie白天消散属正确行为, 改用skel验证岩浆扣血), 147/147 断言通过(宝箱取放/门夹实体/盔甲防御数值/智能光标ray命中/箭命中/爆炸清格/EoC全流程/水晶封顶/橡子成树/存读档v2/v1迁移/explored边界/minPower/devFly/分层刷怪池/向导对话/主循环1200帧冒烟/旧render兼容/性能0.01ms每tick)
- scratch 已清理; tsc 全绿; lint 全绿

Stage Summary:
- 引擎新公共字段(9-f render 消费): g.projs(Proj[])/g.guide(Guide|null)/g.guideLine(当前台词)/g.guideTalkT/g.boss(Enemy|null)/g.smartTarget({gx,gy}|null)/g.mapOpen/g.explored(Uint8Array)/g.mapCanvas(w×h离屏)/g.chestOpen(idx|null)/g.devFly/g.saplings/g.chestContents/g.devMode/g.player.armor
- EngineAPI 新方法: newWorld(size,seedStr,name,dev)/toggleMap()/toggleSmart()/closeChest()/clickChestSlot(i,right)/clickArmorSlot(slot,right)
- ui 新字段已每帧/变化同步: defense/armor/chestOpen/chestSlots/boss/mapOpen/smart/devMode/playerName/biomeName + stations.altar
- 给 9-f: 家具整图绘制锚点见 9-b 条目备忘; LAVA/WATER 液体渲染建议 fillRect; MUSH_CAP/HELLSTONE/LIFE_CRYSTAL 光晕用 glowBlue/glowRed; EoC drawEoC(e.x,e.y为底部中心,phase,lookX=朝玩家偏移*0.06,flash); 盔甲渲染读 player.armor→ARMOR_COLORS
- 给 9-g: 键位表更新(Tab地图/C智能/M静音/E背包/Esc层级:地图>宝箱>背包>暂停); 新世界对话框调 engine.newWorld; HUD 心形支持20颗两行; GAME_CONTROLS 更新

---
Task ID: 9-f + 9-g
Agent: general-purpose (渲染/UI, 均超时于收尾前, main 代为验证补记)
Task: render.ts 渲染层升级 + HUD/Overlays UI 升级

Work Log:
- 9-f render.ts 395→756 行: 新方块分支(LAVA 波纹+冒泡+glowRed 光晕/HELLSTONE 余烬闪点/MUSH_CAP glowBlue/LIFE_CRYSTAL crystalFrames 脉动/JUNGLE_GRASS、CORRUPT_GRASS 自包含贴图/门 doorC doorO 16x32/宝箱 chest 32x32+开箱金光/祭坛 altar+浮动符文点/桌椅/树苗/藤蔓/三树冠/仙人掌/通用新地形块), 玩家盔甲渲染(armorColorsOf: ARMOR_COLORS 按 helmId+slot偏移 查色, 空槽回退 PLAYER_PALETTE), 新敌怪分支(bat/skel/lslime+glow/eos/eoc Boss: drawEoC+telegraph 抖动+不画通用血条), 向导(GUIDE_PALETTE+名牌+对话气泡 measureText 自适应+淡出), 投射物(drawArrow 旋转/drawBomb+引信火花), 智能光标高亮(青色 smartTarget), 全屏地图叠加层(等比缩放 mapCanvas+探索迷雾缓存: 首次全量/玩家跨16格局部重画/90帧定时/世界变更全量重建+玩家白点/出生点绿点/Boss红点/标题与坐标群系名)
- 9-g HUD.tsx 642→808 行 + Overlays.tsx 198→369 行: 盔甲三槽(头/身/腿 40px+图标标签+tooltip 防御+)/宝箱面板(5x4 金边格+clickChestSlot)/防御徽章(心条旁)/Boss 血条(顶部中央金色名+红条+10%刻度+ARIA)/心形两行(20颗)/信息条群系名/智能光标切换按钮/GAME_CONTROLS 更新(Tab 地图/C 智能/dev 行)/tooltip 增强(盔甲防御/弓远程/炸弹); Overlays: 世界生成对话框(三尺寸 radio/种子输入/角色名/开发者模式 checkbox/开始返回)、标题按钮文案、暂停菜单玩家名+种子+dev 徽标、死亡屏玩家名
- 验证(主代理): scratch-9f 56/56 通过(新方块/家具/敌怪/投射物/盔甲/智能光标/开箱微光/地图叠加/迷雾缓存四种失效路径/数百帧冒烟/中世界)后删除; tsc 0 错误; lint exit 0; agent-browser: 标题屏→生成新世界对话框(大世界+种子 terraria+Dev 开)→进入游戏(铜镐/斧/剑+火把10)→移动→E 背包→Tab 地图→N 夜晚→G 刷怪, 全程零 console 错误

Stage Summary:
- 全部 UI/渲染新内容落地; 截图存 agent-ctx/(new_game/walk1/inventory/map/night_spawn).png 待 VLM 视觉复审
- 剩余: 9-int 主代理深度集成验证(VLM 视觉+更多交互) → 9-h 单文件版重建 → 9-i GitHub 推送

---
Task ID: 9-h
Agent: general-purpose (单文件版打包)
Task: standalone/main.ts 同步 9-e~9-g 新 UI + 重建 public/terraria.html

Work Log:
- 仅改 standalone/main.ts(667→1058 行) + 重新生成 public/terraria.html; 未动 src/ 任何文件、未动 build.ts(仅执行)
- A1 世界生成对话框: 标题屏"生成新世界"改为打开 #gen 模态(三尺寸 radio 小/中/大+尺寸数字、种子 input maxlength32 留空随机、角色名 maxlength12 默认泰拉行者、开发者模式 checkbox、开始冒险(金)/返回、生成中 spinner+全部控件 disabled), 复刻 React 版 handleStartNewWorld: setTimeout(60) 先绘制按钮态再同步阻塞调 eng.newWorld(size,seed,name,dev)+enterWorld
- A2 盔甲三槽: 背包面板顶部 #armor-row(盔甲标签+头/身/腿 40px 槽+badge 字+右侧 🛡防御 N), data-armor 委托 mousedown→eng.clickArmorSlot(slot,right), tooltip 走通用 data-tip-item
- A3 宝箱面板: #chest-panel(st.chestOpen 时)置于背包面板 inner 顶部(金标题"宝箱"+✕关闭按钮→eng.closeChest+5x4 金边 .slot.gold 格 grid-cols-5), data-chest 委托→eng.clickChestSlot(i,right); panelOpen=invOpen||chestOpen 合并展示(引擎开宝箱不置 invOpen, 与 React 版一致), hotbar inv-open 态/背包显隐均跟随 panelOpen
- A4 Boss 血条: #bossbar 顶部中央 top56/72px(金色名+text-shadow 描边、红渐变条金边 2px+9 根 10% 白刻度+hp/maxHp 数字、ARIA progressbar valuemin/max/now), st.boss&&maxHp>0 时显示, fill 宽度 calc((100%-4px)*ratio)
- A5 心形两行+防御: heartsHTML 改显式分行(每行 10 颗, maxHp200→2 行 20 颗), 心条下方 #defense 徽章(盾 SVG+数字, title=防御 N), 换血量时重放 heartpulse 动画(classList remove+reflow+add 复刻 React key={hp})
- A6 信息条: 加 .biome 行(st.biomeName 10px #9ab8e0)
- A7 智能光标按钮: #infobar 下方 #smart-btn(十字准 SVG+"智能 开/关", on 态金框金字, aria-pressed/title"智能光标 (C)")→eng.toggleSmart
- A8 暂停菜单: 玩家：{name} · 种子：{seed}(mono 字体, seed 空时整段隐藏)+开发者模式已开启徽标(st.devMode); 死亡屏 h2 改"{playerName}死亡了…"
- A9 帮助面板: CONTROLS 更新为 11 行(E 背包/Tab 全屏地图/C 智能光标), 两处弹窗均加 .dev-line(devMode 时显示"F 飞行 · G 刷怪 · N 昼夜切换"金边行), 标题屏按钮文案改"操作指南"
- A10 Tab 修正: 键盘绑定删掉旧"e||Tab 开背包", 仅 E 开背包(引擎 capture 阶段已 stopPropagation 接管 Tab/Esc 地图/宝箱优先级); main.ts Esc 处理补 chestOpen 分支(fallback, 与引擎优先级一致)
- A11 tooltip: KIND_LABEL 加 armor 盔甲、STATION_NAMES 加 altar 恶魔祭坛(工作站指示灯加第 4 个"祭坛"); itemTipHTML 加 盔甲"防御 +N"(#9ab8e0)/弓"远程 · 伤害 N"(#a8d8a8)/炸弹"爆炸物 · 伤害 N"(#f0b090) 三分支(远程分支优先于普通伤害行)
- A12 memo/委托: 新增 lastArmorKey/lastChestKey/lastBossKey/lastSmartKey/lastDefenseKey/lastPausedKey/lastDeadKey/lastHelpDevKey 分区 memo, 全部沿用既有"key 变化才重绘innerHTML"模式; slotHTML 重构为 (slot,dataAttrs,cls,badge) 通用签名供 背包/快捷栏/盔甲/宝箱 四类槽复用
- B 构建: bun standalone/build.ts → public/terraria.html 336.6KB(旧 168KB, 引擎+UI 大升级所致); 产物零 http(s) 引用(仅 data-URI favicon+运行时程序化贴图)、零 fetch; 存档键 tw-save-v2/v1 由共享 engine.ts 处理, 与 Next 版同源同键互通(已实测互通)
- C 验证: bunx tsc --noEmit(过滤 examples/skills 既有 4 错)src/standalone 零错误; bun run lint exit 0
- E2E(agent-browser, dev server /terraria.html): 标题屏→生成对话框(选大 1900x460+种子 terraria+名"测试勇者"+Dev 开)→进入世界✓; E 背包(盔甲三槽 40px+防御 4+4 工作站指示含祭坛)✓; Tab 地图开(canvas 采样 rgba(10,12,24,.92) 暗罩=15,23,41)/关且不开背包✓; C 智能开/关(aria-pressed 同步)✓; Esc 暂停显示"玩家：测试勇者 · 种子：terraria"+Dev 徽标✓; reload→继续上次冒险→大世界/名字/种子/Dev 全还原✓; 盔甲槽 tooltip"铜头盔/盔甲/防御 +1"✓、点盔甲槽取放(光标物品出现/回收)✓; 宝箱面板(20 金格+4 件战利品火把x12/木箭x52/木材x37/炸弹x5, 取放物品、E 关宝箱保背包、再 E 关背包)✓; 炸弹 tooltip"爆炸物 · 伤害 60"✓、木箭"弓的弹药"✓; Boss 血条(克苏鲁之眼 1800/1800→砍一刀 1799 条宽更新)✓; 死亡屏"测试勇者死亡了…"ovl open✓; 帮助面板 11 行+dev 行✓; 375x667 移动端 docW=375 无横向溢出(游戏/背包/标题/对话框 boxL16-R359)✓; 全程 0 page error/0 console 错误
- 宝箱/Boss/盔甲/双行心 E2E 用临时 window.__dbg 调试钩子(teleport+openChestAt/spawnEnemy eoc/直接设 armor+maxHp)验证渲染路径, 验证后已整体移除并重建正式产物(grep __dbg=0), 正式产物另跑全流程冒烟(新世界生成→背包→地图→暂停)确认无回归
- 截图 23 张存 agent-ctx/9h_*.png(title/gendialog/genfilled/game/inventory/armor_tooltip/inventory_armor/chest/boss/help/paused/deathx3/mobile_x3/final_x6/continue/map)

Stage Summary:
- 交付: standalone/main.ts(1058 行, +470/-78) + public/terraria.html(336.6KB); 12 项同步清单全部完成
- 存档互通确认: 单文件版与 Next 版共享 localStorage tw-save-v2(引擎侧统一, 无需改动)
- 遗留问题: ①弓(BOW 本体)的"远程 · 伤害"tooltip 分支未实测无弓存货(木箭/炸弹 tooltip 已验证, 分支代码相同结构); ②Boss 血条中途 hp 更新仅验证单次 1800→1799(机制与心条同为 memo 重绘, 风险低); ③产物 336.6KB 略超预期区间 200-300KB(引擎 9-e 大升级所致, 非打包问题)
- 下游: 9-i GitHub 推送可直接携带新产物

---
Task ID: 9-int
Agent: main
Task: 集成验证 — 端到端实测 + 关键 Bug 修复

Work Log:
- tsc 0 错误 / lint exit 0 / dev server 全程 200 无错误
- agent-browser 端到端: 标题屏→生成新世界(大1900x460/种子/角色名/Dev)→进入(初始四件套+向导在出生点)→飞行探索(白天森林→群系→地狱岩浆狱岩→洞穴)→E 背包(盔甲三槽)→Tab 全屏地图→C 智能光标→N 昼夜切换→G 刷怪, 全程零 console 错误
- Boss 战全生命周期实测(存档注入装备+夜间+可疑眼球): 右键召唤(需避开向导48px对话半径)→phase0 悬浮/震颤/3连冲→玩家被击杀→死亡重生→【修复1】Boss 存活战斗继续→压血线45%触发 phase1 spin+4连冲→黎明 flee 逃走(消息+血条消失)→再次召唤→击杀: 掉落 27 魔金矿+4 晶状体+「你击败了克苏鲁之眼！」
- 【修复1·关键】engine.ts 三处: ①tickDead 70格过滤器补 Boss 豁免(死亡画面期间 Boss 不被距离清除) ②重生清怪过滤器补 Boss 豁免(原 bug: 玩家死亡重生→悬浮在出生点上空的 Boss 被静默删除, 表现为"Boss 无声消失", 已实测复现并修复) ③向导右键对话半径 60→48px(减少站在向导身边时右键使用物品被拦截)
- 单文件版随修复重建: public/terraria.html 336.7KB
- VLM 视觉评审因账户级 429 限流未能执行本轮截图复审; 视觉质量由 9-b(205项贴图断言+ASCII目检)/9-f(56项渲染断言)/9-h(23张E2E截图)覆盖; 截图存档 agent-ctx/(new_game/biome1/biome2/hell/cave/inventory/map/night_spawn/boss1-3).png
- 排障记录: 工具输出管线会吞 ESC 转义序列([h/[m), 导致源码显示疑似损坏(ItemDefs[held → ItemDefseld / w-[min( → w-in(), 实为显示假象, base64 验证源码完好

Stage Summary:
- 全部 9 系列任务完成: 群系世界/贴图精灵/实体AI/音效BGM/引擎17项系统/渲染/UI/单文件版/集成验证
- 剩余: 9-i git 提交推送

---
Task ID: 9-int (补充)
Agent: main
Task: 群系/移动疑云排查 — 最终结论

Work Log:
- 现象: agent-browser keydown 走路"不动"、小地图白点不动、群系名一直"森林"
- 排查: 白点居中=小地图窗口跟随(正常行为,不能证位移); 跨 CLI 调用触发 window blur → 引擎 onBlur 清空按键集(对真实用户是正确行为, 纯测试工具问题); 走路撞 2+ 格悬崖卡住(正常玩法, 需手动跳)
- 决定性验证: 单次 eval 页内按住 KeyA 1.6s → 地形哈希大变(玩家移动✓); 页内 12s 跳走 → 群系 森林→雪原; 再 20s → 雪原→腐化之地 (世界群系布局+群系名显示+移动全部正常)
- 结论: 游戏无 bug; 截图 agent-ctx/final_biome.png (腐化之地)

Stage Summary:
- 9 系列全部完成, 进入 9-i git 提交推送

---
Task ID: 9-i
Agent: main
Task: GitHub 提交推送

Work Log:
- 提交 f2a74ed "feat: 大版本内容升级 — 六大群系世界 + Boss战 + 盔甲系统 + 全屏地图 + 单文件版同步" (含完整变更说明)
- 推送至 https://github.com/43aquarius/web-terraria main 分支成功 (d2d966e..f2a74ed)
- 排除项: agent-ctx 截图/VLM json 等测试产物不入库

Stage Summary:
- 9 系列全部完成: 9-0/9-1 契约 → 9-a/b/c/d 并行(世界/贴图/实体/音频) → 9-e 引擎 → 9-f/9-g 渲染UI → 9-h 单文件 → 9-int 集成验证+关键Boss修复 → 9-i 推送
- 交付物: Next.js 版(/) + 单文件版(/terraria.html, 336KB) 双形态, 同一引擎同一存档

---
Task ID: 10-b
Agent: general-purpose (sprites)
Task: 重写 sprites.ts — 2x 块状像素风角色/敌怪精灵
Work Log:
- 按序阅读 worklog.md(末 200 行)/ART-SPEC.md(§2 调色板 + §5 精灵规范)/旧 sprites.ts(516 行)/render.ts 全部调用点(entities/engine 不直接引用 sprites, 唯一调用方 render.ts)
- 仅重写 src/game/sprites.ts(517 行), 全部导出签名/接口字段不变: HumanoidPalette 9 个必有字段原样保留, 新增可选扩展色阶(hairLight/hairDark/shirtShade/pantsDark/shoeDark/inner), SlimePalette 新增可选 line(描边色) —— 可选字段对调用方零破坏(render.ts 零改动通过 tsc/lint)
- 调色板全部换 ART-SPEC 精确值: PLAYER(发 #873822/#c25132/#542316, 肤 #ff7d5a/#be5d43, 眼白 #f1f1f1+瞳 #1f232a, 上衣 #e3cd9c/#beab82/#afa58c, 内衬 #6e634b+领口 shadeHex×0.45=#322d22, 裤 #8494b1/#7786a0, 鞋 #321812/#190c08) / ZOMBIE(腐绿皮 #7a9a5a/#5a7a40, 破衣 #6e634b/#4a4438, 暗绿发 #4a5a38, 红瞳 #c03838) / GUIDE(金发 #e8c860/#c8a040, 蓝裤 #5a7ab0, 米上衣) / SKELETON(骨白 #d8d8d0/#a8a8a0/#787870, 黑瞳 #101014, 肋缝=shirtDark #787870)
- drawHumanoid 全新逐像素实现: 10x15 逻辑=20x30 帧(P(c,r)=fillRect(c*2-10,r*2-30,w*2,h*2) 全偶数), 布局=头 6x5(发 2 行[顶亮行+后侧暗列+前额发丝]+脸 3 行[后侧阴影列+眼白 1px+朝向侧瞳+两侧垂发/鬓角) / 躯干 6x4(胸口 2 处暗纹+前侧阴影列+领口+腰部 1 行内衬) / 髋 1 行 / 腿 2x3 裤+1 行裤脚暗+底 1 行鞋(前半鞋色后半鞋暗) / 手臂 2x3(袖 1 行+肤 2 行)
- 走路 8 帧查找表 WALK_F/WALK_B(前/后腿各 [dx,lift]): 摆幅 ±2px、抬腿 1px、过中线帧一腿抬起一腿支撑, 帧 7 与帧 5 区分(7=前腿抬/5=后腿抬); 手臂反相摆(afdx=-fdx); 空中姿态=后腿后抬 1+前腿前伸(上升 vy<-0.5 时收 2); 僵尸/骷髅 zombieArms=双臂水平前伸(后臂从躯干后穿出+前臂横胸+手下垂)+嘴部暗色; 盔甲四件套(头盔[盔顶高光/面甲沿/盔后板+裙/护鼻留眼]/胸甲[侧缝+甲片缝+领口亮+腰带]/臂甲[袖亮+甲身+暗缝+手]/腿甲[膝盖高光])全部在 2x 网格重绘; 挥舞=肩(4,-20)旋转坐标系内 2px 块手臂(3 阶段由 render 传入的连续 angle 驱动)+物品 drawImage 锚点逻辑保留; flash 全色 #ff5040
- drawSlime: 适配任意判定盒(w/2 x h/2 逻辑网格), 水滴轮廓(顶 1px 圆弧→0.55/0.85 渐宽→中下部全宽→平底), 全周 1 逻辑 px 描边(轮廓膨胀一圈, line 色), 主体底 1 行暗色, 左上 1x2 高光斑, 双眼=深色竖椭圆(2x6/2x4)+顶部白点 2x2、随 dir 偏移; squish→dw=clamp(round(squish*2.5),±1) 宽+1 高-1(拉伸反向); maxHW=floor(lw/2) 保证 squash 档位可见; 半透明 α0.88 保留; 三调色板带 line 描边色(#1d5a1d/#0a1c42/#6b1e08)
- drawEye 重设计: 像素圆球(圆弦轮廓 rows=max(4,round(min(w,h+2)/4)*2), h=14→16x16 球) #f1f1f1 + 边缘血丝 #d05050(6 处确定性 2 段折线) + 大虹膜 #c03030 4x4 朝 dir 偏移 2px + 瞳 #1a1a2a 2x2(朝向前侧) + 顶部 #ffffff 高光; 背后 3 条 #b04040 触须(替换旧翅膀, 随 t 摆动 ±2px)
- drawBat: 身体 3x3 #4a3628+双耳 2x2, 翅膀两帧(上展/下收)3 段折线块 #3a2818, 红眼 #e03030 2x2 朝向前侧
- drawEos: 分节虫体=头(12x12 描边 #4a3568+8x8 主体 #6a4d8e+3 颗白牙 #f1f1f1+红眼 #d83030)/身节 x2(6x6 圆段 #5a4278+底部暗边, 随 anim 起伏 ±2 交错)/尾(2x4 细尖); mr() 镜像助手处理 dir
- drawEoC: 像素椭圆球体(rows=round((h-6)/2)=16 行×maxHW=11 → 44x32)+确定性 8 处血丝+大虹膜 #c03030 12x10(lookX/Y 偶数量化 clamp ±6)+瞳 #1a1a2a 4x4+顶部 #ffffff 4x4 高光; phase1 巨口=暗口腔 #3a0a0a(6 行渐宽 8..20..8px)+红牙 #a02020 上下各 5 颗锯齿(长短交替)+±2px 脉动; 后部 5 条 #b04040 触须(2px 块, animT 摆动); flash>0 白色 α0.55 覆盖
- drawArrow: 杆 #976b4b+头 #adb8cd(两段收窄)+尾羽 #e8e8e8 上下各 2 片, save/translate/rotate(angle) 结构保留; drawBomb: 8x8 像素圆黑球 #2a2a30+高光 #55555f+引线 #78553c+火花 #ffd75e/#ff9a3c/#fff2b0 双频闪烁(闪烁节奏沿用旧 t*0.8/t*1.7)
- 全部精灵锚点 snap2()吸附 2px 网格, 保证任何位置下 fillRect 落在偶数坐标(2x 块对齐)
- 验收自测(临时脚本 /home/z/sprites_test.ts, 已删): mock canvas 记录 fillRect, 149 项断言全过 —— a) 8 走路帧(walkT=k*π/4)腿部色块坐标 8/8 帧互异(要求≥6); b) 输出含 #873822/#ff7d5a/#8494b1/#321812(另验证 #c25132/#542316/#be5d43/#f1f1f1/#1f232a/#e3cd9c/#6e634b/#7786a0 全到位)+全部色块在 20x30 帧内; c) drawSlime 含 #205ad4+#0a1c42+#1a49ac+#4074e2 且描边包围盒四边超出主体≥2px, squash(0.34) 宽 24>20 高 14<16, 三调色板×4 squish×2 dir×2 flash 共 48 组合冒烟; d) drawEoC 含 #f1f1f1+#c03030+#1a1a2a+#d05050+#b04040+#ffffff, phase1 含 #a02020+白闪, 相位/look 极值冒烟; e) humanoid 9 状态×4 调色板+slime/eye/bat/eos/eoc/bomb 全部 fillRect 坐标尺寸为偶数(含奇数坐标输入、dir=-1、盔甲+空中挥舞组合), drawArrow(旋转例外)5 角度冒烟; 附加: swing.icon=null 回退/blinkHidden/僵尸红瞳/骷髅黑瞳+肋缝
- ASCII 目检(临时脚本已删): 玩家静止/走路帧 2/帧 5/跳跃/铜盔甲/僵尸/骷髅/向导 + 蓝绿史莱姆 + 恶魔眼 + 蝙蝠双帧 + 噬魂者 + EoC 双相位, 布局逐块核对(头脸眼/躯干纹/髋腿鞋/手臂摆/盔甲层/水滴描边/虫体分节/巨口锯齿)全部符合设计; 期间修正 2 处: eos 身节 mr(-3) 奇数坐标→mr(-4), slime maxHW round→floor(奇数 lw 时 squash 档位不可见)
- 环境: bunx tsc --noEmit -p tsconfig.json — src 零错误(仅 examples/skills 既有 4 错, 与基线一致); bun run lint exit 0(eslint sprites.ts 零问题)
- 浏览器实测(dev server localhost:3000): 进入世界零 page error/console 错误; 切白天后 canvas 采样确认玩家新调色板全到位(#ff7d5a 416px/#873822 112px/#8494b1/#e3cd9c 144px/#321812 296px/#f1f1f1 32px); G 刷怪后僵尸 #6e634b 在屏; 截图 agent-ctx/10b_*.png(注: 史莱姆半透明 α0.88 与背景混色, 屏上采样不做精确色断言, 精确色由 mock 测试覆盖)
Stage Summary:
- 交付: 仅 src/game/sprites.ts 一个文件(全量重写 517 行); 调用方 render.ts/entities.ts/engine.ts 零改动; HumanoidPalette/SlimePalette 仅新增可选字段(扩展色阶/描边色), 全部函数签名与 opts 字段 100% 不变
- 视觉: 角色/敌怪全部对齐 ART-SPEC 2x 块状像素规范(逻辑像素→2x2 fillRect), 玩家 20x30 帧、史莱姆水滴+全周描边、恶魔眼/蝙蝠/噬魂者/EoC 逐像素重绘, 调色板为规格精确色值
- 验证: mock 149/149 断言(含任务书 a-e 全条款)+tsc src 零错误+lint exit 0+浏览器实测零错误
- 已知说明: ①旧 public/terraria.html 单文件产物内嵌旧 sprites 代码, 需后续任务执行 standalone/build.ts 重建才会带上新精灵(本任务红线=只改 sprites.ts, 未动产物); ②史莱姆 "16x24(8x12 逻辑)" 规格解读为标称帧比例参考, 实际按判定盒 w/2×h/2 逻辑网格绘制(gslime 8x6/bslime 11x8/lslime 9x7), 保证碰撞视觉一致; ③腿长 6 逻辑行(裤 3+髋 1+暗脚 1+鞋 1)以填满 10x15 帧, 规格字面 "腿 2x3" 按裤区 3 行落实

---
Task ID: 10-a
Agent: general-purpose (textures) [超时前完成代码, 由 main 验证收尾]
Task: 重写 textures.ts — 参考站精确调色板 + 2×2 块状纹理系统

Work Log:
- 子代理执行超时(context deadline), 但代码已完成: textures.ts 1300→1683 行, 内部 51 个绘制函数全量重写
- 接口契约 100% 保留: mulberry32 / GameTextures 全字段 / getTextures() 单例
- 核心: logical() 助手(8×8 逻辑网格 → ×2 放大 16×16)实现参考站的 2×2 块状像素结构
- 调色板换为 ART-SPEC.md 精确值(泥土 #976b4b/#725138/#bf8f6f、石头 #616772 五档、草 #1e9648/#1cd85e/#0d6524、四矿粒团+闪光色、树皮竖纹马尔可夫、树叶亮上暗下等)
- main 接手验证: tsc 零错误 + 浏览器像素采样 13/14 目标色命中(泥土三档/石头两档/草三档/玩家肤色发色裤色/树干/树叶全部在屏)

Stage Summary:
- 交付: textures.ts 全量重写(2x 块状结构 + 参考站精确调色板), 编译零错误, 渲染验证通过

---
Task ID: 10-c
Agent: general-purpose (render) [超时前完成代码, 由 main 验证收尾]
Task: render.ts 升级 — 边缘描边 + 墙面暗化 + 深度分层背景

Work Log:
- 子代理执行超时, 代码已完成: render.ts 44KB, 含 EDGE_MATS 材质→描边色映射表 + drawTileEdges + 树林剪影层 + 深度分层背景
- main 接手验证(浏览器实测):
  - 边缘描边: 地形区检测到 12,015 个暗边采样点(泰拉瑞亚标志性地形轮廓)✓
  - 深度背景: 地表角落亮度 77 → 洞穴 40(55% 深度实时传送实测)✓
  - 火把照明: 洞穴中心亮度 6(黑暗) → 47(持火把)✓
  - 远处树林剪影层 + 地表线对齐 ✓
- tsc/lint 零错误, 全程零 page error

Stage Summary:
- 交付: render.ts 三大视觉升级(描边/背景/暗化)全部生效, 浏览器像素级验证通过

---
Task ID: 10-d
Agent: main
Task: 视觉验证循环 — 程序化像素采样替代 VLM(VLM 账户级 429 限流)

Work Log:
- VLM 评审三次尝试均 429 限流, 改用更精确的程序化像素采样验证
- 调色板验证: eval 采样 canvas, 13/14 目标色命中(泥土 base/dark/light、石头 base/dark、草 main/bright/dark、玩家 skin/hair/pants、trunk、leaf; stone_light #adb8cd 当前视口未出现)
- 传送验证: 通过 window.__game 引擎对象 + world.isSolid 搜索 3×3 气腔实时传送(修正: 坐标是像素单位, 首次误传 y=187px 到天上)
- 黄金路径: 走路(KeyD 266px)✓ 挖掘(铜镐挖泥土, 方块 1→0, 掉落物拾取入背包)✓
- 排障记录: 挖掘初次"失败"实为手持火把(放置类); E 键需 window+key:'e' 属性(React 层监听), 引擎层 code 即可
- UI: 背包开合正常, 新图标系统渲染正常
- 截图存档: agent-ctx/10_check_game.png, 10c_surface.png, 10c_cave_real.png, 10c_cave_torch.png, 10d_surface_final.png, 10d_inventory.png

Stage Summary:
- 视觉重构三件套(textures/sprites/render)全部完成并实测通过
- 剩余: 10-e 单文件版重建 + GitHub 推送

---
Task ID: 10-e
Agent: main
Task: 单文件版重建 + GitHub 推送

Work Log:
- bun standalone/build.ts → public/terraria.html 357.6KB(引擎共享 src/game/*, 自动带上新视觉三件套)
- 单文件版浏览器冒烟: 标题屏→进入世界→像素采样验证(泥土/草/玩家肤色新调色板全部在屏)→零 page error
- git commit 1f5079c "feat: 视觉重构 — 对齐原版泰拉瑞亚观感" (6 文件, +3900/-2290)
- 推送 https://github.com/43aquarius/web-terraria main 分支成功 (f2a74ed..1f5079c)
- 提交包含: textures/sprites/render 三件套重写 + ART-SPEC.md 美术规格 + worklog

Stage Summary:
- 10 系列全部完成: 10-0 规格文档 → 10-a/b/c 并行重写(贴图/精灵/渲染) → 10-d 验证 → 10-e 交付
- 交付物: Next.js 版(/) + 单文件版(/terraria.html) 双形态同步升级, 视觉对齐参考站标准

---
Task ID: 12-0
Agent: main
Task: 原版素材获取与逆向分析(11/12系列前置)

Work Log:
- 下载 terraria.space-z.ai 全部 197 个原版 PNG 素材到 public/assets/(curl 并行, WebP→PNG sharp 转换, 197/197 校验为真 PNG, 共 1.7MB)
- 逆向参考站渲染 JS(beautify 610KB): 完整提取以下逻辑——
  - 帧查找表: S=[6,2,9,2,6,5,9,0,12,12,5,1,12,4,2,10](泥土/草/石, step16), C=[12,1,9,1,12,5,9,0,12,12,5,1,12,4,1,0](木, step16), _=[0,1,2,1,0,3,2,4,5,5,3,4,5,4,1,3](矿/沙 step17, 腐化草/黑檀石/灰烬/泥/丛林草/黑曜石/狱岩等 step18)
  - 邻接帧选择 rN: idx = up|right<<1|down<<2|left<<3, flipY 规则(上同下不同时上下互换+垂直翻转)
  - 同族融合 rG: {dirt,grass,corrupt_grass} / {stone,iron,copper,silver,gold,ebonstone,demonite} / wood / sand / {mud,jungle_grass} / obsidian / ash / hellstone / obsidian_brick / blue_brick
  - 瓦片映射: dirt_tile_set / GrassTilesetTerraria / stone_tile_set / wood_tileset / Copper_ore_tileset / Iron_Ore_tileset / silver_ore_tileset / Gold_ore_tileset / sand_block_tileset / Corrupt_grass_tileset / Ebonstone_tileset / Demonite_ore_tileset / Obsidian_tileset / Ash_block_tileset / Mud_tileset / Jungle_grass_tileset / Hellstone_tileset / Obsidian_brick_tileset / Blue_brick_tileset
  - 墙: dirt_wall_tileset / Wood_wall_tileset / Blue_brick_wall_tileset 取 (0,0,16,16) 帧 + 0.45 暗化
  - 玩家: player_spritesheet 380x30 = 19帧x20x30; 帧0站立/1-4挥击/5跳跃/6-18走路; 绘制 64x96(参考站32px格); 盔甲用 *_ingame.png 叠绘
  - 敌怪布局: Zombie 3帧x34x46 / Skeleton 7帧x60x48 / 绿蓝熔岩史莱姆 2帧x32x24 / Demon_eye 2帧x37x22 / Cave_Bat 4帧x28x24 / Eater_of_souls 2帧x42x78 / EoC 两相位 80x80 / EoW 头/身/尾 60x60 / Guide 15帧表[[0,26],[29,30]...] / Old_man 40x46
  - 树: tree_example.png 76x142 整树精灵, 高度=(heightTiles+3)*32 拉伸, 奇数 variant 水平翻转
  - 高草: Tall_Grass_1-6 (8x18) 24px 高 + 风摆 shear + 丛林绿色叠加
  - 背景: 玩家深度选层(y<15%森林/腐化, <30%地下, <50%洞穴, <70%熔岩, 其余地狱), 高度铺满视口 + 0.5 视差横向平铺
  - 物品图标: 全部 *_item.png / 工具/武器 PNG
- 已创建 src/game/assets.ts 接口骨架(帧表/布局常量/绘制函数签名/图标覆盖钩子) — 12-a 实现体, 12-b 渲染接入, 双方以该文件签名为唯一契约

Stage Summary:
- 素材就绪: public/assets/ 197 个原版 PNG; 参考站渲染逻辑全部解密并存档于本节
- 契约就绪: src/game/assets.ts 骨架(TILE_SHEET/frameFor/LAYOUT/drawImg*/applyItemIcons)
- 下一步: 12-a 实现 assets.ts / 12-b render.ts 接入 / 12-c 手机端适配(并行)

---
Task ID: 12-c
Agent: general-purpose (手机端适配)
Task: 手机端触屏适配与相机修复 — viewport meta / 引擎触屏输入 / 触屏交互层 / HUD 触屏可用

Work Log:
- 按序阅读 worklog.md(末两节 10 系列+12-0)/ engine.ts(mount/unmount/resize/onMouse*/onKeyDown/moveInput/tickGame 移动跳跃段/followCam/setEngine-getEngine)/ GameCanvas.tsx / HUD.tsx 全文 / layout.tsx / page.tsx / globals.css / Overlays.tsx(全部 onClick 已可用) / store.ts / render.ts 小地图位置(只读)
- **根因确认**: layout.tsx 无 viewport 导出 → 移动浏览器以 ~980px 虚拟视口渲染再整体缩放, canvas CSS 尺寸≠显示尺寸 → 画面比例错乱+玩家坐标错位跑出画面; 次因: 无触屏输入 / 地址栏收放 resize / iOS 安全区
- src/app/layout.tsx: 新增 `export const viewport: Viewport`(Next 16 规范) = device-width / initialScale 1 / maximumScale 1 / userScalable false / viewportFit cover / themeColor #000000; 修掉主因
- src/game/engine.ts(只加不改, 现有键盘鼠标路径 100% 原样):
  - 新公共字段 `touch = { active, mx, my, jump, mine }`(mx/my ∈ [-1,1])
  - 新公共方法 `touchAt(xCss, yCss, phase)` — 世界触摸转发入口, 'start'=鼠标移动+左键按下(含 SFX.init/Music.start, 对齐 onMouseDown), 'move'=移动, 'end'=左键抬起; 坐标单位与 onMouseMove 一致(画布内 CSS px)
  - moveInput(): 移动/跳跃/下平台改为键盘 ∪ 触屏并集(tmx<-0.15 左 / >0.15 右 / tmy>0.6 下平台 / touch.jump 等同按住空格, 保留"按住跳更高"); 精准跳跃/下跳机制不受影响
  - resize(): 检测 vw/vh 变化 >1px(旋转屏/地址栏收放)→ 相机立即对准玩家(followCam 目标位 px-viewW/2, py-viewH*0.62 + clampCam); mount/unmount 挂/卸 window.visualViewport 的 resize 监听(比 ResizeObserver 更及时)
  - followCam() 兜底: 玩家越出相机中心 0.5 视口范围 → 插值系数 0.14→1(瞬移回中), 根治"跑到画面外"
- src/components/game/TouchControls.tsx(新建 242 行): 仅触屏设备渲染('ontouchstart' in window || maxTouchPoints>0, useSyncExternalStore 空订阅模式 SSR 安全——规避 react-hooks/set-state-in-effect lint 报错)
  - 世界触摸层 .tc-world(全屏 pointer-events-auto, pointer 事件+setPointerCapture, 单指跟踪第二指忽略): pointerdown/move/up → eng.touchAt(clientX-rect.left, clientY-rect.top, phase); globals.css `@media (pointer: fine)` 下整层 pointer-events:none —— 混合设备(触屏笔记本)鼠标/滚轮/右键/中键仍直达画布走引擎原生事件, 桌面零回归
  - 左下虚拟摇杆: 120px 圆盘(border-white/40 bg-white/10 backdrop-blur)+48px 手柄(bg-white/30), safe-area 左下 24px; 拖动半径 40px/死区 8px → eng.touch.mx/my; touch-none
  - 右下跳跃按钮: 88px 大圆钮 safe-area 右下 24px, ChevronUp 图标, pointerdown→touch.jump=true+SFX.init, pointerup/cancel→false
  - 每控件独立 pointerId 跟踪防第二指误触; 切屏/卸载时 clearTouchInput 清引擎触屏状态+mouse.left(防死亡/回标题后卡死自动挖掘)
- src/components/game/HUD.tsx(最小可用性补丁):
  - SlotCell onMouseDown→onPointerDown(触屏 tap 即触发, 鼠标左/右键语义不变), hover 改 onPointerEnter/Leave 且仅 pointerType==='mouse'(触屏不再弹残留 tooltip)
  - 右下按钮组新增背包按钮(Backpack 图标, onClick=engine.toggleInventory, 等价 E 键)——原 HUD 仅键盘 E 可开背包
  - HUD_CSS 追加 `@media (pointer: coarse)`: 右下按钮组抬到跳跃钮上方(bottom+128px)+触达≥44px、隐藏键盘提示文案、左下消息抬到摇杆上方(+152px)、背包/宝箱面板 bottom+150px(面板打开时摇杆/跳跃仍可操作)
- GameCanvas canvas 加 touch-none; page.tsx 在 GameCanvas 与 HUD 之间挂 TouchControls(低于 HUD/Overlays, 不挡快捷栏/按钮); globals.css 加 html/body overscroll-behavior:none + -webkit-tap-highlight-color:transparent
- 自测: bunx tsc --noEmit — 本任务 6 文件+新建 1 文件零错误(仅剩 examples/skills 既有 4 错 + assets.ts 12-a 骨架 19 错, 均为并行任务基线); bun run lint exit 0
- 浏览器实测(agent-browser):
  - iPhone 15 模拟(393x852, dpr3→引擎 dpr 上限 2): meta viewport ✓, scrollW==clientW 无横向滚动, canvas 393x852 全铺满且引擎 vw/vh 精确一致(虚拟视口缩放根除), 玩家相机中心偏移 (0,0)
  - 375x667 / 667x375 双向: 旋转后引擎 vw/vh 即时更新+玩家仍居中(0,0), 无横向滚动; 摇杆/跳跃钮渲染 ✓
  - 功能: 摇杆拖动 mx=0.75→-0.5/my=0.25→释放归零 ✓; 按住右推 1s 玩家 +97.7px 且始终居中 ✓; 跳跃钮按下 touch.jump=true+离地 ✓ 抬起 false ✓; 世界层触摸按住 3s 挖掉泥土块(tile 1→0) mouse.left/mine 起落正确 ✓; 快捷栏 tap 选中槽位 2 ✓; 背包按钮开合面板 ✓; 中途 quitToTitle 触屏状态全部清零(防卡死) ✓ 再进入控件回归 ✓
  - coarse 让位规则模拟验证(headless 无 pointer 媒体匹配, 注入等效样式实测): 摇杆/消息、跳跃/按钮组零重叠, hint 隐藏, 按钮 44x44 ✓; 摇杆手柄拖动后像素采样确认视觉位移(新中心 [98,97,101] vs 原中心 [30,31,36])
  - 桌面回归 1024x768: 无摇杆/跳跃/世界触摸层(maxTouchPoints=0), 鼠标 move→engine.mouse 坐标一致、按住 3s 挖掉方块(1→0) ✓, JS 派发 KeyD/Space 移动+146px/起跳 ✓(agent-browser CLI 的 keydown 命令在 headless 下不达页面, 非应用问题), 全程零 page error/console 错误
  - 截图: agent-ctx/12c_mobile_375_portrait.png / 12c_mobile_375_coarse_sim.png / 12c_mobile_stick_drag.png / 12c_mobile_inventory.png / 12c_mobile_final.png

Stage Summary:
- 交付: 完整手机端适配 —— viewport meta(根因修复)+ 引擎触屏输入(touch 字段/touchAt/移动跳跃并集/visualViewport resize+相机即时回中/followCam 越界兜底)+ TouchControls 触屏交互层(世界触摸转发/虚拟摇杆/跳跃钮)+ HUD 触屏可用性(pointer 事件/背包按钮/coarse 让位)+ 画布 touch-none
- 红线遵守: 未动 render/assets/textures/sprites/world; engine.ts 纯增量(新字段/新方法/resize 与 followCam 增强/输入并集), 键盘鼠标路径行为不变(桌面回归实测通过)
- 已知说明: ①混合触屏笔记本(主指针 fine)世界触摸层按设计禁用, 触屏点击画布不挖矿(鼠标为主输入), 摇杆/跳跃钮仍可用; ②headless Chrome 无 pointer 媒体查询匹配, coarse 让位规则以注入等效样式验证, 真机必然匹配; ③单文件版(terraria.html)尚未包含触屏层(React 组件不在引擎内), 如需单文件触屏版由后续任务处理

---
Task ID: 12-a
Agent: general-purpose (assets) [超时前完成代码, main 补记]
Task: 实现 assets.ts — 原版素材加载/帧逻辑/图像化绘制/图标覆盖

Work Log:
- assets.ts 骨架 → 656 行完整实现: 加载器(逐文件 decode, 失败跳过)/帧表 S/C/_(并实测修正 step: 泥土草石木与腐化系均为 18px 步距, 矿+沙为 17px — 12-0 规格中"16"系误读, 实现时以参考站代码复核为准)/TILE_SHEET 20 材质映射/tileFamily 11 族/frameFor 邻接选帧(含 flipY 互换规则)
- 派生贴图: snow/ice/clay 由 dirt/stone 整图像素色相偏移生成(getImageData 一次性处理)
- 图像化绘制函数 15 个: 玩家(19 帧布局+盔甲 ingame 叠绘+挥舞帧 1-4)/僵尸(3帧x34x46)/骷髅(7帧x60x48)/向导(15 帧显式表)/三色史莱姆(2帧x32x24)/恶魔眼/蝙蝠(4帧)/噬魂者/EoC 双相位/EoW 三段/整树精灵(76x142 拉伸+tint 染色)/高草(风摆 shear)/火把(地面/墙双形态)
- applyItemIcons: 70 个物品图标 PNG 覆盖(icons/iconURL/anchors)
- main 补: 清单补缺(bg_* 7 背景/家具 12 件/dirt_wall_tileset/Skeletron 移除未用), ASSET_MANIFEST 导出(standalone 内嵌用), __TERRARIA_ASSETS__ 数据 URI 支持, TDZ 修复
- 验证: tsc/lint 零错误; 浏览器 121→137 请求全 200

Stage Summary:
- 交付: src/game/assets.ts 完整实现(签名与 12-0 契约一致), 素材就绪后全渲染路径可用

---
Task ID: 12-b
Agent: general-purpose (render) [超时前完成代码, main 补记]
Task: render.ts 接入原版素材渲染

Work Log:
- render.ts 1051 → 1446 行: useAssets 就绪分支覆盖全渲染管线, 程序化回退 100% 保留
- 瓦片: TILE_SHEET 映射的 20 材质走邻接选帧(同族融合判定), 原版贴图自带边缘→不再叠程序化描边; 狱岩保留余烬+光晕
- 墙: dirt_wall_tileset(0,0,16,16) + 0.45 叠暗, 保留墙缘暗边
- 树: 视口扫描树基(TRUNK 底格+下方实心)→ heightTiles 统计 → tree_example 整树精灵(按 x 排序, 变体翻转, 群系 tint: snow/jungle/corrupt 由树基邻草判定); TRUNK/LEAF* 逐格绘制跳过(残干/浮空冠回退)
- 背景: drawImgBackdrop 深度分层(森林双图 100 格交替/腐化/地下/洞穴/熔岩/地狱), 高度铺满+0.5 视差平铺, 深层渐暗 0.15-0.5
- 实体: 玩家/僵尸/骷髅/向导/三色史莱姆/眼/蝙蝠/噬魂者/EoC 全部图像化(IMG_OFF 锚点偏移对齐碰撞盒), flash=lighter 二次叠绘; 挥舞物品用 PNG 图标旋转叠绘
- 家具: 工作台/铁砧/熔炉/宝箱/门(开关左右)/祭坛/椅子/平台/生命水晶(5帧动画)/树苗/高草 PNG 化
- 掉落物/快捷栏/挥舞图标: 经 applyItemIcons 自动生效
- main 补记: 无需返工, 一次通过

Stage Summary:
- 交付: render.ts 双路径渲染(原版素材优先/程序化兜底), 视觉与参考站同源

---
Task ID: 12-d
Agent: main
Task: 集成验证 + 修复 + 单文件版素材内嵌

Work Log:
- 发现并修复: assets.ts 清单缺 7 张背景图/12 件家具/dirt_wall_tileset(浏览器实测 bg 请求 0 → 补齐后 7/7)
- standalone/build.ts 重写: ASSET_MANIFEST 137 个 PNG base64 内嵌(window.__TERRARIA_ASSETS__), 产物 1641KB 零外链
- standalone/main.ts 补触屏层: tc-world 世界触摸转发(touchAt)/116px 虚拟摇杆(死区 0.13)/84px 跳跃钮; body.playing 才显示(标题/暂停可点); #hud z-index 35 保证快捷栏可点; coarse 下按钮组/消息让位
- 浏览器全量验证(VLM 视觉评审 9 轮 + 程序化像素采样):
  - 标题屏/世界: 原版贴图渲染正常, VLM 相似度 8/10
  - 与参考站对比: 瓦片同源确认; 背景(修复后)/树木/角色同原版; 剩余差异为 UI 布局(我们自带小地图/更多状态, 属设计差异)
  - 群系传送实测: 雪原(派生雪贴图正常)/丛林(泥 #5c4449 与原版 Mud_tileset 一致, VLM 误报)/腐化(黑檀石紫色正常)
  - 夜间: 僵尸/史莱姆原版精灵, 火把光照自然
  - 洞穴: 无光全黑/持火把径向衰减, 石头矿物原版贴图
  - 战斗: 剑击杀僵尸(hp 20→dead); 挖掘: 泥土 1→0 掉落拾取(需 zoom 坐标换算, 引擎无 bug)
  - HUD: 70 个物品图标 PNG 化(铜镐/泥土/盔甲全过)
  - 单文件版: 进入世界渲染与主版一致, externalAssetReqs=0, 零 page error
- dev.log 零异常; tsc/lint 零错误

Stage Summary:
- 全链路绿: 主版 + 单文件版双形态原版素材渲染, 移动端适配, 挖掘/战斗/光照/群系全部实测通过

---
Task ID: 12-e
Agent: main
Task: 交付收尾 — GitHub 推送

Work Log:
- 提交 6f2b6e4 "feat: 原版素材重构 — 197 个原版 PNG 全量接入 + 手机端完整适配"(328 文件: assets.ts/render.ts/TouchControls/viewport/单文件版/public/assets 197 PNG/截图)
- 推送 https://github.com/43aquarius/web-terraria main 成功 (84ee02c..6f2b6e4)
- dev.log 无异常

Stage Summary:
- 12 系列全部完成: 12-0 素材获取+逆向 → 12-a/b/c 并行(素材系统/渲染接入/手机端) → 12-d 集成验证 → 12-e 交付
- 交付物: Next.js 主版(/) + 单文件版(/terraria.html, 1.6MB 内嵌素材) 双形态, 原版素材渲染 + 完整移动端适配

---
Task ID: 13-b
Agent: general-purpose (Overlays 原版化)
Task: 完全仿照原版 Terraria 1.4 重做 Overlays.tsx(标题屏/世界生成/死亡屏/暂停菜单/帮助/Loading),只改 Overlays.tsx

Work Log:
- 仅改 src/components/game/Overlays.tsx(369→486 行),全部业务逻辑/useUIState/表单状态/handleSave/handleStartNewWorld/显隐条件/aria/pointer-events 保持原样
- OVL_CSS 扩充原版组件类: .terraria-font(var(--font-andy)+var(--font-cjk))、.t-stroke(8 向 1px 黑描边)、.t-menu-btn(石质按钮: #3d4355→#2b3040 竖向渐变 + #565e78 边 + inset 高光/暗部 + 圆角 3px,hover #4a5266 提亮,active 下压)、.t-btn-text(奶油→橙渐变字 background-clip:text + drop-shadow 投影,hover 变亮白,disabled 灰)、.t-menu-btn-gold(金边略大)/-sm(小号)、.t-panel(原版蓝 rgba(28,36,74,0.96) + rgba(120,140,220,0.8) 边)、.t-input/.t-radio/.t-close/.t-key(蓝底亮蓝边,选中/聚焦金色)、.t-death(大红字 #e03c3c + 8 向深红 #7a1414 描边 + 黑投影)
- 渐变字踩坑: color:transparent + text-shadow 会污染渐变 → 改用 filter: drop-shadow(1px 2px 0 rgba(0,0,0,0.55)); lucide 图标 currentColor 会继承 transparent → 声音按钮图标显式 text-[#f0b840]; 嵌套 inline-flex 文字经无头浏览器实测 background-clip:text 正常作用于后代文本
- 标题屏: 官方 logo(/assets/terraria_logo.png 628x193)mt-[min(12vh,80px)] w-[min(80vw,560px)]; 移除文字标题与副标题; 主菜单 w-72 sm:w-80 竖排(进入世界 gold/继续上次冒险(有存档)/生成新世界/操作指南); 背景暗化 /30→/20; 左下 "Web 复刻版 v0.2"; 右下 "Copyright © Re-Logic — Web 复刻致敬之作" + Github 图标(16px, opacity-70 hover:100, 新标签开 https://github.com/43aquarius/web-terraria); 新增 GitHubLink 内部组件(标题屏图标版/暂停菜单带文字版)
- 世界生成对话框/帮助弹窗/暂停菜单全部换 .t-panel 原版蓝; 生成对话框标题金色、单选/输入蓝底金选中、按钮石质小号; 暂停菜单布局保留(继续游戏/保存游戏/声音开关/回到标题 + 玩家信息),底部新增分隔线 + GitHub 链接行; 死亡屏文案改 "{playerName} 被杀死了…" + bg-red-950/60→/45; Loading 白字黑描边
- 验证(agent-browser 无头): DOM+computed style 断言全过——logo 560x172@11.1vh、按钮渐变/金边/3px 圆角/inset 阴影、渐变字 clip=text+transparent+drop-shadow、版本/版权黑描边、GitHub href/target/右下定位、三弹窗面板色值精确匹配、暂停内 GitHub 行、死亡字色/字号/8 向红描边; sharp 像素采样——logo 绿色字形 5265px、石质底 3779px、金按钮字 460px、普通按钮字 859px、死亡红字 14287px、蓝面板 91255px; 移动 375x667 布局不溢出不遮挡; 全程零页面错误
- 死亡屏测试方法: __game.diePlayer() 直调不触发 syncUI(引擎只在 tickGame 帧尾同步,正常游玩无此问题),补 __game.syncUI(true) 后验证; Loading 态用 50ms 以下 setTimeout 吞掉法冻结后截图
- tsc --noEmit 零错误、bun run lint 零输出(exit 0); 截图存 agent-ctx/13b_*.png 7 张

Stage Summary:
- Overlays 六个覆盖层全部原版化: 官方 logo + 石质按钮 + 原版蓝面板 + GitHub 双入口(标题屏右下/暂停菜单底部)
- 交付物: 修改 src/components/game/Overlays.tsx 一个文件; MenuButton 签名(onClick/children/gold/small)不变; 逻辑零改动
- 注意: 本任务不含 APK/PR(v1.0.17 清单第 1/4/5 项为 main 编排,版本号在 meson.build 由其他步骤统一)——Overlays 已就绪待集成

---
Task ID: 13-a
Agent: general-purpose (HUD 原版化)
Task: 完全仿照原版 Terraria 1.4 重做游戏内 HUD(src/components/game/HUD.tsx)

Work Log:
- 重写 HUD.tsx(833→~740 行, 单文件, 未动 Overlays/engine/render/entities/TouchControls):
  - 左上纵向布局(原版): 快捷栏 10 槽左上锚定(left-1.5/top-1.5), 槽位改原版蓝 rgba(63,82,151,0.80) + 亮蓝边 rgba(120,140,220,0.9) + rounded-[3px]; 选中槽金色边框 #f7d060 + scale-[1.12] + -translate-y-[2px] + z-10 + hud-sel 金色呼吸光; 序号 1-0 白字黑描边
  - 选中物品名显示在快捷栏右侧(min-[720px] 以上, 避开小屏 256px 小地图), 空手留空, .terraria-font(Baloo 2 + Noto Sans SC 回退, 新增 CSS 类)
  - 背包面板改为左上锚定、紧贴快捷栏向下展开(原版无底板, 槽位直浮世界): 面板第 1-3 行与常驻快捷栏同列对齐(同槽同距 gap-[2px])构成 4x10 网格; 面板打开时快捷栏行自动切换为背包语义(clickSlot 可拿放), 关闭时左键=selectHotbar(合并了原"重复第 0 行"两套槽位)
  - 盔甲三槽(头/身/腿)+防御(盾+数字)+工作站指示在网格下方一行; 合成列表(图标+名称, 仅 can=true, hover 配方 tooltip, 点击 engine.craft)在面板底部, 自带 max-h-36/44 滚动; 面板整体 max-h-[calc(100vh-13rem)] + max-w + overflow-y-auto + hud-scroll + touch-pan-y
  - 心形血条 20 颗/行(lg+ 单行 478px, 以下 max-w-[238px] 自动 10 颗换行, 375px 实测 2 行不溢出), 保留 tex.heartURL/heartEmptyURL 半心裁剪与 hud-heart-pulse; 心形+呼吸气泡+防御随左列流式排列(面板关闭时紧贴快捷栏下方, 打开时在面板下方, 还原原版"心形下移"行为)
  - 宝箱 5x4 金边槽位: lg 并排在背包网格右侧(lg:order-2), 小屏在网格上方(flex-col 默认序)
  - Boss 血条移至底部中央: 黑半透明底 + 红条(#d03838 系渐变) + 金/古铜边 #c9a227 + 黑外圈, Boss 名白字黑描边在条上、HP 数字在条下, 保留全部 aria 属性, 去掉非原版刻度线
  - 右上信息(小地图正下方 top-[186px] right-[11px] 与地图右缘对齐): 群系/深度(X 米)/昼夜改为原版信息配件风格裸文字(白 11px + 黑描边, 无背景框); 智能光标按钮改原版蓝小按钮
  - 左下消息去掉金色左竖条 → 纯半透明黑底白字(原版聊天); 右下三按钮(背包/静音/帮助)改原版蓝 rgba(63,82,151,.85)+亮蓝边; 帮助面板底色改原版蓝
  - 全文件清除 #6a76b8/8a96cc 蓝紫色系(禁 indigo 达成); coarse 媒体规则重算: hud-panel 由 bottom 让位改为 max-height:60vh(顶部锚定不再碰摇杆), hud-br/hud-msgs/hud-ibtn 让位规则原样保留
  - 保留全部功能: useUIState/useTextures 订阅、SlotCell onActivate/onHover(pointer 事件+触屏语义+右键)、MouseTooltip/CursorItemView/ItemTooltipContent/RecipeTooltipContent、E/Esc/M/H/数字键、GAME_CONTROLS/GAME_DEV_CONTROLS_LINE 导出(Overlays 依赖)、hud-fade-in 等动画
- 验证: bunx tsc --noEmit(过滤 examples/skills 后)零错误(仅剩 4 个 examples/skills 既有错误); bun run lint exit 0
- agent-browser 实测(1280x800 桌面 + 375x667 手机):
  - 进入世界 __game.enterWorld(): 快捷栏 x:12 顶部左上, 选中槽实测 49px(44×1.12 缩放生效); 20 心单行 w:478 y:62(紧贴快捷栏下方, lifeCrystal 提满 maxHp=200 验证)
  - 背包打开: 面板 y:62 紧贴快捷栏, 网格列 x:12 与快捷栏完全对齐(aligned=true), 宝箱/盔甲/工作站/合成列表全渲染; 手机 375px: 面板 top 锚定 h:228 不遮摇杆, 心形 2 行×10 棵不溢出, 快捷栏右缘 344<375
  - Boss: 夜晚用 EoC 召唤物实测, 血条 x:360 w:560 于 1280 视口精确居中, 底缘 768=800-12(bottom-3)
  - 交互回归: 槽位 pointerdown 点击选中 hotbar=3 ✓; addItem 木材后合成列表出现"木平台×2"并点击合成成功(木 50→49, 平台+2) ✓; 快捷栏物品名"火把"显示 ✓; 零 page error
  - VLM 视觉评审 3 轮(桌面开面板/手机开面板/桌面关面板): 全部"布局正常", 与原版 1.4 对照项全符合
- 截图: agent-ctx/13a_hud_desktop_closed.png / 13a_hud_desktop_20hearts.png / 13a_hud_desktop_bossbar.png / 13a_hud_desktop_final.png / 13a_hud_mobile_375_inventory.png / 13a_hud_final_verify.png

Stage Summary:
- 交付: HUD.tsx 单文件原版化重做 — 左上快捷栏+背包向下展开(4x10 同列对齐, 原版蓝槽位/金选中)、心形 20/行在其下(小屏 10 换行)、底部中央 Boss 条、右上裸文字信息+蓝按钮、左下纯黑底聊天、右下蓝色按钮组; 心形随背包展开自动下移还原原版行为; 全部交互与导出契约不变
- 关键决策: ①背包打开时快捷栏行即网格第 0 行(切 clickSlot 语义), 消除旧版重复行 ②面板无底板(原版槽位直浮世界) ③槽位尺寸 h-8→lg:h-11 断点后移, 规避 640-760px 视口与 256px 小地图重叠 ④coarse 面板由 bottom 让位改 max-h:60vh 顶部锚定
- 已知边界: 手机 375px 下快捷栏/面板与引擎固定 256x168 小地图部分重叠(渲染层归属 render.ts, 本任务红线不可动), HUD 在上层功能不受影响

---
Task ID: 13-c
Agent: main
Task: 全代码物理/刷怪 bug 修复 — 人物与怪物"卡死+消失"根治

Work Log:
- 根因分析: ① moveBody stepUp 只查目标列抬升区间, 漏查当前列头部上方 → 低顶棚下自动上台阶把头嵌进天花板(卡死+光照罩下隐形=消失); ② tickSpawn 洞穴/地表刷怪只查 1-2 格, 僵尸(h=36, 跨3行)头可嵌顶棚/悬崖, 飞行怪可生在山体内; ③ noPickup 按数组下标标记, splice 后错位; ④ 掉落物掉进岩浆永不消失
- entities.ts: 新增 boxClear(整身盒全列×全高实心检查) + unstickBody(防卡死安全网: 上/左右/下最近空位推移); stepUp 改用 boxClear 全盒检查; Enemy 增 stuck? 字段
- engine.ts: 玩家/向导/敌怪每帧 unstickBody 安全网; 敌怪连续嵌死 600 帧静默消散(Boss 豁免); tickSpawn 四条路径(地表地面/地表飞行/洞穴地面/洞穴飞行)全部整身 clearance, 地面怪出生位改 exact 站面顶; EoC 召唤 5 候选位找无遮挡; tickDrops noPickup 改按 Drop 引用 + 岩浆烧毁掉落物
- render.ts: 小地图窄屏(<768px)缩至 168x110(原 256x168) 避让左上快捷栏, 边框色改原版蓝; HUD.tsx 信息条断点适配 top-[128px] md:top-[186px]
- layout.tsx: 新增 Baloo_2(--font-andy, 原版 Andy 字体近似) + Noto_Sans_SC(--font-cjk)
- public/assets: 新增 terraria_logo.png(官方 Steam logo 裁剪 628x193 透明底) + Lesser_Healing_Potion.png(补齐参考站缺件)
- 验证(agent-browser 实测): 嵌进石头的骷髅 2s 内被推移到 24px 下方的洞腔(stuck=0 存活); 低顶棚+台阶场景按住 D 玩家被正确阻挡仅移动 2px 且 headRow=134 未嵌入顶棚行 133(旧代码必嵌); 开阔台阶 +82px 正常通过; 标题屏/HUD/背包/暂停菜单 VLM 全过; 手机 375px 快捷栏与小地图零重叠; 全程零 page error; tsc(排除 examples/skills 既有 4 错)/lint 零错误

Stage Summary:
- "卡消失"四根因全部修复: stepUp 全盒检查 / 刷怪整身 clearance / unstickBody 安全网(含读档旧位置兜底) / 长期嵌死敌怪 10s 消散
- 附带修复: 掉落物岩浆烧毁 / noPickup 引用化 / Boss 召唤位防嵌 / 小地图窄屏缩放

---
Task ID: 13-d
Agent: general-purpose (standalone 同步)
Task: 主版 13-a/13-b/13-c 全部改动同步到单文件版(standalone/)并重建 public/terraria.html

Work Log:
- 上下文确认: standalone/main.ts 直接 import ../src/game/engine(引擎/实体/渲染共享), 13-c 物理/刷怪修复(boxClear/unstickBody/stepUp 全盒检查/每帧防卡死安全网/tickSpawn 整身 clearance/EoC 5 候选位/tickDrops noPickup Map+岩浆烧毁/Enemy stuck 字段/小地图 168x110)随 src 自动进入产物, 无需镜像; 重建即生效(产物内 8 处 13-c 代码模式逐一 grep 验证在包)
- standalone/main.ts 全面重写(1170→约 1290 行, 只改 UI 层, 引擎/触屏/存档/音乐零回归):
  - HUD 原版化(对照 HUD.tsx): 新增 #topleft 左上纵向列(快捷栏行→背包面板→心形/呼吸/防御); 槽位改原版蓝 rgba(63,82,151,.8)+亮蓝边+圆角 3px, 选中金框 #f7d060+scale 1.12+translateY(-2px)+呼吸光; 快捷栏移到左上(left-1.5/top-1.5, 序号 1-0), 手持物品名显示在右侧(≥720px); 背包面板无底板、紧贴快捷栏向下展开(取消旧 #inv-hot 重复行, 面板打开时快捷栏行即网格第 0 行切 clickSlot 语义), 盔甲 3 槽(与普通槽同尺寸)+防御+工作站在网格下方, 合成列表最下(max-h 144/176 滚动); 心形 20 颗/行(小屏 max-w 238px 自动 10 颗换行); Boss 血条移到底部中央(黑底 rgba(8,6,6,.78)+红条渐变+金边 #c9a227+黑外圈, 去掉刻度线); 右上信息改小地图下方裸文字白字黑描边(128px/186px 断点)+智能光标蓝色小按钮; 消息纯黑底白字(去金色竖条); 右下按钮组原版蓝+新增背包按钮
  - 修复既有 bug: smart-btn 此前只渲染未绑定点击 → 绑定 toggleSmart
  - 覆盖层原版化(对照 Overlays.tsx): 标题屏官方 terraria_logo(内嵌 data URI, min(80vw,560px) 居中偏上)+石质菜单按钮(#3d4355→#2b3040 渐变+#565e78 边+inset 高光, 奶油→橙渐变字 background-clip:text+drop-shadow, gold 金边略大)+左下"Web 复刻版 v0.2"+右下版权行+GitHub 图标链接(octocat SVG, 新标签); 生成对话框/暂停菜单/帮助弹窗换 .t-panel 原版蓝(rgba(28,36,74,.96)+rgba(120,140,220,.8) 边)+t-input/t-radio/t-close; 暂停菜单底部 GitHub 行; 死亡屏"{玩家名} 被杀死了…"大红字(#e03c3c+8 向深红描边+黑投影); Loading 白字黑描边
  - 字体: .terraria-font('Baloo 2','Noto Sans SC',…), 覆盖层根节点+HUD 标题/物品名/按钮应用
  - coarse 让位规则同步 13-a 版: #hud-btns bottom+128px/隐藏提示/按钮≥44px/#msgs bottom+152px/#inv max-h 60vh(样式表内逐条验证); 触屏层 tc-world/摇杆/跳跃钮原样保留
- standalone/build.ts: 新增 EXTRA_ASSETS=[terraria_logo, Lesser_Healing_Potion] 并入内嵌清单(不动 src ASSET_MANIFEST); <head> 注入 Google Fonts(Baloo 2 400/700/800 + Noto Sans SC 400/700/900, display=swap, 离线回退系统字体)
- bun standalone/build.ts → public/terraria.html 1766.4KB(139 个唯一素材全内嵌, 含 logo; 旧 1641KB, +125KB 主要为 logo 90KB×base64)
- 浏览器实测(agent-browser, 1280x800 + 375x667):
  - 标题屏: logo data URI 560x172 居中(y=80=min(12vh,80px)), 石质按钮渐变/金边/clip=text 渐变字全部 computed style 命中, 版本/版权/GitHub href+target ✓, 像素采样 logo 绿字 9090px+石质底 9032px
  - HUD: 快捷栏 x12/y12 左上 10 槽 44px, 选中槽 49px(1.12 缩放)+金框; maxHp=200 时 20 心单行 478px 紧贴快捷栏; 背包面板 y62 与快捷栏同列对齐(10 列×30 格)+无底板+盔甲行/工作站/合成列表+心形随面板下移; Boss 条 x360 w560 精确居中+底缘 788=800-12+金边; 右上裸文字 y186; 消息黑底; 按钮组蓝+背包按钮; 像素采样蓝槽 4106px/金边 218px/红心 2220px/黑底消息 4665px
  - 交互回归: 数字键选槽/E 开背包/合成点击(木 50→49+木平台×2)/保存按钮写档/智能光标按钮开合/生成对话框单选与开始冒险/标题屏帮助弹窗 ✓
  - 防卡死(13-c 引擎同步验证): skel(kind skel, night:false)嵌进玩家下方 20 格石头+下方 48px 洞腔 → 2.2s 后被推移 +48px 入洞腔, stuck=0 存活未 dead; 全埋石(无空腔)skel → stuck 计数 601(>600)粒子消散+dead+移出列表; 玩家嵌石 → 1.2s 内被推下 48px 且 fallStart 被重置为 null
  - 手机 375x667: 快捷栏 338px 不溢出(选中槽 36px 缩放生效), 心形 2 行×10 棵, 面板 top 锚定 max-h 459px, coarse 五条让位规则在样式表逐条命中, 小地图 168px 宽(边框起点 x190 像素采样确认 13-c 缩放生效)
  - 零 page error/零 console 错误; performance resource 检查 png/素材外链请求 = 0(仅 Google Fonts CSS+woff2, 任务豁免项); document.fonts.check('Baloo 2')=true
  - VLM 视觉评审(标题/HUD/背包 3 张): 标题屏与 HUD 全部符合原版 1.4; 其报"背包内心形重叠"经像素扫描证伪(全屏仅 y334-348 一条心形带, DOM .heart=10 颗, 另两条红带为图标/世界内红色物体)
  - 测试后清理: localStorage tw-save-v2 测试世界已清除
- bunx tsc --noEmit(过滤 examples/skills)零错误; bun run lint exit 0

Stage Summary:
- 交付: standalone/main.ts UI 层全面原版化(13-a HUD 布局+13-b 标题/暂停/死亡屏)+build.ts 素材/字体增强+public/terraria.html 重建 1766.4KB; 13-c 物理修复经共享引擎自动带入并实测(嵌石推移/长期消散/玩家安全网三例全过)
- 双版本视觉现已同步: 主版(/)与单文件版(/terraria.html)同为官方 logo+石质按钮+原版蓝 UI; 单文件版零素材外链(仅 Google Fonts)

---
Task ID: 13-e/13-f
Agent: main
Task: 全链路终验 + GitHub 推送

Work Log:
- 终验(主版 /): 标题屏官方 logo(560px)/GitHub 链接(_blank)/石质按钮 DOM 断言全过; enterWorld 后移动(+189px)/挖掘(泥土 1→0)/背包/暂停菜单 VLM+DOM 全过; 手机 375px 快捷栏-小地图零重叠; 零 page error
- 终验(单文件版 /terraria.html): 引擎加载 engine-ok, 零错误
- 提交 379d9f1(含 13-a/b/c/d 全部产物 + 模式位变更) 推送 https://github.com/43aquarius/web-terraria main 成功 (e9ddc29..379d9f1)

Stage Summary:
- 13 系列完成: 人物/怪物"卡死+消失"四根因根治(stepUp 全盒/刷怪 clearance/unstick 安全网/嵌死消散) + HUD/标题屏/暂停/死亡完全仿原版 + GitHub 入口(标题屏右下+暂停菜单) + 单文件版同步重建 + 已推送 GitHub

---
Task ID: 14
Agent: main
Task: 修复"人物还会消失/不居中/手持物分离"三大 bug + 全代码清查修复

Work Log:
- 根因分析(浏览器实测 + 像素级验证 + 参考站 chunk 逆向):
  1. [致命] assets.ts blit()/drawImgPlayer() 朝右镜像分支: translate(x+dw, y) 后 drawImage 目标 y 又用 y → 目标世界 Y = 2y, 所有朝右的实体(玩家默认朝右!/僵尸/骷髅/向导/史莱姆/眼/蝙蝠/噬魂者)被画到 ~2y 深处远出屏外 = "人物/怪物时不时消失"真正根因(向导帧/骷髅帧实测居中, 排除素材问题)
  2. [致命] render.ts:506 setTransform(dpr) 后世界空间又 scale(zoom*dpr) → dpr² 缩放: 任何 dpr>1 设备(全部手机/retina, 测试机 dpr=3→2)世界渲染放大 2 倍, 视野只剩一半, 玩家按 vw/zoom 的相机数学与实际画面脱节 = "人物不居中/跑出画面"根因(桌面 dpr=1 所以历次桌面测试全漏过)
  3. 参考站 chunk 提取: 相机 = 玩家身体中心 - 视口/2(50%/50% 居中, lerp 0.15), 我们用 0.62 偏下
  4. 参考站无逐格黑暗系统(仅夜色 rgba(10,10,40,.5)); 我们光照 0 光 = 全黑 alpha255 → 洞穴无火把时玩家隐形(实测 VLM 确认"完全看不到玩家")
  5. 参考站手持物品: 常显(非仅挥击时), 锚点=精灵左上+(朝右.7/朝左.3)×宽, 顶+.4×高, 挥击旋转 dir×(-.36+.96t), 尺寸 22.4px(其 32px 瓦片); 我们只在挥击时画, 且锚点(p.y-14)远低于手部(p.y-36) = "手持装备图层分离"
- 修复清单:
  - assets.ts: blit/drawImgPlayer 镜像分支目标 y 改 0(根因①); LAYOUT 全系精灵改参考站一半比例(玩家/僵尸/骷髅/向导 32x48=2x3格, 史莱姆/眼 32x24, 蝙蝠 24x16, 嗑魂 32x32, EoC 64x64, EoW 48x48; 旧版统一大 25%); drawImgPlayer 帧选择优先信 playerImgFrame(旧版 walkT 弧度当帧号, 走路只在 6-12 帧); drawImgGuide 同样修 walkT×13/2π; 删 drawImgPlayer 内旧 heldIcon 死代码
  - render.ts: 世界空间 scale(zoom)(根因②); IMG_OFF 全部按新精灵尺寸(-16,-48/-16,-24/-12,-16/-16,-32/-32,-64); 手持物品常显+参考站手部锚点公式(任意物品类型); 相机 outY 比较式同步
  - engine.ts: followCam/resize/setupWorld/loadSave 相机目标改 (p.y-p.h/2)-viewH/2 参考站式 50% 居中(根因③), lerp 0.15; mineDamage 裂纹衰减清理(松开左键/换目标旧进度作废, 每 6 帧 ×0.86, <0.5 移除 — 旧版裂纹永久残留); 敌怪接触伤害改精确 AABB(旧版上下各膨胀 e.h/2 隔一格也能打人); msgSeq 改时间基起始(HMR 重挂载后与 store 残留消息 id 撞车 → React duplicate key 报错)
  - lighting.ts: 暗度封顶 DARK_CAP=0.72(洞穴保底 28% 可见度)
  - render.ts 光照: 玩家常显环境光 0.62(手持火把仍 0.95) → 洞穴玩家与身边数格始终清晰可见(根因④)
  - HUD.tsx/render.ts/standalone 手机布局: 窄屏小地图下移 y=50(旧版与快捷栏第 7-10 格重叠 ~140px); 心形窄屏每行 5 颗(max-w 134px); 信息条窄屏 top-170; 背包打开且窄屏时隐藏小地图
- 验证(agent-browser 实测):
  - 桌面 1280x800 dpr=1: 玩家 50%/50% 居中(引擎坐标+品红十字像素级对齐双重验证), 朝右站立/朝左行走/挥剑三态 VLM 全过(此前朝右 = 只剩漂浮镐子的"消失"状态)
  - iPhone14 模拟(dpr=3→2, canvas 780x1688): 玩家居中可见、镐子贴手、无比例失调(修复前世界渲染 2 倍大玩家出屏)
  - 地下 80 格无火把: 玩家清晰可辨(VLM 确认), 周围 1-2 格可见, 远处保持洞穴氛围
  - 夜晚快进刷怪: 朝右僵尸/恶魔眼完整可见(修复前朝右怪全消失); 玩家被围杀死→复活流程正常, 复活后 50%/50%
  - 向导 NPC: 身体+名牌完整, 无半身/消失
  - 3 分钟随机游玩模拟(10800 tick 移动/挖掘/右键): 0 异常(无 NaN/出屏/嵌方块/异常)
  - 桌面+手机背包/全屏地图/暂停菜单(含 GitHub 链接): 布局无重叠无溢出
  - 全屏地图出生点标记/暂停菜单按钮/GitHub 链接全部正常; 零 page error、零 console error(修复 duplicate key 后)
  - 单文件版 /terraria.html 重建(1767.2KB): 引擎加载/玩家居中/手持物贴手 VLM 全过
  - tsc(排除 examples/skills 既有 4 错)/lint 零错误

Stage Summary:
- "人物/怪物消失"两真正根因全部根治: ①朝右镜像 2y 出屏(玩家默认朝右必现) ②dpr≥2 世界 dpr 倍放大出屏(全部手机)
- 相机改参考站式 50%/50% 居中; 手持物品常显+贴手(参考站锚点/旋转公式); 全精灵比例对齐参考站; 洞穴不再全黑(暗度封顶+玩家环境光)
- 附带修复: 走路动画帧换算(玩家/向导)、挖掘裂纹残留、敌怪判定框过大、React duplicate key、手机小地图与快捷栏重叠

---
Task ID: 15-a
Agent: general-purpose (mp-server)
Task: 联机 socket.io 服务端 mini-service

Work Log:
- 阅读 worklog 末尾(13/14 系列)了解项目现状; 参照 examples/websocket/server.ts 官方示例(path '/' 勿改/Caddy 依赖、cors *、pingTimeout 60000、pingInterval 25000、graceful shutdown 写法)
- 创建 mini-services/mp-server/{package.json, index.ts}: 独立 Bun + socket.io 纯后端服务, 端口 3010 写死, 不动主仓任何代码
- 协议实现: join(name trim 后 1-16 字符校验, 非法忽略; room trim 后 1-24 字符, 缺省/非法回落 "lobby"; 房间不存在则创建, seed = FNV-1a 32 位无符号正整数, 同房间码必同种子) / state(非空对象即原样转发, 零校验零日志) / tile(x/y/id 须有限数且 >=0, 合法才记日志+转发) / chat(截断 200 字符, 空文本忽略)
- 出站事件: welcome{id, seed, edits 拷贝, roster(不含自己)} / pjoin{id,name} / pleave{id} / pstate{id,s} / tile{id,x,y,tile}(tile=方块id, id=发送者 socket.id) / chat{id,name,text}; 全部经 socket.to(room) 只发同房间其他人, 无自我回显
- 房间数据: Map<code, {seed, edits:[x,y,tile][], players:Map<socketId,{name}>}>; edits 上限 30000 条超出丢最旧; 最后一人离开自动删房间; 同一 socket 重复 join 先 leaveRoom(广播 pleave+清理)再加入; state/tile/chat 未 join 直接忽略
- 依赖: mp-server 目录内独立 `bun add socket.io@4.8.3` + `bun add -d socket.io-client@4.8.3`(测试用), 与根项目完全隔离; bunx tsc --strict 独立类型检查通过
- **踩坑(重要)**: 本环境 Bash 工具每条命令结束后会清理其后台子进程 — 直接 `nohup bun run dev &` 与 `setsid ... &` 均被杀; 必须双层 fork `( cd … && nohup bun run dev > log 2>&1 < /dev/null & )` 让中间父进程立即退出、服务挂到 PID 1 下才能跨命令存活(与 Next dev/agent-browser 同款 PPID=1)
- 集成测试(临时脚本放项目外 /home/z/mp-test.ts, socket.io-client 绝对路径导入, 跑完已删): 4 客户端 22 项断言全过 — welcome(id=自己/seed 正整数/新房间 edits+roster 空)、同房间 seed 一致、pjoin、pstate 13 字段原样转发、tile 字段正确+6 种非法值(负数×3/字符串/NaN/缺字段)全被忽略、chat 转发+250→200 截断+发送者不回显、第三人 welcome.edits 回放 [[10,20,5]]+roster 2 人、断开 pleave、重复 join 换房触发 pleave、跨房间 state 隔离、缺省 room 落 lobby
- SIGTERM 实测: 日志输出 "SIGTERM received, shutting down mp-server..." + "mp-server closed", 进程退出端口释放(io.close + 2s 强退兜底); 随后双层 fork 重启服务恢复正常
- 发现平台机制: /start.sh 容器启动时自动扫描 mini-services/* 子目录, 有 package.json 且含 dev 脚本即后台 `bun install && bun run dev`(日志 /tmp/mini-service-<name>.log) — mp-server 已天然符合约定, 容器重启后自动拉起, 无需注册
- 服务最终状态: bun --hot index.ts 运行中(engine.io 握手 HTTP 200), 监听日志在 /tmp/mp-server.log; 连接/加入/离开/建房/清房各一行 console.log, state 转发零日志

Stage Summary:
- 产物: mini-services/mp-server/{package.json, index.ts, bun.lock}(约 190 行 strict TS) + 本地 node_modules; 主仓零改动
- 端口: 3010(HTTP+WebSocket, socket.io path '/' 勿改 — Caddy 网关 XTransformPort 转发依赖), cors origin *, pingTimeout 60000 / pingInterval 25000
- 协议事件名(客户端对接契约): C→S `join{name,room}` `state{x,y,dir,frame,walkT,onGround,hp,maxHp,held,swingT,armorH,armorB,armorL}` `tile{x,y,id}` `chat{text}`; S→C `welcome{id,seed,edits,roster}` `pjoin{id,name}` `pleave{id}` `pstate{id,s}` `tile{id,x,y,tile}` `chat{id,name,text}`
- 要点: seed=FNV-1a(room) 确定性种子(客户端按 seed 生成同款世界); welcome.edits 按时间序回放方块编辑(上限 30000); 空房自动清理; 重复 join 先退旧房; chat 200 字符截断
- 运维: 会话内手动启动须双层 fork 存活; 容器重启由 /start.sh mini-services 扫描自动拉起; SIGTERM/SIGINT 优雅关闭已验证

---
Task ID: 15
Agent: main
Task: 比例彻底修复 + 联机功能 + 原版化检查 + GitHub 图标

Work Log:
- 比例修复(逐帧 bbox 实测 + VLM 确认素材结构, 全部改「原生尺寸绘制」):
  - player: 半尺寸表(19帧x20x30, 内容~11-15x24) → 2x 绘制 40x60(原版 40x56); PLAYER_CONF h 38→42(宽度保持 12 兼容 1 格门洞)
  - skeleton: 帧结构勘误 60宽x7帧 → 30宽x14帧(旧切片把两帧腰斩拼一起); 原生 30x48
  - zombie 34x46 / eye 37x22 / bat 28x24 / eos 42x78 / eow 头46x68/身42x46/尾42x64 全部原生(旧版统一压 32x48/32x24/24x16/32x32 严重变形)
  - guide: 变宽帧原生绘制(旧版拉伸固定 32 宽, 胖瘦随帧跳变); drawImgGuide 内部按帧宽居中
  - EoC: 素材为竖直存储(瞳孔朝下) → rotatedCW() 派生旋转画布 + 取中间帧切片绘制; P1 162x110 / P2 146x110 原生; facing=冲刺方向镜像; 首版忘切片(3 眼叠加)已修
  - tree: 定宽切片绘制(旧版 w=76/142*h 等比 → 20 格树宽 10.7 格严重肥胖); 树冠64+树干带枝48平铺+根部30, 宽恒 76
  - life crystal: 5 帧循环改为静态完整帧(素材实为心形品阶表, 循环=抽搐)
  - 手持物: 固定 11.2px → itemDrawSize() 原生最大边(钳 8..36); 掉落物同款原生物品尺寸(旧统一 16x18)
  - ENEMY_DEFS 判定盒与精灵对齐(eoc 46x38→96x52, eos 16x16→22x44, eye 18x14→26x16, bat 14x10→18x16, 史莱姆系放大, 僵尸/骷髅 16x40)
- 联机功能(15-a 子代理服务端 + 15-b 主代理客户端):
  - mini-services/mp-server(端口 3010, socket.io, path '/'): 房间制(join/welcome/pstate/tile/chat/pleave), FNV-1a 房间种子, 编辑日志回放(上限3万), 22 项断言全过, 容器重启自愈(/start.sh 自动拉起)
  - src/game/net.ts: NetClient 单例(io('/?XTransformPort=3010')), 12Hz 状态广播+lerp 0.18 插值, 方块编辑 200ms 批次去重(液体不同步, 各端本地模拟), 远端玩家 8s 超时剔除
  - engine: onTileChanged(x,y,id) 增广播(远程回放 applyingNet 守卫防回环); tick 增状态广播; enterWorldMP(欢迎→同种子 setupWorld→回放 edits→enterWorld); quitToTitle 断开; Enter 开聊天(输入框聚焦时引擎按键让位)
  - render: 远端玩家绘制(同款精灵/盔甲/手持物 + 名牌 + 受伤血条 + 屏外裁剪)
  - store: chatOpen/mpOnline/mpRoom/mpCount; HUD: 聊天输入条 + 联机徽章 + 聊天按钮 + GitHub 按钮(coarse 让位规则自动覆盖); Overlays: 标题屏「联机游戏」+ 对话框(昵称+房间码)
  - 单机聊天本地回显; 帮助键位表补 Enter 聊天
- 单文件版同步: 标题屏联机按钮+对话框+徽章+聊天条+聊天按钮(I_CHAT svg); socket.io-client 随 net.ts 打包; 重建 1878.5KB
- 验证(agent-browser 双会话实测):
  - 比例: 玩家 2.5x3.5 格居中/树干 1 格/镐子贴手/EoC 旋转后单眼横向 8-10 格宽瞳孔朝玩家触须向后/噬魂者竖高 4-5 格/骷髅完整 14 帧走路 — VLM 全过(修复前 EoC 3 眼竖叠、噬魂者被压扁)
  - 联机(网关 :81 双会话): 同房间同世界(种子一致)/双端互见名牌/聊天端到端/方块双向同步(B 挖 A 见洞, A 放 B 见石)/移动插值可见/徽章「房间 test · 2 人在线」
  - 单文件版: 联机入口/进入房间/徽章/按钮全过
  - 手机 375x667 + iPhone 模拟: 快捷栏不溢出/聊天+GitHub 按钮 32px 入组/粗指针让位规则自动生效
  - 桌面最终: 单机聊天回显「泰拉行者: 单机聊天测试」/GitHub 链接 href 正确/向导名牌/零 console 错误
  - tsc(排除 examples/skills 既有 4 错) + lint 零错误

Stage Summary:
- 比例: 全精灵原生尺寸绘制原则落地, 8 类实体 + 树 + 手持/掉落物 + 生命水晶 + EoC 旋转全部修复, VLM 评估「与原版 1.4 高度一致」
- 联机: 房间码制多人(共享种子世界 + 实时方块同步 + 玩家互见 + 聊天), mp-server 3010 + net.ts 客户端, 主版与单文件版双端可用; 敌怪/AI 为本地实例(v1 范围)
- GitHub 入口三处: 标题屏右下 / 暂停菜单 / 游戏内右下按钮组(octocat, _blank)
