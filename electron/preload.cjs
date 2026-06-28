"use strict";
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const IPC = {
  sysStats:     "system:stats",
  pickFiles:    "dialog:pickFiles",
  pickFolder:   "dialog:pickFolder",
  pickSave:     "dialog:pickSave",
  readFile:     "fs:readFile",
  writeFile:    "fs:writeFile",
  defaultDir:   "app:defaultDir",
  compress:     "pdf:compress",
  convert:      "pdf:convert",
  ocr:          "pdf:ocr",
  cancel:       "job:cancel",
  onProgress:   "job:progress",
  historyList:   "history:list",
  historyAdd:    "history:add",
  historyClear:  "history:clear",
  historyRemove: "history:remove",
  ocrRecognize:  "ocr:recognize",
  settingsGet:  "settings:get",
  settingsSet:  "settings:set",
  showInFolder: "shell:showInFolder",
  openPath:     "shell:openPath",
  appVersion:   "app:version",
  win:          "window:control",
  updateCheck:   "update:check",
  updateDownload:"update:download",
  updateInstall: "update:install",
  onUpdate:      "update:status",
};

const api = {
  pickFiles:       (filters)   => ipcRenderer.invoke(IPC.pickFiles, filters),
  pickFolder:      ()          => ipcRenderer.invoke(IPC.pickFolder),
  pickSavePath:    (opts)      => ipcRenderer.invoke(IPC.pickSave, opts),
  getPathForFile:  (file)      => webUtils.getPathForFile(file),
  defaultOutputDir:()          => ipcRenderer.invoke(IPC.defaultDir),
  readFile:        (path)      => ipcRenderer.invoke(IPC.readFile, path),
  writeFile:       (path, d)   => ipcRenderer.invoke(IPC.writeFile, path, d),
  compress:        (req)       => ipcRenderer.invoke(IPC.compress, req),
  convert:         (req)       => ipcRenderer.invoke(IPC.convert, req),
  ocr:             (req)       => ipcRenderer.invoke(IPC.ocr, req),
  cancel:          (id)        => ipcRenderer.invoke(IPC.cancel, id),

  onProgress(cb) {
    const listener = (_, p) => cb(p);
    ipcRenderer.on(IPC.onProgress, listener);
    return () => ipcRenderer.off(IPC.onProgress, listener);
  },

  historyList:    ()          => ipcRenderer.invoke(IPC.historyList),
  historyAdd:     (e)         => ipcRenderer.invoke(IPC.historyAdd, e),
  historyClear:   ()          => ipcRenderer.invoke(IPC.historyClear),
  historyRemove:  (id)        => ipcRenderer.invoke(IPC.historyRemove, id),
  ocrRecognize:   (data, lang)=> ipcRenderer.invoke(IPC.ocrRecognize, data, lang),
  settingsGet:    ()     => ipcRenderer.invoke(IPC.settingsGet),
  settingsSet:    (p)    => ipcRenderer.invoke(IPC.settingsSet, p),
  showInFolder:   (path) => ipcRenderer.invoke(IPC.showInFolder, path),
  openPath:       (path) => ipcRenderer.invoke(IPC.openPath, path),
  appVersion:     ()     => ipcRenderer.invoke(IPC.appVersion),
  win:            (a)    => ipcRenderer.invoke(IPC.win, a),
  systemStats:    ()     => ipcRenderer.invoke(IPC.sysStats),

  updateCheck:    ()     => ipcRenderer.invoke(IPC.updateCheck),
  updateDownload: ()     => ipcRenderer.invoke(IPC.updateDownload),
  updateInstall:  ()     => ipcRenderer.invoke(IPC.updateInstall),
  onUpdate(cb) {
    const listener = (_, s) => cb(s);
    ipcRenderer.on(IPC.onUpdate, listener);
    return () => ipcRenderer.off(IPC.onUpdate, listener);
  },
};

contextBridge.exposeInMainWorld("api", api);
