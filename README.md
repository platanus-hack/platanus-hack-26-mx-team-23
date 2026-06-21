<img src="./project-logo.png" alt="Klai" width="120" />

# Klai

**The first interface that builds itself over any video.**

You don't navigate menus or click buttons. You speak (or type), and Klai builds the exact widget you need right on top of whatever you're watching. It reads the current video frame to understand the context, then composes animated widgets over the video, placed so they don't cover the action.

Built at Platanus Hack 26 (CDMX) for the **New Interface** track.

---

## What it is

Klai is a Chrome extension (plus a small Next.js backend) that turns any video into an interactive surface driven by intent. Today it shines on sports: while watching a match you ask for the score, the stats, the win probability, or a timer, and it appears instantly over the broadcast. The same engine works on lectures, cooking videos, and gameplay.

The idea is to flip the usual relationship: instead of you adapting to a fixed UI, the UI adapts to your intent.

## How it works

1. You ask for something by voice or text.
2. Klai captures the visible tab frame and interprets it with AI (Claude, vision).
3. It returns a validated description of which widget to render, and the extension draws a hand-built, animated component over the video.

The AI never writes runtime code. It chooses from a curated set of components and fills their data, which keeps the result reliable and consistent.

## Features

- **Works on any video** — sports, lectures, cooking, gameplay. Klai detects the kind of content and picks the right widgets.
- **Voice and text** — speak or type your request.
- **Live widgets** — scoreboard, stats panel, win-probability bar, alerts, timer, key points, definitions.
- **Voice control of the interface** — "close the scoreboard", "move the stats to the right", "clear everything".
- **Watch mode** — Klai proactively surfaces notable moments on its own (a goal, a penalty, a card).
- **Fill-the-gap scoreboard** — when the broadcast hides its own score (a replay, a wide shot), Klai shows the last known score; when the broadcast shows it again, Klai's hides itself.
- **Manageable widgets** — drag, close, and arrange each widget freely.

### Sports examples (most tested)

While watching a match:

- "What's the score?" — a live scoreboard with teams and minute.
- "Who's winning?" — a win-probability bar.
- "Show me the cards" — yellow and red cards per team.
- "Put a 10 minute timer" — a countdown over the video.
- "Give me the match summary" — several widgets at once.

## Install (for users)

The fastest way to try Klai. The extension talks to our hosted backend, so you don't need to run anything else.

1. Download the latest `klai-extension-v1.0.1.zip` from the [Releases page](https://github.com/KiraBelak/overlai/releases).
2. Unzip it.
3. Open `chrome://extensions`, enable **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped folder.
5. On first run, grant microphone access on the one-time page that opens (needed for voice).

That's it. Open any video and start asking.

> Note: Chrome does not allow one-click installs from outside the Chrome Web Store, so the load-unpacked step above is the supported way until the store listing is live.

## Run from source (for developers)

Klai is open source. To run the full stack locally:

### 1. Backend

```bash
cd backend
yarn install
```

Create `backend/.env.local` with your keys:

```bash
ANTHROPIC_API_KEY=sk-ant-...   # Claude (vision + structured output)
OPENAI_API_KEY=sk-...          # Whisper voice transcription
FIRECRAWL_API_KEY=fc-...       # web research (optional)
```

Then run it:

```bash
yarn dev   # serves on http://localhost:3000
```

### 2. Extension

```bash
cd extension
npm install
npm run build:dev   # builds to dist/ pointing at localhost, with auto-rebuild
```

Load it in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select `extension/dist`

On first run, Klai opens a one-time page to grant microphone access (needed for voice).

> For a production build pointing at the deployed backend, set `VITE_BACKEND_BASE_URL` in `extension/.env.production` and run `npm run build`.

## Usage

- Click the Klai icon and speak or type your request, or use the keyboard shortcut **Alt+Shift+K** over any video.
- Turn on **Watch mode** in the popup to let Klai surface notable moments automatically.
- Manage widgets by voice ("close the scoreboard", "move it to the right") or by dragging and closing them directly.

## Tech stack

- **Extension**: Chrome Manifest V3, React, TypeScript, Vite + CRXJS, Framer Motion, Zod.
- **Backend**: Next.js (App Router) on Vercel.
- **AI**: Claude for vision and structured (tool-use) output; Whisper for voice transcription.
- **Data**: live sports data from ESPN.

## Project structure

```
extension/   Chrome extension (popup, content overlay, service worker, widgets)
backend/     Next.js API (/api/generate, /api/transcribe) + landing page
```

## Open source

Contributions are welcome. Open an issue or a pull request. The curated-component model makes it easy to add a new widget: define its schema, build the component, register it, and describe it to the model.

## Team

- Juan Kaleb Rodriguez Esparza ([@KiraBelak](https://github.com/KiraBelak))
- Fora Delgado ([@Foralitos](https://github.com/Foralitos))
- Pedro Gutierrez ([@ronihy](https://github.com/ronihy))
