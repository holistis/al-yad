// Chrome Web Store publiceer-/update-pijplijn (weg 2 — zonder browser, zonder dashboard).
// Uploadt de gebouwde zip naar een bestaand winkel-item en publiceert. Dit is de AUTONOME
// update-motor: elke volgende versie push je hiermee zonder dat de koning iets doet.
//
// EENMALIG (koning, ~5 min): drie geheimen uit Google halen -> zet ze in webstore-secrets.json:
//   { "client_id": "...", "client_secret": "...", "refresh_token": "...", "item_id": "..." }
//   (item_id verschijnt nadat het item één keer via het dashboard is aangemaakt + listing ingevuld.)
//   webstore-secrets.json staat in .gitignore, komt NOOIT in git.
//
// Gebruik:
//   node scripts/webstore-publish.mjs           -> upload zip + publiceer
//   node scripts/webstore-publish.mjs --upload  -> alleen uploaden (draft), niet publiceren
//   node scripts/webstore-publish.mjs --auth-url -> print de consent-URL (eenmalige stap)
//   node scripts/webstore-publish.mjs --exchange <code> -> ruil consent-code om voor refresh_token
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SECRETS = process.env['WEBSTORE_SECRETS'] ?? resolve(ROOT, 'webstore-secrets.json')
const ZIP = process.env['WEBSTORE_ZIP'] ?? resolve(ROOT, 'yad-winkel-upload.zip')
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore'
const REDIRECT = 'urn:ietf:wg:oauth:2.0:oob' // desktop-app out-of-band: code wordt getoond, geen server nodig

function cfg() {
  if (!existsSync(SECRETS)) throw new Error(`Geen ${SECRETS} — vul client_id/client_secret/refresh_token/item_id in (zie kop van dit bestand).`)
  return JSON.parse(readFileSync(SECRETS, 'utf8'))
}

async function accessToken(c) {
  const body = new URLSearchParams({
    client_id: c.client_id, client_secret: c.client_secret,
    refresh_token: c.refresh_token, grant_type: 'refresh_token',
  })
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })
  const d = await r.json()
  if (!d.access_token) throw new Error('Geen access_token: ' + JSON.stringify(d).slice(0, 200))
  return d.access_token
}

async function main() {
  const arg = process.argv[2]

  if (arg === '--auth-url') {
    const c = cfg()
    const u = new URL('https://accounts.google.com/o/oauth2/auth')
    u.searchParams.set('client_id', c.client_id)
    u.searchParams.set('redirect_uri', REDIRECT)
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('scope', SCOPE)
    u.searchParams.set('access_type', 'offline')
    u.searchParams.set('prompt', 'consent')
    console.log('\nOpen deze URL, log in, klik Toestaan, en plak de getoonde code terug:\n\n' + u.toString() + '\n')
    return
  }

  if (arg === '--exchange') {
    const c = cfg(); const code = process.argv[3]
    if (!code) throw new Error('Geef de consent-code: node scripts/webstore-publish.mjs --exchange <code>')
    const body = new URLSearchParams({
      client_id: c.client_id, client_secret: c.client_secret,
      code, grant_type: 'authorization_code', redirect_uri: REDIRECT,
    })
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })
    const d = await r.json()
    if (!d.refresh_token) throw new Error('Geen refresh_token: ' + JSON.stringify(d).slice(0, 200))
    console.log('\nJe refresh_token (zet in webstore-secrets.json):\n\n' + d.refresh_token + '\n')
    return
  }

  // Normale flow: upload + publiceer
  const c = cfg()
  if (!c.item_id) throw new Error('item_id ontbreekt — maak het item één keer via het dashboard aan, kopieer het item-ID.')
  if (!existsSync(ZIP)) throw new Error('Geen zip: ' + ZIP + ' (bouw eerst: YAD_WINKEL=1 pnpm build + zippen)')
  const token = await accessToken(c)
  const zipBytes = readFileSync(ZIP)

  console.log(`[webstore] upload ${ZIP} -> item ${c.item_id} ...`)
  const up = await fetch(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${c.item_id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2' },
    body: zipBytes,
  })
  const upd = await up.json()
  console.log('[webstore] upload:', JSON.stringify(upd).slice(0, 250))
  if (upd.uploadState && upd.uploadState !== 'SUCCESS') throw new Error('Upload niet SUCCESS — zie hierboven.')

  if (process.argv.includes('--upload')) { console.log('[webstore] klaar (alleen upload, niet gepubliceerd).'); return }

  console.log('[webstore] publiceren ...')
  const pub = await fetch(`https://www.googleapis.com/chromewebstore/v1.1/items/${c.item_id}/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2', 'Content-Length': '0' },
  })
  const pubd = await pub.json()
  console.log('[webstore] publish:', JSON.stringify(pubd).slice(0, 300))
  console.log('[webstore] klaar.')
}

main().catch((e) => { console.error('[webstore] FOUT:', e.message); process.exit(1) })
