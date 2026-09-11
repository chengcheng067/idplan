import { useCallback, useSyncExternalStore } from 'react';

import { installTitleBarThemeSync, syncTitleBarTheme } from '../lib/titleBarTheme';

/**
 * 双主题（亮 / 暗）状态源。
 *
 * 设计要点：
 *   1) **首屏不闪**：index.html 里有一段同步内联脚本先按 localStorage / 系统偏好写好
 *      <html data-theme>，本模块只负责接管后续变更，不作为首屏唯一依据。
 *   2) **优先级**：用户显式选择（localStorage）> 系统偏好（prefers-color-scheme）。
 *      用户没选过时，跟随系统实时变化；一旦手动切换过，就以用户选择为准。
 *   3) **持久化降级**：localStorage 不可用（隐私模式 / 禁用 storage）时静默降级为
 *      「仅当前会话生效」，不抛错、不影响渲染。
 *   4) 颜色值本身不在这里，全部住在 src/styles/global.css 的 CSS 变量里；
 *      这里只切换 <html data-theme>，整站自动换肤。
 */

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'idplan-theme';

/** 是否已显式选择（light/dark）；'system' 不落库，故「未选 = system」 */
function isExplicit(v: string | null): v is 'light' | 'dark' {
  return v === 'light' || v === 'dark';
}

/** 读取用户显式选择；无则返回 null（表示「跟随系统」） */
function readStoredTheme(): 'light' | 'dark' | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isExplicit(v) ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 当前应当生效的主题（解析 'system' 为实际亮/暗） */
function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? systemTheme() : mode;
}

/** 选择模式：light / dark / system（localStorage 不存在即 system） */
function storedMode(): ThemeMode {
  return readStoredTheme() ?? 'system';
}

// —— 极小的外部 store：让任意多个组件共享同一份主题状态 ——
// mode 是用户选择（含 system）；current 是该选择解析出的实际主题（light/dark），
// 用于 <html data-theme> 与 useSyncExternalStore 快照（系统切换时 current 变、mode 不变）。
let mode: ThemeMode = storedMode();
let current: 'light' | 'dark' = resolveTheme(mode);
const listeners = new Set<() => void>();

function apply(next: ThemeMode): void {
  mode = next;
  current = resolveTheme(mode);
  document.documentElement.dataset.theme = current;
  // 主题已落 DOM → 立刻同步原生标题栏叠加层配色（内部读 CSS 变量实际值，
  // getComputedStyle 会强制同步样式重算，故此处能拿到新主题的颜色）。
  // 非桌面端短路，浏览器 / NAS 端无副作用。
  syncTitleBarTheme();
  try {
    if (next === 'system') {
      // 删除显式键：让 resolveTheme() 自然回退到 systemTheme()
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, next);
    }
  } catch {
    /* 存储不可用：仅当前会话生效，忽略 */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): 'light' | 'dark' {
  return current;
}

function getServerSnapshot(): 'light' | 'dark' {
  return 'light';
}

/**
 * 在 main.tsx 渲染前调用一次：同步 DOM 上的 data-theme，并挂上系统偏好监听。
 * 与 index.html 的内联脚本互补——内联脚本防首屏闪白，这里负责运行期响应。
 */
export function initTheme(): void {
  document.documentElement.dataset.theme = resolveTheme(storedMode());
  // 首屏也要同步一次原生标题栏配色：index.html 的内联脚本虽已写好 data-theme，
  // 但叠加层颜色是主进程持有的状态，不通知就仍是 main.cjs 的亮色兜底值——
  // 暗色启动时会出现「顶栏暗、三键区亮」的割裂（正是本项要修的现象）。
  syncTitleBarTheme();
  // 视口宽度跨 xl（1280）时顶栏高度 56↔64 变化，需重发高度给主进程
  installTitleBarThemeSync();

  if (typeof window.matchMedia !== 'function') return;
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    // 仅当用户未显式选过主题（= system）时跟随系统；显式选了就保持
    if (readStoredTheme() !== null) return;
    current = e.matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = current;
    // 「跟随系统」路径同样要通知主进程，否则系统切暗色时原生栏不跟随
    syncTitleBarTheme();
    listeners.forEach((l) => l());
  });
}

export interface UseThemeResult {
  /** 实际生效主题（light/dark，已解析 system） */
  theme: 'light' | 'dark';
  /** 用户选择：light / dark / system */
  mode: ThemeMode;
  /** 在亮 / 暗之间切换（显式选择） */
  toggleTheme(): void;
  /** 直接设定（显式 light/dark） */
  setTheme(mode: ThemeMode): void;
  /** 设定选择，含 'system'（删除 localStorage 键回退系统） */
  setMode(mode: ThemeMode): void;
}

export function useTheme(): UseThemeResult {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggleTheme = useCallback(() => {
    apply(current === 'dark' ? 'light' : 'dark');
  }, []);
  const setTheme = useCallback((m: ThemeMode) => {
    apply(m);
  }, []);
  const setMode = useCallback((m: ThemeMode) => {
    apply(m);
  }, []);
  return { theme, mode, toggleTheme, setTheme, setMode };
}
