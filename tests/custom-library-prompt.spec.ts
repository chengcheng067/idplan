// @vitest-environment node
/**
 * 自定义行业包 · prompt 生成器 + 失败路径人话化 spec（她反馈 #6.2 新流程）。
 *
 * 验收口径（团队任务规格）：
 *   ① prompt 六类必需信息齐全（硬规则/字段表/引用完整性/10 板块/最小示例/输出格式令）；
 *   ② 最小示例**真能过现有校验**（parse import 链路证明，不是抄一句「已校验」）；
 *   ③ 勾选框开启时 prompt 尾部含现有库 JSON；
 *   ④ 错误路径翻译（items.3 → 第 4 个阶段）——变异验证见提交说明；
 *   ⑤ 常量与 schema 行为锚点：prompt 里写的 200/20/9/24 等数字，schema 必须真的按这个拒。
 */

import { describe, it, expect } from 'vitest';

import {
  buildCustomLibraryPrompt,
  buildAgentFeedbackText,
  describeCustomLibraryPath,
  translateCustomLibraryIssue,
  CUSTOM_LIBRARY_MINIMAL_EXAMPLE,
} from '../src/core/template/custom-library.prompt';
import {
  validateCustomLibrary,
  CUSTOM_LIBRARY_SCHEMA,
  CUSTOM_LIBRARY_MAX_BYTES,
  KANBAN_COLUMN_VALUES,
} from '../src/core/template/custom-library.schema';
import { DOMAIN_LABELS } from '../src/core/template/stage-library';
import type { StoredCustomLibrary } from '../src/core/template/custom-library.service';

/** 从 prompt 里把最小示例的 ```json 代码块原样抠出来（证明 prompt 自带可导入示例） */
function extractExampleFromPrompt(prompt: string): unknown {
  const m = prompt.match(/```json\n([\s\S]*?)```/);
  expect(m, 'prompt 必须含一个 ```json 代码块').toBeTruthy();
  return JSON.parse(m![1]!);
}

describe('prompt 生成器 · 六类必需信息（她 #6.2 的闭环契约）', () => {
  const prompt = buildCustomLibraryPrompt();

  it('① 硬规则：schema 字面量 / 字节上限 / usr. 前缀 / items 1–200 / presets 1–20', () => {
    expect(prompt).toContain(CUSTOM_LIBRARY_SCHEMA); // 'idplan-custom-library/v1'
    expect(prompt).toContain(`${Math.floor(CUSTOM_LIBRARY_MAX_BYTES / 1024)}KB`); // 256KB
    expect(prompt).toContain('usr.');
    expect(prompt).toContain('items 阶段 1-200 个');
    expect(prompt).toContain('presets 套餐 1-20 个');
  });

  it('② 字段表：ratioPercent / colorIndex / kanbanColumn 白名单全量 / defaultTasks ≤20', () => {
    expect(prompt).toContain('ratioPercent');
    expect(prompt).toContain('colorIndex');
    expect(prompt).toContain('1-9 的整数');
    expect(prompt).toContain('defaultTasks');
    expect(prompt).toContain(`最多 ${20} 条`);
    // 看板列白名单全量在 prompt 里（从 schema 常量生成，不许手抄）。
    // 注：真实取值是 **23** 个（已与 templates/stage-library.json 的 distinct 列核对一致）；
    // schema 源注释写的「24 列」是既有笔误，以常量/数据为准（已报 team-lead）。
    expect(KANBAN_COLUMN_VALUES).toHaveLength(23);
    for (const col of KANBAN_COLUMN_VALUES) {
      expect(prompt, `看板列 ${col} 必须在字段表里`).toContain(col);
    }
  });

  it('③ 引用完整性：preset.itemKeys 悬空 = 最常见的错误，prompt 里显式警告 + 自查指引', () => {
    expect(prompt).toContain('itemKeys');
    expect(prompt).toContain('必须能在同一个文件的 items[] 里找到');
    expect(prompt).toContain('整个文件会被拒收');
    expect(prompt).toContain('逐一比对');
  });

  it('④ 10 个可挂靠板块：domain 白名单 + 中文名逐一在', () => {
    const entries = Object.entries(DOMAIN_LABELS);
    expect(entries).toHaveLength(10);
    for (const [key, label] of entries) {
      expect(prompt, `板块 ${key}（${label}）必须在列`).toContain(`${key}（${label}）`);
    }
  });

  it('⑤ 最小完整示例：prompt 自带，2 阶段 + 1 套餐，抠出来真能过现有校验', () => {
    const fromPrompt = extractExampleFromPrompt(prompt);
    const result = validateCustomLibrary(fromPrompt);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.issues)).toBe(true);
    if (result.ok) {
      expect(result.library.items).toHaveLength(2);
      expect(result.library.presets).toHaveLength(1);
      expect(result.library.presets[0]!.itemKeys).toEqual(result.library.items.map((i) => i.key));
    }
    // 导出常量与 prompt 内嵌示例同一份（tsc 已按 CustomLibraryFile 类型钉住形状）
    const direct = validateCustomLibrary(CUSTOM_LIBRARY_MINIMAL_EXAMPLE);
    expect(direct.ok).toBe(true);
  });

  it('⑥ 输出格式令：只输出一个 JSON 代码块、不要前言解释、存为 .json', () => {
    expect(prompt).toContain('只输出一个 JSON 代码块');
    expect(prompt).toContain('不要任何前言、解释、总结');
    expect(prompt).toContain('.json');
    // 全文只有一个 ```json 代码块（示例），不出现第二个
    expect(prompt.match(/```json/g)).toHaveLength(1);
  });

  it('反向：不放内置 74 阶段清单（避免 Agent 模仿内置而不是生成用户自己的流程）', () => {
    for (const builtin of ['indoor.', 'landscape.', 'architecture.', 'software.', 'indoor_full']) {
      expect(prompt, `不得出现内置阶段 key 前缀 ${builtin}`).not.toContain(builtin);
    }
    expect(prompt).not.toContain('方案设计'); // 内置阶段名style抽样（若将来内置改名此断言失效，属预期收紧点）
  });
});

describe('prompt 常量 ⇔ schema 行为锚点（防 prompt 数字与校验规则漂移）', () => {
  const base = CUSTOM_LIBRARY_MINIMAL_EXAMPLE;
  const item = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...base.items[0]!,
    ...over,
  });

  it('items 上限 200：201 个阶段被拒（prompt 写 1-200）', () => {
    const lib = {
      ...base,
      items: Array.from({ length: 201 }, (_, n) => item({ key: `usr.s${n}` })),
    };
    expect(validateCustomLibrary(lib).ok).toBe(false);
  });

  it('presets 上限 20：21 个套餐被拒（prompt 写 1-20）', () => {
    const lib = {
      ...base,
      presets: Array.from({ length: 21 }, (_, n) => ({
        key: `usr.p${n}`,
        name: `套餐${n}`,
        description: '',
        itemKeys: ['usr.site'],
      })),
    };
    expect(validateCustomLibrary(lib).ok).toBe(false);
  });

  it('defaultTasks 上限 20：第 21 条被拒（prompt 写 最多 20 条）', () => {
    const lib = {
      ...base,
      items: [item({ defaultTasks: Array.from({ length: 21 }, (_, n) => `t${n}`) }), base.items[1]!],
    };
    expect(validateCustomLibrary(lib).ok).toBe(false);
  });

  it('ratioPercent 0/101 与 colorIndex 0/10 被拒（prompt 写 0<r≤100 / 1-9）', () => {
    for (const bad of [0, 101]) {
      const lib = { ...base, items: [item({ ratioPercent: bad }), base.items[1]!] };
      expect(validateCustomLibrary(lib).ok, `ratio=${bad}`).toBe(false);
    }
    for (const bad of [0, 10]) {
      const lib = { ...base, items: [item({ colorIndex: bad }), base.items[1]!] };
      expect(validateCustomLibrary(lib).ok, `colorIndex=${bad}`).toBe(false);
    }
  });
});

describe('prompt 尾部拼接（① 用户一句话 / ③ 附上现有库作参照）', () => {
  it('用户的一句话描述拼在尾部', () => {
    const text = buildCustomLibraryPrompt({ userNote: '  社区咖啡店，选址到开业  ' });
    expect(text.endsWith('【用户的一句话描述】\n社区咖啡店，选址到开业')).toBe(true);
  });

  it('不传 note / 传空串 = 不加该段', () => {
    const bare = buildCustomLibraryPrompt();
    expect(bare).not.toContain('【用户的一句话描述】');
    expect(buildCustomLibraryPrompt({ userNote: '   ' })).not.toContain('【用户的一句话描述】');
  });

  it('附上参照库：尾部含现有库 JSON（去勾则不含）', () => {
    const lib: StoredCustomLibrary = {
      schema: CUSTOM_LIBRARY_SCHEMA,
      name: '我已有的茶空间库',
      domain: 'indoor',
      items: [
        { key: 'usr.a', name: '阶段A', ratioPercent: 50, colorIndex: 1, kanbanColumn: 'design', defaultResponsibility: '', defaultTasks: [] },
        { key: 'usr.b', name: '阶段B', ratioPercent: 50, colorIndex: 2, kanbanColumn: 'build', defaultResponsibility: '', defaultTasks: [] },
      ],
      presets: [{ key: 'usr.p', name: '全流程', description: '', itemKeys: ['usr.a', 'usr.b'] }],
      importedAt: '2026-10-06T00:00:00.000Z',
    };
    const withRef = buildCustomLibraryPrompt({ referenceLibraries: [lib] });
    expect(withRef).toContain('【用户当前的行业库 · 仅供参考，不要照抄】');
    expect(withRef).toContain(JSON.stringify([lib], null, 2));
    expect(withRef.endsWith(JSON.stringify([lib], null, 2))).toBe(true);

    const withoutRef = buildCustomLibraryPrompt({ referenceLibraries: [] });
    expect(withoutRef).not.toContain('我已有的茶空间库');
  });

  it('note 与参照库同时在时：顺序 = 主体 → note → 参照库', () => {
    const lib: StoredCustomLibrary = {
      schema: CUSTOM_LIBRARY_SCHEMA,
      name: '参照库X',
      domain: 'travel',
      items: [{ key: 'usr.t', name: '踩点', ratioPercent: 100, colorIndex: 1, kanbanColumn: 'research', defaultResponsibility: '', defaultTasks: [] }],
      presets: [{ key: 'usr.tp', name: '全流程', description: '', itemKeys: ['usr.t'] }],
      importedAt: '2026-10-06T00:00:00.000Z',
    };
    const text = buildCustomLibraryPrompt({ userNote: '徒步路线规划', referenceLibraries: [lib] });
    const noteAt = text.indexOf('【用户的一句话描述】');
    const refAt = text.indexOf('【用户当前的行业库');
    expect(noteAt).toBeGreaterThan(0);
    expect(refAt).toBeGreaterThan(noteAt);
  });
});

describe('失败路径人话化（⑥）', () => {
  it('路径翻译：items.3.key → 第 4 个阶段 / presets.1 → 第 2 个套餐 / (root) → 整个文件', () => {
    expect(translateCustomLibraryIssue({ path: 'items.3.key', message: '阶段 key 必须以 usr. 开头' }))
      .toBe('第 4 个阶段的key：阶段 key 必须以 usr. 开头');
    expect(translateCustomLibraryIssue({ path: 'presets.1', message: 'Required' }))
      .toBe('第 2 个套餐：Required');
    expect(translateCustomLibraryIssue({ path: '(root)', message: '整个文件太大了' }))
      .toBe('整个文件：整个文件太大了');
    expect(translateCustomLibraryIssue({ path: '', message: '空的' }))
      .toBe('整个文件：空的');
  });

  it('带原文时带出它是谁：第 4 个阶段（名字/key）', () => {
    const raw = {
      items: [
        { key: 'usr.a', name: '一' },
        { key: 'usr.b', name: '二' },
        { key: 'usr.c', name: '三' },
        { key: 'usr.site', name: '选址' },
      ],
    };
    expect(translateCustomLibraryIssue({ path: 'items.3', message: '坏' }, raw))
      .toBe('第 4 个阶段（选址）：坏');
    // 有 key 无 name 时退到 key
    const keyOnly = { items: [null, null, null, { key: 'usr.zzz' }] };
    expect(translateCustomLibraryIssue({ path: 'items.3', message: '坏' }, keyOnly))
      .toBe('第 4 个阶段（usr.zzz）：坏');
  });

  it('细分路径：defaultTasks.5 / itemKeys.2 / 根字段名', () => {
    expect(translateCustomLibraryIssue({ path: 'items.2.defaultTasks.5', message: '太短' }))
      .toBe('第 3 个阶段的第 6 条默认任务：太短');
    expect(translateCustomLibraryIssue({ path: 'presets.0.itemKeys.2', message: '悬空' }))
      .toBe('第 1 个套餐引用的第 3 个阶段 key：悬空');
    expect(translateCustomLibraryIssue({ path: 'items.1.ratioPercent', message: '超了' }))
      .toBe('第 2 个阶段的占比：超了');
    expect(translateCustomLibraryIssue({ path: 'name', message: '必填' }))
      .toBe('包名：必填');
    expect(translateCustomLibraryIssue({ path: 'domain', message: '无效' }))
      .toBe('主板块：无效');
    expect(translateCustomLibraryIssue({ path: 'items', message: '重复' }))
      .toBe('阶段列表：重复');
  });

  it('引用完整性错误路径（presets.<key>）自明：不重复加前缀', () => {
    expect(translateCustomLibraryIssue({ path: 'presets.usr.tea-full', message: '套餐「茶空间全流程」引用了不存在的阶段 key：usr.ghost' }))
      .toBe('套餐「茶空间全流程」引用了不存在的阶段 key：usr.ghost');
  });

  it('未知路径原样兜底（不吞位置）', () => {
    expect(describeCustomLibraryPath('weird.thing')).toBe('weird.thing');
    expect(translateCustomLibraryIssue({ path: 'weird.thing', message: 'X' }))
      .toBe('weird.thing：X');
  });

  it('一键复制全部错误：编号修正单 + 翻译版行', () => {
    const issues = [
      { path: 'items.0.key', message: '阶段 key 必须以 usr. 开头（小写字母/数字/连字符）' },
      { path: 'presets.0.itemKeys.2', message: '引用了不存在的阶段 key：usr.ghost' },
    ];
    const text = buildAgentFeedbackText(issues);
    expect(text.split('\n')).toHaveLength(3);
    expect(text).toContain('请按下面每一条修正，然后重新只输出一个 JSON 代码块');
    expect(text).toContain('1. 第 1 个阶段的key：阶段 key 必须以 usr. 开头（小写字母/数字/连字符）');
    expect(text).toContain('2. 第 1 个套餐引用的第 3 个阶段 key：引用了不存在的阶段 key：usr.ghost');
  });

  it('真链路：坏包跑 validateCustomLibrary → 翻译后人话（items.3.key 场景）', () => {
    const bad = {
      schema: CUSTOM_LIBRARY_SCHEMA,
      name: '坏包',
      domain: 'indoor',
      items: [
        { key: 'usr.ok1', name: '甲', ratioPercent: 10, colorIndex: 1, kanbanColumn: 'design', defaultResponsibility: '', defaultTasks: [] },
        { key: 'usr.ok2', name: '乙', ratioPercent: 10, colorIndex: 1, kanbanColumn: 'design', defaultResponsibility: '', defaultTasks: [] },
        { key: 'usr.ok3', name: '丙', ratioPercent: 10, colorIndex: 1, kanbanColumn: 'design', defaultResponsibility: '', defaultTasks: [] },
        { key: 'bad.site', name: '选址', ratioPercent: 10, colorIndex: 1, kanbanColumn: 'design', defaultResponsibility: '', defaultTasks: [] },
      ],
      presets: [{ key: 'usr.p', name: '全流程', description: '', itemKeys: ['usr.ok1', 'usr.ok2', 'usr.ok3', 'bad.site'] }],
    };
    const r = validateCustomLibrary(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const lines = r.issues.map((i) => translateCustomLibraryIssue(i, bad));
    // 「第 4 个阶段」+ 原文带出的名字「（选址）」——位置 + 它是谁，都给
    expect(lines[0]).toBe('第 4 个阶段（选址）的key：阶段 key 必须以 usr. 开头（小写字母/数字/连字符）');
  });
});
