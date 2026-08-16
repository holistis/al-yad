# Invullijst juridische documenten

De privacyverklaring, algemene voorwaarden en het gebruiksbeleid staan klaar in
`packages/extension/public/legal/`, maar er staan nog **96 plaatshouders** in (35 unieke in
de privacyverklaring alleen al). Chrome eist een echte privacyverklaring met een werkende
URL voordat een extensie met deze permissies wordt toegelaten.

**Waarom ik ze niet zelf invul:** hier staan bedrijfsgegevens tussen. Een juridisch document
met een verzonnen KvK-nummer of vestigingsadres is geen concept maar een vervalsing, en het
zou de klant precies dat vertrouwen kosten dat het document moet geven. Dus: dit deel is aan
de koning, de rest doe ik.

---

## Deel 1 — alleen jij weet dit (16 stuks)

Vul in en ik verwerk ze:

| plaatshouder | wat er moet staan | jouw antwoord |
|---|---|---|
| `[RECHTSPERSOON]` | volledige juridische naam | |
| `[KVK]` | KvK-nummer | |
| `[VESTIGINGSADRES]` | straat en nummer | |
| `[VESTIGINGSPLAATS]` | plaats | |
| `[ADRES]` | post- of bezoekadres als dat afwijkt | |
| `[E-MAIL]` | algemeen contactadres | |
| `[PRIVACY-E-MAIL]` | adres voor privacyverzoeken | |
| `[SECURITY-E-MAIL]` | adres voor beveiligingsmeldingen | |
| `[FG-E-MAIL]` | functionaris gegevensbescherming, als je die hebt | |
| `[afdeling/FG]` | wie behandelt privacyverzoeken | |
| `[NAAM VERTEGENWOORDIGER]` | wie tekent namens het bedrijf | |
| `[NAAM HOSTING]` | Hetzner, neem ik aan | |
| `[NAAM LLM-PROVIDER]` | zie hieronder, dit is de lastige | |
| `[NAAM BETAALDIENST]` | Stripe, Mollie, of nog niets | |
| `[NAAM E-MAIL/SUPPORT]` | waar support binnenkomt | |
| `[via e-mail / in de Dienst]` | hoe je wijzigingen meldt | |

### De lastige: welke LLM-provider noem je?

Dit is geen invuloefening maar een keuze die je product raakt. YAD kan nu in twee standen
werken en de verklaring moet dat eerlijk beschrijven:

- **Standaard**: paginatekst gaat naar een taalmodel in de cloud. Op dit moment zijn dat
  Gemini, Groq, Cerebras, OpenRouter, Together en Mistral, in die volgorde. Die moet je dan
  allemaal noemen als subverwerker, met hun vestigingsland en doorgifte-waarborg.
- **Lokale stand** (`YAD_LOKAAL=1`): er gaat helemaal niets naar buiten.

Mijn advies: verkoop alleen de lokale stand aan zakelijke klanten, en noem de cloudstand
apart als optie die de klant zelf moet aanzetten. Dan is de lijst subverwerkers kort en de
verklaring eerlijk. Zes Amerikaanse partijen opsommen in een privacyverklaring kost je
precies de klant die je zoekt.

---

## Deel 2 — dit vul ik in zodra jij deel 1 hebt (34 stuks)

Termijnen, versienummers, rechtbank en dergelijke. Mijn voorstellen, pas ze aan als je iets
anders wilt:

| plaatshouder | mijn voorstel | waarom |
|---|---|---|
| `[VERSIE]` / `[DATUM]` | 1.0 / de dag van publicatie | |
| `[ARRONDISSEMENT/RECHTBANK]` | rechtbank van je vestigingsplaats | standaard en goedkoopst voor jou |
| `[DATALEK-TERMIJN]` | 48 uur | strenger dan de wet (72 uur), goed signaal |
| `[EXIT-TERMIJN]` | 30 dagen | gebruikelijk |
| `[OPZEGTERMIJN]` | 1 maand | laagdrempelig, past bij een klein product |
| `[TERMIJN bewaartermijn logs]` | 12 maanden | genoeg voor onderzoek, niet meer |
| `[EU/EER-regio]` | Duitsland (Hetzner) | dat is waar de server staat |
| `[Nee]` bij verkoop van data | Nee | en dat blijft zo |
| `[KLACHTTERMIJN]` | 30 dagen | |
| `[URL]` / `[PRIVACY-URL]` | volgt zodra de pagina online staat | |

---

## Wat er daarna nog nodig is voor de winkel

1. Schermafbeeldingen, 1280x800, minimaal drie. Die moet jij maken of goedkeuren, want er
   staan echte pagina's op.
2. Vijf dollar eenmalig voor het ontwikkelaarsaccount, met tweestapsverificatie aan.
3. Een zin per permissie waarom hij nodig is. Wij vragen `debugger`, `cookies` en
   `<all_urls>`, en daar wordt streng op beoordeeld. Die zinnen schrijf ik.

Zie `winkelpagina-concept.md` voor de teksten zelf.
