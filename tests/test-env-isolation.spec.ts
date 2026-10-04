/**
 * F11 · 测试 env 隔离元守卫：`process.env` 写入必须配对清理
 *
 * ══════════════════════════ 这个 spec 在守什么 ══════════════════════════
 *
 * **一个已被复现两次、并被安全侧独立复现第三次的环境污染缺陷。**
 *
 * 病灶（本仓既有）：`vite.config.ts` 的 test 段是
 *   `pool: 'threads'` + `poolOptions.threads.singleThread: true`
 * ⇒ **全部 spec 跑在同一个进程**，`process.env` 是**进程级共享**的。
 * 而「清库重建」只覆盖 Dexie（fake-indexeddb），**覆盖不到 env**。
 *
 * 后果：`server/lib/agent-auth.ts` 的三个鉴权函数是**每次调用现读 env**
 *   （`requireToken` :66 / `writeAuthMode` :91 / `requireAgentToken` :171）
 * ⇒ 谁在污染者之后 import 它，谁就会看到 `writeAuthMode() === 'enforce'`
 *   而不是 `'open'`，且**症状方向决定了这个缺陷有多危险**：
 *   · 断言「**洞存在**」的 spec（`expect(200)`）⇒ 被污染后变 **红**（会被看见）；
 *   · 断言「**洞已堵住**」的 spec（`expect(拒绝)`）⇒ 可能因**不相关原因**
 *     （如鉴权 401）达成拒绝而变 **绿** ⇒ **假绿，守卫效力被掩盖**。
 *   （这条方向差异由安全官指出、调查员实测确认，见 F7 spec 注释与交付记录。）
 *
 * **本 spec 守的是「漏清理不可能发生」，不是「补一次清理」。**
 * 那三处已补（commit 564495d），但它们全靠**手写** `afterAll`/`afterEach`
 * ⇒ **全仓没有任何机制阻止第 6 个人再犯**。本 spec 就是那个机制。
 *
 * ── 语法 grep 的能力边界（实测得出，别越界用）──
 *   ✅ 语法 grep（`process\.env\.[A-Z_]+\s*=`）能可靠找到「**写**」——
 *      因为赋值是有明确文本形态的语法。
 *   ❌ 但它**判断不了「清理是否正确」**：同一个 `agent-nl.spec.ts` 有 8 处写入
 *      也有 `afterEach` save-restore（合规），另三处有写入零清理（违规）。
 *      ⇒ **光列出写入点会告诉你「有 N 处」，告诉不了你「哪处漏了」。**
 *   ⇒ 本 spec 做的正是**配对**：写入点 × 清理点，缺配对即红。
 *
 * ⚠️ **注意本 spec 与「grep 找安全判定」的根本区别**（本仓踩过同一个坑三次）：
 *   要证明「某处**没有**门」，grep **概念词不可靠**（判定可用任意命名），
 *   必须逐处读码；要证明「某处**有**写入」，grep **语法结构可靠**。
 *   本 spec 只做后者，因此可靠。
 */

// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

const ROOT = join(__dirname, '..');
const TESTS_DIR = join(ROOT, 'tests');

/** 递归收集 tests/ 下的 .ts/.tsx（posix 风格相对路径，与 arch-boundary.spec.ts 同口径） */
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

/** 剥掉注释（否则「示例代码块」里的赋值会被当真命中） */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ');
}

/** 一处 env 写入 */
interface EnvWrite {
  /** 1 基行号 */
  line: number;
  /** 环境变量名 */
  key: string;
  /** 顶层（列 0）还是用例内（缩进） */
  topLevel: boolean;
}

/**
 * 找出所有 `process.env.X = …` 形式的**赋值点**。
 *
 * 只认「赋值」而不认读取/比较（`process.env.X` 后面必须跟 `=`，且不是 `==`/`===`）。
 * 顶层判定用「该行的缩进为 0」——实测这与 vitest 语义一致：
 *   · `tests/server.agent-json-columns.spec.ts:25` 顶层（无缩进）
 *   · `tests/server.agent-nl.spec.ts:109` 在 `it()` 内（有 4 空格缩进）
 */
function findEnvWrites(source: string): EnvWrite[] {
  const lines = stripComments(source).split('\n');
  const out: EnvWrite[] = [];
  lines.forEach((raw, i) => {
    // 顶层无缩进；列 0 = 顶层
    const topLevel = !/^[ \t]/.test(raw);
    // 赋���：process.env.KEY = ，排除 == / === / => 等
    const m = /process\.env\.([A-Z_][A-Z0-9_]*)\s*=(?!=)/.exec(raw);
    if (m) out.push({ line: i + 1, key: m[1], topLevel });
  });
  return out;
}

/** 剥注释后源码里是否出现某种清理形态（`delete process.env.K` 或 save-restore 的 `process.env[k]`） */
function hasCleanupFor(source: string, key: string): boolean {
  const stripped = stripComments(source);
  // 形态 A：直接 delete process.env.KEY
  if (new RegExp(`delete\\s+process\\.env\\.${key}\\b`).test(stripped)) return true;
  // 形态 B：save-restore（`delete process.env[k]` + `process.env[k] = v` 的通用写法）
  //         —— `server.agent-nl.spec.ts:78-82` 用的就是这种，用变量 k 不写死 key。
  if (/delete\s+process\.env\[\s*k\s*\]/.test(stripped) && /process\.env\[\s*k\s*\]\s*=/.test(stripped)) {
    return true;
  }
  return false;
}

/** 该文件是否声明了任意一种清理钩子（顶层写必须配 afterAll，用例内写至少要 afterEach/afterAll） */
function hasHook(source: string, hook: 'afterAll' | 'afterEach'): boolean {
  return new RegExp(`\\b${hook}\\s*\\(`).test(stripComments(source));
}

/**
 * 取出 `afterAll(...)` / `afterEach(...)` 调用的**参数体**（已剥注释）。
 *
 * 为什么必须取 body 而不是整文件：
 *   守卫若只判「文件里出现过 `afterAll(`」，它回答的是「这文件有过钩子吗」，
 *   而守卫要回答的是「**这个 key** 被这个钩子清了吗」。二者不是一回事：
 *   · `afterAll(() => { delete process.env.IDPLAN_AGENT_TOKNE })` ← 拼错 key
 *   · `afterAll(() => { /* 清理别的 key *\/ })`                  ← 管不到本 key
 *   两种情况都会让「整文件有 afterAll」成立 ⇒ 守卫放行 ⇒ **假绿**。
 *
 * ⚠️ 这就是安全官 2026-10-04 指出的那处假绿，本函数是它的修复点。
 *   修复前的写法是 `hasHook(src,'afterAll')`（整文件子串），
 *   修复后改为「body 必须触及该 key」（见 `hookCoversKey`）。
 *
 * 截取方式：从 `afterAll(` 起，用括号配对找到对应的 `)`（带深度计数）。
 * 本仓的钩子体都是短小的清理代码，不含会让配对失效的复杂字面量。
 */
function hookBody(source: string, hook: 'afterAll' | 'afterEach'): string {
  const stripped = stripComments(source);
  const start = stripped.search(new RegExp(`\\b${hook}\\s*\\(`));
  if (start < 0) return '';
  let depth = 0;
  let seenOpen = false;
  for (let i = start; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (ch === '(') {
      depth += 1;
      seenOpen = true;
    } else if (ch === ')') {
      depth -= 1;
      if (seenOpen && depth === 0) return stripped.slice(start, i + 1);
    }
  }
  return '';
}

/**
 * 该钩子的 body 是否**触及**指定 key。
 *
 * 两种有效形态（安全官定的口径）：
 *   ① body 内出现 `process.env.<该 KEY>` 的**任意**引用（delete / 赋值 / 读都算）
 *      —— 覆盖「显式按 key 清理」与「写死 key 的 save-restore」；
 *   ② body 内出现**通用变量形态** `process.env[变量]`
 *      —— 覆盖 `server.agent-nl.spec.ts:78-82` 那类用一个变量统一恢复全部 key 的写法。
 *
 * 取「或」：任一成立即认为该 key 被这个钩子管到。
 */
function hookCoversKey(source: string, hook: 'afterAll' | 'afterEach', key: string): boolean {
  const body = hookBody(source, hook);
  if (body === '') return false;
  if (new RegExp(`process\\.env\\.${key}\\b`).test(body)) return true;
  if (/process\.env\[\s*[A-Za-z_$][\w$]*\s*\]/.test(body)) return true;
  return false;
}

/**
 * ★ 具名豁免白名单（安全官约束 3：豁免必须显式化，不留「静默通过」的口子）。
 * 格式：`相对路径 → 豁免理由`。**当前为空** —— 本仓当前无正当理由需要在顶层写 env 而不清理。
 * 若将来确需（例如某 spec 独占进程），必须在此登记并写明理由，否则守卫会红。
 */
const ENV_WRITE_EXEMPTIONS: Record<string, string> = {};

const testFiles = collect(TESTS_DIR);

/**
 * ★ 本文件必须排除自己，否则会**扫描自己的判别力探针**（那个探针故意写了
 *   两处 process.env 赋值来证明扫描器有判别力）⇒ 自我误报。
 *   这不是「给自己开豁免」——豁免机制在下方另有显式白名单，此处是**排除扫描器自身**
 *   这一普适规则（守卫不审自己，是所有静态守卫的共同约束）。
 */
const SELF = 'tests/test-env-isolation.spec.ts';
const SCANNED = testFiles.filter((f) => f !== SELF);

describe('F11 元守卫 · process.env 写入必须配对清理', () => {
  it('tests/ 收集到足够文件（守卫自身有效性：收集器坏了会假绿）', () => {
    // 与 arch-boundary.spec.ts:76 同款自证。若这条红了，说明本守卫根本没在工作，
    // 下面所有「无违规」的结论都不可信 —— 故它必须排在最前。
    expect(testFiles.length).toBeGreaterThan(50);
    expect(SCANNED.length).toBe(testFiles.length - 1); // 只排除自己一个
  });

  it('扫描器能识别模块顶层写入与用例内写入（判别力自证）', () => {
    const probe = [
      "import { afterAll } from 'vitest';",
      "process.env.IDPLAN_SOME_TOKEN = 'x';", // 顶层
      "it('t', () => {", // 用例内
      "  process.env.IDPLAN_OTHER = 'y';",
      '});',
    ].join('\n');
    const found = findEnvWrites(probe);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ key: 'IDPLAN_SOME_TOKEN', topLevel: true });
    expect(found[1]).toMatchObject({ key: 'IDPLAN_OTHER', topLevel: false });
  });

  it('顶层写 process.env 必须有对应清理（afterAll 的 body 必须触及该 key）', () => {
    const offenders: string[] = [];
    for (const f of SCANNED) {
      if (f in ENV_WRITE_EXEMPTIONS) continue;
      const src = readFileSync(join(ROOT, f), 'utf-8');
      for (const w of findEnvWrites(src)) {
        if (!w.topLevel) continue; // 用例内写入由下一条用例守
        // ★ 强证据：该 key 被 afterAll 的 **body** 管到（不是「文件里有过 afterAll」）。
        //   修复前这里是 `hasHook(src,'afterAll')` 整文件子串 —— 那是弱证据，
        //   会放过「afterAll 里 delete 拼错 key」与「afterAll 清的是别的 key」两种假绿。
        const coveredByHook = hookCoversKey(src, 'afterAll', w.key);
        // 弱证据兜底：文件内任意位置的精确 delete / save-restore（不在钩子里的也算，
        //   例如写在文件末尾的集中清理段）。保留它是为了不误报「清理写在别处」的合法写法。
        const perKey = hasCleanupFor(src, w.key);
        if (!coveredByHook && !perKey) {
          offenders.push(
            `${f}:${w.line} 顶层写 process.env.${w.key}，但 afterAll 的 body 未触及该 key、也无精确 delete`,
          );
        }
      }
    }
    expect(
      offenders,
      `以下 spec 顶层写 process.env 却无清理（singleThread 下会外泄给后续 spec）：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('用例内写 process.env 必须有 afterEach 或 afterAll（否则同样外泄）', () => {
    const offenders: string[] = [];
    for (const f of SCANNED) {
      if (f in ENV_WRITE_EXEMPTIONS) continue;
      const src = readFileSync(join(ROOT, f), 'utf-8');
      const inner = findEnvWrites(src).filter((w) => !w.topLevel);
      if (inner.length === 0) continue;
      if (!hasHook(src, 'afterEach') && !hasHook(src, 'afterAll')) {
        for (const w of inner) {
          offenders.push(`${f}:${w.line} 用例内写 process.env.${w.key}，但无 afterEach / afterAll`);
        }
      }
    }
    expect(
      offenders,
      `以下 spec 在用例内写 process.env 却无任何清理钩子：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('豁免白名单里不得有「不存在的文件」（防写错路径导致空守）', () => {
    for (const f of Object.keys(ENV_WRITE_EXEMPTIONS)) {
      expect(testFiles, `豁免登记了不存在的文件：${f}`).toContain(f);
    }
  });

  it('登记的豁免必须写明理由（空字符串理由 = 静默通过的口子）', () => {
    for (const [f, reason] of Object.entries(ENV_WRITE_EXEMPTIONS)) {
      expect(reason.trim().length, `豁免 ${f} 必须写明理由`).toBeGreaterThan(0);
    }
  });
});
