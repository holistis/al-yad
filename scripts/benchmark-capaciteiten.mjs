#!/usr/bin/env node
/**
 * BENCHMARK CAPACITEITEN — meet per competentie of YAD nog kan wat een mens kan.
 *
 * VERSCHIL MET DE BESTAANDE BENCHMARK (scripts/benchmark.ts):
 * Die meet TAKEN: een doel in gewone taal, door een taalmodel gepland, over echte
 * websites. Uitstekend om te weten of het geheel werkt, maar ongeschikt om een losse
 * mogelijkheid te beoordelen: als "download het rapport" faalt, weet je niet of de hand
 * niet kan downloaden of dat het model een verkeerd plan maakte. En je meet mee hoe druk
 * het gratis modelquotum die dag is.
 *
 * Deze benchmark meet de HAND, deterministisch en zonder taalmodel. Elke competentie is
 * een losse meting met een score en een reactietijd, tegen een echte browser op een
 * echte pagina. Twee keer draaien geeft hetzelfde antwoord, en als iets kapotgaat wijst
 * de uitslag meteen de competentie aan.
 *
 * SCORES, in dezelfde geest als de bestaande benchmark:
 *   1.0  werkt, bewezen met bewijs uit de pagina zelf
 *   0.5  werkt gedeeltelijk of kon niet volledig worden aangetoond
 *   0.0  werkt niet
 *
 * De uitslag gaat naar een geschiedenisbestand, zodat je kunt zien of iets is
 * teruggevallen in plaats van alleen wat de stand vandaag is.
 *
 * Draaien: node scripts/benchmark-capaciteiten.mjs
 */

import { createServer } from "node:http";
import { writeFileSync, appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const WORTEL = join(HIER, "..");
const YAD = process.env.YAD_URL ?? "http://localhost:3747";
const P1 = Number(process.env.BENCH_POORT ?? 8901);
const P2 = P1 + 1;
const UITSLAG = process.env.BENCH_UITSLAG ?? join(WORTEL, "data", "capaciteiten-laatste.json");
const HISTORIE = process.env.BENCH_HISTORIE ?? join(WORTEL, "data", "capaciteiten-historie.jsonl");

const HOOFD = `<!doctype html><meta charset="utf-8"><title>capaciteiten</title><body style="font:15px system-ui;padding:16px">
<button id="dlg">Open bevestiging</button><div id="u2">-</div>
<div id="host"></div><div id="u4">-</div>
<iframe id="fr" style="width:100%;height:60px"></iframe>
<a id="dl" download="bench.txt" href="data:text/plain;base64,YmVuY2htYXJrLWJlc3RhbmQ=">Download bench.txt</a>
<div id="sleep" draggable="true" style="width:90px;padding:8px;background:#eee">sleep mij</div>
<div id="zone" tabindex="0" role="group" aria-label="laat hier los" style="border:2px dashed #888;padding:14px">laat hier los</div><div id="u6">-</div>
<div id="rechts" tabindex="0" style="padding:8px;background:#eee">klik rechts op mij</div><div id="u7">-</div>
<div id="u8">-</div>
<div id="laat">nog niet geladen</div>
<iframe id="vreemd" src="http://127.0.0.1:${P2}/" style="width:380px;height:100px"></iframe>
<script>
setTimeout(()=>{document.getElementById('laat').textContent='GELADEN';},2500);
document.getElementById('dlg').onclick=()=>{const j=confirm('Doorgaan?');document.getElementById('u2').textContent=j?'ok-geklikt':'geannuleerd';};
document.getElementById('fr').srcdoc='<body><input id="veld" placeholder="typ hier"></body>';
const r=document.getElementById('host').attachShadow({mode:'open'});
r.innerHTML='<button id="sb">knop in schaduw</button>';
r.getElementById('sb').onclick=()=>{document.getElementById('u4').textContent='schaduw-geklikt';};
const s=document.getElementById('sleep'),z=document.getElementById('zone');
s.addEventListener('dragstart',e=>e.dataTransfer.setData('text','lading'));
z.addEventListener('dragover',e=>e.preventDefault());
z.addEventListener('drop',e=>{e.preventDefault();document.getElementById('u6').textContent='ontving-'+e.dataTransfer.getData('text');});
document.getElementById('rechts').addEventListener('contextmenu',e=>{e.preventDefault();document.getElementById('u7').textContent='rechtsklik-ok';});
history.pushState({},'',location.pathname+'?s=2');
addEventListener('popstate',()=>{document.getElementById('u8').textContent='terug-ok';});
</script>`;

const VREEMD = `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:6px">
<input id="kaartnr" placeholder="kaartnummer"><button id="ok">Bevestig</button><div id="u">-</div>
<script>document.getElementById('ok').onclick=()=>{document.getElementById('u').textContent='ok-'+document.getElementById('kaartnr').value;};</script>`;

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(pad, body, ms = 30_000) {
  const r = await fetch(YAD + pad, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(ms),
  });
  return r.json();
}
const get = async (pad, ms = 30_000) => (await fetch(YAD + pad, { signal: AbortSignal.timeout(ms) })).json();
const evalueer = (e) => post("/cdp/evaluate", { expression: e });
const doe = (action) => post("/act", { action });

async function leesUit(id) {
  const r = await evalueer(`document.getElementById(${JSON.stringify(id)})?.textContent ?? ""`).catch(() => null);
  return typeof r?.value === "string" ? r.value.replace(/^"|"$/g, "") : "";
}

/**
 * Navigeren met controle. YAD's tab-koppeling is na een herstart berucht instabiel:
 * navigate meldt ok terwijl de tab op about:blank blijft staan. Zonder deze lus meet je
 * een lege pagina en concludeer je dat alles kapot is.
 */
async function gaNaar(url) {
  for (let i = 0; i < 4; i++) {
    await post("/navigate", { url, sync: true }, 25_000).catch(() => {});
    await evalueer(`location.href = ${JSON.stringify(url)}; 1`).catch(() => {});
    await wacht(2200);
    await post("/adopt-tab", { pattern: String(P1) }).catch(() => {});
    const r = await evalueer("location.href").catch(() => null);
    if (typeof r?.value === "string" && r.value.includes(String(P1))) return true;
  }
  return false;
}

const snapshot = async () => (await get("/snapshot").catch(() => null))?.snapshot ?? { nodes: [] };
const zoek = (nodes, tekst) => nodes.find((n) => (n.name ?? "").includes(tekst))?.ref ?? null;

// ── de competenties ──────────────────────────────────────────────────────────

const metingen = [];
function meet(competentie, categorie, score, bewijs, ms) {
  metingen.push({ competentie, categorie, score, bewijs: String(bewijs ?? "").slice(0, 120), ms });
  const merk = score === 1 ? "1.0" : score === 0.5 ? "0.5" : "0.0";
  console.log(`  ${merk}  ${competentie.padEnd(30)} ${String(ms ?? "").padStart(6)}ms  ${bewijs ?? ""}`);
}

async function main() {
  const s1 = createServer((_q, r) => { r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(HOOFD); }).listen(P1);
  const s2 = createServer((_q, r) => { r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(VREEMD); }).listen(P2);
  await wacht(400);

  try {
    const st = await get("/status", 10_000).catch(() => null);
    if (!st?.connected) { console.error("YAD niet verbonden met Chrome — benchmark afgebroken"); process.exitCode = 2; return; }
    if (!(await gaNaar(`http://localhost:${P1}/?b=${Date.now()}`))) {
      console.error("kon niet op de benchmarkpagina komen — afgebroken"); process.exitCode = 2; return;
    }
    await wacht(1000);

    console.log("\nWAARNEMING — ziet de agent wat er te zien valt");
    let t = Date.now();
    const n = (await snapshot()).nodes ?? [];
    const snapMs = Date.now() - t;
    meet("snapshot-snelheid", "waarneming", snapMs < 3000 ? 1 : 0.5, `${n.length} elementen`, snapMs);
    meet("shadow DOM", "waarneming", zoek(n, "knop in schaduw") ? 1 : 0, zoek(n, "knop in schaduw") ?? "niet gezien", 0);
    meet("same-origin iframe", "waarneming", zoek(n, "typ hier") ? 1 : 0, zoek(n, "typ hier") ?? "niet gezien", 0);
    const vreemd = zoek(n, "kaartnummer");
    meet("cross-origin iframe", "waarneming", vreemd ? 1 : 0, vreemd ?? "niet gezien", 0);
    meet("sleepbaar element", "waarneming", zoek(n, "sleep mij") ? 1 : 0, zoek(n, "sleep mij") ?? "niet gezien", 0);
    meet("tabindex-element", "waarneming", zoek(n, "laat hier los") ? 1 : 0, zoek(n, "laat hier los") ?? "niet gezien", 0);

    console.log("\nHANDELING — kan hij doen wat een mens doet");
    const dref = zoek(n, "Open bevestiging");
    if (dref) {
      t = Date.now();
      await doe({ kind: "click", ref: dref }).catch(() => {});
      const leeft = await evalueer("1+1").catch(() => null);
      const ms = Date.now() - t;
      const ok = leeft?.value === 2 || leeft?.value === "2";
      meet("dialoogvenster overleven", "handeling", ok ? 1 : 0, ok ? "tab reageert nog" : "TAB BEVROREN", ms);
    } else meet("dialoogvenster overleven", "handeling", 0, "knop niet waargenomen", 0);

    const van = zoek(n, "sleep mij"), naar = zoek(n, "laat hier los");
    if (van && naar) {
      t = Date.now();
      await doe({ kind: "drag", ref: van, toRef: naar }).catch(() => {});
      const u = await leesUit("u6");
      meet("slepen", "handeling", u.includes("ontving-lading") ? 1 : 0, u || "geen reactie", Date.now() - t);
    } else meet("slepen", "handeling", 0, "elementen niet waargenomen", 0);

    const rref = zoek(n, "klik rechts");
    if (rref) {
      t = Date.now();
      await doe({ kind: "right-click", ref: rref }).catch(() => {});
      const u = await leesUit("u7");
      meet("rechtermuisknop", "handeling", u.includes("rechtsklik-ok") ? 1 : 0, u || "geen reactie", Date.now() - t);
      t = Date.now();
      const c = await doe({ kind: "copy", ref: rref }).catch(() => null);
      meet("kopieren", "handeling", c?.result?.extracted ? 1 : 0, c?.result?.extracted ?? "niets", Date.now() - t);
    }

    if (vreemd) {
      t = Date.now();
      const r = await doe({ kind: "type", ref: vreemd, text: "4111" }).catch(() => null);
      meet("typen in vreemd frame", "handeling", r?.result?.ok ? 1 : 0, r?.result?.detail ?? "ok", Date.now() - t);
    }

    const dlRef = zoek(n, "Download bench.txt");
    if (dlRef) {
      const sinds = Date.now();
      t = Date.now();
      await doe({ kind: "click", ref: dlRef }).catch(() => {});
      await wacht(3000);
      const d = await get(`/downloads?sinds=${sinds}`).catch(() => null);
      const f = d?.downloads?.[0]?.filename;
      meet("downloaden", "handeling", f ? 1 : 0, f ?? "niets binnengekomen", Date.now() - t);
    } else meet("downloaden", "handeling", 0, "link niet waargenomen", 0);

    t = Date.now();
    await doe({ kind: "history", direction: "back" }).catch(() => {});
    await wacht(700);
    const u8 = await leesUit("u8");
    meet("terug-navigatie", "handeling", u8.includes("terug-ok") ? 1 : 0, u8 || "geen reactie", Date.now() - t);

    console.log("\nBETROUWBAARHEID — is de meter eerlijk");
    t = Date.now();
    const diep = await get("/status?deep=1", 20_000).catch(() => null);
    meet(
      "statusmeter meet echt",
      "betrouwbaarheid",
      typeof diep?.reactieMs === "number" ? 1 : 0,
      `responsive=${diep?.responsive} gezond=${diep?.gezond} reactie=${diep?.reactieMs}ms`,
      Date.now() - t,
    );
  } finally {
    s1.close(); s2.close();
  }

  // ── uitslag ────────────────────────────────────────────────────────────────
  const totaal = metingen.reduce((s, m) => s + m.score, 0);
  const perCat = {};
  for (const m of metingen) {
    perCat[m.categorie] ??= { aantal: 0, score: 0 };
    perCat[m.categorie].aantal++;
    perCat[m.categorie].score += m.score;
  }

  console.log(`\n═══ UITSLAG ═══`);
  for (const [cat, v] of Object.entries(perCat)) {
    console.log(`  ${cat.padEnd(18)} ${v.score.toFixed(1)}/${v.aantal}  (${Math.round((v.score / v.aantal) * 100)}%)`);
  }
  console.log(`  ${"TOTAAL".padEnd(18)} ${totaal.toFixed(1)}/${metingen.length}  (${Math.round((totaal / metingen.length) * 100)}%)`);

  const kapot = metingen.filter((m) => m.score < 1);
  if (kapot.length) {
    console.log("\nNIET (volledig) IN ORDE:");
    for (const k of kapot) console.log(`  ${k.score.toFixed(1)}  ${k.competentie}: ${k.bewijs}`);
  }

  const record = {
    ts: new Date().toISOString(),
    totaalScore: Number(totaal.toFixed(2)),
    aantal: metingen.length,
    percentage: Math.round((totaal / metingen.length) * 100),
    perCategorie: perCat,
    metingen,
  };
  try {
    mkdirSync(dirname(UITSLAG), { recursive: true });
    writeFileSync(UITSLAG, JSON.stringify(record, null, 2));
    appendFileSync(HISTORIE, JSON.stringify(record) + "\n");
  } catch { /* opslaan is bijzaak */ }

  // Vergelijken met de vorige run: een terugval is belangrijker nieuws dan de stand zelf.
  try {
    if (existsSync(HISTORIE)) {
      const regels = readFileSync(HISTORIE, "utf8").trim().split("\n").filter(Boolean);
      if (regels.length > 1) {
        const vorig = JSON.parse(regels[regels.length - 2]);
        const verschil = record.totaalScore - vorig.totaalScore;
        if (verschil < 0) console.log(`\nLET OP: TERUGVAL van ${vorig.totaalScore} naar ${record.totaalScore} sinds ${vorig.ts.slice(0, 16)}`);
        else if (verschil > 0) console.log(`\nVooruitgang: van ${vorig.totaalScore} naar ${record.totaalScore}`);
        else console.log(`\nGelijk aan de vorige run (${vorig.ts.slice(0, 16)})`);
      }
    }
  } catch { /* historie lezen is bijzaak */ }

  if (kapot.some((k) => k.score === 0)) process.exitCode = 1;
}

main().catch((e) => { console.error("benchmark crashte:", e.message); process.exitCode = 2; });
