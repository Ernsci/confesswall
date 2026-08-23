const form = document.getElementById("confess-form");
const fromInput = document.getElementById("from");
const toInput = document.getElementById("to");
const messageInput = document.getElementById("message");
const wordCount = document.getElementById("word-count");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const successCard = document.getElementById("success-card");
const anotherBtn = document.getElementById("another-btn");

const MAX_WORDS = 1000;

function countWords(text) {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function updateWordCount() {
  const words = countWords(messageInput.value);
  wordCount.textContent = words.toLocaleString();
  wordCount.parentElement.classList.toggle("over", words > MAX_WORDS);
}

function setStatus(text) {
  statusEl.textContent = text;
  statusEl.hidden = false;
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
  submitBtn.textContent = "Sending...";

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
    }
  } catch {
    setStatus("Network error. Please check your connection and try again.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Send Confession";
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
