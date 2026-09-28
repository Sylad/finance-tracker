import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreBadge, ScoreRing } from './score-ring';

describe('<ScoreRing />', () => {
  it('renders the rounded score and the / 100 suffix', () => {
    render(<ScoreRing score={73.4} />);
    expect(screen.getByText('73')).toBeInTheDocument();
    expect(screen.getByText('/ 100')).toBeInTheDocument();
  });

  it('clamps the rendered visual to [0, 100] but still shows the raw rounded score', () => {
    render(<ScoreRing score={142} />);
    // The number itself is round(score) — the clamp only affects the dasharray
    expect(screen.getByText('142')).toBeInTheDocument();
  });

  it('uses the positive tone when score >= 75', () => {
    const { container } = render(<ScoreRing score={80} />);
    const tonedNode = container.querySelector('.text-positive');
    expect(tonedNode).not.toBeNull();
  });

  it('uses the negative tone when score < 30', () => {
    const { container } = render(<ScoreRing score={12} />);
    expect(container.querySelector('.text-negative')).not.toBeNull();
  });
});

describe('<ScoreBadge />', () => {
  it('rounds the score and applies the matching badge tone', () => {
    const { container } = render(<ScoreBadge score={62.7} />);
    const span = container.querySelector('span');
    expect(span?.textContent).toBe('63');
    expect(span?.className).toContain('badge-info');
  });
});

describe('<ScoreRing /> petite taille (L21/t12)', () => {
  it('« / 100 » jamais sous 11 px (anneau 96 px : 7,7 px avant)', () => {
    render(<ScoreRing score={75} size={96} />);
    expect(screen.getByText('/ 100')).toHaveStyle({ fontSize: '11px' });
  });
  it('grand anneau : proportionnel (180 px → 14,4 px)', () => {
    render(<ScoreRing score={75} size={180} />);
    expect(screen.getByText('/ 100')).toHaveStyle({ fontSize: '14.4px' });
  });
});
