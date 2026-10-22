import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadPage } from './upload';
import type { ImportLog } from '@/types/api';

const state = vi.hoisted(() => ({ isPending: false, logs: [] as ImportLog[], mutateAsync: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...p }: { children: React.ReactNode }) => <a {...(p as object)}>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/lib/queries', () => ({
  useUploadStatements: () => ({ mutateAsync: state.mutateAsync, isPending: state.isPending }),
  useImportLogs: () => ({ data: state.logs }),
}));

const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' });
const log = (id: string, filename: string, status: ImportLog['status'], uploadedAt: string): ImportLog => ({
  id, filename, status, uploadedAt, durationMs: 0,
});

/** Sélectionne puis lance l'analyse ; la promesse d'envoi reste en suspens, comme le serveur. */
async function startUpload(...names: string[]) {
  state.mutateAsync = vi.fn(() => new Promise(() => {}));
  const view = render(<UploadPage />);
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  await userEvent.upload(input, names.map(pdf));
  state.isPending = true;
  await userEvent.click(screen.getByRole('button', { name: /Analyser/ }));
  view.rerender(<UploadPage />);
  return view;
}

describe('Import de relevés — suivi pendant l’analyse (L110)', () => {
  beforeEach(() => {
    state.isPending = false;
    state.logs = [];
  });

  it('R7 — un seul fichier est « Claude analyse… » ; les autres attendent', async () => {
    const view = await startUpload('a.pdf', 'b.pdf', 'c.pdf');
    state.logs = [log('1', 'a.pdf', 'success', '2026-10-22T10:00:00Z'), log('2', 'b.pdf', 'in-progress', '2026-10-22T10:01:00Z')];
    view.rerender(<UploadPage />);
    const list = screen.getByRole('list', { name: 'Fichiers en cours d’analyse' });
    expect(list.textContent!.match(/Claude analyse…/g)).toHaveLength(1);
    expect(list.textContent).toContain('En attente');
    expect(list.textContent).toContain('Fait');
  });

  it('R8 — le bouton annonce « fichier k / N »', async () => {
    const view = await startUpload('a.pdf', 'b.pdf', 'c.pdf');
    state.logs = [log('1', 'a.pdf', 'success', '2026-10-22T10:00:00Z'), log('2', 'b.pdf', 'in-progress', '2026-10-22T10:01:00Z')];
    view.rerender(<UploadPage />);
    expect(screen.getByRole('button', { name: /Analyse en cours/ })).toHaveTextContent('fichier 2 / 3');
  });

  it('R9 — « Vider » et « Parcourir » sont désactivés pendant l’analyse, la liste reste', async () => {
    await startUpload('a.pdf', 'b.pdf');
    expect((screen.getByRole('button', { name: 'Vider' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Parcourir' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('a.pdf')).toBeTruthy();
    expect(screen.getByText('b.pdf')).toBeTruthy();
  });

  it('R10 — un fichier déposé pendant l’analyse n’efface pas la liste suivie', async () => {
    await startUpload('a.pdf', 'b.pdf');
    const zone = screen.getByText('Glisse-dépose tes PDFs ici').closest('section')!;
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.drop(zone, { dataTransfer: { files: [pdf('c.pdf')] } });
    expect(screen.queryByText('c.pdf')).toBeNull();
    expect(screen.getByText('a.pdf')).toBeTruthy();
  });
});
