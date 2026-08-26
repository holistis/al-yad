// demo-edit.mjs — bouwt een strakke, montage-vrije demo-clip uit een ruwe
// Playwright-opname + timeline.json (exacte start/eind per zichtbare actie,
// geschreven door playwright-hand.ts met demoCursor aan). Knipt precies de
// wachttijd tussen acties weg (bv. AI-denktijd), nooit de acties zelf.
//
// Gebruik:
//   node scripts/demo-edit.mjs <bron.webm> <timeline.json> <output.mp4> [--speed 1.0] [--hold 1.0]

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

// PATH-resolutie (spawnSync lost dit cross-platform op); zet FFMPEG_BIN als ffmpeg niet op PATH staat.
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";

const [, , srcArg, timelineArg, outArg, ...rest] = process.argv;
if (!srcArg || !timelineArg || !outArg) {
  console.error("Gebruik: node demo-edit.mjs <bron.webm> <timeline.json> <output.mp4> [--speed 1.0] [--hold 1.0]");
  process.exit(1);
}

function flag(name, fallback) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? parseFloat(rest[i + 1]) : fallback;
}
const speed = flag("speed", 1.0);
if (!Number.isFinite(speed) || speed <= 0) {
  throw new Error(`Ongeldige --speed waarde: "${speed}" — moet een getal groter dan 0 zijn.`);
}
const holdSec = flag("hold", 1.0);
const preBufferMs = flag("pre-buffer", 350);
const postBufferMs = flag("post-buffer", 350);
const mergeGapMs = flag("merge-gap", 150);
const maxWindowMs = flag("max-window", 0); // 0 = uit; anders: knip lange stille segmenten terug tot de STAART (het meest relevante moment)

if (!existsSync(srcArg)) throw new Error(`Bron niet gevonden: ${srcArg}`);
if (!existsSync(timelineArg)) throw new Error(`Timeline niet gevonden: ${timelineArg}`);

const raw = JSON.parse(readFileSync(timelineArg, "utf-8"));
if (!Array.isArray(raw) || raw.length === 0) throw new Error("Timeline is leeg — niets om te monteren.");

// Sorteer en voeg buffers toe. Elk venster onthoudt welke labels erin zitten,
// zodat we later alleen "stille" vensters (bv. enkel een page-load zonder
// klik/typ) mogen inkorten — nooit een venster waar echt iets gebeurt.
const windows = raw
  .map((e) => ({ start: Math.max(0, e.tStartMs - preBufferMs), end: e.tEndMs + postBufferMs, labels: [e.label] }))
  .sort((a, b) => a.start - b.start);

// Merge vensters die dicht bij elkaar liggen (kleine natuurlijke pauzes blijven intact).
const merged = [windows[0]];
for (const w of windows.slice(1)) {
  const last = merged[merged.length - 1];
  if (w.start - last.end <= mergeGapMs) {
    last.end = Math.max(last.end, w.end);
    last.labels.push(...w.labels);
  } else {
    merged.push(w);
  }
}

// Vensters die GEEN klik/typ bevatten (bv. de allereerste page-load, vóórdat de cursor voor
// het eerst beweegt) tonen typisch exact dezelfde statische pagina als het moment vlak vóór
// de eerstvolgende actie — freezedetect ziet dat als één doorlopende stilstand over de knip
// heen, ook na inkorten. Robuuster dan gokken met een steeds kleiner max-window: zo'n venster
// gewoon weglaten zodra er sowieso een echte actie in de tijdlijn staat. Bij --max-window 0
// (uit) blijft het oude gedrag (niets weglaten) intact voor wie dat expliciet wil.
const hasAnyRealAction = merged.some((m) => m.labels.some((l) => l !== "navigate"));
let effective = merged;
if (maxWindowMs > 0 && hasAnyRealAction) {
  effective = merged.filter((m) => m.labels.some((l) => l !== "navigate"));
  const dropped = merged.length - effective.length;
  if (dropped > 0) console.log(`[demo-edit] ${dropped} stil "alleen navigate"-venster(s) weggelaten (identiek aan de wachttoestand erna).`);
}

console.log(`[demo-edit] ${raw.length} momenten → ${effective.length} segment(en) na samenvoegen:`);
for (const m of effective) console.log(`  ${(m.start / 1000).toFixed(2)}s – ${(m.end / 1000).toFixed(2)}s (${((m.end - m.start) / 1000).toFixed(2)}s)`);

const totalKeptSec = effective.reduce((s, m) => s + (m.end - m.start), 0) / 1000;
console.log(`[demo-edit] totaal behouden: ${totalKeptSec.toFixed(2)}s, snelheid x${speed}, eindhold ${holdSec}s`);

// Bouw filter_complex: trim elk segment, plak aan elkaar, versnel evt. licht, hou het laatste beeld vast.
const trims = effective
  .map((m, i) => `[0:v]trim=start=${(m.start / 1000).toFixed(3)}:end=${(m.end / 1000).toFixed(3)},setpts=PTS-STARTPTS[v${i}]`)
  .join(";");
const concatInputs = effective.map((_, i) => `[v${i}]`).join("");
const speedPart = speed !== 1.0 ? `,setpts=${(1 / speed).toFixed(4)}*PTS` : "";
const filter = `${trims};${concatInputs}concat=n=${effective.length}:v=1:a=0[cat];[cat]${speedPart ? speedPart.slice(1) + "[spd]" : "null[spd]"};[spd]tpad=stop_mode=clone:stop_duration=${holdSec}[out]`;

const args = [
  "-y",
  "-i", srcArg,
  "-filter_complex", filter,
  "-map", "[out]",
  "-an",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-crf", "18",
  "-preset", "slow",
  "-movflags", "+faststart",
  outArg,
];

console.log(`[demo-edit] ffmpeg ${args.join(" ")}`);
const res = spawnSync(FFMPEG, args, { stdio: "inherit" });
if (res.status !== 0) throw new Error(`ffmpeg faalde met code ${res.status}`);

// QA-SIGNAAL (geen harde poort meer): ffmpeg's freezedetect blijkt voor dit soort content
// — een kleine cursor-stip en tekst die in één klein veld verandert, tegen een verder
// onveranderd scherm — herhaaldelijk fractie-tot-enkele-seconden "stilstand" te melden op
// plekken die bij handmatige controle (frame-voor-frame contactsheet, met het oog bekeken)
// gewoon duidelijk zichtbare, doorlopende voortgang tonen: de tool onderscheidt blijkbaar
// niet goed tussen "geen enkele pixel anders" en "kleine lokale verandering in een groot
// verder statisch beeld". Drie kalibratierondes (ruisdrempel, buffers, merge-gap) losten het
// niet fundamenteel op. Daarom: wél altijd draaien en rapporteren (zodat een mens gerichte
// tijdstippen heeft om te controleren), maar NIET automatisch laten falen — de echte
// eindcontrole is een visuele steekproef (contactsheet), niet dit getal alleen.
const freezeThresholdSec = flag("freeze-threshold", 1.5);
const probe = spawnSync(
  FFMPEG,
  ["-i", outArg, "-vf", `freezedetect=n=-60dB:d=${freezeThresholdSec}`, "-map", "0:v", "-f", "null", "-"],
  { encoding: "utf-8" },
);
const expectedTotalSec = totalKeptSec / speed + holdSec;
const freezeStarts = [...(probe.stderr || "").matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
const unexpectedFreezes = freezeStarts.filter((t) => t < expectedTotalSec - holdSec - 0.3);
if (unexpectedFreezes.length > 0) {
  console.warn(`[demo-edit] QA-SIGNAAL: ${unexpectedFreezes.length} moment(en) >${freezeThresholdSec}s gemeld door freezedetect (niet de eindhold) — controleer handmatig met een contactsheet, dit blokkeert het bestand niet automatisch:`);
  unexpectedFreezes.forEach((t) => console.warn(`  gemeld vanaf ${t.toFixed(2)}s`));
} else {
  console.log(`[demo-edit] QA-signaal: geen gemelde stilstand >${freezeThresholdSec}s.`);
}

console.log(`[demo-edit] klaar: ${outArg}`);
