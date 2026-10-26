---
title: "Abonnements : dialogues et messages d'échec clairs"
date: 2026-10-26
created: 2026-10-26T08:25+01:00
lots: [L151]
captures:
  - { file: captures/abonnements-confirmation-1440.png, alt: "Confirmation « Supprimer Netflix ? » dans la page, avec Annuler et Supprimer" }
  - { file: captures/abonnements-echec-suppression-1440.png, alt: "Message d'échec « Suppression de Netflix impossible » sous l'en-tête, à 1440 px" }
  - { file: captures/abonnements-echec-suppression-390.png, alt: "Le même message d'échec sur téléphone, à 390 px" }
# une capture peut dire ce qu'elle montre : captures: [{ file: captures/x.png, alt: "texte alternatif" }]
# nocapture: raison, quand une capture n'a pas de sens
---
Sur la page Abonnements, les confirmations ne passent plus par les petites fenêtres du navigateur : **Supprimer** et **Reset** ouvrent une fenêtre dans la page, avec Annuler et un bouton qui dit ce qu'il fait. Le résultat d'un Reset s'affiche dans la page, et la fenêtre **Doublons** se ferme avec Échap et garde le clavier à l'intérieur.

Quand une action échoue, tu le vois : suppression, masquage (« Connu, masquer »), rejet (« Faux positif »), fusion de doublons ou enregistrement affichent un message qui nomme l'abonnement ou la suggestion concernés, au lieu de ne rien dire.

Si les suggestions ne se chargent pas et que tu n'as aucun abonnement, la page ne te dit plus d'importer un relevé : elle explique que les suggestions n'ont pas pu être chargées. Le champ « Pattern (regex) » du formulaire devient « Motif cherché dans les libellés (expression régulière) ».
