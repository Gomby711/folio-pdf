import { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
  Highlighter, Pen, Type, Eraser, Save, List,
  Moon, Sun, RotateCcw, BookOpen, MousePointer,
} from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

// ── Types ─────────────────────────────────────────────────────────────────────

type AnnotTool = 'none' | 'highlight' | 'draw' | 'text' | 'erase';

interface AnnotRect {
  id: string; page: number; type: 'rect';
  x: number; y: number; w: number; h: number; color: string;
}
interface AnnotPath {
  id: string; page: number; type: 'path';
  points: [number, number][]; color: string; width: number;
}
interface AnnotText {
  id: string; page: number; type: 'text';
  x: number; y: number; text: string; color: string; size: number;
  font: string; bold: boolean; italic: boolean; underline: boolean; strikethrough: boolean;
}
type Annotation = AnnotRect | AnnotPath | AnnotText;
interface PageDim { width: number; height: number; }

interface TextFormat {
  color: string; font: string; size: number;
  bold: boolean; italic: boolean; underline: boolean; strikethrough: boolean; bullet: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb01(hex: string): [number, number, number] {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return [0, 0, 0];
  return [parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255];
}

const HIGHLIGHT_COLORS = ['#FFE000', '#6EE7B7', '#93C5FD', '#FCA5A5', '#C4B5FD', '#FCD34D', '#86EFAC', '#F9A8D4'];
const DRAW_COLORS      = ['#FF3333', '#4F6EF7', '#22C55E', '#F59E0B', '#EC4899', '#000000', '#ffffff', '#A855F7'];
const TEXT_COLORS      = ['#1a1a2e', '#4F6EF7', '#22C55E', '#F59E0B', '#EC4899', '#FF3333', '#A855F7', '#ffffff'];
const FONTS            = ['Inter', 'Arial', 'Times New Roman', 'Courier New', 'Georgia'];
const TEXT_SIZES       = [10, 12, 14, 16, 18, 20, 24, 28, 36];

function buildFont(italic: boolean, bold: boolean, size: number, font: string): string {
  const parts = [italic ? 'italic' : '', bold ? 'bold' : ''].filter(Boolean);
  return `${parts.join(' ')} ${size}px "${font}", sans-serif`;
}

function toPdfFontName(bold: boolean, italic: boolean, font: string): string {
  const f = font.toLowerCase();
  if (f.includes('courier') || f.includes('mono')) {
    if (bold && italic) return 'CourierBoldOblique';
    if (bold)   return 'CourierBold';
    if (italic) return 'CourierOblique';
    return 'Courier';
  }
  if (f.includes('times')) {
    if (bold && italic) return 'TimesBoldItalic';
    if (bold)   return 'TimesBold';
    if (italic) return 'TimesItalic';
    return 'TimesRoman';
  }
  if (bold && italic) return 'HelveticaBoldOblique';
  if (bold)   return 'HelveticaBold';
  if (italic) return 'HelveticaOblique';
  return 'Helvetica';
}

// ── Bookmarks ─────────────────────────────────────────────────────────────────

function OutlineItem({ item, depth = 0, onJump }: { item: any; depth?: number; onJump: (dest: any) => void }) {
  const [open, setOpen] = useState(depth < 1);
  return (
    <div>
      <button
        onClick={() => { if (item.dest) onJump(item.dest); if (item.items?.length) setOpen(v => !v); }}
        className="w-full text-left py-1 px-2 rounded transition-colors hover:bg-[rgba(79,110,247,0.1)]"
        style={{ paddingLeft: 8 + depth * 14, fontSize: 12, color: '#c0c2d8' }}
      >
        {item.items?.length ? (open ? '▾ ' : '▸ ') : '  '}{item.title}
      </button>
      {open && item.items?.map((child: any, i: number) => (
        <OutlineItem key={i} item={child} depth={depth + 1} onJump={onJump} />
      ))}
    </div>
  );
}

// ── Text Format Toolbar ───────────────────────────────────────────────────────

function TextFormatBar({ fmt, onChange }: { fmt: TextFormat; onChange: (p: Partial<TextFormat>) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1">
        {TEXT_COLORS.map(c => (
          <button key={c} onClick={() => onChange({ color: c })}
            className="w-5 h-5 rounded-full border-2 transition-all shrink-0"
            title={c}
            style={{ background: c, borderColor: fmt.color === c ? '#fff' : 'rgba(255,255,255,0.15)', boxShadow: fmt.color === c ? `0 0 5px ${c}` : 'none' }} />
        ))}
      </div>

      <div className="w-px h-4 shrink-0" style={{ background: 'rgba(255,255,255,0.12)' }} />

      <select value={fmt.font} onChange={e => onChange({ font: e.target.value })}
        className="rounded px-2 py-1 text-xs focus:outline-none"
        style={{ background: 'rgba(20,20,36,0.9)', border: '1px solid rgba(79,110,247,0.25)', color: '#c8cadf', maxWidth: 130 }}>
        {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
      </select>

      <select value={fmt.size} onChange={e => onChange({ size: Number(e.target.value) })}
        className="rounded px-2 py-1 text-xs focus:outline-none"
        style={{ background: 'rgba(20,20,36,0.9)', border: '1px solid rgba(79,110,247,0.25)', color: '#c8cadf', width: 54 }}>
        {TEXT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <div className="w-px h-4 shrink-0" style={{ background: 'rgba(255,255,255,0.12)' }} />

      {([
        { key: 'bold'          as const, label: 'B',  extraStyle: { fontWeight: 700 } },
        { key: 'italic'        as const, label: 'I',  extraStyle: { fontStyle: 'italic' } },
        { key: 'underline'     as const, label: 'U',  extraStyle: { textDecoration: 'underline' } },
        { key: 'strikethrough' as const, label: 'S',  extraStyle: { textDecoration: 'line-through' } },
        { key: 'bullet'        as const, label: '•', extraStyle: {} },
      ] as Array<{ key: keyof TextFormat; label: string; extraStyle: React.CSSProperties }>).map(opt => (
        <button
          key={opt.key}
          onClick={() => onChange({ [opt.key]: !fmt[opt.key] })}
          className="w-6 h-6 flex items-center justify-center rounded text-xs font-semibold transition-all shrink-0"
          style={{
            ...opt.extraStyle,
            background: fmt[opt.key] ? 'rgba(79,110,247,0.4)' : 'rgba(20,20,36,0.6)',
            color: fmt[opt.key] ? '#a0b4ff' : '#888aaa',
            border: `1px solid ${fmt[opt.key] ? 'rgba(79,110,247,0.5)' : 'rgba(79,110,247,0.15)'}`,
            fontFamily: 'monospace',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Main Viewer ───────────────────────────────────────────────────────────────

export function PDFViewer({
  fileData, fileName,
  defaultDarkMode = false,
  defaultHighlight = true,
  defaultShowBookmarks = true,
  onClose, onSave,
}: {
  fileData: ArrayBuffer;
  fileName: string;
  defaultDarkMode?: boolean;
  defaultHighlight?: boolean;
  defaultShowBookmarks?: boolean;
  onClose: () => void;
  onSave?: (bytes: Uint8Array, name: string) => Promise<void> | void;
}) {
  const [pdfDoc,      setPdfDoc]      = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages,    setNumPages]    = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom,        setZoom]        = useState(1.2);
  const [tool,        setTool]        = useState<AnnotTool>('none');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [darkMode,    setDarkMode]    = useState(defaultDarkMode);
  const [showBM,      setShowBM]      = useState(defaultShowBookmarks);
  const [outline,     setOutline]     = useState<any[] | null>(null);
  const [hlColor,     setHlColor]     = useState(HIGHLIGHT_COLORS[0]);
  const [drawColor,   setDrawColor]   = useState(DRAW_COLORS[0]);
  const [drawWidth,   setDrawWidth]   = useState(2.5);
  const [textFmt,     setTextFmt]     = useState<TextFormat>({
    color: '#1a1a2e', font: 'Inter', size: 14,
    bold: false, italic: false, underline: false, strikethrough: false, bullet: false,
  });
  const [pageDims,  setPageDims]  = useState<Record<number, PageDim>>({});
  const [savedMsg,  setSavedMsg]  = useState(false);
  const [saveErr,   setSaveErr]   = useState('');
  const [loadErr,   setLoadErr]   = useState('');
  const [loading,   setLoading]   = useState(true);

  // Copy BEFORE pdfjs transfers the ArrayBuffer to its worker thread.
  // Without this copy, PDFDocument.load() in save() would receive a detached buffer.
  const fileDataForSave = useRef<ArrayBuffer>(fileData.slice(0));

  const isDrawing    = useRef(false);
  const drawStart    = useRef<[number, number] | null>(null);
  const currentPath  = useRef<[number, number][]>([]);
  const pageCanvases  = useRef<Record<number, HTMLCanvasElement>>({});
  const annotCanvases = useRef<Record<number, HTMLCanvasElement>>({});
  const textLayers    = useRef<Record<number, HTMLDivElement>>({});
  const rendering     = useRef<Record<number, boolean>>({});
  const scrollRef     = useRef<HTMLDivElement>(null);

  // Stable ref to the latest redrawPage. This breaks the dep chain:
  // annotations -> redrawPage -> renderPage -> useEffect -> re-render (which was clearing canvases).
  const redrawPageRef = useRef<(pg: number) => void>(() => {});

  useEffect(() => {
    setLoadErr('');
    setLoading(true);
    setPdfDoc(null);
    setNumPages(0);
    // Slice BEFORE passing to pdfjs — pdfjs transfers the buffer to its worker thread,
    // neutering (byteLength→0) any Uint8Array that shares the same underlying ArrayBuffer.
    // Two independent copies: one for pdfjs rendering, one for save/annotation.
    const dataCopy = fileData.slice(0);
    fileDataForSave.current = fileData.slice(0);
    const bytes = new Uint8Array(dataCopy);
    if (!bytes.byteLength) {
      setLoadErr('File data is empty — try re-opening the file.');
      setLoading(false);
      return;
    }
    // Cancellation flag: when cleanup runs (unmount or fileData change), task.destroy()
    // causes the promise to reject with "worker destroyed". Without this flag that rejection
    // would call setLoadErr on an already-unmounted component, showing a spurious error.
    let cancelled = false;
    const task = pdfjsLib.getDocument({ data: bytes });
    task.promise
      .then(async doc => {
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setLoading(false);
        const ol = await doc.getOutline().catch(() => null);
        if (!cancelled) setOutline(ol ?? []);
      })
      .catch(err => {
        if (cancelled) return;
        setLoadErr(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => { cancelled = true; task.destroy(); };
  }, [fileData]);

  const redrawPage = useCallback((pageNum: number) => {
    const canvas = annotCanvases.current[pageNum];
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const ann of annotations) {
      if (ann.page !== pageNum) continue;
      if (ann.type === 'rect') {
        ctx.save();
        ctx.globalAlpha = 0.38;
        ctx.fillStyle = ann.color;
        ctx.fillRect(ann.x, ann.y, ann.w, ann.h);
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(ann.x, ann.y, ann.w, ann.h);
        ctx.restore();
      } else if (ann.type === 'path') {
        if (ann.points.length < 2) continue;
        ctx.save();
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = ann.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(ann.points[0][0], ann.points[0][1]);
        ann.points.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.stroke();
        ctx.restore();
      } else if (ann.type === 'text') {
        ctx.save();
        ctx.font = buildFont(ann.italic, ann.bold, ann.size, ann.font);
        const metrics = ctx.measureText(ann.text);
        const w = metrics.width;
        const ascent = metrics.actualBoundingBoxAscent || ann.size * 0.8;
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = 'rgba(255,255,220,0.95)';
        ctx.fillRect(ann.x - 2, ann.y - ascent - 2, w + 8, ann.size + 6);
        ctx.globalAlpha = 1;
        ctx.fillStyle = ann.color;
        ctx.fillText(ann.text, ann.x + 2, ann.y);
        if (ann.underline) {
          ctx.fillStyle = ann.color;
          ctx.fillRect(ann.x + 2, ann.y + 3, w, Math.max(1, ann.size * 0.07));
        }
        if (ann.strikethrough) {
          ctx.fillStyle = ann.color;
          ctx.fillRect(ann.x + 2, ann.y - ann.size * 0.28, w, Math.max(1, ann.size * 0.07));
        }
        ctx.restore();
      }
    }
  }, [annotations]);

  // Keep ref in sync so renderPage always calls the latest version
  useEffect(() => { redrawPageRef.current = redrawPage; }, [redrawPage]);

  useEffect(() => {
    for (let i = 1; i <= numPages; i++) redrawPage(i);
  }, [annotations, redrawPage, numPages]);

  // renderPage does NOT depend on redrawPage — it calls via ref instead.
  // This prevents annotation state changes from triggering full page re-renders.
  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDoc || rendering.current[pageNum]) return;
    rendering.current[pageNum] = true;
    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: zoom });
      const canvas  = pageCanvases.current[pageNum];
      const aCanvas = annotCanvases.current[pageNum];
      const tDiv    = textLayers.current[pageNum];
      if (!canvas) return;

      canvas.width  = viewport.width;
      canvas.height = viewport.height;
      if (aCanvas) { aCanvas.width = viewport.width; aCanvas.height = viewport.height; }
      if (tDiv)    { tDiv.style.width = viewport.width + 'px'; tDiv.style.height = viewport.height + 'px'; }

      setPageDims(d => ({ ...d, [pageNum]: { width: viewport.width, height: viewport.height } }));
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;

      if (tDiv) {
        tDiv.innerHTML = '';
        try {
          const { TextLayer } = pdfjsLib as any;
          if (TextLayer) {
            const tl = new TextLayer({ textContentSource: page.streamTextContent(), container: tDiv, viewport });
            await tl.render();
          }
        } catch { /* text layer is optional */ }
      }

      redrawPageRef.current(pageNum);
      page.cleanup();
    } finally {
      rendering.current[pageNum] = false;
    }
  }, [pdfDoc, zoom]);

  useEffect(() => {
    if (!pdfDoc) return;
    rendering.current = {};
    for (let i = 1; i <= numPages; i++) renderPage(i);
  }, [pdfDoc, zoom, numPages, renderPage]);

  const canvasXY = (e: React.MouseEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>, pg: number) => {
    if (tool === 'none') return;
    e.preventDefault();
    const ac = annotCanvases.current[pg];
    if (!ac) return;
    const [x, y] = canvasXY(e, ac);

    if (tool === 'highlight' || tool === 'draw') {
      isDrawing.current = true;
      drawStart.current = [x, y];
      currentPath.current = [[x, y]];
    } else if (tool === 'text') {
      const fmt = textFmt;
      const screenX = e.clientX, screenY = e.clientY;
      const ta = document.createElement('textarea');
      Object.assign(ta.style, {
        position: 'fixed',
        left: screenX + 'px',
        top: (screenY - 14) + 'px',
        zIndex: '99999',
        background: 'rgba(255,255,220,0.97)',
        border: '2px solid #4F6EF7',
        borderRadius: '4px',
        padding: '4px 8px',
        fontSize: fmt.size + 'px',
        fontFamily: `"${fmt.font}", sans-serif`,
        fontWeight: fmt.bold ? '700' : '400',
        fontStyle: fmt.italic ? 'italic' : 'normal',
        textDecoration: [fmt.underline && 'underline', fmt.strikethrough && 'line-through'].filter(Boolean).join(' ') || 'none',
        color: fmt.color,
        minWidth: '180px',
        minHeight: '32px',
        outline: 'none',
        resize: 'both',
        lineHeight: '1.4',
      });
      document.body.appendChild(ta);
      ta.focus();
      const commit = () => {
        let txt = ta.value.trim();
        if (txt) {
          if (fmt.bullet) txt = '• ' + txt.split('\n').join('\n• ');
          setAnnotations(p => [...p, {
            id: crypto.randomUUID(), page: pg, type: 'text',
            x, y, text: txt, color: fmt.color, size: fmt.size,
            font: fmt.font, bold: fmt.bold, italic: fmt.italic,
            underline: fmt.underline, strikethrough: fmt.strikethrough,
          }]);
        }
        if (document.body.contains(ta)) document.body.removeChild(ta);
      };
      ta.addEventListener('blur', commit, { once: true });
      ta.addEventListener('keydown', e2 => {
        if (e2.key === 'Enter' && !e2.shiftKey) { e2.preventDefault(); ta.blur(); }
        if (e2.key === 'Escape') { ta.value = ''; ta.blur(); }
      });
    } else if (tool === 'erase') {
      setAnnotations(prev => prev.filter(ann => {
        if (ann.page !== pg) return true;
        if (ann.type === 'rect')
          return !(x >= ann.x - 4 && x <= ann.x + ann.w + 4 && y >= ann.y - 4 && y <= ann.y + ann.h + 4);
        if (ann.type === 'text')
          return !(Math.abs(x - ann.x) < 80 && Math.abs(y - ann.y) < 30);
        if (ann.type === 'path')
          return !ann.points.some(([px, py]) => Math.hypot(px - x, py - y) < 14);
        return true;
      }));
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>, pg: number) => {
    if (!isDrawing.current) return;
    const ac = annotCanvases.current[pg];
    if (!ac) return;
    const [x, y] = canvasXY(e, ac);
    const ctx = ac.getContext('2d')!;
    if (tool === 'highlight') {
      redrawPageRef.current(pg);
      const [sx, sy] = drawStart.current!;
      ctx.save(); ctx.globalAlpha = 0.38; ctx.fillStyle = hlColor;
      ctx.fillRect(sx, sy, x - sx, y - sy); ctx.restore();
    } else if (tool === 'draw') {
      currentPath.current.push([x, y]);
      const pts = currentPath.current;
      if (pts.length > 1) {
        ctx.save(); ctx.strokeStyle = drawColor; ctx.lineWidth = drawWidth;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
        ctx.moveTo(pts[pts.length - 2][0], pts[pts.length - 2][1]);
        ctx.lineTo(x, y); ctx.stroke(); ctx.restore();
      }
    }
  };

  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>, pg: number) => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const ac = annotCanvases.current[pg];
    if (!ac) return;
    const [x, y] = canvasXY(e, ac);
    if (tool === 'highlight') {
      const [sx, sy] = drawStart.current!;
      const w = x - sx, h = y - sy;
      if (Math.abs(w) > 4 && Math.abs(h) > 4) {
        setAnnotations(p => [...p, {
          id: crypto.randomUUID(), page: pg, type: 'rect',
          x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(w), h: Math.abs(h), color: hlColor,
        }]);
      } else redrawPageRef.current(pg);
    } else if (tool === 'draw') {
      if (currentPath.current.length > 1) {
        setAnnotations(p => [...p, {
          id: crypto.randomUUID(), page: pg, type: 'path',
          points: [...currentPath.current], color: drawColor, width: drawWidth,
        }]);
      }
      currentPath.current = [];
    }
    drawStart.current = null;
  };

  const jumpToDest = async (dest: any) => {
    if (!pdfDoc) return;
    let d = dest;
    if (typeof d === 'string') d = await pdfDoc.getDestination(d);
    if (!Array.isArray(d)) return;
    const idx = await pdfDoc.getPageIndex(d[0]);
    const pg = idx + 1;
    setCurrentPage(pg);
    document.getElementById(`pdf-page-${pg}`)?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => {
      for (let i = 1; i <= numPages; i++) {
        const el = document.getElementById(`pdf-page-${i}`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const cr = container.getBoundingClientRect();
        if (r.top >= cr.top - 40 && r.top < cr.bottom) { setCurrentPage(i); break; }
      }
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [numPages]);

  const save = async () => {
    if (!onSave) return;
    setSaveErr('');
    try {
      const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
      const doc = await PDFDocument.load(new Uint8Array(fileDataForSave.current));
      const pages = doc.getPages();
      const fontCache: Record<string, any> = {};
      const getFont = async (name: string) => {
        if (!fontCache[name]) fontCache[name] = await doc.embedFont((StandardFonts as any)[name]);
        return fontCache[name];
      };

      for (const ann of annotations) {
        const page = pages[ann.page - 1];
        if (!page) continue;
        const { width: pW, height: pH } = page.getSize();
        const dim = pageDims[ann.page];
        if (!dim) continue;
        const sx = pW / dim.width, sy = pH / dim.height;

        if (ann.type === 'rect') {
          const [r, g, b] = hexToRgb01(ann.color);
          page.drawRectangle({ x: ann.x*sx, y: pH-(ann.y+ann.h)*sy, width: ann.w*sx, height: ann.h*sy, color: rgb(r,g,b), opacity: 0.38 });
        } else if (ann.type === 'path') {
          const [r, g, b] = hexToRgb01(ann.color);
          for (let i = 1; i < ann.points.length; i++) {
            page.drawLine({
              start: { x: ann.points[i-1][0]*sx, y: pH-ann.points[i-1][1]*sy },
              end:   { x: ann.points[i][0]*sx,   y: pH-ann.points[i][1]*sy },
              color: rgb(r,g,b), thickness: ann.width,
            });
          }
        } else if (ann.type === 'text') {
          const [r, g, b] = hexToRgb01(ann.color);
          const fontName = toPdfFontName(ann.bold, ann.italic, ann.font);
          const font = await getFont(fontName);
          const pdfY = pH - ann.y * sy;
          page.drawText(ann.text, { x: ann.x*sx, y: pdfY, size: ann.size, font, color: rgb(r,g,b) });
          if (ann.underline || ann.strikethrough) {
            const tw = font.widthOfTextAtSize(ann.text, ann.size) * sx;
            if (ann.underline) {
              page.drawLine({ start: { x: ann.x*sx, y: pdfY-2 }, end: { x: ann.x*sx+tw, y: pdfY-2 }, color: rgb(r,g,b), thickness: 1 });
            }
            if (ann.strikethrough) {
              const mid = pdfY + ann.size * 0.3;
              page.drawLine({ start: { x: ann.x*sx, y: mid }, end: { x: ann.x*sx+tw, y: mid }, color: rgb(r,g,b), thickness: 1 });
            }
          }
        }
      }

      const bytes = await doc.save();
      await onSave(bytes, fileName);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveErr(msg);
      setTimeout(() => setSaveErr(''), 6000);
    }
  };

  const getCursor = () => {
    if (tool === 'highlight' || tool === 'draw') return 'crosshair';
    if (tool === 'text')  return 'text';
    if (tool === 'erase') return 'cell';
    return 'default';
  };

  const toolBtn = (t: AnnotTool, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setTool(prev => prev === t ? 'none' : t)}
      title={label} data-active={tool === t}
      className="neon-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all"
      style={{
        fontSize: 11, fontWeight: 600, fontFamily: 'monospace',
        background: tool === t ? 'rgba(79,110,247,0.22)' : 'rgba(20,20,36,0.6)',
        color: tool === t ? '#a0b4ff' : '#888aaa',
        border: `1px solid ${tool === t ? 'rgba(79,110,247,0.4)' : 'rgba(79,110,247,0.12)'}`,
      }}
    >
      {icon} {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#0a0a14', fontFamily: "'Inter', sans-serif" }}>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 shrink-0 border-b flex-wrap"
        style={{ background: 'rgba(8,8,18,0.98)', borderColor: 'rgba(79,110,247,0.18)', minHeight: 48 }}>

        <div className="flex items-center gap-2 mr-2 shrink-0">
          <BookOpen size={14} style={{ color: '#4F6EF7' }} />
          <span className="text-sm font-semibold truncate max-w-48" style={{ color: '#c8cadf' }}>{fileName}</span>
        </div>

        <div className="w-px h-5 shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />

        <div className="flex items-center gap-1.5 shrink-0">
          {toolBtn('none',      <MousePointer size={13} />, 'Select')}
          {toolBtn('highlight', <Highlighter size={13} />,  'Highlight')}
          {toolBtn('draw',      <Pen size={13} />,          'Draw')}
          {toolBtn('text',      <Type size={13} />,         'Text')}
          {toolBtn('erase',     <Eraser size={13} />,       'Erase')}
        </div>

        <div className="w-px h-5 shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />

        {/* Highlight color palette */}
        {tool === 'highlight' && (
          <div className="flex items-center gap-1.5">
            <span style={{ fontSize: 10, color: '#888aaa', fontFamily: 'monospace' }}>Color:</span>
            {HIGHLIGHT_COLORS.map(c => (
              <button key={c} onClick={() => setHlColor(c)}
                className="w-5 h-5 rounded-full border-2 transition-all"
                style={{ background: c, borderColor: hlColor === c ? '#fff' : 'transparent', opacity: hlColor === c ? 1 : 0.6 }} />
            ))}
          </div>
        )}

        {/* Draw color + thickness */}
        {tool === 'draw' && (
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 10, color: '#888aaa', fontFamily: 'monospace' }}>Color:</span>
            <div className="flex gap-1">
              {DRAW_COLORS.map(c => (
                <button key={c} onClick={() => setDrawColor(c)}
                  className="w-4 h-4 rounded-full border-2 transition-all"
                  style={{ background: c, borderColor: drawColor === c ? '#fff' : 'rgba(255,255,255,0.2)' }} />
              ))}
            </div>
            <div className="w-px h-4 shrink-0" style={{ background: 'rgba(255,255,255,0.12)' }} />
            <span style={{ fontSize: 10, color: '#888aaa', fontFamily: 'monospace' }}>Size:</span>
            {[1, 2.5, 4, 7, 12].map(w => (
              <button key={w} onClick={() => setDrawWidth(w)}
                className="w-5 h-5 flex items-center justify-center rounded transition-all"
                title={`${w}px`}
                style={{ background: drawWidth === w ? 'rgba(79,110,247,0.35)' : 'rgba(20,20,36,0.6)', border: `1px solid ${drawWidth === w ? 'rgba(79,110,247,0.5)' : 'rgba(79,110,247,0.15)'}` }}>
                <div className="rounded-full bg-white" style={{ width: Math.min(w * 2, 12), height: Math.min(w * 2, 12) }} />
              </button>
            ))}
          </div>
        )}

        {/* Text format bar */}
        {tool === 'text' && (
          <TextFormatBar fmt={textFmt} onChange={patch => setTextFmt(f => ({ ...f, ...patch }))} />
        )}

        <div className="flex-1" />

        {/* Page nav */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => { const t = Math.max(1, currentPage-1); setCurrentPage(t); document.getElementById(`pdf-page-${t}`)?.scrollIntoView({ behavior: 'smooth' }); }}
            className="p-1.5 rounded hover:bg-[rgba(255,255,255,0.07)] transition-all" style={{ color: '#888aaa' }}>
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs px-1" style={{ color: '#888aaa', fontFamily: 'monospace' }}>{currentPage} / {numPages}</span>
          <button onClick={() => { const t = Math.min(numPages, currentPage+1); setCurrentPage(t); document.getElementById(`pdf-page-${t}`)?.scrollIntoView({ behavior: 'smooth' }); }}
            className="p-1.5 rounded hover:bg-[rgba(255,255,255,0.07)] transition-all" style={{ color: '#888aaa' }}>
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setZoom(z => Math.max(0.5, +(z-0.15).toFixed(2)))} className="p-1.5 rounded hover:bg-[rgba(255,255,255,0.07)] transition-all" style={{ color: '#888aaa' }}><ZoomOut size={14} /></button>
          <span className="text-xs px-1 min-w-8 text-center" style={{ fontFamily: 'monospace', color: '#888aaa' }}>{Math.round(zoom*100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, +(z+0.15).toFixed(2)))} className="p-1.5 rounded hover:bg-[rgba(255,255,255,0.07)] transition-all" style={{ color: '#888aaa' }}><ZoomIn size={14} /></button>
        </div>

        <div className="w-px h-5 shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />

        <button onClick={() => setDarkMode(v => !v)} title="Dark reader mode"
          className="p-1.5 rounded transition-all shrink-0"
          style={{ color: darkMode ? '#93C5FD' : '#888aaa', background: darkMode ? 'rgba(79,110,247,0.15)' : 'transparent' }}>
          {darkMode ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button onClick={() => setShowBM(v => !v)} title="Bookmarks"
          className="p-1.5 rounded transition-all shrink-0"
          style={{ color: showBM ? '#93C5FD' : '#888aaa', background: showBM ? 'rgba(79,110,247,0.15)' : 'transparent' }}>
          <List size={15} />
        </button>
        <button onClick={() => setAnnotations(p => p.slice(0, -1))} title="Undo" className="p-1.5 rounded hover:bg-[rgba(255,255,255,0.07)] transition-all shrink-0" style={{ color: '#888aaa' }}>
          <RotateCcw size={14} />
        </button>

        <div className="w-px h-5 shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />

        {onSave && (
          <button onClick={save}
            className="neon-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all shrink-0"
            style={{ background: savedMsg ? 'rgba(34,197,94,0.5)' : 'rgba(79,110,247,0.55)', border: '1px solid rgba(79,110,247,0.4)' }}>
            <Save size={13} /> {savedMsg ? 'Saved!' : 'Save PDF'}
          </button>
        )}

        <button onClick={onClose} className="p-1.5 rounded hover:bg-[rgba(255,50,50,0.15)] transition-all ml-1 shrink-0" style={{ color: '#888aaa' }}>
          <X size={16} />
        </button>
      </div>

      {/* Hint bar */}
      <div className="flex items-center gap-2 px-4 py-1.5 shrink-0"
        style={{ background: tool !== 'none' ? 'rgba(79,110,247,0.1)' : 'rgba(79,110,247,0.05)', borderBottom: '1px solid rgba(79,110,247,0.14)' }}>
        <span style={{ fontSize: 11, color: tool !== 'none' ? '#a0b4ff' : '#888aaa', fontFamily: 'monospace', fontWeight: tool !== 'none' ? 600 : 400 }}>
          {tool === 'none'      && 'Select a tool above to annotate — then click on the page.'}
          {tool === 'highlight' && 'HIGHLIGHT — click and drag to mark text'}
          {tool === 'draw'      && 'DRAW — click and drag to draw freely'}
          {tool === 'text'      && 'TEXT — click anywhere to place text (Enter to confirm, Shift+Enter for new line)'}
          {tool === 'erase'     && 'ERASE — click an annotation to remove it'}
        </span>
        {tool !== 'none' && (
          <button onClick={() => setTool('none')} style={{ fontSize: 11, color: '#888aaa', fontFamily: 'monospace', marginLeft: 'auto' }}>
            x Exit
          </button>
        )}
      </div>

      {/* Save error toast */}
      {saveErr && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-semibold max-w-lg text-center"
          style={{ background: 'rgba(224,82,82,0.92)', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)' }}>
          Save failed: {saveErr}
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Bookmarks */}
        {showBM && (
          <div className="w-52 shrink-0 flex flex-col border-r overflow-hidden" style={{ background: 'rgba(6,6,14,0.98)', borderColor: 'rgba(79,110,247,0.12)' }}>
            <div className="px-3 py-2 border-b" style={{ borderColor: 'rgba(79,110,247,0.1)' }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#888aaa', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'monospace' }}>Bookmarks</p>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {!outline?.length
                ? <p className="px-3 py-4" style={{ fontSize: 12, color: '#666880' }}>No bookmarks.</p>
                : outline.map((item, i) => <OutlineItem key={i} item={item} onJump={jumpToDest} />)
              }
            </div>
            <div className="border-t py-1" style={{ borderColor: 'rgba(79,110,247,0.1)' }}>
              <p className="px-3 py-1" style={{ fontSize: 10, fontWeight: 700, color: '#888aaa', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'monospace' }}>Pages</p>
              <div className="overflow-y-auto max-h-28 px-2 space-y-0.5">
                {Array.from({ length: numPages }, (_, i) => i + 1).map(pg => (
                  <button key={pg}
                    onClick={() => { setCurrentPage(pg); document.getElementById(`pdf-page-${pg}`)?.scrollIntoView({ behavior: 'smooth' }); }}
                    className="w-full text-left px-2 py-1 rounded transition-all"
                    style={{ fontSize: 12, background: currentPage === pg ? 'rgba(79,110,247,0.18)' : 'transparent', color: currentPage === pg ? '#a0b4ff' : '#888aaa' }}>
                    Page {pg}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Pages */}
        <div ref={scrollRef} className="flex-1 overflow-auto" style={{ background: darkMode ? '#1a1a2a' : '#3a3a4a' }}>
          {loading && (
            <div className="flex items-center justify-center h-full min-h-64">
              <div style={{ color: '#888aaa', fontFamily: 'monospace', fontSize: 13 }}>Loading PDF…</div>
            </div>
          )}
          {loadErr && (
            <div className="flex flex-col items-center justify-center h-full min-h-64 gap-3 p-8">
              <div style={{ color: '#e05252', fontFamily: 'monospace', fontSize: 13, textAlign: 'center', maxWidth: 480 }}>
                Failed to load PDF: {loadErr}
              </div>
              <button onClick={onClose} style={{ color: '#888aaa', fontSize: 12 }}>Close</button>
            </div>
          )}
          <div className="flex flex-col items-center py-6 gap-4"
            style={{ filter: darkMode ? 'invert(92%) hue-rotate(180deg) brightness(0.88)' : 'none', display: loading || loadErr ? 'none' : 'flex' }}>
            {Array.from({ length: numPages }, (_, i) => i + 1).map(pg => {
              const dim = pageDims[pg];
              return (
                <div key={pg} id={`pdf-page-${pg}`} className="relative shadow-2xl" style={{ display: 'inline-block' }}>
                  <div className="absolute -top-5 left-0" style={{ fontSize: 11, color: darkMode ? '#555' : '#aaa', fontFamily: 'monospace' }}>
                    Page {pg}
                  </div>
                  <canvas ref={el => { if (el) pageCanvases.current[pg] = el; }} style={{ display: 'block', background: '#fff' }} />
                  <div ref={el => { if (el) textLayers.current[pg] = el; }}
                    className="pdf-text-layer"
                    style={{ position: 'absolute', top: 0, left: 0, overflow: 'hidden', pointerEvents: tool === 'none' ? 'auto' : 'none', userSelect: tool === 'none' ? 'text' : 'none' }} />
                  <canvas
                    ref={el => { if (el) annotCanvases.current[pg] = el; }}
                    style={{ position: 'absolute', top: 0, left: 0, cursor: getCursor(), pointerEvents: tool === 'none' ? 'none' : 'auto' }}
                    onMouseDown={e => onMouseDown(e, pg)}
                    onMouseMove={e => onMouseMove(e, pg)}
                    onMouseUp={e => onMouseUp(e, pg)}
                    onMouseLeave={e => { if (isDrawing.current) onMouseUp(e, pg); }}
                  />
                  {!dim && (
                    <div className="flex items-center justify-center" style={{ width: 595, height: 842, background: '#fff' }}>
                      <div style={{ fontSize: 13, color: '#ccc' }}>Rendering...</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {annotations.length > 0 && (
        <div className="absolute bottom-4 right-4">
          <button onClick={() => setAnnotations([])}
            className="px-2.5 py-1 rounded text-xs transition-all"
            style={{ background: 'rgba(20,20,36,0.9)', border: '1px solid rgba(79,110,247,0.2)', color: '#888aaa' }}>
            Clear all ({annotations.length})
          </button>
        </div>
      )}
    </div>
  );
}
