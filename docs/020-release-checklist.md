# 020 发布检查清单

> 发布前逐项打勾；任一项不过就不发。每项都写明"用什么命令/看什么"。

## A. 代码与测试

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm build` 通过（`lib/` 已更新并提交；git 安装依赖构建产物）
- [ ] `pnpm vitest run` 全绿（当前基线 1179 passed / 48 skipped / 0 failed）
- [ ] 文档契约测试通过：`pnpm vitest run tests/docs.spec.ts`（编号连续、只链更早编号、本地链接可解析）
- [ ] 工作区干净：`git status --short` 为空；`main` 与 `origin/main` 一致
- [ ] **无本机绑定**：`pnpm vitest run tests/portability.spec.ts` 通过（全仓不得出现开发机绝对路径、用户名或旧 checkout 名）

## B. 归属与许可（不可移除）

- [ ] `LICENSE` 仍是官方 MIT 原文（Copyright (c) 2026 DeepSeek Harness Team）
- [ ] `NOTICE` 存在，列出新增部分与"上游实现即回退"的承诺
- [ ] `README.md` 顶部归属横幅含上游仓库、MIT、版权
- [ ] `locale/zh.json` 与 `locale/en.json` 的 `meta.description` 含上游与本构建两个链接与版权行（插件页会显示）
- [ ] 桌面应用「帮助 → 关于 DSH-Superagent」含上游与版权（用户不打开仓库也能看到）

## C. 桌面产物

- [ ] `node windows-app/build-portable.js` 产出 payload
- [ ] 用 payload 打包 zip，并记录 SHA-256
- [ ] 在**干净目录**跑包内 `install.ps1`：生成 `Superagent.exe` 与 `config\paths.json`
- [ ] **含空格的安装路径**也要成功（例如 `D:	mp\Path With Spaces`）；失败时安装器必须报错，不得只写 `paths.json`
- [ ] 安装后快捷方式名为 `DSH-Superagent.lnk`；窗口标题 `DSH-Superagent`；关于框版本与发布版本一致
- [ ] 卸载/删除测试安装目录，确保未动真实安装与 `%APPDATA%\Superagent`

## D. Release 与一行安装

- [ ] Release 说明含：非官方声明、上游归属、包含内容、安装命令、SHA-256、已知限制
- [ ] 资产齐全：`DSH-Superagent-<ver>-win-x64.zip` 与 `.sha256`
- [ ] 发布资产 digest 与本地 `sha256sum` 一致（GitHub API 会回传 digest）
- [ ] `install.ps1` 里 `$checksums` 已写入本次发布的 SHA-256
- [ ] 一行命令可用（或至少确认两条下载路径：`github.com/releases` 与 `api.github.com` 回退）
- [ ] `irm … | iex` 后默认装到 `%LOCALAPPDATA%\Programs\Superagent`，无需管理员

## E. 运行状态（发布前最后一步）

- [ ] 启动应用：`setup: null`、`runtime: ready`、`router: one Router Session`、`github: ready`
- [ ] 面板「介绍」页可打开，五个页面名称与说明正确
- [ ] 设置 → 执行 → 控制回路与分片四个输入项可见、可保存
- [ ] 多实例：`instances.ps1 -Action list` 正常；应用「文件 → 实例…」可打开
- [ ] 日志中有 `[instance]` 行与后端 URL；无未捕获异常

## F. 发布后

- [ ] 仓库 About：描述、Topics（`dsh`、`deepseek-harness`、`super-agent`、`windows`）、Homepage 指向 Release
- [ ] README 的 Release 链接可打开
- [ ] 在 Release 说明里给出"如何回报问题"（Issues 链接）
- [ ] 记录版本号与校验值到 `CHANGELOG.md`

## 回滚

发布后发现阻断问题时：

1. 不删除 Release，改为**编辑说明**标注问题并置 `prerelease`
2. 修复后发 `v0.1.1`；`install.ps1` 的默认 `$Version` 与 `$checksums` 一起更新
3. 已安装用户：重新跑一行安装命令即可覆盖应用文件；状态目录与配置不受影响
