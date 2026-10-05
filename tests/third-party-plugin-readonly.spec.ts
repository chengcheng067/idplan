// @vitest-environment node
/**
 * 第三方插件只读边界守卫（v0.8.6 阶段 3）
 *
 * 守的是安全官对第一个第三方插件的硬约束：**只读**。
 *
 * 为什么用「读源码文本」而不是「跑一遍看它写没写」：
 * 写能力一旦被引入，伤害是**运行期**的（用户数据被改），而跑一遍只能证明
 * 「这次跑的时候没写」。静态扫 `src/plugins/**` 里每个 member 插件的 import
 * 图 = 在**提交时**就拦住「第三方插件 import 了仓储/服务」，这正是
 * `arch-boundary.spec.ts` 的既有范式（L1 静态断言）。
 *
 * 三条锁：
 *   ① member 插件**不得** import 任何 repository / repos 句柄 / service 写入侧；
 *   ② member 插件**不得** import `useRepos`（那是全部写能力的根）；
 *   ③ manifest 的能力声明只能是 `data.read`（写/网/文件保存都不在 v1）。
 *
 * 纪律：变异实测过（往样板插件里塞一个 `useRepos` import ⇒ 本条立刻红）。
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PLUGINS_DIR = resolve(__dirname, '..', 'src', 'plugins');

/** 已知的「随包分发」插件目录——本 spec 只审 member 源，不审这些。 */
const BUILTIN_DIRS = new Set(['agent-board']);

function pluginDirs(): Array<{ name: string; path: string }> {
  return readdirSync(PLUGINS_DIR)
    .filter((d) => statSync(join(PLUGINS_DIR, d)).isDirectory())
    .map((d) => ({ name: d, path: join(PLUGINS_DIR, d) }));
}

/** 递归收集一个插件目录下的全部 ts/tsx 源文件。 */
function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSources(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** member 插件 = manifest 里 source: 'member' 的目录（不写死名字，防加新插件时漏审）。 */
function memberPlugins(): Array<{ name: string; files: string[]; manifest: string }> {
  const out: Array<{ name: string; files: string[]; manifest: string }> = [];
  for (const dir of pluginDirs()) {
    if (BUILTIN_DIRS.has(dir.name)) continue;
    const files = collectSources(dir.path);
    const manifest = files.find((f) => /manifest\.tsx?$/.test(f));
    if (!manifest) continue;
    const text = readFileSync(manifest, 'utf8');
    if (!/source:\s*'member'/.test(text)) continue;
    out.push({ name: dir.name, files, manifest });
  }
  return out;
}

describe('第三方插件 · 只读边界', () => {
  const member = memberPlugins();

  it('① 扫描器自身有效性：真的找到了 member 插件（否则本 spec 是空转的假绿）', () => {
    expect(member.length).toBeGreaterThan(0);
    expect(member.map((m) => m.name)).toContain('weekly-report');
  });

  it('② member 插件不得 import useRepos（全部写能力的根）', () => {
    const offenders: string[] = [];
    for (const plug of member) {
      for (const f of plug.files) {
        const src = readFileSync(f, 'utf8');
        if (/from\s+['"][^'"]*useRepos['"]/.test(src)) {
          offenders.push(`${plug.name}/${f.split(/[\\/]/).pop()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('③ member 插件不得 import repositories / service 写入侧', () => {
    const offenders: string[] = [];
    for (const plug of member) {
      for (const f of plug.files) {
        const src = readFileSync(f, 'utf8');
        // repository 层（local/remote/server 三形态）、备份服务、agent 写入内核
        if (/from\s+['"][^'"]*(core\/repositories|backup\.service|agent-takeover|payload\.apply)/.test(src)) {
          offenders.push(`${plug.name}/${f.split(/[\\/]/).pop()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('④ manifest 的能力声明只能是 data.read（写/网/文件保存不在 v1）', () => {
    for (const plug of member) {
      const src = readFileSync(plug.manifest, 'utf8');
      const caps = [...src.matchAll(/capabilities:\s*\[([^\]]*)\]/g)].map((m) => m[1] ?? '');
      for (const cap of caps) {
        const items = cap
          .split(',')
          .map((s) => s.trim().replace(/['"]/g, ''))
          .filter(Boolean);
        for (const item of items) {
          expect(item).toBe('data.read');
        }
      }
    }
  });

  it('⑤ member 插件默认关（defaultEnabled:false）——「装」与「开」是两件事', () => {
    for (const plug of member) {
      const src = readFileSync(plug.manifest, 'utf8');
      expect(src).toMatch(/defaultEnabled:\s*false/);
    }
  });

  it('⑥ 插件目录必须真实存在（扫描器不是在对空气断言）', () => {
    expect(existsSync(PLUGINS_DIR)).toBe(true);
    expect(pluginDirs().length).toBeGreaterThanOrEqual(2);
  });
});
