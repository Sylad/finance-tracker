# Carte — finance-tracker

## Écrans
- **404** (`components/not-found.tsx`, `defaultNotFoundComponent`) : « Page introuvable » + lien vers le tableau de bord, visible seulement une fois connecté (Root redirige vers /login avant).
- **Titres d'onglet** (`components/layout/page-title.ts`) : « <libellé de navigation> — Finance Tracker » sur correspondance EXACTE d'une page ; seule sous-page : `/history/<id>` (« Historique », liste `SUB_PAGES`). Tout autre chemin, sous-chemin d'une page connue compris (`/plan/x`, `/loans/x`), = « Page introuvable — Finance Tracker ». Connexion : « Connexion — Finance Tracker ».

## Décisions (L169)
- Camemberts de /expenses et du relevé : `aria-hidden` + `rootTabIndex={-1}` ; l'information passe par la légende / liste de catégories. Testés avec un `Pie` simulé qui reproduit le tabindex du `<g>` racine de recharts.
- Cibles ≥ 24 px : classe `min-h-6`, testée par classe (jsdom sans mise en page) dans `components/l169-targets.test.tsx`.
- Bilan annuel : le tableau « Détail mois par mois » défile dans une région nommée, `tabIndex=0`.
- Nouvelle sous-route imbriquée dans le routeur → l'ajouter à `SUB_PAGES`, sinon le test R2 d'app-shell échoue.
