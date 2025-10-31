/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
// System prompt: strictly restricts the assistant to L'Oréal product and beauty topics.
// This prompt forces a polite, single-line refusal when the user asks anything
// outside the allowed scope (other brands, medical/legal advice, politics, etc.).
const SYSTEM_PROMPT = `You are a helpful specialist for L'Oréal. ONLY answer questions about L'Oréal products, L'Oréal product ingredients (non-medical descriptions), and recommended skincare, haircare or beauty routines using L'Oréal products. Provide product recommendations only within the L'Oréal portfolio. If a user asks about topics outside this scope (for example: other brands, medical diagnoses, legal advice, politics, or unrelated subjects), reply exactly and briefly: "Sorry — I can only help with L'Oréal products, routines, and beauty recommendations. Please ask about those topics." Do not provide additional out-of-scope information. Keep answers concise, friendly, and when recommending products remind users to patch test and consult a professional for serious conditions.`;

// URL of your deployed Cloudflare Worker which forwards requests to OpenAI.
// Set to the worker URL provided by the user.
const WORKER_URL = "https://rapid-smoke-3f7b.mkamal21.workers.dev/";

// Initial welcome message
appendMessage(
  "ai",
  "👋 Hello! I can help with L'Oréal products, routines, and recommendations. Ask me about a product, routine, or ingredient."
);

// Conversation history and persistence
const MAX_HISTORY_MESSAGES = 10; // keep the last N user/assistant messages (not counting system)
let conversationHistory = [];
let userName = null;

function initConversation() {
  // Start with the system prompt
  conversationHistory = [{ role: "system", content: SYSTEM_PROMPT }];

  // Try to restore from sessionStorage
  try {
    const raw = sessionStorage.getItem("conversationHistory");
    const storedName = sessionStorage.getItem("userName");
    if (storedName) userName = storedName;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Ensure system prompt remains the first entry
        // Merge stored messages after the system prompt
        const storedMessages = parsed.filter((m) => m.role !== "system");
        conversationHistory = [
          { role: "system", content: SYSTEM_PROMPT },
        ].concat(storedMessages);
      }
    }
  } catch (err) {
    console.warn("Could not restore conversation history:", err);
  }

  // If we have a known user name, add a system context message
  if (userName) {
    conversationHistory.splice(1, 0, {
      role: "system",
      content: `User name: ${userName}`,
    });
  }

  // Render restored history to the chat window (skip system messages)
  renderHistory();
  // If there's a most recent user message in history, display it as the latest question
  try {
    const nonSystem = conversationHistory.filter((m) => m.role !== "system");
    // find last user index in nonSystem
    let lastUserIndex = -1;
    for (let i = nonSystem.length - 1; i >= 0; i--) {
      if (nonSystem[i].role === "user") {
        lastUserIndex = i;
        break;
      }
    }
    if (lastUserIndex !== -1) {
      const lastUser = nonSystem[lastUserIndex];
      // Try to insert the latest-question element before the assistant reply that follows it
      const msgNodes = Array.from(chatWindow.querySelectorAll(".msg"));
      const insertBeforeNode = msgNodes[lastUserIndex + 1] || null;
      showLatestQuestion(lastUser.content, insertBeforeNode);
    }
  } catch (e) {
    // ignore
  }
}

function persistHistory() {
  try {
    // Persist only non-system messages to keep storage small
    const toStore = conversationHistory.filter((m) => m.role !== "system");
    sessionStorage.setItem("conversationHistory", JSON.stringify(toStore));
    if (userName) sessionStorage.setItem("userName", userName);
  } catch (err) {
    console.warn("Failed to persist conversation history", err);
  }
}

function renderHistory() {
  // Clear messages area and re-render non-system messages
  chatWindow.innerHTML = "";
  // Find all messages except system ones
  conversationHistory.forEach((m) => {
    if (m.role === "system") return;
    const role =
      m.role === "assistant" || m.role === "ai" || m.role === "system"
        ? "ai"
        : m.role;
    appendMessage(role === "user" ? "user" : "ai", m.content);
  });
}

/**
 * Show the user's latest question just above the assistant response.
 * If beforeEl is provided, insert the label before that element (useful
 * to place it right above a loading indicator). Otherwise append at the end.
 */
function showLatestQuestion(text, beforeEl) {
  // Remove existing latest-question element if present
  const prev = document.getElementById("latest-question");
  if (prev) prev.remove();

  const el = document.createElement("div");
  el.id = "latest-question";
  el.className = "latest-question";
  el.textContent = text;

  if (beforeEl && beforeEl.parentNode === chatWindow) {
    chatWindow.insertBefore(el, beforeEl);
  } else {
    chatWindow.appendChild(el);
  }
  // keep it visible
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function trimHistory() {
  // Keep system messages at start, then last MAX_HISTORY_MESSAGES of user/assistant
  const systemMsgs = conversationHistory.filter((m) => m.role === "system");
  const nonSystem = conversationHistory.filter((m) => m.role !== "system");
  const trimmed = nonSystem.slice(-MAX_HISTORY_MESSAGES);
  conversationHistory = systemMsgs.concat(trimmed);
}

function setUserNameIfPresent(text) {
  if (userName) return;
  // naive detection: "my name is Alice", "I'm Alice", "I am Alice"
  const m = text.match(
    /\b(?:my name is|i am|i'm|im)\s+([A-Z][a-zA-Z'-]{1,30})/i
  );
  if (m && m[1]) {
    userName = m[1];
    // Insert or replace a system context message with the user name
    // Remove any existing 'User name:' system messages
    conversationHistory = conversationHistory.filter(
      (m) =>
        !(
          m.role === "system" &&
          m.content &&
          m.content.startsWith("User name:")
        )
    );
    conversationHistory.splice(1, 0, {
      role: "system",
      content: `User name: ${userName}`,
    });
    persistHistory();
  }
}

/* Helper: append a message to the chat window */
function appendMessage(role, text) {
  const msg = document.createElement("div");
  msg.className = "msg " + (role === "user" ? "user" : "ai");
  // Use textContent to avoid HTML injection
  msg.textContent = text;
  chatWindow.appendChild(msg);
  // scroll to bottom
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return msg;
}

/* Show a temporary loading indicator message and return the element */
function appendLoading() {
  const el = document.createElement("div");
  el.className = "msg ai loading";
  el.textContent = "…";
  chatWindow.appendChild(el);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return el;
}

/* Handle form submit */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = userInput.value.trim();
  if (!text) return;

  // Render user's message
  appendMessage("user", text);
  userInput.value = "";
  userInput.disabled = true;

  // Update conversation history with the new user message
  conversationHistory.push({ role: "user", content: text });
  setUserNameIfPresent(text);
  trimHistory();
  persistHistory();

  // Show loading
  const loadingEl = appendLoading();

  // Display the latest user question above the assistant response/loading
  showLatestQuestion(text, loadingEl);

  // Build the messages array from conversationHistory (send to worker)
  const messages = conversationHistory.map((m) => ({
    role: m.role === "assistant" ? "assistant" : m.role,
    content: m.content,
  }));

  // Client uses the Cloudflare Worker to call OpenAI. No API key required in the browser.

  try {
    // Send request to the Cloudflare Worker which will sign the request to OpenAI.
    if (!WORKER_URL || WORKER_URL.indexOf("REPLACE_WITH_YOUR") !== -1) {
      throw new Error(
        "Worker URL not configured. Set WORKER_URL in script.js to your deployed worker URL."
      );
    }

    const resp = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Worker expects JSON body with `{ messages }` (see RESOURCE_cloudflare-worker.js)
      body: JSON.stringify({ messages }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`API error: ${resp.status} ${errText}`);
    }

    const data = await resp.json();
    let assistant = "Sorry, I didn't get a response.";
    if (
      data &&
      Array.isArray(data.choices) &&
      data.choices[0] &&
      data.choices[0].message &&
      typeof data.choices[0].message.content === "string"
    ) {
      assistant = data.choices[0].message.content;
    }

    // Update conversation history with assistant reply
    conversationHistory.push({ role: "assistant", content: assistant });
    trimHistory();
    persistHistory();

    // Replace loading with assistant reply
    loadingEl.remove();
    appendMessage("ai", assistant);
  } catch (err) {
    console.error(err);
    loadingEl.textContent = "Error: " + (err.message || "Request failed");
  } finally {
    userInput.disabled = false;
    userInput.focus();
  }
});

// Initialize conversation on load (restores session history and renders it)
initConversation();
