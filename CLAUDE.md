# Finance Tracker — guide Claude Code

App perso de suivi financier perso, déployée sur NAS Synology. Frontend React + TanStack, backend NestJS, stockage JSON local.

## Architecture

| | |
|---|---|
| Backend | NestJS 11 sur port `3000`, préfixe `/api` |
| Frontend | React 18 + Vite + TanStack Router/Query sur port `4200` (nginx) |
| Stockage | JSON local dans `data/` (statements/, yearly/, uploads/, snapshots/) |
| Auth | PIN guard global (Bearer token) — toutes routes sauf `/health` et `/events` |
| AI | Anthropic SDK — modèle `claude-sonnet-4-5`, two-phase tool-use (extract_transactions → analyze_finances) |
| Live | Server-Sent Events sur `/api/events` (claude-balance-changed, etc.) |

## Workflow dev

Les builds se font via Docker compose côté NAS (sources sync via `scp -O` depuis WSL) :

```bash
ssh nas "cd /volume2/docker/developpeur/finance-tracker && docker compose up -d --build finance-frontend"
```

Pour le backend : remplace `finance-frontend` par `finance-backend`.

## Variables d'env requises (`backend/.env`)

```
APP_PIN=0000                  # PIN d'auth (4-8 chiffres)
ANTHROPIC_API_KEY=sk-ant-...
DATA_DIR=/app/data
UPLOAD_DIR=/app/data/uploads
CORS_ORIGIN=http://localhost:4200
```

## Conventions code

- Frontend : React 18, TypeScript strict, TanStack Router code-based (pas de file-based routing), TanStack Query pour data fetching, Tailwind CSS + tokens HSL custom (slate + emerald).
- Backend : NestJS modules dans `src/modules/{feature}/`, services + controllers + DTOs.
- Stockage : `StorageService` lit/écrit JSON avec snapshots automatiques avant écriture. Les bilans annuels s'archivent automatiquement le 1er janvier (mois passés déplacés dans `statements/archive/`).

## Pièges connus

- **Cache JSON après schema change** : si un module backend ajoute un champ, le cache JSON existant ne contient pas ce champ → re-fetch peut renvoyer des objets incomplets. Buster en supprimant le cache avant rebuild.
- **PIN guard** : le frontend stocke le PIN en `localStorage`, ajouté en header `Authorization: Bearer <pin>` automatiquement. La route `/budgets` est utilisée comme test de validité au login.
- **Two-phase tool-use** : si la phase 1 retourne 0 transactions extraites, la phase 2 plante. Toujours vérifier le retour de phase 1 avant phase 2.

## Stack précise

- React 18.3 · Vite 5 · TanStack Router 1.78 · TanStack Query 5.59 · Recharts 2.13 · Tailwind 3.4 · Lucide
- NestJS 11 · Anthropic SDK 0.91 · multer 2 · uuid 14
- Docker multi-stage (`node:20-alpine` builder → `nginx:alpine` runtime côté frontend)

## Règles projet (durables)

### Données réelles
- ❌ **JAMAIS de vraies transactions** dans les fixtures, seeds, snapshots de tests, ou dataset démo. Le dataset démo (`/api/demo`) est synthétique : 6 statements (Oct 2025 → Mar 2026), 6 crédits fictifs, 2 épargnes fictives, 4 suggestions.
- ❌ Ne pas commit le contenu de `data/finance/` ni de `uploads/`. C'est dans `.gitignore` et ça doit y rester.

### PIN guard
- ✅ Tout nouvel endpoint **write** (POST/PUT/PATCH/DELETE) doit passer par `PinGuard`. Le guard est global au module racine via `APP_GUARD` ; vérifier que l'endpoint n'est pas dans la whitelist (`/health`, `/events`).
- ✅ Ajouter un test PIN guard sur le endpoint avant de merger. Pattern existant dans `pin.guard.spec.ts`.
- ✅ Mode démo : si `DEMO_FORCED_HOSTS` matche le host, le guard est bypassé ET le mode démo s'active (lecture seule, dataset isolé). Voir `forced_demo_host_pattern.md` (mémoire user).

### Convention nom PDF LBP
- Les PDFs LBP sont nommés `releve_..._YYYYMMDD.pdf` où `YYYYMMDD` est la **date d'émission** (~9 du mois suivant), **pas la période**.
- ✅ Le relevé du mois M est dispo le ~9 de M+1. Si user dit "le mois X manque", vérifier d'abord que le PDF émis le 9 de X+1 existe.
- ❌ Ne PAS utiliser `extractMonthFromFilename` pour deviner la période — il ne reconnaît plus que le pattern `YYYY-MM` explicite (avec tiret) depuis 2026-04-28.
- ✅ La période est dérivée du **mode des dates de transactions** côté backend (`derivePeriodFromTransactions` dans `anthropic.service.ts`), via **unique-day count** (pas tx count) pour gérer le straddle de mois LBP.

### Archivage relevés
- Relevés d'années passées **déplacés** (pas supprimés) dans `data/finance/statements/archive/<YYYY>/<YYYY-MM>.json`.
- `getAllStatements()` ne lit que la racine — comportement souhaité, l'archive n'est pas exposée par défaut.
- Yearly summary `data/finance/yearly/<YYYY>.json` régénéré depuis TOUS les fichiers de `archive/<YYYY>/` à chaque archivage. Ne pas régresser cette logique.

### Détection sub-credits (loans.service)
Pour découper un crédit revolving en sub-credits :
- Filtrer **débits uniquement**, regex référence `\b\d{8,}\b` qui revient ≥ 2 fois.
- Cluster par montant **±5 %**.
- Garder un cluster seulement si : **≥ 3 mois distincts**, ≤ 1 occurrence/mois en moyenne. Si montant < 30€ → seuil monté à **≥ 4 mois distincts** (sinon les abos polluent).
- Sans ces filtres, un Carrefour Banque se découpe en 48 faux sub-credits.

### Auto-création depuis suggestions Claude
- Whitelist `KNOWN_LOAN_CREDITORS` dans `auto-sync.service` — toute suggestion hors liste → snooze auto, pas de création.
- Regex `NOT_A_CREDIT` exclut `\b(COMPTANT|PAIEMENT CB|ACHAT CB|CB CARREFOUR|RETRAIT)\b` même si la regex de matching est large.
- Matcher AND si la suggestion porte un `contractRef` (creditor regex AND contractRef in description), pas OR. Sinon toutes les transactions Cofidis taggent le même crédit.

### Two-phase tool-use Claude
- Phase 1 = `extract_transactions`, Phase 2 = `analyze_finances`. **Toujours vérifier que phase 1 a retourné > 0 transactions** avant de lancer phase 2 — sinon plantage.
- `tool_choice: { type: 'tool' }` strict, donc `ANALYZE_TOOL.description` peut rester en EN (pas de risque pratique).

### Cache JSON après schema change
- Si un module backend ajoute un champ, le cache JSON existant ne contient pas ce champ → re-fetch peut renvoyer des objets incomplets. **Buster le cache** (suppression du fichier ou bump version) avant rebuild backend.

### Path NAS
- Container path **`/volume2/docker/developpeur/finance-tracker-v2/`** (note : `-v2` sur le NAS, repo GitHub et WSL = `finance-tracker` sans suffixe).
