import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

export type FormatCategory = 'pdf' | 'document' | 'image';

export type ConvertFormat = {
  id: string;
  label: string;
  ext: string;
  category: FormatCategory;
  desc: string;
};

export const ALL_FORMATS: ConvertFormat[] = [
  { id: 'pdf',  label: 'PDF',   ext: 'pdf',  category: 'pdf',      desc: 'Portable Document'   },
  { id: 'docx', label: 'Word',  ext: 'docx', category: 'document', desc: 'Microsoft Word'       },
  { id: 'xlsx', label: 'Excel', ext: 'xlsx', category: 'document', desc: 'Microsoft Excel'      },
  { id: 'txt',  label: 'Text',  ext: 'txt',  category: 'document', desc: 'Plain Text'           },
  { id: 'jpg',  label: 'JPG',   ext: 'jpg',  category: 'image',    desc: 'JPEG Image'           },
  { id: 'png',  label: 'PNG',   ext: 'png',  category: 'image',    desc: 'PNG Image'            },
  { id: 'webp', label: 'WebP',  ext: 'webp', category: 'image',    desc: 'Web Image'            },
  { id: 'tiff', label: 'TIFF',  ext: 'tiff', category: 'image',    desc: 'Tagged Image'         },
  { id: 'bmp',  label: 'BMP',   ext: 'bmp',  category: 'image',    desc: 'Bitmap'               },
];

// Which TO formats are supported for each FROM extension
export const SUPPORTED_OUTPUTS: Record<string, string[]> = {
  pdf:  ['jpg', 'png', 'webp', 'txt', 'docx', 'xlsx'],
  jpg:  ['pdf', 'png', 'webp', 'tiff', 'bmp'],
  jpeg: ['pdf', 'png', 'webp', 'tiff', 'bmp'],
  png:  ['pdf', 'jpg', 'webp', 'tiff', 'bmp'],
  webp: ['pdf', 'jpg', 'png', 'tiff', 'bmp'],
  tiff: ['pdf', 'jpg', 'png', 'webp'],
  bmp:  ['pdf', 'jpg', 'png', 'webp'],
  txt:  ['pdf'],
};

export function guessInputFormat(ext: string): ConvertFormat | null {
  const id = ext.toLowerCase().replace('jpeg', 'jpg');
  return ALL_FORMATS.find(f => f.id === id || f.ext === id) ?? null;
}

const CAT_LABELS: Record<FormatCategory, string> = {
  pdf: 'PDF', document: 'Document', image: 'Image',
};
const CATEGORIES: FormatCategory[] = ['pdf', 'document', 'image'];

interface Props {
  value: ConvertFormat | null;
  onChange: (f: ConvertFormat) => void;
  disabledIds?: string[];
  placeholder?: string;
  color?: string;
}

export function FormatPicker({ value, onChange, disabledIds = [], placeholder = 'Select format', color = '#22C55E' }: Props) {
  const [open, setOpen]       = useState(false);
  const [search, setSearch]   = useState('');
  const [tab, setTab]         = useState<FormatCategory>('pdf');
  const ref       = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) setTimeout(() => searchRef.current?.focus(), 50); }, [open]);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = search
    ? ALL_FORMATS.filter(f => f.label.toLowerCase().includes(search.toLowerCase()) || f.desc.toLowerCase().includes(search.toLowerCase()))
    : ALL_FORMATS.filter(f => f.category === tab);

  const grouped = search
    ? CATEGORIES.reduce<Record<string, ConvertFormat[]>>((acc, cat) => {
        const hits = filtered.filter(f => f.category === cat);
        if (hits.length) acc[cat] = hits;
        return acc;
      }, {})
    : null;

  const mono: React.CSSProperties = { fontFamily: "'DM Mono', 'JetBrains Mono', monospace" };

  return (
    <div ref={ref} className="relative w-full">
      <button
        onClick={() => setOpen(o => !o)}
        className="neon-btn w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl transition-all"
        style={{
          background: open ? `${color}14` : 'rgba(20,20,36,0.7)',
          border: `1px solid ${open ? color + '50' : 'rgba(79,110,247,0.2)'}`,
        }}
      >
        {value ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="font-bold text-sm" style={{ color }}>{'.' + value.ext}</span>
            <span className="text-sm truncate" style={{ color: '#d0d2e8' }}>{value.label}</span>
            <span className="text-xs ml-auto" style={{ ...mono, color: '#888aaa' }}>{value.desc}</span>
          </div>
        ) : (
          <span className="text-sm flex-1 text-left" style={{ color: '#888aaa' }}>{placeholder}</span>
        )}
        <ChevronDown size={14} className="shrink-0 transition-transform" style={{ color: '#888aaa', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && (
        <div className="neon absolute left-0 top-full mt-1 z-50 rounded-xl overflow-hidden"
          style={{ width: 320, background: 'rgba(12,12,24,0.97)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', backdropFilter: 'blur(20px)' }}>

          {/* Search */}
          <div className="p-2 border-b" style={{ borderColor: 'rgba(79,110,247,0.12)' }}>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(30,30,50,0.5)' }}>
              <Search size={12} style={{ color: '#888aaa', flexShrink: 0 }} />
              <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search formats…" className="flex-1 bg-transparent focus:outline-none text-xs"
                style={{ color: '#d0d2e8' }} />
              {search && <button onClick={() => setSearch('')}><X size={11} style={{ color: '#888aaa' }} /></button>}
            </div>
          </div>

          {/* Category tabs */}
          {!search && (
            <div className="flex border-b" style={{ borderColor: 'rgba(79,110,247,0.08)' }}>
              {CATEGORIES.map(cat => (
                <button key={cat} onClick={() => setTab(cat)}
                  className="flex-1 py-2.5 text-xs font-semibold transition-colors"
                  style={{
                    color: tab === cat ? color : '#888aaa',
                    borderBottom: `2px solid ${tab === cat ? color : 'transparent'}`,
                    marginBottom: -1,
                  }}>
                  {CAT_LABELS[cat]}
                </button>
              ))}
            </div>
          )}

          {/* Format chips */}
          <div className="p-3 overflow-y-auto" style={{ maxHeight: 240 }}>
            {search && grouped ? (
              Object.entries(grouped).map(([cat, fmts]) => (
                <div key={cat} className="mb-3">
                  <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-widest" style={{ color: '#888aaa' }}>
                    {CAT_LABELS[cat as FormatCategory]}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {fmts.map(f => <Chip key={f.id} fmt={f} selected={value?.id === f.id} disabled={disabledIds.includes(f.id)} color={color}
                      onClick={() => { onChange(f); setOpen(false); setSearch(''); }} />)}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {filtered.map(f => <Chip key={f.id} fmt={f} selected={value?.id === f.id} disabled={disabledIds.includes(f.id)} color={color}
                  onClick={() => { onChange(f); setOpen(false); setSearch(''); }} />)}
              </div>
            )}
            {filtered.length === 0 && (
              <p className="text-center py-5 text-xs" style={{ color: '#888aaa' }}>No formats found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ fmt, selected, disabled, color, onClick }: { fmt: ConvertFormat; selected: boolean; disabled: boolean; color: string; onClick: () => void }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      className="px-3 py-1.5 rounded-md text-xs font-bold transition-all"
      style={{
        background: selected ? color : disabled ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)',
        color: selected ? '#fff' : disabled ? '#555568' : '#c4c4c4',
        border: `1px solid ${selected ? color : 'transparent'}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        letterSpacing: '0.04em',
      }}
      title={disabled ? 'Not supported for this input type' : undefined}
    >
      {fmt.label}
    </button>
  );
}
