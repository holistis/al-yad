# CONCEPT — Privacyverklaring Yad

> **LET OP — DIT IS EEN DOOR AI ONDERZOCHT CONCEPT.**
> Dit document is opgesteld met behulp van AI op basis van bronnenonderzoek naar Nederlands en EU-recht (AVG/GDPR, Telecommunicatiewet, EU AI Act). Het is **geen juridisch advies** en **nog niet geschikt voor gebruik**. Laat dit concept vóór publicatie of ingebruikname controleren en vaststellen door een gekwalificeerd jurist of privacy-specialist, met toetsing aan uw concrete verwerkingen, uw subverwerkers-contracten (in het bijzonder de retentie- en trainingsvoorwaarden van uw LLM-provider) en uw doorgifte-waarborgen. **Vervang alle plaatshouders tussen vierkante haken `[ ]` door uw eigen, waarheidsgetrouwe gegevens vóór gebruik. Vervang elke voorbeeldtermijn of "range" door één vastgestelde termijn of één concreet criterium — laat geen ranges staan.**
>
> **Verplichte randvoorwaarden vóór deze verklaring live gaat** (zie ook hoofdstuk 16):
> 1. Er is een **DPIA** (gegevensbeschermingseffectbeoordeling, art. 35 AVG) uitgevoerd voor de kern-verwerking (pagina-inhoud → taalmodel), vóór de Dienst live gaat.
> 2. Er is een vastgestelde, juridisch onderbouwde **rol-analyse** waarom Yad voor de sessie-/DOM-verwerking verwerker is en geen (mede-)verwerkingsverantwoordelijke (zie hoofdstuk 5).
> 3. Met de LLM-provider zijn **zero-retention / no-training**-voorwaarden gecontracteerd, of de feitelijke afwijking daarvan is in dit document eerlijk benoemd (zie 4.10 en 6.4).
> 4. Het aparte **cookiebeleid** bestaat en de consent-banner dwingt toestemming-eerst af voor niet-functionele cookies (zie hoofdstuk 10).
> 5. De aparte **Verwerker-/DPA-documentatie** voor Klanten bestaat (deze publieke verklaring beschrijft de verwerker-rol slechts samenvattend; de bindende afspraken staan in de DPA).

---

**Versie:** `[VERSIE]`
**Laatst bijgewerkt:** `[DATUM]`
**In werking vanaf:** `[DATUM]`

---

## 1. Inleiding, doel en reikwijdte van deze privacyverklaring

1.1 Deze privacyverklaring legt in begrijpelijke taal uit hoe `[RECHTSPERSOON]` (hierna: **"Yad"**, **"wij"** of **"ons"**) omgaat met persoonsgegevens **in de rol van verwerkingsverantwoordelijke**, bij het aanbieden van de browser-automatiseringsdienst Yad (hierna: de **"Dienst"**).

1.2 **Reikwijdte — wat deze verklaring wél en níét regelt.**

- Deze verklaring gaat over de verwerkingen waarvoor Yad **zelf verwerkingsverantwoordelijke** is: het beheer van uw account, facturatie, telemetrie/logging, beveiliging, eigen communicatie en marketing, en het bezoek aan onze website (hoofdstukken 3 tot en met 13).
- Voor het **uitvoeren van automatiseringstaken in opdracht van de zakelijke gebruiker** (hierna: de **"Klant"**) treedt Yad op als **verwerker**. De bindende afspraken daarover staan **niet** in deze publieke verklaring, maar in de **verwerkersovereenkomst (DPA)** tussen Yad en de Klant. Hoofdstuk 5 vat die rol samen en legt uit hoe wij verzoeken van betrokkenen behandelen, maar is uitdrukkelijk geen vervanging van de DPA.

1.3 **Wat de Dienst doet, en waarom dat privacy raakt.** De Dienst is een AI-gedreven browser-automatiseringsagent die handelingen verricht **binnen de reeds ingelogde sessie** van de Klant. Daardoor kan de Dienst persoonsgegevens raken die op de geautomatiseerde pagina's zichtbaar zijn — waaronder gegevens van de Klant zelf én van personen met wie de Klant relaties onderhoudt (bijvoorbeeld de eigen klanten of contacten van de Klant; hierna: **"derden"** of **"betrokkenen van de Klant"**).

1.4 Wij vinden transparantie belangrijk. Deze verklaring beschrijft daarom **alle** categorieën gegevens die wij als verantwoordelijke verwerken, met welk doel, op welke grondslag, met wie wij ze delen en hoe lang wij ze bewaren. Wij verbergen geen verwerkingen en vermelden geen waarborgen die niet feitelijk juist zijn.

---

## 2. Wie wij zijn (contactgegevens verwerkingsverantwoordelijke)

2.1 De verwerkingsverantwoordelijke voor de in deze verklaring beschreven verwerkingen is:

| | |
|---|---|
| **Rechtspersoon** | `[RECHTSPERSOON]` |
| **KvK-nummer** | `[KVK]` |
| **Vestigingsadres** | `[VESTIGINGSADRES]`, `[VESTIGINGSPLAATS]` |
| **E-mail (privacy)** | `[PRIVACY-E-MAIL]` |
| **Algemeen e-mail** | `[E-MAIL]` |
| **Website** | `[WEBSITE]` |

2.2 `[KEUZE: Wij hebben een Functionaris voor Gegevensbescherming (FG) aangesteld. U kunt de FG bereiken via [FG-E-MAIL]. / Wij zijn niet wettelijk verplicht een Functionaris voor Gegevensbescherming aan te stellen en hebben dit ook niet gedaan; voor privacyvragen kunt u terecht via [PRIVACY-E-MAIL].]`

2.3 `[INDIEN VAN TOEPASSING: Yad is gevestigd buiten de EU/EER en heeft een vertegenwoordiger in de Unie aangewezen op grond van artikel 27 AVG: [NAAM VERTEGENWOORDIGER], [ADRES].]`

---

## 3. Welke persoonsgegevens wij verwerken

Wij verwerken de volgende categorieën persoonsgegevens. Per categorie staat in hoofdstuk 4 het doel en de grondslag, en in hoofdstuk 7 de bewaartermijn. Categorie 3.4 verwerken wij als **verwerker** namens de Klant en valt buiten de verantwoordelijke-rol van deze verklaring; wij vermelden haar alleen voor de volledigheid en transparantie.

### 3.1 Accountgegevens (Yad = verantwoordelijke)

- Naam en functie van de contactpersoon/gebruiker;
- Zakelijk e-mailadres en (optioneel) telefoonnummer;
- Inloggegevens voor de Dienst (gebruikersnaam, versleutelde wachtwoord-hash, eventueel tweefactor-gegevens);
- Bedrijfsnaam en KvK-/vestigingsgegevens van de Klant;
- Voorkeuren en instellingen binnen de Dienst.

### 3.2 Facturatie- en transactiegegevens (Yad = verantwoordelijke)

- Facturatieadres en btw-/KvK-gegevens;
- Gekozen abonnement, prijs en betaalhistorie;
- Betaalstatus en (via onze betaaldienstverlener) beperkte betaalgegevens. Wij slaan **geen** volledige creditcard- of bankrekeninggegevens zelf op.

### 3.3 Gebruiks-, telemetrie- en logbestanden (Yad = verantwoordelijke)

- Technische logs: tijdstempels, IP-adres, browser-/extensietype en -versie, apparaat- en sessie-identificatoren;
- Gebruiksstatistieken op functieniveau (welke functies wanneer zijn gebruikt, foutmeldingen, prestatie-/diagnosegegevens);
- Beveiligingslogs (bijv. inlogpogingen, beveiligingsgebeurtenissen).

**Hoe wij omgaan met pagina-inhoud (DOM) in deze logs — concrete, controleerbare toezegging.** Onze logs onder de verantwoordelijke-rol zijn bedoeld voor de werking, beveiliging en diagnose van de Dienst, **niet** voor het vastleggen van de inhoud van de geautomatiseerde pagina's. Daarom geldt:

- a) **Standaard filteren wij pagina-inhoud (DOM-tekst, formulierwaarden, schermafbeeldingen) uit onze technische, gebruiks- en beveiligingslogs.** Onze logging legt metadata vast (zoals het type handeling, tijdstip, status, foutcode), niet de inhoud van de velden op de pagina.
- b) Kan bij een storing of beveiligingsincident **incidenteel** toch een fragment pagina-inhoud in een foutmelding of diagnostische log terechtkomen, dan behandelen wij dat fragment als gegevens onder de verwerker-rol, passen wij **pseudonimisering/redactie** toe waar dat technisch kan, beperken wij de toegang en de bewaring strikt (zie 7.1), en gebruiken wij het uitsluitend voor het oplossen van de storing of het incident — nooit voor een eigen doel.
- c) Voor zover ondanks (a) en (b) onverhoopt persoonsgegevens van **derden** in onze eigen logs belanden, beroepen wij ons op ons gerechtvaardigd belang bij een veilige en betrouwbare Dienst (4.3/4.4) en op de uitzondering van **artikel 14 lid 5 sub b AVG** (onevenredige inspanning om elke betrokken derde individueel te informeren), waarbij deze verklaring en de informatie die de Klant aan zijn betrokkenen verstrekt samen de transparantie waarborgen. Wij minimaliseren deze restverwerking actief en wissen dergelijke fragmenten zo snel als operationeel mogelijk.

> Wij gebruiken hier bewust **geen** vrijblijvende formuleringen als "wij streven ernaar". De toezegging onder (a) is een ingerichte filtering; de eerlijk benoemde restverwerking onder (b)/(c) is het deel dat technisch niet 100% uit te sluiten is, en dat erkennen wij liever dan het te verzwijgen.

### 3.4 Namens de Klant verwerkte sessie- en paginagegevens (Yad = verwerker — valt buiten deze verantwoordelijke-verklaring)

Bij het uitvoeren van een automatiseringstaak kan de Dienst gegevens verwerken die op de pagina van de Klant aanwezig zijn, zoals:

- Inhoud van de DOM (de op de pagina zichtbare gegevens), die persoonsgegevens van derden kan bevatten;
- Door de Klant opgegeven taakinstructies en invoer;
- Tijdelijke sessie-artefacten die nodig zijn om de taak uit te voeren (bijv. sessietokens en, indien geconfigureerd, schermafbeeldingen of DOM-fragmenten);
- Tekstfragmenten die voor het uitvoeren van de taak aan een taalmodel (LLM-provider) worden voorgelegd.

> Voor deze categorie is de **Klant verwerkingsverantwoordelijke** en treedt **Yad op als verwerker** op grond van een verwerkersovereenkomst (art. 28 AVG). De bindende voorwaarden staan in die DPA, niet in deze publieke verklaring. De Klant bepaalt welke taken op welke systemen worden uitgevoerd en is verantwoordelijk voor een geldige rechtsgrond en voor het informeren van de betrokkenen (artikel 13/14 AVG; zie hoofdstuk 5).

### 3.5 Bijzondere categorieën persoonsgegevens

Wij vragen niet actief om en zijn niet gericht op het verwerken van bijzondere categorieën persoonsgegevens (zoals gegevens over gezondheid, religie, etniciteit; artikel 9 AVG). Omdat de Dienst in een live sessie werkt, kunnen zulke gegevens onbedoeld op een pagina zichtbaar zijn. De Klant is verplicht de Dienst **niet** in te zetten om bijzondere persoonsgegevens te verwerken zonder geldige uitzondering uit artikel 9 lid 2 AVG; dit is vastgelegd in de verwerkersovereenkomst en de gebruiksvoorwaarden. Gelet op dit risico is voor de kern-verwerking een DPIA verplicht (hoofdstuk 16).

---

## 4. Doeleinden en grondslagen (verwerkingen waarvoor Yad verantwoordelijke is)

Wij verwerken persoonsgegevens uitsluitend voor de hieronder genoemde doeleinden, telkens op een wettelijke grondslag uit artikel 6 AVG.

| Nr. | Doel | Categorieën gegevens | Grondslag (art. 6 AVG) |
|---|---|---|---|
| 4.1 | Aanmaken en beheren van het account en het leveren van de Dienst | 3.1 | Uitvoering overeenkomst (art. 6 lid 1 sub b) |
| 4.2 | Facturatie, debiteurenbeheer en boekhouding | 3.2 | Uitvoering overeenkomst (sub b) + wettelijke plicht, o.a. fiscale bewaarplicht (sub c) |
| 4.3 | Beveiliging, fraudepreventie, misbruikdetectie en het waarborgen van de integriteit van de Dienst | 3.3 | Gerechtvaardigd belang (sub f): een veilige en betrouwbare Dienst |
| 4.4 | Onderhoud, foutopsporing en het verbeteren van de stabiliteit en prestaties van de Dienst | 3.3 | Gerechtvaardigd belang (sub f) |
| 4.5 | Klantenservice en communicatie over de Dienst (functionele/serviceberichten) | 3.1, 3.3 | Uitvoering overeenkomst (sub b) + gerechtvaardigd belang (sub f) |
| 4.6 | Direct marketing over onze eigen, gelijksoortige diensten aan **bestaande zakelijke klanten** (zie 4.6 hieronder voor de grenzen) | 3.1 | Gerechtvaardigd belang (sub f) **binnen de grenzen van de soft-opt-in van art. 11.7 Telecommunicatiewet**, met afmeldmogelijkheid bij verkrijging en in elke uiting |
| 4.7 | Voldoen aan wettelijke verplichtingen en verzoeken van bevoegde autoriteiten | naar gelang vereist | Wettelijke plicht (sub c) |

4.6 **Direct marketing — grenzen onder de Telecommunicatiewet (e-Privacy).** E-mailmarketing valt in Nederland niet alleen onder de AVG maar ook onder **artikel 11.7 Telecommunicatiewet**. Wij houden ons aan de daar geldende regels:

- a) Wij sturen elektronische marketing (zoals e-mail) **uitsluitend aan bestaande klanten** wier zakelijke e-mailadres wij in het kader van een verkoop/levering hebben verkregen, en **uitsluitend over onze eigen, gelijksoortige diensten** (de wettelijke "soft-opt-in"-uitzondering).
- b) Bij het verkrijgen van het e-mailadres **én** in elke marketinguiting bieden wij een eenvoudige, kosteloze **afmeldmogelijkheid**. Afmelden werkt direct voor de toekomst.
- c) Voor **prospects en andere niet-klanten** sturen wij pas elektronische marketing **nadat zij daarvoor toestemming (opt-in) hebben gegeven**.
- d) Het recht van bezwaar tegen direct marketing (art. 21 lid 2 AVG) geldt te allen tijde en absoluut: na bezwaar stoppen wij de marketing aan u.

4.8 **Gerechtvaardigd belang — afweging.** Waar wij ons baseren op gerechtvaardigd belang (sub f), hebben wij een afweging gemaakt tussen ons belang en uw rechten en vrijheden. U heeft het recht hiertegen bezwaar te maken (zie hoofdstuk 9). Op verzoek lichten wij de afweging nader toe via `[PRIVACY-E-MAIL]`.

4.9 **Geautomatiseerde besluitvorming en geautomatiseerde handelingen.**

- a) **Binnen de verantwoordelijke-rol van Yad** (account, facturatie, telemetrie, beveiliging, marketing) nemen wij **geen** uitsluitend geautomatiseerde besluiten met rechtsgevolgen of vergelijkbaar aanzienlijke gevolgen voor u in de zin van artikel 22 AVG.
- b) **Binnen de verwerker-rol** verricht de Dienst in opdracht van de Klant geautomatiseerde **handelingen** binnen diens ingelogde sessie. Deze handelingen kunnen voor de Klant of voor diens betrokkenen gevolgen hebben. Of daarbij sprake is van een geautomatiseerd besluit in de zin van artikel 22 AVG, en welke waarborgen dan gelden, moet **de Klant als verwerkingsverantwoordelijke** beoordelen voor de taken die hij door de Dienst laat uitvoeren. Yad bepaalt deze taken niet zelf.

4.10 **Geen verkoop van persoonsgegevens; geen modeltraining op klantdata zonder grondslag.** Wij verkopen uw persoonsgegevens niet. Wij gebruiken de in hoofdstuk 3.4 bedoelde, namens de Klant verwerkte sessie- en paginagegevens **niet** voor het trainen van onze eigen AI-modellen of voor andere eigen doeleinden, tenzij dit met de Klant afzonderlijk en op een geldige grondslag is overeengekomen. Deze belofte strekt zich ook uit tot onze **subverwerkers**: zie 6.4 voor de wijze waarop wij dit bij de LLM-provider contractueel afdwingen (en de eerlijke vermelding wanneer een gekozen provider daarvan afwijkt).

---

## 5. Onze rol: verwerker versus verwerkingsverantwoordelijke

5.1 Yad heeft een **hybride rol**:

- **Verwerkingsverantwoordelijke** voor de eigen bedrijfsvoering: account-, facturatie-, telemetrie-/log- en beveiligingsgegevens en eigen marketing (hoofdstuk 4). Voor deze verwerkingen bepalen wij doel en middelen, en geldt deze verklaring volledig.
- **Verwerker** voor het uitvoeren van automatiseringstaken in opdracht van de Klant (hoofdstuk 3.4). Hierbij verwerken wij persoonsgegevens **uitsluitend op gedocumenteerde instructie** van de Klant, die voor deze gegevens verwerkingsverantwoordelijke is.

5.2 Voor de verwerker-rol sluiten wij met iedere Klant een **verwerkersovereenkomst (DPA)** op grond van artikel 28 AVG. Daarin staan onder meer: de instructiegebondenheid, geheimhouding, beveiligingsmaatregelen, het regime voor subverwerkers, bijstand bij verzoeken van betrokkenen en datalekken, en teruggave of wissing na afloop. **Deze publieke verklaring vervangt de DPA niet**; bij tegenstrijdigheid over de verwerker-rol prevaleert de DPA.

5.3 **Waarom Yad verwerker is en geen (mede-)verwerkingsverantwoordelijke voor de sessie-/DOM-verwerking.** Wij hebben deze rolverdeling onderbouwd en laten vaststellen door een jurist `[DATUM/REFERENTIE rol-analyse]`. De kern van die onderbouwing:

- a) **De Klant bepaalt het doel.** De Klant beslist welke taak op welk systeem wordt uitgevoerd; Yad biedt enkel het middel (de agent) om die door de Klant bepaalde taak uit te voeren.
- b) **De technische keuzes van de agent zijn middel-keuzes, geen doel-bepaling.** Dat de agent zelf bepaalt welke DOM-fragmenten voor het uitvoeren van de taak aan het taalmodel worden voorgelegd en hoe wordt gepseudonimiseerd/gefilterd, betreft de *wijze* van uitvoering (het "hoe"), binnen de door de Klant gegeven instructie en het "waarom". Het maakt Yad niet tot bepaler van het *doel*.
- c) **Wij gebruiken deze gegevens niet voor eigen doeleinden** (zie 5.4 en 4.10). Zodra wij dat wél zouden doen, zouden wij voor dát deel zelf verwerkingsverantwoordelijke worden (art. 28 lid 10 AVG) — wat wij uitsluiten.

> **Eerlijk voorbehoud:** of een toezichthouder of rechter Yad in een concreet geval tóch als (mede-)verwerkingsverantwoordelijke kwalificeert, is een feitelijke en juridische beoordeling die per situatie kan verschillen. Daarom is de rol-analyse onder 5.3 een verplichte, periodiek te herijken randvoorwaarde (hoofdstuk 16), en informeren wij de betrokkenen van de Klant via de hierna beschreven route (5.5) in plaats van ons uitsluitend op de Klant te verlaten.

5.4 **Sluipende rolwijziging voorkomen — gekoppeld aan een controleerbare maatregel.** Wij gebruiken in onze verwerker-rol verkregen gegevens niet voor eigen doeleinden. Dit is geen losse belofte: wij borgen het met **technische scheiding** tussen de verwerker-omgeving en onze eigen administratie en met **audit-logging** op toegang tot sessie-/paginagegevens, zodat oneigenlijk gebruik traceerbaar is. Zouden wij deze gegevens tóch voor eigen doeleinden gebruiken, dan zouden wij voor dat deel zelf verwerkingsverantwoordelijke worden (art. 28 lid 10 AVG); dat is uitdrukkelijk niet onze bedoeling en wij beletten dit in onze processen.

5.5 **Informatie aan betrokkenen van de Klant (art. 14 AVG).** Voor persoonsgegevens van derden die de Dienst in de sessie raakt, is in beginsel de **Klant** verwerkingsverantwoordelijke en moet de Klant die betrokkenen informeren (art. 13/14 AVG). Omdat Yad geen rechtstreekse relatie met deze betrokkenen heeft, informeert Yad hen niet individueel; dat zou een onevenredige inspanning vergen (art. 14 lid 5 sub b AVG). Wel maken wij deze publieke verklaring algemeen toegankelijk, zodat ook betrokkenen van de Klant kunnen nagaan welke rol Yad speelt, en verlenen wij de Klant de wettelijk vereiste bijstand bij het informeren van en het beantwoorden van verzoeken van die betrokkenen (zie 9.3).

---

## 6. Subverwerkers, ontvangers en internationale doorgifte

### 6.1 Categorieën ontvangers

Wij delen persoonsgegevens alleen met partijen die ons helpen de Dienst te leveren, of wanneer wij daartoe wettelijk verplicht zijn. Het gaat om de volgende categorieën:

- **Hostingproviders / cloud-infrastructuur** — voor het draaien van de Dienst en de opslag van gegevens;
- **LLM-providers (taalmodel-aanbieders)** — voor het verwerken van tekstfragmenten die nodig zijn om automatiseringstaken uit te voeren;
- **Betaaldienstverlener(s)** — voor het afhandelen van betalingen;
- **E-mail-, support- en analysetools** — voor communicatie en het functioneren van de Dienst;
- **Professionele adviseurs en toezichthouders / autoriteiten** — uitsluitend indien noodzakelijk of wettelijk verplicht.

### 6.2 Actueel subverwerkersregister

Wij houden een **actueel, opvraagbaar register van alle subverwerkers** bij, met per subverwerker de naam, de soort dienst, de verwerkingslocatie, de doorgifte-waarborg **en of de subverwerker de gegevens voor eigen doeleinden mag gebruiken**. Dit register is beschikbaar `[via [URL/locatie] / op verzoek via [PRIVACY-E-MAIL]]`. Voor de verwerker-rol melden wij voorgenomen wijzigingen in subverwerkers vooraf aan de Klant, zodat deze bezwaar kan maken, overeenkomstig de verwerkersovereenkomst.

| Subverwerker | Dienst | Verwerkingslocatie | Doorgifte-waarborg | Gebruik voor eigen doeleinden? |
|---|---|---|---|---|
| `[NAAM HOSTING]` | Hosting / infrastructuur | `[EU/EER-regio]` | `[n.v.t. (binnen EER) / SCC's + TIA / DPF]` | `[Nee — alleen verwerking in onze opdracht]` |
| `[NAAM LLM-PROVIDER]` | Taalmodel-verwerking | `[EU/EER-regio indien mogelijk]` | `[n.v.t. (binnen EER) / SCC's + TIA / DPF]` | `[Nee — zero-retention/no-training gecontracteerd / JA, namelijk: [abuse-monitoring met menselijke review / retentie X dagen / training] — zie 6.4]` |
| `[NAAM BETAALDIENST]` | Betalingen | `[LOCATIE]` | `[GRONDSLAG]` | `[Eigen verantwoordelijke voor wettelijke betaal-/fraudeplichten]` |
| `[NAAM E-MAIL/SUPPORT]` | Communicatie/support | `[LOCATIE]` | `[GRONDSLAG]` | `[Nee]` |

> `[Vul dit register volledig en waarheidsgetrouw in. Vermeld geen subverwerker als "EU-gehost" als dat niet feitelijk klopt, en vermeld geen "Nee" bij eigen gebruik als de provider de data feitelijk wél voor training, retentie of menselijke review gebruikt — dat zou misleidend zijn en de belofte in 4.10 onwaar maken.]`

### 6.3 EU-residency als uitgangspunt

6.3.1 Wij streven ernaar persoonsgegevens binnen de Europese Economische Ruimte (EER) te verwerken en geven, waar mogelijk, de voorkeur aan **EU-gehoste of EU-regio-subverwerkers** (waaronder voor de taalmodel-verwerking), om doorgifte buiten de EER zoveel mogelijk te vermijden.

### 6.4 LLM-providers: eigen gebruik, retentie en doorgifte buiten de EER

6.4.1 De tekstfragmenten die voor het uitvoeren van een taak aan een LLM-provider worden voorgelegd (3.4) vormen de **hoogste-risico-verwerking** van de Dienst, omdat zij persoonsgegevens van derden en — onbedoeld — mogelijk bijzondere categorieën kunnen bevatten, en omdat doorgifte buiten de EER kan plaatsvinden. Wij behandelen deze verwerking daarom met bijzondere waarborgen:

- a) **Eigen gebruik door de provider.** Wij contracteren met de LLM-provider, waar de markt dit toelaat, **zero-retention en no-training**-voorwaarden: de provider mag de aangeboden fragmenten en de gegenereerde output **niet** gebruiken voor het trainen van modellen of voor eigen doeleinden, en bewaart ze niet langer dan strikt nodig om de taak uit te voeren. Per provider staat in het register (6.2) of dit is afgesproken.
- b) **Eerlijke vermelding bij afwijking.** Gebruikt een door ons gekozen provider de gegevens tóch voor eigen doeleinden (bijvoorbeeld tijdelijke retentie voor misbruikdetectie, menselijke review of training), dan **vermelden wij dat eerlijk** in het register en stemmen wij dit af met de Klant in de DPA. In dat geval geldt de no-training-belofte in 4.10 alleen voor zover het register dat bevestigt; wij wekken niet de indruk dat geen enkel eigen gebruik plaatsvindt terwijl dat feitelijk wel zo is.

6.4.2 **Doorgiftegrondslag buiten de EER.** Wanneer een subverwerker (bijvoorbeeld een LLM-provider) gegevens buiten de EER verwerkt, vindt doorgifte uitsluitend plaats met een geldige waarborg op grond van hoofdstuk V AVG:

- een **adequaatheidsbesluit** van de Europese Commissie (bijvoorbeeld het EU-US Data Privacy Framework voor gecertificeerde Amerikaanse partijen); en/of
- de door de Commissie vastgestelde **Standaardcontractbepalingen (SCC's)**, aangevuld met een **Transfer Impact Assessment (TIA)** en waar nodig aanvullende maatregelen.

6.4.3 Wij vertrouwen niet uitsluitend op één doorgiftegrondslag: waar wij ons baseren op het Data Privacy Framework, houden wij **SCC's als terugvaloptie** achter de hand, voor het geval dat kader zou wijzigen of komen te vervallen.

6.4.4 U kunt een kopie of nadere informatie over de toegepaste waarborgen en over het eigen gebruik door providers opvragen via `[PRIVACY-E-MAIL]`.

---

## 7. Bewaartermijnen

7.1 Wij bewaren persoonsgegevens niet langer dan nodig is voor de doeleinden waarvoor wij ze verwerken, of zolang een wettelijke bewaarplicht dat vereist. **Vul per categorie één vastgestelde termijn of één concreet criterium in; laat geen "range" staan in de definitieve versie.**

| Gegevenscategorie | Bewaartermijn (één termijn/criterium vaststellen) | Reden |
|---|---|---|
| Accountgegevens (3.1) | Gedurende de looptijd van de overeenkomst + `[VASTGESTELDE TERMIJN, bijv. 12 maanden]` na beëindiging | Beheer en heractivering |
| Facturatie-/transactiegegevens (3.2) | `[VASTGESTELDE TERMIJN — minimaal de fiscale bewaarplicht]` | Wettelijke (fiscale) bewaarplicht; in beginsel 7 jaar voor de basisadministratie (art. 52 AWR). `[Let op: voor specifieke gegevens kan een langere termijn gelden; laat dit per administratie vaststellen.]` |
| Telemetrie-/logbestanden (3.3) | `[VASTGESTELDE TERMIJN, bijv. 90 dagen]`; beveiligingslogs `[VASTGESTELDE TERMIJN, bijv. 12 maanden]` | Beveiliging, diagnose, foutopsporing |
| Incidentele pagina-inhoud in logs (3.3 sub b/c) | **Zo kort als operationeel nodig**, en in elk geval `[VASTGESTELDE MAXIMUMTERMIJN]` | Dataminimalisatie; verkleint het lek-oppervlak |
| Sessie-/paginagegevens namens de Klant (3.4) | Volgens de DPA; **zo kort als operationeel nodig**, sessie-artefacten en LLM-prompts/outputs `[VASTGESTELDE TERMIJN, bijv. direct na taakuitvoering / max. X uren]` | Dataminimalisatie |
| Marketinggegevens (4.6) | Tot afmelding/bezwaar, daarna verwijderd of geanonimiseerd | Direct marketing |

7.2 Voor de namens de Klant verwerkte gegevens (3.4) gelden in de eerste plaats de in de verwerkersovereenkomst afgesproken termijnen. Na beëindiging van de Dienst wissen of retourneren wij deze gegevens overeenkomstig die overeenkomst, tenzij wettelijke bewaring vereist is.

7.3 Na afloop van een bewaartermijn worden gegevens verwijderd of onomkeerbaar geanonimiseerd.

---

## 8. Beveiliging

8.1 Wij nemen passende technische en organisatorische maatregelen om persoonsgegevens te beschermen (artikel 32 AVG), waaronder:

- **Versleuteling** van gegevens in transit en, waar passend, at rest;
- **Toegangsbeperking** volgens het principe van minimale rechten (least privilege) en strikte toegangscontrole op de browser-extensie en de achterliggende systemen;
- **Scheiding tussen klanten** (multi-tenant-isolatie), zodat gegevens van verschillende Klanten gescheiden blijven;
- **Technische scheiding** tussen de verwerker-omgeving (sessie-/paginagegevens) en onze eigen administratie, met **audit-logging** op toegang tot sessie-/paginagegevens (zie 5.4);
- **Dataminimalisatie en pseudonimisering/redactie** van wat uit de pagina/DOM wordt gelogd of aan een LLM-provider wordt voorgelegd;
- **Filtering van pagina-inhoud uit onze logs** onder de verantwoordelijke-rol (zie 3.3 sub a);
- **Beperkte bewaring** van sessietokens en cookies — niet langer dan nodig;
- **Logging, monitoring en periodieke evaluatie** van beveiligingsmaatregelen.

8.2 Omdat de Dienst in een reeds **ingelogde sessie** werkt, behandelen wij toegang tot de Dienst met extra zorg: een incident kan immers meerdere Klanten tegelijk raken. Wij richten onze beveiliging op het verkleinen van dit risico (onder meer door minimalisering van wat wordt gelogd en doorgestuurd, en door multi-tenant-isolatie).

8.3 Bij **self-host- of white-label-levering** beheert de Klant (respectievelijk de reseller) een deel van de omgeving zelf. In dat geval ligt de verantwoordelijkheid voor beveiliging, updates en hardening van die zelf-beheerde omgeving bij die partij. De verdeling van beveiligingsverantwoordelijkheden wordt vastgelegd in de overeenkomst en de verwerkersovereenkomst.

---

## 9. Uw rechten als betrokkene

9.1 U heeft op grond van de AVG de volgende rechten met betrekking tot uw persoonsgegevens:

- **Inzage** (art. 15) — weten welke gegevens wij van u verwerken;
- **Rectificatie** (art. 16) — onjuiste gegevens laten corrigeren;
- **Wissing / "vergetelheid"** (art. 17) — gegevens laten verwijderen waar dat kan;
- **Beperking** van de verwerking (art. 18);
- **Overdraagbaarheid** (dataportabiliteit, art. 20) — voor gegevens die u zelf heeft verstrekt en die wij geautomatiseerd verwerken op basis van toestemming of overeenkomst;
- **Bezwaar** (art. 21) — tegen verwerkingen op basis van gerechtvaardigd belang, en altijd en absoluut tegen direct marketing;
- **Intrekken van toestemming** — voor zover een verwerking op toestemming berust, met werking voor de toekomst.

9.2 **Hoe uitoefenen.** Stuur uw verzoek naar `[PRIVACY-E-MAIL]`. Wij vragen u **uitsluitend wanneer wij redelijke twijfel hebben over uw identiteit** om die te bevestigen (art. 12 lid 6 AVG), en wij vragen daarbij **niet meer gegevens dan daarvoor strikt noodzakelijk is**. Wij reageren binnen één maand; bij complexiteit kan deze termijn met twee maanden worden verlengd, waarover wij u dan binnen de eerste maand informeren. Het uitoefenen van uw rechten is in beginsel kosteloos.

9.3 **Verzoeken die de verwerker-rol betreffen.** Gaat uw verzoek over gegevens die wij **namens een Klant** verwerken (hoofdstuk 3.4), dan is die Klant de verwerkingsverantwoordelijke. Wij sturen uw verzoek dan zonder onnodige vertraging door naar de betreffende Klant of verwijzen u door, en verlenen de Klant de wettelijk vereiste bijstand om uw verzoek te kunnen behandelen.

9.4 **Herkomst van gegevens (art. 14 lid 2 sub f).** Verwerken wij persoonsgegevens over u die wij niet rechtstreeks van u hebben verkregen — bijvoorbeeld doordat zij via de sessie van een Klant zichtbaar werden — dan is de **herkomst** in de regel die Klant (of het systeem waarop de Klant de Dienst inzet). Op verzoek lichten wij toe, voor zover wij dat kunnen vaststellen, uit welke bron de gegevens afkomstig zijn.

9.5 **Klachtrecht.** Bent u niet tevreden over hoe wij met uw gegevens omgaan, dan horen wij dat graag eerst van u. U heeft daarnaast altijd het recht een klacht in te dienen bij de toezichthouder. In Nederland is dat de **Autoriteit Persoonsgegevens** (www.autoriteitpersoonsgegevens.nl). Bent u in een ander EU/EER-land gevestigd, dan kunt u terecht bij uw lokale toezichthouder.

---

## 10. Cookies en lokale opslag (website en browser-extensie)

10.1 **Website.** Onze website gebruikt `[cookies en/of vergelijkbare technieken]`. Wij plaatsen functionele en strikt noodzakelijke cookies zonder toestemming; voor analytische en/of marketingcookies vragen wij **vooraf** uw toestemming via een consent-banner die **toestemming-eerst** afdwingt (niet-functionele cookies worden pas geplaatst ná uw toestemming), die u altijd kunt intrekken (art. 11.7a Telecommunicatiewet). Zie ons `[cookiebeleid / cookieverklaring]` op `[URL]` voor de volledige lijst en bewaartermijnen. `[Randvoorwaarde: dit aparte cookiebeleid en de toestemming-eerst-banner moeten bestaan en werken vóór deze verklaring live gaat — zie hoofdstuk 16.]`

10.2 **Browser-extensie / Companion.** De Dienst maakt gebruik van een browser-extensie en/of lokale opslag op uw apparaat om te functioneren. Hierin kunnen worden opgeslagen:

- Sessie- en authenticatiegegevens die nodig zijn om de Dienst te laten werken;
- Configuratie- en voorkeursinstellingen;
- Tijdelijke werkgegevens voor het uitvoeren van een taak.

10.3 De extensie leest pagina-inhoud (de DOM) **uitsluitend** voor zover nodig om de door u of de Klant opgedragen taak uit te voeren. Wij gebruiken deze toegang niet om mee te lezen buiten het doel van de opgedragen taak. Lokale gegevens kunnen doorgaans via de extensie-instellingen of door verwijdering van de extensie worden gewist.

10.4 `[Vermeld hier, indien van toepassing, welke specifieke permissies de extensie vraagt en waarom — conform de transparantie-eisen van de browser-marktplaats.]`

---

## 11. Datalekken (inbreuken in verband met persoonsgegevens)

11.1 Wij hebben procedures om een mogelijk datalek snel te herkennen, te onderzoeken en af te handelen.

11.2 **Onze eigen rol (verantwoordelijke).** Constateren wij een datalek met een risico voor betrokkenen, dan melden wij dit waar vereist binnen **72 uur** na ontdekking aan de Autoriteit Persoonsgegevens (art. 33 AVG) en, bij hoog risico, ook aan de betrokkenen (art. 34 AVG).

11.3 **Onze verwerker-rol.** Constateren wij een (vermoed) datalek bij gegevens die wij **namens een Klant** verwerken, dan informeren wij die Klant **zonder onredelijke vertraging** — overeenkomstig de verwerkersovereenkomst binnen `[VASTGESTELDE TERMIJN, bijv. 48 uur]` na ontdekking — met voldoende informatie zodat de Klant zijn eigen 72-uurstermijn kan halen. De melding aan de Autoriteit Persoonsgegevens doet in dat geval de Klant als verwerkingsverantwoordelijke.

---

## 12. Kinderen

12.1 De Dienst is een zakelijke (B2B) dienst en niet gericht op kinderen. Wij verzamelen niet bewust persoonsgegevens van kinderen onder de 16 jaar. Vermoedt u dat wij toch zulke gegevens hebben verwerkt, neem dan contact met ons op via `[PRIVACY-E-MAIL]`, dan verwijderen wij deze.

---

## 13. AI-transparantie

13.1 Yad is een AI-systeem dat tekst leest, genereert en handelingen verricht. Waar u of uw betrokkenen rechtstreeks met door AI gegenereerde of door AI gestuurde output in aanraking komen, **maken wij dit kenbaar voor zover de EU AI Act ons daartoe verplicht** (onder meer de transparantieverplichtingen van artikel 50 voor AI-systemen die met natuurlijke personen interacteren of content genereren). Dit is een resultaatsverplichting, geen vrijblijvende inspanning. `[De positie van Yad onder de AI Act (aanbieder vs. gebruiksverantwoordelijke) en de geldende ingangsdata moeten door een jurist worden vastgesteld; dat bepaalt welke transparantieplichten precies op u rusten.]`

---

## 14. Wijzigingen in deze privacyverklaring

14.1 Wij kunnen deze privacyverklaring van tijd tot tijd aanpassen, bijvoorbeeld bij wijziging van de Dienst, van subverwerkers of van wetgeving.

14.2 De actuele versie staat altijd op `[URL]`, met vermelding van versienummer en datum. Bij materiële wijzigingen informeren wij u `[via e-mail / in de Dienst]` voordat de wijziging ingaat.

---

## 15. Contact

15.1 Heeft u vragen over deze privacyverklaring of over de verwerking van uw persoonsgegevens? Neem dan contact op:

- **E-mail (privacy):** `[PRIVACY-E-MAIL]`
- **Post:** `[RECHTSPERSOON]`, t.a.v. `[afdeling/FG]`, `[VESTIGINGSADRES]`, `[VESTIGINGSPLAATS]`

---

## 16. Verplichte randvoorwaarden en aanverwante documenten (niet weglaten vóór livegang)

> Dit hoofdstuk is een **checklist voor uzelf en uw jurist**. Het hoort bij dit concept en mag in de gepubliceerde versie worden ingekort of verplaatst naar interne documentatie, maar de onderliggende verplichtingen mogen niet worden overgeslagen.

16.1 **DPIA (art. 35 AVG) — verplicht.** Voor de kern-verwerking (pagina-inhoud/DOM → taalmodel, binnen ingelogde sessies, mogelijk grootschalig en met mogelijk bijzondere categorieën) is een **gegevensbeschermingseffectbeoordeling** vrijwel zeker verplicht (nieuwe technologie, grootschalige verwerking, systematische monitoring). Laat deze DPIA uitvoeren en vaststellen **vóór** de Dienst live gaat. `[U kunt hier desgewenst vermelden dat een DPIA is uitgevoerd; dat vergroot het vertrouwen.]`

16.2 **Rol-analyse verwerker vs. (mede-)verantwoordelijke — verplicht.** Laat de in 5.3 bedoelde analyse door een jurist vaststellen en periodiek herijken; dit is het grootste juridische risico in de keten en bepaalt of uw art. 14-route via de Klant volstaat.

16.3 **LLM-providervoorwaarden — verplicht.** Contracteer zero-retention/no-training waar mogelijk; benoem afwijkingen eerlijk in het register (6.2/6.4). Dit bepaalt of de belofte in 4.10 waarheidsgetrouw is — en is daarmee ook een halal-/eerlijkheidsvoorwaarde.

16.4 **Cookiebeleid + consent-banner — verplicht.** Het aparte cookiebeleid (10.1) moet bestaan en de banner moet toestemming-eerst afdwingen vóór livegang.

16.5 **DPA / verwerker-documentatie — verplicht.** De verwerkersovereenkomst (art. 28 AVG) en eventuele aparte verwerker-/sub-verwerker-bijlage voor Klanten moeten bestaan; deze publieke verklaring verwijst ernaar en vervangt ze niet.

16.6 **Marketing-proces — controleren.** Borg dat het e-mailmarketing-proces de soft-opt-in-grenzen van art. 11.7 Telecommunicatiewet respecteert (4.6) en dat afmelden technisch werkt.

---

> **Herinnering:** dit is een AI-onderzocht **CONCEPT** (`[VERSIE]`, `[DATUM]`) en **geen juridisch advies**. Laat het controleren en vaststellen door een gekwalificeerd jurist, voer eerst de DPIA en de rol-analyse uit, en vul alle plaatshouders waarheidsgetrouw in vóór publicatie. **Vermeld nooit waarborgen, locaties, retentie- of trainingsafspraken of subverwerkers die niet feitelijk juist zijn — een onjuiste privacyverklaring is zowel juridisch riskant als misleidend (en daarmee in strijd met de eerlijkheidstoets).**

---

**Sharia-check resultaat:** GROEN (punt 5 — misleiding — relevant en afgedekt). Het document is strenger eerlijk gemaakt dan het eerste concept: de vrijblijvende voorbehouden rond DOM-in-logs zijn vervangen door een concrete filtering-toezegging plus een eerlijk benoemde restverwerking met art. 14 lid 5 sub b-grondslag (3.3); de no-training-belofte (4.10) is gekoppeld aan een afdwingbare subverwerker-voorwaarde én aan een eerlijke afwijkingsvermelding (6.4), zodat de belofte niet leeg of misleidend wordt; de absolute art. 22-geruststelling is beperkt tot de verantwoordelijke-rol (4.9); marketing is binnen de soft-opt-in van art. 11.7 Tw gebracht (4.6); en de anti-rolwijziging-toezegging is gekoppeld aan technische scheiding en audit-logging (5.4). De verplichte concept/jurist-notitie staat zichtbaar boven én onder, met de DPIA-, rol-analyse- en register-randvoorwaarden expliciet benoemd (hoofdstuk 16). Voorwaarde om groen te blijven: het subverwerkersregister en alle plaatshouders worden waarheidsgetrouw ingevuld.

---

Notitie over de geleverde issues: de twee **blockers** zijn beide geadresseerd — (1) de rol-vermenging is opgelost door deze verklaring strikt tot de verantwoordelijke-rol te begrenzen, de verwerker-rol naar de DPA te verwijzen (hfdst 1.2, 5.2), een onderbouwde rol-analyse met eerlijk voorbehoud op te nemen (5.3) en de art. 14-route via 5.5/9.3/9.4 te dekken; (2) het log-gat is gesloten met de concrete filtering-toezegging plus eerlijk benoemde restverwerking en art. 14 lid 5 sub b-grondslag (3.3). Alle vier **majors** zijn verwerkt: marketing onder art. 11.7 Tw (4.6), LLM-eigen-gebruik in register + zero-retention/no-training (6.2/6.4), DPIA als verplichte randvoorwaarde (3.5, 16.1), en de art. 22-toon beperkt tot de verantwoordelijke-rol (4.9). De vijf **minors** zijn ook gedicht (identiteitsverificatie 9.2, vastgestelde termijnen/criteria 7.1, controleerbare maatregel bij anti-rolwijziging 5.4, cookiebeleid-randvoorwaarde 10.1/16.4, AI-Act-formulering 13.1). De ontbrekende clausules zijn toegevoegd, waaronder herkomst van gegevens (9.4) en geautomatiseerde handelingen onder de Klant (4.9 sub b). Dit document is als deliverable bedoeld voor het "Yad"-product en is niet in deze repo (REDACTED) aangetroffen; er is geen bestaand bestandspad om naar te verwijzen.
