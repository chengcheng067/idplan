import { create } from 'zustand';

import type { IRepositoryBundle } from '../core/repositories/interfaces';
import { ALL_REST_POLICIES, MemberRoleKind, RestPolicyKind } from '../core/types/enums';
import { DEFAULT_REST_POLICY } from '../core/types/entities';
import type { RestPolicyConfig } from '../core/types/entities';
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
   */
  const currentMemberId =
    localStorage.getItem('changxia.currentMemberId') ??
    readCurrentMemberFromSettings(settings) ??
    null;
  const restPolicy = readRestPolicyFromSettings(settings);

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

/** 把任意解析结果收敛成合法 RestPolicyConfig；无法识别时回落默认值 */
function normalizeRestPolicy(raw: unknown): RestPolicyConfig {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_REST_POLICY;
  const { kind, anchorWeek, extraHolidays, extraWorkdays } = raw as Record<string, unknown>;
  if (!ALL_REST_POLICIES.includes(kind as RestPolicyKind)) return DEFAULT_REST_POLICY;
  return {
    kind: kind as RestPolicyKind,
    anchorWeek: typeof anchorWeek === 'string' ? anchorWeek : null,
    extraHolidays: Array.isArray(extraHolidays)
      ? extraHolidays.filter((d): d is string => typeof d === 'string')
      : undefined,
    extraWorkdays: Array.isArray(extraWorkdays)
      ? extraWorkdays.filter((d): d is string => typeof d === 'string')
      : undefined,
  };
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
