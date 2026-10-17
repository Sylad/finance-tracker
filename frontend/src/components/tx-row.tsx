import { CATEGORY_LABELS, type Transaction, type TransactionCategory } from '@/types/api';
import { formatEUR, formatDate, cn } from '@/lib/utils';
import { recognizeMerchant } from '@/lib/merchants';
import { categoryLabelFr } from '@/lib/category-label';

export const CATEGORY_COLOR: Record<TransactionCategory, string> = {
  income: 'hsl(160 84% 50%)',
  housing: 'hsl(217 91% 60%)',
  transport: 'hsl(45 93% 50%)',
  food: 'hsl(280 85% 65%)',
  health: 'hsl(0 84% 60%)',
  entertainment: 'hsl(330 85% 60%)',
  subscriptions: 'hsl(195 83% 50%)',
  savings: 'hsl(140 70% 45%)',
  transfers: 'hsl(220 12% 50%)',
  taxes: 'hsl(20 90% 55%)',
  other: 'hsl(220 8% 40%)',
};

/**
 * Couleur du TEXTE des puces (L23/t1) : les couleurs ci-dessus restent celles des graphiques.
 * Sur le fond des lignes, « Autre » et « Virements » étaient à 2,95:1 et 4,12:1 (WCAG 1.4.3) et
 * plusieurs teintes saturées frôlaient le seuil : celles-ci sont éclaircies pour passer 4,5:1.
 */
export const CATEGORY_TEXT_COLOR: Record<TransactionCategory, string> = {
  ...CATEGORY_COLOR,
  housing: 'hsl(217 91% 66%)',
  food: 'hsl(280 85% 70%)',
  health: 'hsl(0 84% 67%)',
  entertainment: 'hsl(330 85% 66%)',
  transfers: 'hsl(220 12% 60%)',
  taxes: 'hsl(20 90% 56%)',
  other: 'hsl(220 8% 59%)',
};

function MerchantAvatar({ merchant, fallback }: { merchant: { name: string } | null; fallback: string }) {
  // Pas de logo distant (L69) : carré avec l'initiale, aucune requête tierce.
  const initial = (merchant?.name ?? fallback).trim().match(/[A-Za-z0-9]/)?.[0]?.toUpperCase() ?? '?';
  return (
    <div className="h-6 w-6 rounded shrink-0 flex items-center justify-center bg-surface-2 text-fg-muted text-[10px] font-bold">
      {initial}
    </div>
  );
}

/**
 * Ligne de transaction du relevé détaillé. Sous md (L78) : deux rangées sur une grille
 * [libellé | montant] — libellé tronquable et montant à sa largeur naturelle sur la 1re,
 * date et catégorie sur la 2e — pour que rien ne dépasse à 390 px. Dès md : les 12 colonnes
 * d'origine, sur une seule rangée. À toute largeur (L79), titre et sous-ligne (« · récurrent »
 * compris) passent à la ligne plutôt que d'être rognés par une ellipse.
 */
export function TxRow({ t, onPickCategory }: { t: Transaction; onPickCategory: (t: Transaction) => void }) {
  const positive = t.amount > 0;
  const knownCat = (Object.keys(CATEGORY_LABELS) as TransactionCategory[]).includes(t.category);
  const color = knownCat ? CATEGORY_COLOR[t.category] : 'hsl(220 12% 50%)';
  const textColor = knownCat ? CATEGORY_TEXT_COLOR[t.category] : 'hsl(220 12% 62%)';
  const label = knownCat ? CATEGORY_LABELS[t.category] : t.category;
  const merchant = recognizeMerchant(t.description);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-12 gap-x-3 gap-y-1.5 md:gap-3 items-center px-2 py-2.5 text-sm">
      <div className="row-start-2 col-start-1 md:row-start-auto md:col-start-auto md:col-span-2 text-xs text-fg-dim tabular">{formatDate(t.date)}</div>
      <div className="row-start-1 col-start-1 md:row-start-auto md:col-start-auto md:col-span-5 min-w-0 flex items-center gap-2.5">
        <MerchantAvatar merchant={merchant} fallback={t.description} />
        <div className="min-w-0 flex-1">
          <div className="break-words text-fg font-medium">{merchant?.name ?? t.description}</div>
          <div className="text-[10px] text-fg-dim uppercase tracking-wider mt-0.5 break-words">
            {merchant ? <><span className="normal-case lowercase italic text-fg-dim/80">{t.description}</span>{' '}</> : null}
            {categoryLabelFr(t.subcategory || label)}
            {t.isRecurring && <>{' '}<span className="text-accent-bright">·&nbsp;récurrent</span></>}
          </div>
        </div>
      </div>
      <div className="row-start-2 col-start-2 justify-self-end md:row-start-auto md:col-start-auto md:justify-self-auto md:col-span-2">
        <button
          onClick={() => onPickCategory(t)}
          className="badge text-[10px] cursor-pointer hover:ring-1 hover:ring-accent transition"
          style={{ background: `${color}20`, color: textColor }}
          title="Modifier la catégorie"
        >
          {label}
        </button>
      </div>
      <div className={cn(
        'row-start-1 col-start-2 md:row-start-auto md:col-start-auto md:col-span-3 text-right tabular font-medium',
        positive ? 'text-positive' : 'text-fg-bright',
      )}>
        <span className="whitespace-nowrap md:whitespace-normal">{formatEUR(t.amount, positive)}</span>
        {t.exceptionalAmount != null && t.exceptionalAmount > 0 && (
          <div
            className="w-0 min-w-full md:w-auto md:min-w-0 text-[10px] font-normal text-warning normal-case"
            title="Solde de tout compte, prime ou rappel : cette part n'entre ni dans le score, ni dans le revenu récurrent, ni dans les prévisions"
          >
            dont {formatEUR(t.exceptionalAmount)} exceptionnel
          </div>
        )}
      </div>
    </li>
  );
}
