#!/usr/bin/env node
/**
 * Maakt de schermafbeeldingen voor de winkelpagina, 1280x800.
 *
 * WAAROM ZO EN NIET MET EEN ONTWERPPROGRAMMA: de winkel wil zien wat het product doet, en
 * een nagetekend plaatje is precies het soort belofte waar een koper later boos over wordt.
 * Daarom laadt dit script de ECHTE gebouwde extensie in een echte Chromium, opent het echte
 * zijpaneel, en fotografeert dat. Wat je op de plaatjes ziet is dus letterlijk de software.
 *
 * Alleen de inhoud is verzonnen: een demoportaal op localhost dat eruitziet als het soort
 * leveranciersportaal waar de doelgroep facturen uit haalt. Dat mag, want het toont echte
 * werking met voorbeeldgegevens. Wat NIET mag en hier dus ook niet gebeurt: functies laten
 * zien die er niet zijn.
 *
 * Draaien vanuit de repo-root:
 *   node scripts/maak-winkelplaatjes.mjs
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const WORTEL = join(HIER, "..");
const EXT = join(WORTEL, "packages", "extension", ".output-winkel", "chrome-mv3");
const UIT = join(WORTEL, "docs", "winkelplaatjes");
const EXT_ID = readFileSync(join(WORTEL, "packages", "extension", ".keys", "ext-id.txt"), "utf8").trim();
const POORT = 8123;

// Playwright staat in de companion, niet in de wortel. Via die require-context oplossen
// scheelt een dubbele installatie van 300 MB aan browsers.
const eis = createRequire(join(WORTEL, "packages", "companion", "package.json"));
const { chromium } = eis("playwright");

/** Het demoportaal. Bewust saai en herkenbaar: zo ziet het werk van de koper eruit. */
const PORTAAL = `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<title>Demo Leveranciersportaal</title><style>
*{box-sizing:border-box} body{margin:0;font:14px/1.5 system-ui,sans-serif;color:#111827;background:#f9fafb}
header{background:#1e3a5f;color:#fff;padding:14px 24px;display:flex;align-items:center;gap:12px}
header .logo{width:26px;height:26px;background:#60a5fa;border-radius:5px}
header h1{font-size:16px;margin:0;font-weight:600}
header .wie{margin-left:auto;font-size:13px;opacity:.85}
nav{background:#fff;border-bottom:1px solid #e5e7eb;padding:0 24px;display:flex;gap:22px}
nav a{padding:12px 0;text-decoration:none;color:#4b5563;font-size:13px;border-bottom:2px solid transparent}
nav a.actief{color:#1e3a5f;border-bottom-color:#1e3a5f;font-weight:600}
main{padding:22px 24px}
h2{font-size:17px;margin:0 0 4px}
.sub{color:#6b7280;font-size:13px;margin:0 0 18px}
.filters{display:flex;gap:10px;margin-bottom:14px}
select,input{padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;background:#fff}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden}
th{background:#f3f4f6;text-align:left;padding:10px 12px;font-size:12px;color:#4b5563;font-weight:600}
td{padding:10px 12px;border-top:1px solid #f3f4f6;font-size:13px}
td.bedrag{text-align:right;font-variant-numeric:tabular-nums}
.dl{color:#1d4ed8;text-decoration:none}
.badge{background:#dcfce7;color:#166534;padding:2px 8px;border-radius:999px;font-size:11px}
.badge.open{background:#fef3c7;color:#92400e}
</style></head><body>
<header><div class="logo"></div><h1>Demo Leveranciersportaal</h1><span class="wie">Ingelogd als demo@voorbeeld.nl</span></header>
<nav><a href="#">Overzicht</a><a href="#" class="actief">Facturen</a><a href="#">Bestellingen</a><a href="#">Instellingen</a></nav>
<main>
<h2>Facturen</h2><p class="sub">Periode maart 2026 tot en met augustus 2026</p>
<div class="filters">
  <select><option>Alle jaren</option><option selected>2026</option></select>
  <select><option>Alle maanden</option></select>
  <input placeholder="Zoek op factuurnummer">
</div>
<table><thead><tr><th>Factuurnummer</th><th>Datum</th><th>Omschrijving</th><th>Status</th><th style="text-align:right">Bedrag</th><th>Bestand</th></tr></thead><tbody>
${[
  ["2026-03-0148", "12-03-2026", "Maandelijkse licentie", "Betaald", "241,90"],
  ["2026-04-0192", "11-04-2026", "Maandelijkse licentie", "Betaald", "241,90"],
  ["2026-05-0237", "13-05-2026", "Maandelijkse licentie + meerwerk", "Betaald", "389,15"],
  ["2026-06-0281", "12-06-2026", "Maandelijkse licentie", "Betaald", "241,90"],
  ["2026-07-0330", "10-07-2026", "Maandelijkse licentie", "Betaald", "241,90"],
  ["2026-08-0374", "12-08-2026", "Maandelijkse licentie", "Openstaand", "241,90"],
]
  .map(
    ([nr, d, o, s, b]) =>
      `<tr><td>${nr}</td><td>${d}</td><td>${o}</td><td><span class="badge${s === "Openstaand" ? " open" : ""}">${s}</span></td><td class="bedrag">&euro; ${b}</td><td><a class="dl" href="data:text/plain;base64,ZmFjdHV1cg==" download="factuur-${nr}.pdf">Download PDF</a></td></tr>`,
  )
  .join("\n")}
</tbody></table>
</main></body></html>`;

/** Zet het zijpaneel in de stand die we willen fotograferen. */
async function stelPaneelIn(pagina, gesprek) {
  await pagina.evaluate(async (regels) => {
    // De akkoordpoort overslaan: die is echt, maar hij hoort niet op een winkelplaatje.
    await chrome.storage.local.set({ yad_acceptance: { accepted: true, at: Date.now(), version: 1 } });
    document.querySelector("#gate")?.classList.add("hidden");
    document.querySelector("#app")?.classList.remove("hidden");

    const dot = document.querySelector("#dot");
    if (dot) dot.className = "dot verbonden";
    const label = document.querySelector("#conn-label");
    if (label) label.textContent = "Verbonden";

    // De echte klassen uit sidepanel/index.html: .cb is een bubbel, .u is de gebruiker,
    // .a is Yad, .a.ok is een geslaagd resultaat en .step is een tussenregel.
    const chat = document.getElementById("chat-messages");
    if (chat) {
      chat.innerHTML = "";
      for (const r of regels) {
        const d = document.createElement("div");
        d.className = `cb ${r.klasse}`;
        d.textContent = r.tekst;
        chat.appendChild(d);
      }
      chat.scrollTop = chat.scrollHeight;
    }
  }, gesprek);
  await pagina.waitForTimeout(350);
}

async function main() {
  mkdirSync(UIT, { recursive: true });
  const server = createServer((_q, r) => {
    r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    r.end(PORTAAL);
  }).listen(POORT);

  const ctx = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 880, height: 800 },
  });

  try {
    const portaal = await ctx.newPage();
    await portaal.goto(`http://localhost:${POORT}/`, { waitUntil: "networkidle" });
    await portaal.waitForTimeout(600);
    const portaalPng = join(UIT, "_portaal.png");
    await portaal.screenshot({ path: portaalPng });
    console.log("portaal gefotografeerd");

    const paneel = await ctx.newPage();
    await paneel.setViewportSize({ width: 400, height: 800 });
    await paneel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`, { waitUntil: "domcontentloaded" });
    await paneel.waitForTimeout(900);

    const scenes = [
      {
        naam: "_paneel-1-opdracht",
        gesprek: [
          { klasse: "u", tekst: "Haal alle facturen van 2026 uit dit portaal en zet ze in mijn downloadmap." },
          { klasse: "a", tekst: "Ik zie 6 facturen in de tabel. Ik open ze een voor een en bewaar de PDF's." },
        ],
      },
      {
        naam: "_paneel-2-bezig",
        gesprek: [
          { klasse: "u", tekst: "Haal alle facturen van 2026 uit dit portaal en zet ze in mijn downloadmap." },
          { klasse: "a", tekst: "Ik zie 6 facturen in de tabel. Ik open ze een voor een en bewaar de PDF's." },
          { klasse: "step", tekst: "Klik op Download PDF bij 2026-05-0237" },
          { klasse: "step", tekst: "Bestand opgeslagen: factuur-2026-05-0237.pdf" },
          { klasse: "a", tekst: "4 van 6 opgehaald. Bezig met factuur 2026-07-0330." },
        ],
      },
      {
        naam: "_paneel-3-klaar",
        gesprek: [
          { klasse: "u", tekst: "Haal alle facturen van 2026 uit dit portaal en zet ze in mijn downloadmap." },
          { klasse: "step", tekst: "6 downloadlinks gevonden en aangeklikt" },
          {
            klasse: "a ok",
            tekst:
              "Klaar. 6 facturen opgehaald, samen 1598,65 euro. Een factuur staat nog open: 2026-08-0374.",
          },
        ],
      },
    ];

    for (const s of scenes) {
      await stelPaneelIn(paneel, s.gesprek);
      await paneel.screenshot({ path: join(UIT, `${s.naam}.png`) });
      console.log(`${s.naam} gefotografeerd`);
    }
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(`\nlosse delen staan in ${UIT}`);
}

await main();
