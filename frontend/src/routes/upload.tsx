import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Upload as UploadIcon, FileText, X, CheckCircle2, AlertCircle, Loader2, History as HistoryIcon, ExternalLink, Info, Clock } from 'lucide-react';
import { useUploadStatements, useImportLogs } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import type { UploadResult } from '@/types/api';
import { cn, formatEUR, formatMonth } from '@/lib/utils';
import { MAX_FILES as MAX, selectStatementFiles, type RejectedFile } from '@/lib/upload-files';
import { failuresFromUploadError, skippedMonthLabel } from '@/lib/upload-report';
import { fileProgress, type FileState } from '@/lib/upload-progress';

const STATE_LABEL: Record<FileState, string> = { waiting: 'En attente', running: 'Claude analyse…', done: 'Fait' };

export function UploadPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const browseButton = useRef<HTMLButtonElement>(null);
  const statusRegion = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);
  // Index du fichier retiré : le focus passe au « retirer » qui prend sa place.
  const [removedAt, setRemovedAt] = useState<number | null>(null);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const upload = useUploadStatements();
  const { data: importLogs } = useImportLogs();
  // Journaux déjà présents à l'envoi : seuls les nouveaux disent où en est l'analyse.
  const knownLogIds = useRef<Set<string>>(new Set());
  const progress = upload.isPending
    ? fileProgress(files.map((f) => f.name), importLogs ?? [], knownLogIds.current)
    : null;

  const addFiles = (list: FileList | null) => {
    // Pendant l'analyse, la liste suivie ne change plus.
    if (!list || upload.isPending) return;
    const { accepted, rejected: refused } = selectStatementFiles(files, Array.from(list));
    // Parcourir se désactive à 12/12 : s'il avait le focus, il passe au premier « Retirer » (WCAG 2.4.3).
    if (accepted.length >= MAX && document.activeElement === browseButton.current) setRemovedAt(0);
    setFiles(accepted);
    setRejected(refused);
  };

  const [connectionLost, setConnectionLost] = useState(false);

  useEffect(() => {
    if (removedAt === null) return;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-remove]');
    const target = buttons && buttons.length > 0 ? buttons[Math.min(removedAt, buttons.length - 1)] : browseButton.current;
    target?.focus();
    setRemovedAt(null);
  }, [removedAt, files]);

  const removeFile = (i: number) => {
    setFiles((p) => p.filter((_, j) => j !== i));
    setRemovedAt(i);
  };

  const clearFiles = () => {
    setFiles([]);
    setRejected([]);
    setRemovedAt(0);
  };

  const handleSubmit = async () => {
    if (files.length === 0) return;
    // Le bouton se désactive puis disparaît avec la liste : le focus va à la région de statut.
    statusRegion.current?.focus();
    setResult(null);
    setRejected([]);
    setConnectionLost(false);
    const filenames = files.map((f) => f.name);
    knownLogIds.current = new Set((importLogs ?? []).map((l) => l.id));
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
          failed: failuresFromUploadError(e, filenames),
        });
      }
    }
  };

  return (
    <>
      <PageHeader
        title="Importer des relevés"
        subtitle={`Glisse jusqu'à ${MAX} PDFs de 20 Mo maximum chacun. Claude analyse chaque relevé : extraction, classification, scoring, narratif. Comptez 30-60s par fichier.`}
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
          {files.length >= MAX && ' · la liste est pleine : retire un fichier pour en ajouter'}
        </p>
        <button ref={browseButton} onClick={() => fileInput.current?.click()} disabled={files.length >= MAX || upload.isPending} className="btn-secondary">
          Parcourir
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
      </section>

      {rejected.length > 0 && (
        <section role="alert" className="card p-4 mb-6 border-l-4 border-l-warning bg-warning/5">
          <div className="font-medium text-fg-bright mb-2">
            {rejected.length} fichier{rejected.length > 1 ? 's' : ''} non ajouté{rejected.length > 1 ? 's' : ''}
          </div>
          <ul className="text-sm space-y-1">
            {rejected.map((r, i) => (
              <li key={`${r.name}-${i}`}>
                <span className="text-fg-bright">{r.name}</span> <span className="text-fg-muted">: {r.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {files.length > 0 && (
        <>
        <section ref={listRef} className="card divide-y divide-border rounded-b-none">
          <div role="list" aria-label={upload.isPending ? 'Fichiers en cours d’analyse' : 'Fichiers sélectionnés'} className="divide-y divide-border">
          {files.map((f, i) => {
            const st = progress?.states[i];
            return (
            <div key={`${f.name}-${i}`} role="listitem" className="px-4 py-3">
              <div className="flex items-center gap-3">
                <FileText className={cn('h-4 w-4 shrink-0', st === 'running' ? 'text-accent-bright' : 'text-fg-dim')} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-fg-bright truncate">{f.name}</div>
                  <div className="text-xs text-fg-dim tabular">
                    {(f.size / 1024).toFixed(0)} Ko {st && `· ${STATE_LABEL[st]}`}
                  </div>
                </div>
                {st === 'running' ? (
                  <Loader2 className="h-4 w-4 text-accent-bright animate-spin" aria-hidden="true" />
                ) : st === 'done' ? (
                  <CheckCircle2 className="h-4 w-4 text-positive" aria-hidden="true" />
                ) : st === 'waiting' ? (
                  <Clock className="h-4 w-4 text-fg-dim" aria-hidden="true" />
                ) : (
                  <button
                    onClick={() => removeFile(i)}
                    data-remove
                    aria-label={`Retirer ${f.name}`}
                    // scroll-mb-40 : le focus clavier ne passe pas sous la barre collante (WCAG 2.4.11).
                    className="btn-ghost p-1.5 scroll-mb-40"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
              {st === 'running' && <div className="shimmer-bar mt-2" />}
            </div>
            );
          })}
          </div>
        </section>
        <div
          data-actions-bar
          className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 z-30 px-4 py-3 mb-6 bg-surface-2 border border-t-0 border-border rounded-b-lg shadow-[0_-4px_12px_rgba(0,0,0,0.25)] flex flex-wrap items-center justify-between gap-2"
        >
          <span className="text-xs text-fg-muted">{files.length} fichier{files.length > 1 ? 's' : ''}</span>
          <div className="flex items-center gap-2">
            <button onClick={clearFiles} disabled={upload.isPending} className="btn-secondary">Vider</button>
            <button onClick={handleSubmit} disabled={upload.isPending} className="btn-primary">
              {upload.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Analyse en cours… fichier {progress?.current} / {progress?.total}</> : <>Analyser {files.length} relevé{files.length > 1 ? 's' : ''}</>}
            </button>
          </div>
        </div>
      </>
      )}

      <div ref={statusRegion} role="status" tabIndex={-1} className="outline-none">
        {progress && <p className="sr-only">Analyse en cours… fichier {progress.current} / {progress.total}.</p>}
        {result && (
          <p className="sr-only">
            Analyse terminée : {result.succeeded.length} importé{result.succeeded.length > 1 ? 's' : ''}, {result.skipped.length} ignoré{result.skipped.length > 1 ? 's' : ''}, {result.failed.length} échec{result.failed.length > 1 ? 's' : ''}.
          </p>
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
      </div>
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
      {result.skipped.length > 0 && (
        <div className="space-y-2 mb-4">
          {result.skipped.map((s) => (
            <div key={`${s.filename}-${s.statementId}`} className="flex items-center gap-3 text-sm">
              <Info className="h-4 w-4 text-fg-dim shrink-0" aria-hidden="true" />
              <span className="flex-1 min-w-0 truncate text-fg">{s.filename}</span>
              <Link
                to="/history/$id"
                params={{ id: s.statementId }}
                className="text-xs text-accent-bright hover:underline shrink-0"
              >
                déjà importé : {skippedMonthLabel(s.statementId)}
              </Link>
            </div>
          ))}
        </div>
      )}
      {result.failed.map((f, i) => (
        <div key={i} role="alert" className="flex items-start gap-3 text-sm text-negative">
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
