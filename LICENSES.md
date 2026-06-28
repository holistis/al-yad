# Licentie-discipline (hard)

Yad wordt verkocht als product. Daarom: **alleen permissieve dependencies (MIT, Apache-2.0, ISC, BSD).**

## Verboden als dependency

- **AGPL-3.0** (copyleft bij netwerk-distributie): `browser-use`, `Skyvern`, `BrowserOS`. Niet als dependency gebruiken in een commercieel/SaaS-product.
- Elke andere copyleft/onbekende licentie zonder expliciete review.

## Toegestaan + waar we van lenen (alleen patronen, geen monolithische dependency)

- **Nanobrowser** (Apache-2.0): MV3-skelet + Planner/Navigator/Validator-patroon.
- **Stagehand** (MIT): action-caching/replay-idee.
- **WXT** (MIT), **Playwright** (Apache-2.0), **Drizzle** (Apache-2.0), **better-sqlite3** (MIT).

## Handhaving

`scripts/check-licenses.ts` draait in CI en faalt de build bij elke niet-toegestane (ook transitieve) licentie. De allowlist staat in dat script.
