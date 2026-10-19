// @vitest-environment jsdom
/**
 * **落库值哨兵**（`operator_name` / `Member.role`）：落库值 vs 显示文案的分离。
 *
 * 覆盖两族：① `operator_name`（四个哨兵值）；② `Member.role`（一个兜底值）。
 * 两族口径完全相同，差别只在 ② 是用户自由文本 ⇒ 只翻兜底值、用户填的一律回落原文。
 *
 * ══════════════════════ 这个文件锁的是什么 ══════════════════════
 * 裁决（雯丞 2026-10-19）：`operator_name` 是**落库数据值** ⇒
 *   **写入点钉死中文原值 + 显示层取词**（零迁移、不动 DDL）。
 *
 * 这条裁决有一个非常容易破的口子：**写入点图省事写成 `t('common.unknown')`**。
 * 它在中文态下测试全绿、行为逐字节相同；**英文态会把 `Unknown` 写进库**，
 * 于是同一张流水表里「老行中文 / 新行英文」，审计与回溯当场失效。
 * 本仓真有这么一处（`MyTasksPage.tsx` 原为 `me?.name ?? t('common.unknown')`）。
 *
 * ⇒ 光靠注释挡不住（K21），必须让**下一次**再写 `t()` 的时候有东西响：
 *
 *   ① **写入侧**：数据面常量表是唯一出处 —— 全仓 `src/**`（除 `src/i18n/**` 与本表
 *      自身）剥注释后，这四个中文原值**一个引号串都不许剩**；且每个写入点的使用行
 *      **不许出现 `t(`**。
 *   ② **显示侧**：屏幕唯一渲染点（`DelayHistoryTimeline`）必须走 `operatorNameLabel()`；
 *      同时**纸面（`src/print/**`）不许取词** —— 打印稿恒中文，取词会把屏幕上选的语言
 *      带进纸面，破坏「纸面恒中文」这条既有口径。
 *   ③ **覆盖率锁**：值表 ⟷ 映射表 ⟷ zh/en 两列，四处集合相等；zh 取值逐字等于原值；
 *      en 非空且不含汉字。将来新增一个哨兵值忘了建键，这里当场红。
 *   ④ **行为**：中文态逐字等于改造前（零变化）；英文态真变成英文；成员真名与未知值
 *      **回落原文**（不显示空、也不显示第二份语言）。
 *
 * ⚠️ 本 spec 用 jsdom：③④ 需要 `setLang('en')`（它会写 `document` 与 `localStorage`）。
 *    ① 的文件扫描在 jsdom 下同样成立（只读 fs）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { maskComments } from './helpers/cjk-locator-guard';
import {
  OPERATOR_SENTINELS,
  ALL_OPERATOR_SENTINELS,
} from '../src/core/types/operator-sentinel';
import { ROLE_SENTINELS, ALL_ROLE_SENTINELS } from '../src/core/types/role-sentinel';
import {
  OPERATOR_NAME_KEYS,
  ROLE_NAME_KEYS,
  catalogOf,
  operatorNameLabel,
  roleLabel,
  setLang,
  t,
} from '../src/i18n';

const REPO_ROOT = join(__dirname, '..');
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf-8');
}

/** 剥注释后的源码（等长抹白，保留行号；引号/正则/模板串的字面量**保留**） */
function masked(rel: string): string {
  return maskComments(read(rel));
}

/**
 * 四个哨兵值在**改造前**的原值 —— 逐字节。
 * 这条断言是「零迁移、不动 DDL」的证据：只要值不变，老行就天然可映射，
 * 不存在 UPDATE 语句，也不存在「半张表新值半张表老值」的中间态。
 */
const ORIGINAL_VALUES = ['未知', '当前用户', '我', 'Agent 通道'] as const;

/**
 * 写入点清单（8 个文件 / 10 个点位）→ **每个文件应有的常量引用次数**。
 *
 * ── 为什么钉「次数」而不是「行号」──
 * 行号会随任何一次无关编辑漂移（本文件自己就踩过），漂了就得改 spec，
 * 改着改着大家就把这条断言当噪音关掉。次数是**稳定的**：
 *   · 有人把一个点位退回字面量 ⇒ 次数下降 ⇒ 红；
 *   · 有人在别处新增一个写入点 ⇒ 次数上升 ⇒ 红（逼他回来登记这条棘轮，
 *     也就是逼他确认「新点位也走常量表」）。
 * 只数 `OPERATOR_SENTINELS.`（带点 = 取值引用），`import { OPERATOR_SENTINELS }` 不计入。
 *
 * 只覆盖**会被写进 `assignments.operator_name` / `stage_logs.operator_name`** 的兜底值出处；
 * `src/core/services/stage.service.ts` 的 `'未知操作人'` 与 `project.service.ts` 的
 * `'system'` **不在本轮范围**（前者是另一个字面量、后者本就非中文）。
 */
const WRITE_POINT_FILES: ReadonlyArray<readonly [string, number]> = [
  ['src/store/useProjectsStore.ts', 2], // toggleDone 的 operatorName 兜底 + useMemberName(null)
  ['src/pages/MyTasksPage.tsx', 1], // ★ 曾经是 t('common.unknown')，英文态会写 Unknown 进库
  ['src/components/settings/RestPolicyRecalcDialog.tsx', 1],
  ['src/components/stage-detail/StageDrawer.tsx', 2], // StatusRow + DateRow
  ['src/components/stage-detail/TaskChecklist.tsx', 1],
  ['src/components/timeline/RescheduleDialog.tsx', 1],
  ['src/components/travel/TravelItineraryPanel.tsx', 1],
  ['src/core/agent/commands.ts', 1],
];

/** 屏幕侧唯一渲染点 */
const DISPLAY_FILE = 'src/components/stage-detail/DelayHistoryTimeline.tsx';

afterEach(() => {
  setLang('zh'); // 别把英文态漏给同进程的其它 spec
});

/* ══════════════════════════ ③ 覆盖率锁 + 值不变 ══════════════════════════ */

describe('操作人哨兵值 · 值表与映射表', () => {
  it('值逐字节等于改造前（零迁移、不动 DDL 的前提）', () => {
    expect([...ALL_OPERATOR_SENTINELS]).toEqual([...ORIGINAL_VALUES]);
    expect(OPERATOR_SENTINELS.unknown).toBe('未知');
    expect(OPERATOR_SENTINELS.currentUser).toBe('当前用户');
    expect(OPERATOR_SENTINELS.me).toBe('我');
    expect(OPERATOR_SENTINELS.agentChannel).toBe('Agent 通道');
  });

  it('值表 ⟷ 映射表 集合双向相等（新增哨兵忘了建键 = 这里红）', () => {
    const values = [...ALL_OPERATOR_SENTINELS].sort();
    const mapped = Object.keys(OPERATOR_NAME_KEYS).sort();
    expect(mapped).toEqual(values);
  });

  it('每个值的 zh 取值逐字等于原值（中文态零变化）', () => {
    const zh = catalogOf('zh');
    for (const value of ALL_OPERATOR_SENTINELS) {
      const key = OPERATOR_NAME_KEYS[value];
      expect(key, `${value} 没有映射键`).toBeTruthy();
      expect(zh[key!], `${value} 的 zh 取值被改动了`).toBe(value);
    }
  });

  it('每个值的 en 非空、不含汉字、且与 zh 不同（否则等于没翻）', () => {
    const zh = catalogOf('zh');
    const en = catalogOf('en');
    for (const value of ALL_OPERATOR_SENTINELS) {
      const key = OPERATOR_NAME_KEYS[value]!;
      const text = en[key];
      expect(text.length, `${key} 的英文为空`).toBeGreaterThan(0);
      expect(CJK.test(text), `${key} 的英文里还有汉字：${text}`).toBe(false);
      expect(text, `${key} 中英同值`).not.toBe(zh[key]);
    }
  });
});

/* ══════════════════════════ ④ 行为（zh / en 逐条） ══════════════════════════ */

describe('operatorNameLabel · 显示层取词', () => {
  it('中文态：四个哨兵值全部逐字回显（与改造前一字不差）', () => {
    setLang('zh');
    expect(operatorNameLabel('未知')).toBe('未知');
    expect(operatorNameLabel('当前用户')).toBe('当前用户');
    expect(operatorNameLabel('我')).toBe('我');
    expect(operatorNameLabel('Agent 通道')).toBe('Agent 通道');
  });

  it('英文态：四个哨兵值全部变英文', () => {
    setLang('en');
    expect(operatorNameLabel('未知')).toBe('Unknown');
    expect(operatorNameLabel('当前用户')).toBe('current user');
    expect(operatorNameLabel('我')).toBe('me');
    expect(operatorNameLabel('Agent 通道')).toBe('Agent channel');
  });

  it('成员真名回落原文（两种语言都不许被改写）', () => {
    for (const lang of ['zh', 'en'] as const) {
      setLang(lang);
      expect(operatorNameLabel('张工')).toBe('张工');
      expect(operatorNameLabel('Marvis')).toBe('Marvis');
    }
  });

  it('未登记的未知值回落原文，不显示空、也不猜（`未知操作人` 是另一个字面量）', () => {
    setLang('en');
    expect(operatorNameLabel('未知操作人')).toBe('未知操作人');
    expect(operatorNameLabel('')).toBe('');
  });

  it('端到端：delayHistory.operator 拼出来的整串在英文态无汉字', () => {
    setLang('en');
    const line = t('delayHistory.operator', { name: operatorNameLabel('未知') });
    expect(line).toContain('Unknown');
    expect(CJK.test(line), `英文流水行仍含汉字：${line}`).toBe(false);
  });
});

/* ══════════════════════════ ① 写入侧：唯一出处 + 不许取词 ══════════════════════════ */

describe('写入侧 · 数据面常量表是唯一出处', () => {
  it('src/** 剥注释后不再有这四个哨兵值的引号串（src/i18n 与本表自身除外）', () => {
    const hits: string[] = [];
    for (const rel of walk('src')) {
      if (rel.startsWith('src/i18n/')) continue; // 文案表里当然有（那是显示文案的出处）
      if (rel === 'src/core/types/operator-sentinel.ts') continue; // 值表本身
      const src = masked(rel);
      for (const value of ORIGINAL_VALUES) {
        const quoted = new RegExp(`['"\`]${escapeRegExp(value)}['"\`]`, 'g');
        for (const m of src.matchAll(quoted)) {
          const line = src.slice(0, m.index).split(/\r?\n/).length;
          hits.push(`${rel}:${line} 仍把 '${value}' 写成字面量`);
        }
      }
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it.each(WRITE_POINT_FILES)('%s 有 %i 处取数据面常量（棘轮：只许按这个数对上）', (rel, expected) => {
    const src = masked(rel);
    const refs = src.match(/OPERATOR_SENTINELS\.[A-Za-z]+/g) ?? [];
    expect(
      refs.length,
      `${rel} 的常量引用数变了（实际 ${refs.length} / 期望 ${expected}）：` +
        `减少 = 某个点位退回了字面量或 t()；增加 = 新增了写入点，请回来登记本棘轮`,
    ).toBe(expected);
  });

  it.each(WRITE_POINT_FILES)('%s：凡是出现 operatorName 的行都不许经 t()', (rel) => {
    const offenders = masked(rel)
      .split(/\r?\n/)
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => line.includes('operatorName') && /\bt\(/.test(line));
    expect(
      offenders.map(([n, l]) => `${rel}:${n} ${l.trim()}`),
      '写入点经 t() ⇒ 英文态把英文写进库，历史留痕按语言分叉',
    ).toEqual([]);
  });

  it('写入点所在文件都从数据面 import 常量表（不是各自复制一份）', () => {
    for (const [rel] of WRITE_POINT_FILES) {
      expect(masked(rel), `${rel} 没有 import 常量表`).toMatch(
        /import\s*\{[^}]*OPERATOR_SENTINELS[^}]*\}\s*from\s*'[^']*operator-sentinel'/,
      );
    }
  });
});

/* ══════════════════════════ ② 显示侧：取词 + 纸面不取词 ══════════════════════════ */

describe('显示侧 · 取词边界', () => {
  it('DelayHistoryTimeline 的 operatorName 走 operatorNameLabel', () => {
    const src = masked(DISPLAY_FILE);
    expect(src).toMatch(/operatorNameLabel\(\s*l\.operatorName\s*\)/);
    expect(
      src,
      '原样透传 l.operatorName = 英文界面里显示中文哨兵值',
    ).not.toMatch(/name:\s*l\.operatorName\b/);
  });

  it('纸面（src/print/**）不取词：打印稿恒中文，只显示落库原值', () => {
    const offenders: string[] = [];
    for (const rel of walk('src/print')) {
      const src = masked(rel);
      if (/operatorNameLabel/.test(src)) offenders.push(rel);
    }
    expect(offenders, `纸面不该取词：${offenders.join(', ')}`).toEqual([]);
  });
});

/* ══════════════════════════ ⑤ 角色数据槽（Member.role 的兜底值） ══════════════════════════
 *
 * 同一套口径（裁决 2026-10-19）：`Member.role` 是落库数据值 ⇒ 兜底值 `负责人`
 * 写入钉死中文原值 + 显示层取词。
 *
 * ⚠️ 与 operator 那一族的**关键差别**：`role` 是用户自由文本（能填「主案设计师」
 *   「Lighting Designer」）⇒ 本族只覆盖**兜底值**，其余取值必须回落原文。
 *   所以这里多一条「自由文本在两个语言下都逐字不变」的反向断言 —— 防的是
 *   「好心把角色名也翻译掉」这个更严重的错误（那会篡改用户数据）。
 */
const ROLE_ORIGINAL_VALUES = ['负责人'] as const;

/** 角色兜底值的写入点 / 显示点（各 1 个文件 + 3 个显示文件） */
const ROLE_WRITE_FILE = 'src/components/layout/IdentityDialog.tsx';
const ROLE_DISPLAY_FILES = [
  'src/components/common/AvatarStack.tsx',
  'src/components/timeline/StageRowsColumn.tsx',
  'src/components/stage-detail/TaskChecklist.tsx',
] as const;

describe('角色数据槽 · 值表与映射表', () => {
  it('值逐字节等于改造前（零迁移、不动 DDL 的前提）', () => {
    expect([...ALL_ROLE_SENTINELS]).toEqual([...ROLE_ORIGINAL_VALUES]);
    expect(ROLE_SENTINELS.owner).toBe('负责人');
  });

  it('值表 ⟷ 映射表 集合双向相等', () => {
    expect(Object.keys(ROLE_NAME_KEYS).sort()).toEqual([...ALL_ROLE_SENTINELS].sort());
  });

  it('每个值的 zh 取值逐字等于原值；en 非空、无汉字、且与 zh 不同', () => {
    const zh = catalogOf('zh');
    const en = catalogOf('en');
    for (const value of ALL_ROLE_SENTINELS) {
      const key = ROLE_NAME_KEYS[value]!;
      expect(zh[key], `${value} 的 zh 取值被改动了`).toBe(value);
      expect(en[key].length, `${key} 的英文为空`).toBeGreaterThan(0);
      expect(CJK.test(en[key]), `${key} 的英文里还有汉字：${en[key]}`).toBe(false);
      expect(en[key], `${key} 中英同值`).not.toBe(zh[key]);
    }
  });
});

describe('roleLabel · 显示层取词', () => {
  it('中文态：兜底值逐字回显', () => {
    setLang('zh');
    expect(roleLabel('负责人')).toBe('负责人');
  });

  it('英文态：兜底值变英文', () => {
    setLang('en');
    expect(roleLabel('负责人')).toBe('Owner');
  });

  it('★ 用户自填的角色名**永不翻译**（两种语言都逐字不变）', () => {
    for (const lang of ['zh', 'en'] as const) {
      setLang(lang);
      expect(roleLabel('主案设计师')).toBe('主案设计师');
      expect(roleLabel('Lighting Designer')).toBe('Lighting Designer');
      expect(roleLabel('')).toBe('');
    }
  });
});

describe('角色数据槽 · 写入侧与显示侧', () => {
  it('src/** 剥注释后不再有 `负责人` 引号串（i18n / 值表 / demo 夹具除外）', () => {
    const hits: string[] = [];
    for (const rel of walk('src')) {
      if (rel.startsWith('src/i18n/')) continue; // 文案表里当然有
      if (rel === 'src/core/types/role-sentinel.ts') continue; // 值表本身
      // `src/core/demo/**` 是**演示数据内容**（某个演示成员就叫「负责人甲」、角色填「负责人」），
      // 与用户自己填的角色名同性质 ⇒ 不许翻译、也不算兜底值出处。
      if (rel.startsWith('src/core/demo/')) continue;
      const src = masked(rel);
      for (const value of ROLE_ORIGINAL_VALUES) {
        const quoted = new RegExp(`['"\`]${escapeRegExp(value)}['"\`]`, 'g');
        for (const m of src.matchAll(quoted)) {
          const line = src.slice(0, m.index).split(/\r?\n/).length;
          hits.push(`${rel}:${line} 仍把 '${value}' 写成字面量`);
        }
      }
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('写入点 IdentityDialog 取 ROLE_SENTINELS.owner（棘轮计数 = 1），且不经 t()', () => {
    const src = masked(ROLE_WRITE_FILE);
    expect(src.match(/ROLE_SENTINELS\.[A-Za-z]+/g)?.length ?? 0).toBe(1);
    const offenders = src
      .split(/\r?\n/)
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => line.includes('role:') && /\bt\(/.test(line));
    expect(
      offenders.map(([n, l]) => `${ROLE_WRITE_FILE}:${n} ${l.trim()}`),
      'role 的写入点经 t() ⇒ 英文态把 Owner 写进库',
    ).toEqual([]);
    expect(src).toMatch(
      /import\s*\{[^}]*ROLE_SENTINELS[^}]*\}\s*from\s*'[^']*role-sentinel'/,
    );
  });

  it.each(ROLE_DISPLAY_FILES)('%s 的角色渲染走 roleLabel()', (rel) => {
    const src = masked(rel);
    expect(src, `${rel} 仍在原样透传 role（英文界面显示中文兜底值）`).toMatch(
      /roleLabel\(/,
    );
    // 反向：不许再出现 `m.role || '...'` 这种「取词之外还自带字面量」的形态
    expect(src).not.toMatch(/\.role\s*\|\|\s*'/);
  });

  it('AvatarStack 补了 useLang() 订阅（roleLabel 不是 hook，不订阅就不会重渲染）', () => {
    expect(masked('src/components/common/AvatarStack.tsx')).toMatch(/useLang\(\)/);
  });
});

/* ══════════════════════════ 小工具 ══════════════════════════ */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 递归列出某目录下的 .ts/.tsx（相对仓库根，正斜杠） */
function walk(relDir: string): string[] {
  const out: string[] = [];
  const stack = [relDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const name of readdirSync(join(REPO_ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(REPO_ROOT, rel)).isDirectory()) {
        stack.push(rel);
        continue;
      }
      if (rel.endsWith('.ts') || rel.endsWith('.tsx')) out.push(rel);
    }
  }
  return out;
}
