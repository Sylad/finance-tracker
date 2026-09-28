import { cn } from '@/lib/utils';

export function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className="card p-4">
      <div className="stat-label flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div
        className={cn(
          'mt-1.5 font-display tabular font-semibold tracking-tight text-[22px] leading-tight',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
          !tone && 'text-fg-bright',
        )}
      >
        {value}
      </div>
    </div>
  );
}
