# 🏢 Axial Office — an agentic AI workspace in 3D

A website that renders a **3D isometric office** where a team of real
[Claude](https://www.anthropic.com/claude) agents plan, walk around, and work.

You talk to **Morgan**, the head agent, in chat. You give a goal; Morgan breaks it
into assignments and delegates to specialists — **Rae** (research), **Ada**
(engineering), **Wes** (writing), **Del** (design), and **Val** (review). Each
specialist is a real Claude API call. You **watch the little agents get up from
their desks and walk to the whiteboard, the Kanban wall, the vault, or the compute
desk** to do their part. Work packets fly between them. Morgan keeps running in
rounds — checking the result against your goal — **until it's actually done**, then
assembles the final deliverable.

It also remembers your past goals and can **review your history to suggest ways to
make future tasks easier**.

![status](https://img.shields.io/badge/status-working-46c46e) ![model](https://img.shields.io/badge/model-claude--opus--4--8-7c5cff) ![3d](https://img.shields.io/badge/render-three.js-2f6bff)

## Run it

```bash
npm install
npm start
```

Open <http://localhost:3000> and rotate/zoom the office with your mouse.

### Wire in real agents

Runs in **demo mode** out of the box so the office animates with no key. For real
Claude agents:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

Get a key from the [Anthropic Console](https://console.anthropic.com/).

## What you'll see

- **3D office** (Three.js): glossy agents with glowing eyes, a whiteboard, a
  holographic Kanban wall, a vault, a dual-monitor compute desk, a security gate,
  a lounge, an easel, plants — with floating labels, drivable camera, and shadows.
- **Agents that move**: when an agent is assigned work it walks to its station and
  animates; when done it returns. The agent you're engaging lights up.
- **Chat with Morgan** (left): conversational goal-setting; Morgan decides when to
  start a run and reports back when it's delivered.
- **System Overview** (right): live agent states, activity log, session history,
  and a "Suggest shortcuts" button that has Morgan mine your history for
  time-savers.
- **Runtime readout** (bottom): active agent, task, round, runtime, token count,
  status, and a progress bar — like a live build console.

## How it works

```
You ──chat──► 🧭 Morgan
                 │  plans (structured JSON) and delegates
                 ├─► 🔍 Rae  → walks to the Vault
                 ├─► 💻 Ada  → walks to Desk 01 (compute)
                 ├─► ✍️ Wes  → walks to the Lounge      (each = a real Claude call,
                 ├─► 🎨 Del  → walks to the Easel         run in parallel)
                 └─► ✅ Val  → walks to the Kanban Wall
                 │
                 ▼  assembles + self-checks against the goal
            round 2 if not done ⟳ … then delivers
```

- **`server.js`** — Express server + orchestration. Streams newline-delimited JSON
  events (plan, statuses, packets, tokens, rounds) so the 3D office animates in
  real time. Endpoints: `/api/chat` (talk to Morgan), `/api/run` (streamed work),
  `/api/history`, `/api/insights`. Persists sessions to `data/sessions.json`.
- **`agents.js`** — the roster: each agent's color, 3D station, and system prompt.
- **`public/office3d.js`** — the Three.js scene (room, props, characters, movement).
- **`public/app.js`** — the client: chat, event stream, and driving the office.

The manager's planning and self-check steps use Claude **structured outputs**;
specialists run concurrently; the final synthesis is **streamed** token-by-token.

## Customize

- **Staff / colors / stations:** `agents.js` (+ station coordinates in
  `public/office3d.js`).
- **How hard it works:** `MAX_ROUNDS` and `output_config` effort in `server.js`.
- **The office look:** props and materials in `public/office3d.js`.

---

Built with [Three.js](https://threejs.org/) and the
[Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript).
