# 安装 DSH-Superagent（桌面版）

## 最快的方式

```powershell
irm https://raw.githubusercontent.com/Check-mj/dsh-superagent-windows/main/install.ps1 | iex
```

下载 Release、校验 SHA-256、解压并调用本目录同款的 `install.ps1`（默认装到
`%LOCALAPPDATA%\Programs\Superagent`）。下文是手动安装步骤，供离线或排错时使用。

# 安装布局与路径规则

本文件定义 **Superagent 的路径方案**。所有路径在运行时推导，源码里没有任何一台机器、一个用户名的绝对路径。

---

## 1. 安装根目录

默认：`%LOCALAPPDATA%\Programs\Superagent`

选它的理由：**每个用户自己的目录、不需要管理员权限、不污染 `Program Files`、卸载就是删目录**。

可以改，按优先级：

| 方式 | 作用 |
|---|---|
| `install.ps1 -Root "<目录>"` | 安装时指定，写进快捷方式 |
| 环境变量 `SUPERAGENT_HOME` | 运行时覆盖根目录（免安装的绿色用法） |
| 默认值 | `%LOCALAPPDATA%\Programs\Superagent` |

## 2. 目录布局

```
<安装根目录>\
  Superagent.exe                  ← Electron 外壳（自带 Electron 运行时，无需装 Node/Electron）
  resources\app\                  ← 应用负载（main.js 等，不是 asar）
  dsh-superagent\                 ← 插件源码（我们的仓库检出；含 lib\、node_modules\）
  tools\                          ← 可选：随包携带的 git / gh（自包含安装用）
    git\cmd\git.exe
    gh\bin\gh.exe
  config\paths.json               ← 安装器记录：插件检出在哪、装在哪、什么时候装的
  user-data\                      ← 可选：便携数据目录（仅在 %APPDATA% 不可写时自动回退到这里）
```

**只读的部分**（升级时整体替换）：`Superagent.exe`、`resources\`、`tools\`
**可写的部分**（升级时保留）：`data\`、`config\`
**插件检出**：`dsh-superagent\`（由 git 管理，独立升级）

## 3. 路径解析顺序（全部运行时推导）

### 3.1 插件检出目录（后端的 cwd）

1. `SUPERAGENT_CWD` 或 `SUPERAGENT_CHECKOUT` 环境变量
2. `<exe 所在目录>\..\dsh-superagent`（默认布局）
3. `<exe 所在目录>\dsh-superagent`
4. `<exe 所在目录>\..\..\dsh-superagent`
5. `<exe 所在目录>\..`（exe 直接在检出里时）
   - 以上每个候选都会读 `package.json` 确认 `"name": "dsh-superagent"`
6. `%USERPROFILE%\.dsh\profiles\<profile>`（退化：直接用已安装的 profile）
7. `%USERPROFILE%`

### 3.2 git

1. `SUPERAGENT_GIT_DIR`
2. `<exe 所在目录>\tools\git\cmd`、`tools\git\bin`（自包含）
3. `where git` 命中的目录（PATH）
4. `%ProgramFiles%\Git\cmd`、`%ProgramFiles(x86)%\Git\cmd`、`%LOCALAPPDATA%\Programs\Git\cmd`

### 3.3 GitHub CLI

1. `SUPERAGENT_GH_DIR`
2. `<exe 所在目录>\tools\gh\bin`（自包含）
3. `where gh` 命中的目录（PATH）
4. `%ProgramFiles%\GitHub CLI`、`%LOCALAPPDATA%\Programs\GitHub CLI`

### 3.4 Node.js

1. `SUPERAGENT_NODE`
2. `%ProgramFiles%\nodejs\node.exe`、`%ProgramFiles(x86)%\nodejs\node.exe`、`%LOCALAPPDATA%\Programs\nodejs\node.exe`
3. `where node.exe`

### 3.5 DSH 运行时（`lib/bin.js`）

1. `SUPERAGENT_DSH_BIN`
2. `%APPDATA%\npm\node_modules\@deepseek-ai\dsh\lib\bin.js`（`npm i -g` 的默认位置）
3. `%LOCALAPPDATA%\npm\node_modules\@deepseek-ai\dsh\lib\bin.js`
4. 兜底：装在 `%LOCALAPPDATA%\Programs\DeepSeek Harness` 的桌面版内置运行时

### 3.6 应用数据（userData）

真实顺序（`resolveUserData()`，取第一个可写的）：

1. `SUPERAGENT_USER_DATA`（显式覆盖；绿色便携用法就指到安装目录下的 `user-data`）
2. `%APPDATA%\Superagent` ← **默认**，正常安装/双击走这里
3. `<exe 所在目录>\user-data` ← 回退：`%APPDATA%` 不可写时（受限上下文常见）
4. `%TEMP%\superagent-user-data` ← 最后兜底

日志在里面：`app.log`（生命周期与解析出的实际路径）、`backend.log`（后端原始 stdout/stderr）、`window-state.json`、`runtime.patch.yml`。
实际选用的目录每次启动写在 `app.log` 第一屏，排查以日志为准。

### 3.7 后端端口

profile 的 `cordis.patch.yml` 钉死了 `webserver.port`，命令行 `--port` 会被覆盖，所以应用在 `<userData>\runtime.patch.yml` 生成一个只改端口的 overlay，默认 `port: 0`（系统分配空闲端口），再从后端 stdout 抓 `dsh web: http://127.0.0.1:<port>/?token=…`。要固定端口就设 `SUPERAGENT_PORT`。

## 4. 可重定位性保证

整个安装目录可以**整体搬到任意路径、任意盘符**，也能在另一台 Windows 机器上直接用（只要那台机器有 Node.js 与 DSH）。因为：

- 源码中不存在 `D:\...`、`C:\Users\<某人>\...` 之类的绝对路径（有 CI 审计项，见下）
- 快捷方式在安装时由 `install.ps1` 用解析后的真实路径生成，不写死在仓库里
- 后端命令的 argv 全部由上述解析结果拼装

审计命令（提交前应无输出）：

```bash
grep -rn -E "D:[\\\\/]{1,2}1111|C:[\\\\/]{1,2}Users[\\\\/]{1,2}[A-Za-z]" \
  --include="*.js" --include="*.ts" --include="*.cmd" --include="*.mjs" \
  windows-app/main.js windows-app/build-portable.js scripts src tests
```

## 5. 安装与卸载

```powershell
# 安装到默认根目录，并生成桌面/开始菜单快捷方式
powershell -NoProfile -ExecutionPolicy Bypass -File .\windows-app\install.ps1

# 安装到自选目录
powershell -NoProfile -ExecutionPolicy Bypass -File .\windows-app\install.ps1 -Root "E:\Apps\Superagent"
```

卸载：关闭应用，删除安装根目录，删除桌面与开始菜单的 `Superagent.lnk` 即可。注册表里没有条目，`%LOCALAPPDATA%` 之外没有残留（除非你改过 `SUPERAGENT_HOME`）。
