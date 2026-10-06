# 完整示例：会议室占用看板

「会议室」是借喻：把每个项目当成一次占用，`plannedStartAt → plannedEndAt` 就是预订时段。
这个插件做的事 = **把本周正在进行的项目画成一条周视图时间带**——全部数据来自三个只读出口，
真实可跑、可抄。

> 本示例为演示而写。它进仓库是为了让你有可以照着改的样板（不是随包插件）。

「会议室」是借喻：把每个项目当成一次占用，`plannedStartAt → plannedEndAt` 就是预订时段。插件做的事 = **把本周正在进行的项目画成一条周视图时间带**——全部数据来自三个只读出口，真实可跑。此插件为虚构演示，不进随包。

### 目录

```
src/plugins/meeting-room-board/
├── manifest.tsx        # 清单（§1.7.1）
├── occupancy.ts        # 纯函数：本周裁剪与分带（可单测）
├── MeetingRoomBoardPanel.tsx  # 面板
└── occupancy.spec.ts   # 单测（§1.7.3）
```

### manifest.tsx

```tsx
import type { PluginManifest } from '../../core/plugin/types';
import { MeetingRoomBoardPanel } from './MeetingRoomBoardPanel';

export const meetingRoomBoardManifest: PluginManifest = {
  id: 'meeting-room-board',
  name: '会议室占用看板',
  summary: '把项目周期画成本周时间带：哪些项目在跑、什么时候开始结束（只读）',
  version: '1.0.0',
  source: 'member',
  capabilities: ['data.read'],
  defaultEnabled: false,
  routes: [{ path: 'meeting-rooms', element: <MeetingRoomBoardPanel /> }],
  // ⚠️ group:'main' 的入口在宿主补齐渲染前不会出现在侧栏（见 §1.4.2），
  // 页面本身可通过路由 /meeting-rooms 直达，功能不受影响。
  nav: [{ to: '/meeting-rooms', label: '会议室占用', icon: 'calendarRange', group: 'main' }],
};
```

### occupancy.ts（纯函数）+ MeetingRoomBoardPanel.tsx（面板）

```ts
// occupancy.ts —— 纯函数，无 IO、无 React（单测直接打这里）

/** 自然周：周一 → 周日。返回两个 ISO date（YYYY-MM-DD） */
export function thisWeek(now: Date): { from: string; to: string } {
  const day = now.getDay() === 0 ? 7 : now.getDay(); // 周一=1 … 周日=7
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  return { from: iso(monday), to: iso(sunday) };
}

export interface Bar {
  projectId: string;
  name: string;
  client: string;
  /** 裁剪后在 [from, to] 区间内的可见段，百分比 0-100 */
  leftPct: number;
  widthPct: number;
}

type Span = ReadonlyArray<{
  id: string;
  name: string;
  clientName: string;
  plannedStartAt: string;
  plannedEndAt: string;
}>;

/**
 * 把项目的起止时段裁剪到任意 [from, to] 窗口，换算成百分比条。
 * 起止为 UTC ISO string（实体铁律：时间字段全程 string，这里才转 Date）。
 */
export function barsForRange(projects: Span, from: string, to: string): Bar[] {
  const rangeStart = new Date(`${from}T00:00:00.000Z`).getTime();
  const rangeEnd = new Date(`${to}T23:59:59.999Z`).getTime();
  const span = rangeEnd - rangeStart;
  if (span <= 0) return [];
  const bars: Bar[] = [];
  for (const p of projects) {
    const s = new Date(p.plannedStartAt).getTime();
    const e = new Date(p.plannedEndAt).getTime();
    if (!(e >= rangeStart && s <= rangeEnd)) continue; // 与窗口无交集
    const leftPct = ((Math.max(s, rangeStart) - rangeStart) / span) * 100;
    const rightPct = ((Math.min(e, rangeEnd) - rangeStart) / span) * 100;
    bars.push({
      projectId: p.id,
      name: p.name,
      client: p.clientName,
      leftPct,
      // 右端钳进 100（全周期窗口右端即最晚项目当天 23:59:59.999）
      widthPct: Math.max(Math.min(rightPct, 100) - leftPct, 0.8),
    });
  }
  return bars;
}

/** 本周视图 = barsForRange 的特化（spec 直接测这个入口） */
export function barsForWeek(projects: Span, now: Date): Bar[] {
  const { from, to } = thisWeek(now);
  return barsForRange(projects, from, to);
}

/** 全周期视图的窗口：最早开始 → 最晚结束；无项目返回 null */
export function fullRange(projects: Span): { from: string; to: string } | null {
  if (projects.length === 0) return null;
  const starts = projects.map((p) => p.plannedStartAt.slice(0, 10)).sort();
  const ends = projects.map((p) => p.plannedEndAt.slice(0, 10)).sort();
  return { from: starts[0]!, to: ends[ends.length - 1]! };
}
```

```tsx
// MeetingRoomBoardPanel.tsx —— 只读面板
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarRange } from 'lucide-react';

import { useHumanProjects } from '../../core/project/visibility';
import { barsForRange, fullRange, thisWeek } from './occupancy';

export function MeetingRoomBoardPanel(): JSX.Element {
  const projects = useHumanProjects(); // 人类侧项目（kind 已收窄）
  const now = useMemo(() => new Date(), []);
  const week = useMemo(() => thisWeek(now), [now]);
  const [onlyThisWeek, setOnlyThisWeek] = useState(true);

  const bars = useMemo(() => {
    const range = onlyThisWeek ? week : (fullRange(projects) ?? week);
    return barsForRange(projects, range.from, range.to);
  }, [projects, week, onlyThisWeek]);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarRange size={16} className="text-pine" aria-hidden />
            <h1 className="text-[20px] font-semibold tracking-tight text-ink">会议室占用看板</h1>
            <span className="font-mono text-[10px] text-mist">member plugin · read-only</span>
          </div>
          <p className="mt-1 text-[13px] text-mist">
            {onlyThisWeek ? '本周' : '全周期'} {bars.length} 个项目有占用时段 · 一根时间带 = 一个项目的计划周期
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOnlyThisWeek((v) => !v)}
          className="h-8 shrink-0 rounded-md border border-line bg-paper px-3 text-[12px] text-ink outline-none transition-colors hover:bg-sand focus-visible:ring-2 focus-visible:ring-pine/40"
        >
          {onlyThisWeek ? '看全周期' : '只看本周'}
        </button>
      </div>

      {bars.length === 0 ? (
        <div className="rounded-lg border border-line bg-paper px-4 py-8 text-center text-[13px] text-mist">
          {onlyThisWeek ? '本周没有占用中的项目。' : '当前没有可显示的项目。'}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {bars.map((b) => (
            <li key={b.projectId} className="rounded-lg border border-line bg-paper px-3 py-2.5">
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <Link
                  to={`/project/${b.projectId}`}
                  className="truncate text-[13px] font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
                >
                  {b.name}
                </Link>
                <span className="shrink-0 font-mono text-[10px] text-mist">{b.client || '—'}</span>
              </div>
              {/* 时间带：宿主 token 上色（pine-soft 品牌浅底），双主题自动成立 */}
              <div className="relative h-2 rounded-full bg-sunken">
                <span
                  className="absolute inset-y-0 rounded-full bg-pine-soft"
                  style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-[11px] text-mist">
        本面板只读项目数据，不写入、不修改任何内容。
      </p>
    </div>
  );
}
```

### occupancy.spec.ts（一条直接可抄的 spec）

```ts
// @vitest-environment node
/** 会议室占用看板 · 纯函数单测（无 React、无 DOM，node 环境直接跑） */
import { describe, it, expect } from 'vitest';

import { barsForWeek, fullRange, thisWeek } from '../src/plugins/meeting-room-board/occupancy';

describe('thisWeek · 自然周起止', () => {
  it('周三输入 ⇒ 返回当周周一到周日', () => {
    // 2026-10-07 是周三
    expect(thisWeek(new Date('2026-10-07T10:00:00Z'))).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });
  it('周日输入 ⇒ 仍归当周（周一=1…周日=7，不跳到下周）', () => {
    expect(thisWeek(new Date('2026-10-11T10:00:00Z'))).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });
});

describe('barsForWeek · 时段裁剪', () => {
  const inWeek = {
    id: 'proj_a', name: 'A 项目', clientName: '甲方A',
    plannedStartAt: '2026-10-06T00:00:00Z', plannedEndAt: '2026-10-08T23:59:59.999Z',
  };
  const before = {
    id: 'proj_b', name: 'B 项目', clientName: '甲方B',
    plannedStartAt: '2026-09-01T00:00:00Z', plannedEndAt: '2026-09-30T23:59:59Z',
  };

  // 本周窗口：2026-10-05T00:00:00.000Z → 2026-10-11T23:59:59.999Z
  it('① 落在本周内的项目出一条带（位置=周二起、宽度≈3/7 周）', () => {
    const bars = barsForWeek([inWeek], new Date('2026-10-07T10:00:00Z'));
    expect(bars).toHaveLength(1);
    expect(bars[0]!.name).toBe('A 项目');
    expect(bars[0]!.leftPct).toBeCloseTo(100 / 7, 4);   // 周二 0 点 = 一周的 1/7
    expect(bars[0]!.widthPct).toBeCloseTo(300 / 7, 4);  // ≈ 3 天 = 3/7 周
  });

  it('② 完全不沾本周的项目不出带', () => {
    expect(barsForWeek([before], new Date('2026-10-07T10:00:00Z'))).toEqual([]);
  });

  it('③ 跨周项目被裁剪进本周（左端贴 0、右端贴 100）', () => {
    const cross = {
      id: 'proj_c', name: 'C 项目', clientName: '甲方C',
      plannedStartAt: '2026-09-28T00:00:00Z', plannedEndAt: '2026-10-14T23:59:59.999Z',
    };
    const bars = barsForWeek([cross], new Date('2026-10-07T10:00:00Z'));
    expect(bars).toHaveLength(1);
    expect(bars[0]!.leftPct).toBeCloseTo(0, 5);
    expect(bars[0]!.widthPct).toBeCloseTo(100, 5);
  });
});

describe('fullRange · 全周期窗口', () => {
  it('④ 取最早开始与最晚结束（都截到日）', () => {
    expect(
      fullRange([
        { id: 'a', name: 'A', clientName: '', plannedStartAt: '2026-10-06T00:00:00Z', plannedEndAt: '2026-10-08T23:59:59Z' },
        { id: 'b', name: 'B', clientName: '', plannedStartAt: '2026-09-01T00:00:00Z', plannedEndAt: '2026-12-31T23:59:59Z' },
      ]),
    ).toEqual({ from: '2026-09-01', to: '2026-12-31' });
  });

  it('⑤ 无项目返回 null（面板据此回落本周视图）', () => {
    expect(fullRange([])).toBeNull();
  });
});
```

> 组件本身的渲染 spec 若需要，要引 `@testing-library/react`（**当前 devDeps 未装**，PR 时单独议；jsdom 已在）。评审清单不强制渲染 spec——**纯函数 spec 一条 + manifest 静态守卫**即达门槛。