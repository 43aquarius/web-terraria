'use client'

/**
 * 游戏画布宿主
 * 挂载 GameEngine 单例并接管整块画布(DPR/resize 由引擎内部处理)
 */

import { useEffect, useRef } from 'react'
import { GameEngine } from '@/game/engine'

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const eng = new GameEngine(canvas)
    eng.mount()

    return () => {
      eng.unmount()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 block h-full w-full cursor-crosshair touch-none"
      aria-label="泰拉瑞亚游戏画面"
    />
  )
}
