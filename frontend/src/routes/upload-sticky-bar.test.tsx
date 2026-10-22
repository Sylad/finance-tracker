import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadPage } from './upload';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...p }: { children: React.ReactNode }) => <a {...(p as object)}>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/lib/queries', () => ({
  useUploadStatements: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportLogs: () => ({ data: [] }),
}));

const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' });

async function pick(n: number) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  await userEvent.upload(input, Array.from({ length: n }, (_, i) => pdf(`m${i}.pdf`)));
}

describe("Import de relevés — barre d'actions collante (L111)", () => {
  it("R1 — la barre « Vider / Analyser » reste collée en bas de l'écran pendant qu'on fait défiler 12 fichiers", async () => {
    render(<UploadPage />);
    await pick(12);
    const bar = screen.getByRole('button', { name: /Analyser 12 relevés/ }).closest('[data-actions-bar]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.className).toMatch(/\bsticky\b/);
    expect(bar.className).toMatch(/\bbottom-/);
  });

  it("R2 — au téléphone la barre se cale au-dessus de la barre de navigation du bas (zone sûre comprise), au bureau contre le bord", async () => {
    render(<UploadPage />);
    await pick(2);
    const bar = document.querySelector('[data-actions-bar]') as HTMLElement;
    expect(bar.className).toContain('bottom-[calc(4rem+env(safe-area-inset-bottom))]');
    expect(bar.className).toContain('lg:bottom-0');
  });

  it("R3 — la barre contient le compteur, Vider et Analyser, et reste au-dessus du contenu défilant (z-index)", async () => {
    render(<UploadPage />);
    await pick(3);
    const bar = document.querySelector('[data-actions-bar]') as HTMLElement;
    expect(bar.textContent).toContain('3 fichiers');
    expect(bar.querySelector('button.btn-secondary')?.textContent).toBe('Vider');
    expect(bar.className).toMatch(/\bz-\d+/);
  });

  it("R4 — un bouton « Retirer » focalisé au clavier ne passe pas sous la barre collante (marge de défilement)", async () => {
    render(<UploadPage />);
    await pick(12);
    const remove = screen.getByRole('button', { name: 'Retirer m11.pdf' });
    expect(remove.className).toMatch(/\bscroll-mb-\d+/);
  });
});
