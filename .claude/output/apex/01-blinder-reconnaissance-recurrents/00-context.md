# APEX Task: 01-blinder-reconnaissance-recurrents

**Created:** 2026-05-07T13:00 (auto mode, save mode)
**Project:** finance-tracker

## User Request

Blinder la reconnaissance des crédits / salaires / abonnements. Garantir
qu'un PDF de relevé de crédit ajouté est reconnu via le N° de crédit.
Gérer les décalages temporels entre :
- Relevés de compte bancaire (décrivent le mois précédent)
- Saisies manuelles de crédits (concernent le mois actuel)
- Relevés de crédit PDF (1×/mois, pas à la même date que le relevé bancaire)

## Acceptance Criteria

- [ ] AC1 : Quand un PDF est uploadé, le backend détecte si c'est un
  relevé de crédit (vs relevé de compte) et identifie le N° de crédit
- [ ] AC2 : Les transactions importées d'un relevé de crédit sont liées
  au crédit correspondant via le N°, pas via heuristiques (montant/date)
- [ ] AC3 : Pas de double-comptage si la même mensualité crédit apparaît
  dans le relevé de compte (prélèvement) ET dans le relevé de crédit
  (échéance) avec décalage de quelques jours
- [ ] AC4 : Reconnaissance salaire récurrent (libellé + montant ±5%) +
  abonnements récurrents (Netflix, Spotify, etc.) blindée — détection
  fiable même si le libellé varie
- [ ] AC5 : Saisies manuelles de crédits = mois actuel ; relevés bancaires
  = mois précédent. La timeline des bilans annuels est cohérente.
