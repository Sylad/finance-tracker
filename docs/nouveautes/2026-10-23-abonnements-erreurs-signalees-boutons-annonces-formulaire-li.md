---
title: "Abonnements : erreurs signalées, boutons annoncés, formulaire lisible sur téléphone"
date: 2026-10-23
created: 2026-10-23T23:02+02:00
lots: [L33]
captures:
  - { file: captures/abonnements-formulaire-390.png, alt: "Formulaire Nouvel abonnement à 390 px : champs sur une colonne, titre et boutons visibles" }
  - { file: captures/abonnements-liste-1440.png, alt: "Page Abonnements à 1440 px" }
# une capture peut dire ce qu'elle montre : captures: [{ file: captures/x.png, alt: "texte alternatif" }]
# nocapture: raison, quand une capture n'a pas de sens
---
Sur la page Abonnements, si la liste ne se charge pas, un message « Impossible de charger les abonnements » avec un bouton Réessayer remplace l'ancien écran « Aucun abonnement déclaré ». Si seules les suggestions échouent, un message « Suggestions indisponibles » s'affiche au-dessus de la liste, qui reste visible.

Les boutons crayon et corbeille de chaque ligne, ainsi que Enregistrer, Connu, masquer et Faux positif de chaque suggestion, sont annoncés par les lecteurs d'écran avec le nom de l'abonnement ou de la suggestion concernée.

Le formulaire Nouvel abonnement / Modifier l'abonnement est une vraie fenêtre : le curseur arrive sur le premier champ, la touche Échap la ferme et le focus revient au bouton d'origine. Sur téléphone, les champs passent sur une seule colonne et la fenêtre défile, de sorte que le titre et les boutons restent atteignables.
