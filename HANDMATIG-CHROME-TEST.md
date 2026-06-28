# De ene handmatige stap: de Hand in Chrome laden

Het Brein, de framing, de handshake en de Windows-host zijn al mechanisch bewezen
(9 unit-tests + een rooktest tegen het echte companion-proces, allemaal groen).
Wat een mens moet doen, omdat ik niet zelf in jouw Chrome kan klikken: de extensie
laden en met eigen ogen "Verbonden met het Brein" zien.

## Eenmalige setup (al gedaan, hier voor de volledigheid)

```
pnpm install
pnpm build
pnpm setup-host        # maakt de vaste sleutel + host-manifest + launcher
pnpm register-host     # zet de host in het Windows-register (Chrome + Edge)
```

## De test (jij, 2 minuten)

1. Open Chrome en ga naar `chrome://extensions`.
2. Zet rechtsboven "Ontwikkelaarsmodus" aan.
3. Klik "Uitgepakte extensie laden" en kies deze map:
   `C:\Code\al-yad\packages\extension\.output\chrome-mv3`
4. Controleer dat de extensie-ID gelijk is aan:
   `lblmbkbfifppfaljefkhpankggekhlfn`
   (Als de ID anders is, klopt de host-registratie niet. Draai dan opnieuw
   `pnpm setup-host` en `pnpm register-host`.)
5. Klik op het Yad-icoon in de toolbar. De side panel opent.
6. Je hoort binnen een seconde een groen bolletje te zien met
   "Verbonden met het Brein", en daaronder de companion-versie, tenant en sessie-id.

Groen = de extensie heeft via native messaging het lokale Brein gestart en de
handshake is gelukt. Dat is de mijlpaal waar alles aan hangt.

## Als het rood blijft

- Foutmelding "Specified native messaging host not found": de host is niet
  geregistreerd of de ID matcht niet. Draai `pnpm register-host` opnieuw en
  controleer de ID uit stap 4.
- Er gebeurt niets: open de service-worker console via
  `chrome://extensions` -> Yad -> "service worker" -> tab Console, en kijk naar de
  foutmeldingen. Het Brein logt naar stderr; die zie je ook daar.
- Controleer dat `packages\companion\dist\main.js` bestaat (anders `pnpm build`).
