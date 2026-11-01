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

## 5. 新实例的第一次启动

新实例的 `<stateDir>/gh-config` 是空的，首次 setup 会以 `agentCliSignedOut` 失败——这是 §8.4 凭据边界**正确工作**的表现。两种解决方式：

**（推荐）在实例记录里显式声明复用：**

```json
{ "name": "team-b", "label": "Team B", "stateDir": "C:/Users/<you>/.dsh/state/team-b", "ghConfigFrom": "default" }
```

应用在启动后端之前执行一次**有条件的**复制：仅当本实例的 `gh-config` 还没有 `hosts.yml`（即尚未登录）时，从 `ghConfigFrom` 指明的实例复制 `config.yml` 与 `hosts.yml`，并写一行日志。凭据目录**仍然是每实例一份**，跨边界不共享运行期状态；这是"同账号多边界"的便利，不是默认行为，也不需要手工操作。

**（或）手工登录该实例：**

```powershell
set "GH_CONFIG_DIR=%USERPROFILE%\.dsh\state\<instance>\gh-config"
& "$env:LOCALAPPDATA\Programs\Superagent	ools\ghin\gh.exe" auth login
```

实测（本轮）：删掉 `team-b` 的 `gh-config` 后加 `"ghConfigFrom": "default"` 启动，日志出现
`[instance] seeded gh credentials for team-b from default`，随后 `setup: null`、`runtime: ready`、`stateDir=.../superagent-b`。

## 6. 顺带修掉的一个安装器缺陷

`install.ps1` 之前在**应用运行中**执行会卡死：robocopy 对锁定文件默认无限重试。现在：

- 检测到 `Superagent` 进程就直接拒绝并提示"关闭窗口后重跑"（退出码 2）
- robocopy 改为 `/R:2 /W:2`（最多重试 2 次）

## 7. 应用内实例管理窗口

**文件 → 实例…** 打开一个管理窗口，列出 `<安装>\config\instances.json` 里的每个实例（标签、名称、状态目录），每行一个「打开」按钮：点击即用同一可执行文件 `--instance <name>` 启动该边界的窗口。

命令行等价物（便于脚本与验证）：

```powershell
Superagent.exe --list-instances   # 打印实例记录（JSON）后退出，不开窗口
Superagent.exe --manage           # 直接打开管理窗口
```

实测：`--list-instances` 打印出两条记录（含 `ghConfigFrom`）；`--manage` 启动后日志出现 `[instances] window ready: Superagent 实例`，窗口枚举也确认该窗口可见。管理窗口内的按钮点击属于 GUI 交互，本会话无法模拟，已在下节标注。

## 8. 尚未做

1. 实例级总览（跨实例健康/Watchdog 汇总）：需要实例之外的观察者
2. 端口分配仍交给 DSH 的 `--patch` overlay（已默认 `0`），未做显式冲突检测
3. 管理窗口的按钮点击未经真实鼠标验证（数据通路已用 `--list-instances` 验证）
4. DSH **workspace 列表是跨实例共享的**（存在 `~/.dsh` 而非 `stateDir`），所以侧栏会看到别的实例创建的 workspace；这不影响状态隔离，但界面观感需要后续收敛
