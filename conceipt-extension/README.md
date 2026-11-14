# Conceipt (v0.4, ChatGPT)

Adds an **Export Conceipt** button to ChatGPT. One click reads the conversation, has an LLM condense it into a Conceipt (context receipt), and downloads it as `.conceipt.md` so you can upload it into another AI.

## Install (unpacked)

1. Unzip this folder somewhere permanent.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `conceipt-extension` folder.
4. Pin Conceipt via the puzzle-piece menu, then click its toolbar icon to open the settings popup.
5. Pick **OpenRouter** or **Google Gemini**, paste that provider's API key, and save. Each provider remembers its own key, so switching providers switches keys automatically.

## Use

1. Open any conversation on chatgpt.com.
2. Click **Export Conceipt** (bottom right).
3. Review or edit the receipt in the panel, then click **Download .conceipt.md**.
4. In another AI, upload the file and send:
   *"This is a Conceipt (context receipt) from another AI. Continue from Next steps."*

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Chrome MV3 manifest: permissions, content script, background worker |
| `content.js` | Runs on ChatGPT: button, scraper, receipt panel, download |
| `background.js` | Holds the receipt prompt and calls the OpenRouter or Gemini API |
| `popup.html` / `popup.js` | Toolbar popup: provider, API key, model |

## If it breaks

- **"No messages found"**: ChatGPT probably changed its page. The scraper is `scrapeChatGPT()` in `content.js`. It tries several known ChatGPT layouts in order (`STRATEGIES`). Inspect a message in DevTools to find the new marker and add a strategy at the top of the list.
- **API error 404 / model not found**: set a model name your account has access to in settings.
- **Button doesn't appear**: refresh the ChatGPT tab after installing or reloading the extension.
- **Very long chats**: if the transcript is over ~300k characters, the middle is trimmed before sending.

## API keys

Keys are entered in the popup and saved in `chrome.storage.local` on your machine. **Never put API keys in the code or commit them to this repo**: anyone can read an extension's files, and bots scan GitHub for keys.

## Privacy note

The full chat transcript is sent to the provider you choose. Your API key is stored in `chrome.storage.local` in this browser only.
