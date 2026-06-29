> **CONCEPT — AI-onderzocht, GEEN juridisch advies.** Dit document is een door AI opgesteld concept ten behoeve van interne voorbereiding. Het is **geen** juridisch advies en biedt geen garantie op juridische juistheid, volledigheid of afdwingbaarheid. Laat dit document vóór gebruik controleren en vaststellen door een **gekwalificeerd jurist**. Plaatshouders in [BLOKHAKEN] dienen door [RECHTSPERSOON] realistisch en waarheidsgetrouw te worden ingevuld; beloof niets dat niet daadwerkelijk waargemaakt kan worden.

# Service Level Agreement (Serviceniveau-overeenkomst) — Yad

**Product:** Yad — browser-automatiseringsagent (B2B SaaS)
**Aanbieder:** [RECHTSPERSOON], gevestigd te [VESTIGINGSPLAATS], ingeschreven bij de Kamer van Koophandel onder nummer [KVK-NUMMER] ("Yad", "wij", "ons")
**Toepasselijk op:** de beheerde EU-hosting deploymodus en het beheer-/onderhoudsabonnement
**Versie:** [VERSIE] — **Datum:** [DATUM]
**Contact service & support:** [SUPPORT-E-MAIL] — **Escalatie:** [ESCALATIE-E-MAIL]

---

## 1. Inleiding en samenhang met de Algemene Voorwaarden

1.1 Deze Service Level Agreement ("SLA") beschrijft de serviceniveaus, beschikbaarheidsdoelen, reactie- en hersteltijden en onderhoudsverplichtingen die [RECHTSPERSOON] hanteert voor het SaaS-product Yad in de beheerde EU-hosting deploymodus, voor klanten met een actief beheer-/onderhoudsabonnement.

1.2 Deze SLA is een aanvulling op en onlosmakelijk verbonden met de Algemene Voorwaarden van [RECHTSPERSOON] (de "AV"). Begrippen die in deze SLA met een hoofdletter worden gebruikt en hier niet zijn gedefinieerd, hebben de betekenis die de AV daaraan geeft.

1.3 Bij strijdigheid tussen deze SLA en de AV prevaleert de AV, tenzij de SLA voor een specifiek onderwerp uitdrukkelijk een afwijkende, meer specifieke regeling bevat; in dat geval geldt de SLA uitsluitend voor dat specifieke onderwerp.

1.4 Deze SLA geldt alleen voor de beheerde EU-hosting die door of namens [RECHTSPERSOON] wordt geleverd. Voor zelf-gehoste of door de klant beheerde installaties (self-hosted / on-premise) gelden de beschikbaarheids- en hersteltoezeggingen van deze SLA **niet**; daarvoor gelden uitsluitend de bepalingen uit de AV en eventuele afzonderlijke afspraken.

## 2. Definities

2.1 **Platform** — de door [RECHTSPERSOON] beheerde Yad-omgeving, gehost binnen de Europese Unie, waarmee de Klant browser-automatiseringen ("Workflows") configureert en uitvoert.

2.2 **Workflow** — een door of voor de Klant ingerichte geautomatiseerde browser-taak die handelt op één of meer externe doelsystemen ("Doelsystemen").

2.3 **Doelsysteem** — een website, webapplicatie of dienst van een derde partij waarop een Workflow handelt en waarover [RECHTSPERSOON] geen zeggenschap heeft.

2.4 **Platform-beschikbaarheid** — de mate waarin het Platform bereikbaar is en Workflows kan accepteren, plannen en starten. Dit is meetbaar en valt onder de uptime-doelstelling van artikel 5.

2.5 **Taak-slaagkans** — de mate waarin een individuele Workflow-uitvoering het beoogde resultaat op een Doelsysteem bereikt. Dit is **geen** gegarandeerd serviceniveau, maar een inspanningsverplichting (zie artikel 4 en 9).

2.6 **Servicevenster** — de tijden waarbinnen support en menselijke afhandeling beschikbaar zijn, zoals omschreven in artikel 3.

2.7 **Incident** — een door de Klant gemelde of door [RECHTSPERSOON] vastgestelde verstoring waarbij het Platform of een Workflow niet of niet juist functioneert binnen de reikwijdte van deze SLA.

2.8 **Prioriteit / Severity** — de classificatie van een Incident naar zwaarte, zoals omschreven in artikel 6.

2.9 **Reactietijd** — de tijd tussen ontvangst van een geldige melding via een erkend support-kanaal en de eerste inhoudelijke, menselijke reactie van [RECHTSPERSOON].

2.10 **Hersteltijd / Oplostijd** — de tijd tussen ontvangst van een geldige melding en het herstel van de dienst tot een werkende staat, of de levering van een werkbare tijdelijke oplossing (workaround).

2.11 **Site-wijziging** — een wijziging aan een Doelsysteem (bijvoorbeeld in lay-out, structuur, beveiliging, anti-bot-maatregelen of toegangsbeleid) die ertoe leidt dat een eerder werkende Workflow breekt.

2.12 **Zelfherstel** — de geautomatiseerde mechanismen waarmee het Platform een gebroken Workflow tracht te detecteren en aan te passen aan een Site-wijziging, zonder menselijke tussenkomst.

2.13 **Gepland Onderhoud** — vooraf aangekondigd onderhoud aan het Platform, zoals omschreven in artikel 13.

2.14 **Service Credit** — een tegoed of restitutie die als redelijke en transparante vergoeding wordt toegekend wanneer een toegezegd serviceniveau niet wordt gehaald, zoals omschreven in artikel 11.

2.15 **Meetperiode** — een aaneengesloten kalendermaand, tenzij schriftelijk anders overeengekomen.

2.16 **Pakket** — het door de Klant afgenomen serviceniveau: **Business**, **Done-for-you** of **Enterprise**, zoals vastgelegd in de bestelbevestiging of order.

## 3. Servicetijden en support-kanalen

3.1 **Erkende support-kanalen.** Meldingen worden uitsluitend in behandeling genomen wanneer zij via een erkend kanaal binnenkomen:
- E-mail / ticket: [SUPPORT-E-MAIL]
- Klantenportaal / dashboard: [PORTAAL-URL]
- (Enterprise) toegewezen kanaal: [ENTERPRISE-KANAAL]

3.2 **Servicevenster per Pakket.**

| Pakket | Servicevenster support | Tijdzone |
|--------|------------------------|----------|
| Business | [werkdagen, bv. ma–vr [STARTTIJD]–[EINDTIJD]] | [TIJDZONE, bv. CET/CEST] |
| Done-for-you | [werkdagen + uitgebreid venster, PLAATSHOUDER] | [TIJDZONE] |
| Enterprise | [uitgebreid venster, eventueel 24/7 voor severity 1, PLAATSHOUDER] | [TIJDZONE] |

3.3 Meldingen die buiten het Servicevenster binnenkomen, worden geacht te zijn ontvangen bij aanvang van het eerstvolgende Servicevenster, tenzij voor het betreffende Pakket en de betreffende severity uitdrukkelijk een ruimer venster geldt.

3.4 **Geautomatiseerde monitoring** van het Platform vindt doorlopend plaats; geautomatiseerd detecteren en zelfherstel staan los van het Servicevenster voor menselijke support.

## 4. Reikwijdte: platform-beschikbaarheid versus taak-slaagkans

4.1 Browser-automatisering is naar haar aard **niet 100% betrouwbaar**. Doelsystemen veranderen, kunnen tijdelijk onbereikbaar zijn, kunnen anti-bot-maatregelen inzetten of kunnen geautomatiseerde toegang weigeren. [RECHTSPERSOON] doet hierover **geen** garantie-uitspraak per individuele taak.

4.2 [RECHTSPERSOON] maakt een uitdrukkelijk onderscheid tussen twee soorten toezeggingen:

(a) **Platform-beschikbaarheid (resultaatsgerichte toezegging, meetbaar).** De beschikbaarheid van het Platform zelf valt onder de uptime-doelstelling van artikel 5.

(b) **Taak-slaagkans (inspanningsverplichting, geen garantie).** Voor het succesvol uitvoeren van individuele Workflows op Doelsystemen geldt een **inspanningsverplichting**: [RECHTSPERSOON] spant zich naar redelijkheid in om Workflows werkend te houden en te herstellen (artikel 7), maar **garandeert geen slaagpercentage per taak** en geen specifieke uitkomst op een Doelsysteem.

4.3 Geen enkele bepaling in deze SLA mag worden uitgelegd als een garantie dat een Workflow op een Doelsysteem altijd, foutloos of binnen een vaste tijd zal slagen.

## 5. Beschikbaarheid / uptime-doel (beheerde hosting)

5.1 **Uptime-doel.** [RECHTSPERSOON] streeft per Meetperiode naar de volgende Platform-beschikbaarheid:

| Pakket | Uptime-doel per Meetperiode |
|--------|------------------------------|
| Business | [PLAATSHOUDER, bv. 99,[x]%] |
| Done-for-you | [PLAATSHOUDER, bv. 99,[x]%] |
| Enterprise | [PLAATSHOUDER, bv. 99,[x]%] |

5.2 **Meetmethode.** De beschikbaarheid wordt berekend als:

> Beschikbaarheid (%) = ( (Totale minuten in Meetperiode − Telende Downtime-minuten) / Totale minuten in Meetperiode ) × 100

waarbij "Telende Downtime-minuten" de minuten zijn waarin het Platform aantoonbaar niet bereikbaar was om Workflows te accepteren of te starten, zoals vastgesteld door de monitoring van [RECHTSPERSOON]. De meetgegevens van [RECHTSPERSOON] zijn leidend, behoudens aantoonbare onjuistheid.

5.3 **Wat NIET meetelt als Downtime.** De volgende perioden en oorzaken tellen **niet** mee als Telende Downtime en zijn uitgesloten van de uptime-berekening:

(a) **Gepland Onderhoud** dat conform artikel 13 is aangekondigd;
(b) **Overmacht** zoals omschreven in de AV (waaronder stroom- en netwerkstoringen buiten de invloedssfeer van [RECHTSPERSOON], DDoS-aanvallen, calamiteiten);
(c) storingen of fouten die **bij de Klant** ontstaan (waaronder onjuiste configuratie door de Klant, onjuiste of verlopen inloggegevens/credentials voor Doelsystemen, ongeldige invoer, overschrijding van afgesproken volumes/limieten);
(d) storingen, wijzigingen, onbereikbaarheid, blokkades of beleidswijzigingen **bij Doelsystemen of andere derde partijen** (waaronder Site-wijzigingen, anti-bot-maatregelen, rate-limiting en account-blokkades aan de zijde van het Doelsysteem);
(e) onderbrekingen veroorzaakt door een opschorting of beëindiging conform de AV (bijvoorbeeld wegens wanbetaling of misbruik);
(f) gebruik van het Platform in strijd met de AV, deze SLA of redelijke instructies van [RECHTSPERSOON].

5.4 De uptime-doelstelling betreft uitsluitend de **Platform-beschikbaarheid** (artikel 4.2 sub a) en **niet** de Taak-slaagkans (artikel 4.2 sub b).

## 6. Prioriteitsindeling (severity)

6.1 Incidenten worden ingedeeld in de volgende prioriteiten. [RECHTSPERSOON] stelt de classificatie in redelijkheid vast; de Klant kan gemotiveerd om herclassificatie verzoeken.

| Severity | Omschrijving |
|----------|--------------|
| **S1 — Kritiek** | Het Platform is volledig onbereikbaar of een bedrijfskritische functie voor (vrijwel) alle Workflows van de Klant is uitgevallen; geen werkbare workaround. |
| **S2 — Hoog** | Belangrijke functionaliteit is ernstig verstoord of meerdere Workflows zijn gebroken; beperkte of omslachtige workaround beschikbaar. |
| **S3 — Gemiddeld** | Eén of enkele Workflows functioneren niet juist, of een functie werkt gedeeltelijk niet; bedrijfsvoering van de Klant grotendeels door te zetten. |
| **S4 — Laag** | Kleine afwijking, cosmetisch probleem, vraag of verzoek om informatie; geen directe impact op de bedrijfsvoering. |

6.2 Een gebroken Workflow als gevolg van een Site-wijziging wordt naar impact ingedeeld (doorgaans S2 of S3) en behandeld volgens het onderhoudsproces van artikel 8.

## 7. Reactie- en hersteltijden per prioriteit en Pakket

7.1 De onderstaande tijden gelden binnen het van toepassing zijnde Servicevenster (artikel 3) en gaan in vanaf ontvangst van een geldige melding via een erkend kanaal.

7.2 **Reactietijden (eerste inhoudelijke menselijke reactie).**

| Severity | Business | Done-for-you | Enterprise |
|----------|----------|--------------|------------|
| S1 | [PLAATSHOUDER] | [PLAATSHOUDER] | [PLAATSHOUDER] |
| S2 | [PLAATSHOUDER] | [PLAATSHOUDER] | [PLAATSHOUDER] |
| S3 | [PLAATSHOUDER] | [PLAATSHOUDER] | [PLAATSHOUDER] |
| S4 | [PLAATSHOUDER] | [PLAATSHOUDER] | [PLAATSHOUDER] |

7.3 **Streef-hersteltijden / doorlooptijd tot werkbare oplossing.** Dit zijn **streeftijden** (inspanningsverplichting), geen gegarandeerde maximale oplostijden, omdat herstel mede afhankelijk kan zijn van Doelsystemen en derden.

| Severity | Business | Done-for-you | Enterprise |
|----------|----------|--------------|------------|
| S1 | [PLAATSHOUDER] | [PLAATSHOUDER] | [PLAATSHOUDER] |
| S2 | [PLAATSHOUDER] | [PLAATSHOUDER] | [PLAATSHOUDER] |
| S3 | [PLAATSHOUDER] | [PLAATSHOUDER] | [PLAATSHOUDER] |
| S4 | [PLAATSHOUDER] | [PLAATSHOUDER] | [PLAATSHOUDER] |

7.4 Wanneer herstel binnen de invloedssfeer van [RECHTSPERSOON] niet mogelijk is omdat de oorzaak bij een Doelsysteem of derde ligt, vervalt de streef-hersteltijd voor dat Incident en geldt uitsluitend de inspanningsverplichting van artikel 9. [RECHTSPERSOON] informeert de Klant hierover.

## 8. Onderhoud van Workflows (kern van het beheerabonnement)

8.1 Het beheer-/onderhoudsabonnement houdt in dat [RECHTSPERSOON] zich er als doorlopende dienst voor inspant om de Workflows van de Klant **werkend te houden** wanneer Doelsystemen wijzigen. Dit is de kern van de terugkerende dienst en wordt langs twee sporen geleverd:

8.2 **Spoor 1 — Zelfherstel (geautomatiseerd).** Het Platform tracht Site-wijzigingen geautomatiseerd te detecteren en Workflows daaraan aan te passen, waar mogelijk zonder onderbreking en zonder menselijke tussenkomst. Zelfherstel is een inspanningsmechanisme en slaagt niet bij elke wijziging.

8.3 **Spoor 2 — Handmatige fix bij breuk.** Wanneer Zelfherstel een door een Site-wijziging gebroken Workflow niet kan herstellen, neemt [RECHTSPERSOON] de handmatige reparatie ter hand binnen het Servicevenster en de toepasselijke streef-doorlooptijd:

| Pakket | Streef-doorlooptijd handmatige fix na breuk door Site-wijziging |
|--------|----------------------------------------------------------------|
| Business | [PLAATSHOUDER, bv. binnen [x] werkdagen] |
| Done-for-you | [PLAATSHOUDER] |
| Enterprise | [PLAATSHOUDER] |

8.4 De in artikel 8.3 genoemde doorlooptijden zijn **realistische streeftijden** en geen garanties. De daadwerkelijke doorlooptijd is mede afhankelijk van de aard en complexiteit van de Site-wijziging, de mate waarin het Doelsysteem geautomatiseerde toegang nog toelaat, en de medewerking en informatieverstrekking door de Klant (bijvoorbeeld geldige toegang en testgegevens).

8.5 [RECHTSPERSOON] is niet gehouden tot herstel wanneer een Doelsysteem geautomatiseerde toegang structureel onmogelijk maakt of verbiedt, of wanneer herstel alleen mogelijk zou zijn door de AV, deze SLA, de gebruiksvoorwaarden van het Doelsysteem of toepasselijke wet- en regelgeving te schenden. In dat geval treedt [RECHTSPERSOON] met de Klant in overleg over alternatieven; een dergelijke situatie geldt niet als tekortkoming onder deze SLA.

8.6 Onderhoud aan een Workflow dat voortvloeit uit een **gewijzigde wens van de Klant** (nieuwe functionaliteit, ander Doelsysteem, uitbreiding van scope) valt niet onder dit reguliere onderhoud, maar geldt als nieuw werk volgens de AV of een afzonderlijke afspraak.

## 9. Taak-slaagkans als inspanningsverplichting

9.1 Voor het feitelijk slagen van individuele Workflow-uitvoeringen op Doelsystemen geldt een **inspanningsverplichting** en uitdrukkelijk **geen** resultaatsgarantie (zie artikel 4).

9.2 [RECHTSPERSOON] spant zich naar redelijkheid in om een goede en stabiele Taak-slaagkans te realiseren, onder meer door monitoring, Zelfherstel en onderhoud. [RECHTSPERSOON] kan, ter informatie en zonder dat dit een toezegging vormt, periodiek een indicatieve slaagstatistiek rapporteren (artikel 12).

9.3 Tijdelijke daling van de Taak-slaagkans door oorzaken buiten de invloedssfeer van [RECHTSPERSOON] (zoals Site-wijzigingen, anti-bot-maatregelen, onbereikbaarheid of beleidswijzigingen bij Doelsystemen) geldt niet als tekortkoming en geeft geen recht op Service Credits.

## 10. Uitsluitingen

10.1 De toezeggingen in deze SLA gelden **niet** voor, en [RECHTSPERSOON] is niet aansprakelijk uit hoofde van deze SLA voor, situaties die geheel of gedeeltelijk het gevolg zijn van:

(a) **Account-blokkades, account-bans, schorsingen of toegangsweigeringen** bij Doelsystemen, en **schendingen van de gebruiksvoorwaarden (Terms of Service) van Doelsystemen of andere derde partijen**. Het beoordelen of geautomatiseerd gebruik van een Doelsysteem is toegestaan en het dragen van de gevolgen van eventuele blokkades of bans, is en blijft de **verantwoordelijkheid van de Klant**. De Klant vrijwaart [RECHTSPERSOON] hiervoor conform de AV.

(b) Wijzigingen, storingen, onbereikbaarheid, rate-limiting, anti-bot-maatregelen of beleidswijzigingen bij Doelsystemen of andere derde partijen;

(c) Onjuist, onrechtmatig of met de AV strijdig gebruik van het Platform door de Klant of door personen aan wie de Klant toegang heeft verleend;

(d) Onjuiste configuratie, onjuiste of verlopen credentials, ongeldige invoer of het niet (tijdig) verstrekken van benodigde informatie of medewerking door de Klant;

(e) Overmacht zoals omschreven in de AV;

(f) Gepland Onderhoud conform artikel 13, en aangekondigd noodonderhoud;

(g) Software, hardware, netwerken, browsers, extensies of diensten van derden die buiten het beheer van [RECHTSPERSOON] vallen;

(h) Opschorting of beëindiging op grond van de AV.

10.2 De Klant is zelf verantwoordelijk voor het rechtmatig en toelaatbaar gebruik van Yad ten opzichte van elk Doelsysteem, waaronder naleving van de gebruiksvoorwaarden van dat Doelsysteem en van toepasselijke wet- en regelgeving.

## 11. Service Credits

11.1 **Karakter.** Wanneer [RECHTSPERSOON] in een Meetperiode het toegezegde **uptime-doel voor de Platform-beschikbaarheid** (artikel 5) aantoonbaar niet haalt, kan de Klant aanspraak maken op een **Service Credit**. Een Service Credit is een eerlijke, transparante en redelijke vergoeding voor niet-geleverde beschikbaarheid. Het is **geen boete, geen rente en geen schadevergoeding**, maar een verrekening of (gedeeltelijke) teruggave die in verhouding staat tot de gemiste dienst.

11.2 **Waarop van toepassing.** Service Credits gelden uitsluitend voor het niet-halen van het meetbare uptime-doel (artikel 5). Op de Taak-slaagkans (artikel 9), op uitgesloten oorzaken (artikel 10) en op streef-hersteltijden (artikel 7.3) en streef-doorlooptijden (artikel 8.3) zijn **geen** Service Credits van toepassing.

11.3 **Staffel (indicatief, in te vullen).** De Service Credit wordt uitgedrukt als percentage van de maandelijkse abonnementsvergoeding voor de betreffende beheerde dienst over de betreffende Meetperiode:

| Behaalde beschikbaarheid in Meetperiode | Service Credit (% van maandvergoeding) |
|-----------------------------------------|----------------------------------------|
| onder doel, maar ≥ [PLAATSHOUDER]% | [PLAATSHOUDER]% |
| ≥ [PLAATSHOUDER]% en < [PLAATSHOUDER]% | [PLAATSHOUDER]% |
| < [PLAATSHOUDER]% | [PLAATSHOUDER]% |

11.4 **Aanvraag.** De Klant dient een Service Credit schriftelijk en gemotiveerd aan te vragen via [SUPPORT-E-MAIL] binnen [PLAATSHOUDER, bv. 30] dagen na afloop van de betreffende Meetperiode. Aanvragen na deze termijn komen te vervallen.

11.5 **Maximum (cap).** De totale Service Credits per Meetperiode bedragen **ten hoogste [PLAATSHOUDER, bv. 100]% van de maandelijkse abonnementsvergoeding** voor de betreffende beheerde dienst over die Meetperiode. Service Credits worden niet uitgekeerd in contanten, tenzij schriftelijk anders overeengekomen, en worden bij voorkeur verrekend met een toekomstige factuur.

11.6 **Exclusiviteit.** De Service Credit is het **enige en uitsluitende verhaal** (sole remedy) van de Klant voor het niet-halen van het uptime-doel, behoudens dwingend recht en behoudens hetgeen de AV daarover bepalen.

11.7 Geen Service Credit is verschuldigd zolang de Klant openstaande, opeisbare facturen voor de betreffende dienst onbetaald laat.

## 12. Rapportage

12.1 [RECHTSPERSOON] stelt, ten minste voor de Pakketten waarvoor dit is overeengekomen, periodiek (ten minste [PLAATSHOUDER, bv. per maand]) rapportage beschikbaar over:

(a) de gerealiseerde Platform-beschikbaarheid over de Meetperiode;
(b) geregistreerde Incidenten en hun status/afhandeling;
(c) uitgevoerd onderhoud aan Workflows (Zelfherstel en handmatige fixes), op hoofdlijnen;
(d) een indicatieve, niet-bindende slaagstatistiek van Workflows (artikel 9.2), waar van toepassing.

12.2 Rapportage wordt aangeboden via [PORTAAL-URL] of per e-mail aan het bij [RECHTSPERSOON] bekende contact van de Klant.

12.3 De meetgegevens en monitoring van [RECHTSPERSOON] zijn leidend voor de vaststelling van serviceniveaus, behoudens aantoonbare onjuistheid.

## 13. Gepland Onderhoud en meldingen

13.1 [RECHTSPERSOON] voert periodiek Gepland Onderhoud uit om het Platform veilig, actueel en betrouwbaar te houden. Gepland Onderhoud wordt waar mogelijk uitgevoerd buiten de drukste gebruiksuren.

13.2 **Aankondiging.** Gepland Onderhoud met verwachte impact op de beschikbaarheid wordt ten minste [PLAATSHOUDER, bv. [x] werkdagen / [x] uur] van tevoren aangekondigd via [AANKONDIGINGSKANAAL, bv. e-mail / statuspagina / portaal].

13.3 **Onderhoudsvenster.** Waar mogelijk vindt Gepland Onderhoud plaats binnen een vast onderhoudsvenster: [PLAATSHOUDER, bv. dag/tijd/tijdzone].

13.4 **Noodonderhoud.** In geval van een acute beveiligings- of stabiliteitsdreiging mag [RECHTSPERSOON] noodonderhoud uitvoeren zonder de in artikel 13.2 genoemde aankondigingstermijn. [RECHTSPERSOON] informeert de Klant in dat geval zo spoedig als redelijkerwijs mogelijk.

13.5 Gepland Onderhoud en aangekondigd noodonderhoud tellen niet mee als Downtime (artikel 5.3 sub a).

## 14. Escalatie

14.1 Wanneer de Klant van mening is dat een Incident onvoldoende voortvarend of niet conform deze SLA wordt afgehandeld, kan de Klant escaleren via [ESCALATIE-E-MAIL].

14.2 **Escalatieniveaus (indicatief).**

| Niveau | Contact | Reageert binnen |
|--------|---------|-----------------|
| 1 — Support | [SUPPORT-E-MAIL] | volgens artikel 7 |
| 2 — Service-/Accountverantwoordelijke | [PLAATSHOUDER] | [PLAATSHOUDER] |
| 3 — [Directie / verantwoordelijke functie] | [PLAATSHOUDER] | [PLAATSHOUDER] |

14.3 Bij een S1-Incident mag de Klant direct op niveau 2 escaleren. Partijen spannen zich in om escalaties in goed overleg en te goeder trouw op te lossen.

## 15. Verplichtingen en medewerking van de Klant

15.1 Een goede uitvoering van deze SLA vereist tijdige medewerking van de Klant. De Klant:

(a) meldt Incidenten tijdig en zo volledig mogelijk via een erkend kanaal (artikel 3.1), met reproductiestappen waar mogelijk;
(b) verstrekt geldige en actuele toegang, credentials en testgegevens die nodig zijn voor onderhoud en herstel;
(c) zorgt dat het gebruik van Yad ten opzichte van elk Doelsysteem rechtmatig en toelaatbaar is (artikel 10.2);
(d) houdt zich aan de AV, deze SLA en redelijke instructies van [RECHTSPERSOON].

15.2 Vertraging die ontstaat doordat de Klant niet, niet tijdig of onvoldoende meewerkt, schort de toepasselijke reactie-, herstel- en doorlooptijden op voor de duur van die vertraging en geldt niet als tekortkoming van [RECHTSPERSOON].

## 16. Wijziging van de SLA

16.1 [RECHTSPERSOON] mag deze SLA van tijd tot tijd wijzigen, bijvoorbeeld om serviceniveaus te verduidelijken, te verbeteren of aan te passen aan gewijzigde technische of juridische omstandigheden.

16.2 Een wijziging wordt ten minste [PLAATSHOUDER, bv. 30] dagen vóór inwerkingtreding aangekondigd via [AANKONDIGINGSKANAAL]. Wijzigingen die de serviceniveaus voor de Klant **wezenlijk nadelig** veranderen, geven de Klant het recht de betreffende dienst op te zeggen tegen de datum van inwerkingtreding, conform de opzegregeling in de AV.

16.3 Wijzigingen die geen wezenlijk nadeel voor de Klant meebrengen (zoals tekstuele verduidelijkingen, verbeteringen of wettelijk verplichte aanpassingen) mogen zonder opzegrecht worden doorgevoerd.

16.4 Het van toepassing zijnde versienummer en de ingangsdatum staan bovenaan dit document vermeld.

## 17. Looptijd en samenhang

17.1 Deze SLA geldt zolang de Klant een actief beheer-/onderhoudsabonnement op de beheerde EU-hosting van Yad heeft en loopt mee met de looptijd en opzegging van de onderliggende overeenkomst conform de AV.

17.2 Bij beëindiging van het abonnement vervallen de toezeggingen uit deze SLA, onverminderd reeds ontstane en nog niet afgewikkelde aanspraken (zoals een vóór beëindiging correct aangevraagde Service Credit).

## 18. Toepasselijk recht en geschillen

18.1 Op deze SLA is **Nederlands recht** van toepassing. Geschillen worden beslecht conform de geschillenregeling in de AV.

---

> **Slotnotitie (CONCEPT).** Dit is een AI-onderzocht concept en **geen juridisch advies**. Controleer met name: (i) de samenhang en kruisverwijzingen met de daadwerkelijke Algemene Voorwaarden (waaronder aansprakelijkheid, overmacht, vrijwaring en opzegging); (ii) of de toezeggingen in artikel 5, 7 en 8 daadwerkelijk operationeel waargemaakt kunnen worden vóórdat ze worden vastgelegd (geen loze beloften); (iii) de invulling van alle [PLAATSHOUDERS] met realistische, haalbare waarden; (iv) de juridische houdbaarheid van de Service-Credit-staffel en de cap onder Nederlands recht. Laat dit document vóór gebruik vaststellen door een **gekwalificeerd jurist**.
