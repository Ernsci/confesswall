require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const { createClient } = require("@supabase/supabase-js");
const config = require("./config");

const app = express();
const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const TIMEZONE = process.env.TIMEZONE || "UTC";

app.use(helmet({ contentSecurityPolicy: false }));

const MAX_WORDS = config.maxWords;
const RATE_LIMIT_MS = config.rateLimitMs;
const submissions = new Map();
const adminFails = new Map();

// Supabase setup
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'chaddy';
const IP_HASH_SECRET = process.env.IP_HASH_SECRET || "dev-insecure-salt";

function hashIp(ip) {
  return crypto.createHash("sha256").update(`${IP_HASH_SECRET}:${ip}`).digest("hex").slice(0, 32);
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Bad word filter
const LEET_CHARS = { "4": "a", "@": "a", "8": "b", "3": "e", "1": "i", "!": "i", "0": "o", "5": "s", "$": "s", "7": "t", "+": "t", "9": "g" };
const SUFFIXES = ["s", "es", "ed", "ing", "er", "ers"];
const ZERO_WIDTH = /[\u200b-\u200f\u2028\u2029\u2060-\u2064\ufeff]/g;
const HOMOGLYPHS = {
  "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c",
  "\u0445": "x", "\u0443": "y", "\u0456": "i", "\u0455": "s", "\u043a": "k",
  "\u043c": "m", "\u0442": "t", "\u0432": "b", "\u043d": "h", "\u0501": "d",
  "\u03bf": "o", "\u03b1": "a", "\u03b5": "e", "\u03b9": "i", "\u03ba": "k",
  "\u03c1": "p", "\u03c4": "t", "\u03c5": "u", "\u03bd": "v"
};
const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPHS).join("")}]`, "g");

function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .replace(ZERO_WIDTH, "")
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(HOMOGLYPH_RE, (ch) => HOMOGLYPHS[ch])
    .replace(/[4@83!10$57+9]/g, (ch) => LEET_CHARS[ch])
    .replace(/ph/g, "f")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

// join runs of >=3 single-letter tokens ("f u c k" -> "fuck") for matching only
function collapseSpacedLetters(tokens) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= 3) out.push(run.join(""));
    else out.push(...run);
    run = [];
  };
  for (const t of tokens) {
    if (t.length === 1) run.push(t);
    else { flush(); out.push(t); }
  }
  flush();
  return out;
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

function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    // treat adjacent transposition as a single edit
    if (
      i + 1 < a.length && j + 1 < b.length &&
      a[i] === b[j + 1] && a[i + 1] === b[j]
    ) {
      i += 2; j += 2; continue;
    }
    if (a.length === b.length) { i++; j++; }
    else if (a.length > b.length) i++;
    else j++;
  }
  edits += a.length - i + b.length - j;
  return edits <= 1;
}

// returns the list of matched terms (may be empty)
function findBadWords(text) {
  const matches = [];
  const push = (term) => {
    if (term && !matches.includes(term) && matches.length < 10) matches.push(term);
  };

  const normalized = normalizeText(text);
  if (!normalized) return matches;

  for (const phrase of blockedPhrases) {
    if (normalized.includes(phrase)) push(phrase);
  }

  const tokens = collapseSpacedLetters(normalized.split(" "));
  for (const token of tokens) {
    const collapsed = token.replace(/(.)\1+/g, "$1");
    if (strictWords.has(token)) { push(token); continue; }
    if (strictWords.has(collapsed)) { push(collapsed); continue; }
    const stemmed = stripSuffixes(collapsed);
    if (strictWords.has(stemmed)) { push(stemmed); continue; }
    for (const word of looseWords) {
      if (token.includes(word) || collapsed.includes(word)) { push(word); continue; }
      if (
        config.fuzzyEnabled &&
        !matches.includes(word) &&
        word.length >= config.fuzzyMinLen && token.length >= config.fuzzyMinLen &&
        (withinOneEdit(token, word) || withinOneEdit(collapsed, word))
      ) {
        push(word);
      }
    }
  }

  return matches;
}

app.use(express.json({ limit: "32kb" }));
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

async function logBlockedAttempt(ipHash, from, to, message, matches) {
  try {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await supabase
      .from("blocked_attempts")
      .select("*", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since);

    if ((count || 0) >= config.blockedLogCapPerHour) return;

    const { error } = await supabase.from("blocked_attempts").insert({
      ip_hash: ipHash,
      sender_name: from || null,
      recipient_name: to || null,
      message_excerpt: String(message || "").slice(0, 300),
      matched_words: matches.slice(0, 10),
      created_at: new Date().toISOString()
    });
    if (error) console.error("Failed to log blocked attempt:", error.message);

    if (Math.random() < 0.1) {
      const cutoff = new Date(Date.now() - config.blockedRetentionDays * 86400_000).toISOString();
      supabase.from("blocked_attempts").delete().lt("created_at", cutoff)
        .then(({ error: purgeErr }) => { if (purgeErr) console.error("Retention purge failed:", purgeErr.message); })
        .catch(() => {});
    }
  } catch (err) {
    console.error("logBlockedAttempt failed:", err.message);
  }
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

  // Persisted hourly/daily caps per person
  const thisHash = hashIp(ip);
  try {
    const { data: recent, error: rateErr } = await supabase
      .from("rate_events")
      .select("created_at")
      .eq("ip_hash", thisHash)
      .gte("created_at", new Date(now - 86400_000).toISOString());

    if (rateErr) {
      console.error("Rate cap check failed:", rateErr.message);
    } else if (Array.isArray(recent)) {
      const hourCount = recent.filter(r => new Date(r.created_at).getTime() >= now - 3600_000).length;
      if (hourCount >= config.hourlyCap) {
        return res.status(429).json({
          success: false,
          error: "You've sent quite a few confessions already — please wait a little while."
        });
      }
      if (recent.length >= config.dailyCap) {
        return res.status(429).json({
          success: false,
          error: "You've reached today's confession limit. Come back tomorrow."
        });
      }
    }
  } catch (err) {
    console.error("Rate cap check error:", err.message);
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

  const matchedWords = [
    ...new Set([
      ...findBadWords(from),
      ...findBadWords(to),
      ...findBadWords(rawMessage)
    ])
  ];

  if (matchedWords.length > 0) {
    logBlockedAttempt(thisHash, from, to, rawMessage, matchedWords);
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

  // Push notification via ntfy (best-effort, non-blocking)
  const NTFY_TOPIC = process.env.NTFY_TOPIC;
  if (NTFY_TOPIC) {
    const preview =
      displayMessage.length > 300
        ? `${displayMessage.slice(0, 300)}…`
        : displayMessage;
    fetch("https://ntfy.sh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: NTFY_TOPIC,
        title: `\u2665 New confession from ${from}`,
        message: `To: ${to}\n\n${preview}`,
        tags: ["heart"],
        priority: 4
      })
    }).catch(err => console.error("ntfy push failed:", err.message));
  }

  // record the accepted confession against the person's caps (best-effort)
  supabase.from("rate_events").insert({ ip_hash: thisHash, created_at: new Date(now).toISOString() })
    .then(({ error: rateInsertErr }) => { if (rateInsertErr) console.error("Rate event insert failed:", rateInsertErr.message); })
    .catch(() => {});
  if (Math.random() < 0.05) {
    const cutoff = new Date(now - 25 * 3600_000).toISOString();
    supabase.from("rate_events").delete().lt("created_at", cutoff)
      .then(({ error: purgeErr }) => { if (purgeErr) console.error("Rate purge failed:", purgeErr.message); })
      .catch(() => {});
  }

  return res.json({ success: true });
});

app.get('/adin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/adin.html'));
});

app.get('/creator', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/creator.html'));
});

app.get('/wall', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/wall.html'));
});

// Public wall feed — posted letters only. Sender names are deliberately NOT selected.
app.get('/api/wall', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 60);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const { data, error } = await supabase
    .from("confessions")
    .select("id, recipient_name, message, date_display")
    .eq("posted", true)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("Failed to load wall:", error.message);
    return res.status(500).json({ error: "Could not load the wall." });
  }

  res.json({
    items: (data || []).map(r => ({
      id: r.id,
      to: r.recipient_name || "Someone special",
      message: r.message,
      date: r.date_display
    })),
    hasMore: (data || []).length === limit
  });
});

app.get('/admin/data', async (req, res) => {
  if (!adminAuth(req, res)) return;
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
  const ip = getClientIp(req);
  const thisHash = hashIp(ip);
  const now = Date.now();

  // brute-force lockout: 8 failures in 10 min -> 15 min lock
  const entry = adminFails.get(thisHash);
  if (entry && entry.lockedUntil && now < entry.lockedUntil) {
    const minutes = Math.ceil((entry.lockedUntil - now) / 60000);
    res.status(429).json({ error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` });
    return false;
  }

  const pw = req.get("x-admin-password") || "";
  if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) {
    const rec = entry || { fails: [], lockedUntil: 0 };
    rec.fails = (rec.fails || []).filter(t => now - t < 600_000);
    rec.fails.push(now);
    if (rec.fails.length >= 8) {
      rec.lockedUntil = now + 900_000;
      rec.fails = [];
    }
    adminFails.set(thisHash, rec);
    res.status(401).json({ error: "Unauthorized." });
    return false;
  }

  // success passes through but keeps prior failures — only the 10-minute window forgives
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

app.get("/admin/blocked", async (req, res) => {
  if (!adminAuth(req, res)) return;
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const { data, error } = await supabase
    .from("blocked_attempts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Failed to load blocked attempts:", error.message);
    return res.status(500).json({ error: "Could not load blocked attempts." });
  }

  res.json(data.map(r => ({
    id: r.id,
    from: r.sender_name || "",
    to: r.recipient_name || "",
    excerpt: r.message_excerpt || "",
    words: r.matched_words || [],
    date: r.created_at
  })));
});

app.get("/admin/stats", async (req, res) => {
  if (!adminAuth(req, res)) return;

  const stats = { total: 0, posted: 0, blockedTotal: 0, blockedToday: 0, topOffenders: [] };
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();

  try {
    const [totalR, postedR, blockedTotalR, blockedTodayR] = await Promise.all([
      supabase.from("confessions").select("*", { count: "exact", head: true }),
      supabase.from("confessions").select("*", { count: "exact", head: true }).eq("posted", true),
      supabase.from("blocked_attempts").select("*", { count: "exact", head: true }),
      supabase.from("blocked_attempts").select("*", { count: "exact", head: true }).gte("created_at", dayAgo)
    ]);

    stats.total = totalR.count || 0;
    stats.posted = postedR.count || 0;
    stats.blockedTotal = blockedTotalR.count || 0;
    stats.blockedToday = blockedTodayR.count || 0;

    const { data: rows } = await supabase
      .from("blocked_attempts")
      .select("ip_hash")
      .order("created_at", { ascending: false })
      .limit(2000);

    const tally = {};
    for (const r of rows || []) tally[r.ip_hash] = (tally[r.ip_hash] || 0) + 1;
    stats.topOffenders = Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hash, count]) => ({ ip: `${hash.slice(0, 8)}…`, count }));
  } catch (err) {
    console.error("Stats query failed:", err.message);
  }

  res.json(stats);
});

app.listen(PORT, () => {
  console.log(`Confess Wall running on port ${PORT}`);
});