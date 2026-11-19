# Carte — finance-tracker

## Écrans
- **404** (`components/not-found.tsx`, `defaultNotFoundComponent`) : « Page introuvable » + lien vers le tableau de bord, visible seulement une fois connecté (Root redirige vers /login avant).
- **Titres d'onglet** (`components/layout/page-title.ts`) : « <libellé de navigation> — Finance Tracker » sur correspondance EXACTE d'une page ; seule sous-page : `/history/<id>` (« <Mois Année> — Historique », L173 ; liste `SUB_PAGES`). Tout autre chemin, sous-chemin d'une page connue compris (`/plan/x`, `/loans/x`), = « Page introuvable — Finance Tracker ». Connexion : « Connexion — Finance Tracker ».

## Décisions (L169)
- Camemberts de /expenses et du relevé : `aria-hidden` + `rootTabIndex={-1}` ; l'information passe par la légende / liste de catégories. Testés avec un `Pie` simulé qui reproduit le tabindex du `<g>` racine de recharts.
- Cibles ≥ 24 px : classe `min-h-6`, testée par classe (jsdom sans mise en page) dans `components/l169-targets.test.tsx`.
- Bilan annuel : le tableau « Détail mois par mois » défile dans une région nommée, `tabIndex=0`.
- Nouvelle sous-route imbriquée dans le routeur → l'ajouter à `SUB_PAGES`, sinon le test R2 d'app-shell échoue.

## Décisions (L173)
- Titre d'onglet du détail d'un relevé : « <Mois Année> — Historique — Finance Tracker » (« Relevé introuvable — Historique » si absent, titre parent pendant le chargement) ; nom posé par `usePageTitleDetail`, lu par AppShell. README.md (paragraphe L169) décrit ce titre.
- Texte de la Nouveauté L173 : le titre d'onglet est lu par un lecteur d'écran à l'OUVERTURE de la page (URL directe, nouvel onglet, rechargement), pas en navigation interne : l'app n'a ni annonceur de route ni focus déplacé (focus sur BODY après un clic, revue UX L173). Un annonceur de route serait un lot à part, pour toute l'app.

## Décisions (L180, D-1 — échéancier réel d'un crédit, carte Crédits > Tableau d'amortissement)
- `matchDebitsToSchedule` (front `lib/loan-state.ts`, miroir back `loans-state.helper.ts`, mêmes tests des deux côtés) : un prélèvement va à l'échéance de SON mois, ou à celle d'un mois voisin qui n'a AUCUN débit. Un mois voisin déjà prélevé n'est jamais pris : un débit en trop reste non rattaché (compté une fois dans les mensualités, pas dans le capital), jamais de chaîne de décalages.
- Courbe Réel (`lib/amortization-series.ts`) : un point seulement dans un mois où un débit a eu lieu ; il compte chaque échéance rattachée au mois de SON débit (avance comprise). « Dernier prélèvement connu » = mois du dernier débit réel. Une échéance prélevée le mois voisin n'est pas un trou (pas de « aucun prélèvement ») : pas de point ce mois-là, l'infobulle dit « Échéance prélevée en … » / « Prélèvement compté pour l'échéance de/d'… », la phrase « Échéance de/d'X prélevée en Y ».
- Tests de cohérence (`amortization-chart.test.tsx`) : lus sur ce que l'écran rend (phrase, infobulles) contre les débits du jeu.
- Nouveautés compilées à la main (même format que `cadence news build`) quand cadence n'est pas disponible, puis `nouveautes-tailles.mjs` et `npm run plan`.
