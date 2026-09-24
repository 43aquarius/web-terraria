'use client'

/**
 * 游戏 HUD — 心形血条(两行/防御) / Boss 血条 / 呼吸气泡 / 快捷栏 / 背包+盔甲三槽+宝箱面板 / 合成面板 /
 * 消息 / 信息条(群系/智能光标) / 物品 tooltip / 键盘
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
.hud-scroll { scrollbar-width: thin; scrollbar-color: #6a76b8 rgba(10, 12, 26, 0.8); }
.hud-scroll::-webkit-scrollbar { width: 6px; }
.hud-scroll::-webkit-scrollbar-track { background: rgba(10, 12, 26, 0.8); }
.hud-scroll::-webkit-scrollbar-thumb { background: #6a76b8; }
.hud-scroll::-webkit-scrollbar-thumb:hover { background: #8a96cc; }
/* ---- 触屏适配(12-c): 主指针 coarse(手机/平板)时让位虚拟摇杆/跳跃按钮, 触达目标 ≥44px ---- */
@media (pointer: coarse) {
  /* 右下按钮组: 抬到跳跃按钮(88px+24px 安全边)上方 */
  .hud-br { bottom: calc(env(safe-area-inset-bottom, 0px) + 128px); }
  /* 键盘提示文案对触屏无意义 */
  .hud-br-hint { display: none; }
  /* 触达目标 ≥44px(Apple HIG 最小触控尺寸) */
  .hud-ibtn { min-width: 44px; min-height: 44px; }
  /* 左下消息: 抬到摇杆(120px+24px)上方 */
  .hud-msgs { bottom: calc(env(safe-area-inset-bottom, 0px) + 152px); }
  /* 背包/宝箱面板: 抬到摇杆/跳跃上方, 面板打开时仍可移动 */
  .hud-panel { bottom: calc(env(safe-area-inset-bottom, 0px) + 150px); }
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
      className="pointer-events-none fixed left-0 top-0 z-50 max-w-60 border-2 border-[#6a76b8] bg-[rgba(12,15,32,0.94)] p-2 opacity-0"
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

/** 心形血条:每颗心 10 HP,半心用 50% 宽度裁剪;每行 10 颗,maxHp 200 时共两行 */
function Hearts({ hp, maxHp, tex }: { hp: number; maxHp: number; tex: GameTextures | null }) {
  const n = Math.max(1, Math.ceil(maxHp / 10))
  const rows: number[][] = []
  for (let i = 0; i < n; i += 10) {
    rows.push(Array.from({ length: Math.min(10, n - i) }, (_, j) => i + j))
  }
  return (
    // key 变化时整块重挂载 -> 血量变化重放轻微缩放动画
    <div key={hp} className="hud-heart-pulse flex flex-col gap-0.5">
      {rows.map((row, ri) => (
        <div key={ri} className="flex gap-0.5">
          {row.map((i) => {
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
      ))}
    </div>
  )
}

/** 呼吸气泡条:8 个气泡按 breath 比例显示 */
function BreathBar({ breath, tex }: { breath: number; tex: GameTextures | null }) {
  const n = 8
  return (
    <div className="mt-1 flex gap-0.5">
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

/** 背包/快捷栏/盔甲/宝箱槽位:左键 onActivate(false),右键 onActivate(true) */
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
        ? 'hud-sel border-[#f7d060] bg-[rgba(38,34,20,0.88)]'
        : 'border-[#6a76b8] bg-[rgba(28,34,66,0.85)] hover:border-[#8a96cc]'
  return (
    <button
      type="button"
      aria-label={def ? def.name : '空槽位'}
      className={`relative flex items-center justify-center border-2 transition-colors focus-visible:outline-2 focus-visible:outline-[#f7d060] ${toneCls} ${className}`}
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
          className={`pointer-events-none absolute left-0.5 top-0 text-[9px] font-bold leading-none [text-shadow:1px_1px_0_#000] ${
            selected ? 'text-amber-300' : 'text-white/50'
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
          className="pointer-events-none h-5 w-5 [image-rendering:pixelated] sm:h-7 sm:w-7"
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
  /** 背包/宝箱任一打开时展示中下面板(打开宝箱时引擎不置 invOpen,由 UI 合并展示) */
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

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <style>{HUD_CSS}</style>

      {/* ---- 左上:心形血条(两行) + 防御 + 呼吸气泡(小屏时移到快捷栏下方,避免重叠) ---- */}
      <div className="absolute left-2 top-[56px] flex flex-col lg:left-3 lg:top-2">
        <Hearts hp={st.hp} maxHp={st.maxHp} tex={tex} />
        {st.breath !== null && <BreathBar breath={st.breath} tex={tex} />}
        <div
          className="mt-1 flex items-center gap-1 text-[13px] font-bold leading-none text-[#9ab8e0] [text-shadow:1px_1px_0_#000]"
          title={`防御 ${st.defense}`}
        >
          <Shield size={14} aria-hidden />
          <span className="tabular-nums">{st.defense}</span>
        </div>
      </div>

      {/* ---- 顶部中央:快捷栏 ---- */}
      <div
        className={`pointer-events-auto absolute left-1/2 flex -translate-x-1/2 gap-[2px] transition-all duration-200 min-[400px]:gap-1 ${
          panelOpen ? 'top-4 opacity-80' : 'top-2'
        }`}
      >
        {st.slots.slice(0, 10).map((slot, i) => (
          <SlotCell
            key={i}
            slot={slot}
            tex={tex}
            selected={st.hotbar === i}
            badge={String((i + 1) % 10)}
            className="h-8 w-8 min-[400px]:h-9 min-[400px]:w-9 sm:h-11 sm:w-11"
            onActivate={(right) => {
              if (!right) engine.selectHotbar(i)
            }}
            onHover={setHoverItemId}
          />
        ))}
      </div>

      {/* ---- 顶部中央(快捷栏下方):Boss 血条(名称金色描边 + 红条金边 + 每 10% 白色刻度) ---- */}
      {st.boss && st.boss.maxHp > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-14 z-10 flex -translate-x-1/2 flex-col items-center gap-1 sm:top-[72px]">
          <h2 className="text-lg font-black tracking-widest text-[#f7d060] [text-shadow:2px_2px_0_#000,-1px_-1px_0_#000,0_0_14px_rgba(247,208,96,0.5)] sm:text-2xl">
            {st.boss.name}
          </h2>
          <div
            className="relative h-[14px] w-[min(80vw,560px)] border-2 border-[#f7d060] bg-[#2a0a0a] shadow-[0_0_0_1px_#000,0_2px_8px_rgba(0,0,0,0.7)]"
            role="progressbar"
            aria-label={`${st.boss.name} 生命值`}
            aria-valuemin={0}
            aria-valuemax={st.boss.maxHp}
            aria-valuenow={st.boss.hp}
          >
            <div
              className="absolute bottom-[2px] left-[2px] top-[2px] bg-gradient-to-b from-[#ff6a5a] via-[#e03c3c] to-[#8a1616]"
              style={{ width: `calc((100% - 4px) * ${Math.max(0, Math.min(1, st.boss.hp / st.boss.maxHp))})` }}
            />
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => (
              <div
                key={t}
                aria-hidden
                className="absolute inset-y-0 w-px bg-white/45"
                style={{ left: `${t * 10}%` }}
              />
            ))}
          </div>
          <span className="text-[11px] font-bold tabular-nums text-[#e8e4d8] [text-shadow:1px_1px_0_#000]">
            {st.boss.hp} / {st.boss.maxHp}
          </span>
        </div>
      )}

      {/* ---- 右上:信息条(群系/深度/昼夜,位于引擎小地图 256x168 下方)+ 智能光标切换 ---- */}
      <div className="absolute right-2 top-[176px] flex flex-col items-end gap-1.5">
        <div className="rounded-sm bg-black/30 px-2 py-1 text-right text-[11px] leading-tight text-[#e8e4d8] [text-shadow:1px_1px_0_#000]">
          <div className="text-[10px] text-[#9ab8e0]">{st.biomeName}</div>
          <div className="mt-0.5 tabular-nums">{st.depth >= 0 ? `${st.depth} 米` : '地表上'}</div>
          <div className="mt-0.5 flex items-center justify-end gap-1">
            {st.isNight ? (
              <Moon size={14} className="text-slate-200" aria-hidden />
            ) : (
              <Sun size={14} className="text-amber-300" aria-hidden />
            )}
            <span>{st.isNight ? '夜晚' : '白天'}</span>
          </div>
        </div>
        <button
          type="button"
          aria-pressed={st.smart}
          aria-label={st.smart ? '关闭智能光标' : '开启智能光标'}
          title="智能光标 (C)"
          className={`pointer-events-auto flex items-center gap-1 border-2 px-2 py-1 text-[11px] font-bold leading-none transition-colors focus-visible:outline-2 focus-visible:outline-[#f7d060] ${
            st.smart
              ? 'border-[#f7d060] bg-[rgba(60,48,16,0.9)] text-[#f7d060] [text-shadow:1px_1px_0_#000]'
              : 'border-[#6a76b8] bg-[rgba(28,34,66,0.85)] text-[#e8e4d8] hover:border-[#8a96cc]'
          }`}
          onClick={() => engine.toggleSmart()}
        >
          <Crosshair size={12} aria-hidden />
          智能 {st.smart ? '开' : '关'}
        </button>
      </div>

      {/* ---- 中下方:宝箱面板 + 背包 + 合成面板(背包或宝箱打开时) ---- */}
      {panelOpen && (
        <div className="hud-panel hud-fade-in hud-scroll pointer-events-auto absolute bottom-12 left-1/2 max-h-[calc(100vh-8rem)] w-max max-w-[calc(100vw-12px)] -translate-x-1/2 overflow-y-auto rounded-md border-2 border-[#6a76b8] bg-[rgba(16,20,40,0.92)] p-3 sm:p-4">
          {/* 宝箱面板(20 格 5x4,边框偏金;Esc/E 由引擎关闭) */}
          {st.chestOpen && (
            <div className="mb-3 border-b-2 border-[#c0a050]/40 pb-3">
              <div className="mb-2 flex items-center justify-between gap-6">
                <h2 className="text-sm font-bold tracking-widest text-[#f7d060] [text-shadow:1px_1px_0_#000]">宝箱</h2>
                <button
                  type="button"
                  aria-label="关闭宝箱"
                  className="border border-[#6a76b8] bg-[rgba(28,34,66,0.85)] px-2 py-0.5 text-xs text-[#e8e4d8] transition-colors hover:border-[#f7d060]"
                  onClick={() => engine.closeChest()}
                >
                  ✕
                </button>
              </div>
              <div className="grid w-max grid-cols-5 gap-[2px] sm:gap-1">
                {st.chestSlots.map((slot, i) => (
                  <SlotCell
                    key={i}
                    slot={slot}
                    tex={tex}
                    tone="gold"
                    onActivate={(right) => engine.clickChestSlot(i, right)}
                    onHover={setHoverItemId}
                    className="h-8 w-8 sm:h-11 sm:w-11"
                  />
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
            {/* 背包格 */}
            <div>
              {/* 盔甲三槽(头/身/腿, 40px) + 防御合计 */}
              <div className="mb-2 flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold tracking-widest text-[#f0e8c8]/80 [text-shadow:1px_1px_0_#000]">
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
                      className="h-10 w-10"
                    />
                  ))}
                </div>
                <span
                  className="flex items-center gap-1 text-[11px] font-bold leading-none text-[#9ab8e0] [text-shadow:1px_1px_0_#000]"
                  title="护甲防御值"
                >
                  <Shield size={13} aria-hidden />
                  防御 {st.defense}
                </span>
              </div>
              <div className="mb-2 flex items-center justify-between gap-6">
                <h2 className="text-sm font-bold tracking-widest text-[#f0e8c8] [text-shadow:1px_1px_0_#000]">背包</h2>
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
                          st.stations[s] ? 'text-[#f7d060]' : 'text-[#6a6a7a]'
                        }`}
                      >
                        {STATION_NAMES[s]}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
              {/* 第 0 行 = 快捷栏 */}
              <div className="grid grid-cols-10 gap-[2px] sm:gap-1">
                {st.slots.slice(0, 10).map((slot, i) => (
                  <SlotCell
                    key={i}
                    slot={slot}
                    tex={tex}
                    selected={st.hotbar === i}
                    onActivate={(right) => engine.clickSlot(i, right)}
                    onHover={setHoverItemId}
                    className="h-8 w-8 sm:h-11 sm:w-11"
                  />
                ))}
              </div>
              <div className="my-1.5 h-px bg-[#6a76b8]/50" aria-hidden />
              {/* 第 1-3 行 */}
              <div className="grid grid-cols-10 gap-[2px] sm:gap-1">
                {st.slots.slice(10, 40).map((slot, idx) => (
                  <SlotCell
                    key={idx + 10}
                    slot={slot}
                    tex={tex}
                    onActivate={(right) => engine.clickSlot(idx + 10, right)}
                    onHover={setHoverItemId}
                    className="h-8 w-8 sm:h-11 sm:w-11"
                  />
                ))}
              </div>
            </div>

            {/* 合成面板 */}
            <div className="w-full lg:w-56 lg:shrink-0">
              <h2 className="mb-2 text-sm font-bold tracking-widest text-[#f0e8c8] [text-shadow:1px_1px_0_#000]">合成</h2>
              <div className="hud-scroll max-h-40 overflow-y-auto pr-1 sm:max-h-56 lg:max-h-72">
                {craftable.length === 0 ? (
                  <p className="py-4 text-center text-xs leading-relaxed text-[#8a8a9a]">
                    暂无可合成物品
                    <br />
                    收集材料或靠近工作台试试
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
                            className="flex w-full items-center gap-2 border-2 border-[#6a76b8]/60 bg-[rgba(28,34,66,0.85)] px-2 py-1.5 text-left transition-colors hover:border-[#f7d060] hover:bg-[rgba(38,34,20,0.85)] focus-visible:outline-2 focus-visible:outline-[#f7d060]"
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
                            <span className="flex-1 truncate text-xs text-[#e8e4d8] [text-shadow:1px_1px_0_#000]">
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
        </div>
      )}

      {/* ---- 左下:消息(半透明黑底圆角 + 金色左竖条,泰拉瑞亚聊天框风格) ---- */}
      <div className="hud-msgs absolute bottom-3 left-3 flex max-w-[70vw] flex-col gap-1">
        {st.messages.slice(-6).map((m) => (
          <p
            key={m.id}
            className="hud-msg w-max max-w-full break-words rounded-sm border-l-2 border-amber-400/70 bg-black/45 px-2 py-0.5 text-[13px] leading-snug text-white backdrop-blur-[1px]"
            style={{ color: m.color, textShadow: '1px 1px 0 #000' }}
          >
            {m.text}
          </p>
        ))}
      </div>

      {/* ---- 右下:背包 / 静音 / 帮助按钮 + 提示文字(触屏时按钮组抬到跳跃钮上方, 见 HUD_CSS) ---- */}
      <div className="hud-br absolute bottom-2 right-2 flex items-center gap-2">
        <span className="hud-br-hint pointer-events-none text-[11px] text-[#e8e4d8]/60 [text-shadow:1px_1px_0_#000]">
          C 智能 · M 静音 · H 帮助
        </span>
        <button
          type="button"
          aria-label={invOpen ? '关闭背包' : '打开背包'}
          className="hud-ibtn pointer-events-auto flex h-8 w-8 items-center justify-center border border-[#6a76b8] bg-[rgba(28,34,66,0.85)] text-[#e8e4d8] transition-colors hover:border-[#f7d060]"
          onClick={() => engine.toggleInventory()}
        >
          <Backpack size={15} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={st.muted ? '取消静音' : '静音'}
          className="hud-ibtn pointer-events-auto flex h-8 w-8 items-center justify-center border border-[#6a76b8] bg-[rgba(28,34,66,0.85)] text-[#e8e4d8] transition-colors hover:border-[#f7d060]"
          onClick={() => engine.toggleMute()}
        >
          {st.muted ? <VolumeX size={15} aria-hidden /> : <Volume2 size={15} aria-hidden />}
        </button>
        <button
          type="button"
          aria-label="操作说明"
          className="hud-ibtn pointer-events-auto flex h-8 w-8 items-center justify-center border border-[#6a76b8] bg-[rgba(28,34,66,0.85)] text-[#e8e4d8] transition-colors hover:border-[#f7d060]"
          onClick={() => setHelpOpen((v) => !v)}
        >
          <HelpCircle size={15} aria-hidden />
        </button>
      </div>

      {/* ---- 操作说明面板(H 键 / ? 按钮) ---- */}
      {helpOpen && (
        <div className="hud-fade-in pointer-events-auto absolute left-1/2 top-1/2 z-30 w-[19rem] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-[#6a76b8] bg-[rgba(16,20,40,0.95)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-widest text-[#f0e8c8] [text-shadow:1px_1px_0_#000]">操作说明</h2>
            <button
              type="button"
              aria-label="关闭操作说明"
              className="border border-[#6a76b8] bg-[rgba(28,34,66,0.85)] px-2 py-0.5 text-xs text-[#e8e4d8] transition-colors hover:border-[#f7d060]"
              onClick={() => setHelpOpen(false)}
            >
              ✕
            </button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {GAME_CONTROLS.map(([k, d]) => (
              <li key={k} className="flex items-center justify-between gap-3 text-xs">
                <span className="whitespace-nowrap border border-[#6a76b8] bg-[#262c50] px-1.5 py-0.5 font-mono text-[10px] text-[#f0e8c8]">
                  {k}
                </span>
                <span className="text-right text-[#b8b4a8]">{d}</span>
              </li>
            ))}
          </ul>
          {st.devMode && (
            <div className="mt-2 flex items-center justify-between gap-3 border-2 border-[#f7d060]/50 bg-[rgba(60,48,16,0.45)] px-2 py-1.5">
              <span className="text-[10px] font-bold tracking-wider text-[#f7d060] [text-shadow:1px_1px_0_#000]">
                开发者
              </span>
              <span className="text-right text-[11px] text-[#e8c878]">{GAME_DEV_CONTROLS_LINE}</span>
            </div>
          )}
          <p className="mt-3 border-t border-[#6a76b8]/40 pt-2 text-[10px] leading-relaxed text-[#8a8a9a]">
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
