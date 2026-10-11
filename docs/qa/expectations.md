# Attentes QA — instance de démonstration

Fichier lu par le `qa-reviewer` (QA de la livraison, https://finance.sladoire.dev, ns `preprod`). Il dit ce que **chaque route doit montrer** sur le jeu de données de démo : un écart n'est un défaut que s'il contredit une ligne d'ici ; le reste est une observation.

Repris du brouillon du rapport QA L14 du 11-10 (22 routes), corrigé pour L61 (salaire récurrent et déclarations dans les fixtures), L62 (`import-logs.json` et bilan écrits par le seed) et L63 (dates **recalées** : le dernier relevé est toujours le mois précédant la date du jour).

## Syntaxe

- `shows:` ce qui est visible à l'écran ; plusieurs éléments séparés par des virgules.
- `api:` appels `/api/…` qui doivent répondre 2xx pendant la visite de la route.
- `never:` texte qui ne doit apparaître nulle part sur la route. Le reviewer compare sans casse : un mot court comme « nan » se trouverait dans « fiNANcière » ; on écrit donc les formes réelles du défaut (« NaN € », « NaN % ») et non le mot seul.
- `may be empty when …:` une réponse vide ou un état vide est normal dans ce cas.

## Règle de lecture des dates (L63)

Les fixtures s'arrêtent en mars 2026 mais sont décalées de mois entiers à chaque démarrage du backend : **ne jamais attendre un mois ou une année précis**. Les six relevés sont les six mois qui précèdent le mois en cours, le dernier étant le mois précédent. « Dernier relevé » et « le plus ancien » remplacent « Mars 2026 » et « Octobre 2025 ». Seule exception de contenu : les commentaires en texte libre des fixtures gardent leur mois d'origine.

## *

never: « Erreur : », « Erreur inconnue », Impossible de charger, undefined, « NaN € », « NaN % », « NaN/100 »

## /

shows: à 1440 px seulement, « Vue d'ensemble basée sur 6 relevés » (l'en-tête de page est masqué sous `md` : le tableau de bord téléphone affiche le mois et la tendance, pas cette phrase) ; aux deux tailles PATRIMOINE NET, SANTÉ FINANCIÈRE /100, RELEVÉS RÉCENTS (5 cartes à 1440 px, 3 à 390 px)
api: /api/statements, /api/statements/score-history, /api/loans, /api/savings-accounts, /api/budgets, /api/dashboard/net-worth, /api/dashboard/yearly-overview?months=12, /api/health-check/diagnostic, /api/dashboard/alerts
may be empty when aucune alerte (`/api/dashboard/alerts`)

## /loans

shows: « N crédits actifs » avec N ≥ 1, au moins 5 cartes crédit, au moins un crédit dont la santé n'est pas « Trou » (L63 : sans recalage tous passaient en « Trou » et FLOA en « 0 mois restants »)
api: /api/loans, /api/loan-suggestions

## /history

shows: 6 relevés, du plus récent (le mois précédent) au plus ancien (six mois avant)
api: /api/statements

## /history/<mois du dernier relevé>

Ouvrir le relevé le plus récent de `/history`, pas une URL en dur.
shows: « N / N transactions » (tous les relevés listés), RÉPARTITION DES DÉPENSES
api: /api/statements/<mois>, /api/statements/<mois>/anomalies
may be empty when aucune anomalie (`/anomalies`)

## /category-rules

shows: 11 catégories prédéfinies
api: /api/category-rules

## /income

shows: au moins 1 revenu récurrent (le salaire), total > 0 €
never: « Importe au moins 2 relevés »
api: /api/statements/recurring-credits

## /recurring

shows: contenu non vide
api: /api/statements/recurring-credits

## /forecast

shows: ENTRÉES > 0 € sur au moins un mois
api: /api/forecast?months=12

## /expenses

shows: Répartition des retraits sur au moins 5 postes
api: /api/expenses/breakdown

## /budget

shows: budgets Transport 80, Alimentation 400, Loisirs 100 (valeurs des champs)
api: /api/budgets

## /savings

shows: 2 comptes, total 20 330,00 €
api: /api/savings-accounts

## /subscriptions

shows: au moins 1 suggestion
api: /api/loan-suggestions, /api/subscriptions
may be empty when aucun abonnement suivi (`/api/subscriptions`, démo)

## /yearly

shows: au moins un bilan annuel d'une **année révolue** (calculé depuis les relevés de la démo ; l'année dépend du recalage, ne pas attendre 2025)
never: état vide « aucun bilan »
api: /api/statements/yearly, /api/statements/yearly/<année> (détail de l'année affichée)

## /upload

shows: Historique des imports avec 4 entrées, aucune datée dans le futur (L63)
api: /api/import-logs

## /heatmap

shows: « N jours avec débit » avec N > 0
api: /api/statements, /api/statements/<mois> (un appel par relevé)

## /health

shows: 4 indicateurs (Reste à vivre, Charge de la dette, Dépendance aux tirages, Trajectoire), verdict rouge/orange/vert
api: /api/health-check/diagnostic, /api/health-check/advice
may be empty when aucun conseil n'a encore été généré (`/api/health-check/advice` répond 204, corps vide)

## /declarations

shows: 2 déclarations (électricité, assurance) — L61
api: /api/declarations

## /goals

may be empty when démo (`/api/goals`)

## /about, /nouveautes, /plan

shows: contenu non vide ; au moins 1 entrée sous Nouveautés
