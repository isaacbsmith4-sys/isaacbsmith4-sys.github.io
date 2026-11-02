// GAME DAY app: router, views, refresh loop.
import {
  state, save, SECTIONS, isFavTeam, isFavPlayer, toggleTeam, togglePlayer, move, favTeamIds, favPlayerTeamIds,
  sourceLog, esc, today, addDays, isoDay, fmtTime, fmtDay, dayLabel, ago, resetAll, forget,
} from "./core.js?v=2";
import {
  SPORTS, SPORT_KEYS, slate, boardDay, news, teams, team as getTeam, searchPlayers, athlete, schedule, standings,
  modelFeed, spreadText, fmt1, pct,
} from "./data.js?v=2";
import {
  ICON, sportBadge, modelBadge, marketBadge, logo, headshot, starBtn, gameCard, section, empty, errBox, skel,
  updated, newsItem, statusText, shortBook,
} from "./ui.js?v=2";

const $ = (s, r = document) => r.querySelector(s);
const view = $("#view");
const overlay = $("#overlay");
const ui = { expand: new Set(), scoresDay: 0, teamsSport: null, teamsQ: "", statsSport: null, statsConf: "" };
const gameIndex = new Map(); // "sport:id" -> game, for opening the game sheet

// ---------------------------------------------------------------- helpers
const enabled = () => SPORT_KEYS.filter((k) => state.sports[k]);
const active = () => (state.filter !== "all" && state.sports[state.filter] ? [state.filter] : enabled());
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 1800);
}
const favGame = (g) => {
  const ft = favTeamIds(g.sport), fp = favPlayerTeamIds(g.sport);
  return ft.has(g.home.id) || ft.has(g.away.id) || fp.has(g.home.id) || fp.has(g.away.id);
};
function favReason(g) {
  const names = [];
  for (const t of [g.away, g.home]) if (isFavTeam(g.sport, t.id)) names.push(t.short);
  for (const p of state.players) if (p.sport === g.sport && (p.teamId === g.home.id || p.teamId === g.away.id)) names.push(p.name);
  return names.length ? `★ ${names.join(", ")}` : "";
}
function more(key, items, n, render) {
  const open = ui.expand.has(key);
  const shown = open ? items : items.slice(0, n);
  return `<div class="grid cols">${shown.map(render).join("")}</div>${items.length > n
    ? `<div style="text-align:center;margin-top:10px"><button class="btn" data-action="expand" data-key="${key}">${open ? "Show less" : `Show all ${items.length}`}</button></div>` : ""}`;
}

async function loadSlates(sports) {
  const res = await Promise.allSettled(sports.map((s) => slate(s)));
  const games = [], errors = [];
  res.forEach((r, i) => (r.status === "fulfilled" ? games.push(...r.value) : errors.push([sports[i], r.reason])));
  for (const g of games) gameIndex.set(`${g.sport}:${g.id}`, g);
  return { games, errors };
}
function setLive(games) {
  const n = games.filter((g) => g.state === "in").length;
  const p = $("#livePill");
  p.hidden = !n;
  p.querySelector("span").textContent = `${n} live`;
}

// ---------------------------------------------------------------- sport chips
function renderChips() {
  const tab = route().name;
  const box = $("#sportChips");
  if (!["home", "scores"].includes(tab)) { box.hidden = true; return; }
  box.hidden = false;
  const opts = [["all", "All"], ...enabled().map((k) => [k, SPORTS[k].label])];
  box.innerHTML = opts.map(([k, l]) =>
    `<button class="chip" data-action="filter" data-sport="${k}" aria-pressed="${state.filter === k || (k === "all" && !active().length)}">
      ${k !== "all" ? `<span class="sw" style="background:var(--${k})"></span>` : ""}${l}</button>`).join("");
}

// ================================================================= HOME
async function viewHome() {
  const sports = active();
  if (!view.innerHTML.trim() || view.dataset.v !== "home") view.innerHTML = skel(4);
  view.dataset.v = "home";
  if (!sports.length) { view.innerHTML = empty("All sports are turned off. Turn one on in <b>Profile → Sports</b>."); return; }

  const [{ games, errors }, newsRes, feeds] = await Promise.all([
    loadSlates(sports),
    Promise.allSettled(sports.map((s) => news(s, 8))),
    Promise.allSettled(sports.map((s) => modelFeed(s))),
  ]);
  setLive(games);
  const tKey = isoDay(today()), yKey = isoDay(addDays(today(), -1));
  const now = Date.now();
  const upcoming = games.filter((g) => g.state !== "post");
  const todays = games.filter((g) => g.day === tKey);
  const order = (a, b) => (a.state === "in") - (b.state === "in") || 0;

  const S = {};
  // My Sports: each followed team's next or current game, plus yesterday's results
  if (state.teams.length || state.players.length) {
    const mine = games.filter(favGame).filter((g) => g.day >= yKey);
    const live = mine.filter((g) => g.state === "in");
    const next = mine.filter((g) => g.state === "pre").slice(0, 8);
    const done = mine.filter((g) => g.state === "post" && g.day >= yKey).reverse().slice(0, 4);
    const list = [...live, ...next, ...done];
    S.my = section("my", '<span style="color:var(--fav)">★</span> My Sports',
      list.length ? `<div class="grid cols">${list.map((g) => gameCard(g, { reason: favReason(g) })).join("")}</div>`
        : empty(`None of the teams or players you follow play between yesterday and the next few days.`),
      `<a class="sec-more" href="#/profile">Manage</a>`);
  } else {
    S.my = section("my", '<span style="color:var(--fav)">★</span> My Sports',
      empty(`Follow teams and players to see them here first.<br><br><button class="btn primary" data-action="search">Find teams and players</button>`));
  }

  const live = games.filter((g) => g.state === "in").sort((a, b) => favGame(b) - favGame(a));
  S.live = live.length ? section("live", '<span class="dot-live"></span> Live now', more("live", live, 6, (g) => gameCard(g)), `${live.length} games`) : "";

  // Biggest games: transparent scoring, the reason is shown on the card
  const scored = todays.filter((g) => g.state !== "post").map((g) => {
    let s = 0; const why = [];
    if (favGame(g)) { s += 100; why.push("You follow"); }
    const r = [g.away.rank, g.home.rank].filter(Boolean);
    if (r.length === 2) { s += 40 - Math.min(...r); why.push(`Top-25 matchup`); }
    else if (r.length === 1) { s += 15 - r[0] / 3; why.push(`#${r[0]} ranked`); }
    if (g.national.length) { s += 12; why.push(g.national[0]); }
    const hp = g.model?.home_win_prob;
    if (hp != null && Math.abs(hp - 0.5) < 0.07) { s += 10; why.push(`Model toss-up`); }
    const wp = (rec) => { const m = /^(\d+)-(\d+)/.exec(rec || ""); return m && +m[1] + +m[2] >= 3 ? +m[1] / (+m[1] + +m[2]) : 0; };
    if (wp(g.home.record) >= 0.6 && wp(g.away.record) >= 0.6) { s += 8; why.push("Two winning teams"); }
    if (g.note) { s += 5; why.push(g.note); }
    return { g, s, why };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 4);
  S.featured = scored.length ? section("featured", "Biggest games",
    `<div class="grid cols">${scored.map((x) => gameCard(x.g, { reason: x.why.slice(0, 2).join(" · ") })).join("")}</div>`) : "";

  // Model predictions vs market, biggest gaps first. Data only, no picks here.
  const withModel = upcoming.filter((g) => g.model && g.start - now < 8 * 864e5);
  const rows = withModel.map((g) => {
    const m = g.model, mk = m.market;
    const d = mk?.spread_home != null && m.spread_home != null ? m.spread_home - mk.spread_home : null;
    return { g, m, mk, d };
  }).sort((a, b) => (b.d == null ? -1 : Math.abs(b.d)) - (a.d == null ? -1 : Math.abs(a.d)))
    // with several sports on, keep it balanced: up to 3 per sport (8 for one sport)
    .filter((r, i, all) => sports.length === 1 || all.slice(0, i).filter((x) => x.g.sport === r.g.sport).length < 3).slice(0, 8);
  const feedMeta = feeds.map((f, i) => f.status === "fulfilled" ? `${SPORTS[sports[i]].label} ${ago(f.value.updated)}` : `${SPORTS[sports[i]].label} unavailable`).join(" · ");
  S.models = section("models", "Model predictions", rows.length ? `<div class="card list">${rows.map(({ g, m, mk, d }) => `
      <a class="mrow" href="#" data-action="game" data-sport="${g.sport}" data-id="${g.id}">
        <div><div class="who">${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</div><div class="when">${sportBadge(g.sport)} ${esc(statusText(g))}</div></div>
        <div class="v m"><small>${esc(m.source)}</small>${spreadText(m.spread_home, g)}</div>
        <div class="v k"><small>${esc(shortBook(mk?.book))}</small>${mk?.spread_home != null ? spreadText(mk.spread_home, g) : "–"}</div>
        ${d != null && Math.abs(d) >= 0.5 ? `<div class="diff">Model is <b>${fmt1(Math.abs(d))} pts</b> more on ${esc(d < 0 ? g.home.abbr : g.away.abbr)} than the line${m.home_win_prob != null ? ` · ${esc(m.home_win_prob >= .5 ? g.home.abbr : g.away.abbr)} win ${pct(Math.max(m.home_win_prob, 1 - m.home_win_prob))}` : ""}</div>` : ""}
      </a>`).join("")}</div>` : empty("No upcoming games with a model line right now."),
    esc(feedMeta));

  const todayList = todays.slice().sort((a, b) => favGame(b) - favGame(a) || (b.state === "in") - (a.state === "in") || a.start - b.start);
  const nextDay = !todayList.length ? upcoming.filter((g) => g.day > tKey) : [];
  S.today = section("today", todayList.length ? "Today's games" : "Up next",
    todayList.length ? more("today", todayList, 6, (g) => gameCard(g))
      : nextDay.length ? more("today", nextDay, 6, (g) => gameCard(g)) : empty("No games scheduled today."),
    todayList.length ? `${todayList.length} games` : "");

  // Top performances: game leaders from live/final games, today and yesterday (actual stats)
  const perf = [];
  for (const g of games.filter((g) => g.state !== "pre" && g.day >= yKey)) {
    for (const side of ["away", "home"]) {
      const t = g[side], opp = g[side === "home" ? "away" : "home"];
      for (const l of t.leaders) {
        let score = null;
        if (SPORTS[g.sport].kind === "basketball" && l.cat === "points") score = l.value;
        if (SPORTS[g.sport].kind === "football") {
          if (l.cat === "passingYards") score = l.value / 9;
          if (l.cat === "rushingYards" || l.cat === "receivingYards") score = l.value / 3.5;
        }
        if (score == null) continue;
        const fav = isFavPlayer(g.sport, l.athlete.id);
        perf.push({ g, t, opp, l, score: score + (fav ? 1000 : 0), fav });
      }
    }
  }
  perf.sort((a, b) => b.score - a.score);
  S.performers = perf.length ? section("performers", "Top performances", `<div class="card list">${perf.slice(0, 8).map(({ g, t, opp, l, fav }) => `
    <a class="perf" href="#/player/${g.sport}/${l.athlete.id}">${headshot(l.athlete.headshot)}
      <div class="sp"><div class="t ellip">${esc(l.athlete.name)} ${fav ? '<span class="badge b-fav">★</span>' : ""}</div>
      <div class="s ellip muted small">${sportBadge(g.sport)} ${esc(t.abbr)} ${g.home === t ? "vs" : "@"} ${esc(opp.abbr)} · ${g.state === "in" ? '<span style="color:var(--live)">Live</span>' : dayLabel(g.start)}</div></div>
      <div class="stat">${esc(l.text)}<small>${esc(l.label)}</small></div></a>`).join("")}</div>`, "Actual stats · ESPN") : "";

  const finals = games.filter((g) => g.day === yKey && g.state === "post").sort((a, b) => favGame(b) - favGame(a));
  S.finals = section("finals", "Yesterday's finals", finals.length ? more("finals", finals, 6, (g) => gameCard(g, { showModel: false })) : empty("No finals yesterday."));

  const arts = newsRes.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const favArt = (a) => a.teamIds.some((id) => isFavTeam(a.sport, id)) || a.athleteIds.some((id) => isFavPlayer(a.sport, id));
  arts.sort((a, b) => favArt(b) - favArt(a) || new Date(b.published) - new Date(a.published));
  S.news = section("news", "Latest news", arts.length ? `<div class="card list">${arts.slice(0, 10).map(newsItem).join("")}</div>` : empty("No news loaded."), "ESPN");

  const errs = errors.map(([s, e]) => errBox(`${SPORTS[s].label} scores`, e)).join("");
  view.innerHTML = `${errs}${state.sections.filter((x) => x.on).map((x) => S[x.key] || "").join("")}
    <p class="muted small" style="text-align:center;margin-top:24px">Scores and stats: ESPN · Predictions: your models' published files · Refreshes automatically</p>`;
  return games;
}

// ================================================================= SCORES
async function viewScores() {
  const d = addDays(today(), ui.scoresDay);
  const sports = active();
  const days = [-3, -2, -1, 0, 1, 2, 3].map((n) => ui.scoresDay + n);
  const head = `<h1 class="page-title">Scores</h1>
    <div class="seg" style="margin-bottom:14px">${days.map((n) => `<button data-action="day" data-n="${n}" aria-pressed="${n === ui.scoresDay}">${n === 0 ? "Today" : fmtDay(addDays(today(), n)).replace(/^\w+, /, "")}</button>`).join("")}</div>`;
  if (view.dataset.v !== "scores") view.innerHTML = head + skel(4);
  view.dataset.v = "scores";
  const res = await Promise.allSettled(sports.map((s) => boardDay(s, d)));
  await Promise.all(sports.map(async (s, i) => {
    if (res[i].status !== "fulfilled") return;
    try { const f = await modelFeed(s); for (const g of res[i].value) g.model = f.lookup(g) || null; } catch {}
  }));
  let all = [];
  const body = sports.map((s, i) => {
    if (res[i].status === "rejected") return section(s, SPORTS[s].name, errBox(`${SPORTS[s].label} scores`, res[i].reason));
    const gs = res[i].value.sort((a, b) => favGame(b) - favGame(a) || (b.state === "in") - (a.state === "in") || a.start - b.start);
    all = all.concat(gs);
    if (!gs.length) return sports.length === 1 ? section(s, SPORTS[s].name, empty(`No ${SPORTS[s].label} games on ${fmtDay(d)}.`)) : "";
    for (const g of gs) gameIndex.set(`${g.sport}:${g.id}`, g);
    return section(s, `${sportBadge(s)} ${SPORTS[s].name}`, more(`sc-${s}`, gs, 12, (g) => gameCard(g)), `${gs.length} games`);
  }).join("");
  if (ui.scoresDay === 0) setLive(all);
  view.innerHTML = head + (body || empty(`No games on ${fmtDay(d)} for the sports you picked.`)) +
    `<p class="muted small" style="text-align:center;margin-top:20px">${dayLabel(d)} · ESPN scoreboard · tap a game for details</p>`;
  return all;
}

// ================================================================= TEAMS
async function viewTeams() {
  const sports = enabled();
  ui.teamsSport = sports.includes(ui.teamsSport) ? ui.teamsSport : sports[0];
  const s = ui.teamsSport;
  if (!s) { view.innerHTML = empty("All sports are off. Turn one on in Profile."); return; }
  view.dataset.v = "teams";
  const d = await teams();
  view.innerHTML = `<h1 class="page-title">Teams</h1>
    <div class="seg" style="margin-bottom:10px">${sports.map((k) => `<button data-action="tsport" data-sport="${k}" aria-pressed="${k === s}">${SPORTS[k].label}</button>`).join("")}</div>
    <input class="input" id="teamQ" placeholder="Filter ${esc(SPORTS[s].name)} teams" value="${esc(ui.teamsQ)}" autocomplete="off" style="margin-bottom:12px">
    <div id="teamList"></div><p class="muted small" style="text-align:center">Team list: ESPN (saved ${ago(d.generated_at)})</p>`;
  const draw = () => {
    const q = ui.teamsQ.trim().toLowerCase();
    const list = d.sports[s].filter((t) => !q || [t.name, t.abbr, t.nick, t.conf].some((x) => (x || "").toLowerCase().includes(q)));
    const fav = list.filter((t) => isFavTeam(s, t.id));
    const groups = new Map();
    for (const t of list) {
      const g = s === "nfl" || s === "nba" ? t.div ? `${t.div}` : t.conf : t.conf || "Other";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(t);
    }
    const row = (t) => `<div class="li"><a class="row sp" href="#/team/${s}/${t.id}">${logo(t)}<div class="sp"><div class="t ellip">${esc(t.name)}</div><div class="s ellip">${esc(t.div || t.conf || "")}</div></div></a>
      ${starBtn(isFavTeam(s, t.id), "favteam", `data-sport="${s}" data-id="${t.id}"`, t.name)}</div>`;
    $("#teamList").innerHTML = (fav.length ? `<div class="card list" style="margin-bottom:12px;overflow:hidden"><div class="group-h" style="position:static;color:var(--fav)">★ Following</div>${fav.map(row).join("")}</div>` : "") +
      (list.length ? `<div class="card list" style="overflow:hidden">${[...groups].sort((a, b) => a[0].localeCompare(b[0])).map(([g, ts]) => `<div class="group-h">${esc(g)}</div>${ts.map(row).join("")}`).join("")}</div>` : empty("No teams match."));
  };
  draw();
  $("#teamQ").addEventListener("input", (e) => { ui.teamsQ = e.target.value; draw(); });
}

// ================================================================= TEAM PAGE
async function viewTeam(sport, id) {
  view.dataset.v = "team";
  const t = await getTeam(sport, id);
  if (!t) { view.innerHTML = empty("Team not found."); return; }
  const hero = (extra = "") => `<a class="back" href="#/teams" data-action="back">${ICON.back} Back</a>
    <div class="hero" style="--tc:${esc(t.color)}"><div class="row" style="gap:14px">${logo(t, "logo logo-lg")}
      <div class="sp"><div class="row" style="gap:6px;margin-bottom:6px">${sportBadge(sport)}</div><h1>${esc(t.name)}</h1>
      <div class="sub">${esc([t.div, t.conf].filter(Boolean).join(" · "))}</div>${extra}</div></div>
      <div style="margin-top:14px"><button class="btn ${isFavTeam(sport, t.id) ? "on" : ""}" data-action="favteam" data-sport="${sport}" data-id="${t.id}">${ICON.star} ${isFavTeam(sport, t.id) ? "Following" : "Follow"}</button></div></div>`;
  view.innerHTML = hero() + skel(2);
  let sch;
  try { sch = await schedule(sport, id); } catch (e) { view.innerHTML = hero() + errBox("schedule", e); return; }
  const rec = sch.team?.recordSummary, stand = sch.team?.standingSummary;
  const past = sch.games.filter((g) => g.state === "post").reverse();
  const next = sch.games.filter((g) => g.state !== "post");
  for (const g of sch.games) gameIndex.set(`${g.sport}:${g.id}`, g);
  const ng = next[0];
  const resRow = (g) => {
    const me = g.home.id === String(id) ? g.home : g.away, op = me === g.home ? g.away : g.home;
    const w = me.score != null && op.score != null ? (me.score > op.score ? "W" : me.score < op.score ? "L" : "T") : "";
    return `<a class="li" href="#" data-action="game" data-sport="${sport}" data-id="${g.id}">
      <span class="badge" style="width:26px;justify-content:center;background:${w === "W" ? "rgba(51,209,122,.15)" : "rgba(255,90,106,.15)"};color:${w === "W" ? "var(--win)" : "var(--loss)"}">${w}</span>
      ${logo(op)}<div class="sp"><div class="t ellip">${me === g.home ? "vs" : "@"} ${esc(op.short)}</div><div class="s">${fmtDay(g.start)}</div></div>
      <b>${me.score ?? ""}-${op.score ?? ""}</b></a>`;
  };
  const upRow = (g) => {
    const me = g.home.id === String(id) ? g.home : g.away, op = me === g.home ? g.away : g.home;
    return `<a class="li" href="#" data-action="game" data-sport="${sport}" data-id="${g.id}">${logo(op)}
      <div class="sp"><div class="t ellip">${me === g.home ? "vs" : "@"} ${esc(op.short)}</div><div class="s">${fmtDay(g.start)} · ${fmtTime(g.start)}${g.tv.length ? " · " + esc(g.tv[0]) : ""}</div></div>
      ${g.model ? `<span class="badge b-model">${spreadText(g.model.spread_home, g)}</span>` : ""}</a>`;
  };
  view.innerHTML = hero(`<div class="sub" style="margin-top:6px"><b style="color:var(--text)">${esc(rec || "")}</b>${stand ? ` · ${esc(stand)}` : ""}</div>`) +
    (ng ? section("next", "Next game", `${gameCard(ng)}${ng.model ? modelBlock(ng) : `<div class="note">No model line for this game yet. ${esc(SPORTS[sport].modelName)} publishes lines for the next few days.</div>`}`) : "") +
    section("recent", "Recent results", past.length ? `<div class="card list">${past.slice(0, 5).map(resRow).join("")}</div>` : empty("No games played yet."), "Actual · ESPN") +
    section("sched", "Upcoming", next.length > 1 ? `<div class="card list">${next.slice(1, 7).map(upRow).join("")}</div>` : empty("Nothing else scheduled yet.")) +
    `<p class="muted small" style="text-align:center;margin-top:18px">Full team stats, rankings and roster are coming next.</p>`;
}

function modelBlock(g) {
  const m = g.model, mk = m.market, hp = m.home_win_prob;
  const d = mk?.spread_home != null && m.spread_home != null ? m.spread_home - mk.spread_home : null;
  return `<div class="card" style="margin-top:10px;overflow:hidden">
    <div class="pad"><div class="row" style="margin-bottom:10px">${modelBadge(m.source)}<b>${esc(m.source)}</b><span class="sp"></span><span class="muted small">updated ${ago(m.updated)}</span></div>
    <div class="stats-grid">
      <div class="stat-box"><div class="n" style="color:var(--model)">${spreadText(m.spread_home, g)}</div><div class="l">Model spread</div></div>
      ${hp != null ? `<div class="stat-box"><div class="n" style="color:var(--model)">${pct(Math.max(hp, 1 - hp))}</div><div class="l">${esc(hp >= .5 ? g.home.abbr : g.away.abbr)} win chance</div></div>` : ""}
      ${m.total != null ? `<div class="stat-box"><div class="n" style="color:var(--model)">${fmt1(m.total)}</div><div class="l">Model total</div></div>` : ""}
      ${mk?.spread_home != null ? `<div class="stat-box"><div class="n" style="color:var(--market)">${spreadText(mk.spread_home, g)}</div><div class="l">${esc(mk.book || "Line")} spread</div>${mk.spread_open != null ? `<div class="r">open ${spreadText(mk.spread_open, g)}</div>` : ""}</div>` : ""}
      ${mk?.total != null ? `<div class="stat-box"><div class="n" style="color:var(--market)">${fmt1(mk.total)}</div><div class="l">${esc(mk.book || "Line")} total</div></div>` : ""}
    </div></div>
    ${d != null ? `<div class="note">${Math.abs(d) < 0.5 ? "Model and line agree." : `Model is <b>${fmt1(Math.abs(d))} pts</b> more on ${esc(d < 0 ? g.home.abbr : g.away.abbr)} than ${esc(mk.book || "the line")}.`}</div>` : `<div class="note">No sportsbook line in the model's file for this game.</div>`}
    ${(m.notes || []).slice(0, 3).map((n) => `<div class="note">${esc(n)}</div>`).join("")}
  </div>`;
}

// ================================================================= PLAYER PAGE
async function viewPlayer(sport, id) {
  view.dataset.v = "player";
  view.innerHTML = `<a class="back" href="#" data-action="back">${ICON.back} Back</a>` + skel(2);
  let a;
  try { a = await athlete(sport, id); } catch (e) { view.innerHTML = errBox("player", e); return; }
  const t = a.team || {};
  const tm = t.id ? await getTeam(sport, t.id) : null;
  const fav = isFavPlayer(sport, id);
  const pinfo = { sport, id, name: a.displayName, teamId: t.id, team: t.displayName, pos: a.position?.abbreviation, headshot: a.headshot?.href };
  // keep saved favorite's team current (trades, transfers)
  const saved = state.players.find((p) => p.sport === sport && p.id === String(id));
  if (saved && t.id && saved.teamId !== String(t.id)) { Object.assign(saved, { teamId: String(t.id), team: t.displayName }); save(); }
  const facts = [a.displayHeight, a.displayWeight, a.age ? `Age ${a.age}` : null, a.displayExperience, a.college?.name ? a.college.name : null].filter(Boolean);
  const stats = a.statsSummary?.statistics || [];
  let nextHtml = "";
  if (t.id) {
    try {
      const sch = await schedule(sport, t.id);
      const ng = sch.games.find((g) => g.state !== "post");
      if (ng) { gameIndex.set(`${sport}:${ng.id}`, ng); nextHtml = section("next", "Next game", gameCard(ng)); }
    } catch {}
  }
  view.innerHTML = `<a class="back" href="#" data-action="back">${ICON.back} Back</a>
    <div class="hero" style="--tc:${esc(tm?.color || "#444")}"><div class="row" style="gap:14px">${headshot(a.headshot?.href, "headshot headshot-lg")}
      <div class="sp"><div class="row" style="gap:6px;margin-bottom:6px">${sportBadge(sport)}${a.status?.type && a.status.type !== "active" ? `<span class="badge b-plain">${esc(a.status.name)}</span>` : ""}</div>
      <h1>${esc(a.displayName)}</h1>
      <div class="sub">${[a.displayJersey, a.position?.displayName].filter(Boolean).map(esc).join(" · ")}${t.id ? ` · <a href="#/team/${sport}/${t.id}" style="color:var(--text)"><b>${esc(t.displayName)}</b></a>` : ""}</div>
      <div class="sub small muted">${facts.map(esc).join(" · ")}</div></div></div>
      <div style="margin-top:14px"><button class="btn ${fav ? "on" : ""}" data-action="favplayer" data-p='${esc(JSON.stringify(pinfo))}'>${ICON.star} ${fav ? "Following" : "Follow"}</button></div></div>
    ${stats.length ? section("season", esc(a.statsSummary.displayName || "Season stats"), `<div class="stats-grid">${stats.map((s) =>
      `<div class="stat-box"><div class="n">${esc(s.displayValue)}</div><div class="l">${esc(s.shortDisplayName || s.abbreviation)}</div>${s.rankDisplayValue ? `<div class="r">${esc(s.rankDisplayValue)}</div>` : ""}</div>`).join("")}</div>`, "Actual · ESPN") : ""}
    ${nextHtml}
    <p class="muted small" style="text-align:center;margin-top:18px">Coming next: game logs, last 5/10/20 averages and your model's projections.</p>`;
}

// ================================================================= STATS (standings for now)
async function viewStats() {
  const sports = enabled();
  ui.statsSport = sports.includes(ui.statsSport) ? ui.statsSport : sports[0];
  const s = ui.statsSport;
  if (!s) { view.innerHTML = empty("All sports are off."); return; }
  view.dataset.v = "stats";
  const head = `<h1 class="page-title">Standings</h1><p class="page-sub">The Statistics Lab (efficiency, rankings, charts) is coming next.</p>
    <div class="seg" style="margin-bottom:12px">${sports.map((k) => `<button data-action="ssport" data-sport="${k}" aria-pressed="${k === s}">${SPORTS[k].label}</button>`).join("")}</div>`;
  view.innerHTML = head + skel(2);
  let d;
  try { d = await standings(s); } catch (e) { view.innerHTML = head + errBox("standings", e); return; }
  const college = s === "ncaab" || s === "cfb";
  const st = (e, type) => e.stats.find((x) => x.type === type)?.displayValue ?? "–";
  const groups = [];
  const walk = (n, parent) => {
    if (n.standings?.entries?.length) groups.push({ name: n.name, parent, entries: n.standings.entries });
    for (const c of n.children || []) walk(c, n.name);
  };
  (d.children || []).forEach((c) => walk(c, null));
  const confs = groups.map((g) => g.name);
  if (college && !confs.includes(ui.statsConf)) {
    const favConf = (await teams()).sports[s].find((t) => isFavTeam(s, t.id))?.conf;
    ui.statsConf = confs.includes(favConf) ? favConf : confs[0];
  }
  const colsAll = college
    ? [["Overall", "total"], ["Conf", "vsconf"], ["Home", "home"], ["Away", "road"], ["Strk", "streak"]]
    : [["W-L", "total"], ["PCT", "winpercent"], ["GB", "gamesbehind"], ["Home", "home"], ["Away", "road"], ["Strk", "streak"]];
  const show = college ? groups.filter((g) => g.name === ui.statsConf) : groups;
  // ESPN returns entries in no useful order: sort by win % (college: conference record first)
  const wp = (rec) => { const [w = 0, l = 0, t = 0] = String(rec).split("-").map(Number); return w + l + t ? (w + t / 2) / (w + l + t) : -1; };
  const wins = (rec) => Number(String(rec).split("-")[0]) || 0;
  for (const g of show) g.entries.sort((a, b) => (college ? wp(st(b, "vsconf")) - wp(st(a, "vsconf")) : 0)
    || wp(st(b, "total")) - wp(st(a, "total")) || wins(st(b, "total")) - wins(st(a, "total")));
  const cols = colsAll.filter(([, k]) => show.some((g) => g.entries.some((e) => st(e, k) !== "–"))); // drop empty columns
  const ft = favTeamIds(s);
  view.innerHTML = head + (college ? `<select class="input" data-action="sconf" style="margin-bottom:12px">${confs.map((c) => `<option ${c === ui.statsConf ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>` : "") +
    show.map((g) => section("st", esc(g.name), `<div class="card tscroll"><table class="tbl"><thead><tr><th>Team</th>${cols.map(([l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>
      ${g.entries.map((e) => `<tr class="${ft.has(String(e.team.id)) ? "fav" : ""}"><td><a class="tm" href="#/team/${s}/${e.team.id}"><img src="${esc(e.team.logos?.[0]?.href || "")}" alt="" loading="lazy">${esc(e.team.abbreviation || e.team.shortDisplayName)}</a></td>
      ${cols.map(([, k]) => `<td>${esc(st(e, k))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`, g.parent ? esc(g.parent) : "")).join("") +
    `<p class="muted small" style="text-align:center;margin-top:16px">Standings: ESPN · ${esc(d.seasons?.[0]?.displayName || "")}</p>`;
}

// ================================================================= PROFILE
async function viewProfile() {
  view.dataset.v = "profile";
  const favRow = (kind, x, i, list) => `<div class="li">
    ${kind === "team" ? logo(x) : headshot(x.headshot)}
    <a class="sp" href="#/${kind}/${x.sport}/${x.id}"><div class="t ellip">${esc(x.name)}</div><div class="s">${sportBadge(x.sport)} ${esc(kind === "player" ? [x.pos, x.team].filter(Boolean).join(" · ") : "")}</div></a>
    <button class="mini" data-action="mv" data-kind="${kind}" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">${ICON.up}</button>
    <button class="mini" data-action="mv" data-kind="${kind}" data-i="${i}" data-d="1" ${i === list.length - 1 ? "disabled" : ""} aria-label="Move down">${ICON.down}</button>
    <button class="mini" data-action="unfav" data-kind="${kind}" data-i="${i}" aria-label="Unfollow ${esc(x.name)}">${ICON.x}</button></div>`;
  const log = [...sourceLog].sort((a, b) => a[0].localeCompare(b[0]));
  view.innerHTML = `<h1 class="page-title">Profile</h1>
    ${section("my", '<span style="color:var(--fav)">★</span> My Sports', `
      <div class="card list" style="margin-bottom:10px"><div class="group-h" style="position:static">Teams · ${state.teams.length}</div>
        ${state.teams.length ? state.teams.map((t, i, l) => favRow("team", t, i, l)).join("") : '<div class="li muted">No teams yet.</div>'}</div>
      <div class="card list"><div class="group-h" style="position:static">Players · ${state.players.length}</div>
        ${state.players.length ? state.players.map((p, i, l) => favRow("player", p, i, l)).join("") : '<div class="li muted">No players yet.</div>'}</div>
      <div style="margin-top:10px"><button class="btn primary" data-action="search">Add teams or players</button></div>`, "Saved on this device")}
    ${section("layout", "Home screen", `<div class="card list">${state.sections.map((x, i) => {
      const s = SECTIONS.find((y) => y.key === x.key);
      return `<div class="li"><div class="sp"><div class="t">${esc(s.label)}</div><div class="s">${esc(s.hint)}</div></div>
        <button class="mini" data-action="secmv" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">${ICON.up}</button>
        <button class="mini" data-action="secmv" data-i="${i}" data-d="1" ${i === state.sections.length - 1 ? "disabled" : ""} aria-label="Move down">${ICON.down}</button>
        <button class="tog" role="switch" aria-checked="${x.on}" data-action="sectog" data-i="${i}" aria-label="Show ${esc(s.label)}"></button></div>`;
    }).join("")}</div>`)}
    ${section("sports", "Sports", `<div class="card list">${SPORT_KEYS.map((k) => `<div class="li">${sportBadge(k)}<div class="sp t">${SPORTS[k].name}</div>
      <button class="tog" role="switch" aria-checked="${!!state.sports[k]}" data-action="sporttog" data-sport="${k}" aria-label="Show ${SPORTS[k].name}"></button></div>`).join("")}</div>`)}
    ${section("legend", "How to read numbers", `<div class="card list">
      <div class="li"><span class="badge b-actual">Actual</span><div class="sp s">Real results and stats from ESPN</div></div>
      <div class="li"><span class="badge b-model">Model</span><div class="sp s">Predictions from your own models (NBA, NFL, NCAAB, CFB), shown separately and never averaged</div></div>
      <div class="li"><span class="badge b-market">DK</span><div class="sp s">Sportsbook lines (DraftKings via ESPN, or the NFL model's consensus line)</div></div></div>`)}
    ${section("sources", "Data sources", `<div class="card list">${log.length ? log.map(([k, v]) => `<div class="li"><span class="badge ${v.ok ? "b-actual" : "b-live"}">${v.ok ? "OK" : "Error"}</span>
      <div class="sp"><div class="t ellip">${esc(k)}</div><div class="s ellip">${v.ok ? `loaded ${ago(v.at)} · ${v.ms} ms` : esc(v.error)}</div></div></div>`).join("") : '<div class="li muted">Nothing loaded yet this session.</div>'}</div>`, "This session")}
    ${section("about", "About", `<div class="card pad small muted">Favorites and settings are saved on this device only. Live data comes straight from ESPN; predictions come from the files your models already publish to this site 4 times a day.
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-action="refresh">Refresh data</button><button class="btn" data-action="reset">Reset GAME DAY</button></div></div>`)}`;
}

// ================================================================= GAME SHEET (full Game Center is next)
function openGame(sport, id) {
  const g = gameIndex.get(`${sport}:${id}`);
  if (!g) return;
  const side = (t) => `<a class="side" href="#/team/${sport}/${t.id}" data-action="close-go">${logo(t, "logo logo-lg")}<div class="nm">${t.rank ? `<span class="muted">${t.rank}</span> ` : ""}${esc(t.short)}</div><div class="muted small">${esc(t.record || "")}</div></a>`;
  const leaders = g.state !== "pre" ? [g.away, g.home].flatMap((t) => t.leaders.slice(0, 3).map((l) => ({ t, l }))) : [];
  const espnUrl = `https://www.espn.com/${SPORTS[sport].league}/game/_/gameId/${g.id}`;
  const inj = g.model?.injuries;
  openSheet(`<div class="sheet-head">${sportBadge(sport)}${g.state === "in" ? '<span class="badge b-live">Live</span>' : ""}<span class="sp muted small ellip">${esc(g.note || g.venue || "")}</span><button class="mini" data-action="close" aria-label="Close">${ICON.x}</button></div>
    <div class="vs">${side(g.away)}<div>${g.state === "pre" ? `<div class="mid">${esc(dayLabel(g.start))}<br>${fmtTime(g.start)}</div>` : `<div class="big">${g.away.score ?? 0}<span class="muted" style="font-size:24px"> – </span>${g.home.score ?? 0}</div><div class="mid" style="${g.state === "in" ? "color:var(--live)" : ""}">${esc(g.detail)}</div>`}</div>${side(g.home)}</div>
    ${g.tv.length ? `<p class="muted small" style="text-align:center;margin:-4px 0 12px">${esc(g.tv.join(" · "))}</p>` : ""}
    ${g.model ? modelBlock(g) : `<div class="card pad small muted">No prediction from ${esc(SPORTS[sport].modelName)} for this game.${g.espnOdds?.details ? ` ${marketBadge(g.espnOdds.book)} ${esc(g.espnOdds.details)}${g.espnOdds.total ? `, O/U ${esc(g.espnOdds.total)}` : ""}` : ""}</div>`}
    ${inj && (inj.away.length || inj.home.length) ? section("inj", "Injuries", `<div class="card list">${[["away", g.away], ["home", g.home]].flatMap(([k, t]) => inj[k].slice(0, 5).map((p) => `<div class="li">${logo(t)}<div class="sp t">${esc(p.name)}</div><span class="badge b-plain">${esc(p.status)}</span></div>`)).join("")}</div>`, `via ${esc(SPORTS[sport].modelName)} file`) : ""}
    ${leaders.length ? section("lead", "Game leaders", `<div class="card list">${leaders.map(({ t, l }) => `<a class="perf" href="#/player/${sport}/${l.athlete.id}" data-action="close-go">${headshot(l.athlete.headshot)}<div class="sp"><div class="t ellip">${esc(l.athlete.name)}</div><div class="s muted small">${esc(t.abbr)} · ${esc(l.label)}</div></div><div class="stat">${esc(l.text)}</div></a>`).join("")}</div>`, "Actual · ESPN") : ""}
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap"><a class="btn" href="${espnUrl}" target="_blank" rel="noopener">${ICON.ext} Box score on ESPN</a></div>
    <p class="muted small" style="margin-top:12px">Full Game Center (box score, play-by-play, team comparison) is coming next.</p>`);
}

function openSheet(html, full = false) {
  overlay.innerHTML = `<div class="sheet ${full ? "full" : ""}" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  overlay.hidden = true; overlay.innerHTML = "";
  document.body.style.overflow = "";
}

// ================================================================= SEARCH
function openSearch() {
  openSheet(`<div class="sheet-head"><input class="input" id="q" placeholder="Search any team or player" autocomplete="off" autocapitalize="off" enterkeyhint="search">
    <button class="mini" data-action="close" aria-label="Close">${ICON.x}</button></div><div id="qres"><p class="muted small">Teams from all ${enabled().length} sports, players from ESPN.</p></div>`, true);
  const q = $("#q");
  q.focus(); // synchronous, so iOS opens the keyboard
  let timer, seq = 0;
  q.addEventListener("input", () => {
    clearTimeout(timer);
    const text = q.value.trim();
    const my = ++seq;
    if (text.length < 2) { $("#qres").innerHTML = '<p class="muted small">Type at least 2 letters.</p>'; return; }
    drawSearch(text, null, my);
    timer = setTimeout(async () => {
      let players;
      try { players = await searchPlayers(text); } catch (e) { players = e; }
      if (my === seq) drawSearch(text, players, my);
    }, 260);
  });
}
let lastPlayers = [];
async function drawSearch(text, players) {
  const d = await teams();
  const ql = text.toLowerCase();
  const ts = [];
  for (const s of enabled()) for (const t of d.sports[s]) {
    const hay = [t.name, t.abbr, t.nick, t.short].map((x) => (x || "").toLowerCase());
    const score = hay[1] === ql ? 3 : hay.some((h) => h.startsWith(ql)) ? 2 : hay.some((h) => h.includes(ql)) ? 1 : 0;
    if (score) ts.push({ s, t, score });
  }
  ts.sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name));
  const teamHtml = ts.slice(0, 10).map(({ s, t }) => `<div class="li"><a class="row sp" href="#/team/${s}/${t.id}" data-action="close-go">${logo(t)}<div class="sp"><div class="t ellip">${esc(t.name)}</div><div class="s">${sportBadge(s)} ${esc(t.conf || "")}</div></div></a>
    ${starBtn(isFavTeam(s, t.id), "favteam", `data-sport="${s}" data-id="${t.id}"`, t.name)}</div>`).join("");
  let playerHtml;
  if (players === null) playerHtml = '<div class="li muted small">Searching players…</div>';
  else if (players instanceof Error) playerHtml = `<div class="li">${errBox("player search", players)}</div>`;
  else {
    lastPlayers = players.filter((p) => state.sports[p.sport]);
    playerHtml = lastPlayers.length ? lastPlayers.slice(0, 15).map((p, i) => `<div class="li"><a class="row sp" href="#/player/${p.sport}/${p.id}" data-action="close-go">${headshot(p.headshot)}<div class="sp"><div class="t ellip">${esc(p.name)}</div><div class="s ellip">${sportBadge(p.sport)} ${esc(p.team || "")}</div></div></a>
      ${starBtn(isFavPlayer(p.sport, p.id), "favsearch", `data-i="${i}"`, p.name)}</div>`).join("") : '<div class="li muted small">No players found.</div>';
  }
  $("#qres").innerHTML = `${teamHtml ? `<div class="card list" style="margin-bottom:12px;overflow:hidden"><div class="group-h" style="position:static">Teams</div>${teamHtml}</div>` : ""}
    <div class="card list" style="overflow:hidden"><div class="group-h" style="position:static">Players</div>${playerHtml}</div>`;
}

// ================================================================= router
function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { name: parts[0] || "home", args: parts.slice(1) };
}
let lastGames = [];
let rendering = false;
async function render({ quiet = false } = {}) {
  const { name, args } = route();
  const tab = { team: "teams", player: "teams", game: "scores" }[name] || name;
  document.querySelectorAll(".tabs a").forEach((a) => (a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  renderChips();
  if (!quiet) { view.dataset.v = ""; window.scrollTo(0, 0); }
  rendering = true;
  try {
    if (name === "home") lastGames = (await viewHome()) || [];
    else if (name === "scores") lastGames = (await viewScores()) || [];
    else if (name === "teams") await viewTeams();
    else if (name === "stats") await viewStats();
    else if (name === "profile") await viewProfile();
    else if (name === "team") await viewTeam(args[0], args[1]);
    else if (name === "player") await viewPlayer(args[0], args[1]);
    else if (name === "game") { location.replace("#/scores"); }
    else location.replace("#/home");
  } catch (e) {
    view.innerHTML = errBox("this page", e);
    console.error(e);
  } finally { rendering = false; }
}

// ---------------------------------------------------------------- clicks
document.addEventListener("click", (e) => {
  if (e.target === overlay) return closeSheet();
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action, ds = el.dataset;
  const rerender = () => render({ quiet: true });
  switch (a) {
    case "search": e.preventDefault(); openSearch(); break;
    case "filter": state.filter = ds.sport; save(); ui.expand.clear(); view.dataset.v = ""; rerender(); break;
    case "expand": ui.expand.has(ds.key) ? ui.expand.delete(ds.key) : ui.expand.add(ds.key); rerender(); break;
    case "game": e.preventDefault(); openGame(ds.sport, ds.id); break;
    case "close": closeSheet(); break;
    case "close-go": closeSheet(); break; // link navigates on its own
    case "back": e.preventDefault(); history.length > 1 ? history.back() : (location.hash = "#/home"); break;
    case "day": ui.scoresDay = +ds.n; view.dataset.v = ""; rerender(); break;
    case "tsport": ui.teamsSport = ds.sport; ui.teamsQ = ""; rerender(); break;
    case "ssport": ui.statsSport = ds.sport; rerender(); break;
    case "favteam": {
      e.preventDefault(); e.stopPropagation();
      getTeam(ds.sport, ds.id).then((t) => {
        const on = toggleTeam({ ...t, sport: ds.sport });
        toast(on ? `Following ${t.name}` : `Unfollowed ${t.name}`);
        if (!overlay.hidden) { el.setAttribute("aria-pressed", on); return; }
        rerender();
      });
      break;
    }
    case "favplayer": {
      const p = JSON.parse(ds.p);
      const on = togglePlayer(p);
      toast(on ? `Following ${p.name}` : `Unfollowed ${p.name}`);
      rerender(); break;
    }
    case "favsearch": {
      e.preventDefault();
      const p = lastPlayers[+ds.i];
      const on = togglePlayer(p);
      el.setAttribute("aria-pressed", on);
      toast(on ? `Following ${p.name}` : `Unfollowed ${p.name}`);
      break;
    }
    case "mv": move(ds.kind === "team" ? state.teams : state.players, +ds.i, +ds.d); rerender(); break;
    case "unfav": {
      const list = ds.kind === "team" ? state.teams : state.players;
      const [x] = list.splice(+ds.i, 1); save(); toast(`Unfollowed ${x.name}`); rerender(); break;
    }
    case "secmv": move(state.sections, +ds.i, +ds.d); rerender(); break;
    case "sectog": state.sections[+ds.i].on = !state.sections[+ds.i].on; save(); rerender(); break;
    case "sporttog": {
      state.sports[ds.sport] = !state.sports[ds.sport];
      if (!enabled().length) { state.sports[ds.sport] = true; toast("Keep at least one sport on"); }
      if (!state.sports[state.filter]) state.filter = "all";
      save(); rerender(); break;
    }
    case "refresh": forget(); toast("Refreshing…"); rerender(); break;
    case "reset": if (confirm("Reset GAME DAY? This removes your followed teams, players and settings on this device.")) resetAll(); break;
  }
});
document.addEventListener("change", (e) => {
  if (e.target.matches('[data-action="sconf"]')) { ui.statsConf = e.target.value; render({ quiet: true }); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) closeSheet(); });
window.addEventListener("hashchange", () => { closeSheet(); render(); });

// ---------------------------------------------------------------- auto refresh (live: 30s, otherwise 2 min)
let lastTick = Date.now();
setInterval(() => {
  if (document.hidden || rendering || !overlay.hidden) return;
  const { name } = route();
  if (!["home", "scores"].includes(name)) return;
  const live = lastGames.some((g) => g.state === "in");
  const startingSoon = lastGames.some((g) => g.state === "pre" && g.start - Date.now() < 5 * 60e3 && g.start - Date.now() > -30 * 60e3);
  if (Date.now() - lastTick >= (live || startingSoon ? 30e3 : 120e3)) { lastTick = Date.now(); render({ quiet: true }); }
}, 5e3);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastTick > 60e3) { lastTick = Date.now(); render({ quiet: true }); }
});

render();
