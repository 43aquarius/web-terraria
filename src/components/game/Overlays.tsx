'use client'

/**
 * 全屏覆盖层 — loading / 标题屏 / 死亡 / 暂停菜单 / 标题屏帮助弹窗
 * 根据游戏 UI 状态切换,所有覆盖层带 fade-in 动画
 */

import { useState, type ReactNode } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { engine } from '@/game/engine'
import { useToast } from '@/hooks/use-toast'
import { GAME_CONTROLS, useUIState } from '@/components/game/HUD'

const OVL_CSS = `
@keyframes ovlFade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes ovlSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.ovl-fade { animation: ovlFade 0.3s ease-out; }
.ovl-spin { animation: ovlSpin 1.2s steps(8) infinite; }
`

/** 泰拉瑞亚风格菜单按钮 */
function MenuButton({
  onClick,
  children,
  gold = false,
  small = false,
}: {
  onClick: () => void
  children: ReactNode
  gold?: boolean
  small?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full border-2 font-bold tracking-wider transition-colors active:translate-y-0.5 ${
        small ? 'px-6 py-2 text-sm' : 'px-8 py-3'
      } ${
        gold
          ? 'border-[#f7e07a] bg-[#b8912e] text-[#fff6d8] hover:bg-[#d0a83e] [text-shadow:1px_1px_0_rgba(0,0,0,0.5)]'
          : 'border-[#6a76b8] bg-[#2a4a2e] text-[#f0e8c8] hover:bg-[#3a6a40] [text-shadow:1px_1px_0_#000]'
      }`}
    >
      {children}
    </button>
  )
}

export default function Overlays() {
  const st = useUIState()
  const { toast } = useToast()
  const [showHelp, setShowHelp] = useState(false)

  const handleSave = (): void => {
    const ok = engine.saveGame()
    toast({
      title: ok ? '已保存' : '保存失败',
      description: ok ? '世界与背包已写入本地存档' : '存档未能写入,请重试',
    })
  }

  const showTitle = st.screen === 'title' && !st.loading
  const showDead = st.screen === 'dead'
  const showPaused = st.paused && st.screen === 'playing' && !st.loading

  return (
    <div className="pointer-events-none absolute inset-0">
      <style>{OVL_CSS}</style>

      {/* ---- 标题屏(背后是活的游戏世界渲染,加一层轻微暗化) ---- */}
      {showTitle && (
        <div className="ovl-fade pointer-events-none absolute inset-0 z-40 bg-black/30">
          <div className="flex h-full flex-col items-center justify-center gap-8 px-4 sm:gap-10">
            <div className="text-center">
              <h1 className="text-5xl font-black tracking-wide text-[#4ec44e] [text-shadow:0_4px_0_#1d5c1d,0_8px_0_rgba(0,0,0,0.6)] sm:text-6xl md:text-7xl lg:text-8xl">
                TERRARIA
              </h1>
              <p className="mt-4 text-xs tracking-[0.35em] text-[#e8e4d8]/85 [text-shadow:1px_1px_0_#000] sm:text-sm">
                WEB 复刻版 · 程序化像素世界
              </p>
            </div>
            <nav className="pointer-events-auto flex w-64 flex-col gap-3 sm:w-72" aria-label="主菜单">
              <MenuButton gold onClick={() => engine.enterWorld()}>
                进入世界
              </MenuButton>
              {st.hasSave && (
                <MenuButton onClick={() => engine.continueGame()}>继续上次冒险</MenuButton>
              )}
              <MenuButton onClick={() => engine.regenerate()}>生成新世界</MenuButton>
              <MenuButton onClick={() => setShowHelp(true)}>操作说明</MenuButton>
            </nav>
          </div>
          <p className="absolute inset-x-0 bottom-3 px-4 text-center text-[11px] text-[#e8e4d8]/50 [text-shadow:1px_1px_0_#000]">
            泰拉瑞亚 Web 复刻 v0.1 · 致敬 Re-Logic 的伟大作品
          </p>
        </div>
      )}

      {/* ---- 死亡 ---- */}
      {showDead && (
        <div className="ovl-fade pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-red-950/60">
          <h2 className="text-4xl font-black text-[#e03c3c] [text-shadow:0_3px_0_#5a0f0f,0_6px_0_rgba(0,0,0,0.6)] sm:text-6xl">
            你已死亡…
          </h2>
          <p className="animate-pulse text-sm tracking-[0.3em] text-[#e8c8c8] [text-shadow:1px_1px_0_#000]">
            即将重生
          </p>
        </div>
      )}

      {/* ---- 暂停菜单 ---- */}
      {showPaused && (
        <div className="ovl-fade pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="w-72 max-w-full rounded-md border-2 border-[#6a76b8] bg-[rgba(16,20,40,0.95)] p-5">
            <h2 className="mb-4 text-center text-lg font-bold tracking-widest text-[#f7d060] [text-shadow:1px_1px_0_#000]">
              已暂停
            </h2>
            <div className="flex flex-col gap-2.5">
              <MenuButton small onClick={() => engine.togglePause()}>
                继续游戏
              </MenuButton>
              <MenuButton small onClick={handleSave}>
                保存游戏
              </MenuButton>
              <MenuButton small onClick={() => engine.toggleMute()}>
                <span className="flex items-center justify-center gap-2">
                  {st.muted ? <VolumeX size={15} aria-hidden /> : <Volume2 size={15} aria-hidden />}
                  声音：{st.muted ? '关' : '开'}
                </span>
              </MenuButton>
              <MenuButton small onClick={() => engine.quitToTitle()}>
                回到标题
              </MenuButton>
            </div>
          </div>
        </div>
      )}

      {/* ---- 标题屏帮助弹窗 ---- */}
      {showHelp && (
        <div className="ovl-fade pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-[19rem] max-w-full rounded-md border-2 border-[#6a76b8] bg-[rgba(16,20,40,0.96)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-widest text-[#f0e8c8] [text-shadow:1px_1px_0_#000]">
                操作说明
              </h2>
              <button
                type="button"
                aria-label="关闭操作说明"
                className="border border-[#6a76b8] bg-[rgba(28,34,66,0.85)] px-2 py-0.5 text-xs text-[#e8e4d8] transition-colors hover:border-[#f7d060]"
                onClick={() => setShowHelp(false)}
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
            <p className="mt-3 border-t border-[#6a76b8]/40 pt-2 text-[10px] leading-relaxed text-[#8a8a9a]">
              本作为键盘 + 鼠标游戏:先砍树取木材制作工作台,再挖矿造更好的工具。夜晚会有敌怪出没!
            </p>
            <div className="mt-4">
              <MenuButton small onClick={() => setShowHelp(false)}>
                开始冒险
              </MenuButton>
            </div>
          </div>
        </div>
      )}

      {/* ---- Loading(置于最后,任何状态下都盖在最上层) ---- */}
      {st.loading && (
        <div className="ovl-fade pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-black/90">
          <div className="ovl-spin relative h-10 w-10 border-4 border-[#f7d060]" aria-hidden>
            <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 bg-[#6a76b8]" />
          </div>
          <p className="text-sm tracking-[0.3em] text-[#e8e4d8] [text-shadow:1px_1px_0_#000]" role="status">
            {st.loadingText || '正在生成世界…'}
          </p>
        </div>
      )}
    </div>
  )
}
