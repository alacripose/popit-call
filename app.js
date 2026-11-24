import { loadContour, fillContours } from "./contour.js";

const STORE = "popit.call-client.v1";
const $ = (id) => document.getElementById(id);
const state = {
  contacts: [], surfaces: [], envelope: null, session: "", cursor: 0,
  turns: [], bridgeTimer: 0, turnTimer: 0, polling: false, joined: false,
};
let contourReady = false;

const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch]));

const clean = (value, limit = 120) => String(value ?? "").trim().slice(0, limit);
const safeUrl = (value) => {
  try {
    const url = new URL(clean(value, 500));
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
};

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      contacts: state.contacts, surfaces: state.surfaces,
    }));
  } catch {
    setNote("The browser refused local storage. The book is only in this tab.");
  }
}

function restore() {
  try {
    const value = JSON.parse(localStorage.getItem(STORE) || "{}");
    state.contacts = Array.isArray(value.contacts) ? value.contacts.filter(validContact) : [];
    state.surfaces = Array.isArray(value.surfaces) ? value.surfaces.filter(validSurface) : [];
  } catch {
    state.contacts = [];
    state.surfaces = [];
  }
}

function validContact(row) {
  return row && typeof row === "object" && clean(row.name) && clean(row.id);
}

function validSurface(row) {
  return row && typeof row === "object" && clean(row.name) && safeUrl(row.endpoint) && clean(row.id);
}

function draw() {
  if (contourReady) fillContours(document);
}

function decorate() {
  document.querySelectorAll(".button, .pill").forEach((node) => {
    if (!node.hasAttribute("data-contour")) node.setAttribute("data-contour", "card");
  });
  draw();
}

function setNote(text) {
  const note = $("call-note");
  if (note) note.textContent = text;
}

function setCallState(text, kind = "waiting") {
  const pill = $("call-state");
  pill.textContent = text;
  pill.dataset.state = kind;
}

function contactById(id) {
  return state.contacts.find((row) => row.id === id) || null;
}

function surfaceById(id) {
  return state.surfaces.find((row) => row.id === id) || null;
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function renderContacts() {
  const list = $("contact-list");
  $("contact-count").textContent = `${state.contacts.length} contact${state.contacts.length === 1 ? "" : "s"}`;
  if (!state.contacts.length) {
    list.innerHTML = `<li class="empty">No contacts yet. Add one here or import a vCard.</li>`;
  } else {
    list.innerHTML = state.contacts.map((row) => `
      <li class="contact-row" data-id="${escapeHTML(row.id)}" data-contour="card">
        <div>
          <div class="contact-name">${escapeHTML(row.name)}</div>
          <div class="contact-meta">${escapeHTML([row.number, row.agent, row.mcp].filter(Boolean).join(" · ") || "no number or surface")}</div>
        </div>
        <button class="button" type="button" data-call="${escapeHTML(row.id)}">Use</button>
        <button class="button danger" type="button" data-remove-contact="${escapeHTML(row.id)}" aria-label="Remove ${escapeHTML(row.name)}">Remove</button>
      </li>
    `).join("");
  }
  const select = $("call-contact");
  const previous = select.value;
  select.innerHTML = `<option value="">Choose a contact</option>` + state.contacts.map((row) =>
    `<option value="${escapeHTML(row.id)}">${escapeHTML(row.name)}${row.agent ? ` · ${escapeHTML(row.agent)}` : ""}</option>`
  ).join("");
  if (state.contacts.some((row) => row.id === previous)) select.value = previous;
  decorate();
}

function renderSurfaces() {
  const list = $("mcp-list");
  $("mcp-count").textContent = `${state.surfaces.length} surface${state.surfaces.length === 1 ? "" : "s"}`;
  if (!state.surfaces.length) {
    list.innerHTML = `<li class="empty">No MCP surfaces yet. Add the endpoint an agent exposes.</li>`;
  } else {
    list.innerHTML = state.surfaces.map((row) => `
      <li class="surface-row" data-id="${escapeHTML(row.id)}" data-contour="card">
        <div>
          <div class="surface-name">${escapeHTML(row.name)}</div>
          <div class="surface-meta">${escapeHTML(row.endpoint)}${row.agent ? ` · ${escapeHTML(row.agent)}` : ""}</div>
        </div>
        <button class="button" type="button" data-select-surface="${escapeHTML(row.id)}">Select</button>
        <button class="button danger" type="button" data-remove-surface="${escapeHTML(row.id)}" aria-label="Remove ${escapeHTML(row.name)}">Remove</button>
      </li>
    `).join("");
  }
  decorate();
}

function selectSurface(id) {
  const row = surfaceById(id);
  if (!row) return;
  const config = {
    mcpServers: {
      "popit-call": {
        type: "http",
        url: row.endpoint,
        note: "The call token stays on the host; do not put it in this page.",
      },
    },
  };
  $("mcp-config").textContent = JSON.stringify(config, null, 2);
  $("call-agent").value = row.agent || $("call-agent").value;
}

function addContact(event) {
  event.preventDefault();
  const name = clean($("contact-name").value, 60);
  if (!name) return;
  const row = {
    id: uid("contact"), name,
    number: clean($("contact-number").value, 32),
    agent: clean($("contact-agent").value, 60),
    mcp: safeUrl($("contact-mcp").value),
  };
  state.contacts.push(row);
  save();
  event.target.reset();
  renderContacts();
  renderContactChoices();
}

function addSurface(event) {
  event.preventDefault();
  const name = clean($("mcp-name").value, 60);
  const endpoint = safeUrl($("mcp-endpoint").value);
  if (!name || !endpoint) {
    setNote("An MCP surface needs a name and an http(s) endpoint.");
    return;
  }
  state.surfaces.push({ id: uid("surface"), name, endpoint, agent: clean($("mcp-agent").value, 60) });
  save();
  event.target.reset();
  renderSurfaces();
  selectSurface(state.surfaces[state.surfaces.length - 1].id);
}

function renderContactChoices() {
  const select = $("call-contact");
  const previous = select.value;
  select.innerHTML = `<option value="">Choose a contact</option>` + state.contacts.map((row) =>
    `<option value="${escapeHTML(row.id)}">${escapeHTML(row.name)}${row.agent ? ` · ${escapeHTML(row.agent)}` : ""}</option>`
  ).join("");
  if (state.contacts.some((row) => row.id === previous)) select.value = previous;
}

function useContact(id) {
  const row = contactById(id);
  if (!row) return;
  $("call-contact").value = row.id;
  $("call-agent").value = row.agent || "";
  if (row.mcp) {
    const surface = state.surfaces.find((item) => item.endpoint === row.mcp);
    if (surface) selectSurface(surface.id);
    else {
      $("mcp-config").textContent = JSON.stringify({
        mcpServers: { "popit-call": { type: "http", url: row.mcp } },
      }, null, 2);
    }
  }
  document.getElementById("call").scrollIntoView({ behavior: "smooth", block: "start" });
}

function importVCard(text) {
  const unfolded = String(text || "").replace(/\r?\n[ \t]/g, "");
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1);
  let added = 0;
  for (const card of cards) {
    const lines = card.split(/\r?\n/).map((line) => line.trim());
    const field = (name) => {
      const line = lines.find((item) => item.toUpperCase().startsWith(`${name}:`) || item.toUpperCase().startsWith(`${name};`));
      return line ? line.slice(line.indexOf(":") + 1).replace(/\\,/g, ",").replace(/\\;/g, ";").trim() : "";
    };
    const name = field("FN") || field("N").replace(/;/g, " ").trim();
    if (!name) continue;
    state.contacts.push({
      id: uid("contact"), name: clean(name, 60), number: clean(field("TEL"), 32),
      agent: "", mcp: safeUrl(field("URL")),
    });
    added += 1;
  }
  if (added) {
    save();
    renderContacts();
    setNote(`Imported ${added} contact${added === 1 ? "" : "s"}.`);
  } else {
    setNote("No vCard contact had a name.");
  }
}

function exportJSON() {
  const body = JSON.stringify({ schema: "popit.callbook/1", contacts: state.contacts,
    surfaces: state.surfaces }, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "popit-callbook.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function loadEnvelope(raw) {
  try {
    const envelope = JSON.parse(raw);
    if (!envelope || envelope.schema !== "popit.call-envelope/1") throw new Error("wrong schema");
    if (!envelope.name || !envelope.agent || !envelope.endpoint || !envelope.nonce || !envelope.signature) {
      throw new Error("missing signed fields");
    }
    state.envelope = envelope;
    $("envelope-state").textContent = envelope.agent;
    $("envelope-state").dataset.state = "live";
    $("envelope-card").textContent = [
      `caller  ${envelope.name}`,
      `agent   ${envelope.agent}`,
      `endpoint ${envelope.endpoint}`,
      `issued  ${envelope.issued_at || "unknown"}`,
      `nonce   ${envelope.nonce}`,
      `key     ${String(envelope.public_key || "").split("\n")[1] || "loaded"}`,
    ].join("\n");
    $("call-agent").value = envelope.agent;
    setNote("Envelope loaded. The host verifies its signature before it opens a lane.");
  } catch (error) {
    state.envelope = null;
    $("envelope-state").textContent = "refused";
    $("envelope-state").dataset.state = "refused";
    $("envelope-card").textContent = `Refused: ${error.message}`;
  }
}

function bridgeBase() {
  const value = clean($("bridge-url").value, 500).replace(/\/+$/, "");
  return value || "/api/bridge";
}

function bridgePath(path) {
  return `${bridgeBase()}${path}`;
}

async function bridgeFetch(path, options = {}) {
  const response = await fetch(bridgePath(path), {
    cache: "no-store", ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const receipt = await response.json().catch(() => ({}));
  if (!response.ok || receipt.ok === false) {
    const refused = receipt.refused;
    const detail = refused && typeof refused === "object" ? `${refused.code}: ${refused.detail}` : String(refused || `http-${response.status}`);
    throw new Error(detail);
  }
  return receipt;
}

async function checkBridge() {
  const pill = $("origin-state");
  const probe = bridgeBase().endsWith("/api/bridge") ? "/health" : "/api/toast";
  try {
    const response = await fetch(bridgePath(probe), { cache: "no-store" });
    const receipt = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(receipt.refused || `http-${response.status}`);
    pill.textContent = receipt.tls ? "TLS" : "LOOPBACK";
    pill.dataset.state = "live";
    $("bridge-state").textContent = `Companion ready · ${receipt.bridge || "bridge"}`;
  } catch (error) {
    pill.textContent = "PAGE ONLY";
    pill.dataset.state = "refused";
    $("bridge-state").textContent = `Companion not reachable · ${error.message}`;
  }
}

async function joinCall(event) {
  event.preventDefault();
  if (!state.envelope) {
    setNote("Load a signed envelope first. An unsigned name cannot open a lane.");
    return;
  }
  const contact = contactById($("call-contact").value);
  const agent = clean($("call-agent").value, 60) || state.envelope.agent;
  if (state.envelope.agent !== agent) {
    setNote("The loaded envelope names another agent. Load a package for this lane.");
    return;
  }
  if (contact && contact.mcp) {
    const surface = state.surfaces.find((row) => row.endpoint === contact.mcp);
    if (surface) selectSurface(surface.id);
  }
  setCallState("checking", "waiting");
  try {
    const receipt = await bridgeFetch("/api/toast/call/join", {
      method: "POST",
      body: JSON.stringify({ agent, profile: agent.toLowerCase(), envelope: state.envelope }),
    });
    state.session = receipt.session;
    state.cursor = Number(receipt.cursor || 0);
    state.joined = true;
    state.turns = [];
    $("turns").innerHTML = "";
    $("leave-call").disabled = false;
    $("refresh-turns").disabled = false;
    $("say-text").disabled = false;
    $("say-send").disabled = false;
    setCallState("joined", "live");
    setNote(`Joined as ${receipt.agent}. The envelope was admitted before the session opened.`);
    pollTurns();
  } catch (error) {
    setCallState("refused", "refused");
    setNote(`Call refused · ${error.message}`);
  }
}

async function pollTurns() {
  if (!state.joined || state.polling || !state.session) return;
  state.polling = true;
  try {
    const receipt = await bridgeFetch("/api/toast/call/turns", {
      method: "POST",
      body: JSON.stringify({ session: state.session, since: state.cursor, wait: 18 }),
    });
    state.cursor = Number(receipt.cursor || state.cursor);
    for (const turn of (receipt.turns || [])) {
      if (!state.turns.some((row) => String(row.id) === String(turn.id))) state.turns.push(turn);
    }
    renderTurns();
  } catch (error) {
    if (state.joined) setNote(`Turn read stopped · ${error.message}`);
  } finally {
    state.polling = false;
    window.clearTimeout(state.turnTimer);
    if (state.joined) state.turnTimer = window.setTimeout(pollTurns, 900);
  }
}

function renderTurns() {
  const list = $("turns");
  if (!state.turns.length) {
    list.innerHTML = `<li class="empty">The line is joined. Owner and sibling turns appear here.</li>`;
    return;
  }
  list.innerHTML = state.turns.slice(-40).map((turn) => `
    <li class="turn" data-kind="${escapeHTML(turn.kind)}" data-contour="card">
      <span class="turn-meta">${escapeHTML(turn.role || turn.kind || "line")}</span>
      <span>${escapeHTML(turn.text || "event")}</span>
    </li>
  `).join("");
  list.scrollTop = list.scrollHeight;
  decorate();
}

async function say(event) {
  event.preventDefault();
  const text = clean($("say-text").value, 1200);
  if (!text || !state.session) return;
  $("say-text").value = "";
  $("say-send").disabled = true;
  try {
    await bridgeFetch("/api/toast/call/say", {
      method: "POST", body: JSON.stringify({ session: state.session, text }),
    });
    setNote("Line spoken and archived.");
    pollTurns();
  } catch (error) {
    setNote(`The line was refused · ${error.message}`);
  } finally {
    $("say-send").disabled = false;
  }
}

async function leaveCall() {
  if (!state.session) return;
  const session = state.session;
  state.joined = false;
  state.session = "";
  window.clearTimeout(state.turnTimer);
  try {
    await bridgeFetch("/api/toast/call/leave", {
      method: "POST", body: JSON.stringify({ session }),
    });
  } catch (error) {
    setNote(`Leave receipt · ${error.message}`);
  }
  $("leave-call").disabled = true;
  $("refresh-turns").disabled = true;
  $("say-text").disabled = true;
  $("say-send").disabled = true;
  setCallState("not joined", "waiting");
}

function wire() {
  $("contact-form").addEventListener("submit", addContact);
  $("mcp-form").addEventListener("submit", addSurface);
  $("contact-list").addEventListener("click", (event) => {
    const use = event.target.closest("[data-call]");
    const remove = event.target.closest("[data-remove-contact]");
    if (use) useContact(use.dataset.call);
    if (remove) {
      state.contacts = state.contacts.filter((row) => row.id !== remove.dataset.removeContact);
      save(); renderContacts(); renderContactChoices();
    }
  });
  $("mcp-list").addEventListener("click", (event) => {
    const select = event.target.closest("[data-select-surface]");
    const remove = event.target.closest("[data-remove-surface]");
    if (select) selectSurface(select.dataset.selectSurface);
    if (remove) {
      state.surfaces = state.surfaces.filter((row) => row.id !== remove.dataset.removeSurface);
      save(); renderSurfaces();
    }
  });
  $("import-vcf").addEventListener("click", () => $("vcf-file").click());
  $("vcf-file").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) importVCard(await file.text());
    event.target.value = "";
  });
  $("export-json").addEventListener("click", exportJSON);
  $("clear-contacts").addEventListener("click", () => {
    if (!window.confirm("Clear the local contact book and MCP surfaces?")) return;
    state.contacts = [];
    state.surfaces = [];
    save(); renderContacts(); renderSurfaces(); renderContactChoices();
  });
  $("choose-envelope").addEventListener("click", () => $("envelope-file").click());
  $("envelope-file").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) loadEnvelope(await file.text());
    event.target.value = "";
  });
  $("clear-envelope").addEventListener("click", () => {
    state.envelope = null;
    $("envelope-state").textContent = "none loaded";
    $("envelope-state").dataset.state = "waiting";
    $("envelope-card").textContent = "No signed envelope loaded.";
  });
  $("call-form").addEventListener("submit", joinCall);
  $("say-form").addEventListener("submit", say);
  $("leave-call").addEventListener("click", leaveCall);
  $("refresh-turns").addEventListener("click", pollTurns);
  $("call-contact").addEventListener("change", () => {
    const row = contactById($("call-contact").value);
    if (row) {
      $("call-agent").value = row.agent || "";
      if (row.mcp) $("mcp-config").textContent = JSON.stringify({ mcpServers: { "popit-call": { type: "http", url: row.mcp } } }, null, 2);
    }
  });
  $("bridge-url").addEventListener("change", () => {
    window.clearTimeout(state.bridgeTimer);
    state.bridgeTimer = window.setTimeout(checkBridge, 250);
  });
  $("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  window.setInterval(() => {
    $("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, 15000);
  if (window.isSecureContext && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  }
}

restore();
renderContacts();
renderSurfaces();
renderContactChoices();
decorate();
wire();
loadContour("./contour.json")
  .then(() => { contourReady = true; fillContours(document); decorate(); checkBridge(); })
  .catch(() => {
    $("origin-state").textContent = "NO CONTOUR";
    $("origin-state").dataset.state = "refused";
    checkBridge();
  });
