// Conceipt content script for ChatGPT: adds an "Export Conceipt" button, scrapes the chat, shows the receipt.

(() => {
  if (window.__conceiptLoaded) return;
  window.__conceiptLoaded = true;

  // ---------- Scraper (the only ChatGPT-specific part) ----------
  // ChatGPT changes its page markup from time to time, so we try several known layouts in order.
  // If "No messages found" comes back, add a new strategy at the top of this list.
  const STRATEGIES = [
    {
      // Layout seen Nov 2026: <li data-message-role="user|assistant"> inside <ol data-conversation-transcript>
      name: "data-message-role",
      selector: "[data-message-role]",
      role: (n) => n.getAttribute("data-message-role"),
      text: (n, role) => {
        const inner = role === "user"
          ? n.querySelector("[data-user-message-bubble]")
          : [...n.querySelectorAll("[data-assistant-markdown]")];
        if (Array.isArray(inner)) return inner.length ? inner.map((e) => e.innerText).join("\n\n") : n.innerText;
        return (inner || n).innerText;
      }
    },
    {
      // Older layout: elements marked data-message-author-role="user|assistant"
      name: "data-message-author-role",
      selector: "[data-message-author-role]",
      role: (n) => n.getAttribute("data-message-author-role"),
      text: (n) => n.innerText
    },
    {
      // Another older layout: <article data-turn="user|assistant">
      name: "data-turn",
      selector: "article[data-turn]",
      role: (n) => n.getAttribute("data-turn"),
      text: (n) => n.innerText
    }
  ];

  // Fallback with no role attributes at all (logged-in layout seen Nov 2026):
  //   user message      = div.whitespace-pre-wrap inside a right-aligned (items-end) bubble
  //   assistant message = element with class "markdown" (ChatGPT's rendered reply)
  // querySelectorAll returns matches in page order, so the conversation order is kept.
  function scrapeByClasses() {
    const root = document.querySelector("main") || document.body;
    const nodes = root.querySelectorAll('div.whitespace-pre-wrap, [class~="markdown"]');
    const messages = [];
    nodes.forEach((node) => {
      if (node.closest("form, [contenteditable='true']")) return; // skip the input box
      let role = null;
      if (node.matches('[class~="markdown"]')) {
        if (node.parentElement && node.parentElement.closest('[class~="markdown"]')) return; // nested
        role = "assistant";
      } else {
        if (node.closest('[class~="markdown"]')) return; // pre-wrap block inside a reply
        if (!node.closest('[class~="items-end"]')) return; // not a user bubble
        role = "user";
      }
      const text = (node.innerText || "").trim();
      if (!text) return;
      const last = messages[messages.length - 1];
      if (last && last.role === role) last.text += "\n\n" + text;
      else messages.push({ role, text });
    });
    return messages;
  }

  function scrapeChatGPT() {
    const report = [];
    for (const s of STRATEGIES) {
      report.push(`${s.name}: ${document.querySelectorAll(s.selector).length}`);
      const nodes = document.querySelectorAll(s.selector);
      if (!nodes.length) continue;
      const messages = [];
      nodes.forEach((node) => {
        const role = s.role(node);
        if (role !== "user" && role !== "assistant") return;
        const text = (s.text(node, role) || "").trim();
        if (!text) return;
        const last = messages[messages.length - 1];
        if (last && last.role === role) last.text += "\n\n" + text;
        else messages.push({ role, text });
      });
      if (messages.length) {
        console.debug(`[Conceipt] scraped ${messages.length} messages using "${s.name}"`);
        return messages;
      }
    }
    const byClass = scrapeByClasses();
    const users = byClass.filter((m) => m.role === "user").length;
    report.push(`class-based: ${users} user / ${byClass.length - users} assistant`);
    if (byClass.length) {
      console.debug(`[Conceipt] scraped ${byClass.length} messages using "class-based"`);
      if (users === 0 || users === byClass.length) {
        console.warn("[Conceipt] class-based scrape found only one side of the conversation", report);
      }
      return byClass;
    }
    console.warn("[Conceipt] no messages found; ChatGPT's page layout may have changed", report.join(" | "));
    return [];
  }

  // ---------- Primary source: ChatGPT's own conversation data ----------
  // The page loads each chat from /backend-api/conversation/<id> using your logged-in session.
  // We make the same same-origin request. The session token never leaves chatgpt.com.
  async function fetchConversationFromAPI() {
    const m = location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
    if (!m) return { messages: [], why: "not a saved conversation URL" };
    try {
      const session = await fetch("/api/auth/session", { credentials: "include" }).then((r) => (r.ok ? r.json() : null));
      const token = session && session.accessToken;
      if (!token) return { messages: [], why: "no session token (logged out?)" };
      const res = await fetch(`/backend-api/conversation/${m[1]}`, {
        credentials: "include",
        headers: { authorization: `Bearer ${token}` }
      });
      if (!res.ok) return { messages: [], why: `conversation API returned ${res.status}` };
      const data = await res.json();
      return { messages: messagesFromMapping(data), why: "" };
    } catch (e) {
      return { messages: [], why: `API error: ${e.message}` };
    }
  }

  // Walk from the current message back to the root, so only the visible branch is kept
  // (edited/regenerated alternatives are skipped).
  function messagesFromMapping(data) {
    const out = [];
    const mapping = (data && data.mapping) || {};
    let id = data && data.current_node;
    const seen = new Set();
    while (id && mapping[id] && !seen.has(id)) {
      seen.add(id);
      const node = mapping[id];
      const msg = node.message;
      if (msg) {
        const role = msg.author && msg.author.role;
        const hidden = msg.metadata && msg.metadata.is_visually_hidden_from_conversation;
        const toolCall = msg.recipient && msg.recipient !== "all";
        if ((role === "user" || role === "assistant") && !hidden && !toolCall) {
          const parts = (msg.content && msg.content.parts) || [];
          const text = parts.filter((p) => typeof p === "string").join("\n").trim();
          if (text) out.push({ role, text });
        }
      }
      id = node.parent;
    }
    out.reverse();
    const merged = [];
    for (const m of out) {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role) last.text += "\n\n" + m.text;
      else merged.push({ ...m });
    }
    return merged;
  }

  async function getMessages() {
    const api = await fetchConversationFromAPI();
    if (api.messages.length) {
      console.debug(`[Conceipt] got ${api.messages.length} messages from ChatGPT's conversation API`);
      return { messages: api.messages, source: "conversation data" };
    }
    console.warn(`[Conceipt] conversation API unavailable (${api.why}); falling back to reading the page`);
    return { messages: scrapeChatGPT(), source: "page" };
  }

  function toTranscript(messages) {
    return messages
      .map((m) => `[${m.role === "user" ? "USER" : "ASSISTANT"}]\n${m.text}`)
      .join("\n\n");
  }

  // ---------- Helpers ----------
  function localISO(d = new Date()) {
    const pad = (n) => String(Math.abs(n)).padStart(2, "0");
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}` +
      `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
    );
  }

  function fileNameFor(receipt) {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const m = receipt.match(/^topic:\s*(.+)$/m);
    const slug = (m ? m[1] : "session")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "session";
    return `${ymd}-${slug}.conceipt.md`;
  }

  function download(text, name) {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- UI (inside a shadow root so ChatGPT's CSS can't touch it) ----------
  const host = document.createElement("div");
  host.id = "conceipt-host";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
      .fab {
        position: fixed; right: 20px; bottom: 96px; z-index: 2147483646;
        background: #111; color: #fff; border: 1px solid #444; border-radius: 999px;
        padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
        box-shadow: 0 4px 14px rgba(0,0,0,.25);
      }
      .fab:hover { background: #222; }
      .fab:disabled { opacity: .6; cursor: progress; }
      .overlay {
        position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.5);
        display: none; align-items: center; justify-content: center;
      }
      .overlay.open { display: flex; }
      .panel {
        width: min(860px, 92vw); height: min(80vh, 760px); background: #fff; color: #111;
        border-radius: 12px; display: flex; flex-direction: column; overflow: hidden;
      }
      .head { padding: 14px 18px; border-bottom: 1px solid #e5e5e5; display: flex; justify-content: space-between; align-items: center; }
      .head h2 { margin: 0; font-size: 15px; }
      .status { font-size: 12px; color: #555; }
      textarea {
        flex: 1; margin: 0; border: 0; padding: 16px 18px; resize: none; outline: none;
        font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.5; color: #111; background: #fafafa;
      }
      .foot { padding: 12px 18px; border-top: 1px solid #e5e5e5; display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
      .foot .name { margin-right: auto; font-size: 12px; color: #555; }
      button.btn { border: 1px solid #ccc; background: #fff; color: #111; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
      button.btn.primary { background: #111; color: #fff; border-color: #111; }
      button.btn:disabled { opacity: .5; cursor: default; }
      .error { color: #b00020; }
    </style>
    <button class="fab" id="fab" title="Export this chat as a Conceipt">Export Conceipt</button>
    <div class="overlay" id="overlay">
      <div class="panel">
        <div class="head"><h2>Conceipt</h2><span class="status" id="status"></span></div>
        <textarea id="out" spellcheck="false" placeholder="Generating…"></textarea>
        <div class="foot">
          <span class="name" id="fname"></span>
          <button class="btn" id="regen">Regenerate</button>
          <button class="btn" id="copy">Copy</button>
          <button class="btn primary" id="dl">Download .conceipt.md</button>
          <button class="btn" id="close">Close</button>
        </div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(host);

  // ---------- On/off switch (set from the toolbar popup) ----------
  function applyEnabled(on) {
    host.style.display = on ? "" : "none";
    if (!on) root.getElementById("overlay").classList.remove("open");
  }
  chrome.storage.local.get("enabled").then((s) => applyEnabled(s.enabled !== false));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.enabled) applyEnabled(changes.enabled.newValue !== false);
  });

  const $ = (id) => root.getElementById(id);
  const fab = $("fab"), overlay = $("overlay"), out = $("out"), status = $("status"), fname = $("fname");

  function setStatus(text, isError = false) {
    status.textContent = text;
    status.className = "status" + (isError ? " error" : "");
  }

  function setBusy(busy) {
    fab.disabled = busy;
    fab.textContent = busy ? "Generating…" : "Export Conceipt";
    ["regen", "copy", "dl"].forEach((id) => ($(id).disabled = busy));
  }

  async function run() {
    overlay.classList.add("open");
    out.value = "";
    fname.textContent = "";
    setBusy(true);
    setStatus("Reading conversation…");
    const { messages, source } = await getMessages();
    if (messages.length === 0) {
      setBusy(false);
      setStatus("No messages found. Open a saved ChatGPT conversation (URL with /c/…) and try again.", true);
      return;
    }
    const nUser = messages.filter((m) => m.role === "user").length;
    const nAsst = messages.length - nUser;
    setStatus(`Read ${nUser} of your messages and ${nAsst} replies (from ${source}). Generating receipt…`);

    const transcript = toTranscript(messages);
    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: "CONCEIPT_GENERATE",
        transcript,
        meta: {
          issued: localISO(),
          source: "chatgpt (web)",
          title: document.title.replace(/\s*[-|]\s*ChatGPT\s*$/i, "") || "Untitled chat"
        }
      });
    } catch (e) {
      res = { ok: false, error: "Extension was reloaded. Refresh this page and try again." };
    }
    setBusy(false);

    if (!res || !res.ok) {
      const err = res && res.error === "NO_KEY"
        ? "No API key set. Click the Conceipt icon in your toolbar to open settings."
        : (res && res.error) || "Unknown error";
      setStatus(err, true);
      if (res && res.error === "NO_KEY") chrome.runtime.sendMessage({ type: "CONCEIPT_OPEN_OPTIONS" });
      return;
    }
    out.value = res.text;
    fname.textContent = fileNameFor(res.text);
    setStatus(`Done · ${res.text.split(/\s+/).length} words · edit before downloading if needed`);
  }

  function alertInPanel(msg) {
    overlay.classList.add("open");
    out.value = "";
    fname.textContent = "";
    setStatus(msg, true);
  }

  fab.addEventListener("click", run);
  $("regen").addEventListener("click", run);
  $("close").addEventListener("click", () => overlay.classList.remove("open"));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("open"); });
  $("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(out.value); setStatus("Copied to clipboard"); }
    catch { out.select(); document.execCommand("copy"); setStatus("Copied to clipboard"); }
  });
  $("dl").addEventListener("click", () => {
    if (!out.value.trim()) return;
    const name = fileNameFor(out.value);
    download(out.value, name);
    setStatus(`Downloaded ${name}`);
  });
})();
