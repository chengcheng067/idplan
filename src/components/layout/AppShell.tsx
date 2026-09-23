import { Outlet } from 'react-router-dom';

import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { IdentityDialog } from './IdentityDialog';
import { ManualFallbackForm } from '../contract-wizard/ManualFallbackForm';
import { useProjectsBootstrap } from '../../hooks/useProjectsBootstrap';
import { useFirstRunGate } from '../../hooks/useFirstRunGate';
import { useAgentLoopbackReceiver } from '../../hooks/useAgentLoopbackReceiver';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useUiStore } from '../../store/useUiStore';

/**
 * 应用壳：米白底大面积留白 + 侧栏 + 顶栏 + 路由出口；挂载全局 Toast 容器。
 * 启动引导（全量装载）在此触发一次；首启身份闸门也在此挂载。
 *
 * ── v0.7 子系统 ①：三段式壳层（T18 骨架 → T20/T21 填肉）──
 * 结构（§3.4）：
 *   div.flex.min-h-screen           ← 横向 flex，侧栏与内容区并排
 *   ├─ Sidebar                      ← ≥xl 持久左栏（240/64 可切）/ <xl Modal 抽屉
 *   └─ div.flex-1.flex-col          ← 内容区（TopBar + main 独占剩余宽度）
 *      ├─ TopBar                    ← 瘦身后常驻 ≤4 元素
 *      └─ main.max-w-[1440px]       ← **全站唯一**内容宽度锚点（v0.7 §6.2）
 *
 * 关键决策（§3.4，R12 对策）：
 * 1. `<main>` 保留 `max-w-[1440px]`（原 1600，v0.7 §6.2 改为 1440），作为**唯一出处**。
 *    TopBar 与 AgentBoardPage 的重复约束已在 T21/T18 删除——否则会出现
 *    「侧栏 + main 内又一层容器」的双重留白（L-08 验收点）。
 * 2. 内容区加 `min-w-0`：flex 子项默认 `min-width:auto`，内含 overflow-hidden /
 *    grid 时会被内容撑破、把侧栏挤出视口。`min-w-0` 是 flex 布局标配修复。
 * 3. 内容区带 `.app-content-column` 钩子类：打印时由 @media print 拉平为整幅纸宽
 *    （侧栏已被 print:hidden 隐藏，内容区无需再让位）。
 * 4. 两条打印路由（schedule-print / calendar-print）不显示侧栏：Sidebar 内部
 *    `useLocation` 命中即 `return null`（路由层），叠加 `print:hidden`（CSS 层）
 *    与 global.css `[data-app-sidebar]{display:none}`（R20 双保险+1）。
 *    这两个页面的 `max-w-[900px]` 是 A4 预览刻意保留的独立档位，**不并入** 1600。
 */
export function AppShell(): JSX.Element {
  useProjectsBootstrap();
  useFirstRunGate();
  /*
   * 本机 Agent loopback 的**渲染侧落库接收器**：常驻监听主进程转来的导入 / ping。
   * 必须挂在这里（而不是某个页面）—— 见 `useAgentLoopbackReceiver` 文件头：
   * 挂在页面会导致用户不在该页时面板显示「可连通」但写入要等满 10s 超时。
   */
  useAgentLoopbackReceiver();
  const toasts = useProjectsStore((s) => s.toasts);
  const dismissToast = useProjectsStore((s) => s.dismissToast);
  const manualFormOpen = useUiStore((s) => s.manualFormOpen);
  const closeManualForm = useUiStore((s) => s.closeManualForm);

  return (
    <div className="flex min-h-screen bg-cream font-body text-ink">
      {/* ① 侧栏：≥xl 持久左栏 / <xl Modal 抽屉 / 打印路由 return null */}
      <Sidebar />

      {/* 内容区：flex-1 吃掉剩余宽度；min-w-0 防内容撑破导致侧栏被挤出 */}
      <div className="app-content-column flex min-w-0 flex-1 flex-col">
        <TopBar />
        {/*
          内容区宽度锚点（§6.2）：≥1440 时 max-width: 1440px + margin-inline: auto。
          1440 视口下侧栏 240 + 右侧区 1200，main 在 1200 容器里撑满，再减页面横向内边距
          32×2 = 1136 内容宽，正好等于画板 02 内容区宽度——值是算出来的，非拍定。
          内边距全部移除：各页面内边距不同（首页/项目详情 32、Agent 看板 24、月历
          20/36/24/36，§1.8/§2.5），统一内边距无法表达，改由各页面根节点自持。
          ⚠️ 过渡期页面会暂时贴边——这是预期，负责各页面的成员会补正确内边距，勿回加。
        */}
        <main className="mx-auto w-full max-w-[1440px]">
          <Outlet />
        </main>
      </div>

      {/* 身份进入对话框（first-run 管理员确立 / 成员姓名进入 / 未命中提示） */}
      <IdentityDialog />
      {/* 手动建档兜底：全局挂载，「新建项目」直接打开（v0.3 移除导入合同建档入口后） */}
      <ManualFallbackForm open={manualFormOpen} onClose={closeManualForm} />
      {/*
        瞬时 Toast 层（≤2s，无 loading 圈；v0.3 玻璃化）。
        ★ z-50：必须高于**最高**的模态层（Modal center 遮罩 = z-[70]，见
          Modal.tsx 的分层注释）。曾是 z-50 ⇒ 弹窗内的操作反馈（如接入面板的
          「生成接入信息」结果）被压在置灰遮罩**底下**，用户只看到背景变暗、
          看不到提示（2026-09-24 实测投诉）。层级顺序由
          tests/toast-above-modal.spec.ts 钉住。
      */}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismissToast(t.id)}
            className={`toast-enter glass-medium pointer-events-auto rounded-lg px-4 py-2 text-sm shadow-soft ${
              t.kind === 'success'
                ? 'text-moss'
                : t.kind === 'error'
                  ? 'text-clay'
                  : 'text-ink'
            }`}
          >
            {t.message}
          </button>
        ))}
      </div>
    </div>
  );
}
