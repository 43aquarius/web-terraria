'use client'

/**
 * 全屏覆盖层 — loading / 标题屏 / 世界生成对话框 / 死亡 / 暂停菜单 / 标题屏帮助弹窗
 * 视觉完全仿原版 Terraria 1.4:官方 logo + 石质菜单按钮 + 原版蓝 UI 面板,根据游戏 UI 状态切换,带 fade-in 动画
 */

import { useState, type ReactNode } from 'react'
import { Github, Volume2, VolumeX } from 'lucide-react'
import { engine } from '@/game/engine'
import { useToast } from '@/hooks/use-toast'
import { GAME_CONTROLS, GAME_DEV_CONTROLS_LINE, useUIState } from '@/components/game/HUD'
import { WORLD_SIZES, type WorldSize } from '@/game/constants'

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

/* ==================== 原版 Terraria 1.4 UI 风格 ==================== */

/* 字体:近似原版 Andy 的圆润粗体,中文回退 Noto Sans SC */
.terraria-font { font-family: var(--font-andy), var(--font-cjk), sans-serif; }

/* 白字黑描边(原版本本号/版权行/面板文字效果) */
.t-stroke {
  text-shadow:
    1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000,
    1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000;
}

/* 石质菜单按钮(标题屏主菜单/弹窗小按钮通用) */
.t-menu-btn {
  width: 100%;
  padding: 12px 24px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.08em;
  border: 2px solid #565e78;
  border-radius: 3px;
  background: linear-gradient(180deg, #3d4355 0%, #2b3040 100%);
  box-shadow:
    inset 0 2px 0 rgba(255, 255, 255, 0.12),
    inset 0 -3px 0 rgba(0, 0, 0, 0.35),
    0 2px 5px rgba(0, 0, 0, 0.45);
  cursor: pointer;
  transition: filter 0.07s linear;
}
.t-menu-btn-sm { padding: 8px 18px; font-size: 13px; letter-spacing: 0.06em; }
.t-menu-btn:hover:not(:disabled) {
  background: linear-gradient(180deg, #4a5266 0%, #363c50 100%);
  filter: brightness(1.1);
}
.t-menu-btn:active:not(:disabled) { transform: translateY(1px); filter: brightness(0.92); }
.t-menu-btn:disabled { opacity: 0.55; cursor: default; }

/* 主推按钮(gold):金边 + 略大 */
.t-menu-btn-gold { border-color: #a8853c; background: linear-gradient(180deg, #4a5266 0%, #333a4e 100%); }
.t-menu-btn-gold:not(.t-menu-btn-sm) { padding: 14px 24px; font-size: 19px; }

/* 按钮文字:原版奶油→橙渐变字(drop-shadow 让渐变字带黑色投影) */
.t-btn-text {
  background-image: linear-gradient(180deg, #ffe9b0 30%, #f0b840 90%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(1px 2px 0 rgba(0, 0, 0, 0.55));
}
.t-btn-text-gold { background-image: linear-gradient(180deg, #fff8d0 25%, #f7c94a 90%); }
.t-menu-btn:hover:not(:disabled) .t-btn-text { background-image: linear-gradient(180deg, #ffffff 25%, #ffe9a8 90%); }
.t-menu-btn:disabled .t-btn-text { background-image: linear-gradient(180deg, #b8bcc8 30%, #8a8e9a 90%); }

/* 原版蓝 UI 面板(世界生成/暂停/帮助弹窗) */
.t-panel {
  background: rgba(28, 36, 74, 0.96);
  border: 2px solid rgba(120, 140, 220, 0.8);
  border-radius: 4px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), 0 10px 36px rgba(0, 0, 0, 0.7);
}

/* 面板内输入框:原版蓝底 + 亮蓝边,聚焦金色 */
.t-input {
  width: 100%;
  background: rgba(63, 82, 151, 0.35);
  border: 2px solid rgba(120, 140, 220, 0.8);
  border-radius: 3px;
  color: #f0f2fa;
  transition: border-color 0.1s linear;
}
.t-input::placeholder { color: rgba(165, 180, 225, 0.55); }
.t-input:focus { border-color: #f7d060; outline: none; }
.t-input:disabled { opacity: 0.55; }

/* 世界大小单选按钮 */
.t-radio {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(63, 82, 151, 0.35);
  border: 2px solid rgba(120, 140, 220, 0.8);
  border-radius: 3px;
  cursor: pointer;
  transition: border-color 0.1s linear;
}
.t-radio:hover:not(:disabled) { border-color: #9cb0f0; }
.t-radio.t-active { border-color: #f7d060; background: rgba(110, 90, 40, 0.4); }

/* 弹窗右上角关闭按钮 */
.t-close {
  background: rgba(63, 82, 151, 0.35);
  border: 1px solid rgba(120, 140, 220, 0.8);
  border-radius: 2px;
  color: #dfe6ff;
  cursor: pointer;
  transition: border-color 0.1s linear, color 0.1s linear;
}
.t-close:hover:not(:disabled) { border-color: #f7d060; color: #f7d060; }
.t-close:disabled { opacity: 0.5; cursor: default; }

/* 帮助弹窗按键徽标 */
.t-key {
  background: rgba(63, 82, 151, 0.35);
  border: 1px solid rgba(120, 140, 220, 0.8);
  border-radius: 2px;
  color: #f0e8c8;
}

/* 死亡屏大红字:深红描边 + 黑投影 */
.t-death {
  color: #e03c3c;
  text-shadow:
    2px 2px 0 #7a1414, -2px 2px 0 #7a1414, 2px -2px 0 #7a1414, -2px -2px 0 #7a1414,
    2px 0 0 #7a1414, -2px 0 0 #7a1414, 0 2px 0 #7a1414, 0 -2px 0 #7a1414,
    0 6px 16px rgba(0, 0, 0, 0.8);
}
`

/** 泰拉瑞亚原版石质菜单按钮 */
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
      className={`t-menu-btn ${gold ? 't-menu-btn-gold' : ''} ${small ? 't-menu-btn-sm' : ''}`}
    >
      <span className={`t-btn-text ${gold ? 't-btn-text-gold' : ''}`}>{children}</span>
    </button>
  )
}

/** GitHub 仓库入口(标题屏右下角 / 暂停菜单底部) */
function GitHubLink({ iconSize, withText = false }: { iconSize: number; withText?: boolean }) {
  return (
    <a
      href="https://github.com/43aquarius/web-terraria"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="GitHub 仓库"
      className="pointer-events-auto inline-flex items-center gap-1.5 text-[#9ab8e0]/80 transition-colors hover:text-white"
    >
      <Github size={iconSize} aria-hidden />
      {withText && <span className="text-[11px] tracking-wider">web-terraria</span>}
    </a>
  )
}

export default function Overlays() {
  const st = useUIState()
  const { toast } = useToast()
  const [showHelp, setShowHelp] = useState(false)

  /* ---- 世界生成对话框表单状态 ---- */
  const [showGen, setShowGen] = useState(false)
  const [genSize, setGenSize] = useState<WorldSize>('small')
  const [genSeed, setGenSeed] = useState('')
  const [genName, setGenName] = useState('泰拉行者')
  const [genDev, setGenDev] = useState(false)
  const [generating, setGenerating] = useState(false)

  /* ---- 联机对话框状态(15-b) ---- */
  const [showMp, setShowMp] = useState(false)
  const [mpName, setMpName] = useState('泰拉行者')
  const [mpRoom, setMpRoom] = useState('lobby')
  const [mpConnecting, setMpConnecting] = useState(false)

  const handleSave = (): void => {
    const ok = engine.saveGame()
    toast({
      title: ok ? '已保存' : '保存失败',
      description: ok ? '世界与背包已写入本地存档' : '存档未能写入,请重试',
    })
  }

  /** 生成新世界并直接进入(世界生成为同步阻塞,先让按钮状态绘制一帧再执行) */
  const handleStartNewWorld = (): void => {
    if (generating) return
    setGenerating(true)
    window.setTimeout(() => {
      engine.newWorld(genSize, genSeed.trim(), genName.trim() || '泰拉行者', genDev)
      engine.enterWorld()
      setGenerating(false)
      setShowGen(false)
    }, 60)
  }

  /** 联机入场: 连接 mp-server(3010) → 同房间同种子世界 */
  const handleStartMP = (): void => {
    if (mpConnecting) return
    setMpConnecting(true)
    window.setTimeout(() => {
      engine.enterWorldMP(mpName.trim() || '泰拉行者', mpRoom.trim() || 'lobby')
      setMpConnecting(false)
      setShowMp(false)
    }, 60)
  }

  const showTitle = st.screen === 'title' && !st.loading
  const showDead = st.screen === 'dead'
  const showPaused = st.paused && st.screen === 'playing' && !st.loading

  return (
    <div className="terraria-font pointer-events-none absolute inset-0">
      <style>{OVL_CSS}</style>

      {/* ---- 标题屏(背后是活的游戏世界渲染,原版标题屏背景较亮,只加轻微暗化) ---- */}
      {showTitle && (
        <div className="ovl-fade pointer-events-none absolute inset-0 z-40 bg-black/20">
          <div className="flex h-full flex-col items-center px-4">
            {/* 原版 Terraria logo(官方素材,居中偏上) */}
            <img
              src="/assets/terraria_logo.png"
              alt="Terraria"
              width={628}
              height={193}
              draggable={false}
              className="mt-[min(12vh,80px)] w-[min(80vw,560px)] select-none drop-shadow-[0_5px_10px_rgba(0,0,0,0.5)]"
            />
            {/* 主菜单:logo 下方竖排居中,原版石质按钮 */}
            <nav
              className="pointer-events-auto mt-[min(6vh,48px)] flex w-72 flex-col gap-3 sm:w-80"
              aria-label="主菜单"
            >
              <MenuButton gold onClick={() => engine.enterWorld()}>
                进入世界
              </MenuButton>
              {st.hasSave && (
                <MenuButton onClick={() => engine.continueGame()}>继续上次冒险</MenuButton>
              )}
              <MenuButton onClick={() => setShowGen(true)}>生成新世界</MenuButton>
              <MenuButton onClick={() => setShowMp(true)}>联机游戏</MenuButton>
              <MenuButton onClick={() => setShowHelp(true)}>操作指南</MenuButton>
            </nav>
          </div>
          {/* 左下角版本号 */}
          <p className="t-stroke absolute bottom-2 left-3 text-[11px] text-white">
            Web 复刻版 v0.2
          </p>
          {/* 右下角版权行 + GitHub 仓库图标 */}
          <div className="absolute bottom-2 right-3 flex items-center gap-2">
            <p className="t-stroke text-[10px] text-white sm:text-[11px]">
              Copyright © Re-Logic — Web 复刻致敬之作
            </p>
            <GitHubLink iconSize={16} />
          </div>
        </div>
      )}

      {/* ---- 世界生成对话框(覆盖标题屏,原版蓝面板) ---- */}
      {showGen && (
        <div className="ovl-fade pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="t-panel w-[22rem] max-w-full p-4 sm:w-[25rem]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="t-stroke text-base font-bold tracking-widest text-[#f7d060]">
                生成新世界
              </h2>
              <button
                type="button"
                aria-label="关闭世界生成对话框"
                disabled={generating}
                className="t-close px-2 py-0.5 text-xs"
                onClick={() => setShowGen(false)}
              >
                ✕
              </button>
            </div>

            {/* 世界大小三选一 */}
            <div className="mb-3">
              <span className="t-stroke mb-1.5 block text-xs font-bold text-[#f0e8c8]">
                世界大小
              </span>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="世界大小">
                {(Object.keys(WORLD_SIZES) as WorldSize[]).map((s) => {
                  const sz = WORLD_SIZES[s]
                  const active = genSize === s
                  return (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={generating}
                      onClick={() => setGenSize(s)}
                      className={`t-radio px-1 py-1.5 disabled:opacity-60 ${active ? 't-active' : ''}`}
                    >
                      <span
                        className={`text-sm font-bold leading-tight ${
                          active ? 'text-[#f7d060]' : 'text-[#f0e8c8]'
                        } [text-shadow:1px_1px_0_#000]`}
                      >
                        {sz.label}
                      </span>
                      <span className="text-[9px] tabular-nums leading-tight text-[#9ab8e0]">
                        {sz.w}×{sz.h}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 种子 */}
            <label className="mb-3 block">
              <span className="t-stroke mb-1 block text-xs font-bold text-[#f0e8c8]">
                世界种子
              </span>
              <input
                type="text"
                value={genSeed}
                disabled={generating}
                maxLength={32}
                placeholder="留空随机"
                onChange={(e) => setGenSeed(e.target.value)}
                className="t-input px-2 py-1.5 text-sm"
              />
            </label>

            {/* 角色名 */}
            <label className="mb-3 block">
              <span className="t-stroke mb-1 block text-xs font-bold text-[#f0e8c8]">
                角色名
              </span>
              <input
                type="text"
                value={genName}
                disabled={generating}
                maxLength={12}
                onChange={(e) => setGenName(e.target.value)}
                className="t-input px-2 py-1.5 text-sm"
              />
            </label>

            {/* 开发者模式 */}
            <label className="mb-4 flex cursor-pointer select-none items-center gap-2">
              <input
                type="checkbox"
                checked={genDev}
                disabled={generating}
                onChange={(e) => setGenDev(e.target.checked)}
                className="h-4 w-4 shrink-0 accent-[#f7d060]"
              />
              <span className="text-xs leading-snug text-[#c8d0e8]">
                开发者模式（飞行 / 刷怪 / 昼夜切换）
              </span>
            </label>

            <div className="flex gap-2">
              <div className="flex-1">
                <MenuButton gold small onClick={handleStartNewWorld}>
                  {generating ? '正在生成…' : '开始冒险'}
                </MenuButton>
              </div>
              <div className="flex-1">
                <MenuButton small onClick={() => setShowGen(false)}>
                  返回
                </MenuButton>
              </div>
            </div>
            {generating && (
              <div className="mt-2 flex items-center justify-center gap-2" role="status">
                <div className="ovl-spin h-4 w-4 border-2 border-[#f7d060]" aria-hidden />
                <span className="t-stroke text-[11px] tracking-widest text-[#9ab8e0]">
                  正在生成世界…
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---- 联机对话框(15-b: 昵称 + 房间码, 同房间共享世界与编辑) ---- */}
      {showMp && (
        <div className="ovl-fade pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="t-panel w-[22rem] max-w-full p-4 sm:w-[25rem]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="t-stroke text-base font-bold tracking-widest text-[#f7d060]">
                联机游戏
              </h2>
              <button
                type="button"
                aria-label="关闭联机对话框"
                disabled={mpConnecting}
                className="t-close px-2 py-0.5 text-xs"
                onClick={() => setShowMp(false)}
              >
                ✕
              </button>
            </div>

            <p className="mb-3 text-[11px] leading-relaxed text-[#c8d0e8]">
              和好友输入<b className="text-[#f7d060]">相同房间码</b>进入同一个世界：一起挖矿、盖房、聊天。
              世界由房间码决定，方块编辑实时同步。
            </p>

            <label className="mb-3 block">
              <span className="t-stroke mb-1 block text-xs font-bold text-[#f0e8c8]">昵称</span>
              <input
                type="text"
                value={mpName}
                disabled={mpConnecting}
                maxLength={12}
                onChange={(e) => setMpName(e.target.value)}
                className="t-input px-2 py-1.5 text-sm"
              />
            </label>

            <label className="mb-4 block">
              <span className="t-stroke mb-1 block text-xs font-bold text-[#f0e8c8]">房间码</span>
              <input
                type="text"
                value={mpRoom}
                disabled={mpConnecting}
                maxLength={16}
                placeholder="lobby"
                onChange={(e) => setMpRoom(e.target.value)}
                className="t-input px-2 py-1.5 text-sm"
              />
            </label>

            <div className="flex gap-2">
              <div className="flex-1">
                <MenuButton gold small onClick={handleStartMP}>
                  {mpConnecting ? '连接中…' : '加入房间'}
                </MenuButton>
              </div>
              <div className="flex-1">
                <MenuButton small onClick={() => setShowMp(false)}>
                  返回
                </MenuButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- 死亡屏(原版文案:你被杀死了…) ---- */}
      {showDead && (
        <div className="ovl-fade pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-red-950/45">
          <h2 className="t-death max-w-[90vw] text-center text-4xl font-black sm:text-6xl">
            {st.playerName} 被杀死了…
          </h2>
          <p className="t-stroke animate-pulse text-sm tracking-[0.3em] text-[#ffd6d6]">
            即将重生…
          </p>
        </div>
      )}

      {/* ---- 暂停菜单(原版蓝面板 + 石质按钮) ---- */}
      {showPaused && (
        <div className="ovl-fade pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="t-panel w-72 max-w-full p-5">
            <h2 className="t-stroke mb-2 text-center text-lg font-bold tracking-widest text-[#f7d060]">
              已暂停
            </h2>
            {/* 玩家名 / 世界种子 / 开发者模式徽标 */}
            <div className="mb-4 flex flex-col items-center gap-1.5">
              <p className="t-stroke text-center text-[11px] leading-relaxed text-[#9ab8e0]">
                玩家：{st.playerName}
                {st.seed && (
                  <>
                    {' · '}
                    种子：<span className="font-mono">{st.seed}</span>
                  </>
                )}
              </p>
              {st.devMode && (
                <span className="t-stroke border border-[#f7d060]/70 bg-[rgba(110,90,40,0.5)] px-2 py-0.5 text-[10px] font-bold tracking-wider text-[#f7d060]">
                  开发者模式已开启
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2.5">
              <MenuButton small onClick={() => engine.togglePause()}>
                继续游戏
              </MenuButton>
              <MenuButton small onClick={handleSave}>
                保存游戏
              </MenuButton>
              <MenuButton small onClick={() => engine.toggleMute()}>
                <span className="inline-flex items-center justify-center gap-2">
                  {st.muted ? (
                    <VolumeX size={15} className="text-[#f0b840]" aria-hidden />
                  ) : (
                    <Volume2 size={15} className="text-[#f0b840]" aria-hidden />
                  )}
                  声音：{st.muted ? '关' : '开'}
                </span>
              </MenuButton>
              <MenuButton small onClick={() => engine.quitToTitle()}>
                回到标题
              </MenuButton>
            </div>
            {/* 面板底部 GitHub 仓库链接 */}
            <div className="mt-4 flex justify-center border-t border-[rgba(120,140,220,0.35)] pt-3">
              <GitHubLink iconSize={13} withText />
            </div>
          </div>
        </div>
      )}

      {/* ---- 标题屏帮助弹窗(原版蓝面板) ---- */}
      {showHelp && (
        <div className="ovl-fade pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="t-panel w-[19rem] max-w-full p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="t-stroke text-sm font-bold tracking-widest text-[#f0e8c8]">
                操作说明
              </h2>
              <button
                type="button"
                aria-label="关闭操作说明"
                className="t-close px-2 py-0.5 text-xs"
                onClick={() => setShowHelp(false)}
              >
                ✕
              </button>
            </div>
            <ul className="flex flex-col gap-1.5">
              {GAME_CONTROLS.map(([k, d]) => (
                <li key={k} className="flex items-center justify-between gap-3 text-xs">
                  <span className="t-key whitespace-nowrap px-1.5 py-0.5 font-mono text-[10px]">
                    {k}
                  </span>
                  <span className="text-right text-[#b8c0d8]">{d}</span>
                </li>
              ))}
            </ul>
            {st.devMode && (
              <div className="mt-2 flex items-center justify-between gap-3 border-2 border-[#f7d060]/50 bg-[rgba(110,90,40,0.35)] px-2 py-1.5">
                <span className="t-stroke text-[10px] font-bold tracking-wider text-[#f7d060]">
                  开发者
                </span>
                <span className="text-right text-[11px] text-[#e8c878]">{GAME_DEV_CONTROLS_LINE}</span>
              </div>
            )}
            <p className="mt-3 border-t border-[rgba(120,140,220,0.4)] pt-2 text-[10px] leading-relaxed text-[#8a94b8]">
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
            <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 bg-[#78a0e0]" />
          </div>
          <p className="t-stroke text-sm tracking-[0.3em] text-white" role="status">
            {st.loadingText || '正在生成世界…'}
          </p>
        </div>
      )}
    </div>
  )
}
