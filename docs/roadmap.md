# Roadmap

ID Plan 是离线优先的项目排程工具（看板 / 月历 / 甘特 / 打印），桌面 + NAS 双形态，MIT 许可。

路线图按滚动小版本推进，每批都有可测验收；**「明确不做」和「计划做」一样是本项目的一部分**。

## 当前批次

### v0.8.2 — 开源首秀 + 内核还账
- 全仓许可口径一致化（MIT）
- NAS 安装包干净重建 + 版本链单一真相源（amd64 先行，arm64 排队）
- Issue / PR 模板 + Discussions 引导
- Agent 接入指令块补落点参数名 + 能力一致性断言
- README 徽章/版本收口 + SmartScreen 安装提示
- Agent 写入可追溯：runId 批次落库、artifact ID 稳定化

### v0.8.3 — 第一小时
- 「载入示例项目」一键入口（5 个演示项目，四视图立即可见）
- 首次运行三幕引导（可跳过、持久化）
- 英文 README

### v0.8.4 — 行业纵深
- 行业主板块横向扩展（软件 / 市场 / 影视 / 婚礼 / 咨询各 1→2-3 个，纯数据增量）
- 打印弹窗内置化
- 旅游行程模式归档结论

## 明确不做（及理由）

- **授权 / 防逆向的任何形式**：MIT 开源后授权绑定无意义；防逆向在本地优先 Electron 下不可达成
- **云端账号 / 多端同步**：与「离线优先、数据在自己机器上」的定位正面冲突
- **移动端 App**：与当前 Electron/NAS 双形态冲突；若做将是独立产品线
- **阶段数上限放宽到 20 以上**：9 色色板与时间轴可读性是真实约束

## 已发布

| 版本 | 要点 |
|---|---|
| v0.8.1 | MIT 开源落地；移除机器码授权；修复 NAS 后端容器启动崩溃 |
| v0.8.0 | Agent 接入正式版：一键接入 / 自助建板 / 幂等导入 / 读回核对 / 人类项目结构性隔离 |

完整设计文档见 `deliverables/research/`（研究文档，非本仓库内容）。

---

## 🚨 0.8.6 必做清单（2026-10-01 她拍板记账，安全官红牌项）

> 来源：`deliverables/gstack/security-review-idplan-v085-2026-10-01.md` P0-1。
> **这一条是她明确「一定要记得修」的债，0.8.6 排期不可绕过。**

### P0-1 · NAS 写端点无鉴权（OWASP A01）
- 现状：`server/routes/meta.routes.ts` 的 `PUT /api/settings/:key`（:294）、
  `POST /api/settings/replace-all`（:304）、`POST /api/logs/stage`（:121）、
  `POST /api/contracts`（:210）均无 token 校验；`server/index.ts` 无全局 hook。
- 危害：LAN 任意方可覆写 `taskNoSeq` 制造任务重号、伪造审计流水；
  **自定义行业一旦落 settings KV（custom-stage.service.ts:49 先例）= 向所有
  LAN 用户的建档 UI 远程投递内容**——这是自定义行业功能上线的硬前置。
- 修法（安全官已定稿）：Bearer 校验写端点；`PUT /api/settings/:key` 加
  值大小与形状校验；`settings/logs/contracts` 的 exempt keep 清单需与
  api-contract 逐端点核对后定稿；补两个测试（无 token 拒/带 token 过）。
- 预估 1-2 人日。**未修前，自定义行业功能不得上线。**

### 同源记录
- 0.8.5 调研轮附带已修：FirstRunGuide isAdmin 门控、IDPLAN_AGENT_API_TOKEN 部署链补齐（commit 2eb8f34）。
- 待她拍板的 0.8.5 其余项：IA 切片节奏（C→A→B）、遗留 16 条批修范围、AI 接口方案 3 详细说明（2026-10-01 已讲，等她确认）。
