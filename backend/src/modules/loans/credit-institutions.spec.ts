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

  describe('banques à crédit immobilier (décision Sylvain L44)', () => {
    it('sont dans la liste partagée (auto-sync)', () => {
      expect(isCreditInstitution('La Banque Postale')).toBe(true);
      expect(isCreditInstitution('Crédit Agricole')).toBe(true);
      expect(isCreditInstitution('Credit Mutuel')).toBe(true);
    });

    it("ne comptent dans un libellé qu'accompagnées d'un mot de crédit", () => {
      expect(findCreditInstitution('PRLV LA BANQUE POSTALE ECHEANCE PRET 0042')).toBe('la banque postale');
      expect(findCreditInstitution('Prélèvement Crédit Agricole mensualité prêt immo')).toBe('crédit agricole');
      expect(findCreditInstitution('COTISATION CARTE LA BANQUE POSTALE')).toBeNull();
      // « CREDIT » du nom de la banque ne compte pas comme mot de crédit
      expect(findCreditInstitution('PRLV CREDIT MUTUEL ASSURANCE HABITATION')).toBeNull();
    });

    it("la filiale crédit conso (nom plus long) n'exige pas de mot de crédit", () => {
      expect(findCreditInstitution('PRLV LA BANQUE POSTALE CONSUMER FINANCE')).toBe('banque postale consumer finance');
    });
  });

  describe('paypal et alma (décision Sylvain L44)', () => {
    it('« paypal » seul n\'est pas un établissement, « paypal credit » oui', () => {
      expect(isCreditInstitution('paypal')).toBe(false);
      expect(findCreditInstitution('PAYPAL *ZOLAND')).toBeNull();
      expect(findCreditInstitution('PRLV PAYPAL CREDIT')).toBe('paypal credit');
    });

    it("« alma » ne compte qu'accolé à un indicateur de fractionné", () => {
      expect(findCreditInstitution('ALMA*ZOLAND 4X')).toBeNull();
      expect(findCreditInstitution('ACHAT CB ALMA RESTAURANT')).toBeNull();
      expect(findCreditInstitution('PRLV ALMA 3X ZOLAND')).toBe('alma');
      expect(findCreditInstitution('PRLV 4 FOIS ALMA')).toBe('alma');
    });
  });
});
