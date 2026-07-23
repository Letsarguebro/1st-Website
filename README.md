# 🏢 The Agentic Office

A website that looks like a little office where a team of AI agents plan, delegate,
and deliver — powered by real [Claude](https://www.anthropic.com/claude) agents.

You give the office a task. **Morgan** (the manager) reads it, breaks it into
assignments, and delegates to specialists — **Rae** (research), **Wes** (writing),
**Ada** (engineering), **Del** (design), and **Val** (review). Each specialist is a
real Claude API call running in parallel. You watch them light up, exchange little
work packets, and hand their pieces back. Morgan then assembles everything into one
finished deliverable, streamed live into the panel.

![demo](https://img.shields.io/badge/status-working-4f8a5b) ![model](https://img.shields.io/badge/model-claude--opus--4--8-c8663b)

## Run it

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

### Wire in real agents

The office runs in **demo mode** out of the box (no key needed) so you can see it
animate. To bring the agents to life with real Claude calls, set an API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

You can get a key from the [Anthropic Console](https://console.anthropic.com/).
Copy `.env.example` to `.env` for reference. The mode pill in the top-right shows
whether you're in **demo** or **live agents** mode.

## How it works

```
Your task
   │
   ▼
🧭 Morgan (manager)  ──►  makes a plan (structured JSON) assigning specialists
   │
   ├─►  🔍 Rae        ┐
   ├─►  ✍️ Wes        │  all run in parallel — each is its own Claude call
   ├─►  💻 Ada        │
   ├─►  🎨 Del        │
   └─►  ✅ Val        ┘
   │
   ▼
🧭 Morgan  ──►  assembles their work into the final deliverable (streamed)
```

- **`server.js`** — Express server. Serves the site and exposes `POST /api/run`,
  which streams newline-delimited JSON events (plan, statuses, messages, tokens)
  so the office can animate as the work happens.
- **`agents.js`** — the roster: each agent's name, emoji, role, and system prompt.
- **`public/`** — the office UI (no build step; plain HTML/CSS/JS).

The manager's planning step uses Claude's **structured outputs** to return a typed
plan; specialists run concurrently with `Promise.all`; the final synthesis is
**streamed** token-by-token into the page.

## Customize

- **Add or edit staff:** change the roster in `agents.js`.
- **Change the model or effort:** see `MODEL` in `agents.js` and the
  `output_config` options in `server.js`.
- **Restyle the office:** it's all in `public/style.css`.

---

Built with the [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript).
