# dsh-superagent Windows 操作手册

> 面向本机操作者（Windows 11 Pro x64，**没有管理员权限**）的完整部署与运维手册。
> 上游文档（`README.md`、`SETUP.md`、`docs/000`–`docs/008`）描述的是 Linux/macOS 的形态；本文件记录 **Windows 原生移植**后真正可用的做法，并标出与上游的每一处差异。
>
> 文档状态标记：
> ✅ **本机实测**（写这份文档时实际跑过）　🔧 **源码确认**（读移植代码确认，未逐条运行）　⏳ **待定/未验证**（第 12 节汇总）

---

## 目录

1. [这是什么，以及 Windows 上它是怎么构成的](#1-这是什么以及-windows-上它是怎么构成的)
2. [Windows 前置条件](#2-windows-前置条件)
3. [一次性装配：插件、DSH CLI、桌面应用](#3-一次性装配插件dsh-cli桌面应用)
4. [机器配置：profile 的 cordis.patch.yml](#4-机器配置profile-的-cordispatchyml)
5. [模型 provider](#5-模型-provider)
6. [GitHub 智能体账户（最重要的一步）](#6-github-智能体账户最重要的一步)
7. [面板设置：Sources → Policy → Execution → Prompts](#7-面板设置sources--policy--execution--prompts)
8. [启动 / 停止 / 状态](#8-启动--停止--状态)
9. [第一次跑通](#9-第一次跑通)
10. [故障排查](#10-故障排查)
11. [Windows 移植与上游的差异](#11-windows-移植与上游的差异)
12. [验证状态与开放问题](#12-验证状态与开放问题)
13. [附录：路径、命令、升级与回滚](#13-附录路径命令升级与回滚)

---

## 1. 这是什么，以及 Windows 上它是怎么构成的

dsh-superagent 是 **一个 GitHub 仓库的常驻编码智能体**，作为 DeepSeek Harness（下文 DSH）的插件运行：它监听 GitHub（可选飞书），把"被允许的人提出的请求"变成一张 **Ticket（工单）**，在自己的 Session 和目录里干活，最后回到原对话交付结果（通常是一个 Pull Request）。面板只显示"需要人处理的事"。

### 1.1 三层结构

```
┌──────────────────────────────────────────────────────────────┐
│ Superagent 桌面应用（Electron，便携，无 admin）              │
│  D:\1111\superagent-app\Superagent\Superagent.exe           │
│  · 自己的窗口 + 图标，双击即用                               │
│  · 负责拉起后端、清理子进程、显示启动失败页                  │
└───────────────────────────┬──────────────────────────────────┘
                            │ 启动一个隐藏的子进程（不经过 shell）
┌───────────────────────────▼──────────────────────────────────┐
│ DSH 后端：dsh profile = superagent                           │
│  node …\@deepseek-ai\dsh\lib\bin.js --profile superagent    │
│       --patch <userData>\runtime.patch.yml --no-open         │
│  · 只监听 127.0.0.1 的随机端口（应用强制 port 0）            │
│  · 在应用窗口里加载 http://127.0.0.1:<port>/?token=…        │
└───────────────────────────┬──────────────────────────────────┘
                            │ 插件 dsh-superagent（link: 到本机 checkout）
┌───────────────────────────▼──────────────────────────────────┐
│ 面板（侧栏 Superagent）+ 智能体                              │
│  · 主 Session 评估、路由；每个 Ticket 一个执行器 Session     │
│  · 以 你的 Windows 用户 身份、danger-full-access 运行        │
│  · 通过独立的 GitHub 账号发评论、推分支、开 PR               │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 本机各组件的确切位置

| 组件 | 位置 / 取值 | 状态 |
| --- | --- | --- |
| 桌面应用（构建产物） | `D:\1111\superagent-app\Superagent\Superagent.exe`（便携目录约 250 MB） | ✅ 已构建；⏳ 双击验收中 |
| 应用源码 | `D:\1111\superagent-app\`（`main.js`、`build-portable.js`、`icon.png`） | 🔧 已读源码 |
| 应用用户数据 | `%APPDATA%\Superagent\`（`app.log`、`backend.log`、`runtime.patch.yml`、`window-state.json`）<br>实际路径以应用内 **帮助 → 关于 Superagent** 为准 | 🔧 源码确认，⏳ 目录名待实测 |
| DSH 安装 | `C:\Users\Chen\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`（版本 `0.2.1-rc.3`） | ✅ |
| DSH profile | `C:\Users\Chen\.dsh\profiles\superagent\` | ✅ 已存在 |
| 插件 checkout | `D:\1111\dsh-superagent`（profile 以 `link:` 指向它） | ✅ 已 link |
| 状态目录 `stateDir` | `C:/Users/Chen/.dsh/state/superagent`（数据库、锁、worker shim、agent 的 git 配置、工单目录） | ✅ 配置好；目录已创建，含 `orchestrator.sqlite` |
| 模型凭据 | `C:\Users\Chen\.dsh\.credentials.yaml` 的 `refs: OPENCODE_GO_API_KEY` | ✅ 已存在 |
| GitHub 智能体账户 | 单独的 GitHub 用户；面板 CLI 填 `gh.exe` 的绝对路径，账号由 `GH_CONFIG_DIR` 隔离（第 6 节） | ⏳ 需要你创建账户并登录 |
| 被操作的仓库 | `github.com/<owner>/<name>` + 本地 clone（供 `git worktree` 使用） | ⏳ 需要你指定 |
| 工单目录 | `stateDir\work\<工单短名>-<id前12位>\`（默认） | 🔧 |

### 1.3 两条运行路径（用途不同，别混用）

| | **桌面应用**（日常用） | **CLI 服务管理器**（排障 / 无人值守） |
| --- | --- | --- |
| 入口 | 双击 `Superagent.exe` | `.\scripts\dsh-superagent.cmd start` |
| 端口 | 随机空闲端口（应用写入 `runtime.patch.yml` 覆盖） | profile 里写死的 `3082` |
| 需要打开浏览器吗 | 不需要，窗口内嵌面板 | 需要，日志里会打印带 token 的 URL |
| 需要 `gh` 在 PATH 吗 | 不需要（面板里填绝对路径） | 同左 |
| 关闭方式 | 关窗口 / 文件→退出 | `.\scripts\dsh-superagent.cmd stop` |
| 状态 | 窗口内可见 | `status` 的退出码 0/1/2/3 |

> 两者不会互相复用：应用每次启动自己的后端；CLI 启动的是 profile 固定端口的后端。**同一时间只用一个**，避免两个实例抢同一个 `stateDir`。

### 1.4 一次请求的流转（理解面板的前提）

`Trigger`（GitHub 通知/评论）→ `Thread` → `Eval`（门禁 + 研判）→ 接受则创建 `Ticket` → `Assignment` → `Executor Session` 在自己的目录里干活 → 通过 `Channel` 回到原对话（评论 / PR）。术语见 `docs/001-domain.md`，面板与本文都用这套词。

### 1.5 三条必须知道的安全事实

1. **没有管理员权限也能全程部署**：所有东西都在用户目录、`D:\1111` 下，不写注册表的机器级设置。
2. **执行器和智能体以"你"的 Windows 账户身份、`danger-full-access` 运行**（见 `docs/006-deployment.md` 的 Permissions and isolation）。CLI 包装器和 worker 目录只是默认值，**不是安全边界**；要真正隔离，只能用独立的 Windows 账户。
3. **智能体的每条 GitHub 发言都署它自己的账户名**，所以永远不要用你的账户当智能体（第 6 节）。

---

## 2. Windows 前置条件

### 2.1 版本下限与本机现状

| 组件 | 要求 | 本机现状 | 结论 |
| --- | --- | --- | --- |
| Windows | Windows 10/11 x64 | Windows 11 Pro，build 26300，非管理员 | ✅ |
| Node.js | `^22.19.0 \|\| >=24.0.0`（`package.json` engines） | **v26.13.0**，`C:\Program Files\nodejs\node.exe` | ✅ |
| pnpm | 项目声明 `pnpm@11.7.0`（`packageManager`） | **10.34.9**，`%APPDATA%\npm\pnpm.cmd` | ✅ 可用（见 3.2 的注意事项） |
| git | **>= 2.32**，且发行版要自带 `sh.exe`（Git for Windows / MinGit 都有） | **2.56.0.windows.2** 存在，但**不在 Explorer 的 PATH 里**（只在 DSH 会话的 PATH 里） | ⚠️ 必须加进 **User PATH**，见 2.2 |
| Python | >= 3.8（Windows 启动器用） | **3.12.10**，用户 PATH 中；`py` 启动器也在 | ✅ |
| GitHub CLI `gh` | **>= 2.48** | 便携版 **2.103.3**：`D:\1111\toolchain\gh\bin\gh.exe`，**不在 PATH** | ⚠️ 见 2.2（建议装一份并加入 User PATH） |
| DSH CLI | 满足 `engines.dsh: ^0.2.1-alpha.2`；本机固定 `0.2.1-rc.3` | 已全局安装 `0.2.1-rc.3` | ✅ |
| tmux | 上游需要 | **Windows 不需要**：移植用 Windows 进程管理替换（第 8 节） | ✅ 缺省即可 |
| PowerShell | 任意 | Windows PowerShell 5.1；执行策略 `Restricted` | ⚠️ 见 2.3 |

### 2.2 必须在本机补上的两件事（git、gh 进 User PATH）

**支持的部署方式：把 `git` 和 `gh` 加进"当前用户"的持久 PATH。** 桌面应用是从 Explorer 双击启动的，它继承的是用户 PATH；
**你的用户 PATH 目前既没有 git 也没有 gh**，只有 Python、`%APPDATA%\npm` 等。因此：

- `git`：后端的初始化检查（`verifyEnvironment`）、工单的准备命令、执行器工作区都按名字调用 `git`。
  **找不到 git 时，setup 会报成非常容易误解的**
  `git does not read the github.com credential configuration dsh-superagent writes; … needs git 2.32 or later`（`gitTooOld`）。
  → 看到这条，**第一件事是在新开终端里跑 `where git`**，通常就是 git 不在 PATH 上。
- `gh`：运行期只通过**面板里填的那个绝对路径**调用它（第 7.2 节），所以**严格来说 `gh` 不在 PATH 也能工作**；但建议一并加入 User PATH，方便你手动登录/自查，也让应用的探测能发现它。

**桌面应用的便利层（已实现，🔧 源码确认；GUI 验收见 12.2）**：应用启动时会调 `where git` / `where gh`，找不到再试已知目录
（git：`C:\Program Files\Git\cmd`、`C:\Program Files (x86)\Git\cmd`、`%LOCALAPPDATA%\Programs\Git\cmd`、`D:\1111\toolchain\git\cmd`；
gh：`C:\Program Files\GitHub CLI`、`%LOCALAPPDATA%\GitHubCLI`、`D:\1111\toolchain\gh\bin`），
找到就把它们的目录**前置到后端子进程的 PATH**（不设置 `GH_CONFIG_DIR`，那个由插件管）。
两者都找不到时，启动页和面板顶部会显示横幅：
`未找到 git (Git for Windows) / gh (GitHub CLI)：GitHub 集成不可用。请安装 Git for Windows 与 GitHub CLI，并加入用户 PATH，然后按 Ctrl+Shift+R 重启后端。`
**看到横幅时，按 2.4 把它们加进 User PATH 再重启应用。**
注意这条便利层只覆盖**桌面应用**启动的后端；用 `scripts\dsh-superagent.cmd` 启动的 CLI 路径**不会**自动注入，必须靠 User PATH
（或在该窗口先 `. D:\1111\toolchain\env.ps1`）。

> 立刻自查：**新开**一个 PowerShell 窗口运行 `git --version` 与 `gh --version`。
> 看不到版本号也不一定打不开桌面应用（应用会用已知目录兜底并显示横幅），但 **CLI 路径一定需要**；
> 看不到就按 2.4 加进 User PATH，然后重启应用/后端。

### 2.3 执行策略：为什么本手册一律用 `.cmd`

本机 `Get-ExecutionPolicy` 返回 **`Restricted`**。这带来两个实际后果：

1. npm/pnpm 全局安装会在 `%APPDATA%\npm` 里同时生成 `xxx.cmd` 和 `xxx.ps1`；某些情况下 PowerShell 会先解析到 `.ps1`，于是报：
   `无法加载文件 …\npm.ps1，因为在此系统上禁止运行脚本。`
   → **永远显式调用 `npm.cmd` / `pnpm.cmd` / `dsh.cmd`**（或用完整路径 + `&` 调用运算符）。
2. 任何 `.ps1` 脚本（包括你自己写的巡检脚本）都不能直接双击/直接运行；需要时用
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <脚本>`，**不要**为了省事把全局执行策略改成 `Unrestricted`。

### 2.4 无管理员权限的安装 / PATH 方法

**方式 A（推荐，持久）：官方安装到"当前用户"**

```powershell
# 用 winget（不需要管理员；--scope user 表示当前用户）
winget install --id Git.Git     -e --scope user
winget install --id GitHub.cli  -e --scope user
winget search python            # 例：Python.Python.3.12（本机已装 3.12.10，无需再装）

# 不想用 winget 时：
#   Git for Windows: https://git-scm.com/download/win  → 安装器选 “Only install for me”
#   GitHub CLI:      https://github.com/cli/cli/releases → 用 gh_*_windows_amd64.zip 便携版
```

- Git for Windows 安装时**保持勾选 "Git from the command line and also from 3rd-party software"**（否则 `git` 不进 PATH）。
- 官方安装器通常会把目录写进 User PATH（Git for Windows 的 `…\Git\cmd`，GitHub CLI 的 `…\GitHub CLI`）；**装完后新开一个终端**，用 `where git` / `where gh` 确认能看到。
- ⏳ winget 的 id 与 `--scope user` 行为未在本机逐一验证（当前没有网络/提权）；若 winget 拒绝，用上面两个官方下载，安装时选"仅为我/当前用户"。

**方式 B（本机现状，临时可用）：便携 toolchain `D:\1111\toolchain`**

```powershell
# 每个新开的 PowerShell 窗口执行一次；只修改当前进程的环境，不写注册表
. D:\1111\toolchain\env.ps1
git --version      # git version 2.56.0.windows.4（工具链副本）
gh --version       # gh version 2.103.3
python --version   # Python 3.12.10
```

`env.ps1` 做的事（已读源码）：把 `git\cmd`、`git\usr\bin`、`gh\bin`、`python`、`python\Scripts` 插到当前 `PATH` 前面，设置 `GIT_EXEC_PATH`、`GH_CONFIG_DIR=D:\1111\toolchain\config\gh`、`PYTHONIOENCODING=utf-8`、`PYTHONUTF8=1`。它是**进程级**的，可以重复 dot-source。
注意：它把 `GH_CONFIG_DIR` 指到工具链内部，所以**你在终端里的 `gh` 用的是工具链那份登录**；智能体账户用插件自己的 `GH_CONFIG_DIR`（第 6 节），互不影响。
这是本次移植会话的**临时方案**；长期使用请走方式 A，把 git/gh 做成持久的 User PATH。

**把目录加进"当前用户"PATH（方式 A/B 都可能需要）**

```powershell
# 先看当前用户 PATH
[Environment]::GetEnvironmentVariable('Path','User')

# 追加（示例：git 的 cmd 目录；gh 同理换成它自己的目录）
$dirs = @(
  'C:\Users\Chen\AppData\Local\Programs\Git\cmd',
  'C:\Users\Chen\AppData\Local\Programs\GitHub CLI'
)
$old = [Environment]::GetEnvironmentVariable('Path','User')
$add = ($dirs | Where-Object { $old -notlike "*$_*" }) -join ';'
if ($add) { [Environment]::SetEnvironmentVariable('Path', ($old.TrimEnd(';') + ';' + $add), 'User') }
```

- 只对**之后新启动**的进程生效；已经开着的 Explorer / 应用看不到，**重新登录一次**（或重启 `explorer.exe`）再双击应用。
- **不要用 `setx`**（超过 1024 字符会截断，且容易把 PATH 写坏）。
- 加完用**新开的**终端验证：`where git`、`where gh` 都应先出现你自己的安装目录。

### 2.5 为什么需要 Python

Windows 的服务管理器不是原生 exe，而是：

```
scripts\dsh-superagent.cmd   ← 找 Python 3
scripts\dsh-superagent       ← Python 实现（上游同一个文件，Windows 分支）
```

`.cmd` 的查找顺序（已读源码）：`DSH_SUPERAGENT_PYTHON` 环境变量 → `py -3` → `python.exe` / `python3.exe`。本机这三种都有（Python 3.12.10 + `py` 启动器），所以**不需要额外设置**。若以后换机器，报 `dsh-superagent needs Python 3.8 or later on PATH` 时按提示设置 `DSH_SUPERAGENT_PYTHON` 即可。

### 2.6 不需要 tmux

上游 `scripts/dsh-superagent start` 依赖 tmux；Windows 上没有也不会有。移植版保留同一个 Python 脚本和同一套 CLI/退出码，Windows 分支改为：

- `start`：用 `CREATE_NO_WINDOW` 在**隐藏的独立控制台**里启动后端，把 PID 写进 `.artifacts\control\profiles\<profile>\service.pid`，并用 `node --import scripts\dsh-service-hook.mjs` 预加载停止钩子；
- `stop`：通过命名管道发送 `stop`，钩子把它转成 DSH 本来就在处理的 **SIGINT**（收尾 Sessions 后退出），**从不强杀**；
- `status`：读 PID + 管理 API 健康状态。

---

## 3. 一次性装配：插件、DSH CLI、桌面应用

> 本机这些步骤**大部分已经由移植过程完成**（见每步的状态）。下面给出完整命令，供你核对、重装或迁移到另一台机器时使用。
> 所有命令都在**普通（非管理员）PowerShell 窗口**里、以 `D:\1111\dsh-superagent` 为当前目录执行。

### 3.1 先建立变量（每个窗口执行一次）

```powershell
Set-Location D:\1111\dsh-superagent
. D:\1111\toolchain\env.ps1          # 可选：本机的便携 git/gh/python 工具链
$npm  = 'C:\Program Files\nodejs\npm.cmd'
$pnpm = (Get-Command pnpm.cmd).Source   # 例：C:\Users\Chen\AppData\Roaming\npm\pnpm.cmd
$dsh  = "$env:APPDATA\npm\dsh.cmd"      # npm -g 安装后出现
```

### 3.2 装依赖并构建插件（✅ 已完成，`lib\` 存在）

```powershell
& $pnpm install
& $pnpm build
Test-Path .\lib        # True
```

- 说明：插件是 TypeScript，`dsh` 加载的是构建产物 `lib\`，所以 `build` 不能跳过。`test`/`typecheck` 可选（`& $pnpm check` 全跑）。
- **不要**去修什么 `npm.ps1` 报错，用上面的 `npm.cmd`/`pnpm.cmd` 路径即可。
- pnpm 版本注意：项目 `packageManager` 写的是 `11.7.0`，本机是 `10.34.9`。当前 lockfile 可以被 10.x 读取，安装已经成功；只有在出现 lockfile/引擎不匹配报错时，才升级：
  ```powershell
  & $npm install -g pnpm@11.7.0
  ```
- 🔧 若构建时原生依赖（rolldown/lightningcss 等）下载失败，重跑一次 `& $pnpm install`；仍失败时再考虑换 Node LTS（22/24），当前 Node 26 满足 engines。

### 3.3 全局安装 DSH CLI（✅ 已安装 `0.2.1-rc.3`）

```powershell
& $npm install -g '@deepseek-ai/dsh@0.2.1-rc.3'
& $dsh --version           # 0.2.1-rc.3
```

- 版本必须满足 `package.json` 的 `engines.dsh`（`^0.2.1-alpha.2`）；本次固定用 `0.2.1-rc.3`。
- 安装后 `%APPDATA%\npm\` 下会出现 `dsh`、`dsh.cmd`、`dsh.ps1`。**请始终调用 `dsh.cmd`**（原因见 2.3）。

### 3.4 创建 profile（⚠️ 本机已存在，**绝对不要重跑**）

```powershell
# 仅当 C:\Users\Chen\.dsh\profiles\superagent 不存在时才执行：
& $dsh superagent --from-default-profile web --dump-config > $null
```

- 上游是 `> /dev/null`；PowerShell 的等价写法是 `> $null`（或 `| Out-Null`）。
- 第一个位置参数是 **profile 名**（`superagent`）；`--from-default-profile web` 表示"从 DSH 的 Web 模板复制一份"；`--dump-config` 只打印配置、不启动。
- **重跑会重建整个 profile，并删掉手写的 `cordis.patch.yml`（包括端口、stateDir、模型配置）。** 升级永远不要用它。
- 判断能否执行：
  ```powershell
  Test-Path C:\Users\Chen\.dsh\profiles\superagent\cordis.patch.yml   # True = 已存在，跳过本步
  ```

### 3.5 把插件 link 进 profile（✅ 已完成）

```powershell
& $dsh plugin --profile superagent add "link:D:/1111/dsh-superagent"
```

- 用**正斜杠**写路径：这个值最终会进 JSON 依赖，反斜杠需要转义，容易出错。
- 完成后 `C:\Users\Chen\.dsh\profiles\superagent\package.json` 里应出现：
  ```json
  "dependencies": { "dsh-superagent": "link:D:/1111/dsh-superagent" },
  "dsh": { "profile": { "bundles": [ "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-superagent" ] } }
  ```
- 以后升级插件：`git pull`（本 checkout 是 zip 副本，没有 `.git`，见 13.3）→ `pnpm install && pnpm build` → 重启（第 8 节）。

### 3.6 构建桌面应用（✅ 已构建）

应用源码：`D:\1111\superagent-app\`；构建脚本 `build-portable.js` 的步骤（已读源码）：复制 `node_modules\electron\dist\*` → `Superagent\`，把 `package.json`/`main.js`/`icon.png` 复制到 `Superagent\resources\app\`，删掉 `default_app.asar`，把 `electron.exe` 改名为 `Superagent.exe`。

```powershell
Set-Location D:\1111\superagent-app
& 'C:\Program Files\nodejs\npm.cmd' install electron --allow-scripts=electron
& 'C:\Program Files\nodejs\node.exe' build-portable.js
# 产物：D:\1111\superagent-app\Superagent\Superagent.exe
```

- 只需 Node（Electron 的二进制在该目录的 `node_modules` 里），**目标机器不需要预装 Node/Electron**——整个 `Superagent\` 文件夹可整体复制到别处使用。
- 应用启动时会 `where git`/`where gh` 并按已知目录兜底，找到就**前置到后端子进程的 PATH**；两者都没有时会显示横幅（见 2.2）。
- 如果 npm 不认 `--allow-scripts` 参数，先 `npm.cmd install electron`，再运行 `node build-portable.js`；关键是 Electron 的 dist 必须下载完整。
- 创建桌面快捷方式（无需管理员）：
  ```powershell
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut("$env:USERPROFILE\Desktop\Superagent.lnk")
  $lnk.TargetPath = 'D:\1111\superagent-app\Superagent\Superagent.exe'
  $lnk.WorkingDirectory = 'D:\1111\superagent-app\Superagent'
  $lnk.IconLocation = 'D:\1111\superagent-app\Superagent\Superagent.exe,0'
  $lnk.Save()
  ```
- ⏳ 产物路径与"双击可启动"以桌面应用负责人的验收结论为准（第 12 节）。

### 3.7 装配完成检查单

```powershell
Test-Path D:\1111\dsh-superagent\lib\index.js                                  # True
& "$env:APPDATA\npm\dsh.cmd" --version                                          # 0.2.1-rc.3
Test-Path C:\Users\Chen\.dsh\profiles\superagent\cordis.patch.yml               # True
Select-String -Path C:\Users\Chen\.dsh\profiles\superagent\package.json -Pattern 'dsh-superagent'   # link: 存在
Test-Path D:\1111\superagent-app\Superagent\Superagent.exe                      # True（应用构建后）
Test-Path C:\Users\Chen\.dsh\.credentials.yaml                                  # True（模型凭据）
git --version                                                                   # 2.32 以上，且后端进程能看到
& 'D:\1111\toolchain\gh\bin\gh.exe' --version                                   # 2.48 以上
```

---

## 4. 机器配置：profile 的 cordis.patch.yml

### 4.1 文件与内容

路径：`C:\Users\Chen\.dsh\profiles\superagent\cordis.patch.yml`。这是 profile 的"补丁层"，在 bundle 默认配置之后生效。当前内容（逐字）：

```yaml
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
#
# dsh-superagent on Windows (native port). See docs/006-deployment.md upstream;
# WINDOWS-SETUP.md in the checkout records the Windows-specific deviations.

# The panel listens here (upstream example uses 3082).
- id: webserver
  config:
    host: 127.0.0.1
    port: 3082

# Machine configuration for the bundle. `stateDir` must be an ABSOLUTE path and
# cannot be changed from the panel later; forward slashes are fine on Windows.
- id: dsh-superagent
  config:
    stateDir: C:/Users/Chen/.dsh/state/superagent

# The bundle inserts no model of its own: it uses the profile's default model for
# Evals and for Executor Sessions. Mirror the desktop profile's provider so the
# credentials already stored in ~/.dsh/.credentials.yaml (refs: OPENCODE_GO_API_KEY)
# are reused instead of requiring a second sign-in.
- id: agent-default-model
  config:
    provider: opencode-go
    model: deepseek-v4.1-flash
    reasoningEffort: max

- id: llm-pi-ai
  config:
    providers:
      opencode-go:
        apiKeyEnv: OPENCODE_GO_API_KEY

# dsh-superagent's worker and router presets run with danger-full-access (see
# docs/006-deployment.md "Permissions and isolation"). Restate the presets so the
# default is explicit on this machine; approval prompts are never issued.
- id: permission
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
    defaultPreset: danger-full-access
```

### 4.2 每条配置的含义

| 条目 | 键 | 本机值 | 含义 / 能不能在面板改 |
| --- | --- | --- | --- |
| `webserver` | `host` | `127.0.0.1` | 只监听本机回环，外网访问不到 |
| `webserver` | `port` | `3082` | **CLI 路径**的面板端口。桌面应用会用自己的 overlay 改成随机端口（见 4.5）；改这里后要同步 `--url` / `DSH_SUPERAGENT_URL` |
| `dsh-superagent` | `stateDir` | `C:/Users/Chen/.dsh/state/superagent` | **必须是绝对路径**。存数据库、锁、`worker-bin` 命令 shim、agent 的 git 配置，默认还存工单目录 `work` |
| | `promptMaxChars` | （未写，默认 100000） | 保存的 prompt 配置上限 |
| | `admissionContextMaxPages` | （未写，默认 10） | 一次研判最多读几页 Thread 上下文 |
| | `admissionContextTimeoutMs` | （未写，默认 15000） | 单次上下文读取超时 |
| `agent-default-model` | `provider` / `model` | `opencode-go` / `deepseek-v4.1-flash` | profile 的默认模型；Eval 和 Executor 没单独指定时用它 |
| `agent-default-model` | `reasoningEffort` | `max` | 推理强度。桌面 profile 是 `high`，这里是 `max`（唯一差异，可按需改成一致） |
| `llm-pi-ai` | `providers.opencode-go.apiKeyEnv` | `OPENCODE_GO_API_KEY` | 从凭据库该 ref 取 key，不再要求第二次登录 |
| `permission` | `presets` / `defaultPreset` | `danger-full-access`（`approval: never`） | 与 `docs/006-deployment.md` 的 Permissions and isolation 一致；审批提示永不弹出 |

### 4.3 必须遵守的规则

1. **`stateDir` 用绝对路径**。移植版放宽了校验：`C:/...` 和 `D:\...` 都接受（上游只接受 `/` 开头的 POSIX 路径，Windows 上会报
   `$.stateDir expect string to match regexp /^\//`）。
   ⚠️ 若你看到这个正则报错，说明跑的是**修复前的构建**：重新 `pnpm build` 并重启。
2. **`stateDir` 不能在面板里改**（面板只读显示）。要换位置只能改这个文件，并且先把旧目录里的 `orchestrator.sqlite` 备份/迁移。
3. **未知键会让插件拒绝启动**，日志会点名是哪个键；已废弃的键会提示它搬到了哪里（例如作者、仓库路径现在都在面板/准备命令里）。
4. **不要手改 `stateDir` 下的 `worker-bin\*` 和 `worker-gitconfig`**：每次启动都会重写；里面出现"不是 dsh-superagent 写的"文件会让 setup 直接失败（`… was not written by dsh-superagent`）。
5. **升级前备份** `stateDir\orchestrator.sqlite`。
6. `cordis.patch.yml` 是 YAML 数组，**不要**把它改成空数组 `[]`——那会丢掉全部机器配置。

### 4.4 改完怎么生效

- 改 `webserver.port`、`stateDir`、模型、权限 → **重启后端**（应用内 `Ctrl+Shift+R`，或 CLI `restart`）。
- 改提示词体积、上下文页数等"机器上限" → 面板 **Settings → Deployment** 里改即可，**不用重启**（但 `stateDir` 除外）。

### 4.5 桌面应用如何覆盖端口（重要，别被 3082 误导）

桌面应用**不使用** 3082。它每次启动前在自己的 userData 目录写一份 overlay：

```yaml
# <userData>\runtime.patch.yml（自动生成，别手改）
- id: webserver
  config:
    host: 127.0.0.1
    port: 0
```

然后按下面的顺序启动后端（✅ 实测）：

```
node …\@deepseek-ai\dsh\lib\bin.js --profile superagent --patch "<userData>\runtime.patch.yml" --no-open
```

三条已经验证过的坑：

1. **profile 里的选项赢过 CLI 的应用参数**：`cordis.patch.yml` 里写了 `webserver.port: 3082`，所以只加 `--port 0` **不会**改端口，结果仍是 `EADDRINUSE: 3082`。要换端口只能改 patch 文件，或像应用这样再加一层 `--patch` overlay。
2. **`--patch` 是"启动器参数"，必须放在应用自己的参数之前**：
   `--profile superagent --patch <file.yml> --no-open` ✅；
   `--no-open --patch <file.yml>` ❌ 会报 `unknown option '--patch'`。
3. **一个 `stateDir` 同时只能有一个后端**：第二个实例会以 `Lock file is already being held` 失败。这通常意味着应用/CLI 已经有一个在跑，不是配置错误。

---

## 5. 模型 provider

### 5.1 复用桌面 profile 的 provider（本机已配好）

superagent profile 不引入自己的模型来源；它用 profile 的默认模型。本机沿用桌面 profile 的同一套：

- provider：`opencode-go`，模型：`deepseek-v4.1-flash`
- key 来源：`C:\Users\Chen\.dsh\.credentials.yaml` 的 `refs:` → `OPENCODE_GO_API_KEY`（已存在，✅）
- 通过 `llm-pi-ai` 的 `providers.opencode-go.apiKeyEnv: OPENCODE_GO_API_KEY` 读取

这样**不需要给 superagent 再登录一次**。

### 5.2 面板里还能选什么

- **Settings → Eval → 评估模型**：留空 = 用 profile 默认。
- **Settings → Execution → 执行器模型**：留空 = 用 profile 默认。
- 规则（`docs/003-execution.md`）：**Executor 模型在 Session 创建时固化**，改了只影响之后新建的 Session；Eval 模型每次请求都可能读最新配置。

### 5.3 模型不通时怎么排查

| 现象 | 处理 |
| --- | --- |
| 面板/日志出现 provider 鉴权错误 | 检查 `.credentials.yaml` 里 `OPENCODE_GO_API_KEY` 这个 ref 是否还在；确认后端用的 `DSH_HOME` 是 `C:\Users\Chen\.dsh`（本机默认，未改的话无需设置） |
| 只有某些工单卡住 | 看 **Eval 页**的记录与 `models` 健康项；Session 已创建时改模型不生效，需要重试/重启该工单 |
| 想把 superagent 单独换模型 | 改 `cordis.patch.yml` 的 `agent-default-model`（或在面板 Eval/Execution 指定），重启后端 |

---

## 6. GitHub 智能体账户（最重要的一步）

### 6.1 为什么必须是独立账户

- 智能体的评论、分支、PR **全部以这个账户的名义**出现；用你自己的账户等于让"你"24 小时自动发言。
- 通知驱动：它读的是**这个账户的 GitHub 通知**，所以 GitHub App 不能代替它（`docs/006-deployment.md`）。
- 一份只属于它的 `gh` 登录（独立 `GH_CONFIG_DIR`），确保它不会用你的身份推代码。

### 6.2 创建账户并授权仓库

1. 用**浏览器无痕窗口**（或先退出你的账户）打开 <https://github.com/signup>，注册一个专用账户，例如 `acme-agent`。建议开 2FA。
2. 把它加成目标仓库的协作者，**Write** 权限：
   仓库 → **Settings → Collaborators → Add people** → 输入账户名 → 选择 **Write**。
3. 用智能体账户登录 GitHub，**接受邀请**（邮件或 <https://github.com/notifications>）。
   如果是组织仓库，可能还需要组织允许该账户被邀请，或把它加进有写权限的 Team。
4. 记下它的 **login**（面板 Policy 里要填）和数字 **id**（提交身份会用到）。用浏览器打开 `https://github.com/<agent-login>` 的 API 地址即可，或在你已登录自己账户的 `gh` 里查：

```powershell
gh api users/<agent-login> --jq '{login: .login, id: .id}'
```

### 6.3 准备 `gh` 可执行文件

本机 `gh` **不在 PATH**，只有便携版：

```
D:\1111\toolchain\gh\bin\gh.exe        # v2.103.3，满足 >= 2.48
```

- **运行期不依赖 PATH**：面板里填的是这个 `.exe` 的绝对路径（6.7），插件只按这个路径调用它。
- **建议同时加入当前用户 PATH**（2.4）：方便你手动登录/自查，也让桌面应用的自动探测能找到它；长期使用建议装一份官方 GitHub CLI 到用户目录。

### 6.4 机制：用 `GH_CONFIG_DIR` 选择智能体账户

**Windows 上面板"智能体的 GitHub CLI"必须填真正的 `gh.exe` 绝对路径，绝不能填 `.cmd`。** 实测：Node 26 在 Windows 上 spawn 一个 `.cmd` 会直接抛 `EINVAL`（CVE-27980 之后的加固），裸命令名也不会解析到 `.cmd`。所以上游"用包装脚本换账号"的办法在 Windows 上行不通。

移植版改用 **`GH_CONFIG_DIR`**，由插件在两处注入：

- `src/infra/environment.ts` 的 `agentVariables()`：给 worker 环境（以及插件进程）注入 `GH_CONFIG_DIR=<stateDir>\gh-config`；
- `src/deployment.ts` 的 `workerProbe()`：账号检查也显式传同一个 `GH_CONFIG_DIR`（因为检查发生在 `applyEnvironment()` 之前）。

本机 `stateDir` = `C:/Users/Chen/.dsh/state/superagent`，所以：

```
智能体的 gh 配置目录 = C:\Users\Chen\.dsh\state\superagent\gh-config
```

结果：setup 检查和每个 worker Session 读的都是**智能体**的 gh 配置，**你自己的 `gh` 登录不受影响、也不会被智能体使用**。

### 6.5 创建包装器 `gh-agent.cmd`（仅用于登录/自查，不是面板 CLI）

包装器只是给你手动用的便利工具；**不要把它填进面板**（原因见 6.4）。在 `C:\Users\Chen\bin` 下创建：

```powershell
New-Item -ItemType Directory -Force -Path 'C:\Users\Chen\bin' | Out-Null
notepad 'C:\Users\Chen\bin\gh-agent.cmd'
```

粘贴以下内容（**CRLF 换行**，Notepad 默认就是）。**注意 `GH_CONFIG_DIR` 那一行要与本机 `stateDir` 对应**：

```bat
@echo off
setlocal
rem dsh-superagent: sign in / verify the GitHub agent account (convenience only).
rem The plugin itself selects the agent account through GH_CONFIG_DIR, so this file
rem is NOT the configured CLI; it just saves you from exporting the variable by hand.
rem gh.exe is called by ABSOLUTE path so a `gh` shim on PATH can never be re-entered.
set "GH_CONFIG_DIR=C:\Users\Chen\.dsh\state\superagent\gh-config"
"D:\1111\toolchain\gh\bin\gh.exe" %*
exit /b %ERRORLEVEL%
```

| 行 | 作用 |
| --- | --- |
| `setlocal` | 不改动调用者窗口的环境 |
| `set "GH_CONFIG_DIR=…"` | 指向插件给智能体准备的配置目录（token 存在该目录的 `hosts.yml`）。**必须与 `stateDir` 对应**；换 profile/stateDir 时这里也要改 |
| `"…\gh.exe" %*` | 用**绝对路径**调用真正的 gh，参数原样传递。虽然插件不会调用这个包装器，但 worker 环境的 PATH 最前面有 `<stateDir>\worker-bin\gh.cmd` shim，按名字调 `gh` 仍可能转回自己 |
| `exit /b %ERRORLEVEL%` | 原样传递退出码 |

> gh 装在别处（winget/官方 MSI）时，只改调用 `gh.exe` 的那一行；路径带空格也没问题（引号已验证）。

### 6.6 登录智能体账户

两种方式等价，任选。**推荐方式 1**（不依赖包装器，最贴近插件实际机制）。

**方式 1：直接用 gh.exe + 一次性 `GH_CONFIG_DIR`**

```powershell
$agentHome = 'C:\Users\Chen\.dsh\state\superagent\gh-config'
New-Item -ItemType Directory -Force $agentHome | Out-Null

# 只对当前窗口生效；关掉窗口就恢复（不要用 setx！见下）
$env:GH_CONFIG_DIR = $agentHome
& 'D:\1111\toolchain\gh\bin\gh.exe' auth login --hostname github.com --git-protocol https --web
& 'D:\1111\toolchain\gh\bin\gh.exe' api user --jq .login      # 必须输出智能体账户
Remove-Item Env:GH_CONFIG_DIR                                  # 用完立刻清掉
```

cmd 版本：

```bat
set "GH_CONFIG_DIR=C:\Users\Chen\.dsh\state\superagent\gh-config"
"D:\1111\toolchain\gh\bin\gh.exe" auth login --hostname github.com --git-protocol https --web
"D:\1111\toolchain\gh\bin\gh.exe" api user --jq .login
```

**方式 2：用 6.5 的包装器**

```powershell
& 'C:\Users\Chen\bin\gh-agent.cmd' auth login --hostname github.com --git-protocol https --web
& 'C:\Users\Chen\bin\gh-agent.cmd' api user --jq .login
```

注意事项：

- 浏览器里**必须登录智能体账户**（用无痕窗口，别用你已登录的个人账户，否则会把智能体账户换成你的）。
- 也可以用 token（不要在任何地方贴 token；用完删除临时文件）：
  ```powershell
  & 'C:\Users\Chen\bin\gh-agent.cmd' auth login --hostname github.com --with-token < C:\Users\Chen\agent-token.txt
  Remove-Item C:\Users\Chen\agent-token.txt
  ```
- **不要**用 `setx GH_CONFIG_DIR …` 把它设成全局环境变量：那会污染你终端里所有 `gh` 命令（它们会指向智能体账号），而且对插件没有必要。
- 验证推送权限（插件保存时会做同样的检查）：
  ```powershell
  $env:GH_CONFIG_DIR = 'C:\Users\Chen\.dsh\state\superagent\gh-config'
  & 'D:\1111\toolchain\gh\bin\gh.exe' api repos/<owner>/<name> --jq '.permissions.push'   # true
  Remove-Item Env:GH_CONFIG_DIR
  ```

### 6.7 面板里填什么

| 字段 | 填什么 |
| --- | --- |
| **智能体的 GitHub CLI** | **`gh.exe` 的绝对路径**，例如 `D:\1111\toolchain\gh\bin\gh.exe`（装了官方 CLI 就填它自己的路径）。**必须是 `.exe`** |
| **监听的仓库** | `<owner>/<name>` |

- 保存时插件用它去查账号和推送权限，**通过后会自动重启一次后端**（见 7.5）。
- 在"CLI + 仓库"都配好之前，`/orchestrator/api/state` 里的 `setup.problem` 会是 `agentCliUnset` 或 `repositoryUnset`，**这是预期的待配置状态**（不是故障）。
- 如果保存后报 **`The agent GitHub CLI cannot read its account`**：说明 `gh-config` 目录里还没有登录，或登录的是别的目录——回到 6.6 用**同一个路径**重新登录并验证。

### 6.8 安全边界提醒

包装器和 `worker-bin` 只是"默认走对账号"，**不是安全边界**：执行器以你的 Windows 用户身份运行，可以按绝对路径运行任何程序、读你的 home。真要隔离，就给智能体一个独立的 Windows 用户账户，只放它自己的凭据（`docs/006-deployment.md`）。

---

## 7. 面板设置：Sources → Policy → Execution → Prompts

### 7.1 打开面板

- **桌面应用**：双击 `Superagent.exe`，窗口先显示"正在启动 Superagent…"，就绪后换成面板。**侧栏点 Superagent**。
- **CLI 路径**：日志里会打印 `dsh web: http://127.0.0.1:3082/?token=…`；浏览器打开**带 token 的 URL**（裸 URL 是 401，这是设计如此）。
- 顶部 **Overview** 会列出还缺什么，并链接到对应设置。**setup 没通过之前，轮询和工作都不会开始。**

顺序不能颠倒：**先 Sources（仓库 + 智能体 CLI）→ 再 Policy（谁能发起）→ 再 Execution（目录 + 准备命令）→ 最后 Prompts**。

### 7.2 Sources（来源）

GitHub 卡片里填：

| 字段（面板中文） | 填什么 | 说明 |
| --- | --- | --- |
| **监听的仓库** | `<owner>/<name>` | 只支持 github.com，不支持 GitHub Enterprise Server |
| **智能体的 GitHub CLI** | `D:\1111\toolchain\gh\bin\gh.exe`（**绝对路径，必须是 `.exe`**；装了官方 CLI 就填它自己的路径） | 见 6.4/6.7；保存时校验账号 + 推送权限。**绝对不能填 `.cmd`**（Node spawn `.cmd` 报 `EINVAL`） |
| 接收仓库里的新 Issue / 新 PR / 评论 / 默认分支的 CI | **先全部关闭** | 打开后会收到"没有 @ 智能体"的事件，交给策略的接收表判断；新手先关，减少噪音 |
| 轮询间隔 / 秒（Advanced） | 默认 60 | GitHub 要求更长时以 GitHub 为准 |
| 连续失败几次后报告异常（Advanced） | 默认 3 | 单次网络抖动会在下次轮询自愈 |

保存后如果返回 `restarting: true`，等后端重启完再看（应用会自动重载；CLI 路径用 `status` 等到不再退出 1）。

### 7.3 Policy（策略：谁可以发起工作）

- **接单模式**：先 `observe`（默认）。它会**记录**主动工作的判断但不执行；观察一段时间再切 `auto`。
- **能发起工作的 GitHub 账号**（On each Source → GitHub）：**至少加一个人**（先加你自己的 login）。
  > ⚠️ **这张表为空时，任何请求都不会变成 Ticket**——这是最常见的"我 @ 了它但没反应"的原因。
- **评论可以成为候选的机器人**：按需加 `dependabot[bot]` 之类；机器人永远不能发起"明确请求"，也不能停止工单。
- 两条默认规则可以改/删；规则改动会影响运行中的评估（Policy 版本变化会通知受影响的 Ticket，但**不会立即撤销**已接受的工单）。

### 7.4 Execution（执行）

| 字段 | 建议值 | 说明 |
| --- | --- | --- |
| **执行目录的根目录** | 留空（= `<stateDir>\work`）或 `D:\work\superagent` | 每张工单在这里建一个以短名命名的目录；**只按目录分开，不是安全边界** |
| **并行工单数** | 默认 `3`（范围 1–16） | 超过就排队；状态接口里的 `load.maxWorkers` 就是它 |
| **禁止调用的命令** | 一般留空（见下） | 只拦"按名字"的调用；`gh`、`git`、`lark-cli` 不能禁；用绝对路径仍能跑，所以不是安全边界。Windows 上智能体与你共用同一个 `gh.exe`，插件用 `GH_CONFIG_DIR` 保证它拿不到你的 GitHub 登录，**因此通常不需要再禁什么**；若你另有一个"用你个人身份登录"的 CLI（例如 `gh-main.cmd`），把它的名字写在这里 |
| **准备命令** | 见下（推荐 `.cmd` 包装器） | 新工单目录建好前，在根目录用 **cmd** 跑一次；10 分钟超时；失败则该工单失败并附输出 |

#### 7.4.1 先准备一个"本地 clone"作为 worktree 基座

```powershell
New-Item -ItemType Directory -Force 'C:\Users\Chen\src' | Out-Null
git clone https://github.com/<owner>/<name>.git 'C:\Users\Chen\src\widgets'

# 关键：clone 的本地配置里不能留凭据（插件会检查，发现就判该工单失败）
git -C 'C:\Users\Chen\src\widgets' config --local --get-regexp '^(credential\.|http\..*extraheader)'
# 上面这条“有输出”就要清掉，例如：
# git -C 'C:\Users\Chen\src\widgets' config --local --unset-all credential.https://github.com.helper

# 若 clone 时 URL 里带过 token，务必改回干净地址：
git -C 'C:\Users\Chen\src\widgets' remote set-url origin https://github.com/<owner>/<name>.git
```

- 智能体工作时用的是**它自己的** git 配置（`<stateDir>\worker-gitconfig` + `gh-config` 凭据），不读你全局的 git 配置；所以个人代理、commit 身份等设置都不会带进去。
- 仓库用 Git LFS 的话，先装 `git-lfs`（工具链的 git 自带；Git for Windows 安装时也会带）。

#### 7.4.2 准备命令（Windows 版，✅ 已实测）

上游是 sh 写法（`$DSH_SUPERAGENT_*` + `&&`）。Windows 上准备命令通过 **`cmd.exe /d /s /c`** 执行，所以要用 `%VAR%` 和 cmd 语法。因为 cmd 没有 `${VAR:-默认值}` 这种"空值取默认"的写法，**推荐写成 `.cmd` 包装器**（下面的脚本会处理 PR head 为空的情况）。

创建 `C:\Users\Chen\bin\prepare-ticket.cmd`（**CRLF 换行**）：

```bat
@echo off
setlocal EnableExtensions
rem dsh-superagent: create this ticket's worktree from the local clone.
rem Runs once, in the execution root, with DSH_SUPERAGENT_* in the environment.
rem Edit GIT / CLONE to match this machine.

set "GIT=git.exe"
set "CLONE=C:\Users\Chen\src\widgets"

set "REF=%DSH_SUPERAGENT_GITHUB_PR_HEAD%"
if "%REF%"=="" set "REF=HEAD"

"%GIT%" -C "%CLONE%" fetch --no-tags "https://github.com/%DSH_SUPERAGENT_GITHUB_REPOSITORY%.git" "%REF%:refs/dsh-superagent/%DSH_SUPERAGENT_TICKET%"
if errorlevel 1 exit /b 1

"%GIT%" -C "%CLONE%" worktree add -b "agent/%DSH_SUPERAGENT_NAME%" "%DSH_SUPERAGENT_DIR%" "refs/dsh-superagent/%DSH_SUPERAGENT_TICKET%"
if errorlevel 1 exit /b 1

exit /b 0
```

然后在面板 **准备命令** 里填（路径无空格时不必加引号；有空格时写成 `"C:\path with space\prepare-ticket.cmd"`）：

```
C:\Users\Chen\bin\prepare-ticket.cmd
```

用到的执行环境变量（面板里点变量名可直接插入）：

| 变量 | 含义 |
| --- | --- |
| `DSH_SUPERAGENT_DIR` | 这张工单的执行目录（绝对路径） |
| `DSH_SUPERAGENT_NAME` | 工单短名（`1–4` 个英文小写 kebab 单词 + `-` + id 前 12 位，例如 `fix-plan-color-a1b2c3d4e5f6`） |
| `DSH_SUPERAGENT_TICKET` | 工单 id |
| `DSH_SUPERAGENT_GITHUB_REPOSITORY` | `owner/name` |
| `DSH_SUPERAGENT_GITHUB_PR_HEAD` | 若工单来自 PR：它的 head 分支；否则为空 |
| `DSH_SUPERAGENT_GITHUB_NUMBER`, `DSH_SUPERAGENT_GITHUB_ACCOUNT`, `DSH_SUPERAGENT_GITHUB_COMMIT_EMAIL` | 起始 Issue/PR 编号、智能体账户、提交邮箱 |

✅ **实测结论**（在 `cmd.exe /d /s /c` 下用 git 2.56 跑通）：

- `git -C "<clone>" fetch --no-tags "<url>" "<ref>:refs/dsh-superagent/<ticket>"` + `git worktree add -b "agent/<name>" "<dir>" "<ref>"` 完全可行；
- clone 路径、工单根目录里**有空格**也没问题（全部加引号）；
- `DSH_SUPERAGENT_GITHUB_PR_HEAD` 为空时用 `HEAD`，创建出的工单目录有完整工作区；
- 失败时的 `exit /b` 退出码会正确传回，面板会显示 `The prepare command failed: …` 和输出。

**为什么用包装器而不是一行命令**：cmd 里没有"空值取默认"，如果直接把 `%DSH_SUPERAGENT_GITHUB_PR_HEAD%` 拼进 refspec，PR head 为空时会变成 `:refs/...`，`git fetch` 直接报 invalid refspec。包装器里的 `if "%REF%"=="" set "REF=HEAD"` 解决这一点，并且把容易出错的引号集中在一处。

### 7.5 Prompts（提示词 / 团队段落）

在 **Settings → Prompts → 编辑**，关注三处（顺序同上游文档 `docs/004-prompts.md`）：

| 段落 | 要写什么 | 本机建议 |
| --- | --- | --- |
| **Communication** | 发给人的消息规则；**GitHub 每条消息的第一行声明**；哪些普通账户算"自动评审机器人" | 默认第一行 `This is by an automated agent, not a human.` 保留；如果有自动评审账户（不是 `[bot]` 结尾的），必须在这里点名 |
| **Ticket scope** | 工单何时继续、何时带草稿停下 | 默认即可 |
| **Delivery requirements** | PR 证据要求、**提交身份（commit author）**、**自动合并（auto-merge）条件** | 见下两行 |

**提交身份（必须是智能体账户）**：
默认不写身份时，执行器会用智能体账户的 no-reply 地址（`<id>+<login>@users.noreply.github.com`），这正是我们想要的。为了明确，建议在 Delivery requirements 里加一句：

```text
Author every commit as the agent account, DSH_SUPERAGENT_GITHUB_ACCOUNT <DSH_SUPERAGENT_GITHUB_COMMIT_EMAIL>, never as the operator or any other person.
```

**自动合并（auto-merge）**：
默认答案是 **不要**。原因：GitHub 把"启用自动合并"记在**启用者**名下，所以智能体不能用自己的账户开自动合并；要开就必须另有一个能合并的账户的 CLI，并在 Delivery requirements 里点名。答案"否"时：

- 把默认 Delivery requirements 里关于 auto-merge 的整段删掉（或直接写明）：
  ```text
  Never enable auto-merge; a person merges every pull request.
  ```
- 这样 PR 由人来合并，符合"先保守、观察后再放开"的节奏。

保存提示词**不会重启**后端；Sessions 每次模型请求都会读最新版本。升级后如果某些段落显示 **Default updated**，逐段决定"保留我的文本"还是"用新默认"。

### 7.6 保存语义与（可选）管理 API

- 每次保存都带 `revision`（乐观锁）；过期会返回 409，面板会提示
- 账号/仓库/CLI 这类改动会先跑一次 setup 检查；通过后返回 `restarting: true`，后端自己重启一次
- 面板就是同一套本地 API，路径前缀 `http://127.0.0.1:<port>/orchestrator/api/`，请求头必须带 `x-orchestrator-request: 1`，Host 必须是 `127.0.0.1:<port>` 或 `localhost:<port>`，否则 403

```powershell
# 读设置（把 $port 换成当前端口：应用窗口里的端口不固定，CLI 路径是 3082）
$port = 3082
$api  = "http://127.0.0.1:$port/orchestrator/api"
$h    = @{ 'x-orchestrator-request' = '1' }
Invoke-RestMethod "$api/settings" -Headers $h | ConvertTo-Json -Depth 6

# 读健康/初始化状态
Invoke-RestMethod "$api/state" -Headers $h | ConvertTo-Json -Depth 6
```

> 应用路径的随机端口可以从应用日志 `backend.log` 的 `dsh web: http://127.0.0.1:<port>/?token=…` 里找到。

---

## 8. 启动 / 停止 / 状态

### 8.1 日常：桌面应用

| 操作 | 怎么做 |
| --- | --- |
| 启动 | 双击桌面 `Superagent.lnk` 或 `D:\1111\superagent-app\Superagent\Superagent.exe` |
| 看菜单 | 菜单栏默认隐藏，**按一下 `Alt`** 才出现 |
| 重启后端 | **Ctrl+Shift+R**，或 文件 → 重启后端 |
| 重新加载页面 | **Ctrl+R**（强制：Ctrl+Shift+F5） |
| 开发者工具 | **Ctrl+Shift+I** |
| 打开日志目录 | 文件 → 打开日志文件夹（或 帮助 → 打开日志文件夹） |
| 退出 | 关窗口 / 文件 → 退出 / **Alt+F4** |
| 重复启动 | 单实例：第二次双击只会把已有窗口调到前台，不会起第二个后端 |

行为要点（🔧 源码确认）：

- 启动先显示"正在启动 Superagent…"，等后端打印带 token 的 URL 后自动载入；**裸 URL 是 401，属正常设计**。
- 后端 90 秒内没给出 URL → 显示"后端启动超时"错误页，附最近输出。
- 后端异常退出 → 错误页显示退出码/信号和最近输出，按 Ctrl+Shift+R 可重启。
- 退出时会先让后端优雅收尾（`kill()`），2 秒还没退就 `taskkill /PID <pid> /T /F` 兜底；正常退出后**不应残留 node.exe**。
- 窗口大小/位置/最大化会记住。

### 8.2 排障 / 无人值守：CLI 服务管理器

在 checkout 根目录、普通 PowerShell 窗口里：

```powershell
Set-Location D:\1111\dsh-superagent

.\scripts\dsh-superagent.cmd start      # 后台启动（隐藏控制台），打印日志路径
.\scripts\dsh-superagent.cmd status     # 打印 JSON 状态，用退出码表达结果
.\scripts\dsh-superagent.cmd stop       # 优雅停止（命名管道 → SIGINT，最多等 5 分钟）
.\scripts\dsh-superagent.cmd restart

# 非默认 profile / 端口
.\scripts\dsh-superagent.cmd --profile superagent --url http://127.0.0.1:3082 status

# 给巡检用：intentional stop（手动 stop 过）时不自动拉起
.\scripts\dsh-superagent.cmd --profile superagent --respect-stop restart
```

- 启动日志：`<checkout>\.artifacts\dsh-superagent-superagent-<YYYYMMDD-HHMMSS>-<pid>.log`（保留最新 20 个）
- 控制文件：`<checkout>\.artifacts\control\profiles\superagent\`（`service.pid`、`manually-stopped`、`operation.lock`）
- 服务实际命令：`node --import <checkout>\scripts\dsh-service-hook.mjs <dsh lib\bin.js> --profile superagent --no-open`，工作目录 = checkout。`DSH_SUPERAGENT_DSH_BIN` 可覆盖 dsh 入口（排障/测试用）
- **优雅停止**：`stop` 通过命名管道 `\\.\pipe\dsh-superagent-<profile>-<checkout路径 sha1 前 8 位>` 发一条 `stop`，服务把它变成 DSH 本来就在处理的 SIGINT（收尾 Sessions 后退出，实测退出码 130）；最长等 `--stop-timeout`（默认 300 秒），**从不强杀**
- 健康判断：先看 `service.pid` 是否存活，再请求管理 API 的 `/orchestrator/api/state`；**不会去探 `/`**（它按设计返回 401）
- 本路径**固定使用 profile 里的 3082**；被占用时 `start` 会失败（见第 10 节）
- `stop` **从不强杀**；只有 `stop` 会写 `manually-stopped`，`start` 会清掉它
- **CLI 只认由它自己启动的实例**（靠 `service.pid`）：它不会去停应用窗口里的那份后端，反之亦然。所以"CLI `status` 说没在运行、但应用正开着"是正常现象。
- **同一个 `stateDir` 只能有一个后端**：第二个实例会以 `Lock file is already being held` 退出。看到它通常表示已经有一个后端在跑，而不是配置错误。

### 8.3 退出码契约（`status` / `start` / `restart` 都一样）

| 退出码 | 含义 | 你该做什么 |
| --- | --- | --- |
| **0** | 服务正常运行 | 什么都不用做 |
| **1** | 没在运行 / 跑了两个 / 不响应 / runtime 报错 | **先重启**（`restart`）。仍为 1：看最新 `.artifacts` 日志、看端口占用（第 10 节） |
| **2** | 在运行，但某个部件（Source、策略同步 `sync:<id>` 等）报错 | **不要重启**（重启不修）。`status` 的 JSON 里 `errors` 会点名部件和 detail，按部件修（账号、权限、网络、仓库） |
| **3** | 在运行，但**等待 setup** | **不要重启**。`setup` 字段说明缺什么，按提示去面板对应设置补；修完点 **Check again** |

### 8.4 后端在底下到底跑了什么

桌面应用不经过 shell，直接 spawn（🔧 源码确认；端口、token、启动顺序均已 ✅ 实测）：

```
node "C:\Users\Chen\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js" ^
     --profile superagent --patch "<userData>\runtime.patch.yml" --no-open
```

- **`--patch` 必须写在应用自己的参数（`--no-open` 等）前面**；反过来会报 `unknown option '--patch'`
- `<userData>\runtime.patch.yml` 里是 `webserver: 127.0.0.1 + port: 0` → **随机空闲端口**
- 后端在 stdout 打印：`dsh web: http://127.0.0.1:<port>/?token=<token>`，应用用正则抓它并加载
- **不带 `?token=` 的裸 URL 返回 401**，这是 DSH 的正常行为，不是故障
- CLI 路径（`scripts\dsh-superagent.cmd`）**不加** `--patch`，所以用 profile 的 3082；它用 `--import scripts\dsh-service-hook.mjs` 预加载停止钩子（不设控制管道变量时完全惰性），所以能被 `stop` 优雅停止
- 一个 `stateDir` 同时只能有一个后端（`Lock file is already being held`）
- 应用支持的排障用环境变量（一般不用设）：`SUPERAGENT_PROFILE`（默认 `superagent`）、`SUPERAGENT_PORT`（默认 `0`）、
  `SUPERAGENT_STATE_DIR`（写进 overlay，换一个独立 `stateDir`）、`SUPERAGENT_NODE`、`SUPERAGENT_DSH_BIN`、
  `SUPERAGENT_DESKTOP_ROOT`、`SUPERAGENT_CWD`、`SUPERAGENT_START_TIMEOUT_MS`（默认 90000）
- overlay 优先写到 `<userData>\runtime.patch.yml`；不可写时依次退到应用目录、系统临时目录

启动后 `GET /orchestrator/api/state` 的典型待配置状态（✅ 实测，`stateDir` 用临时目录、端口用 `--patch` 换到 3099）：

```json
{
  "setup": {
    "problem": { "place": "github", "code": "repositoryUnset",
                 "detail": "The GitHub Source names no repository." },
    "accounts": null
  },
  "health": {
    "runtime": { "state": "paused", "detail": "Waiting for the deployment check", "code": "setupPending" },
    "github":  { "state": "paused", "detail": "Waiting for the deployment check", "code": "setupPending" }
  },
  "load": { "running": 0, "queued": 0, "maxWorkers": 3 }
}
```

这对应 `status` 的**退出码 3**（等 setup），不是故障；把仓库和智能体 CLI 配上即可。

临时手动验证（只读；不要改 profile，也不要杀不是你起的进程）：

```powershell
# 换到 3082 之外的端口需要 overlay（--patch 放在最前面）
@"
- id: webserver
  config:
    host: 127.0.0.1
    port: 3099
- id: dsh-superagent
  config:
    stateDir: <一个临时绝对路径，例如 C:/Users/Chen/AppData/Local/Temp/sa-test>
"@ | Set-Content -Encoding utf8 "$env:TEMP\sa-test.yml"

node "C:\Users\Chen\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js" `
  --profile superagent --patch "$env:TEMP\sa-test.yml" --no-open

# 另开窗口：
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3099/                                  # 401
curl.exe -s -H "x-orchestrator-request: 1" http://127.0.0.1:3099/orchestrator/api/state        # JSON
```

### 8.5 日志都在哪

| 日志 | 位置 | 用途 |
| --- | --- | --- |
| 应用生命周期 | `<userData>\app.log` | 启动命令、PID、URL、退出码、重启 |
| 后端原始输出 | `<userData>\backend.log` | 插件启动错误、setup 报错、`dsh web:` 行 |
| CLI 服务日志 | `<checkout>\.artifacts\dsh-superagent-superagent-*.log` | CLI 路径启动的后端 |
| DSH 启动诊断 | `C:\Users\Chen\.dsh\logs\startup-<ISO时间>-<随机>.log` | 插件未激活/端口占用等启动失败详情 ✅ 实测存在 |

### 8.6 每小时巡检（可选，但推荐）

巡检必须跑在**你日常用的 profile**里（例如 `desktop`），而不是 `superagent`——服务挂了它才要能发现。Windows 上把上游那句改成：

```text
Check dsh-superagent: run `D:\1111\dsh-superagent\scripts\dsh-superagent.cmd --profile superagent status` in D:\1111\dsh-superagent.
Exit 0: do nothing and say nothing.
Exit 2: do not restart; tell me each part under `errors` with its detail, unless you already told me about the same ones.
Exit 3: do not restart; tell me what `setup` says setup needs, unless you already told me.
If it reports manually_stopped: true, leave it stopped.
Otherwise (exit 1) run `D:\1111\dsh-superagent\scripts\dsh-superagent.cmd --profile superagent --respect-stop restart`, which exits the same way: 0 means it recovered, so say nothing; 2 and 3 are reported as above; if it exits 1 or fails otherwise, read the newest .artifacts\dsh-superagent-superagent-*.log and the Troubleshooting section of WINDOWS-SETUP.md, fix what you can, and tell me what was wrong and what you did.
```

> ⚠️ 巡检针对的是 **CLI 路径**（端口 3082、`.artifacts` 日志）。如果你日常只用桌面应用，它可以发现"后端没在跑"，但**不能**拉起应用窗口里的那份；需要一名运维同时看应用是否在运行。

### 8.7 不要乱杀进程

- 正常停止：应用内退出 / `scripts\dsh-superagent.cmd stop`。
- `taskkill /F` 会打断正在执行的工单，只能在进程确实无响应、且接受丢失当前步骤时使用；应用退出时自己会用 `taskkill /T /F` 兜底，那是有序流程的一部分。

---

## 9. 第一次跑通

### 9.1 先决检查

1. `status` 语义上健康（CLI：退出码 0；或应用窗口能打开面板且 Overview 没有红色 setup 项）。
2. Sources：仓库已填、**智能体的 GitHub CLI 已填并通过校验**（面板会显示它登录的账号）。
3. Policy：**allowed 列表里至少有一个人**（建议先是你自己）。
4. Execution：目录根可用；准备命令已填（如果没有仓库需要检出，可以先留空跑一次空目录）。
5. 接单模式是 `observe` 也没关系——**明确 @ 智能体的请求在任何模式下都会被处理**。

### 9.2 发一个请求

用 **allowed 列表里的账户**（不是智能体账户）在目标仓库里：

- 新开一个 Issue，正文写：`@<agent-login> 把 README 的安装段落补上 Windows 说明`
- 或者在一个已有 Issue/PR 下**新发一条评论**：`@<agent-login> …`

> ❗ 通过"编辑已有 Issue 正文"加上 @ 是**不会**被收到的；必须是新评论或新 Issue。

### 9.3 一分钟内应该看到什么

- GitHub 来源默认 60 秒轮询一次；面板 **Overview** 出现一张 Ticket；
- 智能体的账户在原对话里**确认一次**（带 `This is by an automated agent, not a human.` 声明）；
- Ticket 进入 **working**，执行器在自己的目录里干活；
- 完成后回到原对话交付（PR 链接 + 一句结论）。

### 9.4 验收

- PR 分支形如 `agent/<DSH_SUPERAGENT_NAME>`（= `agent/<工单短名>`）；提交作者是**智能体账户**；
- 如果按 7.5 选了"不自动合并"，PR 由你合并。

### 9.5 跑不通时按这个顺序查

1. 作者在不在 allowed 列表？（最常见）
2. Source 是否启用、处理是否被暂停（Execution → 暂停处理）？
3. 智能体账户的 `gh` 是否已登录、是否有 push 权限？
4. `status` 退出码是 2 还是 3？（按 8.3 处理）
5. 后端日志里 setup 的具体报错码（第 10 节对照）

---

## 10. 故障排查

> 面板会把 setup 问题翻译成本地化短句；`status`/日志里是英文原文。下表两种都给。

### 10.1 setup / 账号类

| 症状（英文原文 / 中文面板） | 原因与处理 |
| --- | --- |
| `The agent GitHub CLI is not set.` / 没有设置智能体的 GitHub CLI | Sources 里填 **`gh.exe` 的绝对路径**（7.2） |
| `The agent GitHub CLI was not found.` / 找不到智能体的 GitHub CLI | 路径写错、文件不在、或带空格没加引号。`Test-Path 'D:\1111\toolchain\gh\bin\gh.exe'` 自查 |
| `The agent GitHub CLI cannot read its account` / 读不到账号 | 智能体的 gh 配置目录里还没有登录：按 6.6 用 `GH_CONFIG_DIR=C:\Users\Chen\.dsh\state\superagent\gh-config` 登录后再保存；并确认面板 CLI 填的是 **`gh.exe` 绝对路径**（不是 `.cmd`） |
| `The agent GitHub CLI did not report a GitHub account` | CLI 输出被别的东西污染（比如 gh 升级提示）。在终端里用同一个 `GH_CONFIG_DIR` 跑一次 `gh.exe api user --jq .login`，看原始输出 |
| `@x cannot read <repo>` / `@x cannot push to <repo>` | 给智能体账户 Write 权限、接受邀请、组织 SSO 授权 |
| `The GitHub Source names no repository.` | 填 `owner/name` |
| `The agent GitHub CLI is not set.` 出现在你还没配置时 | 这是**预期的待配置状态**（`setup.problem.code = agentCliUnset`）：Sources 里填 CLI 与仓库后自会消失 |
| 手工诊断 `git config --show-origin …` 看到 `file:"C:\\\\…"`（带引号、反斜杠转义） | **这不是不匹配**：不带 `-z` 时 git 会做 C-quote。手工对比请加 `-z`：`git config -z --show-origin --get-all credential.https://github.com.helper` |
| `git does not read the github.com credential configuration …`（`gitTooOld`） | **先在新开的终端里跑 `where git`**：这条报错最常见的原因就是 **git 不在后端进程的 PATH 上**（见 2.2），而不是 git 太旧。若 `where git` 正常，再考虑：git < 2.32，或所用 git 发行版不带 `sh.exe`（`!` 凭据助手跑不起来） |
| `<file> was not written by dsh-superagent`（foreign file） | `stateDir\worker-bin` 或 `worker-gitconfig` 里有别的工具写的文件。删掉/移走它们，或换 `stateDir`。**不要**手编这两个位置的文件 |
| `dsh-superagent configuration has keys it does not use: …` | `cordis.patch.yml` 里有废弃/未知键，删掉；日志会说明该值现在在哪（作者、仓库路径、blockedCommands 等已迁移到面板） |
| `The bot lark-cli …`（飞书相关） | 本手册不启用飞书；用不到就忽略 |

### 10.2 执行 / 工单类

| 症状 | 原因与处理 |
| --- | --- |
| 工单显示 `The prepare command failed: …` | 输出就是原因：clone 路径不对、git 不在 PATH、refspec 无效、目录已存在等。修好命令后 **Retry 工单** |
| 准备命令报 `non-fast-forward` / `invalid refspec` | 多半是同一张工单重试时残留了旧 ref。先清：`git -C "C:\Users\Chen\src\widgets" update-ref -d refs/dsh-superagent/<ticket-id>`（✅ 实测该命令有效），再 Retry |
| 工单目录是空的、worktree 没建出来 | 准备命令留空了；或命令成功了但 `DSH_SUPERAGENT_DIR` 用错（不要在命令里自己再拼路径） |
| `The git configuration of the repository in … sets credential…` | 本地 clone 的 `.git/config` 里有凭据或 `http.*.extraheader`；按 7.4.1 清掉 |
| 执行器长时间卡住 | 看 Overview 的 `models`/`worker` 健康项；可能是模型 provider 重试；也看是否在等审批（不应发生，preset 是 `approval: never`） |
| 编辑 Issue 正文 @ 了智能体但没反应 | 设计如此：只有新 Issue / 新评论（或通知）会触发 |

### 10.3 应用 / 端口 / 环境类

| 症状 | 原因与处理 |
| --- | --- |
| 双击应用后一直"正在启动 Superagent…" | 90 秒后应出错误页。看 `backend.log` 最后几行；最常见是 git 不在 PATH 导致 setup 失败、或 dsh 版本不对 |
| 启动页/面板顶部出现横幅"未找到 git (Git for Windows) / gh (GitHub CLI)" | 应用没找到 git/gh，GitHub 集成不可用。按 2.4 加进 User PATH，然后 **Ctrl+Shift+R** 重启后端 |
| 应用错误页提示"另一个 Superagent 后端正在运行并占用同一 stateDir" | 先关掉别的实例；或设 `SUPERAGENT_STATE_DIR` 指向独立状态目录再启动（排障用，不要用于正式数据） |
| 应用错误页提示"端口被占用 … 若你设置了 SUPERAGENT_PORT" | 把 `SUPERAGENT_PORT` 改回 `0`（应用应使用系统分配端口） |
| 错误页"找不到 Node.js 或 DeepSeek Harness" | 应用只认 `C:\Program Files\nodejs\node.exe` 或 `where node`，以及 `%APPDATA%\npm\node_modules\@deepseek-ai\dsh\lib\bin.js`；用 `SUPERAGENT_NODE` / `SUPERAGENT_DSH_BIN` 覆盖，或装好 |
| `EADDRINUSE … 3082` | **CLI 路径**下：已经有一个后端（应用或 CLI）占着 3082。`Get-NetTCPConnection -LocalPort 3082` 查 PID；停掉多余的实例。应用路径下出现它，说明 overlay 没生效（检查 `<userData>\runtime.patch.yml` 是否被生成） |
| `start` 报 `Lock file is already being held` | 同一个 `stateDir` 已经有后端在跑（可能正是应用窗口里的那份）。这是正常的单实例保护：先确认/停止已有实例，不要同时开两个 |
| `stop` 报"无法通知/无法停止"且不发强杀 | 该服务不是由**当前版本**的 `start` 启动的（没有预加载 `scripts\dsh-service-hook.mjs`），所以命名管道收不到。用 `start` 重启一次即可恢复可停性 |
| 3082 被一个"装了插件但没启动"的 dsh 占着：`/` 返回 401、`/orchestrator/api/state` 返回 404 | 那是另一个 dsh 实例（没加载 dsh-superagent）。CLI `start` 会绑定失败；停掉它，或改 superagent 的端口（4.3/4.5） |
| 启动日志出现 `unknown option '--patch'` | `--patch` 是**启动器参数**，必须写在 `--no-open` 等应用参数之前：`--profile superagent --patch <file> --no-open` |
| `status` 退出码 3，`health.runtime` 是 `paused` + `code: setupPending` | 正常待配置：`setup.problem` 为 `repositoryUnset` / `agentCliUnset`。去面板把仓库和智能体 CLI 填好即可（不是故障，别去重启） |
| 裸开头 `http://127.0.0.1:<port>/` 显示 401/白页 | 正常：必须带 `?token=`（应用自动处理；CLI 路径从日志里复制完整 URL） |
| 面板打不开 / 一直在重载 | 看应用错误页与 `backend.log`；CLI 路径看 `.artifacts` 日志与 `status` |
| `无法加载文件 …npm.ps1，因为在此系统上禁止运行脚本` | 用了裸 `npm`/`pnpm`/`dsh`。改成 `.cmd`（2.3） |
| 中文乱码（日志/终端） | PowerShell 里先 `[Console]::OutputEncoding = [Text.Encoding]::UTF8`；`.cmd` 脚本请保存为 ANSI/UTF-8 均可，日志本身是 UTF-8 |
| 路径里有空格/中文导致失败 | 所有路径加双引号；尽量不用中文路径；超长路径在 git 里开 `core.longpaths` |
| 带反斜杠结尾的路径在引号里出错 | cmd 会把 `\"` 当转义。拼接时**不要让变量以反斜杠结尾**再贴引号（`git -C "%CLONE%"` 这种结构天然安全） |
| `.cmd` 双击闪退/行为异常 | 确认是 **CRLF** 换行；在 PowerShell 里运行看报错，而不是双击 |
| `status` 退出码 2 | 见 8.3：不要重启，按 `errors` 里的部件修 |
| `status` 退出码 3 | 见 8.3：按 `setup` 去面板补设置，再 Check again |
| 升级 DSH 后面板 "Failed to load plugins" | 重启后端（应用 Ctrl+Shift+R） |
| 插件与 dsh 版本不兼容 | 安装满足 `engines.dsh` 的版本（本机固定 `0.2.1-rc.3`） |

---

## 11. Windows 移植与上游的差异

| # | 上游（POSIX） | Windows 移植后的行为 | 状态 |
| --- | --- | --- | --- |
| 1 | `scripts/dsh-superagent start` 用 **tmux** 会话，`stop` 发 SIGINT | 入口 **`scripts\dsh-superagent.cmd`**（批处理，不是 `.ps1`）；Windows 用 `CREATE_NO_WINDOW` 分离启动、`service.pid` 记录、**命名管道 → SIGINT 钩子**（`scripts\dsh-service-hook.mjs`，`node --import` 预加载）优雅停止；不注册服务、不强杀；退出码 0/1/2/3 不变 | ✅ 负责人端到端实测（含真实 dsh 退出码 130） |
| 2 | 命令 shim 是 `#!/bin/sh` 无扩展名脚本 | 写成 **`<name>.cmd`**（`gh.cmd`、`lark-cli.cmd`、被禁命令 `<name>.cmd`），第二行用 `@REM Written by dsh-superagent…` 做归属标记 | 🔧 源码确认 |
| 3 | 准备命令 `sh -c <command>` | 改为 **`cmd.exe /d /s /c <command>`**；准备命令必须用 cmd 语法（`%VAR%`、`&&`），`sh.exe` **不需要** | 🔧 源码确认；✅ 用等价 `.cmd` 包装器实测通过 |
| 4 | 账号探测用 `env PATH=… <cli>` | Windows 没有 `env`，改为给子进程显式传 PATH 覆盖，并**显式传 `GH_CONFIG_DIR`**（修复了"账号检查早于环境注入"的顺序问题） | 🔧 源码确认 |
| 5 | 智能体 CLI 用 `~/.local/bin/gh-agent` sh 包装器换账号 | **`.cmd` 包装器不能当 CLI**：Node 在 Windows 上 spawn `.cmd` 直接 `EINVAL`（CVE-27980 加固），裸名字也不解析到 `.cmd`。改为：面板 CLI = **`gh.exe` 绝对路径**，账号隔离由插件注入的 `GH_CONFIG_DIR=<stateDir>\gh-config` 完成；`gh-agent.cmd` 降级为**登录/自查的便利包装器** | ✅ 负责人已验证 `EINVAL`；🔧 源码确认注入 |
| 6 | `stateDir` 必须是 `/` 开头的 POSIX 绝对路径 | 接受 `C:/…` 或 `D:\…`（正则放宽为 `^(?:[A-Za-z]:[\\/]|\/)`） | ✅ 修复后实测插件可激活 |
| 7 | 用 `ps`/`fcntl`/`SIGINT`/`umask`/`chmod` | 分别换成：`OpenProcess`/`msvcrt` 字节锁/`GenerateConsoleCtrlEvent`/无 | 🔧 源码确认 |
| 8 | `--port` 可改面板端口 | **profile 的 `webserver.port` 会覆盖 CLI 的应用参数**；要改端口必须改 patch 文件或加 `--patch` overlay（桌面应用就是这么做的）；且 **`--patch` 必须放在应用参数之前** | ✅ 实测（`--port 0` 仍撞 3082；`--no-open --patch` 报 unknown option） |
| 9 | 面板在浏览器里 | 桌面应用窗口内嵌同一套 Web 面板（无地址栏/标签页），侧栏 **Superagent** 不变 | 🔧 源码确认；⏳ 打包后待验收 |
| 10 | `dsh` 是 POSIX 可执行 | Windows 上 npm 生成 `dsh.cmd`；脚本/文档一律用 `.cmd`，并注意 `Restricted` 执行策略 | ✅ |
| 11 | 每小时巡检跑 `scripts/dsh-superagent …` | Windows 用 `scripts\dsh-superagent.cmd …`（8.6） | 🔧 |
| 12 | 数据库、锁、SQLite、`proper-lockfile`、`--no-open`、`DSH_HOME` | 行为不变；但 Windows 上**一个 `stateDir` 只能有一个后端**（`Lock file is already being held`），要把它当作正常的单实例保护 | ✅ 实测 |
| 13 | 飞书 Source | 本机不启用（`dsh-superagent-feishu` 保持 disabled）；如启用需另配 `lark-cli.cmd` | — |
| 14 | 应用从 Explorer 继承环境 | 应用启动时探测 git/gh（`where` + 已知目录）并前置到后端子进程 PATH；找不到就在启动页与面板顶部显示横幅告知。CLI 路径不做注入，靠 User PATH | 🔧 源码确认（GUI 未验收） |

---

## 12. 验证状态与开放问题

> 这一节是**诚实清单**：哪些是本次移植在本机实测过的、哪些只是源码/设计确认、哪些还没人跑过。凡与正文冲突，以这里为准。

### 12.1 已经实测过的（可以作为事实引用）

| 项 | 证据 |
| --- | --- |
| 启动器 `scripts\dsh-superagent.cmd` 的 `start/status/stop/restart` 与四个退出码 | 移植负责人端到端跑过：`start` 起真实 dsh（带 `--import` hook、`--patch` overlay 换端口）→ API 应答 → `stop` 发 SIGINT → 进程以 **130** 退出；0/1/2/3 四种码都实际触发过 |
| 优雅停止无强杀 | `stop` 约 0.7 秒返回，pidfile 删除；超时会报错而不是 `taskkill` |
| 命令 shim 的 Windows 形式 | `worker-bin\<name>.cmd`、PATH 剥离、`%*` 传参、退出码透传、被禁命令 stderr + exit 1，全部验证 |
| git 凭据助手 | `helper = !'<gh.exe 绝对路径>' auth git-credential` 经 Git for Windows 的 `sh` 执行；`GH_CONFIG_DIR` 在环境里时 `git credential fill` 返回智能体账号，不在时失败 |
| `verifyEnvironment` 的逐字节比较在 Windows 上原样通过（实测） | `git config -z --show-origin --get-all credential.https://github.com.helper` 的真实输出是 `['file:C:\\…\\worker-gitconfig', "!'C:/…/gh.exe' auth git-credential", '']`，与期望的 `['file:' + workerGitConfig, credentialHelper(cli), '']` 完全一致 → **不会误报 `gitTooOld`**。前提：git 必须是自带 `sh.exe` 的发行版（Git for Windows / MinGit）。注意 `-z`：不带 `-z` 时 git 会 C-quote 路径（`file:"C:\\…"`），手工诊断看起来像不匹配 |
| `.cmd` 不能被无 shell 地 spawn | Node ≥18.20/20.12 起（CVE-2024-27980）抛 `EINVAL`；所以面板 CLI 必须是 `.exe` |
| 准备命令容器 | Windows 为 `cmd.exe /d /s /c <command>`；POSIX 仍 `sh -c`；Git for Windows 的 `sh.exe` 不在 PATH 上，POSIX 写法不能沿用 |
| 端口/`--patch` 规则 | `--port` 输给 profile 的 `webserver.port`；`--patch` 是启动器参数，必须排在应用参数之前；`--no-open --patch` 报 `unknown option` |
| 单实例 | 同一 `stateDir` 第二个实例 `Lock file is already being held` |
| 面板后端行为 | `dsh web: http://127.0.0.1:<port>/?token=…` 打印；裸 URL 401；`GET /orchestrator/api/state` 200，待配置状态为 `setup.problem.code = repositoryUnset` + `health.runtime = paused/setupPending` |

### 12.2 还没验证的（写了做法，但没人跑完）

| 项 | 说明 |
| --- | --- |
| 桌面应用成品 | `D:\1111\superagent-app\Superagent\Superagent.exe` 已构建（约 250 MB 便携目录）；"双击 → 启动 → 面板可交互 → 退出无残留 node"整链由桌面应用负责人验收，本机尚无运行日志 |
| 应用 userData 目录名 | 代码用 Electron `app.getPath('userData')`；按 `productName: Superagent` 推断是 `%APPDATA%\Superagent`，也可能取 `name`（`superagent-desktop`）。**以应用内 帮助 → 关于 Superagent 显示的路径为准** |
| 应用自动探测/注入 git、gh | 源码已实现（候选目录与横幅文案见 2.2），但 GUI 行为未验收 |
| 应用构建参数 `--allow-scripts=electron` | 若 npm 不认该参数，先 `npm.cmd install electron` 再 `node build-portable.js` |
| 端到端首单 | "智能体账户登录 + 面板填仓库/CLI → 允许列表 @ 一下 → 1 分钟内出 Ticket → PR"整链尚未完整实测 |
| winget id 与 `--scope user` | 当前无网络/不能提权，未验证；以官方安装器的"当前用户"选项为准 |
| 面板中文文案与按钮位置 | 依据 `src/client/locales.ts` 与源码确认；可视 UI 验收未做（应用窗口内位置可能有差异） |

### 12.3 已知风险 / 运维注意

- **不注册 Windows 服务**：后端以操作者用户身份运行，**注销/重启后不会自动恢复**。每小时巡检只能发现"没在跑"，不能把应用窗口那份拉起来；重启机器后请双击应用或执行 `start`。
- **停止依赖 hook**：`stop` 通过命名管道通知服务，服务必须由**当前版本**的 `start` 启动（带 `--import scripts\dsh-service-hook.mjs`）。用手工命令或旧脚本起的实例，`stop` 会明确报"无法通知"而不是强杀；用 `start` 重启一次即可恢复可停性。
- **命名管道是本机同用户可见的**：同用户的任意进程都能发 `stop`。和本项目其它机制一样，这是护栏，不是安全边界。
- **3082 可能被别的 DSH 实例占用**：若某个 dsh 进程占了 3082 但没装插件（`/` 返回 401、`/orchestrator/api/state` 返回 404），CLI `start` 会绑定失败、`status` 退出 1。先停掉那个进程，或给 superagent 换端口（4.3/4.5）。
- **飞书未启用**：`dsh-superagent-feishu` 保持 disabled；启用需要另配 `lark-cli.cmd`，不在本手册范围。

---

## 13. 附录：路径、命令、升级与回滚

### 13.1 路径速查

| 名称 | 路径 |
| --- | --- |
| 本 checkout | `D:\1111\dsh-superagent` |
| 桌面应用 | `D:\1111\superagent-app\Superagent\Superagent.exe` |
| 应用源码 | `D:\1111\superagent-app` |
| 应用日志 | `<userData>\app.log`、`<userData>\backend.log`（目录名以应用内 关于 对话框为准，见 12.2） |
| DSH home | `C:\Users\Chen\.dsh` |
| profile | `C:\Users\Chen\.dsh\profiles\superagent` |
| 机器配置 | `C:\Users\Chen\.dsh\profiles\superagent\cordis.patch.yml` |
| 状态目录 | `C:/Users/Chen/.dsh/state/superagent` |
| 工单目录 | `C:/Users/Chen/.dsh/state/superagent/work`（默认） |
| 模型凭据 | `C:\Users\Chen\.dsh\.credentials.yaml`（refs：`OPENCODE_GO_API_KEY`） |
| DSH 全局安装 | `C:\Users\Chen\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh` |
| CLI 日志/控制 | `D:\1111\dsh-superagent\.artifacts\` |
| DSH 启动诊断 | `C:\Users\Chen\.dsh\logs\startup-*.log` |
| 智能体 gh 配置 | `C:\Users\Chen\.dsh\state\superagent\gh-config`（由插件通过 `GH_CONFIG_DIR` 使用；`gh-agent.cmd` 只是登录入口） |
| 便携工具链 | `D:\1111\toolchain`（`env.ps1`、`git`、`gh`、`python`） |
| 本地 clone（worktree 基座） | `C:\Users\Chen\src\widgets`（按实际仓库名） |

### 13.2 命令速查

```powershell
# --- 打开环境（可选，本机便携工具链）---
. D:\1111\toolchain\env.ps1

# --- 构建/更新插件 ---
Set-Location D:\1111\dsh-superagent
& (Get-Command pnpm.cmd).Source install
& (Get-Command pnpm.cmd).Source build

# --- 安装/检查 DSH ---
& 'C:\Program Files\nodejs\npm.cmd' install -g '@deepseek-ai/dsh@0.2.1-rc.3'
& "$env:APPDATA\npm\dsh.cmd" --version

# --- link 插件（已做过就不要再做）---
& "$env:APPDATA\npm\dsh.cmd" plugin --profile superagent add "link:D:/1111/dsh-superagent"

# --- 智能体账户 ---
& 'C:\Users\Chen\bin\gh-agent.cmd' auth login --hostname github.com --git-protocol https --web
& 'C:\Users\Chen\bin\gh-agent.cmd' api user --jq .login

# --- 启停（CLI 路径）---
.\scripts\dsh-superagent.cmd start
.\scripts\dsh-superagent.cmd status
.\scripts\dsh-superagent.cmd stop

# --- 管理 API ---
$h = @{ 'x-orchestrator-request' = '1' }
Invoke-RestMethod 'http://127.0.0.1:3082/orchestrator/api/state' -Headers $h

# --- 端口占用 ---
Get-NetTCPConnection -LocalPort 3082 -ErrorAction SilentlyContinue | Select-Object LocalAddress,State,OwningProcess

# --- 应用构建 ---
Set-Location D:\1111\superagent-app
& 'C:\Program Files\nodejs\npm.cmd' install electron
& 'C:\Program Files\nodejs\node.exe' build-portable.js
```

### 13.3 升级

1. 等到没有执行器正在干活（面板 Execution 里没有 working 的工单）。
2. 备份数据库：复制 `<stateDir>\orchestrator.sqlite` 到安全位置。
3. 更新 checkout 并重建：
   - 本 checkout 是**上游 zip 副本，没有 `.git`**；升级=用新版覆盖文件，再：
     ```powershell
     Set-Location D:\1111\dsh-superagent
     & (Get-Command pnpm.cmd).Source install
     & (Get-Command pnpm.cmd).Source build
     ```
   - ⚠️ 覆盖时不要动 profile 的 `cordis.patch.yml`，也不要动 `stateDir`。
4. 重启后端（应用 Ctrl+Shift+R，或 CLI `restart`），再看 `status`。
5. 如果有段落在面板显示 **Default updated**，逐段决定保留还是用新默认。

> 降级注意：被新版本迁移过的数据库，旧版本打不开；回滚必须先恢复第 2 步的备份。

### 13.4 卸载 / 回滚

```powershell
# 从 profile 里移除插件（不会删 checkout）
& "$env:APPDATA\npm\dsh.cmd" plugin --profile superagent remove dsh-superagent

# 停止 CLI 路径的服务
.\scripts\dsh-superagent.cmd stop

# 彻底清理（确认不再需要后）：profile、stateDir、应用、checkout
#   C:\Users\Chen\.dsh\profiles\superagent
#   C:\Users\Chen\.dsh\state\superagent
#   D:\1111\superagent-app\Superagent
#   C:\Users\Chen\bin\gh-agent.cmd / prepare-ticket.cmd
#   C:\Users\Chen\.dsh\state\superagent\gh-config（智能体账号的 gh 登录）
```

- `plugin remove` 的具体子命令名以 `dsh plugin --help` 为准（本手册未在 Windows 上实测该步）。
- 卸载前先 `stop`，并确认没有 node 进程还在使用 `stateDir`。

### 13.5 参考

- 上游：`README.md`、`SETUP.md`、`docs/000`–`docs/008`（本 checkout 内）
- 部署与排障原文：`docs/006-deployment.md`
- 每条配置的**预期行为**以源码为准：`src/deployment.ts`、`src/infra/environment.ts`、`src/executor/dsh.ts`、`src/app/setup.ts`
- 上游仓库：<https://github.com/deepseek-ai/dsh-superagent-prototype>

---

> 本文件由 Windows 移植过程维护。移植改动集中在：`src/deployment.ts`（`stateDir` 校验、账号探测的 PATH/`GH_CONFIG_DIR` 注入）、`src/infra/environment.ts`（`.cmd` 命令 shim、`GH_CONFIG_DIR=<stateDir>\gh-config`、git 配置）、`src/app/setup.ts`（Windows 环境应用）、`scripts/dsh-superagent`（Windows 进程管理分支），以及新增的 `scripts/dsh-superagent.cmd`、`scripts/dsh-service-hook.mjs`；桌面应用在 `D:\1111\superagent-app`。其余行为与上游一致；第 11 节是完整差异表，第 12 节是验证状态。
