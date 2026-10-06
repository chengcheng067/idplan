# ID Plan 插件 API

给第三方开发者的插件接口规范。**30 分钟能写出第一个插件**——如果你会写 React + TypeScript，你现在就会写 ID Plan 插件。

> 这不是一个「平台梦」，这是一份**能跑的契约**：本规范描述的每一个出口，都在
> `src/core/plugin/` 与 `src/core/project/visibility.ts` 里真实存在，且被单测钉死。
> 凡本规范承诺的能力，你拿去就能用；v1 做不到的事，本文一律直说，不做空头支票。

## 三句话

1. **插件是编译期内置的功能包**：宿主在构建期 import 你的代码，用户随时能在「设置 → 插件」里启用/停用。**停用是真开关**——它的路由从不进入 router 数组、侧栏入口从不渲染（不是置灰、不是隐藏）。
2. **插件是声明式数据**：manifest 只说「我是谁、我要什么能力、我贡献哪些路由/入口/设置区块」。**没有 `activate(hooks)` 这类回调宿主的活口**——那是绕过审计的唯一入口。
3. **v1 插件是只读的**：能读人类侧的项目数据，读不了仓储、写不了库。为什么只有只读，见 [契约 §1.2.3](./contract.md#123-capabilitiesv1-为什么只有-dataread坦诚说明)。

## 30 秒上手

```bash
# 1. 拉仓库、装依赖、跑起来
git clone https://github.com/chengcheng067/idplan.git && cd idplan
npm install && npm run dev

# 2. 抄最小 manifest（契约 §1.2.2 有完整版）：
#    src/plugins/<你的插件>/manifest.tsx

# 3. 加一行到装配清单（src/core/plugin/PluginRegistryProvider.tsx 的
#    BUILTIN_MANIFESTS 数组）——路由、侧栏、设置三处装配全部从这张表派生，
#    不需要改别处。

# 4. 打开设置 → 插件 → 找到你的插件 → 打开开关
```

## 读什么

| 文档 | 内容 |
|---|---|
| [**contract.md**](./contract.md) | manifest 字段总表、只读数据出口清单、三个贡献点写法、硬禁令、样式 token 表 |
| [**example.md**](./example.md) | 完整示例「会议室占用看板」：manifest + 纯函数 + 面板 + 单测，可直接抄 |
| [**review-checklist.md**](./review-checklist.md) | 提交 PR 前的自检清单，以及我们审什么 |

## 当前状态（v1）

| 能力 | 状态 |
|---|---|
| `data.read`（读人类侧项目/阶段/任务） | ✅ 已实现，稳定 |
| routes / nav / settingsSlot 三个贡献点 | ✅ 已实现（nav 的 `main` 组渲染于 2026-10-07 补齐） |
| `data.write.proposal`（写提案，落库由人批） | 🚧 设计已定，等归属门下沉（F8） |
| `file.pick` / `storage.kv` | 📋 规划中 |
| 从文件安装（不重新构建） | 🚧 开发中 |
| 远程市场 / 一键下载 | ❌ v1 不做（要签名体系，见架构决策文档） |

> **想现在就能拿到别人的插件？** 目前插件的分发形态是「进 PR → 合并 → 随下个版本安装包分发」。
> 「从文件安装」正在做（装前会把 manifest 与能力清单摊给你看，只读起步）。

## 参与方式

1. 读 [contract.md](./contract.md)，抄 [example.md](./example.md)
2. 自检 [review-checklist.md](./review-checklist.md)
3. 提 PR 到 `src/plugins/<你的插件>/`，PR 描述里**贴两张截图**：亮色主题一张、暗色主题一张

我们审五件事：只读性 / 样式 token / 无全局副作用 / 顶层纯净 / 有单测。细节在 review-checklist。
