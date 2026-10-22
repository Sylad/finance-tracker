import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadPage } from './upload';
import { ApiError } from '@/lib/api';

const state = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...p }: { children: React.ReactNode; to: string; params?: Record<string, string> }) => (
    <a href={params ? to.replace('$id', params.id) : to} {...(p as object)}>{children}</a>
  ),
}));
vi.mock('@/components/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <header><h1>{title}</h1></header>,
}));
vi.mock('@/lib/queries', () => ({
  useUploadStatements: () => ({ mutateAsync: state.mutateAsync, isPending: false }),
  useImportLogs: () => ({ data: [] }),
}));

function pdf(name: string) {
  return new File(['x'], name, { type: 'application/pdf' });
}

async function sendFiles(...names: string[]) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: names.map(pdf) } });
  await userEvent.click(screen.getByRole('button', { name: /Analyser/ }));
}

describe('Import de relevés — résultat fichier par fichier (L109)', () => {
  beforeEach(() => {
    state.mutateAsync = vi.fn();
  });

  it('R5 — un 422 affiche chaque fichier avec sa raison, jamais « upload »', async () => {
    state.mutateAsync.mockRejectedValue(new ApiError(422, "Aucun relevé n'a pu être analysé", {
      errors: [
        { filename: 'a.pdf', error: 'Document non reconnu' },
        { filename: 'b.pdf', error: 'Analyse échouée : JSON tronqué' },
      ],
    }));
    render(<UploadPage />);
    await sendFiles('a.pdf', 'b.pdf');
    const alerts = await screen.findAllByRole('alert');
    const text = alerts.map((a) => a.textContent).join(' | ');
    expect(text).toContain('a.pdf');
    expect(text).toContain('Document non reconnu');
    expect(text).toContain('b.pdf');
    expect(text).toContain('JSON tronqué');
    expect(text).not.toContain('upload');
  });

  it('R6 — une erreur 500 est écrite en français, sans « Internal server error »', async () => {
    state.mutateAsync.mockRejectedValue(new ApiError(500, 'Internal server error'));
    render(<UploadPage />);
    await sendFiles('a.pdf');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('a.pdf');
    expect(alert).toHaveTextContent('Le serveur a rencontré une erreur');
    expect(document.body.textContent).not.toMatch(/internal server error/i);
  });

  it('R7 — un fichier ignoré est nommé avec « déjà importé : <mois> » et un lien vers le relevé', async () => {
    state.mutateAsync.mockResolvedValue({
      succeeded: [],
      skipped: [{ filename: 'releve_2026-03.pdf', statementId: '2026-03' }],
      failed: [],
    });
    render(<UploadPage />);
    await sendFiles('releve_2026-03.pdf');
    const row = (await screen.findByText(/déjà importé/)).closest('div') as HTMLElement;
    expect(row).toHaveTextContent('releve_2026-03.pdf');
    expect(row).toHaveTextContent('déjà importé : Mars 2026');
    const link = within(row).getByRole('link');
    expect(link.getAttribute('href')).toBe('/history/2026-03');
  });
});
