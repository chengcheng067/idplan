import { BUILD_VERSION } from '../../constants/version';

/**
 * 前端日志服务（统一日志记录 + 导出）。
 *
 * 背景：NAS/后端容器日志不记录前端事件——"输入法能敲但输入框不显示"这类 bug
 * 发生在浏览器内，服务器端无从知晓。为让客户与自研调试都能快速定位问题，
 * 在应用内内置日志：把运行时错误、未捕获异常、关键用户事件一并记入本地，
 * 设置界面提供「导出日志」一键下载，附带时间戳、类型、来源、消息与堆栈。
 *
 * 设计：
 *   - 持久化：localStorage（键名 ID_PLAN_LOG），容量上限 MAX_ENTRIES，超出丢弃最旧。
 *   - 记录类型 LOG_TYPES：error（运行时/未捕获异常）、warn、info（关键用户事件）、user（业务动作）。
 *   - write() 供业务埋点与全局钩子调用；error() 是 write('error') 的便捷封装。
 *   - dump() 取全部（倒序或正序，按需）；clear() 清空；exportLogs() 触发浏览器下载 .log。
 *   - 导出文件名 id-plan-log-<ts>.log，内容为 JSON 数组（含 app/version/exportedAt 元信息），
 *     与 backup.service 的 downloadBackup 同款 Blob 下载模式。
 *
 * 注意：这是浏览器端本地日志，仅存设备本地（localStorage），不会上传服务器，
 * 因此不含任何隐私泄漏风险；导出后由用户自行决定是否传给开发。
 */

export type LogType = 'error' | 'warn' | 'info' | 'user';

export interface LogEntry {
  /** 单调递增序号，便于稳定去重/排序 */
  seq: number;
  /** ISO 时间戳 */
  ts: string;
  /** 记录类型 */
  type: LogType;
  /** 来源（模块/组件/事件名），供快速定位 */
  source: string;
  /** 人类可读消息 */
  message: string;
  /** 可选错误堆栈 */
  stack?: string;
}

/** 导出包元信息 + 全部日志 */
export interface LogExport {
  app: string;
  version: string;
  exportedAt: string;
  /** 渠道：local=浏览器本地；remote=未启用预留 */
  channel: 'local' | 'remote';
  entries: LogEntry[];
}

const STORAGE_KEY = 'ID_PLAN_LOG';
const MAX_ENTRIES = 500;
let seq = 0;
/** 内存缓存，避免每次 read 都 parse（写入仍写 localStorage 以持久化） */
let cache: LogEntry[] | null = null;
/** localStorage 是否存在（node 测试环境无 window，回落纯内存） */
const hasStorage =
  typeof window !== 'undefined' && !!window.localStorage;

function todayTs(): string {
  return new Date().toISOString();
}

/** 读取本地日志（首次从 localStorage 装载，同时恢复 seq 计数器） */
function readEntries(): LogEntry[] {
  if (cache) return cache;
  if (hasStorage) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr: LogEntry[] = JSON.parse(raw) as LogEntry[];
        if (Array.isArray(arr) && arr.length > 0) {
          cache = arr;
          seq = Math.max(seq, ...arr.map((e) => e.seq ?? 0));
          return cache;
        }
      }
    } catch {
      /* 解析失败或隐私模式禁用 localStorage 时回落为空 */
    }
  }
  cache = [];
  return cache;
}

function persist(entries: LogEntry[]): void {
  cache = entries;
  if (hasStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      /* 配额满/隐私模式，忽略——日志仅尽力持久化 */
    }
  }
}

/** 追加一条日志（自动裁剪到容量上限） */
export function write(entry: Omit<LogEntry, 'seq' | 'ts'>): LogEntry {
  const entries = readEntries();
  const full: LogEntry = { seq: ++seq, ts: todayTs(), ...entry };
  entries.push(full);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  persist(entries);
  return full;
}

/** 便捷封装：记录错误（含可选堆栈） */
export function logError(source: string, message: string, error?: unknown): LogEntry {
  const stack =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.stack ?? error.message
        : undefined;
  return write({ type: 'error', source, message, stack });
}

/** 便捷封装：记录警告 */
export function logWarn(source: string, message: string): LogEntry {
  return write({ type: 'warn', source, message });
}

/** 便捷封装：记录关键用户事件（info） */
export function logInfo(source: string, message: string): LogEntry {
  return write({ type: 'info', source, message });
}

/** 便捷封装：记录业务动作（user，如备份导入导出） */
export function logUser(source: string, message: string): LogEntry {
  return write({ type: 'user', source, message });
}

/** 取全部日志（可按类型过滤，不传即全部）；供导出前检查包体 */
export function dump(filterType?: LogType): LogEntry[] {
  const entries = readEntries();
  return filterType ? entries.filter((e) => e.type === filterType) : [...entries];
}

/** 清空日志 */
export function clearLogs(): void {
  persist([]);
}

/** 日志导出文件名（用户可见物，与 backupFileName 同风格） */
export function logExportFileName(now: Date = new Date()): string {
  const ts = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `id-plan-log-${ts}.log`;
}

/** 组装导出包（含元信息），供测试与导出共用 */
export function buildLogExport(now: Date = new Date(), channel: 'local' | 'remote' = 'local'): LogExport {
  return {
    app: 'ID Plan',
    version: BUILD_VERSION,
    exportedAt: now.toISOString(),
    channel,
    entries: dump(),
  };
}

/** 导出日志：Blob 下载 .log 文件（与 downloadBackup 同款模式） */
export function exportLogs(now: Date = new Date()): void {
  const pkg = buildLogExport(now);
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = logExportFileName(now);
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // ★ 与 downloadBackup 同款：revoke 必须让出一拍（同步 revoke 与下载启动存在竞态，详见那里注释）
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * 全局错误捕获：挂载 window.onerror + unhandledrejection + console.error/console.warn，
 * 把运行时异常自动写入日志。在应用装载处调用一次即可。
 * 返回 detach 函数（供测试清理）。
 */
export function installGlobalLogCatchers(): () => void {
  const prevOnError = window.onerror;

  window.onerror = (message, source, line, column, error): boolean => {
    logError(
      'window.onerror',
      `${String(message)} @ ${source ?? ''}:${line}:${column}`,
      error,
    );
    // 保持默认行为（不吞），仅追加记录
    prevOnError?.call(window, message, source, line, column, error);
    return false;
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    logError('unhandledrejection', String(event.reason), event.reason);
  };
  window.addEventListener('unhandledrejection', onRejection);

  const origError = console.error;
  const origWarn = console.warn;
  // 拦截 console.error / console.warn，避免业务代码遗漏的错误逃逸日志之外
  console.error = (...args: unknown[]): void => {
    const msg = args
      .map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    logError('console.error', msg);
    origError.apply(console, args);
  };
  console.warn = (...args: unknown[]): void => {
    const msg = args
      .map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    logWarn('console.warn', msg);
    origWarn.apply(console, args);
  };

  const detach = (): void => {
    window.onerror = prevOnError;
    window.removeEventListener('unhandledrejection', onRejection);
    console.error = origError;
    console.warn = origWarn;
  };

  return detach;
}
