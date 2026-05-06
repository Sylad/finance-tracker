import { useState } from 'react';
import { FileUp, Loader2, X } from 'lucide-react';
import { useImportLoanStatement } from '@/lib/queries';
import type { CreditStatementExtraction, Loan } from '@/types/api';
import { formatEUR } from '@/lib/utils';

type Step = 'pick' | 'preview' | 'done';

export function ImportStatementModal({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const importMut = useImportLoanStatement();
  const [file, setFile] = useState<File | null>(null);
  const [extracted, setExtracted] = useState<CreditStatementExtraction | null>(null);
  const [step, setStep] = useState<Step>('pick');
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!file) return;
    setError(null);
    try {
      const res = await importMut.mutateAsync({ id: loan.id, file });
      setExtracted(res.extracted);
      setStep('preview');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleConfirm = () => {
    // L'update est déjà appliqué côté backend par l'appel /import-statement.
    // Ce bouton sert juste à valider la preview et fermer la modale.
    setStep('done');
    onClose();
  };

  const onPick = (f: File | null) => {
    if (!f) return;
    if (f.type !== 'application/pdf') {
      setError('Seuls les PDF sont acceptés');
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      setError('Fichier trop lourd (max 20 MB)');
      return;
    }
    setError(null);
    setFile(f);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="card max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display font-semibold text-fg-bright">
            Importer un relevé crédit — {loan.name}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {step === 'pick' && (
            <>
              <p className="text-sm text-fg-muted">
                Sélectionne le PDF du relevé envoyé par {loan.creditor ?? "l'organisme"} : Claude
                en extraira le solde, la mensualité, le TAEG et la date d'arrêté pour mettre à jour
                ce crédit.
              </p>

              <label
                htmlFor="loan-stmt-file"
                className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-6 cursor-pointer hover:border-accent transition-colors"
              >
                <FileUp className="h-6 w-6 text-fg-dim" />
                <span className="text-sm text-fg-bright">
                  {file ? file.name : 'Clique pour choisir un PDF (≤ 20 MB)'}
                </span>
                {file && (
                  <span className="text-xs text-fg-dim tabular">
                    {Math.round(file.size / 1024)} KB
                  </span>
                )}
                <input
                  id="loan-stmt-file"
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => onPick(e.target.files?.[0] ?? null)}
                />
              </label>

              {error && <p className="text-xs text-negative">{error}</p>}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button type="button" onClick={onClose} className="btn-secondary">
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={!file || importMut.isPending}
                  className="btn-primary flex items-center gap-2"
                >
                  {importMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {importMut.isPending ? 'Analyse en cours…' : 'Analyser'}
                </button>
              </div>
            </>
          )}

          {step === 'preview' && extracted && (
            <>
              <p className="text-sm text-fg-muted">
                Voici ce que Claude a extrait du relevé. Le crédit a été mis à jour côté serveur ;
                clique sur <em>Confirmer</em> pour fermer cette fenêtre, ou <em>Annuler</em> si
                quelque chose cloche (tu peux revenir aux valeurs précédentes en éditant le
                crédit).
              </p>

              <PreviewTable loan={loan} extracted={extracted} />

              <div className="flex items-center justify-end gap-2 pt-2">
                <button type="button" onClick={onClose} className="btn-secondary">
                  Fermer
                </button>
                <button type="button" onClick={handleConfirm} className="btn-primary">
                  Confirmer
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewTable({ loan, extracted }: { loan: Loan; extracted: CreditStatementExtraction }) {
  const fmtNum = (n: number | null | undefined) =>
    n == null ? '—' : formatEUR(n);
  const fmtPct = (n: number | null | undefined) =>
    n == null ? '—' : `${n.toFixed(2)} %`;

  type Row = { label: string; current: string; extracted: string; applied: boolean };

  const rows: Row[] = [
    {
      label: 'Organisme',
      current: loan.creditor ?? '—',
      extracted: extracted.creditor,
      applied: !loan.creditor && !!extracted.creditor,
    },
    {
      label: 'Type',
      current: loan.type === 'classic' ? 'Classique' : 'Revolving',
      extracted: extracted.creditType === 'classic' ? 'Classique' : 'Revolving',
      applied: false, // type loan jamais écrasé
    },
    {
      label: extracted.creditType === 'revolving' ? 'Utilisé' : 'Capital restant dû',
      current:
        extracted.creditType === 'revolving'
          ? fmtNum(loan.usedAmount)
          : '—',
      extracted: fmtNum(extracted.currentBalance),
      applied: extracted.creditType === 'revolving',
    },
    {
      label: 'Plafond',
      current: fmtNum(loan.maxAmount),
      extracted: fmtNum(extracted.maxAmount),
      applied:
        extracted.creditType === 'revolving' &&
        extracted.maxAmount != null &&
        extracted.maxAmount > 0,
    },
    {
      label: 'Mensualité',
      current: fmtNum(loan.monthlyPayment),
      extracted: fmtNum(extracted.monthlyPayment),
      applied: extracted.monthlyPayment > 0,
    },
    {
      label: 'Date de fin',
      current: loan.endDate ?? '—',
      extracted: extracted.endDate ?? '—',
      applied: extracted.creditType === 'classic' && !!extracted.endDate,
    },
    {
      label: 'TAEG',
      current: '—',
      extracted: fmtPct(extracted.taeg),
      applied: false, // pas stocké sur Loan, juste dans le snapshot
    },
    {
      label: 'Date du relevé',
      current: '—',
      extracted: extracted.statementDate,
      applied: false,
    },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs uppercase tracking-wider text-fg-dim">
          <tr>
            <th className="text-left px-3 py-2">Champ</th>
            <th className="text-left px-3 py-2">Actuel</th>
            <th className="text-left px-3 py-2">Extrait</th>
            <th className="text-left px-3 py-2">Appliqué ?</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border">
              <td className="px-3 py-2 text-fg-muted">{r.label}</td>
              <td className="px-3 py-2 tabular text-fg-dim">{r.current}</td>
              <td className="px-3 py-2 tabular text-fg-bright">{r.extracted}</td>
              <td className="px-3 py-2">
                {r.applied ? (
                  <span className="text-positive text-xs font-semibold">Oui</span>
                ) : (
                  <span className="text-fg-dim text-xs">Non</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
