import { createOffice } from "./office3d.js";

const $ = (s) => document.querySelector(s);
const office = createOffice($("#scene"));

let META = {}; // id -> agent meta
let running = false;
let timer = null;
let startTs = 0;

// ---- boot ------------------------------------------------------------------
async function boot() {
  const data = await (await fetch("/api/agents")).json();
  META = Object.fromEntries([data.manager, ...data.specialists].map((a) => [a.id, a]));
  office.build(data);

  $("#modeText").textContent = data.mode === "live" ? "live agents" : "demo mode";
  $("#sysModel").textContent = data.model;
  $("#sysMode").textContent = data.mode === "live" ? "Live agents" : "Demo (no API key)";
  $("#agentsActive").textContent = `${data.specialists.length + 1} agents`;

  renderAgentList([data.manager, ...data.specialists]);
  addMsg(
    "morgan",
    "Hi — I'm Morgan, head of this office. Tell me a goal and I'll put the team on it and keep going until it's done. You'll see everyone get up and move as they work.",
  );
  loadHistory();
}

function renderAgentList(list) {
  const ul = $("#agentList");
  ul.innerHTML = "";
  list.forEach((a) => {
    const li = document.createElement("li");
    li.id = "al_" + a.id;
    li.innerHTML =
      `<span class="a-dot" style="background:${a.color}"></span>` +
      `<span>${a.name}</span><span class="a-role">${a.role}</span>` +
      `<span class="a-state">idle</span>`;
    ul.appendChild(li);
  });
}

function setAgentState(id, state) {
  const li = $("#al_" + id);
  if (!li) return;
  const on = state && state !== "idle";
  li.classList.toggle("on", on);
  const badge = li.querySelector(".a-state");
  badge.textContent = state;
  badge.classList.toggle("done", state === "done");
}

// ---- chat ------------------------------------------------------------------
$("#chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#chatInput").value.trim();
  if (!text || running) return;
  $("#chatInput").value = "";
  addMsg("user", text);
  await handleChat(text);
});

async function handleChat(message) {
  setBusy(true);
  office.setStatus("manager", "thinking"); // Morgan reacts the moment you talk to him
  setAgentState("manager", "thinking");
  const thinking = addMsg("morgan", "…", true);
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    thinking.remove();
    addMsg("morgan", data.reply);
    if (data.run && data.goal) {
      setView("office"); // on phone, jump to the office to watch the team work
      await runGoal(data.goal);
    } else {
      office.setStatus("manager", "idle");
      setAgentState("manager", "idle");
      setBusy(false);
    }
  } catch (err) {
    thinking.remove();
    addMsg("morgan", "Something went wrong: " + err.message);
    setBusy(false);
  }
}

function setBusy(b) {
  running = b;
  $("#chatSend").disabled = b;
  $("#chatInput").disabled = b;
}

// ---- run a goal (streamed) -------------------------------------------------
async function runGoal(goal) {
  setBusy(true);
  office.reset();
  Object.keys(META).forEach((id) => setAgentState(id, "idle"));
  clearLog();
  $("#final").innerHTML = '<p class="muted">Working…</p>';
  $("#rtTask").textContent = goal.length > 40 ? goal.slice(0, 38) + "…" : goal;
  $("#rtRound").textContent = "1";
  $("#rtTokens").textContent = "0";
  setProgress(4);
  setStatusText("running", "running");
  startTimer();

  let finalMd = "";
  let assignmentsTotal = 1;
  let done = 0;

  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal }),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done: rdone } = await reader.read();
      if (rdone) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) handle(JSON.parse(line));
      }
    }
  } catch (err) {
    log("⚠️ Error", err.message);
  } finally {
    stopTimer();
    setBusy(false);
  }

  function handle(ev) {
    switch (ev.type) {
      case "status":
        office.setStatus(ev.agent, ev.status);
        setAgentState(ev.agent, ev.status);
        if (["thinking", "working", "waiting"].includes(ev.status)) setActive(ev.agent, ev.note);
        if (ev.agent === "manager" && ev.status === "done") setStatusText("done", "done");
        break;
      case "plan":
        assignmentsTotal = Math.max(1, ev.assignments.length);
        log("🧭 Morgan", ev.summary);
        setProgress(15);
        break;
      case "round":
        $("#rtRound").textContent = ev.round;
        break;
      case "message":
        office.sendPacket(ev.from, ev.to);
        log(META[ev.from]?.name || ev.from, `→ ${META[ev.to]?.name || ev.to}: ${ev.text}`);
        break;
      case "contribution":
        done++;
        setProgress(15 + Math.round((done / assignmentsTotal) * 55));
        log(ev.name, "turned in their work.");
        break;
      case "tokens":
        $("#rtTokens").textContent = ev.total.toLocaleString();
        break;
      case "final_start":
        finalMd = "";
        $("#final").innerHTML = '<span class="cursor"></span>';
        setProgress(78);
        break;
      case "final_token":
        finalMd += ev.text;
        $("#final").innerHTML = renderMd(finalMd) + '<span class="cursor"></span>';
        $("#final").scrollTop = $("#final").scrollHeight;
        break;
      case "final_end":
        $("#final").innerHTML = renderMd(finalMd);
        setProgress(92);
        break;
      case "check":
        log("🧭 Morgan", ev.done ? "Goal met ✓ " + ev.assessment : "Needs another pass: " + ev.assessment);
        break;
      case "runtime":
        setProgress(100);
        break;
      case "error":
        log("⚠️ Error", ev.message);
        addMsg("morgan", "I hit a snag: " + ev.message);
        break;
      case "done":
        if (finalMd) {
          addMsg("morgan", "Done — the deliverable is in the panel on the right. Want any changes?");
        }
        loadHistory();
        break;
    }
  }
}

// ---- runtime readout -------------------------------------------------------
function setActive(id, note) {
  const m = META[id];
  $("#rtAgent").textContent = m ? `${m.name} · ${m.role}` : id;
  $("#rtDot").style.background = m?.color || "#888";
  $("#rtDot").style.color = m?.color || "#888";
}
function setStatusText(text, cls) {
  const el = $("#rtStatus");
  el.textContent = text;
  el.className = "rt-status " + (cls || "");
}
function setProgress(pct) {
  $("#rtProgress").style.width = Math.min(100, pct) + "%";
}
function startTimer() {
  startTs = Date.now();
  clearInterval(timer);
  timer = setInterval(() => {
    const s = (Date.now() - startTs) / 1000;
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = (s % 60).toFixed(1).padStart(4, "0");
    $("#rtTime").textContent = `${mm}:${ss}`;
  }, 100);
}
function stopTimer() {
  clearInterval(timer);
}

// ---- activity log ----------------------------------------------------------
function clearLog() { $("#log").innerHTML = ""; }
function log(who, text) {
  const li = document.createElement("li");
  li.innerHTML = `<span class="who">${who}:</span> `;
  li.appendChild(document.createTextNode(text));
  $("#log").appendChild(li);
  $("#log").scrollTop = $("#log").scrollHeight;
}

// ---- history & insights ----------------------------------------------------
async function loadHistory() {
  try {
    const hist = await (await fetch("/api/history")).json();
    const ul = $("#history");
    ul.innerHTML = "";
    hist.slice(0, 8).forEach((h) => {
      const li = document.createElement("li");
      const when = new Date(h.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      li.innerHTML =
        `<span class="h-goal">${escapeHtml(h.goal)}</span>` +
        `<span class="h-meta">${when} · ${h.rounds} round(s) · ${(h.tokens || 0).toLocaleString()} tok</span>`;
      li.title = "Click to run this goal again";
      li.onclick = () => {
        if (running) return;
        $("#chatInput").value = h.goal;
        $("#chatInput").focus();
      };
      ul.appendChild(li);
    });
  } catch {}
}

$("#insightBtn").addEventListener("click", async () => {
  const box = $("#insights");
  box.innerHTML = '<p class="muted">Morgan is reviewing your history…</p>';
  try {
    const data = await (await fetch("/api/insights")).json();
    box.innerHTML = renderMd(data.text);
  } catch (err) {
    box.innerHTML = `<p class="muted">Couldn't load insights: ${err.message}</p>`;
  }
});

// ---- chat bubbles ----------------------------------------------------------
function addMsg(who, text, pending) {
  const div = document.createElement("div");
  div.className = "msg " + who;
  const avatar = who === "morgan" ? '<span class="avatar">🧭</span>' : "";
  const body = who === "morgan" ? `<div class="md">${renderMd(text)}</div>` : escapeHtml(text);
  div.innerHTML = `${avatar}<div class="bubble">${pending ? "…" : body}</div>`;
  $("#chatLog").appendChild(div);
  $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
  if (who === "morgan" && !pending) speak(text);
  return div;
}

// ---- mobile tab bar --------------------------------------------------------
function setView(view) {
  document.body.classList.toggle("m-chat", view === "chat");
  document.body.classList.toggle("m-system", view === "system");
  document.querySelectorAll(".mobile-nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view),
  );
}
document.querySelectorAll(".mobile-nav button").forEach((b) => {
  b.addEventListener("click", () => setView(b.dataset.view));
});

// ---- voice (Jarvis-style spoken replies) -----------------------------------
let voiceOn = false;
const synth = window.speechSynthesis;
function stripMd(t) {
  return String(t).replace(/[#*`_>[\]()~]/g, " ").replace(/\s+/g, " ").trim();
}
function speak(text) {
  if (!voiceOn || !synth) return;
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(stripMd(text).slice(0, 400));
    u.rate = 1.03;
    synth.speak(u);
  } catch {}
}
$("#voiceBtn").addEventListener("click", () => {
  voiceOn = !voiceOn;
  const btn = $("#voiceBtn");
  btn.textContent = voiceOn ? "🔊" : "🔈";
  btn.classList.toggle("on", voiceOn);
  btn.title = voiceOn ? "Voice: on" : "Voice: off";
  if (voiceOn) speak("Voice enabled. I'm listening.");
  else synth?.cancel();
});

// ---- tiny markdown renderer ------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderMd(md) {
  const blocks = [];
  md = md.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _l, code) => {
    blocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return `  ${blocks.length - 1}  `;
  });
  const inline = (t) =>
    escapeHtml(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  let html = "";
  let list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of md.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const ph = line.match(/^\s* (\d+) \s*$/);
    if (ph) { close(); html += blocks[+ph[1]]; continue; }
    if (/^\s*$/.test(line)) { close(); continue; }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { close(); const l = m[1].length; html += `<h${l}>${inline(m[2])}</h${l}>`; }
    else if ((m = line.match(/^\s*>\s?(.*)/))) { close(); html += `<blockquote>${inline(m[1])}</blockquote>`; }
    else if ((m = line.match(/^\s*[-*+]\s+(.*)/))) { if (list !== "ul") { close(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) { if (list !== "ol") { close(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
    else { close(); html += `<p>${inline(line)}</p>`; }
  }
  close();
  return html;
}

boot();
