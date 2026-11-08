#!/usr/bin/env node
// Bewijst dat scripts/winkelzip-poort.mjs kan falen. Bouwt zips in het geheugen, eist dat het echte winkelmanifest slaagt en plant daarna
// een fout per keer (volgens de mutatie-matrix: wijzigen, weghalen, toevoegen, dubbel, omwisselen, leegmaken, afkappen, variant) en eist dat de
// poort elke keer weigert, met de reden die erbij hoort. Daarna: het uploadscript zelf moet een slecht zip weigeren VOORDAT het iets naar Google stuurt.
//
// Gebruik: node scripts/winkelzip-poort.selftest.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { poortWinkelzip, WINKEL_NAAM, TOEGESTANE_RECHTEN } from './winkelzip-poort.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'winkelzip-selftest-'))
let fouten = 0, n = 0

const crcTabel = Array.from({ length: 256 }, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTabel[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

/** Minimale zip-schrijver: bestanden = [{ naam, data: Buffer, opslaan?: true }] */
function maakZip(bestanden) {
  const delen = [], centraal = []
  let offset = 0
  for (const f of bestanden) {
    const naam = Buffer.from(f.naam), data = Buffer.from(f.data)
    const comp = f.opslaan ? data : deflateRawSync(data)
    const methode = f.opslaan ? 0 : 8
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(methode, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12)
    lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(naam.length, 26); lh.writeUInt16LE(0, 28)
    delen.push(lh, naam, comp)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(methode, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14)
    ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(naam.length, 28); ch.writeUInt32LE(offset, 42)
    centraal.push(ch, naam)
    offset += 30 + naam.length + comp.length
  }
  const cd = Buffer.concat(centraal)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(bestanden.length, 8); eocd.writeUInt16LE(bestanden.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...delen, cd, eocd])
}

// Het echte winkelmanifest van 0.1.15, zonder de bestanden die er niet toe doen voor deze poort.
const BASIS = {
  manifest_version: 3,
  name: WINKEL_NAAM,
  version: '0.1.15',
  description: 'Automate browser tasks in plain English, using your own AI key.',
  permissions: [...TOEGESTANE_RECHTEN],
  host_permissions: ['<all_urls>'],
  side_panel: { default_path: 'sidepanel.html' },
  background: { service_worker: 'background.js' },
}
const met = (wijzig) => { const m = JSON.parse(JSON.stringify(BASIS)); wijzig(m); return m }
const zipMet = (m, opties = {}) => maakZip([{ naam: 'background.js', data: Buffer.from('//') }, { naam: opties.manifestNaam ?? 'manifest.json', data: Buffer.from(typeof m === 'string' ? m : JSON.stringify(m)), opslaan: opties.opslaan }])

function proef(naam, zip, verwacht /* null = moet slagen, anders deel van de reden */) {
  n++
  const pad = join(tmp, `z${n}.zip`)
  writeFileSync(pad, zip)
  const r = poortWinkelzip(pad)
  const goed = verwacht === null ? r.ok : !r.ok && r.redenen.join(' | ').toLowerCase().includes(verwacht.toLowerCase())
  if (!goed) { fouten++; console.error(`MIS  ${naam}: verwacht ${verwacht === null ? 'OK' : 'weigering met "' + verwacht + '"'}, kreeg ${r.ok ? 'OK' : r.redenen.join(' | ')}`) }
  else console.log(`ok   ${naam}`)
  return pad
}

// 1. De winkelversie zelf moet slagen (een poort die alles weigert is ook blind, de andere kant op).
proef('het echte winkelmanifest (gecomprimeerd)', zipMet(BASIS), null)
proef('het echte winkelmanifest (opgeslagen zonder compressie)', zipMet(BASIS, { opslaan: true }), null)
// 2. Weghalen/leegmaken/dubbel van rechten mag: een kleinere set is nooit gevaarlijker.
proef('weghalen: recht "tabs" eruit', zipMet(met((m) => { m.permissions = m.permissions.filter((x) => x !== 'tabs') })), null)
proef('leegmaken: geen rechten', zipMet(met((m) => { m.permissions = [] })), null)
proef('dubbel: "tabs" twee keer', zipMet(met((m) => { m.permissions.push('tabs') })), null)
// 3. Toevoegen: elk recht buiten de lijst moet geweigerd worden.
proef('toevoegen: debugger', zipMet(met((m) => { m.permissions.push('debugger') })), 'volledige versie')
proef('toevoegen: cookies', zipMet(met((m) => { m.permissions.push('cookies') })), 'volledige versie')
proef('toevoegen: de hele volledige set (debugger en cookies)', zipMet(met((m) => { m.permissions.push('cookies', 'debugger') })), 'volledige versie')
proef('toevoegen: onbekend recht "history"', zipMet(met((m) => { m.permissions.push('history') })), 'toegestane lijst')
proef('toevoegen: webRequest', zipMet(met((m) => { m.permissions.push('webRequest') })), 'toegestane lijst')
proef('toevoegen: extra host', zipMet(met((m) => { m.host_permissions.push('https://*/*') })), 'toegestane lijst')
proef('toevoegen: optioneel recht debugger (later alsnog te vragen)', zipMet(met((m) => { m.optional_permissions = ['debugger'] })), 'optional_permissions')
proef('leegmaken: lege optional_permissions telt ook niet', zipMet(met((m) => { m.optional_permissions = [] })), 'optional_permissions')
proef('toevoegen: externally_connectable (websites mogen praten met de extensie)', zipMet(met((m) => { m.externally_connectable = { matches: ['*://*/*'] } })), 'externally_connectable')
proef('toevoegen: devtools_page', zipMet(met((m) => { m.devtools_page = 'devtools.html' })), 'devtools_page')
proef('toevoegen: unsafe-eval in de CSP', zipMet(met((m) => { m.content_security_policy = { extension_pages: "script-src 'self' 'unsafe-eval'" } })), 'unsafe-eval')
proef('toevoegen: ontwikkelsleutel (key)', zipMet(met((m) => { m.key = 'MIIB...' })), '"key"')
proef('toevoegen: update_url', zipMet(met((m) => { m.update_url = 'https://example.invalid/u.xml' })), 'update_url')
// 4. Wijzigen/variant: de naam van de volledige versie, hoofdletters, versie, manifestversie, type.
proef('wijzigen: naam van de volledige versie', zipMet(met((m) => { m.name = 'Yad (full version)' })), 'naam is')
proef('variant: winkelnaam in hoofdletters', zipMet(met((m) => { m.name = WINKEL_NAAM.toUpperCase() })), 'naam is')
proef('weghalen: naam ontbreekt', zipMet(met((m) => { delete m.name })), 'naam is')
proef('wijzigen: manifest_version 2', zipMet(met((m) => { m.manifest_version = 2 })), 'manifest_version')
proef('wijzigen: onzinversie', zipMet(met((m) => { m.version = 'latest' })), 'geen geldig versienummer')
proef('variant: rechten als tekst in plaats van lijst', zipMet(met((m) => { m.permissions = 'tabs' })), 'geen lijst van tekst')
proef('variant: een recht dat geen tekst is', zipMet(met((m) => { m.permissions = [1] })), 'geen lijst van tekst')
// 5. Het zip zelf: dubbel, omwisselen/verplaatsen, ontbreken, afkappen, kapot.
proef('dubbel: twee manifest.json (goede eerst, volledige versie erachter)', maakZip([{ naam: 'manifest.json', data: Buffer.from(JSON.stringify(BASIS)) }, { naam: 'manifest.json', data: Buffer.from(JSON.stringify(met((m) => { m.permissions.push('debugger') }))) }]), 'onduidelijk welke')
proef('variant: Manifest.json met hoofdletter', zipMet(BASIS, { manifestNaam: 'Manifest.json' }), 'in de hoofdmap')
proef('omwisselen: manifest in een submap', zipMet(BASIS, { manifestNaam: 'extensie/manifest.json' }), 'niet in de hoofdmap')
proef('weghalen: geen manifest.json', maakZip([{ naam: 'background.js', data: Buffer.from('//') }]), 'niet in de hoofdmap')
proef('leegmaken: leeg zip', maakZip([]), 'niet in de hoofdmap')
proef('leegmaken: leeg bestand', Buffer.alloc(0), 'te klein')
const heel = zipMet(BASIS)
proef('afkappen: laatste 10 bytes weg', heel.subarray(0, heel.length - 10), 'kon niet gelezen worden')
proef('afkappen: de helft', heel.subarray(0, Math.floor(heel.length / 2)), 'kon niet gelezen worden')
proef('variant: geen zip maar tekst', Buffer.from('dit is geen zip, maar wel lang genoeg om niet te klein te zijn'), 'kon niet gelezen worden')
proef('wijzigen: manifest is geen JSON', zipMet('{ dit is geen json'), 'geen geldige JSON')
proef('variant: manifest is een lijst', zipMet('[]'), 'geen object')
proef('variant: manifest is null', zipMet('null'), 'geen object')
// 6. Een bestand dat niet bestaat.
n++
const r0 = poortWinkelzip(join(tmp, 'bestaat-niet.zip'))
if (r0.ok || !r0.redenen[0].includes('kon niet gelezen worden')) { fouten++; console.error('MIS  niet-bestaand bestand moet geweigerd worden') } else console.log('ok   niet-bestaand bestand')

// 7. Het uploadscript zelf moet een slecht zip weigeren voordat het iets naar Google stuurt. Nepgeheimen: bereikt het script de netwerkstap toch, dan zou de fout anders zijn.
const geheimen = join(tmp, 'geheimen.json')
writeFileSync(geheimen, JSON.stringify({ client_id: 'nep', client_secret: 'nep', refresh_token: 'nep', item_id: 'nep' }))
const slecht = proef('(voor het uploadscript) volledige versie met debugger', zipMet(met((m) => { m.permissions.push('debugger', 'cookies') })), 'volledige versie')
for (const args of [[], ['--upload']]) {
  n++
  const u = spawnSync(process.execPath, [join(HERE, 'webstore-publish.mjs'), ...args], { env: { ...process.env, WEBSTORE_SECRETS: geheimen, WEBSTORE_ZIP: slecht }, encoding: 'utf8', timeout: 20000 })
  const uit = `${u.stdout}${u.stderr}`
  const goed = u.status === 1 && uit.includes('Winkelzip geweigerd') && !uit.includes('upload ') && !uit.includes('access_token')
  if (!goed) { fouten++; console.error(`MIS  uploadscript ${args.join(' ') || '(publiceren)'} moet het zip weigeren voor het netwerk: exit ${u.status}, uitvoer: ${uit.slice(0, 200)}`) } else console.log(`ok   uploadscript ${args.join(' ') || '(publiceren)'} weigert het zip voor er iets verstuurd wordt`)
}

rmSync(tmp, { recursive: true, force: true })
console.log(`\n${n} proeven, ${fouten} mis`)
process.exit(fouten === 0 ? 0 : 1)
