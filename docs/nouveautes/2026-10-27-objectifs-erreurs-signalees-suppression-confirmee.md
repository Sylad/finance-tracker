---
title: "Objectifs : erreurs signalées, suppression confirmée"
date: 2026-10-27
created: 2026-10-27T20:50+02:00
lots: [L35]
captures:
  - { file: captures/objectifs-liste-1440.png, alt: "Page Objectifs à 1440 px : deux objectifs avec leur barre de progression" }
  - { file: captures/objectifs-echec-creation-390.png, alt: "Page Objectifs à 390 px : message d'échec de création placé juste au-dessus du formulaire rempli" }
---
Sur la page Objectifs, si la liste ne se charge pas, un message « Impossible de charger les objectifs » avec un bouton Réessayer remplace l'ancien affichage « Aucun objectif ».

Supprimer un objectif demande maintenant une confirmation dans la page, qui précise que tes comptes et tes relevés ne changent pas. Quand une suppression ou une création échoue, un message le dit en nommant l'objectif ; en cas d'échec de création, le formulaire reste rempli.

La corbeille cite l'objectif concerné, chaque champ du formulaire est relié à son libellé, la barre de progression est annoncée aux lecteurs d'écran, et un montant cible nul ou négatif ne permet plus de créer l'objectif.
