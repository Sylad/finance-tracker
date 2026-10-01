import {
  CREDIT_INSTITUTIONS,
  findCreditInstitution,
  isCreditInstitution,
} from './credit-institutions';

describe('credit-institutions (liste partagée L44)', () => {
  it('contient les organismes historiques de la whitelist auto-sync', () => {
    for (const name of ['cetelem', 'sofinco', 'ca consumer finance', 'cofidis', 'floa', 'klarna', 'carrefour banque']) {
      expect(CREDIT_INSTITUTIONS.has(name)).toBe(true);
    }
  });

  describe('isCreditInstitution (nom de créancier entier)', () => {
    it('insensible à la casse et aux espaces de bord', () => {
      expect(isCreditInstitution('  COFIDIS ')).toBe(true);
      expect(isCreditInstitution('Carrefour Banque')).toBe(true);
    });

    it('refuse un nom absent ou seulement préfixe', () => {
      expect(isCreditInstitution('EDF')).toBe(false);
      expect(isCreditInstitution('carrefour')).toBe(false);
      expect(isCreditInstitution('')).toBe(false);
      expect(isCreditInstitution(undefined)).toBe(false);
    });
  });

  describe('findCreditInstitution (libellé bancaire)', () => {
    it('trouve un organisme par mots entiers dans un libellé', () => {
      expect(findCreditInstitution('PRLV SEPA COFIDIS ECH 12')).toBe('cofidis');
      expect(findCreditInstitution('Prélèvement CA Consumer Finance')).toBe('ca consumer finance');
    });

    it('préfère le nom le plus long quand plusieurs se recouvrent', () => {
      expect(findCreditInstitution('PRLV YOUNITED CREDIT 0042')).toBe('younited credit');
    });

    it("ne matche jamais l'intérieur d'un mot", () => {
      expect(findCreditInstitution('ACHAT CB PALMARES')).toBeNull();
      expect(findCreditInstitution('PRLV FLOATING SAS')).toBeNull();
    });

    it('null sur un libellé sans organisme de la liste', () => {
      expect(findCreditInstitution('PRLV SEPA NETFLUX')).toBeNull();
      expect(findCreditInstitution('')).toBeNull();
    });
  });
});
