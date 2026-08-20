# ONDERZOEK: YAD leerlus, herstelbrein, dashboard en Ollama (2026-08-20)

Doel van dit document: een volgende Claude-sessie leest dit en hoeft NIET opnieuw uit te zoeken
hoe YAD leert, waar het herstelbrein staat, en waarom Ollama nu niet bruikbaar is. Alle
verwijzingen zijn geverifieerd in de echte code / op de live server (Hetzner 138.201.204.97,
SSH-sleutel `~/.ssh/id_ed25519`, host `hetzner-bots`).

## 1. Architectuur: de agent-loop naast de 9 klassieke loops

Kern-agent = het "Brein" in `packages/companion/src`; de extensie is een dunne "Hand" zonder
eigen intelligentie. Hoofd-loop: `packages/companion/src/agent/loop.ts`, klasse `AgentLoop.run()`.

| Loop | Status | Waar |
|------|--------|------|
| 1 Goal (eisen/succescriteria) | ZWAK — geen uitvraag, alleen afgeleide DONE-predicaten | `loop.ts:557-568`, `agent/predicate-generator.ts` |
| 2 Planning (opsplitsen) | DEELS — alleen tactisch micro-plan (1-3 stappen) | `agent/parse.ts` `parseMicroPlan`, `agent/substate.ts` |
| 3 Research (info verzamelen) | ZWAK/AFWEZIG — versmolten in uitvoering (`extract`→`findings`) | `loop.ts:505,1255` |
| 4 Execution | STERK — waarnemen→LLM→poort→uitvoeren→herhaal | `loop.ts:603-1284`, `extension/lib/executor.ts`, `perception.ts` |
| 5 Verification | STERK — per-actie judge + DONE-predicaat + effect-nul-detectie | `loop.ts:1185-1234,929-962,698-720`, `judge/judge.ts` |
| 6 Learning/Reflection | DEELS — slaat op WAT werkte, geen WAAROM-analyse | `agent/recovery.ts`, `memory/recovery-store.ts`, `cache-store.ts` |
| 7 Stop-controller | STERK (best ontwikkeld) — arbiter + escalateOrStop, MAX_RECOVERY=3 | `agent/arbiter.ts`, `loop.ts:351-406,20` |
| 8 State/Memory | STERK — alles LOKAAL append-only in `data/` | `history/run-history.ts`, `step-log.ts`, `memory/*` |
| 9 Nieuwe iteratie | STERK — for-lus reset plan bij fout/herstel | `loop.ts:603,382-402` |

**Groeikansen (zwakste eerst):** loop 6 (echt leren-met-waarom), loop 1 (eisen uitvragen),
loop 3 (research-fase), loop 2 (strategische planning).

## 2. De leerlus / het herstelbrein — komt vastloop-info bij de maker? JA.

**8 stuck-signalen** gedetecteerd in `loop.ts` via `agent/arbiter.ts`: repeat, consecutive-act-failures,
state-loop, url-regression, silent-no-effect, no-progress, goal-drift, consecutive-unknowns
(+ unintended-navigation, parse-fail).

**Client → server (in `packages/companion/src/session.ts`):**
- Bij onopgeloste vastloop: POST `{host, why, actionKind}` → `session.ts:189` naar
  `https://wazir-x402.duckdns.org/api/yad-assist`. Standaard AAN, opt-out `YAD_HERSTELBREIN=uit`.
- Bij geslaagd herstel: POST `{host, why}` → `session.ts:565` naar `/api/yad-assist/gelukt`.
- Bewust gesanitiseerd: NOOIT pagina-inhoud, wachtwoorden, doeltekst of PII. Alleen die 3 velden.

**Server-kant (LEEFT in `/app/euler-liquidator/scripts/x402-server.mjs` op Hetzner):**
- `x402-server.mjs:2644` `POST /api/yad-assist`: zoekt bekende hint (`yadHerstelZoek`), verzint
  anders er een via LLM (`yadHerstelBedenk`→`yadVraagLLM`), onthoudt (`yadHerstelNoteer`).
- `x402-server.mjs:2674` `POST /api/yad-assist/gelukt`: telt bewezen hint (`yadHerstelBewijs`).
- Opslag: `/app/euler-liquidator/data/yad-herstel.jsonl`, schema
  `{host, why, actie, hint, bewezen, ts, laatstBewezen?}`. Nieuwste regel per `host|why` wint.
- Functie-definities: `x402-server.mjs:1306-1415`.
- **LLM-bron = CLOUD (niet Ollama):** `yadVraagLLM` gebruikt Cerebras (gpt-oss-120b), Groq
  (llama-3.3-70b), SambaNova. Env-keys. Val-terug op vast advies per signaal.

**Conclusie:** de lus draait al op machineniveau. Elke gebruiker maakt YAD beter voor de volgende.
Bewezen hints worden GLOBAAL per `host|why` geserveerd (netwerkeffect).

## 3. Dashboard (GEBOUWD 2026-08-20)

- Bron: `/app/euler-liquidator/scripts/yad-herstel-dashboard.mjs` (losstaand, NUL risico voor
  x402-betaalserver). PM2-naam `yad-herstel-dashboard`, poort **3755**, ufw 3755 open.
- URL: **http://138.201.204.97:3755** (publiek, geen auth — consistent met fleet-dashboard 3752 /
  business 3753, maar exposure-vlag: overweeg token als er echte gebruikersdata in komt).
- Toont per site+signaal: hint, bewezen-teller (groen=bewezen/geel=wacht), signaal-verdeling.
  JSON op `/json`. Ververst elke 30s.
- Ontbreekt nog: een frequentie-teller (hoe VAAK elk patroon optreedt — nu alleen bewezen-teller).

## 4. Ollama-realiteit (belangrijke correctie op eerdere aanname)

**FOUTE aanname:** "box is CPU-verzadigd, stop trading-bots om ruimte voor Ollama te maken." ONWAAR.
- Box = **8 cores** (i7-6700, 4c/8t), load ~4.0 = ~50% benut, **47% idle**. NIET CPU-verzadigd.
- De trading-liquidators (bonzo, euler, stofzuigers, kamino, gmx, surge) staan ~0% CPU. Ze zijn
  NIET de load. Ze uitzetten voor CPU helpt niets.
- De echte load = **Ollama zelf**: `llama-server` op ~387% CPU, **25GB RES** (81% RAM), + 2,3GB swap.
- Geladen model = **qwen2.5:32b** (21GB, 100% CPU). Vier node-processen hangen aan `:11434`:
  je eigen AI-bots **bug-intel-runner.mjs, benchmark-race-engineer.mjs, vps-brein.mjs**.
- Een schone qwen2.5:7b-testaanvraag gaf zelfs met 90s timeout GEEN antwoord — hij staat in de
  wachtrij achter het 32B-werk, en CPU-inference (geen GPU) is inherent traag.
- Modellen aanwezig: qwen2.5:7b/32b, REDACTED-race-engineer (7b-based), audit-agent/poc-agent (32b).
  GEEN klein model. Disk vrij: 301G (ruimte voor een klein model).

**Gevolg voor de reflectie-laag:** Ollama in het HETE pad (gebruiker wacht op hint) = NEE, te traag
+ al bezet. Reflectie moet een **batch-job off-peak** zijn, of een **klein model** (pull qwen2.5:3b,
~2GB, snelle CPU-inference), zodat het niet vecht met het 32B audit-werk.

## 5. Distributie-besluit: voor iedereen of voor die persoon?

Drie lagen, elk anders:
1. **Herstel-hints voor publieke sites** → GLOBAAL (netwerkeffect). Veilig auto-update (begrensde
   data). Al zo gebouwd (per `host|why`, auto-promote bij bewezen).
2. **Privé-context van de gebruiker** → LOKAAL, verlaat de machine nooit.
3. **Code-verbeteringen** → GLOBAAL maar MENS-GEREVIEWD. NOOIT blind auto-shippen (een gehackte
   server mag nooit YAD op bank.com laten klikken). Deny-lijst (/payment /checkout) geldt ook voor
   binnenkomende hints; hints signeren + verifiëren.

## 6. Privacy-truthfulness (OPEN, vóór markt oplossen)

"Niets verlaat je computer" is standaard NIET letterlijk waar: (a) herstelbrein-ping (3 velden),
(b) cloud-LLM krijgt paginatekst tenzij `YAD_LOKAAL=1`. Code erkent dit zelf (`session.ts:177`,
`http-api.ts:71`). De winkel-copy op branch `feat/yad-onboarding-copy` (commit 955be49, nog niet
naar main) overclaimt met "Niets verlaat je computer" → corrigeren naar precieze belofte, of de
ping opt-IN maken.

## 7. Open next-steps

1. Reflectie-laag bouwen: klein model (qwen2.5:3b) OF off-peak batch → Ollama leest
   yad-herstel.jsonl, drafts (a) betere/gegeneraliseerde hints, (b) code-verbetervoorstellen voor
   review → schrijft naar bestand dat het dashboard toont.
2. Frequentie-teller toevoegen aan de server-handler (hoe vaak elk `host|why` optreedt).
3. Privacy-copy corrigeren vóór markt.
4. Dashboard-auth overwegen bij echte gebruikersdata.
5. Hint-signering + deny-lijst-toepassing op binnenkomende hints (veiligheidsgrens).
