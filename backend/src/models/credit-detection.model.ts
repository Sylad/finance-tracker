export interface ClusterOccurrence {
  date: string;           // YYYY-MM-DD
  amount: number;         // négatif (débit)
  description: string;
  transactionId: string;
  statementId: string;
}

export interface CandidateCluster {
  key: string;            // clé normalisée
  creditor: string;       // ex 'klarna', 'paypal'
  merchant: string | null; // ex 'zalando', 'joytoy'
  occurrences: ClusterOccurrence[]; // triées par date croissante
}

export type DetectionClass = 'installment' | 'revolving' | 'classic' | 'subscription' | 'not_credit';

export interface ClusterClassification {
  classification: DetectionClass;
  creditor: string;
  merchant: string | null;
  installmentCount: number | null;
  confidence: number;     // 0-1
  rationale: string;
  /** Motif de rapprochement imposé (L44 : grande banque, mot de crédit
   *  exigé) — absent = nom du créancier échappé. */
  matchPattern?: string;
}

export interface DetectionScanResult {
  clustersAnalyzed: number;
  suggestionsCreated: number;
  errors: { clusterKey: string; message: string }[];
  /** L4 : vrai quand le scan a été sauté parce qu'un autre était en cours. */
  skipped?: boolean;
  /** L4 : sur un scan de relevé sauté, résultat du scan complet de rattrapage
   *  qui suivra (rejette si ce scan échoue) — pour l'import-log du hook. */
  catchUp?: Promise<DetectionScanResult>;
}
