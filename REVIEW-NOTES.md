# Keurmeester-review — status van de bevindingen

Bron: multi-agent inspectie (45 agents) + heronderzoek internet, adversarieel geverifieerd.
27 bevestigde bevindingen. Dit bestand houdt bij wat is opgelost en wat bewust later komt.

## Opgelost (deze ronde)

Veiligheid / de Poort (raakt de rode lijn: nooit bestellen/betalen):
- Scheme-allowlist op navigate: alleen http/https; javascript:/data:/file:/chrome:/blob: geweigerd (parse.ts + guardrails.ts).
- Deny-lijst fail-SAFE bij lege/onbekende/niet-http pagina-URL: muterende acties geweigerd i.p.v. doorgelaten.
- Percent-encoding bypass gedicht: /che%63kout en /%2Fcheckout worden genormaliseerd en geweigerd.
- Confirm-before-act fail-closed op ROL: elke klik op een muterende rol (button/submit/checkbox/...) en elke type-met-submit vereist bevestiging, ongeacht het door de pagina geleverde label.
- Deny-hercontrole op de WERKELIJKE post-navigatie-URL: belandt de agent op een betaal-/bestel-pad, dan stopt de run hard.

Prompt-injectie / perceptie:
- Paginatekst + element-namen in een gemarkeerd UNTRUSTED-blok met harde systeem-regel (nooit als instructie).
- Onzichtbare unicode (zero-width, BOM, bidi) gestript; aria-hidden genegeerd.
- Open shadow DOM wordt nu doorzocht (web components).

Correctheid / robuustheid:
- Gehallucineerd succes ingeperkt: navigate-timeout geeft ok:false; type leest de waarde terug en faalt als het veld leeg bleef.
- Body-read-timeout-bug: de timeout dekt nu ook het lezen van de body; niet-JSON antwoord schakelt door i.p.v. harde fout.
- Akkoord-poort afgedwongen op het run-start-pad (niet alleen in de UI): geen run zonder akkoord.
- Gesloten run-tab breekt de run netjes af (ABORT_RUN); dubbele-run-bescherming; confirm-timeout aan de Hand-kant; inject-op-aanvraag (scripting) tegen "receiving end does not exist"; run-state reset op nieuwe verbinding (vers companion-proces).
- parseAction gebruikt een echte balans-scanner (eerste geldige object) i.p.v. first/last-accolade.
- Abort-listener-leak in de provider opgeruimd.

## Opgelost (ronde 2 — 2026-06-29)

Tab-capture bug:
- captureActiveWebTab() gebruikt nu 3-stappen fallback: lastFocusedWindow → lastWebTabId (bijgehouden via onActivated/onUpdated) → query alle windows op lastAccessed. Side-panel focus geeft niet langer "geen geschikte web-pagina".

Deferred items uit ronde 1:
- Cross-frame perceptie: same-origin iframes meegenomen in buildSnapshot() via contentDocument; cross-origin gooit SecurityError en wordt netjes overgeslagen. (perception.ts)
- Overlay/cookiebanner: elementFromPoint-check voor elke klik; consent-dismiss (NL/EN/FR/DE) automatisch vóór de echte klik. (executor.ts)
- Aparte REQUEST_CONFIRM-timeout: 120s i.p.v. 30s; timeout logt "geen antwoord" (onderscheid met expliciete weigering); fail-closed. (session.ts)
- Log-redactie: response-body niet meer verbatim in LlmError; alleen HTTP-status + provider-naam. (openai-compatible.ts)
- NativeHost.send: EPIPE/schrijffout gevangen; closed=true; geen crash bij gebroken pipe. (native-host.ts)
- SPA-navigatie: webNavigation.onHistoryStateUpdated luistert op run-tab; extra 800ms wacht na pushState. webNavigation permission toegevoegd. (native-port.ts, wxt.config.ts)

## Bewust later (tracked)

Grotere of niet-urgente items, met bestand-hints:
- host_permissions versmallen: van <all_urls> naar activeTab + optionele per-origin host-permissions; injecteer alleen op de run-tab. Pre-flight: draai in een apart, leeg Chrome-profiel met alleen in-scope test-accounts. (wxt.config.ts)
- Per-tenant/per-sessie rate-budget (token-bucket) bovenop pacing 1s + maxSteps. (companion/agent/loop.ts, session.ts)
- Protocol-versie-check ook op GOAL/RESULT-berichten bij een toekomstige versie-bump. (session.ts)
- Windows host: console-subsystem .exe-wrapper i.p.v. .bat. (native-messaging, scripts/setup-native-host.ts)
- Hand-laag tests (jsdom): executor (click/type/select/extract, contenteditable), perception, native-port reconnect/heartbeat, en de akkoord-handhaving op het GOAL-pad. (packages/extension)
- Cross-origin iframes en gesloten shadow roots expliciet als "niet-inspecteerbaar" markeren in de snapshot. (perception.ts)
