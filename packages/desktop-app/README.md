# @yad/desktop-app

YAD openen als een gewoon programma op je laptop — zonder eerst Chrome met de
extensie te starten, zonder CLI-commando's.

## Wat dit is

Vóór dit pakket bestonden er alleen een CLI (`main-playwright.ts`) en een
headless HTTP-server (`main-server.ts`) in `packages/companion` — niets wat
een niet-technisch iemand kon dubbelklikken. Dit pakket lost dat op met twee
delen:

1. **Een lokale server** (`src/main.ts`) die dezelfde motor hergebruikt als
   `main-server.ts`/`main-playwright.ts` (`PlaywrightHand` + `AgentLoop` +
   `LlmRouter` + `buildPool`, allemaal uit `packages/companion`) en een kleine
   eigen UI-pagina serveert (doel invoeren, Run-knop, live-stappenfeed,
   resultaatpaneel). Draait de automatiseringsbrowser **headed** (zichtbaar) —
   dit is een bureaublad-app, je mag toekijken.
2. **`launch.bat`** — dubbelklikbaar. Start de server (als die nog niet
   draait) en opent daarna een systeem-Chrome (of Edge) in **app-modus**
   (`--app=http://localhost:3761/`), wat de tabbalk en adresbalk verbergt —
   voelt aan als een los venster, niet als een browsertab.

Dat app-modus-venster is **alleen de UI-schil**. De browser die de taak
daadwerkelijk uitvoert is een compleet ander, apart Playwright-Chromium-
proces — de twee staan volledig los van elkaar.

v1 = **één run tegelijk** (geen wachtrij zoals `packages/dashboard` — dat is
een ander product voor een ander gebruik: meerdere taken parallel volgen).

## Bouwen en draaien

Dit pakket importeert de **gecompileerde** `dist/`-output van `@yad/companion`
en `@yad/shared` (zie de `@yad/companion/dist/...`-imports in `src/runner.ts`
en `src/live-hand.ts`). `pnpm --filter @yad/desktop-app build` bouwt daarom
NIET op een verse checkout: pnpm's `--filter` bouwt alleen het genoemde
pakket, niet de workspace-afhankelijkheden eronder (dat is turbo's taak via
`dependsOn: ["^build"]`, niet iets wat `pnpm --filter` zelf doet). Bouw
daarom vanaf de repo-root, waar turbo shared → companion → desktop-app in de
juiste volgorde bouwt:

```bash
pnpm install
pnpm build
```

Zijn `@yad/shared` en `@yad/companion` al gebouwd (bv. tijdens ontwikkelen
binnen dit pakket), dan volstaat ook:

```bash
pnpm --filter @yad/desktop-app build
```

De automatiseringsbrowser (Playwright's eigen Chromium — een apart, eenmalig
gedownload binary, los van het systeem-Chrome/Edge dat de UI-schil gebruikt,
zie hieronder) moet daarnaast één keer beschikbaar zijn:

```bash
npx playwright install chromium
```

Zonder deze stap toont de eerste "Run" een duidelijke foutmelding die
hiernaar terugverwijst (zie `runner.ts`'s `friendlyErrorMessage()`) in plaats
van Playwright's eigen rauwe CLI-tekst.

Daarna:

- **Dubbelklik `launch.bat`** (of `node dist/launch.js` vanaf de command
  line) — start de server + opent het app-venster in één stap, of
- `node dist/main.js` — start alleen de server, open zelf
  `http://127.0.0.1:3761/` in een browser naar keuze.

## Omgevingsvariabelen

| Variabele | Default | Betekenis |
| --- | --- | --- |
| `YAD_DESKTOP_PORT` | `3761` | Poort van de lokale server |
| `YAD_DESKTOP_HOST` | `127.0.0.1` | Bind-adres — bewust lokaal, dit is een persoonlijk bureaublad-programma, geen netwerkdienst |
| `YAD_DESKTOP_HEADLESS` | (uit) | `1`/`true` = draai de automatiseringsbrowser headless i.p.v. headed |

`OLLAMA_BASE_URL`, `GROQ_API_KEY`, etc. — dezelfde LLM-provider-variabelen als
`main-server.ts` (via `.env` in de repo-root of echte env-vars); zie
`packages/companion/src/engine/pool.ts`.

## Endpoints

- `GET /` — de app-pagina (formulier + live status, pollt elke 1,2s)
- `POST /run` — `{ goal, url?, domains?, maxSteps? }` → `202` (start,
  niet-blokkerend) of `409` als er al een run loopt (vereist
  `Content-Type: application/json`)
- `GET /run/status` — status van de huidige/laatste run: `idle` / `running` /
  `done` / `error`, plus live-stappen en eindresultaat

## Chrome/Edge-padkeuze (`src/chrome-path.ts`)

1. Systeem-Chrome (`...\Google\Chrome\Application\chrome.exe`) — het pad
   waar YAD's eigen extensie toch al van afhankelijk is, dus elke echte
   gebruiker heeft dit.
2. Systeem-Edge — ook Chromium-based, ondersteunt dezelfde `--app`-vlag.
3. Playwright's eigen gedownloade Chromium onder `ms-playwright` —
   **alleen** een terugval voor dit ontwikkeltoestel, nooit een pad dat op
   een echte gebruikersmachine bestaat.

## Wat dit NIET is (bewust, v1)

Dit is een prototype dat het "YAD openen als een echt programma"-gevoel
end-to-end bewijst — geen geïnstalleerd product. Een getekende `.exe` zonder
Node-vereiste (SEA-wrapping + code-signing) is een **losstaande, bewust
uitgestelde** volgende stap: er ligt al onderzoek naar in
`docs/ONDERZOEK-companion-standalone-2026-08-20.md`, dat expliciet stelt dat
die stap bewezen vraag nodig heeft vóórdat hij de moeite waard is. Vandaag
dus niet aangepakt.

Ook niet gebouwd (net als bij `packages/dashboard`): meerdere taken
tegelijk, taakgeschiedenis, authenticatie — dit is een lokaal, persoonlijk
programma voor één gebruiker die er zelf bij zit.
