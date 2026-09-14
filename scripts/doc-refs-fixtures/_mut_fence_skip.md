# 围栏内路径必须仍被跳过（回归护栏）

普通行：`src/core/planned-z.ts`

```ts
// 这段代码里的路径**不该**被当成引用
import { x } from 'src/core/inside-fence-1.ts';
const y = require('src/core/inside-fence-2.ts');
```

围栏后再来一条：`src/core/planned-w.ts`
