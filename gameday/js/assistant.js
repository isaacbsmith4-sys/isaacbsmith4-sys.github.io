// GAME DAY assistant, built in (no AI key). It understands the kinds of questions below, answers only from the
// app's data (ESPN, your models' files), and shows the source and time of every answer. If it can't answer
// something from real data, it says so rather than guessing.
import { esc, ago, fmtTime, fmtDay, dayLabel, isoDay, today, addDays, state, isFavTeam, favTeamIds, favPlayerTeamIds } from "./core.js?v=22";
import { SPORTS, SPORT_KEYS, teams, slate, schedule, searchPlayers, spreadText, fmt1, pct, modelFeed } from "./data.js?v=22";
import { sportBadge, modelBadge, marketBadge, logo, headshot, empty, errBox, gameCard } from "./ui.js?v=22";
import { gamelog, quickProjection } from "./players.js?v=22";
import { labData } from "./stats.js?v=22";

const SUGGEST = [
  "What are my favorite players projected to score tonight?",
  "Which of my favorite teams play today?",
  "What are the best statistical matchups tonight?",
  "Compare the Pacers and the Hawks",
  "What is Luka Doncic's average over his last 10 games?",
  "What does my model predict for the Cowboys game?",
  "Which NBA teams have improved the most recently?",
  "Show my favorite NFL players' receiving projections this week",
];
const log = []; // this session's questions and answers

export function viewAssistant(view) {
  view.dataset.v = "ask";
  view.innerHTML = `<h1 class="page-title">Ask GAME DAY</h1>
    <p class="page-sub">Answers come only from live ESPN data and your models' files, with the source and time on each. No guessing.</p>
    <form id="askForm" class="ask-form"><input class="input" id="askQ" placeholder="Ask about your teams, players, games or your models" autocomplete="off" enterkeyhint="send"><button class="btn primary" type="submit">Ask</button></form>
    <div class="chips ask-chips">${SUGGEST.map((s) => `<button class="chip" data-ask="${esc(s)}">${esc(s)}</button>`).join("")}</div>
    <div id="askLog">${log.map(render).join("")}</div>
    <div class="card pad small muted" style="margin-top:16px;line-height:1.5"><b style="color:var(--text2)">What I can answer</b><br>
      Projections for your players tonight or this week · which of your teams play today or this week · the best matchups tonight ·
      comparing two teams · a player's average over their last N games · what your model predicts for a game · which teams are improving ·
      a team's or player's latest numbers. Free-form chat would need an AI key, which isn't set up.</div>`;
  const form = view.querySelector("#askForm"), q = view.querySelector("#askQ");
  form.onsubmit = (e) => { e.preventDefault(); if (q.value.trim()) ask(view, q.value.trim()); q.value = ""; };
  view.onclick = (e) => { const b = e.target.closest("[data-ask]"); if (b) ask(view, b.dataset.ask); };
}

async function ask(view, text) {
  const entry = { q: text, html: `<div class="skel" style="height:80px"></div>`, at: new Date() };
  log.unshift(entry);
  const box = view.querySelector("#askLog");
  box.innerHTML = log.map(render).join("");
  try { entry.html = await answer(text); } catch (e) { entry.html = errBox("an answer", e); console.error(e); }
  box.innerHTML = log.map(render).join("");
}
const render = (x) => `<div class="ask-item"><div class="ask-q">${esc(x.q)}</div><div class="ask-a">${x.html}</div></div>`;
const src = (s) => `<p class="ask-src">${s}</p>`;

// ---------------------------------------------------------------- understanding the question
const SPORT_WORDS = [[/\bnba\b|pro basketball/i, "nba"], [/\bnfl\b|pro football/i, "nfl"], [/college basketball|\bncaab\b|\bcbb\b|men'?s basketball|march madness/i, "ncaab"], [/college football|\bcfb\b|\bncaaf\b/i, "cfb"]];
const sportsIn = (t) => SPORT_WORDS.filter(([re]) => re.test(t)).map(([, s]) => s).filter((s) => state.sports[s]);
const enabled = () => SPORT_KEYS.filter((k) => state.sports[k]);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

async function findTeams(text, sports) {
  const T = await teams(), t = ` ${norm(text)} `, hits = [];
  const raw = ` ${String(text).replace(/[^A-Za-z0-9 ]/g, " ")} `;
  for (const s of sports) for (const tm of T.sports[s]) {
    const names = [tm.name, tm.short, tm.nick && s !== "ncaab" && s !== "cfb" ? tm.nick : null].filter(Boolean).map(norm);
    let hit = names.filter((n) => n.length >= 3 && t.includes(` ${n} `)).sort((a, b) => b.length - a.length)[0];
    let at = hit ? t.indexOf(` ${hit} `) : -1;
    // abbreviations only when typed in capitals ("IND", "KC"), so words like "for" or "how" don't match teams
    if (!hit && tm.abbr && tm.abbr.length >= 2 && raw.includes(` ${tm.abbr} `)) { hit = tm.abbr; at = raw.indexOf(` ${tm.abbr} `); }
    if (hit) hits.push({ s, tm, len: hit.length, at });
  }
  // keep the longest match per position, prefer followed teams and pro leagues on ties
  hits.sort((a, b) => b.len - a.len || isFavTeam(b.s, b.tm.id) - isFavTeam(a.s, a.tm.id) || (["nba", "nfl"].includes(b.s) - ["nba", "nfl"].includes(a.s)));
  const out = [];
  for (const h of hits) if (!out.some((o) => Math.abs(o.at - h.at) < 3 || (o.tm.id === h.tm.id && o.s === h.s))) out.push(h);
  return out.sort((a, b) => a.at - b.at);
}

async function findPlayer(text) {
  const t = text.replace(/what('?s| is)|average|avg|over|last|\d+|games?|his|her|their|the|in|for|projection|projected|stats?|\?|'s\b/gi, " ").replace(/\s+/g, " ").trim();
  const fav = state.players.find((p) => norm(text).includes(norm(p.name)) || norm(text).includes(norm(p.name.split(" ").pop())));
  if (fav) return fav;
  if (t.split(" ").length < 2) return null;
  const r = await searchPlayers(t).catch(() => []);
  return r.find((p) => state.sports[p.sport]) || null;
}

async function answer(text) {
  const t = text.toLowerCase();
  const sp = sportsIn(t);
  const sports = sp.length ? sp : enabled();
  const mine = /\b(my|favou?rite|i follow|following)\b/.test(t);
  if (/project|score tonight|expected to/.test(t) && mine && /player/.test(t)) return favoriteProjections(sports, /receiv|catch|reception/.test(t) ? "receiving" : null, /week/.test(t));
  if (/receiving|rushing|passing/.test(t) && /projection/.test(t) && mine) return favoriteProjections(sports.includes("nfl") ? ["nfl"] : sports, /receiv/.test(t) ? "receiving" : /rush/.test(t) ? "rushing" : "passing", true);
  if (mine && /team/.test(t) && /(play|playing|game)/.test(t)) return favoriteTeamsPlaying(sports, /week/.test(t) ? 7 : /tomorrow/.test(t) ? "tomorrow" : 0);
  if (/matchup/.test(t) && /(best|top|biggest)/.test(t)) return bestMatchups(sports);
  if (/improv|trending|hot|surging|getting better/.test(t)) return improved(sp.length ? sp : ["nba", "nfl"].filter((s) => state.sports[s]));
  const tms = await findTeams(text, sports);
  if (/compare|\bvs\.?\b|versus|against/.test(t) && tms.length >= 2 && !/predict|model|line|spread/.test(t)) return compare(tms[0], tms[1]);
  if (/predict|model|projected score|spread|line|win (chance|prob)/.test(t) && tms.length) return modelGame(tms);
  const nGames = /last (\d+)/.exec(t);
  if (/average|avg|last \d+|averag|per game|stats/.test(t) || nGames) {
    const p = await findPlayer(text);
    if (p) return playerAverages(p, nGames ? Math.min(+nGames[1], 82) : 10);
  }
  if (tms.length) return teamSnapshot(tms[0]);
  const p = /\b[A-Z][a-z]+ [A-Z][a-z'-]+/.test(text) ? await findPlayer(text) : null;
  if (p) return playerAverages(p, 10);
  return `<p>I can't answer that from the app's data. Try one of the suggestions above, or ask about a specific team, player or game.</p>`;
}

// ---------------------------------------------------------------- answers
async function loadGames(sports) {
  return (await Promise.allSettled(sports.map((s) => slate(s)))).flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

async function favoriteProjections(sports, focus, week) {
  const P = state.players.filter((p) => sports.includes(p.sport));
  if (!P.length) return `<p>You aren't following any ${sports.length === 1 ? SPORTS[sports[0]].label + " " : ""}players yet. Use search (top right) to follow some.</p>`;
  const rows = await Promise.all(P.map(async (p) => {
    let g = null;
    try { g = (await schedule(p.sport, p.teamId)).games.find((x) => x.state !== "post"); } catch {}
    if (!g) return `<div class="li">${headshot(p.headshot)}<div class="sp"><div class="t">${esc(p.name)}</div><div class="s">No upcoming game on the schedule.</div></div></div>`;
    const soon = week ? g.start - Date.now() < 8 * 864e5 : isoDay(g.start) <= isoDay(addDays(today(), 1));
    const opp = g.home.id === p.teamId ? g.away : g.home;
    if (!soon) return `<div class="li">${headshot(p.headshot)}<div class="sp"><div class="t">${esc(p.name)}</div><div class="s">Next game ${esc(fmtDay(g.start))} vs ${esc(opp.abbr)}, not ${week ? "this week" : "tonight"}.</div></div></div>`;
    let q = null;
    try { q = await quickProjection(p.sport, p, g); } catch {}
    let items = q?.items || [];
    if (focus === "receiving") items = items.filter((x) => /REC/.test(x.label));
    if (focus === "rushing") items = items.filter((x) => /RUSH/.test(x.label));
    if (focus === "passing") items = items.filter((x) => /PASS/.test(x.label));
    const why = q?.why === "college" ? "Your college models don't project players." : q?.why === "nba-noline" ? "No projection yet: the NBA model only projects players once their prop lines post (usually game day)." : "Not in the model's player file for this game.";
    return `<a class="li" href="#/player/${p.sport}/${p.id}" style="flex-wrap:wrap">${headshot(p.headshot)}<div class="sp"><div class="t">${esc(p.name)}</div><div class="s">${sportBadge(p.sport)} ${g.home.id === p.teamId ? "vs" : "@"} ${esc(opp.abbr)} · ${esc(dayLabel(g.start))} ${fmtTime(g.start)}</div></div>
      ${items.length ? `<div class="pps">${items.map((x) => `<span class="pp"><small>${esc(x.label)}</small><b>${x.proj >= 100 ? x.proj.toFixed(0) : x.proj.toFixed(1)}</b>${x.line != null ? `<i>${fmt1(x.line)}</i>` : ""}</span>`).join("")}</div>` : `<span class="muted small" style="max-width:220px">${esc(why)}</span>`}</a>`;
  }));
  return `<div class="card list">${rows.join("")}</div>` + src(`${modelBadge("model")} Projections: NBA Model prop board and NFL Model player file (prop line in small type, DraftKings). Schedules: ESPN. As of ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
}

async function favoriteTeamsPlaying(sports, when) {
  const T = state.teams.filter((t) => sports.includes(t.sport));
  if (!T.length) return `<p>You aren't following any teams yet.</p>`;
  const games = await loadGames([...new Set(T.map((t) => t.sport))]);
  const day = when === "tomorrow" ? isoDay(addDays(today(), 1)) : isoDay(today());
  const hit = games.filter((g) => [g.home, g.away].some((x) => isFavTeam(g.sport, x.id)) && (when === 7 ? g.start - Date.now() < 7 * 864e5 && g.state !== "post" : g.day === day))
    .sort((a, b) => a.start - b.start);
  const missing = T.filter((t) => !hit.some((g) => g.sport === t.sport && [g.home.id, g.away.id].includes(t.id)));
  return (hit.length ? `<div class="grid cols">${hit.map((g) => gameCard(g)).join("")}</div>` : `<p>None of your teams play ${when === 7 ? "in the next 7 days (in the loaded schedule)" : when === "tomorrow" ? "tomorrow" : "today"}.</p>`) +
    (missing.length && hit.length ? `<p class="muted small">Not playing: ${missing.map((t) => esc(t.name)).join(", ")}.</p>` : "") +
    src(`Schedules and scores: ESPN · model lines: your models' files · ${ago(new Date())}`);
}

async function bestMatchups(sports) {
  const games = (await loadGames(sports)).filter((g) => g.day === isoDay(today()) && g.state !== "post");
  if (!games.length) return `<p>No games left today${sports.length === 1 ? ` in the ${SPORTS[sports[0]].label}` : ""}.</p>`;
  const out = [];
  for (const s of [...new Set(games.map((g) => g.sport))]) {
    let L = null;
    try { L = await labData(s); } catch {}
    const by = new Map((L?.rows || []).map((r) => [r.id, r]));
    const scored = games.filter((g) => g.sport === s).map((g) => {
      const a = by.get(g.away.id), h = by.get(g.home.id);
      let edge = null, why = "";
      if (s === "nba" && a && h) { // biggest single edge: an offense's rating vs the points per 100 the other defense allows
        const lgO = L.rows.reduce((x, r) => x + r.ortg, 0) / L.rows.length, lgD = L.rows.reduce((x, r) => x + r.drtg, 0) / L.rows.length;
        const aEdge = (a.ortg - lgO) + (h.drtg - lgD), hEdge = (h.ortg - lgO) + (a.drtg - lgD); // + = offense better than avg, defense worse than avg
        const best = aEdge > hEdge ? [g.away, a, h, aEdge] : [g.home, h, a, hEdge];
        edge = best[3]; why = `${best[0].abbr} offense ${best[1].ortg.toFixed(1)} ORtg vs ${(best[0] === g.away ? g.home : g.away).abbr} defense allowing ${best[2].drtg.toFixed(1)} (+${best[3].toFixed(1)} per 100 vs league average)`;
      } else if (s === "nfl" && a && h) { // offense EPA/play plus the EPA/play the other defense allows
        const aEdge = a.oepa + h.depa, hEdge = h.oepa + a.depa;
        const best = aEdge > hEdge ? [g.away, a, h, aEdge] : [g.home, h, a, hEdge];
        edge = best[3] * 100; why = `${best[0].abbr} offense ${best[1].oepa.toFixed(3)} EPA/play vs a defense allowing ${best[2].depa.toFixed(3)}`;
      } else if (g.model?.home_win_prob != null) { // college: closest games by your model
        edge = 50 - Math.abs(g.model.home_win_prob - 0.5) * 100; why = `${g.model.source}: ${pct(Math.max(g.model.home_win_prob, 1 - g.model.home_win_prob))} for ${g.model.home_win_prob >= 0.5 ? g.home.abbr : g.away.abbr} (a close call)`;
      }
      return { g, edge, why };
    }).filter((x) => x.edge != null).sort((a, b) => b.edge - a.edge).slice(0, 4);
    if (scored.length) out.push(`<h3 class="ask-h">${sportBadge(s)} ${s === "nba" ? "Biggest offense-vs-defense mismatches" : s === "nfl" ? "Biggest EPA mismatches" : "Closest games by your model"}</h3>
      <div class="card list">${scored.map((x) => `<a class="li" href="#/game/${s}/${x.g.id}">${logo(x.g.away)}<div class="sp"><div class="t">${esc(x.g.away.abbr)} @ ${esc(x.g.home.abbr)} · ${fmtTime(x.g.start)}</div><div class="s">${esc(x.why)}</div></div>${logo(x.g.home)}</a>`).join("")}</div>`);
  }
  return (out.join("") || `<p>Not enough data for today's games.</p>`) + src("NBA: team efficiency from the research feed (box scores). NFL: EPA from nflverse. College: your models' win chances. ESPN schedules.");
}

async function improved(sports) {
  if (!sports.length) return `<p>Recent-form rankings are available for the NBA and NFL (their per-game team logs are in the research feed).</p>`;
  const out = [];
  for (const s of sports.filter((x) => x === "nba" || x === "nfl")) {
    const { getJSON } = await import("./core.js?v=22");
    const d = await getJSON(`../research/data/${s}_teamstats.json`, { ttl: 600_000 });
    const L = await labData(s);
    const season = Math.max(...Object.values(d.teams).flat().map((r) => r.s));
    const k = s === "nba" ? 4 : 3;
    const rows = Object.entries(d.teams).map(([ab, gs]) => {
      const g = gs.filter((r) => r.s === season).sort((a, b) => (a.d < b.d ? -1 : 1));
      if (g.length < k + 2) return null;
      const m = (arr) => arr.reduce((a, r) => a + (r.pf - r.pa), 0) / arr.length;
      const recent = m(g.slice(-k)), before = m(g.slice(0, -k));
      const t = L.rows.find((r) => r.abbr === ({ LA: "LAR", WAS: "WSH" }[ab] || ab));
      return t ? { t, recent, before, delta: recent - before, n: g.length } : null;
    }).filter(Boolean).sort((a, b) => b.delta - a.delta).slice(0, 5);
    if (!rows.length) { out.push(`<p>${SPORTS[s].label}: not enough games played yet this season to measure a trend.</p>`); continue; }
    out.push(`<h3 class="ask-h">${sportBadge(s)} Most improved: last ${k} games vs earlier this season</h3><div class="card list">${rows.map((r) => `<a class="li" href="#/team/${s}/${r.t.id}">${logo(r.t)}<div class="sp"><div class="t">${esc(r.t.name)}</div><div class="s">Avg margin ${r.recent >= 0 ? "+" : ""}${r.recent.toFixed(1)} recently vs ${r.before >= 0 ? "+" : ""}${r.before.toFixed(1)} before (${r.n} games)</div></div><b style="color:var(--win)">+${r.delta.toFixed(1)}</b></a>`).join("")}</div>`);
  }
  return out.join("") + src(`Point margins per game, this season: research feed (${sports.includes("nfl") ? "nflverse" : ""}${sports.length > 1 ? ", " : ""}${sports.includes("nba") ? "NBA box scores" : ""}). Early-season samples are small.`);
}

async function compare(a, b) {
  if (a.s !== b.s) return `<p>${esc(a.tm.name)} and ${esc(b.tm.name)} are in different sports, so there's nothing to compare head to head.</p>`;
  const s = a.s;
  const L = await labData(s).catch(() => null);
  const ra = L?.rows.find((r) => r.id === a.tm.id), rb = L?.rows.find((r) => r.id === b.tm.id);
  const keyCols = (L?.cols || []).filter((c) => c.better).slice(0, 8);
  const rows = keyCols.map((c) => {
    const va = ra?.[c.key], vb = rb?.[c.key];
    const w = va != null && vb != null && va !== vb ? ((c.better === "high") === (va > vb) ? "a" : "b") : null;
    return `<tr><td class="${w === "a" ? "adv-w" : ""}">${c.fmt(va, ra)}</td><td class="lbl">${esc(c.label)}${c.src === "model" ? ' <span class="badge b-model">Model</span>' : ""}</td><td class="${w === "b" ? "adv-w" : ""}">${c.fmt(vb, rb)}</td></tr>`;
  }).join("");
  return `<div class="card tscroll"><table class="tbl adv-t"><thead><tr><th>${logo(a.tm)} ${esc(a.tm.abbr)}</th><th></th><th>${esc(b.tm.abbr)} ${logo(b.tm)}</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No league-wide data for these teams yet.</td></tr>'}</tbody></table></div>
    <p style="margin:10px 0 0"><a class="btn" href="#/stats/matchup/${s}/${a.tm.id}/${b.tm.id}">Full Matchup Analyzer</a></p>` + src(`${esc(L?.source || "")}${L?.updated ? `, updated ${ago(L.updated)}` : ""}. Green = better side.`);
}

async function modelGame(tms) {
  const { s, tm } = tms[0];
  const sch = await schedule(s, tm.id);
  let g = sch.games.find((x) => x.state !== "post" && (!tms[1] || tms[1].s !== s || [x.home.id, x.away.id].includes(tms[1].tm.id)));
  if (!g) return `<p>${esc(tm.name)} ${tms[1] ? `and ${esc(tms[1].tm.name)} don't have a game scheduled` : "have no upcoming game on the schedule"}.</p>`;
  const m = g.model;
  const mine = g.home.id === tm.id ? g.home : g.away, op = mine === g.home ? g.away : g.home;
  if (!m) return `<p>${esc(SPORTS[s].modelName)} hasn't published a prediction for ${esc(mine.short)} ${mine === g.home ? "vs" : "@"} ${esc(op.short)} (${esc(fmtDay(g.start))}) yet. Its file covers the next few days.</p>` + src("Schedule: ESPN");
  const margin = mine === g.home ? -m.spread_home : m.spread_home;
  const wp = mine === g.home ? m.home_win_prob : 1 - m.home_win_prob;
  const score = m.total != null ? [(m.total + m.spread_home) / 2, (m.total - m.spread_home) / 2] : null; // away, home
  return `<p>${modelBadge(m.source)} <b>${esc(m.source)}</b>: ${esc(margin >= 0 ? mine.short : op.short)} by <b>${fmt1(Math.abs(margin))}</b>${wp != null ? `, ${esc(mine.short)} win chance <b>${pct(wp)}</b>` : ""}${score ? `. Projected score ${esc(g.away.abbr)} ${score[0].toFixed(1)}, ${esc(g.home.abbr)} ${score[1].toFixed(1)}` : ""}.
    ${m.market?.spread_home != null ? `<br>${marketBadge(m.market.book)} Line: ${esc(spreadText(m.market.spread_home, g))}${m.market.total != null ? `, total ${fmt1(m.market.total)}` : ""}. Model: ${esc(spreadText(m.spread_home, g))}${m.total != null ? `, total ${fmt1(m.total)}` : ""}.` : ""}</p>
    ${gameCard(g)}` + src(`${esc(m.source)} file updated ${ago(m.updated)} · ${esc(fmtDay(g.start))} ${fmtTime(g.start)}${s === "nba" ? " · the NBA model doesn't project totals" : ""}`);
}

async function playerAverages(p, N) {
  const { rows } = await gamelog(p.sport, p.id);
  if (!rows.length) return `<p>ESPN has no games in ${esc(p.name)}'s game log for this season yet.</p>`;
  const last = rows.slice(0, N);
  const isBB = SPORTS[p.sport].kind === "basketball";
  const keys = isBB ? [["pts", "PTS"], ["reb", "REB"], ["ast", "AST"], ["fg3m", "3PM"], ["min", "MIN"]]
    : [["passingYards", "PASS YDS"], ["passingTouchdowns", "PASS TD"], ["rushingYards", "RUSH YDS"], ["receptions", "REC"], ["receivingYards", "REC YDS"], ["receivingTouchdowns", "REC TD"]]
      .filter(([k]) => rows.some((r) => r.v[k]));
  const avg = (rs, k) => { const v = rs.map((r) => r.v[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  return `<a class="li" href="#/player/${p.sport}/${p.id}" style="padding:0 0 10px">${headshot(p.headshot)}<div class="sp"><div class="t">${esc(p.name)}</div><div class="s">${sportBadge(p.sport)} ${esc(p.team || "")}</div></div></a>
    <div class="card tscroll"><table class="tbl box"><thead><tr><th class="pcol"></th>${keys.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>
      <tr><td class="pcol">Last ${last.length}</td>${keys.map(([k]) => `<td><b>${avg(last, k)?.toFixed(1) ?? "–"}</b></td>`).join("")}</tr>
      <tr><td class="pcol">Season (${rows.length})</td>${keys.map(([k]) => `<td>${avg(rows, k)?.toFixed(1) ?? "–"}</td>`).join("")}</tr></tbody></table></div>
    ${last.length < N ? `<p class="muted small">Only ${last.length} games played so far.</p>` : ""}` + src(`Actual stats: ESPN game log, through ${esc(fmtDay(rows[0].date))}. Open the player page for projections and the full log.`);
}

async function teamSnapshot({ s, tm }) {
  const sch = await schedule(s, tm.id);
  const past = sch.games.filter((g) => g.state === "post").slice(-5).reverse();
  const next = sch.games.find((g) => g.state !== "post");
  return `<a class="li" href="#/team/${s}/${tm.id}" style="padding:0 0 10px">${logo(tm)}<div class="sp"><div class="t">${esc(tm.name)}</div><div class="s">${sportBadge(s)} ${esc(sch.team?.recordSummary || "")} ${esc(sch.team?.standingSummary ? "· " + sch.team.standingSummary : "")}</div></div></a>
    ${past.length ? `<p class="small">Last ${past.length}: ${past.map((g) => { const me = g.home.id === tm.id ? g.home : g.away, op = me === g.home ? g.away : g.home; return `<b style="color:${me.score > op.score ? "var(--win)" : "var(--loss)"}">${me.score > op.score ? "W" : "L"}</b> ${me.score}-${op.score} ${me === g.home ? "vs" : "@"} ${esc(op.abbr)}`; }).join(" · ")}</p>` : ""}
    ${next ? gameCard(next) : ""}` + src(`ESPN schedule and results${next?.model ? ` · model line: ${esc(next.model.source)}, ${ago(next.model.updated)}` : ""}`);
}
