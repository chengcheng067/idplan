import { create } from 'zustand';

import type { IRepositoryBundle } from '../core/repositories/interfaces';
import { MemberRoleKind } from '../core/types/enums';
import { DEFAULT_REST_POLICY } from '../core/types/entities';
import type { RestPolicyConfig } from '../core/types/entities';
import { normalizeRestPolicy } from '../core/holidays/policy';
import { useRepoContext } from '../di/repository.provider';
import { useProjectsStore } from '../store/useProjectsStore';
import { useMembersStore } from '../store/useMembersStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { normalizeLegacyMemberRoles } from './useRoleGuard';

/**
 * 业务代码唯一取数入口（铁律 4）。
 * 依赖 react 组件树 Context —— 只能在组件/自定义 hook 内调用，
 * service 层经由 store action 或 React 层注入的 bundle 工作。
 *
 * ── v0.8 隔离守卫白名单（T04 §7.2 第 1 项，**本文件不参与隔离过滤**） ──
 * 本文件（尤其 `bootstrapAllStores`）是**唯一**被允许「全量读入 projects / stages / tasks」
 * 的应用层入口：v0.8 的隔离设计是「**全量读入 → 单一谓词出口分流**」
 * （PRD N11），过滤本身发生在 `src/core/project/visibility.ts` 的出口，不在取数层。
 * ⇒ 若 T04 的 `tests/isolation-guard.spec.ts` 在本文件命中「未过滤的全量读」，
 *   那是**预期命中（白名单内）**，请在此文件补白名单登记，**不要**在取数层加过滤 ——
 *   在取数层过滤会让 Agent 侧同样读不到数据，两个工作区一起变空。
 *
 * v0.8 另注：自定义阶段库走 `settings` KV（键 `customStages`），读写唯一出口是
 * `src/core/services/custom-stage.service.ts`；本文件的 settings 装配**不需要任何改动**。
 */
export function useRepos(): IRepositoryBundle {
  return useRepoContext();
}

/** 首屏装载完成后的整体引导（useProjectsBootstrap 的核心动作包装） */
export async function bootstrapAllStores(repos: IRepositoryBundle): Promise<void> {
  const [projects, stages, tasks, members, settings] = await Promise.all([
    repos.projects.list({ status: 'all' }),
    loadAllStages(repos),
    repos.tasks.list(),
    repos.members.list(true),
    repos.settings.all(),
  ]);

  const restPolicy = readRestPolicyFromSettings(settings);

  /**
   * v0.8.6 身份来源优先级**反转**（她 10-04 授权重新设计 NAS 使用逻辑）。
   *
   * 原顺序：`settings.currentMemberId ?? localStorage` —— **共享 KV 优先于个人选择**。
   * 在 NAS 形态下这是「A 改身份影响 B」的机制：settings 表全员共享，里面只要有值，
   * 每个浏览器打开都会被它盖掉自己选过的身份 ⇒ 多人共用时身份串味。
   *
   * 新顺序：`localStorage ?? settings` —— **个人选择优先**，共享 KV 只在
   * 「本浏览器从未选过身份」时兜底一次（老库/备份导入带进来的遗留值）。
   * remote 形态下 localStorage 天然按浏览器隔离 ⇒ NAS 上「每人一个身份」成立，
   * 且不需要新表、不需要服务端会话（她明确说可以不沿用旧单机逻辑重设计）。
   *
   * ★ 下面的**存在性校验**不改变这条优先级，只淘汰「指向查无此人的 id」的候选档。
   */
  /**
   * 身份「存在性」校验（身份悬挂修复 · 2026-10-14）。
   *
   * ── 修的是什么 ──
   * 上面那条优先级阶梯的**任何一档都可能是悬挂的**：`members` 表会被**覆盖式导入**
   * （`BackupService.importAndReplace`：整表清空再插包内行）整张换掉，而浏览器
   * `localStorage` 里那份**还在**（导入后 `window.location.reload()`，没人清过它）；
   * 同理 settings KV 里也可能是**异机备份带过来的**、在**本库**查无此人的 id。
   *
   * 悬挂的后果不是报错而是**静默**：`deriveRoleGuardState` 查无此人 ⇒ `role = null`
   * ⇒ 用户被当成「未进入身份」（受限视图）；而 `useFirstRunGate` 要求
   * `currentMemberId === null` 才自动弹引导 ⇒ 这里非 null ⇒ 既不入身份、也不提示。
   * 更糟的是 `FirstRunGuide` 的「身份流是否走完」信号就是 `localStorage 非空`
   * ⇒ 那个本该确立身份的欢迎卡也被**一并压掉**。用户看到的只是「我的身份悄悄没了」。
   *
   * ── 判据为什么是「存在」而不是「active」──
   * `list(true)` 含**停用**成员，故命中即可。**刻意不看 `active`**：
   * 「当前成员被停用」在改造前会保持 id 不清、等管理员**重新启用**后自动恢复；
   * 若这里按 active 淘汰，那个恢复路径会被悄悄掐断 —— 那是本次修复范围之外的行为变更。
   * 「active 才算进入身份」的口径本来就只在 `deriveRoleGuardState` 一处，保持不动。
   *
   * ── 为什么必须**清掉**而不是只传 null ──
   * 下游 `useSettingsStore.hydrate()` 是 `currentMemberId ?? readLocalStorageId()`
   * ⇒ 只传 null 会让它把那份悬挂的 localStorage **再读回来**，修复等于没做。
   * 清空走 store 自己的 action（`setCurrentMember(null)`），**不在本文件手写那个键名**
   * —— 键名的唯一出处是 `useSettingsStore.ts` 的 `LS_KEY`。
   *
   * ── 刻意**不**做的两件事 ──
   * · **不**把兜底值写回 localStorage：那会把「共享 KV 只兜底一次」悄悄升级成
   *   「本浏览器从此有了个人选择」，属身份优先级语义变更，本轮不动。
   * · **不**改 `active` 口径：命中即算存在（见上），`deriveRoleGuardState` 仍是
   *   「active 才算进入身份」的唯一出处。
   */
  const memberIds = new Set(members.map((m) => m.id));
  const pickValidId = (...candidates: Array<string | null>): string | null =>
    candidates.find((id): id is string => id !== null && memberIds.has(id)) ?? null;
  // 候选阶梯与 v0.8.6 口径逐字一致（个人选择优先、共享 KV 兜底），只是每一档要**命中**当前成员
  const lsCandidate = localStorage.getItem('changxia.currentMemberId');
  const currentMemberId = pickValidId(lsCandidate, readCurrentMemberFromSettings(settings));
  if (currentMemberId === null || currentMemberId !== lsCandidate) {
    /*
     * 命中这个条件 = 「最终采用的身份不是本机那份」⇒ 本机那份必须失效。两种情形都在这：
     *   · 它**悬挂**（覆盖式导入换掉了整张 members 表 / 异机备份带来的 id）⇒ 别留僵尸：
     *     每次启动都会被过滤掉，却一直躺着；而 `FirstRunGuide` 用「LS 非空」当
     *     「身份流已走完」的信号 ⇒ 它会继续把欢迎卡压掉。
     *   · 或两档都淘汰（最终为 null）⇒ 也清掉，否则下游 hydrate 会把它读回来。
     */
    useSettingsStore.getState().setCurrentMember(null);
  }

  // LOW-2 迁移：旧成员行 roleKind 归一（undefined→member；当前用户且系统无 admin 时恢复 admin）
  const memberList = normalizeLegacyMemberRoles(members, currentMemberId);
  const legacyRows = members.filter((m) => m.roleKind === undefined);
  if (legacyRows.length > 0) {
    // 一次性持久化回 Dexie（失败不影响本次会话——内存已归一，下次启动重试）
    void Promise.allSettled(
      legacyRows.map((m) => {
        const roleKind =
          memberList.find((x) => x.id === m.id)?.roleKind ?? MemberRoleKind.Member;
        return repos.members.update(m.id, { roleKind }).catch(() => undefined);
      }),
    );
  }

  useProjectsStore.getState().replaceAll({ projects, stages, tasks });
  useMembersStore.getState().setAll(memberList);
  // 先注入休息制度再置 hydrated，保证消费方看到 hydrated=true 时口径已就绪
  useSettingsStore.getState().setRestPolicy(restPolicy);
  useSettingsStore.getState().hydrate(currentMemberId);
}

async function loadAllStages(
  repos: IRepositoryBundle,
): Promise<import('../core/types/entities').Stage[]> {
  const projects = await repos.projects.list({ status: 'all' });
  const chunks = await Promise.all(projects.map((p) => repos.stages.listByProject(p.id)));
  return chunks.flat();
}

/**
 * 读取休息制度（settings 表 key='restPolicy'）。
 * 缺失、JSON 损坏、形状不符一律静默回落 DEFAULT_REST_POLICY——制度读不出来不该拦住首屏。
 *
 * 法定节假日（skipHolidays）的合并**不在这里做**：落 store 的仍是用户手填的原始值，
 * 合并发生在 useSettingsStore.setRestPolicy 的派生（hydrate 边界，见 core/holidays/policy.ts）。
 */
function readRestPolicyFromSettings(
  rows: Array<{ key: string; valueJson: string }>,
): RestPolicyConfig {
  for (const row of rows) {
    if (row.key !== 'restPolicy') continue;
    try {
      return normalizeRestPolicy(JSON.parse(row.valueJson));
    } catch {
      return DEFAULT_REST_POLICY;
    }
  }
  return DEFAULT_REST_POLICY;
}

function readCurrentMemberFromSettings(
  rows: Array<{ key: string; valueJson: string }>,
): string | null {
  for (const row of rows) {
    if (row.key === 'currentMemberId') {
      try {
        const v = JSON.parse(row.valueJson);
        return typeof v === 'string' ? v : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}
