## 这个 PR 做什么

（一句话；关联 Issue 请附编号）

## 改了哪一侧

- [ ] 渲染层 / 桌面（src、electron）
- [ ] 服务端 / NAS（server）
- [ ] 数据（仓储 / 迁移 / 备份格式）
- [ ] 纯文档 / 模板

## 自检清单

- [ ] `npm run build` 通过
- [ ] `npx vitest run` 全量 0 failed（涉及 src 改动必跑）
- [ ] 架构铁律核对过（CONTRIBUTING §1-2：dexie 单文件 / electron 不进 src / better-sqlite3 只在 server）
- [ ] 涉及版本号/套餐数/测试数的，已同源同批更新（README / api-contract / roadmap）

> 提交即表示你的贡献以 MIT 许可并入本项目（inbound = outbound，见 CONTRIBUTING）。
