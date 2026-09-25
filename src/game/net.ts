/**
 * 联机客户端 — socket.io 连接 3010 端口 mini-service(mp-server)
 *
 * 同步模型(与 Task 15-a 服务端协议一一对应):
 *   join{name,room} → welcome{id,seed,edits,roster} → 用 seed 生成确定性世界 + 回放 edits
 *   state 12Hz 广播玩家姿态 → pstate{id,s} → 远端玩家插值渲染
 *   tile{x,y,id} 方块编辑(玩家挖掘/放置; 液体模拟不同步) → 双向 last-write-wins
 *   chat{text} → 聊天
 *
 * 引擎集成点:
 *   - engine.onTileChanged → net.queueTile(跳过液体/远程回放)
 *   - engine.tick → net.sendState(12Hz) + net.tickInterp(插值)
 *   - render.ts → 画 net.remotes 远端玩家(复用 drawImgPlayer + 名牌 + 手持物)
 *   - store.ts → mpOnline/mpRoom/mpCount 供 HUD 徽章
 */

import { io, type Socket } from 'socket.io-client';

export interface RemotePlayer {
  id: string;
  name: string;
  /** 插值后的身体坐标(x=中心, y=底部, 世界px) */
  x: number;
  y: number;
  /** 最新目标坐标(来自 pstate) */
  tx: number;
  ty: number;
  dir: number;
  frame: number;
  walkT: number;
  onGround: boolean;
  hp: number;
  maxHp: number;
  held: number;
  swingT: number;
  armorH: number;
  armorB: number;
  armorL: number;
  lastSeen: number;
}

export interface NetChatLine {
  id: string;
  name: string;
  text: string;
}

type WelcomeFn = (seed: number, edits: Array<[number, number, number]>, roster: Array<{ id: string; name: string }>) => void;

const REMOTE_TIMEOUT_MS = 8000;   // 超时未收到 state 的远端玩家剔除

class NetClient {
  socket: Socket | null = null;
  online = false;
  room = '';
  myName = '';
  myId = '';
  seed: number | null = null;
  remotes = new Map<string, RemotePlayer>();
  chatLog: NetChatLine[] = [];
  /** 方块编辑批次(200ms 冲刷, 同格去重) */
  private tileQueue = new Map<number, number>();
  private tileFlushAt = 0;
  private lastStateAt = 0;
  private onWelcome: WelcomeFn | null = null;
  /** 远程编辑应用回调(engine 设置: 直接 world.set, 不回广播) */
  applyRemoteTile: ((x: number, y: number, id: number) => void) | null = null;
  /** 聊天/进出消息回调(engine 设置: 走 msg 提示) */
  onChat: ((name: string, text: string) => void) | null = null;
  onPlayerJoin: ((name: string) => void) | null = null;
  onPlayerLeave: ((name: string) => void) | null = null;
  onStatusChange: (() => void) | null = null;

  connect(name: string, room: string, welcome: WelcomeFn): void {
    this.disconnect();
    this.myName = name;
    this.room = room;
    this.onWelcome = welcome;
    this.online = false;
    // Caddy 网关: 路径恒为 '/', 端口写进 XTransformPort 查询参数
    const sock = io('/?XTransformPort=3010', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 8000,
    });
    this.socket = sock;
    sock.on('connect', () => {
      this.myId = sock.id ?? '';
      sock.emit('join', { name, room });
    });
    sock.on('disconnect', () => {
      if (this.online) { this.online = false; this.remotes.clear(); this.onStatusChange?.(); }
    });
    sock.on('connect_error', () => {
      if (this.online) { this.online = false; this.onStatusChange?.(); }
    });
    sock.on('welcome', (w: { id: string; seed: number; edits: Array<[number, number, number]>; roster: Array<{ id: string; name: string }> }) => {
      this.myId = w.id;
      this.seed = w.seed;
      this.online = true;
      this.remotes.clear();
      for (const r of w.roster) this.upsertRemote(r.id, r.name);
      this.onWelcome?.(w.seed, w.edits, w.roster);
      this.onStatusChange?.();
    });
    sock.on('pjoin', (d: { id: string; name: string }) => {
      this.upsertRemote(d.id, d.name);
      this.onPlayerJoin?.(d.name);
      this.onStatusChange?.();
    });
    sock.on('pleave', (d: { id: string }) => {
      const r = this.remotes.get(d.id);
      if (r) this.onPlayerLeave?.(r.name);
      this.remotes.delete(d.id);
      this.onStatusChange?.();
    });
    sock.on('pstate', (d: { id: string; s: Record<string, unknown> }) => {
      const r = this.remotes.get(d.id);
      if (!r) return;
      r.tx = Number(d.s.x) || r.tx;
      r.ty = Number(d.s.y) || r.ty;
      r.dir = Number(d.s.dir) || r.dir;
      r.frame = Number(d.s.frame) || 0;
      r.walkT = Number(d.s.walkT) || 0;
      r.onGround = !!d.s.onGround;
      r.hp = Number(d.s.hp) || r.hp;
      r.maxHp = Number(d.s.maxHp) || r.maxHp;
      r.held = Number(d.s.held) || 0;
      r.swingT = Number(d.s.swingT) || 0;
      r.armorH = Number(d.s.armorH) || 0;
      r.armorB = Number(d.s.armorB) || 0;
      r.armorL = Number(d.s.armorL) || 0;
      r.lastSeen = performance.now();
      // 首包直接吸附, 避免出生瞬移长滑
      if (r.x === 0 && r.y === 0) { r.x = r.tx; r.y = r.ty; }
    });
    sock.on('tile', (d: { id: string; x: number; y: number; tile: number }) => {
      if (d.id === this.myId) return;   // 自己的回显(服务器不回发, 保险)
      this.applyRemoteTile?.(d.x, d.y, d.tile);
    });
    sock.on('chat', (d: { id: string; name: string; text: string }) => {
      this.chatLog.push({ id: d.id, name: d.name, text: d.text });
      if (this.chatLog.length > 60) this.chatLog.shift();
      this.onChat?.(d.name, d.text);
    });
  }

  private upsertRemote(id: string, name: string): void {
    if (id === this.myId) return;
    if (!this.remotes.has(id)) {
      this.remotes.set(id, {
        id, name, x: 0, y: 0, tx: 0, ty: 0, dir: 1, frame: 0, walkT: 0,
        onGround: true, hp: 100, maxHp: 100, held: 0, swingT: 0,
        armorH: 0, armorB: 0, armorL: 0, lastSeen: performance.now(),
      });
    } else {
      const r = this.remotes.get(id)!;
      r.name = name;
      r.lastSeen = performance.now();
    }
  }

  /** 玩家状态广播(引擎 tick 调用, 内部限 12Hz) */
  sendState(p: {
    x: number; y: number; dir: number; frame: number; walkT: number; onGround: boolean;
    hp: number; maxHp: number; held: number; swingT: number;
    armorH: number; armorB: number; armorL: number;
  }): void {
    const s = this.socket;
    if (!s || !this.online) return;
    const now = performance.now();
    if (now - this.lastStateAt < 80) return;
    this.lastStateAt = now;
    s.emit('state', p);
  }

  /** 方块编辑入队(onTileChanged 调用; 液体由本地模拟, 不广播) */
  queueTile(x: number, y: number, id: number, isLiquid: boolean): void {
    const s = this.socket;
    if (!s || !this.online || isLiquid) return;
    this.tileQueue.set(y * 1e5 + x, id);
  }

  /** 每 tick 冲刷方块编辑批次(200ms) */
  flushTiles(): void {
    const s = this.socket;
    if (!s || !this.online || this.tileQueue.size === 0) return;
    const now = performance.now();
    if (now < this.tileFlushAt) return;
    this.tileFlushAt = now + 200;
    for (const [k, id] of this.tileQueue) {
      s.emit('tile', { x: k % 1e5, y: Math.floor(k / 1e5), id });
    }
    this.tileQueue.clear();
  }

  sendChat(text: string): void {
    const s = this.socket;
    if (!s || !this.online) {
      // 单机/离线: 本地回显(进入世界后 onChat 已接线 → 消息栏可见)
      this.chatLog.push({ id: 'local', name: this.myName, text });
      if (this.chatLog.length > 60) this.chatLog.shift();
      this.onChat?.(this.myName, text);
      return;
    }
    s.emit('chat', { text });
    // 自己的消息直接入本地记录(服务器不回显)
    this.chatLog.push({ id: this.myId, name: this.myName, text });
    if (this.chatLog.length > 60) this.chatLog.shift();
  }

  /** 远端玩家位置插值(lerp 0.18) + 超时剔除(引擎每 tick 调用) */
  tickInterp(): void {
    if (this.remotes.size === 0) return;
    const now = performance.now();
    for (const [id, r] of this.remotes) {
      if (now - r.lastSeen > REMOTE_TIMEOUT_MS) {
        this.remotes.delete(id);
        this.onStatusChange?.();
        continue;
      }
      r.x += (r.tx - r.x) * 0.18;
      r.y += (r.ty - r.y) * 0.18;
    }
  }

  disconnect(): void {
    if (this.socket) {
      try { this.socket.disconnect(); } catch { /* 忽略 */ }
      this.socket = null;
    }
    if (this.online) {
      this.online = false;
      this.remotes.clear();
      this.onStatusChange?.();
    }
    this.tileQueue.clear();
    this.chatLog = [];
    this.seed = null;
  }
}

export const net = new NetClient();
