import { useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Upload as UploadIcon, FileText, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useUploadStatements } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import type { UploadResult } from '@/types/api';
import { cn, formatEUR } from '@/lib/utils';

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

  const handleSubmit = async () => {
    if (files.length === 0) return;
    setResult(null);
    try {
      const r = await upload.mutateAsync(files);
      setResult(r);
      setFiles([]);
    } catch (e) {
      setResult({
        succeeded: [],
        skipped: [],
        failed: [{ filename: 'upload', error: String((e as Error).message) }],
      });
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
            <div key={`${f.name}-${i}`} className="flex items-center gap-3 px-4 py-3">
              <FileText className="h-4 w-4 text-fg-dim shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-fg-bright truncate">{f.name}</div>
                <div className="text-xs text-fg-dim tabular">{(f.size / 1024).toFixed(0)} Ko</div>
              </div>
              <button
                onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                className="btn-ghost p-1.5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
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

      {result && <UploadReport result={result} />}
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
