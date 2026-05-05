# Comment ça marche

> Cette page raconte ce que fait l'app sous le capot — qui décide quoi entre **toi**, **Claude (l'IA)**, et **le backend déterministe**. Si tu tombes sur ce repo par hasard et que tu veux comprendre l'architecture sans lire 4000 lignes de TypeScript, t'es au bon endroit.

## TL;DR

Tu glisses un PDF de relevé bancaire. Claude lit le PDF, en extrait la liste structurée des transactions, et écrit un commentaire en français. Le backend, lui, **calcule le score de santé financière de manière 100 % déterministe** à partir des transactions extraites. Toi, tu peux **forcer la catégorie** d'une transaction et créer des **règles regex** qui s'auto-appliqueront aux imports futurs.

## Le pipeline d'un import

```
                ┌──────────────────────────┐
   PDF.pdf  ──► │  Phase 1 (Claude)        │  extract_transactions tool
                │  temperature: 0          │  → tx[], soldes, comptes externes
                └──────────────┬───────────┘
                               │
                               ▼
                ┌──────────────────────────┐
                │  Phase 2 (Claude)        │  analyze_finances tool
                │  temperature: 0          │  → recurringCredits, narrative,
                │                          │     claudeHealthComment, suggestions
                └──────────────┬───────────┘
                               │
                               ▼
                ┌──────────────────────────┐
   Tes règles ──► CategoryRulesService    │  applique tes overrides regex
                  (déterministe, JSON)     │  (la règle gagne sur Claude)
                └──────────────┬───────────┘
                               │
                               ▼
                ┌──────────────────────────┐
                │  ScoreCalculatorService  │  5 formules pures, 0 LLM
                │  (déterministe, code)    │  → score 0-100 + 5 sous-scores
                └──────────────┬───────────┘
                               │
                               ▼
                ┌──────────────────────────┐
                │  StorageService          │  écrit data/statements/YYYY-MM.json
                │  + AutoSync              │  + MAJ jauges crédits/épargne
                └──────────────────────────┘
```

## Qui décide quoi

| Élément | Source | Pourquoi |
|---|---|---|
| **Extraction des transactions** (date, montant, libellé, catégorie initiale) | Claude Phase 1 | Lire un PDF de relevé bancaire (mise en page, dates en lettres, devise…) c'est exactement ce qu'un LLM fait bien. Coder un parser robuste pour 5 banques différentes serait un cauchemar. |
| **Catégorisation des transactions** | Claude Phase 1 → puis override par tes `CategoryRule` user | Claude propose une catégorie sur chaque tx ("Logement", "Alimentation"…). Si tu n'es pas d'accord, tu cliques sur le badge → modal qui te laisse choisir une autre catégorie + créer une règle regex pour les futurs imports. **Tes règles gagnent toujours sur Claude.** |
| **Texte d'analyse** (`claudeHealthComment`, `analysisNarrative`) | Claude Phase 2 | "Mars positif (+105€). Le PEL rassure sur la situation patrimoniale" — aucun template ne devinerait ça. C'est la valeur ajoutée du LLM. |
| **Détection des crédits récurrents + suggestions** | Claude Phase 2 | Pareil, ça demande du raisonnement contextuel sur des dizaines de tx. |
| **Score de santé (0-100) + les 5 sous-scores** | **Backend `ScoreCalculatorService`**, 0 LLM | C'était initialement Claude. Problème : variait de 16 à 40 sur le même PDF re-importé 3 fois. Une note censée être "objective" ne peut pas osciller comme ça. **Maintenant calculé en arithmétique pure, byte-identique à chaque rescore.** |

## Les 5 dimensions du score

Pondération totale = 100 %. Chaque dimension est ramenée sur `[0, 1]` puis multipliée par son poids.

| Dimension | Poids | Formule | Excellent (=1.0) | Mauvais (=0.0) |
|---|---|---|---|---|
| **savingsRate** | 25 % | `(virements vers épargne + delta solde positif) / income` | ≥ 30 % du revenu épargné | 0 % épargné |
| **expenseControl** | 20 % | `1 - (loisirs + abonnements) / total débits` | ≤ 10 % des débits en discrétionnaire | ≥ 40 % |
| **debtBurden** | 20 % | `1 - (logement + crédits + utilities) / income` | ≤ 30 % du revenu en charges fixes | ≥ 60 % |
| **cashFlowBalance** | 20 % | `(closing - opening) / opening` remappé sur `[-10 %, +10 %]` → `[0, 1]` | Solde grossit de +10 % ou plus | Solde chute de −10 % ou plus |
| **irregularSpending** | 15 % | `1 - CV des débits quotidiens` | CV ≤ 0.5 (dépenses lisses) | CV ≥ 2.0 (très spiky) |

Le code de référence est dans [`backend/src/modules/score/score-calculator.service.ts`](../backend/src/modules/score/score-calculator.service.ts), avec 19 specs unitaires juste à côté.

Si tu veux changer une formule (par ex. relâcher `debtBurden` à 75 % au lieu de 60 %) :
1. Édite la formule dans le service.
2. `npm test` pour valider.
3. Une fois déployé, clique **"Recalculer les scores"** sur la page Historique → applique la nouvelle formule à tous les relevés existants en quelques ms (zéro appel Claude, zéro coût).

## Pourquoi ce partage humain ⇄ Claude ⇄ backend

C'est le résultat de plusieurs itérations :

1. **V1** : Claude faisait tout, score compris. Trop variable (16↔40 sur le même PDF), pas reproductible, et chaque rescore coûtait un appel API.
2. **V2 — `temperature: 0`** : ramène la variance à ±2-3 points. Mieux mais pas suffisant pour un chiffre qu'on présente comme "ta note".
3. **V3 — `ScoreCalculator`** : le score devient une formule pure. Stable à vie tant qu'on ne touche pas au code.

La règle qu'on essaie de suivre :

> **Claude pour ce qui demande du langage ou du jugement contextuel.**
> **Du code déterministe pour ce qui se chiffre.**

L'utilisateur (toi) reste maître via les `CategoryRule` qui battent Claude.

## Côté tunnel public (`*.trycloudflare.com`)

Le backend détecte automatiquement les hôtes Cloudflare via la variable d'environnement `DEMO_FORCED_HOSTS` :

- Force le mode démo (données isolées dans `data/demo/`, jamais de fuite vers le vrai compte).
- Bypass le PIN d'auth (le visiteur arrive direct sur le dashboard démo).
- Cache le bouton "Quitter démo" côté UI.

Recette détaillée dans le code : [`backend/src/modules/demo/demo-mode.middleware.ts`](../backend/src/modules/demo/demo-mode.middleware.ts) + [`backend/src/guards/pin.guard.ts`](../backend/src/guards/pin.guard.ts).

## Pour aller plus loin

- Spec V3 (le gros chantier d'origine) : [`docs/superpowers/specs/2026-05-02-finance-tracker-v3-design.md`](superpowers/specs/2026-05-02-finance-tracker-v3-design.md)
- Plan d'implémentation TDD bite-sized : [`docs/superpowers/plans/2026-05-02-finance-tracker-v3.md`](superpowers/plans/2026-05-02-finance-tracker-v3.md)
- README principal : [`README.md`](../README.md)

## Stack rappel

- **Backend** : NestJS 11, modules `analysis/`, `category-rules/`, `score/`, `loans/`, `savings/`, `auto-sync/`, `storage/` (JSON local).
- **Frontend** : React 18 + TanStack Router/Query, Tailwind, Recharts.
- **AI** : Anthropic SDK, modèle `claude-sonnet-4-5`, two-phase tool-use.
- **Déploiement** : Docker compose multi-stage, testé sur Synology NAS DSM.
