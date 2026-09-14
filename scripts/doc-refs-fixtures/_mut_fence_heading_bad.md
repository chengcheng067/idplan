# 标题式 + 行中开栏毒丸（声明 3，实列 2 → 必须报错）

这一格是照抄真实文档的形状：围栏开栏写在**行中**，不是行首。

| 项 | 设计 |
|---|---|
| ⚠️ 回退点 | 回退只需改一个字面量：<br><br>```ts
// src/core/services/custom-stage.service.ts
export const PERSIST = true;
```<br>**实现约束**：所有读写只能经导出函数。 |

### 4.1 新增（3）
- `src/core/planned-b.ts`
- `src/core/planned-c.ts`
