// @vitest-environment jsdom
/**
 * 阶段名 / 快捷套餐名（随包 JSON 的数据名）的语言契约。
 *
 * ══════════════════════ 为什么有这一条 ══════════════════════
 * `templates/stage-library.json` 里 74 个阶段名（提案 / 测量 / 平面方案…）与 29 个快捷套餐名
 * （室内·全流程…）是**随包数据名**。用户在向导里选中后，阶段名会作为 `stage.name` **落库**
 * （并进备份、上月面）。英文界面里它们原先一直是中文 —— 与 1.0.0.0012 用户截图同族。
 *
 * 口径（与 `operator_name` / `Member.role` 同族）：**落库钉死中文原值 + 屏幕侧取词**。
 *   · 取值表：`STAGE_NAME_KEYS`（**按中文原值建键** ⇒ 老数据零迁移）、`PRESET_NAME_KEYS`（按 preset key）；
 *   · 取词：`stageNameLabel()` / `presetNameLabel()`，未登记值 / 用户改名 **回落原文**。
 *
 * ── 本文件守六件事 ──
 *   ① 覆盖锁：74 个 item 的中文名全部有条目；29 个 preset key 全部有条目；
 *   ② 中文零变化：每条 zh 取值与 JSON 的 `name` **逐字节相同**；
 *   ③ 英文合格：非空、不含汉字、与 zh 不同；
 *   ④ 回落语义：用户改名（「方案A」）/ 自定义库套餐 **原样回显**，绝不篡改数据；
 *   ⑤ 真渲染（jsdom）：挂真 `StageSelectPanel`，英文态下套餐按钮与阶段 chip 逐个无汉字；
 *   ⑥ **纸面不取词**：`src/print/**` 里不得出现 `stageNameLabel` / `presetNameLabel`
 *      （打印稿恒中文，取词会把屏幕语言带进纸面）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { maskComments } from './helpers/cjk-locator-guard';
import rawLibrary from '../templates/stage-library.json';
import { StageSelectPanel } from '../src/components/contract-wizard/StageSelectPanel';
import {
  PRESET_NAME_KEYS,
  STAGE_NAME_KEYS,
  catalogOf,
  presetNameLabel,
  setLang,
  stageNameLabel,
} from '../src/i18n';

const REPO_ROOT = join(__dirname, '..');
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

type Item = { key: string; name: string };
type Preset = { key: string; name: string };
const ITEMS = (rawLibrary as { items: Item[] }).items;
const PRESETS = (rawLibrary as { presets: Preset[] }).presets;
const UNIQUE_NAMES = [...new Set(ITEMS.map((it) => it.name))];

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function unmount(): void {
  if (root) {
    const r = root;
    act(() => {
      r.unmount();
    });
  }
  host?.remove();
  root = null;
  host = null;
}

function mountPanel(): HTMLDivElement {
  unmount();
  const el = document.createElement('div');
  document.body.appendChild(el);
  host = el;
  root = createRoot(el);
  act(() => {
    root!.render(
      <StageSelectPanel
        selected={[]}
        onChange={() => undefined}
        domain="indoor"
        visibleDomains={['architecture', 'landscape', 'indoor']}
      />,
    );
  });
  return el;
}

afterEach(() => {
  setLang('zh');
  unmount();
});

/* ══════════════════════════ ①②③ 覆盖锁与取值 ══════════════════════════ */

describe('阶段名 · 覆盖锁', () => {
  it('71 个唯一阶段名全部有条目（74 个 item 里有 3 组同名共用一条键）', () => {
    expect(UNIQUE_NAMES.length, 'JSON 唯一阶段名应为 71').toBe(71);
    expect(ITEMS.length).toBe(74);
    expect(Object.keys(STAGE_NAME_KEYS).length).toBe(UNIQUE_NAMES.length);
    const missing = UNIQUE_NAMES.filter((n) => STAGE_NAME_KEYS[n] === undefined);
    expect(missing, `这些阶段名没有映射键：${missing.join(' / ')}`).toEqual([]);
  });

  it('29 个快捷套餐 key 全部有条目', () => {
    expect(PRESETS.length).toBe(29);
    expect(Object.keys(PRESET_NAME_KEYS).sort()).toEqual(PRESETS.map((p) => p.key).sort());
  });

  it('每个阶段名的 zh 取值与 JSON 的 name 逐字节相同（默认中文零变化）', () => {
    const zh = catalogOf('zh');
    for (const name of UNIQUE_NAMES) {
      expect(zh[STAGE_NAME_KEYS[name]!], `「${name}」的 zh 取值被改动`).toBe(name);
    }
  });

  it('每个套餐名的 zh 取值与 JSON 的 name 逐字节相同', () => {
    const zh = catalogOf('zh');
    for (const p of PRESETS) {
      expect(zh[PRESET_NAME_KEYS[p.key]!], `「${p.name}」的 zh 取值被改动`).toBe(p.name);
    }
  });

  it('两族英文非空、不含汉字、且与 zh 不同', () => {
    const zh = catalogOf('zh');
    const en = catalogOf('en');
    const keys = [
      ...UNIQUE_NAMES.map((n) => STAGE_NAME_KEYS[n]!),
      ...PRESETS.map((p) => PRESET_NAME_KEYS[p.key]!),
    ];
    for (const key of keys) {
      expect(en[key].length, `${key} 的英文为空`).toBeGreaterThan(0);
      expect(CJK.test(en[key]), `${key} 的英文里还有汉字：${en[key]}`).toBe(false);
      expect(en[key], `${key} 中英同值（等于没翻）`).not.toBe(zh[key]);
    }
  });
});

/* ══════════════════════════ ④ 回落语义（最要紧的一条）══════════════════════════ */

describe('取词 · 回落原文（绝不篡改用户数据）', () => {
  it('中文态：阶段名与套餐名逐字回显 JSON 原名', () => {
    setLang('zh');
    for (const name of UNIQUE_NAMES) expect(stageNameLabel(name)).toBe(name);
    for (const p of PRESETS) expect(presetNameLabel(p.key, p.name)).toBe(p.name);
  });

  it('英文态：登记过的名字变英文', () => {
    setLang('en');
    expect(stageNameLabel('提案')).toBe('Proposal');
    expect(stageNameLabel('施工图深化')).toBe('Construction Drawings');
    expect(presetNameLabel('indoor_full', '室内·全流程')).toBe('Interior · Full Scope');
  });

  it('★ 用户把阶段改名后（「方案A」）原样回显 —— 不翻译、不吞字', () => {
    setLang('en');
    expect(stageNameLabel('方案A')).toBe('方案A');
    expect(stageNameLabel('Proposal')).toBe('Proposal'); // 用户自己写成英文
    expect(stageNameLabel('')).toBe('');
  });

  it('★ 自定义行业库的套餐（不在这张表里）原样回显', () => {
    setLang('en');
    expect(presetNameLabel('my_tea_space_full', '我的茶空间·全流程')).toBe('我的茶空间·全流程');
    expect(presetNameLabel('', '')).toBe('');
  });
});

/* ══════════════════════════ ⑤ 真渲染 ══════════════════════════ */

describe('★ 真渲染 · 向导里的套餐与阶段随语言变', () => {
  const texts = (el: HTMLElement, sel: string): string[] =>
    Array.from(el.querySelectorAll<HTMLElement>(sel)).map((b) => (b.textContent ?? '').trim());

  it('前提：中文态下套餐按钮与阶段 chip 真的渲染出来了（否则下面两条是空过）', () => {
    setLang('zh');
    const el = mountPanel();
    const presets = texts(el, '[data-preset]');
    const chips = texts(el, '[data-stage-chip]');
    expect(presets.length, '套餐按钮应 ≥1').toBeGreaterThan(0);
    expect(chips.length, '阶段 chip 应 ≥1').toBeGreaterThan(0);
    expect(presets.some((t) => CJK.test(t)), '中文态套餐按钮应含中文（前提）').toBe(true);
  });

  it('★ 英文态：套餐按钮与阶段 chip 逐个都无汉字', () => {
    setLang('en');
    const el = mountPanel();
    for (const sel of ['[data-preset]', '[data-stage-chip]']) {
      const list = texts(el, sel);
      expect(list.length).toBeGreaterThan(0);
      for (const t of list) {
        expect(CJK.test(t), `${sel} 英文态仍是中文：${t}`).toBe(false);
      }
    }
  });

  it('★ 切语言会重渲染（取词函数不是 hook，靠组件自己的 useLang 订阅）', () => {
    setLang('zh');
    const el = mountPanel();
    const before = texts(el, '[data-preset]')[0]!;
    expect(CJK.test(before)).toBe(true);
    act(() => {
      setLang('en');
    });
    const after = texts(el, '[data-preset]')[0]!;
    expect(CJK.test(after)).toBe(false);
  });

  it('测试锚点仍是 JSON 原名（`data-preset-name` / `data-stage-chip-name` 不是文案）', () => {
    setLang('en');
    const el = mountPanel();
    const presetNames = Array.from(
      el.querySelectorAll('[data-preset-name]'),
    ).map((b) => b.getAttribute('data-preset-name') ?? '');
    expect(presetNames.length).toBeGreaterThan(0);
    expect(
      presetNames.some((n) => CJK.test(n)),
      '锚点应保留中文原名（换掉会连带废掉既有按名字定位的用例）',
    ).toBe(true);
  });
});

/* ══════════════════════════ ⑥ 纸面不取词 ══════════════════════════ */

describe('纸面（src/print/**）不取词', () => {
  function walk(relDir: string): string[] {
    const out: string[] = [];
    const stack = [relDir];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const name of readdirSync(join(REPO_ROOT, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(join(REPO_ROOT, rel)).isDirectory()) stack.push(rel);
        else if (rel.endsWith('.ts') || rel.endsWith('.tsx')) out.push(rel);
      }
    }
    return out;
  }

  it('打印稿恒中文：src/print/** 里不得出现 stageNameLabel / presetNameLabel', () => {
    const offenders = walk('src/print').filter((rel) => {
      const src = maskComments(readFileSync(join(REPO_ROOT, rel), 'utf-8'));
      return /stageNameLabel|presetNameLabel/.test(src);
    });
    expect(offenders, `纸面不该取词：${offenders.join(', ')}`).toEqual([]);
  });
});
