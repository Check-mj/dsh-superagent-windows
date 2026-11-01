# 018 独立实现层：交付状态基线

> 记录日期：2026-11-01。对应路线 `docs/017`。本文是这份改造的**诚实基线**：哪些已做、证据在哪、哪些没做。

## 1. 总览

| 项 | 状态 | 证据 |
|---|---|---|
| **P3 Watchdog 深化（§6）** | ✅ 已实现并真实运行验证 | `src/app/watchdog.ts`、`src/app/runtime.ts`；`tests/watchdog.spec.ts`；`docs/012` §4.1 |
| **P4 状态存储接缝（§5）** | ✅ 已实现（接口预留，行为零变化） | `src/app/state-store.ts`、`src/app/source-context.ts`；`tests/state-store.spec.ts` |
| **P1 异步子任务（§4.1 右半边）** | 🟡 已接线（opt-in，默认关闭），真实并发验收待做 | `src/app/subagents.ts`、`src/app/sessions.ts`；`tests/subagents.spec.ts`；`docs/017` P1 |
| **P2 Router 分片（§2.1）** | 🟡 放置、预置、分发均已接线；分发只到单元级证据（无真实 Trigger 可造） | `src/app/shards.ts`、`src/app/assessment.ts`、`src/app/sessions.ts`、`src/app/runtime.ts`；`tests/shards.spec.ts` |
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

## 3. 未完成与继续方式

### P1 剩余（下一轮第一件事）
1. 配置项 `asyncSubagents`（默认 `false`），仅在开启时注册 `subagent_background` / `subagent_cancel` 两个工具
2. `ctx.on('agent/status')` 的 idle → `finish(session, lastResult)`；`agent/disposed` → 回收
3. 真实并发验收：worker 发起慢子任务，期间父会话仍能接新消息；结束后父会话收到事件消息；cancel 后无投递
4. 完成后在 `docs/017` 把 P1 标为 ✅，并在 `WINDOWS-DELTA.md` 确认差量条目

**已有的基础**：`src/app/subagents.ts` 的生命周期与 5 个测试；`ctx.on('agent/status')` 与 `agent/disposed` 均在 `src/app/sessions.ts` 有用法可参照。

### P2 未开始
设计已在 `docs/017` P2：`routerShards=N`、按 `threadKey` 哈希分片、保持 Thread 亲和性、默认关闭、健康可见分片。风险：分片削弱全局连续性（文章自己强调的权衡），必须默认关闭。

## 4. 硬约束现状（本轮收尾时）

| 约束 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 通过 |
| `pnpm build` | ✅ 通过 |
| `vitest` | ✅ **1177 passed / 48 skipped / 0 failed** |
| 桌面应用 | ✅ `setup: null`、`runtime: ready` |
| 提交与推送 | ✅ 仓库 `d2ecff7`，工作区干净 |

## 5. 与上游的关系（不变）

所有新增能力都是**新增模块 + opt-in 配置**，不改上游语义；每项在 `WINDOWS-DELTA.md` 有差量记录，上游若实现同名能力即删我们的模块切回。未开启时行为与上游部署完全一致。

## 6. P2 启用与验收

`routerShards: N`（默认 1）。启用后：每个分片一个 Router Session（`<masterId>-shard-<i>`），`router` 健康项显示
`N Router Sessions (sharded by Thread)`，候选按 Thread 稳定落到同一分片。

要验证分发，需要一条真实环境事件：在 `Check-mj/superagent-playground` 里由**另一个账号**（`WEAaaa-sudo`）给 issue 发
一条评论/新开 issue。看日志与路由：该 Thread 的候选只出现在其分片 Session 里，主 Router 不接它；同一 Thread 的第二条
事件必须落同一分片。智能体账号不能自己触发自己（设计约束），所以这一步无法用本机脚本完成。

## 7. P1 手动验收步骤（需要人在 Superagent 窗口里操作）

自动化的 API 没有「向主会话发一条消息」的入口，所以下面这三条只能人工确认。已开启 `asyncSubagents: true` 的实例上：

1. 在对话里说：「用 subagent_background 跑一个慢任务：先睡 25 秒，再报告 1 到 100 的和；启动后立刻告诉我『父会话仍然可用』，不要等它。」
2. **验收 A（Started 立即返回）**：工具结果应立刻返回 `{ status: "started", subagent: "...", session: "..." }`，而不是等到 25 秒后。
3. **验收 B（运行期间父会话可响应）**：紧接着再发一句「现在几点了？」，应在子任务跑完之前就有回复。
4. **验收 C（结果以事件消息回投）**：约 25 秒后，父会话收到一条以 `[background subagent ... finished]` 开头的消息，内容是 5050。
5. **验收 D（cancel 不投递）**：再启动一个慢任务，然后立刻说「取消它」；之后不应收到任何 finished 消息，工具 `subagent_cancel` 应返回 `{ cancelled: true }`。
6. **验收 E（Session 不泄漏）**：在侧栏确认多出的子会话在完成后不再活跃；进程重启后不残留。

任一条不符合即为缺陷，先修再继续 P2。

## 8. 最终状态

| 项 | 状态 |
|---|---|
| P1 异步子任务（§4.1 右半边） | ✅ 已接线（opt-in），⏳ 人工验收（§7） |
| P2 Router 分片（§2.1） | ✅ 放置/预置/分发已接线（默认 1），⏳ 人工验收（§6） |
| P3 Watchdog 深化（§6） | ✅ 完成并实测 |
| P4 状态存储接缝（§5） | ✅ 完成，行为零变化 |
| 硬约束 | typecheck / build / vitest / 应用健康 全部保持 |
