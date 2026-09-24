'use client'

/**
 * 触屏交互层(12-c) — 仅触屏设备渲染('ontouchstart' / maxTouchPoints 检测, SSR 安全)
 *
 * 结构(absolute inset-0 pointer-events-none, 子元素 pointer-events-auto):
 * 1. 世界触摸层(.tc-world, 全屏): 单指触摸画布 = 鼠标移动 + 左键按下, 拖动 = 移动, 抬起 = 左键抬起
 *    —— 经引擎公共方法 touchAt() 转发, 复用现有挖掘/放置/攻击管线;
 *    (pointer: fine) 主指针设备上整层禁用(globals.css), 鼠标/滚轮/右键直达画布走引擎原生事件
 * 2. 左下虚拟摇杆: 120px 圆盘 + 48px 手柄, 拖动半径 40px / 死区 8px, 写入 engine.touch.mx/my
 * 3. 右下跳跃按钮: 88px 大圆钮, 按住 = engine.touch.jump(等同按住空格, 保留"按住跳更高")
 *
 * 防误触: 每个控件独立 pointerId 跟踪, 第二指一律忽略;
 * 安全: 全控件 touch-action:none + tap 高亮透明; 摇杆/按钮随 safe-area 避让刘海与底部横条
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronUp } from 'lucide-react'
import { getEngine } from '@/game/engine'
import { SFX } from '@/game/sound'
import { useUIState } from './HUD'

/** 摇杆最大拖动半径 / 死区(CSS px) */
const STICK_MAX = 40
const STICK_DEAD = 8

/* ---- 触屏能力检测(useSyncExternalStore, SSR/水合安全, 与 HUD useTextures 同模式) ---- */

/** 触屏能力在页面生命周期内不变, 空订阅 */
function subscribeTouch(): () => void {
  return () => {}
}
function touchSnapshot(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}
function touchServerSnapshot(): boolean {
  return false
}
function useIsTouch(): boolean {
  return useSyncExternalStore(subscribeTouch, touchSnapshot, touchServerSnapshot)
}

/** 卸载/切屏时清空引擎触屏输入, 防止 mouse.left / touch.jump 卡死 */
function clearTouchInput(): void {
  const eng = getEngine()
  if (!eng) return
  eng.touch.mx = 0
  eng.touch.my = 0
  eng.touch.jump = false
  eng.touch.active = false
  eng.touchAt(0, 0, 'end')
}

export default function TouchControls() {
  const st = useUIState()
  const isTouch = useIsTouch()

  const active = isTouch && st.screen === 'playing'

  /* 触摸层生效期间挂卸载/切屏清理(screen 变化或组件卸载时复位引擎输入) */
  useEffect(() => {
    if (!active) return
    return clearTouchInput
  }, [active])

  if (!active) return null

  return (
    <div className="pointer-events-none absolute inset-0 select-none [-webkit-tap-highlight-color:transparent]">
      <WorldTouchLayer />
      <Joystick />
      <JumpButton />
    </div>
  )
}

/* ==================== 世界触摸层 ==================== */

function WorldTouchLayer() {
  const idRef = useRef<number | null>(null)

  const forward = (clientX: number, clientY: number, phase: 'start' | 'move' | 'end'): void => {
    const eng = getEngine()
    if (!eng) return
    const r = eng.canvas.getBoundingClientRect()
    eng.touchAt(clientX - r.left, clientY - r.top, phase)
  }

  return (
    <div
      className="tc-world pointer-events-auto absolute inset-0 touch-none"
      aria-hidden
      onPointerDown={(e) => {
        if (idRef.current !== null) return // 第二指忽略
        if (e.target !== e.currentTarget) return // 只处理落在本层上的触摸(控件是兄弟节点且更高, 不会到这)
        idRef.current = e.pointerId
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* 捕获失败仅影响越界拖动跟踪, 不影响按下语义 */
        }
        forward(e.clientX, e.clientY, 'start')
      }}
      onPointerMove={(e) => {
        if (idRef.current !== e.pointerId) return
        forward(e.clientX, e.clientY, 'move')
      }}
      onPointerUp={(e) => {
        if (idRef.current !== e.pointerId) return
        idRef.current = null
        forward(e.clientX, e.clientY, 'end')
      }}
      onPointerCancel={(e) => {
        if (idRef.current !== e.pointerId) return
        idRef.current = null
        forward(e.clientX, e.clientY, 'end')
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}

/* ==================== 虚拟摇杆 ==================== */

function Joystick() {
  const baseRef = useRef<HTMLDivElement>(null)
  const idRef = useRef<number | null>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })

  /** 把指针位置换算成摇杆向量并写入引擎(限制半径 40px, 死区 8px, 归一化到 [-1,1]) */
  const apply = (clientX: number, clientY: number): void => {
    const el = baseRef.current
    const eng = getEngine()
    if (!el || !eng) return
    const r = el.getBoundingClientRect()
    let dx = clientX - (r.left + r.width / 2)
    let dy = clientY - (r.top + r.height / 2)
    const len = Math.hypot(dx, dy)
    if (len > STICK_MAX) {
      dx = (dx / len) * STICK_MAX
      dy = (dy / len) * STICK_MAX
    }
    setKnob({ x: dx, y: dy })
    eng.touch.active = true
    eng.touch.mx = Math.abs(dx) < STICK_DEAD ? 0 : dx / STICK_MAX
    eng.touch.my = Math.abs(dy) < STICK_DEAD ? 0 : dy / STICK_MAX
  }

  const release = (): void => {
    idRef.current = null
    setKnob({ x: 0, y: 0 })
    const eng = getEngine()
    if (!eng) return
    eng.touch.mx = 0
    eng.touch.my = 0
    eng.touch.active = eng.touch.jump || eng.touch.mine
  }

  return (
    <div
      ref={baseRef}
      role="application"
      aria-label="移动摇杆"
      className="pointer-events-auto absolute bottom-[calc(env(safe-area-inset-bottom,0px)+24px)] left-[calc(env(safe-area-inset-left,0px)+24px)] z-10 flex h-[120px] w-[120px] touch-none select-none items-center justify-center rounded-full border-2 border-white/40 bg-white/10 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (idRef.current !== null) return // 第二指忽略
        idRef.current = e.pointerId
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* 同上 */
        }
        apply(e.clientX, e.clientY)
      }}
      onPointerMove={(e) => {
        if (idRef.current !== e.pointerId) return
        apply(e.clientX, e.clientY)
      }}
      onPointerUp={(e) => {
        if (idRef.current === e.pointerId) release()
      }}
      onPointerCancel={(e) => {
        if (idRef.current === e.pointerId) release()
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none h-12 w-12 rounded-full border border-white/50 bg-white/30"
        style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
      />
    </div>
  )
}

/* ==================== 跳跃按钮 ==================== */

function JumpButton() {
  const idRef = useRef<number | null>(null)

  return (
    <button
      type="button"
      aria-label="跳跃(按住跳得更高)"
      className="pointer-events-auto absolute bottom-[calc(env(safe-area-inset-bottom,0px)+24px)] right-[calc(env(safe-area-inset-right,0px)+24px)] z-10 flex h-[88px] w-[88px] touch-none select-none items-center justify-center rounded-full border-2 border-white/40 bg-white/10 text-white/80 backdrop-blur-sm transition-colors active:bg-white/25 active:text-white"
      onPointerDown={(e) => {
        if (idRef.current !== null) return // 第二指忽略
        idRef.current = e.pointerId
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* 同上 */
        }
        e.preventDefault()
        const eng = getEngine()
        if (eng) {
          eng.touch.jump = true
          eng.touch.active = true
        }
        SFX.init()
      }}
      onPointerUp={(e) => {
        if (idRef.current !== e.pointerId) return
        idRef.current = null
        const eng = getEngine()
        if (!eng) return
        eng.touch.jump = false
        eng.touch.active = eng.touch.mine || eng.touch.mx !== 0 || eng.touch.my !== 0
      }}
      onPointerCancel={(e) => {
        if (idRef.current !== e.pointerId) return
        idRef.current = null
        const eng = getEngine()
        if (!eng) return
        eng.touch.jump = false
        eng.touch.active = eng.touch.mine || eng.touch.mx !== 0 || eng.touch.my !== 0
      }}
    >
      <ChevronUp size={36} strokeWidth={3} aria-hidden />
    </button>
  )
}
