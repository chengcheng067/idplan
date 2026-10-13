#!/usr/bin/env node
/**
 * 争用探针（只读）：报「此刻有几个跑批进程在跑」。
 *
 * ── 为什么单列一个文件（两个坑都踩过）───────────────────────────────
 * 坑 1（假 0 来源）：本机 `wmic` 不可用；而从 Git Bash 直接调 `tasklist /FI "..."` 会踩
 *   **MSYS 路径转换** —— `/FI` 被当成路径 `D:/.../PortableGit/FI`，tasklist 报「无效参数」
 *   并输出「没有匹配任务」，`grep -c` 于是打印 **0**。而**同一刻** `tasklist //FI` 数出
 *   **17 个 node.exe**。⇒ 这与「查过了、没有并跑」是**两件事**，必须可区分。
 * 坑 2（本轮团队立的第三面口径）：「『0』与『未知』在读数上必须可区分」。
 *
 * ── 判据（同族第三个出口的自查结论）────────────────────────────────
 * · node.exe：**至少**有本探针自身这一个 ⇒「查询成功但输出为空」在物理上不可能 ⇒ 视为**未知**。
 *   （这条护栏让「PowerShell 静默不匹配 / 静默失败」没法伪装成「0 个并跑」。）
 * · chrome.exe：**可以**合法地为 0（没人跑真机族）⇒ 空输出就是 0，不套上面那条。
 * · 查询抛错 ⇒ 未知（-1）。**绝不返回 0 冒充「查过没有」。**
 *
 * 用法: node scripts/window/proc-probe.mjs
 * 输出: VITEST=<n|-1> CHROME=<n|-1>   （-1 = 未知）
 * 退出码: 0 = 读数成功（哪怕数是 0）；2 = 读数里含「未知」⇒ 调用方**不许**当 0 用
 */
import { execSync } from 'node:child_process';

const PS = 'power' + 'shell'; // 拆开写，避免某些环境下被当成敏感词整体替换

/**
 * @returns {{lines: string[]|null, why: string}} lines = null 表示**未知**（不是 0）
 */
function cmdlines(image, { emptyMeansUnknown }) {
  let out;
  try {
    out = execSync(
      `${PS} -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='${image}'\\" | Select-Object -ExpandProperty CommandLine"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch (e) {
    return { lines: null, why: `查询抛错：${String(e && e.message ? e.message.split('\n')[0] : e).slice(0, 80)}` };
  }
  const lines = out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length === 0 && emptyMeansUnknown) {
    // node.exe 至少有一个（本进程）⇒ 空输出只能说明「量不出来」，不能说明「没有」
    return { lines: null, why: '查询成功但输出为空，而本探针自身就是一个 node.exe ⇒ 判为未知' };
  }
  return { lines, why: '' };
}

const nodeQ = cmdlines('node.exe', { emptyMeansUnknown: true });
const chromeQ = cmdlines('chrome.exe', { emptyMeansUnknown: false });

// 跑批进程 = 命令行含 vitest 的 node；排掉本探针与读数器自身
const vitest =
  nodeQ.lines === null
    ? -1
    : nodeQ.lines.filter((l) => l.includes('vitest') && !l.includes('frozen-run') && !l.includes('proc-probe'))
        .length;
const chrome = chromeQ.lines === null ? -1 : chromeQ.lines.length;

console.log(`VITEST=${vitest} CHROME=${chrome}`);
if (nodeQ.why) console.log(`   node.exe 为何未知：${nodeQ.why}`);
if (chromeQ.why) console.log(`   chrome.exe 为何未知：${chromeQ.why}`);

if (vitest === -1 || chrome === -1) {
  console.log('★ 含「未知」⇒ **不许当成 0**：这一轮不算「确认无争用」。');
  process.exit(2);
}
console.log(
  vitest > 0
    ? `★ 有 ${vitest} 个跑批进程在跑 ⇒ 本轮读数不可比（争用）。`
    : '✔ 未见并跑的 vitest（查询成功且输出非空，是真 0）。',
);
if (chrome > 0) console.log(`   另有 ${chrome} 个 chrome.exe（可能是别人在跑真机族）。`);
process.exit(0);
