---
title: "Santé financière : tiroir des seuils au clavier, erreurs dites, conseils fiables"
date: 2026-10-28
created: 2026-10-28T11:53+01:00
lots: [L37]
captures:
  - { file: captures/sante-1440.png, alt: "Santé financière à 1440 px : bandeau verdict et quatre cartes" }
  - { file: captures/sante-390.png, alt: "Santé financière à 390 px : bandeau verdict puis les cartes en colonne" }
  - { file: captures/sante-tiroir-erreur-1440.png, alt: "Tiroir des seuils à 1440 px : un seuil vidé, message d'erreur en haut et champ signalé" }
  - { file: captures/sante-tiroir-erreur-390.png, alt: "Tiroir des seuils à 390 px : message d'erreur en haut, champ fautif en rouge juste dessous" }
# une capture peut dire ce qu'elle montre : captures: [{ file: captures/x.png, alt: "texte alternatif" }]
# nocapture: raison, quand une capture n'a pas de sens
---
Le tiroir « Ajuster les seuils » de la page Santé financière se manie maintenant entièrement au clavier : le focus y entre à l'ouverture, Tab reste dans le tiroir, Échap le ferme et te ramène sur le bouton d'où tu venais. Le bouton de fermeture a un nom pour les lecteurs d'écran.

Quand un seuil est vide ou incohérent, le message d'erreur s'affiche en haut du tiroir et le curseur saute sur le champ fautif, même sur téléphone. Si les seuils ne se chargent pas, ou si « Restaurer les défauts » échoue, tu le lis dans le tiroir (avec un bouton Réessayer pour le chargement) au lieu d'un « Chargement… » sans fin ou d'un échec silencieux.

Si le diagnostic ne se charge pas, la page propose un bouton Réessayer. Dans le champ de revenu manuel, une valeur vide ou nulle est expliquée au lieu d'être ignorée, et les messages d'échec sont plus lisibles (contraste relevé de 3,96:1 à 4,99:1 au plus bas).

Les conseils personnalisés ne signalent plus à tort une erreur tant qu'aucun conseil n'a été généré ; en cas de vrai échec de lecture, la page le dit. Le graphique de trajectoire a une description en texte, et ses deux étiquettes (Actuel, Projeté) sont visibles.
