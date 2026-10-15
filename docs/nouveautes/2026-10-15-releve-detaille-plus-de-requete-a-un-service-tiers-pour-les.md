---
title: "Relevé détaillé : plus de requête à un service tiers pour les logos"
date: 2026-10-15
created: 2026-10-15T13:23+02:00
lots: [L69]
captures:
  - { file: captures/2026-10-15-l69-avatar-initiale.png, alt: "Détail d'un relevé de septembre 2026 : chaque transaction est précédée d'une pastille grise portant l'initiale du marchand (V, F, B, C, E, Y, M)" }
---
Dans le détail d'un relevé, chaque transaction est maintenant précédée d'une pastille portant l'initiale du marchand (C pour Carrefour, E pour EDF…). Les logos n'étaient récupérés que par un service extérieur, qui ne répondait plus pour la plupart des marchands et laissait des erreurs dans la console du navigateur à chaque visite.

Plus aucune requête ne part vers un service tiers pour afficher ces pastilles : elles sont dessinées par l'application elle-même, et le détail d'un relevé se charge sans erreur.
