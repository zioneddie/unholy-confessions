const express = require("express");
const { AwsClient } = require("aws4fetch");

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_ACCESS_KEY = process.env.CF_ACCESS_KEY;
const CF_SECRET_KEY = process.env.CF_SECRET_KEY;
const CF_BUCKET_NAME = process.env.CF_BUCKET_NAME;
const CF_PUBLIC_URL = process.env.CF_PUBLIC_URL;

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS || "https://unholyconfessions.online"
).split(",").map(origin => origin.trim()).filter(Boolean);

// Increase limit for audio base64 strings
app.use(express.json({ limit: "15mb" }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const attempts = new Map();
app.use("/api/confessions", (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const record = attempts.get(ip);
  if (!record || now - record.start >= windowMs) {
    attempts.set(ip, { start: now, count: 1 });
    return next();
  }
  if (record.count >= 5) return res.status(429).json({ error: "Too many attempts." });
  record.count++;
  next();
});

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

app.post("/api/confessions", async (req, res) => {
  try {
    if (!BOT_TOKEN || !CHAT_ID) return res.status(500).json({ error: "Server config incomplete." });

    const type = req.body.type || "text";
    const consent = req.body.consent === true;
    if (!consent) return res.status(400).json({ error: "Consent required." });

    // --- VOICE NOTES ---
    if (type === "voice") {
      if (!req.body.audio) return res.status(400).json({ error: "No audio." });
      if (!CF_ACCOUNT_ID || !CF_ACCESS_KEY || !CF_BUCKET_NAME) {
        return res.status(500).json({ error: "Cloudflare keys missing in Render." });
      }

      const base64Data = req.body.audio.replace(/^data:audio\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const fileName = `voice_${Date.now()}.webm`;
      
      // Use aws4fetch to sign the request for Cloudflare R2
      const r2 = new AwsClient({
        accessKeyId: CF_ACCESS_KEY,
        secretAccessKey: CF_SECRET_KEY,
      });

      const cfUrl = `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com/${CF_BUCKET_NAME}/${fileName}`;
      
      const uploadRes = await r2.fetch(cfUrl, {
        method: "PUT",
        body: buffer,
        headers: { "Content-Type": "audio/webm" }
      });

      if (!uploadRes.ok) {
        console.error("Cloudflare Upload Error:", await uploadRes.text());
        return res.status(500).json({ error: "Failed to upload audio." });
      }

      const publicUrl = `${CF_PUBLIC_URL}/${fileName}`;
      const message = "🎙️ <b>NEW VOICE CONFESSION</b>\n\n" +
                      "<b>Category:</b> " + escapeHtml(req.body.category || "Voice") + "\n\n" +
                      "<a href='" + publicUrl + "'>Listen to Audio</a>";

      const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: "HTML" }),
        signal: AbortSignal.timeout(15000)
      });

      if (!tgRes.ok) throw new Error("Telegram delivery failed.");
      return res.status(200).json({ success: true });
    }

    // --- TEXT CONFESSIONS ---
    const confession = typeof req.body.confession === "string" ? req.body.confession.trim() : "";
    const category = typeof req.body.category === "string" ? req.body.category.trim() : "";

    if (confession.length < 10 || confession.length > 5000) {
      return res.status(400).json({ error: "10-5000 characters required." });
    }
    if (!category) return res.status(400).json({ error: "Category required." });

    const message = "🕯️ <b>NEW ANONYMOUS CONFESSION</b>\n\n" +
                    "<b>Category:</b> " + escapeHtml(category) + "\n\n" +
                    "<b>Confession:</b>\n" + escapeHtml(confession);

    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(15000)
    });

    if (!tgRes.ok) return res.status(502).json({ error: "Delivery failed." });
    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("Submission error:", error.message);
    return res.status(500).json({ error: "Something went wrong." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Unholy Confessions API running on port ${PORT}`);
});
