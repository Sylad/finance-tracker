# Détection crédits & paiements N× par LLM local + opérations neutres

**Date** : 2026-08-12 · **Statut** : validé par Sylvain (approche A + 5 blocs approuvés en session)

## Objectif

1. Détecter les crédits et paiements en plusieurs fois qui échappent aux heuristiques
   actuelles (whitelist `KNOWN_LOAN_CREDITORS`, regex `PAY_IN_N_PATTERN`, filtre
   `NOT_A_CREDIT` qui masque les « Achat CB ») — cas réels observés dans les relevés :
   séries PayPal (~48.18 ×4, ~45.75 ×3, ~16.98), Klarna Zalando (3× : ~44.98, ~42,
   ~52), Alma (~91-99). Le LLM **local** (qwen3:32b, RTX 5090) classe, le code valide,
   Sylvain accepte.
2. Règle « opérations neutres » : les paires entrée/sortie pass-through (ex. +1 979 €
   reçu puis renvoyé à un tiers le lendemain) ne comptent plus dans les dépenses
   courantes du diagnostic santé.

Décisions structurantes (validées) :
- **Scan rétrospectif à la demande + classification incrémentale à chaque import.**
- **Tout passe par les suggestions existantes** (bandeau `/loans`) — le LLM ne crée
  jamais un loan directement. Trois verrous : LLM propose → validateur déterministe →
  validation humaine.
- **Exception privacy assumée** : les libellés de transactions PARTENT au LLM de
  détection (indispensable pour classer) — acceptable car strictement local
  (localhost:11434), contrairement au module conseils santé qui reste agrégats-only.
  À documenter dans le code et CLAUDE.md.

## Architecture — module backend `credit-detection/`

### 1. `CandidateClusteringService` (déterministe)

- Entrée : liste de `MonthlyStatement` (tous pour le scan, le seul nouveau pour
  l'import).
- Candidats : débits (`amount < 0`) NON déjà occurrences d'un loan ou d'une
  subscription (par `transactionId`, toutes sources). PAS de filtre `NOT_A_CREDIT`.
- Clé de cluster : contrepartie normalisée — lowercase, retrait des préfixes
  génériques (`achat cb`, `prélèvement`, `paiement`), des chiffres et des mots de
  mois ; extraction `creditor`/`merchant` sur les séparateurs connus
  (`Klarna*Zalando` → creditor `klarna`, merchant `zalando` ; `PAYPAL *JOYTOY` →
  `paypal` + `joytoy`).
- Cluster retenu : ≥ 2 occurrences. Un débit isolé n'est jamais envoyé au LLM (un
  plan qui démarre sera rattrapé à l'import suivant).
- Sortie : `CandidateCluster { key, creditor, merchant, occurrences: [{date, amount,
  description, transactionId, statementId}] }`.

### 2. `CreditClassifierService` (LLM local)

- Un appel Ollama par cluster — `POST {baseUrl}/api/generate`, `format: json`,
  timeout **60 s** par cluster.
- Config : `OLLAMA_DETECTION_MODEL` (défaut `qwen3:32b`), base URL partagée
  `OLLAMA_ADVICE_BASE_URL`.
- Prompt système français : analyste de relevés bancaires ; classes possibles et
  leurs critères (installment = série courte de montants ~identiques ~mensuels chez
  un créancier BNPL ; subscription = récurrent long à montant fixe ; not_credit =
  achats ponctuels) ; interdiction d'inventer ; sortie JSON exacte :
  `{ "classification": "installment"|"revolving"|"classic"|"subscription"|"not_credit",
     "creditor": string, "merchant": string|null, "installmentCount": number|null,
     "confidence": number, "rationale": string }`.
- Validation stricte de la réponse (types, classification dans l'enum, confidence
  0-1) → sinon erreur comptée pour ce cluster. Fail-loud agrégé : le résultat du scan
  expose `{clustersAnalyzed, suggestionsCreated, errors: [{clusterKey, message}]}` —
  aucune erreur avalée. AUCUN fallback cloud.

### 3. `DetectionValidatorService` (déterministe — le LLM ne crée rien)

Seuil de confiance : `< 0.6` → ignoré (loggé). Sinon, par classification :

- **installment** : montants dans ±5 % de la médiane du cluster ; espacement médian
  25-35 jours ; nb occurrences ≤ `installmentCount` (si fourni) ; ≤ 1 occurrence par
  mois calendaire ; `findExistingLoan(signals)` sans match `high`/`medium` →
  suggestion de type installment. À l'ACCEPT (UI existante) : création
  `kind='installment'` avec `installmentSchedule` = occurrences observées (paid=true)
  + échéances restantes projetées (même pas mensuel, même montant, jusqu'à
  `installmentCount`).
- **revolving / classic** : délégué au flux suggestion loan existant
  (`LoanSuggestionsService`), avec `creditor` fourni par le LLM — la whitelist
  `KNOWN_LOAN_CREDITORS` ne bloque PAS ces suggestions (le rôle de gate passe au
  couple LLM+validateur) mais reste pour l'auto-création historique.
- **subscription** : flux suggestion subscription existant.
- **not_credit** : rien.
- Dédup : pas de nouvelle suggestion si une suggestion pending/snoozed couvre déjà le
  même pattern (mécanisme de dédup existant du service suggestions).

### 4. Déclenchement & endpoints

- `POST /api/credit-detection/scan` — scan complet (tous les relevés). Réponse
  synchrone avec le résumé `{clustersAnalyzed, suggestionsCreated, errors}`. Durée
  attendue : 10-30 clusters × 5-8 s. PinGuard.
- À l'import : après `syncStatement`, scan des seules transactions du nouveau relevé
  en **tâche de fond** (l'import ne ralentit pas) ; résultat consigné dans
  l'import-log (ligne « détection IA : N suggestions, M erreurs ») et visible au
  bandeau suggestions.
- UI `/loans` : bouton « Détecter les crédits (IA locale) » + spinner long + résumé
  du scan (dont les erreurs) ; les suggestions atterrissent dans le bandeau existant.
  Nouvelle variante d'affichage pour les suggestions installment (mention « N× chez
  {merchant} »).

## Opérations neutres (module santé, déterministe)

Dans `computeResteAVivre` (`health.service.ts`) : détection des paires
`(crédit entrant, débit sortant)` sur la fenêtre des 3 derniers relevés avec
`|montants| égaux à ±0.01 €` et `écart ≤ 7 jours`, hors transactions déjà exclues
(occurrences loans/subscriptions, mouvements épargne) et hors transactions dont la
contrepartie matche un créancier de loan actif. Chaque transaction ne peut appartenir
qu'à une paire (appariement glouton par proximité de date). Les DEUX jambes sont
exclues des dépenses courantes ; le total exclu est exposé dans
`details.operationsNeutres` (transparence sur la carte Reste à vivre).

Cas de référence : +1 979 € « Transition funds » (22/07) / −1 979 € virement vers un
tiers (23/07) → exclu, reste à vivre remonte de ~660 €/mois sur la fenêtre courante.
Anti-faux-positif : deux dépenses identiques SANS entrée correspondante ne sont pas
appariées ; une entrée sans sortie (vrai revenu ponctuel) non plus.

## Erreurs

- Ollama down pendant un scan → HTTP 502 explicite (bouton affiche l'erreur), aucun
  cluster traité en silence.
- Ollama down pendant la détection post-import → import réussi normalement, ligne
  d'échec dans l'import-log (pas de blocage de l'import).
- Cluster en erreur (JSON invalide, timeout) → compté dans `errors`, les autres
  clusters continuent.

## Tests

- Clustering : fixtures synthétiques (séries type 4× PayPal, 3× Klarna, achats
  ponctuels mêlés) — clés, extraction creditor/merchant, exclusion des occurrences
  existantes, seuil ≥ 2.
- Classifier : fetch mocké — réponse valide, JSON invalide, timeout, enum inconnue,
  confidence hors bornes.
- Validateur : installment valide → suggestion ; montants incohérents (>±5 %) →
  rejeté ; doublon `findExistingLoan` → rejeté ; confiance < 0.6 → ignoré ; accept →
  schedule reconstruit correct (occurrences passées paid + projection).
- Opérations neutres : paire 1 979-like exclue ; 2 débits identiques sans entrée →
  gardés ; entrée seule → revenu non touché ; paire à 8 jours → non appariée.
- **Bench réel** au début de l'implémentation : le classifier sur les clusters réels
  PayPal/Klarna/Alma de Sylvain, sorties montrées avant branchement (ajustement du
  prompt si besoin, pattern /tune-llm-prompt-loop).

## Hors scope (YAGNI)

- Reclassification des loans existants (ils restent tels quels).
- Auto-création sans validation humaine.
- Détection d'autres langues/banques que les libellés LBP actuels.
- UI dédiée au-delà du bouton + bandeau suggestions existant.
