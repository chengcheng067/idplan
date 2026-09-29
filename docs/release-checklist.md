# 发布 checklist（0.8.1 / 0.8.2 两轮出包实测固化 · 2026-09-30）

> 每次发版前逐项过。带 ✱ 的是踩过坑后补的（坑记在条目末尾）。

## 1. 代码就绪
- [ ] `npm run build` ✓（**先 build 再全量**——浏览器族依赖 `build-dist`，没构建整批 skip，skip ≠ 通过）
- [ ] `npx vitest run`：**0 failed 且 0 skipped**（1841 例基线）
- [ ] `npm run typecheck:tests`：≤ 66（既有债基线；新增 spec 不许加债）
- [ ] `npx tsc --noEmit -p tsconfig.json` 与 `-p server/tsconfig.json` 双 0

## 2. 版本号（✱ 走查 D5 纪律：数字类事实同源同批更新）
- [ ] `version.json` 四段号推进（如 0.8.3.0001）
- [ ] README / README.en.md 徽章 version + tests 数与**本轮实跑一致**
- [ ] `docs/install/windows-install.md` 文件名同步
- [ ] 套餐数 / phase 数等库数字（stage-library version、presets 数）同批更（api-contract / README）

## 3. Windows 桌面包（四步链）
- [ ] `rm -f build-dist/assets/* && npm run build && node scripts/prune-build-dist.mjs`（空目录重建防旧 bundle 混入）
- [ ] `ELECTRON_BUILDER_RCEDIT_PATH=... npx electron-builder --win nsis -c.directories.output=release-v260928`
- [ ] `node scripts/verify-package.cjs` → **总体 ALL PASS**；asar 内 `version.json` 实读 == 本轮版本
- [ ] 产物 `ID Plan-0.8.x-Setup.exe`（builder 用 package.json semver 命名）**复制为** `IDPlan-<四段号>-Setup.exe` 并记 SHA256

## 4. NAS UPK（干净重建，✱ 永不 patch 旧层）
- [ ] `python scripts/patch_oci_tar.py <cache.tar> rootfs_amd64/images/idplan-amd64-upk.tar build-dist`
- [ ] `python scripts/patch_backend_tar.py <cache.tar> rootfs_amd64/images/idplan-backend-amd64-upk.tar server`
- [ ] `python scripts/verify_chain.py` 双 tar 全绿
- [ ] 双子 `project.yaml` version 对齐（ugcli 校验会抓 `${VAR}` 未在 parameters 声明——✱ ugcli **不认** `${VAR:-}` 形式）
- [ ] `ugnas/upk && ../../..tools/ugcli.exe pack --arch amd64 --build <n>`（n 自增）
- [ ] 解包验：config.json 实读版本 / .check-app MD5 / 后端层三棵树 / **新版本特征串判别力（旧包全 0 命中）**
- [ ] 交付副本入 `release-v260928/` 记 SHA256

## 5. 发布
- [ ] commit + push master
- [ ] `git tag -a v<四段号>` + push tag
- [ ] GitHub Release（notes：变更表 / 双包 SHA256 / SmartScreen 提示 / 许可证）
- [ ] 上传双包——**✱ curl 不要加 `--retry`**：GitHub 上传响应偶发解析失败显示 "Validation Failed"，但 asset 实已 uploaded；传完以 `GET .../releases/<tag>` 的 assets 列表实态为准，别被 response 骗而重复传（同名二次传才是真 422）

## 6. arm64 UPK（当前：无验证环境，显式排队）
路线已定（0.8.4 决策）：CI 产线 `upk-images.yml` 本就支持 `linux/arm64` 双构建，缺的只是触发与打包。三步（需要有权触发 CI 的人操作）：
1. GitHub 网页 → Actions → **upk-images** → Run workflow（ref=master，version=当前镜像 tag，如 0.3.0）——PAT 通常无 Actions 写权限（dispatch API 会 403），**网页端点不需要**
2. 下载 artifact 的 `*-arm64-upk.tar`（前端+后端）到 `ugnas/upk/rootfs_arm64/images/`
3. 复用第 4 节同链：patch_backend_tar → verify_chain → `ugcli pack --arch arm64 --build 1` → 解包验
- **纪律**：无 arm64 真机验收的包不得发 Release（不做无验证发布）；README / 安装文档已明示 arm64 走 Docker compose 替代（ghcr 镜像多架构，pull 自动选层）

## 7. 收尾
- [ ] `.workbuddy/memory/YYYY-MM-DD.md` 归档（changelog + 踩坑）
- [ ] 更新 `docs/roadmap.md` 已发布表
- [ ] 回滚点：上一版双包保留在 `release-v260928/`（SHA 记 notes）

---

## 踩坑汇编（两轮实测）

| 坑 | 现象 | 解法 |
|---|---|---|
| `patch_backend_tar` 漏新文件 | 后端层缺新模块 | 脚本按 git tracked 推导；新增 `.ts` 自动入层，`.tsx` 按白名单不入（后端不需要） |
| ugcli `${VAR:-}` | `project validation failed: variables not set` | 裸 `${VAR}` + project.yaml parameters 声明 |
| 同名 asset 重复传 | 真 422「Validation Failed」 | 先 GET assets 实态再决定传不传 |
| curl `--retry` 上传 | 假「Validation Failed」 | 别加 retry；以实态为准 |
| python 改写 CRLF 文件 | LF 混入行被统一成 CRLF，spec 的 `indexOf('\n')` 假红 | 源码级锚点用 `\s*` 正则（换行无关） |
| 注释写 z 数字 | toast spec 正则误抓，层级断言假红 | 注释语义化，数字只出现在类名里 |
| 空库加引导层 | 全浏览器族点击被遮罩拦（timeout 海） | 探针 flag + 身份 helper 尾部加「消卡」步骤，同轮适配 |
