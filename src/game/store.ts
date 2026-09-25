/**
 * 引擎 -> React 的 UI 状态桥
 * 引擎在状态变化时调用 ui.set()，React 用 useSyncExternalStore 订阅
 */

export interface Slot { id: number; count: number }
export interface UIMessage { id: number; text: string; color: string; born: number }
export interface UICraftable { index: number; out: number; count: number; can: boolean }
export interface UIArmor { head: Slot | null; body: Slot | null; legs: Slot | null }
export interface UIBoss { name: string; hp: number; maxHp: number }

export interface UIState {
  screen: 'title' | 'playing' | 'dead';
  paused: boolean;
  invOpen: boolean;
  loading: boolean;
  loadingText: string;
  hp: number;
  maxHp: number;
  defense: number;                  // 玩家总防御
  breath: number | null;           // 0-1，null=未潜水
  slots: (Slot | null)[];          // 40 格背包(0-9 为快捷栏)
  armor: UIArmor;                  // 盔甲三槽
  hotbar: number;
  cursorItem: Slot | null;
  messages: UIMessage[];
  stations: { workbench: boolean; furnace: boolean; anvil: boolean; altar: boolean };
  craftables: UICraftable[];
  hasSave: boolean;
  muted: boolean;
  seed: string;
  depth: number;                   // 玩家当前深度(米，地表为0)
  isNight: boolean;
  // ---- 宝箱 ----
  chestOpen: boolean;
  chestSlots: (Slot | null)[];
  // ---- Boss ----
  boss: UIBoss | null;
  // ---- 全屏地图 / 智能光标 / 开发模式 ----
  mapOpen: boolean;
  smart: boolean;
  devMode: boolean;
  playerName: string;
  biomeName: string;               // 当前群系名
  // ---- 联机(15-b) ----
  chatOpen: boolean;               // 聊天输入框打开
  mpOnline: boolean;               // 联机中
  mpRoom: string;                  // 房间码
  mpCount: number;                 // 在线人数(含自己)
}

type Listener = () => void;

const initial: UIState = {
  screen: 'title',
  paused: false,
  invOpen: false,
  loading: false,
  loadingText: '',
  hp: 100,
  maxHp: 100,
  defense: 0,
  breath: null,
  slots: new Array(40).fill(null),
  armor: { head: null, body: null, legs: null },
  hotbar: 0,
  cursorItem: null,
  messages: [],
  stations: { workbench: false, furnace: false, anvil: false, altar: false },
  craftables: [],
  hasSave: false,
  muted: false,
  seed: '',
  depth: 0,
  isNight: false,
  chestOpen: false,
  chestSlots: new Array(20).fill(null),
  boss: null,
  mapOpen: false,
  smart: false,
  devMode: false,
  playerName: '泰拉行者',
  biomeName: '森林',
  chatOpen: false,
  mpOnline: false,
  mpRoom: '',
  mpCount: 0,
};

class UIStore {
  private state: UIState = initial;
  private listeners = new Set<Listener>();

  getSnapshot = (): UIState => this.state;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };

  set = (partial: Partial<UIState>): void => {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((l) => l());
  };

  reset = (): void => { this.state = { ...initial }; this.listeners.forEach((l) => l()); };
}

export const ui = new UIStore();
