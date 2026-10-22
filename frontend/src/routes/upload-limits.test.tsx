import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadPage } from './upload';

const state = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...p }: { children: React.ReactNode }) => <a {...(p as object)}>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({
  PageHeader: ({ title, subtitle }: { title: string; subtitle?: string }) => <header><h1>{title}</h1><p>{subtitle}</p></header>,
}));
vi.mock('@/lib/queries', () => ({
  useUploadStatements: () => ({ mutateAsync: state.mutateAsync, isPending: false }),
  useImportLogs: () => ({ data: [] }),
}));

function file(name: string, size = 1000, type = 'application/pdf') {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function pick(...files: File[]) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

describe('Import de relevés — contrôle à la sélection (L108)', () => {
  beforeEach(() => {
    state.mutateAsync = vi.fn();
  });

  it('R6 — la limite de 20 Mo est écrite dans la consigne de la page', () => {
    render(<UploadPage />);
    expect(screen.getByText(/20 Mo/)).toBeTruthy();
  });

  it('R7 — chaque fichier écarté est nommé avec sa raison dans une alerte, le reste est gardé', () => {
    render(<UploadPage />);
    pick(file('notes.txt', 10, 'text/plain'), file('gros.pdf', 25 * 1024 * 1024), file('ok.pdf'));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('notes.txt');
    expect(alert).toHaveTextContent("ce n'est pas un PDF");
    expect(alert).toHaveTextContent('gros.pdf');
    expect(alert).toHaveTextContent('dépasse 20 Mo (25,0 Mo)');
    expect(screen.getByRole('button', { name: 'Retirer ok.pdf' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retirer gros.pdf' })).toBeNull();
  });

  it('R8 — à 12/12, Parcourir est désactivé et la liste pleine est dite', () => {
    render(<UploadPage />);
    pick(...Array.from({ length: 12 }, (_, i) => file(`r${i}.pdf`, 100 + i)));
    const browse = screen.getByRole('button', { name: 'Parcourir' }) as HTMLButtonElement;
    expect(browse.disabled).toBe(true);
    expect(screen.getByText(/12 \/ 12 fichiers/)).toBeTruthy();
    expect(screen.getByText(/liste est pleine/i)).toBeTruthy();
  });

  it('R8 — retirer un fichier réactive Parcourir', async () => {
    render(<UploadPage />);
    pick(...Array.from({ length: 12 }, (_, i) => file(`r${i}.pdf`, 100 + i)));
    await userEvent.click(screen.getByRole('button', { name: 'Retirer r0.pdf' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Parcourir' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('R9 — un excédent glissé sur une liste pleine est nommé', () => {
    render(<UploadPage />);
    pick(...Array.from({ length: 12 }, (_, i) => file(`r${i}.pdf`, 100 + i)));
    const zone = screen.getByRole('heading', { level: 3 }).closest('section') as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [file('trop.pdf', 7)] } });
    expect(screen.getByRole('alert')).toHaveTextContent('trop.pdf');
    expect(screen.getByRole('alert')).toHaveTextContent('liste est pleine');
  });

  it("R10 — l'alerte disparaît à la sélection suivante sans refus", () => {
    render(<UploadPage />);
    pick(file('notes.txt', 10, 'text/plain'));
    expect(screen.queryByRole('alert')).not.toBeNull();
    pick(file('bon.pdf'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
