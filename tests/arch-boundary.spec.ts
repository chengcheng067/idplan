/**
 * 架构边界守卫（v0.6 · T15 P1-1；v0.7 · T17 追加共享内核纯净性）。
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
 *
 * v0.7 追加（T17 · 判断 2「共享内核」落地前置，R18）：
 *   5. `src/core/agent/**` 与 `src/core/types/**` 是**共享内核**——同一份源码
 *      前端（Vite/浏览器）与后端（tsx/Node）都跑。故禁止出现任一端专属的全局 API：
 *      浏览器侧 window/document/localStorage，Node 侧 node:fs/node:path。
 *      一旦泄漏，服务端会运行时崩（`window is not defined`），且**只在生产暴露**，
 *      本地 vite dev 全绿——所以必须用守卫测试在提交期拦住。
 *   6. `payload.apply.ts` 不得直接 import `dexie`：它只允许依赖
 *      `IRepositoryBundle` 接口（服务端注入 SQLite 适配器，前端注入 Dexie 适配器）。
 *      直接 import dexie = 服务端无法消费共享内核（J2 破产）。
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

/**
 * 去掉注释后的源码（守卫做 API 扫描时必须先剥注释）。
 * 为什么必须剥：共享内核文件里常见「本模块零 DOM / 不读 localStorage」这类
 * **说明性注释**，若把注释也算命中，守卫会被迫写成脆弱的白名单，
 * 反而失去「新增泄漏即红」的价值。
 * 实现：块注释 → 行注释 → 行尾注释，三步顺序不可颠倒（否则 `//` 会先吃掉 `/*`）。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ');
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

/**
 * v0.7 · T17 —— 共享内核纯净性守卫（判断 2 的前置条件，R18）。
 *
 * 共享内核 = `src/core/agent/**` + `src/core/types/**`（+ 二者依赖的
 * `src/core/repositories/interfaces.ts`、`src/core/services/task.service.ts`、
 * `src/lib/date.ts`）。这份源码会被**服务端 tsx 直接执行**，因此：
 *   - 出现浏览器 API → Node 端 `ReferenceError: window is not defined`；
 *   - 出现 Node API   → 浏览器端 Vite 打包报错 / 运行期 undefined。
 * 两类问题都**只在另一端暴露**，本地跑 vite dev + vitest（node 环境）都可能漏，
 * 所以用源码 grep 守卫在提交期拦住。
 */
describe('v0.7 T17 · 共享内核纯净性（J2 前置）', () => {
  /** 共享内核目录（递归） */
  const KERNEL_DIRS = ['src/core/agent', 'src/core/types'];
  const kernelFiles = KERNEL_DIRS.flatMap((d) => collect(join(ROOT, d)));

  it('共享内核文件清单非空（守卫自身有效性）', () => {
    expect(kernelFiles.length).toBeGreaterThanOrEqual(8);
  });

  it('共享内核不含浏览器专属 API（window / document / localStorage）', () => {
    // 用带词界的正则：`window.` / `window[` / `typeof window` / 裸 `document` 引用；
    // 只匹配「作为全局对象被使用」的形态，避免误伤如 `DocumentType` 之类的类型名。
    const BROWSER_API = /\bwindow\b|\bdocument\b|\blocalStorage\b|\bsessionStorage\b/;
    const offenders: string[] = [];
    for (const f of kernelFiles) {
      const code = stripComments(readFileSync(join(ROOT, f), 'utf-8'));
      code.split('\n').forEach((line, i) => {
        if (BROWSER_API.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
    expect(
      offenders,
      `共享内核出现浏览器专属 API（服务端 tsx 运行时会崩）：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('共享内核不含 Node 专属 API（node:fs / node:path / fs / path）', () => {
    // 只查 import 语句本身：`import ... from 'node:fs'` / `'fs'` / `'path'` / `'node:path'`。
    // 不扫裸标识符（否则 `path.xxx` 这类业务变量名会大面积误伤）。
    const NODE_MODULE = /^(node:)?(fs|path|crypto|os|child_process|url|http|https)$/;
    const offenders: string[] = [];
    for (const f of kernelFiles) {
      const mods = importedModules(readFileSync(join(ROOT, f), 'utf-8'));
      const hit = mods.filter((m) => NODE_MODULE.test(m));
      if (hit.length > 0) offenders.push(`${f}  →  ${hit.join(', ')}`);
    }
    expect(
      offenders,
      `共享内核 import 了 Node 专属模块（浏览器端打包会失败）：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('payload.apply.ts 不得直接 import dexie（只依赖 IRepositoryBundle 接口）', () => {
    const target = 'src/core/agent/payload.apply.ts';
    expect(kernelFiles, `${target} 应属于共享内核`).toContain(target);
    const mods = importedModules(readFileSync(join(ROOT, target), 'utf-8'));
    const offenders = mods.filter((m) => /^(dexie|dexie\/.*)$/.test(m));
    expect(
      offenders,
      `${target} 直接 import 了 dexie → 服务端无法消费共享内核（J2 破产）。` +
        `必须只依赖 ../repositories/interfaces 的 IRepositoryBundle。`,
    ).toEqual([]);
  });

  it('共享内核只依赖 zod 这一个外部包（其余必须相对路径或内置全局）', () => {
    // 白名单：zod（契约校验，已在 dependencies）。任何**新**外部包都会在服务端
    // 运行期被 tsx 解析（能装上则不算崩），但会破坏「共享内核依赖面最小」的假设，
    // 故要求显式登记——新增时必须同步更新本白名单并在 PR 说明理由。
    const ALLOWED_EXTERNAL = new Set(['zod']);
    const offenders: string[] = [];
    for (const f of kernelFiles) {
      const mods = importedModules(readFileSync(join(ROOT, f), 'utf-8'));
      const external = mods.filter(
        (m) => !m.startsWith('.') && !m.startsWith('/') && !ALLOWED_EXTERNAL.has(m),
      );
      if (external.length > 0) offenders.push(`${f}  →  ${external.join(', ')}`);
    }
    expect(
      offenders,
      `共享内核引入了白名单外的外部包（破坏依赖面最小假设）：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('crypto.randomUUID 是共享内核唯一允许的全局能力（Node18+/浏览器均内置）', () => {
    // 显式登记而非放任：§5.3 要求「共享内核允许的全局 API 白名单」有出处。
    // randomUUID 在 Node 18+（engines.node>=18）与全部现代浏览器均为全局，
    // 无需 import，两端可跑。此断言的作用是「白名单变更有迹可循」：
    // 若将来新增其它 crypto.* 用法，本断言会红，逼开发者回来登记。
    const cryptoUsers = kernelFiles.filter((f) =>
      /\bcrypto\s*\./.test(stripComments(readFileSync(join(ROOT, f), 'utf-8'))),
    );
    for (const f of cryptoUsers) {
      const code = stripComments(readFileSync(join(ROOT, f), 'utf-8'));
      const calls = [...code.matchAll(/\bcrypto\s*\.\s*(\w+)/g)].map((m) => m[1]);
      const unexpected = calls.filter((c) => c !== 'randomUUID');
      expect(
        unexpected,
        `${f} 使用了白名单外的 crypto 成员：${unexpected.join(', ')}`,
      ).toEqual([]);
    }
  });
});
