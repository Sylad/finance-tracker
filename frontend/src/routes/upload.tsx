import { useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Upload as UploadIcon, FileText, X, CheckCircle2, AlertCircle, Loader2, History as HistoryIcon, ExternalLink } from 'lucide-react';
import { useUploadStatements, useImportLogs } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import type { UploadResult } from '@/types/api';
import { cn, formatEUR, formatMonth } from '@/lib/utils';

const MAX = 12;

export function UploadPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useUploadStatements();

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list).filter((f) => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    setFiles((prev) => {
      const merged = [...prev];
      for (const f of incoming) {
        if (!merged.some((m) => m.name === f.name && m.size === f.size)) merged.push(f);
        if (merged.length >= MAX) break;
      }
      return merged;
    });
  };

  const [connectionLost, setConnectionLost] = useState(false);

  const handleSubmit = async () => {
    if (files.length === 0) return;
    setResult(null);
    setConnectionLost(false);
    try {
      const r = await upload.mutateAsync(files);
      setResult(r);
      setFiles([]);
    } catch (e) {
      const msg = String((e as Error).message);
      // Connexion coupée (timeout nginx 504, déconnexion réseau, rebuild conteneur…)
      // → ne PAS afficher comme échec : le backend traite peut-être encore.
      // L'historique des imports en bas montre l'état réel via polling 5s.
      if (msg.includes('504') || msg.toLowerCase().includes('failed to fetch')) {
        setConnectionLost(true);
        setFiles([]);
      } else {
        setResult({
          succeeded: [],
          skipped: [],
          failed: [{ filename: 'upload', error: msg }],
        });
      }
    }
  };

  return (
    <>
      <PageHeader
        title="Importer des relevés"
        subtitle={`Glisse jusqu'à ${MAX} PDFs. Claude analyse chaque relevé : extraction, classification, scoring, narratif. Comptez 30-60s par fichier.`}
      />

      <section
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        className={cn(
          'card border-2 border-dashed p-10 text-center transition-colors mb-6',
          dragOver ? 'border-accent bg-accent/5' : 'border-border',
        )}
      >
        <UploadIcon className={cn('h-10 w-10 mx-auto mb-4', dragOver ? 'text-accent' : 'text-fg-dim')} />
        <h3 className="font-display text-lg font-semibold text-fg-bright mb-1">
          Glisse-dépose tes PDFs ici
        </h3>
        <p className="text-sm text-fg-muted mb-5">
          ou clique pour parcourir · {files.length} / {MAX} fichiers sélectionnés
        </p>
        <button onClick={() => fileInput.current?.click()} className="btn-secondary">
          Parcourir
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </section>

      {files.length > 0 && (
        <section className="card divide-y divide-border mb-6">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <FileText className={cn('h-4 w-4 shrink-0', upload.isPending ? 'text-accent-bright' : 'text-fg-dim')} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-fg-bright truncate">{f.name}</div>
                  <div className="text-xs text-fg-dim tabular">
                    {(f.size / 1024).toFixed(0)} Ko {upload.isPending && '· Claude analyse…'}
                  </div>
                </div>
                {upload.isPending ? (
                  <Loader2 className="h-4 w-4 text-accent-bright animate-spin" />
                ) : (
                  <button
                    onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                    className="btn-ghost p-1.5"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {upload.isPending && <div className="shimmer-bar mt-2" />}
            </div>
          ))}
          <div className="px-4 py-3 bg-surface-2 flex items-center justify-between">
            <span className="text-xs text-fg-muted">{files.length} fichier{files.length > 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setFiles([])} className="btn-secondary">Vider</button>
              <button onClick={handleSubmit} disabled={upload.isPending} className="btn-primary">
                {upload.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Analyse en cours…</> : <>Analyser {files.length} relevé{files.length > 1 ? 's' : ''}</>}
              </button>
            </div>
          </div>
        </section>
      )}

      {connectionLost && (
        <section className="card p-4 mb-6 border-l-4 border-l-warning bg-warning/5">
          <div className="flex items-start gap-3">
            <Loader2 className="h-5 w-5 text-warning shrink-0 mt-0.5 animate-spin" />
            <div className="flex-1">
              <div className="font-medium text-fg-bright">Connexion fermée — l'analyse continue côté serveur</div>
              <div className="text-xs text-fg-muted mt-1 leading-relaxed">
                La requête a été coupée (souvent un timeout réseau pour les uploads longs), mais Claude continue à traiter tes PDFs en arrière-plan.
                Suis l'historique des imports ci-dessous : il se rafraîchit toutes les 5 secondes et tu verras chaque fichier passer de "Analyse en cours" à son résultat final.
              </div>
            </div>
          </div>
        </section>
      )}
      {result && <UploadReport result={result} />}
      <ImportHistory />
    </>
  );
}

function UploadReport({ result }: { result: UploadResult }) {
  const ok = result.succeeded.length;
  const skipped = result.skipped.length;
  const failed = result.failed.length;
  return (
    <section className="card p-5 animate-fade-in">
      <div className="stat-label mb-3">Résultat de l'analyse</div>
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Stat label="Importés" value={ok} tone="positive" />
        <Stat label="Ignorés" value={skipped} tone="neutral" />
        <Stat label="Échecs" value={failed} tone="negative" />
      </div>

      {result.succeeded.length > 0 && (
        <div className="space-y-2 mb-4">
          {result.succeeded.map((s) => (
            <div key={s.statement.id} className="flex items-center gap-3 text-sm">
              <CheckCircle2 className="h-4 w-4 text-positive shrink-0" />
              <Link
                to="/history/$id"
                params={{ id: s.statement.id }}
                className="flex-1 text-fg hover:text-accent-bright truncate"
              >
                {s.filename}
              </Link>
              <span className="text-xs text-fg-dim tabular">
                {formatEUR(s.statement.closingBalance)}
              </span>
              {s.replaced && <span className="badge-warning">remplacé</span>}
            </div>
          ))}
        </div>
      )}
      {result.failed.map((f, i) => (
        <div key={i} className="flex items-start gap-3 text-sm text-negative">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">{f.filename}</div>
            <div className="text-xs text-fg-muted">{f.error}</div>
          </div>
        </div>
      ))}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'positive' | 'negative' | 'neutral' }) {
  const cls = tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : 'text-fg-bright';
  return (
    <div className="bg-surface-2 rounded p-3 text-center">
      <div className={cn('font-display text-2xl font-bold tabular', cls)}>{value}</div>
      <div className="stat-label mt-1">{label}</div>
    </div>
  );
}

function ImportHistory() {
  const { data } = useImportLogs();
  const items = (data ?? []).slice(0, 20);
  if (items.length === 0) return null;
  const inProgressCount = items.filter((it) => it.status === 'in-progress').length;
  return (
    <section className="card p-5 mt-6">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <HistoryIcon className="h-4 w-4 text-fg-dim" />
          <div className="stat-label">Historique des imports ({items.length})</div>
        </div>
        {inProgressCount > 0 && (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent/10 border border-accent/30 text-accent-bright text-xs font-medium">
            <Loader2 className="h-3 w-3 animate-spin" />
            {inProgressCount} analyse{inProgressCount > 1 ? 's' : ''} en cours
          </div>
        )}
      </div>
      <div className="divide-y divide-border">
        {items.map((it) => (
          <div key={it.id} className={cn(
            'flex items-center gap-3 py-2.5 text-sm relative',
            it.status === 'in-progress' && 'bg-accent/5 -mx-5 px-5',
          )}>
            {it.status === 'in-progress' && <Loader2 className="h-4 w-4 text-accent-bright shrink-0 animate-spin" />}
            {it.status === 'success' && <CheckCircle2 className="h-4 w-4 text-positive shrink-0" />}
            {it.status === 'error' && <AlertCircle className="h-4 w-4 text-negative shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="text-fg-bright truncate">{it.filename}</div>
              <div className="text-xs text-fg-dim">
                {new Date(it.uploadedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                {it.status === 'in-progress' && (
                  <> · <span className="text-accent-bright">Claude analyse… ({Math.round((Date.now() - new Date(it.uploadedAt).getTime()) / 1000)}s)</span></>
                )}
                {it.status !== 'in-progress' && <> · {(it.durationMs / 1000).toFixed(1)}s</>}
                {it.status === 'success' && it.statementMonth && it.statementYear && (
                  <> · <span className="text-accent-bright">{formatMonth(it.statementMonth, it.statementYear)}</span></>
                )}
                {it.status === 'success' && it.replaced && <> · <span className="text-warning">remplacé</span></>}
                {it.status === 'error' && <> · <span className="text-negative">{it.error}</span></>}
              </div>
            </div>
            {it.status === 'in-progress' && <div className="shimmer-bar absolute left-5 right-5 bottom-0" />}
            {it.status === 'success' && it.statementId && (
              <Link
                to="/history/$id"
                params={{ id: it.statementId }}
                className="btn-ghost p-1.5"
                title="Voir le relevé"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
