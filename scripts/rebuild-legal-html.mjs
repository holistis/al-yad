import { readFileSync, writeFileSync } from "node:fs";
import { marked } from "marked";

const docs = [
  { md: "docs/legal/privacyverklaring.md", html: "packages/extension/public/legal/privacyverklaring.html", title: "Privacyverklaring (Privacy Policy) — Yad" },
  { md: "docs/legal/algemene-voorwaarden.md", html: "packages/extension/public/legal/algemene-voorwaarden.html", title: "Algemene Voorwaarden (Terms of Service) — Yad" },
  { md: "docs/legal/gebruiksbeleid.md", html: "packages/extension/public/legal/gebruiksbeleid.html", title: "Gebruiksbeleid (Acceptable Use Policy) — Yad" },
  { md: "docs/legal/privacyverklaring-en.md", html: "packages/extension/public/legal/privacyverklaring-en.html", title: "Privacy Policy — Yad" },
  { md: "docs/legal/algemene-voorwaarden-en.md", html: "packages/extension/public/legal/algemene-voorwaarden-en.html", title: "Terms of Service — Yad" },
  { md: "docs/legal/gebruiksbeleid-en.md", html: "packages/extension/public/legal/gebruiksbeleid-en.html", title: "Acceptable Use Policy — Yad" },
];

const style = `
      body { font-family: system-ui, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 16px; line-height: 1.55; color: #1a1a1a; }
      h1, h2, h3 { line-height: 1.25; }
      blockquote { background: #fffbeb; border-left: 4px solid #d97706; margin: 1em 0; padding: .5em 1em; }
      code { background: #f3f4f6; padding: 1px 4px; border-radius: 4px; }
      table { border-collapse: collapse; }
      td, th { border: 1px solid #d1d5db; padding: 4px 8px; text-align: left; }
`;

for (const doc of docs) {
  const md = readFileSync(doc.md, "utf8");
  const body = marked.parse(md);
  const html = `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${doc.title}</title>
    <style>${style}</style>
  </head>
  <body>
${body}
  </body>
</html>
`;
  writeFileSync(doc.html, html);
  console.log("wrote", doc.html);
}
