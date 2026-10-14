/**
 * 笔 4-a · 原生「打开文件」对话框的**文案来源**契约（新 spec）。
 *
 * ══════════════════ 形态（team-lead 已批准）══════════════════
 * 主进程**没有也不该有**界面语言状态 ⇒ 标题与筛选器名由**渲染层经 IPC 传进来**，主进程只当参数用。
 *
 * ══════════════════ 这个文件守四件事 ══════════════════
 * ① **退化行为可执行**：`manifestPickerOptions(…)` 拿不到（或拿到脏值）时
 *    **不带 title / 不带 filters** —— 绝不在主进程写一份中文兜底
 *    （那会变成第二份真相，且英文用户会看到中文，正是本笔要修的形态）。
 *    这是把「注释里的三条规则」变成**会红的断言**的唯一办法 ⇒ 故把选项抽成纯函数。
 * ② **主进程源码里不许再有那两句中文**（静态锁）。
 * ③ **调用形状锁**：`main.cjs` 的 handler 收 `labels` 并交给纯函数；
 *    `preload.cjs` **转发**参数；渲染层传的是 `plugin.pick.*` 的消息表取值。
 *    判「调用形状」而不是「文件里出现过某字面量」—— 后者会被注释/import 行满足（本仓实测过的假绿）。
 * ④ **桥类型的参数是可选**：老调用方（不传 labels）仍能编译，运行时走退化分支。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { catalogOf } from '../src/i18n';
import { maskComments } from './helpers/cjk-locator-guard';

// CJS 主进程模块（node 环境直 require；本模块零 Electron 依赖，见其文件头纪律）
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pluginInstall = require('../electron/plugin-install.cjs') as {
  manifestPickerOptions(labels?: unknown): {
    properties: string[];
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  };
};

const rootDir = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(rootDir, p), 'utf8');

/* ══════════════ ① 纯函数的退化行为（零容差） ══════════════ */
describe('① manifestPickerOptions：拿不到文案时的退化（主进程不许写中文兜底）', () => {
  it('传全了 ⇒ 带 title 与 filters（且 extensions 只认 json）', () => {
    expect(pluginInstall.manifestPickerOptions({ title: 'T', filterName: 'F' })).toEqual({
      properties: ['openFile'],
      title: 'T',
      filters: [{ name: 'F', extensions: ['json'] }],
    });
  });

  it.each([
    ['完全没传', undefined],
    ['传了 null', null],
    ['传了脏类型', '脏值'],
    ['title / filterName 都是空串', { title: '', filterName: '' }],
    ['字段类型不对', { title: 42, filterName: { nope: 1 } }],
  ])('★ %s ⇒ **不带** title、**不带** filters（退化，而不是退回某个语言）', (_why, input) => {
    const opts = pluginInstall.manifestPickerOptions(input);
    expect(opts).toEqual({ properties: ['openFile'] });
    expect(opts.title).toBeUndefined();
    expect(opts.filters).toBeUndefined();
  });

  it('只传 title ⇒ 只有 title（两个字段各自独立退化）', () => {
    expect(pluginInstall.manifestPickerOptions({ title: 'T' })).toEqual({
      properties: ['openFile'],
      title: 'T',
    });
  });
});

/* ══════════════ ② 主进程源码里不许再有那两句中文 ══════════════ */
describe('② 静态锁：主进程不持有文案', () => {
  const main = read('electron/main.cjs');

  it('★ `main.cjs` 里既没有那句对话框标题、也没有筛选器名（剥注释后）', () => {
    const code = maskComments(main);
    expect(code, '对话框标题被写回主进程了').not.toContain('选择插件的 manifest.json');
    expect(code, '筛选器名被写回主进程了').not.toContain('插件清单');
  });

  it('★ 调用形状：handler 收 `labels` 并把**它**交给纯函数', () => {
    const code = maskComments(main);
    expect(code).toMatch(/ipcMain\.handle\(\s*'plugin:pick-file'\s*,\s*async\s*\(\s*_event\s*,\s*labels\s*\)/);
    expect(code, '没把 labels 交给纯函数 ⇒ 传参白做').toMatch(
      /pluginInstall\.manifestPickerOptions\(\s*labels\s*\)/,
    );
    expect(code, '不再直接给对话框塞字面量').not.toMatch(/dialog\.showOpenDialog\(\s*win\s*,\s*\{/);
  });
});

/* ══════════════ ③ 端到端接线（preload 转发 + 渲染层取词） ══════════════ */
describe('③ 接线：preload 转发参数，渲染层传消息表取值', () => {
  it('preload 的 `pickManifestFile` 把参数**转发**给 IPC（不是丢掉）', () => {
    const preload = read('electron/preload.cjs');
    expect(preload).toMatch(
      /pickManifestFile:\s*\(labels\)\s*=>\s*ipcRenderer\.invoke\('plugin:pick-file',\s*labels\)/,
    );
  });

  it('渲染层传的是 `plugin.pick.title` / `plugin.pick.filterName`（调用形状）', () => {
    const src = maskComments(read('src/components/settings/PluginsSection.tsx'));
    expect(src).toMatch(/pickManifestFile\(\{[\s\S]{0,120}?title:\s*t\('plugin\.pick\.title'\)/);
    expect(src).toMatch(/pickManifestFile\(\{[\s\S]{0,160}?filterName:\s*t\('plugin\.pick\.filterName'\)/);
  });

  it('两处取值有 zh/en 两条，且都不是空串', () => {
    for (const key of ['plugin.pick.title', 'plugin.pick.filterName'] as const) {
      expect(catalogOf('zh')[key].length).toBeGreaterThan(0);
      expect(catalogOf('en')[key].length).toBeGreaterThan(0);
      expect(catalogOf('en')[key]).not.toBe(catalogOf('zh')[key]);
    }
    // 与原来写死在主进程里的那两句**逐字相同**（zh 逐字不变）
    expect(catalogOf('zh')['plugin.pick.title']).toBe('选择插件的 manifest.json');
    expect(catalogOf('zh')['plugin.pick.filterName']).toBe('插件清单');
  });

  it('桥类型的参数是**可选**（老调用方不传仍能编译，运行时走退化）', () => {
    const dts = maskComments(read('src/vite-env.d.ts'));
    expect(dts).toMatch(/pickManifestFile:\s*\(labels\?:\s*\{[\s\S]{0,120}?\}\s*\)\s*=>/);
  });
});
