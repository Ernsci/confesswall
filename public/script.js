const form = document.getElementById("confess-form");
const fromInput = document.getElementById("from");
const toInput = document.getElementById("to");
const messageInput = document.getElementById("message");
const messageField = messageInput.closest(".field");
const wordCount = document.getElementById("word-count");
const wordMeter = document.getElementById("word-meter");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const successCard = document.getElementById("success-card");
const anotherBtn = document.getElementById("another-btn");
const postmarkDate = document.getElementById("postmark-date");

const MAX_WORDS = 1000;

postmarkDate.textContent = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric"
}).format(new Date()).toUpperCase();

function countWords(text) {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function updateWordCount() {
  const words = countWords(messageInput.value);
  wordCount.textContent = words.toLocaleString();
  wordMeter.style.transform = `scaleX(${Math.min(words / MAX_WORDS, 1)})`;
  messageField.classList.toggle("over", words > MAX_WORDS);
}

function setStatus(text) {
  statusEl.textContent = text;
  statusEl.hidden = false;
}

function celebrate() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["var(--rose)", "var(--gold)", "var(--rose-ink)"];
  for (let i = 0; i < 18; i++) {
    const spark = document.createElement("span");
    spark.className = "burst-heart";
    spark.textContent = "\u2665";
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 90;
    spark.style.setProperty("--dx", `${Math.round(Math.cos(angle) * dist)}px`);
    spark.style.setProperty("--dy", `${Math.round(Math.sin(angle) * dist) - 30}px`);
    spark.style.setProperty("--rot", `${Math.round(Math.random() * 60 - 30)}deg`);
    spark.style.color = colors[i % colors.length];
    spark.style.fontSize = `${10 + Math.random() * 12}px`;
    spark.style.animationDelay = `${(Math.random() * 0.12).toFixed(2)}s`;
    successCard.appendChild(spark);
    spark.addEventListener("animationend", () => spark.remove());
  }
}

messageInput.addEventListener("input", updateWordCount);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.hidden = true;

  if (!fromInput.value.trim()) {
    return setStatus("Please enter your name.");
  }
  if (!toInput.value.trim()) {
    return setStatus("Please enter who this confession is for.");
  }

  const message = messageInput.value.trim();
  if (!message) {
    return setStatus("Please write your message.");
  }
  if (countWords(message) > MAX_WORDS) {
    return setStatus(`Your message is over the ${MAX_WORDS} word limit.`);
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Sealing...";

  try {
    const response = await fetch("/api/confess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromInput.value,
        to: toInput.value,
        message: message
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      setStatus(data.error || "Something went wrong. Please try again.");
    } else {
      form.hidden = true;
      successCard.hidden = false;
      celebrate();
    }
  } catch {
    setStatus("Network error. Please check your connection and try again.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Seal & Send";
  }
});

anotherBtn.addEventListener("click", () => {
  form.reset();
  updateWordCount();
  statusEl.hidden = true;
  successCard.hidden = true;
  form.hidden = false;
  fromInput.focus();
});

if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const sky = document.getElementById("sky");
  for (let i = 0; i < 16; i++) {
    const heart = document.createElement("span");
    heart.className = "heart";
    heart.textContent = "\u2665";
    if (i % 4 === 3) heart.classList.add("gold");
    heart.style.left = `${Math.random() * 100}vw`;
    heart.style.fontSize = `${10 + Math.random() * 16}px`;
    heart.style.animationDuration = `${14 + Math.random() * 14}s`;
    heart.style.animationDelay = `${-Math.random() * 28}s`;
    sky.appendChild(heart);
  }
}
