# Changelog

All notable changes to **DSH-Superagent** — the Windows deep-adaptation of the official
[`dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype) — are recorded here.
Upstream behaviour is tracked in [`WINDOWS-DELTA.md`](WINDOWS-DELTA.md); this file records the adaptation.

The npm package id stays `dsh-superagent` (plugin id, profile dependency and internal paths); only the displayed
product name changed to DSH-Superagent.

## [0.1.0] — 2026-11-01

First publishable Windows adaptation.

### Added — desktop application (windows-app/)
- Portable Electron shell that starts the DeepSeek Harness backend itself, self-locating its install root, with
  bundled `git`, `gh` and PowerShell 7 under `tools/`, and an installer that copies the payload per user and creates
  Desktop and Start Menu shortcuts.
- Diagnostics instead of a blank window: preflight of the bundled tools, backend logs in `%APPDATA%\Superagentpp.log`,
  readable error screens, and automatic backend restart.
- Instance management: `--instance <name>` reads `config/instances.json`, so one window per context boundary, each
  with its own `stateDir`, settings and credentials; plus `instances.ps1` (list/add/remove/start/shortcut) and an
  in-app manager window (File → 实例…). An instance record may reuse another instance's signed-in `gh-config` once
  (`ghConfigFrom`), keeping credentials per instance.

### Added — panel
- A guide page (介绍) that explains what the panel is for, what each page does, the first four steps, usage notes and
  the two repositories, reachable from the overview's introduction block.
- Execution settings gained the control-loop and Router-shard options (interval, stall threshold, standing
  instruction, shard count), with the same values available through declarative settings.

### Added — mechanisms the upstream prototype lacks (opt-in)
- Watchdog depth: cross-tick diffing so a healthy instance is not woken, stall detection for Tickets that look busy
  but are not moving, and a standing-instruction channel sent with every digest.
- Router sharding (article §2.1): stable Thread placement, shard Sessions created on first delivery, visible in health;
  off by default, verified against a real cross-account GitHub event.

### Changed
- The bundle is now installed from this repository's git source, so the plugin page's 代码来源 names a repository
  instead of a local path; `lib/` is committed so a git install needs no build.
- Attribution is explicit in README, `NOTICE`, `LICENSE` and the plugin page's locale description: upstream is the
  official DeepSeek prototype (MIT, © 2026 DeepSeek Harness Team), and this fork deletes its own version of a
  mechanism once upstream ships one.
### Changed

- The product description was rewritten everywhere it is read (repository About, plugin page metadata, README
  positioning, package description): it no longer reads as "watches one repository" but covers the whole chain —
  event sources (GitHub issues/PRs/comments/CI and optional Feishu), two-level judgement, isolated executions with
  replies, the panel, multi-instance, the Watchdog control loop and Router sharding, plus the desktop install and
  self-recovery story.


### Fixed
- The installer no longer hangs when the application is running (it refuses, and robocopy retries are bounded).
- GitHub polling, source state and per-instance credentials are isolated per instance.

### Fixed in the second pass (before announcement)
- The installer no longer breaks on an install root containing a space (a user name such as `John Doe` was enough):
  the copy is quoted and verified, and the installer fails loudly instead of writing only `paths.json`.
- A backend left over from a window that was closed while it ran used to keep the state lock, so the next launch died
  with "Lock file is already being held" and the panel never connected. The shell now clears orphan backends of its own
  instance before starting, and the startup-failure page offers 重新启动后端.
- The backend token is no longer written to `app.log` (only the origin is), and an `unhandledRejection` handler keeps a
  rejected promise from disappearing.
- The panel header and sidebar entry read DSH-Superagent everywhere (the shell title, the About dialog and the plugin
  page already did).

### Added in the second pass
- `pnpm release:check` / `scripts/release-check.ps1`: the release rehearsal in one command — clean tree and pushed
  branch, attribution in every place, a changelog section, typecheck/build/tests, and the published release's asset
  digest matching the checksum the one-line installer verifies.
- `tests/portability.spec.ts` and `tests/release-invariants.spec.ts`: no tracked file may name the development machine,
  and attribution, the changelog, the package id and the absence of credential shapes are locked by tests.
- The panel's guide page explains the four stages plus Settings, links both repositories and the delta file, and carries
  the first four steps and three usage notes.
- `docs/019` turned into a recording runbook (pre-flight, shot-by-shot table, file conventions, self-check, fallbacks),
  and `docs/020` is the release checklist with a publisher command sequence.

### Known limitations
- Compute/state separation (article §5) is not implemented; a stopped process stays stopped, so an external
  scheduled check is still the outermost guard.
- Async subagent calls come from DeepSeek Harness itself; this adaptation ships no duplicate.
- A new instance needs its own agent sign-in once (or `ghConfigFrom`).

[0.1.0]: https://github.com/Check-mj/dsh-superagent-windows/releases/tag/v0.1.0
