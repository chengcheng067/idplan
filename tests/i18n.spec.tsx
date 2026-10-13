// @vitest-environment jsdom
/**
 * 界面语言（中 / 英）地基守卫（2026-10-13 · 语言切换批 1）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 本 spec 守六件**机器可判**的事（每条都对应一个会真实发生的坏结果）
 * ══════════════════════════════════════════════════════════════════════
 *   ① **单一取词出口**：`src/**`（排除 `src/i18n/**`）不许直接 import
 *      `i18n/messages/*` / `i18n/translate` / `i18n/lang`。
 *      坏结果：消费方四散 import ⇒ 将来若要换第三方 i18n 库就得全仓改，
 *      「可替换性」这条设计前提当场作废。
 *   ② **中英两列都得给**：键集完全一致、英文非空、且不含未翻译的中文
 *      （`appearance.lang.zh` 例外——语言名按惯例写自己的母语）。
 *      坏结果：英文界面里冒出中文，或英文表只填了一半。
 *   ③ **中文值不许漂移**：`messages/zh.ts` 与 `core/types/enums.ts` 那五张
 *      标签表**逐键同值**。批 1 把枚举值留在了 enums（打印层与三条既有 spec
 *      都吃中文值），于是「两处中文」成了事实——本锁把「两处」压成「一处」。
 *      坏结果：改了一处忘了另一处，中文界面里出现两种口径。
 *   ④ **出厂默认恒为中文**：`DEFAULT_LANG === 'zh'`，且语言状态**不跟随浏览器**。
 *      坏结果：英文系统的用户/CI 环境一打开就变英文（2742 条既有用例与产品
 *      文案口径全按中文建立）。
 *   ⑤ `t()` 的插值语义：`{name}` 被替换；**找不到的占位符原样保留**
 *      （漏传变量要一眼看得见，而不是渲染成 `undefined`）。
 *   ⑥ 语言状态的落 DOM 与持久化：`<html lang>`（zh-CN / en）、
 *      `<html data-lang>`、`localStorage['idplan-lang']`；**存储不可用时静默降级**
 *      不抛错（与 `useTheme` 同款）。
 *
 * ⚠️ 本文件**不**替代真 Chromium 验收。真机四项（切英文界面真变、切回中文复原、
 *   刷新后保持、首帧不闪）在 `settings-zones.spec.ts` 同底座跑构建产物，见批 1 报告。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import {
  ALL_LANGS,
  DEFAULT_LANG,
  MEMBER_ACTOR_KIND_KEYS,
  MEMBER_ROLE_KEYS,
  MESSAGE_KEYS,
  REST_POLICY_KEYS,
  SCHEDULE_BASIS_KEYS,
  STAGE_STATUS_KEYS,
  TASK_STATUS_KEYS,
  WEEKDAY_FULL_KEYS,
  WEEKDAY_SHORT_KEYS,
  catalogOf,
  getLang,
  isMessageKey,
  memberRoleLabel,
  restPolicyLabel,
  setLang,
  t,
  taskStatusLabel,
  useLang,
  weekdayFullLabel,
  weekdayShortLabel,
  writebackStatusLabel,
} from '../src/i18n';
import {
  MEMBER_ACTOR_KIND_LABELS,
  MEMBER_ROLE_LABELS,
  REST_POLICY_LABELS,
  SCHEDULE_BASIS_LABELS,
  TASK_STATUS_LABELS,
  MemberActorKind,
  MemberRoleKind,
  RestPolicyKind,
  ScheduleBasis,
  StageStatus,
  TaskStatus,
} from '../src/core/types/enums';

const ROOT = resolve(__dirname, '..');

/** 恢复出厂中文（本 spec 会切到 en，必须回收——进程级单例，见 setup.ts 的同类教训） */
function resetLang(): void {
  setLang('zh');
  try {
    localStorage.removeItem('idplan-lang');
  } catch {
    /* 忽略 */
  }
}

beforeEach(resetLang);
afterEach(resetLang);

/* ══════════════════════ ① 单一取词出口（源码守卫） ══════════════════════ */

describe('① 单一取词出口：src/** 只许从 `src/i18n` 取词', () => {
  /** 递归收集 src（排除 i18n 自身）下的 ts/tsx */
  function srcFiles(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (p.split(/[\\/]/).includes('i18n')) continue;
        srcFiles(p, acc);
      } else if (/\.tsx?$/.test(name)) acc.push(p);
    }
    return acc;
  }

  /** import 语句的目标模块（含 `import type` / 副作用 import / 动态 import） */
  function importedModules(source: string): string[] {
    const out: string[] = [];
    const res = [
      /(?:^|\n)\s*import\s+(?:type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/g,
      /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const re of res) for (const m of source.matchAll(re)) out.push(m[1]!);
    return out;
  }

  it('src/ 里任何 import 到 i18n 的路径都必须落在 `src/i18n` 这一个模块上', () => {
    const offenders: string[] = [];
    for (const f of srcFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(f, 'utf-8');
      for (const mod of importedModules(src)) {
        if (!mod.includes('i18n')) continue;
        // 合法形态：`../i18n` / './i18n' / '../../i18n'（解析到 src/i18n/index.ts）
        if (!/(^|\/)i18n$/.test(mod)) {
          offenders.push(`${f.replace(ROOT + '\\', '').replace(ROOT + '/', '')}  →  ${mod}`);
        }
      }
    }
    expect(
      offenders,
      '以下文件绕过了唯一出口直取 i18n 内部模块（换库时这些都要改 ⇒ 可替换性作废）：\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('守卫自身有效：src/ 里确实存在经 `src/i18n` 取词的文件（否则上面那条会空过）', () => {
    const consumers = srcFiles(resolve(ROOT, 'src')).filter((f) =>
      importedModules(readFileSync(f, 'utf-8')).some((m) => /(^|\/)i18n$/.test(m)),
    );
    expect(consumers.length).toBeGreaterThanOrEqual(1);
  });

  it('守卫自身有效：messages/* 确实在 src/i18n 下（路径写错会变成永不命中的空锁）', () => {
    expect(readFileSync(resolve(ROOT, 'src/i18n/messages/zh.ts'), 'utf-8')).toContain(
      'export const zhMessages',
    );
    expect(readFileSync(resolve(ROOT, 'src/i18n/messages/en.ts'), 'utf-8')).toContain(
      'export const enMessages',
    );
  });
});

/* ══════════════════════ ② 两列都得给 ══════════════════════ */

describe('② 中英两列齐全', () => {
  it('英文表键集与中文表**完全一致**（运行期兜底；编译期由 Record<MessageKey,…> 兜）', () => {
    const en = catalogOf('en');
    expect(Object.keys(en).sort()).toEqual([...MESSAGE_KEYS].sort());
  });

  it('每条英文都非空，且不是把键名照抄回来的占位', () => {
    const en = catalogOf('en');
    const bad = MESSAGE_KEYS.filter((k) => en[k].trim() === '' || en[k] === k);
    expect(bad, `以下键的英文为空或就是键名本身：${bad.join(', ')}`).toEqual([]);
  });

  it('英文里不得残留中文（语言名 `中文` 按惯例写母语，是唯一例外）', () => {
    const en = catalogOf('en');
    const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
    const bad = MESSAGE_KEYS.filter((k) => k !== 'appearance.lang.zh' && CJK.test(en[k]));
    expect(bad, `以下键的英文仍含中文（漏译）：${bad.join(', ')}`).toEqual([]);
  });

  it('插值占位符中英一致（漏一个 `{count}` 会让英文永远显示原始花括号）', () => {
    const zh = catalogOf('zh');
    const en = catalogOf('en');
    const holders = (s: string): string[] =>
      [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
    const bad = MESSAGE_KEYS.filter(
      (k) => holders(zh[k]).join(',') !== holders(en[k]).join(','),
    );
    expect(bad, `以下键的占位符中英不一致：${bad.join(', ')}`).toEqual([]);
  });

  it('isMessageKey 只认已登记的键', () => {
    expect(isMessageKey('nav.projects')).toBe(true);
    expect(isMessageKey('nav.notAKey')).toBe(false);
  });
});

/* ══════════ ③ 中文值不许漂移：messages/zh 与 enums.ts 逐键同值 ══════════ */

describe('③ 中文与 enums.ts 的五张标签表逐键同值（防两处漂移）', () => {
  const zh = catalogOf('zh');

  it('REST_POLICY_LABELS', () => {
    for (const k of Object.values(RestPolicyKind)) {
      expect(zh[REST_POLICY_KEYS[k]], `${k} 的中文两处不一致`).toBe(REST_POLICY_LABELS[k]);
    }
  });

  it('SCHEDULE_BASIS_LABELS', () => {
    for (const k of Object.values(ScheduleBasis)) {
      expect(zh[SCHEDULE_BASIS_KEYS[k]], `${k} 的中文两处不一致`).toBe(SCHEDULE_BASIS_LABELS[k]);
    }
  });

  it('MEMBER_ROLE_LABELS', () => {
    for (const k of Object.values(MemberRoleKind)) {
      expect(zh[MEMBER_ROLE_KEYS[k]], `${k} 的中文两处不一致`).toBe(MEMBER_ROLE_LABELS[k]);
    }
  });

  it('TASK_STATUS_LABELS', () => {
    for (const k of Object.values(TaskStatus)) {
      expect(zh[TASK_STATUS_KEYS[k]], `${k} 的中文两处不一致`).toBe(TASK_STATUS_LABELS[k]);
    }
  });

  it('MEMBER_ACTOR_KIND_LABELS', () => {
    for (const k of Object.values(MemberActorKind)) {
      expect(zh[MEMBER_ACTOR_KIND_KEYS[k]], `${k} 的中文两处不一致`).toBe(
        MEMBER_ACTOR_KIND_LABELS[k],
      );
    }
  });

  it('阶段四态（重算弹窗）：取值同改造前的 STATUS_LABELS', () => {
    expect(zh[STAGE_STATUS_KEYS[StageStatus.NotStarted]]).toBe('未开始');
    expect(zh[STAGE_STATUS_KEYS[StageStatus.InProgress]]).toBe('进行中');
    expect(zh[STAGE_STATUS_KEYS[StageStatus.Completed]]).toBe('已完成');
    expect(zh[STAGE_STATUS_KEYS[StageStatus.Delayed]]).toBe('延期');
  });

  it('星期两套粒度：短名与改造前的 `WEEKDAYS`（一~日）逐项同值，且序号 0 = 周一', () => {
    const short = WEEKDAY_SHORT_KEYS.map((k) => zh[k]);
    expect(short).toEqual(['一', '二', '三', '四', '五', '六', '日']);
    // 全名 = 短名加「周」前缀（改造前是 `周${短名}` 拼串，换载体不换语义）
    const full = WEEKDAY_FULL_KEYS.map((k) => zh[k]);
    expect(full).toEqual(short.map((w) => `周${w}`));
  });

  it('取词小函数随语言变（切换后同一次调用给出另一种语言）', () => {
    setLang('zh');
    expect(restPolicyLabel(RestPolicyKind.DoubleOff)).toBe('双休');
    expect(taskStatusLabel(TaskStatus.InProgress)).toBe('进行中');
    expect(memberRoleLabel(MemberRoleKind.Admin)).toBe('管理员');
    expect(weekdayShortLabel(0)).toBe('一');
    expect(weekdayFullLabel(0)).toBe('周一');

    setLang('en');
    expect(restPolicyLabel(RestPolicyKind.DoubleOff)).toBe(catalogOf('en')['restPolicy.doubleOff']);
    expect(taskStatusLabel(TaskStatus.InProgress)).toBe('In progress');
    expect(memberRoleLabel(MemberRoleKind.Admin)).toBe('Admin');
    expect(weekdayShortLabel(0)).toBe('Mon');
    expect(weekdayFullLabel(0)).toBe('Monday');
  });

  it('未知枚举值原样回显（上游新增写回状态时不吞成空白）', () => {
    expect(writebackStatusLabel('applied')).toBe('已应用');
    expect(writebackStatusLabel('brand_new_status')).toBe('brand_new_status');
  });
});

/* ══════════════ ④ 出厂默认恒为中文、不跟随浏览器 ══════════════ */

describe('④ 出厂默认恒为中文', () => {
  it('DEFAULT_LANG === zh，ALL_LANGS 两档', () => {
    expect(DEFAULT_LANG).toBe('zh');
    expect([...ALL_LANGS]).toEqual(['zh', 'en']);
  });

  it('语言判定**不读浏览器语言**（源码锁：不出现 navigator.language）', () => {
    const src = readFileSync(resolve(ROOT, 'src/i18n/lang.ts'), 'utf-8');
    expect(src, '一旦跟随浏览器语言，英文系统首开就变英文（无人要求的行为变更）').not.toMatch(
      /navigator\.languages?\b/,
    );
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf-8');
    expect(html).not.toMatch(/navigator\.languages?\b/);
  });

  it('index.html 的内联脚本与 lang.ts 同 key、同合法值、同回落（口径不许两处）', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf-8');
    const lang = readFileSync(resolve(ROOT, 'src/i18n/lang.ts'), 'utf-8');
    expect(html).toContain("localStorage.getItem('idplan-lang')");
    expect(lang).toContain("'idplan-lang'");
    expect(html, '内联脚本必须落 lang 与 data-lang 两个属性').toContain(
      'document.documentElement.lang',
    );
    expect(html).toContain('document.documentElement.dataset.lang');
    // 行业中立化元数据锁（industry-neutral-copy ⑤）钉住的 description 不许被本次改动碰到
    expect(html).toContain('跨行业项目排程工具');
  });
});

/* ══════════════════════ ⑤ t() 的插值与兜底语义 ══════════════════════ */

describe('⑤ t() 语义', () => {
  it('无 vars 时返回原文；有 vars 时替换 `{name}`', () => {
    expect(t('toast.projectUpdated')).toBe('项目信息已更新');
    expect(t('toast.projectCreated', { name: '某某项目' })).toBe('「某某项目」建档完成');
    expect(t('toast.tasksMovedDropped', { count: 3, dropped: 1 })).toBe(
      '已搬运 3 条任务（剥离 1 条悬空依赖）',
    );
  });

  it('占位符找不到对应变量时**原样保留**（漏传一眼可见，不渲染 undefined）', () => {
    expect(t('toast.projectCreated', {})).toBe('「{name}」建档完成');
    expect(t('toast.projectCreated', { other: 'x' })).toBe('「{name}」建档完成');
  });

  it('显式 lang 参数可覆盖当前语言（供打印层等一次性取词）', () => {
    setLang('zh');
    expect(t('nav.projects', undefined, 'en')).toBe('Projects');
    expect(t('nav.projects')).toBe('项目');
  });

  it('切到 en 后 t() 立刻返回英文（同步生效，无需刷新）', () => {
    setLang('en');
    expect(getLang()).toBe('en');
    expect(t('nav.projects')).toBe('Projects');
    setLang('zh');
    expect(t('nav.projects')).toBe('项目');
  });
});

/* ══════════ ⑥ 落 DOM / 持久化 / 存储不可用降级 ══════════ */

describe('⑥ 语言落 DOM 与持久化', () => {
  it('setLang 同步写 localStorage、<html lang> 与 <html data-lang>', () => {
    setLang('en');
    expect(localStorage.getItem('idplan-lang')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dataset.lang).toBe('en');

    setLang('zh');
    expect(localStorage.getItem('idplan-lang')).toBe('zh');
    // 中文用带地区的 zh-CN（与改造前 index.html 逐字一致）
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.documentElement.dataset.lang).toBe('zh');
  });

  it('存储不可用时静默降级：不抛错，本次会话内仍能切语言', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    try {
      expect(() => setLang('en')).not.toThrow();
      expect(getLang()).toBe('en');
      expect(document.documentElement.lang).toBe('en');
    } finally {
      spy.mockRestore();
    }
  });

  it('React 组件经 useLang() 订阅：切语言时**重渲染**出新文案', () => {
    let root: Root | null = null;
    const container = document.createElement('div');
    document.body.appendChild(container);

    function Probe(): JSX.Element {
      const { t: tt, lang } = useLang();
      return (
        <span data-probe="">
          {lang}:{tt('nav.projects')}
        </span>
      );
    }

    try {
      root = createRoot(container);
      act(() => {
        root!.render(<Probe />);
      });
      expect(container.querySelector('[data-probe]')!.textContent).toBe('zh:项目');

      act(() => {
        setLang('en');
      });
      expect(
        container.querySelector('[data-probe]')!.textContent,
        '组件未订阅语言变化 ⇒ 界面停在中文（本仓最典型的假绿）',
      ).toBe('en:Projects');

      act(() => {
        setLang('zh');
      });
      expect(container.querySelector('[data-probe]')!.textContent).toBe('zh:项目');
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });
});
