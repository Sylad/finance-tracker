# Failles connues des dépendances — L184 (2026-11-26)

Lot L184, demande D-32 du registre parent (relevé de sécurité du 25-11 : Dependabot 8 critiques et
37 hautes ; npm audit production : backend 1 critique et 4 hautes, frontend 1 critique).

Règle suivie : production d'abord, `npm audit fix` sans `--force`, chaque montée majeure seule dans
son commit avec build et tests verts, aucune modification de comportement de l'application.

## Avant / après (`npm audit`, 2026-11-26)

Colonnes : critique / haute / modérée / basse (total).

| Paquet npm | Périmètre | Avant (05e6c9b) | Après |
|---|---|---|---|
| backend | production (`--omit=dev`) | 1 / 4 / 1 / 0 (6) | **0 / 0 / 0 / 0 (0)** |
| backend | complet | 2 / 9 / 20 / 1 (32) | 0 / 0 / 19 / 0 (19) |
| frontend | production (`--omit=dev`) | 1 / 0 / 0 / 0 (1) | **0 / 0 / 0 / 0 (0)** |
| frontend | complet | 4 / 8 / 9 / 1 (22) | **0 / 0 / 0 / 0 (0)** |
| racine (`concurrently`) | complet (dev seul) | 2 / 0 / 0 / 0 (2) | **0 / 0 / 0 / 0 (0)** |

Les alertes Dependabot lisent les lockfiles de `main` : elles ne bougeront qu'une fois ces commits poussés.

## Ce qui a changé

1. **`npm audit fix` sans `--force`** (backend, frontend, racine), aucun `package.json` modifié :
   - backend production : `proxy-addr` 2.0.7 → 2.0.8 (critique, usurpation d'IP par adresse IPv4
     dans IPv6), `multer` 2.1.1 → 2.5.0, `body-parser` 2.2.2 → 2.4.0,
     `@nestjs/platform-express` 11.1.19 → 11.2.12, `zod` 4.4.3 → 4.6.7 (hautes, déni de service),
     `qs` 6.15.1 → 6.17.1 (modérée) ;
   - frontend production : `seroval` 1.5.3 → 1.8.2 (critique, via `@tanstack/react-router`) ;
   - dev : `brace-expansion`, `js-yaml`, `handlebars`, `form-data`, `fast-uri`, `ws`, `postcss`,
     `nanoid`, `shell-quote`… dans les plages déjà déclarées ;
   - racine : le lock est resynchronisé avec `package.json` (`@resvg/resvg-js` et `png-to-ico`,
     absents de `package.json` et utilisés nulle part, en sortent).
2. **vite 5.4 → 6.4.6** (frontend, dev, majeure) : failles du serveur de dev (traversée de chemin,
   esbuild ≤ 0.24.2), concrètes ici car `server.host: true` l'expose au réseau local. Mêmes
   morceaux produits, même `modulepreload`, +1 % de taille ; `scripts/test-nginx-cache.sh` vert.
3. **vitest et @vitest/coverage-v8 2.1.9 → 4.1.12** (frontend, dev, majeure) : tinypool critique,
   vitest et @vitest/mocker. 4.x et non 5.x : vitest 5 exige Node ≥ 22.12, la CI et les images sont
   sous Node 20. Seule adaptation : un type de test (`subscriptions-echecs.test.tsx`).
   Le lock a été produit par npm 11 (npm 10.9.9 plante dans arborist, « reading 'edgesOut' ») et
   `npm ci` sous npm 10.9.9 l'accepte.

## Ce qui reste, et pourquoi

19 modérées, backend, **dépendances de développement uniquement** :

| Paquet | Avis | Arrive par | Correctif proposé | Décision |
|---|---|---|---|---|
| `glob` 13.0.6, 10.5.0 | GHSA-3g3m-2fjr-6pw4 (signal d'abandon ignoré) | `@nestjs/cli` 11, `test-exclude` (Jest) | `@nestjs/cli` 12 | reporté |
| `minimatch` 10.2.6, 9.0.9 | GHSA-g3hv-75wg-m249 (déni de service par motif) | idem | idem | reporté |
| chaîne Jest 30 (`jest`, `@jest/*`, `babel-jest`, `babel-plugin-istanbul`, `test-exclude`…) | les mêmes, transitives | `test-exclude` ≥ 7 (aucune version corrigée publiée) | redescendre à `jest` 29.7.0 | refusé |

- **Pas exploitable chez nous** : ces bibliothèques ne servent qu'à `nest build` et à Jest, avec des
  motifs écrits dans nos propres fichiers de configuration ; aucune donnée externe n'y entre. Le
  serveur (`node dist/main`) ne les charge jamais.
- **`@nestjs/cli` 12** exige `@nestjs/schematics` 12, qui exige **TypeScript 6** : c'est le
  compilateur du `dist` de production qui changerait de version majeure. Ce n'est pas « sans
  risque » ; à faire dans le lot mensuel des technos, TypeScript 6 d'abord.
- **Jest** : le seul correctif proposé est un retour à Jest 29, une régression d'outil pour une
  modérée de dev ; à revoir quand `test-exclude` publiera une version corrigée.
- À noter : l'image backend copie tout `node_modules` du builder (`backend/Dockerfile`), dépendances
  de dev comprises ; ces paquets sont donc présents dans l'image sans y être exécutés. Passer à
  `npm ci --omit=dev` dans l'étape finale réduirait l'image et la surface : changement d'image hors
  du périmètre de ce lot.

## Preuves

- Build (`nest build` ; `tsc -b && vite build` avec la vérification de fuite du plan), `tsc --noEmit`
  des deux côtés, Jest 1328/1328, Vitest 1000/1000 et sa couverture, après chaque étape.
- Analyse à cliquet (`eslint.analyse.mjs`) : aucune violation nouvelle, backend et frontend.
- Comportement HTTP du backend : la même série de requêtes (santé, PIN absent / faux / bon, en-tête
  `X-Forwarded-For` IPv6, envois de fichiers refusés et acceptés, JSON de 90 ko, 5 Mo, invalide,
  requêtes imbriquées) jouée sur la version d'avant et celle d'après, sur des données jetables :
  réponses identiques, sauf le libellé d'erreur de multer quand un envoi dépasse 12 fichiers ou
  utilise un champ inconnu (« Unexpected field » devient « Unexpected file field ») ; l'interface
  refuse déjà ces envois avant de les faire (`frontend/src/lib/upload-files.ts`).
