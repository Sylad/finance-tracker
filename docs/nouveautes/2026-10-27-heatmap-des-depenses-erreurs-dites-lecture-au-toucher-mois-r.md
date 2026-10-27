---
title: "Heatmap des dépenses : erreurs dites, lecture au toucher, mois récents en vue"
date: 2026-10-27
created: 2026-10-27T21:51+01:00
lots: [L36]
captures:
  - { file: captures/heatmap-lecture-1440.png, alt: "Heatmap des dépenses à 1440 px : une journée choisie est lue sous la grille, avec son montant" }
  - { file: captures/heatmap-lecture-390.png, alt: "Heatmap à 390 px : la grille s'ouvre sur les mois récents, la journée touchée est lue juste dessous" }
  - { file: captures/heatmap-echec-390.png, alt: "Heatmap à 390 px : message d'échec de chargement avec le bouton Réessayer" }
---
Sur la page Heatmap des dépenses, tu peux maintenant toucher ou cliquer une case pour lire le jour et son montant sous la grille, sans avoir besoin du survol. Sur téléphone, la grille s'ouvre directement sur les mois les plus récents.

Si les relevés ne se chargent pas, un message « Impossible de charger la heatmap » avec un bouton Réessayer remplace le chargement qui tournait sans fin. Sans relevé importé, la page l'explique au lieu de tourner dans le vide.

Les étiquettes de mois ne se chevauchent plus, les textes de l'axe et de la légende sont plus lisibles, le sélecteur de période porte un nom, et la grille est résumée en une phrase pour les lecteurs d'écran (jours avec débit, total, journée la plus dépensière).

L'échelle de couleur a changé de sens : avant, plus la case était foncée, plus tu avais dépensé ; maintenant, plus la case est claire, plus tu as dépensé (le sous-titre de la page le rappelle).
