// Eén self-contained HTML-pagina (geen build-stap, geen CDN, geen dependencies).
// Poll't /status en /jobs elke 2s en rendert een formulier + tabel.

export const PAGE_HTML = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YAD Dashboard</title>
<style>
  :root{
    --bg:#0B0A12; --panel:#15131f; --panel2:#181622; --line:#2a2740;
    --text:#f1eefb; --muted:#9791b8; --accent:#8b5cf6;
    --queued:#9791b8; --running:#f59e0b; --done:#34d399; --error:#f87171;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--text);
    font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;}
  .wrap{max-width:1080px;margin:0 auto;padding:28px 20px 60px;}
  h1{font-size:20px;margin:0 0 4px;display:flex;align-items:center;gap:10px;}
  h1 .hand{font-size:24px;}
  .sub{color:var(--muted);font-size:13px;margin:0 0 22px;}
  .statusbar{display:flex;gap:18px;flex-wrap:wrap;background:var(--panel);
    border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin-bottom:22px;
    font-size:13px;color:var(--muted);}
  .statusbar b{color:var(--text);}
  form{background:var(--panel);border:1px solid var(--line);border-radius:12px;
    padding:18px 20px;margin-bottom:26px;display:grid;gap:12px;}
  form .row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  label{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;
    letter-spacing:.04em;margin-bottom:5px;}
  textarea, input{width:100%;background:#0f0d16;border:1px solid var(--line);
    border-radius:6px;padding:9px 11px;font-size:14px;color:var(--text);
    font-family:inherit;outline:none;}
  textarea{min-height:64px;resize:vertical;}
  textarea:focus, input:focus{border-color:var(--accent);}
  button{justify-self:start;background:var(--accent);color:#fff;border:none;
    border-radius:6px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;}
  button:hover{filter:brightness(1.08);}
  button:disabled{opacity:.5;cursor:not-allowed;}
  .err{color:var(--error);font-size:13px;min-height:16px;}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  th{text-align:left;color:var(--muted);font-weight:600;font-size:11px;
    text-transform:uppercase;letter-spacing:.04em;padding:8px 10px;border-bottom:1px solid var(--line);}
  td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top;}
  tr:last-child td{border-bottom:none;}
  .goal-cell{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .mono{font-family:Consolas,monospace;font-size:12px;color:var(--muted);}
  .badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;
    font-weight:600;border:1px solid transparent;}
  .badge-queued{color:var(--queued);border-color:var(--queued);}
  .badge-running{color:var(--running);border-color:var(--running);}
  .badge-done{color:var(--done);border-color:var(--done);}
  .badge-error{color:var(--error);border-color:var(--error);}
  .empty{color:var(--muted);font-size:13px;padding:18px 0;}
  .result{max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);}
  .result.is-error{color:var(--error);}
</style>
</head>
<body>
<div class="wrap">
  <h1><span class="hand">yad</span> dashboard</h1>
  <p class="sub">Orchestrator vóór main-server.ts &mdash; volgt taken, main-server.ts blijft ongewijzigd.</p>

  <div class="statusbar" id="statusbar">laden...</div>

  <form id="job-form">
    <div>
      <label for="goal">Doel (goal)</label>
      <textarea id="goal" name="goal" required placeholder="bv. Zoek het laatste nieuws over ..."></textarea>
    </div>
    <div class="row">
      <div>
        <label for="url">Start-URL (optioneel)</label>
        <input id="url" name="url" placeholder="https://...">
      </div>
      <div>
        <label for="domains">Domeinen, komma-gescheiden (optioneel)</label>
        <input id="domains" name="domains" placeholder="example.com, sub.example.com">
      </div>
    </div>
    <div class="row">
      <div>
        <label for="maxSteps">Max stappen (optioneel)</label>
        <input id="maxSteps" name="maxSteps" type="number" min="1" max="100" placeholder="30">
      </div>
      <div></div>
    </div>
    <div class="err" id="form-err"></div>
    <button type="submit" id="submit-btn">Taak toevoegen</button>
  </form>

  <table>
    <thead>
      <tr>
        <th>ID</th><th>Goal</th><th>Status</th><th>Stappen</th><th>Resultaat / fout</th><th>Verstreken</th>
      </tr>
    </thead>
    <tbody id="job-rows"></tbody>
  </table>
  <div class="empty" id="empty-msg" style="display:none;">Nog geen taken. Voeg er hierboven een toe.</div>
</div>

<script>
(function () {
  "use strict";

  var form = document.getElementById("job-form");
  var goalEl = document.getElementById("goal");
  var urlEl = document.getElementById("url");
  var domainsEl = document.getElementById("domains");
  var maxStepsEl = document.getElementById("maxSteps");
  var errEl = document.getElementById("form-err");
  var submitBtn = document.getElementById("submit-btn");
  var statusbar = document.getElementById("statusbar");
  var rowsEl = document.getElementById("job-rows");
  var emptyEl = document.getElementById("empty-msg");

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function badgeClass(status) {
    return "badge badge-" + status;
  }

  function fmtElapsed(job) {
    var start = job.startedAt || job.createdAt;
    var end = job.finishedAt || Date.now();
    var ms = Math.max(0, end - start);
    var s = Math.round(ms / 1000);
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60);
    return m + "m " + (s % 60) + "s";
  }

  function renderStatus(data) {
    if (!data) { statusbar.textContent = "yad-server niet bereikbaar"; return; }
    statusbar.innerHTML =
      "server: <b>" + escapeHtml(data.yadServerUrl) + "</b>" +
      " &nbsp;|&nbsp; actieve workers: <b>" + data.activeRunners + " / " + data.concurrency + "</b>" +
      " &nbsp;|&nbsp; wachtrij: <b>" + data.queueLength + "</b>";
  }

  function renderJobs(jobs) {
    if (!jobs.length) {
      rowsEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";
    var html = "";
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      var shortId = String(job.id).slice(0, 8);
      var goal = escapeHtml(job.goal || "");
      if (goal.length > 90) goal = goal.slice(0, 90) + "…";

      var resultHtml = "";
      var resultClass = "result";
      if (job.status === "error") {
        resultHtml = escapeHtml(job.error || "");
        resultClass += " is-error";
      } else if (job.status === "done" && job.result) {
        resultHtml = escapeHtml(job.result.summary || job.result.status || "");
      } else {
        resultHtml = "";
      }

      var steps = (job.result && typeof job.result.steps === "number") ? job.result.steps : "";

      html +=
        "<tr>" +
        "<td class=\\"mono\\">" + escapeHtml(shortId) + "</td>" +
        "<td class=\\"goal-cell\\" title=\\"" + escapeHtml(job.goal || "") + "\\">" + goal + "</td>" +
        "<td><span class=\\"" + badgeClass(job.status) + "\\">" + escapeHtml(job.status) + "</span></td>" +
        "<td>" + steps + "</td>" +
        "<td class=\\"" + resultClass + "\\" title=\\"" + resultHtml + "\\">" + resultHtml + "</td>" +
        "<td class=\\"mono\\">" + fmtElapsed(job) + "</td>" +
        "</tr>";
    }
    rowsEl.innerHTML = html;
  }

  function poll() {
    fetch("/status").then(function (r) { return r.json(); })
      .then(renderStatus)
      .catch(function () { renderStatus(null); });
    fetch("/jobs").then(function (r) { return r.json(); })
      .then(function (data) { renderJobs(data.jobs || []); })
      .catch(function () { /* volgende poll probeert het opnieuw */ });
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
    var maxSteps = maxStepsEl.value.trim();
    if (maxSteps) body.maxSteps = Number(maxSteps);

    submitBtn.disabled = true;
    fetch("/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (data) { return { ok: r.ok, data: data }; });
      })
      .then(function (res) {
        if (!res.ok) {
          errEl.textContent = (res.data && res.data.detail) || "Aanmaken van taak mislukt.";
          return;
        }
        form.reset();
        poll();
      })
      .catch(function () { errEl.textContent = "Kon dashboard-server niet bereiken."; })
      .finally(function () { submitBtn.disabled = false; });
  });

  poll();
  setInterval(poll, 2000);
})();
</script>
</body>
</html>
`;
