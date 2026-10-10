// @vitest-environment jsdom
/**
 * 侧栏「打印页互斥」路由层（R20 保险 ①）· 纯函数锁。
 *
 * ── 这条用例补的是什么缺口 ──
 * `Sidebar` 的打印路由判定（原 `PRINT_ROUTE_RE.test(pathname)`）与同文件的
 * `matchProjectId` 在 tests/ 下**零引用**——侧栏这条最容易被漏的语义一直没有
 * 任何自动化覆盖。漏的代价已经发生过一次：`PRINT_ROUTE_RE` 只写了
 * `(schedule|calendar)`，而 main.tsx / AppShell 都是**三条**打印路由，
 * 于是行程单打印窗口（`itinerary-print`）里侧栏**漏渲染**（保险 ① 失效；
 * 保险 ② 的 `print:hidden` 与 ③ 的 `@media print` 只在真打印时生效，
 * 屏幕态的漏渲染它们兜不住）。
 *
 * ── 锁法（为什么不把三条路由抄进断言）──
 * 抄一遍只是把同一个事实写两处：将来加第四条打印路由时，路由表与这份清单
 * 很可能一起忘。所以判定真值取自 **main.tsx 的路由表**（全仓唯一出处），
 * 要求 `isPrintRoute` 对每条 `*-print` 路由都返回 true。新增打印页却不更新
 * 侧栏正则 ⇒ 本用例红；反过来写宽（把非打印路由也判成打印）⇒ 反向断言红。
 *
 * 顺带锁 `matchProjectId`：侧栏项目高亮的 id 提取口径在打印路由上也必须成立
 * （两条路由都返回 null 才是回归）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isPrintRoute, matchProjectId } from '../src/components/layout/Sidebar';

const ROOT = resolve(__dirname, '..');
const mainSrc = readFileSync(resolve(ROOT, 'src/main.tsx'), 'utf-8');

/** 路由表里全部 `<path>-print` 子路由（路由表是全仓唯一出处，不手抄） */
const printRoutes = [...mainSrc.matchAll(/path:\s*'([^']*-print)'/g)].map((m) => m[1]!);

/** `/project/:id/...` 形式的 `:id` 换成具体 id，模拟真实 pathname */
const asPathname = (route: string): string => `/${route.replace(':id', 'proj_x')}`;

describe('侧栏打印路由互斥（R20 保险 ①）', () => {
  it('前提：main.tsx 里确实挂着三条打印路由（否则下面的断言会空过）', () => {
    expect(printRoutes, `实际抽到：${printRoutes.join(', ')}`).toEqual([
      'project/:id/schedule-print',
      'project/:id/itinerary-print',
      'project/:id/calendar-print',
    ]);
  });

  it('★ 路由表里每一条 *-print 路由，侧栏都必须认出来（漏一条 ⇒ 该打印窗口侧栏漏渲染）', () => {
    for (const route of printRoutes) {
      const pathname = asPathname(route);
      expect(isPrintRoute(pathname), `${pathname} 未被识别为打印路由（侧栏会漏渲染）`).toBe(true);
    }
  });

  it('反向：非打印路由不得被误判（误判 = 正常页面里侧栏整条消失）', () => {
    for (const pathname of [
      '/',
      '/member-board',
      '/my-tasks',
      `/project/proj_x`,
      '/project/proj_x/print',
      '/project/proj_x/schedule-prints',
    ]) {
      expect(isPrintRoute(pathname), `${pathname} 不是打印路由，不得被判定为打印页`).toBe(false);
    }
  });

  it('matchProjectId：打印路由与详情路由都能提取项目 id（侧栏高亮口径）', () => {
    for (const route of printRoutes) {
      expect(matchProjectId(asPathname(route))).toBe('proj_x');
    }
    expect(matchProjectId('/project/proj_x')).toBe('proj_x');
    expect(matchProjectId('/project/proj_x/stage/stg_1')).toBe('proj_x');
    expect(matchProjectId('/')).toBeNull();
    expect(matchProjectId('/member-board')).toBeNull();
    expect(matchProjectId('/my-tasks')).toBeNull();
  });
});
