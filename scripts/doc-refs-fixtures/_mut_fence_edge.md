# 围栏边界用例

开合同行（偶数个围栏 → 状态不该翻转）：行内 ```` ``` ```` 示例。

真引用 A：`src/core/edge-a.ts`

````ts
// 四反引号围栏（内含三反引号）里的路径不该被数
import { q } from 'src/core/inside-fence-3.ts';
````

真引用 B：`src/core/edge-b.ts`

## 新增（2）
- `src/core/edge-c.ts`
- `src/core/edge-d.ts`
