/**
 * L1 · Agent 隔离**静态守卫**（v0.8 · 设计 §7.5「防模仿守卫」／§7.7 L1 行）。
 *
 * ═══════════════════════ 这个 spec 到底在守什么 ═══════════════════════
 *
 * v0.8 的隔离是「**全量读入 → 单一谓词出口分流**」：
 *   · 全量数据 `useProjectsStore.projects` 必须存在（Agent 页自己要读 Agent 看板）；
 *   · 但**"全量"不是漏洞，"不经漏斗直接消费全量"才是漏洞**（§7.1 唯一事实）。
 *
 * 于是有两条**进程级不变量**（不变量 1 是别人最容易照抄坏样例的地方）：
 *
 *   不变量 ①（读）　`store.projects` 的**原始读**只能发生在 `src/core/project/visibility.ts`。
 *       页面/组件一律走 `useHumanProjects()` / `useAgentProjects()` / `useProjectById(id)` …
 *       反例（v0.8 修掉的三个）：首页/我的任务/成员看板/打印页曾各自
 *       `useProjectsStore((s) => s.projects)` ＋ 就地 filter。
 *
 *   不变量 ②（写）　`store.projects` 这个**切片的写入点唯一**：只有
 *       `src/hooks/useRepos.ts::bootstrapAllStores()`（外加 `useProjectsStore` 自身的 action）。
 *       反例（设计 §7.5 的第 28 处）：`AgentBoardPage.loadAll()` 曾
 *       `useProjectsStore.setState({ projects: projectRows, … })` 把**全量**灌进 store——
 *       它一旦存在，§7.2 的 27 项接线**全部白做**（任何忘了过滤的人类侧页面都会拿到 Agent 数据，
 *       而且不报错、不崩、tsc 不管）。
 *
 * ── 为什么是「白名单 + 越界即红」而不是「人工逐项核对」 ──
 * 人工清单会腐化：今天 27 项全对，明天有人加第 28 个页面就漏了。把不变量写成
 * **可执行断言**后，"新增任何一处绕过漏斗的读/写"都变成**提交期红灯**，
 * 而不是 code review 的自觉（§7.7 的立意：「自动发现漏网之鱼」）。
 *
 * ── 本 spec 的两段结构（第二段是「守卫自身的守卫」）──
 *   ① `扫描器正反向自证`：对**合成夹具**断言扫描器既不会漏报（真阳）
 *      也不会误报（真阴）。为什么必须有这段：一条永远返回 `[]` 的扫描器
 *      能骗过所有"应为空"的断言（**假绿**是本项目的高发区，见设计 §12.3），
 *      所以扫描器的判别力必须被独立证明。
 *   ② `真实仓库不变量`：扫 `src/**` 全量，越界即红并打印 `file:line`。
 *
 * ── 口径与已知边界（写出来，免得下一个人以为这里"应该"更强）──
 *   · **只守 `projects` 切片**。`stages` / `tasks` 的原始读**有意不守**：
 *     它们没有 `kind` 字段，归属靠 `projectId → projects` 反查，人类侧读它们
 *     走的是 `useVisibleStages('human')` / `useVisibleTasks('human')`；
 *     而 §7.5 理由③明示「任务抽屉/交接包读的就是 store 里的 stages/tasks，
 *     挪走会把一份数据源拆成两份」。故 `TaskDrawer` / `AgentBoardPage` 直读
 *     `s.stages` / `s.tasks` 是**设计认可的**，在这里红会是误报。
 *   · 扫描前**剥注释**（块注释 → 行注释），否则 §7.5 的**说明性注释**里
 *     引用的坏样例（`AgentBoardPage` / `SchedulePrintPage` 的「旧实现是…」）
 *     会被当成真命中，守卫被迫收进脆弱的白名单。
 *   · 字符串/模板字面量内部视为**不透明**：模板里的 `${…}` 不会被扫。
 *     这是刻意的取舍（模板里藏 store 读的概率极低，而 `https://` 这类串
 *     误当行注释会把整行吃掉、造成漏报）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

const ROOT = join(__dirname, '..');

/** 一处命中：文件（posix 相对路径）、1 基行号、该行原文（截断展示用） */
interface Hit {
  file: string;
  line: number;
  /** 该行原文（trim 后截断），用于红灯时直接看到越界代码 */
  text: string;
}

/** 一个待扫描的源码单元 */
interface Source {
  file: string;
  text: string;
}

/* ══════════════════════════════ 源码收集 ══════════════════════════════ */

/**
 * 递归收集目录下全部 ts/tsx 文件（posix 风格相对路径）。
 * 与 `tests/arch-boundary.spec.ts` 的 `collect()` 同口径 —— 全仓守卫测试用同一套路径写法，
 * 白名单字符串才可以在不同 spec 之间互相抄。
 */
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

function readSources(files: readonly string[]): Source[] {
  return files.map((file) => ({ file, text: readFileSync(join(ROOT, file), 'utf-8') }));
}

/* ══════════════════════════════ 词法预处理 ══════════════════════════════ */

/**
 * 把注释内容**原地替换为空格**（保留换行），使字符偏移与原文一一对应 ⇒ 行号可精确回溯。
 *
 * 顺序不可颠倒（`//` 会先吃掉 `/*`），故用状态机而不是三次 `replace`：
 *   · `code`  → 遇 `'` / `"` / `` ` `` 进入字符串态（内部原样保留）；
 *   · `code`  → 遇 `//` 进入行注释；遇 `/*` 进入块注释；
 *   · 注释态 → 只把非换行字符写成空格，换行原样保留（**这是行号不漂的关键**）。
 *
 * 转义：字符串内的 `\\` 会连跳两格，避免 `'\\''` 这类写法把字符串态提前关掉。
 */
function maskComments(source: string): string {
  const out = source.split('');
  let state: 'code' | 'line' | 'block' = 'code';
  let quote: string | null = null;
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const d = source[i + 1];

    if (state === 'code') {
      if (quote !== null) {
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === quote) quote = null;
        i += 1;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        quote = c;
        i += 1;
        continue;
      }
      if (c === '/' && d === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        out[i] = ' ';
        out[i + 1] = ' ';
        state = 'block';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (state === 'line') {
      if (c === '\n') state = 'code';
      else out[i] = ' ';
      i += 1;
      continue;
    }

    // state === 'block'
    if (c === '*' && d === '/') {
      out[i] = ' ';
      out[i + 1] = ' ';
      state = 'code';
      i += 2;
      continue;
    }
    if (c !== '\n') out[i] = ' ';
    i += 1;
  }
  return out.join('');
}

/** 偏移 → 1 基行号 */
function lineOf(masked: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < masked.length; i += 1) {
    if (masked[i] === '\n') line += 1;
  }
  return line;
}

/** 取原文里对应行（用于红灯展示）。行号越界时返回空串。 */
function rawLine(source: string, line: number): string {
  const line_ = source.split('\n')[line - 1] ?? '';
  return line_.trim().slice(0, 120);
}

/**
 * 从 `openIdx` 处的开括号开始，做**括号配平**并返回内部实参文本。
 * `openIdx` 必须指向 `open` 字符本身；未配平时返回 `null`。
 *
 * 为什么必须是配平而不是正则：`setState((st) => ({ a: f(x, y), b: [1, 2] }))`
 * 里既有圆括号又有花括号，任何"取到第一个 `)` 为止"的写法都会截断。
 * 入参传**已剥注释**的文本，故注释里的括号不会干扰配平。
 */
function balancedInner(
  masked: string,
  openIdx: number,
  open: string,
  close: string,
): { inner: string; innerStart: number; endIdx: number } | null {
  if (masked[openIdx] !== open) return null;
  let depth = 0;
  for (let i = openIdx; i < masked.length; i += 1) {
    const c = masked[i];
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) {
        return { inner: masked.slice(openIdx + 1, i), innerStart: openIdx + 1, endIdx: i };
      }
    }
  }
  return null;
}

/* ══════════════════════════════ 两条不变量 · 纯扫描器 ══════════════════════════════
 *
 * 扫描器写成**纯函数**（入参是 `Source[]`，出参是 `Hit[]`），于是可以被合成夹具
 * 直接喂 —— 这是下面「正反向自证」能存在的前提。
 */

/** 匹配 `useProjectsStore` 的调用起点（后面紧跟 `(`） */
const CALL_HEAD = /useProjectsStore\s*\(/g;
/**
 * 匹配写入调用的起点，两种形态：
 *   · `useProjectsStore.setState(`            —— React 组件/action 里的写法；
 *   · `useProjectsStore.getState().replaceAll(` —— `bootstrapAllStores()` 的写法（唯一全量写点）。
 * 中间的 `getState()` 必须显式吃掉，否则 useRepos.ts 的合法写点会漏检（守卫盲区）。
 */
const WRITE_HEAD = /useProjectsStore\s*\.\s*(?:getState\s*\(\s*\)\s*\.\s*)?(setState|replaceAll)\s*\(/g;
/** 匹配 `useProjectsStore.getState().projects`（设计 §7.1 明示的反面写法） */
const GETSTATE_PROJECTS = /useProjectsStore\s*\.\s*getState\s*\(\s*\)\s*\.\s*projects\b/g;
/** 选择器体里出现 `.projects` 属性访问（`s.projects` / `st.projects.find(...)`） */
const PROJECTS_ACCESS = /\.\s*projects\b/;
/**
 * 对象字面量里的 `projects` 键，两种形态都要认：
 *   · 显式赋值 `{ projects: projectRows, … }`；
 *   · 简写属性 `{ projects, stages, tasks }`（`bootstrapAllStores()` 用的正是这种）。
 *
 * 必须带前导 `{` 或 `,`，否则 `stageProjects:` 这类同后缀键会被误命中；
 * 结尾字符限 `[,\\}:]`，把「值位置出现 projects」排除掉（值位置前面是 `:` 而不是 `{`/`,`）。
 */
const PROJECTS_KEY = /[{,]\s*projects\s*[,:}]/;

/**
 * 不变量 ① 扫描器：`store.projects` 的原始读。
 *
 * 命中两类写法：
 *   a) `useProjectsStore((s) => s.projects …)` —— 订阅型原始读（页面最常照抄的那种）；
 *   b) `useProjectsStore.getState().projects` —— 命令型原始读（§7.1 注释里的反面例子）。
 */
export function scanRawProjectsReads(sources: readonly Source[]): Hit[] {
  const hits: Hit[] = [];
  for (const { file, text } of sources) {
    const masked = maskComments(text);

    for (const m of masked.matchAll(CALL_HEAD)) {
      const openIdx = m.index! + m[0].length - 1;
      const arg = balancedInner(masked, openIdx, '(', ')');
      if (arg === null) continue;
      if (!PROJECTS_ACCESS.test(arg.inner)) continue;
      const line = lineOf(masked, m.index!);
      hits.push({ file, line, text: rawLine(text, line) });
    }

    for (const m of masked.matchAll(GETSTATE_PROJECTS)) {
      const line = lineOf(masked, m.index!);
      hits.push({ file, line, text: rawLine(text, line) });
    }
  }
  return hits;
}

/**
 * 不变量 ② 扫描器：`store.projects` **切片**的写入。
 *
 * 命中判据（两步，缺一不可）：
 *   a) 存在 `useProjectsStore.setState(` 或 `useProjectsStore.replaceAll(` 调用；
 *   b) **配平截出的实参文本**里含对象字面量的 `projects:` 键。
 *
 * 为什么必须带 (b)：`setState` 本身不是罪——`AgentBoardPage.loadProject()` 的
 * `useProjectsStore.setState({ stages, tasks })` 是**按 projectId 局部替换**，
 * 设计 §7.5 明示**保留**。若只按 (a) 判，这条会被误报成越界。
 * 同理 `useAgentStore` 内也有一处只写 `tasks` 的 `setState`。
 *
 * ⇒ 本扫描器守的精确不变量是「**`projects` 切片的写入点唯一**」，
 *   而不是「`setState` 出现点唯一」（后者是设计 §7.5 的简化表述，
 *   照字面实现会把上两处合法调用误报——详见本文件尾部的实现说明）。
 */
export function scanProjectsWrites(sources: readonly Source[]): Hit[] {
  const hits: Hit[] = [];
  for (const { file, text } of sources) {
    const masked = maskComments(text);
    for (const m of masked.matchAll(WRITE_HEAD)) {
      const openIdx = m.index! + m[0].length - 1;
      const arg = balancedInner(masked, openIdx, '(', ')');
      if (arg === null) continue;
      if (!PROJECTS_KEY.test(arg.inner)) continue;
      const line = lineOf(masked, m.index!);
      hits.push({ file, line, text: rawLine(text, line) });
    }
  }
  return hits;
}

/** 把所有命中渲染成 `file:line  <该行原文>`，红灯信息里直接用 */
function renderHits(hits: readonly Hit[]): string {
  return hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n');
}

/* ══════════════════════════════ ① 扫描器正反向自证（合成夹具） ══════════════════════════════
 *
 * 这段是**守卫自身的守卫**：一条永远返回 `[]` 的扫描器能骗过下面所有
 * "应为空"的断言（假绿）。所以这里喂**合成源码**，断言真阳/真阴都成立。
 */
describe('L1 扫描器 · 正反向自证（合成夹具，不读真实仓库）', () => {
  const src = (file: string, text: string): Source => ({ file, text });

  describe('不变量 ① · 原始读 store.projects', () => {
    it('真阳：页面直读 `s.projects` 必须被捕获（含行号）', () => {
      const hits = scanRawProjectsReads([
        src('src/pages/Fake.tsx', [
          'const a = 1;',
          'const projects = useProjectsStore((s) => s.projects);',
          'const b = 2;',
        ].join('\n')),
      ]);
      expect(hits).toHaveLength(1);
      expect(hits[0]!.file).toBe('src/pages/Fake.tsx');
      expect(hits[0]!.line).toBe(2);
    });

    it('真阳：`.find` / `.filter` 变体同样被捕获（不是只认裸 `s.projects`）', () => {
      const hits = scanRawProjectsReads([
        src('src/pages/Fake.tsx', [
          'const p = useProjectsStore((s) => s.projects.find((x) => x.id === id));',
          'const q = useProjectsStore((s) => s.projects.filter((x) => x.status === "active"));',
        ].join('\n')),
      ]);
      expect(hits.map((h) => h.line)).toEqual([1, 2]);
    });

    it('真阳：`getState().projects`（命令型原始读）被捕获', () => {
      const hits = scanRawProjectsReads([
        src('src/pages/Fake.tsx', 'const all = useProjectsStore.getState().projects;'),
      ]);
      expect(hits).toHaveLength(1);
      expect(hits[0]!.line).toBe(1);
    });

    it('真阴：读非项目切片（pushToast / toasts / stages / tasks）**不得**命中', () => {
      const hits = scanRawProjectsReads([
        src('src/pages/Fake.tsx', [
          'const pushToast = useProjectsStore((s) => s.pushToast);',
          'const toasts = useProjectsStore((s) => s.toasts);',
          'const stages = useProjectsStore((s) => s.stages);',
          'const tasks = useProjectsStore((s) => s.tasks);',
          'const logs = useProjectsStore((s) => (stageId ? s.stageLogs[stageId] : undefined));',
        ].join('\n')),
      ]);
      expect(hits).toEqual([]);
    });

    it('真阴：**注释里**引用的坏样例不得命中（§7.5 说明性注释遍地都是）', () => {
      const hits = scanRawProjectsReads([
        src('src/pages/Fake.tsx', [
          '/**',
          ' * 旧实现是 `useProjectsStore((s) => s.projects)`：页面直接订阅全量项目。',
          ' */',
          '// const projects = useProjectsStore((s) => s.projects);',
          'const ok = useProjectsStore((s) => s.pushToast);',
        ].join('\n')),
      ]);
      expect(hits).toEqual([]);
    });

    it('真阴：`visibleProjectsFor(...)`（漏斗出口）不得被当成 `.projects` 访问', () => {
      const hits = scanRawProjectsReads([
        src('src/core/project/visibility.ts', 'const agent = visibleProjectsFor("agent", rows);'),
      ]);
      expect(hits).toEqual([]);
    });
  });

  describe('不变量 ② · projects 切片的写入', () => {
    it('真阳：`setState` 写 `projects:` 必须被捕获（§7.5 第 28 处的原形）', () => {
      const hits = scanProjectsWrites([
        src('src/pages/AgentBoardPage.tsx', [
          'useProjectsStore.setState((st) => ({',
          '  projects: projectRows,',
          '  stages: st.stages,',
          '  tasks: st.tasks,',
          '}));',
        ].join('\n')),
      ]);
      expect(hits).toHaveLength(1);
      expect(hits[0]!.line).toBe(1);
    });

    it('真阳：`replaceAll` 写 `projects` 同样被捕获', () => {
      const hits = scanProjectsWrites([
        src('src/hooks/useRepos.ts', 'useProjectsStore.getState().replaceAll({ projects, stages, tasks });'),
      ]);
      expect(hits).toHaveLength(1);
    });

    it('真阴：只写 stages/tasks 的 `setState`（§7.5 明示保留）不得命中', () => {
      const hits = scanProjectsWrites([
        src('src/pages/AgentBoardPage.tsx', [
          'useProjectsStore.setState((st) => ({',
          '  stages: [...st.stages.filter((s) => s.projectId !== id), ...stageRows],',
          '  tasks: [...st.tasks.filter((t) => t.projectId !== id), ...taskRows],',
          '}));',
        ].join('\n')),
      ]);
      expect(hits).toEqual([]);
    });

    it('真阴：`stageProjects:` 之类**同后缀键**不得被误认为 `projects:`', () => {
      const hits = scanProjectsWrites([
        src('src/x.ts', 'useProjectsStore.setState({ stageProjects: rows });'),
      ]);
      expect(hits).toEqual([]);
    });

    it('真阴：实参截取必须**括号配平**（嵌套括号/数组不截断，也不越界到下一个语句）', () => {
      const withProjects = scanProjectsWrites([
        src('src/x.ts', [
          'useProjectsStore.setState((st) => ({',
          '  things: [f(a, b), { nested: true }],',
          '  projects: rows,',
          '}));',
        ].join('\n')),
      ]);
      expect(withProjects).toHaveLength(1);

      const withoutProjects = scanProjectsWrites([
        src('src/x.ts', [
          'useProjectsStore.setState((st) => ({',
          '  things: [f(a, b), { nested: true }],',
          '}));',
          'const unrelated = { projects: localOnly };',
        ].join('\n')),
      ]);
      expect(withoutProjects).toEqual([]);
    });
  });
});

/* ══════════════════════════════ ② 真实仓库不变量 ══════════════════════════════ */

/** 不变量 ① 白名单：`store.projects` 原始读**只允许**在这个文件（设计 §7.1 纪律 1） */
const READ_WHITELIST = ['src/core/project/visibility.ts'];

/** 不变量 ② 白名单：`projects` 切片的写入**只允许**这两个文件（设计 §7.5） */
const WRITE_WHITELIST = ['src/hooks/useRepos.ts', 'src/store/useProjectsStore.ts'];

describe('L1 守卫 · 真实仓库（src/**）', () => {
  const srcFiles = collect(join(ROOT, 'src'));
  const sources = readSources(srcFiles);

  it('src/ 收集到足够文件（守卫自身有效性：收集器坏了会假绿）', () => {
    expect(srcFiles.length).toBeGreaterThan(50);
  });

  it('白名单文件真实存在（防白名单写错路径导致空守）', () => {
    for (const f of [...READ_WHITELIST, ...WRITE_WHITELIST]) {
      expect(srcFiles, `白名单登记了不存在的文件：${f}`).toContain(f);
    }
  });

  it('① 原始读 `store.projects` 只允许出现在 visibility.ts（页面直读即红）', () => {
    const offenders = scanRawProjectsReads(sources).filter(
      (h) => !READ_WHITELIST.includes(h.file),
    );
    expect(
      offenders,
      [
        '以下位置绕过漏斗直接读 store.projects（设计 §7.1 纪律 1 / PRD B5）。',
        '一律改用 visibility.ts 的 hooks：',
        '  · 人类侧列表 → useHumanProjects() / useHumanStages() / useHumanTasks()',
        '  · Agent 侧     → useAgentProjects() / useAgentStages() / useAgentTasks()',
        '  · 单项目直达   → useProjectById(id) / useProjectStages(id) / useProjectTasks(id)',
        '',
        renderHits(offenders),
      ].join('\n'),
    ).toEqual([]);
  });

  it('② `projects` 切片的写入只允许出现在 useRepos.ts / useProjectsStore.ts（§7.5 第 28 处）', () => {
    const offenders = scanProjectsWrites(sources).filter(
      (h) => !WRITE_WHITELIST.includes(h.file),
    );
    expect(
      offenders,
      [
        '以下位置把 `projects` 切片写回 store —— 这是 §7.5 的第 28 处旁路：',
        '它会让 §7.2 的 27 项接线全部白做（此后任何忘了过滤的人类侧页面都会拿到 Agent 数据，',
        '不报错、不崩、tsc 不管）。',
        '',
        '正确做法：把结果**就地经谓词收窄**后放进本页局部 state，例如 ——',
        "  setLoadedAgentBoards(visibleProjectsFor('agent', projectRows));",
        '',
        renderHits(offenders),
      ].join('\n'),
    ).toEqual([]);
  });

  it('①的实证：visibility.ts 确实是唯一原始读点（白名单条目被真正用到）', () => {
    const hits = scanRawProjectsReads(sources);
    const usedFiles = [...new Set(hits.map((h) => h.file))].sort();
    // 白名单若变成"死条目"（visibility.ts 不再原始读），说明口径已漂移，必须回来看一眼。
    expect(usedFiles).toContain('src/core/project/visibility.ts');
    // 且命中集必须 ⊆ 白名单 —— 上面第 ① 条断言已覆盖，这里再兜一层，防"过滤条件写反"。
    expect(usedFiles.every((f) => READ_WHITELIST.includes(f))).toBe(true);
  });

  it('②的实证：useRepos.ts 与 useProjectsStore.ts 都仍是合法写入点', () => {
    const hits = scanProjectsWrites(sources);
    const usedFiles = [...new Set(hits.map((h) => h.file))].sort();
    expect(usedFiles).toEqual([...WRITE_WHITELIST].sort());
  });
});
