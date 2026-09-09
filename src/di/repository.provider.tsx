import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { appEnv } from '../config/env';
import { createRepositories } from '../core/repositories';
import { ChangxiaError, ChangxiaErrorCode } from '../core/types/enums';
import type { IRepositoryBundle } from '../core/repositories/interfaces';
import { detectLocalDbVersion } from '../core/repositories/local/dexie.database';
import { SCHEMA_VERSION } from '../core/schema/current';
import { exportPreMigrationBackupToFile } from '../components/layout/useBackupIo';

/**
 * DI 注入点：启动时经工厂创建一次 IRepositoryBundle，Context 下发。
 * 业务代码统一通过 useRepos() 取用（铁律 4 的唯一合法取数入口）。
 *
 * v0.6 新增：**迁移前备份闸门**（设计文档 §5.4，PRD §0.6 硬要求）。
 * local 数据源下探测到 Dexie 库仍是 v1（即将升级）时，先弹**不可跳过**的阻塞
 * 对话框，要求导出一份升级前备份——它是唯一的三级回滚凭据（L1 应用内导入 /
 * L2 删库回旧版都依赖它）。导出成功前绝不执行 `db.open()`，即绝不触发升级。
 */

const RepoContext = createContext<IRepositoryBundle | null>(null);

/** 闸门状态：pending=等待用户导出；exporting=导出中；failed=导出失败（可重试） */
type GateState = 'pending' | 'exporting' | 'failed';

export function RepoProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [bundle, setBundle] = useState<IRepositoryBundle | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [gate, setGate] = useState<GateState | null>(null);
  const cancelledRef = useRef(false);

  const startRepositories = useCallback(async (): Promise<void> => {
    try {
      const b = await createRepositories({ dataSource: appEnv.dataSource, apiBaseUrl: appEnv.apiBaseUrl });
      if (!cancelledRef.current) setBundle(b);
    } catch (err: unknown) {
      if (cancelledRef.current) return;
      const msg =
        err instanceof ChangxiaError
          ? err.userMessage
          : '本地数据库初始化失败（可能是隐私模式禁用了存储）。';
      setFatalError(msg);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    void (async () => {
      if (appEnv.dataSource === 'local') {
        // 探测不到（全新环境）或已是当前版本 → 直接建库，不弹闸门
        const verno = await detectLocalDbVersion();
        if (cancelledRef.current) return;
        if (verno !== null && verno < SCHEMA_VERSION) {
          setGate('pending');
          return;
        }
      }
      await startRepositories();
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [startRepositories]);

  /** 闸门唯一出口：导出成功才允许升级（无「跳过」选项） */
  const confirmMigrationBackup = useCallback(async (): Promise<void> => {
    setGate('exporting');
    const ok = await exportPreMigrationBackupToFile();
    if (cancelledRef.current) return;
    if (!ok) {
      setGate('failed');
      return;
    }
    setGate(null);
    await startRepositories();
  }, [startRepositories]);

  const value = useMemo(() => bundle, [bundle]);

  if (gate) {
    // ★ 阻塞式闸门：不渲染 children（数据尚未就绪），也不提供任何跳过路径
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream p-8">
        <div className="max-w-md rounded-md border border-clay-soft bg-paper p-6 text-ink shadow-soft">
          <h1 className="mb-2 font-display text-display-md">需要先导出升级前备份</h1>
          {gate === 'failed' ? (
            <>
              <p className="text-sm leading-6 text-mist">
                备份导出失败（请检查磁盘空间 / 下载权限）。为保护你的数据，本次
                <strong>不执行升级</strong>，本地数据仍为旧格式、未受任何影响。
              </p>
              <button
                type="button"
                className="mt-4 rounded-full bg-pine px-4 py-2 text-sm font-medium text-paper"
                onClick={() => void confirmMigrationBackup()}
              >
                重试导出
              </button>
            </>
          ) : (
            <>
              <p className="text-sm leading-6 text-mist">
                检测到本地数据库仍是旧版本（v1），即将升级到 v{SCHEMA_VERSION}。升级会
                <strong>就地改写本地数据且不可逆</strong>，因此必须先导出一份备份——
                这是升级后唯一的回滚凭据。
              </p>
              <p className="mt-2 text-xs leading-5 text-mist">
                点击按钮将下载 <code>id-plan-backup-*.json</code>，导出成功后自动继续升级。
              </p>
              <button
                type="button"
                className="mt-4 rounded-full bg-pine px-4 py-2 text-sm font-medium text-paper disabled:opacity-60"
                disabled={gate === 'exporting'}
                onClick={() => void confirmMigrationBackup()}
              >
                {gate === 'exporting' ? '正在导出…' : '导出备份并继续'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (fatalError) {
    // 存储不可用的兜底画面：不白屏、给出可操作指引
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream p-8">
        <div className="max-w-md rounded-md border border-clay-soft bg-paper p-6 text-ink shadow-soft">
          <h1 className="mb-2 font-display text-display-md">无法访问本地数据</h1>
          <p className="text-sm leading-6 text-mist">{fatalError}</p>
          <p className="mt-3 text-sm leading-6">
            请确认未处于浏览器无痕/隐私模式，或为站点启用站点数据后刷新重试。
          </p>
        </div>
      </div>
    );
  }

  if (!value) {
    // 首屏装配瞬态：仅微占位，非「加载圈」（PRD 禁令针对写操作反馈）
    return <div className="min-h-screen bg-cream" aria-busy="true" />;
  }

  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
}

/** Context 消费（业务 hook useRepos() 底层实现；组件请勿直接使用本函数） */
export function useRepoContext(): IRepositoryBundle {
  const ctx = useContext(RepoContext);
  if (!ctx) {
    throw new ChangxiaError(
      ChangxiaErrorCode.Cancelled,
      '仓储上下文缺失：RepoProvider 未挂载。',
    );
  }
  return ctx;
}
