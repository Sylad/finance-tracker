/** Marqueur carré des points de « Sorties » : la forme les distingue d'« Entrées » (WCAG 1.4.1). */
export function SquareDot({ cx, cy, stroke }: { cx?: number; cy?: number; stroke?: string }) {
  if (cx === undefined || cy === undefined) return null;
  return <rect x={cx - 3} y={cy - 3} width={6} height={6} fill="hsl(var(--surface))" stroke={stroke} strokeWidth={2} />;
}

const ENTREES_STROKE = 'hsl(160 84% 50%)';
const SORTIES_STROKE = 'hsl(0 84% 60%)';

/** Légende du « Cash flow mensuel » : reproduit le trait et le marqueur de chaque courbe (WCAG 1.4.1). */
export function CashFlowLegend() {
  return (
    <ul data-testid="cashflow-legend" className="mt-1 flex justify-center gap-4 text-[11px] text-fg-dim">
      <li className="flex items-center gap-1.5">
        <svg width={24} height={10} aria-hidden="true">
          <line x1={0} y1={5} x2={24} y2={5} stroke={ENTREES_STROKE} strokeWidth={2} />
          <circle cx={12} cy={5} r={3} fill="hsl(var(--surface))" stroke={ENTREES_STROKE} strokeWidth={2} />
        </svg>
        Entrées
      </li>
      <li className="flex items-center gap-1.5">
        <svg width={24} height={10} aria-hidden="true">
          <line x1={0} y1={5} x2={24} y2={5} stroke={SORTIES_STROKE} strokeWidth={2} strokeDasharray="6 4" />
          <rect x={9} y={2} width={6} height={6} fill="hsl(var(--surface))" stroke={SORTIES_STROKE} strokeWidth={2} />
        </svg>
        Sorties
      </li>
    </ul>
  );
}
