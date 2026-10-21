/** Marqueur carré des points de « Sorties » : la forme les distingue d'« Entrées » (WCAG 1.4.1). */
export function SquareDot({ cx, cy, stroke }: { cx?: number; cy?: number; stroke?: string }) {
  if (cx === undefined || cy === undefined) return null;
  return <rect x={cx - 3} y={cy - 3} width={6} height={6} fill="hsl(var(--surface))" stroke={stroke} strokeWidth={2} />;
}
