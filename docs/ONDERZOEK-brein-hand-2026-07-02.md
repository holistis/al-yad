# Onderzoek: brein-hand browser-agents — pijnpunten, wensen, en het bouwplan voor YAD

Datum: 2026-07-02
Bron: multi-agent onderzoek (21 agents, ~955K tokens) over GitHub-issues (echte `gh` API-data),
YouTube Data API v3 (video's + comment-threads), Reddit, Hacker News, dev-blogs, arXiv-papers en
commerciële concurrenten. 14 kern-pijnpunten adversarieel geverifieerd (elk 5-9 onafhankelijke bronnen,
allemaal CONFIRMED). Aangevuld met directe lezing van YAD's code.

---

## 0. De kern in vijf zinnen

De hele markt loopt vast op exact de problemen die jij bij YAD ziet, en niemand heeft ze schoon opgelost.
Zelfs OpenAI kon zijn losse browser-agent (Operator) niet levend houden: gelanceerd jan 2025, gesunset
aug 2025, teruggevouwen in ChatGPT. Het faalt niet op modelkracht maar op architectuur: geen faal-geheugen,
geen zelfherstel, geen echt leren, token-explosie, en agents die liegen dat ze klaar zijn. YAD heeft al drie
zeldzame troeven (echte ingelogde Chrome, eerlijke "ik liep vast", lokaal/vaste prijs), maar mist precies de
laag die jij beschrijft: bij vastlopen terugkoppelen naar het sterke brein, en de gevonden hersteltruc daarna
opslaan zodat YAD het zelf onthoudt. Dat gat is de plek waar je de markt kunt inhalen.

---

## 1. De geverifieerde pijn-kaart (wat iedereen tegenkomt)

Alle 14 zijn CONFIRMED met meerdere onafhankelijke bronnen. Gesorteerd op hoe breed gedragen.

| # | Pijnpunt | Bronnen | Raakt YAD-onderdeel |
|---|----------|---------|---------------------|
| 1 | **Vastlopen in lus**: herhaalt dezelfde actie / doet "lege actie" tot step-budget op is (duurste faalpatroon, tot 15,7% van alle fouten) | 6-8 | loop (repeat-guard) |
| 2 | **Geen automatisch herstel na fout**: hangt of blijft dood element proberen i.p.v. recoveren | 8 | loop + judge |
| 3 | **Login/sessie-verloop niet herkend**: taak breekt zodra auth verloopt of sessie niet herbruikt wordt | 9 | session + loop |
| 4 | **Geen resume-punt bij CAPTCHA/timeout/block**: workflow faalt volledig, werk kwijt | 9 | loop + memory |
| 5 | **Anti-bot/captcha/Cloudflare** blokkeert volledig; enige fallback is mens overnemen | 7 | site-profile + hand |
| 6 | **Silent failure**: agent claimt succes terwijl taak faalde, fabriceert soms bewijs | 7 | judge + verify |
| 7 | **Token-explosie**: hele DOM/snapshot per stap → (quasi-)exponentieel duur; ~10 stappen = meerdere dollars | 6-7 | perception + router |
| 8 | **Voortijdig "klaar" of eindeloze lus**: geen verifieerbare eind-conditie | 8 | loop + judge |
| 9 | **Brosse selectors**: cache/actie breekt bij kleine DOM-shift (wrapper-div, ad, herordening) | 5 | cache + perception |
| 10 | **Verkeerd element geklikt** door positie/index-targeting dat verschuift na een actie | 5 | perception + cache |
| 11 | **Planner-executor communicatie**: planner hallucineert, sub-plannen driften, geen schone hand-off, convergeert niet | 6 | bridge + loop |
| 12 | **Demo-vs-productie kloof**: guarded sites detecteren automation vroeg; architectuur beslist, niet het model | 6 | hele systeem |
| 13 | **Compounding per-stap-fout**: 10 stappen à 90% = ~35% eind-betrouwbaarheid | (afgeleid) | loop |
| 14 | **Naïef geheugen**: "leren" = alleen geslaagde reeksen herhalen, geen foutgeheugen, geen skill-library | 3+ | memory (**exact jouw punt**) |

Extra, door de criticus als onderbelicht-maar-echt gemarkeerd (in-het-wild uitgebuit, geen randgeval):
prompt-injectie/agent-hijack, file-upload/download, multi-tab/OAuth-vensters, 2FA/OTP, SPA data-vs-UI race,
geheugen-drift na ~25-30 stappen, cross-origin iframes en canvas-apps.

---

## 2. Wat mensen expliciet BETER willen (39 wensen, gegroepeerd)

**Herstel & anti-loop**
- Expliciet faal-geheugen: "dit heb ik geprobeerd en het werkte niet", en dan een *fundamenteel andere* aanpak forceren, niet dezelfde herhalen.
- Meerlaags herstelmodel (Level 0 observeren → 1 lokaal herstel → 2 alternatief → 3 replan/escaleer), i.p.v. één blinde retry-loop.
- Schone escalatie die de run niet doodt en context meeneemt (naar mens OF naar een sterker brein).

**Leren (jouw kern-wens)**
- Leren van HERSTELTRUCS, niet alleen van geslaagde reeksen. Bij falen een verbale post-mortem schrijven en de LES opslaan (Reflexion/ExpeL).
- Geslaagde workflows automatisch omzetten in herbruikbare, geparametriseerde skills (deterministisch replay zonder LLM).
- Geleerde vaardigheden die generaliseren naar gelijkende taken, niet alleen exacte replays (Agent Workflow Memory).

**Betrouwbaarheid & eerlijkheid**
- Verifieerbare "klaar"-definitie zodat de agent stopt en niet liegt over succes.
- Een ANDERSOORTIGE verificateur (ander model/aanpak dan de drafter, geen self-bias).
- Semantische verify-laag die vóór/na de actie bevestigt dat het juiste element geraakt is.
- Gestructureerde session-replay / audit-trail: wat zag de agent, wat deed hij, waarom.

**Token & kosten**
- Constante kosten ongeacht taak-complexiteit: cache staten/reeksen, stuur niet elke stap de volledige DOM.
- Delta/hard-scoped snapshots (bewezen ~65% besparing) + interactive-only refs (~93% context-reductie).
- Voorspelbare vaste prijs zonder betalen-voor-mislukking (marktbrede afkeer van ondoorzichtige credits).

**Vorm & vertrouwen**
- Draai op mijn eigen, al-ingelogde browser/profiel (niet een kale Chromium waar ik opnieuw moet inloggen).
- Lokaal/privacy in plaats van cloud die data doorstuurt.
- Pagina-inhoud strikt als DATA behandelen, nooit als instructie (prompt-injectie-weerbaarheid).

---

## 3. Waar YAD nu staat: troeven en gaten (gegrond in je code)

### Troeven die de markt expliciet WIL en die YAD al heeft
1. **Echte Chrome met echte sessies.** YAD werkt via een extensie op de actieve tab + injecteert opgeslagen cookies/localStorage (`session.ts`, `session-reader`). De breedste marktwens ("draai op mijn eigen ingelogde profiel") heb je al ingebouwd. Operator/Manus/Genspark openen een kale sandbox — daar haken gebruikers op af.
2. **Eerlijkheid boven fabricatie.** Bij vastlopen zegt YAD eerlijk "ik liep vast" i.p.v. "klaar" te faken (`loop.ts` regel 350-360). Manus en Skyvern fabriceren juist succes. Dit is technisch een troef *en* het valt samen met 5.1 (geen misleiding). Sidq/al-Amin en de competitieve edge wijzen hier dezelfde kant op: het duurste vertrouwensprobleem van de hele markt is de agent die liegt over succes.
3. **Interactive-only snapshot met stabiele-vorm refs.** `perception.ts` stuurt alleen zichtbare interactieve elementen (max 150) + korte textDigest, niet de hele DOM. Dat is precies het "Snapshot + Refs"-patroon dat bouwers vragen (Vercel's agent-browser wordt als positief referentiepunt genoemd, near-identiek aan jouw aanpak).
4. **Action-cache met deterministische replay + drift-detectie.** `cache-store.ts` + `replay.ts`: geslaagde reeksen 0 LLM-calls opnieuw afspelen, met guardrails in replay. Dit is Stagehand's bewezen richting.
5. **Halal veiligheids-poort in CODE, niet in LLM-redenering.** Deny-lijst (`/payment`, `/checkout`), confirm-before-mutate, scheme-allowlist, percent-encoding-normalisatie. Bouwers vragen expliciet "veiligheid afgedwongen in de execution-layer" — jij hebt het al.
6. **Multi-provider router + circuit-breaker over gratis modellen.** `router.ts` + `circuit-breaker.ts`: een dode sleutel legt de machine niet stil.

### Gaten (waar jouw pijn en de marktpijn samenvallen)
1. **Escalatie gaat naar de MENS, niet naar Claude Code.** Bij vastlopen/onzekerheid roept `loop.ts` `requestConfirm` aan (mens). Er is geen kanaal "vastgelopen → hier is context → geef me een herstelplan" naar het externe brein. De bridge (`http-api.ts`) heeft wel `/goal` en `/verify`, maar geen automatische stuck-hand-off. **Dit is precies de lus die jij wilt.**
2. **Geen persistent faal-geheugen; "vastlopen" = opgeven.** `loop.ts` heeft alleen een in-run repeat-guard (`lastActionSig`/`repeatCount`). Er is geen geheugen over runs heen en geen gedwongen strategie-wissel — het probeert geen andere aanpak, het stopt. De markt-wens #1 is precies het omgekeerde.
3. **Leren is alleen success-replay.** Er is geen schrijf-pad voor hersteltrucs, faal-patches of skill-abstractie. Jouw wens "bij succes wordt YAD bijgewerkt zodat hij leert" heeft nog geen code-pad.
4. **Action-cache is broos: positionele refs.** `perception.ts` nummert refs (`e1`, `e2`…) per snapshot op DOM-volgorde; `loop.ts` cachet de ruwe acties inclusief die vluchtige refs. Bij replay op een verschoven pagina kan `e7` een ander element zijn → verkeerde klik. De cache moet op stabiele attributen (id/data-testid/rol+naam) sleutelen.
5. **Sessie-verloop wordt maar grof gedetecteerd.** Alleen redirect NAAR een loginpagina (`LOGIN_PATH_PATTERNS`). Stille 401/403, verlopen token zonder redirect, soft-logout in een SPA: niet herkend.
6. **Token-groei zonder compaction of budget.** De history groeit monotoon en gaat integraal in elke prompt; geen doel-anker, geen kosten/token-telling, geen budget-stop. Na ~25-30 stappen begint doel/geheugen-drift.
7. **Breedte-plafond: de Hand kent maar 7 acties** (navigate/click/type/select/extract/wait/finish). Ontbreekt voor "alles wat een mens doet": scroll-als-actie, hover, `waitFor(conditie)`, file-upload, download-vangst, toetscombinaties, multi-tab/venster, drag-drop, en een vision/coordinaat-fallback voor canvas-apps. `<input type=file>` staat wél in de perception maar kan nooit bediend worden.
8. **Prompt-injectie is nu een actief uitgebuit risico, niet theorie.** YAD stuurt volledige body-tekst (1500 tekens) + alle node-namen ongefilterd naar de LLM. Er is een UNTRUSTED-markering in de prompt, maar geen injectie-detectie en geen "plotselinge doel-afwijking → mens bevestigen". Brave toonde dit live bij Comet (verborgen tekst haalt OTP's op).

---

## 4. Het bouwplan: de zelfherstellende leer-lus die jij beschreef

Dit is precies wat je vroeg, vertaald naar YAD's echte bestanden. De volgorde is gekozen op hefboom
(grootste effect, kleinste wijziging eerst).

### Fase P0 — De brein-hand herstel-lus sluiten (het hart van je vraag)

**Doel:** Claude Code geeft één groot doel → YAD voert uit → loopt hij vast, dan koppelt hij *met context*
terug naar Claude Code → Claude Code redeneert in scenario's en herstuurt → bij succes leert YAD de truc.

1. **Vroege loop-detectie i.p.v. hard stoppen.** In `loop.ts`: vervang de "stop bij 2x herhaling" door een
   sliding-window fingerprint (detecteer herhaling én "lege vooruitgang": zelfde URL + zelfde snapshot-hash
   over N stappen). Classificeer WAAROM: dood element / selector-drift / captcha / login-verloop / onbekend.
2. **Stuck-envelope + escalatie naar Claude Code.** Nieuw pad: bij vastlopen schrijf een gestructureerde
   envelope (doel, step-log, laatste snapshot, faal-classificatie, "dit is al geprobeerd") en zet de
   run-status op `hulp-nodig`. Bridge-uitbreiding in `http-api.ts` + `session.ts`: Claude Code pollt/leest
   die status (of een nieuw `/assist`-endpoint), leest de envelope, en POST een herstelplan terug.
3. **Hervatten met herstelplan.** YAD hervat vanaf het driftpunt met het door Claude Code geleverde plan.
   De cache-drift-machinerie in `loop.ts` (regel 205-210, "LLM neemt over vanaf driftpunt") is hiervoor
   grotendeels herbruikbaar.
4. **Faal-geheugen in de prompt.** In `prompt.ts`: injecteer een "REEDS GEPROBEERD (faalde): …; kies een
   FUNDAMENTEEL andere aanpak"-blok. Zet YAD's gedrag om van "opgeven" naar "leren en anders proberen".

Bestanden: `loop.ts`, `http-api.ts`, `session.ts`, `protocol.ts` (nieuw bericht-type of via result-file),
`prompt.ts`.

### Fase P1 — Leren dat blijft plakken (zuiniger met tokens)

5. **Recovery-store (nieuw, naast `cache-store.ts`).** Bij een geslaagd herstel: sla een
   `faal-signatuur → oplossing`-episode op (site-patroon + faal-classificatie als sleutel; de herstel-acties
   als waarde), met een reliability-tier die stijgt bij herhaald succes. Volgende keer dezelfde muur: YAD
   haalt de truc zelf op — geen Claude Code, geen LLM-call. Dit is jouw "leert + zuiniger met tokens".
6. **Stabiele-selector cache (fix het broze punt).** Sla in de action-cache niet `click e7` op, maar
   `{role, name, nearestId/data-testid, url-pattern}`. Bij replay: resolve op attribuut, niet op index.
   Valideer passief tegen de verse snapshot vóór je een gecachte actie uitvoert (Stagehand-model).
7. **Skill-abstractie (AWM-stijl), later.** Induceer geabstraheerde "task recipes" uit geslaagde trajecten
   zodat leren generaliseert naar gelijkende taken, niet alleen exacte replays.

Bestanden: nieuw `memory/recovery-store.ts`, nieuw `memory/skill-store.ts`, aanpassing `cache-store.ts` +
`loop.ts` (schrijf-pad bij succes).

### Fase P2 — Breedte: alles wat een mens in de browser doet

8. **Breid de Action-DSL uit** (`shared/src/action.ts` + `extension/lib/executor.ts`):
   `scroll`, `hover`, `waitFor(selector|conditie)` (lost de SPA data-vs-UI race op; vervang blinde `wait(ms)`),
   `uploadFile`, `pressKey`/toetscombinaties, `switchTab`/`openTab`, en drag.
9. **Multi-tab / OAuth-venster-model** in de extensie (nu stuurt de loop alleen de actieve tab).
10. **2FA/OTP als eerste-klas pauze-stap** (nu alleen grove login-detectie).
11. **Vision/Set-of-Marks fallback** alleen wanneer de a11y-tree leeg is (canvas/kaart/tekentools). Het
    protocol noemt al `cdp` en `ax-snapshot` als capabilities maar gebruikt ze niet — ongebruikte hefboom.
12. **Snapshot-truncatie signaleren**: `buildSnapshot` kapt stil af op 150 nodes; geef "meer beschikbaar,
    scroll" terug i.p.v. het doel-element onzichtbaar te laten verdwijnen.

### Fase P3 — Token-discipline & lange taken

13. **Delta-snapshots + hard-scope subtree** (bewezen ~65% besparing; cruciaal op gratis modellen met
    token-per-minuut-limieten).
14. **History-compaction met VASTGEPINDE veiligheidsregels.** Let op de "governance decay"-val: bij het
    inkorten van context mogen de deny-regels/5.1-instructies nooit uit het venster vallen.
15. **Token/kosten-teller + budget-stop** in de loop (nu alleen repeat-guard + circuit-breaker).

---

## 5. Veiligheids-poorten vóór opschalen (de 4 checks + 5.1)

Zodra YAD breder en autonomer wordt, worden deze harde poorten, niet optioneel:

- **Data-check (prompt-injectie).** Dit is nu in-het-wild uitgebuit (Brave/Comet: verborgen tekst haalt OTP's
  en opent bankportalen). Behandel alle pagina-tekst strikt als data + detecteer plotselinge doel-afwijking +
  bevestig bij de mens vóór een gevoelige actie op instigatie van pagina-inhoud. Dit beschermt de gebruiker
  tegen schade en valt samen met 5.1 (geen misleiding faciliteren).
- **Auth/consequentie-tier.** Gate acties op "hoe erg als YAD fout zit" (irreversibel? geld? verzenden?),
  niet op broze confidence-scores. De deny-lijst is een goed begin maar dekt niet alles.
- **Exposure-check.** De bridge bindt correct alleen aan 127.0.0.1. Houd dat zo; het nieuwe `/assist`-kanaal
  mag geen doel-inhoud of sessie-data buiten localhost lekken.
- **Rate/budget-check.** Token/kosten-budget per taak (zie P3-15), plus de bestaande pacing/anti-bot tiers,
  om account-bans en kosten-runaway te voorkomen.

---

## 6. Strategische gaten (ondernemers-bril, niet alleen bouwer)

1. **Het venster staat open.** De hele markt zit vast op dezelfde muur; zelfs OpenAI trok Operator terug.
   Betrouwbaarheid is architectuur, niet modelkracht. Wie de herstel-lus + het echte leren + de eerlijke
   hand-off schoon bouwt, loopt voor — niet wie het grootste model heeft.
2. **YAD's drie moats zijn echt en zeldzaam** en dekken de drie breedste marktwensen: (a) echte ingelogde
   browser, (b) eerlijkheid over falen, (c) lokaal + vaste prijs. Positioneer hierop, niet op "betere agent".
3. **De leer-lus die jij wilt is precies het gat dat NIEMAND heeft gevuld.** Stagehand cachet succes;
   Voyager/AWM zijn onderzoek, niet productie-web. Een product dat onthoudt *hoe je uit een vastloop komt*
   is aantoonbaar nieuw. Dit is je scherpste verkoop-verhaal.
4. **Verkoop het als beheerde dienst, niet als "betere agent"** (sluit aan bij je bestaande productlijn in
   `al-yad`). De moat is de harness + de brein-hand hand-off + de geleerde skills, niet het ruwe model.
5. **Bouw de audit-trail zichtbaar.** "Wat zag de agent, wat deed hij, waarom" is een top-bouwerswens *en*
   een verkoop-asset: het maakt van een zwarte doos die kan liegen een verifieerbare, eerlijke werker. Je hebt
   de step-log al (`step-log.ts`); een leesbare replay eroverheen is goedkoop en levert veel vertrouwen op.
6. **Prompt-injectie is een aansprakelijkheid, geen feature-gap.** Een YAD die op een gekaapte pagina handelt
   kan de gebruiker schaden. Dit moet een eerste-klas poort zijn vóór je breedte opschaalt — zowel klant-
   vertrouwen als spirituele rode lijn (geen schade faciliteren).

---

## 7. Aanbevolen eerste stap (kleinste wijziging, grootste hefboom)

Bouw eerst **Fase P0 stap 1-4** (de stuck-envelope + escalatie naar Claude Code + faal-geheugen in de prompt).
Dat is de lus die jij het sterkst wilt, het vult het gat dat de hele markt heeft, en het raakt maar een handvol
bestaande bestanden. Daarna direct **P1 stap 5-6** (recovery-store + stabiele-selector cache) zodat de gevonden
hersteltrucs blijven plakken en de cache niet meer broos is.

Alles op een `dev`-branch, jij test op dev, pas daarna naar main. Ik bouw dit niet zonder jouw go.

---

*Ruwe onderzoeksdata (397KB JSON, 14 geverifieerde claims, 39 wensen, 48 patronen, 40 concurrent-profielen)
stond in de workflow-output; de kern staat hierboven verwerkt.*
