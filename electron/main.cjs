const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const PROTOCOL = 'poeatlas';
// Для тестов: отдельная папка данных (не трогает данные пользователя)
if (process.env.POE_USERDATA) app.setPath('userData', process.env.POE_USERDATA);
const isDev = !!process.env.VITE_DEV;
const DEV_URL = 'http://localhost:5173';

// ---------- регистрация протокола poeatlas:// ----------
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

const findLink = (argv) =>
  argv.find((a) => typeof a === 'string' && a.toLowerCase().startsWith(PROTOCOL + '://'));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let mainWindow = null;
let pendingLink = findLink(process.argv) || null;

// ---------- хранилище: JSON-файлы в userData ----------
const storageRoot = () => path.join(app.getPath('userData'), 'storage');
const kindDir = (kind) => {
  if (!['docs', 'trees', 'profiles'].includes(kind)) throw new Error('bad kind');
  const d = path.join(storageRoot(), kind);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}

// Windows может на мгновение заблокировать файл (антивирус, индексатор, синхронизация).
// Раньше такие ошибки молча прятали файл из списка или обрывали удаление — теперь повторяем.
const RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENOTEMPTY']);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function withRetry(fn, tries = 8) {
  for (let i = 0; ; i++) {
    try { return fn(); } catch (err) {
      if (i >= tries - 1 || !RETRY_CODES.has(err.code)) throw err;
      pause(40 * (i + 1));
    }
  }
}
const readJson = (f) => withRetry(() => JSON.parse(fs.readFileSync(f, 'utf8')));

ipcMain.handle('store:list', (_e, kind) => {
  const d = kindDir(kind);
  const items = [];
  const unreadable = [];
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    try {
      const { content, sheets, ...meta } = readJson(path.join(d, f)); // в списке только метаданные
      items.push(meta);
    } catch (err) {
      unreadable.push(f);
      console.error('[store] не удалось прочитать', kind, f, err.code || err.message);
    }
  }
  items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  // Нечитаемые файлы не прячем молча: вызывающий код узнаёт о них и не принимает решений «данных нет»
  return { items, unreadable };
});

ipcMain.handle('store:get', (_e, kind, id) => {
  const f = path.join(kindDir(kind), safeId(id) + '.json');
  return fs.existsSync(f) ? readJson(f) : null;
});

function writeObj(sender, kind, obj) {
  obj.updatedAt = Date.now();
  const f = path.join(kindDir(kind), safeId(obj.id) + '.json');
  const tmp = f + '.tmp';
  withRetry(() => fs.writeFileSync(tmp, JSON.stringify(obj)));
  withRetry(() => fs.renameSync(tmp, f));
  broadcast('store:changed', { kind, id: obj.id, source: sender.id });
  return obj;
}

ipcMain.handle('store:put', (e, kind, obj) => writeObj(e.sender, kind, obj));
ipcMain.on('store:put-sync', (e, kind, obj) => {
  try { e.returnValue = writeObj(e.sender, kind, obj); } catch (err) { e.returnValue = null; }
});

// Удаление = перенос в корзину storage/.trash/<вид>/ (данные можно восстановить вручную)
ipcMain.handle('store:delete', (e, kind, id) => {
  const f = path.join(kindDir(kind), safeId(id) + '.json');
  if (fs.existsSync(f)) {
    const trash = path.join(storageRoot(), '.trash', kind);
    fs.mkdirSync(trash, { recursive: true });
    const dest = path.join(trash, `${safeId(id)}.${Date.now()}.json`);
    withRetry(() => fs.renameSync(f, dest));
  }
  broadcast('store:changed', { kind, id, deleted: true, source: e.sender.id });
  return true;
});

// ---------- резервные копии: снимок всех данных при каждом запуске, храним 15 последних ----------
function backupStorage() {
  try {
    const root = storageRoot();
    if (!fs.existsSync(root)) return;
    const dir = path.join(root, '.backups');
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const dest = path.join(dir, stamp);
    let copied = 0;
    for (const kind of ['profiles', 'trees', 'docs']) {
      const src = path.join(root, kind);
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.join(dest, kind), { recursive: true });
      for (const f of fs.readdirSync(src)) {
        if (!f.endsWith('.json')) continue;
        try { withRetry(() => fs.copyFileSync(path.join(src, f), path.join(dest, kind, f))); copied++; } catch {}
      }
    }
    if (!copied && fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    const all = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    for (const old of all.slice(0, Math.max(0, all.length - 15))) fs.rmSync(path.join(dir, old), { recursive: true, force: true });
  } catch (err) {
    console.error('[backup]', err.message);
  }
}

// ---------- файлы ----------
ipcMain.handle('file:save', async (e, { defaultName, filters, data, encoding }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, encoding === 'base64' ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8'));
  return filePath;
});

ipcMain.handle('file:open', async (e, { filters }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { filters, properties: ['openFile'] });
  if (canceled || !filePaths[0]) return null;
  return { name: path.basename(filePaths[0]), base64: fs.readFileSync(filePaths[0]).toString('base64') };
});

ipcMain.handle('file:pdf', async (e, { html, defaultName }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return null;
  const pw = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  await pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const pdf = await pw.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
  pw.destroy();
  fs.writeFileSync(filePath, pdf);
  return filePath;
});

// ---------- окна ----------
function loadRoute(win, hash) {
  if (isDev) win.loadURL(DEV_URL + '/#' + hash);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash });
}

function makeWindow(hash, opts = {}) {
  const win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0b0f',
    title: 'PoE Atlas Docs',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false },
    ...opts,
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    else if (url.toLowerCase().startsWith(PROTOCOL + '://')) win.webContents.send('open-link', url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (ev, url) => {
    if (url.startsWith(DEV_URL) || url.startsWith('file:')) return;
    ev.preventDefault();
    if (url.toLowerCase().startsWith(PROTOCOL + '://')) win.webContents.send('open-link', url);
    else if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  loadRoute(win, hash);
  return win;
}

function openAtlasWindow(treeId, profileId) {
  const q = new URLSearchParams();
  if (treeId) q.set('tree', treeId);
  if (profileId) q.set('profile', profileId);
  return makeWindow('/atlas-window?' + q.toString(), { title: 'Дерево атласа — PoE Atlas Docs' });
}

ipcMain.handle('window:atlas', (_e, treeId, profileId) => {
  openAtlasWindow(treeId, profileId);
  return true;
});
ipcMain.handle('link:pending', () => {
  const l = pendingLink;
  pendingLink = null;
  return l;
});
ipcMain.handle('shell:external', (_e, url) => {
  if (/^https?:/i.test(url)) shell.openExternal(url);
});

function deliverLink(url) {
  if (!url) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('open-link', url);
  } else {
    pendingLink = url;
  }
}

app.on('second-instance', (_e, argv) => deliverLink(findLink(argv)));
app.on('open-url', (e, url) => {
  e.preventDefault();
  deliverLink(url);
});

if (gotLock) {
  app.whenReady().then(() => {
    backupStorage();
    mainWindow = makeWindow('/');
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    // Самопроверка: POE_CAPTURE=путь.png — снимок окна через 8 с и выход
    if (process.env.POE_CAPTURE) {
      setTimeout(async () => {
        const img = await mainWindow.webContents.capturePage();
        fs.writeFileSync(process.env.POE_CAPTURE, img.toPNG());
        app.quit();
      }, 8000);
    }
  });
}

app.on('window-all-closed', () => app.quit());
