/**
 * Merchant recognition for French bank statements.
 *
 * Maps raw bank descriptions (e.g. "PAYL*AMAZON EU 25/03 LUXEMBO") to a
 * clean merchant name + a logo URL (DuckDuckGo's icon CDN, no API key,
 * gracefully falls back to a transparent pixel via 404).
 *
 * Order matters: more specific patterns must come first (e.g. "AMAZON
 * PRIME" before "AMAZON").
 */

export interface MerchantHit {
  name: string;
  domain: string;
  faviconUrl: string;
}

interface MerchantPattern {
  match: RegExp;
  name: string;
  domain: string;
}

const MERCHANTS: MerchantPattern[] = [
  // Streaming / SaaS
  { match: /\bNETFLIX\b/i, name: 'Netflix', domain: 'netflix.com' },
  { match: /\b(SPOTIFY|SPOT_FY)\b/i, name: 'Spotify', domain: 'spotify.com' },
  { match: /\bAPPLE\.COM\/BILL|APPLE STORE|ITUNES\b/i, name: 'Apple', domain: 'apple.com' },
  { match: /\bGOOGLE\b/i, name: 'Google', domain: 'google.com' },
  { match: /\bMICROSOFT|MSFT\*\b/i, name: 'Microsoft', domain: 'microsoft.com' },
  { match: /\bDISNEY\b/i, name: 'Disney+', domain: 'disneyplus.com' },
  { match: /\bDEEZER\b/i, name: 'Deezer', domain: 'deezer.com' },
  { match: /\bCANAL\+/i, name: 'Canal+', domain: 'canalplus.com' },
  { match: /\bOPENAI|CHATGPT\b/i, name: 'OpenAI', domain: 'openai.com' },
  { match: /\bANTHROPIC|CLAUDE\.AI\b/i, name: 'Anthropic', domain: 'anthropic.com' },

  // Marketplaces
  { match: /\bAMAZON PRIME\b/i, name: 'Amazon Prime', domain: 'amazon.fr' },
  { match: /\b(AMAZON|AMZN|PAYL\*AMAZON)\b/i, name: 'Amazon', domain: 'amazon.fr' },
  { match: /\bEBAY\b/i, name: 'eBay', domain: 'ebay.fr' },
  { match: /\bCDISCOUNT\b/i, name: 'Cdiscount', domain: 'cdiscount.com' },
  { match: /\bFNAC\b/i, name: 'Fnac', domain: 'fnac.com' },
  { match: /\bDARTY\b/i, name: 'Darty', domain: 'darty.com' },
  { match: /\bBOULANGER\b/i, name: 'Boulanger', domain: 'boulanger.com' },
  { match: /\bDECATHLON\b/i, name: 'Decathlon', domain: 'decathlon.fr' },
  { match: /\bIKEA\b/i, name: 'Ikea', domain: 'ikea.com' },
  { match: /\bLEROY MERLIN\b/i, name: 'Leroy Merlin', domain: 'leroymerlin.fr' },
  { match: /\bCASTORAMA\b/i, name: 'Castorama', domain: 'castorama.fr' },

  // Supermarkets
  { match: /\bCARREFOUR\b/i, name: 'Carrefour', domain: 'carrefour.fr' },
  { match: /\bLIDL\b/i, name: 'Lidl', domain: 'lidl.fr' },
  { match: /\bALDI\b/i, name: 'Aldi', domain: 'aldi.fr' },
  { match: /\b(LECLERC|E\.?LECLERC)\b/i, name: 'E.Leclerc', domain: 'e.leclerc' },
  { match: /\bMONOPRIX\b/i, name: 'Monoprix', domain: 'monoprix.fr' },
  { match: /\bAUCHAN\b/i, name: 'Auchan', domain: 'auchan.fr' },
  { match: /\bINTERMARCHE\b/i, name: 'Intermarché', domain: 'intermarche.com' },
  { match: /\bCASINO\b/i, name: 'Casino', domain: 'casino.fr' },
  { match: /\bFRANPRIX\b/i, name: 'Franprix', domain: 'franprix.fr' },
  { match: /\bPICARD\b/i, name: 'Picard', domain: 'picard.fr' },
  { match: /\bBIOCOOP\b/i, name: 'Biocoop', domain: 'biocoop.fr' },
  { match: /\bNATURALIA\b/i, name: 'Naturalia', domain: 'naturalia.fr' },

  // Telecom / utilities
  { match: /\b(FREE MOBILE|FREE TELE|FREE FBX)\b/i, name: 'Free', domain: 'free.fr' },
  { match: /\bORANGE\b/i, name: 'Orange', domain: 'orange.fr' },
  { match: /\bSFR\b/i, name: 'SFR', domain: 'sfr.fr' },
  { match: /\bBOUYGUES\b/i, name: 'Bouygues Telecom', domain: 'bouyguestelecom.fr' },
  { match: /\bSOSH\b/i, name: 'Sosh', domain: 'sosh.fr' },
  { match: /\bRED BY SFR\b/i, name: 'RED by SFR', domain: 'red-by-sfr.fr' },
  { match: /\bEDF\b/i, name: 'EDF', domain: 'edf.fr' },
  { match: /\bENGIE\b/i, name: 'Engie', domain: 'engie.fr' },
  { match: /\bTOTALENERGIES?\b/i, name: 'TotalEnergies', domain: 'totalenergies.fr' },
  { match: /\b(VEOLIA|SUEZ)\b/i, name: 'Veolia/Suez', domain: 'veolia.com' },

  // Mobility
  { match: /\bUBER EATS\b/i, name: 'Uber Eats', domain: 'ubereats.com' },
  { match: /\bUBER\b/i, name: 'Uber', domain: 'uber.com' },
  { match: /\bBOLT\b/i, name: 'Bolt', domain: 'bolt.eu' },
  { match: /\bDELIVEROO\b/i, name: 'Deliveroo', domain: 'deliveroo.fr' },
  { match: /\bJUST EAT\b/i, name: 'Just Eat', domain: 'just-eat.fr' },
  { match: /\bBLABLACAR\b/i, name: 'BlaBlaCar', domain: 'blablacar.fr' },
  { match: /\b(SNCF|OUI\.?SNCF|OUIGO|TGV)\b/i, name: 'SNCF', domain: 'sncf-connect.com' },
  { match: /\b(RATP|NAVIGO|IDF MOBILITES)\b/i, name: 'RATP / Île-de-France Mobilités', domain: 'ratp.fr' },
  { match: /\b(TOTAL|SHELL|BP|ESSO|AVIA|INTERMARCHE PETROLE)\b.*(STATION|ESSENCE|CARBURANT)?/i, name: 'Station-service', domain: 'totalenergies.fr' },

  // Restaurants
  { match: /\bMC\s?DONALD'?S?|MCDO\b/i, name: "McDonald's", domain: 'mcdonalds.fr' },
  { match: /\bBURGER KING\b/i, name: 'Burger King', domain: 'burgerking.fr' },
  { match: /\bKFC\b/i, name: 'KFC', domain: 'kfc.fr' },
  { match: /\bSUBWAY\b/i, name: 'Subway', domain: 'subway.com' },
  { match: /\bSTARBUCKS\b/i, name: 'Starbucks', domain: 'starbucks.fr' },

  // Crédits / paiement fractionné (renvoie au logo de l'organisme)
  { match: /\bCOFIDIS\b/i, name: 'Cofidis', domain: 'cofidis.fr' },
  { match: /\bSOFINCO\b/i, name: 'Sofinco', domain: 'sofinco.fr' },
  { match: /\bCETELEM\b/i, name: 'Cetelem', domain: 'cetelem.fr' },
  { match: /\bFLOA\b/i, name: 'FLOA', domain: 'floabank.fr' },
  { match: /\bKLARNA\b/i, name: 'Klarna', domain: 'klarna.com' },
  { match: /\bALMA\b/i, name: 'Alma', domain: 'getalma.eu' },
  { match: /\bYOUNITED\b/i, name: 'Younited', domain: 'younited-credit.com' },
  { match: /\bONEY\b/i, name: 'Oney', domain: 'oney.fr' },

  // Banques / impôts / sécurité sociale
  { match: /\b(LBP|LA BANQUE POSTALE)\b/i, name: 'La Banque Postale', domain: 'labanquepostale.fr' },
  { match: /\b(BNP|BNP PARIBAS)\b/i, name: 'BNP Paribas', domain: 'bnpparibas.fr' },
  { match: /\bCREDIT AGRICOLE\b/i, name: 'Crédit Agricole', domain: 'credit-agricole.fr' },
  { match: /\bSOCIETE GENERALE\b/i, name: 'Société Générale', domain: 'societegenerale.fr' },
  { match: /\bDGFIP|IMPOTS\b/i, name: 'DGFiP / Impôts', domain: 'impots.gouv.fr' },
  { match: /\bCAF\b/i, name: 'CAF', domain: 'caf.fr' },
  { match: /\bURSSAF\b/i, name: 'URSSAF', domain: 'urssaf.fr' },
  { match: /\bAMELI|CPAM|SECU\b/i, name: 'Assurance Maladie', domain: 'ameli.fr' },

  // Insurance
  { match: /\bMAIF\b/i, name: 'MAIF', domain: 'maif.fr' },
  { match: /\bMAAF\b/i, name: 'MAAF', domain: 'maaf.fr' },
  { match: /\bMACIF\b/i, name: 'MACIF', domain: 'macif.fr' },
  { match: /\bMATMUT\b/i, name: 'Matmut', domain: 'matmut.fr' },
  { match: /\bAXA\b/i, name: 'AXA', domain: 'axa.fr' },
  { match: /\bGROUPAMA\b/i, name: 'Groupama', domain: 'groupama.fr' },
  { match: /\bPREDICA\b/i, name: 'Predica', domain: 'predica.fr' },

  // Misc
  { match: /\bPAYPAL\b/i, name: 'PayPal', domain: 'paypal.com' },
  { match: /\bSUMUP\b/i, name: 'SumUp', domain: 'sumup.fr' },
  { match: /\bSTRIPE\b/i, name: 'Stripe', domain: 'stripe.com' },
];

export function recognizeMerchant(description: string): MerchantHit | null {
  if (!description) return null;
  const hit = MERCHANTS.find((p) => p.match.test(description));
  if (!hit) return null;
  return {
    name: hit.name,
    domain: hit.domain,
    faviconUrl: `https://icons.duckduckgo.com/ip3/${hit.domain}.ico`,
  };
}
