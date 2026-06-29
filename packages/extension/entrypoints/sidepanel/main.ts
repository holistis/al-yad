import {
  ACCEPT_ITEMS,
  ACCEPT_SUMMARY,
  isAccepted,
  recordAcceptance,
} from "../../lib/acceptance";

type RunStatus = "plannen" | "bezig" | "klaar" | "gestopt" | "fout" | "geweigerd";

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;

const gate = $("#gate");
const app = $("#app");

// ---------- Akkoord-poort ----------
function showGate(): void {
  gate.classList.remove("hidden");
  app.classList.add("hidden");
  $("#gate-summary").textContent = ACCEPT_SUMMARY;

  const container = $("#gate-items");
  container.innerHTML = "";
  const boxes: HTMLInputElement[] = [];
  for (const item of ACCEPT_ITEMS) {
    const wrap = document.createElement("label");
    wrap.className = "gate-item";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = `chk-${item.id}`;
    const span = document.createElement("span");
    span.textContent = item.text;
    wrap.append(box, span);
    container.append(wrap);
    boxes.push(box);
  }

  const acceptBtn = $<HTMLButtonElement>("#accept");
  const refresh = (): void => {
    acceptBtn.disabled = !boxes.every((b) => b.checked);
  };
  boxes.forEach((b) => b.addEventListener("change", refresh));
  refresh();

  acceptBtn.onclick = async (): Promise<void> => {
    await recordAcceptance();
    startApp();
  };

  document.querySelectorAll<HTMLAnchorElement>(".docs a").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const doc = a.dataset["doc"];
      if (doc) window.open(chrome.runtime.getURL(`legal/${doc}.html`), "_blank");
    });
  });
}

// ---------- Werk-UI ----------
function renderStatus(status: RunStatus | "verbonden" | "verbinden" | "verbroken", detail?: unknown): void {
  const dot = $(".dot");
  const label = $("#label");
  const start = $<HTMLButtonElement>("#start");
  if (status === "verbonden" || status === "verbinden" || status === "verbroken") {
    dot.className = `dot ${status}`;
    label.textContent =
      status === "verbonden"
        ? "Verbonden met het Brein"
        : status === "verbinden"
          ? "Verbinden…"
          : "Niet verbonden";
    start.disabled = status !== "verbonden";
    void detail;
  }
}

function addLog(status: RunStatus, message: string, step?: number): void {
  const log = $("#log");
  const line = document.createElement("div");
  line.className = "logline";
  const tag = document.createElement("span");
  tag.className = `tag ${status}`;
  tag.textContent = step ? `${status} ${step}` : status;
  const msg = document.createElement("span");
  msg.textContent = message;
  line.append(tag, msg);
  log.append(line);
  log.scrollTop = log.scrollHeight;

  if (status === "klaar" || status === "fout" || status === "gestopt") {
    $<HTMLButtonElement>("#start").disabled = false;
  }
}

function showConfirm(id: string, action: unknown, reason: string): void {
  const box = $("#confirm");
  box.classList.remove("hidden");
  box.innerHTML = "";
  const p = document.createElement("div");
  p.textContent = reason;
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(action, null, 2);
  const row = document.createElement("div");
  row.className = "row";
  const yes = document.createElement("button");
  yes.type = "button";
  yes.textContent = "Goedkeuren";
  const no = document.createElement("button");
  no.type = "button";
  no.className = "secondary";
  no.textContent = "Weigeren";
  const answer = (approved: boolean): void => {
    void chrome.runtime.sendMessage({ type: "YAD_CONFIRM_RESPONSE", id, approved });
    box.classList.add("hidden");
    box.innerHTML = "";
  };
  yes.onclick = (): void => answer(true);
  no.onclick = (): void => answer(false);
  row.append(yes, no);
  box.append(p, pre, row);
}

function startApp(): void {
  gate.classList.add("hidden");
  app.classList.remove("hidden");

  chrome.runtime.sendMessage({ type: "YAD_GET_STATUS" }, (resp?: { status: string }) => {
    if (resp) renderStatus(resp.status as never);
  });

  $<HTMLButtonElement>("#start").onclick = (): void => {
    const goal = $<HTMLTextAreaElement>("#goal").value.trim();
    if (!goal) return;
    $<HTMLButtonElement>("#start").disabled = true;
    addLog("plannen", `Taak gestart: ${goal}`);
    void chrome.runtime.sendMessage({ type: "YAD_GOAL", goal });
  };

  $<HTMLButtonElement>("#clear").onclick = (): void => {
    $("#log").innerHTML = "";
  };

  chrome.runtime.onMessage.addListener(
    (msg: {
      type?: string;
      status?: string;
      detail?: unknown;
      message?: string;
      step?: number;
      id?: string;
      action?: unknown;
      reason?: string;
    }) => {
      if (msg?.type === "YAD_STATUS" && msg.status) {
        renderStatus(msg.status as never, msg.detail);
      } else if (msg?.type === "YAD_RUN_UPDATE" && msg.status) {
        addLog(msg.status as RunStatus, msg.message ?? "", msg.step);
      } else if (msg?.type === "YAD_CONFIRM_REQUEST" && msg.id) {
        showConfirm(msg.id, msg.action, msg.reason ?? "Bevestig deze actie");
      } else if (msg?.type === "YAD_CONFIRM_EXPIRED") {
        const box = $("#confirm");
        box.classList.add("hidden");
        box.innerHTML = "";
      }
    },
  );
}

async function init(): Promise<void> {
  if (await isAccepted()) startApp();
  else showGate();
}

void init();
