# Winkelpagina YAD — concept

Concept voor de Chrome Web Store. Nog niet verstuurd; de koning beslist.

## Waarom deze positionering, met de cijfers erbij

Gemeten op 2026-08-16, niet aangenomen:

- **De vraag is bewezen.** TaskMagic staat op AppSumo met exact onze pitch ("automatiseert
  alles wat je in een browser doet, ook zonder API, beschreven in gewone taal"), heeft 201
  beoordelingen met een 4,48, en verkoopt in treden van 89 tot 2.499 dollar. Tweehonderd
  beoordelingen betekent meestal een paar duizend kopers.
- **De marktleider draait in de cloud.** TaskMagic voert automatiseringen uit op hun eigen
  servers. Voor een accountant, advocaat, zorgverlener of overheidsleverancier is dat geen
  ongemak maar een diskwalificatie: die mág dat niet.
- **De reuzen dekken de rest af.** Microsoft geeft browserbesturing voor AI-agents gratis
  weg (@playwright/mcp, 4,8 miljoen downloads per week) en Anthropic heeft 10 miljoen
  installaties. Tegen "ook een AI die je browser bedient" verliezen we per definitie.

Er blijft één plek over die niemand van die drie kan innemen: **het werk gebeurt op de
computer van de gebruiker en de gegevens gaan nergens heen.** Dat is geen marketingzin maar
een afdwingbare stand: `YAD_LOKAAL=1` sluit elke cloudprovider uit, met een test die faalt
als iemand er later toch een toevoegt.

## Naam

**YAD — browserwerk dat je computer niet verlaat**

Niet "AI-agent" in de naam. Dat woord zoekt de doelgroep niet, en het zet ons naast Claude
en Gemini in plaats van ernaast.

## Korte omschrijving (max 132 tekens, dit is wat men in de zoekresultaten ziet)

> Laat terugkerend browserwerk uitvoeren op je eigen computer. Je inloggegevens en je
> schermen gaan nergens heen.

## Volledige omschrijving

*Let op: deze tekst gaat naar mensen. Geen opmaakstreepjes, geen jargon, korte zinnen.*

---

Sommige dingen doe je elke maand opnieuw. Facturen ophalen uit tien verschillende
leveranciersportalen. Dezelfde gegevens overtypen in een systeem zonder koppeling. Bestanden
downloaden en hernoemen. Werk waar geen API voor is, en waar dus ook geen knop voor bestaat.

YAD doet dat werk voor je, in je eigen browser, met je eigen accounts.

Je beschrijft in gewone taal wat er moet gebeuren. YAD kijkt naar de pagina, klikt, typt,
wacht tot iets verschijnt en haalt op wat je nodig hebt. Verandert de site volgende maand,
dan zoekt hij het opnieuw uit in plaats van stuk te gaan.

Wat YAD anders maakt:

Het draait op jouw computer. Niet in onze cloud, niet op een server in Amerika. Zet je de
lokale stand aan, dan wordt er zelfs geen enkel stukje paginatekst naar buiten gestuurd,
want dan gebruikt hij alleen een taalmodel dat bij jou draait. Dat is geen belofte op ons
woord: die stand sluit alle andere verbindingen uit, en faalt zichtbaar als hij het niet
alleen afkan.

Het werkt met je bestaande sessies. Je hoeft nergens een wachtwoord af te staan, want je
bent gewoon al ingelogd in je eigen browser.

Het weigert wat het niet hoort te doen. Klikken op knoppen die betalen, bestellen of
verwijderen gebeurt niet zonder dat jij het bevestigt.

Eerlijk over de grenzen:

Lokaal werken is trager. Op een gewone laptop duurt een denkstap ongeveer vijftien seconden,
tegenover minder dan een seconde met een model in de cloud. Voor werk dat je 's nachts of
tijdens de lunch laat lopen maakt dat niets uit. Voor iets waar je bij zit te wachten wel.
Je kiest zelf welke stand je gebruikt.

YAD omzeilt geen captcha's en geen beveiliging tegen robots. Sites die dat gebruiken,
blijven werk voor een mens.

Voor wie dit gemaakt is:

Voor ondernemers, boekhouders en kantoren die terugkerend werk hebben in systemen zonder
koppeling, en die niet willen of mogen dat hun gegevens bij een derde partij belanden.

---

## Categorie

Werkstroom en planning (Workflow & Planning). Niet "Ontwikkelaarshulpmiddelen", want de
koper is geen ontwikkelaar.

## Nog nodig voordat dit de deur uit kan

1. **Schermafbeeldingen** (1280x800). Minimaal drie: een taak die wordt beschreven, YAD die
   hem uitvoert, en het resultaat. Die moet de koning maken of goedkeuren, want er staan
   echte pagina's op.
2. **Privacyverklaring** met een URL. Chrome eist die bij deze permissies. Er staat al iets
   in `packages/extension/entrypoints/legal/`; dat moet kloppen met wat hierboven beloofd
   wordt, anders is het een valse belofte.
3. **Vijf dollar** eenmalig voor het ontwikkelaarsaccount, plus tweestapsverificatie op het
   Google-account.
4. **Permissies verantwoorden.** Wij vragen `debugger`, `cookies` en `<all_urls>`. Dat is
   veel, en Chrome beoordeelt daar streng op. Voor de inzending moet er per permissie een
   zin klaarliggen die uitlegt waarom hij nodig is.

## Wat ik bewust NIET in de tekst heb gezet

- Geen "AI-agent" en geen "autonoom". Dat belooft meer dan we waarmaken en trekt de
  verkeerde vergelijking.
- Geen aantallen gebruikers of klantverhalen. Die hebben we niet.
- Geen "bespaart u X uur per week". Dat weten we niet en het is precies het soort belofte
  waar een koper later boos over wordt.
