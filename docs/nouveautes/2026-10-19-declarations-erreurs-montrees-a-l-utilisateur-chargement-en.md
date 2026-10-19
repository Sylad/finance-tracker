---
title: "Déclarations : quand ça ne marche pas, la page te le dit"
date: 2026-10-19
created: 2026-10-19T10:46+02:00
lots: [L87]
captures: []
nocapture: "le navigateur de capture n'a pas pu démarrer dans cette session ; les états d'erreur sont prouvés par des tests"
---
Sur la page Déclarations, un problème n'est plus passé sous silence. Si la liste ne peut pas se charger, la page affiche « Impossible de charger les déclarations » avec un bouton Réessayer, au lieu de faire croire qu'il n'y a aucune déclaration. Si un enregistrement est refusé, le message du serveur apparaît dans la fenêtre de saisie, qui reste ouverte avec tout ce que tu as tapé. Si une suppression échoue, un message indique quelle déclaration n'a pas été supprimée, au moment où la ligne réapparaît.
