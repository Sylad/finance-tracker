import { CandidateCluster } from '../../models/credit-detection.model';
import { subscriptionNameFromLabel, triageCluster } from './deterministic-triage';

/** Fixtures synthétiques uniquement (noms de marchands inventés ou
 *  génériques) — jamais de vraies transactions. */
function cluster(
  descriptions: string[],
  opts: { dates?: string[]; amounts?: number[]; creditor?: string; merchant?: string | null } = {},
): CandidateCluster {
  const dates =
    opts.dates ?? descriptions.map((_, i) => `2026-0${i + 1}-10`);
  return {
    key: 'k',
    creditor: opts.creditor ?? 'k',
    merchant: opts.merchant ?? null,
    occurrences: descriptions.map((description, i) => ({
      date: dates[i],
      amount: -(opts.amounts?.[i] ?? 50),
      description,
      transactionId: `t${i}`,
      statementId: dates[i].slice(0, 7),
    })),
  };
}

describe('triageCluster (L44)', () => {
  describe('établissement listé → crédit ou N×, sans LLM', () => {
    it('Cofidis sans indicateur de fractionné → crédit (classic)', () => {
      const d = triageCluster(cluster(['PRLV SEPA COFIDIS 0042', 'PRLV SEPA COFIDIS 0042', 'PRLV SEPA COFIDIS 0042']));
      expect(d.route).toBe('rule');
      if (d.route !== 'rule') return;
      expect(d.classification.classification).toBe('classic');
      expect(d.classification.creditor).toBe('COFIDIS');
      expect(d.classification.confidence).toBe(1);
      expect(d.classification.installmentCount).toBeNull();
    });

    it('Floa avec « 4X » dans un libellé → N× avec le nombre lu', () => {
      const d = triageCluster(
        cluster(['FLOA*ZOLAND 4X 1/4', 'FLOA*ZOLAND 4X 2/4'], { merchant: 'zoland' }),
      );
      expect(d.route).toBe('rule');
      if (d.route !== 'rule') return;
      expect(d.classification.classification).toBe('installment');
      expect(d.classification.installmentCount).toBe(4);
      expect(d.classification.merchant).toBe('zoland');
    });

    it('société BNPL (Klarna) sans indicateur → N× (nombre inconnu)', () => {
      const d = triageCluster(cluster(['KLARNA*ZOLAND', 'KLARNA*ZOLAND']));
      expect(d.route).toBe('rule');
      if (d.route !== 'rule') return;
      expect(d.classification.classification).toBe('installment');
      expect(d.classification.installmentCount).toBeNull();
    });

    it('crédit immobilier d\'une grande banque (mot de crédit) → crédit', () => {
      const d = triageCluster(
        cluster(['PRLV LA BANQUE POSTALE ECHEANCE PRET 7', 'PRLV LA BANQUE POSTALE ECHEANCE PRET 8', 'PRLV LA BANQUE POSTALE ECHEANCE PRET 9']),
      );
      expect(d.route).toBe('rule');
      if (d.route !== 'rule') return;
      expect(d.classification.classification).toBe('classic');
      expect(d.classification.creditor).toBe('LA BANQUE POSTALE');
    });

    it('cluster mêlant un établissement et des libellés qui ne le nomment pas → LLM', () => {
      const d = triageCluster(cluster(['PRLV COFIDIS 0042', 'PRLV NETFLUX', 'PRLV COFIDIS 0042']));
      expect(d.route).toBe('llm');
    });
  });

  describe('mensuels non listés qui ne sont pas des abonnements → exclus', () => {
    it.each([
      ['impôts', ['PRLV DGFIP IMPOT MENSUALITE', 'PRLV DGFIP IMPOT MENSUALITE']],
      ['trésor public', ['PRLV TRESOR PUBLIC', 'PRLV TRESOR PUBLIC']],
      ['loyer', ['PRLV LOYER RESIDENCE DES PINS', 'PRLV LOYER RESIDENCE DES PINS']],
      ['virement à une personne', ['VIR SEPA M JEAN EXEMPLE', 'VIR SEPA M JEAN EXEMPLE']],
      ['virement permanent', ['VIREMENT PERMANENT MME EXEMPLE', 'VIREMENT PERMANENT MME EXEMPLE']],
    ])('%s → excluded, jamais abonnement', (_label, descriptions) => {
      expect(triageCluster(cluster(descriptions)).route).toBe('excluded');
    });

    it("cluster partiellement exclu → LLM (pas d'exclusion en bloc)", () => {
      expect(triageCluster(cluster(['PRLV DGFIP IMPOT', 'PRLV STREAMIO'])).route).toBe('llm');
    });
  });

  describe('ambigus → LLM', () => {
    it('non listé avec un mot de crédit (prêt d\'une banque hors liste)', () => {
      const d = triageCluster(cluster(['PRLV BANQUE EXEMPLE ECHEANCE PRET', 'PRLV BANQUE EXEMPLE ECHEANCE PRET']));
      expect(d.route).toBe('llm');
    });

    it('non listé avec « MENSUALITE » ou « CREDIT »', () => {
      expect(triageCluster(cluster(['PRLV FINAZUR MENSUALITE', 'PRLV FINAZUR MENSUALITE'])).route).toBe('llm');
      expect(triageCluster(cluster(['PRLV FINAZUR CREDIT', 'PRLV FINAZUR CREDIT'])).route).toBe('llm');
    });

    it('non listé avec un indicateur de fractionné (« paypal » hors liste, « alma » non accolé)', () => {
      expect(triageCluster(cluster(['PAYPAL *ZOLAND 4X', 'PAYPAL *ZOLAND 4X'])).route).toBe('llm');
      expect(triageCluster(cluster(['ALMA*ZOLAND 3X', 'ALMA*ZOLAND 3X'])).route).toBe('llm');
    });

    it('non listé et série non mensuelle', () => {
      const d = triageCluster(
        cluster(['CB SUPERETTE', 'CB SUPERETTE', 'CB SUPERETTE'], {
          dates: ['2026-01-03', '2026-01-09', '2026-01-17'],
        }),
      );
      expect(d.route).toBe('llm');
    });
  });

  describe('autre société récurrente mensuelle → abonnement, sans LLM', () => {
    it('série mensuelle à montant fixe → subscription, nom tiré du libellé nettoyé', () => {
      const d = triageCluster(
        cluster(['PRLV SEPA STREAMIO PREMIUM REF 123456', 'PRLV SEPA STREAMIO PREMIUM REF 123999'], {
          amounts: [9.99, 9.99],
        }),
      );
      expect(d.route).toBe('rule');
      if (d.route !== 'rule') return;
      expect(d.classification.classification).toBe('subscription');
      expect(d.classification.creditor).toBe('STREAMIO PREMIUM');
      expect(d.classification.confidence).toBe(1);
    });

    it('montant variable mais un débit par mois (énergie) → subscription', () => {
      const d = triageCluster(
        cluster(['PRELEVEMENT ENERGIA', 'PRELEVEMENT ENERGIA', 'PRELEVEMENT ENERGIA'], {
          amounts: [61.2, 74.8, 55.1],
        }),
      );
      expect(d.route).toBe('rule');
    });

    it('une sous-série mensuelle parmi un opérateur multi-abonnements → subscription', () => {
      const d = triageCluster(
        cluster(['PRLV TELCO', 'PRLV TELCO', 'PRLV TELCO', 'PRLV TELCO'], {
          dates: ['2026-01-05', '2026-01-07', '2026-02-05', '2026-02-07'],
          amounts: [10, 25, 10, 25],
        }),
      );
      expect(d.route).toBe('rule');
    });
  });
});

describe('subscriptionNameFromLabel (L44)', () => {
  it.each([
    ['PRLV SEPA STREAMIO PREMIUM REF 123456', 'STREAMIO PREMIUM'],
    ['Prélèvement Énergia', 'ENERGIA'],
    ['PRLV SEPA SPOTIFAI*PREMIUM', 'SPOTIFAI'],
    ['PAIEMENT CB 12/01 GYMNASE DU PARC PARIS 15', 'GYMNASE PARC PARIS'],
    ['PRLV SEPA FACTURE TELCO MOBILE 2026-01 FR12ZZZ', 'TELCO MOBILE'],
  ])('%s → %s', (label, expected) => {
    expect(subscriptionNameFromLabel(label)).toBe(expected);
  });

  it('libellé entièrement générique → null', () => {
    expect(subscriptionNameFromLabel('PRLV SEPA 123456')).toBeNull();
  });
});
