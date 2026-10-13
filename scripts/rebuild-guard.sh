#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-dist 重建守卫（一次性投资，后续每批复用 —— team-lead 2026-10-14 要求）
#
# 为什么需要：`emptyOutDir:false` ⇒ 两份并发重建会往同一目录写两代 bundle，
#   产出**混合代**（极端情形让 built-assets 自检按 loud-fail 报出一批无关红）。
#
# 行为：
#   · 检测到并发 vite/electron-vite 进程 ⇒ **拒绝重建**（exit 2，打印计数）；
#   · 无并发 ⇒ 清旧哈希 bundle → 构建 → 自查「过期输入 = 0」（非 0 ⇒ exit 4）；
#   · 构建失败 ⇒ exit 3 并打印尾部日志。
#
# 自证（team-lead 要求两条，缺一不可）：
#   (a) **会拦**：`REBUILD_GUARD_FAKE_VITE=1 bash scripts/rebuild-guard.sh` ⇒ 必须 exit 2
#   (b) **不误拦**：不带该变量正常跑 ⇒ 必须放行并 exit 0
#   （`REBUILD_GUARD_FAKE_VITE` 只服务于自证 (a)，生产路径不受影响。）
set -u

fake="${REBUILD_GUARD_FAKE_VITE:-0}"
raw=$( (ps -W 2>/dev/null || ps aux 2>/dev/null) | grep -i 'vite' | grep -v grep | wc -l )
count=$(printf '%s' "$raw" | tr -d ' \n')
[ "$fake" = "1" ] && count=1
[ -z "$count" ] && count=0

if [ "$count" != "0" ]; then
  echo "REFUSE: 检测到 $count 个 vite 进程在跑 ⇒ 拒绝重建（避免产出混合代）。请稍后重试。"
  exit 2
fi

# ── 第二道闸：**树里不能有非 HEAD 内容**（team-lead 2026-10-14 加；职责分工：
#    并发 build 归本守卫、**树干净也归本守卫**；产物代归 `browser-run.sh`）
#
# 为什么必须由**构建守卫**把关：受控实验证明构建**逐字可复现**（REPRODUCIBLE=1）
#   ⇒ **产物代不同，必然意味着构建时树里存在非 HEAD 内容**（例：变异脚本故意把变异烤进产物）
#   ⇒ 那种产物里读出的任何数，**都不能用来判 HEAD 的性质**（这是存在性证明，不是概率判断）。
fake_dirty="${REBUILD_GUARD_FAKE_DIRTY:-0}"
# ⚠️ **判据要收窄到「构建输入」**：`docs/`、`tests/`、`qa-scratch/` 的未提交改动**不影响产物**
#    （第一次写这闸时我用了裸 `git diff --quiet`，结果因为别人在改 `docs/release-checklist.md`
#     而**误拦**了自己 —— 守卫过度封锁与不封锁一样坏，这正是「会拦 + 不误拦」两条自证要拦住的错）。
build_inputs='src electron index.html vite.config.ts tailwind.config.ts postcss.config.js package.json'
dirty=$(git status --porcelain -- $build_inputs 2>/dev/null | head -5)
if [ "$fake_dirty" = "1" ] || [ -n "$dirty" ]; then
  echo "REFUSE: 树里的**构建输入**存在未提交改动 ⇒ 拒绝重建（构建会把它烤进产物，污染所有人的读数）："
  [ -n "$dirty" ] && printf '%s\n' "$dirty" | sed 's/^/        /'
  echo "        请先让其落库，或与改动者确认后再建。"
  exit 5
fi
echo "OK: 构建输入干净（无未提交改动；docs/tests 的改动不受此闸限制）"

rm -f build-dist/assets/*.css build-dist/assets/*.js
if ! npm run build > /tmp/rebuild-guard.out 2>&1; then
  echo "BUILD FAILED（尾部日志）："
  tail -5 /tmp/rebuild-guard.out
  exit 3
fi

n=$(find src electron -type f \( -name '*.ts' -o -name '*.tsx' \) -newer build-dist/index.html | wc -l | tr -d ' \n')
echo "REBUILT: build exit=0 / 过期输入=$n"
if [ "$n" != "0" ]; then
  echo "STALE: 仍有 $n 个输入比产物新（别人在改 src）⇒ 读数不可用"
  exit 4
fi

echo "产物代："
ls -l --time-style=+%Y-%m-%dT%H:%M:%S build-dist/index.html | awk '{print "  index.html mtime = "$6}'
ls build-dist/assets/ | grep -E '\.(js|css)$' | sed 's/^/  bundle: /'
