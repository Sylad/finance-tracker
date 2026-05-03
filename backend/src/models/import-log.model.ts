export type ImportLogStatus = 'success' | 'error';

export interface ImportLog {
  id: string;
  filename: string;
  uploadedAt: string;        // ISO timestamp when import started
  durationMs: number;        // total processing time
  status: ImportLogStatus;
  // Success-only fields
  statementId?: string | null;
  statementMonth?: number | null;
  statementYear?: number | null;
  replaced?: boolean;
  // Error-only field
  error?: string;
}
