import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AboutPage } from './about';

describe('<AboutPage /> — revue UX L39', () => {
  it('R1 — chaque lien externe annonce l’ouverture dans un nouvel onglet', () => {
    const { container } = render(<AboutPage />);
    const external = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]'));
    expect(external.length).toBeGreaterThanOrEqual(10);
    for (const a of external) {
      expect(within(a).getByText(/nouvel onglet/i), a.href).toHaveClass('sr-only');
      expect(a.rel).toContain('noopener');
    }
  });

  it('R2 — les liens du récit se distinguent du texte autrement que par la couleur, tous de la même couleur', () => {
    render(<AboutPage />);
    const inline = [screen.getByRole('link', { name: /Claude Code/ }), screen.getByRole('link', { name: /ChatGPT/ })];
    for (const a of inline) expect(a).toHaveClass('underline');
    expect(inline[0].className.match(/text-[a-z-]+/)?.[0]).toBe(inline[1].className.match(/text-[a-z-]+/)?.[0]);
  });

  it('R3 — plan de titres : un h1, les sections en h2, aucun saut vers h3', () => {
    render(<AboutPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'L\'histoire courte', 'Frontend', 'Backend', 'Infra', 'Sources d\'inspiration', 'Mes autres sites',
    ]);
  });

  it('R4 — aucun texte sous 12 px (auteurs des inspirations, pied de page)', () => {
    const { container } = render(<AboutPage />);
    expect(container.innerHTML).not.toMatch(/text-\[(?:[0-9]|1[01])px\]/);
  });

  it('R5 — au téléphone, le logo passe au-dessus du récit au lieu de lui prendre de la largeur', () => {
    render(<AboutPage />);
    const story = screen.getByRole('heading', { name: 'L\'histoire courte' }).parentElement!.parentElement!;
    expect(story).toHaveClass('flex-col');
    expect(story).toHaveClass('sm:flex-row');
  });
});
