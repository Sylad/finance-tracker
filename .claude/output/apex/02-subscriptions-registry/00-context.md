# APEX Task: 02-subscriptions-registry

**Created:** 2026-05-07T14 (auto + save)
**Project:** finance-tracker

## User Request
Volet C reporté de /apex 01 : Subscriptions registry — modèle `Subscription`
pour abonnements récurrents (Netflix, Spotify, Amazon Prime, Canal+, etc.),
auto-detect, page registry frontend.

## Acceptance Criteria
- [ ] AC1 : Modèle Subscription persisté dans data/subscriptions.json
- [ ] AC2 : Endpoints CRUD /subscriptions (list/get/create/update/delete)
- [ ] AC3 : Pattern matching transaction → subscription via matchPattern (regex) + amount ±5% (réutilise pattern Loans)
- [ ] AC4 : Page /subscriptions enrichie avec registry réel (vs triage seulement)
- [ ] AC5 : Quand user accepte LoanSuggestion type='subscription', router vers Subscription au lieu de Loan
