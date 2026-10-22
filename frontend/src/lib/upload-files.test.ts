import { describe, expect, it } from 'vitest';
import { MAX_FILES, MAX_FILE_BYTES, selectStatementFiles } from './upload-files';

function file(name: string, size = 1000, type = 'application/pdf'): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('selectStatementFiles (L108)', () => {
  it('R1 — un fichier non PDF est écarté avec son nom et sa raison', () => {
    const r = selectStatementFiles([], [file('notes.txt', 10, 'text/plain'), file('a.pdf')]);
    expect(r.accepted.map((f) => f.name)).toEqual(['a.pdf']);
    expect(r.rejected).toEqual([{ name: 'notes.txt', reason: "ce n'est pas un PDF" }]);
  });

  it('R1 — un PDF sans type MIME mais en .pdf (casse comprise) est accepté', () => {
    const r = selectStatementFiles([], [file('A.PDF', 10, '')]);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toEqual([]);
  });

  it('R2 — un PDF de plus de 20 Mo est écarté, un de 20 Mo pile est gardé', () => {
    const r = selectStatementFiles([], [file('gros.pdf', MAX_FILE_BYTES + 1), file('limite.pdf', MAX_FILE_BYTES)]);
    expect(r.accepted.map((f) => f.name)).toEqual(['limite.pdf']);
    expect(r.rejected).toEqual([{ name: 'gros.pdf', reason: 'dépasse 20 Mo (20,0 Mo)' }]);
  });

  it('R2 — la taille affichée est celle du fichier', () => {
    const r = selectStatementFiles([], [file('x.pdf', 25 * 1024 * 1024)]);
    expect(r.rejected[0].reason).toBe('dépasse 20 Mo (25,0 Mo)');
  });

  it('R3 — au-delà de 12 fichiers, chaque excédent est nommé avec sa raison', () => {
    const prev = Array.from({ length: 11 }, (_, i) => file(`p${i}.pdf`, 100 + i));
    const r = selectStatementFiles(prev, [file('n1.pdf'), file('n2.pdf'), file('n3.pdf')]);
    expect(r.accepted).toHaveLength(MAX_FILES);
    expect(r.accepted[11].name).toBe('n1.pdf');
    expect(r.rejected).toEqual([
      { name: 'n2.pdf', reason: 'la liste est pleine (12 fichiers maximum)' },
      { name: 'n3.pdf', reason: 'la liste est pleine (12 fichiers maximum)' },
    ]);
  });

  it('R4 — un fichier déjà dans la liste est signalé, pas ajouté deux fois', () => {
    const r = selectStatementFiles([file('a.pdf', 5)], [file('a.pdf', 5)]);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toEqual([{ name: 'a.pdf', reason: 'déjà dans la liste' }]);
  });
});
