---
title: "Import de relevés : contrôle des fichiers affiné"
date: 2026-10-22
created: 2026-10-22T12:31+02:00
lots: [L112]
captures:
  - { file: captures/import-controle-1440.png, alt: "Page Importer des relevés à 1440 px : un fichier texte est refusé dans un encadré avec sa raison, les deux PDF restent dans la liste" }
  - { file: captures/import-controle-390.png, alt: "La même page à 390 px" }
---
Sur la page d'import, le contrôle des fichiers à la sélection est plus juste.

- Un PDF trop gros n'est plus annoncé « 20,0 Mo » : la taille affichée est arrondie au supérieur, donc un fichier un peu au-dessus de 20 Mo se lit « 20,1 Mo ».
- Un fichier en `.pdf` dont le navigateur ne donne pas le type est refusé tout de suite, avec une raison explicite, au lieu de faire échouer l'envoi de tout le lot.
- Quand la liste atteint 12 fichiers, le bouton « Parcourir » se désactive : si vous l'aviez utilisé au clavier, le focus passe au premier bouton « Retirer » au lieu de se perdre.
