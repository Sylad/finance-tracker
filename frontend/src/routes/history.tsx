import { Link } from '@tanstack/react-router';
import { ArrowRight, ArrowDownRight, ArrowUpRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useStatements } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/loading-state';
import { ScoreBadge } from '@/components/score-ring';
import { formatEUR, formatMonth } from '@/lib/utils';

export function HistoryPage() {
  const { data, isLoading } = useStatements();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const all = data ?? [];
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter((s) =>
      formatMonth(s.month, s.year).toLowerCase().includes(q) ||
      s.bankName.toLowerCase().includes(q) ||
      s.accountHolder.toLowerCase().includes(q),
    );
  }, [data, query]);

  const grouped = useMemo(() => {
    const map = new Map<number, typeof filtered>();
    for (const s of filtered) {
      const arr = map.get(s.year) ?? [];
      arr.push(s);
      map.set(s.year, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
  }, [filtered]);

  if (isLoading) return <LoadingState />;

  return (
    <>
      <PageHeader
        title="Historique"
        subtitle={`${data?.length ?? 0} relevés analysés. Clique sur un mois pour voir le détail.`}
        actions={
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-dim" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input pl-9 w-64"
            />
          </div>
        }
      />

      {filtered.length === 0 ? (
        <div className="card p-12 text-center text-fg-dim">Aucun relevé.</div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([year, items]) => (
            <div key={year}>
              <h2 className="font-display text-lg font-semibold text-fg-bright mb-3">{year}</h2>
              <div className="card divide-y divide-border">
                {items.map((s) => {
                  const net = s.totalCredits - s.totalDebits;
                  return (
                    <Link
                      key={s.id}
                      to="/history/$id"
                      params={{ id: s.id }}
                      className="grid grid-cols-12 gap-4 items-center px-4 py-3.5 hover:bg-surface-2 transition-colors"
                    >
                      <div className="col-span-3 sm:col-span-2">
                        <div className="text-sm font-medium text-fg-bright">
                          {formatMonth(s.month, s.year).split(' ')[0]}
                        </div>
                        <div className="text-xs text-fg-dim">{s.bankName}</div>
                      </div>
                      <div className="col-span-3 sm:col-span-2 text-positive text-sm tabular flex items-center gap-1">
                        <ArrowUpRight className="h-3 w-3" />
                        {formatEUR(s.totalCredits)}
                      </div>
                      <div className="col-span-3 sm:col-span-2 text-negative text-sm tabular flex items-center gap-1">
                        <ArrowDownRight className="h-3 w-3" />
                        {formatEUR(s.totalDebits)}
                      </div>
                      <div className="hidden sm:block sm:col-span-2 text-sm tabular text-fg">
                        <span className={net >= 0 ? 'text-positive' : 'text-negative'}>
                          {formatEUR(net, true)}
                        </span>
                        <div className="text-[10px] text-fg-dim uppercase tracking-wider mt-0.5">net</div>
                      </div>
                      <div className="hidden sm:block sm:col-span-2 text-sm tabular text-fg-bright">
                        {formatEUR(s.closingBalance)}
                        <div className="text-[10px] text-fg-dim uppercase tracking-wider mt-0.5">solde</div>
                      </div>
                      <div className="col-span-3 sm:col-span-2 flex items-center justify-end gap-2">
                        <ScoreBadge score={s.healthScore} />
                        <ArrowRight className="h-3.5 w-3.5 text-fg-dim" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
