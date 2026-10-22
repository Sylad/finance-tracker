import { describe, expect, it } from 'vitest';
import { fileProgress } from './upload-progress';
import type { ImportLog } from '@/types/api';

const log = (id: string, filename: string, status: ImportLog['status'], uploadedAt: string): ImportLog => ({
  id, filename, status, uploadedAt, durationMs: 0,
});

describe('Import de relevés — avancement fichier par fichier (L110)', () => {
  it("R1 — sans journal nouveau, tous les fichiers attendent et « fichier k / N » vaut 1 / N", () => {
    const p = fileProgress(['a.pdf', 'b.pdf'], [], new Set());
    expect(p.states).toEqual(['waiting', 'waiting']);
    expect(p.current).toBe(1);
    expect(p.total).toBe(2);
  });

  it('R2 — un fichier fait, un en cours, un en attente, dans l’ordre de l’envoi', () => {
    const logs = [
      log('2', 'b.pdf', 'in-progress', '2026-10-22T10:01:00Z'),
      log('1', 'a.pdf', 'success', '2026-10-22T10:00:00Z'),
    ];
    const p = fileProgress(['a.pdf', 'b.pdf', 'c.pdf'], logs, new Set());
    expect(p.states).toEqual(['done', 'running', 'waiting']);
    expect(p.current).toBe(2);
    expect(p.total).toBe(3);
  });

  it('R3 — un journal en erreur compte comme fait (le fichier est traité)', () => {
    const p = fileProgress(['a.pdf'], [log('1', 'a.pdf', 'error', '2026-10-22T10:00:00Z')], new Set());
    expect(p.states).toEqual(['done']);
  });

  it("R4 — un journal antérieur à l'envoi (même nom de fichier) est ignoré", () => {
    const old = log('old', 'a.pdf', 'success', '2026-10-01T10:00:00Z');
    const p = fileProgress(['a.pdf'], [old], new Set(['old']));
    expect(p.states).toEqual(['waiting']);
  });

  it('R5 — deux fichiers de même nom prennent chacun leur journal, dans l’ordre', () => {
    const logs = [
      log('1', 'a.pdf', 'success', '2026-10-22T10:00:00Z'),
      log('2', 'a.pdf', 'in-progress', '2026-10-22T10:01:00Z'),
    ];
    expect(fileProgress(['a.pdf', 'a.pdf'], logs, new Set()).states).toEqual(['done', 'running']);
  });

  it('R6 — tout fait : « fichier k / N » ne dépasse pas N', () => {
    const logs = [log('1', 'a.pdf', 'success', '2026-10-22T10:00:00Z')];
    const p = fileProgress(['a.pdf'], logs, new Set());
    expect(p.current).toBe(1);
  });

  it('R4 — un nom accentué que le serveur a relu en latin1 (multer) est rapproché de son fichier', () => {
    const mojibake = Array.from(new TextEncoder().encode('relevé_août.pdf'), (b) => String.fromCharCode(b)).join('');
    expect(mojibake).not.toBe('relevé_août.pdf');
    const p = fileProgress(
      ['relevé_août.pdf', 'b.pdf'],
      [log('1', mojibake, 'in-progress', '2026-10-22T10:00:00Z')],
      new Set(),
    );
    expect(p.states).toEqual(['running', 'waiting']);
  });

  it('R4 — un nom accentué déjà correct reste rapproché', () => {
    const p = fileProgress(['relevé.pdf'], [log('1', 'relevé.pdf', 'success', '2026-10-22T10:00:00Z')], new Set());
    expect(p.states).toEqual(['done']);
  });
});
