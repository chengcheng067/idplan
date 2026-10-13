#!/usr/bin/env node
/**
 * 判别力自检：把「注入变异 → 测试**必须变红**」固化成一条可重复执行的命令（opt-in）。
 *
 * ── 为什么需要它 ──
 * 「测试通过」只说明它现在不报错，不说明它**能报错**。一条断言完全可能恒真
 * （例如 `className.toContain('rounded-xl')` —— `rounded-2xl` 同样含该子串），
 * 于是缺陷从它眼皮底下走过去而它永远绿。要证明一条断言有判别力，唯一的办法是
 * **注入它本该抓住的那个缺陷，看它红不红**。这件事此前靠人手工改源码完成：
 * 手工改 → 重建 → 跑 → 改回，四步里有三步可能漏（忘改回、忘重建、改错文件）。
 *
 * ── 为什么**不进**发版关卡（team-lead 已裁定）──
 * `verify-package.cjs` 这类关卡脚本必须**确定性 + 非破坏性**。一个会「改源码 + 重建」
 * 的步骤塞进关卡，等于把关卡自身变成污染源：它跑失败一次就可能在源码树里留下变异体，
 * 而关卡失败时恰恰是最不会有人回头检查工作树的时候。故本脚本独立成 opt-in，
 * 由人显式触发、且只在干净工作树上跑。
 *
 * ── 起因（真实事故，别删这段）──
 * 2026-09-11 17:04 有人在**共享工作树**里手工做变异测试（AgentTaskCard 的 `bg-paper`
 * 改成 `glass-light`）并按变异体重建了产物。QA 正好在这个窗口里跑全量，
 * 撞上「build-dist 比源码新、测的却是变异版界面」的中间态，白白排查了一轮。
 * 共享工作树上的手工变异窗口 = 队友的随机崩溃源。本脚本的约束 ①②③ 全部针对它。
 *
 * ── 三条硬约束（由 team-lead 指定，本脚本逐条落实）──
 *   ① 开工前工作树必须干净（`git status --porcelain` 为空）。脏则**拒绝运行**并列出脏文件，
 *      不提供「继续」选项 —— 脏树上做变异，还原后无法区分「我的还原」与「别人的在途改动」。
 *   ② `try/finally` + 信号处理：任何退出路径（正常 / 断言不符 / 抛异常 / Ctrl-C / SIGTERM）
 *      都必须还原源码。还原走**内存快照回写**，不依赖 git 状态，故即使 git 中途被改动也能还原。
 *   ③ 收尾断言 `git diff --quiet`：还原失败就**大声报错**并以非零码退出，绝不静默收场。
 *      （2026-10-14 起：这一条**改为调用共用工具** `scripts/lib/restore-guard.mjs` —— 它比裸
 *       `git diff --quiet` 多两件事：能区分「我造成的改动」与「起跑前就有的脏条目」，且**指名文件**。
 *       两处退出路径（正常收尾 / 信号中断）都受它管。手工变异会话可直接用它的 CLI。）
 *
 * ⚠️ **本脚本会重建 `build-dist`（共享资源，会影响其他线的浏览器跑批）**
 *   每一次变异都会「改源码 → 重建产物 → 跑探测用例 → 还原」，收尾还会再重建一次，
 *   目的是不留下一棵「产物比源码新」的 stale 树（那种树会让后续真浏览器 spec **静默 skip**，
 *   而 skip ≠ 通过）。⇒ 跑之前请知道：**别的线正在跑的真浏览器批会被这棵产物影响**；
 *   请挑没有并发跑批的窗口，或接受「你重建后别人的读数要重取」。
 *   （这条提示是 team-lead 2026-10-14 要求的「共享资源副作用要**可见**、不要**消失**」的具体落点；
 *    对应地，我提过的 `--no-build` 开关**未获批** —— 那会让 stale 树的坑回来。）
 *   跑完自查：`find src electron -type f \( -name '*.ts' -o -name '*.tsx' \) -newer build-dist/index.html | wc -l`
 *   应为 0。
 *
 * ── ★ 变异纪律的两条硬约束（2026-10-14 增补；本文件是这两条的**唯一出处**，别处不要再抄）──
 *
 *   **第 0 段 = 「注入确实生效」**（原先只写「① 变异确实施加」，太松）
 *     实测教训：一次手工变异「注入执行了，但语义没发生」——点的是静默空操作（控件不在 DOM 里），
 *     于是测试**返回绿**，而它**长得和「假设被证伪」一模一样**。若不拦住，就会把「绿来自根本没施加」
 *     当成「施加了变异却仍然绿」报上去，那是「绿的来源」里最阴的一种。
 *     ⇒ 要求：**变异体必须自带前置断言** —— 注入后先断言「我要造成的那个状态」确实成立
 *       （例如读回被改的那一行、或断一个只有变异态才会出现的中间量），不成立就**红在变异自检上**。
 *       **不能靠外部读回**（外部读回等于让验证者自己举证，而它正是刚才漏掉的那一环）。
 *     ⇒ 记法：**「构造不出来的变异」（第 0 段未通过）与「被证伪的假设」必须分开记**；
 *       前者**不作证据**，也不得以「施加了变异但仍然绿」的形式写进结论。
 *
 *   **会被覆盖的路径上的产物不是证据**
 *     实测教训（同一天两次）：`qa-scratch/v07-stageD/10~12-*.png` 被后续运行**静默覆盖**（事后核不到）；
 *     `/tmp/mut1.log` / `/tmp/mut2b.log` / `/tmp/shell-fix*.log` 全是**固定名**，任何一次重跑都会覆盖
 *     ⇒ 当初引用的「原样输出」**只在当时可核**，事后无法复核。
 *     ⇒ **凡要当时间锚点用的产物，必须落在 append-only 或轮次/标签命名的路径上**
 *       （本仓的对应做法见 `docs/release-checklist.md` §1.1 的「分轮次落盘」，那条讲**读数**，本条讲
 *       **截图/中间产物**，是同一个坑的两面）；**固定路径上的产物只能当「当前状态」，不能当「历史证据」**。
 *
 * 额外做一件事（超出要求，但正对这次事故）：全部跑完后**重建一次产物**，
 * 让 build-dist 回到与源码一致的状态。否则脚本自己就会留下一个「产物比源码新」的
 * stale 树 —— 正是 QA 撞上的那个坑。并校验产物新鲜度，不新鲜则告警。
 *
 * ── 用法 ──
 *   node scripts/verify-test-discriminative.mjs                  # 跑全部变异（要求干净树）
 *   node scripts/verify-test-discriminative.mjs --list           # 只列出变异清单
 *   node scripts/verify-test-discriminative.mjs --check-anchors  # 只校验锚点是否仍然唯一（不改文件）
 *   node scripts/verify-test-discriminative.mjs --only=a4-radius # 只跑其中一条
 *   node scripts/verify-test-discriminative.mjs --dry-run        # 打印将要做什么，不动文件
 *   node scripts/verify-test-discriminative.mjs --keep-going     # 一条不符预期也继续跑其余
 *   node scripts/verify-test-discriminative.mjs --root=<dir>     # 对另一棵树（隔离工作树/干净克隆）做
 *
 * ── 推荐姿势：在**隔离工作树**里做，别在队友共用的树上做 ──
 * 本仓库是多人共享一棵工作树（agent 团队并行改同一目录）。在这种树上做变异，
 * 35~90 秒的变异窗口会直接变成队友的随机崩溃源。正确做法是给自己开一棵只读 HEAD 的隔离树：
 *
 *   git worktree add --detach ../disc-probe HEAD
 *   # 让隔离树能用依赖（Windows 用 junction，无需管理员）
 *   node -e "require('fs').symlinkSync(require('path').resolve('node_modules'),require('path').resolve('../disc-probe/node_modules'),'junction')"
 *   node scripts/verify-test-discriminative.mjs --root=../disc-probe
 *
 * 隔离树里怎么改都不影响任何人；跑完 `git worktree remove --force ../disc-probe` 即可。
 *
 * 收尾会删掉隔离树吗？不会 —— 删目录是不可逆操作，本脚本不替你做这种决定，只提示命令。
 *
 * ── 退出码 ──
 *   0 = 全部「变异 → 红在正确断言 → 还原 → 树干净」通过
 *   1 = 有任一条不符预期（没变红 / 红错地方 / 还原失败）
 *   2 = 前置拒绝（工作树脏 / 锚点失效 / 用法错误）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// 共用「还原基线守卫」：起跑记基线 → 收尾复核 → 有差异即非零退出。
// 本脚本的约束 ③ 由它兑现（比裸 `git diff --quiet` 多两件事：区分「我造成的」与「起跑就有的」脏条目、
// 且能**指名到文件**）。手工变异会话也能直接用它的 CLI —— 见该文件头注释。
import { beginRestoreGuard, endRestoreGuard } from './lib/restore-guard.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/* ============================================================================================
 * 变异清单
 *
 * 每条 = 一个「源码里的单点改动」+ 一条「本应因此变红的断言」。
 * `find` 必须在目标文件里**恰好出现一次**（--check-anchors 会守着这一点）：
 * 出现 0 次说明代码重构后锚点漂了、出现多次说明会改错地方 —— 两种都必须当场拒绝，
 * 否则脚本会「改了个寂寞」然后报告「测试没变红」，把锚点失效误报成断言失效。
 *
 * `expectMarkers` 是「红在正确断言上」的判据，**优先用 ASCII 标记**：
 * 子进程输出的中文编码受 Windows 代码页影响，可能以 GBK 或 UTF-8 落盘，
 * 混进中文会让判据时灵时不灵（详见 containsMarker 的双解码兜底）。
 * ============================================================================================ */
const MUTATIONS = [
  {
    id: 'human-card-material',
    title: '人话卡材质：bg-paper → glass-light（本次真实发生过的那个回归，语义正好相反）',
    file: 'src/components/agent/AgentTaskCard.tsx',
    find: "'flex w-full items-center gap-3 rounded-2xl border bg-paper p-3",
    replace: "'flex w-full items-center gap-3 rounded-2xl border glass-light p-3",
    /*
     * ⚠️ 记账（未修，等干净窗口）：本用例的「红落在哪条断言上」取决于 B-12 里三条断言的**先后** ——
     *    `notPaper`（当前第 1 条）/ `looksSunken`（bg === sunken）/ `glassCards`（cls 含 glass-light）
     *    都会被这个变异打中，而 vitest 在**第一条失败处抛** ⇒ 现在稳定红在 `notPaper`，与
     *    `expectAssertion` 一致。若有人调换顺序，红会落到别条 ⇒ 本脚本会报「红在了错误断言上」
     *    （**响的，但归因错**）。⇒ 动 B-12 的断言顺序之前先看这一段。
     *    备选修法：把 expectMarkers 放宽成「三条中任一」（三条都是同一变异的后果，不损失特异性，
     *    但去掉顺序依赖）。它属**变异清单本体**，只能在**干净工作树**上验证 ⇒ 与「完整变异跑一次」
     *    合并到出包冻结窗口做，别在脏树上顺手改。
     */
    probe: {
      spec: 'tests/v07-board-acceptance.spec.ts',
      test: 'B-12',
      // notPaper 的失败信息里带的是卡片的真实计算底色；glass-light = sunken = rgb(241,245,249)
      expectMarkers: ['rgb(241, 245, 249)', '人话行卡必须走 paper 浮起面'],
      expectAssertion: 'notPaper',
    },
  },
  {
    id: 'human-card-invisible',
    title: '人话卡可见性：加 hidden（材质正常但盒子零尺寸）',
    file: 'src/components/agent/AgentTaskCard.tsx',
    find: "'flex w-full items-center gap-3 rounded-2xl border bg-paper p-3",
    replace: "'hidden flex w-full items-center gap-3 rounded-2xl border bg-paper p-3",
    probe: {
      spec: 'tests/v07-board-acceptance.spec.ts',
      test: 'B-12',
      // 只有 badBoxes 的失败信息会打出 `visible=false`（notPaper 打的是「→ 底色 ...」）
      expectMarkers: ['visible=false', '锚点必须落在有实际宽高且可见的卡片上'],
      expectAssertion: 'badBoxes',
    },
  },
  {
    id: 'a4-radius',
    title: 'A4 lg 档圆角：rounded-md(=12) → rounded-xl(=16，本仓库刻度重映射后的陷阱)',
    file: 'src/components/ui/SegmentedControl.tsx',
    find: "'h-[28px] min-w-[84px] rounded-md px-0'",
    replace: "'h-[28px] min-w-[84px] rounded-xl px-0'",
    probe: {
      spec: 'tests/ui-batch-a-geometry.spec.ts',
      test: 'A4-G1',
      // vitest 的断言尾巴是 ASCII：expected '16px' to be '12px'
      expectMarkers: ["to be '12px'", '画板 02 要求 12px'],
      expectAssertion: 'A4-G1 段圆角 === 12px',
    },
  },
];

/* ============================================================================================
 * 命令行
 * ============================================================================================ */
const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const onlyArg = argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice('--only='.length) : null;

const MODE_LIST = hasFlag('--list');
const MODE_CHECK_ANCHORS = hasFlag('--check-anchors');
const MODE_DRY_RUN = hasFlag('--dry-run');
const KEEP_GOING = hasFlag('--keep-going');
const MODE_HELP = hasFlag('--help') || hasFlag('-h');

/** 只有「真的会改文件」的模式才需要干净工作树 */
const WILL_MUTATE = !MODE_LIST && !MODE_CHECK_ANCHORS && !MODE_DRY_RUN && !MODE_HELP;

/* ============================================================================================
 * 被检项目根
 *
 * 默认 = 本脚本所在仓库；`--root=<dir>` 可指向另一棵树（隔离工作树 / 干净克隆）。
 * 这不是可有可无的便利项，而是本次事故的正解：在队友共用的树上做变异 = 制造随机崩溃源。
 * 隔离树里怎么改都影响不到任何人（详见文件头「推荐姿势」）。
 * ============================================================================================ */
const rootArg = (argv.find((a) => a.startsWith('--root=')) || '').slice('--root='.length);
const ROOT = rootArg ? resolve(process.cwd(), rootArg) : resolve(SCRIPT_DIR, '..');
/** qa-scratch/ 已 gitignore，证据落在这里不会污染工作树 */
const EVIDENCE_DIR = resolve(ROOT, 'qa-scratch', 'discriminative');

/* ============================================================================================
 * 小工具
 * ============================================================================================ */

/** 以 buffer 收子进程输出：避免 Node 在 Windows 上按控制台代码页把中文二次编码 */
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: 'buffer', shell: true, ...opts });
}

/**
 * 解码子进程输出。
 *
 * Windows 上子进程写出的中文可能是 UTF-8，也可能被按 GBK 落盘（取决于它探测到的代码页），
 * 此前 redirect 到文件时实测出现过后一种。故同时给出两种解码，判据在两者里任一命中即算命中——
 * 这比「赌一种编码」稳，也比把判据全换成 ASCII 更宽容（保留中文标记作为备选）。
 */
function decode(buf) {
  if (!buf || buf.length === 0) return '';
  const utf8 = buf.toString('utf8');
  let gbk = '';
  try {
    gbk = new TextDecoder('gbk').decode(buf);
  } catch {
    gbk = '';
  }
  return gbk && gbk !== utf8 ? `${utf8}\n${gbk}` : utf8;
}

function containsMarker(buf, markers) {
  const hay = decode(buf);
  return markers.some((m) => hay.includes(m));
}

function porcelain() {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git status 执行失败：${r.stderr || r.error?.message || '未知原因'}`);
  }
  return String(r.stdout || '')
    .split('\n')
    .map((s) => s.replace(/\s+$/, ''))
    .filter((s) => s.length > 0);
}

function gitDiffQuiet() {
  // `git diff --quiet`：无差异退 0，有差异退 1
  return spawnSync('git', ['diff', '--quiet'], { cwd: ROOT }).status === 0;
}

function echo(...args) {
  console.log(...args);
}

/* ============================================================================================
 * 还原机制（约束 ②）
 *
 * 用**内存快照回写**而不是 `git checkout --`：
 *   · 不依赖 git 当时的状态（万一有别人在动 index/工作树，git checkout 会误伤）；
 *   · 快照在改之前取，改回后字节级一致，`git diff --quiet` 必然通过。
 * ============================================================================================ */

/** @type {{ abs: string; original: string; label: string } | null} */
let pendingRestore = null;

/** 立刻还原当前变异体。返回是否成功。 */
function restoreNow(reason) {
  if (!pendingRestore) return true;
  const { abs, original, label } = pendingRestore;
  try {
    writeFileSync(abs, original);
    pendingRestore = null;
    echo(`[restore] 已还原 ${label}（${reason}）`);
    return true;
  } catch (err) {
    // 这里失败是**严重**的：源码树里留了变异体。必须大声、且不吞掉。
    console.error(`!! [restore] 还原失败（${reason}）：${abs} —— ${err.message}`);
    console.error(`!! 请立刻手工把该文件恢复原状（可用 git checkout -- "${label}"）。`);
    return false;
  }
}

/**
 * 本轮**还原基线**（`beginRestoreGuard` 的产物）。`assertTreeClean()` 以它为准做收尾复核。
 * 为什么不用裸 `git diff --quiet`：那个判据只能说明「树不干净」，说不出**是谁的**改动
 * （2026-10-14 的事故就是「变异忘了还原」以「树脏」的形态留下，而当时没人有基线可比）。
 */
let restoreGuardState = null;

/** 约束 ③：收尾断言「本轮改过的文件都还原了」——判据来自共用工具 `restore-guard`。 */
function assertTreeClean(stageLabel) {
  const quiet = gitDiffQuiet();
  if (restoreGuardState) {
    const r = endRestoreGuard(restoreGuardState);
    if (!r.ok) {
      console.error(`!! [clean] ${stageLabel}：还原基线复核**未通过**（详见上方红字：已指名文件/脏条目）。`);
      console.error('!! 这意味着变异体没还原干净（或事后又被人改动过），本次结果不可信。');
      return false;
    }
    if (!quiet) {
      // 基线通过但 `git diff --quiet` 失败：说明差异**起跑前就有**（本脚本正常情况下会被约束 ① 拦住）
      console.error(`!! [clean] ${stageLabel}：git diff --quiet 失败，但相对基线无新增改动 —— 差异来自起跑前。`);
      return false;
    }
    console.log(`[clean] ${stageLabel}：还原基线复核通过（git diff --quiet 亦通过）。`);
    return true;
  }
  // 没有基线（例如未进入主流程的模式）：退回裸判据
  if (quiet) {
    console.log(`[clean] ${stageLabel}：git diff --quiet 通过，工作树无差异。`);
    return true;
  }
  console.error(`!! [clean] ${stageLabel}：git diff --quiet 失败 —— 工作树里仍有差异！`);
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  console.error(String(r.stdout || '').replace(/\s+$/, ''));
  console.error('!! 这意味着变异体没还原干净（或本就在脏树上跑的），结果不可信。');
  return false;
}

/**
 * 重建产物，让 build-dist 回到与源码一致。
 *
 * 这一步是「本次事故」的直接补丁：变异跑完后若只还原源码不重建，产物就比源码新，
 * 于是下一个跑全量的人拿到的是**变异版产物 + 干净源码**的错配（或反之）。
 */
function rebuildProduct(context) {
  echo(`[build] 重建产物（${context}）…`);
  const r = run('npm', ['run', 'build']);
  const ok = r.status === 0;
  if (!ok) {
    console.error(`!! [build] 重建失败（exit=${r.status}）：`);
    console.error(decode(r.stdout).slice(-4000));
  }
  return ok;
}

/**
 * 产物新鲜度校验：build-dist/index.html 不得早于任一构建输入。
 * 与 tests/ui-batch-a-geometry.spec.ts 的 staleInputs() 同口径（有意重复一份独立实现：
 * 脚本不该 import 测试文件，那是把「被测物」和「校验器」耦在一起）。
 */
const BUILD_INPUT_FILES = ['index.html', 'vite.config.ts', 'tailwind.config.ts', 'postcss.config.js'];

function collectSourceFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...collectSourceFiles(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function staleInputs() {
  const distIndex = resolve(ROOT, 'build-dist', 'index.html');
  if (!existsSync(distIndex)) return ['(build-dist/index.html 不存在)'];
  const distMs = statSync(distIndex).mtimeMs;
  const candidates = [
    ...collectSourceFiles(resolve(ROOT, 'src')),
    ...collectSourceFiles(resolve(ROOT, 'electron')),
    ...BUILD_INPUT_FILES.map((f) => resolve(ROOT, f)).filter((f) => existsSync(f)),
  ];
  return candidates.filter((f) => statSync(f).mtimeMs > distMs).slice(0, 5);
}

/* ============================================================================================
 * 前置校验 ②：探针测试名**还能命中至少一个用例**吗
 *
 * ── 为什么必须有这一层（真实失败模式，不是假想）──
 * 一条变异要真的被验证，除锚点之外还依赖**探针命令** `vitest run <spec> -t <testName>`。
 * 若哪天测试名被改名/被删（本仓这轮就有一批重命名与拆组），探针会**跑 0 个用例**，
 * 而 vitest 在「没有任何用例匹配」时**退出码是 0** ⇒ 本脚本读成「没有变红」⇒
 * 报「**断言失效**」。⇒ **响是响的，但归因完全错**：人会去查断言，而真因在锚点名单里的
 * `probe.test`。这与「锚点漂移被误报成断言失效」（本文件 :74-76 已写过）是同一类错误，
 * 故必须与锚点校验**同层、同一次**报出来。
 *
 * ── 判据口径（与 vitest 实际行为对齐）──
 * vitest 的 `-t/--testNamePattern` 拿**测试全名**（describe 链 + it 标题拼接）做**正则**
 * 匹配。故「能命中」⟺ 该 token 出现在某个 `describe(...)` 标题里，或某个
 * `it(...)/test(...)` 标题里。本函数按此口径**扫源码**（不跑 vitest，毫秒级）。
 *   ⚠️ 已知简化（写出来免得被当成强判据）：不重建 describe 的**层级归属**，token 出现在
 *      任一句 describe 里即算命中 ⇒ 它只能证明「**至少有一个用例会被选中**」，
 *      不能证明「恰好是那一个」。对「跑 0 个用例」这个失败模式足够，也正是它存在的唯一目的。
 * ============================================================================================ */
function probeTestResolves(probe) {
  const abs = resolve(ROOT, probe.spec);
  if (!existsSync(abs)) return { ok: false, why: `探测 spec 不存在：${probe.spec}` };
  const src = readFileSync(abs, 'utf8');
  const titles = [];
  const re = /\b(?:describe|it|test)(?:\.\w+)?\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let m;
  while ((m = re.exec(src)) !== null) titles.push(m[2]);
  const hits = titles.filter((t) => t.includes(probe.test));
  if (hits.length > 0) return { ok: true, hits: hits.length, total: titles.length };
  return {
    ok: false,
    why:
      `测试名 ${JSON.stringify(probe.test)} 在 ${probe.spec} 的 describe/it/test 标题里都找不到` +
      `（该文件共 ${titles.length} 个标题）⇒ 探针会跑 0 个用例、vitest 退出码 0 ⇒ ` +
      '本脚本会把它误读成「没变红 / 断言失效」。请更新该用例的 probe.test（真因在锚点名单，不在断言）。',
  };
}

/* ============================================================================================
 * 锚点校验：`find` 必须在目标文件里恰好出现一次
 * ============================================================================================ */
function checkAnchors() {
  echo('=== 锚点校验（find 必须在目标文件中恰好出现一次）===');
  let bad = 0;
  for (const m of MUTATIONS) {
    const abs = resolve(ROOT, m.file);
    if (!existsSync(abs)) {
      console.error(`  ✗ [${m.id}] 目标文件不存在：${m.file}`);
      bad += 1;
      continue;
    }
    const src = readFileSync(abs, 'utf8');
    const count = src.split(m.find).length - 1;
    if (count !== 1) {
      console.error(`  ✗ [${m.id}] 锚点在 ${m.file} 中出现 ${count} 次（必须恰好 1 次）：`);
      console.error(`        find = ${JSON.stringify(m.find)}`);
      if (count === 0) console.error('        → 代码重构后锚点已漂移，请更新本脚本的 find。');
      else console.error('        → 会改到多处，请把 find 加长到唯一。');
      bad += 1;
      continue;
    }
    if (m.find === m.replace) {
      console.error(`  ✗ [${m.id}] find 与 replace 相同，等于没变异。`);
      bad += 1;
      continue;
    }
    const probeOk = probeTestResolves(m.probe);
    if (!probeOk.ok) {
      console.error(`  ✗ [${m.id}] ${probeOk.why}`);
      bad += 1;
      continue;
    }
    echo(
      `  ✓ [${m.id}] 锚点唯一；探测 ${m.probe.spec} -t ${m.probe.test} 可命中` +
        `（${probeOk.hits}/${probeOk.total} 个标题）；期望红在 ${m.probe.expectAssertion}`,
    );
  }

  /*
   * ── 自证：本前置校验**自己**必须能被证明会 ✗ ──
   * 「只写一条永远绿的检查不算做完」：合成一个**必然不存在**的测试名（同一个真实 spec），
   * 它必须被拒。若它反而报「可命中」，说明这条检查恒真 = 假闸门 ⇒ 当场报错。
   * 每次跑 --check-anchors 都会打印这一行，让「检查是活的」这件事**每次都被看见**，
   * 而不是只在某次人工变异里被证明过一次。
   */
  const synthetic = { spec: MUTATIONS[0].probe.spec, test: `__不存在的测试名__${process.pid}__` };
  const syntheticR = probeTestResolves(synthetic);
  if (syntheticR.ok) {
    console.error(
      `  ✗ [自证] 前置校验恒真：给一个必然不存在的测试名却报「可命中」（${JSON.stringify(synthetic.test)}）`,
    );
    bad += 1;
  } else {
    echo(
      `  ✓ [自证] 前置校验有判别力：不存在的测试名被拒（${JSON.stringify(synthetic.test)} → ✗）`,
    );
  }
  return bad === 0;
}

/* ============================================================================================
 * 单条变异的执行
 * ============================================================================================ */
function runOne(mutation, index, total) {
  const abs = resolve(ROOT, mutation.file);
  echo('');
  echo('─'.repeat(96));
  echo(`[${index + 1}/${total}] ${mutation.id} · ${mutation.title}`);
  echo(`    改文件：${mutation.file}`);
  echo(`    探测  ：${mutation.probe.spec} -t ${mutation.probe.test}`);
  echo('─'.repeat(96));

  const original = readFileSync(abs, 'utf8');
  const mutated = original.split(mutation.find).join(mutation.replace);
  const result = {
    id: mutation.id,
    ok: false,
    reason: '',
    buildOk: false,
    wentRed: false,
    redOnRightAssertion: false,
  };

  try {
    // 约束 ②：先登记还原义务，再动文件。登记与写入之间不留空窗。
    pendingRestore = { abs, original, label: mutation.file };
    writeFileSync(abs, mutated);

    // 变异体必须能编译；编译失败会让 vitest 直接报错，那不是「红在断言上」
    if (!rebuildProduct(`变异体 ${mutation.id}`)) {
      result.reason = '变异体构建失败（tsc/vite 报错）—— 这条变异不成立，请换一个不破坏编译的单点改动';
      return result;
    }
    result.buildOk = true;

    // 跑探测用例。期望 **失败**（非零退出）
    const r = run('npx', ['vitest', 'run', mutation.probe.spec, '-t', mutation.probe.test], {
      // vitest 在 CI 下更稳定；并强制 UTF-8 输出，减少代码页干扰
      env: { ...process.env, CI: '1' },
    });
    const out = decode(r.stdout) + decode(r.stderr);
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(EVIDENCE_DIR, `${mutation.id}.log`), out, 'utf8');

    const failedCount = Number((out.match(/Tests\s+(\d+)\s+failed/i) || [])[1] || 0);
    const skippedCount = Number((out.match(/Tests\s+(\d+)\s+skipped/i) || [])[1] || 0);
    const passedCount = Number((out.match(/Tests\s+(\d+)\s+passed/i) || [])[1] || 0);

    result.wentRed = r.status !== 0 || failedCount > 0;

    if (skippedCount > 0 && passedCount === 0 && failedCount === 0) {
      result.reason =
        '探测用例被 **skip** 了（未真正执行）。最常见原因：产物被判过期（stale-product 守卫）。' +
        '本脚本已按变异体重建过，若仍 skip 请检查 spec 的 CAN_RUN_FRESH / 前置检查用例输出。';
      return result;
    }

    if (!result.wentRed) {
      result.reason =
        '变异后测试**仍然绿** —— 说明这条断言没有判别力（或锚点改错了地方）。' +
        `输出摘要：${(out.match(/Tests\s+\d+\s+(?:passed|failed|skipped)[^\n]*/g) || []).join(' | ')}`;
      return result;
    }

    // 不只看「红了」，还要看「红在对的那条断言上」——红错地方等于没测到
    result.redOnRightAssertion = containsMarker(r.stdout, mutation.probe.expectMarkers);
    if (!result.redOnRightAssertion) {
      result.reason =
        `测试确实失败了，但**不是**在期望的 ${mutation.probe.expectAssertion} 上（标记 ` +
        `${JSON.stringify(mutation.probe.expectMarkers)} 均未命中）。` +
        `先看证据日志：qa-scratch/discriminative/${mutation.id}.log`;
      return result;
    }

    result.ok = true;
    result.reason = `红在 ${mutation.probe.expectAssertion}（证据 qa-scratch/discriminative/${mutation.id}.log）`;
    return result;
  } catch (err) {
    result.reason = `执行中抛异常：${err?.message ?? String(err)}`;
    return result;
  } finally {
    // 约束 ② 的骨架：无论 return 还是 throw，都在这里还原
    const restored = restoreNow(`变异 ${mutation.id} 结束`);
    if (!restored && result.ok) {
      result.ok = false;
      result.reason = '还原失败！源码里可能残留变异体，见上方 git checkout 提示。';
    }
  }
}

/* ============================================================================================
 * 中断处理（约束 ② 在信号路径上的兑现）
 * ============================================================================================ */
let interrupted = false;
function installSignalHandlers() {
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      if (interrupted) process.exit(130); // 第二次 Ctrl-C：别拦着了
      interrupted = true;
      console.error(`\n!! 收到 ${sig}：正在还原源码并重建产物…`);
      const ok = restoreNow(`收到 ${sig}`);
      if (ok) rebuildProduct(`${sig} 中断后恢复产物一致性`);
      // ★ 中断路径也必须让「未还原」反映到退出码上（原先这里忽略返回值 ⇒ 变异残留会被吞掉）
      const clean = assertTreeClean('中断收尾');
      process.exit(ok && clean ? 130 : 1);
    });
  }
  // 兜底：任何未捕获的同步异常也会走到这里
  process.on('exit', () => {
    restoreNow('进程退出兜底');
  });
}

/* ============================================================================================
 * 主流程
 * ============================================================================================ */
function printHelp() {
  echo('用法：node scripts/verify-test-discriminative.mjs [选项]');
  echo('');
  echo('  --list            只列出变异清单');
  echo('  --check-anchors   校验锚点是否仍然唯一 + 探针测试名是否仍能命中（不改文件，可在脏树上跑）');
  echo('  --only=<id>       只跑指定 id');
  echo('  --root=<dir>      被检项目根（默认本脚本所在仓库；可指向隔离工作树）');
  echo('  --dry-run         打印将要做什么，不动文件');
  echo('  --keep-going      一条不符预期也继续跑其余');
  echo('  -h, --help        显示本帮助');
  echo('');
  echo('退出码：0 全通过 / 1 有不符合预期 / 2 前置拒绝（树脏、锚点失效、用法错误）');
}

function main() {
  if (MODE_HELP) {
    printHelp();
    return 0;
  }

  // 被检根必须存在、且确实是一棵 git 工作树 —— 否则后面的 git diff --quiet 会静默失去意义
  if (!existsSync(ROOT)) {
    console.error(`!! 被检根不存在：${ROOT}${rootArg ? `（来自 --root=${rootArg}）` : ''}`);
    return 2;
  }
  const inWorkTree = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (String(inWorkTree.stdout || '').trim() !== 'true') {
    console.error(`!! 被检根不是 git 工作树：${ROOT}`);
    console.error('   本脚本靠 `git diff --quiet` 保证「变异已还原」，非 git 目录下这个保证不成立。');
    return 2;
  }
  echo(`被检根：${ROOT}${rootArg ? '（--root 指定，隔离树）' : '（本仓库）'}`);
  if (WILL_MUTATE) {
    // ★ 共享资源副作用「可见」而不是「消失」（team-lead 2026-10-14；`--no-build` 未获批的替代）
    console.warn(
      '\u001b[33m⚠️  本脚本会**重建 build-dist**（共享资源，会影响其他线的真浏览器跑批）——请挑无并发跑批的窗口；' +
        '跑完请自查 `find src electron -name "*.ts*" -newer build-dist/index.html | wc -l` == 0。\u001b[0m',
    );
  }

  const selected = ONLY ? MUTATIONS.filter((m) => m.id === ONLY) : MUTATIONS;
  if (ONLY && selected.length === 0) {
    console.error(`!! 没有 id 为 "${ONLY}" 的变异。可用 id：${MUTATIONS.map((m) => m.id).join(', ')}`);
    return 2;
  }

  if (MODE_LIST) {
    echo(`共 ${MUTATIONS.length} 条变异：`);
    for (const m of MUTATIONS) {
      echo(`  · ${m.id}`);
      echo(`      ${m.title}`);
      echo(`      文件：${m.file}`);
      echo(`      探测：${m.probe.spec} -t ${m.probe.test} → 期望红在 ${m.probe.expectAssertion}`);
    }
    return 0;
  }

  // 锚点必须先过 —— 锚点错了，后面跑出来的「没变红」是假信号
  if (!checkAnchors()) {
    console.error('\n!! 锚点校验未通过，拒绝继续（否则会得到「测试没变红」的误导结论）。');
    return 2;
  }
  if (MODE_CHECK_ANCHORS) {
    echo('\n锚点全部有效。');
    return 0;
  }

  // 约束 ①：脏树拒绝运行
  const dirty = porcelain();
  if (dirty.length > 0 && WILL_MUTATE) {
    console.error('\n!! 前置拒绝：工作树不干净，本脚本拒绝运行。');
    console.error(`   本脚本会**改源码**。脏树上的变异，还原后无法区分「我的还原」与「别人的在途改动」，`);
    console.error('   而且变异窗口会坑到同时跑全量的队友（2026-09-11 17:04 的事故就是这么来的）。');
    console.error('');
    for (const line of dirty) console.error(`     ${line}`);
    console.error('');
    console.error('   请先提交或暂存以上改动（不要 stash 别人的在途工作），再重试。');
    console.error('   只校验锚点、不动文件的话，可以跑：--check-anchors');
    return 2;
  }

  // ★ 起跑：记「还原基线」（目标文件 blob 哈希 + 起跑时的脏条目快照）。
  //   收尾由 assertTreeClean() 复核（含中断路径）；差异会**指名文件**并以非零退出码结束。
  //   状态文件落 `qa-scratch/restore-guard/<label>-<时间戳>.json`（轮次命名；不落固定名）。
  if (WILL_MUTATE) {
    restoreGuardState = beginRestoreGuard({
      label: 'discriminative',
      paths: selected.map((m) => m.file),
      root: ROOT,
      stateDir: join(ROOT, 'qa-scratch', 'restore-guard'),
    });
    echo(`[guard] 已记还原基线（${selected.length} 个目标文件）：${restoreGuardState.statePath}`);
  }

  if (MODE_DRY_RUN) {
    echo(`\n[dry-run] 将依次执行 ${selected.length} 条变异（每条：改源码 → npm run build → 跑探测用例 → 还原）：`);    for (const m of selected) {
      echo(`  · ${m.id}：${m.file}`);
      echo(`      ${JSON.stringify(m.find)}`);
      echo(`   →  ${JSON.stringify(m.replace)}`);
    }
    echo('[dry-run] 未改动任何文件。');
    return 0;
  }

  installSignalHandlers();

  echo(`\n判别力自检开始：共 ${selected.length} 条变异。每条 ≈ 1 次构建（~10s）+ 1 次探测用例。`);
  const results = [];
  for (let i = 0; i < selected.length; i += 1) {
    const r = runOne(selected[i], i, selected.length);
    results.push(r);
    echo(`    结果：${r.ok ? '通过 ✓' : '不符合预期 ✗'} —— ${r.reason}`);
    if (!r.ok && !KEEP_GOING) {
      echo('    （--keep-going 可继续跑其余变异）');
      break;
    }
  }

  // 收尾：把产物重建回与源码一致，并校验新鲜度
  const rebuilt = rebuildProduct('全部变异跑完后的收尾');
  const stale = staleInputs();

  // 约束 ③
  const clean = assertTreeClean('收尾');

  echo('');
  echo('='.repeat(96));
  echo('判别力自检汇总');
  echo('='.repeat(96));
  for (const r of results) {
    echo(`  ${r.ok ? '✓' : '✗'} ${r.id}：${r.reason}`);
  }
  const ran = results.length;
  const okCount = results.filter((r) => r.ok).length;
  echo('');
  echo(`  通过 ${okCount}/${ran}（清单共 ${selected.length} 条，未跑 ${selected.length - ran} 条）`);
  echo(`  产物重建：${rebuilt ? '成功' : '失败'}`);
  echo(`  产物新鲜度：${stale.length === 0 ? '新鲜（无构建输入晚于产物）' : '过期 → ' + stale.join(', ')}`);
  echo(`  工作树：${clean ? '干净' : '**不干净**'}`);

  const allOk = okCount === selected.length && clean && rebuilt && stale.length === 0;
  if (allOk) {
    echo('\n结论：全部变异都在正确的断言上变红，且树已还原干净。判别力成立。');
    return 0;
  }
  echo('\n结论：**未通过**（见上）。在补齐之前，不要把这些断言当作「已验收」。');
  return 1;
}

let code = 1;
try {
  code = main();
} catch (err) {
  console.error(`!! 未捕获异常：${err?.stack ?? err}`);
  restoreNow('main 抛异常');
  code = 1;
}
process.exit(code);
