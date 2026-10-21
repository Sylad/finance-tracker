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
- **Mémoriser pour ce marchand** (L75) — `PATCH /api/statements/:id/transactions/:txId/category` accepte `memorizeMerchant: true` (le booléen seul ; `createRule` reste prioritaire s'il est aussi vrai) : la catégorie est appliquée et une règle utilisateur est créée sur les mots de l'enseigne que le dictionnaire reconnaît dans le libellé (ex. `\bCARREFOUR\b` pour « RETRAIT DAB 12/03 CARREFOUR »), sinon sur toute la clé normalisée (ex. `\bRESTAURANT[^A-Za-z0-9]+LE[^A-Za-z0-9]+RECAMIER\b`), y compris quand la catégorie choisie contredit celle du dictionnaire (« PRLV VINCI IMMOBILIER LOYER » remis en Logement mémorise `VINCI IMMOBILIER LOYER`, pas `VINCI`, pour ne pas détourner les péages) — chaque mot borné, jamais un fragment de la clé, sans modifier une règle existante — une règle déjà gagnante avec le même résultat est réutilisée, sinon la nouvelle passe au-dessus (priorité 100 ou 1 + la plus haute règle qui reconnaît le libellé). `replayAll` rejoue la règle sur les autres relevés. Libellé sans marchand ou motif ne reconnaissant pas le libellé brut : catégorie appliquée, pas de règle, `ruleSkipped` (`merchant-key-empty` / `pattern-too-short` pour un motif d'un seul mot de moins de 4 lettres / `pattern-no-match`). Le panneau « Catégoriser » propose trois choix de règle exclusifs (boutons radio) : « Mémoriser pour « <mots du motif> » » (présélectionné, c'est lui qui envoie `memorizeMerchant`), « Règle avec un motif à saisir » (`createRule` et motif regex libre) et « Aucune règle ». La mémorisation est grisée, avec sa raison affichée, quand aucune règle ne serait créée : clé de marchand vide, motif d'un seul mot de moins de 4 lettres, ou mots du motif absents tels quels du libellé brut (accent, chiffres intercalés).
- **Détail d'un relevé au téléphone** (L78) — sous 768 px, chaque transaction (`frontend/src/components/tx-row.tsx`) tient sur deux rangées : libellé (avec « · récurrent », qui passe à la ligne au lieu d'être tronqué) et montant en entier à droite, puis date et catégorie ; dès 768 px, la ligne à 12 colonnes d'origine. Depuis L79, à toute largeur, le titre (libellé brut quand aucun marchand n'est reconnu) et la sous-ligne passent à la ligne au lieu d'être rognés par une ellipse : « · récurrent » n'est jamais coupé
- **Crédits au téléphone** (L96) — la rangée d'actions de l'en-tête de `/loans` (Importer PDF crédits, Détecter les crédits, Doublons, Suspects, Reset, Nouveau crédit ; `frontend/src/routes/loans.tsx`) passe à la ligne quand la largeur manque, au lieu de s'étendre sur 722 px et d'élargir la page à 738 px à 390 px (défilement horizontal) ; dès 640 px le titre (« X € / mois », sur une ligne) et la rangée sont empilés (côte à côte, les six boutons ~873 px ne tiennent à aucune largeur : le contenu est plafonné à ~1136 px), la rangée tient sur une ligne à 1440 px et passe à la ligne sous ~900 px de contenu ; au passage, les trois boutons d'une suggestion de crédit (`suggestions-banner.tsx`) passent à la ligne à 320 px au lieu d'élargir la page à 357 px
- **Doublons de crédits en fr-FR** (L97) — les raisons affichées par `/loans` › Doublons (`detectDuplicates`, `loans.service.ts`) écrivent les montants avec la virgule et deux décimales (« Mensualité identique : 240,00 € », « Mensualités proches : 240,00 € / 245,50 € ») via `formatDecimalFr` (`common/money.ts`), plus au point décimal
- **Champs de saisie mieux délimités** (L82) — la bordure de la classe `.input` (partagée par toutes les pages à formulaire) utilise le jeton `--input-border` (`222 12% 45%`, relié dans `tailwind.config.ts`) : 3,2:1 sur `--surface-2` et 3,4:1 sur `--surface` (WCAG 1.4.11), contre 1,31:1 avec `--border`. Tests : `src/test/contrast.test.ts` (R1–R5).
- **Menu du mois de `/expenses` nommé et stable** (L84) — le `<select>` porte `aria-label="Mois du relevé"` (un lecteur d'écran dit ce qu'il choisit) ; changer de mois garde la page affichée (`placeholderData: keepPreviousData`) donc le focus reste sur le select. Tests : `routes/expenses.test.tsx`.
- **Menu du mois de `/expenses` mieux délimité** (L83) — le `<select>` du mois (seul contrôle de formulaire hors `.input` à garder `border-border`, 1,31:1) emploie lui aussi `--input-border`. Tests : `contrast.test.ts` R6 (aucun `select`/`input`/`textarea` ne porte `border-border`) et R7.
- **Historique et détail des relevés accessibles** (L23) — la liste de `/history` est une liste `ul/li` dont les colonnes crédits, débits et score portent un sous-libellé (« score /100 ») comme net et solde, icônes masquées aux lecteurs d'écran ; le champ de recherche a un nom accessible (« Rechercher un relevé »). Le détail d'un relevé porte un titre de niveau 2 par section, ses transactions forment une liste `ul/li` nommée et atteignable au clavier (cadre défilant de `min(640px, 70vh)` seulement dès `lg` ; à plat en dessous), les filtres Tout/Crédit/Débit et les lignes de répartition portent `aria-pressed`, le compteur « N / M transactions » est un `role="status"`, le champ « Filtrer les transactions » est nommé, et l'explication du score s'affiche en entier sous le cercle. Les puces de catégorie utilisent `CATEGORY_TEXT_COLOR` (`tx-row.tsx`), éclaircie pour tenir 4,5:1 sur le fond réel de la puce (teinte `color-mix` de 12,5 % de la couleur de catégorie, composée sur le fond des lignes — L80, le test de contraste mesure ce fond rendu) ; `CATEGORY_COLOR` reste celle des graphiques. Tests : `history.test.tsx`, `statement-detail.test.tsx`, `tx-row.test.tsx`.
- **Qualité de catégorisation** (L74) — sur chaque relevé et en tuile du tableau de bord (dernier relevé) : part des transactions restées en « Autre » (vert < 15 %, orange < 30 %, rouge au-delà) et marchands non classés les plus fréquents (5 au plus, débits seulement, libellés débarrassés du bruit bancaire). Calcul côté navigateur depuis les transactions déjà chargées (`frontend/src/lib/categorization-quality.ts`) ; c'est une mesure, rien n'est recatégorisé
- **Détection des crédits récurrents** (salaire, loyers, pensions) avec date de fin estimée. Page **Revenus** (L25) : le total et le sous-titre (« N revenus récurrents actifs · M inactifs, exclus du total ») ne comptent que les actifs, triés par montant ; les inactifs sont dans une carte « Revenus terminés » (badge texte « Inactif », « Dernier vu », montant en `text-fg-muted`, pleine opacité) ; une erreur de l'API affiche `ErrorState` avec « Réessayer » (jamais « 0,00 € / mois ») ; la fiabilité de la date de fin se lit « Fiabilité élevée / moyenne / faible » ; le libellé passe à la ligne et chaque séparateur « · » ouvre l'élément qui le suit ; l'état vide propose « Importer un relevé » (`EmptyState` accepte une `action`). Tests : `routes/income.test.tsx`
- **Budgets par catégorie** — progression visuelle au fil du mois ; plafonds en euros entiers (un montant négatif ou décimal est refusé sur son champ), Entrée enregistre, le bouton reste inactif sans modification, un enregistrement refusé affiche le message du serveur sans perdre la saisie, et quitter la page avec un brouillon demande confirmation (enregistrement désactivé en démo verrouillée)
- **Déclarations** d'engagements (revenus, crédits, abonnements) → moteur de **prévisions** mensuel (`GET /api/forecast?months=3|6|12`, 12 par défaut, autre valeur refusée en 400 ; la fenêtre commence au mois courant ; sur `/forecast` le graphe « Cash flow projeté » a un axe des montants en euros entiers (`formatEURCompact` : « 2 000 € », « 12,5 k € » au-delà de 10 000 €), une info-bulle aux montants exacts au centime (2 068,15 € et non 2 068,00 €) avec une ligne **Solde** (signe gardé) et le solde mensuel tracé en courbe sur les barres Revenus/Dépenses (le contour sombre et la ligne blanche partagent le même réglage d'animation, `SOLDE_LINE_ANIMATION`, et se dessinent ensemble) ; chaque carte de mois dit en texte « Passé », « En cours » ou « Prévu » (badge à gauche du solde, d'après le mois courant), chaque ligne a pour nom accessible « libellé, type, rapproché / non rapproché » (`role=listitem` ; la pastille est décorative) et une légende sous le titre (● Revenus ● Crédits ● Abonnements ● Dépenses · estompé = non rapproché) explique les pastilles ; le sélecteur 3/6/12 mois expose `aria-pressed` et, pendant le rechargement, la page garde titre, sélecteur et focus ; un chargement en échec affiche « Impossible de charger les prévisions » avec **Réessayer** (jamais « Pas de déclaration »), en gardant le sélecteur 3/6/12 mois et son focus (un changement d'horizon qui échoue n'enferme pas sur l'horizon en échec), et une projection dont aucun mois n'a d'occurrence — ou une liste vide — affiche l'état vide avec un lien vers Déclarations plutôt que des cartes à 0,00 € ; cet état garde le sélecteur 3/6/12 mois, et sur un horizon réduit il dit « Aucune échéance sur les N prochains mois » au lieu de « Pas de déclaration ») ; la fenêtre de saisie est une vraie modale (rôle `dialog`, focus sur Libellé à l'ouverture, Tab bouclé, Échap ferme (sauf s'il vient de la palette ⌘K ouverte par-dessus), focus rendu au bouton d'origine, × nommé « Fermer ») qui défile au lieu de déborder à 320×568 ; la liste tient sur deux rangées sous 640 px (type + libellé entier, puis détails à gauche, montant et actions à droite) pour rester lisible à 320 px, et sur une seule ligne au-delà ; les erreurs sont montrées : un chargement en échec affiche « Impossible de charger les déclarations » avec **Réessayer** (jamais l'état vide), un enregistrement refusé affiche le message de l'API dans la modale (`role=alert`) en gardant la saisie, une suppression refusée affiche un message nommant la déclaration quand la ligne réapparaît
- **Bilan annuel** auto-archivé le 1er janvier (top catégories (libellés français, comme dans les Déclarations et le détail d'un relevé), meilleur/pire mois, score moyen), graphique « Cash flow mensuel » des entrées et sorties en € de chaque mois ; les cartes de synthèse disent « Entrées », « Sorties » et « Revenus récurrents » (jamais « Crédits » ni « Débits », qui désignent les emprunts dans le menu, L101) ; une liste de bilans en échec affiche « Impossible de charger les bilans annuels » avec **Réessayer** (jamais « Pas encore de bilan »), un détail en échec affiche « Impossible de charger le bilan AAAA » avec **Réessayer** en gardant le sélecteur d'année (plus de « Chargement… » sans fin) ; un rafraîchissement qui échoue garde les données déjà affichées (L100). le sélecteur d'année expose `aria-pressed` et marque l'année choisie d'un liseré d'accent (contraste ≥ 3:1, WCAG 1.4.11, L102). Tests : `routes/yearly-errors.test.tsx`, `routes/yearly.test.tsx`
- PIN guard simple en Bearer token ; écran de connexion accessible : erreur annoncée au lecteur d'écran et reliée au champ, focus rendu au champ après un échec (PIN faux vidé), état « Déverrouillage… » pendant la vérification

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

`./local/ux-demo.sh` lance, sur la machine qui porte les vraies données, une démo qui ne les touche pas : backend sur le port **3052**, frontend Vite sur **5192** (distincts d'ol-companion, qui tient en dur 3002/5174, et de l'instance réelle 3000/4200), `DEMO_FORCED=true` (lecture seule), `APP_PIN` et `ANTHROPIC_API_KEY` vides. `DATA_DIR` est un dossier jetable **hors de `data-local/` et de `data/`** (`../tmp/finance-ux-demo`, surchargeable par `UX_DEMO_DIR` — un chemin dans `data-local/` ou `data/` est refusé), rempli à chaque lancement depuis les fixtures versionnées (`backend/src/modules/demo/demo-fixtures.json`). Ces fixtures portent, en plus des relevés, crédits et épargnes, le salaire en crédit récurrent de chaque relevé (page Revenus, entrées de la prévision) et deux déclarations de dépenses (électricité, assurance) : sans eux, `/income` restait vide et `/forecast` à 0 € d'entrées. Le seed écrit aussi `import-logs.json` (les 4 imports des fixtures : Historique des imports de `/upload`) et le bilan de chaque année révolue (2025, calculé depuis les relevés des fixtures avec le même code que l'archivage : Bilan annuel de `/yearly`) ; démo seulement, `data-local/` n'est jamais lu. Les fixtures s'arrêtent en mars 2026 : à l'amorçage **et à chaque démarrage du backend**, leurs dates (relevés, transactions, occurrences, échéances, noms de fichier) sont décalées de mois entiers pour que le dernier relevé soit le mois précédant la date du jour (`demo-date-shift.ts`) ; sans cela tous les crédits passaient en « Trou » et FLOA en « 0 mois restants ». Le décalage appliqué est mémorisé dans `demo/.shift`, l'empreinte SHA-256 de `demo-fixtures.json` dans `demo/.fixtures` : si l'un des deux change (nouveau mois, démo amorcée avant ce recalage, fixtures modifiées par une livraison — L98), les données synthétiques de la démo sont réécrites. Quand les six relevés recalés tiennent tous dans l'année en cours, le bilan de l'année révolue est celui des mêmes relevés décalés d'un an. Aucun calcul (santé des crédits comprise) n'est modifié : seule la donnée de démonstration bouge. Les commentaires en texte libre des fixtures gardent leur mois d'origine. `--print-env` affiche l'environnement sans rien lancer. C'est la commande `orchestrate.ux` de `cadence.yaml` ; `backend/src/modules/demo/ux-demo.spec.ts` prouve qu'aucun fichier de `data-local/` n'est ouvert.

**Attentes QA** : `docs/qa/expectations.md` liste, route par route (lignes `shows:` / `api:` / `never:` / `source:`), ce que l'instance de démo doit afficher ; le `qa-reviewer` s'y réfère après chaque livraison. Les dates y sont relatives (dernier relevé = mois précédent), jamais un mois fixe. Sur `/`, la tuile « Points d'attention » lit le diagnostic santé (`/api/health-check/diagnostic`) ; `/api/dashboard/alerts` n'alimente que le bloc « Alertes » (L81).

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
