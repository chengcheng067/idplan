import { useState } from 'react';

import { ExternalLink, Copy, FolderOpen } from 'lucide-react';

import type { Stage } from '../../core/types/entities';
import { createProjectActions } from '../../store/useProjectsStore';
import { useRepos } from '../../hooks/useRepos';
import { useProjectsStore } from '../../store/useProjectsStore';
import { ImeInput } from '../common/ImeInput';

/**
 * 本地资料路径登记 + 打开引导（F12）。
 * 浏览器无法直接 file:// 跳转 —— 提供三通道：
 *   ① 尝试 window.open(file://)（部分环境可用）
 *   ② 复制路径到剪贴板（兜底）
 *   ③ 展示路径文字方便手动取用
 */
export function ResourcePathButton({ stage }: { stage: Stage }): JSX.Element {
  const repos = useRepos();
  const [editing, setEditing] = useState(false);
  const [pathText, setPathText] = useState(stage.resourcePath ?? '');

  const save = async (): Promise<void> => {
    await createProjectActions(repos).updateStageFields(stage.id, {
      resourcePath: pathText.trim() || null,
    });
    setEditing(false);
    if (pathText.trim()) {
      useProjectsStore.getState().pushToast('success', '资料路径已保存');
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
        .pushToast('info', '浏览器不允许直接打开本地文件夹，已复制路径，请粘贴到资源管理器地址栏。');
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
            className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs hover:bg-sand"
          >
            <ExternalLink size={12} /> 打开
          </button>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(stage.resourcePath!)}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs hover:bg-sand"
          >
            <Copy size={12} /> 复制路径
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md px-2 py-1.5 text-xs text-mist hover:bg-sand"
          >
            修改
          </button>
        </div>
      ) : editing ? (
        <div className="flex items-center gap-2">
          <ImeInput
            autoFocus
            value={pathText}
            onChange={(e) => setPathText(e.target.value)}
            placeholder="如 D:\长夏项目\某茶空间\03-施工图 或 file://D:/…"
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
            保存
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-sm text-mist underline underline-offset-2 hover:text-pine"
        >
          登记本阶段资料文件夹路径…
        </button>
      )}
    </div>
  );
}
