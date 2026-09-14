# 变异测试文档

普通散句引用一个不存在的文件：`src/core/nope.ts:12`

## 新增（1）
- `src/core/planned-a.ts`

## 新增（3）
- `src/core/planned-b.ts`
- `src/core/planned-c.ts`

行号越界：`src/core/lib/task-no.ts:99999`

豁免行：`src/core/planned-a.ts` 与 `src/core/lib/task-no.ts` <!-- refs-ignore planned-a.ts -->
