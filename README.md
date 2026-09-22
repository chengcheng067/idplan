<p align="center">
  <img src="./public/logo.png" alt="ID Plan Logo" width="120" />
</p>

<h1 align="center">ID Plan</h1>

<p align="center">
  <strong>把项目拆成一张看得懂的阶段时间轴 —— 离线优先的项目排程工具。</strong>
</p>

> ID Plan 从室内设计场景起步，现在覆盖 **7 个行业大类 / 9 个主板块**。把项目的金额、类型、阶段节点、参与成员整理成一条时间轴，用看板、月历、甘特随时掌握进度，并把排期导成能直接发给甲方的交付页。

当前版本：**v0.8.0（构建号 0.8.0.0006）**

---

## ✨ 功能亮点

### 🧭 建档：先选行业，再出阶段
- **三层级联建档** —— 行业大类 → 主板块 → 阶段套餐。首次打开**不做任何预选**，选定主板块后才会带出对应的套餐与阶段。
- **9 个主板块** —— 室内 / 景观 / 建筑 / 软件开发 / 市场活动 / 影视制作 / 婚礼策划 / 咨询交付 / 旅游出行。
- **21 套阶段套餐** —— 每个主板块都有贴合自身流程的阶段（不是把室内九段换个名字照搬）。例如旅游是「规划 → 行程设计 → 资源预订 → 行前确认 → 执行 → 结算 → 复盘」，软件开发是「规划 → 设计 → 开发 → 测试 → 发布」。
- **看板列随主板块变化** —— 室内是设计 / 深化 / 施工，影视是筹备 / 拍摄 / 后期 / 交付，不共用一套列。

### 📐 排期与交付
- **休息制度可配置** —— 大休 / 小休、单休 / 双休，排期自动跳过休息日，竣工日期算得准。
- **多视图** —— 看板、月历、可拖拽改期的甘特时间轴。
- **打印 / 导出** —— 日程表 A4 打印视图、导出 PNG 高清图。
- **旅游客户行程单** —— 旅游项目按项目起止日期生成每日行程卡（交通 / 住宿 / 预算 / 实际），可打印成给客户看的行程单；非旅游项目不显示。
- **双主题** —— 亮 / 暗 / 跟随系统三态。

### 👥 协同
- **任务指派** —— 任务可指派多个成员，参与人可勾选完成，进度实时同步。
- **角色权限** —— 管理员看全貌；普通成员只看与自己相关的项目与任务。
- **成员看板** —— 每位成员登录后看到的是自己相关的项目进度。
- **密码登录** —— 管理员可为成员单独设置 / 清除密码。

### 🤖 AI 协作（建设中）
- **本机自动导入（已可用）** —— 桌面端在 `127.0.0.1:17788` 提供本机 loopback 通道，WorkBuddy / Codex 等外部 Agent 可以把任务直接写进 ID Plan。
- **手动粘贴兜底（已可用）** —— 内置可复制的导入提示词与 JSON 模板，不连通道也能导入。
- **执行控制台（数据层已就绪，界面未接）** —— 已落地执行域数据层：`Execution` / `ExecutionAttempt` / `ExecutionEvent` / `WritebackProposal`，状态机在**存储边界**强制（未人工确认不得执行、完成必须存在已审批的写回提案、每次重试保留独立 attempt）。但**还没有执行控制台界面，也没有从 ID Plan 发起执行的出口**。
- **NAS 远程写入未启用** —— 目前只做连通探测，不自动写入。

### 🔒 授权（MVP）
- 离线 Ed25519 签名许可证：机器码取自 Windows `MachineGuid`，验签在主进程用公钥完成，零联网。
- **当前只显示授权状态，不拦截功能** —— 未授权也能正常使用。是否升级为硬门禁尚未决定。

### 💾 数据
- **备份恢复** —— 一键导出 / 导入 JSON 备份，格式全量校验；旧版本备份可安全导入。
- **离线优先** —— 桌面版数据存本机 IndexedDB，不依赖网络。

---

## 🖥️ 支持平台

| 平台 | 方式 | 说明 |
|------|------|------|
| **Windows** | 桌面版安装包 | 独立桌面应用，数据存本机，适合个人使用 |
| **绿联 NAS** | UPK 应用包 / Docker | 数据集中存 NAS，团队共享 |
| **浏览器** | 访问 NAS Docker 版 | Mac / 手机都能通过浏览器访问 NAS 上部署的版本 |

> **关于 Mac**：没有发布 Mac 原生安装包。Mac 用户请部署 **绿联 NAS 上的 Docker 版**，然后用浏览器访问 `http://<NAS的IP>:28080`（与 Windows 用浏览器访问 NAS 的方式一致）。

---

## 🚀 安装方式

### 方式一：Windows 桌面版（推荐个人使用）

下载安装包双击即装，桌面与开始菜单生成「ID Plan」快捷方式，数据存在**本机**。

- 📄 详细步骤：[docs/install/windows-install.md](docs/install/windows-install.md)

> 无代码签名证书，Windows SmartScreen 可能提示「未知发布者」→ 点**更多信息** → **仍要运行**。

### 方式二：绿联 NAS（推荐团队共享）

数据集中在 NAS 上，所有人看到同一份，不用手动导 JSON。只需要一台绿联 NAS（UGOS Pro）+ 一个浏览器，不需要装 Docker 工具。

- 📦 **UPK 应用包**（最省事）：[docs/install/upk-install-tutorial.md](docs/install/upk-install-tutorial.md)
- ⚙️ **Docker compose**（手动配容器）：[docs/install/nas-deploy-tutorial.md](docs/install/nas-deploy-tutorial.md) · [idplan-nas-compose.yml](docs/install/idplan-nas-compose.yml)

部署完成后，Windows / Mac / 手机都能用浏览器访问 `http://<NAS的IP>:28080`。

### 方式三：Docker（通用 / 自建服务器）

前后端分离，两个镜像发布在 ghcr：

```bash
ghcr.io/chengcheng067/idplan:<版本>          # 前端（nginx 托管页面 + /api 反代）
ghcr.io/chengcheng067/idplan-backend:<版本>  # 后端（Fastify + SQLite）
```

镜像由 [docker-build.yml](.github/workflows/docker-build.yml) 手动触发构建，标签即触发时填写的版本号。

---

## 📦 下载地址

所有发布产物都挂在 GitHub **Releases**：
👉 **https://github.com/chengcheng067/idplan/releases**

| 平台 | 最新产物 | 说明 |
|------|----------|------|
| Windows | `IDPlan-0.8.0.0006-Setup.exe`（构建号 0006） | 桌面安装，个人使用 |
| 绿联 NAS (amd64) | `amd64_com.chengcheng.idplan_0.7.0.0001.upk` | UGOS Pro 手动导入 |
| Docker 镜像 | `ghcr.io/chengcheng067/idplan-backend:<版本>` 等 | 离线导入 / 自建 |

> 架构选择：绝大多数 Intel 系 NAS 用 **amd64**；arm64 仅 Apple Silicon / 部分 ARM 机型。

---

## 🛠️ 技术栈

| 层 | 技术 |
|---|------|
| 桌面壳 | Electron 44 |
| 前端框架 | Vite 5 + React 18 + TypeScript 5 |
| 状态管理 | Zustand |
| 本地存储 | Dexie 4（IndexedDB） |
| 样式 | Tailwind CSS 3 |
| 服务端 | Fastify 4 + SQLite（团队共享数据层） |
| 校验 | Zod |
| 测试 | Vitest + fake-indexeddb |
| 打包 | electron-builder → NSIS（Windows） / 绿联 UPK |

### 本地开发

```bash
npm install

npm run dev              # 前端 http://localhost:5173
npm run dev:server       # 后端（需 remote 数据源时）
npm run dev:all          # 前后端一起起

npm run typecheck        # 前端类型检查
npm run typecheck:server # 服务端类型检查
npm test                 # 全量单测（vitest run）
npm run build            # 类型检查 + 构建

npm run electron:dev     # 桌面形态开发运行
npm run electron:build   # 构建 + 打 Windows NSIS 安装包
```

> **数据源**：`.env.local` 里 `VITE_DATA_SOURCE=local`（本地 IndexedDB，默认）或 `remote`（NAS 后端）。进程启动时定型，改完需重启。
>
> **跑测试前请先 `npm run build`**：有一批真浏览器几何验收用例依赖 `build-dist` 产物，没构建会被整批跳过。**被跳过的用例不算通过。**

---

## 📖 文档

- 🪟 **Windows 安装**：[docs/install/windows-install.md](docs/install/windows-install.md)
- 📦 **绿联 NAS · UPK**：[docs/install/upk-install-tutorial.md](docs/install/upk-install-tutorial.md)
- ⚙️ **绿联 NAS · Docker**：[docs/install/nas-deploy-tutorial.md](docs/install/nas-deploy-tutorial.md)
- 🗂️ **备份格式**：[docs/backup-format.md](docs/backup-format.md)
- 🔌 **接口契约**：[docs/api-contract.md](docs/api-contract.md)
- 🧪 **迁移演练**：[docs/migration-drill.md](docs/migration-drill.md)

---

## 🗺️ 当前状态

| 能力 | 状态 |
|------|------|
| 多行业建档、排期、看板 / 月历 / 甘特、打印导出 | ✅ 可用 |
| 旅游每日行程与客户行程单 | ✅ 可用 |
| 本机 loopback 自动导入、手动粘贴导入 | ✅ 可用 |
| 离线授权验签 | 🟡 MVP，仅显示状态，不拦功能 |
| Agent 执行控制台界面 | 🔴 未接（数据层已就绪） |
| 从 ID Plan 发起并追踪 Agent 执行 | 🔴 未接（目前只有外部写入通道） |
| NAS 远程自动写入 | 🔴 未启用（仅连通探测） |

---

## 🤝 如何参与共创

- **反馈功能 / 提 Bug** —— 提 Issue 或直接 PR
- **补充行业模板** —— 熟悉某个行业就提交模板 PR（阶段库是纯 JSON 增量，零迁移）
- **改进交互 / 视觉** —— UI 文案、操作路径、图标优化
- **贡献代码** —— 用 vitest 写测试，欢迎提 PR；注意本项目为**专有软件**，提交即表示同意将贡献并入本仓库，不额外授予开源许可

---

## ⚖️ 许可

本仓库是**专有软件**。源码公开用于展示与收集反馈，但**未授予任何使用、复制、修改、合并、发布、分发或再分发的许可**，默认保留所有权利。

如需商用授权、二次开发或部署给第三方，请通过 [GitHub Issues](https://github.com/chengcheng067/idplan/issues) 与作者联系。

---

## 💬 写在最后

这个项目始于一个简单的想法：**设计师不应该在项目管理上浪费时间。**

我的设计师朋友丞丞说，每次做项目，光是记阶段节点、排工期、跟成员对齐进度就耗掉大半天。于是我们决定做一个工具——把项目的阶段、任务、成员、排期放在一个地方，让进度管理在同一次操作中完成，还能一键导出给甲方看。

如果你有类似的需求，或者对这个项目有任何想法，欢迎提 Issue 或 PR。我们一起让它变得更好。

> **ID Plan — 阶段清晰，进度可见。**

---

© 2026 ChengCheng · [GitHub](https://github.com/chengcheng067/idplan)
