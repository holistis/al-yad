#!/usr/bin/env node
/**
 * CAPACITEITEN-WACHT — merkt het als YAD iets verleert.
 *
 * AANLEIDING (2026-08-16):
 * Op één dag zijn acht mogelijkheden toegevoegd of gerepareerd. Twee daarvan bleken bij
 * het testen iets anders te doen dan gedacht, en één "reparatie" werkte alleen doordat er
 * toevallig vlak daarvoor een andere aanroep was gedaan. Zulk werk gaat stilletjes weer
 * stuk zodra iemand aan de waarneming of het protocol sleutelt.
 *
 * Deze wacht draait de benchmark en meldt ALLEEN bij verandering. Een dagelijkse mail dat
 * alles goed is, leert mensen wegkijken; een melding dat er iets is teruggevallen niet.
 *
 * Hij is bewust terughoudend met alarm slaan. YAD hangt aan een echte browser, en die kan
 * afgesloten zijn of net herstarten. Dat is geen defect maar afwezigheid, en die twee door
 * elkaar halen levert precies het valse alarm op waar dit tegen gebouwd is.
 *
 * Draaien: node scripts/capaciteiten-wacht.mjs
 * Als cron: elke zes uur, op minuut 20 (zet de sterren zelf in de crontab)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const WORTEL = join(HIER, "..");
const YAD = process.env.YAD_URL ?? "http://localhost:3747";
const STAAT = process.env.CAP_STATE ?? join(WORTEL, "data", "capaciteiten-wacht.json");
const UITSLAG = join(WORTEL, "data", "capaciteiten-laatste.json");

const TG_TOKEN = process.env.TELEGRAM_TOKEN ?? "";
const TG_CHAT = process.env.TELEGRAM_CHAT_ID ?? "";

async function meld(regels) {
  const tekst = regels.join("\n");
  console.log(tekst);
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text: tekst, disable_web_page_preview: true }),
    });
  } catch (e) {
    console.error(`melding mislukt: ${e.message}`);
  }
}

function lees(pad) {
  if (!existsSync(pad)) return null;
  try { return JSON.parse(readFileSync(pad, "utf8")); } catch { return null; }
}

async function main() {
  // Eerst kijken of er überhaupt een browser is. Zonder Chrome kan de benchmark niets
  // meten, en dat is geen terugval maar afwezigheid. Die twee door elkaar halen geeft
  // een vals alarm bij elke keer dat de koning zijn browser dichtdoet.
  let verbonden = false;
  try {
    const r = await fetch(`${YAD}/status`, { signal: AbortSignal.timeout(8000) });
    verbonden = Boolean((await r.json())?.connected);
  } catch { /* companion draait niet */ }

  if (!verbonden) {
    console.log("YAD niet verbonden met Chrome — meting overgeslagen, geen alarm");
    try {
      writeFileSync(STAAT, JSON.stringify({ ts: new Date().toISOString(), overgeslagen: "geen browser" }, null, 2));
    } catch { /* bijzaak */ }
    return;
  }

  const vorige = lees(UITSLAG);

  const run = spawnSync(process.execPath, [join(HIER, "benchmark-capaciteiten.mjs")], {
    cwd: WORTEL,
    encoding: "utf8",
    timeout: 6 * 60_000,
    env: { ...process.env, BENCH_POORT: process.env.BENCH_POORT ?? "8951" },
  });
  const uitvoer = `${run.stdout ?? ""}${run.stderr ?? ""}`;

  const nieuw = lees(UITSLAG);
  if (!nieuw) {
    await meld([
      "🔴 CAPACITEITEN-BENCHMARK LEVERDE GEEN UITSLAG",
      "",
      uitvoer.trim().split("\n").slice(-6).join("\n") || "geen uitvoer",
      "",
      "YAD was wél verbonden, dus dit is geen afwezige browser maar een echte storing.",
    ]);
    process.exitCode = 1;
    return;
  }

  const kapot = (nieuw.metingen ?? []).filter((m) => m.score < 1);
  const vorigeScore = vorige?.totaalScore ?? null;
  const terugval = vorigeScore != null && nieuw.totaalScore < vorigeScore;

  console.log(`score ${nieuw.totaalScore}/${nieuw.aantal} (${nieuw.percentage}%)`);

  // Melden bij terugval, of als er iets kapot is dat de vorige keer nog werkte.
  if (terugval) {
    await meld([
      `🔴 YAD IS IETS VERLEERD: ${vorigeScore} → ${nieuw.totaalScore} van ${nieuw.aantal}`,
      "",
      ...kapot.map((k) => `  ${k.competentie}: ${k.bewijs}`),
      "",
      "Dit werkte eerder wel. Er is waarschijnlijk iets veranderd aan de waarneming, de",
      "acties of het protocol.",
    ]);
    process.exitCode = 1;
    return;
  }

  if (kapot.length && !vorige) {
    await meld([
      `🟠 EERSTE METING: ${nieuw.totaalScore}/${nieuw.aantal} (${nieuw.percentage}%)`,
      "",
      ...kapot.map((k) => `  ${k.competentie}: ${k.bewijs}`),
    ]);
    return;
  }

  if (vorigeScore != null && nieuw.totaalScore > vorigeScore) {
    await meld([`🟢 YAD KAN MEER: ${vorigeScore} → ${nieuw.totaalScore} van ${nieuw.aantal}`]);
    return;
  }

  console.log("gelijk aan de vorige meting — geen melding");
}

main().catch(async (e) => {
  await meld(["🔴 CAPACITEITEN-WACHT CRASHTE", "", e.message.slice(0, 200)]);
  process.exitCode = 2;
});
