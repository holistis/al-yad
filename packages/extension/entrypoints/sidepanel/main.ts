interface StatusSnapshot {
  status: "verbonden" | "verbinden" | "verbroken";
  detail?: unknown;
}

const dot = document.querySelector<HTMLSpanElement>(".dot")!;
const label = document.querySelector<HTMLSpanElement>("#label")!;
const detailEl = document.querySelector<HTMLPreElement>("#detail")!;

const LABELS: Record<StatusSnapshot["status"], string> = {
  verbonden: "Verbonden met het Brein",
  verbinden: "Verbinden…",
  verbroken: "Niet verbonden",
};

function render(snap: StatusSnapshot): void {
  dot.className = `dot ${snap.status}`;
  label.textContent = LABELS[snap.status];
  detailEl.textContent = snap.detail ? JSON.stringify(snap.detail, null, 2) : "";
}

// Huidige status ophalen bij openen.
chrome.runtime.sendMessage({ type: "YAD_GET_STATUS" }, (resp?: StatusSnapshot) => {
  if (resp) render(resp);
});

// Live updates.
chrome.runtime.onMessage.addListener((msg: { type?: string } & Partial<StatusSnapshot>) => {
  if (msg?.type === "YAD_STATUS" && msg.status) {
    render({ status: msg.status, detail: msg.detail });
  }
});
