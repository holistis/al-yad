# @yad/dashboard

Orchestrator-UI vóór `packages/companion`'s `main-server.ts`.

## Het ene architectuurfeit dat telt

`main-server.ts` is een kale, blokkerende API: `POST /goal` wacht tot de hele
browser-run klaar is en heeft geen eigen geheugen van taken — geen run-IDs, geen
geschiedenis, alleen een live concurrency-teller. Dit pakket **wijzigt
`main-server.ts` niet**. Het is een client ervoor: geeft elke taak een ID, houdt
een eigen wachtrij + worker-pool bij (concurrency altijd ónder `main-server.ts`'s
eigen `MAX_CONCURRENT=10`), en toont een pagina waarop je meerdere taken tegelijk
kan volgen.

## Draaien

```bash
# main-server.ts moet al draaien (default poort 3747)
pnpm --filter @yad/dashboard build
pnpm --filter @yad/dashboard dashboard
```

Open daarna `http://127.0.0.1:3760/`.

## Omgevingsvariabelen

| Variabele | Default | Betekenis |
| --- | --- | --- |
| `YAD_SERVER_URL` | `http://localhost:3747` | Waar `main-server.ts` draait |
| `DASHBOARD_PORT` | `3760` | Poort van dit dashboard |
| `DASHBOARD_HOST` | `127.0.0.1` | Bind-adres — bewust lokaal, geen `0.0.0.0` default |
| `DASHBOARD_CONCURRENCY` | `5` | Max. gelijktijdige `/goal`-runs vanuit dit dashboard (geklemd op 9 — strikt onder `main-server.ts`'s eigen `MAX_CONCURRENT=10`, zodat er altijd ruimte overblijft voor andere afnemers) |
| `YAD_JOB_TIMEOUT_MS` | `1200000` (20 min) | Harde ceiling per job-call naar `main-server.ts`; voorkomt dat een hangende `fetch()` een worker-slot voor altijd bezet houdt |

## Endpoints

- `GET /` — dashboard-pagina (form + tabel, pollt elke 2s)
- `GET /status` — `{ ok, activeRunners, concurrency, queueLength, yadServerUrl }`
- `POST /jobs` — `{ goal, url?, domains?, maxSteps? }` → `201 { id }` (niet-blokkerend, vereist `Content-Type: application/json`)
- `GET /jobs` — alle taken, nieuwste eerst
- `GET /jobs/:id` — één taak

Taken-opslag is in-memory (een `Map`, geen database) en bewaart maximaal de
laatste 200 taken — voldoende voor een v1-bedienpaneel, niet bedoeld als
permanente geschiedenis.
