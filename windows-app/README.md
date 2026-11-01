# DSH-Superagent Desktop

A real, portable Windows desktop application (Electron) that wraps the
**DeepSeek Harness `superagent` profile**. Double-click → the app starts the
backend itself, waits for its token URL, and shows the DSH panel in a native
window titled **DSH-Superagent**. Closing the window stops the backend.

No browser tab, no installer, no admin rights.

---

## 1. Launch (what the user double-clicks)

| Artifact | Path |
| --- | --- |
| **Desktop shortcut** (primary) | `%USERPROFILE%\Desktop\DSH-Superagent.lnk` |
| Start Menu shortcut | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Superagent\Superagent.lnk` |
| Portable launcher (`.cmd`, fallback) | `D:\1111\superagent-app\启动 Superagent.cmd` |
| Portable executable | `D:\1111\superagent-app\Superagent\Superagent.exe` |

Both shortcuts start:

```
"D:\1111\superagent-app\Superagent\Superagent.exe" --no-sandbox --disable-gpu
```

with working directory `D:\1111\superagent-app\Superagent`.

`--no-sandbox` / `--disable-gpu` are required on this machine: without them
Chromium crashes during startup before any JavaScript runs (observed here with
Electron 33.4.11 and 44.7.0, signed and unsigned binaries). They are baked into
the shortcuts and into `启动 DSH-Superagent.cmd`, and `main.js` additionally calls
`app.disableHardwareAcceleration()` / `appendSwitch('disable-gpu')` for
defence in depth.

### Requirements

* Windows 10/11 x64.
* **No Node.js, no Electron, no npm needed** to run the app — `Superagent\`
  contains the whole Electron runtime.
* The **backend** is *not* bundled; the app locates it on the machine
  (see §3). On this machine that is the globally installed
  `@deepseek-ai/dsh` plus `node.exe`.

---

## 2. Layout / sizes

```
D:\1111\superagent-app\
├─ Superagent\                  368 MB   portable app (copy anywhere)
│  ├─ Superagent.exe           246 MB   Electron 44.7.0, renamed
│  ├─ <electron runtime files>          dlls, pak, locales, resources.pak, ...
│  └─ resources\app\                    OUR app (plain folder, no app.asar)
│     ├─ package.json
│     ├─ main.js
│     ├─ icon.png / icon.ico
├─ package.json                 dev manifest (electron 44.7.0)
├─ main.js                      app source (the only code file)
├─ icon.png / icon.ico          window + shortcut icon
├─ build-portable.js            rebuilds Superagent\ from node_modules\electron\dist
├─ 启动 Superagent.cmd           launcher that passes the required flags
├─ verification\                test evidence (logs + panel screenshot)
└─ README.md                    this file
```

Electron version: **44.7.0** (chosen to match the Electron embedded in the
installed DeepSeek Harness app, which is known to run on this machine).
`resources\default_app.asar` is removed, so the shipped app — not the Electron
demo — is what starts.

---

## 3. How the backend is started

Resolution order (`main.js` → `resolveBackend()`):

1. **node** – `%ProgramFiles%\nodejs\node.exe`,
   `%ProgramFiles(x86)%\nodejs\node.exe`, `%LOCALAPPDATA%\Programs\nodejs\node.exe`,
   `where node.exe`.
2. **dsh CLI** – `%APPDATA%\npm\node_modules\@deepseek-ai\dsh\lib\bin.js`
   (then `%LOCALAPPDATA%\npm\...`).
3. **Bundled runtime fallback** (only if no dsh CLI above) –
   `%LOCALAPPDATA%\Programs\DeepSeek Harness\DeepSeek Harness.exe` with
   `ELECTRON_RUN_AS_NODE=1 --expose-internals
   ...\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js`.

The spawn command (no shell, `stdio: ['ignore','pipe','pipe']`):

```
node "<%APPDATA%>\npm\node_modules\@deepseek-ai\dsh\lib\bin.js" ^
     --profile superagent ^
     --patch "<userData>\runtime.patch.yml" ^
     --no-open
```

`--patch` is a **launcher-level** flag, so it must come **before** app flags
like `--no-open` (afterwards the CLI rejects it: `unknown option '--patch'`).

`runtime.patch.yml` is generated on every launch:

```yaml
- id: webserver
  config:
    host: 127.0.0.1
    port: 0
```

Why: `%USERPROFILE%\.dsh\profiles\superagent\cordis.patch.yml` pins
`webserver.port: 3082`, and that config wins over the CLI `--port` flag —
`--port 0` is silently ignored and the backend dies with `EADDRINUSE` if
anything else holds 3082. The generated overlay is applied *after* the profile
layer, so the port becomes 0 (OS-assigned).

The app then reads the child's stdout until it matches

```
dsh web: http://127.0.0.1:<port>/?token=<token>
```

and loads **that URL** (with `?token=`) into the window. The bare root URL is
HTTP **401** by design (`dsh web authentication required`); loading the token
URL returns 303 → sets the auth cookie → 200 panel. `dsh: warning: 2 entries
did not activate` (stateDir/github) is a plugin-level message, not an app error.

Startup timeout: **90 s** (`SUPERAGENT_START_TIMEOUT_MS`). On timeout, early
exit, or missing node/dsh, the window shows a styled error page with the
captured stdout/stderr tail, the exact command, the log paths, and hints for
the common failures (`Lock file is already being held`, `EADDRINUSE`, `EPERM`).

### git / gh preflight

Explorer's `PATH` has **no git** on this machine, which makes the backend report
a misleading `git 2.32 or later` setup error. Before spawning, the app resolves
`git`/`gh` (`where`, then known dirs: `C:\Program Files\Git\cmd`,
`%LOCALAPPDATA%\Programs\Git\cmd`, `D:\1111\toolchain\git\cmd`, …) and prepends
the found directories to the child `PATH`. If one is missing it does **not**
fail: the missing tool is logged, shown on the loading page, and as a
dismissible banner over the panel. `GH_CONFIG_DIR` is never set by the app —
the dsh-superagent plugin owns it.

---

## 4. App data, logs, state

Resolved before Chromium starts, in this order (first writable wins):

1. `%SUPERAGENT_USER_DATA%` (if set)
2. `%APPDATA%\Superagent`  ← **normal case**, e.g.
   `C:\Users\Chen\AppData\Roaming\Superagent`
3. `<the folder containing Superagent.exe>\user-data` ← portable fallback used
   when the app runs with a restricted token (see §7)
4. `%TEMP%\superagent-user-data`

`app.setPath('userData', …)` is called with the winner; `app.getPath('userData')`
is logged at startup (never called before `whenReady` — on Electron 44 it hangs
in restricted contexts).

Log files:

| File | Content |
| --- | --- |
| `<userData>\app.log` | lifecycle, resolved command/cwd, preflight results, backend URL, UI loads |
| `<userData>\backend.log` | raw backend stdout/stderr, appended |
| `<userData>\window-state.json` | window x/y/width/height/maximized; restored on next start only if still on a connected display |
| `<userData>\runtime.patch.yml` | generated CLI overlay (do not edit) |
| `<userData>\screenshot.png` | only when `SUPERAGENT_SCREENSHOT=1` (debug) |

The app window itself is 1280×860 by default, min 960×640, `title: Superagent`,
`autoHideMenuBar: true`, icon from `resources\app\icon.ico` (the icon of the
installed DeepSeek Harness app, copied here).

---

## 5. Controls, menus, lifecycle

* **Single instance** (`app.requestSingleInstanceLock`): a second launch does
  not open a second window; it focuses/restores the existing one and logs
  `[app] second instance launch -> focusing existing window`.
* **Loading page**: a dark "正在启动 Superagent…" page appears immediately, then
  is replaced by the panel when the backend URL is printed.
* **Closing the window / Alt+F4**: `before-quit` → backend is stopped (`SIGTERM`
  first, then `taskkill /PID <pid> /T /F` after a 2 s grace period, plus an
  absolute 8 s cap), then the app exits. `process.on('exit')` and
  `uncaughtException` also `taskkill /T /F` the tree, so no orphan `node.exe`
  is left behind. Verified: 0 Superagent processes, 0 dsh node processes after
  close.
* **Ctrl+Shift+R** (or menu 文件 → 重启后端): stops the child, shows the loading
  page, spawns a new backend, reloads.
* **Ctrl+R** reload panel; **Ctrl+Shift+F5** force reload;
  **Ctrl+Shift+I** / menu 视图 → devtools; zoom and fullscreen roles.
* **文件 → 打开日志文件夹** opens the userData directory.
* External links open in the system browser (`setWindowOpenHandler` +
  `will-navigate` allow localhost/data only).
* Permissions are denied except clipboard read/write, notifications, fullscreen.

### Unexpected backend exit after the panel loaded

The window switches to the same styled error page (with the backend tail and the
exit code) and tells the user to press **Ctrl+Shift+R**. A retry is not
automatic, because a crash loop would otherwise hide the cause.

---

## 6. Rebuild / change configuration

```bat
cd /d D:\1111\superagent-app
:: 1. install Electron (npm 11 blocks install scripts by default -> allowScripts
::    field in package.json is already set; the binary download may need a mirror)
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
"C:\Program Files\nodejs\npm.cmd" install --no-audit --no-fund
:: 2. rebuild the portable folder (copies electron dist, app files, renames exe)
"C:\Program Files\nodejs\node.exe" build-portable.js
```

Notes:
* If `node_modules\electron\dist\electron.exe` is missing after install,
  extract the cached zip manually:
  `unzip -o "%LOCALAPPDATA%\electron\Cache\<hash>\electron-v44.7.0-win32-x64.zip" -d node_modules\electron\dist`
  then `echo electron.exe > node_modules\electron\path.txt`.
* Close the app before rebuilding — a running `Superagent.exe` locks the folder.
* Re-running `build-portable.js` after editing `main.js` is enough; only the
  three payload files are copied.

Environment overrides (handy for testing):

| Variable | Meaning |
| --- | --- |
| `SUPERAGENT_PROFILE` | profile name, default `superagent` |
| `SUPERAGENT_PORT` | overlay port, default `0` (OS-assigned) |
| `SUPERAGENT_STATE_DIR` | adds `- id: dsh-superagent / stateDir` to the overlay (run a second instance while the real stateDir is locked) |
| `SUPERAGENT_USER_DATA` | force the app data directory |
| `SUPERAGENT_NODE` / `SUPERAGENT_DSH_BIN` | force the backend executables |
| `SUPERAGENT_CWD` | backend working directory (default `D:\1111\dsh-superagent`) |
| `SUPERAGENT_START_TIMEOUT_MS` | startup timeout, default `90000` |
| `SUPERAGENT_SCREENSHOT` | `1` = capture `screenshot.png` ~4 s after each page load |

---

## 7. Known limitations / rough edges

1. **One backend per stateDir.** The plugin locks
   `C:\Users\Chen\.dsh\state\superagent`; a second backend dies with
   `Lock file is already being held`. The app's single-instance lock covers the
   normal case and the error page explains the lock case. For parallel testing,
   set `SUPERAGENT_STATE_DIR` to a scratch directory.
2. **Restricted launch contexts (this agent session).** When the app is started
   from an automation/sandbox context on this machine, Electron gets a
   restricted, **Low-integrity** token (S-1-16-4096 + NTLM SID S-1-5-64-10).
   It then cannot write `%USERPROFILE%\.dsh`, so the backend exits with
   `EPERM ... cordis.yml`; the app detects this and says so on the error page.
   The app still works in that context when the backend's home is writable —
   which is how the verification run was done:
   `DSH_HOME=D:\1111\run\dsh-home` + `SUPERAGENT_STATE_DIR=D:\1111\run\app-test-state`.
   A normal desktop double-click from the user's own session is not subject to
   that restriction.
3. **`--no-sandbox`/`--disable-gpu` are required here**; they also make the
   renderer unsandboxed. Acceptable for a localhost-only panel, but worth
   revisiting on a clean machine.
4. `Superagent.exe` itself still carries the default Electron icon (the window
   and shortcuts use `icon.ico`). Patching the exe resource needs `rcedit`.
5. Window size/position is stored; a very small screen still honours min size
   960×640.
6. The panel may show `部署检查未通过 / GitHub 来源没有设置监听的仓库`
   (`repositoryUnset`) — that is the plugin's own setup state, not the app.

---

## 8. Verification performed (this machine)

| Check | Result |
| --- | --- |
| Packaged `Superagent.exe` starts with the shortcut flags | window PID present, `MainWindowTitle = Superagent` |
| Backend spawned and URL captured | `[ready] backend URL: http://127.0.0.1:<port>/?token=…` in ~5 s |
| Panel actually rendered | `did-finish-load http://127.0.0.1:<port>/`, `document.title = DeepSeek Harness`, screenshot `verification\panel-rendered.png` shows the Superagent 概览/来源/触发/评估/执行/设置 panel |
| Token URL semantics | token URL → 303 → cookie → 200; bare root → 401 (by design) |
| Single instance | second launch logged `second instance launch -> focusing existing window`, exactly 1 visible window, no second backend |
| Graceful close | `SIGTERM` → `backend exited … signal=SIGTERM`, app exit in ~1 s, **0 Superagent + 0 dsh node processes** afterwards |
| Window state | `window-state.json` written on close (`{"x":640,"y":266,"width":1280,"height":860,"maximized":false}`) |
| git/gh preflight | `git: D:\1111\toolchain\git\cmd`, `gh: D:\1111\toolchain\gh\bin` (found via known dirs because Explorer PATH has neither) |
| Portable folder | 368 MB, runs from its own copy of Electron 44.7.0 |
