import { cn } from '@/lib/utils';

export function ScoreRing({
  score,
  size = 120,
  strokeWidth = 10,
  className,
}: {
  score: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const dash = c * (1 - pct / 100);

  const tone =
    score >= 75 ? 'text-positive' :
    score >= 50 ? 'text-info' :
    score >= 30 ? 'text-warning' :
    'text-negative';

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--surface-3))"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={c}
          strokeDashoffset={dash}
          strokeLinecap="round"
          className={cn('transition-all duration-500', tone)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className={cn('font-display font-bold tabular leading-none', tone)} style={{ fontSize: size * 0.32 }}>
          {Math.round(score)}
        </div>
        <div className="stat-label mt-1" style={{ fontSize: size * 0.08 }}>/ 100</div>
      </div>
    </div>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 75 ? 'badge-positive' :
    score >= 50 ? 'badge-info' :
    score >= 30 ? 'badge-warning' :
    'badge-negative';

  return <span className={cn(tone, 'tabular')}>{Math.round(score)}</span>;
}
