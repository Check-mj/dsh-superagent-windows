> **这是官方项目的 Windows 适配版（非官方产品，版权归原作者）。**
> Upstream: [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) · MIT · Copyright (c) 2026 DeepSeek Harness Team
>
> 本仓库 fork 自上面这个官方原型，目标是让它在 Windows 上能**双击即用**：桌面应用、打包工具链、多实例、安装器，
> 并补齐官方文章里上游尚未实现的部分（Watchdog 控制回路、Router 分片）。
> 上游代码与设计版权归 DeepSeek Harness Team；本仓库新增部分同样以 MIT 发布。与上游的差异逐条记录在
> [WINDOWS-DELTA.md](WINDOWS-DELTA.md)，上游更新可合并。
>
> **This repository is the Windows adaptation of the official project above, not an official DeepSeek product.**
> The upstream code and design are MIT-licensed by the DeepSeek Harness Team; the additions here are MIT as well.

# dsh-superagent

> **Research prototype for reference only, not an official DeepSeek product.** This code grew out of our team's day-to-day development work, with much of the engineering done by coding agents. Treat it as research code, not production-ready software. It may still contain bugs, and its coding style and engineering practices may be inconsistent. Review and adapt it before using it in your own environment.
>
> We have adapted it for publication, so it is not identical to our internal version or the implementation described in *Exploring Super-agent Design: Towards a More Autonomous Agent System*. Some designs discussed in the article are directions for future development and are not implemented in this prototype.

dsh-superagent is a proactive coding agent for one GitHub repository, packaged as a bundle for [DeepSeek Harness](https://www.deepseek.com/en/harness/). It listens to GitHub and, optionally, Feishu. When someone allowed asks the agent for work, it opens a work item, works on it in its own agent session and directory, and answers in the original conversation, for example with a pull request. A web panel shows what needs a person.

It is also a way of working with an agent: **take as little human attention as possible, and give as much value as possible.** An agent that can act for a whole team can also waste a whole team's attention, so it acts only when asked or when a rule the team wrote allows it, and speaks only when someone must act or can use a result. [docs/000-philosophy.md](docs/000-philosophy.md) explains the principle and what it asks of the operator.

## 安装（Windows 适配版的默认方式）

```powershell
dsh plugin --profile superagent add "git+ssh://git@github.com/Check-mj/dsh-superagent-windows.git#main"
```

安装后重启 Superagent，侧栏出现 Superagent 面板即可。仓库已包含构建产物（`lib/`），安装时无需再构建。
桌面应用（打包工具链、多实例、安装器）见 [`windows-app/INSTALL.md`](windows-app/INSTALL.md)。
想在本机 checkout 上改代码时改用 `link:<checkout>`。

## Setup

Setup has many steps, so an agent does it with you. Ask your coding agent:

> Read SETUP.md in this repository and set up dsh-superagent with me.

It asks one short question at a time, shows the full plan once, and then installs and configures everything. [SETUP.md](SETUP.md) is what it follows.

## Documentation

Read the numbered documents in order; each builds only on the ones before it.

- [000 Philosophy](docs/000-philosophy.md)
- [001 Domain model](docs/001-domain.md)
- [002 Authorization](docs/002-authorization.md)
- [003 Execution](docs/003-execution.md)
- [004 Prompts](docs/004-prompts.md)
- [005 Panel](docs/005-panel.md)
- [006 Deployment](docs/006-deployment.md): manual setup, configuration, upgrades and troubleshooting
- [007 Architecture](docs/007-architecture.md)
- [008 Cookbook](docs/008-cookbook.md): adding a Source

## Development

`pnpm check` runs the typecheck, the tests and the build.

## License

[MIT](LICENSE)
