import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, MANAGER, SPECIALISTS, agentById } from "./agents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

// Serve three.js (and its addons) from node_modules so the browser can import them.
app.use("/vendor/three", express.static("node_modules/three/build"));
app.use("/vendor/three-addons", express.static("node_modules/three/examples/jsm"));

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;
const DEMO = !client;
const MAX_ROUNDS = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// session history persistence
// ---------------------------------------------------------------------------
async function loadSessions() {
  try {
    const raw = await fs.readFile(SESSIONS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
async function saveSession(entry) {
  const sessions = await loadSessions();
  sessions.unshift(entry);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions.slice(0, 200), null, 2));
}

// ---------------------------------------------------------------------------
// simple endpoints
// ---------------------------------------------------------------------------
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, mode: DEMO ? "demo" : "live", model: MODEL }),
);

app.get("/api/agents", (_req, res) => {
  const shape = ({ id, name, emoji, role, color, station, blurb }) => ({
    id, name, emoji, role, color, station, blurb,
  });
  res.json({
    manager: shape(MANAGER),
    specialists: SPECIALISTS.map(shape),
    mode: DEMO ? "demo" : "live",
    model: MODEL,
  });
});

app.get("/api/history", async (_req, res) => {
  const sessions = await loadSessions();
  res.json(
    sessions.map((s) => ({
      id: s.id,
      goal: s.goal,
      at: s.at,
      rounds: s.rounds,
      tokens: s.tokens,
      agents: s.agents,
    })),
  );
});

// Morgan reviews past sessions and suggests ways to make future tasks easier.
app.get("/api/insights", async (_req, res) => {
  const sessions = await loadSessions();
  if (sessions.length === 0) {
    return res.json({
      text: "No past sessions yet. Run a few goals and I'll spot patterns and suggest shortcuts.",
    });
  }
  if (DEMO) {
    return res.json({
      text:
        `You've run ${sessions.length} task(s). *(demo mode — set an API key and I'll ` +
        `analyze them for real.)* Common theme so far: "${sessions[0].goal}".`,
    });
  }
  try {
    const list = sessions
      .slice(0, 40)
      .map((s, i) => `${i + 1}. [${s.at}] ${s.goal} (agents: ${(s.agents || []).join(", ")})`)
      .join("\n");
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: 900,
      output_config: { effort: "medium" },
      system:
        MANAGER.system +
        " You are reviewing the user's past task history to make their future work easier.",
      messages: [
        {
          role: "user",
          content:
            `Here is my history of tasks I've asked the office to do:\n${list}\n\n` +
            `In 4-6 short bullets, find recurring patterns and suggest concrete ways to ` +
            `make these tasks easier next time — reusable templates, a saved goal I could ` +
            `re-run, or a specialist I should lean on. Be specific and practical. Markdown.`,
        },
      ],
    });
    const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    res.json({ text });
  } catch (err) {
    res.json({ text: `Couldn't analyze history: ${err.message}` });
  }
});

// ---------------------------------------------------------------------------
// chat with the head agent (Morgan) — decides whether to just reply or to run
// ---------------------------------------------------------------------------
let conversation = []; // in-memory chat history with Morgan

app.post("/api/chat", async (req, res) => {
  const message = (req.body?.message || "").toString().trim();
  if (!message) return res.json({ reply: "What would you like the office to do?", run: false });

  conversation.push({ role: "user", content: message });

  if (DEMO) {
    const reply =
      "I'm running in demo mode (no API key), but I'll show you how the office moves. " +
      "Kicking this off now.";
    conversation.push({ role: "assistant", content: reply });
    return res.json({ reply, run: true, goal: message });
  }

  try {
    const schema = {
      type: "object",
      properties: {
        reply: { type: "string", description: "Your short conversational reply to the user." },
        run: {
          type: "boolean",
          description: "True if the user has given an actionable goal to execute now.",
        },
        goal: {
          type: "string",
          description: "If run is true, a clear one-line statement of the goal to execute.",
        },
      },
      required: ["reply", "run", "goal"],
      additionalProperties: false,
    };
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      system:
        MANAGER.system +
        " Decide whether the latest user message is a goal to execute now, or just " +
        "conversation/clarification. If it's a goal, set run=true and distill it into `goal`. " +
        "If you need one clarification, ask it in `reply` and set run=false. Keep replies to " +
        "1-3 sentences.",
      messages: conversation,
    });
    const text = r.content.find((b) => b.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(text);
    conversation.push({ role: "assistant", content: parsed.reply });
    res.json(parsed);
  } catch (err) {
    res.json({ reply: `Something went wrong: ${err.message}`, run: false, goal: "" });
  }
});

// ---------------------------------------------------------------------------
// the work run — streamed NDJSON so the 3D office can animate
// ---------------------------------------------------------------------------
app.post("/api/run", async (req, res) => {
  const goal = (req.body?.goal || "").toString().trim();
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (event) => res.write(JSON.stringify(event) + "\n");

  if (!goal) {
    send({ type: "error", message: "No goal provided." });
    return res.end();
  }

  const started = Date.now();
  const state = { tokens: 0 };
  const addUsage = (u) => {
    if (u) state.tokens += (u.input_tokens || 0) + (u.output_tokens || 0);
    send({ type: "tokens", total: state.tokens });
  };

  try {
    send({ type: "mode", mode: DEMO ? "demo" : "live", model: MODEL });
    const result = DEMO
      ? await runDemo(goal, send)
      : await runLive(goal, send, addUsage);

    await saveSession({
      id: "s_" + started.toString(36),
      goal,
      at: new Date(started).toISOString(),
      rounds: result?.rounds ?? 1,
      tokens: state.tokens,
      agents: result?.agents ?? [],
      final: result?.final ?? "",
    });
  } catch (err) {
    console.error(err);
    send({ type: "error", message: err?.message || "Something went wrong in the office." });
  } finally {
    send({ type: "runtime", ms: Date.now() - started });
    send({ type: "done" });
    res.end();
  }
});

// ---------------------------------------------------------------------------
// live orchestration: plan -> work rounds until done -> deliver
// ---------------------------------------------------------------------------
async function runLive(goal, send, addUsage) {
  send({ type: "status", agent: "manager", status: "thinking", note: "Reading the goal…" });

  const plan = await planTask(goal, addUsage);
  send({ type: "plan", summary: plan.plan, assignments: plan.assignments });

  let assignments = plan.assignments;
  const usedAgents = new Set();
  let finalMd = "";
  let round = 0;

  while (round < MAX_ROUNDS) {
    round++;
    send({ type: "round", round, note: round === 1 ? "Delegating…" : "Refining…" });
    send({ type: "status", agent: "manager", status: "waiting", note: "Delegating…" });

    const results = await Promise.all(
      assignments.map(async ({ agentId, instruction }) => {
        const agent = agentById[agentId];
        if (!agent) return null;
        usedAgents.add(agentId);
        send({ type: "message", from: "manager", to: agentId, text: instruction });
        await sleep(250);
        send({ type: "status", agent: agentId, status: "working", note: "On it…" });
        const output = await runSpecialist(agent, goal, instruction, addUsage);
        send({ type: "status", agent: agentId, status: "done", note: "Handed in." });
        send({ type: "message", from: agentId, to: "manager", text: "Done — sending my work." });
        send({ type: "contribution", agent: agentId, name: agent.name, text: output });
        return { agentId, name: agent.name, role: agent.role, output };
      }),
    );

    send({ type: "status", agent: "manager", status: "working", note: "Assembling…" });
    send({ type: "final_start" });
    finalMd = await synthesize(goal, plan.plan, results.filter(Boolean), send, addUsage);
    send({ type: "final_end" });

    // Work until done: does the deliverable actually meet the goal?
    send({ type: "status", agent: "manager", status: "thinking", note: "Checking against the goal…" });
    const check = await selfCheck(goal, finalMd, addUsage);
    send({ type: "check", done: check.done, assessment: check.assessment, round });

    if (check.done || !check.nextAssignments?.length || round >= MAX_ROUNDS) break;
    assignments = check.nextAssignments.filter((a) => agentById[a.agentId]);
    if (!assignments.length) break;
  }

  send({ type: "status", agent: "manager", status: "done", note: "Delivered!" });
  return { rounds: round, agents: [...usedAgents], final: finalMd };
}

async function planTask(goal, addUsage) {
  const schema = {
    type: "object",
    properties: {
      plan: { type: "string", description: "One or two sentences on the approach." },
      assignments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            agentId: { type: "string", enum: SPECIALISTS.map((s) => s.id) },
            instruction: { type: "string" },
          },
          required: ["agentId", "instruction"],
          additionalProperties: false,
        },
      },
    },
    required: ["plan", "assignments"],
    additionalProperties: false,
  };
  const roster = SPECIALISTS.map((s) => `- ${s.id} (${s.name}, ${s.role}): ${s.blurb}`).join("\n");
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system: MANAGER.system,
    messages: [
      {
        role: "user",
        content:
          `Roster you can delegate to:\n${roster}\n\nUser's goal:\n"""${goal}"""\n\n` +
          `Pick the specialists that genuinely help (usually 2-4). Give each a specific ` +
          `assignment. Don't assign the same person twice.`,
      },
    ],
  });
  addUsage(r.usage);
  const parsed = JSON.parse(r.content.find((b) => b.type === "text")?.text ?? "{}");
  const seen = new Set();
  parsed.assignments = (parsed.assignments || []).filter((a) => {
    if (!agentById[a.agentId] || seen.has(a.agentId)) return false;
    seen.add(a.agentId);
    return true;
  });
  if (!parsed.assignments.length) {
    parsed.assignments = [{ agentId: "writer", instruction: "Respond to the goal directly." }];
  }
  return parsed;
}

async function runSpecialist(agent, goal, instruction, addUsage) {
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 1800,
    output_config: { effort: "medium" },
    system: agent.system,
    messages: [
      {
        role: "user",
        content:
          `Overall goal:\n"""${goal}"""\n\nYour assignment:\n"""${instruction}"""\n\n` +
          `Deliver just your part. Be substantive but concise.`,
      },
    ],
  });
  addUsage(r.usage);
  return r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

async function synthesize(goal, plan, results, send, addUsage) {
  const contributions = results.map((r) => `### ${r.name} (${r.role})\n${r.output}`).join("\n\n");
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "medium" },
    system:
      MANAGER.system +
      " Assemble your specialists' work into one clean final deliverable. Integrate — don't " +
      "paste. Resolve conflicts, remove redundancy, format nicely in Markdown.",
    messages: [
      {
        role: "user",
        content:
          `Goal:\n"""${goal}"""\n\nPlan: ${plan}\n\nSpecialist contributions:\n\n${contributions}\n\n` +
          `Write the final deliverable now.`,
      },
    ],
  });
  stream.on("text", (delta) => send({ type: "final_token", text: delta }));
  const msg = await stream.finalMessage();
  addUsage(msg.usage);
  return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

async function selfCheck(goal, finalMd, addUsage) {
  const schema = {
    type: "object",
    properties: {
      done: { type: "boolean" },
      assessment: { type: "string", description: "One sentence: is the goal met, and if not, why." },
      nextAssignments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            agentId: { type: "string", enum: SPECIALISTS.map((s) => s.id) },
            instruction: { type: "string" },
          },
          required: ["agentId", "instruction"],
          additionalProperties: false,
        },
      },
    },
    required: ["done", "assessment", "nextAssignments"],
    additionalProperties: false,
  };
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 900,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system: MANAGER.system + " You critically check whether a deliverable fully meets the goal.",
    messages: [
      {
        role: "user",
        content:
          `Goal:\n"""${goal}"""\n\nCurrent deliverable:\n"""${finalMd}"""\n\n` +
          `Is the goal fully met? If yes, done=true and nextAssignments=[]. If not, done=false ` +
          `and give up to 2 targeted follow-up assignments to close the gaps.`,
      },
    ],
  });
  addUsage(r.usage);
  return JSON.parse(r.content.find((b) => b.type === "text")?.text ?? "{}");
}

// ---------------------------------------------------------------------------
// demo mode (no API key)
// ---------------------------------------------------------------------------
async function runDemo(goal, send) {
  send({ type: "status", agent: "manager", status: "thinking", note: "Reading the goal…" });
  await sleep(800);
  const assignments = [
    { agentId: "researcher", instruction: "Gather the key facts and considerations." },
    { agentId: "engineer", instruction: "Sketch the technical approach." },
    { agentId: "reviewer", instruction: "Check the draft for gaps and polish." },
  ];
  send({ type: "plan", summary: "I'll have Rae research, Ada build, and Val review — then assemble.", assignments });
  send({ type: "round", round: 1, note: "Delegating…" });
  let tokens = 0;
  for (const a of assignments) {
    send({ type: "message", from: "manager", to: a.agentId, text: a.instruction });
    await sleep(350);
    send({ type: "status", agent: a.agentId, status: "working", note: "On it…" });
  }
  for (const a of assignments) {
    await sleep(1100 + Math.random() * 800);
    tokens += 3000 + Math.floor(Math.random() * 4000);
    send({ type: "tokens", total: tokens });
    const agent = agentById[a.agentId];
    send({ type: "contribution", agent: a.agentId, name: agent.name, text: `*(demo)* ${agent.name} handled: "${a.instruction}"` });
    send({ type: "status", agent: a.agentId, status: "done", note: "Handed in." });
    send({ type: "message", from: a.agentId, to: "manager", text: "Done." });
  }
  send({ type: "status", agent: "manager", status: "working", note: "Assembling…" });
  send({ type: "final_start" });
  const demoText =
    `## Demo mode\n\nThe office is running **without an API key**, so I can't call the real ` +
    `specialists.\n\nYour goal was:\n\n> ${goal}\n\nSet \`ANTHROPIC_API_KEY\` and restart to see ` +
    `Morgan, Rae, Ada, Wes, Del, and Val do this for real — working in rounds until it's done.\n`;
  for (const chunk of demoText.match(/.{1,4}/gs) || []) {
    send({ type: "final_token", text: chunk });
    await sleep(10);
  }
  send({ type: "final_end" });
  send({ type: "check", done: true, assessment: "Demo complete.", round: 1 });
  send({ type: "status", agent: "manager", status: "done", note: "Delivered!" });
  return { rounds: 1, agents: assignments.map((a) => a.agentId), final: demoText };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🏢  Agentic office at http://localhost:${PORT}`);
  console.log(`    Mode: ${DEMO ? "DEMO (no API key)" : "LIVE (real Claude agents)"}\n`);
});
