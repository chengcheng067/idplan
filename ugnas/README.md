# ID Plan · 绿联 UGOS Pro 应用（Docker）

> ID Plan 移植为 UGOS PRO 原生应用的 **Docker 形态** 脚手架。
> 本目录包含：Docker 化部署骨架 + 可运行时切换数据源的移植接口，以及绿联 `ugcli` 打包配置。

---

## 1. 当前方案：Docker 应用 · 前端 + 后端（团队共享中心库）

UGOS Pro 应用分两类：

| 形态 | 后端 | 适用 |
|---|---|---|
| **原生应用** | 仅 Go / C++ 等编译型语言 | 轻量单进程 |
| **Docker 应用** | 任意（镜像内自带运行时） | **本方案**，ID Plan 目前走这条 |

### 为什么是「Docker + 带后端」，而不是「原生应用」或「纯前端 Docker」

| 方案 | 判断 | 原因 |
|---|---|---|
| 绿联**原生应用** + 后端 | ❌ 不采用 | 原生应用后端**只支持 Go/C++ 编译型**，而 ID Plan 后端是 Node（Fastify + better-sqlite3）。走原生需把整个后端用 Go 重写，成本高、无收益。 |
| **纯前端 Docker**（无后端） | ❌ 不满足目标 | 数据落在各自浏览器 IndexedDB，**团队无法共享**，仍需手动导入导出 JSON——正是要解决的问题。 |
| **Docker + 带后端** | ✅ **采用** | Docker 可跑任意运行时，直接复用已完成的 Node 后端（业务端点齐全），只补编排层即可。 |

> 后端 `server/`（Fastify + better-sqlite3 WAL）**功能已完整**：覆盖 projects / stages / tasks / members / contracts / settings + backup / bootstrap / reschedule / bulk / logs 全部端点，前端 `remote` 适配器（`rest.client.ts`）已就绪。本方案只需补「编排 + 持久化 + 反代」。

### 架构

```
浏览器 / 客户端
      │  http://<nas-ip>:28080
      ▼
┌─────────────────────────────────────┐
│ 容器 idplan（nginx）                 │
│  · 托管 dist/ 静态产物               │
│  · /api/* ──反代──┐                 │
└──────────────────┼──────────────────┘
                   ▼
        ┌──────────────────────────┐
        │ 容器 idplan-backend       │
        │  Fastify + SQLite(WAL)   │
        │  /data/changxia.db ── 卷  │ ← 持久化到 NAS，容器重建不丢
        └──────────────────────────┘
```

- **同源 `/api`**：浏览器只访问前端端口，由 nginx 反代到后端，**无跨域问题**，`VITE_API_BASE_URL` 保持 `/api` 即可，无需填 NAS IP。
- **数据集中**：remote 模式下所有人的数据都落在 NAS 的 `changxia.db`，**团队自动共享**，不再手动导 JSON。

> 后期如需上原生应用：需先用 Go 重写后端（不建议，见上表）。当前 `is_docker_app: true`。

---

## 2. 目录结构

```
ugnas/
├── Dockerfile                 # 前端：node 构建 dist → nginx 托管 + 注入配置
├── Dockerfile.backend         # 后端：node:20-slim 跑 Fastify + better-sqlite3（含编译工具链）
├── project.yaml               # UGOS 应用配置（ugcli pack 使用）
├── docker-compose.yaml        # UGOS Docker 编排：idplan(前端) + backend(后端) + 数据卷
├── .dockerignore              # 构建上下文忽略
├── nginx/
│   ├── nginx.conf             # SPA 回退 + /env-config.js + /api 反代到 backend:7788
│   └── env-config.template.js # 运行时配置模板（entrypoint 渲染）
└── scripts/
    ├── entrypoint.sh          # 容器启动：渲染 window.__APP_ENV__ 写回 env-config.js
    └── pack.sh                # 一键打包：前端/后端镜像(amd64+arm64) → 导 tar → ugcli pack
```

---

## 3. 绿联移植接口（运行时数据源切换）

**核心机制**：数据源配置从「构建期写死」改为「运行时注入」。

- 前端读取顺序：`window.__APP_ENV__`（健康检查/容器注入）→ `import.meta.env`（构建期兜底）。
- 运行时由容器内 `entrypoint.sh` 用环境变量渲染 `env-config.js`，nginx 以 `no-store` 提供，浏览器加载 index.html 前执行。

对应源码改动：
- `src/config/env.ts`：`readEnvConfig` 加 `runtime?` 参数，`appEnv` 优先读 `window.__APP_ENV__`。
- `index.html`：构建期占位 `window.__APP_ENV__ = { VITE_DATA_SOURCE: 'local', VITE_API_BASE_URL: '' }`。

**效果**：不重建镜像，仅改容器环境变量即可在 `local`（浏览器离线）/`remote`（NAS 后端 API 多端同步）间切换。

```bash
# 容器环境变量（docker-compose 或 UGOS 应用中心应用配置里填）
VITE_DATA_SOURCE=local    # local = 浏览器 IndexedDB（离线单机）；remote = NAS 后端（团队共享）
# remote 时必填。保持 "/api" 即可——nginx 已反代到后端容器，无需 NAS IP：
VITE_API_BASE_URL=/api
```

> 数据层已具备 `createRepositories({ dataSource, apiBaseUrl })` 的 local(Dexie)/remote(REST) 双适配器，`apiBaseUrl` 即上述 `VITE_API_BASE_URL`，天然承接收口。

---

## 4. 在 NAS 上实测（绿联 Docker 套件 / 任意 Docker 主机）

> 这是团队共享模式的完整验证流程。**后端必须和数据卷一起跑**，否则容器重建即丢库。

### 4.1 一键起全套（前端 + 后端 + 数据卷）

```bash
cd changxia/ugnas

# 构建并后台启动（remote = 团队共享模式，数据落 NAS）
VITE_DATA_SOURCE=remote VITE_API_BASE_URL=/api docker compose up -d --build

# 查看状态（两个容器都应 healthy）
docker compose ps

# 看后端日志（确认 SQLite 已就绪）
docker compose logs -f backend
```

### 4.2 验证后端联通

```bash
# 经 nginx 反代访问（浏览器同源路径）
curl http://<nas-ip>:28080/api/projects
curl http://<nas-ip>:28080/api/members

# 预期：返回 []（空库）或已有数据，说明反代 + 后端都通了
```

### 4.3 验证数据持久化（关键）

```bash
# 1) 在页面上建一个项目，或导入演示备份
# 2) 重启容器
docker compose down && docker compose up -d

# 3) 再查一次，数据应仍在
curl http://<nas-ip>:28080/api/projects
#    数据还在 = 卷持久化生效；数据没了 = 卷没挂对，检查 volumes 配置
```

### 4.4 切回本地单机模式

```bash
VITE_DATA_SOURCE=local docker compose up -d
# 此时前端读浏览器 IndexedDB，后端虽在跑但无人调用
```

### 4.5 浏览器打开

```
http://<nas-ip>:28080
```

控制台验证：`window.__APP_ENV__` 应为 `{ VITE_DATA_SOURCE: "remote", VITE_API_BASE_URL: "/api" }`。

### 4.6 仅前端单容器（不带后端，快速验证静态站）

```bash
cd changxia/ugnas
docker build -f Dockerfile -t idplan:local .
docker run --rm -p 28080:80 -e VITE_DATA_SOURCE=local idplan:local
# 浏览器打开 http://localhost:28080（此模式无 /api，仅供静态站自检）
```

> 本机若无 Docker，可直接 `npm run build` 后 `npm run preview` 验证前端（env-config 注入已在 index.html 内置，逻辑一致）。

---

## 5. 绿联 UGOS Pro 打包上架

> 需先完成：申请开发者授权（序列号 + MAC + 管理员用户名 邮件联系绿联）；本机安装 `ugcli`。
>
> **✅ 当前实际在用的流程是 5.0（无本机 Docker 也能打包）**；5.1/5.2 是早期需要本机 Docker 的旧方案，仅留档。

### 5.0 实际在用：云端导镜像 + 本地打包（无需本机 Docker）

本机跑不了 Docker，镜像 tar 由 GitHub Actions 云端导出，本地只做「下载 + 校验 + 打包」：

```
① 推 tag 触发云端导出：
   git tag upk-0.3.0-3 && git push origin upk-0.3.0-3
   → .github/workflows/upk-images.yml
   → buildx --output type=docker 导出「经典 docker-save 格式」tar
     （不能用 docker save：runner 的 containerd 存储会输出 OCI layout，绿联不认；
      也不能用 --output type=oci，同样被 ugcli 拒绝且体积膨胀 3 倍）
   → 挂到 Release upk-images-<版本>，并自校验「单 manifest + 非 latest」

② 本地打包（下载走 GitHub API 资产通道，比直链快几十倍；含断点续传重试）：
   GH_TOKEN=<pat> bash ugnas/scripts/pack-amd64.sh 1
   → 下载 4 个 tar → 放入 rootfs_<arch>/images/ → ugcli check → ugcli pack
   → build_dir/pkgs/upk/{amd64|arm64}_com.chengcheng.idplan_0.3.0.0001.upk
```

**关键约束（ugcli 硬校验，错了直接打包失败）**：
- tar 必须经典 docker-save 格式（根下有 `manifest.json`，不是 `blobs/`）
- 一个 tar 只装一个镜像一个 tag；tag 与 compose `image:` **完全一致**；禁止 `latest`
- compose 不写 `build:`；`${VAR}` 必须在 project.yaml `parameters` 声明（`TZ` 内置，声明反而报错）
- 同一 `x.y.z` 下 `--build` 号必须递增，否则应用中心拒绝覆盖安装

### 5.0.1 版本号流向：project.yaml 是唯一真相源

> 这里曾埋过一个地雷：打出 `…_0.7.0.0001.upk`，装的却是 `0.3.0` 旧镜像，
> 且文件名、文档都对、用户完全看不出来。根因是**版本号散落四处、互不校验**。
> 现在 `pack-*.sh` 会在打包前跑预检，把「静默出错」变成「响亮失败」。

任何一次发版，下面几处必须指向**同一个版本号**：

| 位置 | 控制什么 |
|---|---|
| `ugnas/upk/project.yaml` 的 `version:` | UPK **文件名**的 `x.y.z`（`ugcli pack --build N` → `…_x.y.z.N.upk`）——**单一真相源** |
| `ugnas/upk/rootfs_common/docker-compose.yaml` 各服务 `image: name:<tag>` | 容器**实际拉起**的镜像 tag，必须与 tar 内 tag 完全一致 |
| `ugnas/scripts/pack-amd64.sh` 的 `VERSION` | **不再硬编码**——改为从上面 `project.yaml` 派生，决定去 `upk-images-<VERSION>` Release 下载镜像 tar |
| `ugnas/project.yaml` 的 `version:` | 仅被已弃用的 `pack.sh` 使用（对应 `ugnas/docker-compose.yaml`），与 `upk/` 下的那份需各自保持一致 |

- `pack-amd64.sh` 与 `pack.sh` 都会在真正下载/打包**之前** source `ugnas/scripts/check_upk_versions.sh` 并调用 `check_upk_versions`：
  读 `project.yaml` 的 `version`，与每个 `docker-compose.yaml` 的 `image:` tag 比对，
  **不一致立即退出，并打印「读到的是什么 / 期望什么 / 该改哪个文件哪一行」**。
- **发版时必须同步改**：
  1. `ugnas/upk/project.yaml` 的 `version`；
  2. `ugnas/upk/rootfs_common/docker-compose.yaml` 里两个 `image:` 的 tag（与 ① 同值）；
  3. 让 `upk-images` 工作流以同一版本号导出镜像 tar（Release tag `upk-images-<版本>`；该工作流当前默认 `0.3.0`，需按版本手动触发或打 `upk-<版本>-N` tag）。
  若只改其一，预检会拦下，不会放出错的包。

### 5.1 构建产物 + 导镜像（pack.sh 已封装，需本机 Docker，已弃用）
```bash
cd changxia && bash ugnas/scripts/pack.sh --build 1
```

### 5.2 手动步骤（等价）
```bash
# 1) 构建前端 + 镜像
cd changxia
npm run build
docker build -f ugnas/Dockerfile -t docker.io/chengcheng/idplan:0.1.0-amd64 --platform linux/amd64 .
docker build -f ugnas/Dockerfile -t docker.io/chengcheng/idplan:0.1.0-arm64 --platform linux/arm64 .

# 2) 导出 tar（放 rootfs_<arch>/images/）
docker save -o ugnas/rootfs_amd64/images/idplan-0.1.0-amd64.tar docker.io/chengcheng/idplan:0.1.0-amd64
docker save -o ugnas/rootfs_arm64/images/idplan-0.1.0-arm64.tar docker.io/chengcheng/idplan:0.1.0-arm64

# 3) ugcli 建项目（生成骨架 + project.yaml + rootfs 目录）
ugcli create com.chengcheng.idplan

# 4) 把 ugnas/project.yaml、docker-compose.yaml、图标就位
cp ugnas/project.yaml ./project.yaml
cp ugnas/docker-compose.yaml ./rootfs_common/docker-compose.yaml
# 图标：256×256 PNG <100KB，浅底+描边，套官方圆角模板 → rootfs_common/icon.png

# 5) 打包
ugcli pack --arch all --build 1
# 产物：build_dir/pkgs/upk/{amd64|arm64}_com.chengcheng.idplan_0.1.0.0001.upk
```

### 5.3 装机测试
1. NAS → 应用中心 → 手动安装 → 选 upk。
2. 需已完成开发者授权（授权文件 `ugdev.sig` 上传管理员个人文件夹；≥1.16.0.0000 在应用中心触发整机授权）。

---

## 6. project.yaml 关键字段说明

| 字段 | 值 | 说明 |
|---|---|---|
| `app_id` | `com.chengcheng.idplan` | 上架后不可改 |
| `version` | `0.3.0` | `ugcli pack --build N` 后最终 `0.3.0.N` |
| `is_docker_app` | `true` | 当前 Docker 形态 |
| `depend_docker_version` | `1.7.0.0000` | 依赖 Docker 套件最低版 |
| `port` | `28080` | 宿主端口（Docker 应用 IP:端口直连），与 compose `28080:80` 对应 |
| `open_type` | `tab` | 浏览器新标签页通过 IP+端口直连打开（不走系统网关） |
| `proxy_path` | （无） | Docker 应用无需配置（原生应用专用：把 /api 前缀转给后端进程） |
| `supports` | `[pc, app]` | 桌面端 + 移动端 |
| `parameters` | 见文件 | 数据源 / API 地址，用户可改（注入 compose） |

---

## 7. 后期移植路线（预留）

- **原生应用**：`is_docker_app: false`，后端改用 Go 静态服务器（托管 dist + SPA 回退 + /api 代理），`start_cmd: bin/idplan_serv --port=28080`。前端与数据层接口无需改动。
- **多端同步**：数据源切到 `remote`，后端按 `docs/api-contract.md` 实现 REST API，数据落 NAS；`proxy_path: api` 或 `VITE_API_BASE_URL` 直连。`IRepositoryBundle` 的 remote 适配器已就绪。
- **备份互通**：`IAdminRepository.fullExport()/replaceAllImport()` 已定义，对应 `/api/backup` 端点。

> 详见交付报告 `deliverables/gstack/ugos-pro-migration-research-2026-08-28.md`（平台整体调研 + 三条路线对比）。
