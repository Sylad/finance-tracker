# Santé financière — diagnostic, seuils d'alertes, conseils IA locale

**Date** : 2026-08-12 · **Statut** : validé par Sylvain (sections 1-3 approuvées en session)

## Objectif

Répondre à la question « suis-je dans le rouge ? » avec un verdict explicable, des seuils
d'alertes ajustables, et des conseils d'amélioration générés par un LLM **local**
(Ollama sur Big-Blue, RTX 5090 32 GB — les données financières ne quittent pas la machine).

Décision structurante : **les chiffres en code, les mots au LLM**. Le verdict et tous les
indicateurs sont calculés par du code déterministe et testé. Le LLM ne fait que rédiger
les conseils à partir d'agrégats — il ne calcule jamais rien, et son indisponibilité ne
casse pas le diagnostic.

## Contexte existant (ne pas dupliquer)

- `healthScore` par relevé (calculé par Claude à l'import) — conservé tel quel, c'est un
  score *par mois* ; la nouvelle page est un diagnostic *global et actuel*.
- `DashboardService.getAlerts()` — 3 alertes en dur (revolving ≥ 80/95 %, solde −30 %,
  crédit qui se termine). Conservées ; la page Santé ne les remplace pas (YAGNI : pas de
  refonte des alertes dashboard dans ce chantier).
- Occurrences `source='draw'` (tirages) et encours revolving fiabilisés (commits
  `f1149de` + `60e74c9` du 2026-08-12) — **prérequis** de tous les calculs ci-dessous.
- `/income` : revenus récurrents déclarés/détectés. Base du reste à vivre.

## 1. Indicateurs & seuils par défaut

Tous les seuils sont modifiables (drawer UI) et persistés dans
`data/health-thresholds.json`. Valeurs par défaut :

| Bloc | Calcul | 🟢 vert | 🟠 orange | 🔴 rouge |
|---|---|---|---|---|
| **Reste à vivre** | revenus récurrents mensuels (médiane 3 derniers mois, **hors tirages** et hors mouvements d'épargne entrants) − mensualités crédits actifs − abonnements actifs − dépenses courantes moyennes (3 mois, hors mensualités/abonnements) | > 10 % des revenus | 0 à 10 % | < 0 |
| **Charge de la dette** | taux d'effort = Σ mensualités ÷ revenus ; utilisation plafonds = usedAmount/maxAmount par réserve et en global | taux < 33 % ET tous plafonds < 60 % | taux 33-50 % OU un plafond ≥ 80 % | taux > 50 % OU un plafond ≥ 95 % ou dépassé |
| **Dépendance aux tirages** | Σ tirages − Σ remboursements de réserves, sur 3 mois glissants (occurrences `draw` vs occurrences négatives des revolvings) | ≤ 0 | > 0 | > 15 % des revenus |
| **Trajectoire 6-12 mois** | projection linéaire : encours revolving (tendance 3 mois) et solde bancaire (net mensuel moyen), à 6 et 12 mois | encours en baisse à 6 mois | stable (±5 %) | un plafond saturé sous 6 mois OU solde projeté structurellement négatif |

**Verdict global** = le pire statut des 4 blocs, accompagné de la **liste des causes en
phrases** (« Rouge parce que : reste à vivre −340 €/mois, Carrefour à 110 % du
plafond »). Pas de score agrégé opaque.

### Détection des revenus (règle métier confirmée par Sylvain, 2026-08-12)

Sylvain a **un seul revenu mensuel stable** (salaire). Tout autre crédit entrant est soit
un tirage de réserve, soit un remboursement ponctuel (mutuelle, régularisation). Constat
dans la data réelle : les `recurringCredits` du relevé 2026-07 (détectés par Claude à
l'import) incluent à tort les tirages Sofinco et un remboursement MHP santé.

Le `HealthService` calcule donc SES revenus lui-même, sans faire confiance aux
`recurringCredits` bruts :

1. Candidats = crédits entrants **hors** transactions marquées `draw` (occurrences des
   loans) ;
2. Cluster par contrepartie normalisée : garder les clusters présents sur **≥ 3 mois**
   avec ~1 occurrence/mois et montant stable (±25 %) → élimine les remboursements
   ponctuels ;
3. Revenu mensuel = **médiane des 3 derniers mois** du/des cluster(s) retenu(s).

Sur les données actuelles : seul le cluster « S.A.S. Campbell Scientific » survit
(3 424 / 3 861 / 3 382 € → médiane ≈ 3 424 €). Si aucun cluster ne survit ou si le
résultat semble ambigu (2+ clusters de tailles proches), la page affiche « revenus à
confirmer » avec lien `/income` — jamais de verdict sur des revenus douteux.

Précision anti-faux-positif : les revenus n'incluent JAMAIS les virements marqués
`draw` — sinon ~2 000 €/mois de tirages seraient comptés comme revenus (observé sur
juin-juillet 2026) et le diagnostic serait faussement rassurant.

## 2. Architecture backend

Nouveau module NestJS `src/modules/health/` (pattern identique à `dashboard/`) :

### `HealthService` — moteur déterministe
- `computeResteAVivre()`, `computeChargeDette()`, `computeFluxTirages()`,
  `computeTrajectoire()` : une méthode par bloc, chacune retourne
  `{ value(s), status: 'green'|'orange'|'red', details, thresholdHit }`.
- `getDiagnostic()` : assemble les 4 blocs + verdict + causes.
- Lit uniquement les services existants (StorageService, LoansService,
  SubscriptionsService, revenus). Aucune nouvelle collecte.
- Endpoint `GET /api/health-check/diagnostic` (préfixe `health-check` pour ne pas
  collisionner avec `/api/health` technique). PinGuard comme le reste.

### `HealthThresholdsService`
- `data/health-thresholds.json`, défauts = tableau section 1.
- `GET/PUT /api/health-check/thresholds` + `POST .../thresholds/reset`.

### `HealthAdviceService` — pont LLM local
- Contexte envoyé au LLM : **agrégats uniquement** — les 4 blocs chiffrés, la liste des
  crédits actifs (nom, type, encours, plafond, TAEG, mensualité), le top 5 des postes de
  dépenses. **Aucune transaction brute, aucun libellé bancaire.**
- Appel Ollama `http://localhost:11434` (`OLLAMA_BASE_URL_ADVICE` env, défaut
  localhost), modèle `OLLAMA_MODEL_ADVICE` (choisi au bench, voir plus bas),
  `format: json` avec schéma : `advices: [{ priority: 1..n, title, explanation,
  estimatedImpact }]`, timeout 120 s.
- **Fail-loud** : Ollama down / JSON invalide / timeout → erreur explicite à l'UI
  (« conseils indisponibles — Ollama éteint »). Jamais de fallback silencieux ni de
  bascule vers l'API Claude cloud.
- Cache : dernier résultat + date de génération persistés
  (`data/health-advice-cache.json`) ; re-génération uniquement sur action utilisateur.
- Endpoints : `POST /api/health-check/advice` (génère), `GET` (cache).

### Déclenchement
- Diagnostic : calculé à la volée à chaque affichage (JSON local, < 50 ms).
- Conseils : bouton « Générer les conseils (IA locale) » uniquement.

### Bench modèle (au début de l'implémentation)
`qwen3:32b` vs `gemma3:27b` sur le contexte réel de Sylvain, 3 runs chacun, sorties
montrées à Sylvain qui tranche. Le retenu va dans `.env`. (La 5090 32 GB rend les
30B-class confortables ; pitfall connu qwen3 *thinking* en batch — à réévaluer ici car
usage interactif unitaire, pas batch.)

## 3. Frontend

Page `/health` « Santé financière » (React + shadcn, patterns existants) :

1. **Bandeau verdict** — couleur pleine, phrase de synthèse, causes en liste.
2. **4 cartes indicateurs** — chiffre principal, statut, seuil déclencheur affiché
   (« rouge car < 0 € »), détail dépliable (décomposition ligne à ligne ; mini-graphe
   Recharts pour la trajectoire).
3. **Section conseils** — bouton générer, spinner, conseils triés par priorité avec
   impact estimé, date de génération, état d'erreur Ollama explicite.
4. **Drawer « Ajuster les seuils »** — édition + « restaurer les défauts ».
5. **Tuile dashboard** — verdict (couleur + phrase courte), lien vers `/health`.

## 4. Gestion d'erreurs

- Revenus non configurés (`/income` vide) → bandeau gris « diagnostic impossible —
  configure tes revenus » avec lien. **Pas de verdict faux.**
- Moins de 3 relevés → indicateurs calculés mais badge « fiabilité réduite ».
- Division par zéro (revenus = 0) → même traitement que revenus non configurés.
- Ollama indisponible → seuls les conseils sont en erreur, le diagnostic reste complet.

## 5. Tests

- `HealthService` : unitaires sur **fixtures synthétiques** (règle projet : jamais de
  vraies données) — cas vert/orange/rouge pour chaque bloc, revenus manquants,
  0 relevé, plafond dépassé (>100 %), seuils personnalisés.
- `HealthThresholdsService` : persistance, reset, merge de défauts sur fichier partiel.
- `HealthAdviceService` : Ollama mocké — JSON valide, JSON invalide, timeout, down.
- Bench LLM : manuel, avec Sylvain.

## Hors scope (YAGNI)

- Refonte des alertes dashboard existantes.
- Notifications push / e-mail sur passage au rouge.
- Historisation du verdict dans le temps (regarder plus tard si besoin).
- Simulation « et si je remboursais X en premier » (piste future, les données le
  permettront).
- Bascule de l'extraction PDF vers le LLM local (chantier séparé, à bencher).
