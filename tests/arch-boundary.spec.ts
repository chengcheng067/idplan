/**
 * 架构边界守卫（v0.6 · T15 P1-1）。
 *
 * 背景：项目不引入 ESLint（§8.1 零新增依赖），故以**守卫测试**实现与
 * `no-restricted-imports` 等价的强制约束——CI 全量测试必跑，违规即红。
 *
 * 锁死四条铁律：
 *   1. src/ 只有 `src/core/repositories/local/dexie.database.ts` 允许 import `dexie`
 *      （P1-1 原文：「把『只有 1 个文件 import dexie』从现状变成被锁死的约束」）
 *   2. src/（渲染进程）绝不允许 import `electron` —— Electron 只经 preload.cjs
 *      桥接（换壳期权：核心逻辑零 Electron 绑定，未来可打包为纯 Web 应用）
 *   3. src/ 绝不允许 import `better-sqlite3`（服务端专属）
 *   4. `serializeAssigneeIds`/`parseAssigneeIds` 绝不允许出现在 server/（§9.2 硬禁令：
 *      该过滤会静默清空 artifacts 等对象数组）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

const ROOT = join(__dirname, '..');

/** 递归收集目录下全部 ts/tsx 文件（posix 风格相对路径，便于断言与白名单书写） */
function collect(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) collect(abs, acc);
    else if (/\.(ts|tsx)$/.test(name)) {
      acc.push(abs.slice(ROOT.length + 1).split(sep).join(posix.sep));
    }
  }
  return acc;
}

/** import 语句（含动态 import 与 `import type`）的目标模块粗提取 */
function importedModules(source: string): string[] {
  const modules: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s+(?:type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) modules.push(m[1]!);
  }
  return modules;
}

describe('P1-1 · 持久化/桌面层 import 边界', () => {
  const srcFiles = collect(join(ROOT, 'src'));

  it('src/ 收集到足够文件（守卫自身有效性）', () => {
    expect(srcFiles.length).toBeGreaterThan(50);
  });

  it('只有 dexie.database.ts 允许 import dexie（stores() 单一入口纪律）', () => {
    const DEXIE_GATEKEEPER = 'src/core/repositories/local/dexie.database.ts';
    const offenders = srcFiles.filter((f) => {
      if (f === DEXIE_GATEKEEPER) return false;
      return importedModules(readFileSync(join(ROOT, f), 'utf-8')).some((m) =>
        /^(dexie|dexie\/.*)$/.test(m),
      );
    });
    expect(offenders, `以下文件越界 import dexie：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('src/ 绝不允许 import electron（换壳期权：核心逻辑零 Electron 绑定）', () => {
    const offenders = srcFiles.filter((f) =>
      importedModules(readFileSync(join(ROOT, f), 'utf-8')).some((m) =>
        /^electron(\/.*)?$/.test(m),
      ),
    );
    expect(offenders, `以下文件越界 import electron：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('src/ 绝不允许 import better-sqlite3（服务端专属）', () => {
    const offenders = srcFiles.filter((f) =>
      importedModules(readFileSync(join(ROOT, f), 'utf-8')).some((m) =>
        /^better-sqlite3(\/.*)?$/.test(m),
      ),
    );
    expect(offenders, `以下文件越界 import better-sqlite3：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('serializeAssigneeIds 只允许出现在定义处与 assignee 专用调用行（§9.2 硬禁令）', () => {
    // json-columns.ts 的同名函数已是 serializeJson 薄包装（无 filter 语义），是唯一合法定义；
    // 调用行必须显式作用于 assigneeIds/assignee_ids——任何对 artifacts 等对象数组的使用即违规。
    const WHITELIST = new Set(['server/lib/json-columns.ts']);
    const serverFiles = collect(join(ROOT, 'server'));
    const offenders: string[] = [];
    for (const f of serverFiles) {
      if (WHITELIST.has(f)) continue;
      const lines = readFileSync(join(ROOT, f), 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (/serializeAssigneeIds|parseAssigneeIds/.test(line)) {
          // import 与注释行放行；调用行必须含 assignee 字样（string[] 专用通道）
          const isComment = /^\s*(\/\/|\*|\/\*)/.test(line);
          const isImport = /\bimport\b/.test(line);
          const isAssigneeOnly = /assignee/i.test(line);
          if (!isComment && !isImport && !isAssigneeOnly) {
            offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 80)}`);
          }
        }
      });
    }
    expect(
      offenders,
      `以下调用把 AssigneeIds 序列化用在了非 assignee 字段上（artifacts 等对象数组必须走 serializeJson）：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
