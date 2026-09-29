<p align="center">
  <img src="./public/logo.png" alt="ID Plan Logo" width="120" />
</p>

<h1 align="center">ID Plan</h1>

<p align="center">
  <strong>把项目拆成一张看得懂的阶段时间轴 —— 离线优先的项目排程工具。</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/version-0.8.3.0001-blue.svg" alt="version" />
  <img src="https://img.shields.io/badge/tests-1836%20passing-brightgreen.svg" alt="tests" />
  <img src="https://img.shields.io/badge/Electron-44-47848F.svg" alt="Electron" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20NAS%20%7C%20Browser-lightgrey.svg" alt="platform" />
</p>

> 🌐 [English](./README.en.md) · 中文

> 从室内设计场景起步，现已覆盖 **9 个主板块 / 29 套阶段套餐**。把项目的金额、类型、阶段节点、参与成员整理成一条时间轴，用看板、月历、甘特随时掌握进度，并把排期导成能直接发给甲方的交付页。
> **还能让外部 AI 写方（WorkBuddy / Codex 等）读一个文件就完成接入，把任务直接写进你的看板**——见 [🤖 Agent 接入](#-agent-接入)。

---

## 💡 为什么做这个

我自己就是设计师。每次做项目，光是记阶段节点、排工期、跟成员对齐进度就耗掉大半天——于是做了这个工具：把项目的阶段、任务、成员、排期放在一个地方，进度管理在同一次操作里完成，还能一键导出给甲方看。**阶段清晰，进度可见。**

它现在有三种形态：**Windows 桌面版**（数据本机）、**绿联 NAS 版**（团队共享）、**浏览器/Docker 版**。三者共用同一套排期引擎与阶段库。

---

## ✨ 功能亮点

### 🧭 建档：先选行业，再出阶段
- **三层级联建档** —— 行业大类 → 主板块 → 阶段套餐。首次打开**不做任何预选**，选定主板块后才会带出对应的套餐与阶段。
- **9 个主板块** —— 室内 / 景观 / 建筑 / 软件开发 / 市场活动 / 影视制作 / 婚礼策划 / 咨询交付 / 旅游出行。
- **29 套阶段套餐** —— 每个主板块都有贴合自身流程的阶段（不是把室内九段换个名字照搬）。例如旅游是「规划 → 行程设计 → 资源预订 → 行前确认 → 执行 → 结算 → 复盘」，软件开发是「规划 → 设计 → 开发 → 测试 → 发布」。
- **看板列随主板块变化** —— 室内是设计 / 深化 / 施工，影视是筹备 / 拍摄 / 后期 / 交付，不共用一套列。

### 📐 排期与交付
- **休息制度可配置** —— 大休 / 小休、单休 / 双休，排期自动跳过休息日，竣工日期算得准。
- **多视图** —— 看板、月历、可拖拽改期的甘特时间轴。
- **打印 / 导出** —— 日程表 A4 打印视图、导出 PNG 高清图。
- **旅游客户行程单** —— 旅游项目按项目起止日期生成每日行程卡，可打印成给客户看的行程单；非旅游项目不显示。
- **双主题** —— 亮 / 暗 / 跟随系统三态。

### 👥 协同
- **任务指派** —— 任务可指派多个成员，参与人可勾选完成，进度实时同步。
- **角色权限** —— 管理员看全貌；普通成员只看与自己相关的项目与任务。
- **成员看板** —— 每位成员登录后看到的是自己相关的项目进度。
- **密码登录** —— 管理员可为成员单独设置 / 清除密码。

### 💾 数据
- **备份恢复** —— 一键导出 / 导入 JSON 备份，格式全量校验；旧版本备份可安全导入。
- **离线优先** —— 桌面版数据存本机 IndexedDB，不依赖网络。

---

## 🤖 Agent 接入

ID Plan 内置一条**本机 loopback 通道**（`127.0.0.1:17788`），让外部 AI 写方成为排程工具的一等公民：

- **一键接入** —— 接入面板生成**固定路径的接入文件**（地址 / 令牌 / 端点 / payload schema 全在其中），外部 Agent 读一个文件即完成接入，令牌轮换后重读即可
- **自助建板** —— 写方可自己创建 Agent 看板（名称 + 起止日期 + 阶段集合，缺一即拒）
- **幂等导入** —— `idplan-agent-payload/v1` schema；幂等键 `externalId`，重放不重号；依赖按 `externalId` 解析；支持 dryRun 预览（所见即所写）
- **读回核对** —— 任务流只读接口，写方可随时核对落库结果
- **结构性隔离** —— 落点只能是 Agent 看板（`kind=agent`），**人类项目一律拒绝**（`project_unresolved`）；门在共享核心单点实现，桌面 / NAS 两通道同码
- **手动兜底** —— 不连通道时，内置可复制的导入提示词与 JSON 模板

**建设中**：Agent 执行控制台界面（数据层已就绪：`Execution` / `ExecutionAttempt` / `ExecutionEvent` / `WritebackProposal`，状态机在存储边界强制）；NAS 远程自动写入（当前仅连通探测）。

---

## 🚀 快速开始

```bash
git clone https://github.com/chengcheng067/idplan.git
cd idplan
npm install

npm run dev            # 前端 http://localhost:5173
# 或 electron:dev      # 桌面形态开发运行
```

```bash
npm test               # 全量单测（1836 用例，vitest）
npm run typecheck      # 前端 / 服务端类型检查
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
| 测试 | Vitest + fake-indexeddb |
| 打包 | electron-builder → NSIS（Windows） / 绿联 UPK |

---

## 📖 文档

- 🪧 [Windows 安装](docs/install/windows-install.md) · 📦 [NAS · UPK](docs/install/upk-install-tutorial.md) · ⚙️ [NAS · Docker](docs/install/nas-deploy-tutorial.md)
- 🔌 [接口契约（Agent 四端点）](docs/api-contract.md) · 🗂️ [备份格式](docs/backup-format.md) · 🧪 [迁移演练](docs/migration-drill.md)
- 🗺️ [路线图（含「明确不做」清单）](docs/roadmap.md)
- 🧾 [发布 checklist（含 arm64 路线与踩坑汇编）](docs/release-checklist.md)

---

## 🗺️ 当前状态

| 能力 | 状态 |
|------|------|
| 多行业建档、排期、看板 / 月历 / 甘特、打印导出 | ✅ 可用 |
| 旅游每日行程与客户行程单 | ✅ 可用 |
| Agent loopback 自动导入、手动粘贴导入 | ✅ 可用 |
| Agent 执行控制台界面 | 🔴 未接（数据层已就绪） |
| 从 ID Plan 发起并追踪 Agent 执行 | 🔴 未接（目前只有外部写入通道） |
| NAS 远程自动写入 | 🔴 未启用（仅连通探测） |

---

## 🤝 如何参与共创

- **反馈功能 / 提 Bug** —— 提 Issue 或直接 PR
- **补充行业模板** —— 熟悉某个行业就提交模板 PR（阶段库是纯 JSON 增量，零迁移）
- **改进交互 / 视觉** —— UI 文案、操作路径、图标优化
- **贡献代码** —— 用 vitest 写测试，欢迎提 PR；提交即表示同意将你的贡献以与本项目相同的 MIT 许可并入

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
