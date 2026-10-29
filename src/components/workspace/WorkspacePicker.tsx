import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronLeft, Loader2 } from 'lucide-react';

import { ImeInput } from '../common/ImeInput';
import { Button } from '../ui/Button';
import { useLang } from '../../i18n';
import { cn } from '../../lib/cn';
import { reloadApp } from '../../lib/reload';
import { resolveErrorText } from '../../core/types/enums';
import { logError, logUser } from '../../core/services/log.service';
import { appEnv } from '../../config/env';
import {
  addWorkspace,
  currentWorkspaceIdSync,
  markWorkspaceEntryStarted,
  selectedWorkspaceIdSync,
  setCurrentWorkspaceId,
  writeMemberIdForWorkspace,
} from '../../lib/workspace-registry';
import type {
  IWorkspaceRepository,
  WorkspaceSummary,
} from '../../core/repositories/interfaces';

/**
 * 工作区选择器（多工作区 0016 · 首屏与切换的共用 UI）。
 *
 * ── 两个挂载点（都由「没有任何身份」这一屏决定，不重复入口）──
 *   ① `HomePage` 未进入身份时的整页首屏（桌面版恒走这里；NAS 版在「本浏览器已经
 *      选过公司、但还没选身份」以及「退出身份」时走这里）；
 *   ② `RepoProvider` 的 **remote 无区闸**：NAS 版首次打开（本浏览器从没选过公司）
 *      时**不建全量 bundle**（否则第一批数据请求没有 `X-Workspace-Id` 头、会落到
 *      ws-default 上去），改为先渲染本组件让用户选公司。挂载点只有这两处，
 *      两处都传 `repo`。
 *
 * ── ★ 批 5：不再直接 import 任何实现 ──
 *   改之前本文件直接 import 了四组 **local 专属**实现：注册表 `listWorkspaces` /
 *   `addWorkspace`、`createWorkspaceOwnerDb` / `readWorkspaceGateHash` /
 *   `writeWorkspaceGateHash`、`verifyPassword`。后果是 NAS（remote）形态**根本
 *   无法复用这个组件**——它的数据面是 `GET /api/workspaces` 那一套。
 *   现在列表 / 建区 / 闸密三件事**全部经 `IWorkspaceRepository`**（props 注入），
 *   本文件对「数据在哪」一无所知。
 *
 *   ⚠️ **仍留在本文件里的 localStorage 动作是有意保留的**（两种形态同构）：
 *     `setCurrentWorkspaceId` / `writeMemberIdForWorkspace` /
 *     `markWorkspaceEntryStarted` 操作的是**浏览器侧记忆**（本机上次进的是哪个
 *     公司、上次是谁），remote 一样需要它（`X-Workspace-Id` 与「我的身份」都从这里取）。
 *     唯一分形态的是 `addWorkspace`：**local 注册表就是它的数据源**（分库方案下
 *     每条目还带 `dbName`），remote 的区列表在服务端，前端不能也不该往回写。
 *
 * ── 四态视图 ──
 *   list     区列表（名 + Owner 名）+「新建工作区」；
 *   create   建区表单（区名 + Owner 管理员名 + 密码 ≥4 位 + 确认），成功后直接
 *            以 Owner 身份进入空白新区（落区级身份键 → reload）；
 *   password 目标区设过闸密码 ⇒ 切入前验密（`repo.verifyGate`）；
 *   setpw    目标区**还没设过**闸密码 ⇒ 不直接进，先让它设一个（`repo.setGate`）再进入。
 *
 * ── ★ 0017 订正：从列表进入任何区都要验密码 ──
 *   0016 有两处免密放行，都已被产品负责人否掉：
 *     ① 同区（= 当前区）短路不验 —— 删。哪怕它就是当前区，从列表进入也要验；
 *     ② 区没设过密码就「无可验之物直接进」 —— 改成先设密码（见 setpw 视图）。
 *   验密通过后：非当前区走 enterWorkspace（切库 + reload）；**当前区**不重载，
 *   回调 onEnterCurrentWorkspace 回身份引导。
 *
 * ── 为什么切换走整页 reload ──
 *   桌面版分库后仓储 bundle 绑定的是「启动那一刻」的库；NAS 版契约同形（工作区 id
 *   在建 bundle 那一刻就注入了 `X-Workspace-Id`）。区切换两类都要重新装配最省心也
 *   最不出错（身份键、settings KV、僵尸执行恢复全部按新区重来）。本应用是 Electron
 *   壳没有地址栏，reload 对用户就是一次正常的启动。
 */

type View = 'list' | 'create' | 'password' | 'setpw';

/**
 * 列表骨架占位（**不是**加载圈）：文案说清正在读什么，不闪一张空列表。
 *
 * 为什么导出：`RepoProvider` 的 remote 无区闸在「轻量 repo 还没构造好」的那一瞬
 * 需要一个同样的占位 —— 两处各写一句就是第二份文案来源。
 */
export function WorkspaceListLoading(): JSX.Element {
  const { t } = useLang();
  return (
    <p
      data-workspace-list-loading=""
      aria-busy="true"
      className="py-4 text-center text-[13px] leading-5 text-mist"
    >
      {t('workspace.picker.loading')}
    </p>
  );
}

/**
 * 列表读取失败面（**空数组 ≠ 读取失败**：这是本仓审计反复强调的那条纪律）。
 *
 * 为什么必须是一个「明说的失败」而不是静默退回身份引导：NAS 上「列表读不到」的
 * 真因是网络/服务端，而被退回引导的用户会以为「这台 NAS 上没有公司」，于是去建
 * 一个重名的新区 —— 那是比一次明确的失败糟得多的结局。
 */
export function WorkspaceListError({ onRetry }: { onRetry(): void }): JSX.Element {
  const { t } = useLang();
  return (
    <div
      data-workspace-list-error=""
      className="rounded-xl border border-clay-soft bg-paper p-4 text-center"
    >
      <p className="text-[13px] font-medium text-ink">{t('workspace.picker.loadFailed')}</p>
      <p className="mx-auto mt-1 max-w-[320px] text-[12px] leading-5 text-mist">
        {t('workspace.picker.loadFailedHint')}
      </p>
      <button
        type="button"
        data-workspace-list-retry=""
        onClick={onRetry}
        className="mt-3 rounded-md bg-pine px-4 py-1.5 text-sm text-white transition-colors hover:bg-pine-deep"
      >
        {t('workspace.picker.retry')}
      </button>
    </div>
  );
}

export function WorkspacePicker({
  repo,
  workspaces,
  onEnterCurrentWorkspace,
}: {
  /**
   * 工作区能力仓储（**唯一**数据面）。
   *
   * ⚠️ 类型上是 `IWorkspaceRepository`，取用时调用方给的是 `repos.workspaces!`
   * （`IRepositoryBundle.workspaces` 声明为可选，见 interfaces.ts 的理由；
   * 运行期齐备由 `tests/workspace-repository.spec.ts` 的 A1/A2 钉住）。
   */
  repo: IWorkspaceRepository;
  /**
   * 已经取到的区列表。给了就**不再自己取**（`HomePage` 为了判定首屏档位已经取过一次，
   * 组件再取一遍就是两次请求）；不给则本组件自己 `repo.list()` 并自带三态。
   */
  workspaces?: WorkspaceSummary[];
  /** 选中了「当前区」且验密通过 ⇒ 回身份引导（不 reload） */
  onEnterCurrentWorkspace?: () => void;
}): JSX.Element {
  const { t } = useLang();
  const remote = appEnv.dataSource === 'remote';
  /*
   * 「当前所在」的判据：
   *   · 桌面版 = 当前库对应的区（`currentWorkspaceIdSync()`，注册表首项兜底）；
   *   · NAS 版 = **本浏览器显式选过**的区（`selectedWorkspaceIdSync()`，没选过 ⇒ null）。
   *     不能用前者：`currentWorkspaceIdSync()` 在 remote 下会回落到桌面版遗产
   *     `ws-default`，于是服务端上那个同名区会被标成「当前所在」，而它其实只是
   *     注册表懒迁移播下的一条本地记录 —— 一旦用户点它，就会命中「当前区不 reload」
   *     的短路，而 NAS 那边根本没有对应的 bundle，界面会卡在原地。
   */
  const currentId = remote ? selectedWorkspaceIdSync() : currentWorkspaceIdSync();
  /**
   * 区列表三态来源：
   *   给了 `workspaces` ⇒ 恒用它（调用方已取过，且它自己要负责 loading/error 两档）；
   *   没给 ⇒ 自己 `repo.list()`，`rows === null && !loadFailed` 就是「正在读」。
   */
  const [rows, setRows] = useState<WorkspaceSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const [view, setView] = useState<View>('list');
  /** password 态：目标区 */
  const [gateTarget, setGateTarget] = useState<WorkspaceSummary | null>(null);
  const [gatePw, setGatePw] = useState('');
  const [gateNotice, setGateNotice] = useState<string | null>(null);
  /** setpw 态：目标区（还没设过闸密码的区） */
  const [setPwTarget, setSetPwTarget] = useState<WorkspaceSummary | null>(null);
  const [setPw, setSetPw] = useState('');
  const [setPwConfirm, setSetPwConfirm] = useState('');
  const [setPwNotice, setSetPwNotice] = useState<string | null>(null);

  // 建区表单
  const [wsName, setWsName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [createPw, setCreatePw] = useState('');
  const [createPwConfirm, setCreatePwConfirm] = useState('');
  const [createNotice, setCreateNotice] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  /** 自取列表（仅在调用方没给 `workspaces` 时跑；`loadNonce` 是重试入口） */
  useEffect(() => {
    if (workspaces !== undefined) return;
    let cancelled = false;
    setLoadFailed(false);
    setRows(null);
    void (async () => {
      try {
        const list = await repo.list();
        if (!cancelled) setRows(list);
      } catch (err) {
        if (cancelled) return;
        setLoadFailed(true);
        logError('工作区', 'list workspaces failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, workspaces, loadNonce]);

  const retryLoad = useCallback((): void => setLoadNonce((n) => n + 1), []);

  /** 展示用列表（`workspaces` 优先；否则自取结果） */
  const list: WorkspaceSummary[] | null = workspaces ?? rows;

  /** list↔create↔password 互切时的表单残留清理（一个出口，防漏字段） */
  const resetForms = (): void => {
    setGateTarget(null);
    setGatePw('');
    setGateNotice(null);
    setSetPwTarget(null);
    setSetPw('');
    setSetPwConfirm('');
    setSetPwNotice(null);
    setWsName('');
    setOwnerName('');
    setCreatePw('');
    setCreatePwConfirm('');
    setCreateNotice(null);
  };

  /** 进入目标区（验密通过 / 设好密码的共同出口）：落标记 → reload 换库/换头 */
  const enterWorkspace = (ws: WorkspaceSummary): void => {
    setCurrentWorkspaceId(ws.id);
    // 「进入某区的流程已开始」：reload 后首屏给身份引导而不是区列表（桌面版口径）。
    markWorkspaceEntryStarted();
    logUser('工作区', `switch: enter "${ws.name}" (${ws.id})`);
    reloadApp();
  };

  /*
   * ★ 0017：从列表进入**任何**工作区都要过密码这一关（含当前区）。
   *   ① 同区不再短路——删掉 0016 的 `ws.id === currentId` 免密分支；
   *   ② 目标区还没设过闸密码 ⇒ 不直接进，先给它设一个（setpw 视图）。
   */
  const pick = async (ws: WorkspaceSummary): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const { hasGate } = await repo.gateOf(ws.id);
      if (!hasGate) {
        // 该区没设过任何管理员密码（老区/未设密码的区）⇒ 先设一个再进
        setSetPwTarget(ws);
        setSetPw('');
        setSetPwConfirm('');
        setSetPwNotice(null);
        setView('setpw');
        return;
      }
      setGateTarget(ws);
      setGatePw('');
      setGateNotice(null);
      setView('password');
    } catch (err) {
      // 读不到闸密设置（网络/服务端故障）≠「没有密码」：不许静默走 setpw（那会给
      // 一个**本来有密码**的区设上新密码，等于绕过它）。
      setGateNotice(resolveErrorText(err, t, t('workspace.picker.loadFailed')));
      logError('工作区', `read gate failed: "${ws.name}" (${ws.id})`, err);
    } finally {
      setBusy(false);
    }
  };

  const submitGate = async (): Promise<void> => {
    if (busy || !gateTarget || !gatePw) return;
    setBusy(true);
    try {
      const ok = await repo.verifyGate(gateTarget.id, gatePw);
      if (!ok) {
        setGateNotice(t('workspace.gate.wrong'));
        return;
      }
      // 当前区：库/请求头已经装好了，不必 reload，回身份引导即可；跨区才换库 reload。
      if (gateTarget.id === currentId) {
        onEnterCurrentWorkspace?.();
        return;
      }
      enterWorkspace(gateTarget);
    } catch (err) {
      // ★ 验密**抛错**＝真故障（NAS 连不上 / 5xx），不是密码不对。
      //   `RemoteWorkspacesRepo.verifyGate` 只把 401 吞成 false，其余照抛 —— 那一处
      //   的注释写明了理由：把网络故障显示成「密码不对」会让人一直重输密码。
      setGateNotice(resolveErrorText(err, t, t('workspace.gate.verifyFailed')));
      logError('工作区', `verify gate failed: "${gateTarget.name}" (${gateTarget.id})`, err);
    } finally {
      setBusy(false);
    }
  };

  /** 给「还没设过闸密码」的目标区设密码：校验 → `repo.setGate` → 进入 */
  const submitSetPw = async (): Promise<void> => {
    if (busy || !setPwTarget) return;
    if (setPw.length < 4) {
      setSetPwNotice(t('ui.identity.pw.tooShort'));
      return;
    }
    if (setPw !== setPwConfirm) {
      setSetPwNotice(t('ui.identity.pw.mismatch'));
      return;
    }
    setBusy(true);
    try {
      /*
       * ⚠️ 这里**不用** `resolveErrorText`：两种形态的失败原因（local 是
       * 「没写进本地库」、remote 是服务端拒绝）对用户的下一步动作是同一句
       * 「设置工作区密码失败，请重试」，而 local 的 coreErr 文案在 remote 下是假话
       * （NAS 上没有「本地数据库」这回事）。宁可少说一句实现细节，也不说错一句。
       */
      await repo.setGate(setPwTarget.id, setPw);
      logUser('工作区', `set gate password for "${setPwTarget.name}" (${setPwTarget.id})`);
      if (setPwTarget.id === currentId) {
        onEnterCurrentWorkspace?.();
        return;
      }
      enterWorkspace(setPwTarget);
    } catch (err) {
      setSetPwNotice(t('workspace.setpw.failed'));
      logError('工作区', `set gate password failed: "${setPwTarget.name}"`, err);
    } finally {
      setBusy(false);
    }
  };

  /** 建区：校验 → `repo.create` → （local）注册表 → 区级身份键 → 切区 → reload */
  const submitCreate = async (): Promise<void> => {
    if (busy) return;
    const name = wsName.trim();
    const owner = ownerName.trim();
    if (!name) {
      setCreateNotice(t('workspace.create.nameRequired'));
      return;
    }
    if (!owner) {
      setCreateNotice(t('workspace.create.ownerRequired'));
      return;
    }
    if (createPw.length < 4) {
      setCreateNotice(t('ui.identity.pw.tooShort'));
      return;
    }
    if (createPw !== createPwConfirm) {
      setCreateNotice(t('ui.identity.pw.mismatch'));
      return;
    }
    setBusy(true);
    try {
      /*
       * `repo.create` 两种形态都返回 `{ id, ownerMemberId }`：
       *   · local  —— `ws-<uuid>` + 建库 + Owner 入库；
       *   · remote —— 服务端建区，id 由服务端给，`ownerMemberId` 是那个区库里的 Owner。
       * 于是「建区即以 Owner 身份进入」这条产品口径**不需要分形态**。
       */
      const { id, ownerMemberId } = await repo.create({
        name,
        ownerName: owner,
        password: createPw,
      });
      /*
       * ★ 注册表只在 local 回写（`addWorkspace`）：桌面版的分库方案里注册表**就是**
       *   区列表的数据源，且每条目要带 `dbName`（`id` 的命名约定推导，与
       *   `LocalWorkspacesRepo` / `workspace-registry` 建区口径逐字一致）。
       *   NAS 版的区列表在服务端（`GET /api/workspaces`），前端回写本地注册表只会
       *   留下一条服务端并不存在的幽灵区，且 Owner 名该由服务端派生（`ownerMemberName`），
       *   前端不该自己写一份。
       */
      if (!remote) {
        addWorkspace({
          id,
          name,
          createdAt: new Date().toISOString(),
          ownerMemberName: owner,
          dbName: `idplan-${id}`,
        });
      }
      // 直接以 Owner 身份进入：reload 前把身份记忆写到**新区**的区级键
      writeMemberIdForWorkspace(id, ownerMemberId);
      setCurrentWorkspaceId(id);
      markWorkspaceEntryStarted();
      logUser('工作区', `create: "${name}" (${id})`);
      reloadApp();
    } catch (err) {
      setCreateNotice(resolveErrorText(err, t, t('workspace.create.failed')));
      logError('工作区', `create failed: "${name}"`, err);
      setBusy(false);
    }
  };

  const backToList = (): void => {
    resetForms();
    setView('list');
  };

  const toCreate = (): void => {
    resetForms();
    setView('create');
  };

  const body = (
    <div
      data-workspace-picker=""
      className={cn(
        'space-y-4 rounded-2xl p-5',
        'glass-strong iridescent-border w-[440px] max-w-[92vw] shadow-soft',
      )}
    >
      <div className="flex items-center gap-2">
        {view !== 'list' && (
          <button
            type="button"
            onClick={backToList}
            aria-label={t('workspace.backAria')}
            className="rounded-md p-1 text-mist transition-colors hover:bg-sand hover:text-ink"
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
        )}
        <h2 className="font-display text-display-md text-ink">
          {view === 'list'
            ? t('workspace.picker.title')
            : view === 'create'
              ? t('workspace.create.title')
              : view === 'setpw'
                ? t('workspace.setpw.title')
                : t('workspace.gate.title')}
        </h2>
      </div>

      {view === 'list' && (
        <>
          <p className="text-[13px] leading-5 text-mist">{t('workspace.picker.lead')}</p>
          {loadFailed ? (
            <WorkspaceListError onRetry={retryLoad} />
          ) : list === null ? (
            <WorkspaceListLoading />
          ) : (
            <>
              <ul className="space-y-2" data-workspace-list="">
                {list.map((ws) => {
                  const isCurrent = ws.id === currentId;
                  return (
                    <li key={ws.id}>
                      <button
                        type="button"
                        data-workspace-item={ws.id}
                        disabled={busy}
                        onClick={() => void pick(ws)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                          'border-line bg-paper hover:border-pine hover:bg-sand',
                          'outline-none focus-visible:ring-2 focus-visible:ring-pine/40',
                          isCurrent && 'border-pine/60',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[14px] font-medium text-ink">{ws.name}</span>
                            {isCurrent && (
                              <>
                                <Check size={13} className="shrink-0 text-pine" aria-hidden />
                                <span className="shrink-0 text-[11px] text-pine">{t('workspace.currentTag')}</span>
                              </>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-[12px] text-mist">
                            {t('workspace.ownerLine', { name: ws.ownerMemberName ?? '—' })}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <Button
                variant="secondary"
                className="w-full"
                onClick={toCreate}
                data-workspace-new=""
                disabled={busy}
              >
                {t('workspace.picker.newAction')}
              </Button>
            </>
          )}
        </>
      )}

      {view === 'create' && (
        <div className="space-y-3">
          <p className="text-[13px] leading-5 text-mist">{t('workspace.create.lead')}</p>
          <label className="block space-y-1">
            <span className="text-[12px] text-mist">{t('workspace.create.nameLabel')}</span>
            <ImeInput
              value={wsName}
              onChange={(e) => {
                setWsName(e.target.value);
                setCreateNotice(null);
              }}
              placeholder={t('workspace.create.namePlaceholder')}
              data-workspace-name-input=""
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[12px] text-mist">{t('workspace.create.ownerLabel')}</span>
            <ImeInput
              value={ownerName}
              onChange={(e) => {
                setOwnerName(e.target.value);
                setCreateNotice(null);
              }}
              placeholder={t('workspace.create.ownerPlaceholder')}
              data-workspace-owner-input=""
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[12px] text-mist">{t('workspace.create.pwLabel')}</span>
            <ImeInput
              type="password"
              value={createPw}
              onChange={(e) => {
                setCreatePw(e.target.value);
                setCreateNotice(null);
              }}
              placeholder={t('workspace.create.pwPlaceholder')}
              data-workspace-pw-input=""
              disabled={busy}
              autoComplete="new-password"
              className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
            />
          </label>
          <ImeInput
            type="password"
            value={createPwConfirm}
            onChange={(e) => {
              setCreatePwConfirm(e.target.value);
              setCreateNotice(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submitCreate();
              }
            }}
            placeholder={t('workspace.create.pwConfirmPlaceholder')}
            data-workspace-pw-confirm=""
            disabled={busy}
            autoComplete="new-password"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
          />
          {createNotice && <p className="text-xs text-clay">{createNotice}</p>}
          <Button className="w-full" onClick={() => void submitCreate()} disabled={busy} data-workspace-create-submit="">
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" aria-hidden />
                {t('workspace.create.submitting')}
              </span>
            ) : (
              t('workspace.create.submit')
            )}
          </Button>
        </div>
      )}

      {view === 'password' && gateTarget && (
        <div className="space-y-3">
          <p className="text-[13px] leading-5 text-mist">
            {t('workspace.gate.lead', { name: gateTarget.name })}
          </p>
          <ImeInput
            type="password"
            value={gatePw}
            onChange={(e) => {
              setGatePw(e.target.value);
              setGateNotice(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submitGate();
              }
            }}
            placeholder={t('workspace.gate.inputPlaceholder')}
            data-workspace-gate-input=""
            disabled={busy}
            autoComplete="current-password"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
          />
          {gateNotice && <p className="text-xs text-clay">{gateNotice}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={backToList}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void submitGate()}
              disabled={busy || !gatePw}
              data-workspace-gate-submit=""
              className="rounded-md bg-pine px-4 py-1.5 text-sm text-white transition-colors hover:bg-pine-deep disabled:opacity-50"
            >
              {t('workspace.gate.submit')}
            </button>
          </div>
        </div>
      )}

      {view === 'setpw' && setPwTarget && (
        <div className="space-y-3">
          <p className="text-[13px] leading-5 text-mist">
            {t('workspace.setpw.lead', { name: setPwTarget.name })}
          </p>
          <label className="block space-y-1">
            <span className="text-[12px] text-mist">{t('workspace.create.pwLabel')}</span>
            <ImeInput
              type="password"
              value={setPw}
              onChange={(e) => {
                setSetPw(e.target.value);
                setSetPwNotice(null);
              }}
              placeholder={t('workspace.create.pwPlaceholder')}
              data-workspace-setpw-input=""
              disabled={busy}
              autoComplete="new-password"
              className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
            />
          </label>
          <ImeInput
            type="password"
            value={setPwConfirm}
            onChange={(e) => {
              setSetPwConfirm(e.target.value);
              setSetPwNotice(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submitSetPw();
              }
            }}
            placeholder={t('workspace.create.pwConfirmPlaceholder')}
            data-workspace-setpw-confirm=""
            disabled={busy}
            autoComplete="new-password"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-pine"
          />
          {setPwNotice && <p className="text-xs text-clay">{setPwNotice}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={backToList}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void submitSetPw()}
              disabled={busy || !setPw || !setPwConfirm}
              data-workspace-setpw-submit=""
              className="rounded-md bg-pine px-4 py-1.5 text-sm text-white transition-colors hover:bg-pine-deep disabled:opacity-50"
            >
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                  {t('workspace.setpw.submitting')}
                </span>
              ) : (
                t('workspace.setpw.submit')
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return <div className="flex min-h-[50vh] items-start justify-center pt-6">{body}</div>;
}
