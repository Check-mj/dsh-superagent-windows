/**
 * Instance management for the desktop shell: one window per context boundary (article §8.3).
 *
 * The records live in <install>/config/instances.json and are managed by windows-app/instances.ps1; this module only
 * lists them, opens a window for one of them (`--instance <name>` on the same executable), and renders the manager.
 * Everything Electron-specific is injected, so main.js keeps one small wiring point.
 */
module.exports = function createInstancesUi(deps) {
  const { BrowserWindow, ipcMain, spawn, fs, path, log } = deps;

  const recordsFile = () => path.join(path.dirname(process.execPath), 'config', 'instances.json');

  /** Every instance record, or an empty list when the file is absent or unreadable. */
  function listInstances() {
    try {
      const parsed = JSON.parse(fs.readFileSync(recordsFile(), 'utf8').replace(/^\uFEFF/, ''));
      return Array.isArray(parsed) ? parsed : (parsed && parsed.instances) || [];
    } catch (error) {
      log('[instances] could not read ' + recordsFile() + ': ' + error.message);
      return [];
    }
  }

  /** Opens another context boundary: the same executable with `--instance`. */
  function openInstance(name) {
    try {
      const child = spawn(process.execPath, ['--no-sandbox', '--disable-gpu', '--instance', String(name)], {
        detached: true, stdio: 'ignore', cwd: path.dirname(process.execPath) });
      child.unref();
      log('[instances] opened instance ' + name);
    } catch (error) {
      log('[instances] could not open ' + name + ': ' + error.message);
    }
  }

  const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));

  function instancesHtml(records) {
    const rows = records.map((record) => {
      const name = escapeHtml(record.name || '');
      const label = escapeHtml(record.label || record.name || '');
      const stateDir = escapeHtml(record.stateDir || '(profile default)');
      return '<tr><td><b>' + label + '</b><div class="sub">' + name + '</div></td>'
        + '<td class="dir">' + stateDir + '</td>'
        + '<td><button data-name="' + name + '">打开</button></td></tr>';
    }).join('');
    const body = records.length ? rows
      : '<tr><td colspan="3" class="sub">还没有实例记录。用 instances.ps1 -Action add 添加一个上下文边界。</td></tr>';
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Superagent 实例</title><style>'
      + ':root{color-scheme:dark}body{margin:0;background:#151517;color:#e8e8ea;font:13px/1.6 "Segoe UI","Microsoft YaHei",sans-serif}'
      + 'h1{font-size:15px;margin:18px 20px 10px}table{width:calc(100% - 40px);margin:0 20px;border-collapse:collapse}'
      + 'td{padding:10px 8px;border-top:1px solid #2a2a2f;vertical-align:middle}.sub{color:#8b8b94;font-size:11.5px}'
      + '.dir{color:#9aa0a6;font-size:11.5px;word-break:break-all;max-width:340px}'
      + 'button{background:#2f6fdd;color:#fff;border:0;border-radius:6px;padding:6px 14px;cursor:pointer}'
      + 'button:hover{background:#3d7ff0}p.hint{color:#6f6f78;font-size:11.5px;margin:14px 20px 18px}'
      + '</style></head><body><h1>Superagent 实例 · 一个上下文边界一个窗口</h1><table>' + body + '</table>'
      + '<p class="hint">打开会在新窗口里启动该实例；每个实例有自己的状态目录、策略、凭据与 Watchdog。记录由 instances.ps1 管理。</p>'
      + '<script>const {ipcRenderer}=require("electron");'
      + 'document.querySelectorAll("button[data-name]").forEach((button)=>button.addEventListener("click",()=>{'
      + 'ipcRenderer.send("instance:open",button.dataset.name);button.textContent="已打开";}));</script></body></html>';
  }

  function openInstancesWindow() {
    const win = new BrowserWindow({ width: 800, height: 480, title: 'Superagent — 实例', autoHideMenuBar: true,
      webPreferences: { nodeIntegration: true, contextIsolation: false } });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(instancesHtml(listInstances())));
    win.webContents.on('did-finish-load', () => {
      win.webContents.executeJavaScript('document.title').then((title) => log('[instances] window ready: ' + title)).catch(() => {});
    });
    return win;
  }

  ipcMain.on('instance:open', (_event, name) => openInstance(String(name)));

  return { listInstances, openInstance, openInstancesWindow, recordsFile };
};
