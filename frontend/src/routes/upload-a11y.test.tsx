import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadPage } from './upload';

const state = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...p }: { children: React.ReactNode }) => <a {...(p as object)}>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/lib/queries', () => ({
  useUploadStatements: () => ({ mutateAsync: state.mutateAsync, isPending: state.isPending }),
  useImportLogs: () => ({ data: [] }),
}));

const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' });

async function pick(...names: string[]) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  await userEvent.upload(input, names.map(pdf));
}

describe("Import de relevés — lecteur d'écran et focus (L107)", () => {
  beforeEach(() => {
    state.isPending = false;
    state.mutateAsync = vi.fn();
  });

  it('R1 — chaque bouton « retirer » porte le nom du fichier', async () => {
    render(<UploadPage />);
    await pick('janvier.pdf', 'fevrier.pdf');
    expect(screen.getByRole('button', { name: 'Retirer janvier.pdf' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retirer fevrier.pdf' })).toBeTruthy();
  });

  it('R2 — après un retrait, le focus passe au « retirer » suivant, puis au précédent, puis à Parcourir', async () => {
    render(<UploadPage />);
    await pick('a.pdf', 'b.pdf', 'c.pdf');
    await userEvent.click(screen.getByRole('button', { name: 'Retirer b.pdf' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Retirer c.pdf' })));
    await userEvent.click(screen.getByRole('button', { name: 'Retirer c.pdf' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Retirer a.pdf' })));
    await userEvent.click(screen.getByRole('button', { name: 'Retirer a.pdf' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Parcourir' })));
  });

  it('R8 — après « Vider », le focus passe à Parcourir (pas sur body)', async () => {
    render(<UploadPage />);
    await pick('a.pdf', 'b.pdf', 'c.pdf');
    await userEvent.click(screen.getByRole('button', { name: 'Vider' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Parcourir' })));
  });

  it('R3 — au clic sur Analyser, le focus va à la région de statut (pas sur body)', async () => {
    state.mutateAsync = vi.fn().mockResolvedValue({ succeeded: [], skipped: [], failed: [] });
    render(<UploadPage />);
    await pick('a.pdf');
    await userEvent.click(screen.getByRole('button', { name: /Analyser 1 relevé/ }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('status')));
  });

  it("R4 — le résultat est annoncé dans la région de statut avec les compteurs", async () => {
    state.mutateAsync = vi.fn().mockResolvedValue({ succeeded: [], skipped: [{ filename: 'a.pdf', reason: 'déjà importé' }], failed: [] });
    render(<UploadPage />);
    await pick('a.pdf');
    await userEvent.click(screen.getByRole('button', { name: /Analyser 1 relevé/ }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Analyse terminée : 0 importé, 1 ignoré, 0 échec.'),
    );
  });

  it('R5 — les échecs sont annoncés par role=alert', async () => {
    state.mutateAsync = vi.fn().mockResolvedValue({ succeeded: [], skipped: [], failed: [{ filename: 'a.pdf', error: 'illisible' }] });
    render(<UploadPage />);
    await pick('a.pdf');
    await userEvent.click(screen.getByRole('button', { name: /Analyser 1 relevé/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('illisible'));
  });

  it('R6 — « Connexion fermée » est annoncée dans la région de statut', async () => {
    state.mutateAsync = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    render(<UploadPage />);
    await pick('a.pdf');
    await userEvent.click(screen.getByRole('button', { name: /Analyser 1 relevé/ }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Connexion fermée'));
  });

  it("R7 — l'analyse en cours est annoncée", async () => {
    state.isPending = true;
    render(<UploadPage />);
    await pick('a.pdf');
    expect(screen.getByRole('status')).toHaveTextContent('Analyse en cours');
  });
});
