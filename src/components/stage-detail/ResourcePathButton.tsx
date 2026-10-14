import { useState } from 'react';

import { ExternalLink, Copy, FolderOpen } from 'lucide-react';

import type { Stage } from '../../core/types/entities';
import { createProjectActions } from '../../store/useProjectsStore';
import { useRepos } from '../../hooks/useRepos';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { ImeInput } from '../common/ImeInput';
import { useLang } from '../../i18n';

/**
 * 本地资料路径登记 + 打开引导（F12）。
 * 浏览器无法直接 file:// 跳转 —— 提供三通道：
 *   ① 尝试 window.open(file://)（部分环境可用）
 *   ② 复制路径到剪贴板（兜底）
 *   ③ 展示路径文字方便手动取用
 *
 * ── v0.7 T04 · P0-19-① 权限门控（收紧一处既有缺口）──
 *   现状：本文件此前**全文无** `useRoleGuard`，三种角色都能点「修改」并写库
 *   （对比 `StageDrawer.tsx` 的 `StatusRow` / `DateRow` 都带 `isAdmin` 门控）。
 *   成员视角是**只读视图**（权限矩阵默认档 = H 隐藏），故：
 *     · `stage.resourcePath` **有值** → 只读展示（FolderOpen + `<code>` 路径 +
 *       「打开」「复制路径」保留），**隐藏「修改」按钮**（唯一的写入口）。
 *       为什么保留「打开 / 复制路径」：两者都**不写库**（`window.open` / 剪贴板），
 *       且资料路径本就对成员可见——只读展示不扩大可见面，只是掐掉写入口。
 *     · `stage.resourcePath` **无值** → `if (!isAdmin) return null`（整块不渲染），
 *       成员看不到「登记资料文件夹路径…」这个登记入口。
 *
 *   ⚠️ Hooks 顺序（本项目已出过一次 React #310 白屏事故，见 `StageDrawer.tsx` 的警戒注释）：
 *      `useRoleGuard()` 必须放在**所有条件 return 之前**。本组件的 `return` 都写在
 *      JSX 三元里（无早退），但仍按纪律把 hook 放在最顶部，避免日后加早退时踩坑。
 */
/**
 * @returns 卡片节点；成员且**未登记路径**时返回 `null`（不渲染登记入口）。
 *          返回类型含 `null` 是本组件唯一的类型签名变更（原为 `JSX.Element`），
 *          与 `Sidebar` / `Modal` 等既有的 `JSX.Element | null` 同款。
 */
export function ResourcePathButton({ stage }: { stage: Stage }): JSX.Element | null {
  // ⚠️ 唯一判定出口（禁止在本组件内自写 !isMember 之类的派生，见 useRoleGuard.ts 收口说明）
  /* 取词 + 订阅语言变化（三通道文案 / toast 随语言变）
     ⚠️ 必须在下面那条 `if (!stage.resourcePath && !isAdmin) return null` **之前**
     （早退之前调 hook 是本仓纪律，见文件头 React #310 警戒）。 */
  const { t } = useLang();
  const { isAdmin } = useRoleGuard();
  const repos = useRepos();
  const [editing, setEditing] = useState(false);
  const [pathText, setPathText] = useState(stage.resourcePath ?? '');

  // 未登记路径时，「登记入口」是管理类写操作 → 成员整块隐藏（默认档 H）
  if (!stage.resourcePath && !isAdmin) return null;

  const save = async (): Promise<void> => {
    await createProjectActions(repos).updateStageFields(stage.id, {
      resourcePath: pathText.trim() || null,
    });
    setEditing(false);
    if (pathText.trim()) {
      useProjectsStore.getState().pushToast('success', t('resourcePath.savedToast'));
    }
  };

  const tryOpen = (): void => {
    if (!stage.resourcePath) return;
    // 浏览器安全策略下 file:// 多被拦截；失败则静默，用户走复制通道
    const win = window.open(stage.resourcePath.startsWith('file://') ? stage.resourcePath : `file://${stage.resourcePath}`, '_blank');
    if (!win) {
      void navigator.clipboard?.writeText(stage.resourcePath);
      useProjectsStore
        .getState()
        .pushToast('info', t('resourcePath.openFallbackToast'));
    }
  };

  return (
    <div className="rounded-md border border-line bg-paper p-3">
      {stage.resourcePath ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <FolderOpen size={14} className="text-pine" />
          <code className="min-w-0 flex-1 truncate rounded bg-cream px-2 py-1 text-xs" title={stage.resourcePath}>
            {stage.resourcePath}
          </code>
          <button
            type="button"
            onClick={tryOpen}
            /* 语言无关定位钩子（i18n-EN 批）：真机 spec 原先按 `getByRole('button', { name: '打开' })`
               定位（`v07-dline-shell` 阶段抽屉只读通道那条）⇒ 英文态静默失配。
               ⚠️ `getByRole(name)` 同时是 a11y 断言 ⇒ 使用方要**换钩子 + 补同源断言**。 */
            data-resource-path-open=""
            className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs hover:bg-sand"
          >
            <ExternalLink size={12} /> {t('resourcePath.open')}
          </button>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(stage.resourcePath!)}
            /* 语言无关定位钩子（同上；`v07-dline-shell:1056/1108` 按 `getByRole(name:'复制路径')` 定位） */
            data-resource-path-copy=""
            className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs hover:bg-sand"
          >
            <Copy size={12} /> {t('resourcePath.copy')}
          </button>
          {/* 「修改」= 唯一的写入口 → 管理员专属（成员只读展示，见文件头 P0-19-①） */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              /* 语言无关定位钩子（同上；`v07-dline-shell:1047` 用 `getByRole(name:'修改').count()` **反向**断言成员看不到它） */
              data-resource-path-edit=""
              className="rounded-md px-2 py-1.5 text-xs text-mist hover:bg-sand"
            >
              {t('resourcePath.edit')}
            </button>
          )}
        </div>
      ) : editing ? (
        <div className="flex items-center gap-2">
          <ImeInput
            autoFocus
            value={pathText}
            onChange={(e) => setPathText(e.target.value)}
            placeholder={t('resourcePath.placeholder')}
            className="flex-1 rounded-md border border-pine px-2 py-1.5 text-sm outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
          />
          <button
            type="button"
            onClick={() => void save()}
            className="rounded-md bg-pine px-3 py-1.5 text-xs text-white hover:bg-pine-deep"
          >
            {t('common.save')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-sm text-mist underline underline-offset-2 hover:text-pine"
        >
          {t('resourcePath.register')}
        </button>
      )}
    </div>
  );
}
