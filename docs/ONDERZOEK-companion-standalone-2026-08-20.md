# Onderzoek + bouwstaat: standalone Companion (het Brein)

Datum: 2026-08-20. Bewaar dit zodat een volgende sessie niet opnieuw hoeft te graven.

## Wat de Companion is

YAD = twee helften:
- **De Hand** = de Chrome-extensie (uit de winkel). Ziet de pagina, klikt, typt. Geen eigen verstand.
- **Het Brein = de Companion** = klein lokaal programma (`packages/companion`, `localhost:3747` + native messaging). Neemt de opdracht aan, plant, praat met het AI-model, stuurt de Hand aan. Draait op de machine van de gebruiker.

Zonder de Companion zegt de extensie "Niet verbonden" en gebeurt er niks. Dus elke winkel-gebruiker heeft de Companion nodig. Daarom moet er een publieke download komen.

## Bewezen deze sessie (geverifieerd, niet geclaimd)

1. **De lichte Companion (`src/main.ts`) gebruikt GEEN playwright.** Bevestigd via esbuild-metafile: playwright niet in de graaf. Dus licht te verpakken. (playwright zit alleen in de `main-playwright`/`server-playwright`-varianten, niet in de standaard host.)
2. **Bundelen werkt.** `node scripts/package-companion.mjs` → `companion-dist/yad-companion-bundle.cjs`, 206 KB, 41 modules, `@yad/shared` ingelijfd. esbuild uit de pnpm-store (staat niet in `.bin`, laden via file-URL naar `node_modules/.pnpm/esbuild@*/.../lib/main.js`).
3. **Bundel start schoon** (smoke-test met `YAD_DATA_DIR` + `YAD_ENV_FILE`): laadt `.env`, bouwt de 7-provider motor-pool, start v0.1.0, vangt poort-3747-conflict netjes af, sluit schoon af bij stdin-close.

## Twee bugs gevonden + gefixt (anders crasht de standalone)

De companion is geschreven om vanuit de repo te draaien: hij zoekt `.env`, data-map en leer-stores via `import.meta.url`. **In een CJS-bundel is `import.meta.url` `undefined`** → `fileURLToPath(undefined)` crasht.

- `src/env.ts` — `loadEnvFile()` berekende de map onvoorwaardelijk bij de start → **crash bij boot**. Gefixt: env-overrides (`YAD_ENV_FILE`, cwd/.env) eerst, module-pad afgeschermd in try/catch.
- `src/external-gate.ts` — `auditLogPath()` idem → crash zodra de externe-audit-route wordt geraakt. Gefixt: `YAD_EXTERNAL_AUDIT_PATH` eerst, dan afgeschermd module-pad, dan cwd/data.
- `src/memory/recovery-store.ts`, `src/memory/selector-store.ts`, `src/history/run-history.ts` — `defaultDataDir()` hardcodede `../../../../data`. Gefixt: `YAD_DATA_DIR` eerst, module-pad afgeschermd, val terug op cwd/data.

Alle vijf zijn ook **los van de standalone betere code** (de hardcoded paden waren broos). tsc groen, bundel herbouwd + herverifieerd.

## Wat nog rest voor een ECHTE standalone (bewust NIET gedaan)

- **Node SEA-wrapping** (`.exe` die Node inbakt, zodat de gebruiker geen Node hoeft te hebben). Node 24 kan dit. Finicky: blob-injectie via postject + **Windows code-signing** (ongetekende .exe → SmartScreen-waarschuwing, slecht voor een security-product).
- **Consumenten-installer** die de native-host registreert (`scripts/setup-native-host.ts` doet dit al voor dev; moet naar de bundel + `YAD_DATA_DIR` wijzen i.p.v. `dist/main.js` + `process.execPath`) en een launcher plaatst.

## Waarom die laatste stappen wachten (strategisch, rechterhand-oordeel)

De demand-analyse van 2026-08-20 (zie geheugen `rechterhand-loops-brief-2026-08-20`) toont: YAD heeft 0 bewezen vraag. De koning verkoopt **done-for-you** (hij draait YAD zelf voor de klant). Voor die eerste betalende pilots is de no-Node `.exe` **niet** nodig — alleen zelfbedienende eindgebruikers hebben hem nodig, en dat is ná bewezen vraag. De werkende bundel + de winkel-ID-fix in de native-host maken de standalone klaar-om-af-te-maken op de dag dat de vraag het rechtvaardigt. Nu de finicky .exe + signing forceren aan het eind van een lange sessie = precies de premature-build-fout die de analyse aanklaagt.

## Herbouw-commando's

```
cd packages/companion && tsc -p tsconfig.json     # of: node ../../node_modules/typescript/bin/tsc -p tsconfig.json
node scripts/package-companion.mjs                # -> companion-dist/yad-companion-bundle.cjs
# smoke-test:
YAD_DATA_DIR=<tmp> YAD_ENV_FILE=<pad>/.env node companion-dist/yad-companion-bundle.cjs
```
