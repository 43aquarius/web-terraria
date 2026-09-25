/**
 * mp-server — 泰拉瑞亚 Web 复刻 · 联机服务（Bun + socket.io，端口 3010 写死）
 *
 * 纯后端 mini-service：为 2D 沙盒游戏提供房间内多人状态同步 / 方块编辑同步 / 聊天。
 *
 * 协议（与客户端约定，字段名务必完全一致）：
 *  C→S join   { name: string, room: string }
 *       - name 1-16 字符（trim 后校验，非法则忽略本次 join）
 *       - room 房间码 1-24 字符，缺省/非法回落 "lobby"；房间不存在则创建
 *       - 房间种子 seed = FNV-1a 32 位（取无符号正整数），同房间所有人一致
 *  C→S state  { x, y, dir, frame, walkT, onGround, hp, maxHp, held, swingT, armorH, armorB, armorL }
 *       - 约 12Hz 一次，字段原样转发给同房间其他玩家，不做插值/缓存
 *  C→S tile   { x: number, y: number, id: number }
 *       - 方块编辑；校验 x/y/id 均为有限数且 >= 0，合法才记日志并转发
 *  C→S chat   { text: string } — 截断 200 字符，广播给同房间其他人（不回显自己）
 *
 *  S→C welcome { id, seed, edits: [x,y,tile][], roster: {id,name}[] } — 加入成功
 *  S→C pjoin   { id, name }   — 有人加入（发给房间内其他人）
 *  S→C pleave  { id }          — 有人离开
 *  S→C pstate  { id, s }       — 某玩家状态（s 为 state 原样对象）
 *  S→C tile    { id, x, y, tile } — 方块编辑（id = 发送者 socket.id）
 *  S→C chat    { id, name, text }
 */
import { createServer } from 'http'
import { Server } from 'socket.io'

const PORT = 3010
const MAX_EDITS = 30000 // 房间历史方块编辑日志上限，超出丢最旧
const MAX_CHAT = 200
const MAX_NAME = 16
const MAX_ROOM = 24

// ---------- 房间数据 ----------

interface PlayerInfo {
  name: string
}

interface Room {
  seed: number
  edits: Array<[number, number, number]> // 按时间序 [x, y, tileId]
  players: Map<string, PlayerInfo> // socketId -> 玩家
}

const rooms = new Map<string, Room>()

/** 每个连接的当前状态（所在房间 + 昵称） */
interface Conn {
  room: string | null
  name: string | null
}
const conns = new Map<string, Conn>()

/** FNV-1a 32 位字符串哈希 → 无符号正整数（房间种子） */
function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function createRoom(code: string): Room {
  const room: Room = { seed: fnv1a(code), edits: [], players: new Map() }
  rooms.set(code, room)
  console.log(`[mp] room created "${code}" seed=${room.seed}`)
  return room
}

// ---------- socket.io 服务 ----------

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.on('connection', (socket) => {
  console.log(`[mp] connect ${socket.id}`)
  conns.set(socket.id, { room: null, name: null })

  const conn = (): Conn => conns.get(socket.id)!

  /** 当前所在房间（未 join 返回 null） */
  const currentRoom = (): { code: string; room: Room } | null => {
    const c = conn()
    if (!c.room) return null
    const room = rooms.get(c.room)
    return room ? { code: c.room, room } : null
  }

  /** 离开当前房间：广播 pleave；最后一人离开时删除房间数据（重复 join / 断开共用） */
  const leaveRoom = (): void => {
    const c = conn()
    if (!c.room) return
    const code = c.room
    const room = rooms.get(code)
    if (room) {
      room.players.delete(socket.id)
      socket.to(code).emit('pleave', { id: socket.id })
      if (room.players.size === 0) {
        rooms.delete(code)
        console.log(`[mp] room "${code}" empty -> cleaned up`)
      }
    }
    socket.leave(code)
    console.log(`[mp] leave ${c.name ?? socket.id} room "${code}"`)
    c.room = null
    c.name = null
  }

  socket.on('join', (data: unknown) => {
    const d = (data ?? {}) as { name?: unknown; room?: unknown }
    const name = typeof d.name === 'string' ? d.name.trim() : ''
    if (name.length < 1 || name.length > MAX_NAME) {
      console.log(`[mp] join rejected from ${socket.id}: bad name`)
      return
    }
    const raw = typeof d.room === 'string' ? d.room.trim() : ''
    const code = raw.length >= 1 && raw.length <= MAX_ROOM ? raw : 'lobby'

    leaveRoom() // 同一 socket 重复 join：先离开旧房间再加入

    const room = rooms.get(code) ?? createRoom(code)
    room.players.set(socket.id, { name })
    socket.join(code)
    conn().room = code
    conn().name = name

    // welcome：自己的 socket.id / 房间种子 / 历史方块编辑日志 / 当前房间其他玩家名单
    const roster = Array.from(room.players.entries())
      .filter(([id]) => id !== socket.id)
      .map(([id, p]) => ({ id, name: p.name }))
    socket.emit('welcome', {
      id: socket.id,
      seed: room.seed,
      edits: room.edits.slice(),
      roster,
    })
    socket.to(code).emit('pjoin', { id: socket.id, name })
    console.log(`[mp] join ${name} -> "${code}" (${room.players.size} players)`)
  })

  // 玩家状态原样转发（约 12Hz；不打日志避免刷屏）
  socket.on('state', (s: unknown) => {
    const cur = currentRoom()
    if (!cur || typeof s !== 'object' || s === null) return
    socket.to(cur.code).emit('pstate', { id: socket.id, s })
  })

  socket.on('tile', (data: unknown) => {
    const cur = currentRoom()
    if (!cur) return
    const d = (data ?? {}) as { x?: unknown; y?: unknown; id?: unknown }
    const { x, y, id } = d
    if (typeof x !== 'number' || typeof y !== 'number' || typeof id !== 'number') return
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(id)) return
    if (x < 0 || y < 0 || id < 0) return
    cur.room.edits.push([x, y, id])
    if (cur.room.edits.length > MAX_EDITS) {
      cur.room.edits.splice(0, cur.room.edits.length - MAX_EDITS)
    }
    socket.to(cur.code).emit('tile', { id: socket.id, x, y, tile: id })
  })

  socket.on('chat', (data: unknown) => {
    const cur = currentRoom()
    if (!cur) return
    const d = (data ?? {}) as { text?: unknown }
    const text = typeof d.text === 'string' ? d.text.slice(0, MAX_CHAT) : ''
    if (text.length === 0) return
    socket.to(cur.code).emit('chat', { id: socket.id, name: conn().name ?? '', text })
  })

  socket.on('disconnect', () => {
    console.log(`[mp] disconnect ${socket.id}`)
    leaveRoom()
    conns.delete(socket.id)
  })
})

httpServer.listen(PORT, () => {
  console.log(`[mp] mp-server listening on http://localhost:${PORT} (socket.io path '/', rooms on demand)`)
})

// ---------- Graceful shutdown ----------

const shutdown = (sig: string): void => {
  console.log(`[mp] ${sig} received, shutting down mp-server...`)
  setTimeout(() => process.exit(0), 2000) // 兜底：连接未及时断开也强制退出
  io.close(() => {
    console.log('[mp] mp-server closed')
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
