import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import {
  MODEL,
  MANAGER,
  SPECIALISTS,
  agentById,
} from "./agents.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;
// With no key we still run the office in a simulated "demo" mode so the site
// works out of the box. Set ANTHROPIC_API_KEY to wire in real Claude agents.
const DEMO = !client;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A tiny helper to push a newline-delimited JSON event down the open response.
function makeSender(res) {
  return (event) => {
    res.write(JSON.stringify(event) + "\n");
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mode: DEMO ? "demo" : "live", model: MODEL });
});

app.get("/api/agents", (_req, res) => {
  const shape = ({ id, name, emoji, role, blurb }) => ({ id, name, emoji, role, blurb });
  res.json({
    manager: shape(MANAGER),
    specialists: SPECIALISTS.map(shape),
    mode: DEMO ? "demo" : "live",
    model: MODEL,
  });
});

app.post("/api/run", async (req, res) => {
  const task = (req.body?.task || "").toString().trim();
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  const send = makeSender(res);

  if (!task) {
    send({ type: "error", message: "Please describe a task for the office." });
    return res.end();
  }

  try {
    send({ type: "mode", mode: DEMO ? "demo" : "live", model: MODEL });
    if (DEMO) {
      await runDemo(task, send);
    } else {
      await runLive(task, send);
    }
  } catch (err) {
    console.error(err);
    send({
      type: "error",
      message: err?.message || "Something went wrong in the office.",
    });
  } finally {
    send({ type: "done" });
    res.end();
  }
});

// ---------------------------------------------------------------------------
// Live orchestration with real Claude agents
// ---------------------------------------------------------------------------

async function runLive(task, send) {
  // 1) Manager plans the work and assigns specialists.
  send({ type: "status", agent: "manager", status: "thinking", note: "Reading the request…" });

  const plan = await planTask(task);

  send({ type: "plan", summary: plan.plan, assignments: plan.assignments });
  send({ type: "status", agent: "manager", status: "waiting", note: "Delegating…" });

  // 2) Specialists work in parallel on their assignments.
  const results = await Promise.all(
    plan.assignments.map(async ({ agentId, instruction }) => {
      const agent = agentById[agentId];
      if (!agent) return null;

      send({ type: "message", from: "manager", to: agentId, text: instruction });
      await sleep(250); // let the little packet fly before the desk lights up
      send({ type: "status", agent: agentId, status: "working", note: "On it…" });

      const output = await runSpecialist(agent, task, instruction);

      send({ type: "status", agent: agentId, status: "done", note: "Handed in." });
      send({ type: "message", from: agentId, to: "manager", text: "Done — sending my work." });
      send({ type: "contribution", agent: agentId, name: agent.name, text: output });
      return { agentId, name: agent.name, role: agent.role, output };
    }),
  );

  // 3) Manager assembles everything into the final deliverable (streamed).
  send({ type: "status", agent: "manager", status: "working", note: "Assembling the deliverable…" });
  send({ type: "final_start" });

  await synthesize(task, plan.plan, results.filter(Boolean), send);

  send({ type: "final_end" });
  send({ type: "status", agent: "manager", status: "done", note: "Delivered!" });
}

async function planTask(task) {
  const schema = {
    type: "object",
    properties: {
      plan: {
        type: "string",
        description: "One or two sentences on how the office will tackle this.",
      },
      assignments: {
        type: "array",
        description: "Which specialists to activate and what each should do.",
        items: {
          type: "object",
          properties: {
            agentId: {
              type: "string",
              enum: SPECIALISTS.map((s) => s.id),
            },
            instruction: {
              type: "string",
              description: "A short, specific assignment for this specialist.",
            },
          },
          required: ["agentId", "instruction"],
          additionalProperties: false,
        },
      },
    },
    required: ["plan", "assignments"],
    additionalProperties: false,
  };

  const roster = SPECIALISTS.map(
    (s) => `- ${s.id} (${s.name}, ${s.role}): ${s.blurb}`,
  ).join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system: MANAGER.system,
    messages: [
      {
        role: "user",
        content:
          `Here is the office roster you can delegate to:\n${roster}\n\n` +
          `The user's request is:\n"""${task}"""\n\n` +
          `Pick the specialists that genuinely help (usually 2–4, not always all). ` +
          `Give each a specific assignment. Don't assign the same person twice.`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  const parsed = JSON.parse(text);

  // De-dupe just in case, and drop unknown ids.
  const seen = new Set();
  parsed.assignments = (parsed.assignments || []).filter((a) => {
    if (!agentById[a.agentId] || seen.has(a.agentId)) return false;
    seen.add(a.agentId);
    return true;
  });
  if (parsed.assignments.length === 0) {
    parsed.assignments = [
      { agentId: "writer", instruction: "Respond to the user's request directly and helpfully." },
    ];
  }
  return parsed;
}

async function runSpecialist(agent, task, instruction) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1800,
    output_config: { effort: "medium" },
    system: agent.system,
    messages: [
      {
        role: "user",
        content:
          `The overall task from the user is:\n"""${task}"""\n\n` +
          `Your specific assignment from the manager is:\n"""${instruction}"""\n\n` +
          `Deliver just your part. Be substantive but concise.`,
      },
    ],
  });
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function synthesize(task, plan, results, send) {
  const contributions = results
    .map((r) => `### ${r.name} (${r.role})\n${r.output}`)
    .join("\n\n");

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "medium" },
    system:
      MANAGER.system +
      " Now you assemble your specialists' work into one clean, final deliverable " +
      "for the user. Integrate the contributions — do not just paste them. Resolve " +
      "conflicts, remove redundancy, and format nicely in Markdown.",
    messages: [
      {
        role: "user",
        content:
          `Original request:\n"""${task}"""\n\n` +
          `Your plan was: ${plan}\n\n` +
          `Here is what your specialists handed in:\n\n${contributions}\n\n` +
          `Write the final deliverable for the user now.`,
      },
    ],
  });

  stream.on("text", (delta) => send({ type: "final_token", text: delta }));
  await stream.finalMessage();
}

// ---------------------------------------------------------------------------
// Demo mode (no API key) — canned but lively, so the office still animates
// ---------------------------------------------------------------------------

async function runDemo(task, send) {
  send({ type: "status", agent: "manager", status: "thinking", note: "Reading the request…" });
  await sleep(900);

  const picks = ["researcher", "writer", "reviewer"];
  const assignments = [
    { agentId: "researcher", instruction: "Gather the key facts and considerations." },
    { agentId: "writer", instruction: "Draft the response in a clear, friendly voice." },
    { agentId: "reviewer", instruction: "Check the draft for gaps and polish." },
  ];
  send({
    type: "plan",
    summary: "I'll have Rae gather context, Wes draft it, and Val review — then I'll assemble it.",
    assignments,
  });
  send({ type: "status", agent: "manager", status: "waiting", note: "Delegating…" });

  for (const a of assignments) {
    send({ type: "message", from: "manager", to: a.agentId, text: a.instruction });
    await sleep(400);
    send({ type: "status", agent: a.agentId, status: "working", note: "On it…" });
  }

  for (const a of assignments) {
    await sleep(1200 + Math.random() * 900);
    const agent = agentById[a.agentId];
    send({
      type: "contribution",
      agent: a.agentId,
      name: agent.name,
      text: `*(demo)* ${agent.name} the ${agent.role} would work on: "${a.instruction}"`,
    });
    send({ type: "status", agent: a.agentId, status: "done", note: "Handed in." });
    send({ type: "message", from: a.agentId, to: "manager", text: "Done — sending my work." });
  }

  send({ type: "status", agent: "manager", status: "working", note: "Assembling…" });
  send({ type: "final_start" });
  const demoText =
    `## Demo mode\n\nThis office is running **without an API key**, so I can't call the ` +
    `real specialists yet.\n\nYour task was:\n\n> ${task}\n\n` +
    `To bring the office to life with real Claude agents, set an \`ANTHROPIC_API_KEY\` ` +
    `environment variable and restart the server. Then Morgan will delegate to Rae, Wes, ` +
    `Ada, Del, and Val for real.\n`;
  for (const chunk of demoText.match(/.{1,4}/gs) || []) {
    send({ type: "final_token", text: chunk });
    await sleep(12);
  }
  send({ type: "final_end" });
  send({ type: "status", agent: "manager", status: "done", note: "Delivered!" });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🏢  Agentic office running at http://localhost:${PORT}`);
  console.log(`    Mode: ${DEMO ? "DEMO (no API key)" : "LIVE (real Claude agents)"}\n`);
});
