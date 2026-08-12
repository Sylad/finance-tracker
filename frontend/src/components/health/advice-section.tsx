import { Loader2, Sparkles } from 'lucide-react';
import { useHealthAdvice, useGenerateAdvice } from '@/lib/queries';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/utils';

/**
 * Section « Conseils personnalisés » de /health.
 * Au montage, `useHealthAdvice` (GET, cache) affiche le dernier lot de
 * conseils généré s'il existe (204 tant qu'aucune génération n'a eu lieu).
 * Le bouton déclenche `useGenerateAdvice` (POST, 30-90s sur Ollama local) ;
 * son `onSuccess` réécrit le cache de la query GET (voir queries.ts), donc
 * `advice.data` reflète directement le résultat frais sans étape en plus ici.
 */
export function AdviceSection() {
  const advice = useHealthAdvice();
  const generate = useGenerateAdvice();

  const data = advice.data;
  const sorted = data ? [...data.advices].sort((a, b) => a.priority - b.priority) : [];

  return (
    <div className="card p-5 mt-6">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="stat-label flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" /> Conseils personnalisés
        </div>
        <button
          type="button"
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          className="btn-primary text-sm"
        >
          {generate.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {generate.isPending ? 'Génération en cours sur la 5090…' : 'Générer les conseils (IA locale)'}
        </button>
      </div>

      {generate.isError && (
        <div className="card p-4 mb-3 bg-negative/10 border-l-4 border-l-negative">
          <div className="font-display font-semibold text-fg-bright mb-1">
            Conseils indisponibles — Ollama éteint ?
          </div>
          <p className="text-sm text-fg-muted">
            {generate.error instanceof ApiError ? generate.error.message : (generate.error as Error)?.message}
          </p>
        </div>
      )}

      {data ? (
        <>
          <div className="space-y-4">
            {sorted.map((a, i) => (
              <div key={`${a.priority}-${i}`} className={i > 0 ? 'pt-4 border-t border-border' : undefined}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="font-semibold text-sm text-fg-bright">{a.title}</div>
                  <span className="badge-neutral shrink-0">{a.estimatedImpact}</span>
                </div>
                <p className="text-sm text-fg-muted mt-1">{a.explanation}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-fg-dim mt-4">
            Générés le {formatDate(data.generatedAt)} avec {data.model}
          </p>
        </>
      ) : (
        !generate.isPending &&
        !generate.isError && (
          <p className="text-sm text-fg-dim italic">
            Aucun conseil généré pour l'instant. Clique sur « Générer les conseils » pour une analyse
            personnalisée par l'IA locale (peut prendre 30 à 90 secondes).
          </p>
        )
      )}
    </div>
  );
}
