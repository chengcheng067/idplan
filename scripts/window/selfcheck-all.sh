#!/usr/bin/env bash
# 事故后重建件的**统一自证**：四个件全跑一遍，输出落一个文件（可复算）。
#
# 用法: bash scripts/window/selfcheck-all.sh [输出文件]
#   默认输出落**仓外**耐久路径（不在任何清理器射程内，也不脏工作树）：
#     <repo>/../deliverables/release-1.0.0.0009-窗口证据/
set -u
set -o pipefail   # ★ 必须：否则 `node ... | tail` 的 $? 是 tail 的，案子「红」也会被读成 0
HERE=$(cd "$(dirname "$0")" && pwd)          # scripts/window
REPO=$(cd "$HERE/../.." && pwd)              # 仓库根
READINGS="$REPO/../deliverables/release-1.0.0.0009-窗口证据"
cd "$REPO" || exit 1
OUT="${1:-$READINGS/_selfcheck-$(date +%Y%m%d-%H%M).txt}"
D=$(mktemp -d)
FAIL=0
chk() { # chk <期望退出码> <实际退出码> <名称>
  if [ "$1" = "$2" ]; then echo "  ✔ $3（exit=$2，符合期望）"; else echo "  ✘ $3（exit=$2，期望 $1）"; FAIL=1; fi
}
# ★ 用命令替换取输出与退出码，**不要**接管道：`cmd | tail` 的 $? 是 tail 的。
#   （第一版就是栽在这上面：B/C/D 三个**本该红**的案子被打印成 exit=0「符合期望」。
#     同族第二个坑：`{ ...; } | tee` 会把整块放进**子壳**，块内改的 FAIL 不回传 ⇒ 退出码永远是 0。）
run_case() { # run_case <期望退出码> <名称> <命令...>
  local want="$1" name="$2"
  shift 2
  local out rc
  out=$("$@" 2>&1)
  rc=$?
  printf '%s\n' "$out" | tail -4 | sed 's/^/    /'
  chk "$want" "$rc" "$name"
}

{
echo "==================================================================="
echo "事故后重建件 · 统一自证    $(date '+%Y-%m-%d %H:%M:%S')"
echo "仓库根 = $REPO"
echo "HEAD   = $(git log --oneline -1)"
echo "读数落点 = $READINGS"
echo "==================================================================="

echo
echo "### 1 · proc-probe.mjs（争用探针：0 与未知必须可区分）"
node --check "$HERE/proc-probe.mjs" && echo "  node --check ✔"
echo "  -- 静息态（应为真 0，exit 0）--"
node "$HERE/proc-probe.mjs"; chk 0 $? "静息态"
echo "  -- 正对照：标记进程存活（应 VITEST>=1）--"
(node -e "setTimeout(()=>{},7000)" vitest-marker-POSITIVE >/dev/null 2>&1 &)
sleep 2; node "$HERE/proc-probe.mjs"
sleep 6
echo "  -- 撤掉标记后（应回 0）--"
node "$HERE/proc-probe.mjs"; chk 0 $? "撤标记后"

echo
echo "### 2 · step-precheck.sh（起跑前置：量不出来一律报「未知」）"
bash -n "$HERE/step-precheck.sh" && echo "  bash -n ✔"
bash "$HERE/step-precheck.sh" 2.5 | sed 's/^/  /'
echo "  （若出现「前提不成立」而当前树确实脏/陈旧 ⇒ 判对了；出现「未知」⇒ 按未知处理，不当 0）"

echo
echo "### 3 · skip-diff.mjs（5.6 判据①②③④；夹具用**真实文件名 + 真实门标题**）"
node --check "$HERE/skip-diff.mjs" && echo "  node --check ✔"
GA='反馈 #7 · 月历卡与统计卡行共用左右锚点（真 Chromium）'          # calendar-anchor 的真门标题
GB='出口接线 · 真 Chromium（不拦输入 / reduce / 兜底）跳过：产物过期' # motion-exits 的模板串门（带插值）
cat > "$D/stale.json" <<EOF
{"testResults":[
 {"name":"E:/x/tests/calendar-anchor.spec.ts","assertionResults":[
   {"ancestorTitles":["$GA"],"title":"L-01 锚点","fullName":"$GA > L-01 锚点","status":"skipped"},
   {"ancestorTitles":["普通组"],"title":"源码侧","fullName":"普通组 > 源码侧","status":"passed"}]},
 {"name":"E:/x/tests/motion-exits-browser.spec.ts","assertionResults":[
   {"ancestorTitles":["$GB"],"title":"出口不拦输入","fullName":"$GB > 出口不拦输入","status":"skipped"},
   {"ancestorTitles":["动效源码"],"title":"token","fullName":"动效源码 > token","status":"passed"}]}]}
EOF
printf ' Test Files  1 passed | 1 skipped (2)\n      Tests  2 passed | 2 skipped (4)\n' > "$D/stale.txt"
cat > "$D/fresh_ok.json" <<EOF
{"testResults":[
 {"name":"E:/x/tests/calendar-anchor.spec.ts","assertionResults":[
   {"ancestorTitles":["$GA"],"title":"L-01 锚点","fullName":"$GA > L-01 锚点","status":"passed"},
   {"ancestorTitles":["普通组"],"title":"源码侧","fullName":"普通组 > 源码侧","status":"passed"}]},
 {"name":"E:/x/tests/motion-exits-browser.spec.ts","assertionResults":[
   {"ancestorTitles":["$GB"],"title":"出口不拦输入","fullName":"$GB > 出口不拦输入","status":"passed"},
   {"ancestorTitles":["动效源码"],"title":"token","fullName":"动效源码 > token","status":"passed"}]}]}
EOF
printf ' Test Files  2 passed (2)\n      Tests  4 passed (4)\n' > "$D/fresh_ok.txt"
cat > "$D/fresh_bad.json" <<EOF
{"testResults":[
 {"name":"E:/x/tests/calendar-anchor.spec.ts","assertionResults":[
   {"ancestorTitles":["$GA"],"title":"L-01 锚点","fullName":"$GA > L-01 锚点","status":"skipped"},
   {"ancestorTitles":["普通组"],"title":"源码侧","fullName":"普通组 > 源码侧","status":"passed"}]},
 {"name":"E:/x/tests/motion-exits-browser.spec.ts","assertionResults":[
   {"ancestorTitles":["$GB"],"title":"出口不拦输入","fullName":"$GB > 出口不拦输入","status":"passed"},
   {"ancestorTitles":["动效源码"],"title":"token","fullName":"动效源码 > token","status":"passed"}]}]}
EOF
printf ' Test Files  1 passed | 1 skipped (2)\n      Tests  3 passed | 1 skipped (4)\n' > "$D/fresh_bad.txt"
# 过期态一条没跳（total>0）——用来验「两个 0 合成一个 ✔」那个假绿洞已堵
echo '{"testResults":[{"name":"E:/x/tests/calendar-anchor.spec.ts","assertionResults":[{"ancestorTitles":["普通组"],"title":"源码侧","fullName":"普通组 > 源码侧","status":"passed"}]}]}' > "$D/allpass.json"
printf ' Test Files  1 passed (1)\n      Tests  1 passed (1)\n' > "$D/allpass.txt"
# 跳了、但源码现场看不出有门（真实存在的文件 + 编造的普通组路径）⇒ 判据②必须红
cat > "$D/nogate.json" <<'EOF'
{"testResults":[
 {"name":"E:/x/tests/print-logo.spec.ts","assertionResults":[
   {"ancestorTitles":["某个普通组"],"title":"普通用例","fullName":"某个普通组 > 普通用例","status":"skipped"}]}]}
EOF
printf ' Test Files  0 passed | 1 skipped (1)\n      Tests  0 passed | 1 skipped (1)\n' > "$D/nogate.txt"
printf 'calendar-anchor.spec.ts 1\nmotion-exits-browser.spec.ts 1\n' > "$D/exp.txt"
printf '# 空清单\n' > "$D/exp-empty.txt"
# stdout 说 148 跳过、JSON 只 2 条 ⇒ 判「读数不可信」
printf ' Test Files  200 passed | 20 skipped (220)\n      Tests  2739 passed | 148 skipped (2887)\n' > "$D/stdout148.txt"

echo "  -- A 正例（期望 exit 0）--"
run_case 0 "A 正例" node "$HERE/skip-diff.mjs" --stale="$D/stale.json" --stale-stdout="$D/stale.txt" --fresh="$D/fresh_ok.json" --fresh-stdout="$D/fresh_ok.txt" --expect="$D/exp.txt"
echo "  -- B 变异：新鲜态仍跳（期望 exit 1）--"
run_case 1 "B 变异" node "$HERE/skip-diff.mjs" --stale="$D/stale.json" --stale-stdout="$D/stale.txt" --fresh="$D/fresh_bad.json" --fresh-stdout="$D/fresh_bad.txt" --expect="$D/exp.txt"
echo "  -- C 假绿洞：过期态 0 跳过 + 空清单（期望 exit 1）--"
run_case 1 "C 假绿洞" node "$HERE/skip-diff.mjs" --stale="$D/allpass.json" --stale-stdout="$D/allpass.txt" --fresh="$D/fresh_ok.json" --fresh-stdout="$D/fresh_ok.txt" --expect="$D/exp-empty.txt"
echo "  -- D 读数不可信：stdout 说 148、JSON 只 2（期望 exit 2）--"
run_case 2 "D 读数不可信" node "$HERE/skip-diff.mjs" --stale="$D/stale.json" --stale-stdout="$D/stdout148.txt" --fresh="$D/fresh_ok.json" --fresh-stdout="$D/fresh_ok.txt" --expect="$D/exp.txt"
echo "  -- E 判据②：跳了但源码现场看不出有门（期望 exit 1；会同时触发 ①b 与 ②，
       ——那是同一条发现的两条路，不是两个独立缺陷）--"
run_case 1 "E 判据②无门" node "$HERE/skip-diff.mjs" --stale="$D/nogate.json" --stale-stdout="$D/nogate.txt" --fresh="$D/fresh_ok.json" --fresh-stdout="$D/fresh_ok.txt" --no-expect

echo
echo "### 4 · frozen-run.mjs（读数器：--dry 三夹具，不跑批）"
node --check "$HERE/frozen-run.mjs" && echo "  node --check ✔"
printf ' ✓ tests/calendar-anchor.spec.ts (1 test) 1204ms\n ✓ tests/isolation-browser.spec.ts (20 tests) 9100ms\n\n Test Files  44 passed (44)\n      Tests  329 passed (329)\n   Duration  565.94s\n' > "$D/ok.txt"
printf ' Test Files  200 passed | 20 skipped (220)\n      Tests  2739 passed | 148 skipped (2887)\n   Duration  74.96s\n' > "$D/skip.txt"
printf 'nothing here\n' > "$D/junk.txt"
echo "  -- 全绿夹具（期望 44/329 且自洽 ✔）--"
node "$HERE/frozen-run.mjs" --dry --raw-fixture="$D/ok.txt" --label=dry-ok --out-dir="$D" 2>&1 | grep -E "文件维|用例维|自洽|ARTIFACT|复核|不足以" | sed 's/^/    /'
echo "  -- 过期态夹具（期望精准复现 200 passed|20 skipped / 2739 passed|148 skipped）--"
node "$HERE/frozen-run.mjs" --dry --raw-fixture="$D/skip.txt" --label=dry-skip --out-dir="$D" 2>&1 | grep -E "文件维|用例维|自洽" | sed 's/^/    /'
echo "  -- 垃圾夹具（期望全打 ? 并报「解析出 0 行」，不冒充 0）--"
node "$HERE/frozen-run.mjs" --dry --raw-fixture="$D/junk.txt" --label=dry-junk --out-dir="$D" 2>&1 | grep -E "解析出 0 行|文件维|用例维" | sed 's/^/    /'

echo
echo "### 5 · 两份冻结件 + 机械复导"
FN=$(grep -vc '^#' "$HERE/browser-family-baseline-93dc987.txt")
TS=$(grep -v '^#' "$HERE/browser-family-baseline-93dc987.txt" | grep -oE '\(([0-9]+) tests?\)' | grep -oE '[0-9]+' | awk '{s+=$1} END{print s+0}')
EN=$(grep -vc '^#' "$HERE/gate-expected-93dc987.txt")
ES=$(grep -v '^#' "$HERE/gate-expected-93dc987.txt" | awk '{s+=$2} END{print s+0}')
REVN=$(git grep -l "playwright-core" 93dc987 -- 'tests/*.spec.ts' 'tests/*.spec.tsx' 2>/dev/null | wc -l)
echo "  基线：${FN} 文件 / ${TS} 例   判据 44 / 329 ⇒ $([ "$FN" = 44 ] && [ "$TS" = 329 ] && echo ✔ || echo ✘)"
echo "  门内：${EN} 文件 / ${ES} 例   判据 29 / 148 ⇒ $([ "$EN" = 29 ] && [ "$ES" = 148 ] && echo ✔ || echo ✘)"
echo "  机械复导（93dc987）：${REVN} 个文件   判据 44 ⇒ $([ "$REVN" = 44 ] && echo ✔ || echo ✘)"
echo "  （可复算：bash scripts/window/rebuild-frozen-baselines.sh，它内含「复导 vs 磁盘必须一致」的硬闸）"

echo
echo "==================================================================="
echo "总判：$([ "$FAIL" = "0" ] && echo '全部自证通过' || echo '★ 有项未达期望，别用这套跑批')"
echo "==================================================================="
} > "$OUT" 2>&1
# ★ 不用 `} | tee`：管道会把整块放进**子壳**，块内改的 FAIL 不回传 ⇒ 退出码恒 0。
cat "$OUT"

rm -rf "$D"
exit "$FAIL"
