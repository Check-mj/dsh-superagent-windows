# 021 功能 ↔ 代码 ↔ 测试 ↔ 实测证据

> 发布前给自己的最后一道检查：**宣传里说的每一项，都要能在代码、测试或真实运行记录里找到对应证据**。
> 这张表也方便别人审查："你说它能做 X，我怎么自己验一遍"。
>
> 证据类型：**单测**＝自动化测试；**实测**＝本机真实运行（日志/面板/数据库可查）；**契约**＝由测试锁定的不变量。

## 1. 核心工作流

| 声称的能力 | 代码 | 证据 |
|---|---|---|
| 监听一个 GitHub 仓库，把获授权请求变成工单 | `src/sources/github.ts`、`src/admission.ts` | 单测：`tests/sources.spec.ts`、`tests/policy.spec.ts`；实测：触发/决策/工单记录 |
| 程序层过滤 + 语义层评估两级 | `src/admission.ts`、`src/app/assessment.ts` | 单测：`tests/assessment*.spec.ts`、`tests/policy.spec.ts` |
| 工单在独立 Session 执行并回贴原处 | `src/executor/dsh.ts`、`src/app/outbox.ts` | 单测：`tests/executor*.spec.ts`、`tests/outbox*.spec.ts`；实测：一次完整工单从触发到 PR |
| 面板可见触发/评估/执行/回复 | `src/client/*`、`src/app/http.ts` | 单测：`tests/panel-*.spec.tsx`；实测：`GET /orchestrator/api/{state,sources,settings,overview}` 均 200 |

## 2. 桌面应用（Windows 适配层的核心）

| 声称的能力 | 代码 | 证据 |
|---|---|---|
| 双击即用：外壳自己拉起后端 | `windows-app/main.js`（`startBackend`） | 实测：`app.log` 中 `[ready] backend URL` 与 `[ui] did-finish-load` |
| 内置 git / gh / PowerShell 7 | `windows-app/main.js`（`resolveCliTools`）、payload `tools/` | 实测：`[preflight] git: <install>/tools/git/cmd (bundled tools)` |
| 安装器可装到任意目录（含空格） | `windows-app/install.ps1` | 实测：装到 `Path With Spaces` 成功；修复前同一用例失败（记录在本文件 §6） |
| 一行安装 + 校验和 | `install.ps1`（仓库根）、Release 资产 | 实测：`pnpm release:check` 校验资产 digest 与安装器校验值一致（12 项全绿） |
| 后端挂掉后能自愈 | `windows-app/main.js`（健康轮询、`backendDownHtml`、`preload.js`） | 实测：杀掉后端 → 失败页出现「重新启动后端」→ 点击后 6 秒恢复（日志 `[health] restart requested…` → `[ready]`） |
| 多实例：一边界一实例 | `windows-app/instances.ps1`、`instances-window.js`、`main.js --instance` | 实测：`--instance team-b` 启动后 `stateDir=.../state/superagent-b`、`setup: null`；`instances.ps1 -Action list` 列出两条 |

## 3. 补上游未做的机制（默认关闭）

| 声称的能力 | 代码 | 证据 |
|---|---|---|
| Watchdog 跨 tick 差分、停滞识别、静默、常驻指令 | `src/app/watchdog.ts`、`src/app/runtime.ts` | 单测：`tests/watchdog.spec.ts`（5）；实测：1 分钟间隔下启动期 2 次投递后静默；563 分钟未推进的旧工单被标 `STALLED` |
| Router 分片：Thread 稳定分配、按需创建、健康可见 | `src/app/shards.ts`、`src/app/sessions.ts`、`src/app/runtime.ts`、`src/app/assessment.ts` | 单测：`tests/shards.spec.ts`（4）；实测：`routerShards: 2` 时另一账号的真实事件只落在 `-shard-1`（该会话出现 88 次候选内容，主 Router 0 次） |
| 控制回路/分片可在面板设置 | `src/client/execution.tsx`、`src/policy.ts` | 单测：`tests/panel-settings.spec.tsx`；实测：`GET /settings` 的 executor 块含四个键 |
| 存算分离的接缝（只留接口） | `src/app/state-store.ts`、`src/app/source-context.ts` | 单测：`tests/state-store.spec.ts`（3） |

## 4. 设计一致性（官方文章的对照）

| 条目 | 证据 |
|---|---|
| 双层架构（Router 不干活，Worker 执行） | 代码：`src/app/sessions.ts` 的 `MASTER_TOOLS`；文档：`docs/011` |
| 全双工命令侧（5 秒转后台） | 契约：`tests/bundle-patch.spec.ts` 断言两个 preset 的预算都是 5000ms |
| 链式召回（对象卡片内联下一跳 id + 读取路径） | 单测：`tests/chain-of-recall.spec.ts`；提示词：`prompts/shared.md` |
| 一边界一实例（§8.3） | 代码：`src/app/setup.ts` 拒绝多来源；文档：`docs/015`、`docs/016` |

## 5. 发布不变量（由测试锁定）

| 不变量 | 测试 |
|---|---|
| 官方归属在 README/NOTICE/LICENSE/locale/package 元数据中始终可见 | `tests/release-invariants.spec.ts` |
| 仓库不含本机路径、真实用户名、旧 checkout 名 | `tests/portability.spec.ts` |
| 文档编号连续、只链更早编号、本地链接可解析 | `tests/docs.spec.ts` |
| 模块表/测试表与真实文件一致 | `tests/docs.spec.ts` |
| 代码里没有凭证形态的字符串 | `tests/release-invariants.spec.ts` |
| 发布彩排一条命令可跑 | `scripts/release-check.ps1`（`pnpm release:check`） |

## 6. 已知限制（不要宣传成已实现）

| 限制 | 说明 |
|---|---|
| 存算分离（文章 §5） | 只留了接口接缝，没有远端状态后端；进程停了就不工作，最外层仍需外部定时检查 |
| 异步子任务（§4.1 右半边） | 由 DeepSeek Harness 自带的 `subagent` 提供；本适配版**不重复实现**，早期实现已按 `docs/017` 的规则删除 |
| 平台 | 只在 Windows 11 x64 上构建与验证 |
| 新实例 | 首次需要自己的智能体账号登录（或用 `ghConfigFrom` 复用同账号凭据） |

## 7. 自己复验（命令）

```powershell
pnpm typecheck && pnpm build && pnpm vitest run   # 全部单测与契约
pnpm release:check                                # 发布彩排（含资产校验）
powershell -NoProfile -ExecutionPolicy Bypass -File windows-app\instances.ps1 -Action list
# 桌面端：启动应用 → 面板「介绍」→ 设置 → 执行 → 控制回路与分片
# 后端自愈：启动后杀掉 node 后端进程，等待 ~12 秒看失败页是否出现「重新启动后端」
```
