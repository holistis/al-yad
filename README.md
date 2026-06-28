# Yad (يد) — self-hostbare, privacy-first AI-browser-automatiserings-agent

Codenaam Yad ("de hand"). Een dunne browser-extensie (de Hand) bestuurd door een lokaal/EU-gehost brein (de Companion), die in de echte ingelogde sessie van de gebruiker werkt, een taak één keer leert en hem daarna deterministisch en bijna gratis herhaalt.

Volledig plan: zie het goedgekeurde bouwplan (`je-weet-waar-we-parsed-bee.md`).

## Architectuur (kort)

- `packages/shared` — gedeelde types/protocol tussen Hand en Brein.
- `packages/companion` — het Brein: native-messaging host, agent-loop, motor (LLM-router), geheugen (action-cache), sleutel (sessie/vault), poort (guardrails).
- `packages/extension` — de Hand: MV3-extensie (WXT), houdt de native-messaging-poort open, voert acties uit.
- `packages/dashboard` — de Winkel: multi-tenant control + billing (latere fase).
- `packages/adapters/REDACTED-session` — brug naar het bestaande `REDACTED` project.

## Status

Fase 1 in opbouw. Eerste mijlpaal (taak nummer 1): de native-messaging handshake tussen Hand en Brein groen op Windows. Daar hangt alles aan.

## Licentie-discipline

Alleen MIT/Apache-2.0 dependencies. Geen AGPL (geen browser-use/Skyvern/BrowserOS als dependency). Zie `LICENSES.md`. CI faalt op overtreding via `scripts/check-licenses.ts`.

## Ontwikkelen

```
pnpm install
pnpm build
pnpm typecheck
pnpm test
```
