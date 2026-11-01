# 016 桌面应用的多实例管理

> 依据：官方《Super-agent 设计探索》§8.3——一个上下文边界一个实例。`docs/015` 说明了多实例在服务侧怎么跑；本文说明**桌面应用**怎么承载它。

## 1. 目标

让"多实例"从命令行操作变成**应用内可用**的能力：每个上下文边界一个窗口，互不共享状态、策略、凭据与 Watchdog，切换时不需要记命令行参数。

## 2. 机制

应用启动时解析 `--instance <name>`（或环境变量 `SUPERAGENT_INSTANCE`），从 `<安装根目录>\config\instances.json` 读取该实例的记录：

```json
{
  "instances": [
    { "name": "default", "label": "Main",   "profile": "superagent", "stateDir": "C:/Users/<you>/.dsh/state/superagent", "port": 0 },
    { "name": "team-b",  "label": "Team B", "profile": "superagent", "stateDir": "C:/Users/<you>/.dsh/state/team-b",  "port": 0 }
  ]
}
```

记录里的三个字段分别决定：

| 字段 | 作用 | 说明 |
|---|---|---|
| `profile` | 启动哪个 DSH profile | 默认 `superagent`；不同实例可用不同 profile |
| `stateDir` | 该实例自己的状态目录 | 数据库、锁、worker 垫片、git 配置、`gh-config` 全部在它下面 |
| `port` | 面板端口 | `0` = 系统分配（推荐），避免手动撞端口 |

**不带 `--instance` 时行为与之前完全一致**（用 profile 自己的 stateDir 与端口），所以这是纯增量能力。

## 3. 管理命令

`windows-app\instances.ps1`（安装后也可从安装目录调用）：

```powershell
# 列出实例
windows-app\instances.ps1 -Action list

# 新增一个边界（例如另一个团队）
windows-app\instances.ps1 -Action add -Name team-b -Label "Team B" -StateDir "C:\Users\me\.dsh\state\team-b"

# 在桌面上生成这个实例的快捷方式（双击即开该窗口）
windows-app\instances.ps1 -Action shortcut -Name team-b

# 直接启动
windows-app\instances.ps1 -Action start -Name team-b

# 移除记录（不删状态目录）
windows-app\instances.ps1 -Action remove -Name team-b
```

`-Root` 可指定安装根目录，默认 `%LOCALAPPDATA%\Programs\Superagent`。

## 4. 实测（本轮）

1. 用 `instances.ps1 -Action add` 注册 `default` 与 `team-b` 两条记录。
2. 以 `Superagent.exe --no-sandbox --disable-gpu --instance team-b` 启动。
3. 启动日志：`[instance] team-b | profile=superagent | stateDir=C:/Users/Chen/.dsh/state/superagent-b | port=0`
4. `GET /orchestrator/api/state`：`setup: null`、`runtime: ready`、`stateDir = .../state/superagent-b`

即：同一个应用可同时开两个窗口，各跑一个上下文边界，状态与凭据目录互不相干。

## 5. 新实例的第一次启动（务必知道）

新实例的 `<stateDir>/gh-config` 是空的，首次 setup 会以 `agentCliSignedOut` 失败——这是 §8.4 凭据边界**正确工作**的表现。二选一：

- 在该实例的日志/面板提示下，用它的 `GH_CONFIG_DIR` 跑一次 `gh auth login`；或
- 同账号多实例时，复制已有实例的 `gh-config\config.yml` 与 `hosts.yml`。

## 6. 顺带修掉的一个安装器缺陷

`install.ps1` 之前在**应用运行中**执行会卡死：robocopy 对锁定文件默认无限重试。现在：

- 检测到 `Superagent` 进程就直接拒绝并提示"关闭窗口后重跑"（退出码 2）
- robocopy 改为 `/R:2 /W:2`（最多重试 2 次）

## 7. 尚未做

1. 应用内**GUI** 的实例列表（现在的"管理面"是 `instances.ps1` + 每实例快捷方式；窗口本身仍是单实例视图）
2. 实例级总览（跨实例健康/Watchdog 汇总）：需要实例之外的观察者
3. 端口分配仍交给 DSH 的 `--patch` overlay（已默认 `0`），未做显式冲突检测
