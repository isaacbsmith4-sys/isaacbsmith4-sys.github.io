// Core: saved state (favorites, settings), fetching with a source log, date helpers.
// Everything is saved on this device (localStorage), like LIFE HQ. Nothing is sent anywhere.

const KEY = "gameday:v1";

export const SECTIONS = [
  { key: "my", label: "My Sports", hint: "Games for the teams and players you follow" },
  { key: "players", label: "My players", hint: "Next game and your model's projection for players you follow" },
  { key: "live", label: "Live now", hint: "Games in progress" },
  { key: "featured", label: "Biggest games", hint: "Ranked matchups, national TV, close model calls" },
  { key: "models", label: "Model predictions", hint: "Your models' lines next to DraftKings" },
  { key: "today", label: "Today's games", hint: "Everything on today's slate" },
  { key: "performers", label: "Top performances", hint: "Game leaders from live and final games" },
  { key: "finals", label: "Yesterday's finals", hint: "Final scores" },
  { key: "news", label: "Latest news", hint: "Headlines from ESPN" },
];

const DEFAULTS = {
  sports: { nba: true, nfl: true, ncaab: true, cfb: true },
  filter: "all",
  sections: SECTIONS.map((s) => ({ key: s.key, on: true })),
  teams: [],    // {sport, id, name, abbr, logo, color}
  players: [],  // {sport, id, name, teamId, team, pos, headshot}
};

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "{}");
    const out = { ...structuredClone(DEFAULTS), ...s };
    out.sports = { ...DEFAULTS.sports, ...(s.sports || {}) };
    // keep any sections added in later versions
    const have = new Set(out.sections.map((x) => x.key));
    DEFAULTS.sections.forEach((d, i) => {
      if (have.has(d.key)) return;
      const prev = DEFAULTS.sections[i - 1]?.key;
      const at = out.sections.findIndex((x) => x.key === prev);
      out.sections.splice(at + 1, 0, { ...d });
    });
    out.sections = out.sections.filter((x) => SECTIONS.some((s) => s.key === x.key));
    return out;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const state = load();
const listeners = new Set();
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  listeners.forEach((f) => f());
}
export function onSave(f) { listeners.add(f); }
export function resetAll() {
  try { localStorage.removeItem(KEY); } catch {}
  location.reload();
}

// ---- favorites
export const isFavTeam = (sport, id) => state.teams.some((t) => t.sport === sport && t.id === String(id));
export const isFavPlayer = (sport, id) => state.players.some((p) => p.sport === sport && p.id === String(id));
export function toggleTeam(t) {
  const i = state.teams.findIndex((x) => x.sport === t.sport && x.id === String(t.id));
  if (i >= 0) state.teams.splice(i, 1);
  else state.teams.push({ sport: t.sport, id: String(t.id), name: t.name, abbr: t.abbr, logo: t.logo, color: t.color });
  save();
  return i < 0;
}
export function togglePlayer(p) {
  const i = state.players.findIndex((x) => x.sport === p.sport && x.id === String(p.id));
  if (i >= 0) state.players.splice(i, 1);
  else state.players.push({ sport: p.sport, id: String(p.id), name: p.name, teamId: p.teamId ? String(p.teamId) : null,
    team: p.team || null, pos: p.pos || null, headshot: p.headshot || null });
  save();
  return i < 0;
}
export function move(list, i, d) {
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  save();
}
export const favTeamIds = (sport) => new Set(state.teams.filter((t) => t.sport === sport).map((t) => t.id));
export const favPlayerTeamIds = (sport) =>
  new Set(state.players.filter((p) => p.sport === sport && p.teamId).map((p) => p.teamId));

// ---- fetching: every request is logged so Profile > Data sources can show what loaded and when
export const sourceLog = new Map(); // label -> {url, ok, at, error, ms}
const memo = new Map();             // url -> {at, promise}

export async function getJSON(url, { label, ttl = 60_000 } = {}) {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const t0 = performance.now();
  const p = fetch(url, { cache: "no-cache" })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((d) => {
      if (label) sourceLog.set(label, { url, ok: true, at: new Date(), ms: Math.round(performance.now() - t0) });
      return d;
    })
    .catch((e) => {
      memo.delete(url);
      if (label) sourceLog.set(label, { url, ok: false, at: new Date(), error: String(e.message || e) });
      throw e;
    });
  memo.set(url, { at: Date.now(), promise: p });
  return p;
}
export const forget = () => memo.clear();

// ---- dates (device local time)
export const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export const today = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; };
export const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const fmtDay = (d) => d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
export function dayLabel(d) {
  const k = isoDay(d), t = today();
  if (k === isoDay(t)) return "Today";
  if (k === isoDay(addDays(t, 1))) return "Tomorrow";
  if (k === isoDay(addDays(t, -1))) return "Yesterday";
  return fmtDay(d);
}
export function ago(d) {
  if (!d) return "";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
