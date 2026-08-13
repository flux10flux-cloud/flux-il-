const setupEl = document.getElementById("setup");
const inboxEl = document.getElementById("inbox");
const howEl = document.getElementById("how");
const pairingCodeEl = document.getElementById("pairing-code");
const baseUrlEl = document.getElementById("base-url");
const qrEl = document.getElementById("qr");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const statusMeta = document.getElementById("status-meta");
const threadsEl = document.getElementById("threads");
const messagesEl = document.getElementById("messages");
const threadTitle = document.getElementById("thread-title");
const threadSub = document.getElementById("thread-sub");

/** @type {Map<string, object>} */
const messages = new Map();
let pairingCode = "";
let activeThread = null;
let socket = null;

function formatTime(ts) {
  try {
    return new Intl.DateTimeFormat("he-IL", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(ts));
  } catch {
    return String(ts);
  }
}

function showInbox() {
  setupEl.classList.add("hidden");
  howEl.classList.add("hidden");
  inboxEl.classList.remove("hidden");
  ensureSocket();
  render();
}

function showSetup() {
  inboxEl.classList.add("hidden");
  setupEl.classList.remove("hidden");
}

function groupThreads() {
  /** @type {Map<string, {address:string, latest:object, count:number}>} */
  const threads = new Map();
  for (const msg of [...messages.values()].sort((a, b) => b.timestamp - a.timestamp)) {
    const key = msg.address || "לא ידוע";
    if (!threads.has(key)) {
      threads.set(key, { address: key, latest: msg, count: 1 });
    } else {
      threads.get(key).count += 1;
    }
  }
  return [...threads.values()];
}

function renderThreads() {
  const threads = groupThreads();
  threadsEl.innerHTML = "";

  if (!threads.length) {
    threadsEl.innerHTML = `<p class="empty">עדיין אין הודעות. חברו את הטלפון ושלחו/קבלו סמס.</p>`;
    return;
  }

  if (!activeThread || !threads.some((t) => t.address === activeThread)) {
    activeThread = threads[0].address;
  }

  for (const thread of threads) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `thread-item${thread.address === activeThread ? " active" : ""}`;
    btn.innerHTML = `
      <strong>${escapeHtml(thread.address)}</strong>
      <span>${escapeHtml(thread.latest.body)}</span>
      <span class="meta">${formatTime(thread.latest.timestamp)} · ${thread.count}</span>
    `;
    btn.addEventListener("click", () => {
      activeThread = thread.address;
      render();
    });
    threadsEl.appendChild(btn);
  }
}

function renderMessages() {
  messagesEl.innerHTML = "";
  if (!activeThread) {
    messagesEl.innerHTML = `<p class="empty">בחרו שיחה מהרשימה</p>`;
    threadTitle.textContent = "בחרו שיחה";
    threadSub.textContent = "ההודעות יופיעו כאן כשהטלפון מחובר";
    return;
  }

  const threadMessages = [...messages.values()]
    .filter((m) => m.address === activeThread)
    .sort((a, b) => a.timestamp - b.timestamp);

  threadTitle.textContent = activeThread;
  threadSub.textContent = `${threadMessages.length} הודעות`;

  if (!threadMessages.length) {
    messagesEl.innerHTML = `<p class="empty">אין הודעות בשיחה הזו</p>`;
    return;
  }

  for (const msg of threadMessages) {
    const bubble = document.createElement("article");
    bubble.className = `bubble ${msg.type === "sent" ? "sent" : "received"}`;
    bubble.innerHTML = `${escapeHtml(msg.body)}<time>${formatTime(msg.timestamp)}</time>`;
    messagesEl.appendChild(bubble);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function render() {
  renderThreads();
  renderMessages();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setStatus(online, meta) {
  statusDot.classList.toggle("online", online);
  statusDot.classList.toggle("offline", !online);
  statusText.textContent = online ? "הטלפון מחובר" : "ממתין לטלפון…";
  statusMeta.textContent = meta || (online ? "מקבל סמסים בזמן אמת" : "אין חיבור עדיין");
}

function upsertMessage(msg) {
  if (!msg?.id) return;
  const isNew = !messages.has(msg.id);
  messages.set(msg.id, msg);
  if (!activeThread) activeThread = msg.address;
  render();
  if (isNew && !document.hidden && "Notification" in window && Notification.permission === "granted") {
    new Notification(msg.address, { body: msg.body.slice(0, 140) });
  }
}

function ensureSocket() {
  if (!pairingCode) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${location.host}/ws?role=desktop&code=${encodeURIComponent(pairingCode)}`);

  socket.addEventListener("open", () => {
    statusMeta.textContent = "מחובר לשרת המקומי";
  });

  socket.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "hello") {
        messages.clear();
        for (const msg of data.messages || []) upsertMessage(msg);
        setStatus(Boolean(data.phoneOnline), data.lastPhoneSeenAt
          ? `נראה לאחרונה ${formatTime(data.lastPhoneSeenAt)}`
          : undefined);
      }
      if (data.type === "sms") upsertMessage(data.message);
      if (data.type === "cleared") {
        messages.clear();
        activeThread = null;
        render();
      }
      if (data.type === "status") {
        setStatus(
          Boolean(data.phoneOnline),
          data.lastPhoneSeenAt ? `נראה לאחרונה ${formatTime(data.lastPhoneSeenAt)}` : undefined
        );
      }
    } catch {
      // ignore malformed payloads
    }
  });

  socket.addEventListener("close", () => {
    setStatus(false, "החיבור לשרת נותק — מנסה שוב…");
    setTimeout(ensureSocket, 1500);
  });
}

async function loadSession() {
  const res = await fetch("/api/session");
  const data = await res.json();
  pairingCode = data.pairingCode;
  pairingCodeEl.textContent = data.pairingCode;
  baseUrlEl.textContent = data.baseUrl;
  qrEl.src = data.qrDataUrl;
  setStatus(Boolean(data.phoneOnline));
}

document.getElementById("enter-inbox").addEventListener("click", () => {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
  showInbox();
});

document.getElementById("back-setup").addEventListener("click", showSetup);
document.getElementById("how-link").addEventListener("click", (event) => {
  event.preventDefault();
  howEl.classList.toggle("hidden");
  howEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

document.getElementById("clear-btn").addEventListener("click", async () => {
  if (!pairingCode) return;
  if (!confirm("למחוק את כל ההודעות מהתיבה במחשב?")) return;
  await fetch(`/api/messages?code=${encodeURIComponent(pairingCode)}`, { method: "DELETE" });
  messages.clear();
  activeThread = null;
  render();
});

loadSession().catch(() => {
  pairingCodeEl.textContent = "שגיאה";
  baseUrlEl.textContent = "לא ניתן לטעון את השרת";
});
