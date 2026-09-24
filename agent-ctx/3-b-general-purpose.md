# Task 3-b — UI 子代理工作记录(general-purpose / UI)

> 其他代理可参考本记录了解 UI 层的接口约定与踩坑。项目共享日志见 /home/z/my-project/worklog.md。

## 任务范围

编写 React UI 层(5 个文件),不触碰 src/game/* 下任何文件:

1. `src/components/game/GameCanvas.tsx` — 画布宿主
2. `src/components/game/HUD.tsx` — 游戏 HUD
3. `src/components/game/Overlays.tsx` — 全屏覆盖层
4. `src/app/page.tsx` — 游戏入口(全屏,无 footer)
5. `src/app/layout.tsx` — 仅改 metadata(title/description)

## 已完成内容

### GameCanvas.tsx
- useEffect 中 `new GameEngine(canvas)` + `eng.mount()`,卸载时 `eng.unmount()`
- canvas 绝对铺满(absolute inset-0 block w-full h-full)+ cursor-crosshair,DPR/resize 完全交给引擎

### HUD.tsx(仅 playing/dead 渲染)
- 心形血条 10 颗(每颗 10HP、半心 50% 宽裁剪、key=hp 触发缩放动画)、气泡条 8 个按 breath 显隐
- 快捷栏 10 格(响应式 32/36/44px,金选中边框+内发光,数字键角标),点击 engine.selectHotbar(i)
- 背包 4x10 格(第 0 行=快捷栏,分隔线区分),onMouseDown button 0/2 路由 engine.clickSlot(i, right),onContextMenu 仅 preventDefault
- 合成面板:craftables.filter(can) 列表,点击 engine.craft(index),自定义细滚动条
- tooltip / 光标物品:fixed 定位,ref 直改 DOM transform 跟随鼠标(不触发 React 重渲染)
- 消息最近 6 条 3.5s CSS 淡出;右上信息条(小地图下方 top-176px:深度 + Sun/Moon 昼夜);右下音量/帮助按钮
- 键盘(仅 playing):E/Tab=背包、Esc=帮助→背包→暂停、M=静音、H=帮助、1-0=选快捷栏;过滤 INPUT 目标与 e.repeat
- 导出供复用:`GAME_CONTROLS`(操作说明数据)、`useUIState()`(带 SSR 快照的 ui store 订阅钩子)

### Overlays.tsx
- loading:像素旋转方块(steps(8))+ loadingText(默认"正在生成世界…")
- 标题屏:TERRARIA 多层硬阴影大标题、bg-black/30 暗化、进入世界(金主按钮)/继续上次冒险(hasSave)/生成新世界/操作说明(本地帮助弹窗)
- 死亡屏:bg-red-950/60 + "你已死亡…" + "即将重生"(pulse)
- 暂停菜单:继续/保存(toast 反馈)/静音(显示 muted)/回标题;保存 toast 用 shadcn use-toast(layout 已有 Toaster)
- 全部 fade-in;z-40,loading 最后渲染保证最上层

## 关键实现决策

1. **useUIState()**:React 19 SSR 要求 useSyncExternalStore 第三参 getServerSnapshot,否则 500 "Missing getServerSnapshot"。HUD 导出 `useUIState = () => useSyncExternalStore(ui.subscribe, ui.getSnapshot, ui.getSnapshot)`,服务端返回 initial 状态,与客户端首帧一致,水合安全。
2. **贴图加载**:getTextures() 依赖 document,不能在渲染期调用。模块级 texCache + useSyncExternalStore(subscribe/getSnapshot/getServerSnapshot),effect 内生成一次后通知监听者(规避 react-hooks/set-state-in-effect 报错)。HUD 在标题屏挂载时就会生成并缓存,引擎调用同一缓存。
3. **性能**:tooltip 与光标物品的位置更新直接操作 DOM style.transform,鼠标移动零 React 重渲染。
4. **键鼠分工**:E/Tab/Esc/M/H/数字键归 React;WASD/空格/鼠标挖掘/滚轮归引擎 canvas。Esc 语义:helpOpen→关帮助,invOpen→engine.toggleInventory(),否则 engine.togglePause()。

## 引擎对接注意(给主代理)

- engine.ts 存根中 `inst` 从未赋值(构造器没有 `inst = this`),当前 engine.xxx() 全是空操作——实现时务必赋值
- 请勿在引擎里重复处理 E/Tab/Esc/M/H/数字键,避免双触发
- craft(index) 收到的是 RECIPES 数组下标;clickSlot(i, right) 中 right=右键(拿一半/放一个)
- 右上角 256x168 是小地图区域,HUD 信息条在其下方(top-176px、right-2)
- ui.set() 每次都是新对象引用,UI 靠引用变化重渲染,高频字段(如 hp/depth)请按需 set

## 踩坑记录(重要,所有人都会遇到)

**本沙箱环境的工具回显会把相邻的两个字符 "[" + "h" 吞掉**(只影响工具结果的显示,磁盘文件字节完好)。症状:

- grep/cat/Read 显示 `const elpOpen, setHelpOpen]` —— 实际磁盘是 `const [helpOpen, setHelpOpen]`
- dev.log 错误帧里的代码同样被吞,容易误判为"文件损坏"

处理方式:不要相信含 `[h` 序列的回显内容;需要确认时用 python 打印 **hex** 或让 sandbox 计算布尔断言(如 `b'const \x5bhelpOpen' in data`)。本任务的文件已全部 hex 校验过,字节级完好。

## 验证结果

- `bun run lint`:0 error / 0 warning
- `bunx tsc --noEmit`:src/app 与 src/components 下 0 错误(剩余错误在主代理并行中的 src/game/* 与预置 examples/skills)
- `curl http://localhost:3000/`:HTTP 200,标题屏/画布/中文 metadata 均正常输出
