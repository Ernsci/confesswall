require("dotenv").config();
const path = require("path");
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const config = require("./config");

const app = express();
const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const TIMEZONE = process.env.TIMEZONE || "UTC";

const MAX_WORDS = config.maxWords;
const RATE_LIMIT_MS = config.rateLimitMs;
const submissions = new Map();

// Supabase setup
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'chaddy';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Bad word filter
const LEET_CHARS = { "4": "a", "@": "a", "8": "b", "3": "e", "1": "i", "!": "i", "0": "o", "5": "s", "$": "s", "7": "t", "+": "t", "9": "g" };
const SUFFIXES = ["s", "es", "ed", "ing", "er", "ers"];

function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[4@83!10$57+9]/g, (ch) => LEET_CHARS[ch])
    .replace(/[^a-z]+/g, " ")
    .trim();
}

const exactOnly = new Set((config.exactOnly || []).map((w) => normalizeText(w)));
const blockedPhrases = [];
const looseWords = [];
const strictWords = new Set();

for (const raw of Object.values(config.badWords).flat()) {
  const word = normalizeText(raw);
  if (!word) continue;
  if (word.includes(" ")) {
    blockedPhrases.push(word);
  } else if (word.length < 3 || exactOnly.has(word) || word.length <= 4) {
    strictWords.add(word);
  } else {
    looseWords.push(word);
  }
}

function stripSuffixes(word) {
  let current = word;
  let previous;
  do {
    previous = current;
    for (const suffix of SUFFIXES) {
      if (current.length > 3 && current.endsWith(suffix)) {
        current = current.slice(0, -suffix.length);
        break;
      }
    }
  } while (current !== previous);
  return current;
}

function containsBadWord(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  for (const phrase of blockedPhrases) {
    if (normalized.includes(phrase)) return true;
  }

  for (const token of normalized.split(" ")) {
    const collapsed = token.replace(/(.)\1+/g, "$1");
    if (strictWords.has(token)) return true;
    if (strictWords.has(collapsed)) return true;
    const stemmed = stripSuffixes(collapsed);
    if (strictWords.has(stemmed)) return true;
    for (const word of looseWords) {
      if (collapsed.includes(word)) return true;
    }
  }

  return false;
}

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

  // Save to Supabase (best-effort: Discord delivery already succeeded)
  const { error: dbError } = await supabase.from("confessions").insert({
    sender_name: from,
    recipient_name: to,
    message: rawMessage,
    date_display: formatDateTime(nowDate)
  });

  if (dbError) {
    console.error("Failed to save confession to database:", dbError.message);
  }

  return res.json({ success: true });
});

app.get('/adin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/adin.html'));
});

app.get('/admin/data', async (req, res) => {
  const { data, error } = await supabase
    .from("confessions")
    .select("id, sender_name, recipient_name, message, date_display, posted")
    .order("created_at", { ascending: false })
    .limit(500);

  if (!error) {
    return res.json(data.map(r => ({
      id: r.id,
      from: r.sender_name,
      to: r.recipient_name,
      message: r.message,
      date: r.date_display,
      posted: !!r.posted
    })));
  }

  // Fallback if the "posted" column migration hasn't run yet
  const { data: legacy, error: legacyError } = await supabase
    .from("confessions")
    .select("id, sender_name, recipient_name, message, date_display")
    .order("created_at", { ascending: false })
    .limit(500);

  if (legacyError) {
    console.error("Failed to fetch confessions:", legacyError.message);
    return res.status(500).json({ error: "Could not load confessions." });
  }

  res.json(legacy.map(r => ({
    id: r.id,
    from: r.sender_name,
    to: r.recipient_name,
    message: r.message,
    date: r.date_display,
    posted: false
  })));
});

function adminAuth(req, res) {
  const pw = req.get("x-admin-password") || "";
  if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Unauthorized." });
    return false;
  }
  return true;
}

app.delete("/admin/data/:id", async (req, res) => {
  if (!adminAuth(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid id." });
  }
  const { error } = await supabase.from("confessions").delete().eq("id", id);
  if (error) {
    console.error("Failed to delete confession:", error.message);
    return res.status(500).json({ error: "Delete failed." });
  }
  res.json({ success: true });
});

app.post("/admin/data/:id/posted", async (req, res) => {
  if (!adminAuth(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid id." });
  }
  const { error } = await supabase.from("confessions").update({ posted: true }).eq("id", id);
  if (error) {
    console.error("Failed to mark confession:", error.message);
    return res.status(500).json({ error: "Update failed." });
  }
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Confess Wall running on port ${PORT}`);
});