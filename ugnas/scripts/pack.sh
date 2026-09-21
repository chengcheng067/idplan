#!/usr/bin/env bash
# =====================================================================
# ID Plan · UGOS Pro 打包自动化脚本（需在 Linux / Git Bash 环境运行）
# 前提：
#   - 已安装 ugcli（https://developer.ugnas.com/doc/tools/ugcli.html）
#   - 已安装 docker 且可构建镜像
#   - 已申请绿联开发者授权（本机 NAS）
# 用法：
#   ./pack.sh            # 默认：build dist → 导镜像 → ugcli pack --build <下次构建号>
#   ./pack.sh --build 2  # 指定构建号
# =====================================================================
set -euo pipefail

# 解析 --build N（兼容 --build N 与 --build=N 两种写法）
BUILD_NO=""
for arg in "$@"; do
  case "${arg}" in
    --build=*) BUILD_NO="${arg#*=}" ;;
    --build)   shift ;; # 下一个参数即构建号
    *)         if [ -z "${BUILD_NO}" ] && [ -n "${PREV:-}" ] && [ "${PREV}" = "--build" ]; then BUILD_NO="${arg}"; fi ;;
  esac
  PREV="${arg}"
done
VERSION=$(node -p "require('../package.json').version" 2>/dev/null || echo "0.1.0")
APP_ID="com.chengcheng.idplan"

# 允许从 ugnas/ 或仓库根两种位置运行
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 共享版本预检（镜像 tag 必须与 project.yaml 的 version 一致，否则响亮失败）
source "${SCRIPT_DIR}/check_upk_versions.sh"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}"

# 预检（pack.sh 已弃用，但仍要拦住版本错位）：本路径使用的 project.yaml 是
# ugnas/project.yaml，compose 源是 ugnas/docker-compose.yaml，二者必须同版本。
# 注意：本脚本镜像 tag 另由 package.json 派生（不在本预检范围，属发布决策）。
check_upk_versions "${ROOT_DIR}/project.yaml" \
                   "${ROOT_DIR}/docker-compose.yaml"

echo "==> [1/6] 构建前端 dist"
npm run build

echo "==> [2/6] 构建前端 Docker 镜像（amd64 / arm64）"
docker build -f ugnas/Dockerfile -t docker.io/chengcheng/idplan:${VERSION}-amd64 --platform linux/amd64 .
docker build -f ugnas/Dockerfile -t docker.io/chengcheng/idplan:${VERSION}-arm64 --platform linux/arm64 .

echo "==> [3/6] 构建后端 Docker 镜像（Fastify + SQLite，amd64 / arm64）"
# 后端含 better-sqlite3（native 模块），必须按目标架构分别构建，
# 不能把 amd64 镜像直接跑在 arm64 机型上（绿联两种机型都有）。
docker build -f ugnas/Dockerfile.backend -t docker.io/chengcheng/idplan-backend:${VERSION}-amd64 --platform linux/amd64 .
docker build -f ugnas/Dockerfile.backend -t docker.io/chengcheng/idplan-backend:${VERSION}-arm64 --platform linux/arm64 .

echo "==> [4/6] 导出镜像 tar（前端 + 后端）"
mkdir -p ugnas/rootfs_amd64/images ugnas/rootfs_arm64/images
docker save -o ugnas/rootfs_amd64/images/idplan-${VERSION}-amd64.tar docker.io/chengcheng/idplan:${VERSION}-amd64
docker save -o ugnas/rootfs_arm64/images/idplan-${VERSION}-arm64.tar docker.io/chengcheng/idplan:${VERSION}-arm64
docker save -o ugnas/rootfs_amd64/images/idplan-backend-${VERSION}-amd64.tar docker.io/chengcheng/idplan-backend:${VERSION}-amd64
docker save -o ugnas/rootfs_arm64/images/idplan-backend-${VERSION}-arm64.tar docker.io/chengcheng/idplan-backend:${VERSION}-arm64

echo "==> [5/6] 组装应用项目（project.yaml + compose + 图标）"
# 注：ugcli create 生成的骨架已含 rootfs 目录；此处仅确保 compose/icon 就位
if [ ! -d ugnas/rootfs_common ]; then mkdir -p ugnas/rootfs_common; fi
cp ugnas/docker-compose.yaml ugnas/rootfs_common/docker-compose.yaml
cp ugnas/project.yaml ./

echo "==> [6/6] ugcli 打包"
if [ -n "${BUILD_NO}" ]; then
  (cd ugnas && ugcli pack --arch all --build "${BUILD_NO}")
else
  (cd ugnas && ugcli pack --arch all)
fi

echo "==> 完成！upk 位于 ugnas/build_dir/pkgs/upk/"
