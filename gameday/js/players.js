// Player profiles and player projections.
//   Actual:  ESPN game logs, career stats, athlete bio (and box scores when ESPN's game log lags)
//   Model:   NBA  -> the NBA model's prop board, published as research/data/nba_props.json
//            NFL  -> the NFL model's player file, nfl/props.json
//            NCAAB / CFB -> no player model exists (the college models predict games only)
//   Market:  the prop line from those same files (DraftKings via ESPN)
import { esc, fmtTime, fmtDay, dayLabel, ago, getJSON, isFavPlayer, state, save } from "./core.js?v=23";
import { SPORTS, athlete, schedule, summary, team as getTeam, fmt1, pct } from "./data.js?v=23";
import { ICON, sportBadge, marketBadge, modelBadge, logo, headshot, section, empty, errBox, skel, gameCard } from "./ui.js?v=23";

const WEB = "https://site.web.api.espn.com/apis/common/v3/sports";
const n = (v) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(x) ? x : null; };
const ma = (v) => { const m = /^(\d+)-(\d+)$/.exec(String(v || "")); return m ? [+m[1], +m[2]] : [null, null]; };

// ---------------------------------------------------------------- stat definitions
// Each stat reads a normalized game row. Rows are {id, date, opp, atVs, result, score, v:{key:number}}
const BB = [
  ["pts", "Points", "PTS"], ["reb", "Rebounds", "REB"], ["ast", "Assists", "AST"], ["fg3m", "3-pointers made", "3PM"],
  ["stl", "Steals", "STL"], ["blk", "Blocks", "BLK"], ["tov", "Turnovers", "TO"], ["min", "Minutes", "MIN"],
];
const BB_PCT = [["fg", "FG%"], ["fg3", "3P%"], ["ft", "FT%"]];
const BB_COMBO = { pra: ["Pts+Reb+Ast", ["pts", "reb", "ast"], "P+R+A"], pr: ["Pts+Reb", ["pts", "reb"], "P+R"], pa: ["Pts+Ast", ["pts", "ast"], "P+A"], ra: ["Reb+Ast", ["reb", "ast"], "R+A"] };

const FB = {
  passingYards: ["Passing yards", "PASS YDS"], passingTouchdowns: ["Passing TDs", "PASS TD"], interceptions: ["Interceptions", "INT"],
  completions: ["Completions", "CMP"], passingAttempts: ["Pass attempts", "ATT"], completionPct: ["Completion %", "CMP%"],
  rushingAttempts: ["Carries", "CAR"], rushingYards: ["Rushing yards", "RUSH YDS"], rushingTouchdowns: ["Rushing TDs", "RUSH TD"],
  receivingTargets: ["Targets", "TGT"], receptions: ["Receptions", "REC"], receivingYards: ["Receiving yards", "REC YDS"],
  receivingTouchdowns: ["Receiving TDs", "REC TD"], yardsPerReception: ["Yards per catch", "Y/R"],
  totalTackles: ["Tackles", "TCKL"], soloTackles: ["Solo tackles", "SOLO"], sacks: ["Sacks", "SACK"], passesDefended: ["Passes defended", "PD"],
};
const FB_ORDER = {
  QB: ["passingYards", "passingTouchdowns", "interceptions", "completions", "passingAttempts", "completionPct", "rushingAttempts", "rushingYards", "rushingTouchdowns"],
  RB: ["rushingAttempts", "rushingYards", "rushingTouchdowns", "receivingTargets", "receptions", "receivingYards", "receivingTouchdowns"],
  WR: ["receivingTargets", "receptions", "receivingYards", "receivingTouchdowns", "yardsPerReception", "rushingYards"],
  DEF: ["totalTackles", "soloTackles", "sacks", "interceptions", "passesDefended"],
};
FB_ORDER.TE = FB_ORDER.WR; FB_ORDER.FB = FB_ORDER.RB;
const posGroup = (pos) => (FB_ORDER[pos] ? pos : /^(DE|DT|LB|OLB|ILB|MLB|CB|S|FS|SS|DB|DL|NT|EDGE)$/.test(pos) ? "DEF" : null);

// ---------------------------------------------------------------- game logs
function bbRow(get) { // get(name) -> raw string, works for ESPN game logs and box scores
  const [fgm, fga] = ma(get("fg")), [f3m, f3a] = ma(get("3pt")), [ftm, fta] = ma(get("ft"));
  return { pts: n(get("pts")), reb: n(get("reb")), ast: n(get("ast")), stl: n(get("stl")), blk: n(get("blk")), tov: n(get("to")),
    min: n(get("min")), fgm, fga, fg3m: f3m, fg3a: f3a, ftm, fta };
}
const GL_BB = { pts: "points", reb: "totalRebounds", ast: "assists", stl: "steals", blk: "blocks", to: "turnovers", min: "minutes",
  fg: "fieldGoalsMade-fieldGoalsAttempted", "3pt": "threePointFieldGoalsMade-threePointFieldGoalsAttempted", ft: "freeThrowsMade-freeThrowsAttempted" };

export async function gamelog(sport, id) {
  const s = SPORTS[sport];
  const j = await getJSON(`${WEB}/${s.path}/athletes/${id}/gamelog`, { label: `${s.label} game log (ESPN)`, ttl: 300_000 });
  const reg = (j.seasonTypes || []).find((t) => /regular|season/i.test(t.displayName) && !/pre/i.test(t.displayName)) || (j.seasonTypes || [])[0];
  const names = j.names || [];
  const rows = [];
  for (const c of reg?.categories || []) for (const e of c.events || []) {
    const m = j.events?.[e.eventId] || {};
    const raw = Object.fromEntries(names.map((k, i) => [k, e.stats[i]]));
    let v;
    if (s.kind === "basketball") v = bbRow((k) => raw[GL_BB[k]]);
    else {
      v = {};
      // football: several stats share a name across categories (e.g. "YDS"); names are unique
      for (const k of names) v[k] = n(raw[k]);
      if (v.completions != null && v.passingAttempts) v.completionPct = (v.completions / v.passingAttempts) * 100;
      if (v.receptions) v.yardsPerReception = v.receivingYards / v.receptions;
    }
    rows.push({ id: String(e.eventId), date: new Date(m.gameDate), opp: m.opponent ? { id: String(m.opponent.id), abbr: m.opponent.abbreviation, logo: m.opponent.logo } : null,
      atVs: m.atVs, result: m.gameResult, score: m.score, raw, v });
  }
  rows.sort((a, b) => b.date - a.date);
  const seasonOpt = (j.filters || []).find((f) => f.name === "season");
  return { rows, season: reg?.displayName || seasonOpt?.value, labels: j.labels, names, cats: j.categories, seasonValue: seasonOpt?.value };
}

// When ESPN's college basketball game log still shows last season, rebuild this season from box scores.
async function logsFromBoxScores(sport, id, teamId) {
  const sch = await schedule(sport, teamId);
  const done = sch.games.filter((g) => g.state === "post").slice(-25);
  const sums = await Promise.allSettled(done.map((g) => summary(sport, g.id, 3_600_000)));
  const rows = [];
  sums.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const { g, d } = r.value;
    for (const tb of d.boxscore?.players || []) {
      const grp = tb.statistics?.[0];
      const a = grp?.athletes?.find((x) => String(x.athlete.id) === String(id));
      if (!a || a.didNotPlay || !a.stats?.length) continue;
      const lab = grp.labels.map((l) => l.toLowerCase());
      const get = (k) => a.stats[lab.indexOf(k === "to" ? "to" : k)];
      const me = String(tb.team.id) === g.home.id ? g.home : g.away, op = me === g.home ? g.away : g.home;
      rows.push({ id: g.id, date: g.start, opp: { id: op.id, abbr: op.abbr, logo: op.logo }, atVs: me === g.home ? "vs" : "@",
        result: me.score > op.score ? "W" : "L", score: `${me.score}-${op.score}`, v: bbRow(get) });
    }
  });
  rows.sort((a, b) => b.date - a.date);
  return rows;
}

export async function careerStats(sport, id) {
  const s = SPORTS[sport];
  return getJSON(`${WEB}/${s.path}/athletes/${id}/stats`, { label: `${s.label} career stats (ESPN)`, ttl: 3_600_000 });
}

// ---------------------------------------------------------------- projections from your models
export async function nbaProps() {
  const d = await getJSON("../research/data/nba_props.json", { label: "NBA Model player props", ttl: 300_000 });
  const byPid = new Map();
  for (const p of d.props || []) {
    if (!byPid.has(String(p.pid))) byPid.set(String(p.pid), []);
    byPid.get(String(p.pid)).push(p);
  }
  return { updated: d.generated_at, markets: d.markets, settings: d.settings, byPid, all: d.props || [] };
}
const NFL_ABBR = { LAR: "LA", WSH: "WAS" };
export const normName = (s) => String(s || "").toLowerCase().replace(/[.'’]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[^a-z]+/g, " ").trim();
export async function nflProps() {
  const d = await getJSON("../nfl/props.json", { label: "NFL Model player projections", ttl: 300_000 });
  const pred = await getJSON("../nfl/predictions.json", { label: "NFL Model predictions", ttl: 300_000 }).catch(() => null);
  const byKey = new Map();
  for (const [gid, players] of Object.entries(d.games || {})) {
    for (const p of players) {
      const k = `${normName(p.name)}|${p.team}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push({ gid, meta: d.meta?.[gid], p });
    }
  }
  return { updated: pred?.generated_at || null, lines_source: d.lines_source, tiers: d.tiers, byKey, games: d.games, meta: d.meta };
}
export const nflAbbr = (a) => NFL_ABBR[a] || a;

// NFL model markets -> game-log stat keys
const NFL_PROJ = { passing_yards: "passingYards", rushing_yards: "rushingYards", receiving_yards: "receivingYards", receptions: "receptions" };
const NFL_LINE = { ...NFL_PROJ, pass_tds: "passingTouchdowns", rush_tds: "rushingTouchdowns", rec_tds: "receivingTouchdowns", pass_attempts: "passingAttempts", completions: "completions", rush_attempts: "rushingAttempts", interceptions: "interceptions" };

// Build {statKey: {proj, line, ...}} for one player's next game
async function projectionsFor(sport, a, next) {
  if (sport === "nba") {
    const f = await nbaProps();
    let list = f.byPid.get(String(a.id)) || [];
    if (next) list = list.filter((p) => String(p.event_id) === next.id || p.date === next.day);
    if (!list.length) return { source: "NBA Model", updated: f.updated, stats: {}, why: "nba-noline", file: f };
    const stats = {};
    for (const p of list) stats[p.market] = {
      proj: p.model.proj, projModel: p.model.proj_model, projMarket: p.model.proj_market, lineShare: p.model.line_share,
      line: p.line, open: p.open_line, over: p.over, under: p.under, book: p.book,
      pOver: p.model.p_over, mktOver: p.model.mkt_over, pick: p.model.pick, edge: p.model.edge, tier: p.model.tier,
      projMin: p.model.proj_min, playProb: p.model.play_prob, status: p.model.status, oppFactor: p.model.opp_factor, note: p.model.note,
      opp: p.opp, start: p.start,
    };
    return { source: "NBA Model", updated: f.updated, stats, file: f, label: f.markets };
  }
  if (sport === "nfl") {
    const f = await nflProps();
    const team = nflAbbr(a.team?.abbreviation);
    let list = f.byKey.get(`${normName(a.displayName)}|${team}`) || [];
    if (!list.length) { // names can differ ("Joshua" vs "Josh", "Hollywood" vs "Marquise"): fall back to a unique last name on the team
      const last = normName(a.displayName).split(" ").pop();
      const cands = [...f.byKey.entries()].filter(([k]) => k.endsWith(`|${team}`) && k.split("|")[0].split(" ").pop() === last);
      if (new Set(cands.map(([k]) => k)).size === 1) list = cands[0][1];
    }
    if (next) {
      const opp = nflAbbr((next.home.id === String(a.team?.id) ? next.away : next.home).abbr);
      list = list.filter((x) => x.meta && [x.meta.away, x.meta.home].includes(opp));
    }
    const hit = list.sort((x, y) => (y.meta?.week || 0) - (x.meta?.week || 0))[0];
    if (!hit) return { source: "NFL Model", updated: f.updated, stats: {}, why: "nfl-missing", file: f };
    const p = hit.p, stats = {};
    for (const [mk, key] of Object.entries(NFL_PROJ)) if (p.proj?.[mk] != null) stats[key] = { proj: p.proj[mk] };
    if (p.td) {
      if (p.td.pass) stats.passingTouchdowns = { proj: p.td.pass, kind: "expected" };
      if (p.td.rush) stats.rushingTouchdowns = { proj: p.td.rush, kind: "expected" };
      if (p.td.rec) stats.receivingTouchdowns = { proj: p.td.rec, kind: "expected" };
    }
    if (p.ctx?.carries) stats.rushingAttempts = { proj: p.ctx.carries, kind: "volume" };
    if (p.ctx?.targets) stats.receivingTargets = { proj: p.ctx.targets, kind: "volume" };
    for (const [mk, ln] of Object.entries(p.lines || {})) {
      const key = NFL_LINE[mk];
      if (!key) continue;
      stats[key] = { ...(stats[key] || {}), proj: stats[key]?.proj ?? ln.proj, line: ln.line, open: ln.open, book: "DraftKings",
        pOver: ln.cal_p_over ?? ln.p_over, side: ln.side, prob: ln.prob, tier: ln.tier, units: ln.units, lineUpdated: ln.updated };
    }
    return { source: "NFL Model", updated: f.updated, stats, anytime: p.td?.anytime, ctx: p.ctx, alerts: p.alerts, status: p.status, week: hit.meta?.week, file: f };
  }
  return { source: null, stats: {}, why: "college" };
}

// ---------------------------------------------------------------- averages
function avg(rows, key) {
  const vals = rows.map((r) => r.v[key]).filter((x) => x != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function pctOf(rows, made, att) {
  const m = rows.reduce((s, r) => s + (r.v[made] || 0), 0), a = rows.reduce((s, r) => s + (r.v[att] || 0), 0);
  return a ? (m / a) * 100 : null;
}
function statList(sport, pos, rows) {
  if (SPORTS[sport].kind === "basketball") return BB.map(([k, l, s]) => ({ key: k, label: l, short: s }));
  const g = posGroup(pos) || "WR";
  const have = new Set(rows.flatMap((r) => Object.keys(r.v).filter((k) => r.v[k] != null)));
  let keys = FB_ORDER[g].filter((k) => have.has(k) || !rows.length);
  if (!keys.length) keys = Object.keys(FB).filter((k) => have.has(k)).slice(0, 8);
  return keys.map((k) => ({ key: k, label: FB[k]?.[0] || k, short: FB[k]?.[1] || k }));
}
const fmtStat = (x, key) => (x == null ? "–" : key === "completionPct" ? x.toFixed(1) : Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1));

// ---------------------------------------------------------------- view
const ui = { chart: null, key: null, logAll: false };

export async function viewPlayer(view, sport, id) {
  const key = `${sport}:${id}`;
  if (ui.key !== key) Object.assign(ui, { key, chart: null, logAll: false });
  view.dataset.v = "player";
  view.innerHTML = `<a class="back" href="#" data-action="back">${ICON.back} Back</a>` + skel(3);
  let a;
  try { a = await athlete(sport, id); } catch (e) { view.innerHTML = errBox("player", e); return; }
  const t = a.team || {};
  const tm = t.id ? await getTeam(sport, t.id) : null;
  const pos = a.position?.abbreviation;
  const saved = state.players.find((p) => p.sport === sport && p.id === String(id));
  if (saved && t.id && saved.teamId !== String(t.id)) { Object.assign(saved, { teamId: String(t.id), team: t.displayName }); save(); }

  // everything this page needs, in parallel
  const [schR, logR] = await Promise.allSettled([t.id ? schedule(sport, t.id) : Promise.reject(new Error("no team")), gamelog(sport, id)]);
  const games = schR.status === "fulfilled" ? schR.value.games : [];
  const next = games.find((g) => g.state !== "post") || null;
  const curSeason = schR.status === "fulfilled" ? schR.value.team?.season?.year || null : null;
  let rows = logR.status === "fulfilled" ? logR.value.rows : [];
  let logNote = logR.status === "fulfilled" ? `${logR.value.season || "Season"} · ESPN game log` : "";
  // college basketball: ESPN's game log can lag a season; rebuild from this season's box scores
  if (sport === "ncaab" && t.id) {
    const thisSeasonStart = games.find((g) => g.state === "post")?.start;
    if (thisSeasonStart && (!rows.length || rows[0].date < thisSeasonStart)) {
      try { rows = await logsFromBoxScores(sport, id, t.id); logNote = "This season · built from ESPN box scores"; } catch {}
    }
  }
  const [projR, injR] = await Promise.allSettled([projectionsFor(sport, a, next), next ? summary(sport, next.id, 120_000) : Promise.resolve(null)]);
  const proj = projR.status === "fulfilled" ? projR.value : { stats: {}, why: "error", error: projR.reason };
  let injury = null, modelInj = null;
  if (injR.status === "fulfilled" && injR.value) {
    for (const tInj of injR.value.d.injuries || []) for (const i of tInj.injuries || []) if (String(i.athlete?.id) === String(id)) injury = i;
    // the model's own file may carry a different injury list; show it separately, never merged
    const mi = injR.value.g.model?.injuries;
    if (mi) modelInj = [...mi.away, ...mi.home].find((x) => normName(x.name) === normName(a.displayName)) || null;
    if (modelInj) modelInj.source = injR.value.g.model.source, modelInj.updated = injR.value.g.model.updated;
  }

  const fav = isFavPlayer(sport, id);
  const pinfo = { sport, id, name: a.displayName, teamId: t.id, team: t.displayName, pos, headshot: a.headshot?.href };
  const facts = [a.displayHeight, a.displayWeight, a.age ? `Age ${a.age}` : null, a.displayExperience, a.college?.name].filter(Boolean);
  const stats = statList(sport, pos, rows);
  if (!ui.chart || !stats.some((s) => s.key === ui.chart)) ui.chart = stats[0]?.key;

  view.innerHTML = `<a class="back" href="#" data-action="back">${ICON.back} Back</a>
    <div class="hero" style="--tc:${esc(tm?.color || "#444")}"><div class="row" style="gap:14px">${headshot(a.headshot?.href, "headshot headshot-lg")}
      <div class="sp"><div class="row" style="gap:6px;margin-bottom:6px;flex-wrap:wrap">${sportBadge(sport)}${injury ? `<span class="badge b-live">${esc(injury.status)}</span>` : modelInj ? `<span class="badge b-market">${esc(modelInj.status)} (model file)</span>` : ""}${a.status?.type && a.status.type !== "active" ? `<span class="badge b-plain">${esc(a.status.name)}</span>` : ""}</div>
      <h1>${esc(a.displayName)}</h1>
      <div class="sub">${[a.displayJersey, a.position?.displayName].filter(Boolean).map(esc).join(" · ")}${t.id ? ` · <a href="#/team/${sport}/${t.id}" style="color:var(--text)"><b>${esc(t.displayName)}</b></a>` : ""}</div>
      <div class="sub small muted">${facts.map(esc).join(" · ")}</div></div></div>
      <div style="margin-top:14px"><button class="btn ${fav ? "on" : ""}" data-action="favplayer" data-p='${esc(JSON.stringify(pinfo))}'>${ICON.star} ${fav ? "Following" : "Follow"}</button></div></div>
    ${injury ? `<div class="card pad" style="margin-top:12px;border-color:rgba(255,59,79,.35)"><b>${esc(injury.status)}</b> · ${esc([injury.details?.type, injury.details?.detail, injury.details?.side].filter(Boolean).join(" ") || injury.type?.description || "")}
      ${injury.details?.returnDate ? ` · expected back ${esc(fmtDay(new Date(injury.details.returnDate)))}` : ""}<div class="muted small" style="margin-top:4px">ESPN injury report${injury.date ? `, updated ${esc(fmtDay(new Date(injury.date)))}` : ""}</div></div>` : ""}
    ${modelInj && (!injury || injury.status !== modelInj.status) ? `<div class="card pad" style="margin-top:12px;border-color:rgba(255,194,71,.35)"><b>${esc(modelInj.status)}</b> in ${esc(modelInj.source)}'s file for the next game
      <div class="muted small" style="margin-top:4px">Model file updated ${ago(modelInj.updated)}${injury ? "" : ". ESPN's injury report for this game doesn't list this player, so check closer to game time."}</div></div>` : ""}
    ${performance(sport, a, next, rows, stats, proj, logNote)}
    ${trend(sport, rows, stats, proj)}
    ${splits(sport, rows, stats)}
    ${gameLogTable(sport, rows, stats, logNote)}
    <div id="career">${section("career", "Career", skel(1))}</div>`;

  view.onclick = (e) => {
    const b = e.target.closest("[data-pl]");
    if (!b) return;
    if (b.dataset.pl === "chart") { ui.chart = b.dataset.v; view.querySelector("#trend").outerHTML = trend(sport, rows, stats, proj); }
    if (b.dataset.pl === "logall") { ui.logAll = !ui.logAll; view.querySelector("#glog").outerHTML = gameLogTable(sport, rows, stats, logNote); }
  };
  careerStats(sport, id).then((c) => { const el = view.querySelector("#career"); if (el) el.innerHTML = career(sport, pos, c); })
    .catch((e) => { const el = view.querySelector("#career"); if (el) el.innerHTML = section("career", "Career", /404/.test(e?.message) ? empty("ESPN has no career stats for this player yet.") : errBox("career stats", e)); });
}

// ---------------------------------------------------------------- PLAYER PERFORMANCE (the key card)
function performance(sport, a, next, rows, stats, proj, logNote) {
  const opp = next ? (next.home.id === String(a.team?.id) ? next.away : next.home) : null;
  const where = next ? (next.home.id === String(a.team?.id) ? "vs" : "@") : "";
  const head = next
    ? `<a class="row" href="#/game/${sport}/${next.id}" style="margin-bottom:12px">${logo(opp)}<div class="sp"><div class="t">${where} ${esc(opp.name || opp.short)}</div>
        <div class="s muted small">${esc(dayLabel(next.start))} · ${fmtTime(next.start)}${opp.record ? ` · ${esc(opp.short)} ${esc(opp.record)}` : ""}${next.state === "in" ? ' · <span style="color:var(--live)">In progress</span>' : ""}</div></div><span class="muted">${ICON.back.replace("m15 18-6-6 6-6", "m9 18 6-6-6-6")}</span></a>`
    : `<p class="muted small" style="margin:0 0 12px">No upcoming game on the schedule.</p>`;
  const season = rows, l5 = rows.slice(0, 5), l10 = rows.slice(0, 10);
  const P = proj.stats || {};
  const isBB = SPORTS[sport].kind === "basketball";
  const keys = stats.map((s) => s.key);
  // NBA combo markets appear only when the model projected them
  const combos = isBB ? Object.keys(BB_COMBO).filter((k) => P[k]) : [];
  const rowFor = (key, label) => {
    const sAvg = BB_COMBO[key] ? sumAvg(season, BB_COMBO[key][1]) : avg(season, key);
    const a5 = BB_COMBO[key] ? sumAvg(l5, BB_COMBO[key][1]) : avg(l5, key);
    const a10 = BB_COMBO[key] ? sumAvg(l10, BB_COMBO[key][1]) : avg(l10, key);
    const p = P[key];
    const diff = p?.proj != null && sAvg != null ? p.proj - sAvg : null;
    return `<tr><td class="pcol" title="${esc(label)}">${esc(shortLbl(key))}</td><td>${fmtStat(sAvg, key)}</td><td>${fmtStat(a5, key)}</td><td class="l10">${fmtStat(a10, key)}</td>
      <td class="mcol">${p?.proj != null ? `<b>${fmtStat(p.proj, key)}</b>${p.kind === "volume" ? "*" : ""}` : "–"}</td>
      <td class="${diff == null ? "" : diff >= 0 ? "up" : "down"}">${diff == null ? "–" : `${diff >= 0 ? "+" : ""}${fmtStat(diff, key)}`}</td>
      <td class="kcol">${p?.line != null ? fmt1(p.line) : "–"}</td></tr>`;
  };
  const lbl = (k) => stats.find((s) => s.key === k)?.label || BB_COMBO[k]?.[0] || k;
  const shortLbl = (k) => stats.find((s) => s.key === k)?.short || BB_COMBO[k]?.[2] || k;
  const show = isBB ? ["pts", "reb", "ast", "fg3m", "stl", "blk", "tov", "min"] : keys;
  const table = rows.length || Object.keys(P).length ? `<div class="tscroll"><table class="tbl perf-t"><thead><tr><th class="pcol">Stat</th><th>Season</th><th>L5</th><th class="l10">L10</th>
      <th class="mcol">Model</th><th title="Model minus season average">+/−</th><th class="kcol">Line</th></tr></thead><tbody>
      ${show.filter((k) => keys.includes(k)).map((k) => rowFor(k, lbl(k))).join("")}${combos.map((k) => rowFor(k, lbl(k))).join("")}</tbody></table></div>` : empty("No games played yet this season.");

  // explanation of where the projection came from, or why there isn't one
  let src = "";
  if (proj.why === "college") src = `<div class="note">No player projection: your ${esc(SPORTS[sport].name)} model predicts games (spread, total, win chance), not individual players.</div>`;
  else if (proj.why === "nba-noline") src = `<div class="note">No projection for this game yet. The NBA model only projects players who have a posted prop line; lines usually appear on game day. Player file updated ${ago(proj.updated)}.</div>`;
  else if (proj.why === "nfl-missing") src = `<div class="note">Not in the NFL model's player file for ${next ? "this game" : "the current week"} (it covers QBs, RBs, WRs and TEs with a role). Updated ${ago(proj.updated)}.</div>`;
  else if (proj.why === "error") src = `<div class="note">Couldn't load the model's player file: ${esc(proj.error?.message || proj.error)}</div>`;
  else {
    const any = Object.values(P)[0] || {};
    const notes = [];
    if (sport === "nba") {
      if (any.projMin != null) notes.push(`Projected minutes <b>${fmt1(any.projMin)}</b>`);
      if (any.playProb != null && any.playProb < 1) notes.push(`chance he plays <b>${pct(any.playProb)}</b>`);
      const ls = Object.values(P).find((x) => x.lineShare)?.lineShare;
      if (ls) notes.push(`early season: ${pct(ls)} of each projection is the book's line (this fades over ~8 games)`);
      const adj = ["pts", "reb", "ast"].filter((k) => P[k]?.oppFactor != null)
        .map((k) => `${k} ${P[k].oppFactor >= 1 ? "+" : ""}${Math.round((P[k].oppFactor - 1) * 100)}%`);
      if (adj.length && opp) notes.push(`opponent adjustment vs ${esc(opp.abbr)}: ${adj.join(", ")}`);
    }
    if (sport === "nfl") {
      if (proj.anytime != null) notes.push(`Anytime TD chance <b>${pct(proj.anytime)}</b>`);
      if (proj.ctx?.tgt_share) notes.push(`target share ${pct(proj.ctx.tgt_share)}`);
      if (proj.ctx?.car_share) notes.push(`carry share ${pct(proj.ctx.car_share)}`);
      if (proj.ctx?.team_pts) notes.push(`team projected ${fmt1(proj.ctx.team_pts)} pts`);
      const rel = (x) => (x == null || x === 0 ? null : `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`);
      const dr = [["vs pass (yds/target)", rel(proj.ctx?.def_ypt_rel)], ["vs run (yds/carry)", rel(proj.ctx?.def_ypc_rel)]].filter((x) => x[1]);
      if (dr.length && opp) notes.push(`${esc(opp.abbr)} defense ${dr.map(([l, v]) => `${v} ${l}`).join(", ")} vs average`);
      (proj.alerts || []).forEach((x) => notes.push(esc(x)));
    }
    src = `<div class="note">${modelBadge(proj.source)} <b>${esc(proj.source)}</b>, updated ${ago(proj.updated)}${next?.state !== "pre" && next ? " · pre-game projection" : ""}.
      ${notes.length ? `<br>${notes.join(" · ")}` : ""}${Object.values(P).some((x) => x.kind === "volume") ? "<br>* expected volume the model uses as an input" : ""}
      ${sport === "nfl" && Object.values(P).some((x) => x.kind === "expected") ? "<br>TD rows are expected touchdowns, not a yes/no." : ""}</div>`;
    // prop lines: model's chance vs the book, kept apart
    const lined = Object.entries(P).filter(([, x]) => x.line != null);
    if (lined.length) src += `<div class="note"><div class="row" style="margin-bottom:6px">${marketBadge("DraftKings")}<b>Prop lines</b><span class="sp"></span><span class="small">model's chance of over</span></div>
      ${lined.map(([k, x]) => `<div class="row small" style="padding:3px 0"><span class="sp">${esc(lbl(k))} <b>${fmt1(x.line)}</b>${x.open != null && x.open !== x.line ? ` <span class="muted">(open ${fmt1(x.open)})</span>` : ""}${x.over != null ? ` <span class="muted">O ${x.over > 0 ? "+" : ""}${x.over} / U ${x.under > 0 ? "+" : ""}${x.under}</span>` : ""}</span>
        <b style="color:var(--model)">${pct(x.pOver)}</b>${x.mktOver != null ? `<span class="muted">book ${pct(x.mktOver)}</span>` : ""}${x.tier ? `<span class="badge b-plain">${esc(x.tier === "play3" ? "3U" : x.tier === "play1" ? "1U" : x.tier)}</span>` : ""}</div>`).join("")}</div>`;
  }
  return section("perf", "Player performance", `<div class="card" style="overflow:hidden"><div class="pad" style="padding-bottom:0">${head}</div>${table}${src}</div>`,
    `Actual · ${esc(logNote || "ESPN")}`);
}
function sumAvg(rows, keys) {
  const ok = rows.filter((r) => keys.every((k) => r.v[k] != null));
  return ok.length ? ok.reduce((s, r) => s + keys.reduce((t, k) => t + r.v[k], 0), 0) / ok.length : null;
}

// ---------------------------------------------------------------- trend chart (last 10 games)
function trend(sport, rows, stats, proj) {
  const key = ui.chart;
  if (!rows.length || !key) return `<div id="trend"></div>`;
  const last = rows.slice(0, 10).reverse();
  const vals = last.map((r) => r.v[key] ?? 0);
  const sAvg = avg(rows, key), p = proj.stats?.[key];
  const max = Math.max(1, ...vals, sAvg || 0, p?.proj || 0, p?.line || 0) * 1.12;
  const W = 600, H = 170, bw = W / last.length;
  const y = (v) => H - (v / max) * H;
  const bars = last.map((r, i) => `<g><rect x="${i * bw + bw * 0.18}" y="${y(vals[i])}" width="${bw * 0.64}" height="${H - y(vals[i])}" rx="4" fill="${r.result === "W" ? "var(--win)" : "var(--line2)"}" opacity=".85"/>
    <text x="${i * bw + bw / 2}" y="${Math.max(12, y(vals[i]) - 5)}" text-anchor="middle" font-size="13" fill="var(--text)" font-weight="700">${fmtStat(vals[i], key).replace(/\.0$/, "")}</text></g>`).join("");
  const hline = (v, color, dash) => (v == null ? "" : `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="${color}" stroke-width="2" ${dash ? 'stroke-dasharray="6 5"' : ""}/>`);
  return `<div id="trend">${section("trend", "Recent trend", `<div class="card pad">
    <div class="chips" style="padding:0 0 10px">${stats.map((s) => `<button class="chip" data-pl="chart" data-v="${s.key}" aria-pressed="${s.key === key}">${esc(s.short)}</button>`).join("")}</div>
    <svg viewBox="0 0 ${W} ${H + 22}" style="width:100%;height:auto;display:block" role="img" aria-label="${esc(key)} over the last ${last.length} games">
      ${bars}${hline(sAvg, "var(--muted)", true)}${hline(p?.proj, "var(--model)")}${hline(p?.line, "var(--market)", true)}
      ${last.map((r, i) => `<text x="${i * bw + bw / 2}" y="${H + 16}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(r.opp?.abbr || "")}</text>`).join("")}
    </svg>
    <div class="row small muted" style="gap:14px;flex-wrap:wrap;margin-top:6px"><span><i class="lg" style="border-color:var(--muted)"></i> Season avg ${fmtStat(sAvg, key)}</span>
      ${p?.proj != null ? `<span><i class="lg solid" style="border-color:var(--model)"></i> Model ${fmtStat(p.proj, key)}</span>` : ""}
      ${p?.line != null ? `<span><i class="lg" style="border-color:var(--market)"></i> Line ${fmt1(p.line)}</span>` : ""}<span><i class="lg sq" style="background:var(--win)"></i> win</span></div>
  </div>`, `Last ${last.length} games`)}</div>`;
}

// ---------------------------------------------------------------- splits
function splits(sport, rows, stats) {
  if (!rows.length) return "";
  const isBB = SPORTS[sport].kind === "basketball";
  const sets = [["Last 5", rows.slice(0, 5)], ["Last 10", rows.slice(0, 10)], ["Last 20", rows.slice(0, 20)], [`Season (${rows.length})`, rows]];
  const homeRows = rows.filter((r) => r.atVs === "vs"), awayRows = rows.filter((r) => r.atVs !== "vs");
  if (homeRows.length && awayRows.length) sets.push(["Home", homeRows], ["Away", awayRows]);
  const cols = stats.slice(0, isBB ? 8 : 7);
  const pc = isBB ? BB_PCT : [];
  return section("splits", "Averages", `<div class="card tscroll"><table class="tbl box"><thead><tr><th class="pcol">Span</th>${cols.map((s) => `<th>${esc(s.short)}</th>`).join("")}${pc.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>
    ${sets.map(([l, rs]) => `<tr><td class="pcol">${esc(l)}</td>${cols.map((s) => `<td>${fmtStat(avg(rs, s.key), s.key)}</td>`).join("")}
      ${pc.map(([k]) => { const v = pctOf(rs, k === "fg" ? "fgm" : k === "fg3" ? "fg3m" : "ftm", k === "fg" ? "fga" : k === "fg3" ? "fg3a" : "fta"); return `<td>${v == null ? "–" : v.toFixed(1)}</td>`; }).join("")}</tr>`).join("")}
    </tbody></table></div>`, "Actual · per game");
}

// ---------------------------------------------------------------- game log
function gameLogTable(sport, rows, stats, note) {
  if (!rows.length) return `<div id="glog">${section("glog", "Game log", empty("No games in ESPN's game log yet this season."))}</div>`;
  const shown = ui.logAll ? rows : rows.slice(0, 10);
  const cols = stats;
  return `<div id="glog">${section("glog", "Game log", `<div class="card tscroll"><table class="tbl box"><thead><tr><th class="pcol">Game</th>${cols.map((s) => `<th>${esc(s.short)}</th>`).join("")}</tr></thead><tbody>
    ${shown.map((r) => `<tr><td class="pcol"><a href="#/game/${sport}/${r.id}"><span class="${r.result === "W" ? "win-t" : "loss-t"}">${esc(r.result || "")}</span> ${esc(r.atVs || "")} ${esc(r.opp?.abbr || "")}</a>
      <span class="muted small">${esc(r.date.toLocaleDateString([], { month: "numeric", day: "numeric" }))}</span></td>${cols.map((s) => `<td>${fmtStat(r.v[s.key], s.key).replace(/\.0$/, "")}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>${rows.length > 10 ? `<div style="text-align:center;margin-top:10px"><button class="btn" data-pl="logall">${ui.logAll ? "Show last 10" : `Show all ${rows.length}`}</button></div>` : ""}`, esc(note))}</div>`;
}

// ---------------------------------------------------------------- career
function career(sport, pos, c) {
  const cats = c.categories || [];
  if (!cats.length) return section("career", "Career", empty("ESPN has no career stats for this player."));
  let pick;
  if (SPORTS[sport].kind === "basketball") pick = cats.filter((x) => x.name === "averages");
  else {
    const g = posGroup(pos);
    const want = g === "QB" ? ["passing", "rushing"] : g === "RB" || g === "FB" ? ["rushing", "receiving"] : g === "DEF" ? ["defensive", "defense", "tackles", "defensiveInterceptions"] : ["receiving", "rushing"];
    pick = want.map((w) => cats.find((x) => x.name === w)).filter((x) => x && x.statistics?.some((s) => s.stats.some((v) => v !== "0" && v !== "0.0" && v !== "-")));
    if (!pick.length) pick = cats.slice(0, 1);
  }
  return pick.map((cat) => section("career", `Career ${esc(cat.displayName?.replace(/Regular Season /, "") || "")}`, `<div class="card tscroll"><table class="tbl box"><thead><tr><th class="pcol">Season</th>${cat.labels.map((l) => `<th>${esc(l)}</th>`).join("")}</tr></thead><tbody>
      ${cat.statistics.slice().reverse().map((s) => `<tr><td class="pcol">${esc(s.season?.displayName || "")} <span class="muted small">${esc(teamAbbr(c, s.teamId) || "")}</span></td>${s.stats.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}
      ${cat.totals ? `<tr class="tot"><td class="pcol">Career</td>${cat.totals.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>` : ""}</tbody></table></div>`, "Actual · ESPN")).join("");
}
const teamAbbr = (c, id) => {
  const t = (c.teams && (Array.isArray(c.teams) ? c.teams.find((x) => String(x.id) === String(id)) : c.teams[id])) || null;
  return t?.abbreviation || "";
};

// ---------------------------------------------------------------- projections for a whole game (Game Center) and for favorites (Home)
export async function gameProjections(sport, g) {
  if (sport === "nba") {
    const f = await nbaProps();
    const rows = new Map();
    for (const p of f.all.filter((p) => String(p.event_id) === g.id)) {
      if (!rows.has(p.pid)) rows.set(p.pid, { id: String(p.pid), name: p.player, team: p.team, stats: {} });
      rows.get(p.pid).stats[p.market] = { proj: p.model.proj, line: p.line, pOver: p.model.p_over, tier: p.model.tier };
    }
    return { source: "NBA Model", updated: f.updated, cols: [["pts", "PTS"], ["reb", "REB"], ["ast", "AST"], ["fg3m", "3PM"]],
      players: [...rows.values()].sort((a, b) => (b.stats.pts?.proj || b.stats.pra?.proj || 0) - (a.stats.pts?.proj || a.stats.pra?.proj || 0)) };
  }
  if (sport === "nfl") {
    const f = await nflProps();
    const A = nflAbbr(g.away.abbr), Hm = nflAbbr(g.home.abbr);
    const gid = Object.keys(f.games).find((k) => f.meta?.[k]?.away === A && f.meta?.[k]?.home === Hm);
    if (!gid) return { source: "NFL Model", updated: f.updated, players: [], cols: [] };
    const players = f.games[gid].map((p) => ({ name: p.name, team: p.team, pos: p.pos, stats: {
      passingYards: { proj: p.proj?.passing_yards, line: p.lines?.passing_yards?.line }, rushingYards: { proj: p.proj?.rushing_yards, line: p.lines?.rushing_yards?.line },
      receptions: { proj: p.proj?.receptions, line: p.lines?.receptions?.line }, receivingYards: { proj: p.proj?.receiving_yards, line: p.lines?.receiving_yards?.line },
      anytime: { proj: p.td?.anytime != null ? p.td.anytime * 100 : null } } }))
      .sort((a, b) => Math.max(b.stats.passingYards.proj || 0, b.stats.rushingYards.proj || 0, b.stats.receivingYards.proj || 0)
        - Math.max(a.stats.passingYards.proj || 0, a.stats.rushingYards.proj || 0, a.stats.receivingYards.proj || 0));
    return { source: "NFL Model", updated: f.updated, cols: [["passingYards", "PASS"], ["rushingYards", "RUSH"], ["receptions", "REC"], ["receivingYards", "REC YDS"], ["anytime", "TD %"]], players };
  }
  return null;
}

export function projectionTable(sport, gp, teamIdsByName) {
  if (!gp) return "";
  if (!gp.players.length) return section("pp", "Player projections", `<div class="card pad small muted">${esc(gp.source)} has no player projections for this game yet${sport === "nba" ? " (it only projects players with posted prop lines, usually on game day)" : ""}.</div>`);
  const cell = (s) => (s?.proj == null ? "–" : `<b style="color:var(--model)">${fmtStat(s.proj)}</b>${s.line != null ? `<br><span class="small" style="color:var(--market)">${fmt1(s.line)}</span>` : ""}`);
  return section("pp", "Player projections", `<div class="card tscroll"><table class="tbl box"><thead><tr><th class="pcol">Player</th>${gp.cols.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>
    ${gp.players.slice(0, 16).map((p) => `<tr><td class="pcol">${p.id ? `<a href="#/player/${sport}/${p.id}">${esc(p.name)}</a>` : `<a href="#" data-action="findplayer" data-q="${esc(p.name)}">${esc(p.name)}</a>`} <span class="muted small">${esc(p.pos || (p.team || "").split(" ").pop())}</span></td>
      ${gp.cols.map(([k]) => `<td>${cell(p.stats[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="muted small" style="margin:8px 2px 0">${modelBadge(gp.source)} projection on top, ${marketBadge("DraftKings")} line under it · ${esc(gp.source)} updated ${ago(gp.updated)}</p>`, "Model vs line");
}

// Compact projection for a followed player (Home > My players)
export async function quickProjection(sport, saved, game) {
  const team = game.home.id === saved.teamId ? game.home : game.away;
  const a = { id: saved.id, displayName: saved.name, team: { id: saved.teamId, abbreviation: team.abbr } };
  const p = await projectionsFor(sport, a, game);
  const pickKeys = sport === "nba" ? ["pts", "reb", "ast", "fg3m"]
    : ["passingYards", "rushingYards", "receptions", "receivingYards"].filter((k) => p.stats[k]?.proj != null).slice(0, 3);
  const short = { pts: "PTS", reb: "REB", ast: "AST", fg3m: "3PM", passingYards: "PASS YDS", rushingYards: "RUSH YDS", receptions: "REC", receivingYards: "REC YDS" };
  return { source: p.source, updated: p.updated, why: p.why, items: pickKeys.filter((k) => p.stats[k]?.proj != null).map((k) => ({ label: short[k], proj: p.stats[k].proj, line: p.stats[k].line })) };
}
