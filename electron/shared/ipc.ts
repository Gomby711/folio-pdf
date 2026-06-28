export type CompressionPreset = 'screen' | 'email' | 'ebook' | 'print' | 'prepress';
export type ConvertFormat = 'jpg' | 'png' | 'txt' | 'pdf';
export type OCROutputFormat = 'pdf' | 'txt';
export type OCRLanguage = 'eng' | 'spa' | 'fra' | 'deu' | 'chi_sim';

export interface CompressRequest {
  jobId: string;
  inputPath: string;
  outputPath?: string;
  preset: CompressionPreset;
  /** JPEG quality 0–100 */
  quality: number;
  /** Render DPI for rasterisation */
  dpi: number;
  originalBytes: number;
}

export interface ConvertRequest {
  jobId: string;
  inputPath: string;
  outputDir?: string;
  targetFormat: ConvertFormat;
  /** image data pages from renderer — undefined when main handles conversion */
  pages?: string[]; // base64 JPEG/PNG data URLs
}

export interface OCRRequest {
  jobId: string;
  inputPath: string;
  outputDir?: string;
  language: OCRLanguage;
  outputFormat: OCROutputFormat;
}

export interface JobProgress {
  jobId: string;
  /** 0–1, or -1 when indeterminate */
  percent: number;
  stage: string;
}

export interface JobResult {
  outputPath: string;
  bytes: number;
  originalBytes: number;
  durationMs: number;
}

export interface HistoryEntry {
  id: string;
  name: string;
  tool: 'read' | 'convert' | 'compress' | 'scan' | 'resize'; // 'resize' kept for legacy history entries
  from: string;
  to: string;
  bytes: number;
  savings?: number;
  at: string;
  outputPath: string;
}

export type UpdateState = 'none' | 'available' | 'downloading' | 'ready' | 'error';
export interface UpdateStatus {
  state: UpdateState;
  version?: string;
  percent?: number;
  message?: string;
  /** macOS: no in-app install, open browser download page instead */
  manual?: boolean;
  downloadUrl?: string;
}

export interface AppSettings {
  defaultOutputPath: string;
  autoOpenAfter: boolean;
  overwriteExisting: boolean;
  openPreviewPrompt: boolean;
}

export interface SystemStats {
  cpu: number;
  memUsed: number;
  memTotal: number;
  cpuModel: string;
  cores: number;
  platform: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultOutputPath: '',
  autoOpenAfter: false,
  overwriteExisting: true,
  openPreviewPrompt: true,
};

export const IPC = {
  pickFiles:    'dialog:pickFiles',
  sysStats:     'system:stats',
  pickFolder:   'dialog:pickFolder',
  pickSave:     'dialog:pickSave',
  readFile:     'fs:readFile',
  writeFile:    'fs:writeFile',
  defaultDir:   'app:defaultDir',
  compress:     'pdf:compress',
  convert:      'pdf:convert',
  ocr:          'pdf:ocr',
  cancel:       'job:cancel',
  onProgress:   'job:progress',
  historyList:   'history:list',
  historyAdd:    'history:add',
  historyClear:  'history:clear',
  historyRemove: 'history:remove',
  ocrRecognize:  'ocr:recognize',
  settingsGet:  'settings:get',
  settingsSet:  'settings:set',
  showInFolder: 'shell:showInFolder',
  openPath:     'shell:openPath',
  appVersion:   'app:version',
  win:          'window:control',
  updateCheck:   'update:check',
  updateDownload:'update:download',
  updateInstall: 'update:install',
  onUpdate:      'update:status',
} as const;

export type WinAction = 'minimize' | 'maximize' | 'close' | 'devtools';

export interface FolioApi {
  pickFiles(filters?: { name: string; extensions: string[] }[]): Promise<string[]>;
  pickFolder(): Promise<string | null>;
  pickSavePath(opts?: { defaultName?: string; defaultDir?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
  getPathForFile(file: File): string;
  defaultOutputDir(): Promise<string>;
  readFile(path: string): Promise<ArrayBuffer>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  compress(req: CompressRequest): Promise<JobResult>;
  convert(req: ConvertRequest): Promise<JobResult>;
  ocr(req: OCRRequest): Promise<JobResult>;
  cancel(jobId: string): Promise<void>;
  onProgress(cb: (p: JobProgress) => void): () => void;
  historyList(): Promise<HistoryEntry[]>;
  historyAdd(entry: Omit<HistoryEntry, 'id' | 'at'>): Promise<void>;
  historyClear(): Promise<void>;
  historyRemove(id: string): Promise<void>;
  ocrRecognize(data: ArrayBuffer, lang: string): Promise<string>;
  settingsGet(): Promise<AppSettings>;
  settingsSet(patch: Partial<AppSettings>): Promise<AppSettings>;
  showInFolder(path: string): Promise<void>;
  openPath(path: string): Promise<void>;
  appVersion(): Promise<string>;
  win(action: WinAction): Promise<void>;
  systemStats(): Promise<SystemStats>;
  updateCheck(): Promise<void>;
  updateDownload(): Promise<void>;
  updateInstall(): Promise<void>;
  onUpdate(cb: (s: UpdateStatus) => void): () => void;
}
