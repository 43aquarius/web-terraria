/**
 * sound.ts — 程序化音效合成模块（纯 Web Audio API）
 *
 * 泰拉瑞亚 Web 复刻 · 音频层
 * - 零外部音频文件、零依赖、零 React：全部音效由「共享白噪声 buffer + BiquadFilter
 *   + Gain 指数包络 + OscillatorNode」实时合成
 * - 所有播放方法在 AudioContext 未初始化 / 被暂停时均为安全 no-op（并顺手尝试 resume）
 * - 同一音效 30ms 节流（模块级时间戳 Map），防止游戏循环高频触发导致爆音
 * - 每次触发带 ±2%~10% 随机音高抖动，避免机械感
 * - 单音效峰值音量控制在 0.05 ~ 0.35，经主增益(0.4)汇总输出，整体听感平衡
 */

/* ================================ 对外 API ================================ */

/** 音效模块对外接口（引擎在首次用户手势时调用 init，其余方法可任意时刻安全调用） */
export interface SfxModule {
  init(): void;               // 创建 AudioContext + master GainNode(0.4)，幂等。由引擎在首次用户手势时调用
  setMuted(m: boolean): void;
  isMuted(): boolean;
  toggleMute(): boolean;      // 返回切换后的静音状态
  dig(): void;                // 挖掘刮擦：短促低频噪声脉冲 (~90ms)
  breakBlock(): void;         // 方块破碎：更响的碎裂噪声 + 低频"砰"
  place(): void;              // 放置：柔和短促的"嗒"
  jump(): void;               // 跳跃：轻微快速上滑的短音，音量小
  hurt(): void;               // 玩家受伤：方波下滑音 (~250ms)
  enemyHit(): void;           // 命中敌怪：噪声+音调下坠的"打击感"
  enemyDie(): void;           // 敌怪死亡：史莱姆"噗嗤"挤压声（噪声爆+低频pop）
  pickup(): void;             // 拾取：明亮的双音上滑 (E5→A5 正弦)
  craft(): void;              // 合成：两声清脆的敲击/叮当
  swing(): void;              // 挥舞工具：轻柔的噪声"嗖"（带通滤波扫频）
  splash(): void;             // 入水：低通噪声泼溅 + 1-2个气泡音
  death(): void;              // 玩家死亡：小调下行三连音，略带戏剧性
  click(): void;              // UI 点击：极短的 tick
}

/* ================================ 内部常量 ================================ */

/** 主输出增益（所有音效经此节点汇入 AudioContext.destination） */
const MASTER_GAIN = 0.4;

/** 同一音效的最小触发间隔（毫秒） */
const THROTTLE_MS = 30;

/** 指数包络的"零值"——exponentialRampToValueAtTime 不能到 0，用极小值代替 */
const MIN_GAIN = 0.0001;

/* ================================ 内部类型 ================================ */

/** 音频核心：上下文 + 主增益 + 共享白噪声 buffer（懒创建） */
interface AudioCore {
  ctx: AudioContext;
  master: GainNode;
  noise: AudioBuffer | null;
}

/** 噪声播放参数（白噪声源 → BiquadFilter → 包络 Gain） */
interface NoiseOpts {
  /** 滤波器类型 */
  type: BiquadFilterType;
  /** 滤波器起始频率 (Hz) */
  freq: number;
  /** 滤波器结束频率 (Hz)，设置后产生滤波扫频 */
  freqEnd?: number;
  /** 滤波器 Q 值（共振强度） */
  q?: number;
  /** 峰值音量（0.05 ~ 0.35） */
  peak: number;
  /** 起音时长 (s) */
  attack: number;
  /** 峰值保持时长 (s) */
  hold: number;
  /** 释放衰减时长 (s) */
  release: number;
  /** 噪声源播放速率（<1 更低沉粗粝，>1 更细碎明亮） */
  rate?: number;
  /** 相对当前时间的延迟 (s)，用于组合音效的时序编排 */
  delay?: number;
}

/** 振荡器播放参数（OscillatorNode → 包络 Gain） */
interface ToneOpts {
  /** 波形 */
  type: OscillatorType;
  /** 起始频率 (Hz) */
  freq: number;
  /** 结束频率 (Hz)，设置后产生音高滑动 */
  freqEnd?: number;
  /** 峰值音量（0.05 ~ 0.35） */
  peak: number;
  /** 起音时长 (s) */
  attack: number;
  /** 峰值保持时长 (s) */
  hold: number;
  /** 释放衰减时长 (s) */
  release: number;
  /** 相对当前时间的延迟 (s) */
  delay?: number;
}

/* ================================ 模块状态 ================================ */

/** 音频核心（init 时创建；为 null 时所有播放方法均为 no-op） */
let core: AudioCore | null = null;

/** 静音标志（独立于 AudioContext 存在，允许 UI 在 init 前切换） */
let muted = false;

/** 每种音效的上次触发时间戳（performance.now()），用于 30ms 节流 */
const lastTrigger = new Map<string, number>();

/* ================================ 工具函数 ================================ */

/** 返回 [min, max) 区间随机浮点数 */
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 音高抖动：给基准频率乘上 ±ratio（默认 ±8%）的随机系数，避免机械感 */
function jitter(freq: number, ratio = 0.08): number {
  return freq * rand(1 - ratio, 1 + ratio);
}

/**
 * 节流闸门：同一音效 30ms 内最多放行一次（leading edge，被拦截不刷新时间戳）
 * @param key 音效名（与 SfxModule 方法一一对应）
 */
function allow(key: string): boolean {
  const now = performance.now();
  const last = lastTrigger.get(key);
  if (last !== undefined && now - last < THROTTLE_MS) return false;
  lastTrigger.set(key, now);
  return true;
}

/**
 * 播放前置检查：上下文未初始化或被暂停时返回 null（安全 no-op），
 * 挂起时顺手尝试 resume（下一帧起即可正常发声）
 */
function ready(): AudioCore | null {
  const a = core;
  if (!a) return null;
  if (a.ctx.state !== 'running') {
    void a.ctx.resume().catch(() => undefined);
    return null;
  }
  return a;
}

/** 获取共享白噪声 buffer（懒创建：1 秒 / 单声道 / 上下文采样率） */
function getNoise(a: AudioCore): AudioBuffer {
  if (!a.noise) {
    const len = Math.floor(a.ctx.sampleRate);
    const buf = a.ctx.createBuffer(1, len, a.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    a.noise = buf;
  }
  return a.noise;
}

/**
 * 通用指数包络：MIN_GAIN →(attack)→ peak →(hold)→(release)→ MIN_GAIN
 * 注意 exponentialRamp 不能衰减到 0，统一以 0.0001 兜底
 */
function envGain(
  a: AudioCore,
  t0: number,
  peak: number,
  attack: number,
  hold: number,
  release: number,
): GainNode {
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(MIN_GAIN, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  if (hold > 0) g.gain.setValueAtTime(peak, t0 + attack + hold);
  g.gain.exponentialRampToValueAtTime(MIN_GAIN, t0 + attack + hold + release);
  return g;
}

/** 播放一次滤波噪声：BufferSource(白噪声) → BiquadFilter → 包络 → master */
function playNoise(a: AudioCore, o: NoiseOpts): void {
  const t0 = a.ctx.currentTime + (o.delay ?? 0);
  const dur = o.attack + o.hold + o.release;

  const src = a.ctx.createBufferSource();
  src.buffer = getNoise(a);
  src.playbackRate.value = o.rate ?? 1;

  const flt = a.ctx.createBiquadFilter();
  flt.type = o.type;
  flt.Q.value = o.q ?? 1;
  flt.frequency.setValueAtTime(o.freq, t0);
  if (o.freqEnd !== undefined) {
    flt.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t0 + dur);
  }

  const g = envGain(a, t0, o.peak, o.attack, o.hold, o.release);
  src.connect(flt);
  flt.connect(g);
  g.connect(a.master);

  // 在 1s 噪声 buffer 内取随机起点，让连续触发的噪声样本不重复
  const offset = rand(0, Math.max(0.01, 1 - dur - 0.1));
  src.start(t0, offset);
  src.stop(t0 + dur + 0.05);
}

/** 播放一次振荡器音：Oscillator → 包络 → master（可选音高滑动） */
function playTone(a: AudioCore, o: ToneOpts): void {
  const t0 = a.ctx.currentTime + (o.delay ?? 0);
  const dur = o.attack + o.hold + o.release;

  const osc = a.ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t0 + dur);
  }

  const g = envGain(a, t0, o.peak, o.attack, o.hold, o.release);
  osc.connect(g);
  g.connect(a.master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/* ================================ 具体音效 ================================ */

/** 挖掘刮擦：短促低频噪声脉冲（~90ms），带通聚焦在低频段、慢速回放更粗粝 */
function dig(): void {
  const a = ready();
  if (!a || !allow('dig')) return;
  playNoise(a, {
    type: 'bandpass',
    freq: jitter(320, 0.1),
    freqEnd: 180,
    q: 1.3,
    peak: 0.18,
    attack: 0.005,
    hold: 0.02,
    release: 0.065,
    rate: rand(0.7, 1.0),
  });
}

/** 方块破碎：更亮更响的碎裂噪声（向下扫频）+ 低频正弦"砰"，与 dig 明确区分 */
function breakBlock(): void {
  const a = ready();
  if (!a || !allow('breakBlock')) return;
  playNoise(a, {
    type: 'bandpass',
    freq: jitter(1500, 0.1),
    freqEnd: 450,
    q: 0.8,
    peak: 0.3,
    attack: 0.003,
    hold: 0.03,
    release: 0.12,
    rate: rand(0.9, 1.3),
  });
  playTone(a, {
    type: 'sine',
    freq: jitter(95, 0.1),
    freqEnd: 45,
    peak: 0.26,
    attack: 0.003,
    hold: 0.02,
    release: 0.12,
  });
}

/** 放置方块：柔和短促的"嗒"（三角波快速降调 + 极轻的接触噪声） */
function place(): void {
  const a = ready();
  if (!a || !allow('place')) return;
  playTone(a, {
    type: 'triangle',
    freq: jitter(230, 0.08),
    freqEnd: 120,
    peak: 0.12,
    attack: 0.003,
    hold: 0.01,
    release: 0.05,
  });
  playNoise(a, {
    type: 'lowpass',
    freq: 1400,
    peak: 0.05,
    attack: 0.002,
    hold: 0.004,
    release: 0.03,
    rate: 1.2,
  });
}

/** 跳跃：轻微快速上滑的三角波短音，音量小、不干扰 */
function jump(): void {
  const a = ready();
  if (!a || !allow('jump')) return;
  playTone(a, {
    type: 'triangle',
    freq: jitter(300, 0.06),
    freqEnd: 640,
    peak: 0.07,
    attack: 0.012,
    hold: 0,
    release: 0.1,
  });
}

/** 玩家受伤：方波下滑音（~250ms），320Hz → 95Hz 连续下坠 */
function hurt(): void {
  const a = ready();
  if (!a || !allow('hurt')) return;
  playTone(a, {
    type: 'square',
    freq: jitter(320, 0.07),
    freqEnd: 95,
    peak: 0.16,
    attack: 0.005,
    hold: 0.05,
    release: 0.195,
  });
}

/** 命中敌怪：带通噪声打击 + 方波音调下坠，两层叠加出"打击感" */
function enemyHit(): void {
  const a = ready();
  if (!a || !allow('enemyHit')) return;
  playNoise(a, {
    type: 'bandpass',
    freq: jitter(950, 0.1),
    freqEnd: 260,
    q: 1,
    peak: 0.22,
    attack: 0.002,
    hold: 0.012,
    release: 0.09,
    rate: rand(0.9, 1.2),
  });
  playTone(a, {
    type: 'square',
    freq: jitter(220, 0.08),
    freqEnd: 70,
    peak: 0.12,
    attack: 0.002,
    hold: 0.01,
    release: 0.1,
  });
}

/** 敌怪死亡：史莱姆"噗嗤"——低通噪声爆（挤压感）+ 低频 sine pop */
function enemyDie(): void {
  const a = ready();
  if (!a || !allow('enemyDie')) return;
  playNoise(a, {
    type: 'lowpass',
    freq: jitter(750, 0.1),
    freqEnd: 220,
    q: 0.9,
    peak: 0.28,
    attack: 0.004,
    hold: 0.02,
    release: 0.13,
    rate: rand(0.75, 1.05),
  });
  playTone(a, {
    type: 'sine',
    freq: jitter(165, 0.08),
    freqEnd: 55,
    peak: 0.22,
    attack: 0.003,
    hold: 0.015,
    release: 0.1,
  });
}

/** 拾取：明亮悦耳的双音上滑，E5(659Hz) → A5(880Hz) 正弦，尾音继续微升 */
function pickup(): void {
  const a = ready();
  if (!a || !allow('pickup')) return;
  const f1 = jitter(659.26, 0.02); // E5（音准类音效抖动收窄到 ±2%）
  const f2 = jitter(880, 0.02); // A5
  playTone(a, {
    type: 'sine',
    freq: f1,
    freqEnd: f1 * 1.02,
    peak: 0.14,
    attack: 0.005,
    hold: 0.02,
    release: 0.05,
  });
  playTone(a, {
    type: 'sine',
    freq: f2,
    freqEnd: f2 * 1.04,
    peak: 0.15,
    attack: 0.005,
    hold: 0.03,
    release: 0.09,
    delay: 0.075,
  });
}

/** 合成：两声清脆的"叮当"——高频三角波 + 高通瞬态噪声，第二声更高、延迟 100ms */
function craft(): void {
  const a = ready();
  if (!a || !allow('craft')) return;
  playNoise(a, { type: 'highpass', freq: 3200, peak: 0.06, attack: 0.001, hold: 0.002, release: 0.02 });
  playTone(a, {
    type: 'triangle',
    freq: jitter(1150, 0.05),
    freqEnd: 1100,
    peak: 0.13,
    attack: 0.002,
    hold: 0.012,
    release: 0.075,
  });
  playNoise(a, { type: 'highpass', freq: 3600, peak: 0.05, attack: 0.001, hold: 0.002, release: 0.02, delay: 0.1 });
  playTone(a, {
    type: 'triangle',
    freq: jitter(1520, 0.05),
    freqEnd: 1450,
    peak: 0.12,
    attack: 0.002,
    hold: 0.012,
    release: 0.09,
    delay: 0.1,
  });
}

/** 挥舞工具：轻柔的噪声"嗖"——带通滤波从低到高扫频 + 缓起音包络 */
function swing(): void {
  const a = ready();
  if (!a || !allow('swing')) return;
  playNoise(a, {
    type: 'bandpass',
    freq: jitter(420, 0.1),
    freqEnd: 2000,
    q: 1.6,
    peak: 0.12,
    attack: 0.055,
    hold: 0.03,
    release: 0.1,
    rate: rand(0.9, 1.1),
  });
}

/** 入水：低通噪声泼溅（长衰减）+ 1~2 个随机上滑正弦"气泡"音 */
function splash(): void {
  const a = ready();
  if (!a || !allow('splash')) return;
  playNoise(a, {
    type: 'lowpass',
    freq: jitter(850, 0.1),
    freqEnd: 260,
    q: 0.7,
    peak: 0.26,
    attack: 0.008,
    hold: 0.04,
    release: 0.28,
    rate: rand(0.8, 1.0),
  });
  const bubbles = Math.random() < 0.5 ? 1 : 2;
  for (let i = 0; i < bubbles; i++) {
    playTone(a, {
      type: 'sine',
      freq: rand(260, 460),
      freqEnd: rand(620, 920),
      peak: 0.07,
      attack: 0.008,
      hold: 0.012,
      release: 0.06,
      delay: 0.12 + i * rand(0.07, 0.13),
    });
  }
}

/** 玩家死亡：小调下行三连音 A4→F4→C4（各 160ms），方波 + 低八度锯齿混合，略带戏剧性 */
function death(): void {
  const a = ready();
  if (!a || !allow('death')) return;
  const notes = [440, 349.23, 261.63]; // A4 → F4 → C4
  notes.forEach((base, i) => {
    const f = jitter(base, 0.015); // 旋律音效抖动收窄，保持音准
    const delay = i * 0.17; // 音长 160ms + 10ms 间隔，三音清晰可辨
    playTone(a, { type: 'square', freq: f, peak: 0.1, attack: 0.008, hold: 0.06, release: 0.092, delay });
    playTone(a, { type: 'sawtooth', freq: f / 2, peak: 0.08, attack: 0.008, hold: 0.06, release: 0.092, delay });
  });
}

/** UI 点击：极短的 tick（~23ms 高通噪声瞬态） */
function click(): void {
  const a = ready();
  if (!a || !allow('click')) return;
  playNoise(a, {
    type: 'highpass',
    freq: 2600,
    peak: 0.09,
    attack: 0.001,
    hold: 0.002,
    release: 0.02,
  });
}

/* ================================ 生命周期 ================================ */

/** 初始化音频（幂等）：创建 AudioContext + master Gain(0.4)；需在首次用户手势中调用 */
function init(): void {
  if (core) {
    // 已初始化：仅在被挂起时尝试恢复（比如再次用户手势触发）
    if (core.ctx.state === 'suspended') void core.ctx.resume().catch(() => undefined);
    return;
  }
  if (typeof window === 'undefined') return; // SSR 环境保护（Next.js 服务端渲染）
  // 兼容旧 Safari 的 webkit 前缀（AudioContext 全局构造器在 typeof globalThis 上）
  const w = window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return; // 环境不支持 Web Audio：所有播放方法保持 no-op
  const ctx = new Ctor();
  const master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_GAIN;
  master.connect(ctx.destination);
  core = { ctx, master, noise: null };
  // 若在用户手势中调用，立即激活上下文
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

/** 设置静音（用 setTargetAtTime 平滑过渡，避免开关瞬间"咔哒"爆音） */
function setMuted(m: boolean): void {
  muted = m;
  if (!core) return;
  const t = core.ctx.currentTime;
  core.master.gain.cancelScheduledValues(t);
  core.master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, t, 0.015);
}

/** 查询静音状态（AudioContext 未创建时也可用） */
function isMuted(): boolean {
  return muted;
}

/** 切换静音，返回切换后的状态 */
function toggleMute(): boolean {
  setMuted(!muted);
  return muted;
}

/* ================================ 模块导出 ================================ */

export const SFX: SfxModule = {
  init,
  setMuted,
  isMuted,
  toggleMute,
  dig,
  breakBlock,
  place,
  jump,
  hurt,
  enemyHit,
  enemyDie,
  pickup,
  craft,
  swing,
  splash,
  death,
  click,
};
