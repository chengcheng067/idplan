<p align="center">
  <img src="./public/logo.png" alt="ID Plan Logo" width="120" />
</p>

<h1 align="center">ID Plan</h1>

<p align="center">
  <strong>把项目拆成一张看得懂的阶段时间轴 —— 离线优先的项目排程工具。</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/version-0.8.6.0005-blue.svg" alt="version" />
  <img src="https://img.shields.io/badge/tests-2109%20passing-brightgreen.svg" alt="tests" />
  <img src="https://img.shields.io/badge/Electron-44-47848F.svg" alt="Electron" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20NAS%20%7C%20Browser-lightgrey.svg" alt="platform" />
</p>

> 🌐 [English](./README.en.md) · 中文

> 覆盖 **45 个类目 / 1087 条阶段规范**（室内 / 景观 / 建筑 / 软件 / 市场 / 影视 / 婚礼 / 咨询 / 旅游等）。把项目的金额、类型、阶段节点、参与成员整理成一条时间轴，用看板、月历、甘特随时掌握进度，并把排期导成能直接发给甲方的交付页。
> **还能让外部 AI 写方（WorkBuddy / Codex 等）读一个文件就完成接入，把任务直接写进你的看板**——见 [🤖 Agent 接入](#-agent-接入)。
> **插件系统已开放**：接口规范跟代码同仓，任何人都能照规范写一个插件装进来——见 [🧩 插件](#-插件)。

---

## 💡 为什么做这个

这个工具从室内设计的日常工作里长出来（我自己的老本行），现在服务所有需要排期的行业。每次做项目，光是记阶段节点、排工期、跟成员对齐进度就耗掉大半天：把项目的阶段、任务、成员、排期放在一个地方，进度管理在同一次操作里完成，还能一键导出给甲方看。**阶段清晰，进度可见。**

它现在有三种形态：**Windows 桌面版**（数据本机）、**绿联 NAS 版**（团队共享）、**浏览器/Docker 版**。三者共用同一套排期引擎与阶段库。

---

## ✨ 功能亮点

### 🧭 建档：先选行业，再出阶段
- **三层级联建档** —— 行业大类 → 主板块 → 阶段套餐。首次打开**不做任何预选**，选定主板块后才会带出对应的套餐与阶段。
- **45 个类目** —— 室内 / 景观 / 建筑 / 展陈 / 软件开发 / 市场活动 / 影视制作 / 婚礼策划 / 咨询交付 / 旅游出行……每个类目都有贴合自身流程的阶段，不是把室内九段换个名字照搬。
- **看板列随主板块变化** —— 室内是设计 / 深化 / 施工，影视是筹备 / 拍摄 / 后期 / 交付，不共用一套列。
- **自己的行业自己定** —— 内置库不合脚？设置里「复制提示词 → 发给你的 Agent → 导回」，三步生成一套你自己的行业库。

### 📐 排期与交付
- **休息制度可配置** —— 大休 / 小休、单休 / 双休，排期自动跳过休息日，竣工日期算得准。
- **多视图** —— 看板、月历、可拖拽改期的甘特时间轴。
- **月历一眼报得出项目名** —— 格内条目是「项目色 + 项目名」；一天放不下就「+N」点开当日全部，不再有堆成一片认不出谁是谁的彩条。
- **打印 / 导出** —— 日程表 A4 打印视图、导出 PNG 高清图；「适应 / 100%」缩放可用。
- **双主题** —— 亮 / 暗 / 跟随系统三态。

### 👥 协同
- **任务指派** —— 任务可指派多个成员，参与人可勾选完成，进度实时同步。
- **角色权限** —— 管理员看全貌；普通成员只看与自己相关的项目与任务（设置分区也跟着身份收）。
- **成员看板** —— 每位成员登录后看到的是自己相关的项目进度；管理员搜成员名或点成员列表，直达任意成员的逾期 / 进行中 / 近期完成。
- **密码登录** —— 管理员可为成员单独设置 / 清除密码。

### 💾 数据
- **备份恢复** —— 一键导出 / 导入 JSON 备份，格式全量校验；旧版本备份可安全导入。
- **离线优先** —— 桌面版数据存本机 IndexedDB，不依赖网络。

---

## 🧩 插件

ID Plan 的界面是一组**贡献点**拼出来的：路由、侧栏入口、设置分区。注册表统一装配，插件开关是**真开关**——关掉，它的路由从不进路由表、侧栏入口从不渲染（不是置灰、不是隐藏）。

**装一条插件有三条路**（当前版本的真实能力，不画饼）：

| 路径 | 怎么装 | 适合谁 |
|---|---|---|
| **随版本分发** | 插件合并进本仓库 `src/plugins/`，随安装包发布，在设置 → 插件里启用 | 所有人（当前主流） |
| **从文件安装** | 设置 → 插件 → 从文件安装：选一个插件文件，装前把 manifest 与能力清单摊给你看，沙箱加载、只读起步 | 想试别人插件的人 |
| **远程市场** | ❌ v1 不做（要签名体系， roadmap 里挂着） | — |

**安全边界说在前头**：v1 插件只能**只读**人类侧项目数据（拿不到仓储、写不了库——这是静态守卫钉死的，不是口头约定）；外来代码跑在沙箱 iframe 里，摸不到你的页面和本地库；但它**可以访问网络**（装前会明说，治本的 CSP 在 roadmap 上）。

**想写一个？** 接口规范跟代码同仓，30 分钟能抄出第一个：

- 📜 [**插件契约**](./docs/plugin-api/contract.md) —— manifest 字段、只读数据出口、三个贡献点、硬禁令、样式 token
- 🧪 [**完整示例**](./docs/plugin-api/example.md) ——「会议室占用看板」，manifest + 面板 + 单测，可直接抄
- ✅ [**提交前自检**](./docs/plugin-api/review-checklist.md) —— 我们审的五件事

提 PR 到 `src/plugins/<你的插件>/` 就行——**代码共享同一个构建，评审合并后随下个版本分发**；或者把你的插件文件发给别人，让他们「从文件安装」。这就是「开放共创」在当前阶段的真实形状：写方照契约写，装方看得见自己装了什么。

---

## 🤖 Agent 接入

ID Plan 内置一条**本机 loopback 通道**（`127.0.0.1:17788`），让外部 AI 写方成为排程工具的一等公民：

- **一键接入** —— 接入面板生成**固定路径的接入文件**（地址 / 令牌 / 端点 / payload schema 全在其中），外部 Agent 读一个文件即完成接入，令牌轮换后重读即可
- **自助建板** —— 写方可自己创建 Agent 看板（名称 + 起止日期 + 阶段集合，缺一即拒）
- **幂等导入** —— `idplan-agent-payload/v1` schema；幂等键 `externalId`，重放不重号；依赖按 `externalId` 解析；支持 dryRun 预览（所见即所写）
- **读回核对** —— 任务流只读接口，写方可随时核对落库结果
- **提案审批** —— 外部写方的改动以「提案」形态落到执行记录页，人看过再落库（审计动作不外包给 Agent）
- **结构性隔离** —— 落点只能是 Agent 看板（`kind=agent`），**人类项目一律拒绝**（`project_unresolved`）；门在共享核心单点实现，桌面 / NAS 两通道同码
- **手动兜底** —— 不连通道时，内置可复制的导入提示词与 JSON 模板

Agent 看板本身也是一个插件（设置 → 插件可关）——**它证明这套插件系统能扛最复杂的功能**。

---

## 🚀 快速开始

```bash
git clone https://github.com/chengcheng067/idplan.git
cd idplan
npm install

npm run dev            # 前端 http://localhost:5173
npm run electron:dev   # 桌面形态开发运行
```

```bash
npm test               # 全量单测（2109 用例，vitest）
npm run typecheck      # 前端类型检查
npm run build          # 类型检查 + 构建
npm run electron:build # 构建 + 打 Windows NSIS 安装包
```

> **跑测试前请先 `npm run build`**：有一批真浏览器几何验收用例依赖 `build-dist` 产物，没构建会被整批跳过——**被跳过的用例不算通过**。
>
> **数据源**：`.env.local` 里 `VITE_DATA_SOURCE=local`（本地 IndexedDB，默认）或 `remote`（NAS 后端），进程启动时定型，改完需重启。

## 🏗️ 架构

```
┌─ Electron 桌面壳（Windows）───────────────────────┐
│  主进程：loopback HTTP 通道（IPC 转发渲染侧落库）   │
│  渲染层：React 18 + Zustand + Dexie(IndexedDB)     │
│  插件层：manifest 声明贡献点，注册表统一装配        │
│          外来插件跑沙箱 iframe（只读数据面）        │
├─ 浏览器 / NAS 形态 ──────────────────────────────┤
│  前端：同一份 React（build-dist）                  │
│  服务端：Fastify + SQLite（团队共享数据层）         │
├─ 共享核心（src/core） ────────────────────────────┤
│  payload.apply.ts：落点解析 / 归属门 / 幂等 / 环检 │
│  ↳ 桌面与服务端四路径同源（所见即所写）             │
└──────────────────────────────────────────────────┘
```

**双通道同语义**：Agent 四端点（health / boards / import / tasks）在桌面（loopback + IPC）与 NAS（Fastify）+ 真 SQLite 两侧实现同构；跨通道「同参同性」有专门回归 spec 钉死。

---

## 📦 安装与下载

### Windows 桌面版（个人使用）
下载安装包双击即装，数据存**本机**：📄 [安装步骤](docs/install/windows-install.md)
> 无代码签名证书，Windows SmartScreen 可能提示「未知发布者」→ 点**更多信息** → **仍要运行**。

### 绿联 NAS（团队共享）
数据集中在 NAS 上，所有人看到同一份。只需要一台绿联 NAS（UGOS Pro）+ 浏览器：
- 📦 **UPK 应用包**（最省事，**仅 amd64 机型**——arm64 机型见下）：[教程](docs/install/upk-install-tutorial.md)
- ⚙️ **Docker compose**（手动配容器，amd64 / arm64 均可）：[教程](docs/install/nas-deploy-tutorial.md) · [compose 文件](docs/install/idplan-nas-compose.yml)
- ℹ️ arm64 机型暂无 UPK 包（无真机验证环境，不做无验证发布）；Docker 镜像为多架构，compose 形态 arm64 直接可用

### Docker（通用 / 自建服务器）
```bash
ghcr.io/chengcheng067/idplan:<版本>          # 前端（nginx 托管页面 + /api 反代）
ghcr.io/chengcheng067/idplan-backend:<版本>  # 后端（Fastify + SQLite）
```

**所有发布产物都挂在 GitHub Releases**：👉 https://github.com/chengcheng067/idplan/releases

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
| 测试 | Vitest + fake-indexeddb（含真 Chromium 几何验收） |
| 打包 | electron-builder → NSIS（Windows） / 绿联 UPK |

---

## 📖 文档

- 🪧 [Windows 安装](docs/install/windows-install.md) · 📦 [NAS · UPK](docs/install/upk-install-tutorial.md) · ⚙️ [NAS · Docker](docs/install/nas-deploy-tutorial.md)
- 🧩 [**插件 API（契约 / 示例 / 自检）**](./docs/plugin-api/) · 🔌 [接口契约（Agent 四端点）](docs/api-contract.md) · 🗂️ [备份格式](docs/backup-format.md) · 🧪 [迁移演练](docs/migration-drill.md)
- 🗺️ [路线图（含「明确不做」清单）](docs/roadmap.md)
- 🧾 [发布 checklist（含 arm64 路线与踩坑汇编）](docs/release-checklist.md)

---

## 🗺️ 当前状态

| 能力 | 状态 |
|------|------|
| 多行业建档、排期、看板 / 月历 / 甘特、打印导出 | ✅ 可用 |
| 成员看板、按角色的设置与数据边界 | ✅ 可用 |
| 插件（注册表 / 真开关 / 沙箱加载 / 从文件安装） | ✅ 可用（v1 只读） |
| 行业库自定义（复制提示词 → 生成 → 导回） | ✅ 可用 |
| Agent loopback 自动导入、提案审批、执行记录 | ✅ 可用 |
| 插件写能力 / 远程市场 / CSP 出口管控 | 🚧 roadmap（见下） |
| NAS 远程自动写入 | 🔴 未启用（仅连通探测） |

**近期 roadmap 上的大事**（完整清单带「明确不做」，见 [roadmap](docs/roadmap.md)）：归属门下沉（写能力的地基）→ 插件写能力与 CSP 出口管控 → 作者工具链（脚手架 / 打包器）。

---

## 🤝 如何参与共创

- **写一个插件** —— 照着 [示例](./docs/plugin-api/example.md) 抄，30 分钟；提 PR 进 `src/plugins/`，或把文件发给别人「从文件安装」
- **补充行业模板** —— 熟悉某个行业就提交模板 PR（阶段库是纯 JSON 增量，零迁移）； app 内「复制提示词 → 发给你的 Agent → 导回」能帮你生成
- **反馈功能 / 提 Bug** —— 提 Issue 或直接 PR
- **改进交互 / 视觉** —— UI 文案、操作路径、图标优化
- **贡献代码** —— 用 vitest 写测试，欢迎提 PR；提交即表示同意将你的贡献以与本项目相同的 MIT 许可并入

> 装好软件后，**设置 → 关于** 有赞赏码和我的微信——用得顺手可以请我喝杯咖啡，用得别扭直接跟我说。

---

## ⚖️ 许可

本项目以 **[MIT License](./LICENSE)** 开源——你可以自由地使用、复制、修改、合并、发布、分发、再授权、销售本软件的副本（包括商用），唯一的要求是保留上述版权声明与许可声明。**商用无需另行授权，也不收费。**

> 设计意图：让更多设计师、小团队、学生对它敢用、敢改、敢二次分发，是这个工具活下去最好的方式。

---

## 💬 写在最后

如果你有类似的需求，或者对这个项目有任何想法，欢迎提 Issue 或 PR。我们一起让它变得更好。

> **ID Plan — 阶段清晰，进度可见。**

---

© 2026 杨雯丞（ChengCheng）· [GitHub](https://github.com/chengcheng067/idplan)
