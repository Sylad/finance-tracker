# Finance Tracker

[![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-D97757?logo=anthropic&logoColor=white)](https://claude.com/claude-code)
[![Designed with ChatGPT](https://img.shields.io/badge/Designed%20with-ChatGPT-10A37F?logo=openai&logoColor=white)](https://chat.openai.com)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![NestJS 11](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Analyse tes relevés bancaires PDF avec Claude, suis ton score de santé financière, configure des budgets et des prévisions. Tout local, rien ne sort de ta machine.

![Dashboard — Finance Tracker](./docs/screenshots/dashboard.png)

> Captures prises en **mode démo** (jeu de données fictives 6 mois). L'app embarque un mode démo activable d'un clic, pour explorer toutes les fonctionnalités sans toucher à un vrai compte bancaire.

### Aperçu

| | |
|---|---|
| ![Détail d'un relevé](./docs/screenshots/statement-detail.png) | ![Crédits](./docs/screenshots/loans.png) |
| **Détail d'un relevé** — répartition catégorielle, transactions taggées + récurrentes, commentaire Claude | **Crédits** — classiques (barre temporelle), revolving (jauge), suggestions Claude à valider |
| ![Santé financière](./docs/screenshots/health.png) | ![Dépenses](./docs/screenshots/expenses.png) |
| **Santé financière** — reste à vivre, charge de dette, dépendance aux tirages, trajectoire 6 mois + conseils par IA locale (Ollama) | **Dépenses** — camembert drill-down avec crédits/abonnements/épargne isolés, coupes proposées par l'IA locale |
| ![Comptes épargne](./docs/screenshots/savings.png) | ![Abonnements](./docs/screenshots/subscriptions.png) |
| **Comptes épargne** — PEL, Livret A, sparkline + recalage auto à chaque import | **Abonnements** — détectés par Claude, à trier (connu / faux positif) |
| ![Historique](./docs/screenshots/history.png) | ![Login](./docs/screenshots/login.png) |
| **Historique** — relevés analysés groupés par année, score par mois | **Login** — PIN guard simple (Bearer token) pour les déploiements perso |

<sub>Captures régénérables via `node docs/screenshots/capture.mjs <PIN> docs/screenshots` (Playwright, app démarrée en local, mode démo).</sub>

## Pourquoi

Dev Java/web depuis 2005, j'ai voulu voir jusqu'où on pouvait pousser une collaboration humain ⇄ IA sur un stack que je ne pratique pas en prod : **NestJS + React 18 + Tailwind + shadcn**. Cette appli a été co-construite avec [Claude Code](https://claude.com/claude-code) (le code) et [ChatGPT](https://chat.openai.com) (logo + premières maquettes UX).

Mon rôle : tracer la vision, valider les choix, repérer ce qui cloche.
Le rôle de Claude : poser le code, expliquer, itérer.

## Fonctionnalités

- **Import PDF multi-fichier** (jusqu'à 12 relevés en une fois) — analyse via Claude (Sonnet 5.5) en two-phase tool-use, avec garde-fou sur le type de document (un relevé de crédit ne peut pas écraser un relevé bancaire)
- **Diagnostic de santé financière** — 4 indicateurs à seuils configurables (reste à vivre, charge de dette, dépendance aux tirages revolving, trajectoire d'encours à 6 mois) + **conseils personnalisés par IA locale** (Ollama, rien ne sort de la machine)
- **Page Dépenses** — répartition des retraits du mois avec crédits/abonnements/épargne/opérations neutres isolés d'office, drill-down par catégorie, et **coupes proposées par l'IA locale** sur 3 mois (abonnement / achat ponctuel / autre)
- **Suivi des crédits de bout en bout** — import batch des relevés de crédit ET plans d'amortissement (type de document auto-détecté, rattachement par n° de contrat), tirages sur réserves renouvelables, restant dû officiel prioritaire sur l'estimation
- **Détection LLM locale des crédits et paiements en N fois** (Klarna, PayPal 4×…) — le LLM propose, un validateur déterministe vérifie (1 débit/mois, jour stable, fraîcheur), l'humain accepte
- **Score de santé financière** sur 100 (5 dimensions : épargne, contrôle, dette, cash flow, irrégularité)
- **Catégorisation auto** des transactions (logement, alimentation, etc.) avec sous-catégorie + niveau de confiance ; libellés français partout, y compris sous les champs de saisie brute (déclarations, changement de catégorie) ; la recherche du détail d'un relevé couvre catégorie et sous-catégorie, sans tenir compte des accents
- **Dictionnaire de marchands** (L75) — livré avec le code (`backend/src/modules/category-rules/merchant-dictionary.ts`, version 1) : Carrefour, Leclerc, Lidl, Uber Eats → Alimentation ; SNCF, TotalEnergies, Vinci, Uber → Transport ; Netflix, Free, Orange → Abonnements. Appliqué à l'analyse et à la ré-analyse d'un relevé, **débits seulement**, avec la priorité *règle utilisateur > dictionnaire > catégorie de Claude* ; les libellés sont normalisés à la volée (majuscules, accents, préfixes CB / PAIEMENT CB / PRLV / VIR…, dates et mots à chiffre retirés ; les libellés stockés ne sont jamais réécrits) et l'enseigne doit former des mots entiers (« FREEDOM » n'est pas Free) ; un organisme de crédit ou d'épargne homonyme est écarté par des mots d'exclusion (« CARREFOUR BANQUE », « ORANGE BANK », « DUTY FREE » ne sont pas reconnus : champ `unless` des entrées ; un dernier mot tronqué de 4 lettres au moins, comme « CARREFOUR BANQU », compte aussi). Quand le dictionnaire change la catégorie, la sous-catégorie donnée par Claude est vidée. Chaque passage écrit le log `Merchant dictionary v1: <n> transaction(s) recategorized` (la version n'est pas écrite dans les relevés). Le rejeu des règles (`replayAll`) n'applique jamais le dictionnaire. L'aperçu d'auto-catégorisation (`POST /api/auto-categorize/:id/preview`) résout les enseignes connues sans appeler Claude (suggestions de confiance 1, champ `source` : `dictionary` ou `claude`), et propose pour elles le même motif (mots de l'enseigne)
- **Mémoriser pour ce marchand** (L75) — `PATCH /api/statements/:id/transactions/:txId/category` accepte `memorizeMerchant: true` (le booléen seul ; `createRule` reste prioritaire s'il est aussi vrai) : la catégorie est appliquée et une règle utilisateur est créée sur les mots de l'enseigne que le dictionnaire reconnaît dans le libellé (ex. `\bCARREFOUR\b` pour « RETRAIT DAB 12/03 CARREFOUR »), sinon sur toute la clé normalisée (ex. `\bRESTAURANT[^A-Za-z0-9]+LE[^A-Za-z0-9]+RECAMIER\b`) — chaque mot borné, jamais un fragment de la clé, sans modifier une règle existante — une règle déjà gagnante avec le même résultat est réutilisée, sinon la nouvelle passe au-dessus (priorité 100 ou 1 + la plus haute règle qui reconnaît le libellé). `replayAll` rejoue la règle sur les autres relevés. Libellé sans marchand ou motif ne reconnaissant pas le libellé brut : catégorie appliquée, pas de règle, `ruleSkipped` (`merchant-key-empty` / `pattern-too-short` pour un motif d'un seul mot de moins de 4 lettres / `pattern-no-match`). Le panneau « Catégoriser » propose trois choix de règle exclusifs (boutons radio) : « Mémoriser pour « <mots du motif> » » (présélectionné, c'est lui qui envoie `memorizeMerchant`), « Règle avec un motif à saisir » (`createRule` et motif regex libre) et « Aucune règle ». La mémorisation est grisée, avec sa raison affichée, quand aucune règle ne serait créée : clé de marchand vide, motif d'un seul mot de moins de 4 lettres, ou mots du motif absents tels quels du libellé brut (accent, chiffres intercalés).
- **Qualité de catégorisation** (L74) — sur chaque relevé et en tuile du tableau de bord (dernier relevé) : part des transactions restées en « Autres » (vert < 15 %, orange < 30 %, rouge au-delà) et marchands non classés les plus fréquents (5 au plus, débits seulement, libellés débarrassés du bruit bancaire). Calcul côté navigateur depuis les transactions déjà chargées (`frontend/src/lib/categorization-quality.ts`) ; c'est une mesure, rien n'est recatégorisé
- **Détection des crédits récurrents** (salaire, loyers, pensions) avec date de fin estimée
- **Budgets par catégorie** — progression visuelle au fil du mois
- **Déclarations** d'engagements (revenus, crédits, abonnements) → moteur de **prévisions** mensuel
- **Bilan annuel** auto-archivé le 1er janvier (top catégories (libellés français, comme dans les Déclarations et le détail d'un relevé), meilleur/pire mois, score moyen), graphique « Cash flow mensuel » des entrées et sorties en € de chaque mois
- PIN guard simple en Bearer token

## Comment ça marche sous le capot

Curieux de savoir qui (toi / Claude / le backend) décide de quoi dans le pipeline d'analyse ? Le partage des rôles, les 5 dimensions du score déterministe, et l'historique des choix d'archi sont expliqués dans [**docs/HOW-IT-WORKS.md**](./docs/HOW-IT-WORKS.md).

## Stack

| Couche | Tech |
|---|---|
| Frontend | React 18 + TypeScript 5 + Vite 5 + Tailwind 3 + TanStack Router/Query + Recharts |
| Backend | NestJS 11 + TypeScript 5 + Anthropic SDK + Multer |
| IA locale (optionnelle) | Ollama (qwen3) — conseils santé, détection crédits/N×, analyse des dépenses |
| Storage | JSON local (pas de DB) |
| Build | Docker multi-stage (node:20-alpine → nginx:alpine) |
| Déploiement | Instance de démo : images sur GHCR (CI GitHub), chart Helm sur k3s via ArgoCD (GitOps), tunnel Cloudflare · données réelles : en local uniquement |
| Cache HTTP | nginx : `index.html` et fichiers sans empreinte en `no-cache` (revalidés à chaque visite), `/assets/` à empreinte un an `immutable`, actif absent = 404 — testé par `scripts/test-nginx-cache.sh`, vérifié à chaque livraison par `scripts/verify-cache.sh` |
| Crédits (perf) | `LoansService.getAll()` est mis en cache (validé par mtime/taille/inode de `loans.json`, copie à chaque appel) ; un scan de détection lit les crédits une seule fois et les passe aux gardes du validateur ; `syncInstallmentLoan` écrit occurrences et échéances payées en un seul read-modify-write (`recordInstallmentPayments`) |
| Temps réel | Le backend émet 10 types d'événements SSE (`/api/events`, `EventBusService`) pour les crédits, l'épargne, les abonnements, les objectifs, les échéances, les suggestions (crédits et règles de catégorie), les règles, les journaux d'import et la synchronisation des comptes ; le frontend s'y abonne au démarrage (`frontend/src/lib/live-events.ts`, table événement → clés en en-tête) et invalide les requêtes TanStack qui lisent la source modifiée : un changement fait dans un autre onglet ou par la synchro automatique s'affiche sans rechargement. Après une coupure du flux (erreur puis reconnexion), toutes ces requêtes sont invalidées d'un coup, les événements émis pendant la coupure n'étant pas rejoués. **Limite** : les écritures de relevés (recatégorisation d'une transaction, rejeu des règles, revenu exceptionnel) n'émettent aucun événement — un autre onglet ne les voit qu'après rechargement |
| Règles de catégorie | `CategoryRulesService.replayAll()` est le seul rejeu des règles sur les relevés stockés (route `POST /api/category-rules/replay-all`, option « rejouer » à la création d'une règle, application par lot de l'auto-catégorisation : un seul balayage par lot accepté, jamais un par transaction) |
| Détection après import | `CreditDetectionService.scanInBackground(relevé)` est le seul hook post-import (upload et ré-analyse) : lancé sans attendre, jamais bloquant, son résultat — ou son échec, y compris celui du scan de rattrapage — est inscrit dans l'import-log |
| Import de relevés crédit | les deux routes (`import-statement` sur un crédit, `import-credit-statements` en lot) partagent `ImportOrchestratorService` : `rejectNonCreditDocument` (garde sur le type de document) et `addStatementOccurrence` (occurrence canonique du mois, source `credit_statement`) |

## Setup local

### Prérequis
- Docker 24+
- Une [clé API Anthropic](https://console.anthropic.com/settings/keys)

### Lancement
```bash
git clone <ce-repo> finance-tracker
cd finance-tracker

cp backend/.env.example backend/.env
# Édite backend/.env :
#   - APP_PIN (libre, 4-8 chiffres)
#   - ANTHROPIC_API_KEY (sk-ant-...)
#   - CORS_ORIGIN (l'URL où ton front sera servi)

# Crée les dossiers de données runtime
mkdir -p data/{uploads,statements,snapshots,yearly}
mkdir -p ../shared

# Build + run
docker compose up -d --build
```

Frontend disponible sur `http://localhost:4200`.
Backend API sur `http://localhost:3000/api/health`.

### Premier import
Va sur `/upload`, glisse un PDF de relevé (BNP, Société Générale, La Banque Postale, Crédit Agricole testés). L'analyse prend 30-60s par fichier.

## Lancement local (WSL)

L'app tourne en local en **un seul process Node** (le backend NestJS sert l'API
ET le frontend buildé sur `http://localhost:3000`).

### Première installation
```bash
cp backend/.env.example backend/.env   # APP_PIN, ANTHROPIC_API_KEY…
npm run build                          # build backend + frontend
```
Puis, côté Windows (PowerShell), créer le raccourci Bureau — le script est
sur `\\wsl.localhost`, donc vu comme « distant » par la stratégie
d'exécution, d'où le `-ExecutionPolicy Bypass` pour ce seul appel :
```powershell
powershell -ExecutionPolicy Bypass -File \\wsl.localhost\Ubuntu\home\<user>\projects\developpeur\finance-tracker\local\install-shortcuts.ps1
```
(ou depuis WSL : `powershell.exe -NoProfile -ExecutionPolicy Bypass -File '\\wsl.localhost\…\install-shortcuts.ps1'`).

### Au quotidien
Un seul raccourci, comme une application de bureau :
- **Double-clic "Finance Tracker"** → démarre le serveur (et Ollama s'il est
  éteint) puis ouvre l'app dans une fenêtre Chrome dédiée (mode application,
  sans barre d'adresse).
- **Fermer la fenêtre** → arrête le serveur. Ollama reste en veille (partagé
  avec d'autres outils, il libère le modèle tout seul).

En ligne de commande (WSL) : `./local/run.sh` / `./local/stop.sh`
(`local/stop.vbs` reste disponible côté Windows en dépannage).

### Démo locale isolée (revue UX automatique)

`./local/ux-demo.sh` lance, sur la machine qui porte les vraies données, une démo qui ne les touche pas : backend sur le port **3052**, frontend Vite sur **5192** (distincts d'ol-companion, qui tient en dur 3002/5174, et de l'instance réelle 3000/4200), `DEMO_FORCED=true` (lecture seule), `APP_PIN` et `ANTHROPIC_API_KEY` vides. `DATA_DIR` est un dossier jetable **hors de `data-local/` et de `data/`** (`../tmp/finance-ux-demo`, surchargeable par `UX_DEMO_DIR` — un chemin dans `data-local/` ou `data/` est refusé), rempli à chaque lancement depuis les fixtures versionnées (`backend/src/modules/demo/demo-fixtures.json`). Ces fixtures portent, en plus des relevés, crédits et épargnes, le salaire en crédit récurrent de chaque relevé (page Revenus, entrées de la prévision) et deux déclarations de dépenses (électricité, assurance) : sans eux, `/income` restait vide et `/forecast` à 0 € d'entrées. Le seed écrit aussi `import-logs.json` (les 4 imports des fixtures : Historique des imports de `/upload`) et le bilan de chaque année révolue (2025, calculé depuis les relevés des fixtures avec le même code que l'archivage : Bilan annuel de `/yearly`) ; démo seulement, `data-local/` n'est jamais lu. Les fixtures s'arrêtent en mars 2026 : à l'amorçage **et à chaque démarrage du backend**, leurs dates (relevés, transactions, occurrences, échéances, noms de fichier) sont décalées de mois entiers pour que le dernier relevé soit le mois précédant la date du jour (`demo-date-shift.ts`) ; sans cela tous les crédits passaient en « Trou » et FLOA en « 0 mois restants ». Le décalage appliqué est mémorisé dans `demo/.shift` : s'il change (nouveau mois, démo amorcée avant ce recalage), les données synthétiques de la démo sont réécrites. Quand les six relevés recalés tiennent tous dans l'année en cours, le bilan de l'année révolue est celui des mêmes relevés décalés d'un an. Aucun calcul (santé des crédits comprise) n'est modifié : seule la donnée de démonstration bouge. Les commentaires en texte libre des fixtures gardent leur mois d'origine. `--print-env` affiche l'environnement sans rien lancer. C'est la commande `orchestrate.ux` de `cadence.yaml` ; `backend/src/modules/demo/ux-demo.spec.ts` prouve qu'aucun fichier de `data-local/` n'est ouvert.

**Attentes QA** : `docs/qa/expectations.md` liste, route par route (lignes `shows:` / `api:` / `never:`), ce que l'instance de démo doit afficher ; le `qa-reviewer` s'y réfère après chaque livraison. Les dates y sont relatives (dernier relevé = mois précédent), jamais un mois fixe.

## Sécurité / Vie privée

- **Aucune donnée envoyée ailleurs que vers Anthropic** (analyse PDF)
- Les relevés sont stockés en JSON dans `data/` (volume Docker monté)
- Le PIN protège l'accès web mais c'est du Bearer simple — l'app est conçue pour LAN/VPN, pas pour exposer à Internet
- Aucun secret dans le repo (`.env` gitignoré, seul `.env.example` est versionné)

## Crédits IA

- **[Claude Code](https://claude.com/claude-code)** (Anthropic) — code frontend, backend, infra Docker
- **[ChatGPT](https://chat.openai.com)** (OpenAI) — logo, premières maquettes UX, propositions de design

UI inspirée par [Stripe Dashboard](https://stripe.com), [Mercury](https://mercury.com), [shadcn/ui](https://ui.shadcn.com).
Principes UX : [refactoringui.com](https://refactoringui.com/), [lawsofux.com](https://lawsofux.com/).

## Licence

MIT — fais-en ce que tu veux.

---

**Si tu veux faire pareil** — prends un sujet qui t'enflamme, ouvre Claude Code, décris en langage naturel ce que tu rêves de voir exister, puis itère. Tu seras surpris de ce qu'on peut bâtir en quelques sessions.
