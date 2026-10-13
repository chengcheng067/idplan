#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 浏览器跑批包装：**强制带「产物代前后一致」判据**（team-lead 2026-10-14 立）
#
# 为什么：`rm -f assets/*.js && npm run build` 是**破坏性**动作 —— 正在跑的页面
#   可能取到「旧 index.html 指向已被删的旧 bundle」⇒ 404 ⇒ 白屏 ⇒ 元素等待超时。
#   所以「跑批期间产物代变了」这件事必须被**机器判据**抓住，不能靠纪律提醒。
#
# 判据（任一变化即判）：
#   · `build-dist/index.html` 的 **blob 哈希**（内容，不是 mtime —— stat-only 不算变）；
#   · `build-dist/assets/` 的**文件清单 + 大小**。
# 不一致 ⇒ 打印两次产物代，并输出 `ARTIFACT_CHANGED`（**该轮作废、不出结论**）。
#
# 用法：bash scripts/browser-run.sh tests/a.spec.ts tests/b.spec.ts
#
# ★★ 跑批前必答一句（跟着工具走，不跟记忆走）★★
#   **「我这轮读的，跟我以为我在读的，是同一个吗」** —— 三问：
#     ① HEAD / 工作树内容变了吗（`git diff --quiet && git diff --cached --quiet`）
#     ② 产物代变了吗（本脚本前后两次快照）
#     ③ 判据本身能不能看见（例：GBK 控制台下中文 grep 会**静默**不匹配 ⇒ 判据形同不存在）
#
# ⚠️ 类别记法（team-lead 2026-10-14 纠正）：产物代中途变化导致的红，类别是
#   **「环境在跑批期间被破坏」（环境破坏类）**，**不是**「该 spec 非确定性」——
#   该 spec 在结构上不会因并发而飘，它只是在被破坏的环境里**正确地失败了**。
#   混为一谈会让出包门的判据变钝：清单里会混进一条不可能飘的 spec，
#   而真正该盯的（环境完整性）反而不在清单上。⇒ **不进 flaky 清单**。
set -u

snap() {
  echo "index.html blob = $(git hash-object build-dist/index.html 2>/dev/null || echo 'MISSING')"
  ls -l --time-style=+%s build-dist/assets/ 2>/dev/null | awk 'NR>1 {printf "  %8s  %s\n", $5, $NF}' | sort
}

# 跑前：先确认无并发 build（守卫复用同一判据）
vite=$( (ps -W 2>/dev/null || ps aux 2>/dev/null) | grep -i 'vite' | grep -v grep | wc -l | tr -d ' \n')
echo "== 并发 build 计数 = ${vite:-0}（>0 说明别人正在重建，本轮读数不可信）=="

# 跑前：**分档**报「未提交改动」（team-lead 2026-10-14 收窄判据宽度）
#
# 判据取值域要收到「真正会影响结论的那一部分」：
#   · `tests/` 脏 ⇒ ★**警告**：**被测对象**可能混合了别人的在飞测试改动（「测的是什么」不明确）；
#   · 构建输入脏 ⇒ ★**警告**：产物与 HEAD 不同源（与下面的产物代判据互相印证）；
#   · `docs/` `qa-scratch/` `outputs/` 等 ⇒ **完全不相关，别管**（否则每批都会被写文档挡住 —— 
#     实测过一次：那次触发源是 team-lead 自己忘了提交 `docs/release-checklist.md`）。
# 注意：`src/` 的未提交改动**不影响**「这一轮读的是哪份产物」（产物已定）⇒ 故只警告、不拦。
tests_dirty=$(git status --porcelain -- tests 2>/dev/null | head -5)
inputs_dirty=$(git status --porcelain -- src electron index.html vite.config.ts tailwind.config.ts postcss.config.js package.json 2>/dev/null | head -5)
if [ -n "$tests_dirty" ]; then
  echo "★ 警告：tests/ 有未提交改动 ⇒ **本轮被测对象可能混合了别人的在飞测试改动**："
  printf '%s\n' "$tests_dirty" | sed 's/^/        /'
else
  echo "== tests/ 干净（被测对象无在飞改动）=="
fi
if [ -n "$inputs_dirty" ]; then
  echo "★ 警告：构建输入有未提交改动 ⇒ 产物与 HEAD 不同源（与产物代判据互相印证）："
  printf '%s\n' "$inputs_dirty" | sed 's/^/        /'
else
  echo "== 构建输入干净（产物与 HEAD 同源）=="
fi

before=$(snap)
echo "== 跑前产物代 =="; printf '%s\n' "$before"

npx vitest run "$@" > /tmp/browser-run.out 2>&1
code=$?

after=$(snap)
echo "== 跑后产物代 =="; printf '%s\n' "$after"
grep -E "Test Files|Tests +[0-9]+|× |⚠️" /tmp/browser-run.out | tail -4

if [ "$before" = "$after" ]; then
  echo "ARTIFACT_STABLE=1  ⇒ 读数有效（vitest exit=$code）"
else
  echo "★★ ARTIFACT_CHANGED ⇒ **该轮作废、不出结论**（两次产物代已打印在上）"
fi
exit "$code"
