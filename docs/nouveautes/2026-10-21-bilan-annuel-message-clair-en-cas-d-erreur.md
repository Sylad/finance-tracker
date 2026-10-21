---
title: "Bilan annuel : message clair en cas d'erreur"
date: 2026-10-21
created: 2026-10-21T17:59+02:00
lots: [L100]
captures: []
# une capture peut dire ce qu'elle montre : captures: [{ file: captures/x.png, alt: "texte alternatif" }]
nocapture: "l'état d'erreur demande de faire échouer l'API, ce que la démo en lecture seule ne permet pas ; il est prouvé par des tests"
---
Sur la page Bilan annuel, un problème de chargement n'est plus caché. Si la liste des bilans ne peut pas se charger, la page affiche « Impossible de charger les bilans annuels » avec un bouton Réessayer, au lieu de faire croire qu'il n'y a pas encore de bilan. Si le détail d'une année échoue, la page affiche « Impossible de charger le bilan » de cette année avec Réessayer, au lieu d'un « Chargement… » qui ne finit jamais ; les boutons d'année restent disponibles pour en choisir une autre.
