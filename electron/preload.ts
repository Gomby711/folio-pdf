import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from './shared/ipc.js';
import type { FolioApi, JobProgress, AppSettings, CompressRequest, ConvertRequest, OCRRequest, WinAction, UpdateStatus } from './shared/ipc.js';

const api: FolioApi = {
  pickFiles:       (filters) => ipcRenderer.invoke(IPC.pickFiles, filters),
  pickFolder:      ()         => ipcRenderer.invoke(IPC.pickFolder),
  pickSavePath:    (opts)     => ipcRenderer.invoke(IPC.pickSave, opts),
  getPathForFile:  (file)     => webUtils.getPathForFile(file),
  defaultOutputDir:()         => ipcRenderer.invoke(IPC.defaultDir),
  readFile:        (path)     => ipcRenderer.invoke(IPC.readFile, path),
  writeFile:       (path, d)  => ipcRenderer.invoke(IPC.writeFile, path, d),

  compress: (req: CompressRequest) => ipcRenderer.invoke(IPC.compress, req),
  convert:  (req: ConvertRequest)  => ipcRenderer.invoke(IPC.convert, req),
  ocr:      (req: OCRRequest)      => ipcRenderer.invoke(IPC.ocr, req),
  cancel:   (id)                   => ipcRenderer.invoke(IPC.cancel, id),

  onProgress(cb: (p: JobProgress) => void) {
    const listener = (_: unknown, p: JobProgress) => cb(p);
    ipcRenderer.on(IPC.onProgress, listener);
    return () => ipcRenderer.off(IPC.onProgress, listener);
  },

  historyList:   ()              => ipcRenderer.invoke(IPC.historyList),
  historyAdd:    (e)             => ipcRenderer.invoke(IPC.historyAdd, e),
  historyClear:  ()              => ipcRenderer.invoke(IPC.historyClear),
  historyRemove: (id)            => ipcRenderer.invoke(IPC.historyRemove, id),
  ocrRecognize:  (data, lang)    => ipcRenderer.invoke(IPC.ocrRecognize, data, lang),

  settingsGet: ()            => ipcRenderer.invoke(IPC.settingsGet),
  settingsSet: (p: Partial<AppSettings>) => ipcRenderer.invoke(IPC.settingsSet, p),

  showInFolder: (path)  => ipcRenderer.invoke(IPC.showInFolder, path),
  openPath:     (path)  => ipcRenderer.invoke(IPC.openPath, path),
  appVersion:   ()      => ipcRenderer.invoke(IPC.appVersion),
  win:          (a: WinAction) => ipcRenderer.invoke(IPC.win, a),
  systemStats:  ()             => ipcRenderer.invoke(IPC.sysStats),

  updateCheck:   () => ipcRenderer.invoke(IPC.updateCheck),
  updateDownload:() => ipcRenderer.invoke(IPC.updateDownload),
  updateInstall: () => ipcRenderer.invoke(IPC.updateInstall),
  onUpdate(cb: (s: UpdateStatus) => void) {
    const listener = (_: unknown, s: UpdateStatus) => cb(s);
    ipcRenderer.on(IPC.onUpdate, listener);
    return () => ipcRenderer.off(IPC.onUpdate, listener);
  },
};

contextBridge.exposeInMainWorld('api', api);
