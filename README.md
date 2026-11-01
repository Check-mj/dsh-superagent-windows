# DSH-Superagent

> **这是官方项目的 Windows 深度适配版（非官方产品，版权归原作者）。**
> Upstream: [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) · MIT · Copyright (c) 2026 DeepSeek Harness Team
>
> 本仓库 fork 自上面这个官方原型，目标是让它成为**在 Windows 上可日常使用的深度适配版**：桌面应用、打包工具链、
> 多实例、一行安装，并补齐官方文章里描述、上游尚未实现的部分（Watchdog 控制回路、Router 分片）。
> 上游代码与设计版权归 DeepSeek Harness Team；本仓库新增部分同样以 MIT 发布。与上游的差异逐条记录在
> [WINDOWS-DELTA.md](WINDOWS-DELTA.md)，上游更新可合并。
>
> **This repository is the Windows adaptation of the official project above, not an official DeepSeek product.**
> The upstream code and design are MIT-licensed by the DeepSeek Harness Team; the additions here are MIT as well.

> **显示名是 DSH-Superagent；npm 包名仍是 `dsh-superagent`**（插件 id、profile 依赖名与内部路径不变，
> 改名会破坏已安装实例）。

> **上游的定位没有变**：官方原型是研究代码、不是官方产品。本适配版继承这一说明，并把它做成可日常使用的一层。

DSH-Superagent 是一台**持续在线**的开发助手：它监听一个 GitHub 仓库，把获授权的请求变成工单，在各自的
DeepSeek Harness 会话里执行，并把结果回贴到原处（评论或 Pull Request）。你不需要逐个开对话、逐个盯进度——
面板就是它的控制台。

## 发布

最新版本与校验值：<https://github.com/Check-mj/dsh-superagent-windows/releases>

```powershell
irm https://raw.githubusercontent.com/Check-mj/dsh-superagent-windows/main/install.ps1 | iex
```

安装器会：下载 Release → **校验 SHA-256** → 解压 → 调用包内同款安装器（默认装到
`%LOCALAPPDATA%\Programs\Superagent`，创建桌面与开始菜单快捷方式）。网络访问不了 `github.com/releases` 时，
会自动改走 `api.github.com` 取同一个资产。

可覆盖的环境变量：`$env:DSH_SUPERAGENT_ROOT`（安装目录）、`$env:DSH_SUPERAGENT_VERSION`（版本）、
`$env:DSH_SUPERAGENT_NOSHORTCUTS = '1'`（不建快捷方式）。

装好后从快捷方式启动。面板第一个标签是**介绍**：这个面板做什么、五个页面各自的作用、四步上手、使用提示。

## 它解决什么问题

单个 Coding Agent 已经能干活，但它的工作单位仍是「一次会话」：并行推进多项工作时，人得手动切换并记住上下文。
官方文章把这种形态称为 Super-agent，并给出四个特征——**连续、高效、主动、持久**。本适配版把这套形态搬到
Windows 上，让它能像普通软件一样安装、启动、常驻，并把设计里的可调项做进设置面板。

## 能力

| 能力 | 说明 |
|---|---|
| **双击即用** | 便携 Electron 外壳自己拉起 DeepSeek Harness 后端；不需要 tmux、不需要 Python、不需要另起 Web 服务 |
| **内置工具链** | 安装包内含 `git`、`gh`、PowerShell 7（`tools\`），不必手工装 |
| **主动式工作流** | 轮询 GitHub → 程序层过滤 → 语义层评估 → 建单执行 → 结果回贴；触发、评估、工单、回贴全在面板可见 |
| **多实例** | 一个上下文边界一个实例：独立 `stateDir`、配置、凭据目录与 Watchdog；`instances.ps1` + 应用内实例管理器 |
| **可观测** | 失败原因、健康项、工单会话与报告、轮询状态都在面板里；桌面端有诊断页与日志路径 |
| **可配置** | 面板设置 + 声明式配置文件（[`docs/009`](docs/009-declarative-settings.md)）；新增行为全部 opt-in |
| **可跟随上游** | 每项差异记在 [`WINDOWS-DELTA.md`](WINDOWS-DELTA.md)；上游实现同名机制时删掉我们的版本切回上游 |

## 与上游的差异（摘要）

完整清单与合并方法见 [`WINDOWS-DELTA.md`](WINDOWS-DELTA.md)。

- **桌面应用**（`windows-app/`）：便携布局、内置工具链、安装器、诊断与错误页、多实例
- **Watchdog 深化**（文章 §6）：跨 tick 差分（健康时不唤醒）、停滞识别（看起来在跑其实不动）、常驻指令
- **Router 分片**（文章 §2.1）：按 Thread 稳定分配、分片会话按需创建、健康可见；默认关闭
- **面板**：新增「介绍」引导页；执行设置里可调控制回路与分片参数
- 修复：安装器在应用运行时卡死；GitHub 轮询与凭据按实例隔离

## 第一次使用

1. **接上仓库**：设置 → 来源，填仓库与 GitHub CLI，确认状态变成「就绪」
2. **决定谁能触发**：设置 → 评估，把团队成员加入允许名单（名单外的人不会唤起它）
3. **确认判断策略**：明确请求直接接单；含糊的消息走语义评估，必要时来问你
4. **看执行与结果**：执行页看待处理工单，原 Thread 看回贴结果；需要介入时停止/继续

更细的说明在面板「介绍」页与 [`SETUP.md`](SETUP.md)（给 Agent 读的安装向导）。

## 多实例

```powershell
# 新增一个上下文边界（另一个团队 / 另一个仓库）
windows-app\instances.ps1 -Action add -Name team-b -Label "Team B" -StateDir "C:\Users\<you>\.dsh\state\team-b"
# 为它生成桌面快捷方式
windows-app\instances.ps1 -Action shortcut -Name team-b
```

一个进程只服务一个上下文边界（文章 §8.3）。多个边界 = 多个实例，各自独立重启、独立 Watchdog。
详见 [`docs/015`](docs/015-multi-instance.md) 与 [`docs/016`](docs/016-multi-instance-app.md)。

## 控制回路与分片

面板 **设置 → 执行 → 控制回路（Watchdog）与 Router 分片**：

| 设置 | 默认 | 作用 |
|---|---|---|
| `watchdogMinutes` | 30 | 摘要间隔；0 关闭。健康且无变化时不会唤醒模型 |
| `watchdogStallMinutes` | 45 | 工单多久没推进算「停滞」 |
| `watchdogGuidance` | 空 | 常驻指令，随每次摘要下发给 Watchdog |
| `routerShards` | 1 | Router 分片数，按 Thread 固定分配；**改后需重启** |

设计与取舍见 [`docs/012`](docs/012-watchdog.md)、[`docs/017`](docs/017-independent-layer.md)。

## 只装插件（不装桌面应用）

```powershell
dsh plugin --profile superagent add "git+ssh://git@github.com/Check-mj/dsh-superagent-windows.git#main"
```

仓库已包含构建产物（`lib/`），安装时无需再构建。想在本机 checkout 上改代码时改用 `link:<checkout>`。

## 目录结构

```
windows-app/     便携桌面应用：Electron 外壳、打包脚本、安装器、实例管理
src/             插件本体（TypeScript）：来源、核心、执行器、面板服务
locale/          面板与插件页的显示名、描述（中英）
prompts/         提示词段落
docs/            编号设计文档（000–019）与 Windows 操作说明
scripts/         启动/停止/状态脚本
tests/           单元与面板测试（文档与代码一致性也在其中）
```

## 文档索引

| 文档 | 内容 |
|---|---|
| [`SETUP.md`](SETUP.md) | 给 Agent 读的安装向导（一次一个问题，最后统一执行） |
| [`WINDOWS-SETUP.md`](WINDOWS-SETUP.md) | Windows 上的完整部署与排错 |
| [`WINDOWS-DELTA.md`](WINDOWS-DELTA.md) | 与上游的逐项差异、上游跟随方法 |
| [`CHANGELOG.md`](CHANGELOG.md) | 本适配版的版本历史 |
| [`NOTICE`](NOTICE) | 归属与新增部分声明 |
| [`docs/000`](docs/000-philosophy.md) | 设计哲学：尽可能少占用人的注意力 |
| [`docs/001`](docs/001-domain.md) | 领域模型：Trigger / Thread / Ticket / Assignment |
| [`docs/002`](docs/002-authorization.md) | 授权：谁能唤起 Agent、准入与两级过滤 |
| [`docs/003`](docs/003-execution.md) | 执行：执行器、会话、报告 |
| [`docs/004`](docs/004-prompts.md) | 提示词：段落组织与团队提示词 |
| [`docs/005`](docs/005-panel.md) | 面板：路由与视图 |
| [`docs/006`](docs/006-deployment.md) | 部署：profile、状态目录、契约 |
| [`docs/007`](docs/007-architecture.md) | 架构：模块与测试清单 |
| [`docs/008`](docs/008-cookbook.md) | 操作手册：常见任务的做法 |
| [`docs/009`](docs/009-declarative-settings.md) | 声明式设置文件 |
| [`docs/010`](docs/010-multi-source.md) | 多来源调研（未采纳的路线与原因） |
| [`docs/011`](docs/011-official-design-conformance.md) | 与官方设计的一致性审查 |
| [`docs/012`](docs/012-watchdog.md) | Watchdog 控制回路 |
| [`docs/013`](docs/013-full-duplex.md) | 全双工交互（§4.1）对照 |
| [`docs/014`](docs/014-chain-of-recall.md) | 链式召回（§3.3）对照 |
| [`docs/015`](docs/015-multi-instance.md) | 多实例：一边界一实例 |
| [`docs/016`](docs/016-multi-instance-app.md) | 应用内多实例管理与凭据种子 |
| [`docs/017`](docs/017-independent-layer.md) | 独立实现层：补上游未做的机制 |
| [`docs/018`](docs/018-delivery-state.md) | 交付状态与验收清单 |
| [`docs/019`](docs/019-video-script.md) | 发布视频脚本（分镜 + 旁白） |
| [`docs/020`](docs/020-release-checklist.md) | 发布检查清单：发布前逐项验证与回滚 |

## 常见问题

**它会自己改我的仓库吗？** 只在你或名单里的人请求、或团队写下的规则允许时行动；它写出的内容都在它自己的账号名下，
并出现在原 Thread 里。自动合并默认关闭。

**必须有自己的 GitHub 账号吗？** 需要「智能体账号」——它做的事都记在这个账号名下。不要用你自己的主账号。

**需要常开一台机器吗？** 是。它是常驻进程；进程停了就不工作。外部可以挂一个定时检查（见 [`WINDOWS-SETUP.md`](WINDOWS-SETUP.md)）
作为最外层兜底。

**数据存在哪里？** 每个实例一个状态目录（默认 `~/.dsh/state/superagent`）：数据库、锁、工单目录、凭据目录。
卸载应用不会删它。

**为什么显示名和包名不一样？** 包名是安装契约（插件 id、profile 依赖、内部路径），改了会破坏已安装实例；
显示名只是给人看的。

## 致谢与归属

- **上游项目与设计**：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)，
  MIT，Copyright (c) 2026 DeepSeek Harness Team。上游也明确说明：它是研究原型，不是官方产品。
- **设计思想来源**：官方文章《Super-agent 设计探索：迈向更自主的 Agent 系统》。
- **本适配版**：Windows 桌面应用、多实例、Watchdog 深化、Router 分片、文档与测试，以 MIT 发布，详见 [`NOTICE`](NOTICE)。
- **社区参考**：[hxh230802/dsh-superagent-prototype](https://github.com/hxh230802/dsh-superagent-prototype)
  （MSP 本机感知与经验库方向），其 MIT 许可与原创性归其作者。

## 许可

MIT，见 [`LICENSE`](LICENSE)。
