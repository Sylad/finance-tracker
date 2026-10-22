---
title: "Import de relevés : suivi et noms de fichiers justes"
date: 2026-10-22
created: 2026-10-22T12:45+02:00
lots: [L113]
captures:
  - { file: captures/suivi-import-1440.png, alt: "Page Importer des relevés à 1440 px : le nom « relevé_août_2026.pdf » est lisible dans l'historique, un fichier ignoré indique « déjà importé », et la bannière d'installation ne recouvre plus le bouton Analyser" }
  - { file: captures/suivi-import-390.png, alt: "La même page à 390 px" }
---
Sur la page d'import, le suivi et l'affichage sont plus justes.

- Les noms de fichiers accentués s'affichent correctement dans l'historique des imports (« relevé_août… » au lieu de « relevÃ©_aoÃ»t… »).
- Un fichier ignoré parce que son mois est déjà importé passe tout de suite à « Fait » pendant l'analyse, fait avancer « fichier k / N » et apparaît dans l'historique avec « déjà importé : » suivi du mois.
- Sur grand écran, la bannière d'installation ne recouvre plus le bouton « Analyser ».
- Quand le serveur est momentanément injoignable, le message ne dit plus que le relevé n'a pas été importé : il invite à consulter l'historique avant de relancer. Un fichier trop volumineux est signalé en français (20 Mo maximum par fichier).
