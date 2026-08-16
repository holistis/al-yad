#!/usr/bin/env node
/**
 * CAPACITEITSPROEF — kan YAD nog steeds alles wat een mens kan?
 *
 * AANLEIDING (2026-08-16):
 * Bij een inventarisatie bleek YAD acht dingen niet te kunnen die een mens moeiteloos
 * doet, en het ergste faalde stil: een JavaScript-dialoogvenster bevroor de hele tab
 * terwijl de statusmeter vrolijk "connected" bleef melden. Voor iets dat verhuurd of
 * verkocht wordt is dat dodelijk, want de klant ziet groen terwijl er niets gebeurt.
 *
 * Alles is daarna gerepareerd. Deze proef bestaat om te voorkomen dat het stilletjes
 * terugkomt. Hij draait tegen een ECHTE browser op een ECHTE pagina, niet tegen mocks:
 * elk van die reparaties werkte namelijk pas na een live test, en twee ervan bleken bij
 * die test iets anders te doen dan ik dacht.
 *
 * Wat hij toetst, allemaal met bewijs uit de pagina zelf:
 *   1. dialoogvenster bevriest de tab niet meer
 *   2. shadow DOM is zichtbaar voor de agent
 *   3. same-origin iframe is zichtbaar
 *   4. cross-origin iframe is zichtbaar en bedienbaar
 *   5. slepen komt aan bij de dropzone
 *   6. rechtermuisknop komt aan
 *   7. terug-navigatie werkt
 *   8. kopieren levert de tekst op
 *   9. downloaden en het bestand terugkrijgen
 *  10. de statusmeter is eerlijk over traagheid
 *
 * De proef zet zijn eigen webservers op, dus er is geen voorbereiding nodig. Draai hem
 * na elke wijziging aan de hand, de waarneming of het protocol.
 *
 * Draaien: node scripts/capaciteitsproef.mjs
 * Als cron (elke 6 uur): 0 star/6 star star star  (schrijf de sterren uit in de crontab)
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const YAD = process.env.YAD_URL ?? "http://localhost:3747";
const POORT_HOOFD = Number(process.env.PROEF_POORT ?? 8891);
const POORT_VREEMD = POORT_HOOFD + 1;
const UITSLAG_PAD = process.env.PROEF_UITSLAG ?? join(HIER, "..", ".proef-uitslag.json");

/** De proefpagina. Bewust hier ingebakken zodat de proef zichzelf kan draaien. */
const HOOFD_HTML = `<!doctype html><meta charset="utf-8"><title>YAD capaciteitsproef</title>
<body style="font:15px system-ui;padding:20px">
<h1>YAD capaciteitsproef</h1>
<button id="knop-dialog">Open bevestiging</button><div id="uit2">-</div>
<div id="schaduw-host"></div><div id="uit4">-</div>
<iframe id="fr" style="width:100%;height:70px"></iframe><div id="uit3">-</div>
<a id="dl" download="proef.txt" href="data:text/plain;base64,aGV0IGJlc3RhbmQgaXMgYmlubmVu">Download proef.txt</a>
<div id="sleep" draggable="true" style="width:80px;padding:8px;background:#eee">sleep mij</div>
<div id="dropzone" tabindex="0" role="group" aria-label="laat hier los" style="border:2px dashed #888;padding:16px">laat hier los</div>
<div id="uit6">-</div>
<div id="rechts" tabindex="0" style="padding:8px;background:#eee">klik rechts op mij</div><div id="uit7">-</div>
<div id="uit8">-</div>
<iframe id="vreemd" src="http://127.0.0.1:${POORT_VREEMD}/" style="width:400px;height:110px"></iframe>
<script>
document.getElementById('knop-dialog').onclick=()=>{
  const ja=confirm('Doorgaan?');
  document.getElementById('uit2').textContent = ja ? 'OK-geklikt' : 'geannuleerd';
};
const fr=document.getElementById('fr');
fr.srcdoc='<body><input id="veld" placeholder="typ hier"></body>';
const root=document.getElementById('schaduw-host').attachShadow({mode:'open'});
root.innerHTML='<button id="sb">knop in schaduw</button>';
root.getElementById('sb').onclick=()=>{document.getElementById('uit4').textContent='schaduw-geklikt';};
const s=document.getElementById('sleep'), z=document.getElementById('dropzone');
s.addEventListener('dragstart',e=>e.dataTransfer.setData('text','lading'));
z.addEventListener('dragover',e=>e.preventDefault());
z.addEventListener('drop',e=>{e.preventDefault();document.getElementById('uit6').textContent='ontving-'+e.dataTransfer.getData('text');});
document.getElementById('rechts').addEventListener('contextmenu',e=>{e.preventDefault();document.getElementById('uit7').textContent='rechtsklik-ontvangen';});
history.pushState({},'',location.pathname+'?stap=2');
addEventListener('popstate',()=>{document.getElementById('uit8').textContent='terug-werkte';});
</script>`;

const VREEMD_HTML = `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:8px">
<h3>vreemd frame</h3><input id="kaartnr" placeholder="kaartnummer"><button id="ok">Bevestig</button>
<div id="uit">-</div>
<script>document.getElementById('ok').onclick=()=>{document.getElementById('uit').textContent='bevestigd-'+document.getElementById('kaartnr').value;};</script>`;

// ── kleine hulpjes ───────────────────────────────────────────────────────────

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(pad, body, timeoutMs = 30_000) {
  const r = await fetch(YAD + pad, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return r.json();
}
async function get(pad, timeoutMs = 30_000) {
  const r = await fetch(YAD + pad, { signal: AbortSignal.timeout(timeoutMs) });
  return r.json();
}
const evalueer = (expr) => post("/cdp/evaluate", { expression: expr });
const doe = (action) => post("/act", { action });

/** Leest een tekstveld uit de pagina; geeft "" als het niet lukt. */
async function leesUit(id) {
  const r = await evalueer(`document.getElementById(${JSON.stringify(id)})?.textContent ?? ""`);
  return typeof r?.value === "string" ? r.value.replace(/^"|"$/g, "") : "";
}

/**
 * Navigeert en controleert dat het gelukt is.
 *
 * YAD's tab-koppeling is berucht instabiel na een herstart: navigate meldt ok terwijl de
 * tab op about:blank blijft. Daarom navigeren via de pagina zelf, dan adopteren, en dan
 * pas verder. Zonder deze omweg meet je de verkeerde tab en trek je conclusies over een
 * lege pagina, wat mij tijdens het bouwen twee keer is overkomen.
 */
async function gaNaar(url) {
  for (let poging = 1; poging <= 3; poging++) {
    await evalueer(`location.href = ${JSON.stringify(url)}; 1`).catch(() => {});
    await wacht(2500);
    await post("/adopt-tab", { pattern: String(POORT_HOOFD) }).catch(() => {});
    const r = await evalueer("location.href").catch(() => null);
    if (typeof r?.value === "string" && r.value.includes(String(POORT_HOOFD))) return true;
  }
  return false;
}

async function snapshot() {
  const r = await get("/snapshot");
  return r?.snapshot ?? { nodes: [], url: "" };
}
const zoekRef = (nodes, tekst) => nodes.find((n) => (n.name ?? "").includes(tekst))?.ref ?? null;

// ── de proeven ───────────────────────────────────────────────────────────────

const uitslagen = [];
function noteer(naam, gelukt, detail) {
  uitslagen.push({ naam, gelukt, detail: String(detail ?? "").slice(0, 160) });
  console.log(`  ${gelukt ? "OK  " : "FOUT"}  ${naam}${detail ? ` — ${String(detail).slice(0, 90)}` : ""}`);
}

async function main() {
  // Eigen servers, zodat de proef nergens van afhangt.
  const s1 = createServer((_q, r) => { r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(HOOFD_HTML); }).listen(POORT_HOOFD);
  const s2 = createServer((_q, r) => { r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(VREEMD_HTML); }).listen(POORT_VREEMD);
  await wacht(400);

  try {
    const st = await get("/status").catch(() => null);
    if (!st?.connected) {
      console.error("YAD is niet verbonden met Chrome — proef afgebroken");
      process.exitCode = 2;
      return;
    }

    // Verse laadbeurt afdwingen met een unieke parameter, anders serveert Chrome de
    // vorige versie en toets je oude HTML.
    if (!(await gaNaar(`http://localhost:${POORT_HOOFD}/?p=${Date.now()}`))) {
      console.error("kon niet op de proefpagina komen — proef afgebroken");
      process.exitCode = 2;
      return;
    }
    await wacht(1200);

    const snap = await snapshot();
    const n = snap.nodes ?? [];

    // 2, 3, 4: ziet de agent wat er te zien valt
    noteer("shadow DOM zichtbaar", !!zoekRef(n, "knop in schaduw"), `${n.length} elementen`);
    noteer("same-origin iframe zichtbaar", !!zoekRef(n, "typ hier"), "");
    const vreemdRef = zoekRef(n, "kaartnummer");
    noteer("cross-origin iframe zichtbaar", !!vreemdRef, vreemdRef ?? "niet gevonden");

    // 1: dialoogvenster bevriest niet meer
    const dref = zoekRef(n, "Open bevestiging");
    if (dref) {
      await doe({ kind: "click", ref: dref }).catch(() => {});
      const leeft = await evalueer("1+1").catch(() => null);
      noteer("dialoogvenster bevriest de tab niet", leeft?.value === 2 || leeft?.value === "2", `1+1 gaf ${leeft?.value}`);
    } else {
      noteer("dialoogvenster bevriest de tab niet", false, "knop niet gevonden");
    }

    // 5: slepen
    const van = zoekRef(n, "sleep mij"), naar = zoekRef(n, "laat hier los");
    if (van && naar) {
      await doe({ kind: "drag", ref: van, toRef: naar });
      noteer("slepen komt aan", (await leesUit("uit6")).includes("ontving-lading"), await leesUit("uit6"));
    } else noteer("slepen komt aan", false, "sleep- of dropzone-element niet waargenomen");

    // 6: rechtermuisknop
    const rref = zoekRef(n, "klik rechts");
    if (rref) {
      await doe({ kind: "right-click", ref: rref });
      noteer("rechtermuisknop komt aan", (await leesUit("uit7")).includes("rechtsklik-ontvangen"), await leesUit("uit7"));
    } else noteer("rechtermuisknop komt aan", false, "element niet waargenomen");

    // 8: kopieren (klembord mag weigeren; de tekst moet terugkomen)
    if (rref) {
      const r = await doe({ kind: "copy", ref: rref });
      noteer("kopieren levert tekst op", !!r?.result?.extracted, r?.result?.extracted ?? r?.result?.detail);
    }

    // 4b: bedienen in het vreemde frame
    if (vreemdRef) {
      const r = await doe({ kind: "type", ref: vreemdRef, text: "4111" });
      noteer("typen in cross-origin frame", r?.result?.ok === true, r?.result?.detail ?? "");
    }

    // 9: downloaden
    const sinds = Date.now();
    const dlRef = zoekRef(n, "Download proef.txt");
    if (dlRef) {
      await doe({ kind: "click", ref: dlRef }).catch(() => {});
      await wacht(3000);
      const d = await get(`/downloads?sinds=${sinds}`).catch(() => null);
      const eerste = d?.downloads?.[0];
      noteer("download komt binnen met pad", !!eerste?.filename, eerste?.filename ?? "niets binnengekomen");
    } else noteer("download komt binnen met pad", false, "downloadlink niet waargenomen");

    // 7: terug-navigatie
    await doe({ kind: "history", direction: "back" });
    await wacht(800);
    noteer("terug-navigatie werkt", (await leesUit("uit8")).includes("terug-werkte"), await leesUit("uit8"));

    // 10: eerlijke statusmeter
    const diep = await get("/status?deep=1").catch(() => null);
    noteer(
      "statusmeter meet de pagina echt",
      diep?.responsive === true && typeof diep?.reactieMs === "number",
      `reactie ${diep?.reactieMs}ms, gezond=${diep?.gezond}`,
    );
  } finally {
    s1.close();
    s2.close();
  }

  const mislukt = uitslagen.filter((u) => !u.gelukt);
  const record = { ts: new Date().toISOString(), totaal: uitslagen.length, mislukt: mislukt.length, uitslagen };
  try {
    mkdirSync(dirname(UITSLAG_PAD), { recursive: true });
    writeFileSync(UITSLAG_PAD, JSON.stringify(record, null, 2));
  } catch { /* opslaan is bijzaak, de uitkomst staat al op het scherm */ }

  console.log(`\n${uitslagen.length - mislukt.length}/${uitslagen.length} mogelijkheden werken`);
  if (mislukt.length) {
    console.log("KAPOT:");
    for (const m of mislukt) console.log(`  - ${m.naam}: ${m.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("proef crashte:", e.message);
  process.exitCode = 2;
});
