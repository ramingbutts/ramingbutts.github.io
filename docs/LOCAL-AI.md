# Local AI setup (Ollama on the Mac Mini)

The dashboard can use a local LLM to analyze the data it already stores —
starting with the **✨ Analyze** button on the Journal page. It talks to
[Ollama](https://ollama.com) at `http://localhost:11434`, so it only works in a
browser running **on the machine where Ollama is installed**. On any other
device the button simply tells you Ollama isn't reachable. No data ever leaves
the machine.

## One-time setup (24GB M4 Pro Mac Mini)

1. **Install Ollama** — download the Mac app from <https://ollama.com/download>
   (or `brew install ollama`).

2. **Pull the model:**

   ```sh
   ollama pull gpt-oss:20b
   ```

   This is a ~13GB download and uses ~13GB of unified memory while loaded —
   comfortable on 24GB. If you ever want something lighter, `qwen3:8b` is a
   good fallback (change `AI.MODEL` in `js/ai.js`).

3. **Allow the dashboard's origin (CORS).** Browsers only let
   `https://raphail369.me` call localhost if Ollama says it's allowed:

   ```sh
   launchctl setenv OLLAMA_ORIGINS "https://raphail369.me"
   ```

   Then quit and reopen the Ollama menu-bar app. To make it survive reboots,
   put that `launchctl setenv` line in a LaunchAgent, or just run the dashboard
   from a local checkout (`http://localhost`) where no CORS config is needed.

4. **Verify:** with Ollama running, open the dashboard on the Mini, go to
   Journal, click **✨ Analyze**. First run is slower while the model loads
   into memory; after that expect roughly 40–50 tok/s.

## Browser note

The live site is HTTPS and Ollama is plain HTTP on localhost. Chrome, Edge and
Firefox treat `localhost` as a trustworthy origin and allow this. Safari can be
stricter about mixed content — if the probe fails there, use Chrome on the
Mini or serve the dashboard locally.

## Troubleshooting

- Run `Diag.dump()` in the browser console — every AI call and failure is
  logged under the `ai` scope, including tokens/sec for each generation.
- `curl http://localhost:11434/api/tags` confirms Ollama is up.
- A 403 from Ollama means `OLLAMA_ORIGINS` doesn't include the page's origin.
