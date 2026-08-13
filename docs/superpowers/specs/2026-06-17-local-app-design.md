# Finance Tracker — App locale exécutable/éteignable (PC dev WSL)

**Date** : 2026-06-17
**Statut** : design validé, prêt pour plan d'implémentation

## Objectif

Arrêter d'héberger finance-tracker sur le NAS Synology + Docker compose. En faire une
application qu'on **démarre et éteint à la demande** sur le PC dev (PC dev, WSL Ubuntu),
via un **double-clic sur une icône Windows**, comme une app de bureau.

Contrainte directrice : « si c'est pas compliqué » → solution minimale, pas d'over-engineering.

## Décisions validées

| Sujet | Choix |
|-------|-------|
| Mode de lancement | Double-clic icône Windows (Bureau) |
| Données | Rapatrier depuis le NAS (historique conservé) |
| Moteur | Node natif, **1 seul process** (pas de Docker) |
| PIN | Garder le PIN existant (zéro changement de comportement) |

## Architecture

### Runtime — 1 process Node, 1 port

Aujourd'hui : 2 conteneurs (NestJS backend port 3000 + frontend nginx port 4200) sur le NAS.

Cible : un seul `node dist/main`. Le backend NestJS sert **l'API et le frontend buildé**
sur un **seul port (3000)** grâce à `@nestjs/serve-static` (déjà dans les dépendances,
mais **pas encore câblé**).

- `ServeStaticModule.forRoot` sert `frontend/dist` pour toutes les routes **sauf** `/api/*`
  (le backend a déjà `app.setGlobalPrefix('api')`). Fallback SPA pour le routing React.
- Le frontend utilise déjà des URLs **relatives** (`/api/...`, ex. `frontend/src/routes/history.tsx`
  `fetch('/api/statements/export.csv')`) → **aucun changement frontend nécessaire**.
- CORS devient same-origin → effectivement no-op (on garde `enableCors` tel quel, inoffensif).

### Build

`npm run build` à la racine (script existant) produit `backend/dist/` + `frontend/dist/`.
À relancer manuellement après une modification de code. Pas de watch en prod locale.

### Données — rapatriement NAS → local (one-shot)

- Dossier local : `finance-tracker/data/` (ajouté au `.gitignore`).
  - `data/` (relevés, budgets, uploads…) ← NAS `/volume2/docker/developpeur/data/finance/`
  - `data/shared/claude-shared.json` ← NAS `/volume2/docker/developpeur/data/shared/`
- Le `claude-shared.json` devient une **copie standalone** : finance n'est plus synchro du
  solde Claude partagé avec warhammer/ol (acceptable pour une app finance isolée).
- `.env` local créé à partir du `.env` du NAS pour récupérer la vraie `ANTHROPIC_API_KEY`
  et `APP_PIN`.

### Lancement Windows (double-clic)

Deux raccourcis Bureau, prévisibles :

- **Finance Tracker** → `start.vbs` (fenêtre cachée) :
  1. lance `node dist/main` en tâche de fond dans WSL,
  2. attend que le port 3000 réponde,
  3. ouvre le navigateur par défaut sur `http://localhost:3000`.
- **Finance Tracker — Stop** → `stop.vbs` : tue le process Node dans WSL.

WSL2 forwarde automatiquement `localhost` vers Windows → pas de portproxy/réseau à configurer
pour un accès local.

## Composants / fichiers

Nouveau dossier `local/` (committé) :

| Fichier | Rôle |
|---------|------|
| `local/run.sh` | WSL : build-si-besoin + `node backend/dist/main`, écrit le PID dans `data/.pid`, logs dans `logs/` |
| `local/stop.sh` | WSL : lit `data/.pid` et tue le process (fallback `pkill -f`) |
| `local/start.vbs` | Windows : `wscript` → `wsl.exe ... run.sh` caché, puis ouvre le navigateur |
| `local/stop.vbs` | Windows : `wsl.exe ... stop.sh` |
| `local/install-shortcuts.ps1` | Crée les 2 raccourcis Bureau avec `finance-tracker.ico` (à lancer 1 fois) |
| `local/sync-from-nas.sh` | Rapatriement des données depuis le NAS (à lancer 1 fois) |

Suppressions (chemins `C:\Developpeur\...` morts, mode dev obsolète) :
`start.bat`, `launch.vbs`, `start-bg.ps1`.

## Configuration `.env` locale

```
PORT=3000
NODE_ENV=production
DATA_DIR=./data
UPLOAD_DIR=./data/uploads
SHARED_DATA_DIR=./data/shared
APP_PIN=<repris du NAS>
ANTHROPIC_API_KEY=<repris du NAS>
```

À noter : `SHARED_DATA_DIR` n'est pas dans `backend/src/config/configuration.ts` (il est lu
ailleurs, ex. module claude-usage). À vérifier et brancher au moment de l'implémentation pour
que la copie locale de `claude-shared.json` soit bien trouvée.

## Gestion d'erreurs

- `run.sh` : si `frontend/dist` ou `backend/dist` absent → lancer le build avant de démarrer
  (fail loud si le build échoue, pas de démarrage silencieux d'un binaire absent).
- `run.sh` : refuser de démarrer si le port 3000 est déjà occupé (afficher quel PID) plutôt
  que de doubler les process.
- Démarrage du PIN : le backend refuse de booter en `production` sans `APP_PIN` (sécurité
  fail-safe existante). On garde un `APP_PIN` valide dans `.env`.

## Tests / vérification (avant tout claim « fait »)

1. `npm run build` → succès (pas d'erreur TS).
2. `node backend/dist/main` démarre, log « Backend running ».
3. `curl http://localhost:3000/api/health` → 200.
4. `curl http://localhost:3000/` → HTML du frontend (pas 404).
5. Double-clic Windows → navigateur s'ouvre, **dashboard affiche les données rapatriées**.
6. Double-clic Stop → le process Node n'est plus là (`pgrep` vide).

## Hors scope (YAGNI)

- Autostart au boot Windows (lancement uniquement à la demande).
- Empaquetage Electron/Tauri.
- Exposition LAN (portproxy) — accès localhost uniquement.
- Resynchro bidirectionnelle du solde Claude partagé avec warhammer/ol.
