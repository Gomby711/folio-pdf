import { useState, useCallback, useRef, useEffect } from 'react';
import {
  FileText, BookOpen, RefreshCw, Minimize2, ScanLine,
  FolderOpen, Clock, Settings, Menu,
  Upload, X, CheckCircle, Eye, ArrowRight,
  TrendingDown, Zap, RotateCcw, Plus,
  Trash2, ExternalLink, Cpu, MemoryStick, Download,
} from 'lucide-react';
import { api, fmtBytes, pathBasename, pathDir, stripExt } from './lib/api';
import {
  COMPRESSION_PRESETS,
  compressPDF, pdfToImages, pdfToText, imagesToPDF,
  pdfToDocx, pdfToXlsx, convertImage, textToPDF,
  type CompressionPreset,
} from './lib/pdf';
import { PDFViewer } from './components/PDFViewer';
import { FormatPicker, ALL_FORMATS, SUPPORTED_OUTPUTS, guessInputFormat, type ConvertFormat } from './components/FormatPicker';
import type { AppSettings, HistoryEntry, SystemStats, UpdateStatus } from '../../electron/shared/ipc';

// ── Types ──────────────────────────────────────────────────────────────────────

type ToolId = 'read' | 'convert' | 'compress' | 'scan';
type PageId = 'tools' | 'settings' | 'history' | 'files';
type JobStatus = 'idle' | 'processing' | 'done' | 'error';

interface QueuedFile {
  id: string; name: string; path: string;
  data?: ArrayBuffer; size: number;
  status: JobStatus; progress: number;
  error?: string; outputPath?: string; outputSize?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TOOLS: { id: ToolId; label: string; icon: React.ReactNode; desc: string; color: string }[] = [
  { id: 'read',    label: 'Read PDF',   icon: <BookOpen size={16} />,  desc: 'View and annotate PDFs',       color: '#4F6EF7' },
  { id: 'convert', label: 'Convert',    icon: <RefreshCw size={16} />, desc: 'Change file formats instantly', color: '#22C55E' },
  { id: 'compress',label: 'Compress',   icon: <Minimize2 size={16} />, desc: 'Reduce file size fast',         color: '#F59E0B' },
  { id: 'scan',    label: 'Scan & OCR', icon: <ScanLine size={16} />,  desc: 'Digitize your documents',       color: '#EC4899' },
];

const STAT_DEFS = [
  { label: 'Files Processed', icon: <FileText size={14} />,  color: '#4F6EF7', key: 'total'       as const, fmt: (n: number) => String(n)    },
  { label: 'Space Saved',     icon: <Zap size={14} />,       color: '#22C55E', key: 'spaceSaved'  as const, fmt: (n: number) => fmtBytes(n)  },
  { label: 'Conversions',     icon: <RefreshCw size={14} />, color: '#F59E0B', key: 'conversions' as const, fmt: (n: number) => String(n)    },
  { label: 'Scans Done',      icon: <ScanLine size={14} />,  color: '#EC4899', key: 'scans'       as const, fmt: (n: number) => String(n)    },
];

const OCR_LANGS = [
  { value: 'eng', label: 'English' },
  { value: 'spa', label: 'Spanish' },
  { value: 'fra', label: 'French'  },
  { value: 'deu', label: 'German'  },
];


// ── Style helpers ──────────────────────────────────────────────────────────────

const mono: React.CSSProperties   = { fontFamily: "'DM Mono', 'JetBrains Mono', monospace" };
const outfit: React.CSSProperties = { fontFamily: "'Outfit', sans-serif" };
const label11: React.CSSProperties = { ...mono, fontSize: 10, fontWeight: 600, color: '#888aaa', textTransform: 'uppercase', letterSpacing: '0.1em' };

function fileExt(name: string) { return name.split('.').pop()?.toUpperCase() ?? 'FILE'; }

// ── Shared components ──────────────────────────────────────────────────────────

function Toggle({ on, color, onChange }: { on: boolean; color: string; onChange: () => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={onChange}
      className="w-9 h-5 rounded-full relative shrink-0 transition-colors duration-200"
      style={{ backgroundColor: on ? color : 'rgba(40,40,60,0.8)' }}>
      <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200"
        style={{ transform: on ? 'translateX(16px)' : 'translateX(0)' }} />
    </button>
  );
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="flex-1 max-w-32 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
      <div className="h-full rounded-full transition-all duration-300"
        style={{ width: `${Math.min(100, percent)}%`, background: color, boxShadow: `0 0 4px ${color}` }} />
    </div>
  );
}

function DropZone({ color, accept, hint, onDrop, onClick }: {
  color: string; accept: string; hint: string;
  onDrop: (files: File[]) => void; onClick: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragging(false); const f = Array.from(e.dataTransfer.files); if (f.length) onDrop(f); }}
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
      onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
      onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
      onClick={onClick}
      className="neon relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-200"
      style={{ borderColor: dragging ? color : 'rgba(79,110,247,0.25)', backgroundColor: dragging ? `${color}12` : 'rgba(10,10,20,0.3)', transform: dragging ? 'scale(1.008)' : 'scale(1)' }}>
      <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: `${color}20`, color }}>
        <Upload size={26} />
      </div>
      <p className="font-semibold text-sm mb-1" style={outfit}>{dragging ? 'Release to upload' : 'Drop files or click to browse'}</p>
      <p className="text-xs" style={{ color: '#888aaa' }}>{hint}</p>
      <div className="mt-4 flex items-center justify-center gap-1.5 flex-wrap">
        {accept.split(',').map(ext => (
          <span key={ext} className="px-2 py-0.5 rounded text-xs border" style={{ ...mono, borderColor: 'rgba(79,110,247,0.2)', color: '#888aaa' }}>
            {ext.trim()}
          </span>
        ))}
      </div>
    </div>
  );
}

function FileQueue({ files, color, onRemove, onProcess, onClear, onReveal }: {
  files: QueuedFile[]; color: string;
  onRemove: (id: string) => void; onProcess: (id: string) => void;
  onClear: () => void; onReveal: (path: string) => void;
}) {
  if (!files.length) return null;
  const queued = files.filter(f => f.status === 'idle').length;
  const done   = files.filter(f => f.status === 'done').length;
  return (
    <div className="neon rounded-xl overflow-hidden" style={{ background: 'rgba(10,10,22,0.7)' }}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: 'rgba(79,110,247,0.12)' }}>
        <span className="text-sm font-medium" style={{ color: '#c8cadf' }}>{files.length} file{files.length !== 1 ? 's' : ''} · {done} done</span>
        <div className="flex gap-2">
          <button onClick={onClear} className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-all"
            style={{ color: '#888aaa', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <RotateCcw size={11} /> Clear
          </button>
          {queued > 0 && (
            <button onClick={() => files.filter(f => f.status === 'idle').forEach(f => onProcess(f.id))}
              className="neon-btn px-3 py-1 rounded text-xs font-semibold text-white"
              style={{ background: `linear-gradient(110deg, ${color}80, ${color}aa)` }}>
              Process all ({queued})
            </button>
          )}
        </div>
      </div>
      <div className="divide-y" style={{ borderColor: 'rgba(79,110,247,0.08)' }}>
        {files.map(f => (
          <div key={f.id} className="flex items-center gap-3 px-4 py-2.5 group hover:bg-[rgba(79,110,247,0.04)] transition-colors">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold shrink-0"
              style={{ ...mono, backgroundColor: `${color}18`, color, fontSize: 9 }}>
              {fileExt(f.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: '#d0d2e8' }}>{f.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span style={{ ...mono, fontSize: 10, color: '#888aaa' }}>{fmtBytes(f.size)}</span>
                {f.status === 'processing' && <><ProgressBar percent={f.progress} color={color} /><span style={{ ...mono, fontSize: 10, color: '#888aaa' }}>{Math.round(f.progress)}%</span></>}
                {f.status === 'done' && f.outputSize !== undefined && (
                  <span className="flex items-center gap-1" style={{ fontSize: 11, color: '#22C55E' }}>
                    <CheckCircle size={10} /> {fmtBytes(f.outputSize)}
                    {f.outputSize < f.size && <span style={{ ...mono, fontSize: 10, color: '#22C55E', marginLeft: 3 }}>-{Math.round((1 - f.outputSize / f.size) * 100)}%</span>}
                  </span>
                )}
                {f.status === 'error' && <span className="text-xs" style={{ color: '#e05252' }}>{f.error ?? 'Failed'}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {f.status === 'done' && f.outputPath && (
                <button onClick={() => onReveal(f.outputPath!)} className="p-1.5 rounded hover:bg-[rgba(255,255,255,0.06)]" style={{ color: '#4F6EF7' }} title="Show in folder">
                  <FolderOpen size={13} />
                </button>
              )}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                {f.status === 'idle' && <button onClick={() => onProcess(f.id)} className="p-1.5 rounded hover:bg-[rgba(255,255,255,0.06)]" style={{ color: '#888aaa' }}><ArrowRight size={13} /></button>}
                <button onClick={() => onRemove(f.id)} className="p-1.5 rounded hover:bg-[rgba(255,255,255,0.06)]" style={{ color: '#888aaa' }}><X size={13} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const actionColors: Record<string, { fg: string; bg: string }> = {
  compress: { fg: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  convert:  { fg: '#22C55E', bg: 'rgba(34,197,94,0.12)'  },
  read:     { fg: '#4F6EF7', bg: 'rgba(79,110,247,0.12)' },
  scan:     { fg: '#EC4899', bg: 'rgba(236,72,153,0.12)' },
  resize:   { fg: '#A855F7', bg: 'rgba(168,85,247,0.12)' },
};
const actionLabel: Record<string, string> = {
  compress: 'Compressed', convert: 'Converted', read: 'Read', scan: 'Scanned', resize: 'Resized',
};

function fmtDate(at: string): string {
  const d = new Date(at);
  if (isNaN(d.getTime())) return at;
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 86400 && d.getDate() === now.getDate())
    return `Today, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (diff < 172800) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function RecentFiles({ onOpen, toolFilter }: { onOpen?: (path: string, name: string) => void; toolFilter?: string }) {
  const [entries, setEntries] = useState<any[]>([]);
  useEffect(() => {
    api?.historyList()
      .then(list => setEntries((list ?? []).filter(e => !toolFilter || e.tool === toolFilter).slice(0, 20)))
      .catch(() => {});
  }, [toolFilter]);

  if (!entries.length) return (
    <div className="neon rounded-xl p-6 text-center" style={{ background: 'rgba(10,10,22,0.7)' }}>
      <Clock size={22} className="mx-auto mb-2" style={{ color: '#888aaa' }} />
      <p className="text-sm" style={{ color: '#888aaa' }}>No recent files yet.</p>
    </div>
  );

  return (
    <div className="neon rounded-xl overflow-hidden" style={{ background: 'rgba(10,10,22,0.7)' }}>
      <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: 'rgba(79,110,247,0.12)' }}>
        <div className="flex items-center gap-2">
          <Clock size={14} style={{ color: '#888aaa' }} />
          <span className="text-sm font-semibold" style={outfit}>Recent Files</span>
        </div>
        <span style={{ ...mono, fontSize: 10, color: '#888aaa' }}>{entries.length} entries</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b" style={{ borderColor: 'rgba(79,110,247,0.08)' }}>
              {['File', 'Type', 'Size', 'Date', 'Action', ''].map(col => (
                <th key={col} className="px-5 py-2 text-left" style={label11}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => {
              const ext = entry.name.split('.').pop()?.toUpperCase() ?? 'FILE';
              const ac  = actionColors[entry.tool] ?? actionColors.read;
              return (
                <tr key={i} className="border-b last:border-0 hover:bg-[rgba(79,110,247,0.03)] transition-colors group" style={{ borderColor: 'rgba(79,110,247,0.06)' }}>
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center font-bold shrink-0"
                        style={{ ...mono, backgroundColor: '#4F6EF718', color: '#4F6EF7', fontSize: 9 }}>{ext}</div>
                      <span className="text-sm font-medium truncate max-w-[180px]" style={{ color: '#c8cadf' }}>{entry.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-xs" style={{ ...mono, color: '#888aaa' }}>{ext}</td>
                  <td className="px-5 py-2.5 text-xs" style={{ ...mono, color: '#888aaa' }}>{fmtBytes(entry.bytes)}</td>
                  <td className="px-5 py-2.5 text-xs" style={{ color: '#888aaa' }}>{fmtDate(entry.at)}</td>
                  <td className="px-5 py-2.5">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                      style={{ ...mono, color: ac.fg, background: ac.bg }}>{actionLabel[entry.tool] ?? entry.tool}</span>
                  </td>
                  <td className="px-5 py-2.5">
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                      {entry.outputPath && onOpen && (
                        <button onClick={() => onOpen(entry.outputPath, entry.name)}
                          className="p-1.5 rounded hover:bg-[rgba(255,255,255,0.06)]" style={{ color: '#888aaa' }} title="Open">
                          <Eye size={12} />
                        </button>
                      )}
                      {entry.outputPath && (
                        <button onClick={() => api?.showInFolder(entry.outputPath)}
                          className="p-1.5 rounded hover:bg-[rgba(255,255,255,0.06)]" style={{ color: '#888aaa' }} title="Reveal">
                          <FolderOpen size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [activePage, setActivePage]   = useState<PageId>('tools');
  const [activeTool, setActiveTool]   = useState<ToolId>('read');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [files, setFiles]             = useState<QueuedFile[]>([]);
  const [outputDir, setOutputDir]     = useState('');
  const [defaultDir, setDefaultDir]   = useState('');
  const [saveAsPath, setSaveAsPath]   = useState<string | null>(null);
  const [appVer, setAppVer]           = useState('0.1.0');
  const [stats, setStats]             = useState<SystemStats | null>(null);
  const userPickedDir = useRef(false);

  const [settings, setSettings] = useState<AppSettings>({ defaultOutputPath: '', autoOpenAfter: false, overwriteExisting: true, openPreviewPrompt: true });
  const [compressPreset, setCompressPreset] = useState<CompressionPreset>(COMPRESSION_PRESETS[1]);
  const [convertTo,  setConvertTo]  = useState<ConvertFormat | null>(null);
  const [darkReader, setDarkReader] = useState(false);
  const [highlight,  setHighlight]  = useState(true);
  const [bookmarks,  setBookmarks]  = useState(true);
  const [ocrLang,    setOcrLang]    = useState('eng');
  const [ocrFormat,  setOcrFormat]  = useState<'txt' | 'pdf'>('pdf');
  const [ocrDpi,     setOcrDpi]     = useState('150');

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);

  const [viewerFile, setViewerFile] = useState<{ data: ArrayBuffer; name: string; path: string } | null>(null);
  const [historyStats, setHistoryStats] = useState({ total: 0, spaceSaved: 0, conversions: 0, scans: 0 });
  const [recentKey, setRecentKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tool = TOOLS.find(t => t.id === activeTool)!;

  // Responsive zoom — same pattern as Proxima Studio
  useEffect(() => {
    const BASE_W = 1280, BASE_H = 800;
    const apply = () => {
      const ratio = Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H);
      const zoom  = Math.max(0.7, Math.min(1.6, ratio));
      (document.documentElement.style as any).zoom = String(zoom);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  // Live hardware stats — poll every 2s
  useEffect(() => {
    if (!api) return;
    let alive = true;
    const tick = async () => {
      try { const s = await (api as any).systemStats(); if (alive) setStats(s); } catch {}
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const refreshStats = (entries: HistoryEntry[]) => {
    setHistoryStats({
      total:       entries.length,
      spaceSaved:  entries.reduce((s, e) => s + (e.savings && e.bytes ? Math.round(e.bytes / (1 - e.savings / 100)) - e.bytes : 0), 0),
      conversions: entries.filter(e => e.tool === 'convert').length,
      scans:       entries.filter(e => e.tool === 'scan').length,
    });
  };

  const historyAddAndRefresh = async (entry: Parameters<NonNullable<typeof api>['historyAdd']>[0]) => {
    await api?.historyAdd(entry).catch(() => {});
    api?.historyList().then(list => { refreshStats(list ?? []); setRecentKey(k => k + 1); }).catch(() => {});
  };

  useEffect(() => {
    api?.appVersion().then(setAppVer).catch(() => {});
    api?.defaultOutputDir().then(d => { setDefaultDir(d); if (!userPickedDir.current) setOutputDir(d); }).catch(() => {});
    api?.settingsGet().then(s => { setSettings(s); if (s.defaultOutputPath && !userPickedDir.current) setOutputDir(s.defaultOutputPath); }).catch(() => {});
    api?.historyList().then(list => refreshStats(list ?? [])).catch(() => {});
    const unsub = api?.onUpdate(setUpdateStatus);
    return () => unsub?.();
  }, []);

  // ── File management ────────────────────────────────────────────────────────

  const openInViewer = useCallback(async (path: string, name: string, preloaded?: ArrayBuffer) => {
    const data: ArrayBuffer | null = preloaded ?? (api ? await api.readFile(path).catch(() => null) : null);
    if (data) setViewerFile({ data, name, path });
  }, []);

  const addFiles = useCallback((incoming: File[]) => {
    if (!incoming.length) return;
    Promise.all(incoming.map(async f => {
      const data = await f.arrayBuffer().catch(() => null);
      const path = (api?.getPathForFile(f)) || (f as any).path || f.name;
      return { f, data, path };
    })).then(results => {
      const next: QueuedFile[] = results.filter(r => r.data !== null).map(({ f, data, path }) => ({
        id: Math.random().toString(36).slice(2), name: f.name, path, data: data!, size: f.size,
        status: 'idle' as const, progress: 0,
      }));
      if (!next.length) return;
      setFiles(prev => [...prev, ...next]);
      if (activeTool === 'read') {
        const first = next[0];
        setViewerFile({ data: first.data!, name: first.name, path: first.path });
      }
    });
  }, [activeTool]);

  const addPaths = useCallback(async (paths: string[]) => {
    if (!api) return;
    const next: QueuedFile[] = [];
    let firstData: ArrayBuffer | null = null, firstName = '';
    for (const p of paths) {
      const data = await api.readFile(p).catch(() => null);
      next.push({ id: Math.random().toString(36).slice(2), name: pathBasename(p), path: p, data: data ?? undefined, size: data ? data.byteLength : 0, status: 'idle', progress: 0 });
      if (!firstData && data) { firstData = data; firstName = pathBasename(p); }
    }
    setFiles(prev => [...prev, ...next]);
    if (activeTool === 'read' && firstData) setViewerFile({ data: firstData, name: firstName, path: paths[0] });
  }, [activeTool]);

  const removeFile  = (id: string) => setFiles(p => p.filter(f => f.id !== id));
  const clearFiles  = () => setFiles([]);
  const revealFile  = (path: string) => api?.showInFolder(path);
  const updateFile  = (id: string, patch: Partial<QueuedFile>) => setFiles(p => p.map(f => f.id === id ? { ...f, ...patch } : f));
  const loadFileData = async (file: QueuedFile): Promise<ArrayBuffer> => {
    if (file.data) return file.data;
    if (!api) throw new Error('No API and no cached data');
    return api.readFile(file.path);
  };

  const effectiveDir = (filePath: string) =>
    outputDir || (filePath.includes('\\') || filePath.includes('/') ? pathDir(filePath) : defaultDir);

  // ── Processing ────────────────────────────────────────────────────────────

  const processCompress = async (file: QueuedFile) => {
    if (!api) { updateFile(file.id, { status: 'error', error: 'Electron API unavailable' }); return; }
    updateFile(file.id, { status: 'processing', progress: 0 });
    try {
      const data = await loadFileData(file);
      let outPath: string;
      if (saveAsPath && files.length === 1) {
        outPath = saveAsPath;
      } else {
        const dir = effectiveDir(file.path);
        if (dir) {
          outPath = `${dir}\\${stripExt(file.name)}_${compressPreset.id}.pdf`;
        } else {
          const picked = await api.pickSavePath({ defaultName: `${stripExt(file.name)}_${compressPreset.id}.pdf`, filters: [{ name: 'PDF Files', extensions: ['pdf'] }] });
          if (!picked) { updateFile(file.id, { status: 'idle', progress: 0 }); return; }
          outPath = picked;
        }
      }
      const compressed = await compressPDF(data, { preset: compressPreset, onProgress: (cur, total) => updateFile(file.id, { progress: (cur / total) * 100 }) });
      await api.writeFile(outPath, compressed);
      updateFile(file.id, { status: 'done', progress: 100, outputPath: outPath, outputSize: compressed.length });
      historyAddAndRefresh({ name: file.name, tool: 'compress', from: 'pdf', to: 'pdf', bytes: compressed.length, savings: Math.round((1 - compressed.length / file.size) * 100), outputPath: outPath }).catch(() => {});
    } catch (err) { updateFile(file.id, { status: 'error', error: String(err) }); }
  };

  const processConvert = async (file: QueuedFile) => {
    if (!api) { updateFile(file.id, { status: 'error', error: 'Electron API unavailable' }); return; }
    if (!convertTo) { updateFile(file.id, { status: 'error', error: 'Select an output format first' }); return; }
    updateFile(file.id, { status: 'processing', progress: 0 });
    try {
      const data   = await loadFileData(file);
      let dir = effectiveDir(file.path);
      if (!dir) {
        const picked = await api.pickFolder();
        if (!picked) { updateFile(file.id, { status: 'idle', progress: 0 }); return; }
        dir = picked; setOutputDir(picked); userPickedDir.current = true;
      }
      const stem    = stripExt(file.name);
      const inExt   = (file.name.split('.').pop() ?? '').toLowerCase();
      const to      = convertTo.id;
      const outPath = (saveAsPath && files.length === 1) ? saveAsPath : `${dir}\\${stem}.${convertTo.ext}`;
      const prog    = (cur: number, total: number) => updateFile(file.id, { progress: (cur / total) * 90 });

      let outBytes: Uint8Array;
      if (to === 'txt' && inExt === 'pdf') {
        outBytes = new TextEncoder().encode(await pdfToText(data, prog));
      } else if (to === 'docx' && inExt === 'pdf') {
        outBytes = await pdfToDocx(data, prog);
      } else if (to === 'xlsx' && inExt === 'pdf') {
        outBytes = await pdfToXlsx(data, prog);
      } else if (to === 'pdf' && inExt === 'txt') {
        outBytes = await textToPDF(data, prog);
      } else if (to === 'pdf' && ['jpg','jpeg','png','webp','bmp','tiff'].includes(inExt)) {
        outBytes = await imagesToPDF([{ data, name: file.name }], prog);
      } else if (['jpg','png','webp'].includes(to) && inExt === 'pdf') {
        const pages = await pdfToImages(data, to as 'jpg' | 'png', 150, prog);
        if (pages.length === 1) {
          outBytes = pages[0].data;
        } else {
          let firstPath = '';
          for (let i = 0; i < pages.length; i++) {
            const p = `${dir}\\${stem}_p${i + 1}.${to}`;
            await api.writeFile(p, pages[i].data);
            if (i === 0) firstPath = p;
          }
          const totalBytes = pages.reduce((s, p) => s + p.data.length, 0);
          updateFile(file.id, { status: 'done', progress: 100, outputPath: firstPath, outputSize: totalBytes });
          historyAddAndRefresh({ name: file.name, tool: 'convert', from: inExt, to, bytes: totalBytes, outputPath: firstPath }).catch(() => {});
          return;
        }
      } else if (['jpg','png','webp','tiff','bmp'].includes(to) && ['jpg','jpeg','png','webp','tiff','bmp'].includes(inExt)) {
        outBytes = await convertImage(data, to as any);
      } else {
        updateFile(file.id, { status: 'error', error: `Conversion ${inExt.toUpperCase()} to ${to.toUpperCase()} is not supported` });
        return;
      }

      await api.writeFile(outPath, outBytes);
      updateFile(file.id, { status: 'done', progress: 100, outputPath: outPath, outputSize: outBytes.length });
      historyAddAndRefresh({ name: file.name, tool: 'convert', from: inExt, to, bytes: outBytes.length, outputPath: outPath }).catch(() => {});
    } catch (err) { updateFile(file.id, { status: 'error', error: String(err) }); }
  };

  const processScan = async (file: QueuedFile) => {
    if (!api) { updateFile(file.id, { status: 'error', error: 'Electron API unavailable' }); return; }
    updateFile(file.id, { status: 'processing', progress: 5 });
    try {
      const data = await loadFileData(file);

      let dir = effectiveDir(file.path);
      if (!dir) {
        const picked = await api.pickFolder();
        if (!picked) { updateFile(file.id, { status: 'idle', progress: 0 }); return; }
        dir = picked; setOutputDir(picked); userPickedDir.current = true;
      }
      const stem = stripExt(file.name);

      if (ocrFormat === 'txt') {
        // OCR: extract text from the image and save as .txt
        updateFile(file.id, { progress: 20 });
        const ocrText = await api.ocrRecognize(data, ocrLang);
        updateFile(file.id, { progress: 85 });
        const outPath = (saveAsPath && files.length === 1) ? saveAsPath : `${dir}\\${stem}_ocr.txt`;
        const encoded = new TextEncoder().encode(ocrText);
        await api.writeFile(outPath, encoded);
        updateFile(file.id, { status: 'done', progress: 100, outputPath: outPath, outputSize: encoded.length });
        historyAddAndRefresh({ name: file.name, tool: 'scan', from: file.name.split('.').pop() ?? 'img', to: 'txt', bytes: encoded.length, outputPath: outPath }).catch(() => {});
      } else {
        // PDF: embed the image directly as a full-page PDF — no OCR, shows the actual image
        updateFile(file.id, { progress: 40 });
        const pdfBytes = await imagesToPDF([{ data, name: file.name }]);
        updateFile(file.id, { progress: 90 });
        const outPath = (saveAsPath && files.length === 1) ? saveAsPath : `${dir}\\${stem}_scan.pdf`;
        await api.writeFile(outPath, pdfBytes);
        updateFile(file.id, { status: 'done', progress: 100, outputPath: outPath, outputSize: pdfBytes.length });
        historyAddAndRefresh({ name: file.name, tool: 'scan', from: file.name.split('.').pop() ?? 'img', to: 'pdf', bytes: pdfBytes.length, outputPath: outPath }).catch(() => {});
      }
    } catch (err) { updateFile(file.id, { status: 'error', error: String(err) }); }
  };

  const processRead = async (file: QueuedFile) => {
    updateFile(file.id, { status: 'processing', progress: 20 });
    try {
      const data = await loadFileData(file);
      updateFile(file.id, { status: 'done', progress: 100 });
      setViewerFile({ data, name: file.name, path: file.path });
      historyAddAndRefresh({ name: file.name, tool: 'read', from: 'pdf', to: 'pdf', bytes: data.byteLength, outputPath: file.path }).catch(() => {});
    } catch (err) { updateFile(file.id, { status: 'error', error: String(err) }); }
  };

  const processFile = (id: string) => {
    const file = files.find(f => f.id === id);
    if (!file || file.status === 'processing') return;
    if (activeTool === 'compress') processCompress(file);
    else if (activeTool === 'convert') processConvert(file);
    else if (activeTool === 'scan')   processScan(file);
    else processRead(file);
  };

  const pickFiles = async () => {
    if (!api) { fileInputRef.current?.click(); return; }
    const filters = activeTool === 'scan'
      ? [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'webp'] }]
      : [{ name: 'PDFs', extensions: ['pdf'] }, { name: 'All', extensions: ['*'] }];
    const paths = await api.pickFiles(filters);
    if (paths.length) addPaths(paths);
  };

  const pickAndCombineImages = async () => {
    if (!api) return;
    const localApi = api;
    const paths = await localApi.pickFiles([{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]);
    if (!paths.length) return;
    const images = await Promise.all(paths.map(async p => ({ data: await localApi.readFile(p), name: pathBasename(p) })));
    const dir = outputDir;
    const outPath = `${dir || pathDir(paths[0])}\\combined.pdf`;
    const pdfBytes = await imagesToPDF(images);
    await api.writeFile(outPath, pdfBytes);
    historyAddAndRefresh({ name: 'combined.pdf', tool: 'convert', from: 'images', to: 'pdf', bytes: pdfBytes.length, outputPath: outPath });
    api.showInFolder(outPath);
  };

  const totalSaved = files.filter(f => f.status === 'done' && f.outputSize !== undefined && f.outputSize < f.size).reduce((s, f) => s + (f.size - f.outputSize!), 0);

  // ── Options panel ──────────────────────────────────────────────────────────

  function OptionsPanel() {
    return (
      <div className="space-y-3">
        <div className="neon rounded-xl p-4" style={{ background: 'rgba(10,10,22,0.7)' }}>
          <h3 className="font-semibold mb-3" style={{ ...outfit, fontSize: 12, color: tool.color }}>{tool.label} Options</h3>

          {/* Compress */}
          {activeTool === 'compress' && (
            <div className="space-y-2">
              <p style={label11} className="mb-2">Compression Preset</p>
              {COMPRESSION_PRESETS.map(p => (
                <button key={p.id} onClick={() => setCompressPreset(p)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-all"
                  style={compressPreset.id === p.id
                    ? { borderColor: tool.color, backgroundColor: `${tool.color}12`, color: 'var(--foreground)' }
                    : { borderColor: 'rgba(79,110,247,0.15)', color: '#888aaa' }}>
                  <div>
                    <p className="font-medium text-left" style={{ fontSize: 12 }}>{p.label}</p>
                    <p style={{ ...mono, fontSize: 10, color: '#666880' }}>{p.desc}</p>
                  </div>
                  {compressPreset.id === p.id && <CheckCircle size={13} style={{ color: tool.color, flexShrink: 0 }} />}
                </button>
              ))}
              {files.some(f => f.status === 'done') && totalSaved > 0 && (
                <div className="mt-2 p-3 rounded-xl" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <div className="flex items-center gap-2">
                    <TrendingDown size={13} style={{ color: '#F59E0B' }} />
                    <span className="text-sm font-semibold" style={{ color: '#F59E0B' }}>{fmtBytes(totalSaved)} saved</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Convert */}
          {activeTool === 'convert' && (
            <div className="space-y-3">
              <div>
                <p style={label11} className="mb-1.5">From</p>
                {files.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(new Set(files.map(f => (f.name.split('.').pop() ?? '').toUpperCase()))).map(ext => (
                      <span key={ext} className="px-2.5 py-1 rounded-md text-xs font-bold"
                        style={{ background: `${tool.color}18`, color: tool.color, border: `1px solid ${tool.color}30` }}>.{ext}</span>
                    ))}
                  </div>
                ) : <span className="text-xs" style={{ color: '#888aaa' }}>Add files to detect format</span>}
              </div>
              <div>
                <p style={label11} className="mb-1.5">To</p>
                <FormatPicker
                  value={convertTo} onChange={setConvertTo}
                  disabledIds={files.length > 0
                    ? ALL_FORMATS.filter(f => {
                        const inExts = Array.from(new Set(files.map(fi => (fi.name.split('.').pop() ?? '').toLowerCase())));
                        return inExts.every(ext => !(SUPPORTED_OUTPUTS[ext] ?? []).includes(f.id));
                      }).map(f => f.id)
                    : []}
                  placeholder="Select output format..."
                  color={tool.color}
                />
              </div>
              <button onClick={pickAndCombineImages}
                className="neon-btn w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all"
                style={{ color: tool.color, background: `${tool.color}10`, border: `1px solid ${tool.color}25` }}>
                <Plus size={14} /> Combine Images to PDF
              </button>
            </div>
          )}

          {/* Read */}
          {activeTool === 'read' && (
            <div className="space-y-3">
              {[
                { label: 'Dark reader mode', on: darkReader, set: setDarkReader },
                { label: 'Highlight mode',   on: highlight,  set: setHighlight  },
                { label: 'Show bookmarks',   on: bookmarks,  set: setBookmarks  },
              ].map(opt => (
                <label key={opt.label} className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm" style={{ color: '#a0a2b8' }}>{opt.label}</span>
                  <Toggle on={opt.on} color={tool.color} onChange={() => opt.set(!opt.on)} />
                </label>
              ))}
            </div>
          )}

          {/* Scan */}
          {activeTool === 'scan' && (
            <div className="space-y-3">
              <div>
                <p style={label11} className="mb-1.5">Language</p>
                <select value={ocrLang} onChange={e => setOcrLang(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ background: 'rgba(20,20,36,0.8)', border: '1px solid rgba(79,110,247,0.2)', color: '#c8cadf' }}>
                  {OCR_LANGS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <div>
                <p style={label11} className="mb-1.5">Output format</p>
                <div className="flex gap-2">
                  {(['pdf', 'txt'] as const).map(f => (
                    <button key={f} onClick={() => setOcrFormat(f)}
                      className="neon-btn flex-1 py-1.5 rounded-lg text-sm font-semibold transition-all"
                      style={{ background: ocrFormat === f ? `${tool.color}20` : 'rgba(20,20,36,0.6)', color: ocrFormat === f ? tool.color : '#888aaa', border: `1px solid ${ocrFormat === f ? tool.color + '40' : 'rgba(79,110,247,0.12)'}` }}>
                      .{f.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p style={label11} className="mb-1.5">Scan DPI</p>
                <div className="flex gap-1.5">
                  {['75', '150', '300'].map(d => (
                    <button key={d} onClick={() => setOcrDpi(d)}
                      className="neon-btn flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      style={{ ...mono, background: ocrDpi === d ? `${tool.color}20` : 'rgba(20,20,36,0.6)', color: ocrDpi === d ? tool.color : '#888aaa', border: `1px solid ${ocrDpi === d ? tool.color + '40' : 'rgba(79,110,247,0.12)'}` }}>
                      {d} DPI
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Primary action */}
        <button
          onClick={() => {
            const idle = files.filter(f => f.status === 'idle');
            if (idle.length > 0) idle.forEach(f => processFile(f.id));
            else pickFiles();
          }}
          disabled={activeTool !== 'read' && (!files.some(f => f.status === 'idle') || (activeTool === 'convert' && !convertTo))}
          className="neon-btn w-full py-2.5 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ ...outfit, background: `linear-gradient(135deg, ${tool.color}, ${tool.color}cc)` }}>
          {activeTool === 'read'    && (files.some(f => f.status === 'idle') ? 'Open & Read PDF' : 'Browse & Open PDF')}
          {activeTool === 'convert' && (convertTo ? `Convert to .${convertTo.ext.toUpperCase()}` : 'Select a format above')}
          {activeTool === 'compress'&& `Compress (${compressPreset.label})`}
          {activeTool === 'scan'    && 'Run OCR'}
        </button>

        {/* Save-to path */}
        <div className="neon rounded-xl p-3.5" style={{ background: 'rgba(10,10,22,0.7)' }}>
          <p style={label11} className="mb-1.5">Save to</p>
          <div className="flex items-center gap-2">
            <FolderOpen size={13} style={{ color: '#888aaa', flexShrink: 0 }} />
            <input
              value={saveAsPath ? pathDir(saveAsPath) : outputDir}
              onChange={e => { userPickedDir.current = true; setSaveAsPath(null); setOutputDir(e.target.value); }}
              placeholder={defaultDir || 'Documents folder'}
              spellCheck={false}
              className="flex-1 bg-transparent focus:outline-none text-xs truncate"
              style={{ ...mono, color: '#a0a2b8' }}
            />
            {(saveAsPath || userPickedDir.current) && (
              <button onClick={() => { setSaveAsPath(null); userPickedDir.current = false; setOutputDir(defaultDir); }}
                className="flex items-center justify-center w-5 h-5 rounded hover:bg-[rgba(255,255,255,0.06)] shrink-0"
                style={{ color: '#888aaa' }} title="Reset"><X size={11} /></button>
            )}
            <button
              onClick={async () => { if (!api) return; const folder = await api.pickFolder(); if (folder) { userPickedDir.current = true; setSaveAsPath(null); setOutputDir(folder); } }}
              className="neon-btn shrink-0 px-2 py-1 rounded text-xs font-semibold"
              style={{ color: tool.color, background: `${tool.color}12` }}>
              Folder
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Settings page ──────────────────────────────────────────────────────────

  function SettingsPage() {
    const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
    const [saving, setSaving] = useState(false);
    const [saved,  setSaved]  = useState(false);
    const save = async () => {
      setSaving(true);
      try {
        await api?.settingsSet(localSettings);
        setSettings(localSettings);
        if (localSettings.defaultOutputPath && !userPickedDir.current) setOutputDir(localSettings.defaultOutputPath);
        setSaved(true); setTimeout(() => setSaved(false), 2000);
      } catch {}
      setSaving(false);
    };
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="neon rounded-xl p-6" style={{ background: 'rgba(10,10,22,0.7)' }}>
          <h2 className="font-bold mb-5 text-base" style={{ ...outfit, color: '#d8daee' }}>General</h2>
          <div className="space-y-5">
            <div>
              <p style={label11} className="mb-1.5">Default Output Directory</p>
              <p className="text-xs mb-2.5" style={{ color: '#888aaa' }}>All tools will save here unless you choose a different folder.</p>
              <div className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 neon"
                style={{ background: 'rgba(20,20,36,0.7)', border: '1px solid rgba(79,110,247,0.2)' }}>
                <FolderOpen size={13} style={{ color: '#888aaa', flexShrink: 0 }} />
                <input value={localSettings.defaultOutputPath}
                  onChange={e => setLocalSettings(s => ({ ...s, defaultOutputPath: e.target.value }))}
                  placeholder="e.g. C:\Users\You\Documents"
                  spellCheck={false} className="flex-1 bg-transparent focus:outline-none text-xs"
                  style={{ ...mono, color: '#a0a2b8' }} />
                <button onClick={async () => { const f = await api?.pickFolder(); if (f) setLocalSettings(s => ({ ...s, defaultOutputPath: f })); }}
                  className="neon-btn shrink-0 px-3 py-1 rounded-lg text-xs font-semibold"
                  style={{ color: '#4F6EF7', background: 'rgba(79,110,247,0.12)' }}>Browse</button>
              </div>
            </div>
            {([
              { key: 'autoOpenAfter'    as const, label: 'Auto-open output file after processing', desc: 'Opens the result in viewer automatically when done.' },
              { key: 'overwriteExisting'as const, label: 'Overwrite existing files',               desc: 'Replaces an existing file if the output name matches.' },
              { key: 'openPreviewPrompt'as const, label: 'Ask before opening viewer',             desc: 'Prompt you to open the viewer after processing.' },
            ]).map(opt => (
              <label key={opt.key} className="flex items-start gap-4 cursor-pointer">
                <div className="flex-1">
                  <p className="text-sm font-medium mb-0.5" style={{ color: '#c8cadf' }}>{opt.label}</p>
                  <p className="text-xs" style={{ color: '#888aaa' }}>{opt.desc}</p>
                </div>
                <Toggle on={!!localSettings[opt.key]} color="#4F6EF7" onChange={() => setLocalSettings(s => ({ ...s, [opt.key]: !s[opt.key] }))} />
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setLocalSettings(settings)} className="px-4 py-2 rounded-xl text-sm transition-all" style={{ color: '#888aaa', border: '1px solid rgba(79,110,247,0.15)' }}>Reset</button>
          <button onClick={save} disabled={saving} className="neon-btn px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #4F6EF7, #7C59F5)' }}>
            {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    );
  }

  // ── History page ───────────────────────────────────────────────────────────

  function HistoryPage() {
    const [entries, setEntries] = useState<HistoryEntry[]>([]);
    const [loaded,  setLoaded]  = useState(false);
    useEffect(() => { api?.historyList().then(list => { setEntries(list ?? []); setLoaded(true); }).catch(() => setLoaded(true)); }, []);
    const deleteEntry = async (entry: HistoryEntry) => { await api?.historyRemove(entry.id).catch(() => {}); setEntries(prev => prev.filter(e => e.id !== entry.id)); };
    const clearAll    = async () => { await api?.historyClear().catch(() => {}); setEntries([]); };

    if (!loaded) return <div className="text-center py-20" style={{ color: '#888aaa' }}>Loading...</div>;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-bold text-base" style={{ ...outfit, color: '#d8daee' }}>
            History <span className="ml-2 text-sm font-normal" style={{ color: '#888aaa' }}>({entries.length} entries)</span>
          </p>
          {entries.length > 0 && (
            <button onClick={clearAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{ color: '#e05252', background: 'rgba(224,82,82,0.08)', border: '1px solid rgba(224,82,82,0.2)' }}>
              <Trash2 size={11} /> Clear All
            </button>
          )}
        </div>
        {entries.length === 0 ? (
          <div className="neon rounded-xl p-12 text-center" style={{ background: 'rgba(10,10,22,0.7)' }}>
            <Clock size={28} className="mx-auto mb-3" style={{ color: '#888aaa' }} />
            <p className="text-sm" style={{ color: '#888aaa' }}>No history yet.</p>
          </div>
        ) : (
          <div className="neon rounded-xl overflow-hidden" style={{ background: 'rgba(10,10,22,0.7)' }}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'rgba(79,110,247,0.08)' }}>
                    {['File', 'Conversion', 'Size', 'Saved', 'Date', ''].map(col => (
                      <th key={col} className="px-5 py-2.5 text-left" style={label11}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => {
                    const ac = actionColors[entry.tool] ?? actionColors.read;
                    return (
                      <tr key={entry.id} className="border-b last:border-0 hover:bg-[rgba(79,110,247,0.03)] transition-colors group"
                        style={{ borderColor: 'rgba(79,110,247,0.06)' }}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center font-bold shrink-0"
                              style={{ ...mono, backgroundColor: `${ac.fg}18`, color: ac.fg, fontSize: 9 }}>
                              {(entry.from ?? 'FILE').toUpperCase()}
                            </div>
                            <span className="text-sm font-medium truncate max-w-[200px]" style={{ color: '#c8cadf' }}>{entry.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ ...mono, color: ac.fg }}>
                            <span style={{ background: ac.bg, padding: '2px 7px', borderRadius: 6 }}>
                              {(entry.from ?? '?').toUpperCase()} {'→'} {(entry.to ?? '?').toUpperCase()}
                            </span>
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs" style={{ ...mono, color: '#888aaa' }}>{fmtBytes(entry.bytes)}</td>
                        <td className="px-5 py-3 text-xs" style={{ ...mono, color: '#22C55E' }}>{entry.savings ? `-${entry.savings}%` : '--'}</td>
                        <td className="px-5 py-3 text-xs" style={{ color: '#888aaa' }}>{fmtDate(entry.at)}</td>
                        <td className="px-5 py-3">
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                            {entry.outputPath && (
                              <>
                                <button onClick={() => { const ext = (entry.outputPath!.split('.').pop() ?? '').toLowerCase(); if (ext === 'pdf') openInViewer(entry.outputPath!, entry.name); else api?.openPath(entry.outputPath!); }}
                                  className="p-1.5 rounded hover:bg-[rgba(255,255,255,0.06)]" style={{ color: '#888aaa' }} title="Open"><Eye size={12} /></button>
                                <button onClick={() => api?.showInFolder(entry.outputPath!)}
                                  className="p-1.5 rounded hover:bg-[rgba(255,255,255,0.06)]" style={{ color: '#888aaa' }} title="Reveal"><FolderOpen size={12} /></button>
                              </>
                            )}
                            <button onClick={() => deleteEntry(entry)} className="p-1.5 rounded hover:bg-[rgba(224,82,82,0.12)]" style={{ color: '#e05252' }} title="Delete"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── My Files page ──────────────────────────────────────────────────────────

  function MyFilesPage() {
    const [entries, setEntries] = useState<HistoryEntry[]>([]);
    const [loaded,  setLoaded]  = useState(false);
    useEffect(() => {
      api?.historyList().then(list => { setEntries((list ?? []).filter(e => e.outputPath)); setLoaded(true); }).catch(() => setLoaded(true));
    }, []);
    if (!loaded) return <div className="text-center py-20" style={{ color: '#888aaa' }}>Loading...</div>;
    return (
      <div className="space-y-4">
        <p className="font-bold text-base" style={{ ...outfit, color: '#d8daee' }}>
          My Files <span className="ml-2 text-sm font-normal" style={{ color: '#888aaa' }}>({entries.length} output files)</span>
        </p>
        {entries.length === 0 ? (
          <div className="neon rounded-xl p-12 text-center" style={{ background: 'rgba(10,10,22,0.7)' }}>
            <FolderOpen size={28} className="mx-auto mb-3" style={{ color: '#888aaa' }} />
            <p className="text-sm" style={{ color: '#888aaa' }}>No output files yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {entries.map((entry, i) => {
              const ac = actionColors[entry.tool] ?? actionColors.read;
              const outExt = (entry.to ?? entry.outputPath?.split('.').pop() ?? 'file').toUpperCase();
              return (
                <div key={i} className="neon rounded-xl p-4 flex flex-col gap-3 group hover:border-[rgba(79,110,247,0.3)] transition-all cursor-pointer"
                  style={{ background: 'rgba(10,10,22,0.7)' }}
                  onClick={() => { if (!entry.outputPath) return; const ext = (entry.outputPath.split('.').pop() ?? '').toLowerCase(); if (ext === 'pdf') openInViewer(entry.outputPath, entry.name); else api?.openPath(entry.outputPath); }}>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold shrink-0"
                      style={{ ...mono, backgroundColor: `${ac.fg}18`, color: ac.fg, fontSize: 10 }}>{outExt}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: '#c8cadf' }}>{entry.name}</p>
                      <p className="text-xs mt-0.5" style={{ ...mono, color: '#888aaa' }}>{fmtBytes(entry.bytes)} · {fmtDate(entry.at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ ...mono, color: ac.fg, background: ac.bg }}>
                      {actionLabel[entry.tool] ?? entry.tool}
                    </span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { if (!entry.outputPath) return; const ext = (entry.outputPath.split('.').pop() ?? '').toLowerCase(); if (ext === 'pdf') openInViewer(entry.outputPath, entry.name); else api?.openPath(entry.outputPath); }}
                        className="p-1.5 rounded hover:bg-[rgba(255,255,255,0.06)]" style={{ color: '#888aaa' }} title="Open"><Eye size={13} /></button>
                      <button onClick={() => entry.outputPath && api?.showInFolder(entry.outputPath)}
                        className="p-1.5 rounded hover:bg-[rgba(255,255,255,0.06)]" style={{ color: '#888aaa' }} title="Reveal"><ExternalLink size={13} /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const hintMap: Record<ToolId, string> = {
    read:    'PDF, up to 500 MB',
    convert: 'PDF, JPG, PNG, DOCX · up to 200 MB',
    compress:'PDF files · up to 200 MB per file',
    scan:    'JPG, PNG, BMP, TIFF · up to 50 MB',
  };
  const acceptMap: Record<ToolId, string> = {
    read:    '.pdf',
    convert: '.pdf, .jpg, .png, .docx',
    compress:'.pdf',
    scan:    '.jpg, .jpeg, .png, .bmp, .tiff, .webp',
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      <input ref={fileInputRef} type="file" multiple className="hidden"
        onChange={e => e.target.files && addFiles(Array.from(e.target.files))} />

      {/* Sidebar */}
      <aside className="flex flex-col shrink-0 border-r transition-all duration-300"
        style={{ width: sidebarOpen ? 220 : 56, background: 'rgba(6,6,14,0.95)', borderColor: 'rgba(79,110,247,0.12)' }}>

        {/* Logo */}
        <div className="flex items-center gap-3 px-3.5 py-4 border-b" style={{ borderColor: 'rgba(79,110,247,0.12)' }}>
          <img src="/app-icon.png" alt="Folio PDF" className="w-8 h-8 rounded-xl shrink-0 object-cover" />
          {sidebarOpen && (
            <div>
              <p className="font-semibold leading-tight" style={{ ...outfit, fontSize: 15, color: '#d8daee' }}>Folio</p>
              <p className="tracking-widest uppercase" style={{ ...mono, fontSize: 8, color: '#888aaa' }}>PDF Suite</p>
            </div>
          )}
        </div>

        {/* Tool nav */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {sidebarOpen && <p className="px-2 pt-2 pb-1" style={label11}>Tools</p>}
          {TOOLS.map(t => (
            <button key={t.id}
              onClick={() => { setActiveTool(t.id); setActivePage('tools'); setFiles([]); }}
              title={!sidebarOpen ? t.label : undefined}
              className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg transition-all duration-150"
              style={{ backgroundColor: activeTool === t.id ? `${t.color}15` : 'transparent', color: activeTool === t.id ? t.color : '#888aaa' }}>
              <span className="shrink-0">{t.icon}</span>
              {sidebarOpen && <span className="text-sm font-medium flex-1 text-left truncate">{t.label}</span>}
              {sidebarOpen && activeTool === t.id && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />}
            </button>
          ))}
          <div className="pt-3">
            {sidebarOpen && <p className="px-2 pt-1 pb-1" style={label11}>Library</p>}
            {([
              { icon: <FolderOpen size={16} />, label: 'My Files', page: 'files'   as PageId },
              { icon: <Clock size={16} />,      label: 'History',  page: 'history' as PageId },
            ]).map(item => (
              <button key={item.label} title={!sidebarOpen ? item.label : undefined}
                onClick={() => setActivePage(activePage === item.page ? 'tools' : item.page)}
                className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg transition-all"
                style={{ color: activePage === item.page ? '#4F6EF7' : '#888aaa', backgroundColor: activePage === item.page ? 'rgba(79,110,247,0.1)' : 'transparent' }}>
                <span className="shrink-0">{item.icon}</span>
                {sidebarOpen && <span className="text-sm">{item.label}</span>}
              </button>
            ))}
          </div>
        </nav>

        {/* Sidebar footer */}
        <div className="p-2 border-t space-y-0.5" style={{ borderColor: 'rgba(79,110,247,0.12)' }}>
          <button onClick={() => setActivePage(activePage === 'settings' ? 'tools' : 'settings')}
            className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg transition-all"
            style={{ color: activePage === 'settings' ? '#4F6EF7' : '#888aaa', backgroundColor: activePage === 'settings' ? 'rgba(79,110,247,0.1)' : 'transparent' }}>
            <Settings size={16} className="shrink-0" />
            {sidebarOpen && <span className="text-sm">Settings</span>}
          </button>
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg transition-all" style={{ color: '#888aaa' }}>
            <Menu size={16} className="shrink-0" />
            {sidebarOpen && <span className="text-sm">Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3.5 border-b shrink-0"
          style={{ background: 'rgba(8,8,16,0.80)', backdropFilter: 'blur(14px)', borderColor: 'rgba(79,110,247,0.12)' }}>
          <div>
            <h1 style={{ ...outfit, fontSize: 18, color: '#d8daee' }}>
              {activePage === 'settings' ? 'Settings'
                : activePage === 'history' ? 'History'
                : activePage === 'files'   ? 'My Files'
                : tool.label}
            </h1>
            <p className="text-xs mt-0.5" style={{ color: '#888aaa' }}>
              {activePage === 'settings' ? 'Configure default directories and preferences'
                : activePage === 'history' ? 'All processed files'
                : activePage === 'files'   ? 'Your output files'
                : tool.desc}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Update indicator — single neon button, changes label/action per state */}
            {updateStatus && updateStatus.state !== 'none' && updateStatus.state !== 'error' && (
              <button
                onClick={() => {
                  if (updateStatus.state === 'available') api?.updateDownload();
                  else if (updateStatus.state === 'ready') api?.updateInstall();
                }}
                disabled={updateStatus.state === 'downloading'}
                className="neon-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-70"
                style={{ ...mono, letterSpacing: '0.04em', background: updateStatus.state === 'ready' ? 'rgba(34,197,94,0.18)' : 'rgba(79,110,247,0.18)', color: '#fff', border: `1px solid ${updateStatus.state === 'ready' ? 'rgba(34,197,94,0.4)' : 'rgba(79,110,247,0.4)'}`, boxShadow: `0 0 10px ${updateStatus.state === 'ready' ? 'rgba(34,197,94,0.2)' : 'rgba(79,110,247,0.2)'}` }}
                title={updateStatus.manual ? `v${updateStatus.version} available — opens download page` : updateStatus.state === 'ready' ? 'Restart to finish updating' : updateStatus.state === 'downloading' ? 'Downloading update…' : `v${updateStatus.version} available`}
              >
                {updateStatus.state === 'ready' ? <RefreshCw size={11} /> : <Download size={11} />}
                {updateStatus.state === 'available' && (updateStatus.manual ? `Download v${updateStatus.version}` : `Update to v${updateStatus.version}`)}
                {updateStatus.state === 'downloading' && `Updating… ${updateStatus.percent ?? 0}%`}
                {updateStatus.state === 'ready' && 'Restart to update'}
              </button>
            )}
            <span style={{ ...mono, fontSize: 10, color: '#4F6EF7', letterSpacing: '0.1em', fontWeight: 700 }}>v{appVer}</span>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-5 space-y-4">
          {activePage === 'settings' && <SettingsPage />}
          {activePage === 'history'  && <HistoryPage />}
          {activePage === 'files'    && <MyFilesPage />}

          {activePage === 'tools' && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {STAT_DEFS.map(s => (
                  <div key={s.label} className="neon rounded-xl p-4" style={{ background: 'rgba(10,10,22,0.7)' }}>
                    <div className="flex items-center justify-between mb-2.5">
                      <span style={label11}>{s.label}</span>
                      <span className="p-1.5 rounded-lg" style={{ backgroundColor: `${s.color}20`, color: s.color }}>{s.icon}</span>
                    </div>
                    <p className="text-xl font-bold tracking-tight" style={{ ...outfit, color: '#d8daee' }}>{s.fmt(historyStats[s.key])}</p>
                    <p className="mt-0.5 text-xs" style={{ ...mono, color: '#888aaa' }}>{historyStats.total === 0 ? 'no history yet' : 'from your history'}</p>
                  </div>
                ))}
              </div>

              {/* Workspace */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 space-y-3">
                  <DropZone color={tool.color} accept={acceptMap[activeTool]} hint={hintMap[activeTool]} onDrop={addFiles} onClick={pickFiles} />
                  <FileQueue files={files} color={tool.color} onRemove={removeFile} onProcess={processFile} onClear={clearFiles} onReveal={revealFile} />
                </div>
                <div>{OptionsPanel()}</div>
              </div>

              <RecentFiles key={recentKey} toolFilter={activeTool} onOpen={(path, name) => openInViewer(path, name)} />
            </>
          )}
        </main>

        {/* Status bar with live hardware stats */}
        <div className="flex items-center justify-between px-5 py-1.5 border-t shrink-0"
          style={{ background: 'rgba(6,6,14,0.95)', borderColor: 'rgba(79,110,247,0.10)', height: 28 }}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#22C55E' }} />
              <span style={{ ...mono, fontSize: 10, color: '#888aaa', letterSpacing: '0.1em' }}>ENGINE READY</span>
            </div>
            {stats && (
              <>
                <div className="flex items-center gap-1" title="CPU usage">
                  <Cpu size={10} style={{ color: '#4F6EF7' }} />
                  <span style={{ ...mono, fontSize: 10, color: '#888aaa' }}>CPU {stats.cpu}%</span>
                </div>
                <div className="flex items-center gap-1" title="RAM usage">
                  <MemoryStick size={10} style={{ color: '#22C55E' }} />
                  <span style={{ ...mono, fontSize: 10, color: '#888aaa' }}>{fmtBytes(stats.memUsed)} / {fmtBytes(stats.memTotal)}</span>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            {stats && (
              <span style={{ ...mono, fontSize: 10, color: '#666880' }}>
                {stats.cpuModel} · {stats.cores} cores · {stats.platform}
              </span>
            )}
            <span style={{ ...mono, fontSize: 10, color: '#4F6EF7', letterSpacing: '0.1em', fontWeight: 700 }}>
              FOLIO PDF SUITE · v{appVer}
            </span>
          </div>
        </div>
      </div>

      {/* PDF Viewer modal */}
      {viewerFile && (
        <PDFViewer
          fileData={viewerFile.data}
          fileName={viewerFile.name}
          defaultDarkMode={darkReader}
          defaultHighlight={highlight}
          defaultShowBookmarks={bookmarks}
          onClose={() => setViewerFile(null)}
          onSave={async (bytes, name) => {
            const stem = stripExt(name);
            if (api) {
              const saveDir = outputDir || (viewerFile.path.includes('\\') || viewerFile.path.includes('/') ? pathDir(viewerFile.path) : '');
              const out = await api.pickSavePath({ defaultName: `${stem}_annotated.pdf`, defaultDir: saveDir || undefined, filters: [{ name: 'PDF Files', extensions: ['pdf'] }] });
              if (!out) return;
              await api.writeFile(out, bytes);
              historyAddAndRefresh({ name, tool: 'read', from: 'pdf', to: 'pdf', bytes: bytes.length, outputPath: out }).catch(() => {});
              api.showInFolder(out);
            } else {
              const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
              const url  = URL.createObjectURL(blob);
              const a    = document.createElement('a');
              a.href = url; a.download = `${stem}_annotated.pdf`; a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
          }}
        />
      )}
    </div>
  );
}
