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

app.get('/otin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/otin.html'));
});

app.get('/admin', (req, res) => {
  // Generate letter cards HTML from stored confessions
  let cardsHTML = '';
  for (const c of adminConfessions) {
    const safeFrom = c.from.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
    const safeMessage = c.message.replace(/&/g, '&').replace(/</g, '>').replace(/\n/g, '<br>');
    cardsHTML += `
      <div class="letter-card">
        <div class="letter-header">To: ${safeFrom}</div>
        <div class="letter-body">${safeMessage}</div>
        <div class="letter-date">${c.date}</div>
      </div>
    `;
  }
  // Password prompt HTML
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Panel - Confess Wall</title>
  <link rel="stylesheet" href="style.css">
  <style>
    .prompt { background: #241320; padding: 2rem; border-radius: 8px; max-width: 360px; margin: 2rem auto; }
    .prompt input { width: 100%; padding: 0.6rem; margin-top: 0.5rem; box-sizing: border-box; }
    .prompt button { width: 100%; margin-top: 1rem; padding: 0.6rem; }
    .letter-grid { max-width: 800px; margin: 2rem auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; }
    .letter-card { border: 1px solid var(--rose-deep); border-radius: 12px; background: linear-gradient(var(--paper), var(--paper-deep)); color: var(--ink); padding: 2rem; margin: 1rem 0; }
    .letter-header { font-family: "Fraunces", Georgia, serif; font-size: 1.5rem; color: var(--rose); margin-bottom: 0.8rem; text-transform: uppercase; letter-spacing: -0.01em; }
    .letter-body { font-family: "Caveat", cursive; font-size: 1rem; line-height: 1.5; margin-bottom: 0.8rem; }
  </style>
</head>
<body>
  <div class="prompt" id="password-prompt">
    <h2>Confess Wall Admin</h2>
    <p>Enter password:</p>
    <input type="password" id="pwd" placeholder="chaddy">
    <button id="login">Login</button>
    <p id="status" style="margin-top:0.5rem;"></p>
  </div>
  <div class="letter-grid" id="letter-grid">
    ${cardsHTML}
  </div>
  <script>
    const correct = 'chaddy';
    const pwdInput = document.getElementById('pwd');
    const loginBtn = document.getElementById('login');
    const prompt = document.getElementById('password-prompt');
    const grid = document.getElementById('letter-grid');
    loginBtn.addEventListener('click', () => {
      if (pwdInput.value.trim() === correct) {
        prompt.style.display = 'none';
        grid.style.display = 'grid';
      } else {
        document.getElementById('status').textContent = 'Incorrect password.';
      }
    });
    grid.style.display = 'none';
  </script>
</body>
</html>
  `;
  res.send(html);
});

app.listen(PORT, () => {
  console.log(`Confess Wall running on port ${PORT}`);
});
