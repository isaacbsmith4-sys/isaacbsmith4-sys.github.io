// Team profiles: record, next-game prediction from your model, team stats with league ranks,
// model ratings, standings, schedule, roster.
import { esc, fmtTime, fmtDay, dayLabel, ago, isFavTeam, state } from "./core.js?v=11";
import { SPORTS, team as getTeam, schedule, modelFeed, teamStatistics, roster, leagueTable, spreadText, fmt1, pct } from "./data.js?v=11";
import { ICON, sportBadge, modelBadge, marketBadge, logo, headshot, section, empty, errBox, skel, gameCard } from "./ui.js?v=11";

const ui = { key: null, past: false, next: false, roster: false };
const n = (v) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(x) ? x : null; };
const ord = (i) => `${i}${["th", "st", "nd", "rd"][(i % 100 > 10 && i % 100 < 14) || i % 10 > 3 ? 0 : i % 10]}`;
const signed = (x, d = 1) => (x == null ? "–" : `${x > 0 ? "+" : ""}${x.toFixed(d)}`);

export async function viewTeam(view, sport, id) {
  const key = `${sport}:${id}`;
  if (ui.key !== key) Object.assign(ui, { key, past: false, next: false, roster: false });
  view.dataset.v = "team";
  const t = await getTeam(sport, id);
  if (!t) { view.innerHTML = empty("Team not found."); return; }
  const fav = isFavTeam(sport, t.id);
  const hero = (extra = "") => `<a class="back" href="#/teams" data-action="back">${ICON.back} Back</a>
    <div class="hero" style="--tc:${esc(t.color)}"><div class="row" style="gap:14px">${logo(t, "logo logo-lg")}
      <div class="sp"><div class="row" style="gap:6px;margin-bottom:6px">${sportBadge(sport)}</div><h1>${esc(t.name)}</h1>
      <div class="sub">${esc([t.div, t.conf].filter(Boolean).join(" · "))}</div>${extra}</div></div>
      <div style="margin-top:14px"><button class="btn ${fav ? "on" : ""}" data-action="favteam" data-sport="${sport}" data-id="${t.id}">${ICON.star} ${fav ? "Following" : "Follow"}</button>
      <a class="btn" href="#/stats/matchup/${sport}/${t.id}" style="margin-left:6px">Compare</a></div></div>`;
  view.innerHTML = hero() + skel(3);

  const [schR, tblR, statR, feedR, rosR] = await Promise.allSettled([
    schedule(sport, id), leagueTable(sport), teamStatistics(sport, id), modelFeed(sport), roster(sport, id)]);
  if (schR.status === "rejected") { view.innerHTML = hero() + errBox("schedule", schR.reason); return; }
  const sch = schR.value;
  const tbl = tblR.status === "fulfilled" ? tblR.value : null;
  const me = tbl?.rows.find((r) => r.id === String(id));
  const feed = feedR.status === "fulfilled" ? feedR.value : null;
  const past = sch.games.filter((g) => g.state === "post").reverse();
  const upcoming = sch.games.filter((g) => g.state !== "post");
  const ng = upcoming[0];

  const rec = sch.team?.recordSummary, stand = sch.team?.standingSummary;
  const heroExtra = `<div class="sub" style="margin-top:6px"><b style="color:var(--text)">${esc(rec || me?.rec.total || "")}</b>${stand ? ` · ${esc(stand)}` : ""}</div>
    ${me ? `<div class="hero-stats">
      ${chip("Home", me.rec.home)}${chip("Away", me.rec.road)}${me.rec.conf ? chip("Conf", me.rec.conf) : ""}${me.rec.streak && me.rec.streak !== "-" ? chip("Streak", me.rec.streak) : ""}
    </div>` : ""}`;

  view.innerHTML = hero(heroExtra) +
    (ng ? prediction(sport, t, ng, feed, tbl) : section("next", "Next game", empty("No upcoming games on the schedule."))) +
    recent(sport, id, past) +
    teamStatsSection(sport, statR, me, tbl, past.length) +
    modelRatings(sport, t, feed) +
    standingsSnippet(sport, me, tbl) +
    scheduleSection(sport, id, past, upcoming) +
    rosterSection(sport, rosR) +
    `<p class="muted small" style="text-align:center;margin-top:18px">Actual: ESPN · Predictions: ${esc(SPORTS[sport].modelName)}${feed?.updated ? `, updated ${ago(feed.updated)}` : ""}</p>`;

  view.onclick = (e) => {
    const b = e.target.closest("[data-tm]");
    if (!b) return;
    ui[b.dataset.tm] = !ui[b.dataset.tm];
    viewTeam(view, sport, id);
  };
}
const chip = (l, v) => (v ? `<span class="hs"><small>${esc(l)}</small><b>${esc(v)}</b></span>` : "");

// ---------------------------------------------------------------- next game prediction (your model)
export function prediction(sport, t, g, feed, tbl) {
  const home = g.home.id === String(t.id);
  const meT = home ? g.home : g.away, op = home ? g.away : g.home;
  const m = g.model;
  const head = `<a class="row" href="#/game/${sport}/${g.id}" style="margin-bottom:12px">${logo(op, "logo")}<div class="sp"><div class="t">${home ? "vs" : "@"} ${esc(op.name || op.short)}</div>
    <div class="s muted small">${esc(dayLabel(g.start))} · ${fmtTime(g.start)}${g.tv.length ? ` · ${esc(g.tv[0])}` : ""}${op.record ? ` · ${esc(op.abbr)} ${esc(op.record)}` : ""}</div></div><span class="muted">${ICON.back.replace("m15 18-6-6 6-6", "m9 18 6-6-6-6")}</span></a>`;
  if (!m) return section("next", "Next game", `<div class="card pad">${head}<p class="muted small" style="margin:0">${esc(SPORTS[sport].modelName)} has no prediction for this game yet. Its file covers the next few days${sport === "nfl" ? " and the current week" : ""}.</p></div>`);

  const margin = m.spread_home == null ? null : home ? -m.spread_home : m.spread_home; // + = this team wins by
  const wp = m.home_win_prob == null ? null : home ? m.home_win_prob : 1 - m.home_win_prob;
  const score = m.total != null && m.spread_home != null ? { home: (m.total - m.spread_home) / 2, away: (m.total + m.spread_home) / 2 } : null;
  const mk = m.market;
  const bookSpread = mk?.spread_home == null ? null : home ? mk.spread_home : -mk.spread_home; // this team's line
  const diff = margin != null && bookSpread != null ? margin - -bookSpread : null; // model margin minus book's implied margin
  const teamLine = (x) => (x == null ? "–" : Math.abs(x) < 0.05 ? "PK" : `${esc(meT.abbr)} ${x > 0 ? "+" : ""}${fmt1(x)}`);

  const big = `<div class="pred">
    ${score ? `<div class="pred-score"><div>${logo(g.away)}<b>${score.away.toFixed(1)}</b><span>${esc(g.away.abbr)}</span></div><i>–</i><div>${logo(g.home)}<b>${score.home.toFixed(1)}</b><span>${esc(g.home.abbr)}</span></div></div>
      <p class="muted small" style="text-align:center;margin:4px 0 12px">Projected score, from the model's own spread and total</p>` : ""}
    <div class="stats-grid">
      <div class="stat-box"><div class="n" style="color:var(--model)">${margin == null ? "–" : `${margin >= 0 ? esc(meT.abbr) : esc(op.abbr)} by ${fmt1(Math.abs(margin))}`}</div><div class="l">Model margin</div></div>
      ${wp != null ? `<div class="stat-box"><div class="n" style="color:var(--model)">${pct(wp)}</div><div class="l">${esc(meT.abbr)} win chance</div></div>` : ""}
      <div class="stat-box"><div class="n" style="color:var(--model)">${teamLine(margin == null ? null : -margin)}</div><div class="l">Model spread</div></div>
      ${bookSpread != null ? `<div class="stat-box"><div class="n" style="color:var(--market)">${teamLine(bookSpread)}</div><div class="l">${esc(mk.book || "Book")} spread</div>${mk.spread_open != null ? `<div class="r">open ${teamLine(home ? mk.spread_open : -mk.spread_open)}</div>` : ""}</div>` : ""}
      ${m.total != null ? `<div class="stat-box"><div class="n" style="color:var(--model)">${fmt1(m.total)}</div><div class="l">Model total</div></div>` : ""}
      ${mk?.total != null ? `<div class="stat-box"><div class="n" style="color:var(--market)">${fmt1(mk.total)}</div><div class="l">${esc(mk.book || "Book")} total</div></div>` : ""}
    </div>
    ${diff != null ? `<div class="note" style="margin:10px -14px -14px">${Math.abs(diff) < 0.5 ? "Model and book agree on this game." : `The model has <b>${esc(diff > 0 ? meT.abbr : op.abbr)}</b> <b>${fmt1(Math.abs(diff))} pts</b> better than ${esc(mk.book || "the book")} does.`}</div>` : ""}
    ${!score ? `<div class="note" style="margin:${diff != null ? "14px" : "10px"} -14px -14px">${sport === "nba" ? "The NBA model projects the margin, not a total, so there's no projected score." : "No model total for this game, so no projected score."}</div>` : ""}
  </div>`;
  const links = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><a class="btn" href="#/game/${sport}/${g.id}">Game Center</a><a class="btn" href="#/game/${sport}/${g.id}/matchup">Head-to-head vs ${esc(op.abbr)}</a></div>`;
  return section("next", "Next game: your model", `<div class="card pad">${head}${big}</div>${links}${advantages(sport, g, home, feed)}`,
    `${modelBadge(m.source)} ${esc(m.source)} · ${ago(m.updated)}`);
}

// matchup advantages from the model's own inputs
const HIGHER = /rating|margin|strength|offense|points per play for|yards per play edge|higher = better|goals for|saved vs avg|save %/i;
const LOWER = /value missing|against|model rank|ap rank/i;
function advantages(sport, g, home, feed) {
  const m = g.model;
  if (sport === "nfl" && m.explain?.parts?.length) {
    const meT = home ? g.home : g.away;
    const parts = [...(m.explain.baseline ? [{ label: "Baseline (home field and league average)", pts: m.explain.baseline }] : []), ...m.explain.parts];
    const rows = parts.filter((p) => Math.abs(p.pts) >= 0.05).map((p) => {
      const forMe = home ? p.pts : -p.pts; // parts are home-margin points
      const w = Math.min(50, Math.abs(forMe) * 8);
      return `<div class="adv"><span class="sp">${esc(p.label)}</span><span class="bar"><i class="${forMe >= 0 ? "pos" : "neg"}" style="width:${w}%"></i></span><b>${signed(forMe)}</b></div>`;
    }).join("");
    const R = feed?.ratings, k = feed?.teamKey;
    const ra = R?.get(k(g.away)), rh = R?.get(k(g.home));
    const rr = (r) => (r ? `Elo ${r.elo} (#${r.elo_rank}) · off EPA ${signed(r.off_epa, 3)} (#${r.off_epa_rank}) · def EPA ${signed(r.def_epa, 3)} (#${r.def_epa_rank})` : "");
    return section("adv", "Why the model sees it this way", `<div class="card pad">
      <p class="muted small" style="margin:0 0 8px">Points each factor adds for ${esc(meT.abbr)} (negative = helps the opponent). They add up to the model's margin.</p>${rows}
      ${m.qbs?.some(Boolean) ? `<div class="note" style="margin:12px -14px 0">QBs the model uses: <b>${esc(m.qbs[0] || "?")}</b> (${esc(g.away.abbr)}) vs <b>${esc(m.qbs[1] || "?")}</b> (${esc(g.home.abbr)})</div>` : ""}
      ${ra && rh ? `<div class="note" style="margin:0 -14px -14px">${esc(g.away.abbr)}: ${rr(ra)}<br>${esc(g.home.abbr)}: ${rr(rh)}<br><span class="small">Defense EPA is allowed per play, so lower is better.</span></div>` : ""}
    </div>`, "NFL Model breakdown");
  }
  const A = m.stats?.away || {}, H = m.stats?.home || {};
  const keys = Object.keys({ ...A, ...H }).filter((k) => typeof (A[k] ?? H[k]) === "number" || /^#?\d/.test(String(A[k] ?? H[k])));
  if (!keys.length) return "";
  const rows = keys.map((k) => {
    const a = n(String(A[k]).replace("#", "")), h = n(String(H[k]).replace("#", ""));
    let better = null;
    if (a != null && h != null && a !== h) {
      if (HIGHER.test(k) && !LOWER.test(k)) better = a > h ? "away" : "home";
      else if (LOWER.test(k)) better = a < h ? "away" : "home";
    }
    return `<tr><td class="${better === "away" ? "adv-w" : ""}">${esc(A[k] ?? "–")}</td><td class="lbl">${esc(k)}</td><td class="${better === "home" ? "adv-w" : ""}">${esc(H[k] ?? "–")}</td></tr>`;
  }).join("");
  return section("adv", "Matchup by the model's numbers", `<div class="card tscroll"><table class="tbl adv-t"><thead><tr><th>${logo(g.away)} ${esc(g.away.abbr)}</th><th></th><th>${esc(g.home.abbr)} ${logo(g.home)}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small" style="margin:8px 2px 0">Inputs from ${esc(m.source)}'s file. Green marks the better side where the direction is clear.</p>`);
}

// ---------------------------------------------------------------- recent performance
function recent(sport, id, past) {
  if (!past.length) return "";
  const res = (g) => { const me = g.home.id === String(id) ? g.home : g.away, op = me === g.home ? g.away : g.home; return { me, op, w: me.score > op.score, m: me.score - op.score }; };
  const span = (k) => { const s = past.slice(0, k).map(res); const w = s.filter((x) => x.w).length; return { rec: `${w}-${s.length - w}`, avg: s.reduce((a, x) => a + x.m, 0) / s.length, n: s.length }; };
  const l5 = span(5), l10 = span(10), all = span(past.length);
  const pills = past.slice(0, 10).reverse().map((g) => { const r = res(g); return `<a class="fpill ${r.w ? "w" : "l"}" href="#/game/${sport}/${g.id}"><b>${r.w ? "W" : "L"}</b><span>${r.me === g.home ? "" : "@"}${esc(r.op.abbr)}</span><span>${r.me.score}-${r.op.score}</span></a>`; }).join("");
  return section("recent", "Recent form", `<div class="card pad"><div class="fpills" style="margin-bottom:12px">${pills}</div>
    <div class="stats-grid">
      <div class="stat-box"><div class="n">${l5.rec}</div><div class="l">Last ${l5.n}</div><div class="r">avg margin ${signed(l5.avg)}</div></div>
      ${l10.n > 5 ? `<div class="stat-box"><div class="n">${l10.rec}</div><div class="l">Last ${l10.n}</div><div class="r">avg margin ${signed(l10.avg)}</div></div>` : ""}
      <div class="stat-box"><div class="n">${signed(all.avg)}</div><div class="l">Season avg margin</div><div class="r">${all.n} games</div></div>
    </div></div>`, "Actual · ESPN");
}

// ---------------------------------------------------------------- team stats + league ranks
// scoring comes from the standings ranks above (ESPN's team-stats points can disagree with its own results)
const BB_STATS = [["offensive", "fieldGoalPct", "FG%"], ["offensive", "threePointPct", "3P%"], ["offensive", "freeThrowPct", "FT%"],
  ["general", "avgRebounds", "Rebounds"], ["offensive", "avgOffensiveRebounds", "Off. rebounds"], ["offensive", "avgAssists", "Assists"], ["offensive", "avgTurnovers", "Turnovers"],
  ["defensive", "avgSteals", "Steals"], ["defensive", "avgBlocks", "Blocks"], ["general", "assistTurnoverRatio", "AST/TO"]];
const FB_STATS = [["passing", "yardsPerGame", "Yards / game"], ["passing", "netPassingYardsPerGame", "Pass yards / game"],
  ["rushing", "rushingYardsPerGame", "Rush yards / game"], ["passing", "yardsPerPassAttempt", "Yards / pass"], ["rushing", "yardsPerRushAttempt", "Yards / rush"],
  ["passing", "completionPct", "Completion %"], ["miscellaneous", "thirdDownConvPct", "3rd down %"], ["miscellaneous", "redzoneTouchdownPct", "Red zone TD %"],
  ["passing", "sacks", "Sacks taken"], ["miscellaneous", "totalGiveaways", "Giveaways"], ["miscellaneous", "totalTakeaways", "Takeaways"], ["miscellaneous", "turnOverDifferential", "Turnover margin"],
  ["miscellaneous", "totalPenaltyYards", "Penalty yards"]];

function teamStatsSection(sport, statR, me, tbl, played) {
  const enough = me && tbl && me.gp > 0 && tbl.n >= 8;
  const ranks = enough ? `<div class="stats-grid" style="margin-bottom:12px">
      ${rk("Scoring offense", me.pf, me.pfRank, tbl.n, "pts/game")}${rk("Scoring defense", me.pa, me.paRank, tbl.n, "allowed/game")}${rk("Point differential", me.diff, me.diffRank, tbl.n, "per game", true)}
    </div>` : me && tbl ? `<p class="muted small" style="margin:0 2px 10px">League ranks start once most teams have played (${tbl.n} of ${tbl.rows.length} have so far).</p>` : "";
  if (statR.status !== "fulfilled") return section("tstats", "Team stats", ranks + errBox("team stats", statR.reason));
  const d = statR.value, r = d.results || {};
  const get = (cats, c, k) => cats?.find((x) => x.name === c)?.stats?.find((s) => s.name === k);
  const list = SPORTS[sport].kind === "basketball" ? BB_STATS : FB_STATS;
  const opp = Array.isArray(r.opponent) ? r.opponent : null;
  const rows = list.map(([c, k, l]) => {
    const s = get(r.stats?.categories, c, k);
    if (!s) return "";
    const o = opp ? get(opp, c, k) : null;
    return `<tr><td class="pcol">${esc(l)}</td><td><b>${esc(s.displayValue)}</b></td>${opp ? `<td>${esc(o?.displayValue ?? "–")}</td>` : ""}</tr>`;
  }).join("");
  const season = d.season?.displayName || "";
  // ESPN can lag a season (college basketball in November): its games-played count gives it away
  const gpEspn = n(get(r.stats?.categories, "general", "gamesPlayed")?.value);
  const stale = (tbl?.season && season && tbl.season !== season) || (gpEspn != null && gpEspn > played + 1);
  return section("tstats", "Team stats", ranks + (rows ? `<div class="card tscroll"><table class="tbl box"><thead><tr><th class="pcol">${esc(season)}</th><th>Team</th>${opp ? "<th>Opponents</th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>` : empty("ESPN has no team stats yet this season.")) +
    (stale ? `<p class="muted small" style="margin:8px 2px 0">These ESPN numbers cover ${gpEspn ?? "more"} games, but this team has played ${played} this season, so ESPN is still showing last season's team stats.</p>` : ""),
    `Actual · ESPN${enough ? ` · ranks of ${tbl.n} teams` : ""}`);
}
function rk(label, v, r, nn, unit, signedV) {
  if (v == null) return "";
  return `<div class="stat-box"><div class="n">${signedV ? signed(v) : v.toFixed(1)}</div><div class="l">${esc(label)}</div><div class="r">${r ? `<b style="color:var(--text)">${ord(r)}</b> of ${nn} · ` : ""}${esc(unit)}</div></div>`;
}

// ---------------------------------------------------------------- model ratings
function modelRatings(sport, t, feed) {
  if (!feed) return "";
  if (sport === "nfl") {
    const r = feed.ratings?.get(feed.teamKey({ abbr: t.abbr }));
    if (!r) return "";
    return section("mr", "Model ratings", `<div class="stats-grid">
      <div class="stat-box"><div class="n" style="color:var(--model)">${r.elo}</div><div class="l">Elo</div><div class="r">${ord(r.elo_rank)} of ${feed.ratings.size}${r.rank_change ? ` · ${r.rank_change > 0 ? "▲" : "▼"}${Math.abs(r.rank_change)} this week` : ""}</div></div>
      <div class="stat-box"><div class="n" style="color:var(--model)">${signed(r.off_epa, 3)}</div><div class="l">Offense EPA / play</div><div class="r">${ord(r.off_epa_rank)} of ${feed.ratings.size}</div></div>
      <div class="stat-box"><div class="n" style="color:var(--model)">${signed(r.def_epa, 3)}</div><div class="l">Defense EPA / play allowed</div><div class="r">${ord(r.def_epa_rank)} of ${feed.ratings.size} · lower is better</div></div>
    </div>`, `${modelBadge("NFL Model")} NFL Model · ${ago(feed.updated)}`);
  }
  const ts = feed.teamStats?.get(t.abbr);
  if (!ts) return "";
  // rank NBA team rating among the teams in the file (the others carry their own rank fields)
  let extra = "";
  if (sport === "nba") {
    const all = [...feed.teamStats.values()].map((x) => n(x.stats["Team rating (pts vs avg)"])).filter((x) => x != null).sort((a, b) => b - a);
    const mine = n(ts.stats["Team rating (pts vs avg)"]);
    if (mine != null) extra = ` · rating ranks ${ord(all.indexOf(mine) + 1)} of ${all.length} teams in the file`;
  }
  const entries = Object.entries(ts.stats).filter(([k]) => !/^Days rest$/i.test(k));
  return section("mr", "Model ratings", `<div class="stats-grid">${entries.map(([k, v]) => `<div class="stat-box"><div class="n" style="color:var(--model);font-size:20px">${esc(v)}</div><div class="l">${esc(k)}</div></div>`).join("")}</div>
    <p class="muted small" style="margin:8px 2px 0">From ${esc(SPORTS[sport].modelName)}'s file, for its ${esc(fmtDay(new Date(ts.date + "T12:00")))} game${extra}.</p>`, `${modelBadge(SPORTS[sport].modelName)} ${ago(feed.updated)}`);
}

// ---------------------------------------------------------------- standings snippet
function standingsSnippet(sport, me, tbl) {
  if (!me || !tbl) return "";
  const grp = tbl.rows.filter((r) => r.group === me.group);
  const wp = (rec) => { const [w = 0, l = 0] = String(rec || "").split("-").map(Number); return w + l ? w / (w + l) : -1; };
  const college = sport === "ncaab" || sport === "cfb";
  grp.sort((a, b) => (college ? wp(b.rec.conf) - wp(a.rec.conf) : 0) || wp(b.rec.total) - wp(a.rec.total));
  return section("stand", esc(me.group), `<div class="card tscroll"><table class="tbl"><thead><tr><th>Team</th><th>${college ? "Conf" : "W-L"}</th><th>${college ? "Overall" : "GB"}</th><th>Diff</th><th>Strk</th></tr></thead><tbody>
    ${grp.map((r) => `<tr class="${r.id === me.id ? "fav" : ""}"><td><a class="tm" href="#/team/${sport}/${r.id}"><img src="${esc(r.logo || "")}" alt="" loading="lazy">${esc(r.abbr)}</a></td>
      <td>${esc(college ? r.rec.conf || "–" : r.rec.total || "–")}</td><td>${esc(college ? r.rec.total || "–" : r.rec.gb || "–")}</td><td>${r.diff == null ? "–" : signed(r.diff)}</td><td>${esc(r.rec.streak || "–")}</td></tr>`).join("")}
  </tbody></table></div><p style="margin:8px 2px 0"><a class="sec-more" href="#/stats">Full standings</a></p>`, "ESPN");
}

// ---------------------------------------------------------------- schedule
function scheduleSection(sport, id, past, upcoming) {
  const row = (g) => {
    const me = g.home.id === String(id) ? g.home : g.away, op = me === g.home ? g.away : g.home;
    const done = g.state === "post";
    const w = done && me.score != null ? (me.score > op.score ? "W" : me.score < op.score ? "L" : "T") : "";
    const mm = !done && g.model?.spread_home != null ? (me === g.home ? -g.model.spread_home : g.model.spread_home) : null;
    return `<a class="li" href="#/game/${sport}/${g.id}">${done ? `<span class="badge" style="width:26px;justify-content:center;background:${w === "W" ? "rgba(51,209,122,.15)" : "rgba(255,90,106,.15)"};color:${w === "W" ? "var(--win)" : "var(--loss)"}">${w}</span>` : ""}
      ${logo(op)}<div class="sp"><div class="t ellip">${me === g.home ? "vs" : "@"} ${esc(op.short)}</div><div class="s">${fmtDay(g.start)}${done ? "" : ` · ${fmtTime(g.start)}${g.tv.length ? " · " + esc(g.tv[0]) : ""}`}</div></div>
      ${done ? `<b>${me.score ?? ""}-${op.score ?? ""}</b>` : mm != null ? `<span class="badge b-model">${mm >= 0 ? "by" : "dog"} ${fmt1(Math.abs(mm))}</span>` : ""}</a>`;
  };
  const up = ui.next ? upcoming.slice(1) : upcoming.slice(1, 6);
  const pa = ui.past ? past : past.slice(0, 5);
  return section("upcoming", "Upcoming", upcoming.length > 1 ? `<div class="card list">${up.map(row).join("")}</div>${upcoming.length > 6 ? `<div style="text-align:center;margin-top:10px"><button class="btn" data-tm="next">${ui.next ? "Show less" : `Full schedule (${upcoming.length - 1})`}</button></div>` : ""}` : empty("Nothing else scheduled yet."),
    upcoming.some((g) => g.model) ? `${modelBadge("model")} margin where the file has one` : "") +
    section("results", "Results", past.length ? `<div class="card list">${pa.map(row).join("")}</div>${past.length > 5 ? `<div style="text-align:center;margin-top:10px"><button class="btn" data-tm="past">${ui.past ? "Show less" : `All ${past.length} results`}</button></div>` : ""}` : empty("No games played yet."), "Actual · ESPN");
}

// ---------------------------------------------------------------- roster
function rosterSection(sport, rosR) {
  if (rosR.status !== "fulfilled") return section("roster", "Roster", errBox("roster", rosR.reason));
  const A = rosR.value.athletes || [];
  const groups = A.length && A[0].items ? A.map((g) => ({ name: g.position, items: g.items })) : [{ name: null, items: A }];
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  if (!total) return section("roster", "Roster", empty("ESPN has no roster for this team."));
  const label = { offense: "Offense", defense: "Defense", specialTeam: "Special teams" };
  let shown = 0;
  const limit = ui.roster ? Infinity : 15;
  const body = groups.map((g) => {
    const items = g.items.slice().sort((a, b) => (n(a.jersey) ?? 999) - (n(b.jersey) ?? 999)).filter(() => shown++ < limit);
    if (!items.length) return "";
    return `${g.name ? `<div class="group-h">${esc(label[g.name] || g.name)}</div>` : ""}${items.map((p) => {
      const inj = p.injuries?.[0];
      return `<a class="li" href="#/player/${sport}/${p.id}">${headshot(p.headshot?.href)}<div class="sp"><div class="t ellip">${esc(p.displayName)}</div>
        <div class="s">${p.jersey ? `#${esc(p.jersey)} · ` : ""}${esc(p.position?.abbreviation || "")}${p.displayHeight ? ` · ${esc(p.displayHeight)}` : ""}${p.age ? ` · ${p.age}` : p.experience?.abbreviation ? ` · ${esc(p.experience.abbreviation)}` : ""}</div></div>
        ${inj ? `<span class="badge b-live">${esc(inj.status || "Injured")}</span>` : ""}</a>`;
    }).join("")}`;
  }).join("");
  return section("roster", "Roster", `<div class="card list" style="overflow:hidden">${body}</div>${total > 15 ? `<div style="text-align:center;margin-top:10px"><button class="btn" data-tm="roster">${ui.roster ? "Show less" : `Full roster (${total})`}</button></div>` : ""}`, `${total} players · ESPN`);
}
