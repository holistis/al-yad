# Onderzoek + bouwstaat: standalone desktop-app (v1 prototype)

Datum: 2026-08-26. Bewaar dit zodat een volgende sessie niet opnieuw hoeft te graven.

## Wat er vandaag is gebouwd

`packages/desktop-app` — v1-prototype van "YAD openen als een gewoon
programma", zonder eerst zelf Chrome+extensie te starten of een
CLI-commando te typen. Twee delen:

1. **Lokale server** (`src/main.ts`, poort 3761) die dezelfde motor
   hergebruikt als `main-server.ts`/`main-playwright.ts` uit
   `packages/companion`: `PlaywrightHand` + `ScopeGuard` + `AgentLoop` +
   `LlmRouter` + `buildPool` (`src/runner.ts`), plus een eigen simpele
   UI-pagina (doel invoeren, Run-knop, live-stappenfeed). Automatiserings-
   browser draait **headed** (zichtbaar) — een bureaublad-app, je mag
   toekijken.
2. **`launch.bat` / `src/launch.ts`** — dubbelklikbaar. Start de server (als
   nog niet actief) en opent systeem-Chrome/Edge (of, dev-only-terugval,
   Playwright's eigen Chromium) in app-modus (`--app=http://localhost:3761/`)
   — geen tabbalk/adresbalk, voelt aan als een los venster. Dat venster is
   **alleen de UI-schil**; de browser die de taak uitvoert is een compleet
   ander, apart Playwright-Chromium-proces.

v1 = één run tegelijk (geen wachtrij zoals `packages/dashboard`).

## Waarom Chrome-appmodus + Node-server, niet Tauri/Electron

- **Tauri** vereist een Rust-toolchain — staat niet op dit toestel; die
  erbij trekken voor een prototype is overbodig toolchain-onderhoud.
- **Electron** bakt een eigen Chromium mee (nieuwe download) — via
  Playwright (`npx playwright install chromium`, gebruikt door
  `packages/companion` toch al) staat er al een werkende Chromium op dit
  toestel. Nóg een Chromium erbij halen voor hetzelfde doel is overbodig.
- Systeem-**Chrome/Edge in `--app`-modus** geeft het venster-gevoel gratis:
  elke echte YAD-gebruiker heeft Chrome toch al (de extensie vereist het).

Resultaat: één Node-server (bestaande motor hergebruikt) + één spawn naar
een executable die er al staat — geen nieuwe runtime/toolchain/download.

## Wat nog rest voor een echt verkoopbaar product (bewust NIET gedaan)

Zelfde open punt als **`docs/ONDERZOEK-companion-standalone-2026-08-20.md`**
al documenteert, hier niet opnieuw opgelost: een **getekende `.exe` zonder
Node-vereiste** (Node SEA-wrapping + code-signing), zodat een niet-
technische gebruiker kan installeren zonder zelf Node/pnpm te hebben. Dat
onderzoek stelt dat die stap wacht op bewezen vraag (YAD had op 2026-08-20
nul bewezen vraag — geheugen `rechterhand-loops-brief-2026-08-20`); dat is
vandaag niet herbeoordeeld, dus die conclusie blijft staan. `desktop-app`
bewijst alleen het "voelt als een programma"-gevoel end-to-end; vereist nog
steeds vooraf `pnpm install && pnpm build` en Node op de machine.

Ook niet gebouwd (net als `packages/dashboard`): meerdere taken tegelijk,
taakgeschiedenis, authenticatie. Specifiek gat: runs via `runner.ts`
schrijven niet naar `data/run-history.jsonl` (dat loopt via
`packages/companion/src/session.ts`, dat `runner.ts` bewust niet gebruikt).

## Benchmark-resultaat van vandaag

Geen volledige benchmarksuite gedraaid (`scripts/benchmark.ts` — laatste
resultaatbestand is van 23-08). Wél één echte verificatie ná de build via de
nieuwe motor: goal "Read the page title again" op `example.com`. **Geslaagd**
— de cache-entry in `packages/desktop-app/data/action-cache.json` (alleen
geschreven door `AgentLoop` bij een schone, geslaagde run) bevestigt de
correcte extractie ("De paginatitel is 'Example Domain'."). Eén smoke-test,
geen statistisch bewijs — geen bredere claim dan dat.

## Herbouw-commando's

```bash
pnpm install
pnpm build                               # shared -> companion -> desktop-app (turbo-volgorde)
npx playwright install chromium          # eenmalig, voor de automatiseringsbrowser
node packages/desktop-app/dist/launch.js # of dubbelklik packages/desktop-app/launch.bat
node packages/desktop-app/dist/main.js   # alternatief: alleen de server, zelf browser openen
```

Let op: `pnpm --filter @yad/desktop-app build` alléén bouwt NIET op een
verse checkout (dat filter bouwt de workspace-afhankelijkheden eronder niet
mee) — bouw vanaf de repo-root (`pnpm build`) zodat turbo de volgorde regelt.
