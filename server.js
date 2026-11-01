const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Cloudflare R2 Credentials (Set these in Render)
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_ACCESS_KEY = process.env.CF_ACCESS_KEY;
const CF_SECRET_KEY = process.env.CF_SECRET_KEY;
const CF_BUCKET_NAME = process.env.CF_BUCKET_NAME;

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS || "https://unholyconfessions.online"
)
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

// Increased limit to 15mb to handle base64 audio files
app.use(express.json({ limit: "15mb" }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Rate limit: 5 submissions per IP per 10 minutes.
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
  if (record.count >= 5) {
    return res.status(429).json({ error: "Too many attempts. Please try again later." });
  }
  record.count++;
  next();
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

app.post("/api/confessions", async (req, res) => {
  try {
    if (!BOT_TOKEN || !CHAT_ID) {
      return res.status(500).json({ error: "Server configuration is incomplete." });
    }

    const type = req.body.type || "text";
    const consent = req.body.consent === true;

    if (!consent) {
      return res.status(400).json({ error: "Please confirm consent before submitting." });
    }

    // --- HANDLE VOICE NOTES ---
    if (type === "voice") {
      if (!req.body.audio) {
        return res.status(400).json({ error: "No audio data received." });
      }

      const base64Data = req.body.audio.replace(/^data:audio\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const fileName = `voice_${Date.now()}.webm`;
      
      // Upload to Cloudflare R2 using S3 API
      const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${CF_BUCKET_NAME}/objects/${fileName}`;
      
      const cfResponse = await fetch(cfUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${CF_ACCESS_KEY}:${CF_SECRET_KEY}`,
          'Content-Type': 'audio/webm'
        },
        body: buffer
      });

      if (!cfResponse.ok) {
        const errText = await cfResponse.text();
        console.error("Cloudflare Error:", errText);
        throw new Error("Failed to upload audio to storage.");
      }

      // We need your public R2 URL. Replace this with your actual public R2 URL.
      // Example: https://pub-1234567890abcdef.r2.dev/voice_12345.webm
      const publicUrl = `${process.env.CF_PUBLIC_URL}/${fileName}`;

      // Send the link to Telegram
      const message = "🎙️ <b>NEW VOICE CONFESSION</b>\n\n" +
                      "<b>Category:</b> " + escapeHtml(req.body.category || "Voice") + "\n\n" +
                      "<a href='" + publicUrl + "'>Listen to Audio</a>";

      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: CHAT_ID,
            text: message,
            parse_mode: "HTML"
          }),
          signal: AbortSignal.timeout(15000)
        }
      );

      const result = await telegramResponse.json();
      if (!telegramResponse.ok || !result.ok) throw new Error("Telegram delivery failed.");
      return res.status(200).json({ success: true });
    }

    // --- HANDLE TEXT CONFESSIONS ---
    const confession = typeof req.body.confession === "string" ? req.body.confession.trim() : "";
    const category = typeof req.body.category === "string" ? req.body.category.trim() : "";

    if (confession.length < 10 || confession.length > 5000) {
      return res.status(400).json({ error: "Your confession must be 10–5000 characters." });
    }
    if (!category || category.length > 80) {
      return res.status(400).json({ error: "Please choose a valid category." });
    }

    const message = "🕯️ <b>NEW ANONYMOUS CONFESSION</b>\n\n" +
                    "<b>Category:</b> " + escapeHtml(category) + "\n\n" +
                    "<b>Confession:</b>\n" + escapeHtml(confession);

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: message,
          parse_mode: "HTML"
        }),
        signal: AbortSignal.timeout(15000)
      }
    );

    const result = await telegramResponse.json();
    if (!telegramResponse.ok || !result.ok) {
      console.error("Telegram delivery failed:", result.description);
      return res.status(502).json({ error: "Delivery failed. Please try again later." });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Submission error:", error.message);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Unholy Confessions API running on port ${PORT}`);
});
