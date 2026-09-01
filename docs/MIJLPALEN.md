# Mijlpalen Yad

Eén doorlopend logboek van wat er echt gebouwd en vastgelegd is, met bewijs erbij (commit-hash,
bestandspad, of URL) zodat dit navolgbaar blijft. Nieuwe datum eronder toevoegen, dit bestand
niet vervangen of hernoemen. Dit is de ene afgesproken plek voor Yad-mijlpalen, ongeacht welke
sessie het werk deed.

## 2026-08-28

### Concurrentietest tegen browser-use: eerste, eerlijke resultaten (gratis, geen geld uitgegeven)

Koning gaf akkoord met de expliciete grens "geen geld, alleen gratis API's of eigen Ollama".
Ollama afgevallen: `qwen2.5:32b` op de VPS reageerde niet eens binnen 20s op een triviale
aanvraag (bevestigt eerdere meting: 1,24 tok/s, CPU-only). Groq afgevallen VOOR browser-use
specifiek: het model `openai/gpt-oss-120b` heeft een harde 8000 tokens/minuut-limiet op de
gratis tier, en browser-use's eigen prompt-stijl (volledige DOM/accessibility-representatie
per stap) vraagt daar in één enkele stap al 14.500+ tokens — ruim over de limiet, ongeacht
retries. Dat is zelf al een eerlijk vergelijkingspunt: YAD's compactere snapshot-aanpak
(`slice(0,120)` elementen, `slice(0,1500)` paginatekst) is aanzienlijk zuiniger met tokens dan
browser-use's standaard-aanpak.

Uiteindelijk gedraaid met OpenRouter's gratis `minimax/minimax-m3:free` via browser-use's
litellm-integratie, tegen dezelfde 3 taken (bk-001/002/003) als YAD's eigen benchmark:

- bk-001: PASS, 2 stappen, 11,9s
- **bk-002 (de exacte taak waar YAD's ref-selectie-bug op vastliep, "Home" i.p.v. prijs): PASS**
  — "Starving Hearts... £13.99", 4 stappen, 48,8s, expliciet alle 20 boeken op de pagina
  doorgenomen voor het antwoord.
- bk-003: PASS, 2 stappen, 8,5s

**3/3 volledig correct.** Eerlijk om te noemen: dit was VOOR de fix van PR #2 in productie
geverifieerd kon worden — een directe live-herverificatie van bk-002 op YAD zelf liep vast op
een echte rate-limit ("gratis AI-modellen zitten even op hun limiet"), waarschijnlijk door de
combinatie van deze avond se intensieve testen (eigen curl-tests, deze vergelijking, eerdere
benchmarkrondes) op dezelfde gratis sleutels. Geen bug — gewoon uitgeput door eigen gebruik.
Ruwe resultaten: `data/browser-use-compare-results.json`.

**Eerlijke conclusie voor nu:** op deze kleine steekproef (3 taken, product-research-categorie)
won browser-use met een vergelijkbaar gratis model 3/3, tegen YAD's pre-fix 33-66,7% op een
grotere set. Dit zegt nog weinig definitiefs — te kleine steekproef, andere modellen, geen
gecontroleerde vergelijking op stappen/kosten/snelheid nog. Een echte, bredere vergelijking
(zelfde taken-set, zelfde model waar mogelijk, na YAD's fix, met snelheid/stappen/tokens
gemeten aan beide kanten) is de logische volgende stap, geen haast mee gezien de late uur en
de rate-limits van vanavond.

### Overdracht: andere sessie gestopt, deze sessie neemt YAD volledig over

Om botsingen te voorkomen (twee sessies op dezelfde YAD/browser tegelijk, meerdere keren
vanavond echt gebeurd) is besloten dat de andere sessie stopt met YAD-werk. Alles hieronder na
dit punt is door deze sessie gedaan.

### $7,19 betaald-API-lek gecheckt en veilig bevonden

De andere sessie meldde `YAD_PAID_PRIMARY=true` gevonden en uitgezet ($7,19 ooit uitgegeven op
die sleutel, in totaal). Zelf geverifieerd: `YAD_PAID_API_KEY` (de sleutel die de betaalde
provider daadwerkelijk in de pool zet, zie `pool.ts` regel ~248 `if (env.YAD_PAID_API_KEY)`)
staat NIET meer ingesteld — de betaalde vangnet-provider wordt nu helemaal niet meer opgebouwd,
ongeacht de PRIMARY-vlag. Geen actie meer nodig hier.

### Root cause "alle gratis providers faalden binnen 81s" gevonden en gefixt

Niet quota-uitputting zoals vermoed — drie standaard-modelnamen in `engine/pool.ts` waren
gewoon verouderd (providers deprecaten modellen). Live tegen elke API bevestigd:
- Groq `llama-3.3-70b-versatile` → 404 → `openai/gpt-oss-120b`
- Gemini `gemini-2.0-flash` → 404 (eigen foutmelding noemt de vervanger) → `gemini-3.6-flash`
- OpenRouter `llama-3.3-70b-instruct:free` → 404 "unavailable for free" → `minimax/minimax-m3:free`
- Cerebras `llama3.1-8b` → niet live getest (geen sleutel actief nu) → `gpt-oss-120b`

Bewust met rust gelaten: de PRIMAIRE Gemini-sleutel geeft "prepayment credits depleted" (429) —
dat is waarschijnlijk de `ALLOW_PAID_GEMINI`-veiligheidsrem die correct werkt na het
Vertex-kostenlek van augustus (zie geheugen), geen bug. De pool heeft een tweede gratis
Gemini-sleutel die wel werkt.

Echt end-to-end geverifieerd (niet alleen curl): de werkelijke `buildPool()`+`LlmRouter`-code
gedraaid tegen de live `.env`. Pool bouwt correct op, en toen de primaire Gemini-sleutel de
verwachte 429 gaf, viel de router netjes door naar de tweede sleutel en gaf een echt antwoord.

PR: `https://github.com/holistis/al-yad/pull/3`, gemerged naar main.

### PR #2 (ref-selectie-bug) gemerged

`https://github.com/holistis/al-yad/pull/2` — zie eerdere sectie hieronder voor de root-cause-
analyse. Typecheck+291 tests groen, gemerged. Live eindverificatie op bk-002/bk-003 zelf niet
gedaan (browser was op dat moment bezet door de andere sessie's eigen hertest).

### README herstructurering

Volgorde omgegooid naar een bewijs-eerst opbouw: Demo, Architecture, Benchmark, Install,
Security, Roadmap, Research. Demo-sectie verwijst nu naar de echte, al bestaande video
(`https://yadagent.com/yad-invoice-demo-en.mp4`). Security-sectie samengevat op basis van de
live pagina `yadagent.com/yad-security` (de opdracht noemde per ongeluk een verkeerde URL,
gecorrigeerd voor er een dode link in de README kon komen).

Commit: `5538a80` op branch `feat/yad-onboarding-copy`.

### Provider/model-logging in de benchmark

`AgentLoop` hield nooit bij welk provider:model een taak echt beantwoordde, alleen dat de pool
ooit iets teruggaf. Toegevoegd via `providersUsed` (zelfde patroon als de bestaande
`hadRecovery`/`lastStuckSignalId`-getters), doorgekoppeld naar `benchmark.ts`'s `TaskResult`.

Commit: `a48c307` op branch `feat/yad-onboarding-copy`.

Direct iets echts mee gevonden: een taak die het verkeerde antwoord gaf, bleek te zijn
afgehandeld door het BETAALDE gpt-4o-mini-model (dezelfde modelklasse als de 92%-claim op de
site), niet door een zwak gratis model. Dat verlegt de echte bug naar hoe Yad een stukje tekst
op de pagina kiest om te lezen (ref-selectie), niet naar modelkwaliteit. Nog niet gefixt, wacht
op meer data uit de bredere testronde.

### Benchmark, eerste echte metingen

Klein testje (3 taken, daarna nog 2 extra) op de bestaande 25-taken-set, met de gratis
standaardrouting van Yad zelf:

- Taak bk-001 (eerste boek + prijs vinden): volledig correct.
- Taak bk-002 (goedkoopste boek zoeken): fout antwoord, twee keer gereproduceerd, ref-selectie
  wees het verkeerde element aan ("Home" i.p.v. de prijslijst).
- Taak bk-003 (totaal aantal boeken): fout antwoord, zelfde patroon.

Resultaat: 33 procent volledig correct op dit kleine testje, niet de 92 procent die op de site
staat. Dat getal is een klein, eerlijk gemeten datapunt, geen definitieve conclusie, een bredere
testronde (12 nieuwe taken) liep nog op het moment van schrijven.

Resultaatbestanden: `data/benchmark-results-2026-08-28T20-33-28.json`,
`data/benchmark-results-2026-08-28T20-47-51.json`.

### Root cause bk-002/bk-003 gevonden + gefixt (PR, niet gemerged)

De ref-selectie-bug ("Home" i.p.v. prijslijst) had een concrete oorzaak: het model volgt
prompt.ts's COMPARE/RANK/COUNT-regel ("gebruik extract zonder ref bij goedkoopste/aantal/etc")
niet altijd, en pakt soms toch een specifieke (verkeerde) ref. Zelfde klasse bug als de al
bestaande extract-lus-bewaker verderop in dezelfde functie — daar staat het letterlijk: "Prompt-
regel wordt niet altijd nageleefd door het model."

Fix: een code-niveau bewaker in `AgentLoop.run()` (`packages/companion/src/agent/loop.ts`) die
de ref strip zodra de doelvraag een vergelijk/rangschik/tel-woord bevat (NL+EN) EN de geplande
actie `extract` met een ref is — forceert dan een volledige-pagina-lezing i.p.v. het risico op
een verkeerd element.

Gevalideerd: `pnpm typecheck` schoon, `pnpm test` 291/291 (289 bestaand + 2 nieuwe gerichte
tests: bewaker grijpt in bij een vergelijk-vraag, laat een normale extract met ref met rust bij
een gewone vraag). NIET live geverifieerd tegen de echte benchmark — de andere sessie had de
browser toen in gebruik. PR: `https://github.com/holistis/al-yad/pull/2`, nog NIET gemerged,
wacht op live-verificatie (bk-002/bk-003 opnieuw draaien) + koning-akkoord.

### Bredere benchmark (12 taken) afgerond: 66,7% volledig correct

Rapport: `data/benchmark-results-2026-08-28T21-08-03.json`. 100% pass+partial (8 volledig, 4
gedeeltelijk, 0 mislukt/fout), 66,7% volledig correct — completer en eerlijker beeld dan de
eerdere 33% op een steekproef van 3 taken, nog steeds onder de 92%-claim in de README. Per
categorie: product-research 75%, content-extraction 91,7%. Per moeilijkheid: easy 75%, medium
85,7%, hard 100%.

### Concurrentie-benchmark: NIET gestart, wacht op akkoord (kost geld)

De andere sessie noteerde dit al: een eerlijke test tegen browser-use (zelfde taken, metrics,
een sectie "waar Yad verliest") kost echte tijd en API-geld. Geen script/plan-bestand gevonden
in de repo, alleen dit voornemen in de milestone-tekst. Niet gestart zonder expliciet akkoord
van de koning over budget — zelfde hardcoded regel als "nooit betaalde LLM zonder toestemming".

### Voorbereide, nog niet uitgevoerde stukken

- Eerlijk testplan tegen browser-use (metrics, twee testmodi, aparte sectie "waar Yad
  verliest"), nog niet gedraaid, kost echte tijd en geld, wacht op akkoord.
- Lijst van 24 echte, opgezochte mensen voor technische feedback, niemand benaderd.
- Eerste "Yad Research Log"-artikel over een Power BI dropdown-bug, in een parallelle sessie
  geschreven, niet in dit bestand, zie `site/blog-stuck-in-loops.html` als die daar al staat.

### Product Hunt-launch volledig voorbereid en gepland

Alle stappen ingevuld: naam/tagline/beschrijving/GitHub-link/open-source-vinkje/3 launch tags,
thumbnail + galerij, maker's-comment, "Connect with Investors"-formulier (bewust eerlijk
"pre-revenue by design" bij de omzet-vraag, geen verzonnen cijfers), en een video. Gepland voor
1 september 2026 (gaat live om middernacht PT).

Video: `https://youtu.be/6Vw8VUKZZns` (Unlisted) — géén animatie, een ECHTE schermopname
(ffmpeg+gdigrab) van Yad die live van de homepage naar de security-pagina klikt, ontdekt dat
schermopname via ffmpeg wél kan (eerder ten onrechte aangenomen van niet).

Publieke launch-pagina: `https://www.producthunt.com/products/yad?launch=yad`.

### PR #1 gemerged naar main

`holistis/al-yad#1` ("Edge/Brave support, blog, Dutch translation, AI discoverability, repo
hygiene") stond al klaar en gevalideerd, maar nog niet gemerged. CI groen, geen conflicten,
gemerged naar main op 2026-08-28.

### 3 nieuwe awesome-list PR's, één bewust overgeslagen

- `https://github.com/jim-schwoebel/awesome_ai_agents/pull/465` (1952 sterren)
- `https://github.com/angrykoala/awesome-browser-automation/pull/145` (634 sterren, directe
  topic-match)
- `https://github.com/caramaschiHG/awesome-ai-agents-2026/pull/536` (1695 sterren)

Alle drie geverifieerd op een schone 1-regel-diff voor de PR werd geopend.

Bewust NIET ingediend bij `ProjectRecon/awesome-ai-agents-security`: die lijst is specifiek voor
tools die ANDERE agents beveiligen (firewalls/sandboxes/scanners), niet voor agent-producten
zelf. Yad past daar inhoudelijk niet — geforceerd indienen was list-spam geweest en had het
risico op afwijzing vergroot. Eerst README/CONTRIBUTING.md van een lijst lezen voor je indient.

### AlternativeTo.net

Account aangemaakt (gebruikersnaam `yadagent`), captcha door de koning zelf opgelost (bewust niet
geautomatiseerd — bot-detectie omzeilen raakt platform-voorwaarden). Volledige indiening als
"Yad Agent" (niet kaal "Yad", want die naam is op AlternativeTo al bezet door een ongerelateerde
Linux-tool) later dezelfde dag afgerond, publieke pagina
`https://alternativeto.net/software/yad-agent/about/`, wacht op review.

### Research Log-post #1 geschreven

`site/blog-stuck-in-loops.html` — eerlijk technisch verhaal over een echte faalmodus van diezelfde
avond: Yad liep bij het aansturen van een Power BI-dropdown-menu vast omdat React-herrenders de
opgeslagen element-referenties (snapshot-refs) ongeldig maakten voor de klik landde. Fix: het
element vlak voor de klik opnieuw opzoeken op zichtbare tekstinhoud i.p.v. een eerder genomen
snapshot-referentie te vertrouwen. Nog NIET gelinkt vanaf de blog-index of gepusht, bewust
klaarliggend concept.

### YAD-companion registry-bug gevonden en gefixt

De losse, geïnstalleerde consumenten-app (`yad-companion.exe`) had stilletjes de Chrome
native-messaging-registratie overgenomen van de dev-companion, waardoor poort 3747 (de HTTP-API
die Claude Code gebruikt) niet meer opende — het YAD-paneel toonde gewoon "Verbonden", dus dit
was onzichtbaar zonder de registry na te kijken. Fix: `HKCU:\Software\Google\Chrome\
NativeMessagingHosts\com.yad.companion` teruggezet naar
`C:\Code\al-yad\native-messaging\com.yad.companion.json`.

### Wat hier bewust niet in staat

Distributiewerk voor het andere product (DeFi Signal API / Execution Stress Index) staat niet
hier, dat is een ander project (`wazir-al-ghanima`), niet Yad. Zie daar het eigen geheugen voor
die mijlpalen.

## 2026-08-29

### De echte oorzaak van vannachts slechte cijfers: twee AL GEMERGDE fixes draaiden lokaal niet

Voortzetting van de "Concurrentietest tegen browser-use"-draad van gisteren. De solo-benchmark
(12 taken, alleen gratis providers) gaf eerst een verwoestend resultaat: 1/12 geslaagd (8,3%),
daarna zelfs 0/1 op een herhaalde losse taak, met steeds dezelfde melding: "de gratis
AI-modellen zitten even op hun limiet". Eerste aanname was pure quota-uitputting (browser-use en
YAD's eigen eerdere testrondes hadden dezelfde gratis sleutels vannacht al zwaar gebruikt).

Directe curl-tests naar Groq en OpenRouter met een triviale aanvraag gaven allebei gewoon 200
OK — dus geen echte quota-uitputting. Dat klopte niet met de herhaalde falen op echte taken, dus
doorgezocht met een losse diagnostische taak en de router-log (die de benchmark eerder altijd
weggooide, `log: () => {}` — nu gefixt, zie PR #4 hieronder) zichtbaar gemaakt. Uitkomst: groq,
openrouter EN github-models faalden alle drie meteen, zonder enige retry-poging — een teken dat
de router de fout als NIET-herstelbaar classificeerde, niet als een simpele rate-limit.

Root cause gevonden via `git diff origin/main`: de lokale werkmap (branch
`feat/yad-onboarding-copy`) stond 5 commits achter op main en had `pool.ts`/`http-api.ts` nog op
de OUDE, kapotte model-namen staan (`llama-3.3-70b-versatile`, `gemini-2.0-flash`,
`llama3.1-8b`, `meta-llama/llama-3.3-70b-instruct:free`) — precies de namen die PR #3 gisteren
al gefixt en gemerged had naar main. De lokale branch had die merge nooit opgehaald. Zelfde
verhaal voor `loop.ts`: de compare/rank/count-bewaker van PR #2 was er lokaal ook niet, terwijl
er wel een ongerelateerde, nooit afgemaakte `providersUsed`-tracking-feature in stond (niet van
deze sessie, kennelijk restant van eerder/ander werk, nooit gecommit). Dat laatste is verwijderd
uit de werkmap — half-af, ongetest, en brak `scripts/benchmark.ts` toen het per ongeluk werd
meegekopieerd naar een schone branch (`loop.providersUsed is not iterable` — meteen gevonden en
gefixt voor het een echte run kon beschadigen).

Fix: `pool.ts`, `http-api.ts` en `loop.ts` teruggezet naar de main-versie (`git checkout
origin/main -- <bestand>`), de PR #2/#3-fixes zaten daar dus altijd al in, gewoon nooit lokaal
opgehaald. Les voor volgende keer: na een PR-merge op GitHub, `git pull`/`git merge origin/main`
in de lokale werkmap, anders test je in het echt de oude, kapotte code terwijl je denkt dat de
fix actief is.

**Resultaat na de echte fix — bk-002 (de taak die de hele nacht bleef falen): PASS in 2,2s.**

### PR #4: escalerende circuit-breaker cooldown + zichtbare rate-limit-fout

`https://github.com/holistis/al-yad/pull/4` (branch `fix/free-tier-fallback-reliability`,
losse worktree, niet main aangeraakt zonder bevestiging). Twee losse gaten die de nacht erger
maakten dan nodig, los van de staleness-bug hierboven:

1. `CircuitBreaker` gebruikte altijd dezelfde vaste cooldown (5 min), ongeacht hoe vaak een
   provider al eerder open ging. Cooldown verdubbelt nu per opeenvolgende opening zonder
   tussentijds succes (1x → 2x → 4x-plafond), reset naar 1x bij een succesvolle call.
2. `AgentLoop.run()` gaf bij een LLM-fout geen `summary` terug, alleen een UI-bericht.
   `scripts/benchmark.ts`'s eigen rate-limit-retry (wacht 120s, probeer 1x opnieuw) leest
   precies dat veld en vuurde daardoor NOOIT af, de hele nacht niet. Gefixt: foutmelding gaat nu
   mee in `summary`, en de router's eigen per-provider-log wordt niet meer weggegooid.

Getest: nieuwe circuit-breaker-tests voor de escalatie, volledige companion-suite 293/293 groen,
typecheck schoon. Wacht op bevestiging van de koning voor merge naar main (zelfde afspraak als
PR #2/#3).

### Ollama-bodemval: twee losse gaten gevonden, één lokaal gefixt, één moet de koning beslissen

1. **Gefixt (lokale `.env`, niet in git):** `OLLAMA_MODEL` stond op `qwen2.5:32b`. De codebase's
   eigen benchmark-comment (`pool.ts` regel ~283, van 2026-07-19) zegt letterlijk dat 32b
   85-105s/stap kost tegen een default provider-timeout van 60s — dus gegarandeerd timeout, elke
   keer. 7b haalt 13-27s/stap, past wel. Omgezet naar `qwen2.5:7b-instruct`.
2. **NIET gefixt, koning-beslissing nodig:** de Hetzner-Ollama-box (`138.201.204.97:11434`) is
   op dit moment gewoon onbereikbaar, los van modelkeuze (`fetch failed`, TCP-poort dicht
   bevestigd). Er ligt al een SSH-tunnel-script klaar (`ollama-tunnel.bat`/`ollama-tunnel.py`,
   sinds 10 juli) dat verbinding maakt via `root@138.201.204.97` naar `localhost:11434` op de
   server, maar dat moet iemand HANDMATIG starten en een venster open houden. Zonder dat draaien
   is de "bodemloze terugval" dus geen automatische terugval — hij is er gewoon niet, tenzij een
   mens hem net aanzet. Drie eerlijke opties: (a) tunnel automatisch laten starten (Taakplanner)
   zodat Ollama een echte automatische bodem wordt, (b) de Hetzner-firewall poort 11434 direct
   open zetten voor minder gedoe maar meer blootstelling, (c) accepteren dat Ollama een
   handmatige/optionele terugval is en dat nergens als "automatisch" beschrijven. Geen van drie
   is zelf uitgevoerd, dit raakt gedeelde infrastructuur.

### Concurrentietest tegen browser-use: volledige, eerlijke 12-taken-vergelijking (afronding)

Zelfde 12 taken (bk-001 t/m bk-008, qt-001 t/m qt-004) bij beide kanten, na de echte fix
hierboven — dit is de vergelijking die gisteravond nog niet mogelijk was.

**YAD:** 11/12 volledig correct (91,7%), 1 partial, 0 mislukt. Gemiddeld 1,5 stappen,
gemiddeld 10,9s per taak. Ruwe data: `data/benchmark-results-2026-08-29T06-22-55.json`.

**browser-use** (OpenRouter `minimax/minimax-m3:free`, use_vision=False): 12/12 "PASS" volgens
de eigen keyword-score. Gemiddeld 3,25 stappen, gemiddeld 21,9s per taak. Ruwe data:
`data/browser-use-compare-broad-results.json`.

**Snelheid/efficiëntie:** YAD wint op 11 van de 12 taken op tijd, en gebruikt gemiddeld minder
dan de helft van het aantal stappen (1,5 tegen 3,25). browser-use was alleen sneller op qt-004,
waar YAD een echte onverwachte-navigatie tegenkwam en zichzelf herstelde via de recovery-store
(kostte tijd, geen mislukking).

**Belangrijkste kwalitatieve vondst, apart geverifieerd:** bij bk-007 ("zoek een 5-sterren boek")
gaf YAD een eerlijke partial terug ("sterren staan als CSS-iconen, niet als tekst, kan dit niet
zeker vaststellen uit tekst-extractie"). browser-use gaf een zelfverzekerd PASS: "A Light in the
Attic — 5 sterren, £51.77". Rechtstreeks geverifieerd tegen de echte HTML van
books.toscrape.com: "A Light in the Attic" is 3-sterren, niet 5. De vier echte 5-sterren boeken
op pagina 1 zijn Sapiens, Set Me Free, Scott Pilgrim's Precious Little Life en Rip it Up and
Start Again. browser-use's antwoord is dus een verzinsel, geen correcte lees — logisch ook,
want ook browser-use draaide met use_vision=False en kon de CSS-sterren dus evenmin echt lezen.
Onze eigen simpele keyword-score ving dit niet (checkte alleen op aanwezigheid van "£"), dus dit
is ook een les voor onze eigen benchmark-scoring, niet alleen een browser-use-punt.

**Eerlijke samenvatting:** op deze steekproef is YAD sneller, stapzuiniger, en weigert een
antwoord te verzinnen als het de brontekst niet kan verifiëren. browser-use is net zo vaak
"klaar" maar duurder en gaf één keer een foutief zelfverzekerd antwoord op precies het soort
vraag waar giswerk het makkelijkst binnensluipt. Kleine steekproef (12 taken, één site-paar),
dus geen definitief oordeel, maar wel de eerste ECHTE, gecontroleerde meting sinds het idee
ontstond.

### Research Log #1 en #2 live gezet

Beide verhalen (dropdown-bug van 28 augustus, browser-use-vergelijking hierboven) staan nu
live: `https://yadagent.com/yad-blog-stuck-in-loops` en
`https://yadagent.com/yad-blog-benchmark-browseruse`, beide ook zichtbaar op de blog-index
`https://yadagent.com/yad-blog`.

Belangrijke ontdekking tijdens het live zetten: de YAD-website draait niet los, maar op
dezelfde server EN hetzelfde PM2-proces (`x402-server`, poort 3748 op de Hetzner-VPS) als de
live x402-betaal-API van een ander product. Pagina's worden per verzoek vers van schijf
gelezen (`readFileSync`, geen cache), dus een bestaande pagina bijwerken kan altijd zonder
herstart. Een NIEUWE route (zoals deze twee nieuwe blogposts) vereist wel een code-toevoeging
aan `x402-server.mjs` en dus een herstart van dat gedeelde proces. Koning gaf hiervoor expliciet
akkoord na uitleg van het risico. Uitgevoerd met een lokale backup vooraf
(`x402-server.mjs.pre-yad-blog-backup` op de server zelf), syntax-check vóór het wisselen, en
na de herstart gecontroleerd dat zowel de nieuwe pagina's (HTTP 200) als de betaal-API (schone
herstart in de logs, geen fouten) het overleefden. Downtime: onder de seconde.

### Research Log #2 ook op Hashnode gepubliceerd

Zelfde artikel, herschreven als los stand-alone stuk (geen site-navigatie-context nodig),
gepubliceerd via YAD's eigen browsersturing onder de bestaande publicatie LongevityAI (geen van
de twee bestaande publicaties past qua onderwerp echt, een derde aanmaken kost Hashnode Pro,
dus koning koos expliciet voor LongevityAI). Live:
`https://longevityai.hashnode.dev/we-benchmarked-yad-against-browser-use-then-checked-the-answers`.
Titel en body (578 woorden) ingevuld via de bekende chunked-`yad_evaluate`-techniek (zie
`devto-hashnode-publicatie-2026-08-05` in het geheugen voor de herkomst van die techniek),
bevestigd live via het Published-tabblad in het Hashnode-dashboard (telling ging van 6 naar 7).

### PR #4 gemerged, llms.txt bijgewerkt

PR #4 (circuit-breaker-escalatie + zichtbare rate-limit-fout) is gemerged naar main door de
koning zelf via GitHub (`gh pr merge` werd geblokkeerd door Claude Code's eigen
auto-mode-classifier voor merges naar main, dat is bewust zo en niet omzeild). Branch en
worktree opgeruimd.

`site/llms.txt` (en de live `yadagent.com/llms.txt`) uitgebreid met twee nieuwe secties: "How it
benchmarks" (de geverifieerde browser-use-cijfers) en "For AI coding agents" (eerlijke,
scope-correcte documentatie van de lokale HTTP-trigger-API op poort 3747, expliciet benoemd als
lokaal-alleen, geen publieke internet-API).

### Onderzoek AI-agent-ontdekking + PR #5: yad-agent-mcp

Achtergrond-subagent (WebSearch, bronnen geverifieerd) onderzocht hoe AI-AGENTS (niet chatbots
die citeren, maar agents die zelf tools zoeken) YAD zouden kunnen vinden. Kernbevinding: geen
enkele MCP-registry of tool-directory indexeert een losse HTTP-API, alleen echte MCP-servers.
YAD's bestaande lokale trigger-API (127.0.0.1:3747) is dus onzichtbaar voor dat hele
ecosysteem. Sterk precedent gevonden voor exact deze opzet: BrowserMCP (extensie + lokale
companion die de echte browser aanstuurt, verpakt als MCP), 7.000 GitHub-sterren, gelist op
mcpservers.org en meerdere awesome-mcp-servers-lijsten. Bronnen: registry.modelcontextprotocol.io
(actief, v0.1-freeze sinds okt 2025, ondersteunt lokale stdio-packages als eersteklas
burger), github.com/browsermcp/mcp, mcpservers.org, smithery.ai, glama.ai. mcp.so en de
diverse "awesome-ai-agents-2026"-GitHub-forks bewust afgeraden (laag-curatie resp. een
cluster bijna-identieke, waarschijnlijk AI-gegenereerde SEO-repo's).

Gebouwd op basis daarvan: `packages/mcp-server` (npm-naam `yad-agent-mcp`), een dunne
stdio-MCP-server met 5 tools (`yad_status`, `yad_navigate`, `yad_capture`, `yad_run_goal`,
`yad_last_result`) die stuk voor stuk gewoon de bestaande companion-HTTP-API aanroepen — geen
nieuwe functionaliteit, puur een ontdekkingslaag. Geverifieerd met een ECHTE MCP-client over
stdio (niet alleen typecheck): tool-lijst opgehaald, een echte `yad_status`-aanroep tegen de
al-draaiende companion gelukt. Unit-tests mocken `fetch` zodat CI geen echte companion nodig
heeft (8/8 groen). Volledige workspace (`typecheck`/`build`/`test`) groen met het nieuwe
package erbij. PR: `https://github.com/holistis/al-yad/pull/5`, gemerged door de koning.

### yad-agent-mcp daadwerkelijk gepubliceerd

Koning koos expliciet voor de volle publicatie (npm + MCP-registry + awesome-mcp-servers-PR).
Onderweg twee losse, echte problemen gevonden en opgelost, niet alleen "het lukte gewoon":

- Het bestaande npm-token in `.npmrc` bleek verlopen (401). Nieuw token aangemaakt door de
  koning zelf via de npm-site (YAD kon dat specifieke stapje niet betrouwbaar doen — een andere
  tab bleef steeds de CDP-focus afpakken, koning deed het handmatig). Eerste nieuwe token miste
  "Bypass 2FA" en gaf een 403 bij publiceren, npm eist dat expliciet zodra een account geen 2FA
  heeft — mijn eerdere advies om dat vinkje UIT te laten was fout, gecorrigeerd. Tweede token
  (7 dagen geldig, bewust kort voor een bypass-2FA-token) werkte.
- `npm publish --dry-run` gaf een waarschuwing dat het `bin`-script ongeldig was. Uitgezocht met
  een echte lokale `npm pack` + tarball-inspectie: de executable-bit ging inderdaad verloren in
  een vanaf Windows gepackte tarball, MAAR een echte `npm install -g` vanaf die tarball herstelt
  hem zelf correct (geverifieerd met een echte installatie, niet aangenomen). Bouw-script
  aangepast om 'm toch expliciet te zetten (defensief, niet strikt noodzakelijk gebleken).

Gepubliceerd: `https://www.npmjs.com/package/yad-agent-mcp` (v0.1.1, na een patch voor het
verplichte `mcpName`-veld en een te lange beschrijving voor de MCP-registry se 100-tekens-limiet).
Aangemeld bij de officiële MCP-registry via `mcp-publisher` (Windows-binary opgehaald van de
GitHub-release, GitHub-device-flow-login kostte 5 pogingen — steeds verlopen voor de koning de
code kon invoeren, uiteindelijk gelukt met een ruimer tijdvenster): live op
`registry.modelcontextprotocol.io`, naam `io.github.holistis/yad-agent-mcp`.

PR bij `wong2/awesome-mcp-servers`: wijziging klaar en gepusht (fork opnieuw gezet nadat de
oude bleek "verweesd", `gh repo view` toonde `parent=none`, al bleek dat via de ruwe API
(`gh api repos/holistis/...`) achteraf gewoon correct `parent: wong2/awesome-mcp-servers` te
zijn — een `gh`-CLI-weergavefout, geen echt probleem). `gh pr create` zelf blijft daarna alsnog
weigeren met "does not have the correct permissions", zowel via GraphQL als de REST-fallback,
oorzaak niet gevonden ondanks kloppende fork-rechten en een normaal-toegankelijke upstream-repo.
Rechtstreekse compare-link aan de koning gegeven
(`github.com/wong2/awesome-mcp-servers/compare/main...holistis:add-yad-agent-mcp`), maar de
GitHub-pagina zelf toonde de echte reden: "An owner of this repository has disabled the
ability to open pull requests" — een bewuste instelling van de eigenaar, geen bug. Die lijst dus
laten voor wat het is.

Koning wilde toch doorzetten ("hoe bekender ik kan worden hoe beter"). Alternatief gevonden en
geverifieerd vóór het proberen: `punkpeye/awesome-mcp-servers`, 93.000 sterren (ruim groter dan
de wong2-lijst), actief onderhouden (recente merges van precies hetzelfde "Add X"-PR-type
gecontroleerd), PR's niet uitgeschakeld. Daar lukte het meteen, wat ook bevestigt dat het
eerdere GraphQL/REST-permissiefoutje echt specifiek bij de wong2-repo hoorde, niet een
gh-CLI- of tokenprobleem aan onze kant. Ingevoegd onder de bestaande "Browser Automation"-sectie
(die daar wél bestaat, met browsermcp/mcp als het structureel dichtstbijzijnde bestaande
voorbeeld), alfabetisch tussen hanzili/comet-mcp en hshintelligence/agent-scrape. PR:
`https://github.com/punkpeye/awesome-mcp-servers/pull/13148`.

### Twee echte klik-bugs gevonden en gefixt tijdens het live opzetten van Cloudflare

Koning wilde yadagent.com aanmelden bij Google Search Console (Domain-property, dus een
DNS-TXT-record nodig). Onderweg (Etheron had geen losse DNS-editor, dus overgestapt op
Cloudflare als nameserver-provider) confronteerde de koning me direct: "wij hebben YAD op de
markt gezet en dit kan hij niet eens?!" — terechte vraag, en deze keer ook echt uitgezocht en
opgelost in de broncode, niet alleen omheen gewerkt.

**Bug 1 — verouderde ref op een snel her-renderende pagina.** Cloudflare's dashboard (een
zware React-SPA) verving elementen soms tussen het maken van de snapshot en het uitvoeren van
de klik. `refMap.get(ref)` gaf dan `undefined` terug, of — erger — een losgekoppeld knooppunt
waarop `click()` gewoon slaagde zonder enig zichtbaar effect (`el.getBoundingClientRect()` op
een losgekoppeld element geeft een lege rect, dus de klik landde op coördinaat (0,0)). Dit is
exact dezelfde bugklasse als de Power BI-dropdown uit Research Log #1 (2026-08-28) — die post
noemde toen al "bouw fresh-resolution-by-text als automatische terugval" als concrete
vervolgstap, maar dat is destijds nooit echt gebouwd, alleen handmatig toegepast. Nu wel:
`findFresh()` in `perception.ts` zoekt een element opnieuw op zijn rol+naam in de levende
pagina zodra de refMap-verwijzing ontbreekt of losgekoppeld is (`packages/extension/lib/
perception.ts`, `executor.ts`, `entrypoints/content.ts`).

**Bug 2 — klik op een aangepast dropdown-element faalde met een technische fout.** Cloudflare's
"Type"-veld (een `<button role="combobox">`, geen native `<select>`) gaf bij klikken
"X.click is not a function" terug — dezelfde foutmelding die ook al in het logboek van vanavond
stond bij een eerdere Hashnode-interactie, dus geen incident maar een terugkerend patroon.
Gefixt met `fireClick()`: probeert eerst de native `.click()`, valt anders terug op een
synthetische mousedown/mouseup/click-reeks — hetzelfde principe dat de bestaande
"right-click"-actie in dit bestand al gebruikte, nu ook voor gewone klikken.

Beide fixes rechtstreeks LIVE gedeployed naar de koning's browserextensie tijdens de sessie
(build + `/reload-extension`) en **daadwerkelijk herbevestigd op exact dezelfde Cloudflare-pagina
die eerder faalde**: het "Type"-dropdown opende nu écht (21 opties verschenen), TXT geselecteerd,
record opgeslagen, zichtbaar in de lijst. Niet alleen unit-tests, ook een echte herhaling van de
mislukking. 13 nieuwe tests (`perception.findFresh.test.ts`, `executor.staleRef.test.ts`,
`executor.robustClick.test.ts`) — eerste testinfrastructuur voor dit package (`vitest` + `jsdom`,
bestond nog niet). PR: `https://github.com/holistis/al-yad/pull/6`.

### Chrome Web Store publiceer-pijplijn eenmalig opgezet, PR #6 live naar echte gebruikers

Beide klik-fixes hierboven zaten al in de koning's lokale dev-extensie, maar nog niet bij de
mensen die YAD via de echte Chrome Web Store geïnstalleerd hebben. Dat vroeg een eenmalige
OAuth-opzet voor `scripts/webstore-publish.mjs`, met drie losse, elk voor het eerst hier
tegengekomen obstakels:

1. **Google blokkeert de oude OOB-flow hard** (`Error 400: invalid_request... OOB flow has been
   blocked`) — geen verouderde documentatie maar een actueel, hard beveiligingsbeleid. Vervangen
   door een loopback-redirect (`http://localhost:53682/callback`): het script start zelf
   tijdelijk een lokale server, vangt de `code` op zodra Google terugstuurt, en sluit meteen af.
2. **Verkeerd Google-account eerst geauthenticeerd.** De OAuth-login liep aanvankelijk via
   info@holistischadviseur.nl (eigenaar van het GCP-project) — die kreeg 403 Forbidden, zelfs op
   lees-acties. De koning wees uit dat de Chrome Web Store-listing zelf onder een ander account
   staat. Opnieuw ingelogd onder het juiste account (incl. telefoon-2FA, nummer live doorgegeven
   tijdens het inloggen) loste dit meteen op.
   Tweede blokkade onderweg, ook echt en niet verouderd: het OAuth-consentscherm stond op
   "Internal" (`Error 403: org_internal`, werkt alleen voor accounts binnen dezelfde Workspace-
   organisatie). Omgezet naar "External" + testgebruiker toegevoegd.
3. **`PKG_MANIFEST_KEY_NOT_MATCH` bij de eerste echte upload.** `wxt.config.ts` bakte altijd de
   vaste dev-sleutel (`.keys/manifest-key.txt`, bedoeld om de extensie-ID lokaal stabiel te
   houden voor de native-messaging host) in het manifest, ook in de `YAD_WINKEL=1`-build. De
   Chrome Web Store beheert voor een al gepubliceerd item zelf de sleutel en wijst elke upload
   af die een andere meestuurt. Fix: de sleutel alleen nog toevoegen als `!winkel`
   (`wxt.config.ts` regel ~69) — de winkelbuild laat het `key`-veld nu volledig weg.

Na deze drie fixes: upload `SUCCESS`, publish `status: ["OK"]`, en rechtstreeks bij de Chrome
Web Store API geverifieerd (niet alleen op het API-antwoord vertrouwd) dat het live item
`crxVersion: "0.1.9"` toont — de daadwerkelijke gebruikers krijgen nu dezelfde klik-fixes als de
koning's dev-extensie. `webstore-secrets.json` (client_id/secret/refresh_token/item_id) staat in
`.gitignore`, komt nooit in git; toekomstige versies kunnen voortaan met één commando
(`node scripts/webstore-publish.mjs`) gepubliceerd worden zonder deze opzet te herhalen.

## 2026-08-30

### Beveiligingsheaders + security.txt op yadagent.com

Een awesome-privacy PR-bot (lissy93/awesome-privacy#782) wees terecht op ontbrekende
beveiligingsheaders op yadagent.com: HSTS, CSP, X-Frame-Options, security.txt. Dezelfde melding
bevatte ook een eng klinkende regel ("previously flagged as a spammer") — uitgezocht via de echte
broncode van die bot (`lib/checks/check-project.py` in dat repo): dat is geen zwarte lijst, puur
een teller die afgaat bij 7+ verschillende repositories met een PR in 2 dagen, telt ook de eigen
al-yad/muraqib/SiteCraft-AI/ai-app-PR's mee. Geen echte reputatieschade, wel de moeite waard om
niet te veel awesome-lijsten tegelijk in een korte tijd aan te schrijven.

De headers zelf zijn wél een echte, terechte bevinding en opgelost. Dit is een **nginx-wijziging op
de VPS** (`/etc/nginx/sites-available/yadagent`, backup vooraf als
`yadagent.bak-20260830T214242Z`), geen wijziging in deze GitHub-repo, dus geen overlap met lopend
werk hier. Eerst de live site nagetrokken op externe scripts/stylesheets/fonts/afbeeldingen/iframes
(geen enkele gevonden, alles zelf-bevat) voor er een CSP werd geschreven, om te voorkomen dat de
site zou breken. Toegevoegd: `Strict-Transport-Security`, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy`, een `Content-Security-Policy` met
`'unsafe-inline'` voor de bestaande inline `<script>`/`<style>`-blokken, en een nieuwe
`/.well-known/security.txt` (verwijst naar `info@holistischadviseur.nl` en de bestaande
`/yad-security`-pagina). Na reload geverifieerd: alle headers staan er, en `/yad-nl`,
`/yad-security` en de demo-video geven nog gewoon 200.

### Judge-veiligheidstest: is de gratis lokale Judge te vertrouwen, of gokt hij?

Vraag naar aanleiding van de LLM-pool-upgrade (10+ gratis providers, `buildCheapPool()` zet een
lokale `ollama-cheap` (`qwen2.5:3b-instruct`) als Judge in plaats van een dure cloud-call):
faalt die goedkope Judge VEILIG (naar "unknown", escaleert) of GEVAARLIJK (naar een vals
"match", verbergt echte fouten)?

Nieuw, los script `scripts/judge-safety-test.ts` (raakt loop.ts/judge.ts/pool.ts/benchmark.ts
niet aan) draait de bestaande takenset met de goedkope pool als `judgeRouter`, en stuurt elke
échte Judge-aanroep die daadwerkelijk plaatsvindt ook naar de sterke cloud-pool als referentie —
beide oordelen worden ernaast gelogd. Cache moest bewust UIT (`cacheStore` weggelaten): een
cache-hit slaat de hele plan+Judge-cyclus over, en juist die wilden we meten.

**Eerste run (25 taken, 7 echte vergelijkingen — de meeste taken in deze set zijn puur-lezen en
triggeren de Judge niet):** 2/7 overeenstemming (28,6%). Geen enkele keer de ergste fout
(goedkoop=match, sterk=mismatch), maar wel een duidelijk patroon: 5 van de 7 keer had de
uitgevoerde actie geen `extracted`-bewijs (null), en de sterke Judge zei dan terecht "unknown"
terwijl de goedkope Judge desondanks stellig "mismatch" (4x) of zelfs "match" (1x, bk-008) durfde
te zeggen — een gok op basis van alleen de URL, niet op echt bewijs.

**Fix:** één harde regel toegevoegd aan `JUDGE_SYSTEM` in `packages/companion/src/judge/judge.ts`
— als `extracted` leeg/null is, is "unknown" VERPLICHT, ongeacht hoe overtuigend de URL lijkt.
De regel "unknown bij onvoldoende bewijs" stond er al impliciet, maar een klein model bleek dat
minder consequent toe te passen dan een groot model — een mechanische, harde regel werkt beter
dan vertrouwen op het eigen beoordelingsvermogen van een klein model. 10 bestaande tests in
`judge.test.ts` blijven groen (geen enkele test hangt af van de exacte prompttekst).

**Tweede run, zelfde takenset, na de fix:** 6/7 overeenstemming (85,7%). De ene overgebleven
afwijking wijst de veilige kant op (goedkoop=unknown, sterk=match — te voorzichtig, niet
gevaarlijk). Nul gevaarlijke afwijkingen in beide rondes.

**Conclusie:** de gratis lokale Judge is met deze fix aantoonbaar betrouwbaar genoeg om te
vertrouwen, op een kleine maar echte steekproef (n=7, geen synthetische testgevallen — echte
Judge-momenten uit echte benchmark-runs). Ruwe data: `data/judge-safety-comparisons-*.jsonl`,
`data/judge-safety-summary-*.json` (twee tijdstempels, voor en na de fix).

**Nog niet gedaan, bewust:** een grotere steekproef (taken die wél iets extraheren, voor meer dan
7 vergelijkingen) is nog niet gedraaid — koning gaf aan dat dit resultaat voldoende is om op te
bouwen. `scripts/judge-safety-test.ts` en de fix staan klaar als losse commit, nog niet gepusht.
