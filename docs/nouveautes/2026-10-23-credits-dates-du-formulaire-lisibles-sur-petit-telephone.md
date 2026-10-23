---
title: "Crédits : dates du formulaire lisibles sur petit téléphone"
date: 2026-10-23
created: 2026-10-23T18:25+02:00
lots: [L144]
nocapture: écran modifié seulement sous 360 px de large ; l'application (backend et PIN) n'était pas lancée dans cette session, le comportement est couvert par un test
# une capture peut dire ce qu'elle montre : captures: [{ file: captures/x.png, alt: "texte alternatif" }]
# nocapture: raison, quand une capture n'a pas de sens
---
Dans le formulaire d'un crédit classique, les champs « Date début » et « Date fin » ne coupent plus l'année (« 07/05/202 ») sur un petit téléphone : sous 360 px de large, ils s'affichent l'un sous l'autre, chacun sur toute la largeur. Dès 360 px, ils restent côte à côte.
