import { app, BrowserWindow, dialog, ipcMain, shell, nativeImage } from 'electron';
import electronUpdater from 'electron-updater';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { IPC } from './shared/ipc.js';
import type { AppSettings, HistoryEntry, SystemStats, UpdateStatus } from './shared/ipc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
let win: BrowserWindow | null = null;

/** Resolve a bundled asset (icon) in both dev and packaged builds. */
function assetPath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(app.getAppPath(), 'build', name);
}

/** App icon — .ico on Windows for crisp taskbar rendering, .png elsewhere. */
function appIcon() {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const p = assetPath(file);
  return existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createEmpty();
}

// Polyfill globals needed by some CJS dependencies (e.g. tesseract.js workers)
(globalThis as any).__dirname  = __dirname;
(globalThis as any).__filename = __filename;

// ── Hardware stats ────────────────────────────────────────────────────────────

let prevCpu = cpuSample();
function cpuSample() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const cpu of cpus) {
    for (const v of Object.values(cpu.times)) { total += v; }
    idle += cpu.times.idle;
  }
  return { idle, total };
}

async function readStats(): Promise<SystemStats> {
  const now = cpuSample();
  const idleDiff  = now.idle  - prevCpu.idle;
  const totalDiff = now.total - prevCpu.total;
  prevCpu = now;
  const cpu = totalDiff > 0 ? Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100))) : 0;
  const memTotal = os.totalmem();
  const memUsed  = memTotal - os.freemem();
  const cpus     = os.cpus();
  return {
    cpu, memUsed, memTotal,
    cpuModel: cpus[0]?.model?.trim() ?? 'CPU',
    cores: cpus.length,
    platform: `${os.platform()} ${os.release()}`,
  };
}

// ── Settings ─────────────────────────────────────────────────────────────────

const SETTINGS_PATH = join(app.getPath('userData'), 'settings.json');
const HISTORY_PATH  = join(app.getPath('userData'), 'history.json');

const DEFAULT: AppSettings = {
  defaultOutputPath: '',
  autoOpenAfter: false,
  overwriteExisting: true,
  openPreviewPrompt: true,
};

async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf8');
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT }; }
}

async function saveSettings(s: AppSettings): Promise<void> {
  await writeFile(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
}

async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(HISTORY_PATH, 'utf8');
    return JSON.parse(raw) as HistoryEntry[];
  } catch { return []; }
}

async function saveHistory(h: HistoryEntry[]): Promise<void> {
  await writeFile(HISTORY_PATH, JSON.stringify(h, null, 2), 'utf8');
}

// ── Auto-update ───────────────────────────────────────────────────────────────

const { autoUpdater } = electronUpdater;
const UPDATE_REPO = 'Gomby711/folio-pdf';
let macDownloadUrl = '';

function emitUpdate(s: UpdateStatus) {
  win?.webContents.send(IPC.onUpdate, s);
}

function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function checkMacUpdate() {
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Folio-PDF' },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    const latest = String(data.tag_name ?? '').replace(/^v/, '');
    if (latest && isNewerVersion(latest, app.getVersion())) {
      macDownloadUrl = data.html_url ?? `https://github.com/${UPDATE_REPO}/releases/latest`;
      emitUpdate({ state: 'available', version: latest, manual: true, downloadUrl: macDownloadUrl });
    } else {
      emitUpdate({ state: 'none' });
    }
  } catch { /* offline — retry next interval */ }
}

function setupAutoUpdate() {
  if (!app.isPackaged) return;

  if (process.platform === 'darwin') {
    checkMacUpdate();
    setInterval(checkMacUpdate, 6 * 60 * 60 * 1000);
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available',    (info) => emitUpdate({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available',()     => emitUpdate({ state: 'none' }));
  autoUpdater.on('download-progress',   (p)    => emitUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded',   (info) => emitUpdate({ state: 'ready', version: info.version }));
  autoUpdater.on('error',               (err)  => emitUpdate({ state: 'error', message: String(err) }));

  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Folio PDF',
    backgroundColor: '#0a0a14',
    icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);
  if (process.platform === 'win32') win.setIcon(appIcon());

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.folio.pdf');
  createWindow();
  setupAutoUpdate();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win) createWindow(); });

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle(IPC.pickFiles, async (_, filters?: { name: string; extensions: string[] }[]) => {
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openFile', 'multiSelections'],
    filters: filters ?? [
      { name: 'Supported Files', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'bmp', 'tiff', 'doc', 'docx'] },
      { name: 'PDFs',   extensions: ['pdf'] },
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'webp'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.filePaths;
});

ipcMain.handle(IPC.pickFolder, async () => {
  const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
  return result.filePaths[0] ?? null;
});

ipcMain.handle(IPC.pickSave, async (_, opts: { defaultName?: string; defaultDir?: string; filters?: { name: string; extensions: string[] }[] } = {}) => {
  const result = await dialog.showSaveDialog(win!, {
    defaultPath: opts.defaultDir ? join(opts.defaultDir, opts.defaultName ?? 'output.pdf') : opts.defaultName,
    filters: opts.filters ?? [{ name: 'PDF Files', extensions: ['pdf'] }],
  });
  return result.filePath ?? null;
});

ipcMain.handle(IPC.defaultDir, () => {
  return app.getPath('documents');
});

ipcMain.handle(IPC.readFile, async (_, path: string) => {
  const buf = await readFile(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

ipcMain.handle(IPC.writeFile, async (_, path: string, data: Uint8Array) => {
  const dir = dirname(path);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(path, Buffer.from(data));
});

// PDF compress — renderer does the heavy lifting and sends back compressed bytes
ipcMain.handle(IPC.compress, async (_, req: { outputPath: string; data: number[]; originalBytes: number; startMs: number }) => {
  const { outputPath, data, originalBytes, startMs } = req;
  const bytes = data.length;
  await writeFile(outputPath, Buffer.from(data));
  return { outputPath, bytes, originalBytes, durationMs: Date.now() - startMs };
});

// PDF convert — renderer renders pages, sends image data, main saves files
ipcMain.handle(IPC.convert, async (_, req: { outputPaths: string[]; pages: number[][]; startMs: number; originalBytes: number }) => {
  const { outputPaths, pages, startMs, originalBytes } = req;
  for (let i = 0; i < pages.length; i++) {
    const dir = dirname(outputPaths[i]);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(outputPaths[i], Buffer.from(pages[i]));
  }
  const bytes = pages.reduce((s, p) => s + p.length, 0);
  return { outputPath: outputPaths[0], bytes, originalBytes, durationMs: Date.now() - startMs };
});

// OCR — renderer runs tesseract and sends text back, main writes the file
ipcMain.handle(IPC.ocr, async (_, req: { outputPath: string; content: number[] | string; isText: boolean; startMs: number; originalBytes: number }) => {
  const { outputPath, content, isText, startMs, originalBytes } = req;
  const dir = dirname(outputPath);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  if (isText) {
    await writeFile(outputPath, content as string, 'utf8');
  } else {
    await writeFile(outputPath, Buffer.from(content as number[]));
  }
  const stat = await import('node:fs/promises').then(m => m.stat(outputPath));
  return { outputPath, bytes: stat.size, originalBytes, durationMs: Date.now() - startMs };
});

ipcMain.handle(IPC.cancel, () => { /* renderer cancels its own jobs */ });

// History
ipcMain.handle(IPC.historyList, loadHistory);
ipcMain.handle(IPC.historyAdd, async (_, entry: Omit<HistoryEntry, 'id' | 'at'>) => {
  const h = await loadHistory();
  h.unshift({ ...entry, id: randomUUID(), at: new Date().toISOString() });
  await saveHistory(h.slice(0, 200));
});
ipcMain.handle(IPC.historyClear, async () => saveHistory([]));
ipcMain.handle(IPC.historyRemove, async (_, id: string) => {
  const h = await loadHistory();
  await saveHistory(h.filter(e => e.id !== id));
});

// Settings
ipcMain.handle(IPC.settingsGet, loadSettings);
ipcMain.handle(IPC.settingsSet, async (_, patch: Partial<AppSettings>) => {
  const s = await loadSettings();
  const next = { ...s, ...patch };
  await saveSettings(next);
  return next;
});

// OCR — runs tesseract.js in the main process.
// __dirname polyfill at top-of-file ensures tesseract worker scripts can resolve paths.
ipcMain.handle(IPC.ocrRecognize, async (_, data: ArrayBuffer, lang: string) => {
  const tmpPath = join(os.tmpdir(), `folio-ocr-${randomUUID()}.png`);
  await writeFile(tmpPath, Buffer.from(data));
  try {
    // Dynamic import keeps tesseract out of the startup critical path.
    // Using globalThis.__dirname polyfill instead of createRequire avoids CJS/ESM conflicts
    // that cause "ReferenceError: __dirname is not defined in ES module scope".
    const { createWorker } = (await import('tesseract.js')) as any;
    // Provide explicit workerPath — tesseract's default resolution walks too far up the tree
    // when running from dist-electron/, resolving to an incorrect sibling path.
    const workerPath = join(__dirname, '..', 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js');
    const worker = await createWorker(lang, 1, { workerPath });
    const { data: result } = await worker.recognize(tmpPath);
    await worker.terminate();
    return (result as any).text as string;
  } finally {
    writeFile(tmpPath, '').catch(() => {});
  }
});

// System stats
ipcMain.handle(IPC.sysStats, () => readStats());

// Shell
ipcMain.handle(IPC.showInFolder, (_, path: string) => shell.showItemInFolder(path));
ipcMain.handle(IPC.openPath,     (_, path: string) => shell.openPath(path));

// App
ipcMain.handle(IPC.appVersion, () => app.getVersion());
ipcMain.handle(IPC.win, (_, action: string) => {
  if (!win) return;
  if (action === 'minimize') win.minimize();
  if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  if (action === 'close')    win.close();
  if (action === 'devtools') win.webContents.toggleDevTools();
});

// Auto-update
ipcMain.handle(IPC.updateCheck, async () => {
  if (process.platform === 'darwin') return checkMacUpdate();
  try { await autoUpdater.checkForUpdates(); } catch { /* offline */ }
});
ipcMain.handle(IPC.updateDownload, async () => {
  if (process.platform === 'darwin') {
    await shell.openExternal(macDownloadUrl || `https://github.com/${UPDATE_REPO}/releases/latest`);
    return;
  }
  try { await autoUpdater.downloadUpdate(); }
  catch (err) { emitUpdate({ state: 'error', message: String(err) }); }
});
ipcMain.handle(IPC.updateInstall, async () => {
  if (process.platform === 'darwin') return;
  autoUpdater.quitAndInstall();
});
