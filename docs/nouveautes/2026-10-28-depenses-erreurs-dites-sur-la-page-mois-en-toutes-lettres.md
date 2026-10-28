---
title: "Dépenses : erreurs dites sur la page, mois en toutes lettres"
date: 2026-10-28
created: 2026-10-28T19:50+01:00
lots: [L38]
captures:
  - { file: captures/depenses-1440.png, alt: "Page Dépenses à 1440 px : camembert, légende et détail des retraits d'une part" }
  - { file: captures/depenses-390.png, alt: "Page Dépenses à 390 px : tout tient dans la largeur, les libellés longs sont coupés" }
  - { file: captures/depenses-erreur-390.png, alt: "Dépenses à 390 px : message « Impossible de charger les dépenses » avec le bouton Réessayer, le choix du mois reste accessible" }
  - { file: captures/depenses-analyse-erreur-1440.png, alt: "Dépenses à 1440 px : message d'analyse indisponible affiché au-dessus du camembert" }
  - { file: captures/depenses-analyse-erreur-390.png, alt: "Dépenses à 390 px : message d'analyse indisponible affiché sous les boutons" }
# une capture peut dire ce qu'elle montre : captures: [{ file: captures/x.png, alt: "texte alternatif" }]
# nocapture: raison, quand une capture n'a pas de sens
---
Sur la page Dépenses, le choix du mois se lit en toutes lettres (« Septembre 2026 » au lieu de « 2026-09 »), dans le menu comme dans le sous-titre.

Quand le relevé ne peut pas être chargé, la page le dit (« Impossible de charger les dépenses ») et propose **Réessayer**, au lieu d'afficher « Aucun relevé ». Quand « Proposer des coupes » échoue, le message apparaît sur la page, juste sous les boutons, et non plus dans une fenêtre du navigateur. Pendant l'analyse, la page indique qu'elle dure de 1 à 3 minutes.

La légende du camembert annonce quelle part est sélectionnée aux lecteurs d'écran, un mois sans aucun retrait affiche des 0,0 % au lieu de valeurs absurdes, les libellés tronqués s'affichent en entier au survol, et sur téléphone la page ne dépasse plus de la largeur de l'écran.
