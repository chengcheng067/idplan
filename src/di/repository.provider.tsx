import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { appEnv } from '../config/env';
import { createRepositories } from '../core/repositories';
import { ChangxiaError, ChangxiaErrorCode, resolveErrorText } from '../core/types/enums';
import type { IRepositoryBundle } from '../core/repositories/interfaces';
import { detectLocalDbVersion, isDbAheadOfApp, needsPreMigrationBackup } from '../core/repositories/local/dexie.database';
import { SCHEMA_VERSION } from '../core/schema/current';
import { recoverZombieExecutions } from '../core/execution/execution-recovery';
import { currentWorkspaceDbName, currentWorkspaceIdSync, listWorkspaces, selectedWorkspaceIdSync } from '../lib/workspace-registry';
import type { IWorkspaceRepository } from '../core/repositories/interfaces';
import { API_TOKEN_KEY, RemoteWorkspacesRepo, RestClient } from '../core/repositories/remote/rest.client';
import { WorkspacePicker } from '../components/workspace/WorkspacePicker';
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

/**
 * remote 形态下「还没有当前区」时用的**轻量工作区仓储**（只含五个工作区能力）。
 *
 * ── 为什么需要它，以及为什么走这套构造 ──
 * NAS 版（remote）**没有本地分库**：`X-Workspace-Id` 是在建 bundle 那一刻注入的。
 * 于是「先建 bundle 再让用户选区」这个顺序在 NAS 上是错的 —— 第一批数据请求会不带
 * 该头（或被灌上桌面版遗产 `ws-default`），用户选完 A 公司后看到的是 ws-default 的
 * 数据。⇒ 无区时**不建 bundle**，先让用户把公司选出来。
 *
 * 而选公司这一步本身就得读/写那五个端点，于是需要一个 repo。三条路径的取舍：
 *   (a) 让 `RepoProvider` 造一个「只有 workspaces 的轻量 bundle」并塞进 Context ——
 *       会把「Context 里一定是一个完整 bundle」这条不变量撕开，全仓 `useRepos()`
 *       的每个消费方都得重新怀疑自己拿到的东西，代价远大于收益；
 *   (b) **在本文件里就地 `new` 一个 `RemoteWorkspacesRepo`**，只交给这个选择器用，
 *       **不进 Context、不进 DI 树** —— 选完区必 reload，reload 后
 *       `selectedWorkspaceIdSync()` 有值 ⇒ 走正常 bundle 路径，两条通路不会并存。
 *   ⇒ 取 (b)。可行性核实（三处，缺一就要退回 (a)）：
 *     ① `RemoteWorkspacesRepo` 构造函数只收一个 `RestClient`（rest.client.ts:672）；
 *     ② `RestClient` 的四个构造参数全是本文件已有/可算的：`baseUrl`（`appEnv`）、
 *        token（三级取值）、timeout（缺省）、`workspaceId`（**此处刻意留空**——
 *        `list`/`create` 不需要它，服务端按路径里的 id 定位，且空值时客户端根本不发
 *        这个头，见 RestClient 构造注释）；
 *     ③ `rest.client` 本来就已进主包（设置里的「NAS 服务」区与插件区都**静态** import
 *        它），故这里静态 import 不增加任何体积；反过来说「动态 import 能把它挪出
 *        主包」在本仓本来就不成立（`npm run build` 的 rollup 警告逐字说了这件事）。
 */
function buildWorkspaceOnlyRepo(): IWorkspaceRepository {
  /*
   * ⚠️ token 三级取值与 `createRemoteRepositories` 内部那段**必须同口径**：
   *   ① localStorage `idplan.apiToken`（设置 → NAS 服务里手填，最高优先）
   *   ② 构建期 `VITE_API_TOKEN`
   *   ③ 空串
   *   键名共用 `API_TOKEN_KEY`（不是手打字面量），只有「降级顺序」这三行是复刻。
   *   为什么不干脆把那段抽成导出函数：那要改 rest.client.ts 的公共面，而本批的
   *   所有权只在 `src/di/`；三行的复刻风险低于一次跨文件契约变更。
   */
  const env = import.meta.env as Record<string, string | undefined>;
  const stored =
    typeof localStorage !== 'undefined' ? (localStorage.getItem(API_TOKEN_KEY) ?? '').trim() : '';
  const apiToken = stored || (env.VITE_API_TOKEN ?? '').trim();
  const baseUrl = appEnv.apiBaseUrl.replace(/\/+$/, '');
  /*
   * 空基址必须在这里就抛（而不是让请求打到当前 origin 的 `/workspaces`）：
   * `createRemoteRepositories` 也有同一道校验（`coreErr.remote.baseUrlRequired`），
   * 但本函数**没有走它**（只 new 了一个 RestClient），漏建这道守卫的症状是
   * 「NAS 地址没填时，界面卡在『正在读取工作区…』很久才超时」——失败原因被时间吞掉。
   */
  if (!baseUrl) throw new Error('remote apiBaseUrl is empty');
  return new RemoteWorkspacesRepo(new RestClient(baseUrl, apiToken));
}

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

  const startRepositories = useCallback(async (dbName?: string): Promise<void> => {
    try {
      /*
       * ★ 多工作区（批 4）：工厂现在还要「当前工作区 id」与「工作区列表来源」。
       *   两者都在这里取 —— 本文件在 `src/di/`，读 localStorage 是合法的
       *   （`src/core/**` 才有那条锁，见 tests/arch-boundary.spec.ts）。
       *   · `workspaceId`：remote 用它注入 `X-Workspace-Id`；local 忽略。
       *   · `workspaceListRegistry`：local 的工作区列表来源，工厂把它注进
       *     `LocalWorkspacesRepo`。**必须**在这里给，不能让 core 自己 import
       *     注册表（那会把 localStorage 拖进 core）。
       *   取法与下面 `currentWorkspaceDbName()` 同一个出处（workspace-registry），
       *   保证「库名」与「区 id」永远指向同一个区 —— 两处各自算一遍就会分叉。
       */
      const b = await createRepositories({
        dataSource: appEnv.dataSource,
        apiBaseUrl: appEnv.apiBaseUrl,
        dbName,
        workspaceId: currentWorkspaceIdSync(),
        workspaceListRegistry: () =>
          listWorkspaces().map((w) => ({
            id: w.id,
            name: w.name,
            ownerMemberName: w.ownerMemberName,
            createdAt: w.createdAt,
          })),
      });
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

  /**
   * ★ 多工作区 · 批 5（NAS 首屏选公司）：remote 且本浏览器**没选过区**时的闸。
   *
   * `null` = 还没判定（首帧）；`true` = 需要先选公司（**不建 bundle**）；
   * `false` = 有当前区，走原启动序列。
   *
   * 为什么判据是 `selectedWorkspaceIdSync()`（显式选过）而不是
   * `currentWorkspaceIdSync()`（注册表首项兜底）：后者在 NAS 上永远有值——
   * 注册表是**桌面版分库方案的载体**，它那条 `ws-default` 是懒迁移播下的遗产，
   * 与服务器上有哪些区毫无关系。拿它当判据等于「NAS 版永远认为用户选好了区」，
   * 首批请求全部落到 ws-default。见 `workspace-registry.selectedWorkspaceIdSync`。
   */
  const [needsWorkspacePick, setNeedsWorkspacePick] = useState<boolean | null>(null);
  /** 无区闸用的轻量 repo（只到「选完 reload」为止，不进 Context） */
  const [pickRepo, setPickRepo] = useState<IWorkspaceRepository | null>(null);
  /** 轻量 repo 构造失败（NAS 地址没填 / 动态 import 失败）——不许白屏 */
  const [pickRepoError, setPickRepoError] = useState(false);
  const [pickRepoNonce, setPickRepoNonce] = useState(0);

  /*
   * 无区闸的构造：只在 remote 且没选过区时跑。
   * ⚠️ 与 `repoEpoch` 无关：这一支**不建 bundle**，令牌改了也不影响（选完就 reload）。
   */
  useEffect(() => {
    if (appEnv.dataSource !== 'remote') {
      setNeedsWorkspacePick(false);
      return;
    }
    if (selectedWorkspaceIdSync() !== null) {
      setNeedsWorkspacePick(false);
      return;
    }
    setNeedsWorkspacePick(true);
    setPickRepoError(false);
    try {
      setPickRepo(buildWorkspaceOnlyRepo());
    } catch {
      // NAS 地址没填（`RestClient` 构造前置校验）等装配失败 ⇒ 给可重试的失败面
      setPickRepoError(true);
    }
  }, [pickRepoNonce]);

  useEffect(() => {
    cancelledRef.current = false;
    void (async () => {
      if (appEnv.dataSource === 'local') {
        /*
         * ★ 多工作区 0016：local 模式下所有库级动作都对准**当前工作区**的库。
         *   ensureEntries（首次读取）在注册表缺席时把存量库绑定成 ws-default
         *   （数据零迁移，见 workspace-registry.ts）——此后「当前库名」是
         *   探测 / 闸门 / 建仓储的唯一库名来源；单区用户拿到的是老库名
         *   `changxia`，行为与 0015 逐字节一致。
         */
        const dbName = currentWorkspaceDbName();
        // 探测不到（全新环境）或已是当前版本 → 直接建库，不弹闸门。
        // ★ 判据取自唯一出处 needsPreMigrationBackup（BUG-02）：
        //   detectLocalDbVersion 返回的是**归一后的 Dexie verno**；此前它返回原始
        //   IDB 版本（×10），使这里的 `verno < SCHEMA_VERSION` 恒为 false ——
        //   闸门从不弹出、老库静默升级、没有任何回滚凭据。
        const verno = await detectLocalDbVersion(dbName);
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
        await startRepositories(dbName);
        return;
      }
      /*
       * ★ 批 5：remote 且本浏览器**没选过区** ⇒ **不建 bundle**（否则第一批请求没有
       *   `X-Workspace-Id`，会落到 ws-default 上）。下方渲染段改为先给选公司界面。
       *   判据是**同步**读的（不用 `needsWorkspacePick` 那个 state）：本 effect 与
       *   上面构造轻量 repo 的 effect 在同一次 commit 里跑，靠 state 会有一帧竞态。
       */
      if (selectedWorkspaceIdSync() === null) return;
      await startRepositories();
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [startRepositories, repoEpoch]);

  /** 闸门唯一出口：导出成功才允许升级（无「跳过」选项）。
   *  导出的必须是**当前工作区**那份老库的快照（0016 分库后闸门按区触发）。 */
  const confirmMigrationBackup = useCallback(async (): Promise<void> => {
    setGate('exporting');
    const ok = await exportPreMigrationBackupToFile(currentWorkspaceDbName());
    if (cancelledRef.current) return;
    if (!ok) {
      setGate('failed');
      return;
    }
    setGate(null);
    await startRepositories();
  }, [startRepositories]);

  const value = useMemo(() => bundle, [bundle]);

  /*
   * ★ 批 5 · 无区闸（NAS 首屏选公司）：**在 gate/fatal/bundle 三档之前**判。
   *
   * 顺序为什么必须最前：这一屏的意义是「还没有 bundle」，而 gate（迁移前备份）与
   * fatal（存储/版本不可用）两支描述的**都是本地 Dexie 的病情** —— NAS 形态下
   * 它们本就不执行（见下方 effect 的 `dataSource === 'local'` 分支），state 恒为
   * null，所以放前面不会误挡任何既有分支。
   *
   * 只 return 选公司界面、**不渲染 children**：children 里第一个消费 `useRepos()` 的
   * 组件（AppShell → useProjectsBootstrap）会当场抛「仓储上下文缺失」。
   */
  if (needsWorkspacePick === true) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-cream px-6 py-10">
        {pickRepoError ? (
          <div className="w-[440px] max-w-[92vw] rounded-2xl border border-clay-soft bg-paper p-5 text-center shadow-soft">
            <h1 className="font-display text-display-md text-ink">
              {t('workspace.picker.title')}
            </h1>
            <p className="mt-2 text-[13px] leading-5 text-mist">
              {t('workspace.pick.unreachable')}
            </p>
            <button
              type="button"
              data-workspace-pick-retry=""
              onClick={() => setPickRepoNonce((n) => n + 1)}
              className="mt-4 rounded-full bg-pine px-4 py-2 text-sm font-medium text-paper"
            >
              {t('workspace.picker.retry')}
            </button>
          </div>
        ) : pickRepo === null ? (
          <div
            data-workspace-picker=""
            className="w-[440px] max-w-[92vw] rounded-2xl border border-line bg-paper p-5 shadow-soft"
          >
            <h1 className="font-display text-display-md text-ink">{t('workspace.picker.title')}</h1>
            <p className="mt-2 text-[13px] leading-5 text-mist">{t('workspace.picker.loading')}</p>
          </div>
        ) : (
          <WorkspacePicker repo={pickRepo} />
        )}
      </div>
    );
  }

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
