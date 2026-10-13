/**
 * T10–T13 阶段 D 单元验收（v0.6）；v0.7 T04 起补双模式断言。
 *
 * 覆盖：
 * 1. agentTerms 术语映射——`tech` 模式 Stage→「批次（Batch）」等 PRD §2A.3 统一口径；
 *    `human` 模式对应行业中性文案；**两种模式都必须显式传 mode**（T04 根因修复：
 *    旧版带缺省值 'agent'，导致 human 一列从未被任何调用点取到 = 死代码），
 *    状态标签英文原样（不翻译）；
 * 2. storage-estimate——formatBytes 边界 + estimateLocalDbUsage 两条路径
 *    （storage.estimate 有值 / 无值回落序列化 / 内部异常返回 null）；
 * 3. HF-05 验收：Agent 工作区源码 grep 无行业黑话（甲方 / 工地 / 设计阶段）。
 *
 * ── T04 回归断言（新增，锁死「漏传 mode」不会再回来）──
 * `termFor` 的 mode 已改为**必填**，故本文件所有调用一律显式传参；此外新增
 * 「双模式取值互不相同」与「两列齐备」两组断言——即便将来有人给签名加回
 * 缺省值，只要 human/tech 任一列被证实从未被取到，这两组断言仍会失败。
 *
 * ── #354（2026-08-27）：表搬去 `src/i18n/labels.ts`，本文件**升口径**（不是放宽）──
 *   ① 取词与键表改从单一出口 `../src/i18n` 取（原 `AGENT_TERMS` 已删；为什么不能在
 *      `constants/` 里 import i18n：那份文件进服务端 tsconfig 的 include 白名单，
 *      而该配置无 DOM ⇒ 实测 2×TS2584。详见 `src/i18n/labels.ts` 的区块）；
 *   ② 下面第三条用例原本手写 9 个 key 的「两模式必须不同」清单 —— 那是**子集**，
 *      对未列入的 4 个 key 一直是「宽」的。现改为**遍历全部 13 个 key**，
 *      只跳过 `MODE_COLLAPSED_KEYS` 里**登记在案**的重合（中文侧只有 `onsite`：
 *      它两列自 v0.7 起都是「现场」，是既成事实，取值一字未动）。
 *      ⇒ 覆盖从 9 个 key 提到 12 个，且「要重合就得登记 + 写理由」。
 *   ③ 「不许行业黑话」由只看 `AGENT_TERMS` 改为看**两份语言表**的 26 个取值。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  AGENT_SEAT_LIMIT,
  AGENT_KIND_SUGGESTIONS,
  DEFAULT_AGENT_TERM_MODE,
} from '../src/constants/agentTerms';
import { AGENT_TERM_KEYS, MODE_COLLAPSED_KEYS, catalogOf, termFor } from '../src/i18n';
import type { AgentTermKey, AgentTermMode } from '../src/constants/agentTerms';
import { TaskStatus } from '../src/core/types/enums';
import {
  estimateLocalDbUsage,
  formatBytes,
} from '../src/lib/storage-estimate';

describe('agentTerms · PRD §2A.3 术语映射', () => {
  it('tech 模式：Stage→「批次（Batch）」；导入叫 Apply payload；甘特叫 Timeline', () => {
    expect(termFor('stage', 'tech')).toBe('批次（Batch）');
    expect(termFor('applyPayload', 'tech')).toBe('Apply payload');
    expect(termFor('timeline', 'tech')).toBe('Timeline');
    expect(termFor('ready', 'tech')).toBe('Ready');
    expect(termFor('artifacts', 'tech')).toBe('artifacts（产出物）');
  });

  it('human 模式：同一批 key 给出人话文案（T04 前这一列是死代码）', () => {
    expect(termFor('stage', 'human')).toBe('阶段');
    expect(termFor('applyPayload', 'human')).toBe('导入任务');
    expect(termFor('timeline', 'human')).toBe('时间轴');
    expect(termFor('ready', 'human')).toBe('待办');
    expect(termFor('artifacts', 'human')).toBe('产出物');
  });

  it('两种模式的取值确实不同（防「改了列名但没改值」的假双模式）· 全 13 key 遍历', () => {
    /*
     * 覆盖 9 → 13（跳过 zh 侧登记在案的 1 个）：
     * 旧版手写清单只列 9 个 key，`stageShort` / `client` / `onsite` / `deps` 四个
     * 从未被检查过 —— 其中 `onsite` 中文两列本来就相同（见 `MODE_COLLAPSED_KEYS`）。
     */
    const registered = new Set<string>(MODE_COLLAPSED_KEYS.zh);
    const keys = Object.keys(AGENT_TERM_KEYS) as AgentTermKey[];
    expect(keys.length, '术语 key 少了？表被改空过就说明这条会假绿').toBe(13);
    const checked: string[] = [];
    for (const key of keys) {
      if (registered.has(key)) continue;
      expect(termFor(key, 'human'), `${key} 两模式文案相同（要重合必须在 MODE_COLLAPSED_KEYS 登记 + 写理由）`).not.toBe(
        termFor(key, 'tech'),
      );
      checked.push(key);
    }
    expect(checked.length, '跳过的登记项不该超过 1 个（zh 侧只有 onsite）').toBe(12);
  });

  it('默认模式常量 = human（首次进入人读优先，唯一出处）', () => {
    expect(DEFAULT_AGENT_TERM_MODE).toBe('human');
  });

  /**
   * ★ 这里原本还有一条「『可开工』是独立常量、不复用 ready 词条」的用例，
   * v0.7 收口时随 `READY_NOW_LABEL` 一起删除。它锁的两条事实仍被别处锁着：
   *   · 「『可开工』≠ `termFor('ready','human')`（『待办』）」→ 上面 human 列断言
   *     `termFor('ready','human') === '待办'` + 两模式取值必须不同，均已覆盖；
   *   · 「组标题就叫『可开工』」→ 验收 spec B-02 断言屏幕上的组标题顺序
   *     `['待我确认','可开工','进行中','已完成']`（锁 UI 事实，比锁常量更强）。
   */

  it('状态值英文原样（TaskStatus 枚举值即展示值，UI 不翻译）', () => {
    expect(TaskStatus.Draft).toBe('draft');
    expect(TaskStatus.Ready).toBe('ready');
    expect(TaskStatus.Claimed).toBe('claimed');
    expect(TaskStatus.InProgress).toBe('in_progress');
    expect(TaskStatus.Blocked).toBe('blocked');
    expect(TaskStatus.Review).toBe('review');
    expect(TaskStatus.Done).toBe('done');
  });

  it('agentKind 建议值非空数组（datalist 仅供选择，不封闭输入）', () => {
    expect(AGENT_KIND_SUGGESTIONS.length).toBeGreaterThan(0);
  });

  it('未知 key 回落 key 本身（两种 mode 都回落，新术语未登记时不至于白屏）', () => {
    expect(termFor('someFutureTerm' as never, 'human')).toBe('someFutureTerm');
    expect(termFor('someFutureTerm' as never, 'tech')).toBe('someFutureTerm');
  });

  it('免费 Agent 席位 = 3（B5 拍板值）', () => {
    expect(AGENT_SEAT_LIMIT).toBe(3);
  });

  it('AGENT_TERM_KEYS 两份语言表的所有取值都不允许出现行业黑话（§0.5 常驻约束）', () => {
    const modes: AgentTermMode[] = ['human', 'tech'];
    const keys = Object.keys(AGENT_TERM_KEYS) as AgentTermKey[];
    for (const lang of ['zh', 'en'] as const) {
      const table = catalogOf(lang);
      for (const key of keys) {
        for (const mode of modes) {
          const value = table[AGENT_TERM_KEYS[key][mode]];
          expect(value, `agentTerm.${key}.${mode}（${lang}）出现行业黑话`).not.toMatch(
            /甲方|工地|设计阶段|client site|construction site/,
          );
        }
      }
    }
  });
});

describe('storage-estimate · 本地库占用', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('formatBytes 边界：B / KB / MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50.0 MB');
    expect(formatBytes(-1)).toBe('—');
  });

  it('navigator.storage.estimate 有 usage → 走实测路径', async () => {
    vi.stubGlobal(
      'navigator',
      { storage: { estimate: async () => ({ usage: 42 * 1024 * 1024 }) } },
    );
    const usage = await estimateLocalDbUsage(async () => {
      throw new Error('不应走到序列化 fallback');
    });
    expect(usage).toEqual({ bytes: 42 * 1024 * 1024, source: 'storage-estimate' });
  });

  it('estimate 不可用 → 回落全表序列化估算', async () => {
    vi.stubGlobal('navigator', { storage: undefined });
    const usage = await estimateLocalDbUsage(async () => ({
      tasks: [{ id: 'tsk_1', title: '标题tasks' }],
      members: [],
    }));
    expect(usage?.source).toBe('serialization-fallback');
    // 序列化 JSON 至少包含键名与值的字节
    expect((usage?.bytes ?? 0)).toBeGreaterThan(10);
  });

  it('内部异常 → 返回 null（UI 隐藏该行，不显示假数字）', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: async () => {
          throw new Error('quota error');
        },
      },
    });
    const usage = await estimateLocalDbUsage(async () => {
      throw new Error('dump failed');
    });
    expect(usage).toBeNull();
  });
});

describe('HF-05 · Agent 工作区源码 grep 无行业黑话', () => {
  const agentDir = join(__dirname, '..', 'src', 'components', 'agent');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.tsx') || p.endsWith('.ts')) files.push(p);
    }
  };
  walk(agentDir);
  // Agent Board 页面与术语表也属于 Agent 工作区
  files.push(
    join(__dirname, '..', 'src', 'pages', 'AgentBoardPage.tsx'),
    join(__dirname, '..', 'src', 'constants', 'agentTerms.ts'),
  );

  it('全部 Agent 工作区文件不含「甲方 / 工地 / 设计阶段」（注释也算）', () => {
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const text = readFileSync(f, 'utf-8');
      expect(text, `${f} 出现行业黑话`).not.toMatch(/甲方|工地|设计阶段/);
    }
  });
});
