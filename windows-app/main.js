'use strict';
/*
 * Superagent — portable Windows desktop shell for the DeepSeek Harness
 * "superagent" profile.
 *
 * What it does:
 *   1. Shows a styled splash window immediately.
 *   2. Spawns the DSH web backend as a child process (never a shell), forcing
 *      the web server onto an OS-assigned free port via a generated --patch
 *      overlay (the profile pins port 3082 in cordis.patch.yml and the CLI
 *      --port flag loses to that config).
 *   3. Captures the printed `dsh web: http://127.0.0.1:<port>/?token=...` URL
 *      and loads it (bare root is HTTP 401 by design).
 *   4. Kills the backend tree on quit so no orphan node.exe lingers.
 *
 * Logs:  <userData>/app.log      lifecycle + resolved command
 *        <userData>/backend.log  raw backend stdout/stderr
 * State: <userData>/window-state.json, <userData>/runtime.patch.yml
 */
const { app, BrowserWindow, Menu, shell, screen } = require('electron');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_TITLE = 'Superagent';
const SPLASH_DELAY_MS = 0;
const START_TIMEOUT_MS = Number(process.env.SUPERAGENT_START_TIMEOUT_MS || 90000);
const KILL_GRACE_MS = 2000;
/* ------------------------------------------------------------------ */
/* Instances: one window per context boundary (article §8.3)            */
/* ------------------------------------------------------------------ */

/**
 * `--instance <name>` (or SUPERAGENT_INSTANCE) selects one record of <install>/config/instances.json.
 * Each record names its own DSH profile, state directory and port, so several context boundaries run as
 * separate windows of the same application. Without the flag the app behaves exactly as before.
 */
function instanceFlag(argv) {
  const index = argv.indexOf('--instance');
  const value = index >= 0 ? argv[index + 1] : process.env.SUPERAGENT_INSTANCE;
  return value && !String(value).startsWith('--') ? String(value) : undefined;
}
function readInstanceRecord(name) {
  const file = path.join(path.dirname(process.execPath), 'config', 'instances.json');
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) {
    log('[instance] could not read ' + file + ': ' + error.message);
    return undefined;
  }
  const list = Array.isArray(parsed) ? parsed : (parsed && parsed.instances) || [];
  const record = list.find((entry) => entry && entry.name === name);
  if (!record) log('[instance] no record named ' + name + ' in ' + file);
  return record;
}
const INSTANCE = instanceFlag(process.argv);
const INSTANCE_RECORD = INSTANCE ? readInstanceRecord(INSTANCE) : undefined;
const PROFILE = (INSTANCE_RECORD && INSTANCE_RECORD.profile) || process.env.SUPERAGENT_PROFILE || 'superagent';
const REQUESTED_PORT = String((INSTANCE_RECORD && INSTANCE_RECORD.port) ?? process.env.SUPERAGENT_PORT ?? '0');
/** The instance's own state directory; undefined keeps the profile's configured one. */
const INSTANCE_STATE_DIR = (INSTANCE_RECORD && INSTANCE_RECORD.stateDir) || process.env.SUPERAGENT_STATE_DIR;
const INSTANCE_LABEL = INSTANCE_RECORD && (INSTANCE_RECORD.label || INSTANCE_RECORD.name);
const URL_RE = /dsh web:\s*(https?:\/\/[^\s"'<>]+)/;

/* ------------------------------------------------------------------ */
/* user data directory                                                 */
/* ------------------------------------------------------------------ */

/* Resolve a WRITABLE user-data directory before Chromium starts.
 *
 * Why not just app.getPath('userData'):
 *  - calling getPath('userData') before `app.whenReady()` deadlocks/hangs on
 *    Electron 44 in restricted environments (verified on this machine);
 *  - Chromium hard-crashes when its profile dir is not writable (seen when the
 *    app is launched from a sandboxed shell: EPERM on %APPDATA%).
 * Preference order: explicit override, %APPDATA%\Superagent, a user-data dir
 * next to the portable exe, the OS temp dir. The app always ends up with a
 * writable profile and logs which one it chose. */
function writableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-test-' + process.pid);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return true;
  } catch { return false; }
}

function resolveUserData() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const exeDir = path.dirname(process.execPath);
  const candidates = [
    process.env.SUPERAGENT_USER_DATA,
    path.join(appData, 'Superagent'),
    path.join(exeDir, 'user-data'),
    path.join(os.tmpdir(), 'superagent-user-data'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (writableDir(dir)) return { dir, writable: true };
  }
  return { dir: candidates[candidates.length - 1], writable: false };
}

const USER_DATA_INFO = resolveUserData();
const USER_DATA = USER_DATA_INFO.dir;
try { app.setPath('userData', USER_DATA); } catch { /* keep default */ }
const APP_LOG = path.join(USER_DATA, 'app.log');
const BACKEND_LOG = path.join(USER_DATA, 'backend.log');
const STATE_FILE = path.join(USER_DATA, 'window-state.json');
const PATCH_FILE = path.join(USER_DATA, 'runtime.patch.yml');
const ICON = path.join(__dirname, fs.existsSync(path.join(__dirname, 'icon.ico')) ? 'icon.ico' : 'icon.png');

const state = {
  win: null,
  child: null,
  url: null,
  ready: false,
  restarting: false,
  quitting: false,
  timer: null,
  stdoutBuf: '',
  stderrBuf: '',
  startedAt: 0,
  integrity: 'unknown',
  tools: null,
  envMissing: [],
  splashNote: null,
};

/* ------------------------------------------------------------------ */
/* logging + small helpers                                            */
/* ------------------------------------------------------------------ */

function ensureUserData() {
  try { fs.mkdirSync(USER_DATA, { recursive: true }); } catch { /* ignore */ }
}

function log(line) {
  const stamp = new Date().toISOString();
  const entry = `[${stamp}] [pid ${process.pid}] ${line}\n`;
  try { fs.appendFileSync(APP_LOG, entry); } catch { /* ignore */ }
  process.stdout.write(entry);
}

function logBackend(chunk) {
  try { fs.appendFileSync(BACKEND_LOG, chunk); } catch { /* ignore */ }
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function tail(text, max) {
  const t = String(text || '');
  return t.length > max ? '…' + t.slice(-max) : t;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function dataUrl(html) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

/* ------------------------------------------------------------------ */
/* git / gh PATH preflight                                             */
/* ------------------------------------------------------------------ */

/* Explorer's PATH has no git on this machine (git only exists for bash/DSH
 * sessions), so a double-clicked app would make the backend report a
 * misleading "git 2.32 or later" setup error. Resolve the tools up front and
 * prepend their directories to the child PATH so DSH worker sessions inherit
 * it. Never fail hard: warn in the UI and keep going. */
/* This product is relocatable: nothing is pinned to one machine or one user.
 * Tools are looked up in this order, so a self-contained install always wins:
 *   1. an explicit override environment variable,
 *   2. this installation's own tools\ directory (a relocatable bundle),
 *   3. `where` on PATH,
 *   4. the usual per-user / per-machine install locations, derived from the
 *      environment rather than written down. */
const APP_ROOT = path.dirname(process.execPath);
const portableTool = (...segments) => path.join(APP_ROOT, ...segments);
const GIT_DIR_CANDIDATES = [
  portableTool('tools', 'git', 'cmd'),
  portableTool('tools', 'git', 'bin'),
  process.env.SUPERAGENT_GIT_DIR,
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'cmd'),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Git', 'cmd'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd'),
].filter(Boolean);
const GH_DIR_CANDIDATES = [
  portableTool('tools', 'gh', 'bin'),
  process.env.SUPERAGENT_GH_DIR,
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'GitHub CLI'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'GitHub CLI'),
].filter(Boolean);

function whichExe(name) {
  try {
    const r = spawnSync('where', [name], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) {
      const line = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (line && isFile(line)) return path.dirname(line);
    }
  } catch { /* ignore */ }
  return null;
}

function resolveTool(name, candidates) {
  /* Order matters: this installation's own tools\ must win over whatever
   * happens to be on PATH, otherwise a self-contained bundle would silently use
   * an unrelated machine-wide copy. Explicit overrides come first, then the
   * bundled tools, then PATH, then the standard locations. */
  const explicit = [];
  const bundled = [];
  const standard = [];
  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (resolved.startsWith(path.resolve(APP_ROOT) + path.sep)) bundled.push(resolved);
    else standard.push(resolved);
  }
  for (const c of explicit.concat(bundled, standard)) {
    if (isFile(path.join(c, name + '.exe'))) {
      return { dir: c, via: bundled.includes(c) ? 'bundled tools' : 'known path' };
    }
  }
  const dir = whichExe(name);
  if (dir) return { dir, via: 'where ' + name };
  return null;
}

function resolveCliTools() {
  const git = resolveTool('git', GIT_DIR_CANDIDATES);
  const gh = resolveTool('gh', GH_DIR_CANDIDATES);
  // Optional: a bundled PowerShell 7. DSH prefers %ProgramFiles%\PowerShell\7, then
  // PATH, then Windows PowerShell 5.1, so prepending this directory upgrades the shell.
  const pwsh = resolveTool('pwsh', [portableTool('tools', 'powershell')]);
  const pathDirs = [git && git.dir, gh && gh.dir, pwsh && pwsh.dir].filter(Boolean);
  const missing = [];
  if (!git) missing.push('git (Git for Windows)');
  if (!gh) missing.push('gh (GitHub CLI)');
  const result = { git, gh, pwsh, pathDirs, missing };
  log('[preflight] git: ' + (git ? git.dir + ' (' + git.via + ')' : 'MISSING'));
  log('[preflight] gh:  ' + (gh ? gh.dir + ' (' + gh.via + ')' : 'MISSING'));
  log('[preflight] pwsh: ' + (pwsh ? pwsh.dir + ' (' + pwsh.via + ')' : 'none bundled, DSH falls back'));
  return result;
}

/* This machine's agent/launch contexts hand Electron a restricted, Low
 * integrity token (NTLM Authentication SID + Low Mandatory Label). A Low-IL
 * process cannot write %USERPROFILE%\.dsh, so the backend fails with EPERM.
 * Detect it once so the error page can say something useful. */
function detectIntegrityLevel() {
  try {
    const r = spawnSync('whoami', ['/groups'], { encoding: 'utf8', windowsHide: true });
    const text = (r.stdout || '') + (r.stderr || '');
    if (/S-1-16-4096/.test(text) || /Low Mandatory Level/i.test(text)) return 'low';
    if (/S-1-16-8192/.test(text) || /Medium Mandatory Level/i.test(text)) return 'medium';
  } catch { /* ignore */ }
  return 'unknown';
}

function childEnv(tools) {
  const env = { ...process.env };
  // If this app was launched from a DSH/bash shell this would leak into the
  // backend; a plain GUI launch never has it.
  delete env.ELECTRON_RUN_AS_NODE;
  // Do NOT set GH_CONFIG_DIR: the dsh-superagent plugin owns it and uses it to
  // isolate the agent GitHub account.
  if (tools && tools.pathDirs.length) {
    env.PATH = tools.pathDirs.join(';') + ';' + (env.PATH || env.Path || '');
  // Some networks drop github.com:443 while SSH stays reachable. Observe the routing
  // decision the operator already made in ~/.ssh/config instead of probing the network,
  // and let the plugin's worker git follow it.
  if (!env.SUPERAGENT_GIT_SSH) {
    try {
      const sshConfig = path.join(require('node:os').homedir(), '.ssh', 'config');
      if (fs.existsSync(sshConfig) && /^\s*Host\s+github\.com\b/im.test(fs.readFileSync(sshConfig, 'utf8'))) {
        env.SUPERAGENT_GIT_SSH = '1';
        log('[preflight] worker git transport: SSH (~/.ssh/config routes github.com)');
      } else {
        log('[preflight] worker git transport: HTTPS (default)');
      }
    } catch { /* no ssh config: keep the default */ }
  }
  // A Windows system proxy lives in the registry, which git/libcurl and gh do not read;
  // pass it explicitly so worker git and GitHub CLI follow the same route as the browser.
  try {
    const BS = String.fromCharCode(92);
    const key = ['HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Internet Settings'].join(BS);
    const read = (name) => spawnSync('reg', ['query', key, '/v', name], { encoding: 'utf8', windowsHide: true }).stdout || '';
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(read('ProxyEnable'));
    const raw = (/ProxyServer\s+REG_SZ\s+(\S+)/i.exec(read('ProxyServer')) || [])[1];
    if (enabled && raw) {
      const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
      const pick = (scheme) => {
        const hit = parts.find((s) => s.toLowerCase().startsWith(scheme + '='));
        if (hit) return hit.slice(scheme.length + 1);
        return parts.some((s) => s.includes('=')) ? null : parts[0];
      };
      const https = pick('https') || pick('http');
      if (https) {
        env.HTTPS_PROXY = env.HTTPS_PROXY || 'http://' + https;
        env.HTTP_PROXY = env.HTTP_PROXY || 'http://' + (pick('http') || https);
        env.NO_PROXY = env.NO_PROXY || '127.0.0.1,localhost,::1';
        log('[preflight] system proxy: ' + https + ' (HTTPS_PROXY passed to the backend)');
      }
    }
  } catch { /* no readable proxy settings: keep the default */ }
  }
  return env;
}

/* ------------------------------------------------------------------ */
/* backend resolution                                                  */
/* ------------------------------------------------------------------ */

function resolveNode() {
  const candidates = [];
  if (process.env.SUPERAGENT_NODE) candidates.push(process.env.SUPERAGENT_NODE);
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, 'nodejs', 'node.exe'));
  if (process.env['ProgramFiles(x86)']) candidates.push(path.join(process.env['ProgramFiles(x86)'], 'nodejs', 'node.exe'));
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe'));
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, 'nodejs', 'node.exe'));

  for (const c of candidates) {
    if (c && isFile(c)) return { path: c, via: 'known path' };
  }
  try {
    const r = spawnSync('where', ['node.exe'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) {
      const line = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (line && isFile(line)) return { path: line, via: 'where node.exe' };
    }
  } catch { /* ignore */ }
  return null;
}

function resolveDshBin() {
  const candidates = [];
  if (process.env.SUPERAGENT_DSH_BIN) candidates.push(process.env.SUPERAGENT_DSH_BIN);
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  candidates.push(path.join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
  }
  for (const c of candidates) {
    if (c && isFile(c)) return { path: c, via: 'installed @deepseek-ai/dsh' };
  }
  return null;
}

/* Fallback: the version-matched runtime bundled inside the installed
 * DeepSeek Harness desktop app, run as node via ELECTRON_RUN_AS_NODE=1. */
function resolveBundledRuntime() {
  const bases = [];
  if (process.env.SUPERAGENT_DESKTOP_ROOT) bases.push(process.env.SUPERAGENT_DESKTOP_ROOT);
  if (process.env.LOCALAPPDATA) bases.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness'));
  if (process.env.ProgramFiles) bases.push(path.join(process.env.ProgramFiles, 'DeepSeek Harness'));
  for (const base of bases) {
    const exe = path.join(base, 'DeepSeek Harness.exe');
    const cli = path.join(base, 'resources', 'app.asar', 'dsh', 'node_modules',
      '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');
    if (isFile(exe) && isFile(cli)) return { exe, cli, via: 'bundled DeepSeek Harness runtime' };
  }
  return null;
}

function backendCwd() {
  /* The directory that hosts the plugin source. Nothing is pinned to one machine:
   * an explicit override wins, then the layout this product installs into
   * (<root>\Superagent.exe beside <root>\dsh-superagent), then any checkout found
   * next to the installation, then the profile directory, then the user's home. */
  const explicit = process.env.SUPERAGENT_CWD || process.env.SUPERAGENT_CHECKOUT;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const isCheckout = (dir) => {
    try {
      const pkg = path.join(dir, 'package.json');
      if (!isFile(pkg)) return false;
      return /"name"\s*:\s*"dsh-superagent"/.test(fs.readFileSync(pkg, 'utf8'));
    } catch { return false; }
  };
  // Installation-time record written by install.ps1, so the pieces may live anywhere.
  try {
    const recorded = path.join(APP_ROOT, 'config', 'paths.json');
    if (isFile(recorded)) {
      // PowerShell's Set-Content writes a UTF-8 BOM; JSON.parse rejects it.
      const raw = fs.readFileSync(recorded, 'utf8').replace(/^﻿/, '');
      const checkout = JSON.parse(raw).checkout;
      if (checkout && isCheckout(checkout)) return checkout;
    }
  } catch { /* A malformed record falls through to the layout search below. */ }
  const candidates = [
    path.join(APP_ROOT, '..', 'dsh-superagent'),
    path.join(APP_ROOT, 'dsh-superagent'),
    path.join(APP_ROOT, '..', '..', 'dsh-superagent'),
    path.join(APP_ROOT, '..'),
  ];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (isCheckout(resolved)) return resolved;
  }
  const profileDir = path.join(os.homedir(), '.dsh', 'profiles', PROFILE);
  if (fs.existsSync(profileDir)) return profileDir;
  return os.homedir();
}

function writePatchOverlay(port) {
  const lines = [
    '# Generated by Superagent desktop — DO NOT EDIT.',
    '# The superagent profile pins webserver.port in cordis.patch.yml; this',
    '# overlay is applied after it so the port can be OS-assigned (0).',
    '- id: webserver',
    '  config:',
    '    host: 127.0.0.1',
    '    port: ' + port,
  ];
  // Testing escape hatch: point the plugin at a separate stateDir so this app
  // can run while another backend holds the default state lock.
  if (INSTANCE_STATE_DIR) {
    const sd = String(INSTANCE_STATE_DIR).replace(/\\/g, '/');
    lines.push('- id: dsh-superagent', '  config:', '    stateDir: ' + sd);
  }
  lines.push('');
  const body = lines.join('\n');
  // Prefer userData; fall back to the app dir or the OS temp dir if that is
  // not writable (unusual tokens/ACLs) so startup never dies here.
  const targets = [PATCH_FILE, path.join(__dirname, 'runtime.patch.yml'), path.join(os.tmpdir(), 'superagent-runtime.patch.yml')];
  let lastErr = null;
  for (const target of targets) {
    try {
      const tmp = target + '.tmp';
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(tmp, body, 'utf8');
      fs.renameSync(tmp, target);
      if (target !== PATCH_FILE) log('[backend] warning: overlay written to fallback path ' + target);
      return target;
    } catch (err) { lastErr = err; }
  }
  log('[backend] cannot write patch overlay: ' + (lastErr && lastErr.message));
  return PATCH_FILE;
}

function resolveBackend(tools) {
  const node = resolveNode();
  const dshBin = resolveDshBin();
  const bundled = resolveBundledRuntime();
  const cwd = backendCwd();
  const patch = writePatchOverlay(REQUESTED_PORT);
  // --patch is a LAUNCHER flag: it must come before the app's own options
  // (--no-open). Passing it afterwards makes the app CLI reject it as
  // "unknown option '--patch'". The overlay path must be a native Windows
  // path; an MSYS "/d/..." path is resolved against the current drive.
  const args = ['--profile', PROFILE, '--patch', patch, '--no-open'];

  if (node && dshBin) {
    return {
      cmd: node.path,
      args: [dshBin.path, ...args],
      cwd,
      env: childEnv(tools),
      label: `node (${node.via}: ${node.path}) + dsh bin (${dshBin.path})`,
    };
  }
  if (bundled) {
    return {
      cmd: bundled.exe,
      args: ['--expose-internals', bundled.cli, ...args],
      cwd,
      env: { ...childEnv(tools), ELECTRON_RUN_AS_NODE: '1' },
      label: `bundled runtime fallback (${bundled.via}): ${bundled.exe}`,
    };
  }
  return {
    missing: true,
    reason: [
      '未找到 node.exe（已检查 ProgramFiles\\nodejs、LOCALAPPDATA\\Programs\\nodejs、where node）',
      '未找到 DSH：' + path.join(process.env.APPDATA || '%APPDATA%', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      '也未找到内置运行时（DeepSeek Harness 桌面版）',
      '',
      '安装 Node.js 或 DeepSeek Harness 桌面版后重试，',
      '或设置环境变量 SUPERAGENT_NODE / SUPERAGENT_DSH_BIN 指定路径。',
    ].join('\n'),
  };
}

/* ------------------------------------------------------------------ */
/* splash + error pages                                               */
/* ------------------------------------------------------------------ */

const SHELL_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: #151517; color: #e8e8ea;
    font: 14px/1.6 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    -webkit-user-select: none; user-select: none;
  }
  .card { width: min(660px, 88vw); }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
  .logo {
    width: 38px; height: 38px; border-radius: 10px; flex: none;
    background: linear-gradient(135deg, #4f7cff, #9b5cff);
    display: grid; place-items: center; font-size: 20px;
  }
  h1 { font-size: 17px; font-weight: 600; margin: 0; letter-spacing: .2px; }
  .sub { color: #8b8b94; font-size: 12.5px; margin-top: 2px; }
  .bar { height: 3px; width: 100%; border-radius: 3px; background: #2a2a2f; overflow: hidden; }
  .bar > i {
    display: block; height: 100%; width: 36%; border-radius: 3px;
    background: linear-gradient(90deg, #4f7cff, #9b5cff);
    animation: slide 1.5s ease-in-out infinite;
  }
  @keyframes slide { 0% { margin-left: -36%; } 100% { margin-left: 100%; } }
  .hint { color: #6f6f78; font-size: 12px; margin-top: 18px; }
  .err { border-left: 3px solid #e2534b; padding-left: 14px; }
  h2 { font-size: 16px; margin: 0 0 8px; color: #ff9d94; }
  pre {
    background: #1d1d21; border: 1px solid #2e2e34; border-radius: 8px;
    padding: 12px 14px; overflow: auto; max-height: 300px;
    font: 12px/1.5 Consolas, "Cascadia Mono", monospace;
    white-space: pre-wrap; word-break: break-word; color: #c9c9d1;
    -webkit-user-select: text; user-select: text;
  }
  .meta { color: #8b8b94; font-size: 12px; margin: 14px 0 10px; }
  .meta b { color: #c9c9d1; font-weight: 500; }
  a { color: #7c9cff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .btns { margin-top: 16px; display: flex; gap: 10px; }
`;

function splashHtml(message, note) {
  const noteHtml = note
    ? `<div class="warn-note">⚠ ${escapeHtml(note)}</div>`
    : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${APP_TITLE}</title><style>${SHELL_CSS}
  .warn-note {
    margin-top: 16px; padding: 10px 12px; border-radius: 8px;
    background: #3a2a12; border: 1px solid #6b4a1c; color: #f0b36a; font-size: 12.5px;
  }
</style></head><body>
<div class="card">
  <div class="brand">
    <div class="logo">◆</div>
    <div><h1>${APP_TITLE}</h1><div class="sub">DeepSeek Harness · superagent</div></div>
  </div>
  <div class="bar"><i></i></div>
  <div class="hint">${escapeHtml(message || '正在启动 Superagent…')}</div>
  <div class="hint" style="margin-top:6px">正在启动后端服务，首次启动可能需要十几秒。</div>
  ${noteHtml}
</div></body></html>`;
}

function errorHtml(title, detail, extra, logPath) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${APP_TITLE} — 启动失败</title><style>${SHELL_CSS}</style></head><body>
<div class="card">
  <div class="brand">
    <div class="logo" style="background:linear-gradient(135deg,#e2534b,#ff8a5c)">!</div>
    <div><h1>${APP_TITLE}</h1><div class="sub">无法启动后端服务</div></div>
  </div>
  <div class="err">
    <h2>${escapeHtml(title)}</h2>
    <div class="meta">${escapeHtml(extra || '')}</div>
    <pre>${escapeHtml(detail || '(无输出)')}</pre>
  </div>
  <div class="meta">日志：<b>${escapeHtml(logPath)}</b></div>
  <div class="btns">
    <a href="${escapeHtml('file:///' + logPath.replace(/\\/g, '/'))}" target="_blank">打开应用日志</a>
    <a href="${escapeHtml('file:///' + BACKEND_LOG.replace(/\\/g, '/'))}" target="_blank">打开后端日志</a>
  </div>
  <div class="hint">按 <b>Ctrl+Shift+R</b> 重启后端；按 <b>Ctrl+R</b> 重新加载。退出后重新双击应用亦可。</div>
</div></body></html>`;
}

function showSplash(message) {
  if (!state.win || state.win.isDestroyed()) return;
  state.win.loadURL(dataUrl(splashHtml(message, state.splashNote))).catch(() => { /* window closing */ });
}

/* Non-blocking banner over the loaded panel when git/gh are missing. */
function injectEnvBanner() {
  if (!state.envMissing || !state.envMissing.length) return;
  const win = state.win;
  if (!win || win.isDestroyed() || !state.ready) return;
  const text = '未找到 ' + state.envMissing.join(' / ') +
    '：GitHub 集成不可用。请安装 Git for Windows 与 GitHub CLI，并加入用户 PATH，然后按 Ctrl+Shift+R 重启后端。';
  const js = `(() => {
    if (document.getElementById('sa-env-banner')) return;
    const d = document.createElement('div');
    d.id = 'sa-env-banner';
    d.textContent = ${JSON.stringify(text)};
    d.title = '点击关闭';
    d.style.cssText = [
      'position:fixed','left:50%','transform:translateX(-50%)','top:10px',
      'z-index:2147483647','max-width:900px','padding:9px 14px',
      'background:#4a3410','border:1px solid #8a6420','color:#ffcf8a',
      'font:12.5px/1.5 "Segoe UI","Microsoft YaHei",sans-serif',
      'border-radius:8px','box-shadow:0 6px 24px rgba(0,0,0,.45)','cursor:pointer'
    ].join(';');
    d.addEventListener('click', () => d.remove());
    document.body.appendChild(d);
  })();`;
  win.webContents.executeJavaScript(js).catch((e) => log('[ui] banner injection failed: ' + e.message));
}

function showError(title, detail, extra) {
  if (!state.win || state.win.isDestroyed()) return;
  const html = errorHtml(title, detail, extra, APP_LOG);
  state.win.loadURL(dataUrl(html)).catch(() => { /* window closing */ });
}

/* ------------------------------------------------------------------ */
/* backend lifecycle                                                   */
/* ------------------------------------------------------------------ */

function appendStdout(chunk) {
  state.stdoutBuf = tail(state.stdoutBuf + chunk, 200000);
  logBackend(chunk);
}

function appendStderr(chunk) {
  state.stderrBuf = tail(state.stderrBuf + chunk, 200000);
  logBackend(chunk);
}

function backendTail() {
  const out = state.stdoutBuf.trim();
  const err = state.stderrBuf.trim();
  const parts = [];
  if (err) parts.push('--- stderr ---\n' + tail(err, 4000));
  if (out) parts.push('--- stdout ---\n' + tail(out, 4000));
  return parts.join('\n\n') || '(后端没有任何输出)';
}

/* Turn the two most common backend failures into actionable advice. */
function extraWithHint(base) {
  const all = state.stdoutBuf + '\n' + state.stderrBuf;
  const hints = [];
  if (/Lock file is already being held/i.test(all)) {
    const stateDir = INSTANCE_STATE_DIR ||
      path.join(os.homedir(), '.dsh', 'state', 'superagent');
    hints.push('另一个 Superagent 后端正在运行并占用同一 stateDir（' + stateDir + '）。' +
      '请先关闭其它实例；或设置环境变量 SUPERAGENT_STATE_DIR 指向独立状态目录后再启动。');
  }
  if (/EPERM/i.test(all) && /\.dsh|profiles\|stateDir/i.test(all)) {
    hints.push('后端无法写入 ' + (process.env.USERPROFILE || '%USERPROFILE%') + '\.dsh（EPERM）。' +
      (state.integrity === 'low'
        ? '本进程运行在低完整性级别（Low Integrity，S-1-16-4096），因而无法写入用户目录：请从你自己的桌面会话直接双击桌面快捷方式启动，而不是从受限制的沙箱/自动化会话中启动。'
        : '请检查该目录的权限或安全软件拦截。'));
  }
  if (/EADDRINUSE/i.test(all)) {
    hints.push('端口被占用：本应用的 overlay 本应使用 0（系统分配）。若你设置了 SUPERAGENT_PORT，请改为 0。');
  }
  return hints.length ? hints.join('\n') + '\n\n' + base : base;
}

function startBackend() {
  if (state.quitting) return;
  state.integrity = detectIntegrityLevel();
  log('[preflight] integrity level: ' + state.integrity);
  const tools = resolveCliTools();
  state.tools = tools;
  state.envMissing = tools.missing;
  if (tools.missing.length) {
    state.splashNote = '未找到 ' + tools.missing.join(' / ') +
      '：部分功能（GitHub 集成）不可用。安装后加入用户 PATH 并重启应用。';
    log('[preflight] WARNING missing: ' + tools.missing.join(', '));
  } else {
    state.splashNote = null;
  }
  const resolved = resolveBackend(tools);

  if (resolved.missing) {
    log('[backend] cannot start: ' + resolved.reason.replace(/\n+/g, ' | '));
    showError('找不到 Node.js 或 DeepSeek Harness', resolved.reason, '请安装后重启应用');
    return;
  }

  state.url = null;
  state.ready = false;
  state.stdoutBuf = '';
  state.stderrBuf = '';
  state.startedAt = Date.now();

  const pretty = [resolved.cmd, ...resolved.args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
  log('[backend] start: ' + pretty);
  log('[backend] cwd: ' + resolved.cwd + ' | ' + resolved.label);
  try { fs.appendFileSync(BACKEND_LOG, `\n===== ${new Date().toISOString()} starting: ${pretty}\n`); } catch { /* ignore */ }

  let child;
  try {
    child = spawn(resolved.cmd, resolved.args, {
      cwd: resolved.cwd,
      env: resolved.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
      detached: false,
    });
  } catch (err) {
    log('[backend] spawn threw: ' + err.message);
    showError('无法启动后端进程', String(err && err.stack || err), pretty);
    return;
  }
  state.child = child;
  log('[backend] pid ' + child.pid);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => { appendStdout(d); maybeReady(); });
  child.stderr.on('data', (d) => { appendStderr(d); });

  child.on('error', (err) => {
    log('[backend] process error: ' + err.message);
    if (!state.ready) showError('后端进程启动失败', String(err && err.stack || err), pretty);
  });

  child.on('exit', (code, signal) => {
    const wasReady = state.ready;
    log(`[backend] exited code=${code} signal=${signal} (ready=${wasReady})`);
    if (state.child === child) state.child = null;
    clearTimeout(state.timer);
    if (state.quitting || state.restarting) return;
    if (!wasReady) {
      showError('后端已退出（尚未就绪）',
        backendTail(),
        extraWithHint(`退出码 ${code}${signal ? ' / 信号 ' + signal : ''} · 命令: ${pretty}`));
    } else {
      state.ready = false;
      showError('后端已退出',
        backendTail(),
        extraWithHint(`退出码 ${code}${signal ? ' / 信号 ' + signal : ''} · 按 Ctrl+Shift+R 重启后端`));
    }
  });

  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    if (state.url || state.quitting) return;
    log(`[backend] startup timeout after ${START_TIMEOUT_MS}ms`);
    showError('后端启动超时', backendTail(),
      extraWithHint(`${START_TIMEOUT_MS / 1000}s 内没有输出 dsh web: <url> · 命令: ${pretty}`));
  }, START_TIMEOUT_MS);

  function maybeReady() {
    if (state.url) return;
    const m = state.stdoutBuf.match(URL_RE);
    if (!m) return;
    const url = m[1].replace(/[),.;]+$/, '');
    state.url = url;
    state.ready = true;
    clearTimeout(state.timer);
    log('[ready] backend URL: ' + url + ' (' + (Date.now() - state.startedAt) + 'ms)');
    if (state.win && !state.win.isDestroyed()) {
      state.win.loadURL(url).catch((e) => log('[ready] loadURL failed: ' + e.message));
    }
  }
}

function killTree(pid) {
  if (!pid) return;
  try {
    const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true, stdio: 'ignore',
    });
    log(`[backend] taskkill /T /F ${pid} -> ${r.status}`);
  } catch (err) {
    log('[backend] taskkill failed: ' + err.message);
  }
}

function stopBackend() {
  return new Promise((resolve) => {
    const child = state.child;
    clearTimeout(state.timer);
    state.ready = false;
    state.url = null;
    if (!child || child.exitCode !== null || child.signalCode) {
      state.child = null;
      return resolve();
    }
    const pid = child.pid;
    log('[backend] stopping pid ' + pid);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      clearTimeout(capTimer);
      if (state.child === child) state.child = null;
      resolve();
    };
    child.once('exit', finish);
    try { child.kill(); } catch (err) { log('[backend] kill failed: ' + err.message); }

    // Escalate: kill the whole tree if the child is still alive.
    const hardTimer = setTimeout(() => {
      log('[backend] grace expired, killing tree');
      killTree(pid);
      setTimeout(finish, 500);
    }, KILL_GRACE_MS);

    // Absolute cap so quitting can never hang.
    const capTimer = setTimeout(finish, KILL_GRACE_MS + 6000);
  });
}

function restartBackend() {
  if (state.restarting || state.quitting) return;
  state.restarting = true;
  log('[restart] requested');
  showSplash('正在重启后端…');
  stopBackend().then(() => {
    state.restarting = false;
    if (state.quitting) return;
    startBackend();
  });
}

/* ------------------------------------------------------------------ */
/* window state                                                        */
/* ------------------------------------------------------------------ */

const DEFAULT_BOUNDS = { width: 1280, height: 860 };
const MIN_BOUNDS = { width: 960, height: 640 };

function loadWindowState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const width = Math.max(MIN_BOUNDS.width, Number(raw.width) || DEFAULT_BOUNDS.width);
    const height = Math.max(MIN_BOUNDS.height, Number(raw.height) || DEFAULT_BOUNDS.height);
    const out = { width, height, maximized: !!raw.maximized };
    if (Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      // Only restore the position if it is still on an attached display.
      const visible = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return raw.x + 80 > a.x && raw.x < a.x + a.width - 80 &&
               raw.y + 40 > a.y && raw.y < a.y + a.height - 40;
      });
      if (visible) { out.x = raw.x; out.y = raw.y; }
    }
    return out;
  } catch {
    return { ...DEFAULT_BOUNDS, maximized: false };
  }
}

function saveWindowState() {
  const win = state.win;
  if (!win || win.isDestroyed()) return;
  try {
    const maximized = win.isMaximized();
    const b = maximized ? (win._normalBounds || win.getBounds()) : win.getBounds();
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      x: b.x, y: b.y, width: b.width, height: b.height, maximized,
    }, null, 2));
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* window + menu                                                       */
/* ------------------------------------------------------------------ */

function createWindow() {
  const saved = loadWindowState();
  const win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: MIN_BOUNDS.width,
    minHeight: MIN_BOUNDS.height,
    title: INSTANCE_LABEL ? APP_TITLE + ' — ' + INSTANCE_LABEL : APP_TITLE,
    icon: isFile(ICON) ? ICON : undefined,
    backgroundColor: '#151517',
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  state.win = win;

  win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle(APP_TITLE); });
  win.webContents.on('did-finish-load', () => {
    const url = win.webContents.getURL();
    log('[ui] did-finish-load: ' + url.replace(/([?&]token=)[^&]+/, '$1<redacted>'));
    injectEnvBanner();
    win.webContents.executeJavaScript('document.title').then((t) => log('[ui] document.title: ' + t)).catch(() => {});
    if (process.env.SUPERAGENT_SCREENSHOT) {
      setTimeout(() => {
        win.webContents.capturePage().then((img) => {
          const file = path.join(USER_DATA, 'screenshot.png');
          fs.writeFileSync(file, img.toPNG());
          log('[ui] screenshot: ' + file);
        }).catch((e) => log('[ui] screenshot failed: ' + e.message));
      }, 4000);
    }
  });
  if (saved.maximized) win.maximize();

  if (saved.x !== undefined) {
    const normal = win.getBounds();
    win._normalBounds = normal;
  }
  win.on('maximize', () => { if (!win._normalBounds) win._normalBounds = win.getBounds(); });
  win.on('unmaximize', () => { win._normalBounds = win.getBounds(); });
  win.on('resize', () => { if (!win.isMaximized()) win._normalBounds = win.getBounds(); });
  win.on('move', () => { if (!win.isMaximized()) win._normalBounds = win.getBounds(); });
  win.on('close', saveWindowState);
  win.on('closed', () => { if (state.win === win) state.win = null; });

  // External links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
    else if (/^file:/i.test(url)) shell.openPath(decodeURIComponent(url.replace(/^file:\/\/\//i, ''))).catch(() => {});
    return { action: 'deny' };
  });

  // Keep the window on our own pages / backend origin.
  win.webContents.on('will-navigate', (e, url) => {
    const isLocal = /^(data|devtools):/i.test(url) ||
      (state.url && url.startsWith(state.url.replace(/\?.*$/, '').replace(/\/$/, ''))) ||
      /^https?:\/\/127\.0\.0\.1[:/]/.test(url) || /^https?:\/\/localhost[:/]/.test(url);
    if (!isLocal) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
    }
  });

  // Deny permission requests we do not need; allow clipboard/notifications.
  const sess = win.webContents.session;
  const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen']);
  sess.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  sess.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  return win;
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '重启后端', accelerator: 'CmdOrCtrl+Shift+R', click: () => restartBackend() },
        { type: 'separator' },
        { label: '打开日志文件夹', click: () => shell.openPath(USER_DATA).catch(() => {}) },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+F5', role: 'forceReload' },
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '打开日志文件夹', click: () => shell.openPath(USER_DATA).catch(() => {}) },
        {
          label: '关于 Superagent',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox({
              type: 'info',
              title: '关于 Superagent',
              message: `Superagent ${app.getVersion()}`,
              detail: [
                'DeepSeek Harness · superagent 桌面外壳',
                `Electron ${process.versions.electron} / Chromium ${process.versions.chrome}`,
                `用户数据目录: ${USER_DATA}`,
              ].join('\n'),
              icon: isFile(ICON) ? ICON : undefined,
            }).catch(() => {});
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ */
/* app lifecycle                                                       */
/* ------------------------------------------------------------------ */

/* Hardware acceleration is unnecessary for a localhost panel and is the usual
 * cause of GPU-process startup crashes in remote/sandboxed Windows sessions.
 * Note: --no-sandbox cannot be applied here early enough to fix a pre-JS
 * sandbox crash, so the shipped .cmd launcher and Desktop shortcut also pass
 * --no-sandbox explicitly. */
app.disableHardwareAcceleration();
try { app.commandLine.appendSwitch('disable-gpu'); } catch { /* ignore */ }
try { if (!app.commandLine.hasSwitch('no-sandbox')) app.commandLine.appendSwitch('no-sandbox'); } catch { /* ignore */ }

ensureUserData();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another instance owns the app: hand control over and exit immediately.
  app.quit();
} else {
  app.on('second-instance', () => {
    log('[app] second instance launch -> focusing existing window');
    const win = state.win;
    if (!win || win.isDestroyed()) { createWindow(); showSplash(); startBackend(); return; }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    log(`[app] starting ${app.getVersion()} | Electron ${process.versions.electron} | electron=${process.execPath}`);
    if (INSTANCE) log('[instance] ' + INSTANCE + ' | profile=' + PROFILE + ' | stateDir=' + String(INSTANCE_STATE_DIR || '(profile)') + ' | port=' + REQUESTED_PORT);
    log('[app] userData: ' + USER_DATA + (USER_DATA_INFO.writable ? '' : ' (WARNING: not writable)'));
    try { log('[app] app.getPath(userData): ' + app.getPath('userData')); } catch (e) { log('[app] getPath failed: ' + e.message); }
    if (isFile(ICON)) app.setAppUserModelId('com.superagent.desktop');
    createWindow();
    showSplash();
    buildMenu();
    startBackend();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', (e) => {
    if (state.quitting) return;
    state.quitting = true;
    saveWindowState();
    log('[app] quitting, stopping backend');
    e.preventDefault();
    stopBackend().then(() => {
      log('[app] backend stopped, exiting');
      app.exit(0);
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      showSplash();
      startBackend();
    }
  });

  process.on('exit', () => {
    const child = state.child;
    if (child && child.pid) {
      try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* ignore */ }
    }
  });

  process.on('uncaughtException', (err) => {
    log('[app] uncaughtException: ' + (err && err.stack || err));
    try {
      const child = state.child;
      if (child && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch { /* ignore */ }
    app.exit(1);
  });
}
