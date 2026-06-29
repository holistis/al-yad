/**
 * Verwerkt de output van de juridische zwerm tot bestanden:
 * - docs/legal/<key>.md            (alle documenten + akkoord-poort spec)
 * - packages/extension/public/legal/<key>.html  (leesbaar in de akkoord-poort)
 *
 * Draai: pnpm process-legal "<pad naar workflow .output bestand>"
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { marked } from "marked";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const INPUT = process.argv[2];
if (!INPUT) {
  console.error("Geef het pad naar het workflow .output bestand mee.");
  process.exit(1);
}

function unescapeEntities(s: string): string {
  return s
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&");
}

/**
 * Knipt eventuele meegelekte agent-preamble (bv. "Ik lever het concept...",
 * interne sharia-check) weg: we starten bij de officiele concept/notitie-
 * blockquote, of anders bij de eerste kop.
 */
function cleanPreamble(md: string): string {
  const lines = md.split(/\r?\n/);
  const noticeIdx = lines.findIndex((l) =>
    /^>\s.*(AI[-\s]ONDERZOCHT|BELANGRIJKE NOTITIE|GEEN JURIDISCH ADVIES|LET OP\b)/i.test(l),
  );
  const headingIdx = lines.findIndex((l) => /^#{1,3}\s/.test(l));
  const candidates = [noticeIdx, headingIdx].filter((i) => i >= 0);
  if (!candidates.length) return md.trim() + "\n";
  const start = Math.min(...candidates);
  if (start <= 0) return md.trim() + "\n";
  return lines.slice(start).join("\n").trim() + "\n";
}

interface Doc {
  key: string;
  title: string;
  final: string;
}

const raw = readFileSync(INPUT, "utf8");
const parsed = JSON.parse(raw) as { result?: unknown } & Record<string, unknown>;
const result = (parsed.result ?? parsed) as {
  documents?: Doc[];
  acceptance?: string;
};

const documents = result.documents ?? [];
const acceptance = result.acceptance ?? "";

const legalDir = resolve(repoRoot, "docs", "legal");
const pubDir = resolve(repoRoot, "packages", "extension", "public", "legal");
mkdirSync(legalDir, { recursive: true });
mkdirSync(pubDir, { recursive: true });

const htmlWrap = (title: string, body: string): string =>
  `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} — Yad</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 16px; line-height: 1.55; color: #1a1a1a; }
      h1, h2, h3 { line-height: 1.25; }
      blockquote { background: #fffbeb; border-left: 4px solid #d97706; margin: 1em 0; padding: .5em 1em; }
      code { background: #f3f4f6; padding: 1px 4px; border-radius: 4px; }
      table { border-collapse: collapse; }
      td, th { border: 1px solid #d1d5db; padding: 4px 8px; text-align: left; }
    </style>
  </head>
  <body>
${body}
  </body>
</html>
`;

const userFacing = new Set(["algemene-voorwaarden", "privacyverklaring", "gebruiksbeleid"]);

for (const doc of documents) {
  const md = cleanPreamble(unescapeEntities(String(doc.final ?? "")));
  writeFileSync(resolve(legalDir, `${doc.key}.md`), md, "utf8");
  if (userFacing.has(doc.key)) {
    const body = marked.parse(md, { async: false }) as string;
    writeFileSync(resolve(pubDir, `${doc.key}.html`), htmlWrap(doc.title, body), "utf8");
  }
  console.log(`doc ${doc.key}: ${md.length} tekens`);
}

const accMd = cleanPreamble(unescapeEntities(String(acceptance)));
writeFileSync(resolve(legalDir, "akkoord-poort.md"), accMd, "utf8");
console.log(`akkoord-poort spec: ${accMd.length} tekens`);

writeFileSync(
  resolve(legalDir, "README.md"),
  `# Juridische documenten Yad

AI-onderzochte CONCEPTEN. Laat ze controleren door een gekwalificeerd jurist voor gebruik. Geen juridisch advies.

- algemene-voorwaarden.md
- privacyverklaring.md
- verwerkersovereenkomst.md
- gebruiksbeleid.md
- akkoord-poort.md (spec van de click-wrap akkoord-poort)

Plaatshouders in [BLOKHAKEN] invullen (rechtspersoon, KVK, vestigingsplaats, e-mailadressen, versie, datum).
`,
  "utf8",
);

console.log("Klaar.");
