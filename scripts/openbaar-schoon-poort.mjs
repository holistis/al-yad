// Poort voor de openbare repo: niets van de eigenaar mag erin staan. Werkt met een TOEGESTANE lijst, dus de poort hoeft geen persoonlijke gegevens te noemen.
//
// Geweigerd wordt: bestanden waar een gebruiker zijn eigen gegevens in bewaart (geheugenbestanden, sleutels, sessies, back-ups), elk e-mailadres dat
// niet op de lijst hieronder staat, elk IPv4-adres dat geen privé-, test- of documentatie-adres is, en volledige wallet-adressen.
// Wil je iets nieuws toestaan (een productadres, een publieke DNS), dan moet dat HIER bewust worden toegevoegd.
//
// Gebruik: node scripts/openbaar-schoon-poort.mjs      (scant `git ls-files`; exit 0 = schoon, 1 = gevonden)
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const TOEGESTANE_ADRESSEN = ['info@mergefix.com']
export const TOEGESTANE_MAILDOMEINEN = ['example.com', 'example.org', 'example.net', 'example.invalid', 'voorbeeld.nl', 'invalid', 'localhost', 'users.noreply.github.com']
export const TOEGESTANE_LOKALE_DELEN = ['noreply', 'no-reply']
export const TOEGESTANE_PUBLIEKE_IPS = ['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4', '9.9.9.9']
const VERBODEN_PADEN = [
  /(^|\/)data\/selector-memory\.json$/i,
  /(^|\/)data\/recovery-store\.jsonl/i,
  /(^|\/)\.env(\.[^/]*)?$/i,
  /\.(pem|p12|pfx|keystore)$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/i,
  /\.backup(-|\.)/i,
  /(^|\/)(cookies?|sessions?)\.json$/i,
]
const TOEGESTANE_PADEN = [/(^|\/)\.env\.example$/i]
const MAX_BYTES = 3 * 1024 * 1024
const NEGEER_BESTANDEN = [/(^|\/)pnpm-lock\.yaml$/, /(^|\/)package-lock\.json$/, /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|zip|gz|pdf|mp4|webm)$/i]

const privaat = (a, b) => a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
const documentatie = (a, b, c) => (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)

/** Beoordeelt een lijst bestanden { pad, tekst } en geeft de bevindingen terug. */
export function scan(bestanden) {
  const bevindingen = []
  for (const { pad, tekst } of bestanden) {
    if (VERBODEN_PADEN.some((r) => r.test(pad)) && !TOEGESTANE_PADEN.some((r) => r.test(pad))) bevindingen.push(`${pad}: bestandstype hoort niet in de openbare repo (eigen gegevens, sleutel, sessie of back-up)`)
    if (NEGEER_BESTANDEN.some((r) => r.test(pad)) || typeof tekst !== 'string') continue

    for (const m of tekst.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
      const adres = m[0].toLowerCase()
      const [lokaal, domein] = adres.split('@')
      const veilig = TOEGESTANE_ADRESSEN.includes(adres) || TOEGESTANE_MAILDOMEINEN.includes(domein) || TOEGESTANE_LOKALE_DELEN.includes(lokaal)
      // Pakketnamen als "pkg@1.2.3" matchen niet (domein eindigt op cijfers); bestandsnamen als "naam@2x.png" wel, die zijn geen adres.
      if (!veilig && !/\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|cjs|ts|map)$/.test(adres)) bevindingen.push(`${pad}: e-mailadres dat niet op de toegestane lijst staat (${adres.replace(/^(.{2}).*(@.*)$/, '$1***$2')})`)
    }

    for (const m of tekst.matchAll(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g)) {
      const [a, b, c, d] = m.slice(1).map(Number)
      if ([a, b, c, d].some((x) => x > 255)) continue
      const voor = tekst.slice(Math.max(0, m.index - 12), m.index)
      if (/(Chrome|Safari|Edg|Firefox|Version|Mozilla|AppleWebKit|OPR)\/$|[@vV]$/.test(voor)) continue   // versienummer, geen adres
      if (b === 0 && c === 0 && d === 0) continue                                                         // 124.0.0.0 in een browsernaam
      if (privaat(a, b) || documentatie(a, b, c) || TOEGESTANE_PUBLIEKE_IPS.includes(m[0])) continue
      bevindingen.push(`${pad}: IPv4-adres dat geen privé-, test- of documentatie-adres is (${a}.${b}.x.x)`)
    }

    if (/\b0x[0-9a-fA-F]{40}\b/.test(tekst)) bevindingen.push(`${pad}: volledig wallet-adres`)
  }
  return bevindingen
}

export function leesGetrackteBestanden(root = process.cwd()) {
  const namen = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\0').filter(Boolean)
  return namen.map((pad) => {
    try {
      const st = statSync(`${root}/${pad}`)
      if (!st.isFile() || st.size > MAX_BYTES) return { pad, tekst: null }
      const buf = readFileSync(`${root}/${pad}`)
      return { pad, tekst: buf.subarray(0, 8192).includes(0) ? null : buf.toString('utf8') }
    } catch { return { pad, tekst: null } }   // verwijderd in de werkmap maar nog niet gecommit
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const gevonden = scan(leesGetrackteBestanden())
  if (gevonden.length === 0) { console.log('openbare repo schoon: geen eigen gegevens gevonden'); process.exit(0) }
  console.error(`openbare repo NIET schoon (${gevonden.length}):\n - ` + gevonden.join('\n - '))
  process.exit(1)
}
