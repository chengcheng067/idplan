#!/usr/bin/env node
/**
 * 文档引用体检（**只读**）：把 Markdown 里写的每一个「文件引用 / 行号」拿去仓库里逐条对一遍。
 *
 * ── 为什么需要它 ──
 * 「文档说这里有个文件、第 12 行是这段代码」这类陈述，对读者来说与代码等价 —— 读者会照着它
 * 去改、去验。所以**它错了，后果与代码错同量级**。但它又完全不进任何关卡：没人跑它，
 * 编译器不管它，评审也读不出「这一行号其实已经漂了 2 行」。于是它成了唯一一处
 * **可以长期错误而无人发现**的产出。
 *
 * ── 起因（真实事故，别删这段）──
 * 2026-09-12 前后一轮设计文档核对，同一份文档里累计抓到：
 *   • **8 处引用到「仓库里并不存在」的文件**（`tests/backup.taskno-collision.spec.ts` ×5、
 *     `tests/task-no.spec.ts` ×3）—— 且这两处是**照着旧表执行会把整批任务永久卡死**的那种错
 *     （必跑清单永远凑不齐）；
 *   • **1 处简写被读成了另一个不存在的路径**（口头只写 `dto.ts`，实际是 `src/core/types/dto.ts`）；
 *   • **3 处 off-by-N 行号**（引用的是文件移位前的旧行号，读的人会直接改错地方）。
 * 三类错误的共同点是：**它们全都可以被机器在 1 秒内证伪**，但人类评审一遍要花很久，而且会漏。
 *
 * ── 本脚本只报「能证明的」与「明确不能证明的」两种结论 ──
 * 这是本脚本唯一重要的设计约束。对每一条引用，只允许输出下面三种之一：
 *   ✅ 文件存在 +（若给了行号）把**该行原文打出来**供人比对
 *   ❌ 文件不存在 / 文件名在仓库里有多个候选 / 行号超出文件总行数（**可证明**）
 *   ➖ 仅验证文件存在，行号未验证（文件不可读、或引用未写行号）
 * **绝不输出「行号正确」** —— 除非文档自己把期望文本写进了引用旁边（`--check-hints`），
 * 那也只是**子串包含**级别的比对，仍不算证明。原因见文末「为什么不自动判定行号对错」。
 *
 * ── 用法 ──
 *   node scripts/check-doc-refs.mjs                          # 扫默认文档目录（见下）
 *   node scripts/check-doc-refs.mjs --docs=../deliverables/research
 *   node scripts/check-doc-refs.mjs ../deliverables/research/v0.7-系统设计与任务分解-合并范围.md
 *   node scripts/check-doc-refs.mjs --list                   # 只列引用，不校验
 *   node scripts/check-doc-refs.mjs --check-hints            # 额外做「期望文本」子串比对（建议开）
 *   node scripts/check-doc-refs.mjs --strict-hints           # 上一条的比对失败也算失败
 *   node scripts/check-doc-refs.mjs --strict-paths           # 「只写文件名、没写全路径」也算失败
 *   node scripts/check-doc-refs.mjs --only=task-no           # 只报含该子串的引用
 *   node scripts/check-doc-refs.mjs --json                   # 机器可读输出
 *   node scripts/check-doc-refs.mjs --root=<dir>             # 换一棵树做（隔离工作树/干净克隆）
 *
 *   默认文档目录：`<root>/docs` 与 `<root>/../deliverables/research`（存在哪个扫哪个；
 *   两个都扫，因为设计文档常常在仓库外）。可用 `--docs=<dir|file>` 或位置参数覆盖。
 *
 * ── 引用形式（本脚本识别的）──
 *   ① 反引号内的 `路径`（可含 `:行号`、`:起-止`、`:1 / :2 / :3` 列表）
 *   ② 反引号内的裸 `:行号`（**按本行最近出现过的路径归属**，输出里会标注「归属：推断」）
 *   ③ Markdown 链接里指向本地文件的相对路径（`.md` 等）
 *
 * ── 已知边界（如实声明，别当成 bug）──
 *   • 「路径」与 `L12-34` 分处**两个不同 code span** 的写法**不校验行号**（只校验文件存在）；
 *     本脚本只认 `路径:行号` 这种把两者绑在一起的写法 —— 想要行号被校验，就写在一起。
 *   • 含占位符的引用（`<X>.tsx`、`*.spec.ts`、`…/dto.ts`）**跳过**，报为占位符而非错误。
 *   • 只写文件名（如 `dto.ts`）时会**按文件名全仓搜**：唯一命中 → 报「文件存在，但文档未写全路径」
 *     （这正是 `template/dto.ts` 那次误读的成因）；0 命中 → ❌；多命中 → ❌ 并列候选。
 *   • 文档里**故意**引用失效文件名的行（如「原句写的 xxx 在仓库中不存在」这类更正说明）
 *     会被判成 ❌ —— 在**那种行的行尾**写 `<!-- refs-ignore -->` 即可豁免（整行不校验，报为 ➖）。
 *     这是必需的：否则唯一的出路是把警告写模糊，而那正好毁掉警告的价值。
 *   • 「**计划新建**」的文件（`§4.1 新增（17）` / `**新增（13 个）**` 这类小节）**预期不存在**，报 ➖ 而非 ❌。
 *     首次实测（v0.8 设计文档）就在这里产生过 10 条误报 —— 全部是 4 个「计划新建」文件。
 *     判据是**文档自己的结构**（小节标题，或 `**新增（N）**` 这种加粗小标签），不是文件是否存在；
 *     并且顺带与声明的数量对账（「声明 N 个 / 实列 M 个」—— 本项目的计数类错误已发生 4 次以上）。
 *     代价要说清楚：**写错目录的「计划新建」条目识别不出来**（预期不存在的东西没有存在性可验），
 *     只能靠数量对账间接兜住「少列 / 多列」。
 *
 * ── 为什么不自动判定行号对错 ──
 * 要证明「第 12 行是这段代码」，唯一可靠的办法是机器知道**期望文本**。文档里绝大多数行号
 * 引用旁边**并没有**写明期望文本（写明了的都是巧合），所以任何「行号正确」的自动结论都是
 * **猜**。本脚本选择把该行原文打出来让人比对 —— 慢一点，但结论是真的。
 *
 * ── 退出码 ──
 *   0 = 无 ❌（可证明的错误）
 *   1 = 有 ❌（文件不存在 / 候选歧义 / 行号超出总行数 / 开启 strict 后的额外失败）
 *   2 = 前置或用法问题（文档目录找不到、参数非法）
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');

/* ============================ 常量 ============================ */

/** 会被当成「文件引用」的扩展名（长的在前，避免 `.ts` 吃掉 `.tsx`）。 */
const EXT_ALT = [
  'tsx', 'mts', 'cts', 'ts',
  'jsx', 'mjs', 'cjs', 'js',
  'jsonc', 'json',
  'scss', 'less', 'css',
  'markdown', 'md',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'sql', 'py', 'svelte', 'vue', 'html', 'htm', 'txt', 'sh', 'ps1', 'snap', 'lock',
].join('|');

/** 遍历时跳过的目录（噪声与体积）。 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build-dist', 'coverage', '.vite', 'out',
  'release', '__pycache__', '.turbo', '.output', '.cache', 'tmp',
]);

/** 含占位符 → 无法机器校验。 */
const PLACEHOLDER_RE = /[<>{}*?]|\u2026|\.\.\./;

/** 路径（可含目录），要求不以字母数字下划线以外的字符续尾。 */
const PATH_RE = new RegExp(
  '((?:[A-Za-z0-9_@.\\-]+/)*[A-Za-z0-9_@.\\-]+\\.(?:' + EXT_ALT + '))(?![A-Za-z0-9_])',
  'g',
);

/** `:12` / `:12-34` / `:12 / :34`。前置断言排除 `17:04` 与 `127.0.0.1:17788` 这类非行号。 */
const LINE_RE = /(?<![\d:]):(\d{1,4})(?:\s*[-\u2013\u2014~]\s*(\d{1,4}))?/g;

/** 单反引号 code span（不跨行；排除 ``` 围栏由调用侧处理）。 */
const SPAN_RE = /`([^`\n]+)`/g;

/**
 * 一行里的**连续反引号段**（长度 ≥1）。CommonMark 里 code span 与围栏共用这一种分隔符，
 * 所以必须按「段」而不是按「```」来数 —— 详见 scanFenceLine。
 */
const BACKTICK_RUN_RE = /`+/g;

/**
 * 本行的围栏状态迁移，同时给出「可校验的那一段文本」。
 *
 * ── 为什么不能只认行首的 ^``` ──
 * 设计文档里大量存在**写在表格单元格内**的围栏：形如 `| 说明：<br><br>```ts`（开栏在**行中**）
 * 与 `| ```<br>后续正文 |`（合栏在行首）。行首判据看不见那个行中开栏，却看得见**下一个**
 * 恰好在行首的合栏 → 状态从此**反相**，其后整篇文档都被当成代码块跳过。
 *
 * 真实事故（2026-09，v0.8 系统设计文档）：第 532 行一个**行中开栏**（表格单元格里
 * `<br><br>```ts`）被旧判据完全忽略，第 536 行那个恰好在行首的**合栏**却被当成「开栏」
 * → 从此 `inFence` 反相且再未归位，**第 536–1406 行里 388 行被错误跳过**（实测值），
 * 其中就包含 §4.1「新增（17）」整节 —— 表现为
 * 「`**新增（13 个）**` 加粗小标签式分节能对账，`## 新增（17）` 标题式分节永不触发」。
 * 注意：那次症状**指向分节识别**，真因却在围栏状态；分节逻辑本身一直是好的
 * （加粗式之所以"看着好"，只是因为那份文档恰好没有行中开栏）。
 *
 * ── 为什么不能简单按「本行 ``` 个数的奇偶」翻转 ──
 * 因为**行内 code span 里也可以装反引号**（写 ```` ``` ```` 来表示三个反引号）。
 * 这类行的段数往往是奇数，按奇偶翻会**误把正文吞进代码块**。
 * 所以这里按 CommonMark 的段配对规则来判：
 *   · 不在围栏内时，一个长度 N 的段去找**后面第一个长度恰为 N** 的段 → 配成 code span，
 *     两端都只是分隔符，**不影响**围栏状态（span 内部必须保持可校验：引用就住在里面）；
 *   · 配不上的段，长度 ≥3 → 是围栏开栏；长度 1~2 → 只是字面反引号，不影响状态；
 *   · 在围栏内时，第一个长度 ≥ 开栏长度（且 ≥3）的段即合栏。
 *
 * ── scannable 为什么用等长空格填充而不是删除 ──
 * `readHint()` 拿 `span.end` 这个**下标**回本行取「期望文本」，删字符会让下标全部错位。
 * 空格填充对 `^\s*` 前缀式匹配（标题、加粗小标签）也天然友好。
 *
 * @param {boolean} inFence 进入本行前是否处于围栏内
 * @param {string} lineText 本行原文
 * @returns {{inFenceAfter: boolean, scannable: string}} 迁移后的状态 + 等长可校验文本
 */
function scanFenceLine(inFence, lineText) {
  const runs = [];
  const re = new RegExp(BACKTICK_RUN_RE.source, 'g');
  let m;
  while ((m = re.exec(lineText)) !== null) {
    runs.push({ start: m.index, end: m.index + m[0].length, len: m[0].length });
  }

  // 第一遍：只定角色，不动文本。
  const role = new Array(runs.length).fill('literal');
  let inside = inFence;
  let fenceLen = 0;
  let k = 0;
  while (k < runs.length) {
    const r = runs[k];
    if (inside) {
      if (r.len >= 3 && r.len >= fenceLen) {
        role[k] = 'fence-close';
        inside = false;
        fenceLen = 0;
      }
      k += 1;
      continue;
    }
    let closer = -1;
    for (let j = k + 1; j < runs.length; j++) {
      if (runs[j].len === r.len) { closer = j; break; }
    }
    if (closer >= 0) {
      role[k] = 'span-open';
      role[closer] = 'span-close';
      k = closer + 1;
      continue;
    }
    if (r.len >= 3) {
      role[k] = 'fence-open';
      inside = true;
      fenceLen = r.len;
    }
    k += 1;
  }

  // 第二遍：按角色拼出等长文本，并推出行尾状态。
  let out = '';
  let cursor = 0;
  let state = inFence;
  for (let idx = 0; idx < runs.length; idx++) {
    const r = runs[idx];
    const between = lineText.slice(cursor, r.start);
    out += state ? ' '.repeat(between.length) : between;

    const ro = role[idx];
    const isFence = ro === 'fence-open' || ro === 'fence-close';
    if (isFence || state) {
      // 围栏标记、以及围栏内的任何反引号段：一律遮蔽（它们不是引用）
      out += ' '.repeat(r.len);
    } else {
      // code span 的分隔符必须**原样保留** —— SPAN_RE 靠它定位引用
      out += lineText.slice(r.start, r.end);
    }
    cursor = r.end;

    if (ro === 'fence-open') state = true;
    else if (ro === 'fence-close') state = false;
  }
  const tail = lineText.slice(cursor);
  out += state ? ' '.repeat(tail.length) : tail;

  return { inFenceAfter: state, scannable: out };
}

const MAX_LINE_EXPANSION = 200; // 行号区间最多展开多少行，防 `:1-999999`
const MAX_LINE_TEXT = 160; // 打印单行原文的截断长度
const HINT_LOOKAHEAD = 120; // 引用之后多远内找「期望文本」

/**
 * 行内豁免标记。文档里**故意**引用失效文件名的行（例如「原句写的 xxx 在仓库中不存在」
 * 这类更正说明）会被本脚本判成 ❌，但那是**正确的引用方式**，不是缺陷。
 * 这是**必需**的：否则唯一的出路是把警告写模糊，而那正好毁掉警告的价值。
 *
 * 两种形态（见 IGNORE_RE）：
 *   `<!-- refs-ignore -->`                    整行豁免
 *   `<!-- refs-ignore <子串> [<子串>…] -->`    只豁免路径含该子串的引用（推荐）
 *
 * 为什么需要精细形态：一批警示句往往是「同一条里既有已删除的名字、又有真实文件」
 * （例如「原句写的 `tests/backup.taskno-collision.spec.ts` 不存在，现改为
 * `tests/task-no.allocator.spec.ts:197`」）。整行豁免会**连真实文件一起放过**，
 * 等于用一个错误换另一个错误。
 */
const IGNORE_RE = /refs-ignore(?:\s+([^\n>]*?))?\s*-->/;

/** 解析本行豁免声明；返回 null 表示本行无豁免。 */
function parseIgnore(lineText) {
  const m = lineText.match(IGNORE_RE);
  if (!m) return null;
  const filters = String(m[1] || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { filters };
}

/** 某条引用是否被本行豁免声明覆盖。 */
function isIgnored(spec, refPath) {
  if (!spec) return false;
  if (spec.filters.length === 0) return true;
  const p = String(refPath || '');
  return spec.filters.some((f) => p.includes(f));
}

/**
 * 「计划新建」区域的内联标记（结构化识别的逃生口）。
 * 绝大多数情况下不需要它 —— 本脚本会自动把**「新增 / 新建」小节**（见 PLANNED_NEW_HEADING_RE）
 * 里的引用按「预期不存在」处理。只有当某个新建文件写在没有这种小节的散句里时，才需要这个标记。
 */
const NEW_TOKEN = 'refs-new';

/**
 * 「计划新建 / 预期不存在」小节的标题特征。
 * 对设计文档而言，**引用一个尚未创建的文件是正当的**（§4.1「新增（N）」就是要列它们）。
 * 所以不能把它判成 ❌「文件不存在」—— 那正是「写错路径」（幽灵测试文件）的同一句话。
 * 这两类必须分开，判据只能是**文档自己的结构**：标题明说这是「新增」清单。
 *
 * 刻意收窄：只认「新增/新建 + 括号数量」或「新增文件/新建文件/计划新建」，
 * 以免把「5.1 隔离谓词（**新增**，`src/…`）」这种「顺手提一句新增」的正文标题误判成整节豁免。
 */
const PLANNED_NEW_HEADING_RE = /新增\s*[（(]\s*\d|新建\s*[（(]\s*\d|新增文件|新建文件|计划新建|待创建文件/;

/**
 * 从标题/加粗小标签里取「声明的数量」，用于与实列条数对账。
 * 兼容三种真实写法：「新增（17）」「新增（13 个）」「修改（33 个文件）」。
 * 最后一种（量词后又带名词）必须支持 —— 本仓库附录 A 正是 `**修改（33 个文件）**`，
 * 旧正则只吃到「个」就要求右括号，故对它是 null ⇒ 那条清单**从来没被对账过**。
 * 尾部名词用**显式小词表**而非 `[^)）]*` 通配：宁可漏认，也不要在无关括号上误认。
 */
const DECLARED_COUNT_RE = /[（(]\s*(\d+)\s*(?:个|项|条|处|份|只|页|次|张)?\s*(?:文件|条目|小节|章节|处|项|条|张|份)?\s*[)）]/;

/**
 * 取出声明括号里的**单位**。返回 'file' 表示声明的单位是「文件」。
 *
 * 为什么必须区分单位（真实案例，v0.7-系统设计与任务分解-合并范围.md 附录 A）：
 * 标题写 `**修改（33 个文件）**`，而表格只有 **29 行**。文档自己第 1891 行解释了口径：
 * 「27 个单文件行 + `electron/` 2 个 + 既有 spec 4 个 = 33」—— 即
 *   · 第 1888 行 1 行打包了 2 个文件（`electron/main.cjs` / `electron/preload.cjs`）
 *   · 第 1889 行 1 行写明「等 4 个既有 spec」，但只点名 1 个
 * **文档是对的**：它数的是**文件**，而工具能枚举的结构是**行/条目**，两者本就不可直接比对。
 * 若强行比行数，就会在正确文档上报 29≠33 —— 正是本工具最不能犯的「在正确输入上误报」。
 * 故单位是「文件」时**不做判定**，如实报为「不可对账」（见下），而不是猜一个数去比。
 */
function declaredUnit(headingText) {
  if (!headingText) return null;
  const m = headingText.match(
    /[（(]\s*\d+\s*(?:个|项|条|处|份|只|页|次|张)?\s*([文件条目小节章节处项条张份]*)\s*[)）]/,
  );
  if (m && m[1] && m[1].includes('文件')) return 'file';
  return null;
}

/**
 * 哪些标题/加粗小标签**参与数量对账**。
 *
 * 为什么必须带「新增/新建/修改/变更/删除」这类**清单语义关键词**，而不能只凭 `DECLARED_COUNT_RE`：
 * 真实文档里有大量**恰好也带括号数字、但根本不是清单条数**的标题，例如
 *   `### R2 · 🔴 Dexie version(2).stores() 会整体替换索引定义（必守）` ← 那个 (2) 是版本号
 *   `#### ⚠️ 19 → 31 的差额（12 处）是什么`                       ← 那 12 处不是 12 个条目
 *   `## 3.2 用户故事（5 个）`                                     ← 正文散文，不是列表
 * 只按「括号里有数字」就对账，会在这类标题上批量误报 —— 而**在正确输入上误报的关卡会被关掉**，
 * 那等于这个能力不存在。故此处刻意收窄到「清单语义 + 括号数量」。
 *
 * 覆盖范围：新增（17）／修改（32）／新增文件（26）／修改文件（37）等；
 * 「新增（N）」同时决定**存在性豁免**（见 PLANNED_NEW_HEADING_RE），
 * 而「修改（N）」**不豁免存在性** —— 被修改的文件本来就该存在、必须照常校验。
 * 这两件事必须分开：若把「修改」并入 PLANNED_NEW_HEADING_RE，§4.2 整节会退化成 ➖，
 * 等于放掉「开发者照着改的那张表」的全部校验。
 */
const COUNTED_HEADING_RE = /新增|新建|修改|变更|删除/;

/**
 * 块级条目判定（对账口径：**条目数**，不是**引用数**）。
 *
 * 起因（真实误报，2026-09，v0.8 §4.1）：第 3 行是
 *   `| 3 | ★ \`src/core/color/derive-stage-colors.ts\` | …（与工作区根 \`tmp/build_palette2.py\` 逐行对齐）… |`
 * 一行里有两个 code span ⇒ 旧口径数成 2 ⇒ 18 ≠ 声明 17 ⇒ **在正确的文档上报错**。
 * 而该小节 `awk '/^### 4\.1/,/^### 4\.2/' | grep -cE '^\| *[0-9]+ \|'` 恰好 17 行，文档是对的。
 *
 * 口径（**只有这三类算条目**）：
 *   · 表格数据行（`|…|`，排除 `|---|` 分隔行）
 *   · 无序列表项（`-` / `*` / `+`）
 *   · 顶层编号项（`1.` / `1)`）
 * **正文行、引用块（`>`）等一律不算条目** —— 这正是 §4.2 那条
 * `> **TBD-7b 裁决后的清单变动**（原 34 项 → 32 项）：…` 的性质：它是**旁注**，
 * 里面顺带提到的 `dexie.database.ts` 不该让 32 变成 33。
 * 同一行/同一项里的额外引用**照常逐个校验**，只是不参与计数。
 */
const TABLE_ROW_RE = /^\s*\|/;
const TABLE_SEP_RE = /^\s*\|[\s:|-]+\|\s*$/; // |---|---| 分隔行，不是条目
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s/; // 无序项 或 顶层编号项
const LIST_CONT_RE = /^\s{2,}\S/; // 列表项的**续行**（缩进 ≥2）→ 并入所属条目，不新起一条

const MODE = { INLINE: 'inline', INFERRED: 'inferred', LINK: 'link' };

/**
 * 本行属于哪个「块级条目」；`id` 为 null 表示本行**不构成条目**（正文 / 旁注 / 分隔行）。
 * 同一列表项的续行返回**同一个** id，故「1 项写 3 行」仍只算 1 条。
 */
function blockIdForLine(i, scannable, currentItemBlock) {
  const t = scannable.trim();
  if (t === '') return { id: null, item: null };
  if (TABLE_ROW_RE.test(scannable)) {
    return TABLE_SEP_RE.test(scannable)
      ? { id: null, item: null }
      : { id: `row:${i}`, item: null };
  }
  if (LIST_ITEM_RE.test(scannable)) return { id: `item:${i}`, item: `item:${i}` };
  if (LIST_CONT_RE.test(scannable) && currentItemBlock) {
    return { id: currentItemBlock, item: currentItemBlock };
  }
  return { id: null, item: null }; // 正文 / 引用块：不是条目，不参与计数
}

/* ============================ 参数 ============================ */

function parseArgs(argv) {
  const opts = {
    root: DEFAULT_ROOT,
    docs: [],
    json: false,
    list: false,
    quiet: false,
    checkHints: false,
    strictHints: false,
    strictPaths: false,
    strictCounts: false,
    only: null,
    help: false,
    usageError: null,
  };

  for (const a of argv) {
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--list') opts.list = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--check-hints') opts.checkHints = true;
    else if (a === '--strict-hints') { opts.checkHints = true; opts.strictHints = true; }
    else if (a === '--strict-paths') opts.strictPaths = true;
    else if (a === '--strict-counts') opts.strictCounts = true;
    else if (a.startsWith('--only=')) opts.only = a.slice('--only='.length);
    else if (a.startsWith('--root=')) opts.root = resolve(a.slice('--root='.length));
    else if (a.startsWith('--repo=')) opts.root = resolve(a.slice('--repo='.length));
    else if (a.startsWith('--docs=')) opts.docs.push(resolve(a.slice('--docs='.length)));
    else if (a.startsWith('--doc=')) opts.docs.push(resolve(a.slice('--doc='.length)));
    else if (a.startsWith('-')) {
      opts.usageError = `未知参数：${a}`;
      return opts;
    } else opts.docs.push(resolve(a));
  }
  return opts;
}

/**
 * 帮助文本。
 *
 * ⚠️ 刻意**不用模板字符串**（用单引号数组 + join）：本段最长、最容易顺手写反引号，
 * 而模板串里出现**裸反引号**会**提前闭合它**，另一半又会被当成新的模板串 —— 后续标识符
 * 被解析成变量名，报出来的是 **ReferenceError 而不是 SyntaxError**，表现为
 * 「脚本一启动就崩、连 --help 都打不开」，而且在读取「用法」之前就崩，极难自查。
 *
 * 起因（真实事故，别再犯）：2026-09-12 本段里写了「位于标题（或 `**加粗小标签**`）」这种
 * markdown 口吻的反引号 → 模块求值期即抛 `ReferenceError: 加粗小标签 is not defined`。
 * 更糟的是：当时主理人跑成功的是**加机制之前的旧版本**，所以那次改动引入的整段机制
 * **一次都没运行过**。同类形状本项目已第 3 次（前两次是块注释里写 glob 通配符，
 * 让注释提前闭合）。**给别人的脚本，自己跑不过一次就等于没写。**
 */
const USAGE = [
  '文档引用体检（只读）',
  '',
  '  node scripts/check-doc-refs.mjs [选项] [文档路径或目录 ...]',
  '',
  '选项',
  '  --docs=<dir|file>    指定要扫描的文档（可重复，多个之间累加；一旦出现即**取代**默认目录，',
  '                       不是追加到默认目录。想同时扫默认目录，请把它一并列出）',
  '  --root=<dir>         校验引用时使用的仓库根（默认 = 本脚本所在仓库）',
  '  --list               只列出引用，不做校验',
  '  --check-hints        额外把引用旁的「期望文本」与引用行原文做子串比对',
  '  --strict-hints       子串比对失败也计入失败（需同时开 --check-hints）',
  '  --strict-paths       「只写文件名、未写全路径」也计入失败',
  '  --strict-counts      「新增（N）」小节声明数量与实列条数不一致时计入失败（默认只告警）',
  '  --only=<substr>      只输出含该子串的引用',
  '  --json               机器可读输出',
  '  --quiet              只打印汇总与失败项',
  '  -h, --help           本帮助',
  '',
  '行内标记',
  '  <!-- refs-ignore -->                    该行整行不校验',
  '  <!-- refs-ignore <子串> [<子串>…] -->   只豁免路径含该子串的引用（同行其它引用照常校验）← 推荐',
  '  <!-- refs-new -->                       该引用按「计划新建、预期不存在」处理（局部无「新增」小节时才需要）',
  '',
  '「计划新建」自动识别：位于标题（或加粗小标签 **新增（N）**）匹配「新增（N）/ 新建（N）/',
  '新增文件 / 计划新建」的小节内的引用，按「预期不存在」处理（➖，不算错），并自动与声明数量对账。',
  '',
  '退出码：0 = 无「可证明的错误」；1 = 有；2 = 前置/用法问题',
].join('\n');

/* ============================ 文件收集 ============================ */

function collectMarkdown(target, acc, seen) {
  if (!target || seen.has(target)) return acc;
  seen.add(target);
  if (!existsSync(target)) return acc;

  let st;
  try { st = statSync(target); } catch { return acc; }

  if (st.isDirectory()) {
    let entries;
    try { entries = readdirSync(target, { withFileTypes: true }); } catch { return acc; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        collectMarkdown(join(target, e.name), acc, seen);
      } else if (/\.md$/i.test(e.name)) {
        collectMarkdown(join(target, e.name), acc, seen);
      }
    }
  } else if (/\.md$/i.test(target)) {
    acc.push(target);
  }
  return acc;
}

function defaultDocTargets(root) {
  const cands = [join(root, 'docs'), join(root, '..', 'deliverables', 'research')];
  return cands.filter((c) => existsSync(c));
}

/** 文件名 → 仓库内相对路径列表（仅按需构建：用于解析「只写了文件名」的引用）。 */
function buildNameIndex(root) {
  const map = new Map();
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(join(dir, e.name));
      } else {
        const rel = relative(root, join(dir, e.name)).split(sep).join('/');
        if (!map.has(e.name)) map.set(e.name, []);
        map.get(e.name).push(rel);
      }
    }
  };
  walk(root);
  return map;
}

/* ============================ 引用抽取 ============================ */

/** 从一段文本里抽 `:行号`（含区间展开）。 */
function extractLines(text) {
  const out = [];
  const re = new RegExp(LINE_RE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const a = Number(m[1]);
    if (!Number.isFinite(a)) continue;
    if (m[2]) {
      const b = Number(m[2]);
      if (Number.isFinite(b) && b >= a && b - a <= MAX_LINE_EXPANSION) {
        for (let n = a; n <= b; n++) out.push(n);
      } else {
        out.push(a);
      }
    } else {
      out.push(a);
    }
    if (out.length > 400) break; // 防爆
  }
  return [...new Set(out)];
}

/** 从一行 Markdown 里抽全部引用。 */
function extractRefsFromLine(lineText) {
  const refs = [];
  const spans = [];
  const sre = new RegExp(SPAN_RE.source, 'g');
  let sm;
  while ((sm = sre.exec(lineText)) !== null) {
    spans.push({ inner: sm[1], start: sm.index, end: sm.index + sm[0].length });
  }

  let lastPath = null;

  for (const span of spans) {
    const inner = span.inner;
    const pre = new RegExp(PATH_RE.source, 'g');
    const hits = [];
    let pm;
    while ((pm = pre.exec(inner)) !== null) {
      hits.push({ path: pm[1], start: pm.index, end: pre.lastIndex });
    }

    if (hits.length > 0) {
      for (let i = 0; i < hits.length; i++) {
        const tailStart = hits[i].end;
        const tailEnd = i + 1 < hits.length ? hits[i + 1].start : inner.length;
        const lines = extractLines(inner.slice(tailStart, tailEnd));
        lastPath = hits[i].path;
        refs.push({
          path: hits[i].path,
          lines,
          mode: MODE.INLINE,
          hint: readHint(lineText, span.end),
        });
      }
      continue;
    }

    // span 里没有路径，但有裸行号 → 归属本行最近出现过的路径
    const bareLines = extractLines(inner);
    if (bareLines.length > 0) {
      refs.push({
        path: lastPath,
        lines: bareLines,
        mode: MODE.INFERRED,
        hint: readHint(lineText, span.end),
      });
    }
  }

  // Markdown 链接里的本地路径
  const lre = /\]\(([^)\s]+)\)/g;
  let lm;
  while ((lm = lre.exec(lineText)) !== null) {
    const target = lm[1];
    if (/^[a-z]+:\/\//i.test(target) || target.startsWith('#')) continue;
    if (!new RegExp('\\.(?:' + EXT_ALT + ')(?![A-Za-z0-9_])').test(target)) continue;
    refs.push({ path: target, lines: [], mode: MODE.LINK, hint: null });
  }

  return refs;
}

/** 引用之后若紧跟一个反引号片段，把它当成「期望文本」。 */
function readHint(lineText, afterIndex) {
  const tail = lineText.slice(afterIndex, afterIndex + HINT_LOOKAHEAD);

  // 候选必须是「引用之后的第一个反引号片段」，否则（例如本行有 3 个引用）容易把
  // 下一个路径引用误当成期望文本。
  // 另：无法用 lastIndex 复用的全局正则（PATH_RE/LINE_RE）在此一律新建非全局副本。
  const anchor = tail.match(/^[^`]{0,40}?`([^`\n]{2,80})`/);
  if (!anchor) return null;

  const snippet = anchor[1];

  // 若片段自己就是一个路径引用（含 `:行号`），它显然不是期望文本 → 不认。
  const asPath = new RegExp(PATH_RE.source);
  const asLine = new RegExp(LINE_RE.source);
  if (asPath.test(snippet)) return null;
  if (asLine.test(snippet)) return null;
  if (/^[\s\u3001\u3002\uff0c\uff1b:/\-]+$/.test(snippet)) return null;

  return snippet;
}

/* ============================ 小节上下文（计划新建） ============================ */

/**
 * 维护「当前标题栈」。传入本行原文，若该行是标题则更新栈。
 *
 * 返回两个**不同用途**的 key（刻意不合并，见 COUNTED_HEADING_RE 的注释）：
 *   · plannedKey —— 命中「新增/新建」清单语义的标题 → 该节引用按**预期不存在**豁免（➖）
 *   · countKey   —— 命中「清单语义 + 括号数量」的标题 → 该节参与**条目数对账**
 * 二者对「新增（17）」是同一个标题；对「修改（32）」只有 countKey 命中（存在性照常校验）。
 */
function trackHeadings(headings, lineText) {
  const m = lineText.match(/^(#{1,6})\s+(.+?)\s*$/);
  if (m) {
    const level = m[1].length;
    headings[level] = m[2];
    for (let l = level + 1; l <= 6; l++) delete headings[l];
  }
  // 从**最深**的标题向上找：命中的那个标题即为归属小节。
  // 不能只看最深一级 —— 「### 4.1 新增（17）」下面还可能有「#### 4.1.1 …」子标题，
  // 若只让最深一级裁决，那些子标题下的引用会漏判成 ❌。
  // 同级的「### 4.3 明确不改」会自然替换掉「### 4.1」，故不存在「新增小节吞掉明确不改」的问题。
  let plannedKey = null;
  let countKey = null;
  for (let l = 6; l >= 1; l--) {
    const text = headings[l];
    if (!text) continue;
    if (plannedKey === null && PLANNED_NEW_HEADING_RE.test(text)) plannedKey = text;
    if (countKey === null && COUNTED_HEADING_RE.test(text) && declaredCount(text) != null) {
      countKey = text;
    }
  }
  return { plannedKey, countKey };
}

/** 从「新增（17）」这类标题里取声明数量；取不到返回 null。 */
function declaredCount(headingText) {
  if (!headingText) return null;
  const m = headingText.match(DECLARED_COUNT_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/* ============================ 校验 ============================ */

function makeVerifier(opts, nameIndexRef) {
  const root = opts.root;
  const lineCache = new Map();

  function readLines(abs) {
    if (lineCache.has(abs)) return lineCache.get(abs);
    let value;
    try {
      const text = readFileSync(abs, 'utf8');
      value = { ok: true, lines: text.split(/\r?\n/) };
    } catch (err) {
      value = { ok: false, reason: String((err && err.message) || err) };
    }
    lineCache.set(abs, value);
    return value;
  }

  function resolvePath(refPath) {
    const cleaned = refPath.replace(/^\.\//, '');
    const abs = resolve(root, cleaned);
    if (existsSync(abs)) {
      let isDir = false;
      try { isDir = statSync(abs).isDirectory(); } catch { /* ignore */ }
      if (!isDir) return { kind: 'ok', abs, rel: cleaned };
    }
    // 退一步：只给了文件名 → 全仓按文件名找
    if (!cleaned.includes('/')) {
      const idx = nameIndexRef.get();
      const hits = idx.get(cleaned) || [];
      if (hits.length === 1) {
        return { kind: 'bare-name', abs: resolve(root, hits[0]), rel: hits[0], candidates: hits };
      }
      if (hits.length > 1) {
        return { kind: 'ambiguous', abs: null, rel: null, candidates: hits };
      }
    }
    return { kind: 'missing', abs: null, rel: null, candidates: [] };
  }

  function verify(ref, planned) {
    const out = {
      raw: ref.path,
      lines: ref.lines,
      mode: ref.mode,
      status: 'ok',
      planned: Boolean(planned),
      resolved: null,
      lineTexts: [],
      lineVerification: ref.lines.length > 0 ? 'unverified' : 'no-lines-requested',
      candidates: [],
      messages: [],
      hint: ref.hint || null,
      hintMissing: [],
    };

    if (!ref.path) {
      out.status = 'unattributable';
      out.messages.push('该处只有行号、本行前面没有出现过路径 → 无法归属，跳过');
      return out;
    }

    if (PLACEHOLDER_RE.test(ref.path)) {
      out.status = 'placeholder';
      out.messages.push('含占位符（<>/{}/?/…），无法机器校验 → 跳过');
      return out;
    }

    // ── 「计划新建」区域：引用不存在的文件是**正当的**，不能与「写错路径」混为一谈 ──
    if (planned) {
      if (!ref.path.includes('/')) {
        out.status = 'planned-new-bare';
        out.messages.push('声明为「计划新建」，但只写了文件名 —— 新建文件必须写**全路径**，否则实施方无法落地');
        return out;
      }
      const plannedResolve = resolvePath(ref.path);
      if (plannedResolve.kind === 'missing') {
        out.status = 'planned-new';
        out.messages.push('计划新建（预期不存在）→ 不计为错误；本条只证明「文档声明它将被创建」');
        return out;
      }
      out.messages.push('声明为「计划新建」，但该文件已存在 → 按正常文件校验（可能上一轮已创建）');
    }

    const r = resolvePath(ref.path);

    if (r.kind === 'missing') {
      out.status = 'missing';
      out.messages.push('文件不存在（已按全路径查找；若只写文件名则另按文件名全仓搜过，0 命中）');
      return out;
    }
    if (r.kind === 'ambiguous') {
      out.status = 'ambiguous';
      out.candidates = r.candidates;
      out.messages.push(`只写文件名，仓库里有 ${r.candidates.length} 个同名候选 → 无法判定，请写全路径`);
      return out;
    }

    out.resolved = r.rel;
    if (r.kind === 'bare-name') {
      out.status = 'bare-name';
      out.messages.push(`文件存在（${r.rel}），但文档只写了文件名 → 引用不可直接验证，建议补全路径`);
    }

    if (ref.lines.length === 0) {
      out.lineVerification = 'no-lines-requested';
      return out;
    }

    const read = readLines(r.abs);
    if (!read.ok) {
      out.lineVerification = 'unverified';
      out.messages.push(`仅验证文件存在，行号未验证（文件不可按文本读取：${read.reason}）`);
      return out;
    }

    const total = read.lines.length;
    let beyond = 0;
    for (const n of ref.lines) {
      if (n < 1 || n > total) {
        beyond += 1;
        out.lineTexts.push({ n, text: null });
        continue;
      }
      out.lineTexts.push({ n, text: String(read.lines[n - 1]).slice(0, MAX_LINE_TEXT) });
    }

    if (beyond > 0) {
      out.status = 'beyond-eof';
      out.lineVerification = 'beyond-eof';
      out.messages.push(`有 ${beyond} 个行号超出文件总行数（该文件共 ${total} 行）→ 行号已失效`);
    } else {
      out.lineVerification = 'text-printed';
      out.messages.push(`仅验证文件存在 + 打印该行原文供比对（共 ${total} 行）；本脚本不断言行号内容正确`);
    }

    if (opts.checkHints && out.hint) {
      const haystack = out.lineTexts
        .map((t) => (t.text == null ? '' : t.text))
        .join(' ')
        .replace(/\s+/g, ' ');
      const fragments = splitHint(out.hint);
      for (const f of fragments) {
        if (!haystack.includes(f)) out.hintMissing.push(f);
      }
      if (out.hintMissing.length > 0) {
        if (out.status === 'ok' || out.status === 'bare-name') out.status = 'hint-miss';
        out.messages.push(
          `期望文本未在该行出现（子串比对，非证明）：${out.hintMissing.map((f) => JSON.stringify(f)).join('、')}`,
        );
      }
    }

    return out;
  }

  return verify;
}

/** 把「期望文本」切成可判定的片段：去除省略号段、去除过短与纯符号片段。 */
function splitHint(hint) {
  return hint
    .split(/\u2026|\.\.\./)
    .flatMap((seg) => seg.split(/\s{2,}/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .filter((s) => /[A-Za-z0-9`<>=("]/.test(s))
    .slice(0, 6);
}

/* ============================ 输出 ============================ */

const ICON = {
  ok: '✅',
  'bare-name': '⚠️',
  'hint-miss': '❗',
  missing: '❌',
  ambiguous: '❌',
  'beyond-eof': '❌',
  placeholder: '➖',
  unattributable: '➖',
  suppressed: '➖',
  'planned-new': '➖',
  'planned-new-bare': '⚠️',
  'count-warn': '⚠️',
  'count-mismatch': '❌',
  'count-unreconcilable': '➖',
};

function failStatuses(opts) {
  const base = new Set(['missing', 'ambiguous', 'beyond-eof']);
  if (opts.strictPaths) { base.add('bare-name'); base.add('planned-new-bare'); }
  if (opts.strictHints) base.add('hint-miss');
  if (opts.strictCounts) base.add('count-mismatch');
  return base;
}

/* ============================ 主流程 ============================ */

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (opts.usageError) {
    process.stderr.write(`${opts.usageError}\n${USAGE}`);
    return 2;
  }

  const targets = opts.docs.length > 0 ? opts.docs : defaultDocTargets(opts.root);
  if (targets.length === 0) {
    process.stderr.write(
      `找不到要扫描的文档。请用 --docs=<dir|file> 指定（当前 root=${opts.root}）。\n${USAGE}`,
    );
    return 2;
  }

  const docs = [];
  const seenDocs = new Set();
  for (const t of targets) collectMarkdown(t, docs, seenDocs);

  if (docs.length === 0) {
    process.stderr.write(`指定的路径里没有 .md 文件：${targets.join(', ')}\n`);
    return 2;
  }

  let nameIndexCache = null;
  const nameIndexRef = {
    get() {
      if (nameIndexCache === null) nameIndexCache = buildNameIndex(opts.root);
      return nameIndexCache;
    },
  };

  const verify = makeVerifier(opts, nameIndexRef);
  const failSet = failStatuses(opts);

  const records = [];
  const countChecks = [];
  const counts = {
    docs: docs.length,
    refs: 0,
    ok: 0,
    'bare-name': 0,
    'hint-miss': 0,
    missing: 0,
    ambiguous: 0,
    'beyond-eof': 0,
    placeholder: 0,
    unattributable: 0,
    suppressed: 0,
    'planned-new': 0,
    'planned-new-bare': 0,
  };

  for (const doc of docs) {
    let text;
    try {
      text = readFileSync(doc, 'utf8');
    } catch (err) {
      records.push({
        doc,
        docLine: 0,
        status: 'unattributable',
        raw: doc,
        messages: [`文档不可读：${String((err && err.message) || err)}`],
        lineTexts: [],
      });
      continue;
    }

    const lines = text.split(/\r?\n/);
    const headings = {};
    const sections = new Map();
    let inFence = false;
    // 「**新增（13 个）**」这种**加粗小标签**（不是标题）也当小节边界 —— 本仓库的文档
    // 大量用它分节（附录 A 就是 `**新增（13 个）**` / `**修改（33 个文件）**` / `**明确不改（本轮）**`）。
    let boldPlanned = false;
    // 「加粗小标签」小节也要能对账：boldPlanned 决定本行是否按「计划新建」处理，
    // 而 boldCountKey 决定本行归属哪个**待对账**小节，必须像标题栈那样
    // **持续到下一个标题 / 下一个加粗小标签**，否则 `**新增（13 个）**` 下面列表里的引用
    // 拿到 countKey=null → 对账永远不触发
    // （附录 A 正是 `**新增（N）**` / `**修改（N 个文件）**` / `**明确不改（本轮）**` 三段加粗小标签）。
    let boldCountKey = null;
    // ⚠️ 加粗小标签必须能**顶掉**祖先标题对账：否则
    //     `## 修改（5）` … `**修改（7 个文件）**` 这种「标题下面再挂一个加粗清单」的写法，
    //     加粗清单里的条目会被算进上面那个**已过时的标题**（实测：5 变 3、下面的 7 完全不报）。
    //     故用一个显式作用域标志：处于加粗小标签作用域内时，对账 key 只认加粗标签，不再回落到标题栈。
    let boldScopeActive = false;
    // 当前列表项条目的 id（供 blockIdForLine 判断「续行并入本项」）
    let currentItemBlock = null;
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      // 围栏判定**只此一处**（见 scanFenceLine）：行中开/合栏也认，且返回等长的可校验文本。
      // 之前用「行首 ^``` 才翻转」会让表格单元格内的行中开栏漏判，状态从此反相，
      // 其后整篇文档被当代码块跳过 —— 那正是「标题式分节永不对账」的真因。
      const fence = scanFenceLine(inFence, lineText);
      inFence = fence.inFenceAfter;
      const scannable = fence.scannable;
      // 整行都在围栏内（scannable 全空）→ 与旧行为一致：本行不校验、不参与标题栈
      if (scannable.trim() === '') continue;

      const isHeading = /^#{1,6}\s/.test(scannable);
      const boldMarker = scannable.match(/^\s*\*\*([^*]+)\*\*\s*$/);
      if (boldMarker) {
        boldScopeActive = true;
        boldPlanned = PLANNED_NEW_HEADING_RE.test(boldMarker[1]);
        boldCountKey =
          COUNTED_HEADING_RE.test(boldMarker[1]) && declaredCount(boldMarker[1]) != null
            ? boldMarker[1]
            : null;
      }
      if (isHeading) {
        // 真标题取代加粗小标签的作用域
        boldScopeActive = false;
        boldPlanned = false;
        boldCountKey = null;
      }

      // 标题栈只按「非围栏文本」维护（围栏里的 `# 注释` 不是标题）；
      // 一律用 scannable —— 它与 lineText **等长**，故 extractRefsFromLine/readHint 的下标仍然对齐。
      const { plannedKey, countKey } = trackHeadings(headings, scannable);
      const inlineNew = scannable.includes(NEW_TOKEN);
      const planned = Boolean(plannedKey) || boldPlanned || inlineNew;
      // 对账用的 countKey：处于加粗小标签作用域内时只认加粗标签（它能顶掉祖先标题），
      // 否则用标题栈里最近一个「清单语义 + 括号数量」的标题。
      const sectionKey = boldScopeActive ? boldCountKey : countKey;

      // 块级条目：本次累计「本行是否新增了一个条目」，供对账按**条目数**而非**引用数**统计
      const block = blockIdForLine(i, scannable, currentItemBlock);
      currentItemBlock = block.item;

      const refs = extractRefsFromLine(scannable);
      const ignoreSpec = parseIgnore(scannable);
      for (const ref of refs) {
        if (opts.only && !String(ref.path || '').includes(opts.only)) continue;

        counts.refs += 1;

        if (isIgnored(ignoreSpec, ref.path)) {
          counts.suppressed += 1;
          records.push({
            doc,
            docLine: i + 1,
            status: 'suppressed',
            raw: ref.path,
            lines: ref.lines,
            mode: ref.mode,
            messages: [
              ignoreSpec.filters.length === 0
                ? '该行含 refs-ignore → 整行豁免，不校验（这是豁免，不是通过）'
                : `命中 refs-ignore 子串 [${ignoreSpec.filters.join(', ')}] → 不校验（这是豁免，不是通过）`,
            ],
            lineTexts: [],
          });
          continue;
        }

        // 对账按**块级条目数**统计（不是引用条数、也不是不同路径数）：
        // 同一行/同一项里多写几个引用不改变条目数，但那几个引用**上面照常逐个校验过**。
        if (sectionKey && ref.path && block.id) {
          if (!sections.has(sectionKey)) {
            sections.set(sectionKey, { declared: declaredCount(sectionKey), blocks: new Set() });
          }
          sections.get(sectionKey).blocks.add(block.id);
        }

        if (opts.list) {
          records.push({ doc, docLine: i + 1, status: 'listed', raw: ref.path, lines: ref.lines, mode: ref.mode });
          continue;
        }
        const res = verify(ref, planned);
        counts[res.status] = (counts[res.status] || 0) + 1;
        records.push({ doc, docLine: i + 1, ...res });
      }
    }

    // 「声明 N 个 / 实列 M 个」对账 —— 本类计数错误在本项目已发生 4 次以上
    // 口径：M = 本节的**块级条目数**（表格数据行 / 列表项各算 1 条；正文与旁注不计）
    for (const [key, sec] of sections) {
      if (sec.declared == null) continue;
      const listed = sec.blocks.size;
      // 声明单位是「文件」时，枚列单位（行/条目）与它不同构（一行可能打包 N 个文件），
      // **不做判定**：不猜、也不报假错，只如实标注「不可对账」。
      if (declaredUnit(key) === 'file') {
        countChecks.push({ doc, heading: key, declared: sec.declared, listed, status: 'count-unreconcilable' });
        continue;
      }
      if (listed !== sec.declared) {
        countChecks.push({
          doc,
          heading: key,
          declared: sec.declared,
          listed,
          status: opts.strictCounts ? 'count-mismatch' : 'count-warn',
        });
      }
    }
  }

  const recordFailures = records.filter((r) => failSet.has(r.status));
  const countFailures = countChecks.filter((c) => failSet.has(c.status));
  const failures = recordFailures.length + countFailures.length;

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ root: opts.root, docs, counts, countChecks, failures, records }, null, 2) + '\n',
    );
    return failures > 0 ? 1 : 0;
  }

  const out = [];
  out.push(`文档引用体检 · root=${opts.root}`);
  out.push(`扫描文档 ${docs.length} 篇：`);
  for (const d of docs) out.push(`  - ${relative(opts.root, d).split(sep).join('/') || d}`);
  out.push('');

  let currentDoc = null;
  for (const r of records) {
    if (opts.quiet && !failSet.has(r.status) && r.status !== 'bare-name') continue;
    if (r.doc !== currentDoc) {
      currentDoc = r.doc;
      out.push(`── ${relative(opts.root, r.doc).split(sep).join('/') || r.doc}`);
    }
    const icon = r.status === 'listed' ? '·' : ICON[r.status] || '·';
    const linesLabel = r.lines && r.lines.length
      ? ':' + r.lines.map((n) => String(n)).join(',')
      : '';
    const modeLabel = r.mode === MODE.INFERRED
      ? '（归属：按本行最近路径推断）'
      : r.mode === MODE.LINK
        ? '（Markdown 链接）'
        : '';
    out.push(`${icon} ${r.raw || '(无路径)'}${linesLabel}${modeLabel}    ← 文档第 ${r.docLine} 行`);
    for (const m of r.messages || []) out.push(`     · ${m}`);
    for (const lt of r.lineTexts || []) {
      if (lt.text == null) out.push(`     L${lt.n}: ⚠️ 该行号超出文件总行数`);
      else out.push(`     L${lt.n}: ${lt.text}`);
    }
    if (r.candidates && r.candidates.length > 0) {
      for (const c of r.candidates) out.push(`     候选: ${c}`);
    }
  }

  if (countChecks.length > 0) {
    out.push('── 「声明 N 个 / 实列 M 个」对账');
    for (const c of countChecks) {
      out.push(`${ICON[c.status] || '·'} ${c.heading}`);
      out.push(`     · 标题声明 ${c.declared} 个，本节实际列出 ${c.listed} 个条目（只数表格数据行与列表项；正文/旁注行不计，同行额外引用照常校验但不计数）`);
      if (c.status === 'count-unreconcilable') {
        out.push('     · 声明单位是「文件」而可枚举的结构是「行/条目」，一行可能打包 N 个文件（如「`a.cjs` / `b.cjs`」、「…等 4 个」）');
        out.push('     · ⇒ 二者不同构，**本工具不做判定**（不猜、也不报假错）—— 需人工核对两列');
        continue;
      }
      out.push(`     · 差异 ${c.listed - c.declared >= 0 ? '+' : ''}${c.listed - c.declared}${c.status === 'count-mismatch' ? '（--strict-counts：计入失败）' : '（默认只告警；加 --strict-counts 可计入失败）'}`);
    }
    out.push('');
  }

  out.push('');
  out.push('汇总：');
  out.push(`  引用总数 ${counts.refs}`);
  out.push(`  ✅ 文件存在 ${counts.ok}`);
  out.push(`  ⚠️ 只写文件名（未写全路径）${counts['bare-name']}`);
  out.push(`  ❗ 期望文本未命中（子串比对）${counts['hint-miss']}`);
  out.push(`  ❌ 文件不存在 ${counts.missing}`);
  out.push(`  ❌ 同名候选歧义 ${counts.ambiguous}`);
  out.push(`  ❌ 行号超出总行数 ${counts['beyond-eof']}`);
  out.push(`  ➖ 含占位符跳过 ${counts.placeholder}`);
  out.push(`  ➖ 无法归属跳过 ${counts.unattributable}`);
  out.push(`  ➖ 行内 refs-ignore 豁免 ${counts.suppressed}`);
  out.push(`  ➖ 计划新建（预期不存在）${counts['planned-new']}   ← 来自「新增/新建」小节，**不是错误**`);
  out.push(`  ⚠️ 计划新建但只写文件名 ${counts['planned-new-bare']}`);
  out.push('');
  out.push('结论口径（别误读）：');
  out.push('  · 「✅ 文件存在」不等于「行号也对」 —— 行号只把该行原文打出来供人比对，本脚本不断言其内容。');
  out.push('  · ❌ = 「可证明的错误」：文件不存在（非新建小节）/ 同名候选歧义 / 行号超出文件总行数。');
  out.push('  · ⚠️「只写文件名」= 引用不可直接验证（历史上正是它被读成了另一个不存在的路径）；加 --strict-paths 可让它计入失败。');
  out.push('  · ➖「计划新建」= 「新增/新建（N）」小节内的引用，**预期不存在**，属正当引用；不参与 ❌，但会与标题声明的数量对账。');
  out.push('  · 想让行号内容也被机器比对：把期望文本写成引用旁的反引号片段，并加 --check-hints（子串包含级，仍非证明）。');
  out.push('');
  out.push('⚠️ 已知不可判（如实声明，不猜）：');
  out.push('  · 「计划新建」小节里**写错目录**的条目，本脚本无法识别（预期不存在的东西没有存在性可验）；');
  out.push('    只能靠「与标题声明的数量对账」间接兜 —— 少列 / 多列会被抓，写错目录不会。');

  if (failures > 0) {
    out.push(`失败 ${failures} 条（可证明的错误）。`);
  } else {
    out.push('无 ❌ 项。');
  }

  process.stdout.write(out.join('\n') + '\n');
  return failures > 0 ? 1 : 0;
}

let code = 0;
try {
  code = main();
} catch (err) {
  process.stderr.write(`check-doc-refs 内部错误：${(err && err.stack) || err}\n`);
  code = 2;
}
process.exit(code);
