import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search, Calendar, LayoutDashboard, History as HistoryIcon, Wallet, PiggyBank,
  Banknote, Zap, Repeat, ListChecks, CalendarRange, CalendarDays, Tags, Upload,
  Info, RefreshCw, Sparkles,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { StatementSummary } from '@/types/api';
import { cn } from '@/lib/utils';

type Action = {
  id: string;
  label: string;
  hint?: string;
  icon: typeof Search;
  group: 'navigation' | 'mois' | 'actions';
  perform: () => void | Promise<void>;
};

const NAV: Array<{ to: string; label: string; icon: typeof Search }> = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/history', label: 'Historique', icon: HistoryIcon },
  { to: '/budget', label: 'Budget', icon: Wallet },
  { to: '/savings', label: 'Comptes épargne', icon: PiggyBank },
  { to: '/loans', label: 'Crédits', icon: Banknote },
  { to: '/subscriptions', label: 'Abonnements', icon: Zap },
  { to: '/income', label: 'Revenus', icon: Repeat },
  { to: '/declarations', label: 'Déclarations', icon: ListChecks },
  { to: '/forecast', label: 'Prévisions', icon: CalendarRange },
  { to: '/yearly', label: 'Bilan annuel', icon: CalendarDays },
  { to: '/category-rules', label: 'Catégorisation', icon: Tags },
  { to: '/upload', label: 'Importer', icon: Upload },
  { to: '/about', label: 'À propos', icon: Info },
];

const MONTH_LABELS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { data: statements } = useQuery<StatementSummary[]>({
    queryKey: ['statements'],
    queryFn: () => api.get<StatementSummary[]>('/statements'),
    enabled: open,
  });

  const rescore = useMutation({
    mutationFn: () => api.post('/statements/rescore-all'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['statements'] });
      qc.invalidateQueries({ queryKey: ['statement'] });
    },
  });
  const replayRules = useMutation({
    mutationFn: () => api.post('/category-rules/replay-all'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['statements'] });
      qc.invalidateQueries({ queryKey: ['statement'] });
    },
  });

  // Global keybinding: Cmd+K / Ctrl+K opens, Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Reset query + focus input each time the palette opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const actions: Action[] = useMemo(() => {
    const navActions: Action[] = NAV.map((n) => ({
      id: `nav:${n.to}`,
      label: n.label,
      icon: n.icon,
      group: 'navigation',
      perform: () => { navigate({ to: n.to }); setOpen(false); },
    }));
    const monthActions: Action[] = (statements ?? []).map((s) => ({
      id: `month:${s.id}`,
      label: `${MONTH_LABELS[s.month - 1]} ${s.year}`,
      hint: `${s.bankName} · score ${s.healthScore}`,
      icon: Calendar,
      group: 'mois',
      perform: () => { navigate({ to: '/history/$id', params: { id: s.id } }); setOpen(false); },
    }));
    const adminActions: Action[] = [
      {
        id: 'action:rescore',
        label: 'Recalculer tous les scores',
        hint: 'Applique la formule actuelle, instantané',
        icon: RefreshCw,
        group: 'actions',
        perform: async () => { await rescore.mutateAsync(); setOpen(false); },
      },
      {
        id: 'action:replay-rules',
        label: 'Rejouer les règles de catégorisation',
        hint: 'Réapplique tes règles regex sur tout l\'historique',
        icon: Sparkles,
        group: 'actions',
        perform: async () => { await replayRules.mutateAsync(); setOpen(false); },
      },
    ];
    return [...navActions, ...monthActions, ...adminActions];
  }, [statements, navigate, rescore, replayRules]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) =>
      a.label.toLowerCase().includes(q) ||
      a.hint?.toLowerCase().includes(q),
    );
  }, [actions, query]);

  // Clamp cursor when filter shrinks
  useEffect(() => {
    if (cursor >= filtered.length) setCursor(Math.max(0, filtered.length - 1));
  }, [filtered.length, cursor]);

  const groups = useMemo(() => {
    const byGroup: Record<Action['group'], Action[]> = { navigation: [], mois: [], actions: [] };
    for (const a of filtered) byGroup[a.group].push(a);
    return byGroup;
  }, [filtered]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:pt-32 bg-black/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="card w-full max-w-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-fg-dim shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(filtered.length - 1, c + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                filtered[cursor]?.perform();
              }
            }}
            placeholder="Aller à un mois, une page, lancer une action…"
            className="bg-transparent flex-1 outline-none text-sm text-fg placeholder:text-fg-dim"
          />
          <kbd className="text-[10px] text-fg-dim border border-border rounded px-1.5 py-0.5 hidden sm:inline">esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-auto py-2">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-fg-dim italic">
              Rien trouvé.
            </div>
          )}
          {(['navigation', 'mois', 'actions'] as const).map((g) => groups[g].length > 0 && (
            <div key={g} className="mb-2">
              <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-fg-dim font-semibold">
                {g === 'mois' ? 'Mois' : g === 'navigation' ? 'Navigation' : 'Actions'}
              </div>
              {groups[g].map((a) => {
                const idxInFiltered = filtered.indexOf(a);
                const active = idxInFiltered === cursor;
                const Icon = a.icon;
                return (
                  <button
                    key={a.id}
                    onMouseEnter={() => setCursor(idxInFiltered)}
                    onClick={() => a.perform()}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors',
                      active ? 'bg-accent/15 text-accent-bright' : 'text-fg hover:bg-surface-2',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-fg-muted" />
                    <span className="flex-1 truncate">{a.label}</span>
                    {a.hint && <span className="text-[10px] text-fg-dim truncate max-w-xs">{a.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-border text-[10px] text-fg-dim flex items-center justify-between">
          <span><kbd className="border border-border rounded px-1">↑</kbd> <kbd className="border border-border rounded px-1">↓</kbd> naviguer · <kbd className="border border-border rounded px-1">↵</kbd> sélectionner</span>
          <span><kbd className="border border-border rounded px-1">⌘ K</kbd> / <kbd className="border border-border rounded px-1">Ctrl K</kbd></span>
        </div>
      </div>
    </div>
  );
}
