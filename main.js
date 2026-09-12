const { app, BrowserWindow, ipcMain, dialog, screen, shell, net, session } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let browserWin = null;      // in-app mini web browser
let webMode = 'photo';      // where a grabbed image goes: 'photo' | 'sticker' | 'bg'
let isPinned = false;       // pinned = desktop-widget mode (behind other apps, resize locked)

function isMainSender(event) { return !!(win && event.sender === win.webContents); }
function isBrowserSender(event) { return !!(browserWin && event.sender === browserWin.webContents); }

// Where we persist attachments so they survive between sessions
const attachmentsDir = path.join(app.getPath('userData'), 'attachments');
if (!fs.existsSync(attachmentsDir)) {
  fs.mkdirSync(attachmentsDir, { recursive: true });
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();

  win = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 420,
    minHeight: 360,
    x: workArea.x + 60,
    y: workArea.y + 60,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: true,
    movable: true,
    skipTaskbar: false,
    backgroundColor: '#00000000',
    title: 'Cork Manager',
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  // win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- Window controls ----
ipcMain.handle('window:minimize', (event) => isMainSender(event) && win.minimize());
ipcMain.handle('window:close', (event) => isMainSender(event) && win.close());

// ---- Pin (desktop-widget mode) ----
// When pinned the window is locked in place & sits on the desktop layer.
// When unpinned it is a normal floating window that can be freely moved & resized.
ipcMain.handle('window:pin', (event, shouldPin) => {
  if (!isMainSender(event)) return { pinned: isPinned };
  if (!win) return { pinned: isPinned };
  isPinned = !!shouldPin;

  if (isPinned) {
    win.setMovable(false);
    win.setResizable(false);
    win.setSkipTaskbar(true);
    try { win.setAlwaysOnTop(true, 'desktop'); } catch (_) {}
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false }); } catch (_) {}
  } else {
    try { win.setAlwaysOnTop(false); } catch (_) {}
    win.setMovable(true);
    win.setResizable(true);
    win.setSkipTaskbar(false);
    try { win.setVisibleOnAllWorkspaces(false); } catch (_) {}
  }
  return { pinned: isPinned };
});

ipcMain.handle('window:isPinned', (event) => isMainSender(event) ? ({ pinned: isPinned }) : ({ pinned: false }));

// ---- File attachments ----
ipcMain.handle('files:pick', async (event, { multi = true } = {}) => {
  if (!isMainSender(event)) return [];
  const result = await dialog.showOpenDialog(win, {
    title: 'Attach files',
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
  });
  if (result.canceled) return [];
  return result.filePaths.map(copyIntoStore);
});

ipcMain.handle('files:pickImages', async (event) => {
  if (!isMainSender(event)) return [];
  const result = await dialog.showOpenDialog(win, {
    title: 'Attach images',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
  });
  if (result.canceled) return [];
  return result.filePaths.map(copyIntoStore);
});

function resolveStoredAttachment(storedPath) {
  if (typeof storedPath !== 'string' || !storedPath) return null;
  const abs = path.resolve(path.isAbsolute(storedPath) ? storedPath : path.join(attachmentsDir, storedPath));
  const rel = path.relative(attachmentsDir, abs);
  if (rel === '' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  return abs;
}

ipcMain.handle('files:open', (event, storedPath) => {
  if (!isMainSender(event)) return false;
  const abs = resolveStoredAttachment(storedPath);
  if (abs && fs.existsSync(abs)) return shell.openPath(abs);
  return '';
});

ipcMain.handle('files:reveal', (event, storedPath) => {
  if (!isMainSender(event)) return false;
  const abs = resolveStoredAttachment(storedPath);
  if (abs && fs.existsSync(abs)) shell.showItemInFolder(abs);
});

ipcMain.handle('files:delete', (event, storedPath) => {
  if (!isMainSender(event)) return false;
  const abs = resolveStoredAttachment(storedPath);
  try {
    if (abs && fs.existsSync(abs)) { fs.unlinkSync(abs); return true; }
  } catch (_) {}
  return false;
});

function copyIntoStore(srcPath) {
  const ext = path.extname(srcPath);
  const base = path.basename(srcPath, ext).replace(/[^a-zA-Z0-9-_\. ]/g, '_');
  const stamp = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const filename = `${base}-${stamp}${ext}`;
  const dest = path.join(attachmentsDir, filename);
  try {
    fs.copyFileSync(srcPath, dest);
  } catch (_) {
    return { name: path.basename(srcPath), path: srcPath, mime: guessMime(ext), external: true };
  }
  return {
    name: path.basename(srcPath),
    path: dest,
    fileUrl: 'file://' + dest.replace(/\\/g, '/'),
    mime: guessMime(ext),
    ext: ext.replace('.', '').toLowerCase(),
  };
}

// ================================================================
//  IN-APP MINI WEB BROWSER — browse the web & grab images/cats
// ================================================================
ipcMain.handle('web:open', (event, mode) => {
  if (!isMainSender(event)) return false;
  webMode = mode || 'photo';
  if (browserWin && !browserWin.isDestroyed()) {
    browserWin.focus();
    return true;
  }
  browserWin = new BrowserWindow({
    width: 1060,
    height: 780,
    parent: win || undefined,
    title: 'Grab an image from the web',
    backgroundColor: '#241708',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'webpick-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  browserWin.setMenuBarVisibility(false);
  browserWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  browserWin.webContents.on('will-navigate', (event, url) => {
    try {
      const u = new URL(url);
      if (!['https:', 'http:'].includes(u.protocol)) event.preventDefault();
    } catch (_) { event.preventDefault(); }
  });
  browserWin.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  browserWin.loadFile(path.join(__dirname, 'src', 'webpick.html'));
  browserWin.on('closed', () => { browserWin = null; });
  return true;
});

ipcMain.on('web:close', (event) => {
  if (!isBrowserSender(event)) return;
  if (browserWin && !browserWin.isDestroyed()) browserWin.close();
});

ipcMain.on('web:grab', async (event, url) => {
  if (!isBrowserSender(event)) return;
  const item = await downloadRemoteImage(url);
  if (item && win && !win.isDestroyed()) {
    win.webContents.send('web:image', { mode: webMode, item });
  }
});

function extFromUrl(url) {
  const m = String(url).split('?')[0].match(/\.([a-zA-Z0-9]{2,5})$/);
  return m ? m[1].toLowerCase() : '';
}
function saveBuffer(buf, ext, mime) {
  const clean = (ext || 'jpg').replace('jpeg', 'jpg').replace('+xml', '').replace(/[^a-z0-9]/gi, '') || 'jpg';
  const filename = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${clean}`;
  const dest = path.join(attachmentsDir, filename);
  try {
    fs.writeFileSync(dest, buf);
    return {
      name: filename,
      path: dest,
      fileUrl: 'file://' + dest.replace(/\\/g, '/'),
      mime: mime || guessMime('.' + clean),
      ext: clean,
    };
  } catch (_) {
    return null;
  }
}

function downloadRemoteImage(url) {
  return new Promise((resolve) => {
    try {
      if (typeof url !== 'string' || !url) return resolve(null);
      if (url.startsWith('data:')) {
        const m = url.match(/^data:(image\/(?:png|jpeg|gif|webp|bmp));base64,(.*)$/is);
        if (!m) return resolve(null);
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > 15 * 1024 * 1024) return resolve(null);
        const ext = m[1].split('/')[1];
        return resolve(saveBuffer(buf, ext, m[1]) || null);
      }
      let parsed;
      try { parsed = new URL(url); } catch (_) { return resolve(null); }
      if (!['http:', 'https:'].includes(parsed.protocol)) return resolve(null);

      const request = net.request({ url: parsed.toString(), redirect: 'follow' });
      const chunks = [];
      let total = 0;
      let rejected = false;
      request.on('response', (response) => {
        const ct = String(response.headers['content-type'] || '').toLowerCase();
        if (!ct.startsWith('image/')) { rejected = true; request.abort(); return resolve(null); }
        const len = Number(response.headers['content-length'] || 0);
        if (len > 15 * 1024 * 1024) { rejected = true; request.abort(); return resolve(null); }
        response.on('data', (c) => {
          total += c.length;
          if (total > 15 * 1024 * 1024) { rejected = true; request.abort(); return; }
          chunks.push(c);
        });
        response.on('end', () => {
          if (rejected) return resolve(null);
          const buf = Buffer.concat(chunks);
          if (!buf.length) return resolve(null);
          let ext = extFromUrl(parsed.toString());
          if (!ext) ext = ct.split('/')[1].split(';')[0];
          if (!['png','jpg','jpeg','gif','webp','bmp'].includes(ext)) ext = ct.split('/')[1].split(';')[0];
          if (!['png','jpg','jpeg','gif','webp','bmp'].includes(ext)) return resolve(null);
          resolve(saveBuffer(buf, ext, ct) || null);
        });
      });
      request.on('error', () => resolve(null));
      request.end();
    } catch (_) { resolve(null); }
  });
}

// ---- Reveal / open app source & data locations ----
ipcMain.handle('app:openSourceFolder', (event) => {
  if (!isMainSender(event)) return '';
  const target = app.isPackaged ? path.dirname(app.getAppPath()) : __dirname;
  shell.openPath(target);
  return target;
});

ipcMain.handle('app:openUserDataFolder', (event) => {
  if (!isMainSender(event)) return '';
  shell.openPath(app.getPath('userData'));
  return app.getPath('userData');
});

ipcMain.handle('app:openAttachmentsFolder', (event) => {
  if (!isMainSender(event)) return '';
  shell.openPath(attachmentsDir);
  return attachmentsDir;
});

ipcMain.handle('app:paths', (event) => {
  if (!isMainSender(event)) return null;
  return ({
  source: app.isPackaged ? path.dirname(app.getAppPath()) : __dirname,
  userData: app.getPath('userData'),
  attachments: attachmentsDir,
  platform: process.platform,
  version: app.getVersion(),
  packaged: app.isPackaged,
  });
});

function guessMime(ext) {
  const e = (ext || '').toLowerCase().replace('.', '');
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(e)) return 'image/' + (e === 'jpg' ? 'jpeg' : e);
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(e)) return 'audio/' + e;
  if (['mp4', 'webm', 'mov'].includes(e)) return 'video/' + e;
  if (['pdf'].includes(e)) return 'application/pdf';
  if (['txt', 'md'].includes(e)) return 'text/plain';
  return 'application/octet-stream';
}
