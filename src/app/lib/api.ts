import type { FolioApi } from '../../../electron/shared/ipc';

export const api: FolioApi | undefined = (window as typeof window & { api?: FolioApi }).api;

export function fmtBytes(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

export function pathBasename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export function pathDir(p: string): string {
  return p.replace(/[\\/][^\\/]*$/, '');
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.\\/]+$/, '');
}

export function withExt(p: string, ext: string): string {
  return `${stripExt(p)}.${ext}`;
}
