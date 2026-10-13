#!/usr/bin/env bash
# 重建两份「冻结件」（事故后）：browser-family-baseline / gate-expected
#
# ⚠️ 事故说明（2026-10-14 05:16–05:18，qa-scratch 被清空）：
#   · **集合**：由磁盘现场重新发现（含 playwright-core 的 spec），并与 93dc987 基线逐文件比对；
#   · **用例数**：原输入 `_frozen-run-r2.txt` **已永久丢失**。这里用的是事故前**同一会话内的实测值**
#     （r2 读数逐文件反解 + 静态计数逐文件互校：41/44 逐字相同，3 处差异已解释为 for 循环生成）。
#     ⇒ 标注为「**会话内实测留档**」，不是「当场复算」。**Step 5 的 r1 一跑出来，立刻用它现场复核这 44 个数字。**
#   · **门内条数**：= 用例数 − 门外（门外由源码块跟踪现场算出，可复算）。
#
# 用法: bash scripts/window/rebuild-frozen-baselines.sh
#   两份冻结件写回**本脚本所在目录**（scripts/window/，入库 ⇒ 耐久）。
set -u
HERE=$(cd "$(dirname "$0")" && pwd)          # scripts/window
REPO=$(cd "$HERE/../.." && pwd)              # 仓库根
cd "$REPO" || exit 1

BASE="$HERE/browser-family-baseline-93dc987.txt"
EXP="$HERE/gate-expected-93dc987.txt"

# 机械复导集合（team-lead 要求：基线清单必须可机械复导，不能只活在一个人的上下文里）
#   git grep -l "playwright-core" 93dc987 -- 'tests/*.spec.ts' 'tests/*.spec.tsx' \
#     | sed -E 's/^[0-9a-f]{7}://' | sort        ⇒ 期望 44 个
#   复导结果与磁盘发现必须一致，否则本脚本拒绝生成（说明选择规则不机械）。

# 事故前实测的逐文件用例数（键 = spec 文件名）
read -r -d '' COUNTS <<'EOF'
calendar-anchor.spec.ts 1
calendar-popover-geometry.spec.ts 8
f3-sidebar-identity.spec.ts 1
i18n-browser.spec.ts 1
identity-rail-browser.spec.ts 7
isolation-browser.spec.ts 20
layout-walkthrough.spec.ts 12
member-board-back.spec.ts 4
member-board-column-cap.spec.ts 3
member-board-column-consistency.spec.ts 2
member-board-deeplink.spec.ts 3
member-board-layout.spec.ts 2
member-board-narrow-card.spec.ts 6
member-board-stat-labels.spec.ts 2
motion-exits-browser.spec.ts 3
motion-tokens-preview.spec.ts 14
overlay-stack-browser.spec.ts 4
plugin-mobile-menu-gate-browser.spec.ts 1
plugin-state-demo-browser.spec.ts 3
print-a4-visual.spec.ts 9
print-a4-visual-classic.spec.ts 2
print-a4-visual-d.spec.ts 18
print-a4-visual-e.spec.ts 15
print-a4-visual-h.spec.ts 18
print-final-verify.spec.ts 6
print-generic-fidelity-a4.spec.ts 4
print-generic-fidelity2-a4.spec.ts 5
print-generic-modules-a4.spec.ts 5
print-headers-print-media.spec.ts 7
print-light-lock.spec.ts 4
print-logo.spec.ts 20
print-selector-modal-shots.spec.ts 5
print-selector-shots.spec.ts 1
print-zoom-slider-shots.spec.ts 1
qa-batch-a-verify.spec.ts 16
route-scroll-reset.spec.ts 4
settings-drawer-flicker.spec.ts 6
settings-zones.spec.ts 7
stage-color-wiring.spec.tsx 46
stage-select-rows-geometry.spec.ts 4
ui-batch-a-geometry.spec.ts 3
v07-board-acceptance.spec.ts 13
v07-dline-shell.spec.ts 8
v07-t03b-ingress-geometry.spec.ts 5
EOF

# ── ① 现场发现集合 ─────────────────────────────────────────────────────────
# grep -rl 已经返回 `tests/xxx.spec.ts` ⇒ 不要再补前缀（第一版补了 ⇒ `tests/tests/...`，
# 被下面的对账当场拦下、拒绝生成 —— 这正是「宁可不生成，也不许用猜的数」该有的样子）。
DISK=$(grep -rl "playwright-core" tests --include='*.spec.ts' --include='*.spec.tsx' | sort)
DISK_N=$(printf '%s\n' "$DISK" | grep -c .)
echo "现场发现的真机族 = ${DISK_N} 个文件"

# ── ①b 机械复导并在基线 revision 上校核（team-lead 要求：不许只活在一个人的上下文里） ──
REV=93dc987
REV_SET=$(git grep -l "playwright-core" "$REV" -- 'tests/*.spec.ts' 'tests/*.spec.tsx' 2>/dev/null \
  | sed -E 's/^[0-9a-f]{7}://' | sort)
REV_N=$(printf '%s\n' "$REV_SET" | grep -c .)
echo "机械复导（$REV）= ${REV_N} 个文件   判据 44 ⇒ $([ "$REV_N" = "44" ] && echo ✔ || echo ✘)"
if [ "$REV_N" != "44" ]; then
  echo "★ 复导数 ≠ 44 ⇒ 选择规则或 revision 有问题 ⇒ 拒绝生成，报 team-lead。"
  exit 1
fi
if [ "$REV_SET" != "$DISK" ]; then
  echo "★ 复导集合与本轮磁盘发现不一致 ⇒ 选择规则不机械（或磁盘已漂移）⇒ 拒绝生成，报 team-lead："
  diff <(printf '%s\n' "$REV_SET") <(printf '%s\n' "$DISK") | head -20
  exit 1
fi
echo "✔ 复导集合与磁盘发现逐文件一致 ⇒ 选择规则机械、且本份基线可被独立校核。"

# ── ② 与实测表对账（缺谁都得出声） ─────────────────────────────────────────
MISSING=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  grep -q "^$(basename "$f") " <<< "$COUNTS" || { echo "★ 现场文件缺用例数：${f}（**不许猜**）"; MISSING=1; }
done <<< "$DISK"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  printf '%s\n' "$DISK" | grep -q "/${f}$" || echo "★ 表里有、磁盘上没有：${f}"
done <<< "$(printf '%s\n' "$COUNTS" | awk '{print $1}')"
[ "$MISSING" = "1" ] && { echo "⇒ 有声缺口，拒绝生成（宁可不生成，也不许用猜的数）。"; exit 1; }

# ── ③ 写基线 ───────────────────────────────────────────────────────────────
{
  echo "# 真机族冻结集合（可比性维度之二：**集合**）"
  echo "#"
  echo "# 【机械复导命令】任何人不靠本文件也能复导出同一份集合："
  echo "#   git grep -l \"playwright-core\" 93dc987 -- 'tests/*.spec.ts' 'tests/*.spec.tsx' \\"
  echo "#     | sed -E 's/^[0-9a-f]{7}://' | sort"
  echo "# 【期望计数】44 个文件 / 329 条用例"
  echo "# 【选择规则】被选中的 spec 文件内出现 playwright-core（= 真机族）"
  echo "#"
  echo "# ★ provenance: 事故前留档（待 r1 复核）"
  echo "#   那 44 个用例数只活在事故前同一会话的实测留档里（原 r2 原始读数已永久丢失 ⇒ 无法当场复算）。"
  echo "#   r1 跑完、读数器确认「44 个文件全部出现且逐个相符」后，把本行改成："
  echo "#   ★ provenance: r1 已现场复核（<r1 的时刻/HEAD>）"
  echo "#"
  echo "# 生成：bash scripts/window/rebuild-frozen-baselines.sh（脚本内含①b 步：复导集合与磁盘发现必须一致，否则拒绝生成）"
  echo "# 事故说明：原基线随 2026-10-14 那次 qa-scratch 清空永久丢失；本份为重建版。"
  echo "# 用例数来源 = 事故前**同一会话内实测**（原 r2 原始读数已永久丢失，无法当场复算）"
  echo "#   ⇒ Step 5 的 r1 跑完后，scripts/window/frozen-run.mjs 会拿它的逐文件读数复核下面 44 个数字；"
  echo "#     只有 44 个文件**全部出现且逐个相符**才会打印「已现场复核通过」。"
} > "$BASE"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  n=$(grep "^$(basename "$f") " <<< "$COUNTS" | awk '{print $2}')
  echo "${f} (${n} tests)" >> "$BASE"
done <<< "$DISK"

# ── ④ 写门内清单（= 用例数 − 门外；门外现场算） ───────────────────────────
outside_of() {
  awk '/^describe\.skipIf/{g=1;next} /^describe\(/{g=0;next} /^[[:space:]]*it\.skipIf\(/{next} /^[[:space:]]*it\(/{if(!g)o++} END{print o+0}' "$1"
}
{
  echo "# 冻结的门内清单（过期态**应当**被跳过的文件与条数）"
  echo "# 事故后重建；门内 = 用例数 − 门外（门外由源码块跟踪现场算出，可复算）"
  echo "# 只列新鲜度门：CAN_RUN_FRESH，或把 STALE 并进 CAN_RUN 的写法（isolation-browser / stage-color-wiring）"
  echo "# ★ provenance: 事故前留档（待 r1 复核）—— 同基线的说明；退路：本清单是**期望不是判据**（见 skip-diff.mjs 判据①②）"
  echo "# 期望合计 = 29 文件 / 148 条"
} > "$EXP"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if grep -q "CAN_RUN_FRESH" "$f" || grep -qE "^const CAN_RUN = .*STALE" "$f"; then
    n=$(grep "^$(basename "$f") " <<< "$COUNTS" | awk '{print $2}')
    o=$(outside_of "$f")
    echo "$(basename "$f") $(( n - o ))" >> "$EXP"
  fi
done <<< "$DISK"

# ── ⑤ 自证 ─────────────────────────────────────────────────────────────────
FN=$(grep -vc '^#' "$BASE")
TS=$(grep -v '^#' "$BASE" | grep -oE '\(([0-9]+) tests?\)' | grep -oE '[0-9]+' | awk '{s+=$1} END{print s+0}')
EN=$(grep -vc '^#' "$EXP")
ES=$(grep -v '^#' "$EXP" | awk '{s+=$2} END{print s+0}')
echo "基线：${FN} 文件 / ${TS} 条用例   判据 44 / 329 ⇒ $([ "$FN" = 44 ] && [ "$TS" = 329 ] && echo '✔ 通过' || echo '✘ 不通过')"
echo "门内：${EN} 文件 / ${ES} 条用例   判据 29 / 148 ⇒ $([ "$EN" = 29 ] && [ "$ES" = 148 ] && echo '✔ 通过' || echo '✘ 不通过')"
[ "$FN" = 44 ] && [ "$TS" = 329 ] && [ "$EN" = 29 ] && [ "$ES" = 148 ] || exit 1
