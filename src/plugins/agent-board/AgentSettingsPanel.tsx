/**
 * Agent 看板插件 · **它自己的设置**（v1.0 · 设置层级重做）
 *
 * ── 这个文件为什么存在 ──
 * 她的原话：「Agent 实际上应该包含在下面那个箭头指的『插件』里面，给里面增加一个
 * 设置按钮。**每一个插件都应该有自己对应的设置，它应该是在自己的板块里面**」。
 *
 * 在这之前，这三块（Agent 席位与本地库 / 自然语言通道 / Agent 看板入口）住在
 * 宿主设置抽屉里，而且是**插件区里的一个固定二级分组**（`SettingsDialog` 的
 * `PLUGIN_SUBS` 两段子导航）——那个形态把「插件」写死成只有 Agent 一家有事可说。
 * 现在它们只是 **agent-board 这个插件自己的设置**：经该插件 manifest 的
 * `settingsSlot` 挂载，宿主只认「插件声明的设置区块」这一条抽象。
 *
 * ── 内容零改动（只搬位置 + 换外壳）──
 * 三块的标记、文案键、数值口径与原来逐字一致。唯一需要**换机制**的是那枚
 * `<Link to="/agent">` 的 `onClick={onClose}`：`onClose` 是宿主设置抽屉的关闭回调，
 * 插件组件拿不到（`PluginSettingsSlot` 以 `<Slot />` 无 props 渲染，见
 * `core/plugin/PluginRegistryProvider.tsx`）。**行为照旧**——点它先收起抽屉再导航——
 * 只是通道换成 `useUiStore.requestSettingsClose()`（显式单向信号，机制写在那个
 * store 字段的注释里）。为什么不能直接不要它：640px 的抽屉会继续盖在刚打开的
 * /agent 页面上，那是功能回退。
 *
 * ── 权限口径：全员可见（**不许顺手加管理员墙**）──
 * 搬家前这三块是全员可见的（原二级子导航与 `PLUGIN_SUBS` 都没有 `adminOnly`），
 * 搬家后保持——`settingsSlot` 的渲染由插件启用态决定，与角色无关。
 * 这不是遗漏，是口径：Agent 接入是每个使用者都会碰的东西。
 *
 * ── 为什么 defaultEnabled 的插件里放「席位/用量」这类全局信息 ──
 * 它们是**展示**（B5：只展示不拦截），不是「Agent 插件的配置项」。放这里的理由
 * 是归属：席位与本地库占用说的就是「Agent 这块功能占了你多少」，它属于 Agent，
 * 不属于宿主的「数据与备份」。停用 agent-board ⇒ 整块随 slot 消失，用户不会在
 * 关掉 Agent 之后还被一个「Agent 席位 已用 3/50」的卡片念叨。
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Database } from 'lucide-react';

import { useLang } from '../../i18n';
import { useRepos } from '../../hooks/useRepos';
import { useMembersStore } from '../../store/useMembersStore';
import { useUiStore } from '../../store/useUiStore';
import { AGENT_SEAT_LIMIT } from '../../constants/agentTerms';
import {
  estimateLocalDbUsage,
  formatBytes,
  type LocalDbUsage,
} from '../../lib/storage-estimate';

export function AgentSettingsPanel(): JSX.Element {
  const { t } = useLang();
  /** 见下方 Link 处的注释：这是「请收起居中的设置抽屉」那条显式通道（无 props 可传） */
  const requestSettingsClose = useUiStore((s) => s.requestSettingsClose);

  // —— v0.6 · T13：Agent 席位明示（B5：只展示不拦截）+ 本地库占用量 ——
  const members = useMembersStore((st) => st.members);
  const agentSeatUsed = members.filter((m) => m.actorKind === 'agent').length;
  const agentSeatOver = agentSeatUsed > AGENT_SEAT_LIMIT;
  const repos = useRepos();
  /**
   * 本地库占用：**本面板挂载时**估算一次，打开期间不轮询（展示用途足够）。
   *
   * 原实现在宿主抽屉里靠 `open` 布尔门控（「每次打开抽屉估一次」）。搬进来之后
   * 挂载时机本身就是「用户点了齿轮、要看这个插件的设置」——`open` 这个前置条件
   * 由宿主变成了本组件的生命周期，判据没有变松：依然是「一打开就估、开着不重估」。
   */
  const [dbUsage, setDbUsage] = useState<LocalDbUsage | null>(null);
  useEffect(() => {
    let cancelled = false;
    void estimateLocalDbUsage(async () => {
      const projects = await repos.projects.list();
      const stages = (
        await Promise.all(projects.map((pj) => repos.stages.listByProject(pj.id)))
      ).flat();
      return {
        projects,
        stages,
        tasks: await repos.tasks.list(),
        members: await repos.members.list(),
      };
    }).then((u) => {
      if (!cancelled) setDbUsage(u);
    });
    return () => {
      cancelled = true;
    };
  }, [repos]);

  return (
    <div className="space-y-5">
      {/* Agent 与本地库区（v0.6 · T13：席位明示 + 库占用，只展示不拦截） */}
      <section>
        <div className="mb-2 flex items-center gap-1.5">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <Database size={14} className="text-mist" aria-hidden />
            {t('settings.section.agentSeats')}
          </h3>
        </div>
        <div className="rounded-[10px] border border-line bg-cream/50 px-3 py-2.5 text-xs leading-6">
          <div className="flex items-center justify-between gap-2">
            {/*
              ⚠️ 标签侧用 `<div>` 而不是 `<span>`：这一行是**两栏 flex**（标签 / 数值各
              一个 flex item），两者之间没有任何文本流，只是被 `justify-between` 拉开的
              两块。`tests/i18n-jsx-space.spec.ts` 按「同一 children 数组里相邻的行内
              文本段」判空格，会把 `span` 兄弟误判成一句话的两段（英文侧真报了一次）。
              flex item 自带 blockify ⇒ 换成 `<div>` **布局零变化**，同时让扫描器的模型
              与真实文本流一致。本仓同形先例：`MyTasksPage.tsx:139` 的 `<h1>` + `<span>`。
            */}
            <div className="text-mist">{t('agentSettings.seatRowLabel')}</div>
            <span className="font-mono text-ink">
              {t('agentSettings.seatUsed', { used: agentSeatUsed, limit: AGENT_SEAT_LIMIT })}
            </span>
          </div>
          {agentSeatOver && (
            <p className="text-[11px] text-amber">
              {t('agentSettings.seatOver', { limit: AGENT_SEAT_LIMIT })}
            </p>
          )}
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-mist">{t('agentSettings.dbUsageLabel')}</span>
            <span className="font-mono text-ink">
              {dbUsage ? formatBytes(dbUsage.bytes) : '—'}
              {dbUsage && dbUsage.source === 'serialization-fallback' && (
                <span className="ml-1 text-[10px] text-mist">{t('agentSettings.dbUsageEstimated')}</span>
              )}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-mist">
            {t('agentSettings.dbUsageHint')}
          </p>
        </div>
      </section>

      {/*
        自然语言通道（说明性条目，不重复数据）：接入凭据的生成/管理在
        Agent 看板的接入面板——那边是工作流现场，设置里只讲清口径。
      */}
      <section>
        <div className="mb-2 flex items-center gap-1.5">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <Bot size={14} className="text-mist" aria-hidden />
            {t('settings.section.naturalLanguage')}
          </h3>
        </div>
        <p className="rounded-xl border border-line bg-cream/60 px-3.5 py-3 text-xs leading-relaxed text-mist">
          {t('agentSettings.ingress.lead')}
          <strong className="text-ink">{t('agentSettings.ingress.strong')}</strong>
          {t('agentSettings.ingress.tail')}
        </p>
      </section>

      {/* Agent 看板入口（说明性：数据不复制进设置，点它去现场） */}
      <section>
        <div className="mb-2 flex items-center gap-1.5">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <Bot size={14} className="text-mist" aria-hidden />
            {t('settings.section.agentBoard')}
          </h3>
        </div>
        <p className="mb-2 rounded-xl border border-line bg-cream/60 px-3.5 py-3 text-xs leading-relaxed text-mist">
          {t('agentSettings.boardHint')}
        </p>
        {/*
          这个 Link 只在 agent-board 启用时会被渲染（`PluginSettingsSlot` 判启用态，
          停用就整块返回 null）——所以它**不再是死链**：从前它挂在宿主抽屉里，
          插件关掉后 /agent 路由不存在，点过去落到 '*' 通配回首页且抽屉还开着。

          `onClick={requestSettingsClose}`：点它就**先把设置抽屉收起来**再导航。
          拿不到宿主的 `onClose`（`PluginSettingsSlot` 以 `<Slot />` 无 props 渲染），
          所以走 `useUiStore` 那条**显式请求信号**（机制与理由写在 `useUiStore` 的
          `settingsCloseRequest` 注释里）。没有它 = 640px 抽屉会继续盖在刚打开的
          /agent 页面上——那是功能回退，不是「行为差强人意」。
        */}
        <Link
          to="/agent"
          onClick={requestSettingsClose}
          className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-cream/60 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sand"
        >
          <Bot size={15} className="text-mist" aria-hidden />
          {t('agentSettings.openBoard')}
        </Link>
      </section>
    </div>
  );
}
