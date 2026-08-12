export type HealthStatus = 'green' | 'orange' | 'red';

export interface HealthThresholds {
  // Reste à vivre : rouge si < 0 (fixe), orange si < orangeBelowPctIncome % des revenus
  resteAVivre: { orangeBelowPctIncome: number };
  // Taux d'effort (mensualités / revenus)
  tauxEffort: { orangeAbovePct: number; redAbovePct: number };
  // Utilisation des plafonds revolving
  plafonds: { greenBelowPct: number; orangeAbovePct: number; redAbovePct: number };
  // Flux tirages : orange si > 0 (fixe), rouge si > redAbovePctIncome % des revenus
  tirages: { redAbovePctIncome: number };
  // Trajectoire
  trajectoire: { horizonMonths: number; stableBandPct: number };
  // Override manuel du revenu mensuel (prime toujours sur la détection). null = auto.
  manualMonthlyIncome: number | null;
}

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  resteAVivre: { orangeBelowPctIncome: 10 },
  tauxEffort: { orangeAbovePct: 33, redAbovePct: 50 },
  plafonds: { greenBelowPct: 60, orangeAbovePct: 80, redAbovePct: 95 },
  tirages: { redAbovePctIncome: 15 },
  trajectoire: { horizonMonths: 6, stableBandPct: 5 },
  manualMonthlyIncome: null,
};

export interface HealthBlockResult {
  status: HealthStatus;
  // Phrase du seuil déclencheur, ex "rouge car reste à vivre < 0 €" — null si vert
  thresholdHit: string | null;
  // Valeurs chiffrées propres au bloc, pour l'UI (détail dépliable)
  details: Record<string, number | string | null>;
}

export interface HealthDiagnostic {
  verdict: HealthStatus;
  causes: string[]; // phrases, une par bloc non-vert
  blocks: {
    resteAVivre: HealthBlockResult;
    chargeDette: HealthBlockResult;
    fluxTirages: HealthBlockResult;
    trajectoire: HealthBlockResult;
  };
  income: {
    monthly: number | null;
    source: 'detected' | 'manual' | 'transition' | 'unavailable';
    label: string | null; // contrepartie détectée (affichage), jamais utilisée en logique
  };
  reliability: 'ok' | 'reduced' | 'unavailable'; // reduced si < 3 relevés
  computedAt: string;
}

export interface HealthAdvice {
  generatedAt: string;
  model: string;
  advices: {
    priority: number;
    title: string;
    explanation: string;
    estimatedImpact: string;
  }[];
}
