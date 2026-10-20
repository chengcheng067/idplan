// @vitest-environment jsdom
/**
 * 行业**大类**（建档第 1 层那 7 项）的语言契约。
 *
 * ══════════════════════ 为什么有这一条 ══════════════════════
 * 用户 1.0.0.0012 的英文界面截图里，建档「Manual setup」的
 *   ① 第 1 层行业芯片：`建筑设计行业 / 软件开发 / 市场活动 / 影视制作 / 婚礼策划 / 咨询交付 / 旅游出行`
 *   ② 第 2 层「主板块」下拉的**组头**：`建筑设计行业 / 软件开发`
 * 仍是中文，而同一下拉里的板块项（Architecture / Landscape / Interiors / Software…）已是英文。
 *
 * 根因不是「翻漏了某个字符串」，而是**这一层从来没进过消息表**：
 * 这 7 个名字是 `templates/stage-library.json` 的 `industryGroups[].name`（随包数据），
 * 三个渲染点直接输出 `g.name` / `row.name`：
 *   · `DomainCascade.tsx` 第 1 层芯片的可见文字 **与** 其 aria-label
 *   · `IndustrySelect.tsx` 分组下拉的组头
 * 而第 2 层的 `domain.*` 早就有 `DOMAIN_LABEL_KEYS` 取词 ⇒ 于是出现
 * 「同一个下拉里，伞是中文、板块是英文」的分裂观感。
 *
 * ── 与既有两张表的关系（别混层）──
 *   · `domain.*`        = 第 2 层主板块（室内 / 景观 / 建筑…）
 *   · `industryGroup.*` = 第 1 层行业大类（伞形 + 6 个一级平铺）← 本文件守的
 *
 * ── 本文件守五件事 ──
 *   ① **覆盖锁**：JSON 的 7 个 group.key ⟷ `INDUSTRY_GROUP_KEYS` 集合双向相等
 *      （JSON 将来加第 8 个大类 ⇒ 这里红，逼出建键，而不是静默回落中文）；
 *   ② **中文零变化**：每个 `industryGroup.*` 的 zh 取值与 JSON 的 `name` **逐字节相同**；
 *   ③ **英文合格**：非空、不含汉字、与 zh 不同；
 *   ④ **两层不许撞名**：英文下伞形 `space` 不得与第 2 层的 `architecture` 同名
 *      （否则同一个下拉里出现两个 Architecture，用户分不清谁是伞）；
 *   ⑤ **渲染点真的取词了**：三个输出点走 `industryGroupLabel()`，
 *      且 `data-industry-chip-name` 仍保留 JSON 原名（那是测试锚点，不是文案）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { maskComments } from './helpers/cjk-locator-guard';
import rawLibrary from '../templates/stage-library.json';
import { DomainCascade, DEFAULT_DOMAIN_CASCADE } from '../src/components/contract-wizard/DomainCascade';
import {
  INDUSTRY_GROUP_KEYS,
  catalogOf,
  domainLabelKey,
  industryGroupLabel,
  setLang,
} from '../src/i18n';

const REPO_ROOT = join(__dirname, '..');
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/** JSON 里的 7 个行业大类（`{ key, name }`） */
const GROUPS = (rawLibrary as { industryGroups?: Array<{ key: string; name: string }> })
  .industryGroups ?? [];

function masked(rel: string): string {
  return maskComments(readFileSync(join(REPO_ROOT, rel), 'utf-8'));
}

afterEach(() => {
  setLang('zh'); // 别把英文态漏给同进程的其它 spec
  unmount();
});

/* ══════════════════════════ ⓪ 真渲染（jsdom）══════════════════════════
 *
 * 上面几组都是「取词函数 / 源码」层面的判据。这一组回答用户真正关心的那句：
 * **英文界面里那排芯片到底渲染成什么**。挂真组件、切真语言、读真 DOM。
 */

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

function mountCascade(): HTMLDivElement {
  unmount();
  const el = document.createElement('div');
  document.body.appendChild(el);
  host = el;
  root = createRoot(el);
  act(() => {
    root!.render(
      <DomainCascade value={DEFAULT_DOMAIN_CASCADE} onChange={() => undefined} />,
    );
  });
  return el;
}

/** 第 1 层 7 个芯片的可见文字（按 `data-industry-chip` 逐个读 textContent） */
function chipTexts(el: HTMLDivElement): string[] {
  return Array.from(el.querySelectorAll<HTMLButtonElement>('button[data-industry-chip]')).map(
    (b) => (b.textContent ?? '').trim(),
  );
}

describe('★ 真渲染 · 第 1 层芯片随语言变', () => {
  it('中文态：7 个芯片就是 JSON 原名（与改造前逐字相同）', () => {
    setLang('zh');
    const texts = chipTexts(mountCascade());
    expect(texts).toEqual(GROUPS.map((g) => g.name));
  });

  it('★ 英文态：7 个芯片全部是英文、且一个汉字都没有（用户截图那 7 个就是这条）', () => {
    setLang('en');
    const texts = chipTexts(mountCascade());
    expect(texts.length, '芯片数量应仍为 7').toBe(7);
    for (const t of texts) {
      expect(CJK.test(t), `英文态芯片仍是中文：${t}`).toBe(false);
    }
    expect(texts).toEqual(GROUPS.map((g) => industryGroupLabel(g.key, g.name)));
  });

  it('切换语言会重渲染（`industryGroupLabel` 不是 hook，靠组件自己的 useLang 订阅）', () => {
    const el = mountCascade();
    expect(chipTexts(el)[0]).toBe(GROUPS[0]!.name); // zh
    act(() => {
      setLang('en');
    });
    expect(chipTexts(el)[0]).toBe(industryGroupLabel(GROUPS[0]!.key, GROUPS[0]!.name));
  });

  it('芯片的 aria-label 也走取词（读屏名不会在英文态读中文）', () => {
    setLang('en');
    const el = mountCascade();
    const first = el.querySelector('button[data-industry-chip]')!;
    const aria = first.getAttribute('aria-label') ?? '';
    expect(aria.length).toBeGreaterThan(0);
    expect(CJK.test(aria.replace(industryGroupLabel(GROUPS[0]!.key, GROUPS[0]!.name), '')),
      `aria-label 里除组名外仍有汉字：${aria}`).toBe(false);
  });
});

/* ══════════════════════════ ① 覆盖锁 ══════════════════════════ */

describe('行业大类 · 覆盖锁', () => {
  it('JSON 的 group.key ⟷ 键表 集合双向相等（少一个 = 会回落中文；多一个 = 死词条）', () => {
    expect(GROUPS.length, 'JSON 里应恰好有 7 个行业大类').toBe(7);
    expect(Object.keys(INDUSTRY_GROUP_KEYS).sort()).toEqual(GROUPS.map((g) => g.key).sort());
  });

  it('每个大类的 zh 取值与 JSON 的 name 逐字节相同（默认中文零变化）', () => {
    const zh = catalogOf('zh');
    for (const g of GROUPS) {
      const key = INDUSTRY_GROUP_KEYS[g.key];
      expect(key, `${g.key} 没有映射键`).toBeTruthy();
      expect(zh[key!], `${g.key} 的 zh 取值被改动了（应与 JSON name 逐字节相同）`).toBe(g.name);
    }
  });

  it('每个大类的 en 非空、不含汉字、且与 zh 不同', () => {
    const zh = catalogOf('zh');
    const en = catalogOf('en');
    for (const g of GROUPS) {
      const key = INDUSTRY_GROUP_KEYS[g.key]!;
      expect(en[key].length, `${key} 的英文为空`).toBeGreaterThan(0);
      expect(CJK.test(en[key]), `${key} 的英文里还有汉字：${en[key]}`).toBe(false);
      expect(en[key], `${key} 中英同值（等于没翻）`).not.toBe(zh[key]);
    }
  });
});

/* ══════════════════════════ ② 行为 ══════════════════════════ */

describe('industryGroupLabel · 取词', () => {
  it('中文态：7 个大类逐字回显 JSON 原名', () => {
    setLang('zh');
    for (const g of GROUPS) {
      expect(industryGroupLabel(g.key, g.name)).toBe(g.name);
    }
  });

  it('英文态：7 个大类全部不含汉字', () => {
    setLang('en');
    for (const g of GROUPS) {
      const text = industryGroupLabel(g.key, g.name);
      expect(CJK.test(text), `${g.key} 英文态仍是中文：${text}`).toBe(false);
    }
  });

  it('★ 两层不许撞名：伞形 `space` 不得与第 2 层任何主板块同名（英文态）', () => {
    setLang('en');
    const umbrella = industryGroupLabel('space', '建筑设计行业');
    const domainTexts = [
      domainLabelKey('architecture'),
      domainLabelKey('landscape'),
      domainLabelKey('indoor'),
    ];
    expect(
      domainTexts,
      '同一个下拉里出现两个同名项（伞 vs 板块）会让用户分不清层级',
    ).not.toContain(umbrella);
  });

  it('未知 key（将来 JSON 新增大类）回落 JSON 原名，不显示空、也不显示键名', () => {
    setLang('en');
    expect(industryGroupLabel('space_station', '太空站')).toBe('太空站');
    expect(industryGroupLabel('', '')).toBe('');
  });
});

/* ══════════════════════════ ③ 渲染点 ══════════════════════════ */

describe('渲染点 · 三处必须走取词', () => {
  const DOMAIN_CASCADE = 'src/components/contract-wizard/DomainCascade.tsx';
  const INDUSTRY_SELECT = 'src/components/contract-wizard/IndustrySelect.tsx';

  it('DomainCascade 的芯片文字与 aria-label 都走 industryGroupLabel()', () => {
    const src = masked(DOMAIN_CASCADE);
    expect(src, '芯片 aria-label 仍在用 JSON 原名').toMatch(
      /wizard\.industryAria',\s*\{\s*name:\s*industryGroupLabel\(g\.key,\s*g\.name\)\s*\}/,
    );
    expect(src, '芯片可见文字仍在直出 g.name').toContain('{industryGroupLabel(g.key, g.name)}');
    // 反向：不许再有裸的 `{g.name}` 当**文案**。
    // 例外只有测试锚点 `data-industry-chip-name={g.name}`（属性值，不是渲染文字）⇒ 先抹掉再判。
    const withoutAnchor = src.replace(/data-industry-chip-name=\{g\.name\}/g, '');
    expect(withoutAnchor, '仍有裸 {g.name} 当文案').not.toMatch(/\{\s*g\.name\s*\}/);
  });

  it('IndustrySelect 的分组组头走 industryGroupLabel()', () => {
    const src = masked(INDUSTRY_SELECT);
    expect(src).toContain('{industryGroupLabel(row.key, row.name)}');
    expect(src, '组头仍在直出 row.name').not.toMatch(/\{\s*row\.name\s*\}/);
  });

  it('测试锚点仍是 JSON 原名（换钩子会连带废掉 v08 建档向导那批用例）', () => {
    expect(masked(DOMAIN_CASCADE)).toContain('data-industry-chip-name={g.name}');
    expect(masked(INDUSTRY_SELECT)).toContain('data-industry-select-group={row.key}');
  });
});
