// Eén self-contained HTML-pagina (geen build-stap, geen CDN, geen dependencies).
// Kleurtokens + wordmark 1-op-1 uit site/business.html (het live yadagent.com-merk)
// gehaald, zodat dit geen "los interne tool"-gevoel geeft maar het echte product.
// Pollt GET /run/status elke 1200ms en rendert een formulier + live-stappenfeed +
// resultaatpaneel. Client-JS gebruikt bewust string-concatenatie i.p.v. template
// literals (zelfde reden als packages/dashboard/src/page.ts: dit bestand zit zelf
// al in een backtick-template-literal, dus geen backticks in de payload).

export const PAGE_HTML = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>yad</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='88'>%E2%9C%8B</text></svg>">
<style>
  :root{
    --bg:#0B0A12; --surf-1:#141221; --surf-2:#1C1830;
    --border:rgba(255,255,255,.08); --border-strong:rgba(255,255,255,.14);
    --text:rgba(255,255,255,.92); --text-dim:rgba(255,255,255,.60); --text-faint:rgba(255,255,255,.38);
    --accent:#6d5cf0; --accent-2:#7c3aed; --accent-glow:#9333ea;
    --grad:linear-gradient(135deg,#4f46e5 0%,#7c3aed 55%,#9333ea 100%);
    --good:#34d399; --bad:#f87171; --warn:#f59e0b;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--text);
    font-family:system-ui,-apple-system,"Segoe UI",sans-serif;}
  .wrap{max-width:920px;margin:0 auto;padding:28px 22px 60px;}
  header{display:flex;align-items:center;gap:11px;margin-bottom:4px;}
  .glyph{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;
    background:var(--grad);color:#fff;font-size:16px;box-shadow:0 2px 10px -2px var(--accent-glow);}
  .wordmark{font-weight:700;font-size:19px;letter-spacing:-.02em;}
  .sub{color:var(--text-dim);font-size:13.5px;margin:6px 0 24px;}

  form{background:var(--surf-1);border:1px solid var(--border);border-radius:14px;
    padding:20px 22px;margin-bottom:22px;display:grid;gap:13px;}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  label{display:block;font-size:11px;color:var(--text-faint);text-transform:uppercase;
    letter-spacing:.06em;margin-bottom:6px;}
  textarea, input{width:100%;background:var(--bg);border:1px solid var(--border-strong);
    border-radius:8px;padding:10px 12px;font-size:14px;color:var(--text);
    font-family:inherit;outline:none;}
  textarea{min-height:66px;resize:vertical;}
  textarea:focus, input:focus{border-color:var(--accent);}
  textarea::placeholder, input::placeholder{color:var(--text-faint);}
  .actions{display:flex;align-items:center;gap:14px;}
  button{background:var(--grad);color:#fff;border:none;border-radius:9px;
    padding:11px 22px;font-size:14.5px;font-weight:600;cursor:pointer;
    box-shadow:0 6px 20px -8px var(--accent-glow);}
  button:hover:not(:disabled){filter:brightness(1.08);}
  button:disabled{opacity:.45;cursor:not-allowed;box-shadow:none;}
  .err{color:var(--bad);font-size:13px;}

  .panel{background:var(--surf-1);border:1px solid var(--border);border-radius:14px;
    padding:18px 22px;margin-bottom:18px;}
  .panel h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;
    color:var(--text-faint);margin:0 0 14px;font-weight:600;}
  .statusrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13.5px;color:var(--text-dim);}
  .badge{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;
    font-size:12px;font-weight:600;border:1px solid transparent;}
  .badge::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;}
  .badge-idle{color:var(--text-faint);border-color:var(--border-strong);}
  .badge-running{color:var(--warn);border-color:var(--warn);}
  .badge-done{color:var(--good);border-color:var(--good);}
  .badge-error{color:var(--bad);border-color:var(--bad);}
  .badge-issue{color:var(--bad);border-color:var(--bad);}
  .badge-unreachable{color:var(--warn);border-color:var(--warn);}

  .feed{max-height:340px;overflow-y:auto;font-family:ui-monospace,Consolas,monospace;
    font-size:12.5px;line-height:1.7;border-top:1px solid var(--border);margin-top:14px;padding-top:12px;}
  .feed-empty{color:var(--text-faint);font-family:inherit;font-size:13.5px;}
  .step{display:flex;gap:10px;padding:2px 0;}
  .step .t{color:var(--text-faint);flex:none;width:64px;}
  .step .s{flex:none;width:96px;text-transform:uppercase;letter-spacing:.03em;font-size:11px;}
  .step .m{color:var(--text-dim);word-break:break-word;}
  .s-plannen{color:var(--accent);} .s-bezig{color:var(--warn);} .s-klaar{color:var(--good);}
  .s-gestopt, .s-fout, .s-geweigerd{color:var(--bad);} .s-hulp-nodig{color:#e879f9;}

  .result{font-size:14px;color:var(--text);}
  .result .k{color:var(--text-faint);font-size:11px;text-transform:uppercase;letter-spacing:.06em;
    display:block;margin-bottom:5px;}
  .result .v{margin-bottom:14px;}
  .result .v:last-child{margin-bottom:0;}
  .result.is-error .v{color:var(--bad);}
  .hidden{display:none;}
  .hint{color:var(--text-faint);font-size:12px;line-height:1.5;margin:-4px 0 2px;}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <span class="glyph">&#9995;</span>
    <span class="wordmark">yad</span>
  </header>
  <p class="sub">Lokale browser-agent &mdash; geef een doel, kijk toe hoe het gebeurt.</p>

  <form id="run-form">
    <div>
      <label for="goal">Doel</label>
      <textarea id="goal" name="goal" required placeholder="bv. Zoek het laatste nieuws over ..."></textarea>
    </div>
    <div class="row">
      <div>
        <label for="url">Start-URL (optioneel)</label>
        <input id="url" name="url" placeholder="https://...">
      </div>
      <div>
        <label for="domains">Domeinen, komma-gescheiden (optioneel als url is ingevuld)</label>
        <input id="domains" name="domains" placeholder="example.com, sub.example.com">
      </div>
    </div>
    <div class="row">
      <div>
        <label for="maxSteps">Max stappen (optioneel, default 30)</label>
        <input id="maxSteps" name="maxSteps" type="number" min="1" max="100" placeholder="30">
      </div>
      <div></div>
    </div>
    <div class="actions">
      <button type="submit" id="submit-btn">Run</button>
      <span class="err" id="form-err"></span>
    </div>
    <p class="hint">Na op Run klikken opent een tweede, apart Chrome-venster (mét adresbalk) &mdash;
      dat is de agent zelf die aan het werk gaat. Laat dat venster met rust; de voortgang volg je hier.</p>
  </form>

  <div class="panel">
    <h2>Status</h2>
    <div class="statusrow">
      <span class="badge badge-idle" id="status-badge">idle</span>
      <span id="status-goal"></span>
      <span id="status-elapsed"></span>
    </div>
    <div class="feed" id="feed">
      <div class="feed-empty" id="feed-empty">Nog geen run gestart.</div>
    </div>
  </div>

  <div class="panel hidden" id="result-panel">
    <h2>Resultaat</h2>
    <div class="result" id="result-body"></div>
  </div>
</div>

<script>
(function () {
  "use strict";

  var form = document.getElementById("run-form");
  var goalEl = document.getElementById("goal");
  var urlEl = document.getElementById("url");
  var domainsEl = document.getElementById("domains");
  var maxStepsEl = document.getElementById("maxSteps");
  var errEl = document.getElementById("form-err");
  var submitBtn = document.getElementById("submit-btn");
  var statusBadge = document.getElementById("status-badge");
  var statusGoal = document.getElementById("status-goal");
  var statusElapsed = document.getElementById("status-elapsed");
  var feed = document.getElementById("feed");
  var feedEmpty = document.getElementById("feed-empty");
  var resultPanel = document.getElementById("result-panel");
  var resultBody = document.getElementById("result-body");

  var renderedStepCount = 0;
  var lastStatus = "idle";
  var pollTimer = null;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtElapsed(startedAt, finishedAt) {
    if (!startedAt) return "";
    var end = finishedAt || Date.now();
    var s = Math.max(0, Math.round((end - startedAt) / 1000));
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60);
    return m + "m " + (s % 60) + "s";
  }

  function stepRowHtml(step) {
    var time = new Date(step.ts).toLocaleTimeString();
    var stepNum = (step.step != null) ? ("#" + step.step) : "";
    return "<div class=\\"step\\">" +
      "<span class=\\"t\\">" + escapeHtml(time) + "</span>" +
      "<span class=\\"s s-" + escapeHtml(step.status) + "\\">" + escapeHtml(step.status) + " " + escapeHtml(stepNum) + "</span>" +
      "<span class=\\"m\\">" + escapeHtml(step.message || "") + "</span>" +
      "</div>";
  }

  // r.status ("klaar"/"gestopt"/"fout"/"geweigerd"/"scope-violation") is de
  // ECHTE uitkomst van de run — data.status ("done") betekent alleen "de run
  // is afgerond met een RunResult", niets over of dat resultaat een succes
  // was. Zonder deze mapping toonde het paneel elke afgeronde run (ook een
  // geweigerde/gestopte/mislukte) met dezelfde groene "done"-badge.
  function isSuccessResult(r) {
    return r && r.status === "klaar";
  }

  function resultStatusLabel(status) {
    switch (status) {
      case "klaar": return "Voltooid";
      case "gestopt": return "Gestopt (niet voltooid)";
      case "fout": return "Fout tijdens uitvoering";
      case "geweigerd": return "Geweigerd (veiligheidsgrens)";
      case "scope-violation": return "Geweigerd (buiten toegestaan domein)";
      case "hulp-nodig": return "Vastgelopen, wacht op hulp";
      default: return status;
    }
  }

  function renderResult(data) {
    if (data.status === "done" && data.result) {
      resultPanel.classList.remove("hidden");
      var r = data.result;
      var success = isSuccessResult(r);
      resultBody.classList.toggle("is-error", !success);
      resultBody.innerHTML =
        "<div class=\\"v\\"><span class=\\"k\\">Status</span>" + escapeHtml(resultStatusLabel(r.status)) + "</div>" +
        "<div class=\\"v\\"><span class=\\"k\\">Stappen</span>" + escapeHtml(String(r.steps)) + "</div>" +
        (r.summary ? "<div class=\\"v\\"><span class=\\"k\\">Samenvatting</span>" + escapeHtml(r.summary) + "</div>" : "") +
        (r.stuckSignal ? "<div class=\\"v\\"><span class=\\"k\\">Vastgelopen op</span>" + escapeHtml(r.stuckSignal) + "</div>" : "") +
        (!success && !r.summary
          ? "<div class=\\"v\\"><span class=\\"k\\">Let op</span>De run is niet succesvol afgerond &mdash; bekijk de stappenfeed hierboven voor details.</div>"
          : "");
    } else if (data.status === "error") {
      resultPanel.classList.remove("hidden");
      resultBody.classList.add("is-error");
      resultBody.innerHTML = "<div class=\\"v\\"><span class=\\"k\\">Fout</span>" + escapeHtml(data.error || "Onbekende fout") + "</div>";
    } else {
      resultPanel.classList.add("hidden");
    }
  }

  function badgeInfo(data) {
    if (data.status === "done" && data.result && !isSuccessResult(data.result)) {
      return { cls: "issue", text: "voltooid met probleem" };
    }
    return { cls: data.status, text: data.status };
  }

  function render(data) {
    var b = badgeInfo(data);
    statusBadge.className = "badge badge-" + b.cls;
    statusBadge.textContent = b.text;
    statusGoal.textContent = data.goal ? ("\\u201c" + data.goal + "\\u201d") : "";
    statusElapsed.textContent = fmtElapsed(data.startedAt, data.finishedAt);

    // Nieuwe run gestart (server-side steps-array is opnieuw begonnen) -> feed leegmaken.
    if (data.status === "running" && lastStatus !== "running") {
      feed.innerHTML = "";
      renderedStepCount = 0;
    }
    lastStatus = data.status;

    var steps = data.steps || [];
    if (steps.length === 0) {
      feedEmpty.style.display = "block";
    } else {
      feedEmpty.style.display = "none";
      if (steps.length < renderedStepCount) {
        // Server-state is teruggezet zonder dat wij "running" zagen starten -> herbouw alles.
        feed.innerHTML = "";
        renderedStepCount = 0;
      }
      if (renderedStepCount === 0) {
        var all = "";
        for (var i = 0; i < steps.length; i++) all += stepRowHtml(steps[i]);
        feed.innerHTML = all;
      } else if (steps.length > renderedStepCount) {
        var extra = "";
        for (var j = renderedStepCount; j < steps.length; j++) extra += stepRowHtml(steps[j]);
        feed.insertAdjacentHTML("beforeend", extra);
      }
      renderedStepCount = steps.length;
      feed.scrollTop = feed.scrollHeight;
    }

    renderResult(data);
    submitBtn.disabled = (data.status === "running");
  }

  // Aantal opeenvolgende mislukte polls vóór we "onbereikbaar" tonen. Bij
  // 1200ms per poll is 3 net onder de 4s — snel genoeg om niet als "hangt"
  // aan te voelen, ruim genoeg om één losse hapering niet meteen als
  // serverdood te melden.
  var UNREACHABLE_AFTER_FAILURES = 3;
  var consecutivePollFailures = 0;

  function renderUnreachable() {
    statusBadge.className = "badge badge-unreachable";
    statusBadge.textContent = "server onbereikbaar";
    statusElapsed.textContent = "";
    // Zonder dit bleef de knop uitgeschakeld ("running" was het laatst
    // gerenderde statusbeeld) terwijl er in werkelijkheid niets meer draait
    // om op te wachten — de gebruiker kon dan nooit meer een nieuwe poging
    // starten zonder de pagina zelf te verversen.
    submitBtn.disabled = false;
  }

  function poll() {
    fetch("/run/status")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        consecutivePollFailures = 0;
        render(data);
      })
      .catch(function () {
        consecutivePollFailures++;
        if (consecutivePollFailures >= UNREACHABLE_AFTER_FAILURES) {
          renderUnreachable();
        }
        // volgende poll probeert het opnieuw
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errEl.textContent = "";
    var goal = goalEl.value.trim();
    if (!goal) { errEl.textContent = "Vul een doel in."; return; }

    var body = { goal: goal };
    var url = urlEl.value.trim();
    if (url) body.url = url;
    var domainsRaw = domainsEl.value.trim();
    if (domainsRaw) {
      body.domains = domainsRaw.split(",").map(function (d) { return d.trim(); }).filter(Boolean);
    }
    if (!url && !domainsRaw) {
      errEl.textContent = "Vul een start-URL of minstens één domein in.";
      return;
    }
    var maxSteps = maxStepsEl.value.trim();
    if (maxSteps) body.maxSteps = Number(maxSteps);

    submitBtn.disabled = true;
    fetch("/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (data) { return { ok: r.ok, data: data }; });
      })
      .then(function (res) {
        if (!res.ok) {
          errEl.textContent = (res.data && res.data.detail) || "Starten van run mislukt.";
          submitBtn.disabled = false;
          return;
        }
        poll();
      })
      .catch(function () {
        errEl.textContent = "Kon de server niet bereiken.";
        submitBtn.disabled = false;
      });
  });

  poll();
  pollTimer = setInterval(poll, 1200);
  window.addEventListener("beforeunload", function () { if (pollTimer) clearInterval(pollTimer); });
})();
</script>
</body>
</html>
`;
