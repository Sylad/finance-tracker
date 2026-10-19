---
title: "Prévisions : message clair en cas d'erreur ou sans déclaration"
date: 2026-10-19
created: 2026-10-19T20:44+02:00
lots: [L89]
captures:
  - { file: captures/previsions-erreur-1440.png, alt: "Page Prévisions sur ordinateur : un message d'erreur « Impossible de charger les prévisions » avec un bouton Réessayer" }
  - { file: captures/previsions-erreur-390.png, alt: "Page Prévisions sur téléphone : le même message d'erreur avec le bouton Réessayer" }
# une capture peut dire ce qu'elle montre : captures: [{ file: captures/x.png, alt: "texte alternatif" }]
# nocapture: raison, quand une capture n'a pas de sens
---
Sur la page Prévisions, quand le chargement échoue, tu vois maintenant un message d'erreur « Impossible de charger les prévisions » avec un bouton **Réessayer**. Avant, la page affichait à tort « Pas de déclaration → pas de prévision », comme si tu n'avais rien déclaré.

Et quand tes déclarations ne produisent aucune ligne sur la période, la page n'affiche plus douze cartes vertes à 0,00 € : elle explique qu'il n'y a pas de prévision et propose un bouton vers la page Déclarations pour ajouter tes revenus et engagements.
