const PROVIDERS = {
  openrouter: {
    model: "openrouter/free",
    keyPage: "https://openrouter.ai/settings/keys",
    keyHint: "OpenRouter key (sk-or-…)"
  },
  gemini: {
    model: "gemini-3.8-flash",
    keyPage: "https://aistudio.google.com/apikey",
    keyHint: "Gemini key (AIza…)"
  }
};

const $ = (id) => document.getElementById(id);
const providerEl = $("provider"), keyEl = $("apiKey"), modelEl = $("model"), statusEl = $("status");
const enabledEl = $("enabled");

// One key and one model per provider, so switching providers switches keys too.
let apiKeys = {};
let models = {};

function showProvider(p) {
  providerEl.value = p;
  keyEl.value = apiKeys[p] || "";
  keyEl.placeholder = `Paste your ${PROVIDERS[p].keyHint}`;
  modelEl.value = models[p] || "";
  modelEl.placeholder = `Default: ${PROVIDERS[p].model}`;
  $("getKey").href = PROVIDERS[p].keyPage;
}

function showEnabled(on) {
  enabledEl.checked = on;
  $("stateLabel").textContent = on ? "On" : "Off";
  $("sub").textContent = on ? "Choose which AI writes your receipts." : "Paused. Button hidden on ChatGPT.";
  document.body.classList.toggle("off", !on);
  document.querySelector(".collapsible").inert = !on; // hidden fields can't be tabbed into
}

chrome.storage.local.get(["provider", "apiKeys", "models", "enabled", "apiKey", "model"]).then(async (s) => {
  apiKeys = s.apiKeys || {};
  models = s.models || {};
  let provider = PROVIDERS[s.provider] ? s.provider : "openrouter";

  // One-time migration from the old single-key settings.
  if (s.apiKey && PROVIDERS[s.provider] && !apiKeys[s.provider]) {
    apiKeys[s.provider] = s.apiKey;
    if (s.model) models[s.provider] = s.model;
  }
  if (s.apiKey !== undefined || s.model !== undefined) {
    await chrome.storage.local.set({ apiKeys, models, provider });
    await chrome.storage.local.remove(["apiKey", "model"]);
  }

  document.body.classList.add("no-anim");
  showEnabled(s.enabled !== false);
  showProvider(provider);
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove("no-anim")));
});

// Switching provider loads that provider's saved key and makes it the active one.
providerEl.addEventListener("change", async () => {
  showProvider(providerEl.value);
  await chrome.storage.local.set({ provider: providerEl.value });
  statusEl.textContent = apiKeys[providerEl.value] ? "Switched ✓" : "Add a key for this provider";
  setTimeout(() => (statusEl.textContent = ""), 1800);
});

enabledEl.addEventListener("change", async () => {
  showEnabled(enabledEl.checked);
  await chrome.storage.local.set({ enabled: enabledEl.checked });
});

$("toggle").addEventListener("click", () => {
  const hidden = keyEl.type === "password";
  keyEl.type = hidden ? "text" : "password";
  $("toggle").textContent = hidden ? "Hide" : "Show";
});

async function save() {
  const p = providerEl.value;
  apiKeys[p] = keyEl.value.trim();
  models[p] = modelEl.value.trim();
  await chrome.storage.local.set({ provider: p, apiKeys, models });
  statusEl.textContent = "Saved ✓";
  setTimeout(() => (statusEl.textContent = ""), 1800);
}

$("save").addEventListener("click", save);
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target !== enabledEl) save(); });
