require("dotenv").config();
const path = require("path");
const express = require("express");
const config = require("./config");

const app = express();
const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const TIMEZONE = process.env.TIMEZONE || "UTC";

const MAX_WORDS = config.maxWords;
const RATE_LIMIT_MS = config.rateLimitMs;
const submissions = new Map();
const adminConfessions = [];
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'chaddy';

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function countWords(text) {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function sanitizeName(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TIMEZONE
  }).format(date);
}

app.post("/api/confess", async (req, res) => {
  if (!DISCORD_WEBHOOK_URL) {
    return res.status(500).json({
      success: false,
      error: "Server is missing the Discord webhook configuration."
    });
  }

  const ip = getClientIp(req);
  const now = Date.now();
  const last = submissions.get(ip) || 0;

  if (now - last < RATE_LIMIT_MS) {
    const seconds = Math.ceil((RATE_LIMIT_MS - (now - last)) / 1000);
    return res.status(429).json({
      success: false,
      error: `Please wait ${seconds}s before sending another confession.`
    });
  }

  const from = sanitizeName(req.body.from, 60);
  const to = sanitizeName(req.body.to, 60);
  const rawMessage =
    typeof req.body.message === "string" ? req.body.message.trim().slice(0, 6000) : "";

  if (!from) return res.status(400).json({ success: false, error: "Please enter your name." });
  if (!to) return res.status(400).json({ success: false, error: "Please enter who this confession is for." });
  if (!rawMessage) return res.status(400).json({ success: false, error: "Please write your message." });

  if (countWords(rawMessage) > MAX_WORDS) {
    return res.status(400).json({
      success: false,
      error: `Your message exceeds the ${MAX_WORDS} word limit.`
    });
  }

  if (containsBadWord(from) || containsBadWord(to) || containsBadWord(rawMessage)) {
    return res.status(400).json({ success: false, error: config.blockedMessage });
  }

  const nowDate = new Date();
  const displayMessage =
    rawMessage.length > 4096 ? `${rawMessage.slice(0, 4093)}...` : rawMessage;

  const embed = {
    title: "New Confession",
    color: 0xec4899,
    fields: [
      { name: "From", value: from, inline: true },
      { name: "To", value: to, inline: true },
      { name: "Date & Time", value: formatDateTime(nowDate), inline: true },
      { name: "Message", value: displayMessage }
    ],
    timestamp: nowDate.toISOString(),
    footer: { text: "Confess Wall" }
  };

  try {
    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Confess Wall", embeds: [embed] })
    });

    if (!response.ok) {
      throw new Error(`Discord responded with status ${response.status}`);
    }
  } catch (err) {
    console.error("Failed to send confession:", err.message);
    return res.status(502).json({
      success: false,
      error: "Could not deliver your confession right now. Please try again in a moment."
    });
  }

  submissions.set(ip, now);
  if (submissions.size > 2000) {
    for (const [key, ts] of submissions) {
      if (now - ts > RATE_LIMIT_MS) submissions.delete(key);
    }
  }

  // Save to admin panel
  adminConfessions.push({
    from,
    to,
    message: rawMessage,
    date: formatDateTime(nowDate)
  });
  if (adminConfessions.length > 20) adminConfessions.shift();

  return res.json({ success: true });
});

app.get('/adin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/adin.html'));
});

app.get('/admin/data', (req, res) => {
  res.json(adminConfessions);
});

app.listen(PORT, () => {
  console.log(`Confess Wall running on port ${PORT}`);
});