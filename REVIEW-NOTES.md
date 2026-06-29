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

## Bewust later (tracked)

Grotere of niet-urgente items, met bestand-hints:
- Cross-frame perceptie: same-origin iframes meenemen (all_frames + frame-aggregatie). Nu alleen hoofddocument + open shadow DOM. Cross-origin iframes en gesloten shadow roots expliciet als "niet-inspecteerbaar" markeren. (perception.ts, content.ts, native-port.ts)
- host_permissions versmallen: van <all_urls> naar activeTab + optionele per-origin host-permissions; injecteer alleen op de run-tab. Pre-flight: draai in een apart, leeg Chrome-profiel met alleen in-scope test-accounts. (wxt.config.ts)
- Overlay/cookiebanner-afhandeling: klik-doel verifiëren via elementFromPoint; generieke consent-dismiss (NL/EN) vóór de echte klik. (executor.ts)
- Per-tenant/per-sessie rate-budget (token-bucket) bovenop pacing 1s + maxSteps. (companion/agent/loop.ts, session.ts)
- Protocol-versie-check ook op GOAL/RESULT-berichten bij een toekomstige versie-bump. (session.ts)
- Aparte, ruimere REQUEST_CONFIRM-timeout en onderscheid "geen antwoord" vs "geweigerd". (session.ts, loop.ts)
- Windows host: console-subsystem .exe-wrapper i.p.v. .bat. (native-messaging, scripts/setup-native-host.ts)
- Log-redactie: provider-foutmeldingen (mogelijk PII) niet verbatim loggen; status+provider-naam volstaat. (engine/providers/openai-compatible.ts, router.ts, loop.ts)
- NativeHost.send: output 'error'/EPIPE + backpressure afhandelen i.p.v. mogelijk crashen bij gesloten pipe. (companion/native-host.ts)
- SPA-navigatie-readiness (history.pushState houdt status='complete'): grotendeels gedekt door re-snapshot per stap; later webNavigation.onHistoryStateUpdated. (native-port.ts)
- Hand-laag tests (jsdom): executor (click/type/select/extract, contenteditable), perception, native-port reconnect/heartbeat, en de akkoord-handhaving op het GOAL-pad. (packages/extension)
