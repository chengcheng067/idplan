// @vitest-environment jsdom
/**
 * 分界表笔（第三段）· 裁 3（26 串「两处都用」拆成「core 只产结构化位置 + UI 取词」）
 * ＋ 裁 4（`custom-library.schema.ts` 的中文 `message` 一并带机器码）
 * ＋ 裁 5（file 分支的载荷串收进 core）的**语言契约**。
 *
 * ══════════════ 硬约束 1：载荷一字不变 —— 用**改前基准**，不许改后重算 ══════════════
 * 下面四张 `*_BASELINE` / `BAD_PACKAGES` 里的字符串，全部是**动代码之前**从改前实现跑出来的
 * **输出原文**（抓取脚本 `tools/capture-clprompt-baseline.mts` → `tools/clprompt-baseline.json`）。
 * 它们**不是改后重算** —— 重算只能证明「自己等于自己」，而载荷是契约：改载荷 = 改 Agent 行为。
 *
 * ══════════════ 硬约束 2：「两边不漂」= 可执行断言 ══════════════
 * 对**同一组结构化位置**，`describeCustomLibraryLocation(...)`（载荷口径）与
 * `customLibraryPathText(...)`（界面口径）在 zh 下**逐字相等** —— 本文件一条 spec 同时读两份，
 * 任一侧改动即红。逐条 issue 同理（`translateCustomLibraryIssue` vs `customLibraryIssueText`）。
 *
 * ══════════════ 硬约束 3：core 零 `t(`、零 i18n import ══════════════
 * 落成对 `src/core/**` **全目录**的源码扫描断言（服务端 `tsc` 零错误是另一半，在提交说明里）。
 *
 * ══════════════ 硬约束 4：`FIELD_LABELS` / `ROOT_LABELS` 的**交换条件** ══════════════
 * core 保留中文表作**载荷取值**（载荷侧不能引 i18n，没有第二个选择，team-lead 明确接受
 * 这个「同一个词两个物理位置」的代价）；消息表 zh 由本文件断言与它**逐字相等**、en 另写；
 * 且键集**双向相等**：少一个 ⇒ 英文态露中文；多一个 ⇒ 死词条。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildAgentFeedbackText,
  buildAgentFileFailureText,
  customLibraryPathLocation,
  describeCustomLibraryLocation,
  describeCustomLibraryPath,
  translateCustomLibraryIssue,
  CUSTOM_LIBRARY_FIELD_LABELS,
  CUSTOM_LIBRARY_ROOT_LABELS,
} from '../src/core/template/custom-library.prompt';
import {
  validateCustomLibrary,
  CUSTOM_LIBRARY_KEY_PREFIX,
  CUSTOM_LIBRARY_MAX_BYTES,
  CUSTOM_LIBRARY_SCHEMA,
} from '../src/core/template/custom-library.schema';
import {
  CUSTOM_LIBRARY_FIELD_KEYS,
  CUSTOM_LIBRARY_ISSUE_KEYS,
  CUSTOM_LIBRARY_KIND_KEYS,
  CUSTOM_LIBRARY_ROOT_KEYS,
  catalogOf,
  customLibraryIssueText,
  setLang,
  customLibraryPathText,
  type MessageKey,
} from '../src/i18n';
import { maskComments } from './helpers/cjk-locator-guard';

const rootDir = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(rootDir, p), 'utf8');
const PROMPT = 'src/core/template/custom-library.prompt.ts';
const SCHEMA = 'src/core/template/custom-library.schema.ts';
const UI = 'src/components/settings/CustomLibrarySection.tsx';

/* ══════════════════════ 夹具（与抓基准时**同一份**） ══════════════════════ */

/** 抓基准时那份「原文」，供位置翻译取「它是谁」 */
const RAW = {
  name: '坏包',
  presets: [{ key: 'usr.p', name: '全流程' }],
  items: [
    { key: 'usr.ok1', name: '甲' },
    { key: 'usr.ok2', name: '乙' },
    { key: 'usr.ok3', name: '丙' },
    { key: 'usr.site', name: '选址' },
  ],
};
const KEY_ONLY = { items: [null, null, null, { key: 'usr.zzz' }] };
const NOT_ARRAY = { items: 'not-an-array' };
const PRESET_NO_NAME = { presets: [{ key: 'usr.p' }] };

/* ══════════ 改前基准 · ① 路径人话（36 组：位置形态全覆盖） ══════════ */

const PATH_BASELINE: ReadonlyArray<{ path: string; raw: unknown; before: string }> = [
  { path: "(root)", raw: undefined, before: "整个文件" },
  { path: "", raw: undefined, before: "整个文件" },
  { path: "items", raw: RAW, before: "阶段列表" },
  { path: "presets", raw: RAW, before: "套餐列表" },
  { path: "items.3", raw: RAW, before: "第 4 个阶段（选址）" },
  { path: "items.3.key", raw: RAW, before: "第 4 个阶段（选址）的key" },
  { path: "presets.0", raw: RAW, before: "第 1 个套餐（全流程）" },
  { path: "presets.0.itemKeys.2", raw: RAW, before: "第 1 个套餐（全流程）引用的第 3 个阶段 key" },
  { path: "items.2.defaultTasks.5", raw: RAW, before: "第 3 个阶段（丙）的第 6 条默认任务" },
  { path: "items.1.ratioPercent", raw: RAW, before: "第 2 个阶段（乙）的占比" },
  { path: "items.0.customColor", raw: RAW, before: "第 1 个阶段（甲）的自定义主色" },
  { path: "items.0.defaultResponsibility", raw: RAW, before: "第 1 个阶段（甲）的默认责任人" },
  { path: "items.0.kanbanColumn", raw: RAW, before: "第 1 个阶段（甲）的看板列" },
  { path: "items.0.colorIndex", raw: RAW, before: "第 1 个阶段（甲）的色号" },
  { path: "items.0.defaultTasks", raw: RAW, before: "第 1 个阶段（甲）的默认任务" },
  { path: "items.0.customColor", raw: RAW, before: "第 1 个阶段（甲）的自定义主色" },
  { path: "items.0.name", raw: RAW, before: "第 1 个阶段（甲）的名称" },
  { path: "presets.0.description", raw: RAW, before: "第 1 个套餐（全流程）的说明" },
  { path: "presets.0.itemKeys", raw: RAW, before: "第 1 个套餐（全流程）的阶段 key 列表" },
  { path: "presets.0.name", raw: RAW, before: "第 1 个套餐（全流程）的名称" },
  { path: "presets.0.key", raw: RAW, before: "第 1 个套餐（全流程）的key" },
  { path: "name", raw: RAW, before: "包名" },
  { path: "domain", raw: RAW, before: "主板块" },
  { path: "schema", raw: RAW, before: "版本标识" },
  { path: "items", raw: RAW, before: "阶段列表" },
  { path: "presets", raw: RAW, before: "套餐列表" },
  { path: "presets.usr.p", raw: RAW, before: "" },
  { path: "weird.thing", raw: RAW, before: "weird.thing" },
  { path: "items.0.unknownField", raw: RAW, before: "第 1 个阶段（甲）的unknownField" },
  { path: "mystery", raw: RAW, before: "mystery" },
  { path: "items.3", raw: undefined, before: "第 4 个阶段" },
  { path: "items.3", raw: KEY_ONLY, before: "第 4 个阶段（usr.zzz）" },
  { path: "items.3", raw: NOT_ARRAY, before: "第 4 个阶段" },
  { path: "items.0.defaultTasks.0", raw: RAW, before: "第 1 个阶段（甲）的第 1 条默认任务" },
  { path: "items.0.itemKeys.0", raw: RAW, before: "第 1 个阶段（甲）引用的第 1 个阶段 key" },
  { path: "presets.0.itemKeys", raw: PRESET_NO_NAME, before: "第 1 个套餐（usr.p）的阶段 key 列表" },
];

/* ══════════ 改前基准 · ② 单条 issue 翻译（13 组） ══════════ */

const ISSUE_BASELINE: ReadonlyArray<{ path: string; message: string; before: string }> = [
  { path: "items.3.key", message: "阶段 key 必须以 usr. 开头（小写字母/数字/连字符）", before: "第 4 个阶段（选址）的key：阶段 key 必须以 usr. 开头（小写字母/数字/连字符）" },
  { path: "presets.1", message: "Required", before: "第 2 个套餐：Required" },
  { path: "(root)", message: "整个文件太大了", before: "整个文件：整个文件太大了" },
  { path: "", message: "空的", before: "整个文件：空的" },
  { path: "items.3", message: "坏", before: "第 4 个阶段（选址）：坏" },
  { path: "items.2.defaultTasks.5", message: "太短", before: "第 3 个阶段（丙）的第 6 条默认任务：太短" },
  { path: "presets.0.itemKeys.2", message: "悬空", before: "第 1 个套餐（全流程）引用的第 3 个阶段 key：悬空" },
  { path: "items.1.ratioPercent", message: "超了", before: "第 2 个阶段（乙）的占比：超了" },
  { path: "name", message: "必填", before: "包名：必填" },
  { path: "domain", message: "无效", before: "主板块：无效" },
  { path: "items", message: "重复", before: "阶段列表：重复" },
  { path: "presets.usr.tea-full", message: "套餐「茶空间全流程」引用了不存在的阶段 key：usr.ghost", before: "套餐「茶空间全流程」引用了不存在的阶段 key：usr.ghost" },
  { path: "weird.thing", message: "X", before: "weird.thing：X" },
];

/* ══════════ 改前基准 · ③ 真链路：16 个坏包 → issues + 复制给 Agent 的修正单 ══════════ */

const GOOD_ITEM = {
  key: 'usr.ok1',
  name: '甲',
  ratioPercent: 10,
  colorIndex: 1,
  kanbanColumn: 'design',
  defaultResponsibility: '',
  defaultTasks: [] as string[],
};
const basePkg = () => ({
  schema: CUSTOM_LIBRARY_SCHEMA,
  name: '坏包',
  domain: 'indoor',
  items: [{ ...GOOD_ITEM }],
  presets: [{ key: 'usr.p', name: '全流程', description: '', itemKeys: ['usr.ok1'] }],
});

/**
 * 16 个坏包：**七个中文码**（tooLarge / customColorHex / itemKeyPrefix / presetKeyPrefix /
 * danglingItemKey / duplicateItemKey / duplicatePresetKey）各一个，外加九个 zod 默认消息
 * （英文原样透传，改造前后行为一致）。
 */
const BAD_PACKAGES: ReadonlyArray<{ label: string; raw: unknown; bytes?: number }> = [
  { label: 'tooLarge', raw: basePkg(), bytes: CUSTOM_LIBRARY_MAX_BYTES + 1 },
  { label: 'customColorHex', raw: { ...basePkg(), items: [{ ...GOOD_ITEM, customColor: 'red' }] } },
  { label: 'itemKeyPrefix', raw: { ...basePkg(), items: [{ ...GOOD_ITEM, key: 'bad.site' }] } },
  {
    label: 'presetKeyPrefix',
    raw: { ...basePkg(), presets: [{ key: 'bad.p', name: '全流程', description: '', itemKeys: ['usr.ok1'] }] },
  },
  {
    label: 'danglingItemKey',
    raw: { ...basePkg(), presets: [{ key: 'usr.p', name: '全流程', description: '', itemKeys: ['usr.ghost'] }] },
  },
  { label: 'duplicateItemKey', raw: { ...basePkg(), items: [{ ...GOOD_ITEM }, { ...GOOD_ITEM }] } },
  {
    label: 'duplicatePresetKey',
    raw: {
      ...basePkg(),
      presets: [
        { key: 'usr.p', name: '全流程', description: '', itemKeys: ['usr.ok1'] },
        { key: 'usr.p', name: '全流程', description: '', itemKeys: ['usr.ok1'] },
      ],
    },
  },
  { label: 'zodRequired', raw: { ...basePkg(), name: undefined } },
  { label: 'zodType', raw: { ...basePkg(), items: 'nope' } },
  { label: 'zodEnum', raw: { ...basePkg(), domain: 'nope' } },
  { label: 'zodLiteral', raw: { ...basePkg(), schema: 'nope' } },
  { label: 'zodTooShort', raw: { ...basePkg(), items: [{ ...GOOD_ITEM, name: '' }] } },
  { label: 'zodTooLong', raw: { ...basePkg(), items: [{ ...GOOD_ITEM, name: 'x'.repeat(51) }] } },
  { label: 'zodRatio', raw: { ...basePkg(), items: [{ ...GOOD_ITEM, ratioPercent: 0 }] } },
  { label: 'zodColorIdx', raw: { ...basePkg(), items: [{ ...GOOD_ITEM, colorIndex: 10 }] } },
  {
    label: 'zodTasksMax',
    raw: { ...basePkg(), items: [{ ...GOOD_ITEM, defaultTasks: Array.from({ length: 21 }, (_, n) => `t${n}`) }] },
  },
];

/** label → 改前的 issues 与 `buildAgentFeedbackText` 输出原文 */
const FEEDBACK_BASELINE: Readonly<Record<string, { issues: ReadonlyArray<{ path: string; message: string }>; feedback: string }>> = {
  "tooLarge": {
    issues: [{ path: "(root)", message: "行业包超过 256KB 上限（当前 257KB）" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 整个文件：行业包超过 256KB 上限（当前 257KB）",
  },
  "customColorHex": {
    issues: [{ path: "items.0.customColor", message: "customColor 必须是 #RRGGBB 十六进制" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 第 1 个阶段（甲）的自定义主色：customColor 必须是 #RRGGBB 十六进制",
  },
  "itemKeyPrefix": {
    issues: [{ path: "items.0.key", message: "阶段 key 必须以 usr. 开头（小写字母/数字/连字符）" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 第 1 个阶段（甲）的key：阶段 key 必须以 usr. 开头（小写字母/数字/连字符）",
  },
  "presetKeyPrefix": {
    issues: [{ path: "presets.0.key", message: "套餐 key 必须以 usr. 开头" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 第 1 个套餐（全流程）的key：套餐 key 必须以 usr. 开头",
  },
  "danglingItemKey": {
    issues: [{ path: "presets.usr.p", message: "套餐「全流程」引用了不存在的阶段 key：usr.ghost" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 套餐「全流程」引用了不存在的阶段 key：usr.ghost",
  },
  "duplicateItemKey": {
    issues: [{ path: "items", message: "阶段 key 在包内重复" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 阶段列表：阶段 key 在包内重复",
  },
  "duplicatePresetKey": {
    issues: [{ path: "presets", message: "套餐 key 在包内重复" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 套餐列表：套餐 key 在包内重复",
  },
  "zodRequired": {
    issues: [{ path: "name", message: "Required" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 包名：Required",
  },
  "zodType": {
    issues: [{ path: "items", message: "Expected array, received string" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 阶段列表：Expected array, received string",
  },
  "zodEnum": {
    issues: [{ path: "domain", message: "Invalid enum value. Expected 'indoor' | 'landscape' | 'architecture' | 'exhibition' | 'software' | 'marketing' | 'film' | 'wedding' | 'consulting' | 'travel', received 'nope'" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 主板块：Invalid enum value. Expected 'indoor' | 'landscape' | 'architecture' | 'exhibition' | 'software' | 'marketing' | 'film' | 'wedding' | 'consulting' | 'travel', received 'nope'",
  },
  "zodLiteral": {
    issues: [{ path: "schema", message: "Invalid literal value, expected \"idplan-custom-library/v1\"" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 版本标识：Invalid literal value, expected \"idplan-custom-library/v1\"",
  },
  "zodTooShort": {
    issues: [{ path: "items.0.name", message: "String must contain at least 1 character(s)" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 第 1 个阶段（usr.ok1）的名称：String must contain at least 1 character(s)",
  },
  "zodTooLong": {
    issues: [{ path: "items.0.name", message: "String must contain at most 50 character(s)" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 第 1 个阶段（xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx）的名称：String must contain at most 50 character(s)",
  },
  "zodRatio": {
    issues: [{ path: "items.0.ratioPercent", message: "Number must be greater than 0" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 第 1 个阶段（甲）的占比：Number must be greater than 0",
  },
  "zodColorIdx": {
    issues: [{ path: "items.0.colorIndex", message: "Number must be less than or equal to 9" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 第 1 个阶段（甲）的色号：Number must be less than or equal to 9",
  },
  "zodTasksMax": {
    issues: [{ path: "items.0.defaultTasks", message: "Array must contain at most 20 element(s)" }],
    feedback: "我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：\n1. 第 1 个阶段（甲）的默认任务：Array must contain at most 20 element(s)",
  },
};

/* ══════════ 改前基准 · ④ file 分支（裁 5 收拢前的组件原文） ══════════ */

const FILE_BRANCH_BASELINE: ReadonlyArray<{ message: string; before: string }> = [
  { message: '文件超过 256KB 上限（当前 300KB）', before: "我的行业包导入失败了：文件超过 256KB 上限（当前 300KB）。请修复后重新只输出一个 JSON 代码块。" },
  { message: '不是 JSON', before: "我的行业包导入失败了：不是 JSON。请修复后重新只输出一个 JSON 代码块。" },
];

/* ══════════════════════════ 硬约束 1 ══════════════════════════ */

describe('硬约束 1 · 载荷零变化（逐字等于**改前**输出原文，不是重算）', () => {
  it('① 路径人话 36 组', () => {
    PATH_BASELINE.forEach((c, i) => {
      expect(describeCustomLibraryPath(c.path, c.raw), `#${i} ${c.path}`).toBe(c.before);
    });
  });

  it('② 单条 issue 翻译 13 组', () => {
    ISSUE_BASELINE.forEach((c, i) => {
      expect(translateCustomLibraryIssue(c, RAW), `#${i} ${c.path}`).toBe(c.before);
    });
  });

  it('③ 16 个坏包：issues 的 (path, message) 与复制给 Agent 的修正单都逐字相同', () => {
    for (const c of BAD_PACKAGES) {
      const expect_ = FEEDBACK_BASELINE[c.label]!;
      expect(expect_, `${c.label} 不在基准表里`).toBeTruthy();
      const r = validateCustomLibrary(c.raw, c.bytes);
      expect(r.ok, `${c.label} 本该被拒`).toBe(false);
      if (r.ok) continue;
      expect(
        r.issues.map((i) => ({ path: i.path, message: i.message })),
        `${c.label} 的 issues 漂了`,
      ).toEqual(expect_.issues);
      expect(buildAgentFeedbackText(r.issues, c.raw), `${c.label} 的修正单漂了`).toBe(expect_.feedback);
    }
  });

  it('④ file 分支两支（裁 5：收拢前后逐字相同）', () => {
    for (const c of FILE_BRANCH_BASELINE) {
      expect(buildAgentFileFailureText(c.message), c.message).toBe(c.before);
    }
    // 反向：组件里**不许**再长出那份载荷原文（收拢成一处）
    expect(maskComments(read(UI)), '组件里又出现了载荷原文').not.toContain('我的行业包导入失败了');
  });
});

/* ══════════════════════════ 硬约束 2 ══════════════════════════ */

describe('硬约束 2 · 两边不漂（一条 spec 同时读载荷口径与界面口径）', () => {
  it('★ 路径：同一组结构化位置，载荷口径 === 界面口径（zh），且都等于改前基准', () => {
    PATH_BASELINE.forEach((c, i) => {
      const loc = customLibraryPathLocation(c.path, c.raw);
      const payload = describeCustomLibraryLocation(loc);
      expect(payload, `#${i} ${c.path} 载荷口径`).toBe(c.before);
      expect(customLibraryPathText(loc), `#${i} ${c.path} 界面口径 ≠ 载荷口径`).toBe(payload);
    });
  });

  it('★ 逐条 issue：界面 zh 串 === 载荷串（16 个坏包全覆盖，7 码 + 9 个 zod 默认消息）', () => {
    for (const c of BAD_PACKAGES) {
      const r = validateCustomLibrary(c.raw, c.bytes);
      if (r.ok) continue;
      const payload = r.issues.map((i) => translateCustomLibraryIssue(i, c.raw));
      expect(r.issues.map((i) => customLibraryIssueText(i, c.raw)), `${c.label} 两侧不一致`).toEqual(payload);
    }
  });

  it('★ 界面口径不是「照抄载荷」：换语言即换串（证明它真的走了消息表）', () => {
    const loc = customLibraryPathLocation('items.3', RAW);
    const zh = customLibraryPathText(loc);
    // `setLang` 会落 DOM ⇒ 本文件用 jsdom 环境；切换放在 try **内**，
    // 否则 `setLang` 自己抛错时 finally 不会执行、语言会**泄漏**到后面的用例
    // （第一版就是这么翻的车：后续 8 条用例全在英文态下断言中文）。
    try {
      setLang('en');
      expect(customLibraryPathText(loc), '英文态没变 ⇒ 界面口径根本没走消息表').not.toBe(zh);
      expect(customLibraryPathText(loc)).toBe('stage 4 (选址)');
      expect(
        customLibraryIssueText({
          path: 'items.0.key',
          message: 'X',
          code: 'itemKeyPrefix',
          params: { prefix: 'usr.' },
        }, RAW),
      ).toBe('stage 1 (甲) · key: Stage key must start with usr. (lowercase letters, digits, hyphens)');
    } finally {
      setLang('zh');
    }
    expect(customLibraryPathText(loc), '语言没还原 ⇒ 后面的用例会误判').toBe(zh);
  });
});

/* ══════════════════════════ 硬约束 4：双向集合相等 + 取值逐字 ══════════════════════════ */

describe('硬约束 4 · 载荷表 ⟺ 界面键表（键集双向相等 + zh 取值逐字相等）', () => {
  it('★ 字段表：`CUSTOM_LIBRARY_FIELD_LABELS` 的键集 === `CUSTOM_LIBRARY_FIELD_KEYS` 的键集', () => {
    expect(Object.keys(CUSTOM_LIBRARY_FIELD_KEYS).sort()).toEqual(
      Object.keys(CUSTOM_LIBRARY_FIELD_LABELS).sort(),
    );
  });

  it('★ 根级表：`CUSTOM_LIBRARY_ROOT_LABELS` 的键集 === `CUSTOM_LIBRARY_ROOT_KEYS` 的键集', () => {
    expect(Object.keys(CUSTOM_LIBRARY_ROOT_KEYS).sort()).toEqual(
      Object.keys(CUSTOM_LIBRARY_ROOT_LABELS).sort(),
    );
  });

  it('★ 每个字段的 zh 取值与载荷表**逐字相等**（这一条就是「交换条件」的可执行形式）', () => {
    const zh = catalogOf('zh');
    for (const [field, label] of Object.entries(CUSTOM_LIBRARY_FIELD_LABELS)) {
      expect(zh[CUSTOM_LIBRARY_FIELD_KEYS[field]!], `字段 ${field} 两侧漂了`).toBe(label);
    }
    for (const [field, label] of Object.entries(CUSTOM_LIBRARY_ROOT_LABELS)) {
      expect(zh[CUSTOM_LIBRARY_ROOT_KEYS[field]!], `根级字段 ${field} 两侧漂了`).toBe(label);
    }
  });

  it('★ 两处共用同一个键的四个词（K10：同一个词只建一个键）', () => {
    for (const shared of ['domain', 'schema', 'items', 'presets']) {
      expect(CUSTOM_LIBRARY_ROOT_KEYS[shared], `${shared} 被拆成了两个键`).toBe(
        CUSTOM_LIBRARY_FIELD_KEYS[shared],
      );
    }
    // 唯一**有意**分家的一个词：根上的 name 是「包名」，条目里的 name 是「名称」
    expect(CUSTOM_LIBRARY_ROOT_KEYS.name).not.toBe(CUSTOM_LIBRARY_FIELD_KEYS.name);
  });

  it('★ 失败码集：真链路能跑出来的码集 === 键表的键集 === zh 表 `customLibrary.issue.*` 反解的码集', () => {
    const produced = new Set<string>();
    for (const c of BAD_PACKAGES) {
      const r = validateCustomLibrary(c.raw, c.bytes);
      if (r.ok) continue;
      for (const i of r.issues) if (i.code !== undefined) produced.add(i.code);
    }
    const tableCodes = Object.keys(CUSTOM_LIBRARY_ISSUE_KEYS).sort();
    const catalogCodes = Object.keys(catalogOf('zh'))
      .filter((k) => k.startsWith('customLibrary.issue.'))
      .map((k) => k.slice('customLibrary.issue.'.length))
      .sort();
    // 少一个码 ⇒ 英文态那一行仍是中文；多一个键 ⇒ 死词条
    expect([...produced].sort(), '7 个中文码没有全部被真链路覆盖').toEqual(tableCodes);
    expect(catalogCodes).toEqual(tableCodes);
  });

  it('★ 七码逐一可复现：每个码都**真的**由一个坏包跑出来（不是手抄清单）', () => {
    const hit: Record<string, string> = {};
    for (const c of BAD_PACKAGES) {
      const r = validateCustomLibrary(c.raw, c.bytes);
      if (r.ok) continue;
      for (const i of r.issues) if (i.code !== undefined) hit[i.code] = c.label;
    }
    expect(hit).toEqual({
      tooLarge: 'tooLarge',
      customColorHex: 'customColorHex',
      itemKeyPrefix: 'itemKeyPrefix',
      presetKeyPrefix: 'presetKeyPrefix',
      danglingItemKey: 'danglingItemKey',
      duplicateItemKey: 'duplicateItemKey',
      duplicatePresetKey: 'duplicatePresetKey',
    });
  });
});

/* ══════════════════════════ 硬约束 3：core 侧零 i18n ══════════════════════════ */

function coreFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...coreFiles(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** 相对仓根的 POSIX 路径（断言消息用；也让登记表与平台无关） */
const rel = (p: string): string => p.slice(rootDir.length + 1).replace(/\\/g, '/');

/**
 * ⚠️ `src/core/**` 里**唯一**允许 import i18n 的文件（**显式登记**，新增即红）。
 *
 * 为什么它不是违规：`PluginSandboxFrame.tsx` 是**渲染层组件**（React 帧），只是物理上
 * 落在 `src/core/plugin/`；它不进服务端 program（那份 tsconfig 收的是 `.ts` 共享内核）。
 * 判据不是「文件名在哪个目录」，而是「**服务端 program 收不收**」—— 所以这里既断言
 * 「除它之外一个都没有」，也断言「登记表里没有多余项」（防止登记表腐化成万能豁免）。
 * 📌 这是本笔**顺带查到**的既有事实（不是本笔引入），已如实登记并回报 team-lead。
 */
const CORE_I18N_EXCEPTIONS = new Set<string>(['src/core/plugin/PluginSandboxFrame.tsx']);

/** 命中「引了 i18n」或「调了 t(」的 core 文件（相对路径，POSIX） */
function coreI18nHits(): string[] {
  const files = coreFiles(join(rootDir, 'src/core'));
  return files
    .filter((p) => {
      const code = maskComments(readFileSync(p, 'utf8'));
      return /from\s+'[^']*i18n/.test(code) || /require\([^)]*i18n/.test(code) || /[^.\w]t\(/.test(code);
    })
    .map(rel)
    .sort();
}

describe('硬约束 3 · `src/core/**` 零 i18n（全目录扫描，不是只看本笔那两个文件）', () => {
  const files = coreFiles(join(rootDir, 'src/core'));

  it('扫描面非空（防止断言在空集合上恒真）', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('★ 除显式登记的渲染组件外，没有任何 core 文件 import i18n 或调 `t(`', () => {
    const bad = coreI18nHits().filter((p) => !CORE_I18N_EXCEPTIONS.has(p));
    expect(bad, 'core 引了 i18n ⇒ 服务端 program 会拖进 document / 出现界面取词').toEqual([]);
  });

  it('★ 登记表不许腐化：豁免集**恰好**等于真的命中集（多一项即红）', () => {
    expect(coreI18nHits()).toEqual([...CORE_I18N_EXCEPTIONS].sort());
  });

  it('★ 本笔碰的两个 core 文件（分界表那两个）**不在**豁免表里（不许给自己开后门）', () => {
    expect(CORE_I18N_EXCEPTIONS.has(PROMPT)).toBe(false);
    expect(CORE_I18N_EXCEPTIONS.has(SCHEMA)).toBe(false);
  });

  it('★ 7 条中文 message 在 schema 源码里**各只出现一次**（都在载荷模板表 ISSUE_TEXT 里，没散在函数里）', () => {
    const code = maskComments(read(SCHEMA));
    const frags = [
      '行业包超过 ',
      'customColor 必须是 #RRGGBB 十六进制',
      '阶段 key 必须以 ',
      '套餐 key 必须以 ',
      '引用了不存在的阶段 key：',
      '阶段 key 在包内重复',
      '套餐 key 在包内重复',
    ];
    for (const frag of frags) {
      const n = code.split(frag).length - 1;
      expect(n, `「${frag}」在 schema 源码里出现 ${n} 次（应为 1：载荷模板表是唯一出处）`).toBe(1);
    }
  });
});

/* ══════════════════════════ 消费锁 / 调用形状锁 ══════════════════════════ */

describe('消费锁（K14）· 键表里每一条都真的被取词函数用上', () => {
  const zh = catalogOf('zh');

  it('★ 字段表 14 条都有展示点（经 `customLibraryPathText` 真的被渲染出来）', () => {
    for (const field of Object.keys(CUSTOM_LIBRARY_FIELD_LABELS)) {
      const got = customLibraryPathText(customLibraryPathLocation(`items.0.${field}`, RAW));
      expect(got, `字段 ${field} 的文案没被用上`).toBe(`第 1 个阶段（甲）的${zh[CUSTOM_LIBRARY_FIELD_KEYS[field]!]}`);
    }
  });

  it('★ 根级表 5 条都有展示点', () => {
    for (const field of Object.keys(CUSTOM_LIBRARY_ROOT_LABELS)) {
      const got = customLibraryPathText(customLibraryPathLocation(field, RAW));
      expect(got, `根级字段 ${field} 的文案没被用上`).toBe(zh[CUSTOM_LIBRARY_ROOT_KEYS[field]!]);
    }
  });

  it('★ 两个名词键都有展示点（`第 N 个{阶段|套餐}`）', () => {
    expect(customLibraryPathText({ kind: 'entry', list: 'items', n: 3, who: null })).toBe(
      `第 4 个${zh[CUSTOM_LIBRARY_KIND_KEYS.items]}`,
    );
    expect(customLibraryPathText({ kind: 'entry', list: 'presets', n: 0, who: null })).toBe(
      `第 1 个${zh[CUSTOM_LIBRARY_KIND_KEYS.presets]}`,
    );
  });

  it('★ 位置的三个「带前缀」模板都有展示点', () => {
    expect(customLibraryPathText({ kind: 'entryField', list: 'items', n: 0, who: '甲', field: 'ratioPercent' }))
      .toBe('第 1 个阶段（甲）的占比');
    expect(customLibraryPathText({ kind: 'entryTask', list: 'items', n: 0, who: null, taskN: 1 }))
      .toBe('第 1 个阶段的第 2 条默认任务');
    expect(customLibraryPathText({ kind: 'entryItemKey', list: 'presets', n: 0, who: '全流程', keyN: 2 }))
      .toBe('第 1 个套餐（全流程）引用的第 3 个阶段 key');
  });

  it('★ 未知字段名 / 未知根级字段回落字段名本身（**不吞位置、不写中文兜底**）', () => {
    expect(customLibraryPathText(customLibraryPathLocation('items.0.unknownField', RAW))).toBe(
      '第 1 个阶段（甲）的unknownField',
    );
    expect(customLibraryPathText(customLibraryPathLocation('mystery', RAW))).toBe('mystery');
  });

  it('★ 无码 issue 原样透传 `message`（K22：兜底句可翻、真因不许改写、也不新增兜底语言）', () => {
    expect(customLibraryIssueText({ path: 'name', message: 'Required' })).toBe('包名：Required');
    expect(customLibraryIssueText({ path: 'items', message: 'Expected array, received string' })).toBe(
      '阶段列表：Expected array, received string',
    );
  });

  it('★ 码是**参数化**的：换参数即换取值（真因没被码吃掉）', () => {
    expect(
      customLibraryIssueText(
        { path: 'items.0.key', message: 'X', code: 'itemKeyPrefix', params: { prefix: 'zz.' } },
        RAW,
      ),
    ).toBe('第 1 个阶段（甲）的key：阶段 key 必须以 zz. 开头（小写字母/数字/连字符）');
    expect(
      customLibraryIssueText({ path: '(root)', message: 'X', code: 'tooLarge', params: { max: 9, size: 12 } }),
    ).toBe('整个文件：行业包超过 9KB 上限（当前 12KB）');
  });

  it('★ 界面口径 === 载荷口径 的**传参形态**：前缀参数与 schema 常量同源', () => {
    const issue = { path: 'items.0.key', message: 'x', code: 'itemKeyPrefix' as const, params: { prefix: CUSTOM_LIBRARY_KEY_PREFIX } };
    // ⚠️ key 必须**只**违反前缀正则（'bad' 只有 3 字符 ⇒ 还会撞 min(4)，issues[0] 就不是这一码）
    const r = validateCustomLibrary({ ...basePkg(), items: [{ ...GOOD_ITEM, key: 'bad.site' }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]!.code).toBe('itemKeyPrefix');
    expect(r.issues[0]!.params).toEqual({ prefix: CUSTOM_LIBRARY_KEY_PREFIX });
    expect(customLibraryIssueText(issue)).toContain(CUSTOM_LIBRARY_KEY_PREFIX);
  });
});

describe('调用形状锁（不是「文件里出现过某字面量」）', () => {
  it('★ 组件逐条渲染走 `customLibraryIssueText(i, failure.raw)`', () => {
    expect(maskComments(read(UI))).toMatch(/customLibraryIssueText\(i, failure\.raw\)/);
  });

  it('★ 组件**不再**直接调载荷翻译（载荷口径只服务剪贴板那条路）', () => {
    expect(maskComments(read(UI))).not.toMatch(/translateCustomLibraryIssue\s*\(/);
  });

  it('★ file 分支走 core 的 `buildAgentFileFailureText(failure.message)`', () => {
    expect(maskComments(read(UI))).toMatch(/buildAgentFileFailureText\(failure\.message\)/);
  });

  it('★ 结构化位置**必填**参数不给默认值（K6：漏传即编译错，不靠约定）', () => {
    expect(customLibraryPathLocation.length).toBe(2); // (path, raw?)
    expect(describeCustomLibraryLocation.length).toBe(1);
    expect(buildAgentFileFailureText.length).toBe(1);
    expect(customLibraryIssueText.length).toBe(2);
  });

  it('★ 载荷口径的两个函数仍是「纯函数」签名（界面侧不许改它们的语义）', () => {
    expect(describeCustomLibraryPath.length).toBe(2);
    expect(translateCustomLibraryIssue.length).toBe(2);
  });
});

/* ══════════════════════════ 两列齐全（en 侧） ══════════════════════════ */

describe('en 侧：本笔新增的键全部非空、无汉字、且不是照抄键名', () => {
  const zh = catalogOf('zh');
  const en = catalogOf('en');
  const KEYS = [
    ...Object.values(CUSTOM_LIBRARY_FIELD_KEYS),
    ...Object.values(CUSTOM_LIBRARY_ROOT_KEYS),
    ...Object.values(CUSTOM_LIBRARY_KIND_KEYS),
    ...Object.values(CUSTOM_LIBRARY_ISSUE_KEYS),
  ];
  /** 按设计**就该**与中文相同的：`key` 是 JSON 字段名本身，两种语言都写 `key` */
  const SAME_BY_DESIGN = new Set<string>(['customLibrary.label.key']);

  it('★ 非空 / 无汉字 / 不是键名', () => {
    const CJK = /[\u4e00-\u9fff]/;
    for (const k of KEYS) {
      expect(en[k]?.length ?? 0, `${k} 英文为空`).toBeGreaterThan(0);
      expect(CJK.test(en[k]!), `${k} 英文里混了汉字`).toBe(false);
      expect(en[k], `${k} 的英文就是键名`).not.toBe(k);
    }
  });

  it('★ 与中文不同（除显式登记的 `customLibrary.label.key`）', () => {
    const same = KEYS.filter((k) => !SAME_BY_DESIGN.has(k) && en[k] === zh[k]);
    expect(same, `以下键中英取值相同（要么补翻，要么登记进 SAME_BY_DESIGN）`).toEqual([]);
  });

  it('★ 位置模板的中英占位符逐个一致（漏一个会让英文永远显示花括号）', () => {
    const holders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
    // `Object.keys` 返回 `string[]` ⇒ 断言为 `MessageKey[]` 才能索引两份 catalog
    const pathKeys = (Object.keys(zh) as MessageKey[]).filter((k) => k.startsWith('customLibrary.path.'));
    expect(pathKeys.length, '位置模板键数变了 ⇒ 复核本断言').toBe(7);
    for (const k of pathKeys) expect(holders(en[k]!), k).toEqual(holders(zh[k]!));
  });
});
