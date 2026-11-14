const DEFAULT_MODELS = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-4-5",
  gemini: "gemini-3.8-flash",
  openrouter: "openrouter/free",
  groq: "openai/gpt-oss-120b",
  mistral: "mistral-small-latest"
};

const KEY_PAGES = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  gemini: "https://aistudio.google.com/apikey",
  openrouter: "https://openrouter.ai/settings/keys",
  groq: "https://console.groq.com/keys",
  mistral: "https://console.mistral.ai/api-keys"
};

const $ = (id) => document.getElementById(id);
const providerEl = $("provider"), keyEl = $("apiKey"), modelEl = $("model"), statusEl = $("status");

function refresh() {
  const p = providerEl.value;
  modelEl.placeholder = `Default: ${DEFAULT_MODELS[p]}`;
  $("getKey").href = KEY_PAGES[p];
}

chrome.storage.local.get(["provider", "apiKey", "model"]).then((s) => {
  providerEl.value = s.provider || "openrouter";
  keyEl.value = s.apiKey || "";
  modelEl.value = s.model || "";
  refresh();
});

providerEl.addEventListener("change", () => {
  modelEl.value = "";
  refresh();
});

$("toggle").addEventListener("click", () => {
  const hidden = keyEl.type === "password";
  keyEl.type = hidden ? "text" : "password";
  $("toggle").textContent = hidden ? "Hide" : "Show";
});

async function save() {
  await chrome.storage.local.set({
    provider: providerEl.value,
    apiKey: keyEl.value.trim(),
    model: modelEl.value.trim()
  });
  statusEl.textContent = "Saved ✓";
  setTimeout(() => (statusEl.textContent = ""), 1800);
}

$("save").addEventListener("click", save);
document.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
