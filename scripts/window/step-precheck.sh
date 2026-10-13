#!/usr/bin/env bash
# 出包冻结窗口 · 起跑前置检查（只读；不跑任何 vitest、不动任何产物）
#
# 用法: bash scripts/window/step-precheck.sh [第几步]     # 2.5 / 5 / 5.5 / 5.6
#   第几步只影响最后那句「本步前提是否成立」。
#   建议把输出落**仓外**耐久路径（仓内 qa-scratch 一律在清理器的射程内）：
#     bash scripts/window/step-precheck.sh 2.5 \
#       | tee "$(cd "$(dirname "$0")/../.." && pwd)/../deliverables/release-1.0.0.0009-窗口证据/precheck-2.5-$(date +%H%M).txt"
#
# ★ 本文件的自查口径（team-lead 2026-10-14 立，同族第三个出口）：
#   **凡「计数 / 判空 / grep -c / 退出码」当结论的地方，都必须能区分
#     「数出来是零」与「根本量不出来」。** 量不出来一律打印 **未知**，
#   并让 §⑤ 判「前提不成立」—— 宁可不判，不许拿 0 冒充「查过没有问题」。
set -u
HERE=$(cd "$(dirname "$0")" && pwd)          # scripts/window
REPO=$(cd "$HERE/../.." && pwd)              # 仓库根
cd "$REPO" || exit 1
STEP="${1:-未指定}"

UNKNOWN="未知"

# 统一的「计数或未知」：run 成功才认它的数，失败一律未知
count_or_unknown() {
  local out rc
  out=$("$@" 2>/dev/null)
  rc=$?
  if [ "$rc" != "0" ]; then
    printf '%s' "$UNKNOWN"
    return
  fi
  printf '%s' "$(printf '%s\n' "$out" | grep -c . )"
}

echo "=================== 起跑前置检查（第 ${STEP} 步）==================="
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"

# ── ① 工作树 ───────────────────────────────────────────────────────────────
echo
echo "① 工作树"
DIRTY=$(git status --porcelain 2>/dev/null)
GIT_RC=$?
if [ "$GIT_RC" != "0" ]; then
  DIRTY_N="${UNKNOWN}"
  echo "   git status 失败（rc=${GIT_RC}）⇒ 条数 = ${UNKNOWN}（不是 0！）"
else
  DIRTY_N=$(printf '%s\n' "$DIRTY" | grep -c . )
  echo "   git status --porcelain 条数 = ${DIRTY_N}"
  if [ "${DIRTY_N}" != "0" ]; then
    echo "   ★ 工作树不干净 ⇒ 报告 team-lead，不要自行清理（可能是别人在飞的活）。"
    printf '%s\n' "$DIRTY" | sed 's/^/     /'
  fi
fi
echo "   HEAD = $(git log --oneline -1 2>/dev/null || echo "${UNKNOWN}")"

# ── ② 产物与过期输入 ───────────────────────────────────────────────────────
echo
echo "② 产物与过期输入"
DIST_INDEX="build-dist/index.html"
STALE_N="${UNKNOWN}"
if [ ! -f "$DIST_INDEX" ]; then
  echo "   ★ ${DIST_INDEX} 不存在 ⇒ CAN_RUN = false ⇒ 真机族**整族**跳过。"
  echo "     那种状态的读数测的是**另一个集合**（CAN_RUN 失效时整门应为 31 个 / 209 条）⇒ 不可与 20/148 比。"
  echo "     过期输入计数 = ${UNKNOWN}（find -newer 一个不存在的文件只会报错，**它的 0 是假的**）"
else
  echo "   ${DIST_INDEX} mtime = $(stat -c '%y' "$DIST_INDEX")"
  STALE_LIST=$(find src electron index.html vite.config.ts tailwind.config.ts postcss.config.js \
    -newer "$DIST_INDEX" -type f 2>/dev/null)
  FIND_RC=$?
  if [ "$FIND_RC" != "0" ]; then
    echo "   ★ find -newer 失败（rc=${FIND_RC}）⇒ 过期输入计数 = ${UNKNOWN}"
  else
    STALE_N=$(printf '%s\n' "$STALE_LIST" | grep -c . )
    echo "   比产物新的构建输入计数 = ${STALE_N}"
    printf '%s\n' "$STALE_LIST" | grep . | sed 's/^/     /'
  fi
fi

# ── ③ 并跑进程（争用） ─────────────────────────────────────────────────────
echo
echo "③ 并跑进程（争用；> 0 ⇒ 该轮读数不可比）"
# ★ 别用 `tasklist /FI ...`：从 Git Bash 调会踩 MSYS 路径转换 —— `/FI` 被当成路径
#   `D:/.../PortableGit/FI`，tasklist 报「无效参数」，grep -c 于是返回**假 0**
#   （实测：同一刻 `tasklist //FI` 数出 17 个 node.exe）。一律走 proc-probe.mjs。
PROBE_OUT=$(node "$HERE/proc-probe.mjs" 2>&1)
PROBE_RC=$?
printf '%s\n' "$PROBE_OUT" | sed 's/^/   /'
if [ "$PROBE_RC" = "2" ]; then
  CONTEND="${UNKNOWN}"
  echo "   ⇒ 争用 = ${UNKNOWN}（探针自己报的未知）"
else
  # 抠不出数字就记未知，**不许**把没解析出来的整行当结论（同族：0 与未知必须可区分）
  C_RAW=$(printf '%s\n' "$PROBE_OUT" | head -1 | sed -nE 's/.*VITEST=([-0-9]+).*/\1/p')
  case "$C_RAW" in
    ''|*[!0-9-]*) CONTEND="${UNKNOWN}" ;;
    -*) CONTEND="${UNKNOWN}" ;;   # -1 = 探针报的未知
    *) CONTEND="$C_RAW" ;;
  esac
fi

# ── ④ 代码代 ───────────────────────────────────────────────────────────────
echo
echo "④ 代码代"
echo "   HEAD 短哈希 = $(git rev-parse --short HEAD 2>/dev/null || echo "${UNKNOWN}")"
echo "   tests/ spec 文件数 = $(count_or_unknown bash -c "find tests -type f \\( -name '*.spec.ts' -o -name '*.spec.tsx' \\)")"
TESTS_SUM=$(find tests \( -name '*.spec.ts' -o -name '*.spec.tsx' \) -exec stat -c '%Y' {} + 2>/dev/null | awk 'NF{s+=$1; n++} END{ if (n==0) print "未知"; else print s }')
echo "   tests/ mtime 合计（秒）= ${TESTS_SUM}"

# ── ⑤ 本步前提 ─────────────────────────────────────────────────────────────
echo
echo "⑤ 本步前提"
NEED_CLEAN=""   # 第 2.5 步需要「树干净」
[ "${STEP}" = "2.5" ] && NEED_CLEAN="1"

case "${STEP}" in
  2.5)
    if [ "${DIRTY_N}" = "${UNKNOWN}" ] || [ "${STALE_N}" = "${UNKNOWN}" ]; then
      echo "   ★ 读数含未知（脏=${DIRTY_N} 过期输入=${STALE_N}）⇒ **前提判不了**，"
      echo "     按「前提不成立」处理并报 team-lead（未知 ≠ 成立）。"
    elif [ "${DIRTY_N}" = "0" ] && [ "${STALE_N}" != "0" ]; then
      echo "   ✔ 前提成立：树干净 + 过期输入 ${STALE_N} 个 ⇒ 有复现对象（期望 20 skipped 文件 / 148 skipped 用例）。"
      [ "${CONTEND}" = "0" ] || echo "   ⚠️ 但争用 = ${CONTEND} ⇒ 即便前提成立，这一轮读数**不可比**，先清场再跑。"
    else
      echo "   ★ 前提**不成立**（脏=${DIRTY_N} 过期输入=${STALE_N}）⇒ 这一跑复现不出 20/148。"
      echo "     不许写「已复现」也不许写「未复现」；**先报 team-lead**，不要自行用 touch 造陈旧态。"
    fi
    ;;
  5.5|5.6)
    if [ "${STALE_N}" = "${UNKNOWN}" ]; then
      echo "   ★ 过期输入未知 ⇒ 判不了 ⇒ 报 team-lead。"
    elif [ "${STALE_N}" = "0" ]; then
      echo "   ✔ 前提（产物新鲜）成立 ⇒ 全量应有的 skipped = 0（硬判据）。"
    else
      echo "   ★ 产物已过期（${STALE_N} 个输入比它新）⇒ 全量会**静默跳过**真机族，"
      echo "     这时的读数**不是**第 5.5 步要的那个字段。先重建产物。"
    fi
    ;;
  5)
    if [ "${STALE_N}" = "${UNKNOWN}" ]; then
      echo "   ★ 过期输入未知 ⇒ 判不了 ⇒ 报 team-lead。"
    elif [ "${STALE_N}" = "0" ]; then
      echo "   ✔ 真机族前提成立（产物新鲜 ⇒ CAN_RUN_FRESH = true，族内应 0 跳过）。"
    else
      echo "   ★ 产物过期 ⇒ 族内 29 个文件 / 148 条会被门吞掉，本轮不是「全族 329」⇒ 换了集合，作废。"
    fi
    ;;
  *)
    echo "   （未指定步骤；只打印事实，不做判断）"
    ;;
esac
echo "==================================================================="
