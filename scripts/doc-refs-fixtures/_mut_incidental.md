# 计数语义断言：分节内的「顺带提及」**不计入**（声明 2 / 实列 2 → `--strict-counts` 必须 exit 0）

<!-- 锁定的语义（2026-09-14 领队复跑确认）：
     对账单位 = 块级条目（列表项 / 表格数据行），**不是 code span 数量**。
     下面第 9 行 planned-x 后面还有一个顺带的 tmp/build_palette2.py，两个 span 同属一项 → 仍只算 1 条。
     旧口径按 span 数 ⇒ 数成 3 条，在**正确的**真文档 v0.8 §4.1（声明 17 / 实列 17）上误报「差异 +1」，已被本次修正。
     注：本段刻意**不写反引号**——写了就会让这段注释本身变成待校验的路径引用。 -->

**新增（2 个）**
- `src/core/planned-x.ts`（与 `tmp/build_palette2.py` 逐行对齐）
- `src/core/planned-y.ts`

## 新增（2）
- `src/core/planned-p.ts`（参考 `tmp/build_palette2.py`）
- `src/core/planned-q.ts`
