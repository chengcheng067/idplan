import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { appEnv } from '../config/env';
import { createRepositories } from '../core/repositories';
import { ChangxiaError, ChangxiaErrorCode, resolveErrorText } from '../core/types/enums';
import type { IRepositoryBundle } from '../core/repositories/interfaces';
import { detectLocalDbVersion, isDbAheadOfApp, needsPreMigrationBackup } from '../core/repositories/local/dexie.database';
import { SCHEMA_VERSION } from '../core/schema/current';
import { recoverZombieExecutions } from '../core/execution/execution-recovery';
/*
 * ★ i18n 笔 misc：本文件同时用**两种**取词形态，故 import 时先把模块级取词改名。
 *   · `translate`（模块级 `t`，不订阅）：只给 `startRepositories` 那次「算一次就完」
 *     的启动期调用用（理由见下方原注释）；
 *   · `t`（`useLang()` 的）：本组件 render 期渲染的全部文案 —— 少了它，切语言时
 *     这一页（升级闸门 / 降级安装 / 存储不可用三个致命面）不会重渲染。
 *   ⚠️ 若不改名，组件内的 `const { t } = useLang()` 会**遮蔽**模块级 `t`，
 *     上面那条「不订阅」的意图会被静默改掉。
 */
import { t as translate, useLang } from '../i18n';
import { exportPreMigrationBackupToFile } from '../components/layout/useBackupIo';

/**
 * NAS 令牌变更事件名（0.8.2.0002）。设置「NAS 服务」区保存令牌后由 UI 派发，
 * 本 provider 监听后重建 remote bundle（否则新令牌要等下次刷新页面才生效——
 * 用户保存完立刻点备份又 401，会以为没保存上）。
 */
export const API_TOKEN_EVENT = 'idplan:api-token-changed';

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

/**
 * 致命态（数据不可用，必须停下来把原因说清楚）。
 *
 * ★ 为什么要分两支（审计 F1-②）：
 *   修复前只有一个 `fatalError: string`，无论什么原因都渲染同一句
 *   「请确认未处于浏览器无痕/隐私模式，或为站点启用站点数据后刷新重试」。
 *   于是**降级安装**（库版本比程序新）被冒充成隐私模式问题：用户按提示折腾无效，
 *   下一步最可能就是删站点数据/重装——而数据其实完好，正确动作只是换回新版应用。
 *   两支对症下药，且两支都不提供「降级/删库/修复」任何按钮（只提示 + 允许用户自己决定）。
 */
type FatalState =
  | { kind: 'storage'; message: string }
  | { kind: 'db-ahead'; dbVersion: number; appVersion: number };

export function RepoProvider({ children }: { children: React.ReactNode }): JSX.Element {
  /** 渲染期取词 + 语言变化订阅点（三个致命面/闸门的所有文案都走它） */
  const { t } = useLang();
  const [bundle, setBundle] = useState<IRepositoryBundle | null>(null);
  const [fatal, setFatal] = useState<FatalState | null>(null);
  const [gate, setGate] = useState<GateState | null>(null);
  /**
   * 进入闸门时探测到的**实际库版本**（Dexie verno）。
   * ★ BUG-02 顺带修的文案缺陷：这里原是硬编码「仍是旧版本（v1）」，
   *   而对 v2 库会显示 v1 —— 在「不可逆升级」的确认框里说错版本号，
   *   用户据此判断「要不要先备份」会判断错。改为显示实际探测值。
   */
  const [gateFromVersion, setGateFromVersion] = useState<number | null>(null);
  const cancelledRef = useRef(false);

  const startRepositories = useCallback(async (): Promise<void> => {
    try {
      const b = await createRepositories({ dataSource: appEnv.dataSource, apiBaseUrl: appEnv.apiBaseUrl });
      // ★ 僵尸态兜底（规格 §12 L223 第 1 条）：仓储刚装配完、**首屏数据装载之前**收敛。
      //   时序是硬要求，不是风格选择：
      //     - 早于 `createRepositories` 不可能（那时还没有仓储可写）；
      //     - 晚于 `bootstrapAllStores` 就会先渲染出「还在跑」的假活态再把它抹掉
      //       —— 哪怕只闪一帧，用户已经看见了不该看见的东西。
      //   这里 await（而非 fire-and-forget）：失败也不能拦启动（内部已逐条隔离、不抛），
      //   但必须保证 children 拿到 bundle 时，库里已经没有僵尸态。
      await recoverZombieExecutions(
        b.executions,
        { projectIds: (await b.projects.list({ status: 'all' })).map((p) => p.id) },
        /*
         * ★ i18n 笔 2.1：两条审计原因串在**写入点**取词。
         * 为什么不把取词放进 `execution-recovery.ts`：那个文件在服务端 tsconfig 的
         * include 面内，而 `src/i18n/lang.ts` 引用了 `document` ⇒ import 它会红 TS2584。
         * 这里用**模块级 `t`**（不订阅）：本函数是「算一次就完」的启动期调用 ——
         * 若改用 `useLang()` 的 `t`，它必须进 `useCallback` 的 deps，而 deps 一变
         * 这个 effect 会**重建仓储**（代价远大于收益）。启动期读一次当前语言即正确。
         */
        {
          execution: translate('execution.recovery.reason'),
          attempt: translate('execution.recovery.attemptReason'),
        },
      );
      if (!cancelledRef.current) setBundle(b);
    } catch (err: unknown) {
      if (cancelledRef.current) return;
      const msg = resolveErrorText(err, translate, translate('di.repo.initFailed'));
      setFatal({ kind: 'storage', message: msg });
    }
  }, []);

  /**
   * remote 重建纪元（0.8.2.0002 备份令牌热修）：设置「NAS 服务」区改令牌后
   * +1 → 本 effect 重跑 → createRepositories 重读 localStorage 重建 bundle。
   * 只对 remote 有意义（local 无 token 概念）；local 模式重建会白白重开
   * 一次 IndexedDB，故监听里直接对 dataSource 短路。
   */
  const [repoEpoch, setRepoEpoch] = useState(0);
  useEffect(() => {
    if (appEnv.dataSource !== 'remote') return;
    const onTokenChanged = (): void => setRepoEpoch((n) => n + 1);
    window.addEventListener(API_TOKEN_EVENT, onTokenChanged);
    return () => window.removeEventListener(API_TOKEN_EVENT, onTokenChanged);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    void (async () => {
      if (appEnv.dataSource === 'local') {
        // 探测不到（全新环境）或已是当前版本 → 直接建库，不弹闸门。
        // ★ 判据取自唯一出处 needsPreMigrationBackup（BUG-02）：
        //   detectLocalDbVersion 返回的是**归一后的 Dexie verno**；此前它返回原始
        //   IDB 版本（×10），使这里的 `verno < SCHEMA_VERSION` 恒为 false ——
        //   闸门从不弹出、老库静默升级、没有任何回滚凭据。
        const verno = await detectLocalDbVersion();
        if (cancelledRef.current) return;
        /*
          ★ 降级安装分支（审计 F1-②）：**优先于**备份闸门与隐私模式归因。
          库比程序新 ⇒ 这份数据已被更高版本的应用改写过，本版代码既读不懂也不该碰；
          绝不自动降级/删库/"修复"（那会毁掉更新的数据），只把事实与正确动作说清楚。
          ★ 判据走 `isDbAheadOfApp`（唯一出处），不在 catch 里嗅 VersionError 类名：
            异常要穿过 Dexie → openDatabase → 工厂三层包装，任何一层改写都会让嗅探
            静默失效，且失效表现是「又退回隐私模式话术」——只有真机降级才暴露的假绿。
        */
        if (isDbAheadOfApp(verno)) {
          setFatal({ kind: 'db-ahead', dbVersion: verno, appVersion: SCHEMA_VERSION });
          return;
        }
        if (needsPreMigrationBackup(verno)) {
          setGateFromVersion(verno);
          setGate('pending');
          return;
        }
      }
      await startRepositories();
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [startRepositories, repoEpoch]);

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
          <h1 className="mb-2 font-display text-display-md">{t('di.repo.gate.title')}</h1>
          {gate === 'failed' ? (
            <>
              <p className="text-sm leading-6 text-mist">
                {t('di.repo.gate.failedBefore')}
                <strong>{t('di.repo.gate.failedStrong')}</strong>
                {t('di.repo.gate.failedAfter')}
              </p>
              <button
                type="button"
                className="mt-4 rounded-full bg-pine px-4 py-2 text-sm font-medium text-paper"
                onClick={() => void confirmMigrationBackup()}
              >
                {t('di.repo.gate.retry')}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm leading-6 text-mist">
                {t('di.repo.gate.detectedBefore', {
                  from: gateFromVersion ?? '',
                  to: SCHEMA_VERSION,
                })}
                <strong>{t('di.repo.gate.detectedStrong')}</strong>
                {t('di.repo.gate.detectedAfter')}
              </p>
              <p className="mt-2 text-xs leading-5 text-mist">
                {t('di.repo.gate.downloadBefore')}
                {' '}
                <code>id-plan-backup-*.json</code>
                {t('di.repo.gate.downloadAfter')}
              </p>
              <button
                type="button"
                className="mt-4 rounded-full bg-pine px-4 py-2 text-sm font-medium text-paper disabled:opacity-60"
                disabled={gate === 'exporting'}
                onClick={() => void confirmMigrationBackup()}
              >
                {gate === 'exporting'
                  ? t('di.repo.gate.exporting')
                  : t('di.repo.gate.exportAndContinue')}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (fatal) {
    // 存储/版本不可用的兜底画面：不白屏、给出**对症**的可操作指引
    if (fatal.kind === 'db-ahead') {
      /*
        ★ 降级安装（审计 F1-②）：库版本比程序新。
        这一页存在的唯一理由：让用户**不要**去做那件会毁数据的事（删站点数据 / 重装），
        并知道正确动作是「换回不低于该版本的应用」。两边版本号都要印出来——
        「你的数据是 v6、这个应用只到 v5」比「版本不匹配」有用得多（可截图给技术同学）。
      */
      return (
        <div className="flex min-h-screen items-center justify-center bg-cream p-8">
          <div className="max-w-md rounded-md border border-clay-soft bg-paper p-6 text-ink shadow-soft">
            <h1 className="mb-2 font-display text-display-md">{t('di.repo.ahead.title')}</h1>
            <p className="text-sm leading-6 text-mist">
              {t('di.repo.ahead.intro')}
              <span className="mx-1 font-medium text-ink">
                {t('di.repo.ahead.dataVersion', { version: fatal.dbVersion })}
              </span>
              {t('di.repo.ahead.appOnlyTo')}
              <span className="mx-1 font-medium text-ink">
                {t('di.repo.ahead.appVersion', { version: fatal.appVersion })}
              </span>
              {t('di.repo.ahead.damageBefore')}
              <strong>{t('di.repo.ahead.damageStrong')}</strong>
              {t('di.repo.ahead.damageAfter')}
            </p>
            <p className="mt-3 text-sm leading-6">{t('di.repo.ahead.advice')}</p>
            <p className="mt-3 rounded-2xl bg-cream px-4 py-3 text-[11px] leading-5 text-mist">
              {t('di.repo.ahead.warnBefore')}
              <strong className="text-ink">{t('di.repo.ahead.warnStrong')}</strong>
              {t('di.repo.ahead.warnAfter')}
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream p-8">
        <div className="max-w-md rounded-md border border-clay-soft bg-paper p-6 text-ink shadow-soft">
          <h1 className="mb-2 font-display text-display-md">{t('di.repo.fatal.title')}</h1>
          <p className="text-sm leading-6 text-mist">{fatal.message}</p>
          <p className="mt-3 text-sm leading-6">{t('di.repo.fatal.hint')}</p>
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
      translate('di.repo.noProvider'),
    );
  }
  return ctx;
}
