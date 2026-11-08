// Poort voor de Chrome Web Store: leest het manifest uit het EXACTE zip dat omhoog gaat en weigert alles wat geen winkelversie is.
//
// WAAROM: er zijn twee versies uit een codebase. De volledige versie (met debugger en cookies, voor eigen gebruik) mag nooit
// in een publieke winkel belanden: het is meer dan het product nodig heeft, het is niet voor iedereen bedoeld en het kan
// het ontwikkelaarsaccount kosten. extension-smoke.mjs controleert de gebouwde MAP; deze poort controleert het ZIP dat echt
// verstuurd wordt, zodat een verkeerd gebouwd of verwisseld bestand niet meer kan doorglippen. Geen omzeilvlag, bewust.
//
// De toegestane lijsten staan hier vast. Komt er ooit een recht bij, dan moet dat HIER bewust worden toegevoegd (en in de
// winkeltekst per recht worden uitgelegd), niet stilletjes via wxt.config.ts.
//
// Gebruik: node scripts/winkelzip-poort.mjs <pad naar zip>      (exit 0 = winkelversie, 1 = geweigerd)
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

export const WINKEL_NAAM = 'Yad, AI browser helper on your own computer'
export const TOEGESTANE_RECHTEN = ['nativeMessaging', 'sidePanel', 'storage', 'tabs', 'scripting', 'webNavigation', 'downloads', 'tabGroups']
export const TOEGESTANE_HOSTS = ['<all_urls>']
// Sleutels die in een winkelmanifest niet horen te staan, ook niet leeg: een leeg optioneel recht is morgen een gevuld recht.
const VERBODEN_SLEUTELS = ['key', 'update_url', 'externally_connectable', 'devtools_page', 'optional_permissions', 'optional_host_permissions', 'chrome_url_overrides', 'declarative_net_request']
const ZWARE_RECHTEN = ['debugger', 'cookies']

/** Geeft de bytes van het bestand `naam` uit een zip, of null als het er niet is. Weigert een zip met twee varianten van manifest.json. */
export function leesBestandUitZip(buf, naam) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('geen geldig zip-bestand (te klein)')
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('geen geldig zip-bestand (geen eindrecord, mogelijk afgekapt)')
  const aantal = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  if (aantal === 0xffff || p === 0xffffffff) throw new Error('zip64 wordt niet ondersteund')
  const treffers = []
  for (let n = 0; n < aantal; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('de inhoudsopgave van het zip is beschadigd')
    const methode = buf.readUInt16LE(p + 10)
    const gecomprimeerd = buf.readUInt32LE(p + 20)
    const naamLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const lokaal = buf.readUInt32LE(p + 42)
    const bestandsnaam = buf.toString('utf8', p + 46, p + 46 + naamLen)
    if (bestandsnaam.toLowerCase().replace(/^\.?\//, '') === naam.toLowerCase()) treffers.push({ bestandsnaam, methode, gecomprimeerd, lokaal })
    p += 46 + naamLen + extraLen + commentLen
  }
  if (treffers.length === 0) return null
  if (treffers.length > 1) throw new Error(`het zip bevat ${treffers.length} bestanden die ${naam} heten (${treffers.map((t) => t.bestandsnaam).join(', ')}): onduidelijk welke de winkel gebruikt`)
  const t = treffers[0]
  if (t.bestandsnaam !== naam) throw new Error(`${naam} staat onder de naam "${t.bestandsnaam}" in het zip, de winkel verwacht precies ${naam} in de hoofdmap`)
  if (t.lokaal + 30 > buf.length || buf.readUInt32LE(t.lokaal) !== 0x04034b50) throw new Error('de inhoudsopgave van het zip wijst naar een beschadigd bestand')
  const start = t.lokaal + 30 + buf.readUInt16LE(t.lokaal + 26) + buf.readUInt16LE(t.lokaal + 28)
  if (start + t.gecomprimeerd > buf.length) throw new Error('het zip is afgekapt')
  const data = buf.subarray(start, start + t.gecomprimeerd)
  if (t.methode === 0) return data
  if (t.methode === 8) return inflateRawSync(data)
  throw new Error(`onbekende compressiemethode ${t.methode}`)
}

/** Beoordeelt een manifest-object. Geeft { ok, redenen }. Alles buiten de vaste lijsten is een reden om te weigeren. */
export function beoordeelWinkelManifest(m) {
  const redenen = []
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return { ok: false, redenen: ['het manifest is geen object'] }
  if (m.manifest_version !== 3) redenen.push(`manifest_version is ${JSON.stringify(m.manifest_version)}, moet 3 zijn`)
  if (m.name !== WINKEL_NAAM) redenen.push(`naam is ${JSON.stringify(m.name)}, moet precies ${JSON.stringify(WINKEL_NAAM)} zijn (de volledige versie heet anders)`)
  if (!/^\d+(\.\d+){1,3}$/.test(String(m.version))) redenen.push(`versie ${JSON.stringify(m.version)} is geen geldig versienummer`)
  const lijst = (veld, toegestaan) => {
    const w = m[veld]
    if (w === undefined) return
    if (!Array.isArray(w) || w.some((x) => typeof x !== 'string')) { redenen.push(`${veld} is geen lijst van tekst`); return }
    for (const x of w) {
      if (toegestaan.includes(x)) continue
      redenen.push(ZWARE_RECHTEN.includes(x)
        ? `${veld} bevat "${x}": dat is de volledige versie voor eigen gebruik, die hoort niet in de winkel`
        : `${veld} bevat "${x}", dat staat niet op de toegestane lijst (alleen bewust toe te voegen in scripts/winkelzip-poort.mjs)`)
    }
  }
  lijst('permissions', TOEGESTANE_RECHTEN)
  lijst('host_permissions', TOEGESTANE_HOSTS)
  for (const s of VERBODEN_SLEUTELS) if (s in m) redenen.push(`het manifest bevat "${s}", dat hoort niet in de winkelversie`)
  const csp = JSON.stringify(m.content_security_policy ?? '')
  if (csp.includes('unsafe-eval')) redenen.push('content_security_policy staat unsafe-eval toe')
  return { ok: redenen.length === 0, redenen }
}

/** Leest het zip, haalt manifest.json eruit en beoordeelt het. Gooit nooit: elke fout wordt een reden om te weigeren. */
export function poortWinkelzip(pad) {
  let manifest
  try {
    const bytes = leesBestandUitZip(readFileSync(pad), 'manifest.json')
    if (bytes === null) return { ok: false, redenen: ['manifest.json staat niet in de hoofdmap van het zip'] }
    try { manifest = JSON.parse(bytes.toString('utf8')) } catch { return { ok: false, redenen: ['manifest.json is geen geldige JSON'] } }
  } catch (e) {
    return { ok: false, redenen: [`het zip kon niet gelezen worden: ${e.message}`] }
  }
  const r = beoordeelWinkelManifest(manifest)
  return { ...r, naam: manifest?.name, versie: manifest?.version, rechten: Array.isArray(manifest?.permissions) ? manifest.permissions : [] }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pad = process.argv[2]
  if (!pad) { console.error('gebruik: node scripts/winkelzip-poort.mjs <pad naar zip>'); process.exit(2) }
  const r = poortWinkelzip(pad)
  if (r.ok) { console.log(`winkelzip OK: ${r.naam} ${r.versie}, rechten: ${r.rechten.join(', ')}`); process.exit(0) }
  console.error('winkelzip GEWEIGERD:\n - ' + r.redenen.join('\n - '))
  process.exit(1)
}
