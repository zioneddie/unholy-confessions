
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS || ""
)
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(express.json({ limit: "10kb" }));

// Allow requests from your website only.
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type"
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS"
    );
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// Basic in-memory rate limit: 5 submissions per IP per 10 minutes.
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
    return res.status(429).json({
      error: "Too many attempts. Please try again later."
    });
  }

  record.count++;
  next();
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

app.post("/api/confessions", async (req, res) => {
  try {
    if (!BOT_TOKEN || !CHAT_ID) {
      return res.status(500).json({
        error: "Server configuration is incomplete."
      });
    }

    const confession =
      typeof req.body.confession === "string"
        ? req.body.confession.trim()
        : "";

    const category =
      typeof req.body.category === "string"
        ? req.body.category.trim()
        : "";

    const consent = req.body.consent === true;

    if (!consent) {
      return res.status(400).json({
        error: "Please confirm consent before submitting."
      });
    }

    if (confession.length < 10 || confession.length > 2000) {
      return res.status(400).json({
        error: "Your confession must be 10–2000 characters."
      });
    }

    if (!category || category.length > 80) {
      return res.status(400).json({
        error: "Please choose a valid category."
      });
    }

    const message =
      "🕯️ <b>NEW ANONYMOUS CONFESSION</b>\n\n" +
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
      return res.status(502).json({
        error: "Delivery failed. Please try again later."
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Submission error:", error.message);

    return res.status(500).json({
      error: "Something went wrong. Please try again."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Unholy Confessions API running on port ${PORT}`);
});
