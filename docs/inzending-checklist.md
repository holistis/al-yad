# YAD naar de winkel: wat er klaar is en wat er nog moet

Bijgewerkt 16 augustus 2026. Vervangt het losse stukje "nog nodig" in `winkelpagina-concept.md`.

---

## De route, en waarom deze

Onderzocht op 16 augustus 2026 met primaire bronnen. De belangrijkste correctie op wat we
eerder dachten: **de `debugger`-permissie is gewoon toegestaan.** Google noemt de Debugger API
zelfs expliciet als een van precies twee uitzonderingen op het verbod op code van buitenaf, en
Voice In (26.000 installaties) kwam er in januari 2026 nog mee door de keuring. Er is geen
enkel gedocumenteerd geval gevonden van een afwijzing wegens `debugger`.

Wat wél telt:

1. **De keuring bij Chrome duurt nu ongeveer vier weken.** Het Web Store-team meldde op
   24 april 2026 zelf een stortvloed aan inzendingen. Wij raken alle vier de
   vertragingsfactoren tegelijk: nieuwe ontwikkelaar, nieuwe extensie, zware permissies en
   `<all_urls>`. Opnieuw indienen tijdens het wachten zet je achteraan in de rij.
2. **Edge heeft een geschreven regel die onze bouwwijze toestaat.** Artikel 1.2.3 van hun
   ontwikkelaarsbeleid zegt letterlijk dat een extensie voor zijn kernfunctie afhankelijk mag
   zijn van andere software, mits je dat duidelijk vermeldt. Chrome heeft zo'n regel niet, en
   de vraag of een lokaal programma telt als "code van buitenaf" is door Google nooit
   beantwoord. Edge keurt in vijf tot tien dagen. En Edge zit juist bij bedrijven, onze koper.
3. **Buiten een winkel om distribueren is praktisch dood.** Sinds Chrome 33 mag Windows geen
   losse crx-bestanden meer installeren. De enige uitzondering is een bedrijfsbeleid op een
   machine die aan Active Directory hangt, en sinds Chrome 149 (2 juni 2026) heb je dan ook
   nog een derde instelling nodig anders werkt de debugger daar niet meer.

**Daarom: eerst Edge, tegelijk Chrome als niet-vermeld (unlisted).** Niet-vermeld betekent
dezelfde keuring maar geen publieke pagina: klanten installeren via een directe link, met
gewone automatische updates. Voor zakelijke verkoop is dat prettiger dan een openbare pagina
met consumentenrecensies.

---

## Waarom de winkelversie minder rechten vraagt

De winkelversie vraagt zeven rechten in plaats van negen. Weg zijn `debugger` en `cookies`.

Dit is **geen uitgeklede versie om langs de keuring te komen**. Dat patroon bestaat, het heet
bij Google intern Blue Titanium, en het kost je je hele ontwikkelaarsaccount. Wat hier gebeurt
is iets anders: die twee rechten dienden nooit het product.

Nagekeken in de code: klikken, typen, lezen, wachten, navigeren en downloaden lopen allemaal
via het content-script. De debugger werd alleen gebruikt voor netwerkverkeer inzien en
onderscheppen, en cookies voor het overzetten van sessies tussen browsers. Dat zijn de
gereedschappen voor het eigen beveiligingsonderzoek in REDACTED, niet voor de
boekhouder die facturen uit portalen haalt.

**Gemeten, niet aangenomen.** De capaciteiten-benchmark op beide versies:

| | volledige versie | winkelversie |
|---|---|---|
| totaal | 13/14 (93%) | 13/14 (93%) |
| waarneming, inclusief cross-origin iframe | 6/6 | 6/6 |
| handeling | 6/7 | 6/7 |

Drie rondes op de winkelversie, één op de volledige. De eerste winkelronde gaf 12/13 met een
uitval op cross-origin iframe; twee latere rondes gaven daar gewoon een punt. Dat was ruis van
een net herladen extensie, geen echt verschil. Eén meting is geen meting.

Er is nog een reden om de debugger uit het product te houden die niet in de scores zit: Chrome
zet bij gebruik ervan permanent de balk "Yad started debugging this browser" boven elk
tabblad. Anthropic heeft dat voor hun eigen extensie niet opgelost en het verzoek gesloten als
"niet gepland". Voor een boekhouder is dat geen ongemak maar een reden om het niet te kopen.

De volledige versie blijft gewoon bestaan voor eigen gebruik, in `.output/chrome-mv3`. De
winkelversie bouw je met `YAD_WINKEL=1 pnpm build` en die landt in `.output-winkel/`, apart,
zodat een winkelbuild nooit stilletjes je werkversie vervangt.

---

## Tekst per permissie, klaar om te plakken

Dit gaat naar een menselijke beoordelaar. Geen opmaak, geen jargon.

**Doel van de extensie (single purpose)**

> Yad voert terugkerend werk uit in de browser van de gebruiker zelf. De gebruiker beschrijft
> in gewone taal wat er moet gebeuren, bijvoorbeeld het maandelijks ophalen van facturen uit
> een leveranciersportaal, en Yad klikt, typt, wacht en haalt op wat nodig is. Het werk gebeurt
> in de bestaande sessie van de gebruiker, op zijn eigen computer.

**nativeMessaging**

> Yad werkt samen met een programma dat de gebruiker zelf op zijn computer installeert. Daar
> gebeurt het plannen en het onthouden. Die keuze is bewust: zo blijven de gegevens van de
> gebruiker op zijn eigen machine in plaats van op onze servers. De extensie kan niet zonder
> dit programma zijn volledige werk doen, en dat staat duidelijk in de beschrijving en bij de
> eerste start.

**tabs**

> Om te weten in welk tabblad de opdracht draait, en om te merken wanneer de gebruiker naar
> een ander tabblad gaat of dat tabblad sluit. Zonder dit zou Yad handelingen kunnen uitvoeren
> in een tabblad waar de gebruiker niet meer is.

**scripting**

> Om het leesscript in de pagina te zetten dat de knoppen en velden in kaart brengt en de
> handelingen uitvoert. Dit is de kern van de extensie.

**webNavigation**

> Om te weten wanneer een pagina klaar is met laden, ook in ingesloten frames. Zonder dit zou
> Yad klikken op een knop die er nog niet staat.

**downloads**

> Veel taken eindigen met een bestand, bijvoorbeeld het ophalen van een factuur. Met dit recht
> ziet Yad of het bestand daadwerkelijk binnenkwam en waar het is opgeslagen, zodat hij de
> gebruiker een bruikbaar antwoord kan geven in plaats van een gok.

**storage**

> Voor de instellingen en de opgeslagen taken van de gebruiker. Alles blijft lokaal.

**sidePanel**

> Het bedieningspaneel waarin de gebruiker zijn opdracht typt en de voortgang volgt.

**host_permissions: <all_urls>**

> De gebruiker bepaalt zelf op welke sites hij Yad inzet. Dat zijn vaak portalen van
> leveranciers, boekhoudpakketten en overheidsomgevingen die per klant verschillen en die wij
> vooraf niet kunnen kennen. Een vaste lijst zou het product voor het merendeel van de
> gebruikers onbruikbaar maken. Yad leest alleen de pagina waarop de gebruiker hem op dat
> moment een opdracht heeft gegeven, en doet niets op de achtergrond op andere sites. Er wordt
> geen paginainhoud naar ons verstuurd; de extensie maakt zelf geen enkele verbinding met
> internet.

**Verzameling van gebruikersgegevens (het formulier met de vinkjes)**

> Aankruisen: geen enkele categorie, mits de klant de lokale stand gebruikt. Gebruikt hij een
> taalmodel in de cloud, dan gaat paginainhoud naar de aanbieder die hij zelf kiest en is de
> eerlijke aankruising "Website content", met de toelichting dat dit naar de door de gebruiker
> gekozen aanbieder gaat en niet naar ons.

---

## Wat er nog moet gebeuren

**Door mij, kan meteen:**

- [x] Winkelversie gebouwd, apart van de werkversie
- [x] Zip klaar: `packages/extension/.output-winkel/yad-winkel-v0.1.1.zip` (92,5 kB)
- [x] Korte, waarheidsgetrouwe privacyverklaring: `packages/extension/public/legal/privacy-kort.html`
- [x] Permissie-teksten hierboven
- [ ] De extensie moet zonder het lokale programma iets zinnigs doen. Nu is hij dood zonder.
      Dit is het verschil tussen doorkomen en afgewezen worden op "single purpose is launching
      another app". Zie de open punten hieronder.
- [ ] Privacyverklaring op een openbare URL zetten (nu alleen in de extensie zelf)

**Door de koning, en alleen door hem:**

1. Vijf dollar eenmalig voor het ontwikkelaarsaccount, met tweestapsverificatie aan.
2. Schermafbeeldingen, 1280x800, minimaal drie. Er staan echte pagina's op, dus dat is jouw
   keuze en niet de mijne.
3. Twee gegevens die ik niet mag verzinnen en niet kon vinden: het **vestigingsadres** en een
   **e-mailadres voor privacy- en beveiligingsvragen**. De rest staat er al in: Holistisch
   Adviseur, KvK 86816632.
4. Beslissen of we ook bij Edge indienen. Mijn advies is ja, en zelfs eerst.

---

## Open risico's, eerlijk benoemd

**Het grootste: telt een lokaal programma als "code van buitenaf"?** Google heeft die vraag
nooit beantwoord. De enige plek waar hij letterlijk gesteld is, kreeg antwoord van iemand die
zelf schrijft niet bij Google te horen. 1Password, KeePassXC, Zotero en Ui.Vision doen precies
hetzelfde en staan er al jaren, dus het patroon werkt. Maar het is een patroon, geen belofte.

**Yellow Lithium.** Google verwijdert extensies waarvan het enige doel is een ander programma
te starten. Yad is nu precies dat: zonder de companion doet hij niets. Ui.Vision komt hier
doorheen omdat hun extensie ook zonder hun modules werkt. Dit is het punt waar ik nog iets aan
moet doen voordat we indienen.

**De extensie-ID.** In het manifest zit een vaste sleutel, zodat de ID gelijk blijft en de
koppeling met het lokale programma blijft werken. Of de Web Store die sleutel overneemt of een
eigen ID uitdeelt, weet ik niet zeker. Wijst de store een andere ID toe, dan moet het
installatieprogramma die ID registreren. Merkbaar, oplosbaar, maar reken erop.

**Herhaalde downloads.** In de benchmark faalt "downloaden" bij de tweede en derde ronde in
hetzelfde browservenster. Uitgezocht: het bestand komt dan niet eens op schijf, dus Yad meldt
het correct. Het is Chrome die herhaalde automatische downloads tegenhoudt. Bij een verse
browser werkt het altijd. Geen fout van ons, maar wel iets om te weten voordat een klant het
meldt. Onderweg wel een echt gat gedicht: de lijst met binnengekomen bestanden overleefde niet
dat de service worker in slaap viel, en dat doet hij nu wel.
