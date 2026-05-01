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
