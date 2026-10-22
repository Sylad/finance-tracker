export const MAX_FILES = 12;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export interface RejectedFile {
  name: string;
  reason: string;
}

// Même test que le fileFilter du serveur (analysis.controller) : seul le type MIME compte.
const isPdf = (f: File) => f.type === 'application/pdf';

// Arrondi au supérieur : un fichier refusé car > 20 Mo ne s'affiche jamais « 20,0 Mo ».
const formatMo = (bytes: number) => `${(Math.ceil((bytes * 10) / (1024 * 1024)) / 10).toFixed(1).replace('.', ',')} Mo`;

/** Contrôle à la sélection les mêmes limites que le serveur (PDF, 20 Mo, 12 fichiers). */
export function selectStatementFiles(
  current: File[],
  incoming: File[],
): { accepted: File[]; rejected: RejectedFile[] } {
  const accepted = [...current];
  const rejected: RejectedFile[] = [];
  for (const f of incoming) {
    if (!isPdf(f)) {
      const namedPdf = f.type === '' && f.name.toLowerCase().endsWith('.pdf');
      rejected.push({
        name: f.name,
        reason: namedPdf ? "type PDF non reconnu par le navigateur (le serveur l'aurait refusé)" : "ce n'est pas un PDF",
      });
    }
    else if (f.size > MAX_FILE_BYTES) rejected.push({ name: f.name, reason: `dépasse 20 Mo (${formatMo(f.size)})` });
    else if (accepted.some((m) => m.name === f.name && m.size === f.size)) rejected.push({ name: f.name, reason: 'déjà dans la liste' });
    else if (accepted.length >= MAX_FILES) rejected.push({ name: f.name, reason: `la liste est pleine (${MAX_FILES} fichiers maximum)` });
    else accepted.push(f);
  }
  return { accepted, rejected };
}
