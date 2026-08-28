# Mijlpalen Yad, 28 augustus 2026

Overzicht van wat er op deze datum echt is gebouwd en vastgelegd, met bewijs erbij zodat dit
navolgbaar blijft.

## README herstructurering

Volgorde omgegooid naar een bewijs-eerst opbouw: Demo, Architecture, Benchmark, Install,
Security, Roadmap, Research. Demo-sectie verwijst nu naar de echte, al bestaande video
(`https://yadagent.com/yad-invoice-demo-en.mp4`). Security-sectie samengevat op basis van de
live pagina `yadagent.com/yad-security` (de opdracht noemde per ongeluk een verkeerde URL,
gecorrigeerd voor er een dode link in de README kon komen).

Commit: `5538a80` op branch `feat/yad-onboarding-copy`.

## Provider/model-logging in de benchmark

`AgentLoop` hield nooit bij welk provider:model een taak echt beantwoordde, alleen dat de pool
ooit iets teruggaf. Toegevoegd via `providersUsed` (zelfde patroon als de bestaande
`hadRecovery`/`lastStuckSignalId`-getters), doorgekoppeld naar `benchmark.ts`'s `TaskResult`.

Commit: `a48c307` op branch `feat/yad-onboarding-copy`.

Direct iets echts mee gevonden: een taak die het verkeerde antwoord gaf, bleek te zijn
afgehandeld door het BETAALDE gpt-4o-mini-model (dezelfde modelklasse als de 92%-claim op de
site), niet door een zwak gratis model. Dat verlegt de echte bug naar hoe Yad een stukje tekst
op de pagina kiest om te lezen (ref-selectie), niet naar modelkwaliteit. Nog niet gefixt, wacht
op meer data uit de bredere testronde.

## Benchmark, eerste echte metingen

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

## Voorbereide, nog niet uitgevoerde stukken

- Eerlijk testplan tegen browser-use (metrics, twee testmodi, aparte sectie "waar Yad
  verliest"), nog niet gedraaid, kost echte tijd en geld, wacht op akkoord.
- Lijst van 24 echte, opgezochte mensen voor technische feedback, niemand benaderd.
- Eerste "Yad Research Log"-artikel over een Power BI dropdown-bug, in een parallelle sessie
  geschreven, niet in dit bestand, zie `site/blog-stuck-in-loops.html` als die daar al staat.

## Wat hier bewust niet in staat

Distributiewerk voor het andere product (DeFi Signal API / Execution Stress Index) staat niet
hier, dat is een ander project (`wazir-al-ghanima`), niet Yad. Zie daar het eigen geheugen voor
die mijlpalen.
