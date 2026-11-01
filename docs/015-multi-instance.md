# 015 多实例：§8.3「一个上下文边界一个实例」的落法

> 依据：官方《Super-agent 设计探索》§8.3——**需要共享上下文的范围共用一个实例，需要隔离的范围则各自独立配备**。
> 本文说明在本 fork 上如何跑多个实例，以及为什么这不是"再做一个多仓库功能"。

## 1. 为什么是实例而不是多仓库

`docs/011` 记录了那次方向修正。一句话：一个进程 = 一份 Router 记忆 + 一套策略 + 一个凭据边界。把两个不该共享上下文的仓库塞进同一个进程，等于让它们共享这三样东西——与 §8.3 相反。正确做法是**多实例**：隔离由进程与状态目录天然实现，不需要在每个子系统里做实例切分。

实例的守卫已恢复：配置多个 GitHub Source 时 setup 会报 `multipleSourcesUnsupported`，并指引按边界多起实例。

## 2. 一个实例的完整边界

| 组成 | 每实例独立 | 说明 |
|---|---|---|
| DSH profile | ✅ | `$DSH_HOME/profiles/<name>`，profile 名决定 `dsh-<profile>` 的 tmux/pidfile 命名 |
| 状态目录 `stateDir` | ✅ | 数据库、锁、worker 垫片、git 配置、工单目录、**实例级 gh 配置目录** |
| 声明式配置 | ✅ | 每实例一份 `superagent.settings.json`（见 `docs/009`） |
| Watchdog | ✅ | 每实例一个 Control Loop Session，间隔独立（见 `docs/012`） |
| 端口 | ✅ | 每个 profile 的 `webserver.port` 不同（或用覆盖层自动分配） |
| 仓库与账号 | 按边界 | 同一实例内的仓库必须共享记忆与凭据；跨边界就再起一个实例 |

## 3. 怎么跑第二个实例（当前可用的做法）

1. **复制一份 profile**（不要复用正在用的那个）：

   ```powershell
   dsh.cmd team-b --from-default-profile web --dump-config > $null
   dsh.cmd plugin --profile team-b add "link:D:/path/to/dsh-superagent"
   ```

2. **给新 profile 一份机器配置**（`$DSH_HOME/profiles/team-b/cordis.patch.yml`），关键是**不同的 `stateDir` 与端口**：

   ```yaml
   - id: webserver
     config: { host: 127.0.0.1, port: 3083 }
   - id: dsh-superagent
     config:
       stateDir: C:/Users/<you>/.dsh/state/team-b
       configPath: C:/Users/<you>/AppData/Local/Programs/Superagent/config/team-b.settings.json
       watchdogMinutes: 30
   ```

3. **跑起来**：

   ```powershell
   node "$env:APPDATA/npm/node_modules/@deepseek-ai/dsh/lib/bin.js" --profile team-b --no-open
   ```

4. **验证隔离**：两个实例的 `GET /orchestrator/api/state` 各自返回自己的 `stateDir`；两边数据库、锁、游标互不影响；任一实例的账号失效不影响另一个（这是 §8.3 的直接收益）。

## 4. 实测（本轮）

在本机同时运行两个实例（同一仓库、同一账号，仅 `stateDir` 与端口不同）：

| 实例 | stateDir | 端口 | 结果 |
|---|---|---|---|
| A（桌面应用） | `.../state/superagent` | 应用自动分配 | `setup: null`、`runtime: ready` |
| B（命令行） | `.../state/superagent-b` | 3083 | `setup: null`、`runtime: ready`，账号解析为 `Check-mj` |

- 两者各自持有独立的 `orchestrator.sqlite`、`worker-gitconfig`、`gh-config`、`.lock`
- 互不阻塞、无锁冲突（这正是多仓库方案当年反复踩的坑）
- 停止 B 不影响 A

### 由此发现的一条运维前提（重要）

新实例的 `<stateDir>/gh-config` 是**空的**，因此它的第一次 setup 会以 `agentCliSignedOut` 失败——这是 §8.4 凭据边界正确工作的表现，不是缺陷。**每个实例都需要一次性把智能体账号登进自己的配置目录**：

```powershell
set "GH_CONFIG_DIR=%USERPROFILE%\.dsh\state\<instance>\gh-config"
& "$env:LOCALAPPDATA\Programs\Superagent	ools\ghin\gh.exe" auth login
```

如果同一账号的多个实例共用凭据（只读场景常见），把已有实例的 `gh-config\{config.yml,hosts.yml}` 复制过去即可（本轮就是这样验证的）。

结论：§8.3 在本 fork 上**可落地**——多上下文 = 多实例，隔离由状态目录承担，凭据边界随之天然分离。

## 5. 尚未做（后续）

1. **桌面应用的多实例管理**：现在第二个实例要手工起（命令行）。应用侧应提供「实例列表 / 新建 / 启停 / 打开窗口」，每个实例一条记录（profile、stateDir、端口、配置路径）。
2. **实例级 Watchdog 的统一视图**：目前每个实例的 Watchdog 各管自己；若要多实例总览，需要一个更外层的观察者（不属于任何单实例）。
3. **端口冲突**：手工配置端口；应用侧可在启动时探测空闲端口并写回覆盖层（现有桌面应用已对单实例用 `--patch` 做这件事，可复用）。
