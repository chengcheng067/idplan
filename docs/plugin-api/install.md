# 从文件安装（本地安装 · L2）

不重新构建、不进 PR、不等发版——用户拿你产出的一个目录，在「设置 → 插件」里选 `manifest.json` 装上，重启即可用。

> 这是与[编译期内置](./contract.md)**并行**的第二套契约：内置走构建期 import，本页走磁盘落盘。
> 两套互不影响——内置 manifest 不填本页的字段，自装产物不进 `src/plugins/`。
>
> **v1 实话**：自装插件跑在沙箱 iframe 里（摸不到宿主的其它数据），但**v1 没有 CSP 切片，你的插件运行时可访问网络**。规范要求「能不访就不访」；启用前的告知里我们对用户直说这件事，你这边也别装作没有。

## 60 秒装一个示例

```bash
# 1. 造一个最小插件目录（IIFE 形态）
mkdir my-plugin && cd my-plugin

# 2. manifest.json——比内置 manifest 多三个字段：entry / installVersion / minHostVersion
cat > manifest.json <<'JSON'
{
  "id": "my-plugin",
  "name": "我的第一个自装插件",
  "summary": "读项目数据，在沙箱里画个计数器",
  "version": "1.0.0",
  "entry": "index.js",
  "capabilities": ["data.read"]
}
JSON

# 3. 入口产物——单文件 IIFE，只挂 window.IDPlanPlugin 这一个全局
cat > index.js <<'JS'
window.IDPlanPlugin = {
  mount(api) {
    let ticks = 0;
    const root = document.createElement('div');
    root.style.padding = '16px';
    document.body.appendChild(root);
    const render = () => {
      root.textContent =
        `v${api.version} · ${api.theme} · 项目 ${api.getProjects().length} 个 · ticks ${ticks}`;
    };
    render();
    const timer = setInterval(() => { ticks++; render(); }, 1000);
    return {
      unmount() { clearInterval(timer); root.remove(); },
    };
  },
};
JS

# 4. 在 ID Plan：设置 → 插件 → 「从文件安装」→ 选这个目录里的 manifest.json → 重启
```

装完后默认**关闭**。重启后在设置里找到它，打开开关（首次启用前会再问一次），
内容区就会被这个插件整页接管，顶条上有「回到主界面」可随时退出。

## manifest 字段（自装专属增补）

在[内置契约](./contract.md)的 `id / name / summary / version` 之外，自装 manifest 只认这些：

| 字段 | 必填 | 说明 |
|---|---|---|
| `entry` | ✅ | 入口文件名：`index.js` / `index.mjs`（IIFE，宿主注入）或 `index.html`（整页）。**不允许带路径**（`sub/index.js` 会被拒） |
| `installVersion` | — | 安装器写的版本标记，覆盖写后用户在设置里看得见装了哪版 |
| `minHostVersion` | — | 宿主最低版本（如 `0.8.6`）。宿主低于它 ⇒ 启动扫描跳过并提示，**不进注册表** |
| `capabilities` | — | v1 只有 `data.read` 一项；声明别的会被静默滤掉（写/网/文件保存都不在 v1） |
| `defaultEnabled` | — | **写了也不算**：合并进注册表时强制 `false`。装与开是两件事 |

不认的字段（路由/侧栏/settingsSlot/recommends 等内置贡献点）：磁盘 JSON 变不出 React 组件，
声明了也被忽略。自装插件的唯一界面出口就是 `entry` 指向的沙箱整页。

**校验规则**（安装时逐条过，任一不过即拒并给中文理由）：

- `id` 匹配 `^[a-z0-9][a-z0-9-]{0,63}$`（小写+中划线；`..`、大写、空格一律拒）
- `name` / `version` / `entry` 必填且为非空字符串
- `entry` 声明的文件必须真实存在于所选目录
- 目录总体积 ≤ 5MB（v1 粗限）
- 同名 `id` = **整目录覆盖写**（先删旧再整体复制，不留上一个版本的孤儿文件）；版本号以 `version` 为准

## 两种产物形态（按 `entry` 自动分流）

### A. IIFE 单文件（`entry: "index.js"`）

产物只允许做一件事：在 `window` 上挂 `IDPlanPlugin`。宿主把它注入沙箱 iframe 后代你调 `mount(api)`。

```js
window.IDPlanPlugin = {
  mount(api) {
    // api.version / api.theme：见下文
    // api.getProjects() / getStages() / getTasks()：最近一次广播里的数据
    // api.onSnapshot(cb)：宿主持数据变化主动广播时的回调（返回取消订阅函数）
    const off = api.onSnapshot((snap) => { /* 重新渲染 */ });
    return {
      unmount() { off(); /* 清定时器 / 监听 / DOM */ },
    };
  },
};
```

**契约（六条，硬性）：**

1. 顶层只挂 `window.IDPlanPlugin = { mount(api) → { unmount() } }` 这一个全局，不挂别的；
2. 不得 `import` / `require` 任何东西（沙箱里没有模块解析）；React 等依赖请以 UMD 形式自带进产物；
3. `mount` 返回的句柄必须有 `unmount()`，且它必须**真停**：清定时器、监听、DOM。
   宿主停用插件时会先请你 `unmount` 再摘 iframe——你不停，用户以为停了其实还在跑；
4. **不得轮询**。数据变化由宿主持 `postMessage` 广播（`api.onSnapshot` 即订阅它）；
5. `mount` 之外不得持有副作用（顶层执行 = 用户还没启用就已在跑，安装即运行）；
6. 不得 `postMessage` 到 `'*'`，回消息用宿主告知的精确 origin（IIFE 形态下由宿主胶水代劳，你通常不需要自己发）。

### B. 整页（`entry: "index.html"`）

插件是一个自带 HTML/CSS 的页面，`plug://<你的id>/…` 下的资源都能引用。页面自己实现快照接收：

```html
<script>
  // 开始监听后先向宿主报到（宿主收到 ready 会立即补推当前快照，防你错过挂载瞬间那条）
  parent.postMessage({ v: 1, type: 'idplan-plugin-ready' }, '*');
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.v !== 1 || d.type !== 'idplan-plugin-snapshot') return;
    // d.snapshot = { version, theme, projects, stages, tasks }（深拷贝，改它不影响宿主）
    document.title = `项目 ${d.snapshot.projects.length} 个`;
  });
  // 尊重卸载请求（宿主停用时发来；清完场回个 ack，宿主最多等 600ms）
  window.addEventListener('message', (e) => {
    if (e.data && e.data.v === 1 && e.data.type === 'idplan-plugin-unmount') {
      // 清理……
      parent.postMessage({ v: 1, type: 'idplan-plugin-unmount-ack' }, '*');
    }
  });
</script>
```

消息协议四个类型由单一出处定义：`src/core/plugin/installed.ts` 的 `PLUGIN_MSG`
（`idplan-plugin-snapshot / -ready / -unmount / -unmount-ack`），`v: 1` 为协议版本。

## 你能拿到什么数据（api 契约）

| 出口 | 内容 | 口径 |
|---|---|---|
| `api.version` | 宿主四段版本（x.y.z.build） | 随快照变 |
| `api.theme` | `'light' \| 'dark'`（已解析 system） | 随快照变 |
| `api.getProjects()` | 人类侧项目全量 | **深拷贝**：对返回值的任何写操作碰不到宿主 |
| `api.getStages()` / `api.getTasks()` | 挂在上述项目下的阶段/任务 | 同上 |
| `api.onSnapshot(cb)` | 订阅后续广播（宿主每次数据变化都推） | 返回取消订阅函数 |

新鲜度 = 最近一次宿主广播（数据变化后宿主持推，通常同一两帧内到达）。
**Agent 看板（`kind: 'agent'`）的数据不在快照里**——那是 AI 工作区，不属于人类侧项目数据。

## 你拿不到什么（机制上被挡死，不是君子协定）

| 尝试 | 结果 |
|---|---|
| 读 parent DOM / `window.idplan` / 宿主全局 | `SecurityError`（沙箱无 `allow-same-origin`） |
| `localStorage` / `indexedDB`（宿主库） | `SecurityError` |
| 写宿主的任何数据 | 不存在写出口（v1 只有只读快照这一条通道） |
| 宿主文件系统 / spawn 进程 | 无通道 |
| 导入宿主的 React 树 / 路由 / context | 结构上不可能（iframe 是另一个文档） |

> 也不要尝试降级方案——比如把数据 fetch 到你自己服务器的「托管副本」= 数据外传，等同违规。

**但网络出口是开着的**：沙箱不管网络，v1 未做 CSP 切片。`fetch('https://…')` 实测能通。
规范要求：能不访就不访；要访就只访你插件功能必需的端点。启用前我们对用户的告知里
写明「本插件运行时可访问网络」——你别让这句话变成谎言。

## 安装 / 启用 / 卸载的用户可见流程

1. **装**：选 `manifest.json` ⇒ 先弹披露（代码来自你选的文件 / 只读数据 / **可以访问网络** /
   重启生效）⇒ 确认后校验落盘 ⇒ 启用 KV 强制写 `false`（id 复用不继承旧启用态）；
2. **启用**：重启后扫描登记（默认关、版本可见）⇒ 拨开关前首次会再确认一次 ⇒ 内容区被沙箱
   iframe 整页接管（顶条有「回到主界面」随时退出）；
3. **停**：拨开关即停——宿主持请 `unmount`（清你的定时器/DOM），收到回执（最多等 600ms）后摘除；
4. **卸**：二次确认 ⇒ 先停用再删目录 ⇒ 重启后从列表消失。只删目录，不碰任何数据
   （你本来就写不了）。

## 已知限制（v1，诚实清单）

- **重启才生效**：登记入口唯一 = 启动扫描，运行期不热加载。这不是偷懒，是把「安装/卸载竞态」
  压到零（覆盖安装时旧版可能正挂在 iframe 里跑）；
- **多插件只能跑一个**：多个同时启用时取注册表序第一个整页显示，没有分栏/切换器；
- **没有签名 / 没有市场**：文件从哪来、是不是被改过，宿主不校验——这就是启用前要披露的原因；
- **没有 CSP**：网络出口见上；
- **没有热更新 / 配置保留**：卸载即全部删除，不保留你的用户配置；
- 体积上限 5MB；asar 打包后的可用性与大产物挂载性能未压测（v1 粗限兜底）。

## 排障

| 现象 | 原因 |
|---|---|
| 装完设置里没有 | 没重启（登记只在启动扫描） |
| 启用后整页空白 | IIFE 没挂 `window.IDPlanPlugin`（3 秒不就绪宿主会显示错误条）；或 `entry` 文件不存在 |
| 内容区一直是宿主页面 | `entry` 不是 `.html/.htm/.js/.mjs`（安装时就会被拒） |
| 快照一直是旧的 | 你没监听 `onSnapshot`/`message`，只在 mount 时读了一次 |
| 停用后计时器还在跑 | `unmount()` 没清场——你的契约违背，验收 spec 同款断言会抓到 |

作者自检清单（提 PR 给内置插件时看 [review-checklist.md](./review-checklist.md)）；
自装产物不在本仓库，上面「契约六条」就是你的验收标准。
