// demo-edit.mjs — bouwt een strakke, montage-vrije demo-clip uit een ruwe
// Playwright-opname + timeline.json (exacte start/eind per zichtbare actie,
// geschreven door playwright-hand.ts met demoCursor aan). Knipt precies de
// wachttijd tussen acties weg (bv. AI-denktijd), nooit de acties zelf.
//
// Gebruik:
//   node scripts/demo-edit.mjs <bron.webm> <timeline.json> <output.mp4> [--speed 1.0] [--hold 1.0]

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const FFMPEG =
  process.env.FFMPEG_BIN ||
  "C:\\Users\\hp\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.1-full_build\\bin\\ffmpeg.exe";
const FFPROBE = FFMPEG.replace("ffmpeg.exe", "ffprobe.exe");

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
const holdSec = flag("hold", 1.0);
const preBufferMs = flag("pre-buffer", 350);
const postBufferMs = flag("post-buffer", 350);
const mergeGapMs = flag("merge-gap", 800);
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

// Lange vensters die GEEN klik/typ bevatten (bv. de allereerste page-load, vóórdat de
// cursor voor het eerst beweegt) terugknippen tot hun STAART — het moment vlak vóór de
// eerstvolgende actie is relevanter dan het volle stilstaande begin. Vensters met een
// echte actie erin blijven altijd volledig intact, ook als ze lang zijn.
if (maxWindowMs > 0) {
  for (const m of merged) {
    const hasRealAction = m.labels.some((l) => l !== "navigate");
    if (!hasRealAction && m.end - m.start > maxWindowMs) m.start = m.end - maxWindowMs;
  }
}

console.log(`[demo-edit] ${raw.length} momenten → ${merged.length} segment(en) na samenvoegen:`);
for (const m of merged) console.log(`  ${(m.start / 1000).toFixed(2)}s – ${(m.end / 1000).toFixed(2)}s (${((m.end - m.start) / 1000).toFixed(2)}s)`);

const totalKeptSec = merged.reduce((s, m) => s + (m.end - m.start), 0) / 1000;
console.log(`[demo-edit] totaal behouden: ${totalKeptSec.toFixed(2)}s, snelheid x${speed}, eindhold ${holdSec}s`);

// Bouw filter_complex: trim elk segment, plak aan elkaar, versnel evt. licht, hou het laatste beeld vast.
const trims = merged
  .map((m, i) => `[0:v]trim=start=${(m.start / 1000).toFixed(3)}:end=${(m.end / 1000).toFixed(3)},setpts=PTS-STARTPTS[v${i}]`)
  .join(";");
const concatInputs = merged.map((_, i) => `[v${i}]`).join("");
const speedPart = speed !== 1.0 ? `,setpts=${(1 / speed).toFixed(4)}*PTS` : "";
const filter = `${trims};${concatInputs}concat=n=${merged.length}:v=1:a=0[cat];[cat]${speedPart ? speedPart.slice(1) + "[spd]" : "null[spd]"};[spd]tpad=stop_mode=clone:stop_duration=${holdSec}[out]`;

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

// QA-poort: check of er nog stilstaande stukken >0.6s overblijven.
const probe = spawnSync(FFMPEG, ["-i", outArg, "-vf", "freezedetect=n=-30dB:d=0.6", "-map", "0:v", "-f", "null", "-"], {
  encoding: "utf-8",
});
const freezeLines = (probe.stderr || "").split("\n").filter((l) => l.includes("freeze_duration"));
if (freezeLines.length > 0) {
  console.warn(`[demo-edit] WAARSCHUWING: nog ${freezeLines.length} stilstaand moment(en) >0.6s gevonden:`);
  freezeLines.forEach((l) => console.warn("  " + l.trim()));
} else {
  console.log("[demo-edit] QA-check: geen stilstaande stukken >0.6s gevonden. Clip is dicht.");
}

console.log(`[demo-edit] klaar: ${outArg}`);
