/**
 * sound.ts — 程序化音效 + BGM 合成模块（纯 Web Audio API）
 *
 * 泰拉瑞亚 Web 复刻 · 音频层
 * - 零外部音频文件、零依赖、零 React：全部音效由「共享白/棕噪声 buffer + BiquadFilter
 *   + Gain 指数包络 + OscillatorNode」实时合成
 * - 所有播放方法在 AudioContext 未初始化 / 被暂停时均为安全 no-op（并顺手尝试 resume）
 * - 同一音效 30ms 节流（模块级时间戳 Map），防止游戏循环高频触发导致爆音
 * - 每次触发带 ±2%~10% 随机音高抖动，避免机械感
 * - 单音效峰值音量控制在 0.05 ~ 0.35，经主增益(0.4)汇总输出，整体听感平衡
 * - Music 模块：三场景（标题/白天/夜晚）程序化芯片音乐 BGM，前瞻调度器精确对拍，
 *   独立总增益(0.55)直连输出，与 SFX 静音状态联动（静音时 BGM 同步停播）
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
  bowShoot(): void;           // 射箭：噪声 whoosh 上扫 + 三角波弦振衰减
  arrowHit(): void;           // 箭命中：短木质"嗒"（方波 + 噪声 click）
  bombThrow(): void;          // 扔炸弹：低沉呼呼声
  explosion(): void;          // 爆炸：brown noise 轰鸣 + 正弦下滑 + 弱回响（约 1.5 倍响度）
  doorOpen(): void;           // 开门：木门吱呀（失谐双锯齿颤抖上滑）
  doorClose(): void;          // 关门：闷响（低频方波 + 噪声 thud）
  chestOpen(): void;          // 开宝箱：金属滑开双音 + 混响感尾音
  crystal(): void;            // 生命水晶：清脆三音上行琶音
  bossRoar(): void;           // Boss 怒吼：失谐双锯齿下滑 + 喉音噪声层
  bossHit(): void;            // Boss 受击：闷重打击
  bossDie(): void;            // Boss 死亡：怒吼变体 + 长下坠滑音 + 噪声消散
  guideTalk(): void;          // 向导说话：两声短促"吧吧"
  plant(): void;              // 种植：软"啵"声
  altar(): void;              // 恶魔祭坛：不祥低鸣（90+135Hz 拍频）
}

/** BGM 场景：标题琶音垫 / 白天田园 / 夜晚静谧 */
export type MusicScene = 'title' | 'day' | 'night';

/** 程序化 BGM 模块接口（芯片音乐三场景，前瞻调度器驱动，输出独立于 SFX） */
export interface MusicModule {
  /** 启动 BGM（幂等；应在首次用户手势后由引擎调用，内部会尝试 resume AudioContext） */
  start(): void;
  /** 停止 BGM（清除调度器并平滑淡出） */
  stop(): void;
  /** 切歌：立即停排新音符，旧歌主增益 0.8s 淡出后新歌淡入；未启动时仅记录场景 */
  setScene(s: MusicScene): void;
  /** 总开关；关闭时 BGM 停播，重新打开后从循环相位继续（与 SFX 静音联动） */
  setEnabled(on: boolean): void;
}

/* ================================ 内部常量 ================================ */

/** 主输出增益（所有音效经此节点汇入 AudioContext.destination） */
const MASTER_GAIN = 0.4;

/** 同一音效的最小触发间隔（毫秒） */
const THROTTLE_MS = 30;

/* ---------- BGM（Music 模块）常量 ---------- */

/** BGM 总增益（独立于 SFX 主增益，直连 destination；旋律/低音/打击峰值远低于此） */
const MUSIC_GAIN = 0.55;

/** 前瞻调度器：轮询间隔(ms) 与 提前排音符的时间窗(s) */
const SCHED_MS = 100;
const SCHED_AHEAD = 0.3;

/** 切歌时旧歌主增益的淡出时长(s) */
const SCENE_FADE = 0.8;

/** 指数包络的"零值"——exponentialRampToValueAtTime 不能到 0，用极小值代替 */
const MIN_GAIN = 0.0001;

/* ================================ 内部类型 ================================ */

/** 音频核心：上下文 + SFX 主增益 + BGM 增益 + 共享白/棕噪声 buffer（懒创建） */
interface AudioCore {
  ctx: AudioContext;
  master: GainNode;
  music: GainNode;
  noise: AudioBuffer | null;
  brown: AudioBuffer | null;
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
  /** true 时改用 brown noise（低频能量更足，用于爆炸轰鸣），默认白噪声 */
  brown?: boolean;
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

/** 获取共享 brown noise buffer（懒创建；Paul Kellet 积分式，低频为主的"轰鸣"质感） */
function getBrown(a: AudioCore): AudioBuffer {
  if (!a.brown) {
    const len = Math.floor(a.ctx.sampleRate);
    const buf = a.ctx.createBuffer(1, len, a.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    a.brown = buf;
  }
  return a.brown;
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
  src.buffer = o.brown ? getBrown(a) : getNoise(a);
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

/* --------------- 内容升级（9-d）新增音效：投射物 / 交互 / Boss / NPC --------------- */

/** 射箭：带通噪声 whoosh（600→2400Hz 上扫 0.12s）+ 三角波弦振（700→380Hz 衰减 0.08s） */
function bowShoot(): void {
  const a = ready();
  if (!a || !allow('bowShoot')) return;
  playNoise(a, {
    type: 'bandpass',
    freq: jitter(600, 0.06),
    freqEnd: 2400,
    q: 1.4,
    peak: 0.14,
    attack: 0.012,
    hold: 0.02,
    release: 0.088,
    rate: rand(0.9, 1.1),
  });
  playTone(a, {
    type: 'triangle',
    freq: jitter(700, 0.04),
    freqEnd: 380,
    peak: 0.09,
    attack: 0.004,
    hold: 0.012,
    release: 0.064,
  });
}

/** 箭命中：短木质"嗒"（方波 190Hz 0.03s + 高频噪声 click） */
function arrowHit(): void {
  const a = ready();
  if (!a || !allow('arrowHit')) return;
  playTone(a, {
    type: 'square',
    freq: jitter(190, 0.08),
    freqEnd: 130,
    peak: 0.12,
    attack: 0.002,
    hold: 0.008,
    release: 0.02,
  });
  playNoise(a, {
    type: 'bandpass',
    freq: jitter(2100, 0.15),
    q: 1.2,
    peak: 0.1,
    attack: 0.001,
    hold: 0.002,
    release: 0.018,
  });
}

/** 扔炸弹：低沉呼呼声（低通噪声 0.15s 短扫） */
function bombThrow(): void {
  const a = ready();
  if (!a || !allow('bombThrow')) return;
  playNoise(a, {
    type: 'lowpass',
    freq: jitter(800, 0.1),
    freqEnd: 240,
    q: 0.8,
    peak: 0.16,
    attack: 0.035,
    hold: 0.045,
    release: 0.07,
    rate: rand(0.7, 0.95),
  });
}

/** 爆炸：低频轰——brown noise 0.5s 指数衰减 + 正弦 110→38Hz 下滑 0.4s + 6ms 延迟的弱回响；整体约 1.5 倍响度仍不削波 */
function explosion(): void {
  const a = ready();
  if (!a || !allow('explosion')) return;
  playNoise(a, {
    type: 'lowpass',
    freq: 1000,
    freqEnd: 90,
    q: 0.7,
    peak: 0.42,
    attack: 0.006,
    hold: 0.03,
    release: 0.464,
    brown: true,
  });
  playTone(a, {
    type: 'sine',
    freq: jitter(110, 0.05),
    freqEnd: 38,
    peak: 0.38,
    attack: 0.005,
    hold: 0.02,
    release: 0.375,
  });
  playNoise(a, {
    type: 'lowpass',
    freq: 500,
    freqEnd: 70,
    q: 0.7,
    peak: 0.2,
    attack: 0.006,
    hold: 0.02,
    release: 0.32,
    brown: true,
    delay: 0.006,
  });
}

/** 开门：木门吱呀——失谐双锯齿 180→260Hz 互相拍频出"颤抖"感（0.18s）+ 轻微摩擦噪声 */
function doorOpen(): void {
  const a = ready();
  if (!a || !allow('doorOpen')) return;
  playTone(a, {
    type: 'sawtooth',
    freq: jitter(180, 0.04),
    freqEnd: 260,
    peak: 0.07,
    attack: 0.02,
    hold: 0.06,
    release: 0.1,
  });
  playTone(a, {
    type: 'sawtooth',
    freq: jitter(189, 0.04),
    freqEnd: 272,
    peak: 0.055,
    attack: 0.02,
    hold: 0.06,
    release: 0.1,
  });
  playNoise(a, {
    type: 'bandpass',
    freq: 600,
    freqEnd: 900,
    q: 2.5,
    peak: 0.045,
    attack: 0.03,
    hold: 0.05,
    release: 0.1,
    rate: rand(0.8, 1.0),
  });
}

/** 关门：闷响——120Hz 方波短音 + 低通噪声 thud（各 ~0.08s） */
function doorClose(): void {
  const a = ready();
  if (!a || !allow('doorClose')) return;
  playTone(a, {
    type: 'square',
    freq: jitter(120, 0.06),
    freqEnd: 85,
    peak: 0.15,
    attack: 0.003,
    hold: 0.012,
    release: 0.065,
  });
  playNoise(a, {
    type: 'lowpass',
    freq: 420,
    freqEnd: 140,
    q: 0.8,
    peak: 0.22,
    attack: 0.002,
    hold: 0.008,
    release: 0.07,
    rate: 0.8,
  });
}

/** 开宝箱：金属滑开——620/880Hz 两个短三角波错开 60ms + 长尾噪声营造混响感 */
function chestOpen(): void {
  const a = ready();
  if (!a || !allow('chestOpen')) return;
  playTone(a, {
    type: 'triangle',
    freq: jitter(620, 0.02),
    freqEnd: 700,
    peak: 0.13,
    attack: 0.004,
    hold: 0.02,
    release: 0.06,
  });
  playTone(a, {
    type: 'triangle',
    freq: jitter(880, 0.02),
    freqEnd: 960,
    peak: 0.12,
    attack: 0.004,
    hold: 0.02,
    release: 0.07,
    delay: 0.06,
  });
  playNoise(a, {
    type: 'bandpass',
    freq: 3400,
    q: 1.5,
    peak: 0.04,
    attack: 0.01,
    hold: 0.03,
    release: 0.28,
    delay: 0.06,
  });
}

/** 生命水晶：清脆琶音——正弦 880/1175/1568Hz 各 0.09s 依次（音准类抖动收窄到 ±1%） */
function crystal(): void {
  const a = ready();
  if (!a || !allow('crystal')) return;
  [880, 1174.66, 1567.98].forEach((f, i) => {
    playTone(a, {
      type: 'sine',
      freq: jitter(f, 0.01),
      peak: 0.15,
      attack: 0.005,
      hold: 0.03,
      release: 0.055,
      delay: i * 0.09,
    });
  });
}

/** Boss 怒吼：恐怖吼——主锯齿 260→55Hz 下滑 0.7s + 失谐副锯齿 + lowpass 噪声喉音层 0.5s */
function bossRoar(): void {
  const a = ready();
  if (!a || !allow('bossRoar')) return;
  playTone(a, {
    type: 'sawtooth',
    freq: jitter(260, 0.05),
    freqEnd: 55,
    peak: 0.17,
    attack: 0.025,
    hold: 0.1,
    release: 0.575,
  });
  playTone(a, {
    type: 'sawtooth',
    freq: jitter(272, 0.05),
    freqEnd: 58,
    peak: 0.11,
    attack: 0.03,
    hold: 0.1,
    release: 0.57,
  });
  playNoise(a, {
    type: 'lowpass',
    freq: 700,
    freqEnd: 160,
    q: 0.9,
    peak: 0.2,
    attack: 0.04,
    hold: 0.08,
    release: 0.38,
    rate: rand(0.65, 0.85),
  });
}

/** Boss 受击：闷重打击——正弦 150→70Hz 0.12s + 低频噪声脉冲 */
function bossHit(): void {
  const a = ready();
  if (!a || !allow('bossHit')) return;
  playTone(a, {
    type: 'sine',
    freq: jitter(150, 0.06),
    freqEnd: 70,
    peak: 0.24,
    attack: 0.004,
    hold: 0.02,
    release: 0.096,
  });
  playNoise(a, {
    type: 'lowpass',
    freq: 520,
    freqEnd: 160,
    q: 0.8,
    peak: 0.2,
    attack: 0.002,
    hold: 0.01,
    release: 0.09,
  });
}

/** Boss 死亡：怒吼变体 + 200→30Hz 下坠滑音 1.1s + 尾部噪声消散 */
function bossDie(): void {
  const a = ready();
  if (!a || !allow('bossDie')) return;
  playTone(a, {
    type: 'sawtooth',
    freq: jitter(240, 0.05),
    freqEnd: 48,
    peak: 0.16,
    attack: 0.03,
    hold: 0.12,
    release: 0.55,
  });
  playTone(a, {
    type: 'sawtooth',
    freq: jitter(252, 0.05),
    freqEnd: 51,
    peak: 0.1,
    attack: 0.04,
    hold: 0.12,
    release: 0.54,
  });
  playTone(a, {
    type: 'sine',
    freq: 200,
    freqEnd: 30,
    peak: 0.22,
    attack: 0.04,
    hold: 0.16,
    release: 0.9,
  });
  playNoise(a, {
    type: 'lowpass',
    freq: 900,
    freqEnd: 90,
    q: 0.8,
    peak: 0.16,
    attack: 0.25,
    hold: 0.1,
    release: 0.75,
    rate: 0.7,
    delay: 0.25,
  });
}

/** 向导说话：两声短促"吧吧"（方波 300/360Hz 各 40ms） */
function guideTalk(): void {
  const a = ready();
  if (!a || !allow('guideTalk')) return;
  playTone(a, {
    type: 'square',
    freq: jitter(300, 0.05),
    freqEnd: 285,
    peak: 0.09,
    attack: 0.006,
    hold: 0.014,
    release: 0.02,
  });
  playTone(a, {
    type: 'square',
    freq: jitter(360, 0.05),
    freqEnd: 340,
    peak: 0.09,
    attack: 0.006,
    hold: 0.014,
    release: 0.02,
    delay: 0.075,
  });
}

/** 种植橡子：软"啵"声（正弦 500→300Hz 0.07s） */
function plant(): void {
  const a = ready();
  if (!a || !allow('plant')) return;
  playTone(a, {
    type: 'sine',
    freq: jitter(500, 0.05),
    freqEnd: 300,
    peak: 0.13,
    attack: 0.008,
    hold: 0.01,
    release: 0.052,
  });
}

/** 恶魔祭坛：不祥低鸣——90Hz + 135Hz 正弦拍频（45Hz 差拍缓慢脉动 0.6s；不加抖动保持拍频纯净） */
function altar(): void {
  const a = ready();
  if (!a || !allow('altar')) return;
  playTone(a, { type: 'sine', freq: 90, peak: 0.15, attack: 0.08, hold: 0.28, release: 0.24 });
  playTone(a, { type: 'sine', freq: 135, peak: 0.12, attack: 0.08, hold: 0.28, release: 0.24 });
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
  // BGM 专用总增益（独立于 SFX master；初始 0，由 Music 模块淡入）
  const music = ctx.createGain();
  music.gain.value = 0;
  music.connect(ctx.destination);
  core = { ctx, master, music, noise: null, brown: null };
  // 若在用户手势中调用，立即激活上下文
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

/** 设置静音（用 setTargetAtTime 平滑过渡，避免开关瞬间"咔哒"爆音） */
function setMuted(m: boolean): void {
  muted = m;
  if (core) {
    const t = core.ctx.currentTime;
    core.master.gain.cancelScheduledValues(t);
    core.master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, t, 0.015);
  }
  applyMusicGain(); // 静音联动：SFX 静音时 BGM 同步停播（见下方 Music 模块）
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

/* ================================ 程序化 BGM ================================ */

/** 音名 → 频率（A4=440，十二平均律）。支持 'C4' / 'A#3' / 'Bb2' 格式 */
const NOTE_SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteFreq(name: string): number {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!m) return 440;
  const semi = NOTE_SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 440 * 2 ** (((parseInt(m[3], 10) + 1) * 12 + semi - 69) / 12);
}

/** 音符事件（旋律 / 低音 / 琶音垫共用一个合成器路径） */
interface SongNote {
  k: 'n';
  f: number;             // 频率 (Hz)
  d: number;             // 时值（网格步数）
  wave: OscillatorType;
  vol: number;           // 峰值音量
  atk: number;           // 起音 (s)
  rel: number;           // 释放 (s)
  gap?: number;          // 音尾留白（音与音轻微断开，避免糊成一片）
  vib?: boolean;         // 4Hz 轻微颤音（主旋律用）
}

/** 打击事件：白噪声 highpass 短 tick */
interface SongTick {
  k: 't';
  vol: number;
}

type SongEv = SongNote | SongTick;

/** 一首歌：网格步长 + 循环总步数 + 按步索引的事件表（调度器按步推进 mod 循环） */
interface SongDef {
  stepDur: number;
  steps: number;
  ev: SongEv[][];
}

/** Day：明快田园（C 大调五声 · 104 BPM · 4/4 · 8 小节循环 · 8 分音符网格） */
const SONG_DAY: SongDef = (() => {
  const ev: SongEv[][] = Array.from({ length: 64 }, () => []);
  // 低音：每小节一个全音符 C2 A1 F2 G2 ×2（正弦 0.12）
  ['C2', 'A1', 'F2', 'G2', 'C2', 'A1', 'F2', 'G2'].forEach((n, bar) => {
    ev[bar * 8].push({ k: 'n', f: noteFreq(n), d: 8, wave: 'sine', vol: 0.12, atk: 0.04, rel: 0.35, gap: 0.06 });
  });
  // 旋律：[起始步, 音名, 时值步数]（四分音符 = 2 步；三角波 0.16 + 颤音）
  const mel: Array<[number, string, number]> = [
    [0, 'E4', 2], [2, 'G4', 2], [4, 'A4', 4],
    [8, 'G4', 2], [10, 'E4', 2], [12, 'D4', 4],
    [16, 'C4', 2], [18, 'D4', 2], [20, 'E4', 2], [22, 'G4', 2],
    [24, 'D4', 6],
    [32, 'E4', 2], [34, 'G4', 2], [36, 'A4', 2], [38, 'C5', 2],
    [40, 'A4', 2], [42, 'G4', 2], [44, 'E4', 4],
    [48, 'D4', 2], [50, 'E4', 2], [52, 'D4', 2], [54, 'C4', 2],
    [56, 'C4', 6],
  ];
  mel.forEach(([s, n, d]) => {
    ev[s].push({ k: 'n', f: noteFreq(n), d, wave: 'triangle', vol: 0.16, atk: 0.012, rel: 0.09, gap: 0.035, vib: true });
  });
  // 打击：每个 8 分音符一个轻 noise tick（正拍 0.04 / 反拍 0.024）
  for (let s = 0; s < 64; s++) ev[s].push({ k: 't', vol: s % 2 === 0 ? 0.04 : 0.024 });
  return { stepDur: 30 / 104, steps: 64, ev };
})();

/** Night：静谧（A 小调 · 66 BPM · 4/4 · 8 小节循环 · 8 分音符网格 · 无打击） */
const SONG_NIGHT: SongDef = (() => {
  const ev: SongEv[][] = Array.from({ length: 64 }, () => []);
  // 低音：A1 F2 C2 E2 各两小节（16 步全音符，慢起音）
  const bass: Array<[number, string, number]> = [[0, 'A1', 16], [16, 'F2', 16], [32, 'C2', 16], [48, 'E2', 16]];
  bass.forEach(([s, n, d]) => {
    ev[s].push({ k: 'n', f: noteFreq(n), d, wave: 'sine', vol: 0.12, atk: 0.3, rel: 0.9, gap: 0.15 });
  });
  // 旋律：稀疏长音，正弦 + 0.4s 释放营造空灵
  const mel: Array<[number, string, number]> = [
    [0, 'A3', 4], [4, 'C4', 2], [6, 'B3', 2],
    [8, 'E3', 8],
    [16, 'A3', 4], [20, 'G3', 2], [22, 'E3', 2],
    [28, 'E3', 4],
    [32, 'F3', 4], [36, 'E3', 2], [38, 'D3', 2],
    [40, 'C3', 8],
    [48, 'B2', 4], [52, 'E3', 4],
    [56, 'A2', 8],
  ];
  mel.forEach(([s, n, d]) => {
    ev[s].push({ k: 'n', f: noteFreq(n), d, wave: 'sine', vol: 0.16, atk: 0.05, rel: 0.4, vib: true });
  });
  return { stepDur: 30 / 66, steps: 64, ev };
})();

/** Title：Cmaj7→Fmaj7→Am7→G 琶音垫（每和弦 2s 琶完上行，三角波 0.12，无旋律无鼓） */
const SONG_TITLE: SongDef = (() => {
  const ev: SongEv[][] = Array.from({ length: 16 }, () => []);
  const arp: Array<[number, string]> = [
    [0, 'C4'], [1, 'E4'], [2, 'G4'], [3, 'B4'],
    [4, 'F4'], [5, 'A4'], [6, 'C5'], [7, 'E5'],
    [8, 'A3'], [9, 'C4'], [10, 'E4'], [11, 'G4'],
    [12, 'G3'], [13, 'B3'], [14, 'D4'], [15, 'G4'],
  ];
  arp.forEach(([s, n]) => {
    ev[s].push({ k: 'n', f: noteFreq(n), d: 1, wave: 'triangle', vol: 0.12, atk: 0.03, rel: 0.65 });
  });
  return { stepDur: 0.5, steps: 16, ev };
})();

const SONGS: Record<MusicScene, SongDef> = { title: SONG_TITLE, day: SONG_DAY, night: SONG_NIGHT };

/* ---------- Music 运行状态 ---------- */

let musicRunning = false;         // start() 与 stop() 之间为 true
let musicEnabled = true;          // setEnabled 总开关（与 SFX 静音联动）
let scene: MusicScene = 'title';  // 当前场景曲目
let schedTimer: ReturnType<typeof setInterval> | null = null;
let switchTimer: ReturnType<typeof setTimeout> | null = null;
let songLive = false;             // 当前歌已锚定（songStart 有效）
let switching = false;            // 切歌中：停排新音符，等 0.8s 淡出完成
let song: SongDef = SONGS.title;
let songStart = 0;                // 第 0 步的绝对时间（AudioContext 时间轴）
let nextStep = 0;                 // 下一个待排步号（绝对计数，mod steps 得循环相位）

/** BGM 总增益平滑到目标值（运行中且未静音 → MUSIC_GAIN，否则 0） */
function applyMusicGain(): void {
  const a = core;
  if (!a) return;
  const target = musicRunning && musicEnabled && !muted ? MUSIC_GAIN : 0;
  const t = a.ctx.currentTime;
  a.music.gain.cancelScheduledValues(t);
  a.music.gain.setTargetAtTime(target, t, 0.08);
}

/** 锚定当前场景的歌曲：重置步号，主增益 0.25s 淡入 */
function startSong(): void {
  const a = core;
  if (!a) return;
  song = SONGS[scene];
  songLive = true;
  const t = a.ctx.currentTime;
  songStart = t + 0.25; // 短暂起拍留白，避免淡入吞掉第一个音
  nextStep = 0;
  const g = a.music.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(Math.max(MIN_GAIN, g.value), t);
  g.linearRampToValueAtTime(musicEnabled && !muted ? MUSIC_GAIN : 0, t + 0.25);
}

/**
 * 前瞻调度器（每 100ms 轮询，提前 0.3s 排音符）：
 * 时间一律由 songStart + 步号 × 步长 推导，长播放零漂移、mod 循环无缝衔接；
 * 停排期间（切歌淡出 / 静音 / 关闭）落下的步子按整循环快进，恢复后保持小节相位续播。
 */
function schedulerTick(): void {
  const a = core;
  if (!a || a.ctx.state !== 'running') return;
  if (!musicRunning) return;
  if (!songLive) {
    startSong();
    return;
  }
  if (switching) return;
  if (!musicEnabled || muted) return;
  const now = a.ctx.currentTime;
  const sd = song.stepDur;
  const total = Math.ceil((now + SCHED_AHEAD - songStart) / sd);
  if (total - nextStep > song.steps) {
    // 落后超过一整循环：按整循环快进，保持循环内相位
    nextStep += Math.floor((total - nextStep) / song.steps) * song.steps;
  }
  while (nextStep < total) {
    const t = songStart + nextStep * sd;
    if (t > now - 0.25) fireStep(song.ev[nextStep % song.steps], Math.max(t, now + 0.005));
    nextStep++;
  }
}

/** 排一个网格步上的全部事件：音符（振荡器 + 包络 + 颤音 LFO）与噪声 tick，均汇入 music 增益 */
function fireStep(events: SongEv[], t: number): void {
  const a = core;
  if (!a) return;
  for (const e of events) {
    if (e.k === 't') {
      const src = a.ctx.createBufferSource();
      src.buffer = getNoise(a);
      const flt = a.ctx.createBiquadFilter();
      flt.type = 'highpass';
      flt.frequency.value = 6800;
      flt.Q.value = 0.8;
      const g = envGain(a, t, e.vol, 0.001, 0.004, 0.03);
      src.connect(flt);
      flt.connect(g);
      g.connect(a.music);
      src.start(t, rand(0, 0.4));
      src.stop(t + 0.06);
      continue;
    }
    const dur = e.d * song.stepDur;
    const hold = Math.max(0.015, dur - e.atk - e.rel - (e.gap ?? 0));
    const end = t + e.atk + hold + e.rel;
    const osc = a.ctx.createOscillator();
    osc.type = e.wave;
    osc.frequency.value = e.f;
    const g = envGain(a, t, e.vol, e.atk, hold, e.rel);
    osc.connect(g);
    g.connect(a.music);
    if (e.vib) {
      const lfo = a.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 4; // 4Hz 轻微颤音
      const depth = a.ctx.createGain();
      depth.gain.value = e.f * 0.0045; // ≈ ±8 音分
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(end + 0.03);
    }
    osc.start(t);
    osc.stop(end + 0.03);
  }
}

/** 启动 BGM（幂等）：确保上下文就绪并开跑调度器；歌曲锚定由调度器完成（上下文激活后自动起拍） */
function start(): void {
  musicRunning = true;
  init(); // 幂等：创建 AudioContext / music 增益（应在首次用户手势后调用）
  const a = core;
  if (a && a.ctx.state !== 'running') void a.ctx.resume().catch(() => undefined);
  if (!schedTimer) schedTimer = setInterval(schedulerTick, SCHED_MS);
}

/** 停止 BGM：清除调度器与切歌定时器，主增益平滑淡出 */
function stop(): void {
  musicRunning = false;
  songLive = false;
  switching = false;
  if (schedTimer !== null) {
    clearInterval(schedTimer);
    schedTimer = null;
  }
  if (switchTimer !== null) {
    clearTimeout(switchTimer);
    switchTimer = null;
  }
  const a = core;
  if (a) {
    const t = a.ctx.currentTime;
    a.music.gain.cancelScheduledValues(t);
    a.music.gain.setTargetAtTime(0, t, 0.2);
  }
}

/** 切歌：停排新音符 + 旧歌主增益 0.8s 淡出，淡出完成后锚定新歌淡入（连点自动合并） */
function setScene(s: MusicScene): void {
  if (s === scene) return;
  scene = s;
  const a = core;
  if (!a || !musicRunning || !songLive || a.ctx.state !== 'running') return; // 未在播：仅记录，start 后生效
  const t = a.ctx.currentTime;
  switching = true;
  if (switchTimer !== null) clearTimeout(switchTimer);
  const g = a.music.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(Math.max(MIN_GAIN, g.value), t);
  g.linearRampToValueAtTime(MIN_GAIN, t + SCENE_FADE);
  switchTimer = setTimeout(() => {
    switchTimer = null;
    switching = false;
    if (musicRunning) startSong();
  }, (SCENE_FADE + 0.03) * 1000);
}

/** BGM 总开关：关闭即停（停排 + 增益归零），重新打开后从循环相位续播 */
function setEnabled(on: boolean): void {
  if (musicEnabled === on) return;
  musicEnabled = on;
  applyMusicGain();
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
  bowShoot,
  arrowHit,
  bombThrow,
  explosion,
  doorOpen,
  doorClose,
  chestOpen,
  crystal,
  bossRoar,
  bossHit,
  bossDie,
  guideTalk,
  plant,
  altar,
};

export const Music: MusicModule = {
  start,
  stop,
  setScene,
  setEnabled,
};
