#!/usr/bin/env node
/**
 * 测试类型检查**棘轮**（opt-in · **出包前**跑）：`tsconfig.tests.json` 的错误条数**只许降、不许涨**。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── 为什么需要它（起因是一条**真实被引入又无人拦**的错）──
 * ══════════════════════════════════════════════════════════════════════════════
 * `npm run typecheck:tests`（= `tsc --noEmit -p tsconfig.tests.json`）**不是合并硬闸**：
 * 它带着一批**既有债**（见下 BASELINE），于是任何时候它都是红的 ⇒ **红不再是信号**，
 * 任何人都不看它。2026-10-14 实测到的那一刻：有人往 `tests/plugin-registry.spec.ts`
 * 里写了 `ts.Node`（类型位置）却只用 `const ts = require('typescript')`（**值**绑定），
 * 一次引入 **2 条** `Cannot find namespace 'ts'`。这 2 条在有 96 条既有债的背景下
 * **完全不可见**：没人会为了 2 条新错去翻 96 条旧错的输出。
 *
 * ⇒ 修法不是「把 96 条一次清干净」（那是另一件事，且不属任何一条线），
 *   而是**把「不许涨」变成机器判据**：既有债冻结在 BASELINE，新增即非零退出。
 *   这是「数字棘轮」范式（同 `tests/i18n.spec.ts` 的 116 条棘轮）：**先冻结，再逐步降**。
 *
 * ── BASELINE 的纪律（改它之前先读这段）──
 *   · **只许变小**。修掉若干条之后，回本文件把 BASELINE 改成新的实测值（会写在同一行）。
 *   · **不许为了让脚本过而调大它**。调大 = 把「本轮新增的类型错」转成「基线的一部分」，
 *     等于这个脚本自废。若确实必须调大（例如团队决定引入一批新债），
 *     必须在同一个 commit 里写清「为什么这批新错是可接受的」。
 *   · 基线是**错误条数**（`error TS` 出现的行数），不是文件数。量法见下方「怎么量」。
 *
 * ── 怎么量（口径必须与脚本一致，否则基线不可复现）──
 *   `npx tsc --noEmit -p tsconfig.tests.json 2>&1 | grep -c "error TS"`
 *   （tsc 每条错都打一次 `error TS<四位码>:`，多行明细不带该标记 ⇒ 逐行计数即条数）
 *
 * ── 为什么**不进** `npm test`（这是刻意的代价取舍，不是漏了）──
 *   本脚本自身跑一次 tsc 要 **10–30 秒**（实测：冷启动更久）。`npm test` 是全仓每次跑批
 *   的入口，把它塞进去等于给**每一次**跑批加这个开销，而它防的是「**出包**前的类型债累积」——
 *   两件事的触发频率差三个数量级。⇒ 它属于 **release checklist**（见
 *   `docs/release-checklist.md`），由人在出包前显式跑；不进 `test` 脚本、不进 CI 默认集。
 *
 * ── ★ 它防的是「**集合守恒**」，不只是「计数守恒」（2026-10-14 加 `--new` 的原因）──
 *   只锚条数有一个**静默放行**的洞：**「修掉 3 条旧的 + 新增 3 条新的」⇒ 计数持平 96 → 96，
 *   而内容已经全换。** 计数守恒 ≠ 集合守恒 —— 这是「**量太钝**」（判据在取值域里只有一种
 *   可能结果）的教科书形态。
 *   ⇒ 所以另有一份**冻结的错误清单** `scripts/tests-typecheck-errors.txt`（逐条可读标识），
 *     `--new` 与它比对，**打印「不在清单里的错误」的名单** —— 一条报不出名字的红，
 *     等于一条不可归因的红。
 *   ⇒ 标识口径（**不含行号列号**，否则别人在文件上方加一行就会误报）：
 *       `<相对路径> \t TS<码> \t #<该 文件+码+消息 第几次出现> \t <空白归一化后的消息>`
 *
 * ── 用法 ──
 *   node scripts/check-tests-typecheck-baseline.mjs          # 出包前跑
 *   node scripts/check-tests-typecheck-baseline.mjs --new    # 与冻结清单比对：打印**结构层新增**名单（并单列「消息漂移」）
 *   node scripts/check-tests-typecheck-baseline.mjs --new --strict-drift   # 把「消息漂移」也判红（关掉分层带来的残余洞）
 *   node scripts/check-tests-typecheck-baseline.mjs --list   # 顺带列出全部错误行（默认只列前 20 条）
 *   node scripts/check-tests-typecheck-baseline.mjs --raw    # 只打印 tsc 原始输出（排障用）
 *   node scripts/check-tests-typecheck-baseline.mjs --write-baseline   # 重写冻结清单
 *       ⚠️ 只在**纯减少 / 纯消息漂移**时允许：相对旧清单出现任何**结构层新增** ⇒ **拒绝写入**
 *          （不许把新错洗进基线）。在**无 .git 的干净快照**里生成时用 `--head-override=<短哈希>` 记代码代。
 *
 * ── 退出码（四种，区分「超了」「集合变了」「量不出来」）──
 *   0 = 未超过基线（含「已减到基线以下」，此时提示下调 BASELINE）；`--new` 下还要求**结构层零新增**
 *   1 = **超过基线**，或 `--new` 下**结构层有新增**（即使计数持平 —— 那正是「修旧增新」）
 *   2 = **量不出来**（tsc 没跑起来 / 输出不可解析 / 条数与退出码自相矛盾 /
 *       要求 `--new` 但冻结清单不存在）—— ⇒ 绝不把「量不出来」当成「0 条」。
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ─────────────────────────────────────────────────────────────────────────────
 * ★ BASELINE：既有债的**冻结值**（只许变小；改前读文件头「BASELINE 的纪律」）
 *
 * 实测记录（每次下调请追加一行，便于后人看到下降轨迹）：
 *   2026-10-14  96 条   ← 首设。（设置线修 ⑩-b 那 2 条 `Cannot find namespace 'ts'`
 *                            之后实测；修之前是 98 条。涉及文件数在 41–42 之间浮动 ——
 *                            那只是「同一批错落在哪个文件」的呈现，**基线只锚条数**，别锚文件数，
 *                            否则别人一动文件边界就会误红。）
 * ──────────────────────────────────────────────────────────────────────────── */
const BASELINE = 96;

/** 超基线时最多打印多少条错误行（默认全列会把终端刷满，反而没人看） */
const SHOW_LIMIT_DEFAULT = 20;
const TS_CONFIG = 'tsconfig.tests.json';
/** 冻结的错误清单（`--new` 的比对对象；`--write-baseline` 重写） */
const ERRORS_BASELINE = join('scripts', 'tests-typecheck-errors.txt');

const args = new Set(process.argv.slice(2));
const listAll = args.has('--list');
const rawOnly = args.has('--raw');
const wantNew = args.has('--new');
const writeBaseline = args.has('--write-baseline');
/**
 * ★ 分层的**残余洞**（实测逼出来的，必须写在代码里而不是靠人记得）：
 *   「同 文件+码+序号」的「修旧增新」（fix 掉一个 TS2322、又添一个**不同内容**的 TS2322）
 *   会被归到「消息漂移」⇒ **默认不判红**。
 *   `--strict-drift` 把漂移也判红，用来关掉这个残余洞。
 *   默认不红的原因：实测到 tsc 的消息**会因环境漂移**（本轮实测 1 条），全判红会让棘轮
 *   在活跃开发期常红 ⇒ 变成没人看的红。**要严格就显式加 `--strict-drift`。**
 */
const strictDrift = args.has('--strict-drift');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { existsSync, readFileSync, writeFileSync } = await import('node:fs');
const baselinePath = join(root, ERRORS_BASELINE);

/**
 * 消息归一化。★ 两件事，都是被**实测**逼出来的：
 *   1. 空白折叠（tsc 会换行/缩进）。
 *   2. **抹掉绝对路径**：实测到 tsc 的消息里会内嵌本机绝对路径，两种形态都遇到过 ——
 *        · `import("E:/workbuddy/…/src/store/useProjectsStore").AssignmentLog[]`
 *        · `'E:/workbuddy/…/node_modules/jsdom/lib/api.js' implicitly has an 'any' type.`
 *      第二种**按「测量根」抹不掉**：在 `git archive` 出来的干净快照里测量时，
 *      node_modules 是指向**真实仓库**的联接，消息里的路径指向真实仓库 ⇒ 与快照根不同前缀。
 *      ⇒ 所以按**仓库目录名**归一（两种分隔符都认），换机器/换快照都算出同一个标识。
 */
function normalizeMsg(msg) {
  let out = msg.replace(/\s+/g, ' ').trim();
  // ★ 按**仓库内已知子路径**归一，而不是按「测量根的名字」—— 后者在 `git archive` 出来的
  //   临时快照里会失效（快照目录名不是 `changxia`，而消息里的路径指向**真实仓库**，
  //   因为 node_modules 是指向真实仓库的联接）。实测栽过一次，改用下面的口径。
  out = out.replace(
    /[A-Za-z]:[\\/][^\s'"]*?[\\/](node_modules|src|tests|templates|scripts)[\\/]/g,
    '<repo>/$1/',
  );
  return out;
}

/**
 * 把 tsc 的错误行变成**可读标识**（不含行号列号 ⇒ 上方加一行不会误报）。
 * 两级标识：
 *   strict = `路径 \t 码 \t #序号 \t 消息`（细）
 *   coarse = `路径 \t 码 \t #序号`（粗；**结构层**，用来把「消息漂移」和「真新增」分开）
 * 解析不出的行 ⇒ 直接判定「量不出来」：宁可停，也不许悄悄少认几条。
 */
function identityRows(errorLines) {
  const seen = new Map();
  const rows = [];
  for (const raw of errorLines) {
    const m = /^(.*)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(raw.trim());
    if (!m) return { ok: false, bad: raw };
    const [, file, line, col, code, msg] = m;
    const norm = normalizeMsg(msg);
    const k3 = `${file}\t${code}\t\t${norm}`; // 用空消息位占位，保证与 strict 字段数一致
    const n = (seen.get(k3) ?? 0) + 1;
    seen.set(k3, n);
    rows.push({
      file,
      line,
      col,
      code,
      n,
      coarse: `${file}\t${code}\t#${n}`,
      id: `${file}\t${code}\t#${n}\t${norm}`,
    });
  }
  return { ok: true, rows };
}

const coarseOf = (id) => id.split('\t').slice(0, 3).join('\t');

/** 冻结清单要在**无 .git 的干净快照**里生成（`git archive HEAD` 不含 .git）⇒ 允许显式传入代码代。 */
function argValue(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const headOverride = argValue('head-override');

/** git 短哈希（失败 ⇒ `(未知)`，**不当空串**；`--head-override` 优先） */
function gitHeadShort() {
  if (headOverride) return `${headOverride}（--head-override 传入）`;
  const res = spawnSync('git rev-parse --short HEAD', { cwd: root, shell: true, encoding: 'utf8' });
  const s = (res.stdout ?? '').trim();
  return s || '(未知)';
}
/** 未提交文件条数（失败 ⇒ `(未知)`） */
function dirtyCount() {
  if (headOverride) return ' 0（干净快照，无 .git）';
  const res = spawnSync('git status --porcelain', { cwd: root, shell: true, encoding: 'utf8' });
  if (res.status !== 0) return ' (未知)';
  return ` ${(res.stdout ?? '').split('\n').filter((l) => l.trim()).length}`;
}

/** 读冻结清单（`#` 开头为注释；返回 null = 不存在） */function loadFrozen() {
  if (!existsSync(baselinePath)) return null;
  return readFileSync(baselinePath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.trim());
}

const HEADER = [
  '# tsc -p tsconfig.tests.json 的**冻结错误清单**（逐条标识，供 check-tests-typecheck-baseline.mjs --new 比对）',
  '#',
  '# 为什么需要它：只锚**条数**会被「修掉 3 条旧的 + 新增 3 条新的」静默放行（计数持平、内容全换）。',
  '#            本文件防的是「**集合守恒**」，不是「计数守恒」。',
  '#',
  '# 标识口径（**不含行号列号** —— 否则在文件上方加一行就会全线误报）：',
  '#   <相对路径> <TAB> TS<码> <TAB> #<该 文件+码+消息 第几次出现> <TAB> <空白归一化后的消息>',
  '#',
  '# 纪律：**只许删行，不许加行**。修掉若干条后跑 `--write-baseline` 重写；',
  '#       若相对旧清单出现任何**结构层新增**（路径+错误码+序号 的组合是新的），脚本会**拒绝写入**',
  '#       （不许把新错洗进基线）。**纯消息漂移允许写入**（错误还在，只是文案变了）。',
  '#',
  '# ⚠️ 分层带来一个**残余洞**（如实声明）：「同 路径+码+序号」的「修旧增新」会被归到「消息漂移」，',
  '#    默认**不判红**（因为实测 tsc 的消息会因环境漂移，全判红会让棘轮在活跃开发期常红）。',
  '#    要关掉它：跑 `--new --strict-drift`。',
  '# 生成：node scripts/check-tests-typecheck-baseline.mjs --write-baseline',
];

/** 跑 tsc 并取「错误条数 + 原始输出」。任何启动/解析异常都返回 measured:false。 */
function measure() {
  // 用 shell 调 npx：Windows 上是 npx.cmd，直接 spawn('npx') 会 ENOENT（本仓在 Windows 上开发）
  // ★ `--noErrorTruncation`：tsc 默认会把长消息截断成 `... writebackPr...`，而**截断点取决于
  //   绝对路径的长度** ⇒ 同一份代码在不同根路径下会算出**不同的消息文本** ⇒ 冻结清单不可跨机复现。
  //   实测栽过一次（两个不同根下 96 条里有 1 条不一致）。关掉截断后消息与路径长度无关。
  const res = spawnSync(`npx tsc --noEmit --noErrorTruncation -p ${TS_CONFIG}`, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) return { measured: false, why: `tsc 启动失败：${res.error.message}` };
  if (res.status === null) return { measured: false, why: 'tsc 被信号中断（未拿到退出码）' };

  const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  const errorLines = out.split('\n').filter((l) => /error TS\d+/.test(l));
  const files = new Set(errorLines.map((l) => l.split('(')[0]));
  const count = errorLines.length;

  // 自相矛盾检查：tsc 无错误时退出码 0；有错误时退出码 2。据此判「量不出来」。
  if (count === 0 && res.status !== 0) {
    return {
      measured: false,
      why: `tsc 退出码 ${res.status} 但输出里没有任何 error TS 行（输出可能被截断/格式变了）`,
    };
  }
  if (count > 0 && res.status === 0) {
    return { measured: false, why: `输出里有 ${count} 条 error TS，但 tsc 退出码是 0（矛盾）` };
  }
  return { measured: true, count, fileCount: files.size, errorLines, raw: out };
}

const r = measure();

if (rawOnly) {
  if (!r.measured) {
    console.error(r.why);
    process.exit(2);
  }
  process.stdout.write(r.raw ?? '');
  process.exit(0);
}

if (!r.measured) {
  console.error(`\n❌ 量不出来：${r.why}`);
  console.error('   ⇒ 这**不是**「0 条错误」，棘轮结果无效。请先 `npm run typecheck:tests` 人工看一眼。');
  process.exit(2);
}

const { count, fileCount, errorLines } = r;

/* ── 集合维：逐条标识（`--new` / `--write-baseline` 用）───────────────────────── */
const idr = identityRows(errorLines);
if (!idr.ok) {
  console.error(`\n❌ 量不出来：有错误行解析不出标识 ⇒ 集合维判据无效。`);
  console.error(`   解析不了的那行：${idr.bad}`);
  console.error('   ⇒ 这**不是**「没有新增错误」。请先看 tsc 输出格式是不是变了。');
  process.exit(2);
}
const ids = idr.rows.map((x) => x.id).sort();
const frozen = loadFrozen();

if (writeBaseline) {
  if (frozen) {
    // ★ 只按**结构层**拒绝：纯消息漂移不算「新错」（错误还在，只是文案变了），
    //   否则团队每次重构类型名都会把清单卡死。真正的「把新错洗进基线」＝结构层出现新 (路径,码,序号)。
    const fCoarse = new Set(frozen.map(coarseOf));
    const cCoarse = new Set(ids.map(coarseOf));
    const added = [...cCoarse].filter((c) => !fCoarse.has(c));
    if (added.length > 0) {
      console.error(`\n❌ 拒绝写入冻结清单：相对旧清单出现 **${added.length} 条结构层新增**（清单只许删行）。`);
      const detail = ids.filter((id) => added.includes(coarseOf(id)));
      for (const id of detail.slice(0, listAll ? detail.length : SHOW_LIMIT_DEFAULT)) {
        console.error(`   + ${id.replace(/\t/g, '  |  ')}`);
      }
      console.error('   ⇒ 先把新错修掉，再重写清单。**不许把新错洗进基线。**');
      process.exit(1);
    }
  }
  writeFileSync(
    baselinePath,
    // ★ 存疑/状态类读数必须**自带时刻与代码代**（团队口径）：这份清单是「某一刻、某个 HEAD 上」的快照。
    `${HEADER.join('\n')}\n# 冻结于：HEAD ${gitHeadShort()} ｜ ${new Date().toISOString()}（工作树当时${dirtyCount()} 个未提交文件）\n${ids.join('\n')}\n`,
    'utf8',
  );
  console.log(
    `✅ 已写入冻结清单 ${ERRORS_BASELINE}：${ids.length} 条` +
      (frozen ? `（相对旧清单**纯减少** ${frozen.length - ids.length} 条）` : '（首次建立）'),
  );
  process.exit(0);
}

let newIds = null;
let goneIds = null;
let structuralNew = null;
let msgDrift = null;
if (wantNew) {
  if (!frozen) {
    console.error(
      `\n❌ 量不出来：要 --new 但冻结清单不存在（${ERRORS_BASELINE}）⇒ **判不了「集合守恒」**。`,
    );
    console.error('   ⇒ 这**不是**「零新增」。先生成它：--write-baseline');
    process.exit(2);
  }
  const fset = new Set(frozen);
  const cur = new Set(ids);
  newIds = ids.filter((id) => !fset.has(id));
  goneIds = frozen.filter((id) => !cur.has(id));
  // 分两层：**结构层**（路径+码+序号）才是「新增错误」；只有消息不同 = 文案漂移，不算新增。
  const fCoarse = new Set(frozen.map(coarseOf));
  const cCoarse = new Set(ids.map(coarseOf));
  structuralNew = [...cCoarse].filter((c) => !fCoarse.has(c));
  msgDrift = newIds.filter((id) => fCoarse.has(coarseOf(id)));
}

const delta = count - BASELINE;

if (delta > 0) {
  console.error(`\n❌ 当前 ${count} / 基线 ${BASELINE}（新增 ${delta} 条请修掉；基线只许降）`);
  console.error(`   涉及 ${fileCount} 个文件。前 ${Math.min(SHOW_LIMIT_DEFAULT, errorLines.length)} 条：`);
  for (const line of errorLines.slice(0, listAll ? errorLines.length : SHOW_LIMIT_DEFAULT)) {
    console.error(`   ${line}`);
  }
  if (!listAll && errorLines.length > SHOW_LIMIT_DEFAULT) {
    console.error(`   … 其余 ${errorLines.length - SHOW_LIMIT_DEFAULT} 条加 --list 看全`);
  }
  if (newIds && structuralNew && structuralNew.length > 0) {
    const detail = ids.filter((id) => structuralNew.includes(coarseOf(id)));
    console.error(`   集合维：**结构层新增 ${structuralNew.length} 条**／消失 ${goneIds.length} 条。新增名单：`);
    for (const id of detail.slice(0, listAll ? detail.length : SHOW_LIMIT_DEFAULT)) {
      console.error(`   + ${id.replace(/\t/g, '  |  ')}`);
    }
    if (!listAll && detail.length > SHOW_LIMIT_DEFAULT) {
      console.error(`   … 其余 ${detail.length - SHOW_LIMIT_DEFAULT} 条加 --list 看全`);
    }
  } else if (msgDrift && msgDrift.length > 0) {
    console.error(`   集合维：结构层新增 0 条；**消息漂移 ${msgDrift.length} 条**（清单该同步）。`);
  }
  process.exit(1);
}

// ── 集合维的**决定性**检查：计数持平也可能「内容全换」（修旧增新）─────────────
if (structuralNew && structuralNew.length > 0) {
  console.error(
    `\n❌ 计数持平（${count} / 基线 ${BASELINE}），但**结构层集合变了**：新增 ${structuralNew.length} 条、消失 ${goneIds.length} 条。`,
  );
  console.error('   ⇒ 这就是「修旧增新」的静默放行形态：**计数守恒 ≠ 集合守恒**。新增名单：');
  const detail = ids.filter((id) => structuralNew.includes(coarseOf(id)));
  for (const id of detail.slice(0, listAll ? detail.length : SHOW_LIMIT_DEFAULT)) {
    console.error(`   + ${id.replace(/\t/g, '  |  ')}`);
  }
  if (!listAll && detail.length > SHOW_LIMIT_DEFAULT) {
    console.error(`   … 其余 ${detail.length - SHOW_LIMIT_DEFAULT} 条加 --list 看全`);
  }
  console.error('   ⇒ 修掉新增的那批；若确认是可接受的新债，须在同一 commit 里写明理由后重写清单。');
  process.exit(1);
}

// 只有消息漂移（同 路径+码+序号，文案不同）⇒ 默认**不判红**，但要列出来（清单该同步了）
if (msgDrift && msgDrift.length > 0) {
  const mark = strictDrift ? '❌' : 'ℹ️';
  const how = strictDrift
    ? '**按 --strict-drift 判红**（它会盖住「同 文件+码+序号」的修旧增新）'
    : '默认不判红（加 --strict-drift 可判红）';
  console.log(`${mark} 消息漂移 ${msgDrift.length} 条（同 路径+码+序号，仅文案不同）—— ${how}：`);
  for (const id of msgDrift.slice(0, listAll ? msgDrift.length : SHOW_LIMIT_DEFAULT)) {
    console.log(`   ~ ${id.replace(/\t/g, '  |  ').slice(0, 200)}`);
  }
  console.log('   ⇒ 同步清单：--write-baseline（纯漂移允许写入）');
  if (strictDrift) process.exit(1);
}

if (delta === 0) {
  console.log(
    `✅ 当前 ${count} / 基线 ${BASELINE}（持平：既有债未增未减，涉及 ${fileCount} 个文件）` +
      (structuralNew
        ? `｜集合维：结构层新增 0 条／消失 ${goneIds.length} 条｜消息漂移 ${msgDrift.length} 条`
        : ''),
  );
  process.exit(0);
}

console.log(
  `✅ 当前 ${count} / 基线 ${BASELINE}（已减到 ${count}，可下调基线：把本文件 BASELINE 改成 ${count}）` +
    (structuralNew
      ? `｜集合维：结构层新增 0 条／消失 ${goneIds.length} 条（记得 --write-baseline 同步清单）`
      : ''),
);
process.exit(0);
