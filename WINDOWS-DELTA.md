# WINDOWS-DELTA — 我们相对上游的改动清单与升级流程

本文件是我们这个 fork 的**唯一权威差量清单**。上游（`deepseek-ai/dsh-superagent-prototype`）每次更新后，按本文件核对即可。

设计目标：**上游更新能被低成本吸收，我们的工作永不丢失。**

---

## 1. 仓库结构

```
upstream  https://github.com/deepseek-ai/dsh-superagent-prototype.git   （只读，官方）
origin    <我们自己的仓库>                                              （稍后设置）
main      我们的分支 = 官方 main + 3 个提交 + 后续所有自定义改动
tag       upstream-base   记录我们 fork 时的官方基线（6337fc8）
```

升级只有三步：`fetch → merge → 跑契约测试`。详见 §5。

---

## 2. 改动分层（重要）

我们**绝不整体重写上游代码**，改动按四层组织，每层与上游的耦合度不同：

| 层 | 位置 | 与上游冲突概率 | 说明 |
|---|---|---|---|
| **L1 平台补丁** | `src/deployment.ts`、`src/infra/environment.ts` | 中（仅这几处） | `process.platform === 'win32'` 门控，Linux 分支保持逐字节等价 |
| **L2 新增文件** | `scripts/dsh-superagent.cmd`、`scripts/dsh-service-hook.mjs` | 无 | 纯新增，上游不会有同名文件 |
| **L3 应用壳** | `windows-app/`（Electron） | **零** | 完全不 import 上游源码，只通过 CLI 与 HTTP API 交互 |
| **L4 契约测试 + 文档** | `tests/windows-port.spec.ts`、`WINDOWS-SETUP.md`、本文件 | 低 | 测试锁定我们依赖的行为，文档记录口径 |

`scripts/dsh-superagent` 是**例外**：它是上游文件，我们做了平台门控修改（L1 级），冲突概率中，但冲突只发生在 tmux 相关函数周围。

---

## 3. L1 逐处清单

### `src/deployment.ts`

| 位置 | 上游行为 | 我们的改动 | 为什么 |
|---|---|---|---|
| `absolute()` 校验 | `pattern(/^\//)`，只认 `/` 开头的 POSIX 绝对路径 | `pattern(/^(?:[A-Za-z]:[\\/]|\/)/)` | `stateDir: C:/...` 在上游会被 schema 拒绝，插件直接不激活 |
| `workerProbe()` | 用 `['env', 'PATH=…', …argv]` 调外部 `env` 命令 | win32 分支改为通过 subprocess 的 `env` 层传 PATH + `GH_CONFIG_DIR` | Windows 没有 `env` 可执行文件；且账号探针早于 `applyEnvironment()` 执行，必须显式传 `GH_CONFIG_DIR` 否则会读到操作者本人的 gh 账号 |

### `src/infra/environment.ts`

| 位置 | 上游行为 | 我们的改动 | 为什么 |
|---|---|---|---|
| `agentGhConfig()` | 不存在（上游用 wrapper 脚本选账号） | 新增，指向 `<stateDir>/gh-config` | Node 拒绝 spawn `.cmd`/`.bat`（CVE-2024-27980 之后抛 `EINVAL`），所以 Windows 上不能用 wrapper 脚本当 CLI，改用 `GH_CONFIG_DIR` 选账号 |
| `agentVariables()` | 不含 `GH_CONFIG_DIR` | win32 下注入 `GH_CONFIG_DIR` | 让 worker 会话与 git credential helper 都落到智能体账号 |
| `written()` | 按 `\n` 切前两行、精确匹配 `# Written by …` | 按 `/\r?\n/` 切，并剥掉行首 `@REM ` | Windows 垫片是 batch 文件，`#` 注释会被 cmd 当命令执行，标记必须写成 `@REM # Written by …` |
| `writeEnvironment()` shim | 写无扩展名 `#!/bin/sh` 文件 | win32 写 `<name>.cmd`（`@echo off` + `@REM` 标记 + 绝对路径调用 + `%*` + `exit /b`） | 无扩展名文件在 Windows PATH 查找（PATHEXT）里根本不可执行 |
| `writeEnvironment()` 额外 | — | 创建 `<stateDir>/gh-config` 目录 | 给 gh 一个可写的独立配置目录 |
| PATH 剥离 | POSIX 垫片会把自己从 PATH 里剔除再 exec | **Windows 垫片不做 PATH 剥离** | 垫片直接以绝对路径调用真实 `.exe`，不存在递归；batch 里重建 PATH 对含 `&`/空格/括号的路径很脆弱，收益为零 |

**注意：git 凭据层完全没改。** `credentialHelper()`、`gitQuote()`、`worker-gitconfig` 内容、`verifyEnvironment()` 全部保持上游原样——实测在 Windows 上 `git config -z --show-origin --get-all credential.https://github.com.helper` 的渲染与期望值逐字节相等。

### `scripts/dsh-superagent`

上游是 Python + tmux。我们在 `os.name == 'nt'` 分支里换成：分离进程启动、pidfile、`OpenProcess` 存活检测、命名管道优雅停止（转成 DSH 已处理的 SIGINT）。**POSIX 分支原样保留**，只额外抽出 `wait_for_health()` 供两侧共用。

---

## 4. 契约测试（升级后必须全绿）

`tests/windows-port.spec.ts` 锁定的是我们**依赖**的行为，而不是上游的实现细节：

- 垫片以 `<name>.cmd` 写出，首行 `@echo off`、次行带标记，包含绝对 CLI 路径与 `%*`
- `written()` 能认出自己写的 batch 垫片 → 重复调用 `writeEnvironment` 不报 `foreignFile`（这是 setup 每次启动都会跑到的路径）
- 被禁命令写成失败垫片（stderr 提示 + `exit /b 1`），`gh`/`git`/`lark-cli` 永不被禁
- `agentVariables(stateDir).GH_CONFIG_DIR === <stateDir>/gh-config`

`tests/docs.spec.ts` 我们修了两处 Windows 分隔符假设（`relative()` 返回反斜杠、用 `lastIndexOf('/')` 切文件名）。

**升级判定标准**：`pnpm typecheck && pnpm build` 通过，且 `pnpm vitest run tests/windows-port.spec.ts` 全绿。其余 POSIX-only 测试在 Windows 上的失败属预期（权限位、符号链接、`#!/bin/sh` 脚本、`:` 作为 PATH 分隔符），不作为回归判据。

---

## 5. 升级流程

```bash
cd <checkout>

# 1. 取官方更新
git fetch upstream
git log --oneline upstream-base..upstream/main    # 先看改了什么
git diff upstream-base upstream/main --stat | tail -5

# 2. 合并（我们的提交在上，官方更新并入）
git merge upstream/main

# 3. 重装依赖并重建（上游可能改了依赖）
pnpm install
pnpm build

# 4. 契约测试
pnpm typecheck
pnpm vitest run tests/windows-port.spec.ts

# 5. 若插件接口变了，重启桌面应用验证面板
```

### 冲突处理预案

冲突**只会**出现在 §3 列出的那几个位置。处理原则：

- 先看官方这次是否重构了同一函数。若是，**以官方新结构为准，再把我们的 win32 分支移植进新结构**，不要反向改。
- `writeEnvironment()` 的 shim 写入逻辑若被官方改写：保留官方 POSIX 写法，`windows ? … : …` 只挂在具体写文件那一行。
- `workerProbe()` 若官方也引入了平台抽象：优先用官方的抽象，删掉我们的分支。
- 升级后**必须**重新生成 `worker-bin`（删掉 `<stateDir>` 下旧垫片，或让 setup 重跑），因为标记格式变了会触发 `foreignFile`。

### 基线维护

每次成功合并后：

```bash
git tag -f upstream-base upstream/main
```

---

## 6. 应用层为什么不会和上游冲突

`windows-app/` 只做两件事：

1. **进程编排**：按 profile 拉起 `node <dsh>/lib/bin.js --profile <p> --patch <overlay> --no-open`，捕获它打印的 `dsh web: http://127.0.0.1:<port>/?token=…`，把它加载进 BrowserWindow。
2. **宿主适配**：git/gh 的 PATH 预检、便携 userData、单实例、退出杀进程树、错误页与日志。

它不 import 上游任何源码，也不改插件行为。**上游怎么升级，应用壳都不用动**；反过来，应用壳怎么迭代，也不影响上游合并。唯一需要同步的接口是两处：CLI 参数（`--profile/--patch/--no-open`）与 `/orchestrator/api/state` 管理 API——两者都在 `docs/006-deployment.md` 里有正式承诺。

---

## 7. 目前已知未完成项

- 官方仓库**没有** Windows 支持；我们是唯一实现，因此未来官方若自带 Windows 分支，应评估是否整体切回官方实现（见 §5 冲突预案最后一条）。
- 本 fork 尚未推送到远程（`origin` 待设置）。
- `windows-app/` 的打包产物（Electron 二进制、`user-data/`、`lib/`、`node_modules/`）不入库，只入库源码与构建脚本。
