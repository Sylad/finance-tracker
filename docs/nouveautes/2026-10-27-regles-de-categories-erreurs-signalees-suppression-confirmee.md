---
title: "Règles de catégories : erreurs signalées, suppression confirmée, lisible sur téléphone"
date: 2026-10-27
created: 2026-10-27T19:40+02:00
lots: [L34]
captures:
  - { file: captures/regles-confirmation-390.png, alt: "Page Règles de catégorisation à 390 px : fenêtre de confirmation avant de supprimer une règle" }
  - { file: captures/regles-liste-1440.png, alt: "Page Règles de catégorisation à 1440 px : catégories et règles actives par priorité" }
  - { file: captures/regles-echec-visible-390.png, alt: "Page Règles de catégorisation à 390 px : le message d'échec d'un ajout de catégorie s'affiche entier sous la barre du haut" }
  - { file: captures/regles-echec-visible-1440.png, alt: "Page Règles de catégorisation à 1440 px : le message d'échec d'un ajout de catégorie en haut de la page" }
---
Sur la page Règles de catégorisation, si la liste ne se charge pas, un message « Impossible de charger les règles de catégorisation » avec un bouton Réessayer remplace l'ancien affichage « 0 règle active ».

Supprimer une règle demande maintenant une confirmation dans la page, qui rappelle que les transactions déjà catégorisées gardent leur catégorie. Quand une suppression, un ajout de catégorie, le rejeu sur l'historique ou l'analyse des suggestions échoue, un message le dit, amené à l'écran et lisible en entier sur téléphone ; le nom saisi pour une nouvelle catégorie n'est plus effacé en cas d'échec. Le résultat du rejeu est annoncé aux lecteurs d'écran.

Les corbeilles et les boutons Accepter, Plus tard et Rejeter citent la règle ou la catégorie concernée. Sur téléphone, chaque règle s'affiche sur plusieurs lignes au lieu d'être tronquée.
