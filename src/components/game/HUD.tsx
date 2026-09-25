'use client'

/**
 * 游戏 HUD — 仿原版 Terraria 1.4 布局:
 * 左上角:快捷栏(10 槽带序号,选中金框微放大) + 右侧选中物品名 → 背包面板(紧贴快捷栏
 *   向下展开,4x10 网格第 0 行即快捷栏;宝箱 5x4 在网格右侧(lg)/上方(小屏);盔甲三槽 +
 *   防御 + 工作站指示在网格下方;合成列表在面板底部) → 心形血条(每行 20 颗,每颗 10HP) →
 *   呼吸气泡(水下) → 防御(盾+数字)
 * 右上角:引擎小地图(256x168)正下方的裸文字信息(群系/深度/昼夜,白字黑描边) + 智能光标蓝色小按钮
 * 底部中央:Boss 血条(黑底红条金边) / 左下:消息(纯半透明黑底白字) / 右下:功能按钮组(原版蓝)
 * 仅在 screen === 'playing' 或 'dead' 时渲染;外层 pointer-events-none,可交互子元素 pointer-events-auto
 * Tab(地图)/C(智能光标)/Esc 关地图与宝箱 由引擎 capture 阶段处理,此处不再绑定 Tab
 */

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Backpack, Crosshair, HelpCircle, Moon, Shield, Sun, Volume2, VolumeX } from 'lucide-react'
import { ui, type Slot, type UIState } from '@/game/store'
import { ItemDefs, RECIPES, type ArmorSlot, type ItemKind, type StationKind } from '@/game/constants'
import { getTextures, type GameTextures } from '@/game/textures'
import { engine } from '@/game/engine'

/* ==================== 常量 ==================== */

const STATION_NAMES: Record<StationKind, string> = {
  workbench: '工作台',
  furnace: '熔炉',
  anvil: '铁砧',
  altar: '恶魔祭坛',
}

const KIND_LABEL: Record<ItemKind, string> = {
  block: '方块',
  material: '材料',
  tool: '工具',
  weapon: '武器',
  station: '工作站',
  armor: '盔甲',
}

/** 操作说明列表(Overlays 的标题屏帮助弹窗复用) */
export const GAME_CONTROLS: readonly (readonly [string, string])[] = [
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
]

/** 开发者模式额外键位说明(devMode 时帮助弹窗追加一行) */
export const GAME_DEV_CONTROLS_LINE = 'F 飞行 · G 刷怪 · N 昼夜切换'

/** 盔甲三槽(头/身/腿)标签 */
const ARMOR_SLOT_LABEL: Record<ArmorSlot, string> = { head: '头', body: '身', legs: '腿' }

const HUD_CSS = `
/* 原版 UI 字体(Andy Bold 近似 + 中文回退) */
.terraria-font { font-family: var(--font-andy), var(--font-cjk), sans-serif; }
@keyframes hud-heart-pulse {
  0% { transform: scale(1); }
  45% { transform: scale(1.22); }
  100% { transform: scale(1); }
}
@keyframes hud-msg {
  0% { opacity: 0; transform: translateX(-8px); }
  6% { opacity: 1; transform: translateX(0); }
  72% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes hud-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes hud-sel-glow {
  0%, 100% { box-shadow: inset 0 0 10px rgba(247, 208, 96, 0.25); }
  50% { box-shadow: inset 0 0 10px rgba(247, 208, 96, 0.5); }
}
.hud-heart-pulse { animation: hud-heart-pulse 0.3s ease-out; }
.hud-msg { animation: hud-msg 3.5s linear forwards; }
.hud-fade-in { animation: hud-fade-in 0.25s ease-out; }
.hud-sel { animation: hud-sel-glow 1.6s ease-in-out infinite; }
.hud-scroll { scrollbar-width: thin; scrollbar-color: #788cd0 rgba(10, 12, 26, 0.8); }
.hud-scroll::-webkit-scrollbar { width: 6px; }
.hud-scroll::-webkit-scrollbar-track { background: rgba(10, 12, 26, 0.8); }
.hud-scroll::-webkit-scrollbar-thumb { background: #788cd0; }
.hud-scroll::-webkit-scrollbar-thumb:hover { background: #a8bcf0; }
/* ---- 触屏适配(12-c): 主指针 coarse(手机/平板)时让位虚拟摇杆/跳跃按钮, 触达目标 ≥44px ----
   背包面板已改为左上锚定(top 定位), 不再与摇杆冲突, 仅收紧最大高度保证心形血条可见 */
@media (pointer: coarse) {
  /* 右下按钮组: 抬到跳跃按钮(88px+24px 安全边)上方 */
  .hud-br { bottom: calc(env(safe-area-inset-bottom, 0px) + 128px); }
  /* 键盘提示文案对触屏无意义 */
  .hud-br-hint { display: none; }
  /* 触达目标 ≥44px(Apple HIG 最小触控尺寸) */
  .hud-ibtn { min-width: 44px; min-height: 44px; }
  /* 左下消息: 抬到摇杆(120px+24px)上方 */
  .hud-msgs { bottom: calc(env(safe-area-inset-bottom, 0px) + 152px); }
  /* 背包面板: 左上锚定, 限高 60vh 内部滚动, 不遮挡底部摇杆/跳跃 */
  .hud-panel { max-height: 60vh; }
}
`

/* ==================== Hooks / 基础组件 ==================== */

/* ---- 程序化贴图缓存:客户端挂载后生成,未就绪时图标位置留空 ---- */

let texCache: GameTextures | null = null
const texListeners = new Set<() => void>()

function subscribeTex(listener: () => void): () => void {
  texListeners.add(listener)
  return () => {
    texListeners.delete(listener)
  }
}

function texSnapshot(): GameTextures | null {
  return texCache
}

function texServerSnapshot(): GameTextures | null {
  return null
}

/** 贴图仅能在客户端生成(document 依赖),经外部存储订阅通知组件重渲染 */
function useTextures(): GameTextures | null {
  const tex = useSyncExternalStore(subscribeTex, texSnapshot, texServerSnapshot)
  useEffect(() => {
    if (texCache === null) {
      texCache = getTextures()
      texListeners.forEach((l) => l())
    }
  }, [])
  return tex
}

/** 订阅游戏 UI 状态(第三参提供 SSR 快照 = 初始状态,保证服务端渲染与水合一致) */
export function useUIState(): UIState {
  return useSyncExternalStore(ui.subscribe, ui.getSnapshot, ui.getSnapshot)
}

/** 跟随鼠标的悬浮提示(fixed 定位,直接操作 DOM 避免 HUD 整体重渲染) */
function MouseTooltip({ content }: { content: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const place = (x: number, y: number): void => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      let left = x + 16
      let top = y + 18
      if (left + w > window.innerWidth - 8) left = Math.max(8, x - w - 16)
      if (top + h > window.innerHeight - 8) top = Math.max(8, y - h - 18)
      el.style.transform = `translate(${left}px, ${top}px)`
      el.style.opacity = '1'
    }
    const onMove = (e: MouseEvent): void => place(e.clientX, e.clientY)
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])
  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed left-0 top-0 z-50 max-w-60 rounded-[3px] border-2 border-[rgba(120,140,220,0.9)] bg-[rgba(12,15,32,0.94)] p-2 opacity-0"
      style={{ transition: 'opacity 0.12s ease-out' }}
    >
      {content}
    </div>
  )
}

/** 光标物品(拿在鼠标上的物品,pointer-events-none) */
function CursorItemView({ item, tex }: { item: Slot; tex: GameTextures | null }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const place = (x: number, y: number): void => {
      el.style.transform = `translate(${x + 12}px, ${y + 12}px)`
    }
    const onMove = (e: MouseEvent): void => place(e.clientX, e.clientY)
    const onDown = (e: MouseEvent): void => place(e.clientX, e.clientY)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mousedown', onDown)
    }
  }, [])
  const url = tex?.iconURL[item.id]
  const def = ItemDefs[item.id]
  return (
    <div ref={ref} className="pointer-events-none fixed left-0 top-0 z-50">
      {url && (
        <img
          src={url}
          alt={def?.name ?? ''}
          draggable={false}
          className="h-8 w-8 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] [image-rendering:pixelated]"
        />
      )}
      {item.count > 1 && (
        <span
          className={`absolute -bottom-1 -right-1 font-bold text-white [text-shadow:1px_1px_0_#000] ${
            item.count >= 100 ? 'text-[8px]' : 'text-[11px]'
          }`}
        >
          {item.count}
        </span>
      )}
    </div>
  )
}

/** 心形血条:每颗心 10 HP,半心用 50% 宽度裁剪;每行 20 颗(小屏经 max-w 自动 10 颗换行) */
function Hearts({ hp, maxHp, tex }: { hp: number; maxHp: number; tex: GameTextures | null }) {
  const n = Math.max(1, Math.ceil(maxHp / 10))
  return (
    // key 变化时整块重挂载 -> 血量变化重放轻微缩放动画
    // 14-a: 窄屏每行 5 颗(max-w 134px) —— 手机上小地图下移到快捷栏下方后,
    // 心形第一行若仍到 ~222px 会撞到小地图左缘(208px)
    <div
      key={hp}
      className="hud-heart-pulse flex max-w-[134px] flex-wrap gap-[2px] lg:max-w-none"
    >
      {Array.from({ length: n }, (_, i) => {
        const v = hp - i * 10
        const pct = v <= 0 ? 0 : v >= 10 ? 100 : v * 10
        return (
          <div key={i} className="relative h-[22px] w-[22px]">
            {tex && (
              <img
                src={tex.heartEmptyURL}
                alt=""
                draggable={false}
                aria-hidden
                className="absolute inset-0 h-full w-full [image-rendering:pixelated]"
              />
            )}
            {tex && pct > 0 && (
              <div className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
                <img
                  src={tex.heartURL}
                  alt=""
                  draggable={false}
                  aria-hidden
                  className="h-[22px] w-[22px] [image-rendering:pixelated]"
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 呼吸气泡条:8 个气泡按 breath 比例显示 */
function BreathBar({ breath, tex }: { breath: number; tex: GameTextures | null }) {
  const n = 8
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: n }, (_, i) => {
        const visible = breath * n >= i + 1
        return (
          <div key={i} className="relative h-4 w-4">
            {tex && visible && (
              <img
                src={tex.bubbleURL}
                alt=""
                draggable={false}
                aria-hidden
                className="h-4 w-4 [image-rendering:pixelated]"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ==================== 槽位 ==================== */

interface SlotCellProps {
  slot: Slot | null
  tex: GameTextures | null
  selected?: boolean
  badge?: string
  tone?: 'normal' | 'gold'   // gold = 宝箱格(边框偏金)
  className?: string
  onActivate: (right: boolean) => void
  onHover: (id: number | null) => void
}

/** 背包/快捷栏/盔甲/宝箱槽位:原版经典半透明蓝 rgba(63,82,151,.8) + 亮蓝边;选中金框微放大 */
function SlotCell({
  slot,
  tex,
  selected = false,
  badge,
  tone = 'normal',
  className = '',
  onActivate,
  onHover,
}: SlotCellProps) {
  const def = slot ? ItemDefs[slot.id] : undefined
  const url = slot ? tex?.iconURL[slot.id] : undefined
  const toneCls =
    tone === 'gold'
      ? selected
        ? 'hud-sel border-[#f7d060] bg-[rgba(60,48,16,0.88)]'
        : 'border-[#c0a050] bg-[rgba(40,34,18,0.88)] hover:border-[#f7d060]'
      : selected
        ? 'hud-sel z-10 -translate-y-[2px] scale-[1.12] border-[#f7d060] bg-[rgba(63,82,151,0.80)]'
        : 'border-[rgba(120,140,220,0.9)] bg-[rgba(63,82,151,0.80)] hover:border-[#a8bcf0]'
  return (
    <button
      type="button"
      aria-label={def ? def.name : '空槽位'}
      className={`relative flex items-center justify-center rounded-[3px] border-2 transition-colors focus-visible:outline-2 focus-visible:outline-[#f7d060] ${toneCls} ${className}`}
      onPointerDown={(e) => {
        if (e.button === 0 || e.button === 2) {
          e.preventDefault()
          onActivate(e.button === 2)
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') onHover(slot ? slot.id : null)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') onHover(null)
      }}
    >
      {badge && (
        <span
          className={`pointer-events-none absolute left-[3px] top-[1px] text-[9px] font-bold leading-none [text-shadow:1px_1px_0_#000] ${
            selected ? 'text-amber-300' : 'text-white/80'
          }`}
        >
          {badge}
        </span>
      )}
      {url && (
        <img
          src={url}
          alt=""
          draggable={false}
          aria-hidden
          className="pointer-events-none h-5 w-5 [image-rendering:pixelated] lg:h-7 lg:w-7"
        />
      )}
      {slot && slot.count > 1 && (
        <span
          className={`pointer-events-none absolute bottom-0 right-1 font-bold leading-none text-white [text-shadow:1px_1px_0_#000] ${
            slot.count >= 100 ? 'text-[8px]' : 'text-[11px]'
          }`}
        >
          {slot.count}
        </span>
      )}
    </button>
  )
}

/* ==================== Tooltip 内容 ==================== */

function ItemTooltipContent({ id }: { id: number }) {
  const def = ItemDefs[id]
  if (!def) return null
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-bold text-[#f7d060] [text-shadow:1px_1px_0_#000]">{def.name}</span>
      <span className="text-[10px] text-[#9ab8e0]">
        {KIND_LABEL[def.kind]}
        {def.kind === 'tool' && def.tool ? ` · ${def.tool === 'pick' ? '镐' : '斧'}` : ''}
      </span>
      {(def.dmg !== undefined ||
        def.power !== undefined ||
        def.useTime !== undefined ||
        def.defense !== undefined) && (
        <div className="flex flex-col gap-0.5 text-[11px] text-[#e8e4d8]">
          {def.ranged === 'arrow' && def.dmg !== undefined && (
            <span className="text-[#a8d8a8]">远程 · 伤害 {def.dmg}</span>
          )}
          {def.ranged === 'bomb' && (
            <span className="text-[#f0b090]">爆炸物{def.dmg !== undefined ? ` · 伤害 ${def.dmg}` : ''}</span>
          )}
          {!def.ranged && def.dmg !== undefined && <span>伤害 {def.dmg}</span>}
          {def.kind === 'armor' && def.defense !== undefined && (
            <span className="text-[#9ab8e0]">防御 +{def.defense}</span>
          )}
          {def.power !== undefined && <span>挖掘力 {def.power}</span>}
          {def.useTime !== undefined && <span>使用间隔 {(def.useTime / 60).toFixed(2)} 秒</span>}
        </div>
      )}
      {def.desc && <span className="max-w-52 text-[11px] leading-snug text-[#b8b4a8]">{def.desc}</span>}
    </div>
  )
}

function RecipeTooltipContent({ index }: { index: number }) {
  const r = RECIPES[index]
  if (!r) return null
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-bold text-[#f7d060] [text-shadow:1px_1px_0_#000]">
        合成 {ItemDefs[r.out]?.name ?? '?'}
      </span>
      <div className="flex flex-col gap-0.5 text-[11px] text-[#e8e4d8]">
        <span className="text-[10px] text-[#9ab8e0]">需要材料</span>
        {r.ins.map((m, i) => (
          <span key={i}>
            {ItemDefs[m.id]?.name ?? m.id} × {m.n}
          </span>
        ))}
        <span className="mt-0.5 text-[#b8b4a8]">{r.station ? `需要${STATION_NAMES[r.station]}` : '无需工作站'}</span>
      </div>
    </div>
  )
}

/* ==================== 主组件 ==================== */

export default function HUD() {
  const st = useUIState()
  const tex = useTextures()
  const [helpOpen, setHelpOpen] = useState(false)
  const [hoverItemId, setHoverItemId] = useState<number | null>(null)
  const [hoverRecipe, setHoverRecipe] = useState<number | null>(null)

  const { screen, invOpen, paused } = st
  /** 背包/宝箱任一打开时展示左上面板(打开宝箱时引擎不置 invOpen,由 UI 合并展示) */
  const panelOpen = invOpen || st.chestOpen

  /* ---- 键盘:UI 层按键(E/Esc/M/H/数字);Tab 地图/C 智能光标/G/N dev/移动等按键由引擎处理 ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return
      }
      if (screen !== 'playing') return
      const k = e.key.toLowerCase()
      if (k === 'e') {
        engine.toggleInventory()
      } else if (e.key === 'Escape') {
        if (helpOpen) setHelpOpen(false)
        else if (invOpen) engine.toggleInventory()
        else engine.togglePause()
      } else if (k === 'm') {
        engine.toggleMute()
      } else if (k === 'h') {
        setHelpOpen((v) => !v)
      } else if (/^[0-9]$/.test(k)) {
        if (!paused) engine.selectHotbar(k === '0' ? 9 : Number(k) - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen, invOpen, paused, helpOpen])

  if (screen !== 'playing' && screen !== 'dead') return null

  const craftable = st.craftables.filter((c) => c.can && RECIPES[c.index] !== undefined)
  /** 当前手持物品名(原版切换物品时显示;空手留空) */
  const hotbarSlot = st.slots[st.hotbar] ?? null
  const hotbarName = hotbarSlot ? (ItemDefs[hotbarSlot.id]?.name ?? '') : ''

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <style>{HUD_CSS}</style>

      {/* ---- 左上(原版布局):快捷栏 → 背包面板(展开) → 心形血条/呼吸/防御 纵向排列 ---- */}
      <div className="absolute left-1.5 top-1.5 z-10 flex flex-col items-start gap-1.5 lg:left-3 lg:top-3">
        {/* 快捷栏(第 0 行,常驻)+ 选中物品名(右侧, 窄屏隐藏避免压到小地图) */}
        <div className="pointer-events-auto flex items-start gap-2">
          <div className="flex gap-[2px]">
            {st.slots.slice(0, 10).map((slot, i) => (
              <SlotCell
                key={i}
                slot={slot}
                tex={tex}
                selected={st.hotbar === i}
                badge={String((i + 1) % 10)}
                className="h-8 w-8 lg:h-11 lg:w-11"
                onActivate={(right) => {
                  // 面板打开时快捷栏行即背包第 0 行(可拿放物品);关闭时仅左键切换选中
                  if (panelOpen) engine.clickSlot(i, right)
                  else if (!right) engine.selectHotbar(i)
                }}
                onHover={setHoverItemId}
              />
            ))}
          </div>
          {hotbarName !== '' && (
            <span className="terraria-font hidden min-[720px]:inline-block max-w-[180px] truncate pt-1.5 text-sm font-bold text-[#f0e8d8] [text-shadow:1px_1px_0_#000]">
              {hotbarName}
            </span>
          )}
        </div>

        {/* 背包/宝箱面板:紧贴快捷栏向下展开(原版无底板, 槽位直接浮于世界之上) */}
        {panelOpen && (
          <div className="hud-panel hud-fade-in hud-scroll pointer-events-auto flex max-h-[calc(100vh-13rem)] max-w-[calc(100vw-12px)] touch-pan-y flex-col items-start gap-2 overflow-y-auto pr-1">
            {/* 背包第 1-3 行 + 宝箱(lg 并排在右侧, 小屏在上方) */}
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:gap-3">
              {/* 宝箱 5x4(金色边框槽位;Esc/E 由引擎关闭) */}
              {st.chestOpen && (
                <div className="lg:order-2">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <h2 className="terraria-font text-xs font-bold tracking-widest text-[#f0e8d8] [text-shadow:1px_1px_0_#000]">
                      宝箱
                    </h2>
                    <button
                      type="button"
                      aria-label="关闭宝箱"
                      className="rounded-[3px] border-2 border-[rgba(120,140,220,0.9)] bg-[rgba(63,82,151,0.85)] px-2 py-0.5 text-xs text-[#f0e8d8] transition-colors hover:border-[#f7d060]"
                      onClick={() => engine.closeChest()}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="grid w-max grid-cols-5 gap-[2px]">
                    {st.chestSlots.map((slot, i) => (
                      <SlotCell
                        key={i}
                        slot={slot}
                        tex={tex}
                        tone="gold"
                        onActivate={(right) => engine.clickChestSlot(i, right)}
                        onHover={setHoverItemId}
                        className="h-8 w-8 lg:h-11 lg:w-11"
                      />
                    ))}
                  </div>
                </div>
              )}
              {/* 背包第 1-3 行(与上方快捷栏同列对齐, 构成 4x10 网格) */}
              <div className="grid w-max grid-cols-10 gap-[2px] lg:order-1">
                {st.slots.slice(10, 40).map((slot, idx) => (
                  <SlotCell
                    key={idx + 10}
                    slot={slot}
                    tex={tex}
                    onActivate={(right) => engine.clickSlot(idx + 10, right)}
                    onHover={setHoverItemId}
                    className="h-8 w-8 lg:h-11 lg:w-11"
                  />
                ))}
              </div>
            </div>

            {/* 盔甲三槽(头/身/腿)+ 防御值 + 工作站指示(网格下方一行) */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="terraria-font text-xs font-bold tracking-widest text-[#f0e8d8]/85 [text-shadow:1px_1px_0_#000]">
                  盔甲
                </span>
                {(['head', 'body', 'legs'] as ArmorSlot[]).map((s) => (
                  <SlotCell
                    key={s}
                    slot={st.armor[s]}
                    tex={tex}
                    badge={ARMOR_SLOT_LABEL[s]}
                    onActivate={(right) => engine.clickArmorSlot(s, right)}
                    onHover={setHoverItemId}
                    className="h-8 w-8 lg:h-11 lg:w-11"
                  />
                ))}
              </div>
              <span
                className="flex items-center gap-1 text-[11px] font-bold leading-none text-[#f0e8d8] [text-shadow:1px_1px_0_#000]"
                title="护甲防御值"
              >
                <Shield size={13} aria-hidden />
                <span className="tabular-nums">防御 {st.defense}</span>
              </span>
              <div className="flex items-center gap-2.5">
                {(['workbench', 'furnace', 'anvil', 'altar'] as StationKind[]).map((s) => (
                  <span key={s} className="flex items-center gap-1" title={STATION_NAMES[s]}>
                    <span
                      className={`h-2 w-2 rounded-full ${
                        st.stations[s] ? 'bg-[#f7d060] shadow-[0_0_4px_rgba(247,208,96,0.8)]' : 'bg-[#3a3a48]'
                      }`}
                    />
                    <span
                      className={`text-[10px] leading-none ${
                        st.stations[s] ? 'text-[#f7d060]' : 'text-[#8a8a9a]'
                      }`}
                    >
                      {STATION_NAMES[s]}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            {/* 合成列表(背包下方一列可滚动, 仅显示当前可合成项) */}
            <div className="flex w-full flex-col gap-1">
              <h2 className="terraria-font text-xs font-bold tracking-widest text-[#f0e8d8] [text-shadow:1px_1px_0_#000]">
                合成
              </h2>
              <div className="hud-scroll max-h-36 overflow-y-auto pr-1 sm:max-h-44">
                {craftable.length === 0 ? (
                  <p className="py-3 text-left text-xs leading-relaxed text-[#a8b4d8] [text-shadow:1px_1px_0_#000]">
                    暂无可合成物品,收集材料或靠近工作台试试
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {craftable.map((c) => {
                      const r = RECIPES[c.index]
                      const url = tex?.iconURL[r.out]
                      return (
                        <li key={c.index}>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-[3px] border-2 border-[rgba(120,140,220,0.55)] bg-[rgba(63,82,151,0.72)] px-2 py-1 text-left transition-colors hover:border-[#f7d060] hover:bg-[rgba(63,82,151,0.95)] focus-visible:outline-2 focus-visible:outline-[#f7d060]"
                            onClick={() => engine.craft(c.index)}
                            onMouseEnter={() => setHoverRecipe(c.index)}
                            onMouseLeave={() => setHoverRecipe(null)}
                          >
                            {url && (
                              <img
                                src={url}
                                alt=""
                                draggable={false}
                                aria-hidden
                                className="h-6 w-6 shrink-0 [image-rendering:pixelated]"
                              />
                            )}
                            <span className="flex-1 truncate text-xs text-[#f0e8d8] [text-shadow:1px_1px_0_#000]">
                              {ItemDefs[r.out]?.name}
                            </span>
                            {r.count > 1 && (
                              <span className="text-[11px] font-bold text-[#f7d060] [text-shadow:1px_1px_0_#000]">
                                ×{r.count}
                              </span>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 心形血条(每行 20 颗) + 呼吸气泡(水下) + 防御(盾+数字) */}
        <div className="flex flex-col gap-1">
          <Hearts hp={st.hp} maxHp={st.maxHp} tex={tex} />
          {st.breath !== null && <BreathBar breath={st.breath} tex={tex} />}
          <div
            className="flex items-center gap-1 text-[13px] font-bold leading-none text-[#f0e8d8] [text-shadow:1px_1px_0_#000]"
            title={`防御 ${st.defense}`}
          >
            <Shield size={14} aria-hidden />
            <span className="tabular-nums">{st.defense}</span>
          </div>
        </div>
      </div>

      {/* ---- 右上:信息(小地图正下方, 原版信息配件风格:裸文字白字黑描边)+ 智能光标 ----
          14-a: 窄屏小地图下移到 y=50(高110) → 信息条跟到 top-170; 桌面小地图 y=12(高168) → top-186 */}
      <div className="absolute right-[11px] top-[170px] z-10 flex flex-col items-end gap-1.5 md:top-[186px]">
        <div className="text-right text-[11px] leading-relaxed text-[#f0e8d8] [text-shadow:1px_1px_0_#000]">
          <div>{st.biomeName}</div>
          <div className="tabular-nums">{st.depth >= 0 ? `${st.depth} 米` : '地表上'}</div>
          <div className="mt-0.5 flex items-center justify-end gap-1">
            {st.isNight ? (
              <Moon size={12} className="text-slate-200" aria-hidden />
            ) : (
              <Sun size={12} className="text-amber-300" aria-hidden />
            )}
            <span>{st.isNight ? '夜晚' : '白天'}</span>
          </div>
        </div>
        <button
          type="button"
          aria-pressed={st.smart}
          aria-label={st.smart ? '关闭智能光标' : '开启智能光标'}
          title="智能光标 (C)"
          className={`terraria-font pointer-events-auto flex items-center gap-1 rounded-[3px] border-2 px-2 py-1 text-[11px] font-bold leading-none transition-colors focus-visible:outline-2 focus-visible:outline-[#f7d060] ${
            st.smart
              ? 'border-[#f7d060] bg-[rgba(63,82,151,0.9)] text-[#f7d060] [text-shadow:1px_1px_0_#000]'
              : 'border-[rgba(120,140,220,0.9)] bg-[rgba(63,82,151,0.85)] text-[#f0e8d8] hover:border-[#a8bcf0]'
          }`}
          onClick={() => engine.toggleSmart()}
        >
          <Crosshair size={12} aria-hidden />
          智能 {st.smart ? '开' : '关'}
        </button>
      </div>

      {/* ---- 底部中央:Boss 血条(黑色半透明底 + 红条 + 金边, 名字白字黑描边在上, HP 在下) ---- */}
      {st.boss && st.boss.maxHp > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex w-[min(86vw,560px)] -translate-x-1/2 flex-col items-center gap-1">
          <h2 className="terraria-font text-base font-extrabold tracking-widest text-[#f0e8d8] [text-shadow:2px_2px_0_#000,-1px_-1px_0_#000] sm:text-lg">
            {st.boss.name}
          </h2>
          <div
            className="relative h-[14px] w-full rounded-[2px] border-2 border-[#c9a227] bg-[rgba(8,6,6,0.78)] shadow-[0_0_0_2px_rgba(0,0,0,0.75),0_2px_10px_rgba(0,0,0,0.6)]"
            role="progressbar"
            aria-label={`${st.boss.name} 生命值`}
            aria-valuemin={0}
            aria-valuemax={st.boss.maxHp}
            aria-valuenow={st.boss.hp}
          >
            <div
              className="absolute inset-y-[2px] left-[2px] rounded-[1px] bg-gradient-to-b from-[#e05252] via-[#d03838] to-[#7a1414]"
              style={{ width: `calc((100% - 4px) * ${Math.max(0, Math.min(1, st.boss.hp / st.boss.maxHp))})` }}
            />
          </div>
          <span className="text-[11px] font-bold tabular-nums text-[#f0e8d8] [text-shadow:1px_1px_0_#000]">
            {st.boss.hp} / {st.boss.maxHp}
          </span>
        </div>
      )}

      {/* ---- 左下:消息(原版聊天风格:纯半透明黑底白字) ---- */}
      <div className="hud-msgs absolute bottom-3 left-3 z-10 flex max-w-[70vw] flex-col gap-1">
        {st.messages.slice(-6).map((m) => (
          <p
            key={m.id}
            className="hud-msg w-max max-w-full break-words bg-black/50 px-2 py-0.5 text-[13px] leading-snug text-white"
            style={{ color: m.color, textShadow: '1px 1px 0 #000' }}
          >
            {m.text}
          </p>
        ))}
      </div>

      {/* ---- 右下:背包 / 静音 / 帮助按钮(原版蓝)+ 提示文字(触屏时按钮组抬到跳跃钮上方, 见 HUD_CSS) ---- */}
      <div className="hud-br absolute bottom-2 right-2 z-10 flex items-center gap-2">
        <span className="hud-br-hint pointer-events-none text-[11px] text-[#e8e4d8]/60 [text-shadow:1px_1px_0_#000]">
          C 智能 · M 静音 · H 帮助
        </span>
        <button
          type="button"
          aria-label={invOpen ? '关闭背包' : '打开背包'}
          className="hud-ibtn pointer-events-auto flex h-8 w-8 items-center justify-center rounded-[3px] border-2 border-[rgba(120,140,220,0.9)] bg-[rgba(63,82,151,0.85)] text-[#f0e8d8] transition-colors hover:border-[#f7d060]"
          onClick={() => engine.toggleInventory()}
        >
          <Backpack size={15} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={st.muted ? '取消静音' : '静音'}
          className="hud-ibtn pointer-events-auto flex h-8 w-8 items-center justify-center rounded-[3px] border-2 border-[rgba(120,140,220,0.9)] bg-[rgba(63,82,151,0.85)] text-[#f0e8d8] transition-colors hover:border-[#f7d060]"
          onClick={() => engine.toggleMute()}
        >
          {st.muted ? <VolumeX size={15} aria-hidden /> : <Volume2 size={15} aria-hidden />}
        </button>
        <button
          type="button"
          aria-label="操作说明"
          className="hud-ibtn pointer-events-auto flex h-8 w-8 items-center justify-center rounded-[3px] border-2 border-[rgba(120,140,220,0.9)] bg-[rgba(63,82,151,0.85)] text-[#f0e8d8] transition-colors hover:border-[#f7d060]"
          onClick={() => setHelpOpen((v) => !v)}
        >
          <HelpCircle size={15} aria-hidden />
        </button>
      </div>

      {/* ---- 操作说明面板(H 键 / ? 按钮, 原版蓝底) ---- */}
      {helpOpen && (
        <div className="hud-fade-in pointer-events-auto absolute left-1/2 top-1/2 z-30 w-[19rem] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-[rgba(120,140,220,0.9)] bg-[rgba(22,28,62,0.96)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="terraria-font text-sm font-bold tracking-widest text-[#f0e8d8] [text-shadow:1px_1px_0_#000]">
              操作说明
            </h2>
            <button
              type="button"
              aria-label="关闭操作说明"
              className="rounded-[3px] border-2 border-[rgba(120,140,220,0.9)] bg-[rgba(63,82,151,0.85)] px-2 py-0.5 text-xs text-[#f0e8d8] transition-colors hover:border-[#f7d060]"
              onClick={() => setHelpOpen(false)}
            >
              ✕
            </button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {GAME_CONTROLS.map(([k, d]) => (
              <li key={k} className="flex items-center justify-between gap-3 text-xs">
                <span className="whitespace-nowrap rounded-[3px] border border-[rgba(120,140,220,0.6)] bg-[rgba(63,82,151,0.8)] px-1.5 py-0.5 font-mono text-[10px] text-[#f0e8d8]">
                  {k}
                </span>
                <span className="text-right text-[#b8b4a8]">{d}</span>
              </li>
            ))}
          </ul>
          {st.devMode && (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-[3px] border-2 border-[#f7d060]/50 bg-[rgba(60,48,16,0.45)] px-2 py-1.5">
              <span className="text-[10px] font-bold tracking-wider text-[#f7d060] [text-shadow:1px_1px_0_#000]">
                开发者
              </span>
              <span className="text-right text-[11px] text-[#e8c878]">{GAME_DEV_CONTROLS_LINE}</span>
            </div>
          )}
          <p className="mt-3 border-t border-[rgba(120,140,220,0.4)] pt-2 text-[10px] leading-relaxed text-[#8a8a9a]">
            键盘 + 鼠标游戏:先砍树取木材制作工作台,再挖矿造更好的工具。夜晚会有敌怪出没!
          </p>
        </div>
      )}

      {/* ---- 悬浮 tooltip / 光标物品 ---- */}
      {hoverItemId !== null && <MouseTooltip content={<ItemTooltipContent id={hoverItemId} />} />}
      {hoverRecipe !== null && <MouseTooltip content={<RecipeTooltipContent index={hoverRecipe} />} />}
      {st.cursorItem && <CursorItemView item={st.cursorItem} tex={tex} />}
    </div>
  )
}
