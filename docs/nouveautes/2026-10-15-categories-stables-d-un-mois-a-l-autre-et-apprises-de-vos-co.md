---
title: Catégories stables d'un mois à l'autre et apprises de vos corrections
date: 2026-10-15
created: 2026-10-15T16:47+02:00
lots: [L75]
captures: []
nocapture: capture du panneau Catégoriser à refaire après la revue UX du lot (le panneau vient d'être modifié) ; le reste est un changement de fond sans écran
---
Les enseignes courantes reçoivent désormais toujours la même catégorie, d'un mois à l'autre.

- **Enseignes connues** : Carrefour, Leclerc, Lidl et Uber Eats vont en Alimentation ; SNCF, TotalEnergies, Vinci et Uber en Transport ; Netflix, Free et Orange en Abonnements. Cela s'applique quand vous importez ou ré-analysez un relevé, sur les dépenses uniquement (un remboursement garde sa catégorie).
- **Libellés bancaires nettoyés pour la reconnaissance** : « PAIEMENT CB 1203 CARREFOUR MARKET 12/03 » est reconnu comme Carrefour. Les libellés affichés dans vos relevés ne changent pas.
- **Vos règles passent d'abord** : si vous avez une règle sur une enseigne, elle l'emporte sur ce dictionnaire.
- **Auto-catégorisation plus économe** : les enseignes connues sont proposées tout de suite, avec une confiance maximale, et ne sont plus envoyées à Claude.
- **Mémoriser un marchand en un clic** : dans le panneau « Catégoriser », le choix « Mémoriser pour « AMAZON FR » » est sélectionné par défaut. Il nomme le marchand retenu et crée la règle à votre place, sans motif à saisir ; elle s'applique aux prochains imports. Une règle existante n'est jamais écrasée. Vous pouvez à la place écrire votre propre motif, ou ne créer aucune règle (« Aucune règle »). Si le libellé ne contient aucun nom de marchand, la mémorisation est grisée et la catégorie est seulement appliquée à cette transaction.
