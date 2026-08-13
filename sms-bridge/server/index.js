import cors from "cors";
import express from "express";
import { createServer } from "http";
import { networkInterfaces } from "os";
import path from "path";
import QRCode from "qrcode";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { randomBytes, timingSafeEqual } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const PAIRING_CODE = (process.env.PAIRING_CODE || generatePairingCode()).toUpperCase();
const MAX_MESSAGES = 500;

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

/** @type {Map<string, object>} */
const messages = new Map();
/** @type {Set<import('ws').WebSocket>} */
const desktopClients = new Set();
/** @type {Set<import('ws').WebSocket>} */
const phoneClients = new Set();

let phoneOnline = false;
let lastPhoneSeenAt = null;

app.use(cors());
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "../web/public")));

function generatePairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || "").toUpperCase());
  const right = Buffer.from(String(b || "").toUpperCase());
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function getLanAddresses() {
  const nets = networkInterfaces();
  const addresses = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === "IPv4" && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

function authorize(req, res, next) {
  const code = req.header("x-pairing-code") || req.query.code || req.body?.pairingCode;
  if (!safeEqual(code, PAIRING_CODE)) {
    return res.status(401).json({ error: "קוד צימוד שגוי" });
  }
  return next();
}

function normalizeMessage(input) {
  const now = Date.now();
  const id = String(input.id || `${now}-${randomBytes(4).toString("hex")}`);
  const address = String(input.address || input.from || "לא ידוע").trim();
  const body = String(input.body || input.message || "").trim();
  const timestamp = Number(input.timestamp || input.date || now);
  const type = input.type === "sent" ? "sent" : "received";

  if (!body) {
    throw new Error("גוף ההודעה ריק");
  }

  return {
    id,
    address,
    body,
    timestamp: Number.isFinite(timestamp) ? timestamp : now,
    type,
    receivedAt: now,
  };
}

function sortedMessages() {
  return [...messages.values()].sort((a, b) => b.timestamp - a.timestamp);
}

function broadcastDesktop(payload) {
  const data = JSON.stringify(payload);
  for (const client of desktopClients) {
    if (client.readyState === 1) client.send(data);
  }
}

function setPhoneStatus(online) {
  phoneOnline = online;
  if (online) lastPhoneSeenAt = Date.now();
  broadcastDesktop({
    type: "status",
    phoneOnline,
    lastPhoneSeenAt,
    desktopCount: desktopClients.size,
    phoneCount: phoneClients.size,
  });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "flux-sms-bridge" });
});

app.get("/api/session", async (_req, res) => {
  const addresses = getLanAddresses();
  const primary = addresses[0] || "127.0.0.1";
  const baseUrl = `http://${primary}:${PORT}`;
  const pairUrl = `${baseUrl}/pair?code=${PAIRING_CODE}`;
  const qrDataUrl = await QRCode.toDataURL(pairUrl, {
    margin: 1,
    width: 280,
    color: { dark: "#0b2a3a", light: "#ffffff" },
  });

  res.json({
    pairingCode: PAIRING_CODE,
    port: PORT,
    baseUrl,
    pairUrl,
    lanAddresses: addresses,
    qrDataUrl,
    phoneOnline,
    lastPhoneSeenAt,
    messageCount: messages.size,
  });
});

app.get("/api/messages", authorize, (_req, res) => {
  res.json({ messages: sortedMessages() });
});

app.post("/api/messages", authorize, (req, res) => {
  try {
    const items = Array.isArray(req.body?.messages)
      ? req.body.messages
      : [req.body];

    const saved = [];
    for (const item of items) {
      const msg = normalizeMessage(item);
      messages.set(msg.id, msg);
      saved.push(msg);
    }

    while (messages.size > MAX_MESSAGES) {
      const oldest = sortedMessages().at(-1);
      if (!oldest) break;
      messages.delete(oldest.id);
    }

    setPhoneStatus(true);
    for (const msg of saved) {
      broadcastDesktop({ type: "sms", message: msg });
    }

    res.status(201).json({ ok: true, count: saved.length, messages: saved });
  } catch (error) {
    res.status(400).json({ error: error.message || "בקשה לא תקינה" });
  }
});

app.delete("/api/messages", authorize, (_req, res) => {
  messages.clear();
  broadcastDesktop({ type: "cleared" });
  res.json({ ok: true });
});

app.get("/pair", (req, res) => {
  const code = String(req.query.code || "").toUpperCase();
  res.type("html").send(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>צימוד Flux SMS</title>
  <style>
    body { font-family: "Segoe UI", Tahoma, sans-serif; background:#0b2a3a; color:#fff; display:grid; place-items:center; min-height:100vh; margin:0; }
    .box { background:rgba(255,255,255,.08); padding:2rem; border-radius:16px; max-width:420px; text-align:center; }
    code { font-size:1.6rem; letter-spacing:.2em; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Flux SMS Bridge</h1>
    <p>פתחו את אפליקציית Android והזינו את כתובת השרת ואת קוד הצימוד:</p>
    <p><code>${safeEqual(code, PAIRING_CODE) ? PAIRING_CODE : "———"}</code></p>
    <p>לאחר הצימוד, סמסים חדשים יופיעו במחשב בזמן אמת.</p>
  </div>
</body>
</html>`);
});

wss.on("connection", (socket, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const role = url.searchParams.get("role") === "phone" ? "phone" : "desktop";
  const code = url.searchParams.get("code") || "";

  if (!safeEqual(code, PAIRING_CODE)) {
    socket.close(1008, "unauthorized");
    return;
  }

  if (role === "phone") {
    phoneClients.add(socket);
    setPhoneStatus(true);
    socket.send(JSON.stringify({ type: "hello", role: "phone" }));
  } else {
    desktopClients.add(socket);
    socket.send(
      JSON.stringify({
        type: "hello",
        role: "desktop",
        messages: sortedMessages(),
        phoneOnline,
        lastPhoneSeenAt,
      })
    );
    broadcastDesktop({
      type: "status",
      phoneOnline,
      lastPhoneSeenAt,
      desktopCount: desktopClients.size,
      phoneCount: phoneClients.size,
    });
  }

  socket.on("message", (raw) => {
    try {
      const data = JSON.parse(String(raw));
      if (role === "phone" && data.type === "sms") {
        const msg = normalizeMessage(data.message || data);
        messages.set(msg.id, msg);
        setPhoneStatus(true);
        broadcastDesktop({ type: "sms", message: msg });
        socket.send(JSON.stringify({ type: "ack", id: msg.id }));
      }
      if (data.type === "ping") {
        if (role === "phone") setPhoneStatus(true);
        socket.send(JSON.stringify({ type: "pong", at: Date.now() }));
      }
    } catch {
      socket.send(JSON.stringify({ type: "error", error: "invalid_payload" }));
    }
  });

  socket.on("close", () => {
    desktopClients.delete(socket);
    phoneClients.delete(socket);
    if (role === "phone") {
      setPhoneStatus(phoneClients.size > 0);
    } else {
      broadcastDesktop({
        type: "status",
        phoneOnline,
        lastPhoneSeenAt,
        desktopCount: desktopClients.size,
        phoneCount: phoneClients.size,
      });
    }
  });
});

server.listen(PORT, HOST, () => {
  const addresses = getLanAddresses();
  console.log("Flux SMS Bridge running");
  console.log(`Local:   http://127.0.0.1:${PORT}`);
  for (const ip of addresses) {
    console.log(`LAN:     http://${ip}:${PORT}`);
  }
  console.log(`Pairing code: ${PAIRING_CODE}`);
});
