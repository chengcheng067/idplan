/**
 * 插件「从文件安装」· 沙箱 iframe 容器（L2 · v0.8.6）
 *
 * ══════════════════════ 这个文件是全仓安全红线最密集的地方 ══════════════════════
 *
 * v1 唯一加载形态 = **沙箱 iframe**，`sandbox` 只给 `allow-scripts`，
 * **永远不写 allow-same-origin**。这不是风格选择，是实测判决：
 *   · 同世界 IIFE 能直接 `indexedDB.open` 读到宿主私有数据（探针实测拿到含
 *     passwordHashLike 的数据）⇒「只读快照 API」在同世界下形同虚设；
 *   · 沙箱 iframe 里 parent DOM / window.idplan / localStorage / IndexedDB
 *     五项全部 SecurityError；一旦加上 allow-same-origin，Chromium 自己都警告
 *     "can escape its sandboxing"。
 * `sandbox` 属性字符串由 tests/plugin-install-sandbox.spec.ts 静态钉死
 * （读本文件源码断言），任何人想加 allow-same-origin 会当场红。
 *
 * ── 两种加载形态（manifest.entry 决定，作者产物形态自选）──
 *   · entry 以 .html 结尾：`<iframe src="plug://<id>/<entry>">`——插件是整页，
 *     自带 HTML/CSS，自己实现 postMessage 收快照（契约见 docs/plugin-api/install.md）；
 *   · entry 以 .js/.mjs 结尾：宿主把入口 script 注入**同款沙箱 iframe**（srcdoc
 *     bootstrap），并代宿主调 `window.IDPlanPlugin.mount(api)`——单文件 IIFE 产物。
 *     iframe 由本文件**命令式创建**（不走 React JSX）：卸载句柄、ack 等待、
 *     超时兜底都需要对生命周期的完全控制，JSX 渲染摘除的时序不够。
 *
 * ★ 为什么宿主容器（下面的宿主 div）**常驻不卸载**——
 * 停用必须「先请插件 unmount、再摘 iframe」。第一版把整个组件做成条件渲染，
 * 真机实测抓到：**React 卸组件时先摘 DOM、后跑 effect cleanup**（拆除时序实测：
 * iframe 消失比 cleanup 里的 removeNow 早 608ms）——cleanup 里 `contentWindow`
 * 已是 null，unmount 消息根本发不出去，插件以为用户没停，定时器苟到 iframe 被
 * 系统回收。「停用即真停」当场假成立。故宿主 div 常驻（停用仅隐藏），iframe 的
 * 创建/摘除完全由 effect 依赖（启用插件 id）驱动，握手时序才在宿主手里。
 *
 * ── 数据通道 ──
 * 宿主每次数据变化（或插件报到 ready）时，把**每次现算 + 深拷贝**的快照
 * （projects/stages/tasks/version/theme）postMessage 推进 iframe；插件不得轮询。
 * 停用 = 先请插件 unmount（清定时器/DOM），收到回执（或 600ms 兜底）后摘除 iframe。
 *
 * v1 未做 CSP 切片 ⇒ 插件运行时**可以发网络请求**。这件事在启用前的告知里
 * 诚实写明（PluginsSection 的披露对话框），文档同样不隐瞒。
 */

import { useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react';
import { Puzzle } from 'lucide-react';

import { usePluginRegistry } from './PluginRegistryProvider';
import type { PluginManifest } from './types';
import {
  PLUGIN_MSG,
  PLUGIN_MSG_VERSION,
  isHtmlEntry,
  pluginEntryUrl,
} from './installed';
import type { PluginMountApi, PluginSnapshot } from './installed';
import { useHumanProjects, useHumanStages, useHumanTasks } from '../../core/project/visibility';
import { useTheme } from '../../hooks/useTheme';
import { BUILD_VERSION } from '../../constants/version';
import { cn } from '../../lib/cn';

/** 停用时等 unmount 回执的上限（超时就摘——插件卡死不该拖住宿主） */
const UNMOUNT_ACK_TIMEOUT_MS = 600;
/** IIFE 注入后等 ready 的上限（超时 = 加载失败，展示错误而不是白框架） */
const READY_TIMEOUT_MS = 3000;

/**
 * IIFE 形态的 bootstrap（宿主注入沙箱 iframe 的胶水代码）。
 *
 * 职责：加载插件产物 script ⇒ 等它挂出 `window.IDPlanPlugin` ⇒ 用 postMessage
 * 代理层构造 api（快照由宿主推进来，插件拿不到任何宿主对象引用）⇒ 调
 * `mount(api)` 拿 unmount 句柄 ⇒ 转发卸载请求与回执。插件代码本身在沙箱里，
 * 这段胶水是宿主对插件的**唯一**接触面。
 */
function buildRunnerSrcdoc(pluginId: string, entry: string): string {
  const src = pluginEntryUrl(pluginId, entry).replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${pluginId}</title>
<script src="${src}"></script></head>
<body><script>
(function () {
  var MSG = ${JSON.stringify(PLUGIN_MSG)};
  var V = ${PLUGIN_MSG_VERSION};
  var snapshot = null;
  var listeners = [];
  var handle = null;
  function post(msg) { try { parent.postMessage(msg, '*'); } catch (e) {} }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || d.v !== V) return;
    if (d.type === MSG.snapshot) {
      snapshot = d.snapshot;
      var ls = listeners.slice();
      for (var i = 0; i < ls.length; i++) { try { ls[i](snapshot); } catch (err) {} }
    } else if (d.type === MSG.unmount) {
      try { if (handle && typeof handle.unmount === 'function') handle.unmount(); } catch (err) {}
      post({ v: V, type: MSG.unmountAck });
    }
  });
  var api = {
    get version() { return snapshot ? snapshot.version : ''; },
    get theme() { return snapshot ? snapshot.theme : 'light'; },
    getProjects: function () { return snapshot ? snapshot.projects : []; },
    getStages: function () { return snapshot ? snapshot.stages : []; },
    getTasks: function () { return snapshot ? snapshot.tasks : []; },
    onSnapshot: function (cb) {
      listeners.push(cb);
      return function () { var i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
    }
  };
  function boot() {
    var P = window.IDPlanPlugin;
    if (P && typeof P.mount === 'function') {
      try {
        handle = P.mount(api) || null;
        post({ v: V, type: MSG.ready });
      } catch (err) {
        post({ v: V, type: MSG.ready, error: String((err && err.message) || err) });
      }
      return true;
    }
    return false;
  }
  if (!boot()) {
    // 作者可能异步挂全局：最多探 1s，到点放弃（宿主侧另有 3s ready 超时报错）
    var tries = 0;
    var t = setInterval(function () { tries++; if (boot() || tries >= 10) clearInterval(t); }, 100);
  }
})();
</script></body></html>`;
}

/** 深拷贝快照（postMessage 本身过结构化克隆边界，这里再拷一层是显式契约：宿主侧对象绝不外泄） */
function snapshotOf(
  version: string,
  theme: 'light' | 'dark',
  projects: readonly unknown[],
  stages: readonly unknown[],
  tasks: readonly unknown[],
): PluginSnapshot {
  const clone = <T,>(v: T): T =>
    typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);
  return { version, theme, projects: clone(projects), stages: clone(stages), tasks: clone(tasks) };
}

/**
 * 当前应当由沙箱 iframe 承载的已安装插件（启用中 + 从文件安装 + 声明 entry）。
 * 多个同时启用时取注册表序第一个（v1 不做多插件分栏——见文档「已知限制」）。
 */
export function useActiveInstalledPlugin(): PluginManifest | null {
  const reg = usePluginRegistry();
  return useMemo(
    () => reg.enabledManifests.find((m) => reg.installedIds.has(m.id) && m.entry) ?? null,
    [reg],
  );
}

/**
 * 插件内容区宿主（AppShell 的 `<main>` 里常驻，见文件头「为什么常驻」）。
 *
 * `active` 为 null（没有启用中的自装插件 / 打印路由）时整个宿主隐藏，路由内容
 * （`<Outlet/>`）照常渲染；active 变化时 effect 重建/拆除 iframe——拆除一定走
 * 完整 unmount 握手，因为 DOM 摘除权在宿主自己手里（React 摘不动它）。
 */
export function PluginFrameHost({ active }: { active: PluginManifest | null }): JSX.Element {
  const reg = usePluginRegistry();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const projects = useHumanProjects();
  const stages = useHumanStages();
  const tasks = useHumanTasks();
  const { theme } = useTheme();
  const version = (typeof window !== 'undefined' && window.idplan?.version) || BUILD_VERSION;

  // 数据变化才新建快照（useMemo 依赖即广播时机；structuredClone 只在变化时发生）
  const snapshot = useMemo(
    () => snapshotOf(version, theme, projects, stages, tasks),
    [version, theme, projects, stages, tasks],
  );

  // 广播函数：由下方生命周期 effect 装配，数据 effect 调用
  const snapshotRef = useRef<PluginSnapshot>(snapshot);
  snapshotRef.current = snapshot;
  const pushRef = useRef<() => void>(() => {});

  // 启用插件的 id（effect 的唯一驱动量；null = 不该有 iframe 在跑）
  const activeId = active?.id ?? null;
  const entry = active?.entry ?? 'index.js';
  const htmlMode = isHtmlEntry(entry);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!activeId || !active || !host) return;
    setFailed(null);

    const iframe = document.createElement('iframe');
    // ★ 安全红线：只给 allow-scripts。永远不写 allow-same-origin（静态 spec 钉死这行）。
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('data-plugin-frame', activeId);
    iframe.className = 'absolute inset-0 h-full w-full border-0 bg-cream';
    if (htmlMode) {
      iframe.src = pluginEntryUrl(activeId, entry);
    } else {
      iframe.srcdoc = buildRunnerSrcdoc(activeId, entry);
    }
    host.appendChild(iframe);

    let detached = false;
    let ackTimer = 0;
    const push = (): void => {
      const w = iframe.contentWindow;
      if (w) {
        w.postMessage(
          { v: PLUGIN_MSG_VERSION, type: PLUGIN_MSG.snapshot, snapshot: snapshotRef.current },
          '*',
        );
      }
    };
    pushRef.current = push;

    const onMessage = (e: MessageEvent): void => {
      if (e.source !== iframe.contentWindow) return; // 只认本 iframe 的来信
      const d = e.data as { v?: number; type?: string; error?: string } | null;
      if (!d || typeof d !== 'object' || d.v !== PLUGIN_MSG_VERSION) return;
      if (d.type === PLUGIN_MSG.ready) {
        if (d.error) setFailed(`插件加载失败：${d.error}`);
        else setFailed(null);
        push(); // 握手后立即补推当前快照（挂载瞬间那条广播可能已丢失）
      } else if (d.type === PLUGIN_MSG.unmountAck) {
        removeNow(); // 插件自己清完场了，立刻摘（不用等兜底超时）
      }
    };
    window.addEventListener('message', onMessage);

    /** 摘除 iframe（幂等；先解监听再摘，防 ack 迟到重入） */
    function removeNow(): void {
      if (detached) return;
      detached = true;
      window.clearTimeout(ackTimer);
      window.removeEventListener('message', onMessage);
      iframe.remove();
    }

    // IIFE 形态：ready 超时 = 失败（html 形态无法可靠判定作者是否就绪，不误报）
    let readyTimer = 0;
    if (!htmlMode) {
      readyTimer = window.setTimeout(() => {
        setFailed(
          (cur) =>
            cur ??
            '插件未能在 3 秒内就绪——入口文件未声明 window.IDPlanPlugin.mount，或产物加载失败',
        );
      }, READY_TIMEOUT_MS);
    }

    return () => {
      window.clearTimeout(readyTimer);
      // 停用/切插件：先请插件 unmount，等回执（或超时兜底）后摘除 iframe。
      // 宿主 div 常驻 ⇒ 此刻 iframe 还在 DOM 里、contentWindow 活着，消息一定送得到。
      const w = iframe.contentWindow;
      if (w) w.postMessage({ v: PLUGIN_MSG_VERSION, type: PLUGIN_MSG.unmount }, '*');
      ackTimer = window.setTimeout(removeNow, UNMOUNT_ACK_TIMEOUT_MS);
    };
  }, [activeId, active, entry, htmlMode]);

  // 数据变化 ⇒ 广播新快照（插件不得轮询，宿主推）
  useEffect(() => {
    pushRef.current();
  }, [snapshot]);

  return (
    <div
      className={cn('flex h-full min-h-0 flex-col', !active && 'hidden')}
      data-plugin-host={activeId ?? ''}
    >
      {active && (
        <>
          {/* 顶条：说清「谁在跑」+ 一个显眼的退出（v1 插件是全屏模式，不能让人困在里面） */}
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-cream/80 px-4 py-2">
            <Puzzle size={13} className="text-mist" aria-hidden />
            <span className="truncate text-[12px] font-medium text-ink">{active.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-mist">
              v{active.version} · 成员自装
            </span>
            <button
              type="button"
              data-plugin-exit={active.id}
              onClick={() => void reg.setPluginEnabled(active.id, false)}
              className={cn(
                'ml-auto shrink-0 rounded-md border border-line px-2 py-1 text-[11px] text-mist',
                'transition-colors hover:bg-sand hover:text-ink',
                'outline-none focus-visible:ring-2 focus-visible:ring-pine/40',
              )}
            >
              回到主界面
            </button>
          </div>

          {failed && (
            <p className="shrink-0 border-t border-clay/40 bg-clay/5 px-4 py-2 text-[11px] text-clay">
              {failed}
            </p>
          )}
        </>
      )}

      {/*
        ★ iframe 挂载点：**常驻不随停用卸载**（文件头「为什么常驻」）。
        停用时外层已 hidden，里面的 iframe 正在走 unmount 握手——DOM 摘除权在
        宿主自己手里，React 碰不到它，消息才送得出去。
      */}
      <div ref={hostRef} className="relative min-h-0 flex-1 bg-cream" />
    </div>
  );
}

/** 暴露给文档与探针的 api 形状（运行契约的真正定义在 buildRunnerSrcdoc 里） */
export type { PluginMountApi };
