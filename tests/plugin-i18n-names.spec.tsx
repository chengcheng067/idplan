// @vitest-environment jsdom
/**
 * 插件族 · **界面显示名/说明 + 两条口径**（英文补齐批 · 段 5 之三/之四）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 这一段在修什么
 * ══════════════════════════════════════════════════════════════════════
 *   ① **内置插件名/说明**：`PluginManifest.name` / `.summary` 是**同一字段两种来源**
 *      —— 内置来自编译期 manifest（中文写死）、自装来自磁盘 JSON（作者任意语言）。
 *      只翻内置那份 ⇒ 同一列里一半英文一半中文、且读者分不清哪种才是"正常形态"。
 *      ⇒ 处置（判 B）：**core 一个字不动**，渲染层按 `id` 映射（`pluginDisplayName/Summary`）。
 *   ② **「作者没写说明」**：core 原先写死中文兜底「（作者未提供说明）」
 *      —— core 拿不到界面语言，写下中文 = 英文界面永远显示中文。
 *      ⇒ core 只落**空串**，人话由渲染层取 `t('plugin.noSummary')`（值与原兜底**逐字相同**）。
 *   ③ **「无 Provider」降级档**：原先 `new Error('插件注册表不可用（无 Provider），无法保存开关')`
 *      ⇒ UI 的 `describeToggleFailure` 只对 `ChangxiaError` 走 `resolveErrorText`（能出英文），
 *        对其它 `Error` 会把 `err.message`（中文）当参数插进英文句子。
 *      ⇒ 改成 `coreError(Validation, 'coreErr.plugin.registryUnavailable')`。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 本条最容易假绿的地方，以及本文件怎么堵它
 * ══════════════════════════════════════════════════════════════════════
 * ① 的映射表**可以**写成「只覆盖当前这一件内置插件」而全绿 —— 于是下一个人加第 2 件内置
 *    插件、忘了登记一行，它在英文界面上就是中文，**没有任何测试会红**。
 * ⇒ 故本条按 **AST 从 `PluginRegistryProvider.tsx` 读出真实清单数组**（不是手抄一份名字），
 *    再把每个 id 拿去查表。加插件 = 清单数组多一个标识符 = 这里先红。
 *
 * ③ 的映射同理**可以**写成「core 改了，但 UI 那条 `err.message` 仍在」而全绿
 * （`resolveErrorText` 出英文是一回事，UI 有没有用它、会不会仍然读 `.message` 是另一回事）。
 * ⇒ 故本条用 **AST 定位 `describeToggleFailure`**，断言：
 *    · 该函数里**没有任何** `err.message` 落在 `err instanceof ChangxiaError` 的**块内**；
 *    · 恰好有 1 处落在块外（= 非 ChangxiaError 那一支，那里读 `.message` 才正确）。
 *    这条钉的是**规则本身**：`ChangxiaError.message`（带 `[changxia:<code>] ` 机器前缀）
 *    **永远不许进用户可见文案**。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import {
  PLUGIN_NAME_KEYS,
  PLUGIN_SUMMARY_KEYS,
  pluginDisplayName,
  pluginDisplaySummary,
  setLang,
  t,
} from '../src/i18n';
import { zh as coreZh, en as coreEn } from '../src/i18n/messages/parts/core';
import { ChangxiaError, coreError, ChangxiaErrorCode, resolveErrorText } from '../src/core/types/enums';
import { CORE_ERROR_TEXT } from '../src/core/types/core-error-text';
import { mergeInstalledManifests } from '../src/core/plugin/installed';
import { sampleProjectsManifest } from '../src/core/plugin/builtin/sample-projects.manifest';
import { PLUGIN_MANIFESTS } from '../src/core/plugin/builtin/index';
import { weeklyReportManifest } from '../src/plugins/weekly-report/manifest';

const ROOT = resolve(__dirname, '..');
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const zhTable = coreZh as Record<string, string>;
const enTable = coreEn as Record<string, string>;

beforeEach(() => setLang('zh'));
afterEach(() => setLang('zh'));

/* ══════════════════ ① 映射表 / 显示名 / 说明 ══════════════════ */

describe('插件名 · ① 映射表按 domain-id 语义：读数来自**真实清单**，不是手抄', () => {
  /** ★ 从 `PluginRegistryProvider.tsx` 的 `BUILTIN_MANIFESTS` 数组字面量里读标识符 */
  function builtinManifestIdentifiers(): string[] {
    const file = resolve(ROOT, 'src/core/plugin/PluginRegistryProvider.tsx');
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let out: string[] | null = null;
    const visit = (n: ts.Node): void => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === 'BUILTIN_MANIFESTS' &&
        n.initializer &&
        ts.isArrayLiteralExpression(n.initializer)
      ) {
        out = n.initializer.elements.map((el) => {
          // `...PLUGIN_MANIFESTS` ⇒ 取 `PLUGIN_MANIFESTS`；`sampleProjectsManifest` ⇒ 原样
          if (ts.isSpreadElement(el)) return el.expression.getText(sf);
          return el.getText(sf);
        });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (out === null) throw new Error('没找到 BUILTIN_MANIFESTS 数组 —— 锚点变了，请更新本 spec');
    return out;
  }

  it('★ 清单数组的标识符集 = 本 spec 登记的解析表（加内置插件时**这里先红**）', () => {
    expect(builtinManifestIdentifiers().sort()).toEqual(
      ['PLUGIN_MANIFESTS', 'sampleProjectsManifest', 'weeklyReportManifest'].sort(),
    );
  });

  it('★ 两张键表的 id 集**相等**（防只加名不加说明 / 反之）', () => {
    expect(Object.keys(PLUGIN_NAME_KEYS).sort()).toEqual(Object.keys(PLUGIN_SUMMARY_KEYS).sort());
  });

  it('★★ 全族不变式：**每一个**内置插件的名与说明，在 en 下都不含汉字', () => {
    /*
     * 这条才是本条真正的判据（与「载体」无关）——
     * `PluginManifest.name/.summary` 是**同一列里并排显示**的字段，只要有一件漏了，
     * 用户在英文界面上就同时看到英文与中文两种插件名，且分不清哪种是"正常形态"。
     * 它同时覆盖两种载体（见下一条的 `isGetterCarried`）：
     *   · getter 载体 —— `plugins/agent-board` / `plugins/weekly-report`（在 `src/plugins/**`，
     *     可以 import i18n，故用 `get name() { return t('…') }`）；
     *   · id 映射载体 —— `core/plugin/builtin/sample-projects`（**在 core 里，不许 import i18n**
     *     ⇒ 只能由渲染层按 id 取词，见 `src/i18n/labels.ts` 的 `PLUGIN_NAME_KEYS`）。
     */
    const all = [...PLUGIN_MANIFESTS, sampleProjectsManifest, weeklyReportManifest];
    expect(all.length, '内置插件数量变了 —— 新那件必须先在 labels.ts 登记名与说明').toBe(3);
    setLang('en');
    for (const m of all) {
      expect(pluginDisplayName(m), `${m.id} 的名在英文界面上是中文`).not.toMatch(CJK);
      expect(pluginDisplaySummary(m), `${m.id} 的说明在英文界面上是中文`).not.toMatch(CJK);
    }
    setLang('zh');
    for (const m of all) {
      expect(pluginDisplayName(m), `${m.id} 的名在中文界面上不该是英文`).toMatch(CJK);
    }
  });

  it('★ 载体判据：**字面量载体**的必须登记进 id 表；getter 载体的不需要（`sample-projects` 是前者）', () => {
    /*
     * `get name() { return t('…') }` 这种 manifest（`src/plugins/**` 那两件）自带 i18n 能力，
     * 渲染层拿到的**已经是当前语言**的串 ⇒ 不需要 id 映射，也不该重复登记。
     * `core/plugin/builtin/sample-projects` 是**字面量**载体（core 不许 import i18n）
     * ⇒ 必须由 id 表兜住。这条把「哪些需要登记」变成**可判定的**，而不是靠人记。
     */
    const isGetterCarried = (o: object, f: string): boolean =>
      typeof Object.getOwnPropertyDescriptor(o, f)?.get === 'function';

    const all = [...PLUGIN_MANIFESTS, sampleProjectsManifest, weeklyReportManifest];
    for (const m of all) {
      for (const field of ['name', 'summary'] as const) {
        const registered = Object.prototype.hasOwnProperty.call(PLUGIN_NAME_KEYS, m.id);
        if (isGetterCarried(m, field)) {
          expect(registered, `${m.id} 的 ${field} 已是 getter 载体，不该重复登记进 id 表`).toBe(false);
        } else {
          expect(registered, `${m.id} 的 ${field} 是字面量载体 ⇒ 必须登记进 id 表`).toBe(true);
        }
      }
    }
  });

  it('★ zh 取值逐字等于 core manifest 里的原文（「默认中文」零变化）', () => {
    expect(zhTable['plugin.builtin.sampleProjects.name']).toBe(sampleProjectsManifest.name);
    expect(zhTable['plugin.builtin.sampleProjects.summary']).toBe(sampleProjectsManifest.summary);
  });

  it('★ 自装插件（未登记的 id）**原样**返回作者写的 name/summary，不做任何加工', () => {
    const member = { id: 'my-third-party', name: '我的插件', summary: '作者自己的说明' };
    expect(pluginDisplayName(member)).toBe('我的插件');
    expect(pluginDisplaySummary(member)).toBe('作者自己的说明');
  });

  it('★ 未登记 id 且 name 为空 ⇒ 回落 id 本身（不编名字）', () => {
    expect(pluginDisplayName({ id: 'x1', name: '' })).toBe('x1');
  });

  it('★ 内置插件在 en 下给英文、不含汉字；zh 下与 core 原文一致', () => {
    setLang('zh');
    expect(pluginDisplayName(sampleProjectsManifest)).toBe(sampleProjectsManifest.name);
    expect(pluginDisplaySummary(sampleProjectsManifest)).toBe(sampleProjectsManifest.summary);

    setLang('en');
    expect(pluginDisplayName(sampleProjectsManifest)).not.toMatch(CJK);
    expect(pluginDisplaySummary(sampleProjectsManifest)).not.toMatch(CJK);
    expect(pluginDisplayName(sampleProjectsManifest)).not.toBe(sampleProjectsManifest.name);
  });
});

/* ══════════════════ ② 「作者没写说明」的空串支 ══════════════════ */

describe('插件说明 · ② 空串由渲染层补一句可翻译的占位', () => {
  it('★ core：作者没写说明 ⇒ 落**空串**，且**不含任何汉字**（core 不许写中文兜底）', () => {
    const merged = mergeInstalledManifests([], [
      {
        id: 'm1',
        name: 'm1',
        summary: '',
        version: '1.0.0',
        entry: 'index.html',
        capabilities: [],
      },
    ]);
    expect(merged[0].summary).toBe('');
    expect(merged[0].summary).not.toMatch(CJK);
  });

  it('★ 渲染层：空串 ⇒ `plugin.noSummary`；zh 值逐字等于**改动前 core 写死的**那句', () => {
    expect(zhTable['plugin.noSummary']).toBe('（作者未提供说明）');
    expect(pluginDisplaySummary({ id: 'm1', summary: '' })).toBe('（作者未提供说明）');
  });

  it('★ en：空串支不含汉字；且与 core 改动前那句**不是**同一个串（否则等于没翻）', () => {
    setLang('en');
    const out = pluginDisplaySummary({ id: 'm1', summary: '' });
    expect(out).not.toMatch(CJK);
    expect(out).not.toBe('（作者未提供说明）');
    expect(outTableHasKey('plugin.noSummary')).toBe(true);
  });
});

/* ══════════════════ ③ 「无 Provider」降级档 ══════════════════ */

describe('插件开关 · ③ 无 Provider 的失败体带机器码（不再只有中文 message）', () => {
  const kv = vi.hoisted(() => ({ rows: [] as Array<{ key: string; valueJson: string }> }));
  vi.mock('../src/hooks/useRepos', () => {
    const ok = async (): Promise<void> => undefined;
    const bundle = {
      projects: { list: async () => [], get: async () => null },
      stages: { listByProject: async () => [], get: async () => null },
      tasks: { list: async () => [], get: async () => null },
      members: { list: async () => [], get: async () => null },
      settings: { all: async () => kv.rows.map((r) => ({ ...r })), get: async () => null, set: ok, remove: ok },
      stageLogs: { listByStage: async () => [] },
      customStages: { list: async () => [] },
      dumpTables: async () => ({}),
    };
    return { useRepos: () => bundle, bootstrapAllStores: async () => undefined };
  });

  it('★ 载荷表里有这个键，且与分片 zh 逐字相等', () => {
    expect(CORE_ERROR_TEXT['coreErr.plugin.registryUnavailable']).toBe(
      '插件注册表不可用（无 Provider），无法保存开关',
    );
    expect(zhTable['coreErr.plugin.registryUnavailable']).toBe(
      CORE_ERROR_TEXT['coreErr.plugin.registryUnavailable'],
    );
  });

  it('★ 该错误是 `ChangxiaError`（UI 按 `code` 分类那一支才有英文）+ 带 `messageKey`', () => {
    const err = coreError(ChangxiaErrorCode.Validation, 'coreErr.plugin.registryUnavailable');
    expect(err).toBeInstanceOf(ChangxiaError);
    expect(err.messageKey).toBe('coreErr.plugin.registryUnavailable');
    // 载荷口径逐字 = 改动前那句裸 `Error` 的原文（协议/日志侧零变化）
    expect(err.userMessage).toBe('插件注册表不可用（无 Provider），无法保存开关');
    // 机器前缀**在 `.message` 上**（供日志定位），这正是它**不许进用户可见文案**的原因
    expect(err.message).toContain('[changxia:validation]');
  });

  it('★ `resolveErrorText` 在 en 下给英文、且**不含机器前缀**（前缀只属于日志）', () => {
    const err = coreError(ChangxiaErrorCode.Validation, 'coreErr.plugin.registryUnavailable');

    setLang('zh');
    expect(resolveErrorText(err, t)).toBe('插件注册表不可用（无 Provider），无法保存开关');

    setLang('en');
    const english = resolveErrorText(err, t);
    expect(english).not.toMatch(CJK);
    expect(english, '机器前缀泄进了用户可见文案').not.toContain('[changxia:');
  });

  it('★ 真机路径：**不包 Provider** 取 `usePluginRegistry().setPluginEnabled` ⇒ 拿到带机器码的失败体', async () => {
    const { usePluginRegistry } = await import('../src/core/plugin/PluginRegistryProvider');
    let captured: { ok: boolean; reason?: string; error?: unknown } | null = null;

    function Probe(): JSX.Element {
      const reg = usePluginRegistry();
      React.useEffect(() => {
        void reg.setPluginEnabled('sample-projects', true).then((r) => {
          captured = r as never;
        });
      }, [reg]);
      return <div data-probe="" />;
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(host);
      root.render(<Probe />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(captured).not.toBeNull();
    expect(captured!.ok).toBe(false);
    expect(captured!.reason).toBe('failed');
    expect(captured!.error).toBeInstanceOf(ChangxiaError);
    expect((captured!.error as ChangxiaError).messageKey).toBe('coreErr.plugin.registryUnavailable');

    await act(async () => {
      root?.unmount();
    });
    host.remove();
  });
});

/* ══════════════════ ④ AST：`ChangxiaError.message` 永不进用户可见文案 ══════════════════ */

describe('插件开关 · ④ 界面侧的铁律（AST 级）：ChangxiaError 那一支**不许**读 `.message`', () => {
  it('★ `describeToggleFailure`：`err.message` 恰好 1 处，且**在 `instanceof ChangxiaError` 块之外**', () => {
    const file = resolve(ROOT, 'src/components/settings/PluginsSection.tsx');
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    let fn: ts.FunctionDeclaration | null = null;
    const find = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === 'describeToggleFailure') fn = n;
      ts.forEachChild(n, find);
    };
    find(sf);
    expect(fn, '没找到 describeToggleFailure —— 锚点变了，请更新本 spec').not.toBeNull();

    /** `err instanceof ChangxiaError` 那个 if 语句的**块范围** */
    let guarded: [number, number] | null = null;
    const findIf = (n: ts.Node): void => {
      if (ts.isIfStatement(n)) {
        const c = n.expression;
        if (
          ts.isBinaryExpression(c) &&
          c.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
          ts.isIdentifier(c.right) &&
          c.right.text === 'ChangxiaError'
        ) {
          guarded = [n.thenStatement.getStart(sf), n.thenStatement.getEnd()];
        }
      }
      ts.forEachChild(n, findIf);
    };
    if (fn) findIf(fn);
    expect(guarded, '没找到 `err instanceof ChangxiaError` 分支').not.toBeNull();
    const [lo, hi] = guarded as unknown as [number, number];

    const reads: Array<{ text: string; insideGuarded: boolean }> = [];
    const walk = (n: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(n) &&
        n.name.text === 'message' &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === 'err'
      ) {
        const at = n.getStart(sf);
        reads.push({ text: n.getText(sf), insideGuarded: at >= lo && at <= hi });
      }
      ts.forEachChild(n, walk);
    };
    if (fn) walk(fn);

    expect(
      reads.filter((r) => r.insideGuarded),
      '`ChangxiaError` 那一支读了 `err.message` —— 机器前缀（`[changxia:<code>] `）会进用户可见文案',
    ).toEqual([]);
    expect(reads.length, '`err.message` 的处数变了（非 ChangxiaError 那一支应恰好 1 处）').toBe(1);
  });
});

/* 供上面那条断言复用的极小工具：en 表里有没有这个键 */
function outTableHasKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(enTable, key);
}
