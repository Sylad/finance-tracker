---
title: Catégories stables d'un mois à l'autre et apprises de vos corrections
date: 2026-10-15
created: 2026-10-15T16:47+02:00
lots: [L75]
captures:
  - { file: captures/2026-10-15-l75-categoriser-memoriser-1440.png, alt: "Panneau « Catégoriser » sur ordinateur : la catégorie Loisirs est choisie pour « CB AMAZON.FR » et trois choix de règle sont proposés, « Mémoriser pour « AMAZON FR » » étant coché, puis « Règle avec un motif à saisir » et « Aucune règle »" }
  - { file: captures/2026-10-15-l75-categoriser-memoriser-390.png, alt: "Le même panneau « Catégoriser » sur téléphone, avec les trois choix de règle l'un sous l'autre et « Mémoriser pour « AMAZON FR » » coché" }
---
Les enseignes courantes reçoivent désormais toujours la même catégorie, d'un mois à l'autre.

- **Enseignes connues** : Carrefour, Leclerc, Lidl et Uber Eats vont en Alimentation ; SNCF, TotalEnergies, Vinci et Uber en Transport ; Netflix, Free et Orange en Abonnements. Cela s'applique quand vous importez ou ré-analysez un relevé, sur les dépenses uniquement (un remboursement garde sa catégorie).
- **Libellés bancaires nettoyés pour la reconnaissance** : « PAIEMENT CB 1203 CARREFOUR MARKET 12/03 » est reconnu comme Carrefour. Les libellés affichés dans vos relevés ne changent pas.
- **Vos règles passent d'abord** : si vous avez une règle sur une enseigne, elle l'emporte sur ce dictionnaire.
- **Auto-catégorisation plus économe** : les enseignes connues sont proposées tout de suite, avec une confiance maximale, et ne sont plus envoyées à Claude.
- **Mémoriser un marchand en un clic** : dans le panneau « Catégoriser », le choix « Mémoriser pour « AMAZON FR » » est sélectionné par défaut. Il nomme le marchand retenu et crée la règle à votre place, sans motif à saisir ; elle s'applique aux prochains imports. Une règle existante n'est jamais écrasée. Vous pouvez à la place écrire votre propre motif, ou ne créer aucune règle (« Aucune règle »). La mémorisation est grisée, et la catégorie seulement appliquée à cette transaction, quand le libellé ne contient aucun nom de marchand, quand ce nom est trop court (moins de 4 lettres) ou quand ses mots ne se retrouvent pas tels quels dans le libellé (accents, chiffres intercalés) ; le panneau en donne alors la raison. Si vous choisissez une catégorie différente de celle que l'application reconnaît pour ce marchand (un loyer « Vinci Immobilier » remis en Logement alors que Vinci est classé en Transport), la règle mémorisée porte sur le libellé entier et pas seulement sur le nom de l'enseigne, pour ne pas détourner tous les autres paiements de cette enseigne.
