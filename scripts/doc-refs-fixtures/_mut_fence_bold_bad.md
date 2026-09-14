# 加粗式 + 行中开栏毒丸（声明 3，实列 2 → 必须报错）

| 项 | 设计 |
|---|---|
| ⚠️ 回退点 | 回退只需改一个字面量：<br><br>```ts
export const PERSIST = true;
```<br>**实现约束**：只能经导出函数。 |

**新增（3 个）**
- `src/core/planned-x.ts`
- `src/core/planned-y.ts`
