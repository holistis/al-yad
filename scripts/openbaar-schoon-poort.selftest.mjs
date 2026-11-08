#!/usr/bin/env node
// Bewijst dat scripts/openbaar-schoon-poort.mjs kan falen en niet te veel afkeurt. Eerst een schone bestandenlijst die moet slagen (ook met alles wat bewust
// is toegestaan), daarna per proef een geplante fout volgens de mutatie-matrix (toevoegen, wijzigen, variant, dubbel, verplaatsen, weghalen, leegmaken), met
// de verwachte bevinding. Tot slot: de echte repo moet schoon zijn.
//
// De testgegevens (adressen, IP's) worden hier tijdens het draaien opgebouwd en staan dus niet als letterlijke tekst in dit bestand: anders zou de poort
// zijn eigen test afkeuren, en zou een echt adres in een voorbeeld in de openbare repo kunnen belanden.
//
// Gebruik: node scripts/openbaar-schoon-poort.selftest.mjs
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scan } from './openbaar-schoon-poort.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mail = (lokaal, domein) => `${lokaal}@${domein}`
const ip = (a, b, c, d) => `${a}.${b}.${c}.${d}`
const PUBLIEK = ip(93, 184, 216, 34)          // een publiek adres dat niet op de toegestane lijst staat
const PUBLIEK2 = ip(45, 83, 12, 7)
let n = 0, mis = 0

const SCHOON = [
  { pad: 'README.md', tekst: 'Built by Someone. Contact: info@mergefix.com. Voorbeeld: demo@voorbeeld.nl en jij@example.com, noreply@github.com.' },
  { pad: 'docs/netwerk.md', tekst: 'Lokaal 127.0.0.1, 0.0.0.0, 192.168.1.50, 10.0.0.5, 172.16.4.2, link-local 169.254.169.254, test 203.0.113.7 en 198.51.100.9, DNS 1.1.1.1 en 8.8.8.8.' },
  { pad: 'src/ua.ts', tekst: `const ua = "Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36"; const v = "pkg@${ip(1, 2, 3, 4)}"; const w = "v${ip(10, 20, 30, 40)}"` },
  { pad: '.env.example', tekst: 'API_KEY=vul-zelf-in' },
  { pad: 'img/logo.png', tekst: `${mail('iemand', 'bedrijf.nl')} ${PUBLIEK}` },   // binaire bestanden worden niet gelezen
  { pad: 'pnpm-lock.yaml', tekst: 'foo@1.2.3 bar@4.5.6' },
]
const met = (extra) => [...SCHOON, ...extra]
const proef = (naam, bestanden, verwacht /* null = schoon, anders deel van de bevinding */) => {
  n++
  const b = scan(bestanden)
  const goed = verwacht === null ? b.length === 0 : b.some((x) => x.toLowerCase().includes(verwacht.toLowerCase()))
  if (!goed) { mis++; console.error(`MIS  ${naam}: verwacht ${verwacht === null ? 'schoon' : '"' + verwacht + '"'}, kreeg ${b.length ? b.join(' | ') : 'niets'}`) } else console.log(`ok   ${naam}`)
}

proef('schone lijst met alles wat bewust mag', SCHOON, null)
proef('leegmaken: geen bestanden', [], null)
proef('leegmaken: leeg bestand', met([{ pad: 'a.md', tekst: '' }]), null)
// Toevoegen: e-mail
proef('toevoegen: persoonlijk adres in een document', met([{ pad: 'docs/x.md', tekst: `mail mij op ${mail('iemand', 'bedrijf.nl')}` }]), 'e-mailadres')
proef('toevoegen: adres in JSON', met([{ pad: 'data/x.json', tekst: `{"mail":"${mail('jan', 'mijnbedrijf.nl')}"}` }]), 'e-mailadres')
proef('toevoegen: adres in een mailto-link', met([{ pad: 'site/p.html', tekst: `<a href="mailto:${mail('privacy', 'mijnbedrijf.nl')}">mail</a>` }]), 'e-mailadres')
proef('variant: hoofdletters', met([{ pad: 'a.md', tekst: mail('INFO', 'MIJNBEDRIJF.NL') }]), 'e-mailadres')
proef('variant: het toegestane adres in hoofdletters mag', met([{ pad: 'a.md', tekst: mail('INFO', 'MERGEFIX.COM') }]), null)
proef('variant: subdomein van een toegestaan domein telt niet mee', met([{ pad: 'a.md', tekst: mail('iemand', 'mail.mergefix.com') }]), 'e-mailadres')
proef('wijzigen: ander adres op het toegestane domein', met([{ pad: 'a.md', tekst: mail('persoon', 'mergefix.com') }]), 'e-mailadres')
proef('dubbel: toegestaan adres plus een persoonlijk adres in hetzelfde bestand', met([{ pad: 'a.md', tekst: `info@mergefix.com en ${mail('iemand', 'bedrijf.nl')}` }]), 'e-mailadres')
// Toevoegen: IP
proef('toevoegen: publiek adres in een document', met([{ pad: 'docs/s.md', tekst: `server op ${PUBLIEK}` }]), 'ipv4')
proef('toevoegen: publiek adres in een URL', met([{ pad: 'src/t.ts', tekst: `const u = "http://${PUBLIEK2}:11434/v1"` }]), 'ipv4')
proef('toevoegen: publiek adres in een shellscript', met([{ pad: 'scripts/d.sh', tekst: `SERVER="${PUBLIEK}"` }]), 'ipv4')
proef('variant: publiek adres direct na een slash (niet als versie behandeld)', met([{ pad: 'a.md', tekst: `Chrome 124.0.0.0 en /${PUBLIEK2}` }]), 'ipv4')
proef('wijzigen: octet buiten bereik is geen adres', met([{ pad: 'a.md', tekst: `build ${ip(999, 300, 1, 1)}` }]), null)
// Toevoegen: wallet
proef('toevoegen: volledig wallet-adres', met([{ pad: 'a.json', tekst: `{"a":"0x${'44a8e811aa00bb11cc22dd33ee44ff5566778899'}"}` }]), 'wallet')
proef('variant: ingekort wallet-adres mag', met([{ pad: 'a.json', tekst: '{"a":"0x44a8e811...fbf53696f"}' }]), null)
// Verboden bestanden
proef('toevoegen: geheugenbestand van de eigenaar', met([{ pad: 'data/selector-memory.json', tekst: '{}' }]), 'hoort niet in de openbare repo')
proef('verplaatsen: geheugenbestand in een submap', met([{ pad: 'packages/x/data/selector-memory.json', tekst: '{}' }]), 'hoort niet in de openbare repo')
proef('toevoegen: herstel-geheugen', met([{ pad: 'data/recovery-store.jsonl', tekst: '' }]), 'hoort niet in de openbare repo')
proef('variant: herstel-geheugen als back-up', met([{ pad: 'data/recovery-store.jsonl.backup-2026-09-07', tekst: '' }]), 'hoort niet in de openbare repo')
proef('toevoegen: .env', met([{ pad: '.env', tekst: 'A=1' }]), 'hoort niet in de openbare repo')
proef('variant: .env.local', met([{ pad: 'packages/a/.env.local', tekst: 'A=1' }]), 'hoort niet in de openbare repo')
proef('toevoegen: privésleutel', met([{ pad: 'keys/server.pem', tekst: '-----BEGIN' }]), 'hoort niet in de openbare repo')
proef('toevoegen: opgeslagen sessie', met([{ pad: 'sessions.json', tekst: '{}' }]), 'hoort niet in de openbare repo')
proef('weghalen: .env.example blijft toegestaan', [{ pad: '.env.example', tekst: 'A=' }], null)
// Een binair/groot bestand (tekst null) mag nooit crashen
proef('leegmaken: bestand zonder leesbare tekst', met([{ pad: 'x/groot.bin', tekst: null }]), null)

// De echte repo
n++
const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts/openbaar-schoon-poort.mjs')], { cwd: ROOT, encoding: 'utf8' })
if (r.status !== 0) { mis++; console.error(`MIS  de echte repo is niet schoon:\n${r.stderr}${r.stdout}`) } else console.log('ok   de echte repo is schoon')

console.log(`\n${n} proeven, ${mis} mis`)
process.exit(mis === 0 ? 0 : 1)
