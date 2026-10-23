---
title: "Épargne : notes des versements affichées en entier"
date: 2026-10-23
created: 2026-10-23T11:27+02:00
lots: [L128]
nocapture: le cas ne se voit qu'avec un versement détecté dont la note commence par « Intérêts », absent des données de démo ; il est couvert par un test
# une capture peut dire ce qu'elle montre : captures: [{ file: captures/x.png, alt: "texte alternatif" }]
# nocapture: raison, quand une capture n'a pas de sens
---
Dans la liste des mouvements d'un compte épargne, la note d'un versement détecté s'affiche désormais en entier. Un versement noté « Intérêts créditeurs LDDS » ne perd plus son premier mot et n'apparaît plus comme « créditeurs LDDS ». Les notes des intérêts, elles, restent présentées comme avant.
