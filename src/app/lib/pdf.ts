import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';

// Point pdfjs at its bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export type CompressionPreset = {
  id: string;
  label: string;
  desc: string;
  dpi: number;
  quality: number; // JPEG quality 0–1
  tag: string;
};

export const COMPRESSION_PRESETS: CompressionPreset[] = [
  { id: 'screen',   label: 'Screen',    desc: 'Screen display · ~70% smaller',        dpi: 72,  quality: 0.40, tag: '72 DPI · JPEG 40%'  },
  { id: 'email',    label: 'Email',     desc: 'Email attach · under 5 MB',            dpi: 100, quality: 0.58, tag: '100 DPI · JPEG 58%' },
  { id: 'ebook',    label: 'eBook',     desc: 'Tablet reading · balanced',            dpi: 150, quality: 0.72, tag: '150 DPI · JPEG 72%' },
  { id: 'print',    label: 'Print',     desc: 'Print quality · minimal loss',         dpi: 250, quality: 0.85, tag: '250 DPI · JPEG 85%' },
  { id: 'prepress', label: 'Prepress',  desc: 'Press-ready · near lossless',         dpi: 300, quality: 0.95, tag: '300 DPI · JPEG 95%' },
];

export type ConvertFormat = { id: string; label: string; ext: string; desc: string };

export const CONVERT_FORMATS: ConvertFormat[] = [
  { id: 'jpg',  label: 'PDF → JPG',   ext: 'jpg',  desc: 'One image per page'         },
  { id: 'png',  label: 'PDF → PNG',   ext: 'png',  desc: 'Transparent background'      },
  { id: 'txt',  label: 'PDF → Text',  ext: 'txt',  desc: 'Extract text content'        },
  { id: 'imgs', label: 'Images → PDF',ext: 'pdf',  desc: 'Combine JPG/PNG into PDF'   },
];

/** Load a PDF document from bytes */
export async function loadPDF(data: ArrayBuffer): Promise<pdfjsLib.PDFDocumentProxy> {
  return pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
}

/** Render a single pdfjs page to a canvas at the given scale */
async function renderPageToCanvas(page: pdfjsLib.PDFPageProxy, scale: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width  = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Canvas → Blob with a 30-second safety timeout (toBlob can silently hang on large/complex pages) */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('canvasToBlob timed out after 30 s')), 30_000);
    canvas.toBlob(b => {
      clearTimeout(timer);
      b ? resolve(b) : reject(new Error('Canvas toBlob returned null'));
    }, type, quality);
  });
}

/** Blob → Uint8Array */
async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

// ── Compression ───────────────────────────────────────────────────────────────

export interface CompressOptions {
  preset: CompressionPreset;
  onProgress?: (current: number, total: number) => void;
}

/**
 * Compress a PDF by rasterising each page to JPEG and rebuilding.
 * Returns the compressed PDF as Uint8Array.
 */
export async function compressPDF(data: ArrayBuffer, opts: CompressOptions): Promise<Uint8Array> {
  const { preset, onProgress } = opts;
  const scale = preset.dpi / 72; // pdfjs uses 72 DPI as 1.0 scale

  const src = await loadPDF(data);
  const numPages = src.numPages;
  const out = await PDFDocument.create();

  for (let i = 1; i <= numPages; i++) {
    onProgress?.(i - 1, numPages);
    const page = await src.getPage(i);
    try {
      const canvas = await renderPageToCanvas(page, scale);
      const blob = await canvasToBlob(canvas, 'image/jpeg', preset.quality);
      const imgBytes = await blobToUint8Array(blob);
      const img = await out.embedJpg(imgBytes);
      const { width, height } = img.scale(1);
      const outPage = out.addPage([width, height]);
      outPage.drawImage(img, { x: 0, y: 0, width, height });
    } catch {
      out.addPage(); // keep page count consistent if one page fails
    } finally {
      page.cleanup();
    }
  }

  onProgress?.(numPages, numPages);
  return out.save();
}

// ── Conversion ────────────────────────────────────────────────────────────────

export interface PageImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Render all pages to JPEG or PNG images */
export async function pdfToImages(
  data: ArrayBuffer,
  format: 'jpg' | 'png',
  dpi = 150,
  onProgress?: (current: number, total: number) => void
): Promise<PageImage[]> {
  const scale = dpi / 72;
  const src = await loadPDF(data);
  const numPages = src.numPages;
  const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const quality = format === 'jpg' ? 0.92 : 1;
  const pages: PageImage[] = [];

  for (let i = 1; i <= numPages; i++) {
    onProgress?.(i - 1, numPages);
    const page = await src.getPage(i);
    try {
      const canvas = await renderPageToCanvas(page, scale);
      const blob = await canvasToBlob(canvas, mimeType, quality);
      pages.push({ data: await blobToUint8Array(blob), width: canvas.width, height: canvas.height });
    } catch {
      // skip unrenderable pages rather than hanging forever
    } finally {
      page.cleanup();
    }
  }
  onProgress?.(numPages, numPages);
  return pages;
}

/** Extract plain text from all pages */
export async function pdfToText(
  data: ArrayBuffer,
  onProgress?: (current: number, total: number) => void
): Promise<string> {
  const src = await loadPDF(data);
  const numPages = src.numPages;
  const lines: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    onProgress?.(i - 1, numPages);
    const page = await src.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter((item): item is any => 'str' in item)
      .map(item => item.str)
      .join(' ');
    lines.push(`--- Page ${i} ---\n${pageText}`);
    page.cleanup();
  }
  onProgress?.(numPages, numPages);
  return lines.join('\n\n');
}

/** Build a PDF from a list of image Uint8Arrays (JPEG or PNG) */
export async function imagesToPDF(
  images: { data: ArrayBuffer; name: string }[],
  onProgress?: (current: number, total: number) => void
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  for (let i = 0; i < images.length; i++) {
    onProgress?.(i, images.length);
    const bytes = new Uint8Array(images[i].data);
    const name  = images[i].name.toLowerCase();
    const isPng = name.endsWith('.png') || name.endsWith('.webp');
    const img   = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const { width, height } = img.scale(1);
    const page = doc.addPage([width, height]);
    page.drawImage(img, { x: 0, y: 0, width, height });
  }

  onProgress?.(images.length, images.length);
  return doc.save();
}

/** Get page count + file info without full rendering */
export async function getPDFInfo(data: ArrayBuffer): Promise<{ numPages: number; title?: string }> {
  const src = await loadPDF(data);
  const meta = await src.getMetadata().catch(() => null);
  return {
    numPages: src.numPages,
    title: (meta?.info as { Title?: string } | null)?.Title,
  };
}

// ── Office formats ────────────────────────────────────────────────────────────

/** Convert PDF to Word (.docx) — renders each page as an image for pixel-perfect layout */
export async function pdfToDocx(
  data: ArrayBuffer,
  onProgress?: (current: number, total: number) => void
): Promise<Uint8Array> {
  const { Document, Paragraph, ImageRun, Packer } = await import('docx');
  const src = await loadPDF(data);
  const numPages = src.numPages;
  const children: any[] = [];

  // Render at 150 DPI for quality; scale to fit Word's content width (~6.3 inches at 96 DPI = ~605 px)
  const SCALE = 150 / 72;
  const MAX_W = 605;

  for (let i = 1; i <= numPages; i++) {
    onProgress?.(i - 1, numPages);
    const page = await src.getPage(i);
    const canvas = await renderPageToCanvas(page, SCALE);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    const imgBytes = await blobToUint8Array(blob);

    const aspect = canvas.height / canvas.width;
    const w = Math.min(MAX_W, canvas.width);
    const h = Math.round(w * aspect);

    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: imgBytes,
            transformation: { width: w, height: h },
            type: 'jpg' as any,
          }),
        ],
        spacing: { before: 0, after: 0 },
      })
    );

    if (i < numPages) {
      children.push(new Paragraph({ pageBreakBefore: true }));
    }
    page.cleanup();
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 360, bottom: 360, left: 360, right: 360 },
        },
      },
      children,
    }],
  });
  const outBlob = await Packer.toBlob(doc);
  onProgress?.(numPages, numPages);
  return new Uint8Array(await outBlob.arrayBuffer());
}

/** Convert PDF to Excel (.xlsx) — puts extracted text into spreadsheet rows */
export async function pdfToXlsx(
  data: ArrayBuffer,
  onProgress?: (current: number, total: number) => void
): Promise<Uint8Array> {
  const XLSX = await import('xlsx');
  const src = await loadPDF(data);
  const numPages = src.numPages;
  const wb = XLSX.utils.book_new();

  for (let i = 1; i <= numPages; i++) {
    onProgress?.(i - 1, numPages);
    const page = await src.getPage(i);
    const content = await page.getTextContent();

    // Build rows from text items, grouping by approximate Y position
    const items = content.items.filter((item): item is any => 'str' in item && !!item.str.trim());
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let lastY = -1;

    for (const item of items) {
      const y = Math.round((item as any).transform?.[5] ?? 0);
      if (lastY !== -1 && Math.abs(y - lastY) > 5) {
        if (currentRow.length) rows.push(currentRow);
        currentRow = [];
      }
      currentRow.push(item.str);
      lastY = y;
    }
    if (currentRow.length) rows.push(currentRow);

    const ws = XLSX.utils.aoa_to_sheet(rows.reverse()); // PDF coords are bottom-up
    XLSX.utils.book_append_sheet(wb, ws, `Page ${i}`);
    page.cleanup();
  }

  onProgress?.(numPages, numPages);
  const result = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
  return result;
}

// ── Image conversion ──────────────────────────────────────────────────────────

/** Convert between image formats via canvas */
export async function convertImage(
  data: ArrayBuffer,
  toFormat: 'jpg' | 'png' | 'webp' | 'tiff' | 'bmp'
): Promise<Uint8Array> {
  const blob = new Blob([data]);
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      if (toFormat === 'jpg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      const mime = toFormat === 'jpg' ? 'image/jpeg'
        : toFormat === 'png' ? 'image/png'
        : toFormat === 'webp' ? 'image/webp'
        : 'image/png'; // tiff/bmp fallback to png (browser support)

      canvas.toBlob(b => {
        if (!b) { reject(new Error('Canvas toBlob failed')); return; }
        b.arrayBuffer().then(ab => resolve(new Uint8Array(ab)));
      }, mime, 0.92);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

/** Convert text file content to PDF */
export async function textToPDF(
  data: ArrayBuffer,
  onProgress?: (current: number, total: number) => void
): Promise<Uint8Array> {
  const { PDFDocument: Doc, rgb, StandardFonts } = await import('pdf-lib');
  const text = new TextDecoder().decode(data);
  const lines = text.split('\n');
  const doc   = await Doc.create();
  const font  = await doc.embedFont(StandardFonts.Courier);

  const PAGE_W = 595, PAGE_H = 842, MARGIN = 50, LINE_H = 14, FONT_SIZE = 11;
  const maxY = PAGE_H - MARGIN;
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = maxY;

  onProgress?.(0, lines.length);
  for (let i = 0; i < lines.length; i++) {
    if (y < MARGIN + LINE_H) { page = doc.addPage([PAGE_W, PAGE_H]); y = maxY; }
    const safe = lines[i].replace(/[^\x20-\x7E]/g, '');
    if (safe.length) page.drawText(safe, { x: MARGIN, y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
    y -= LINE_H;
    if (i % 50 === 0) onProgress?.(i, lines.length);
  }

  onProgress?.(lines.length, lines.length);
  return doc.save();
}
