/**
 * `Project.domain`（主板块）的**值域白名单** —— 服务端侧的唯一出口。
 *
 * ── 为什么要有这个文件（而不是各处自己写一份数组）──
 * `domain` 的合法取值**已经有一个出处**：`templates/stage-library.json` 经
 * `src/core/template/stage-library.ts::getUsableDomains()` 算出的「可用主板块」
 * （口径 = 出现在 `industryGroups` 里 **且** 阶段库里至少有一个阶段项）。
 * 服务端**不得**再抄一份字面量数组：本仓判据「同一个事实不许有两个出处」，
 * 抄一份的典型症状是「JSON 新增板块后服务端仍拒收它」。
 *
 * 本模块只做三件**转接**的事，不新增规则：
 *   ① 把 `getUsableDomains()` 暴露成服务端可用的取值清单；
 *   ② 提供「是不是合法 domain」的判定（入参放宽为 `string`，须能测「不在白名单」）；
 *   ③ 提供**统一措辞**的拒收理由（哪个值不合法 + 合法值全表），供 PATCH / 建档 /
 *      备份导入三条通道共用一份文案。
 *
 * ── 为什么服务端可以 import `src/core/template/stage-library.ts` ──
 * 该文件已在 `server/tsconfig.json` 的 `include` 里**显式列出**，且 `server/routes/agent.routes.ts`
 * 早在 v0.8 就经相对路径消费它（建板的阶段骨架 = 同一份 JSON）。它是纯模块（只 import
 * 类型 + 该 JSON，零 DOM、零 Node），故服务端 typecheck 与 `tsx` 直跑均无问题。
 * **相对路径 import**（不是 `@core/*` alias）是硬约束：`tsx` 不读 tsconfig 的 `paths`。
 *
 * ── 为什么「越界值」必须拒收，而不是归一化 ──
 * 拒收/归一化的取舍是产品裁决（team-lead 2026-10-14 拍板：**拒收**），技术后果如实记在这里：
 *   · 看板列集合由 `deriveColumns()`（`src/pages/HomePage.tsx`）**遍历内置行业**派生。
 *     库里若只有越界值，`used` 非空 ⇒ 「至少 indoor」的保险不触发，而遍历又找不到该值
 *     ⇒ **一个行业列都派生不出来**（整行只剩 `todo` 一个列盒），且分桶回落把项目塞进末列
 *     （实测：`in_progress` 的项目被算进 `todo`）。代价是**计数与筛选同时错**，不是排版瑕疵。
 *   · 建档 UI（`IndustrySelect` / `DomainCascade`）的候选**就是** `getUsableDomains()`，
 *     用户根本选不出越界值 ⇒ 能落库的越界值只能来自「绕过 UI 的调用方」或「手改的/脏备份包」。
 *   · 已知副作用（产品负责人已接受）：含脏值的老备份包会**导不进来**，故两条备份通道的
 *     错误文案必须定位到**具体记录**（第几条 / 项目 id），而不是笼统的「导入失败」。
 */

import { getUsableDomains } from '../../src/core/template/stage-library';

/** 合法主板块取值（顺序 = `getUsableDomains()` 声明序；来源见文件头） */
export function usableProjectDomains(): readonly string[] {
  // 放宽为 `readonly string[]`：`getUsableDomains()` 返回窄的 `StageTemplateDomain[]`，
  // 而判定函数必须吃得下任意 `string` 才能测「不在白名单」。放宽的是**调用点的类型**，
  // 不是白名单本身 —— 与 `isProjectKind()` 的处置逐字同源（projects.routes.ts）。
  return getUsableDomains() as readonly string[];
}

/** 值域判定：`null`（= 清除/未确认）由调用方单独放行，本函数只判字符串。 */
export function isProjectDomain(value: string): boolean {
  return usableProjectDomains().includes(value);
}

/** 合法值的可读清单（错误文案里给用户照抄） */
export function usableProjectDomainsText(): string {
  const all = usableProjectDomains();
  return `${all.join(' / ')}（共 ${all.length} 个）`;
}

/**
 * 单条拒收理由（PATCH / 建档共用）。`prefix` 用于把上下文写进同一句话，例如
 * `'备份导入被拒绝（库未改动）。'`。
 */
export function projectDomainRejection(value: unknown, prefix = ''): string {
  return (
    `${prefix}主板块 domain 只接受 ${usableProjectDomainsText()}，` +
    `或显式 null（= 清除，回到读时回落）；收到「${String(value)}」。`
  );
}

/** 备份包内的一条越界记录（定位用：1 基序号 + 项目 id + 实际值） */
export interface DomainOffender {
  /** 在 `data.projects` 里的**1 基**序号（用户可数得出来） */
  index: number;
  id: string;
  value: unknown;
}

/**
 * 扫一份备份包的项目行，收集所有越界 domain。
 *
 * ⚠️ 只**读**、不改：产品口径是「拒收」而不是「清洗数据」（清洗会静默改写用户数据，
 * 且让「越界值从哪来」这条线索永久消失）。
 * 入参用 `unknown` 形状而非 `Project[]`：本函数服务于**未校验**的请求体
 * （`POST /api/backup/import` 直连时包内形状不由我们保证）。
 */
export function findDomainOffenders(rows: readonly Record<string, unknown>[]): DomainOffender[] {
  const out: DomainOffender[] = [];
  rows.forEach((row, i) => {
    const value = row.domain;
    // 缺键 / 显式 null = 「未确认」，合法（老备份本就没有这个键）
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && isProjectDomain(value)) return;
    out.push({ index: i + 1, id: String(row.id ?? '(缺 id)'), value });
  });
  return out;
}

/** 把越界记录渲染成「第 N 条项目（id=…）的行业值「X」不合法」列表（分号连接） */
export function describeDomainOffenders(offenders: readonly DomainOffender[]): string {
  return offenders
    .map((o) => `第 ${o.index} 条项目（id=${o.id}）的行业值「${String(o.value)}」不合法`)
    .join('；');
}
