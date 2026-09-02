/**
 * 应用版本常量（前端只读）。
 *
 * v0.3 版本号收敛：此前版本号散落 4 处（本文件 / package.json / preload.cjs / log.service.ts）
 * 且互相不一致。现统一为单一真相源 version.json（仓库根，与 GitHub Release tag v0.3.0.0018
 * 严格对应，四段 x.y.z.build）。BUILD_VERSION 由此派生——改版本时只动 version.json 一处，
 * 避免漏改导致「关于」区、日志导出、桌面端更新比对基准各说各话。
 */
import pkg from '../../version.json';

/** 应用版本（四段 x.y.z.build，与 GitHub Release tag 一一对应，是更新比对的基准） */
export const BUILD_VERSION = pkg.version;

/** 前端技术栈说明（关于区展示） */
export const FRONTEND_STACK = 'Vite + React';

/** 仓库地址（关于区「提交 Issue」使用） */
export const REPO_URL = 'https://github.com/chengcheng067/idplan';

/** 仓库 owner（拼 GitHub API 地址用，见桌面端更新检测） */
export const REPO_OWNER = 'chengcheng067';

/** 仓库名（拼 GitHub API 地址用） */
export const REPO_NAME = 'idplan';
