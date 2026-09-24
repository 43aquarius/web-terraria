'use client'

/**
 * 游戏入口 — 全屏容器
 * 依次叠加:游戏画布(绝对铺满) -> 触屏交互层(仅触屏设备) -> HUD -> 全屏覆盖层
 */

import GameCanvas from '@/components/game/GameCanvas'
import TouchControls from '@/components/game/TouchControls'
import HUD from '@/components/game/HUD'
import Overlays from '@/components/game/Overlays'

export default function Home() {
  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black">
      <GameCanvas />
      <TouchControls />
      <HUD />
      <Overlays />
    </div>
  )
}
