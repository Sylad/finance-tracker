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
}

export interface DetectionScanResult {
  clustersAnalyzed: number;
  suggestionsCreated: number;
  errors: { clusterKey: string; message: string }[];
}
