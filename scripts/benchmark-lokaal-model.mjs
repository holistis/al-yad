/**
 * Eerlijke meting: kan een klein LOKAAL model YAD aansturen?
 *
 * De eerste poging gaf "onbruikbaar", maar dat was mijn fout: mijn testprompt noemde het
 * schema niet, dus het model verzon eigen veldnamen ({action, element, value} in plaats
 * van {kind, ref, text}). Inhoudelijk koos het wél het juiste veld. Een model afkeuren op
 * een prompt die het antwoord niet vraagt, is geen meting maar een fout.
 *
 * Deze versie gebruikt het schema zoals YAD het echt meestuurt.
 */
const PROMPT = [
  "Je bent een browser-agent. Output een micro-plan als EEN JSON-object en NIETS anders.",
  "Geen proza, geen markdown-fences.",
  "",
  'Formaat: { "steps": [ ... ] }',
  "Elke stap is een van deze acties, exact met deze veldnamen:",
  '{ "kind": "navigate", "url": "https://..." }',
  '{ "kind": "click", "ref": "e3" }',
  '{ "kind": "type", "ref": "e5", "text": "...", "submit": false }',
  '{ "kind": "extract", "what": "..." }',
  '{ "kind": "finish", "summary": "..." }',
  "",
  "GOAL: Log in op het leveranciersportaal en download de factuur van juli.",
  "",
  "URL: https://portaal.leverancier.nl/login",
  "ELEMENTEN:",
  '  e1 textbox "Gebruikersnaam"',
  '  e2 textbox "Wachtwoord"',
  '  e3 button "Inloggen"',
  '  e4 link "Wachtwoord vergeten"',
  '  e5 link "Facturen"',
  "",
  "Page text: Welkom bij het leveranciersportaal. Log in met uw gebruikersnaam en",
  "wachtwoord om uw facturen, orders en pakbonnen te bekijken.",
  "",
  "Output het micro-plan als JSON.",
].join("\n");

const RONDES = Number(process.argv[2] ?? 5);
const MODEL = process.argv[3] ?? "qwen2.5:3b";
const tijden = [];
let bruikbaar = 0;

for (let i = 1; i <= RONDES; i++) {
  const t0 = Date.now();
  let uit = "";
  try {
    const r = await fetch("http://localhost:11434/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: PROMPT }],
        max_tokens: 200,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(300000),
    });
    const d = await r.json();
    uit = (d?.choices?.[0]?.message?.content ?? "").trim().replace(/\s+/g, " ");
  } catch (e) {
    uit = "FOUT: " + e.message.slice(0, 60);
  }
  const ms = Date.now() - t0;
  tijden.push(ms);

  // Bruikbaar = geldige JSON, met een bekende actie, en een ref die op deze pagina bestaat.
  // Dat laatste is belangrijk: een model dat "e9" verzint stuurt de agent het bos in.
  let ok = false;
  try {
    const schoon = uit.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const j = JSON.parse(schoon);
    const stap = Array.isArray(j.steps) ? j.steps[0] : j;
    const bekend = ["navigate", "click", "type", "extract", "finish", "select", "scroll"];
    ok = bekend.includes(stap?.kind) && (!stap.ref || /^e[1-5]$/.test(stap.ref));
  } catch { ok = false; }
  if (ok) bruikbaar++;

  console.log(`  ronde ${i}: ${String(ms).padStart(6)}ms  ${ok ? "GOED " : "fout "}  ${uit.slice(0, 88)}`);
}

tijden.sort((a, b) => a - b);
const med = tijden[Math.floor(tijden.length / 2)];
console.log("");
console.log(`  bruikbaar: ${bruikbaar}/${RONDES}`);
console.log(`  mediaan ${med}ms | snelste ${tijden[0]}ms | traagste ${tijden[tijden.length - 1]}ms`);
console.log(`  taak van 10 stappen: ongeveer ${Math.round((med * 10) / 1000)} seconden`);
