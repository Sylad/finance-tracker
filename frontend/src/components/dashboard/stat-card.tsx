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
    <div className="card p-5">
      <div className="stat-label flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div
        className={cn(
          'mt-2 font-display tabular font-semibold tracking-tight',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
          !tone && 'text-fg-bright',
        )}
        style={{ fontSize: 26 }}
      >
        {value}
      </div>
    </div>
  );
}
