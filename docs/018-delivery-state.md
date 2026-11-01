# 018 独立实现层：交付状态基线

> 记录日期：2026-11-01。对应路线 `docs/017`。本文是这份改造的**诚实基线**：哪些已做、证据在哪、哪些没做。

> **状态更新（发布后，2026-11-01）**：本文是改造过程中的基线记录，写于 P2 验收之前。现在 P1 已按 `docs/017` §4 退役、P2 已通过真实事件验收、`v0.1.0` 已发布。当前证据以 `docs/021-feature-evidence.md` 与 `docs/020-release-checklist.md` 为准；本文保留当时的判断与理由。


## 1. 总览

| 项 | 状态 | 证据 |
|---|---|---|
| **P3 Watchdog 深化（§6）** | ✅ 已实现并真实运行验证 | `src/app/watchdog.ts`、`src/app/runtime.ts`；`tests/watchdog.spec.ts`；`docs/012` §4.1 |
| **P4 状态存储接缝（§5）** | ✅ 已实现（接口预留，行为零变化） | `src/app/state-store.ts`、`src/app/source-context.ts`；`tests/state-store.spec.ts` |
| **P1 异步子任务（§4.1 右半边）** | ⛔ **已退役**：实测上游 `subagent` 已支持后台运行，按 docs/017 §4 切回上游，删除我们的重复实现 | `docs/017` §7（证据与处置） |
| **P2 Router 分片（§2.1）** | ✅ 放置、按需创建、分发均已接线并**通过真实事件验收**（候选落 shard 1，主 Router 未接收）；默认仍为 1 | `src/app/shards.ts`、`src/app/assessment.ts`、`src/app/sessions.ts`、`src/app/runtime.ts`；`tests/shards.spec.ts` |
| 多实例（§8.3，前序工作） | ✅ 服务侧 + 应用侧 + 管理窗口 | `docs/015`、`docs/016` |
| Watchdog 基础（§6，前序工作） | ✅ | `docs/012` |
| 全双工命令侧（§4.1，前序工作） | ✅ 已锁定 | `docs/013` |
| 链式召回（§3.3，前序工作） | ✅ 已锁定 + 提示词补齐 | `docs/014` |

## 2. 已完成的实质内容

### P3 Watchdog 深化
- **跨 tick 状态差分**：只把变化当新闻（暂停、负载、健康项进出故障、新停滞、指令变化）
- **停滞识别**：running/queued 的 Assignment 超过 `watchdogStallMinutes`（默认 45）未变 → `STALLED`
- **健康时零唤醒**：无新闻时 digest 返回空串，循环不投递（不消耗模型回合）
- **常驻指令**：`watchdogGuidance` 随 digest 下发；**只有变化时才算新闻**
- 实测：1 分钟间隔下，启动期 2 次投递后进入静默；期间发现存在一个 563 分钟未推进的旧工单，被正确标为 STALLED（说明该机制真实生效）

### P4 状态存储接缝
- `StateStore` 接口 + `stateStoreOf(store, prefix)` 本地适配器
- Source context 的 `state` 访问器改为经该适配器构造（真实调用点，非装饰）
- 行为完全一致：同样的键、同样的前缀、`undefined` 即删除的约定

## 3. 收尾状态（P1 退役、P2 验收）

### P1 异步子任务（§4.1 右半边）—— ⛔ 已退役

上游 `subagent` 本身就带后台运行：验收会话（`orchestrator-…-shard-1`）里 `subagent` 被调用 5 次、`subagent_background` 0 次，
说明异步子任务由 DSH 自身承担。按 `docs/017` §4「上游已提供的能力不再重复实现」，删除了 `src/app/subagents.ts`、它的两个工具、
`asyncSubagents` 配置与对应测试。若上游将来回退这个能力，再按 `docs/017` §7 恢复我们的实现。

### P2 Router 分片（§2.1）—— ✅ 已验收

放置、按需创建（`ensureRouterSession`，首次投递时才建会话）、按 Thread 稳定分片、健康项可见，全部接线完成。
真实事件验收：另一账号给 issue 发一条**不带 @** 的评论后，触发 `threads=[{github,id:3}]`、健康显示
`2 of 2 Router Sessions`、候选只落在 shard-1（`LICENSE` 出现 88 次、`orchestrator_eval` 46 次），主 Router 里为 0。
默认仍是 `routerShards: 1`（opt-in），不开就等于普通单 Router。

### 仍然存在的限制（有意留到后续）

- §5 算力 / 状态 / 环境分离：只做到 `StateStore` 接缝，没有真的把状态外置成独立存储。
- 只在 Windows 11 x64 上验证过；更老的 Windows、ARM64 未验证。
- 每个实例需要各自的登录凭据，除非用 `ghConfigFrom` 复用另一个实例的 `GH_CONFIG_DIR`。

## 4. 硬约束现状（发布收尾）

| 约束 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 通过 |
| `pnpm build` | ✅ 通过 |
| `vitest` | ✅ **1184 passed / 48 skipped / 0 failed** |
| 桌面应用 | ✅ `setup: null`、`runtime: ready`、`router: one Router Session` |
| 提交与推送 | ✅ 仓库 `79444ed`，工作区干净 |

## 5. 与上游的关系（不变）

所有新增能力都是**新增模块 + opt-in 配置**，不改上游语义；每项在 `WINDOWS-DELTA.md` 有差量记录，上游若实现同名能力即删我们的模块切回。未开启时行为与上游部署完全一致。

## 6. P2 启用与验收

`routerShards: N`（默认 1）。启用后：每个分片一个 Router Session（`<masterId>-shard-<i>`），`router` 健康项显示
`N Router Sessions (sharded by Thread)`，候选按 Thread 稳定落到同一分片。

要验证分发，需要一条真实环境事件：在 `Check-mj/superagent-playground` 里由**另一个账号**（`WEAaaa-sudo`）给 issue 发
一条评论/新开 issue。看日志与路由：该 Thread 的候选只出现在其分片 Session 里，主 Router 不接它；同一 Thread 的第二条
事件必须落同一分片。智能体账号不能自己触发自己（设计约束），所以这一步无法用本机脚本完成。

**验收结果（2026-11-01）**：✅ 通过。用 `WEAaaa-sudo` 的非 @ 评论完成了上面的检查，结果见 §3 的 P2 段落。

## 7. P1 手动验收步骤（已失效，仅存档）

这一段原本写给「等 `asyncSubagents: true` 后人工验收五个断言」。P1 退役后 `subagent_background` / `subagent_cancel`
两个工具已从代码里删除，照做会找不到工具。异步子任务的验收改为直接看 DSH 自带的 `subagent`（它在会话里以
`ctx.subagent` 方式提供，后台运行由上游实现）。无需再执行本节步骤。

## 8. 最终状态

| 项 | 状态 |
|---|---|
| P1 异步子任务（§4.1 右半边） | ⛔ 已退役，上游已提供（`docs/017` §4/§7 证据） |
| P2 Router 分片（§2.1） | ✅ 放置/按需创建/分发已接线（默认 1），并通过真实事件验收（§3、§6） |
| P3 Watchdog 深化（§6） | ✅ 完成并实测 |
| P4 状态存储接缝（§5） | ✅ 完成，行为零变化 |
| 硬约束 | typecheck / build / vitest / 应用健康 全部保持 |
| 发布 | ✅ `v0.1.0` 已发布（zip 与安装器校验和一致），见 `docs/020` |
