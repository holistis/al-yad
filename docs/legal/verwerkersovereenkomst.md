> **⚠️ BELANGRIJKE NOTITIE — DIT IS EEN AI-ONDERZOCHT CONCEPT**
>
> Dit document is opgesteld met behulp van AI op basis van onderzoek naar Nederlands en EU-recht (AVG/GDPR, BW Boek 6) en marktstandaarden. **Het is een CONCEPT en GEEN juridisch advies.** Vóór gebruik in de praktijk moet dit document worden gecontroleerd, aangevuld en goedgekeurd door een gekwalificeerd jurist (bij voorkeur gespecialiseerd in IT-/privacyrecht). Plaatshouders tussen `[VIERKANTE HAKEN]` moeten worden ingevuld. Wet- en regelgeving (o.a. EU AI Act-deadlines, status EU-US Data Privacy Framework via zaak C-703/25 P, SCC-modellen) is in beweging; verifieer de actuele stand vóór ondertekening. Met name de **rolkwalificatie van de taalmodel-verwerking (Artikel 3 en Bijlage 1)** vergt uitdrukkelijk juridische toetsing.
>
> Versie: `[VERSIE]` — Datum: `[DATUM]`

---

# VERWERKERSOVEREENKOMST (DATA PROCESSING AGREEMENT)

## conform artikel 28 van de Algemene Verordening Gegevensbescherming (AVG / Verordening (EU) 2016/679)

---

## DE ONDERGETEKENDEN

**1. De Verwerkingsverantwoordelijke**

`[RECHTSPERSOON KLANT]`, gevestigd te `[VESTIGINGSPLAATS KLANT]`, kantoorhoudende aan `[ADRES KLANT]`, ingeschreven in het handelsregister van de Kamer van Koophandel onder nummer `[KVK KLANT]`, rechtsgeldig vertegenwoordigd door `[NAAM + FUNCTIE TEKENBEVOEGDE]`,

hierna te noemen: **"Verwerkingsverantwoordelijke"** of **"Klant"**;

**en**

**2. De Verwerker**

`[RECHTSPERSOON YAD]`, gevestigd te `[VESTIGINGSPLAATS]`, kantoorhoudende aan `[ADRES]`, ingeschreven in het handelsregister van de Kamer van Koophandel onder nummer `[KVK]`, rechtsgeldig vertegenwoordigd door `[NAAM + FUNCTIE TEKENBEVOEGDE]`,

hierna te noemen: **"Verwerker"** of **"Yad"**;

Verwerkingsverantwoordelijke en Verwerker hierna gezamenlijk te noemen: **"Partijen"** en ieder afzonderlijk een **"Partij"**.

---

## OVERWEGENDE DAT

A. Partijen een overeenkomst hebben gesloten of zullen sluiten met betrekking tot het gebruik door Klant van de dienst Yad, een browser-automatiseringsagent die handelingen verricht binnen de ingelogde (browser)sessie van Klant en daarbij persoonsgegevens kan verwerken (hierna: de **"Hoofdovereenkomst"**);

B. Yad bij de uitvoering van de Hoofdovereenkomst persoonsgegevens verwerkt ten behoeve van Klant; dat Yad ten aanzien van de uitvoering van de door Klant gedefinieerde automatiseringstaken kwalificeert als **verwerker** in de zin van artikel 4 lid 8 AVG, terwijl Klant ten aanzien van die verwerkingen kwalificeert als **verwerkingsverantwoordelijke** in de zin van artikel 4 lid 7 AVG; dat de precieze rolverdeling per verwerkingsstroom is uitgewerkt in **Bijlage 1**;

C. Partijen op grond van artikel 28 lid 3 AVG verplicht zijn de verwerking van persoonsgegevens door Yad schriftelijk (waaronder elektronisch) vast te leggen;

D. de dienst Yad handelt binnen de live, reeds ingelogde sessie van Klant en daardoor — naast persoonsgegevens van Klant zelf — ook persoonsgegevens van **derden (waaronder klanten en relaties van Klant)** kan raken via de inhoud van webpagina's (de DOM), hetgeen bijzondere afbakening van de verwerking vereist;

E. Yad bij de uitvoering van de automatiseringstaken gebruikmaakt van taalmodellen (LLM's) en hostingdiensten die feitelijke pagina-inhoud — en daarmee persoonsgegevens — te zien kunnen krijgen, en dat Partijen de daaraan verbonden risico's (waaronder internationale doorgifte en de rolverdeling) in deze Verwerkersovereenkomst en de Bijlagen uitdrukkelijk hebben willen regelen;

F. Partijen met deze verwerkersovereenkomst (hierna: de **"Verwerkersovereenkomst"** of **"DPA"**) uitvoering geven aan deze wettelijke verplichtingen en de afspraken omtrent de verwerking van persoonsgegevens vastleggen;

verklaren te zijn overeengekomen als volgt:

---

## ARTIKEL 1 — DEFINITIES

1.1 De in deze Verwerkersovereenkomst met een hoofdletter geschreven begrippen hebben de betekenis die daaraan in de AVG wordt toegekend, tenzij hieronder anders bepaald.

1.2 In aanvulling daarop wordt verstaan onder:

a. **"AVG"**: Verordening (EU) 2016/679 van het Europees Parlement en de Raad (Algemene Verordening Gegevensbescherming), alsmede de Nederlandse Uitvoeringswet AVG (UAVG) en overige toepasselijke privacywetgeving.

b. **"Persoonsgegevens"**: alle gegevens in de zin van artikel 4 lid 1 AVG die Verwerker in het kader van de Hoofdovereenkomst ten behoeve van Verwerkingsverantwoordelijke verwerkt, zoals nader omschreven in **Bijlage 1**.

c. **"Verwerking"**: een bewerking of geheel van bewerkingen als bedoeld in artikel 4 lid 2 AVG.

d. **"Betrokkene"**: de geïdentificeerde of identificeerbare natuurlijke persoon op wie een Persoonsgegeven betrekking heeft, waaronder uitdrukkelijk begrepen **derden-betrokkenen** (klanten, relaties of eindgebruikers van Verwerkingsverantwoordelijke) wier gegevens via de sessie van Klant in beeld komen.

e. **"Subverwerker"**: een door Verwerker ingeschakelde andere verwerker die in opdracht en onder verantwoordelijkheid van Verwerker Persoonsgegevens verwerkt (waaronder hosting- en LLM-/taalmodel-leveranciers), zoals opgenomen in **Bijlage 3**.

f. **"Datalek"**: een inbreuk op de beveiliging in de zin van artikel 4 lid 12 AVG die per ongeluk of op onrechtmatige wijze leidt tot de vernietiging, het verlies, de wijziging, de ongeoorloofde verstrekking van of de ongeoorloofde toegang tot doorgezonden, opgeslagen of anderszins verwerkte Persoonsgegevens.

g. **"Sessie-artefacten"**: door de werking van Yad gegenereerde of tijdelijk verwerkte gegevens, waaronder DOM-fragmenten, schermafbeeldingen, sessielogs, prompts en outputs van taalmodellen, en sessietokens/cookies.

h. **"TOMs"**: de technische en organisatorische maatregelen als bedoeld in artikel 32 AVG, zoals beschreven in **Bijlage 2**.

i. **"EER"**: de Europese Economische Ruimte.

j. **"SCC's"**: de door de Europese Commissie bij Uitvoeringsbesluit (EU) 2021/914 vastgestelde Standaard Contractuele Clausules voor de doorgifte van Persoonsgegevens naar derde landen, in de toepasselijke module.

k. **"Geanonimiseerde Gegevens"**: gegevens die op zodanige, onomkeerbare wijze zijn bewerkt dat zij — rekening houdend met alle middelen waarvan redelijkerwijs valt aan te nemen dat zij worden ingezet — niet langer, direct noch indirect, tot een Betrokkene herleidbaar zijn, conform de op dat moment geldende criteria van het Europees Comité voor gegevensbescherming (EDPB). Pseudonimisering geldt uitdrukkelijk **niet** als anonimisering.

---

## ARTIKEL 2 — VOORWERP, RANGORDE EN DUUR

2.1 Deze Verwerkersovereenkomst regelt de verwerking van Persoonsgegevens door Verwerker in het kader van de uitvoering van de Hoofdovereenkomst.

2.2 **Onderwerp, aard en doel** van de verwerking, de **soorten Persoonsgegevens**, de **categorieën Betrokkenen**, de **rolverdeling per verwerkingsstroom** en de **duur** van de verwerking zijn nader gespecificeerd in **Bijlage 1 (Verwerkingsregister)**, die een onlosmakelijk onderdeel vormt van deze Verwerkersovereenkomst.

2.3 **Rangorde.** Bij tegenstrijdigheid tussen documenten geldt, uitsluitend voor zover het de verwerking van Persoonsgegevens en de naleving van de AVG betreft, de volgende rangorde, waarbij het eerstgenoemde voorgaat:
(i) de SCC's, voor zover van toepassing en uitsluitend ten aanzien van de onderwerpen die zij regelen (zie artikel 8);
(ii) deze Verwerkersovereenkomst;
(iii) de Hoofdovereenkomst;
(iv) de algemene voorwaarden.
Voor het overige (niet-privacy-onderwerpen) prevaleert de Hoofdovereenkomst. De verhouding tussen de algemene voorwaarden van Partijen onderling (battle of forms) wordt beheerst door de Hoofdovereenkomst; voor de toepassing van deze Verwerkersovereenkomst geldt dat geen algemene voorwaarden van een Partij prevaleren boven deze Verwerkersovereenkomst.

2.4 **Duur.** Deze Verwerkersovereenkomst treedt in werking op de datum van ondertekening (of, indien eerder, op de datum van eerste verwerking) en geldt voor de duur van de Hoofdovereenkomst. Verplichtingen die naar hun aard bestemd zijn om voort te duren — waaronder geheimhouding, teruggave/verwijdering, verzekering en aansprakelijkheid — blijven na beëindiging van kracht.

2.5 Deze Verwerkersovereenkomst kan niet zelfstandig worden opgezegd zolang de Hoofdovereenkomst voortduurt en er Persoonsgegevens worden verwerkt.

---

## ARTIKEL 3 — ROLVERDELING, HYBRIDE ROL EN VERBOD OP ROLKANTELING

3.1 **Verwerker-rol.** Ten aanzien van de Persoonsgegevens die Verwerker in opdracht van Klant verwerkt bij het uitvoeren van de door Klant gedefinieerde automatiseringstaken, treedt **Verwerker op als verwerker** en Klant als **verwerkingsverantwoordelijke**. De keuze van het taalmodel, de wijze waarop pagina-inhoud aan een taalmodel wordt aangeboden (prompting), de selectie van de in te schakelen Subverwerkers en de retentie van Sessie-artefacten vormen **middelen ter uitvoering van de instructie van Klant** en worden door Verwerker vastgelegd in **Bijlage 1 en Bijlage 3**; Verwerker bepaalt daarmee niet zelfstandig het doel van de verwerking. De doorgifte van pagina-inhoud aan een taalmodel-leverancier vindt uitsluitend plaats voor zover dit noodzakelijk is voor de uitvoering van de door Klant gedefinieerde taak.

3.2 **Per-stroom kwalificatie.** De rol van Verwerker per concrete verwerkingsstroom (klanttaak-uitvoering, taalmodel-verwerking, hosting, beveiliging/telemetrie) is uitgewerkt in de rolverdelingstabel in **Bijlage 1**. Partijen erkennen dat de juridische houdbaarheid van deze kwalificatie — in het bijzonder voor de taalmodel-verwerking — afhankelijk is van de feitelijke uitvoering en onderwerp is van de in de notitie bovenaan bedoelde juridische toetsing.

3.3 **Hybride rol.** Partijen erkennen dat Verwerker voor bepaalde, beperkte en eigen doeleinden zelfstandig **verwerkingsverantwoordelijke** is, in het bijzonder voor:
a. account-, contract- en facturatiegegevens van Klant als zakelijke afnemer;
b. **uitsluitend** metadata en telemetrie die strikt noodzakelijk zijn voor de beveiliging, fraudepreventie, misbruikdetectie en de technische continuïteit van de dienst, **uitdrukkelijk met uitzondering van DOM-inhoud, Sessie-artefacten met inhoudelijke gegevens en Persoonsgegevens van derden-Betrokkenen**, en gepseudonimiseerd waar mogelijk;
c. wettelijk verplichte administratie.
Op de onder dit lid bedoelde verwerkingen is de privacyverklaring van Verwerker van toepassing en niet het verwerker-regime van deze Verwerkersovereenkomst. Sessie-artefacten die Persoonsgegevens van derden-Betrokkenen bevatten vallen **nooit** onder het in dit lid bedoelde zelfstandige regime.

3.4 **Verbod op rolkanteling (artikel 28 lid 10 AVG).** Verwerker bepaalt **niet** zelfstandig het doel en de essentiële middelen van de in artikel 3.1 bedoelde verwerkingen. Verwerker zal de in het kader van de klanttaken verwerkte Persoonsgegevens (en de via de sessie geraakte gegevens van derden-Betrokkenen) **niet** gebruiken voor eigen doeleinden, waaronder uitdrukkelijk begrepen het trainen, finetunen of verbeteren van (taal)modellen, het uitvoeren van eigen analyses of productontwikkeling, behoudens voor zover dit gebeurt met Geanonimiseerde Gegevens als gedefinieerd in artikel 1.2 sub k. Verwerker draagt de bewijslast dat van rechtsgeldige anonimisering sprake is. Handelt Verwerker hiermee in strijd, dan geldt Verwerker voor dat deel als zelfstandig verwerkingsverantwoordelijke met alle daaruit voortvloeiende eigen verplichtingen en aansprakelijkheid.

3.5 **Verantwoordelijkheid Klant voor grondslag.** Klant staat ervoor in dat hij voor alle Persoonsgegevens die via Yad worden verwerkt — daaronder begrepen gegevens van zijn eigen klanten en relaties — beschikt over een geldige rechtsgrond als bedoeld in artikel 6 AVG (en, waar van toepassing, artikel 9 AVG), en dat hij voldoet aan zijn eigen informatieplicht jegens die derden-Betrokkenen (artikelen 13 en 14 AVG). Verwerker is niet verantwoordelijk voor het bestaan van de grondslag of voor het informeren van derden-Betrokkenen, behoudens voor zover Verwerker zelf buiten de instructie van Klant handelt.

---

## ARTIKEL 4 — VERWERKING UITSLUITEND OP INSTRUCTIE EN TOEGESTAAN GEBRUIK

4.1 Verwerker verwerkt de Persoonsgegevens **uitsluitend** op basis van de gedocumenteerde instructies van Klant — waaronder mede begrepen instructies met betrekking tot doorgifte naar een derde land of internationale organisatie — tenzij een op Verwerker van toepassing zijnde Unierechtelijke of nationaalrechtelijke bepaling hem tot verwerking verplicht. In dat geval stelt Verwerker Klant vóór de verwerking in kennis van dat wettelijke voorschrift, tenzij die wetgeving deze kennisgeving om gewichtige redenen van algemeen belang verbiedt.

4.2 De door Klant binnen de dienst gedefinieerde **automatiseringstaken en -opdrachten** gelden als gedocumenteerde instructie in de zin van dit artikel. De Hoofdovereenkomst, deze Verwerkersovereenkomst en de Bijlagen vormen tezamen de volledige instructie. Aanvullende of afwijkende instructies geeft Klant schriftelijk (waaronder elektronisch).

4.3 **Toegestaan gebruik / uitgesloten taken.** De volgende categorieën taken vallen **niet** binnen het toegestane gebruik en gelden niet als rechtmatige instructie, tenzij Partijen daarover vooraf afzonderlijk en schriftelijk overeenstemming bereiken én Klant aantoont over een toereikende grondslag te beschikken:
a. de grootschalige geautomatiseerde verzameling (scraping) of profilering van Persoonsgegevens van derden-Betrokkenen;
b. de verwerking van bijzondere categorieën van Persoonsgegevens (artikel 9 AVG) of strafrechtelijke gegevens (artikel 10 AVG);
c. uitsluitend op geautomatiseerde verwerking gebaseerde besluitvorming met rechtsgevolg of vergelijkbaar aanmerkelijke gevolgen voor een Betrokkene (artikel 22 AVG);
d. iedere verwerking die kennelijk in strijd is met de AVG of ander dwingend recht.

4.4 Verwerker verwerkt de Persoonsgegevens niet voor eigen doeleinden, behoudens het bepaalde in artikel 3.3.

4.5 **Signalerings- en opschortingsplicht.** Verwerker stelt Klant onmiddellijk in kennis indien naar zijn oordeel een instructie inbreuk oplevert op de AVG of op andere toepasselijke gegevensbeschermingsbepalingen. Bij een kennelijk onrechtmatige instructie of een taak als bedoeld in artikel 4.3 is Verwerker niet alleen gerechtigd maar **verplicht** de uitvoering op te schorten totdat Klant de instructie bevestigt met een toereikende onderbouwing, intrekt of wijzigt. Opschorting op deze grond levert geen tekortkoming van Verwerker op.

---

## ARTIKEL 5 — VERTROUWELIJKHEID

5.1 Verwerker waarborgt dat de tot het verwerken van Persoonsgegevens gemachtigde personen — waaronder werknemers, ingeschakelde hulppersonen en Subverwerkers — zich ertoe hebben verbonden vertrouwelijkheid in acht te nemen, dan wel door een passende wettelijke verplichting tot vertrouwelijkheid zijn gebonden.

5.2 Verwerker verleent toegang tot de Persoonsgegevens uitsluitend aan personen voor wie toegang noodzakelijk is voor de uitvoering van de Hoofdovereenkomst (need-to-know / least privilege), en draagt zorg voor passende training en bewustwording.

5.3 De geheimhoudingsverplichting blijft ook na beëindiging van deze Verwerkersovereenkomst en na beëindiging van de betreffende dienstverbanden of opdrachten van kracht.

---

## ARTIKEL 6 — BEVEILIGING (ARTIKEL 32 AVG)

6.1 Verwerker treft passende technische en organisatorische maatregelen om een op het risico afgestemd beveiligingsniveau te waarborgen, rekening houdend met de stand van de techniek, de uitvoeringskosten, en de aard, omvang, context en doeleinden van de verwerking, alsmede de qua waarschijnlijkheid en ernst uiteenlopende risico's voor de rechten en vrijheden van Betrokkenen. De getroffen maatregelen zijn beschreven in **Bijlage 2 (TOMs)**.

6.2 Partijen erkennen dat Yad handelt **binnen een reeds ingelogde sessie van Klant** en daardoor een verhoogd risico met zich brengt (toegang op overname-niveau). De maatregelen omvatten daarom ten minste, voor zover van toepassing op de gekozen leveringsvorm:
a. versleuteling van Persoonsgegevens tijdens transport en in rust;
b. strikte toegangscontrole en least-privilege op de componenten van de dienst;
c. logische scheiding tussen klanten (multi-tenant isolatie);
d. **dataminimalisatie en pseudonimisering** van hetgeen uit de DOM wordt gelogd of naar een taalmodel wordt gestuurd, met beperking van schermafbeeldingen en sessie-artefacten tot het strikt noodzakelijke;
e. het niet langer bewaren van sessietokens en cookies dan strikt noodzakelijk;
f. **registratie (logging) van welke categorieën gegevens naar welke taalmodel-leverancier zijn verzonden**, ten behoeve van het auditspoor en het verwerkingsregister (artikel 30 AVG);
g. het vermogen om de vertrouwelijkheid, integriteit, beschikbaarheid en veerkracht van de verwerkingssystemen te waarborgen en te herstellen;
h. procedures voor het regelmatig testen, beoordelen en evalueren van de doeltreffendheid van de maatregelen.

6.3 **Leveringsvormen.** Bij de varianten *self-host* en *white-label* berust de operationele controle over (een deel van) de verwerkingsomgeving bij Klant respectievelijk de reseller. In die gevallen geldt de verantwoordelijkheidsverdeling zoals beschreven in **Bijlage 2**: Verwerker is niet verantwoordelijk voor de beveiliging, updates, hardening of compliance van de door Klant of de reseller beheerde omgeving.

6.4 **Actualisering TOMs.** Verwerker mag de maatregelen uit Bijlage 2 actualiseren mits het beveiligingsniveau ten minste gelijkwaardig blijft. Bij een materiële wijziging informeert Verwerker Klant vooraf; Klant kan binnen `[AANTAL, bijv. 14]` dagen op redelijke, gegevensbeschermingsrechtelijke gronden schriftelijk en gemotiveerd bezwaar maken, waarna de procedure van de artikelen 7.4 en 7.5 van overeenkomstige toepassing is.

6.5 **Verzekering.** Verwerker beschikt gedurende de looptijd van deze Verwerkersovereenkomst over een toereikende verzekering die ten minste de beroeps- en bedrijfsaansprakelijkheid en de cyber-/datalek-risico's dekt, met een verzekerde som van ten minste `[BEDRAG, bijv. € 1.000.000]` per gebeurtenis en `[BEDRAG]` per jaar. Verwerker overlegt op eerste schriftelijk verzoek van Klant een bewijs van dekking.

---

## ARTIKEL 7 — SUBVERWERKERS

7.1 Klant verleent Verwerker hierbij **algemene voorafgaande toestemming** voor het inschakelen van Subverwerkers. De op het moment van ondertekening ingeschakelde Subverwerkers zijn opgenomen in **Bijlage 3 (Subverwerkerslijst)**, met vermelding van naam, vestigingsadres, contactgegevens, de aard van de verwerking en het land van verwerking.

7.2 Verwerker legt aan iedere Subverwerker bij overeenkomst dezelfde gegevensbeschermingsverplichtingen op als in deze Verwerkersovereenkomst zijn opgenomen (flow-down), in het bijzonder:
a. de verplichting om afdoende garanties te bieden met betrekking tot passende technische en organisatorische maatregelen (artikel 28 lid 4 AVG);
b. de verplichting om een Datalek **onverwijld en uiterlijk binnen 24 uur** na ontdekking aan Verwerker te melden, zodat Verwerker zijn termijn onder artikel 10.1 jegens Klant kan nakomen;
c. de verplichting om Persoonsgegevens op verzoek van Verwerker te verwijderen of terug te geven (aansluitend op artikel 11).

7.3 **Wijziging.** Verwerker informeert Klant ten minste `[AANTAL, bijv. 30]` dagen vóór een beoogde wijziging inzake de toevoeging of vervanging van een Subverwerker. Klant heeft het recht binnen `[AANTAL, bijv. 14]` dagen na die kennisgeving op redelijke, gegevensbeschermingsrechtelijke gronden schriftelijk en gemotiveerd bezwaar te maken.

7.4 Maakt Klant tijdig en gemotiveerd bezwaar, dan treden Partijen in overleg om tot een oplossing te komen.

7.5 Komen Partijen er binnen een redelijke termijn niet uit, dan is Klant gerechtigd de betreffende dienst (of het deel daarvan dat de Subverwerker betreft) op te zeggen, zonder dat dit een tekortkoming van Verwerker oplevert en zonder dat een van beide Partijen tot schadevergoeding gehouden is uit hoofde van die opzegging.

7.6 Verwerker blijft jegens Klant **volledig aansprakelijk** voor de nakoming van de verplichtingen van de door hem ingeschakelde Subverwerkers (artikel 28 lid 4 AVG).

7.7 Partijen erkennen dat taalmodel-leveranciers (LLM-providers) en hosting-leveranciers Subverwerkers zijn die feitelijke pagina-inhoud (en daarmee Persoonsgegevens) te zien kunnen krijgen. Verwerker **waarborgt dat de verwerking door deze Subverwerkers plaatsvindt in de in Bijlage 3 vermelde landen** (data-residency). Een wijziging van het land van verwerking geldt als een wijziging van Subverwerker in de zin van artikel 7.3 en is onderworpen aan dezelfde kennisgevings- en bezwaarprocedure.

---

## ARTIKEL 8 — INTERNATIONALE DOORGIFTE

8.1 Verwerker draagt Persoonsgegevens **niet** over naar een land buiten de EER of een internationale organisatie, tenzij dit gebeurt in overeenstemming met hoofdstuk V AVG en op grond van een geldige doorgiftegrondslag.

8.2 Voor iedere Subverwerker buiten de EER legt Verwerker in **Bijlage 3** de toepasselijke doorgiftegrondslag vast, zijnde:
a. een adequaatheidsbesluit van de Europese Commissie (artikel 45 AVG), waaronder — voor zover van toepassing en geldig — een certificering onder het EU-US Data Privacy Framework; of
b. de SCC's (artikel 46 AVG), in de toepasselijke module (controller-to-processor of processor-to-(sub)processor), aangevuld met een uitgevoerde **Transfer Impact Assessment (TIA)**.

8.3 De op een doorgifte toepasselijke SCC's, met ingevulde bijlagen, worden als **appendix bij Bijlage 3** aangehecht en maken integraal deel uit van deze Verwerkersovereenkomst.

8.4 **Terugvaloptie.** Mocht een ingeroepen adequaatheidsbesluit (waaronder het EU-US Data Privacy Framework) komen te vervallen of worden geschorst, dan zal Verwerker zonder onredelijke vertraging terugvallen op een andere geldige doorgiftegrondslag (in de regel de SCC's met TIA) of de betreffende verwerking staken.

8.5 **Voorrang en onaantastbaarheid van de SCC's.** Waar de SCC's van toepassing zijn, **prevaleren zij onverkort en in hun geheel** ten aanzien van de onderwerpen die zij regelen. Geen bepaling van deze Verwerkersovereenkomst of van de Hoofdovereenkomst mag worden uitgelegd op een wijze die de rechten van Betrokkenen of de aansprakelijkheid van Partijen onder de SCC's (waaronder de clausules 12 en 13 van Uitvoeringsbesluit (EU) 2021/914) beperkt of inperkt. Voor zover een dergelijke beperking toch zou worden aangenomen, blijft zij in zoverre buiten toepassing.

---

## ARTIKEL 9 — BIJSTAND BIJ RECHTEN VAN BETROKKENEN

9.1 Verwerker verleent Klant, rekening houdend met de aard van de verwerking, door middel van passende technische en organisatorische maatregelen, voor zover redelijkerwijs mogelijk, bijstand bij het vervullen van diens plicht om verzoeken van Betrokkenen tot uitoefening van hun rechten te beantwoorden (waaronder inzage, rectificatie, wissing, beperking, overdraagbaarheid en bezwaar; artikelen 15–22 AVG).

9.2 Indien een Betrokkene zich rechtstreeks tot Verwerker wendt met een verzoek, verwijst Verwerker de Betrokkene door naar Klant en stelt Verwerker Klant zonder onredelijke vertraging in kennis. Verwerker geeft zelfstandig geen gevolg aan een dergelijk verzoek, tenzij Klant hem daartoe opdraagt of de wet hem daartoe verplicht.

9.3 **Kosten.** Bijstand bij routinematige verzoeken van Betrokkenen maakt onderdeel uit van de dienst en wordt niet afzonderlijk in rekening gebracht. Uitsluitend voor bijstand die de in **Bijlage 2** omschreven of een vooraf schriftelijk overeengekomen standaard-inspanning (uitgedrukt in een uren- of volumegrens) aantoonbaar te boven gaat, mag Verwerker een vooraf aangekondigde, redelijke vergoeding op basis van een vooraf bekendgemaakt tarief in rekening brengen.

---

## ARTIKEL 10 — DATALEKKEN, DPIA EN VOORAFGAANDE RAADPLEGING

10.1 **Melding aan Klant.** Verwerker informeert Klant **zonder onredelijke vertraging en uiterlijk binnen `[AANTAL, bijv. 24]` uur** nadat hij kennis heeft genomen van een Datalek dat (mede) Persoonsgegevens van Klant betreft. Deze termijn is afgestemd op de meldketen waarin Subverwerkers op grond van artikel 7.2 sub b binnen 24 uur aan Verwerker melden, zodat Klant in staat is te voldoen aan zijn eigen meldplicht aan de Autoriteit Persoonsgegevens binnen 72 uur (artikel 33 AVG).

10.2 De melding bevat ten minste, voor zover bekend: de aard van het Datalek, de (categorieën en bij benadering het aantal) betrokken Betrokkenen en gegevens, of het Datalek zich bij Verwerker dan wel bij een Subverwerker heeft voorgedaan, de waarschijnlijke gevolgen, de getroffen en voorgestelde maatregelen, en de contactgegevens van een aanspreekpunt. Ontbrekende informatie wordt zonder onredelijke vertraging nagezonden.

10.3 Verwerker doet **niet** zelfstandig melding van een Datalek aan de Autoriteit Persoonsgegevens of aan Betrokkenen, tenzij Partijen schriftelijk anders overeenkomen of de wet Verwerker daartoe verplicht. De beoordeling of melding aan de toezichthouder (artikel 33 AVG) of aan Betrokkenen (artikel 34 AVG) is vereist, berust bij Klant.

10.4 Verwerker verleent Klant redelijke bijstand bij het melden aan de toezichthouder en, waar vereist, aan Betrokkenen, en bij het beperken van de gevolgen van het Datalek.

10.5 **DPIA.** Verwerker verleent Klant, rekening houdend met de aard van de verwerking en de hem ter beschikking staande informatie, redelijke bijstand bij het uitvoeren van een gegevensbeschermingseffectbeoordeling (DPIA; artikel 35 AVG) en bij een eventuele voorafgaande raadpleging van de toezichthouder (artikel 36 AVG). Partijen erkennen dat het gebruik van Yad — als AI-gestuurde agent, mogelijk gepaard gaand met systematische verwerking — een DPIA-plicht voor Klant kan triggeren.

10.6 **Onderzoeken en correspondentie toezichthouder.** Indien Verwerker een verzoek, vordering of onderzoek van de Autoriteit Persoonsgegevens of een andere toezichthoudende autoriteit ontvangt dat (mede) de verwerking ten behoeve van Klant betreft, stelt Verwerker Klant — voor zover wettelijk toegestaan — zonder onredelijke vertraging hiervan in kennis, geleidt hij relevante correspondentie door en werkt hij redelijkerwijs met Klant samen, onverminderd de eigen wettelijke verplichtingen van Verwerker.

---

## ARTIKEL 11 — TERUGGAVE, VERWIJDERING EN TRANSITIE

11.1 Na beëindiging van de Hoofdovereenkomst, dan wel op eerder verzoek van Klant, **verwijdert** Verwerker alle Persoonsgegevens, of **geeft** hij deze naar keuze van Klant terug in een gangbaar, bruikbaar formaat, en verwijdert hij bestaande kopieën, tenzij opslag van de Persoonsgegevens Unierechtelijk of nationaalrechtelijk is vereist.

11.2 De verwijdering omvat uitdrukkelijk ook de **Sessie-artefacten** (waaronder logs, schermafbeeldingen, DOM-fragmenten en prompts/outputs van taalmodellen) en alle Persoonsgegevens die bij Subverwerkers (waaronder LLM- en hosting-leveranciers) zijn terechtgekomen. Verwerker **initieert daartoe actief de verwijdering bij zijn Subverwerkers**. Voor zover een Subverwerker geen directe wissing op verzoek biedt, legt Verwerker de korte, automatische retentietermijn van die Subverwerker contractueel vast en vermeldt deze in **Bijlage 3**; na het verstrijken van die termijn is de verwijdering voltooid.

11.3 Verwerker bevestigt de verwijdering of teruggave desgevraagd schriftelijk aan Klant.

11.4 **Exportvenster.** Klant draagt zorg voor het tijdig exporteren van zijn gegevens binnen een termijn van `[AANTAL, bijv. 30]` dagen na beëindiging. Na het verstrijken van dit exportvenster gaat Verwerker over tot **onherroepelijke verwijdering** overeenkomstig de artikelen 11.1 en 11.2, met schriftelijke bevestiging op verzoek.

11.5 **Transitiebijstand.** Op verzoek van Klant verleent Verwerker tegen een redelijke, vooraf bekendgemaakte vergoeding redelijke medewerking aan een ordelijke overgang van de dienstverlening naar Klant of een door Klant aangewezen derde, waaronder de gestructureerde export van gegevens, gedurende een termijn van ten hoogste `[AANTAL, bijv. 60]` dagen na beëindiging. De verplichting tot verwijdering onder dit artikel wordt opgeschort voor zover en zolang dit voor de transitie noodzakelijk is.

---

## ARTIKEL 12 — BEWAARTERMIJNEN EN DATAMINIMALISATIE

12.1 Verwerker bewaart de Persoonsgegevens en Sessie-artefacten niet langer dan strikt noodzakelijk voor de uitvoering van de Hoofdovereenkomst, met inachtneming van de per gegevenscategorie vastgelegde bewaartermijnen in **Bijlage 1**.

12.2 **Maximale bewaartermijnen.** Onverminderd kortere termijnen in Bijlage 1 en behoudens een afwijkende wettelijke verplichting of een uitdrukkelijk schriftelijk overeengekomen langere termijn, gelden voor de hoogste-risico-categorieën de volgende maximale bewaartermijnen, te rekenen vanaf het ontstaan van het gegeven:
a. DOM-fragmenten: vluchtig, niet langer dan voor de directe taakuitvoering nodig en niet structureel opgeslagen;
b. schermafbeeldingen: ten hoogste `[AANTAL, bijv. 7]` dagen;
c. sessielogs: ten hoogste `[AANTAL, bijv. 30]` dagen;
d. prompts en outputs van taalmodellen: ten hoogste `[AANTAL, bijv. 30]` dagen;
e. sessietokens en cookies: uitsluitend voor de duur van de actieve sessie en direct daarna verwijderd.
Bij strijdigheid tussen dit artikel en Bijlage 1 geldt de kortste termijn.

12.3 Operationele gegevens worden, behoudens een afwijkende wettelijke of contractuele grondslag, zoveel mogelijk via automatische verwijdering opgeruimd, teneinde het lekoppervlak van de sessietoegang te beperken.

---

## ARTIKEL 13 — AUDITS EN INSPECTIES

13.1 Verwerker stelt Klant alle informatie ter beschikking die nodig is om de nakoming van de in artikel 28 AVG en in deze Verwerkersovereenkomst neergelegde verplichtingen aan te tonen.

13.2 Verwerker maakt audits, waaronder inspecties, door Klant of een door Klant gemachtigde, onafhankelijke en aan geheimhouding gebonden auditor mogelijk en draagt daaraan bij.

13.3 **Volgorde van middelen.** Verwerker toont de naleving in beginsel aan door overlegging van een actueel, onafhankelijk auditrapport of certificering (zoals ISO/IEC 27001 of SOC 2) en bijbehorende beveiligingsdocumentatie. Partijen plegen op basis daarvan eerst overleg. Leidt dat overleg naar het redelijk oordeel van Klant niet tot afdoende zekerheid over de naleving, dan **behoudt Klant het recht op een inspectie ter plaatse** onder de in artikel 13.4 genoemde waarborgen. Het wettelijke recht van Klant op inspectie (artikel 28 lid 3 sub h AVG) wordt door dit artikel niet beperkt.

13.4 Audits en inspecties vinden plaats: (i) na redelijke voorafgaande aankondiging van ten minste `[AANTAL, bijv. 14]` dagen, (ii) tijdens kantooruren, (iii) ten hoogste eenmaal per jaar (behoudens na een Datalek of een concrete aanwijzing van non-conformiteit), en (iv) op zodanige wijze dat de bedrijfsvoering en de vertrouwelijkheid jegens andere klanten van Verwerker niet onevenredig worden verstoord.

13.5 **Kosten.** Ieder draagt in beginsel de eigen kosten van een audit. Blijkt uit de audit een wezenlijke tekortkoming van Verwerker, dan draagt Verwerker tevens de redelijke kosten van de audit van Klant alsook zijn eigen kosten van herstel.

---

## ARTIKEL 14 — AANSPRAKELIJKHEID EN VRIJWARING

14.1 De aansprakelijkheid van Partijen jegens elkaar uit hoofde van deze Verwerkersovereenkomst wordt beheerst door de aansprakelijkheidsbepalingen van de Hoofdovereenkomst, met inachtneming van het dwingendrechtelijke kader van de AVG en het in dit artikel bepaalde. **Indien de Hoofdovereenkomst geen aansprakelijkheidsplafond bevat, of indien deze Verwerkersovereenkomst los van een Hoofdovereenkomst wordt aangegaan, geldt** ter zake van de verwerking van Persoonsgegevens een aansprakelijkheidsplafond van `[BEDRAG / bijv. de in de laatste 12 maanden betaalde vergoeding, met een ondergrens van € ...]` per gebeurtenis en `[BEDRAG]` per kalenderjaar, onverminderd de leden 2, 5 en het bepaalde in artikel 8.5.

14.2 **Dwingend recht (artikel 82 AVG).** Partijen erkennen dat de aansprakelijkheid jegens Betrokkenen op grond van artikel 82 AVG van dwingend recht is en niet bij overeenkomst kan worden uitgesloten of beperkt. Verwerker en Verwerkingsverantwoordelijke zijn jegens een Betrokkene hoofdelijk aansprakelijk voor de volledige door deze geleden schade, voor zover de wet dat bepaalt. De aansprakelijkheidsbeperkingen in dit artikel en in de Hoofdovereenkomst gelden uitsluitend in de onderlinge verhouding tussen Partijen en laten de aanspraken van Betrokkenen, alsmede de aansprakelijkheid onder de SCC's (artikel 8.5), onverlet.

14.3 **Onderlinge verhaalsverdeling (artikel 82 lid 5 AVG).** Indien een Partij de volledige schadevergoeding aan een Betrokkene heeft betaald, heeft zij het recht van regres op de andere Partij voor het deel van de schade dat overeenstemt met diens aandeel in de verantwoordelijkheid voor het schadeveroorzakende feit.

14.4 **Verwerker-specifieke aansprakelijkheid.** Verwerker is in beginsel slechts aansprakelijk voor schade die voortvloeit uit verwerking voor zover hij niet heeft voldaan aan de specifiek tot verwerkers gerichte verplichtingen van de AVG, of buiten dan wel in strijd met de rechtmatige instructies van Klant heeft gehandeld (artikel 82 lid 2 AVG).

14.5 **Carve-out.** De in dit artikel en in de Hoofdovereenkomst opgenomen beperkingen en uitsluitingen van aansprakelijkheid gelden **niet** bij opzet of bewuste roekeloosheid van Verwerker of haar leidinggevenden, noch voor zover dwingend recht (waaronder artikel 82 AVG, de SCC's en aansprakelijkheid voor dood of lichamelijk letsel) zich tegen beperking of uitsluiting verzet.

14.6 **Vrijwaring door Klant.** Klant vrijwaart Verwerker voor aanspraken van derden (waaronder Betrokkenen, beheerders van doelsystemen, account-providers en toezichthouders) **voor zover** deze aanspraken het rechtstreekse gevolg zijn van: (i) het ontbreken van een geldige rechtsgrond als bedoeld in artikel 3.5; (ii) het niet-nakomen door Klant van zijn informatieplicht jegens derden-Betrokkenen; of (iii) instructies, automatiseringstaken of content die door of namens Klant zijn aangeleverd en die buiten het toegestane gebruik (artikel 4.3) vallen of anderszins onrechtmatig zijn. Deze vrijwaring strekt zich **niet** uit tot aanspraken of boetes die voortvloeien uit een eigen tekortkoming van Verwerker in de nakoming van de specifiek tot verwerkers gerichte verplichtingen (artikelen 28 en 32 AVG) of uit handelen van Verwerker buiten of in strijd met de instructie van Klant, en kan niet worden ingeroepen om de dwingende aansprakelijkheid jegens Betrokkenen onder artikel 82 AVG of onder de SCC's opzij te zetten.

14.7 **Vrijwaring door Verwerker (wederkerigheid).** Verwerker vrijwaart Klant — als spiegelbeeld van artikel 14.6 en met inachtneming van de aansprakelijkheidsbeperkingen van dit artikel — voor aanspraken van derden (waaronder Betrokkenen en toezichthouders) voor zover deze het rechtstreekse gevolg zijn van een schending door Verwerker van de specifiek tot verwerkers gerichte verplichtingen van de AVG (artikelen 28 en 32) of van handelen van Verwerker buiten of in strijd met de rechtmatige instructie van Klant.

---

## ARTIKEL 15 — EU AI ACT EN GEAUTOMATISEERDE VERWERKING

15.1 Partijen erkennen dat Yad een AI-systeem is. Voor zover de Verordening (EU) 2024/1689 (EU AI Act) van toepassing wordt op het gebruik van Yad door Klant, treden Partijen in overleg over de redelijke verdeling van de daaruit voortvloeiende verplichtingen, waaronder die inzake transparantie, logging/registratie en menselijk toezicht. Dit artikel schept geen zelfstandige verplichting verder dan die welke uit toepasselijke wetgeving voortvloeit.

15.2 Geautomatiseerde individuele besluitvorming met rechtsgevolg of vergelijkbaar aanmerkelijke gevolgen (artikel 22 AVG) valt buiten het toegestane gebruik op grond van artikel 4.3 sub c, behoudens afzonderlijke schriftelijke afspraak met een toereikende grondslag en passende waarborgen; in dat geval verleent Verwerker Klant de redelijkerwijs benodigde bijstand om aan de waarborgen van artikel 22 AVG te voldoen.

---

## ARTIKEL 16 — WIJZIGING EN SLOTBEPALINGEN

16.1 Wijzigingen van deze Verwerkersovereenkomst zijn slechts geldig indien schriftelijk (waaronder elektronisch) overeengekomen. Indien wijziging van wet- of regelgeving, een besluit van de toezichthouder of een rechterlijke uitspraak daartoe noopt, treden Partijen in overleg om deze Verwerkersovereenkomst tijdig en in redelijkheid aan te passen.

16.2 Indien een bepaling van deze Verwerkersovereenkomst nietig of vernietigbaar is, blijven de overige bepalingen onverminderd van kracht. Partijen vervangen de betreffende bepaling door een geldige bepaling die de strekking daarvan zoveel mogelijk benadert.

16.3 **Toepasselijk recht.** Op deze Verwerkersovereenkomst is **Nederlands recht** van toepassing.

16.4 **Forumkeuze.** Geschillen die voortvloeien uit of verband houden met deze Verwerkersovereenkomst worden voorgelegd aan de bevoegde rechter van de rechtbank `[ARRONDISSEMENT/VESTIGINGSPLAATS VERWERKER]`. Indien Klant kwalificeert als een kleine wederpartij in de zin van het Nederlandse recht, heeft Klant het recht om binnen **één maand** nadat Verwerker zich schriftelijk op deze forumkeuze beroept, te kiezen voor beslechting van het geschil door de volgens de wet bevoegde rechter. Dit laat de bevoegdheidsregels van de SCC's, waar van toepassing, onverlet.

16.5 De Bijlagen 1 tot en met 3 (met de daarbij behorende appendices) maken integraal onderdeel uit van deze Verwerkersovereenkomst.

---

## ALDUS OVEREENGEKOMEN EN ONDERTEKEND

| **Verwerkingsverantwoordelijke (Klant)** | **Verwerker (Yad)** |
|---|---|
| `[RECHTSPERSOON KLANT]` | `[RECHTSPERSOON YAD]` |
| Naam: `[NAAM]` | Naam: `[NAAM]` |
| Functie: `[FUNCTIE]` | Functie: `[FUNCTIE]` |
| Datum: `[DATUM]` | Datum: `[DATUM]` |
| Plaats: `[PLAATS]` | Plaats: `[PLAATS]` |
| Handtekening: ____________________ | Handtekening: ____________________ |

---

# BIJLAGE 1 — VERWERKINGSREGISTER EN ROLVERDELING PER STROOM

*(in te vullen / aan te vullen per Klant)*

## 1A — Algemene specificatie

| Onderdeel | Specificatie |
|---|---|
| **Onderwerp van de verwerking** | `[bijv. geautomatiseerde uitvoering van handelingen binnen de ingelogde sessie van Klant op de door Klant aangewezen doelsystemen]` |
| **Aard van de verwerking** | `[bijv. uitlezen (DOM), invoeren, wijzigen, verzenden, tijdelijk opslaan/loggen van gegevens]` |
| **Doel van de verwerking** | `[bijv. automatiseren van door Klant gedefinieerde taken/workflows]` |
| **Duur van de verwerking** | `[voor de duur van de Hoofdovereenkomst / [PERIODE]]` |
| **Categorieën Betrokkenen** | `[bijv. medewerkers van Klant; klanten/relaties van Klant (derden-Betrokkenen); eindgebruikers van doelsystemen]` |
| **Soorten Persoonsgegevens** | `[bijv. NAW-gegevens, contactgegevens, account-/inloggegevens, transactiegegevens]` |
| **Bijzondere categorieën (art. 9 AVG)** | `[in beginsel UITGESLOTEN (zie art. 4.3); alleen indien uitdrukkelijk overeengekomen + grondslag art. 9 — specificeer]` |
| **Bewaartermijnen per categorie** | Sessielogs: `[bijv. 30 dagen]` · Schermafbeeldingen: `[bijv. 7 dagen]` · DOM-fragmenten: `[vluchtig / niet opgeslagen]` · LLM-prompts/outputs: `[bijv. 0–30 dagen]` · Sessietokens/cookies: `[duur actieve sessie]` · Account-/facturatiegegevens: `[wettelijke termijn]` (zie ook art. 12.2) |

## 1B — Rolverdeling per verwerkingsstroom

| Verwerkingsstroom | Beschrijving | Rol Yad | Rol Klant | Grondslag / opmerking |
|---|---|---|---|---|
| **Uitvoering klanttaak** | Uitlezen/invoeren/verzenden binnen de ingelogde sessie conform de door Klant gedefinieerde taak | Verwerker | Verwerkingsverantwoordelijke | Instructie via UI + Hoofdovereenkomst (art. 4) |
| **Taalmodel-verwerking** | Aanbieden van (geminimaliseerde) pagina-inhoud aan LLM als middel ter uitvoering van de klanttaak | Verwerker (middel ter uitvoering; zie art. 3.1) | Verwerkingsverantwoordelijke | `[onderbouwing dat modelkeuze/prompting middel is, geen eigen doel — TE TOETSEN door jurist]` |
| **Hosting/opslag** | Tijdelijke opslag van Sessie-artefacten | Verwerker (via Subverwerker) | Verwerkingsverantwoordelijke | Bijlage 3 |
| **Beveiliging/telemetrie** | Metadata/telemetrie zonder DOM-inhoud t.b.v. beveiliging/continuïteit | Zelfstandig verwerkingsverantwoordelijke | n.v.t. | Art. 3.3 sub b — uitsluitend metadata, geen derdendata |
| **Account/facturatie** | Contract-, account- en facturatiegegevens van Klant | Zelfstandig verwerkingsverantwoordelijke | n.v.t. | Art. 3.3 sub a |

---

# BIJLAGE 2 — TECHNISCHE EN ORGANISATORISCHE MAATREGELEN (TOMs)

*(art. 32 AVG — concreet in te vullen; voorbeelden hieronder)*

| Domein | Maatregel |
|---|---|
| **Versleuteling** | TLS in transit; encryptie at rest (`[algoritme/standaard]`) |
| **Toegangscontrole** | Least-privilege, MFA, rolgebaseerde toegang, periodieke review |
| **Multi-tenant isolatie** | Logische scheiding van klantdata; `[mechanisme]` |
| **Dataminimalisatie DOM/LLM** | Pseudonimisering/redactie vóór verzending naar taalmodel; beperking schermafbeeldingen |
| **Logging LLM-verkeer** | Registratie van categorieën gegevens per LLM-provider (art. 6.2 sub f; art. 30 AVG) |
| **Sessietokens/cookies** | Niet langer bewaard dan noodzakelijk; verwijderd na sessie (art. 12.2 sub e) |
| **Logging & monitoring** | Beveiligingslogging, anomaliedetectie, alerting |
| **Back-up & continuïteit** | `[back-upbeleid, RPO/RTO]` |
| **Incident response** | Procedure conform artikel 10 van deze DPA; subverwerker-meldketen (art. 7.2 sub b) |
| **Personeel** | Geheimhouding, screening, security-awareness-training |
| **Pentests/audits** | `[frequentie]`; certificering `[ISO 27001 / SOC 2 — status]` |
| **Verzekering** | Beroeps-/bedrijfs- en cyberaansprakelijkheid; dekking `[BEDRAG]` (art. 6.5) |
| **Standaard-inspanning betrokkenenverzoeken** | `[uren-/volumegrens waarboven art. 9.3 een vergoeding toestaat]` |
| **Self-host / white-label** | Verantwoordelijkheidsverdeling: Klant/reseller verantwoordelijk voor hardening, updates en beveiliging van de eigen omgeving |

---

# BIJLAGE 3 — SUBVERWERKERSLIJST

*(actueel te houden; per Subverwerker invullen)*

| Subverwerker | Vestiging (land) | Aard van de verwerking | Land van verwerking (residency) | Doorgiftegrondslag (indien buiten EER) | Meldtermijn datalek | Retentie / wisbeleid |
|---|---|---|---|---|---|---|
| `[Hosting-leverancier]` | `[land]` | `[hosting/opslag]` | `[EER-land]` | `[n.v.t. / Adequaatheidsbesluit / SCC + TIA]` | `[≤ 24 uur]` | `[wissing op verzoek / auto-retentie X dagen]` |
| `[LLM-/taalmodel-leverancier]` | `[land]` | `[verwerking pagina-inhoud t.b.v. AI-functionaliteit]` | `[EER-land / land]` | `[n.v.t. / DPF / SCC Module 3 + TIA]` | `[≤ 24 uur]` | `[geen training; auto-retentie ≤ 30 dagen]` |
| `[Overig, bijv. monitoring]` | `[land]` | `[...]` | `[...]` | `[...]` | `[≤ 24 uur]` | `[...]` |

> **Contactgegevens per Subverwerker** (naam, adres, contactpersoon) worden bij deze bijlage gevoegd of op verzoek verstrekt, conform de eis dat Klant te allen tijde kan vaststellen wie in de keten Persoonsgegevens verwerkt (EDPB Opinie 22/2024).
>
> **Appendix 3A — SCC's.** De op een doorgifte buiten de EER toepasselijke Standaard Contractuele Clausules (Uitvoeringsbesluit (EU) 2021/914), in de juiste module en met ingevulde bijlagen, worden als appendix bij deze Bijlage 3 aangehecht (art. 8.3) en maken integraal deel uit van deze Verwerkersovereenkomst.

---

*Einde van het CONCEPT. Laat dit document vóór gebruik controleren door een gekwalificeerd (IT-/privacy)jurist, vul alle plaatshouders in, en toets in het bijzonder de rolkwalificatie van de taalmodel-verwerking (Artikel 3 + Bijlage 1B).*
