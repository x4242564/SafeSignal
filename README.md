# SafeSignal Chat

This project is a web demo that showcases a safety-screening workflow using separate HTML, CSS, and JavaScript assets, backed by a small Express server that calls the Claude API.

## Structure

- `index.html` — app layout and UI shell
- `css/styles.css` — styling for the full chat experience
- `js/config.js` — prompt text, categories, resource directory, and constants
- `js/utils.js` — small pure helpers (escaping, formatting, ids)
- `js/state.js` — app state, persistence (localStorage), and derived message selectors
- `js/safety-pipeline.js` — the orchestrator/specialist prompts, response normalization, and the screening flow
- `js/claude-backend.js` — talks to the standalone server's `/api/screen` endpoint
- `js/render.js` — all DOM rendering (thread, inspector, moderator queue, composer)
- `js/app.js` — entry point: wires up event listeners and bootstraps the app
- `server.js` — Express server: serves the static frontend and proxies screening requests to the Anthropic API, keeping the API key server-side

## Run standalone (outside Claude Code)

The frontend calls Claude to screen every message. Since browser JS can't hold an API key safely, `server.js` keeps the key server-side and the frontend calls it over `/api/screen`.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add your API key:

   ```bash
   cp .env.example .env
   ```

   Then edit `.env` and set `ANTHROPIC_API_KEY` to a key from [console.anthropic.com](https://console.anthropic.com/settings/keys).

3. Start the server:

   ```bash
   npm start
   ```

4. Open `http://localhost:8000` (or whatever `PORT` you set in `.env`).

The composer's "Analysis" dropdown (Fast / Balanced / Thorough) selects the model used for the main analysis step: Fast → Claude Haiku, Balanced → Claude Sonnet, Thorough → Claude Opus.

## Run inside Claude Code

When this page is opened inside the Claude app or claude.ai, it uses the built-in `window.claude.use('sample')` capability instead and doesn't need the server or an API key. Serve the static files however you like, e.g.:

```bash
python -m http.server 8000
```

## Notes

- `.env` is gitignored — never commit your API key. `.env.example` documents the required variables.
- The app uses the browser's local storage to preserve chat state across reloads.
- If neither Claude Code nor the standalone server is reachable, the composer disables sending and shows a banner explaining why.
