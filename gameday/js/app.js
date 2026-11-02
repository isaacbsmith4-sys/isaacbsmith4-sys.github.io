// GAME DAY app: router, views, refresh loop.
import {
  state, save, SECTIONS, isFavTeam, isFavPlayer, toggleTeam, togglePlayer, move, favTeamIds, favPlayerTeamIds,
  sourceLog, esc, today, addDays, isoDay, fmtTime, fmtDay, dayLabel, ago, resetAll, forget,
} from "./core.js?v=22";
const fmtStat1 = (x) => (x == null ? "–" : Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1));
import {
  SPORTS, SPORT_KEYS, slate, boardDay, news, teams, team as getTeam, searchPlayers, athlete, schedule, standings,
  modelFeed, spreadText, fmt1, pct,
} from "./data.js?v=22";
import { viewGame } from "./gamecenter.js?v=22";
import { viewPlayer, quickProjection } from "./players.js?v=22";
import { viewTeam } from "./teams.js?v=22";
import { renderLab, renderRankings, renderMatchup } from "./stats.js?v=22";
import { viewNews } from "./news.js?v=22";
import { viewCalendar, downloadIcs } from "./calendar.js?v=22";
import { viewAlerts, computeAlerts, setBadge, notifyNew, enablePush, KINDS } from "./alerts.js?v=22";
import { viewOdds } from "./odds.js?v=22";
import { viewAssistant } from "./assistant.js?v=22";
import {
  ICON, sportBadge, modelBadge, marketBadge, logo, headshot, starBtn, gameCard, section, empty, errBox, skel,
  updated, newsItem, statusText, shortBook, modelBlock,
} from "./ui.js?v=22";

const $ = (s, r = document) => r.querySelector(s);
const view = $("#view");
const overlay = $("#overlay");
const ui = { expand: new Set(), scoresDay: 0, teamsSport: null, teamsQ: "", statsSport: null, statsConf: "" };

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

// With a deadline, returns what has arrived by then plus `pending` (the rest), so one slow ESPN feed doesn't hold up the page
async function loadSlates(sports, deadline = 0) {
  const done = new Map();
  const all = Promise.all(sports.map((s) => slate(s).then((v) => done.set(s, { v }), (e) => done.set(s, { e }))));
  if (deadline) await Promise.race([all, new Promise((r) => setTimeout(r, deadline))]); else await all;
  const games = [], errors = [], late = [];
  for (const s of sports) {
    const r = done.get(s);
    if (!r) late.push(s); else if (r.e) errors.push([s, r.e]); else games.push(...r.v);
  }
  return { games, errors, late, pending: late.length ? all : null };
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

  // games first; news, feed times and player projections fill in when they arrive
  const token = (viewHome.token = (viewHome.token || 0) + 1);
  const newsP = Promise.allSettled(sports.map((s) => news(s, 8)));
  const feedsP = Promise.allSettled(sports.map((s) => modelFeed(s)));
  const { games, errors, late, pending } = await loadSlates(sports, 2500);
  if (pending) pending.then(() => { if (token === viewHome.token && route().name === "home") render({ quiet: true }); });
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

  // My players: each followed player's next game and your model's projection for it
  const myPlayers = state.players.filter((p) => state.sports[p.sport] && sports.includes(p.sport));
  let playersP = null;
  if (myPlayers.length) {
    S.players = section("players", "My players", skel(1));
    playersP = Promise.all(myPlayers.map(async (p) => {
      let g = games.find((x) => x.sport === p.sport && x.state !== "post" && (x.home.id === p.teamId || x.away.id === p.teamId));
      // not in the loaded slate (e.g. football next week): use the team's schedule
      if (!g && p.teamId) try { g = (await schedule(p.sport, p.teamId)).games.find((x) => x.state !== "post"); } catch {}
      if (!g) return `<a class="li" href="#/player/${p.sport}/${p.id}">${headshot(p.headshot)}<div class="sp"><div class="t ellip">${esc(p.name)}</div><div class="s">${sportBadge(p.sport)} No upcoming game on the schedule</div></div></a>`;
      const opp = g.home.id === p.teamId ? g.away : g.home;
      let q = null;
      try { q = await quickProjection(p.sport, p, g); } catch {}
      const items = q?.items?.length ? q.items.map((x) => `<span class="pp"><small>${esc(x.label)}</small><b>${fmtStat1(x.proj)}</b>${x.line != null ? `<i>${fmt1(x.line)}</i>` : ""}</span>`).join("")
        : `<span class="muted small">${q?.why === "college" ? "No player model for this sport" : q?.why === "nba-noline" ? "No projection until prop lines post" : "No projection yet"}</span>`;
      return `<a class="li" href="#/player/${p.sport}/${p.id}" style="flex-wrap:wrap">${headshot(p.headshot)}<div class="sp"><div class="t ellip">${esc(p.name)}</div>
        <div class="s">${sportBadge(p.sport)} ${g.home.id === p.teamId ? "vs" : "@"} ${esc(opp.abbr)} · ${esc(statusText(g))}</div></div><div class="pps">${items}</div></a>`;
    })).then((cards) => (S.players = section("players", "My players", `<div class="card list">${cards.join("")}</div><p class="muted small" style="margin:8px 2px 0">${modelBadge("your model")} projection, ${marketBadge("DraftKings")} line in small type</p>`)));
  }

  const live = games.filter((g) => g.state === "in").sort((a, b) => favGame(b) - favGame(a));
  S.live = live.length ? section("live", '<span class="dot-live"></span> Live now', more("live", live, 6, (g) => gameCard(g)), `${live.length} game${live.length === 1 ? "" : "s"}`) : "";

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
  const modelsSection = (feedMeta) => section("models", "Model predictions", rows.length ? `<div class="card list">${rows.map(({ g, m, mk, d }) => `
      <a class="mrow" href="#/game/${g.sport}/${g.id}">
        <div><div class="who">${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</div><div class="when">${sportBadge(g.sport)} ${esc(statusText(g))}</div></div>
        <div class="v m"><small>${esc(m.source)}</small>${spreadText(m.spread_home, g)}</div>
        <div class="v k"><small>${esc(shortBook(mk?.book))}</small>${mk?.spread_home != null ? spreadText(mk.spread_home, g) : "–"}</div>
        ${d != null && Math.abs(d) >= 0.5 ? `<div class="diff">Model is <b>${fmt1(Math.abs(d))} pts</b> more on ${esc(d < 0 ? g.home.abbr : g.away.abbr)} than the line${m.home_win_prob != null ? ` · ${esc(m.home_win_prob >= .5 ? g.home.abbr : g.away.abbr)} win ${pct(Math.max(m.home_win_prob, 1 - m.home_win_prob))}` : ""}</div>` : ""}
      </a>`).join("")}</div>` : empty("No upcoming games with a model line right now."),
    `${feedMeta ? `${esc(feedMeta)} · ` : ""}<a class="sec-more" href="#/odds">Odds center</a>`);
  S.models = modelsSection("");

  const todayList = todays.slice().sort((a, b) => favGame(b) - favGame(a) || (b.state === "in") - (a.state === "in") || a.start - b.start);
  const nextDay = !todayList.length ? upcoming.filter((g) => g.day > tKey) : [];
  S.today = section("today", todayList.length ? "Today's games" : "Up next",
    todayList.length ? more("today", todayList, 6, (g) => gameCard(g))
      : nextDay.length ? more("today", nextDay, 6, (g) => gameCard(g)) : empty("No games scheduled today."),
    todayList.length ? `${todayList.length} game${todayList.length === 1 ? "" : "s"}` : "");

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

  S.news = section("news", "Latest news", skel(1));
  const errs = errors.map(([s, e]) => errBox(`${SPORTS[s].label} scores`, e)).join("") +
    (late.length ? `<p class="muted small" style="margin:0 2px 8px">Still loading ${late.map((s) => SPORTS[s].label).join(", ")} from ESPN…</p>` : "");
  // first visit in a browser tab: suggest installing (iPhone: Share > Add to Home Screen)
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const install = !standalone && !state.hideInstall ? `<div class="card install"><img src="apple-touch-icon.png" alt=""><div class="sp small"><b>Put GAME DAY on your home screen</b><br><span class="muted">In Safari tap Share, then "Add to Home Screen". It opens full screen and can show alerts.</span></div><button class="mini" data-action="hideinstall" aria-label="Dismiss">${ICON.x}</button></div>` : "";
  const paint = () => {
    if (token !== viewHome.token || route().name !== "home") return; // a newer render or another page took over
    const y = window.scrollY;
    view.innerHTML = `${install}${errs}${state.sections.filter((x) => x.on).map((x) => S[x.key] || "").join("")}
      <p class="muted small" style="text-align:center;margin-top:24px">Scores and stats: ESPN · Predictions: your models' published files · Refreshes automatically</p>`;
    window.scrollTo(0, y);
  };
  paint();

  const [newsRes, feeds] = await Promise.all([newsP, feedsP, playersP]);
  const arts = newsRes.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const favArt = (a) => a.teamIds.some((id) => isFavTeam(a.sport, id)) || a.athleteIds.some((id) => isFavPlayer(a.sport, id));
  arts.sort((a, b) => favArt(b) - favArt(a) || new Date(b.published) - new Date(a.published));
  S.news = section("news", "Latest news", arts.length ? `<div class="card list">${arts.slice(0, 8).map(newsItem).join("")}</div>` : empty("No news loaded."), `<a class="sec-more" href="#/news">All news &amp; injuries</a>`);
  S.models = modelsSection(feeds.map((f, i) => f.status === "fulfilled" ? `${SPORTS[sports[i]].label} ${ago(f.value.updated)}` : `${SPORTS[sports[i]].label} unavailable`).join(" · "));
  paint();
  // notifications last, so they don't compete with the page for bandwidth
  computeAlerts(games).then((items) => { setBadge(items); notifyNew(items); }).catch(() => {});
  return games;
}

// ================================================================= SCORES
async function viewScores() {
  const d = addDays(today(), ui.scoresDay);
  const sports = active();
  const days = [-3, -2, -1, 0, 1, 2, 3].map((n) => ui.scoresDay + n);
  const head = `<div class="row" style="justify-content:space-between;flex-wrap:wrap;row-gap:4px"><h1 class="page-title">Scores</h1>
      <span class="row" style="gap:6px"><a class="btn" href="#/calendar">Calendar</a><a class="btn" href="#/odds">Odds</a><label class="btn" style="position:relative">${ICON.cal} ${esc(fmtDay(d))}<input type="date" data-action="sdate" value="${isoDay(d)}" aria-label="Pick a date" style="position:absolute;inset:0;opacity:0;width:100%;cursor:pointer"></label></span></div>
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
    return section(s, `${sportBadge(s)} ${SPORTS[s].name}`, more(`sc-${s}`, gs, 12, (g) => gameCard(g)), `${gs.length} game${gs.length === 1 ? "" : "s"}`);
  }).join("");
  if (ui.scoresDay === 0) setLive(all);
  // nothing on this day: offer the next day that has games (football is mostly weekends)
  let next = "";
  if (!all.length) {
    for (let n = 1; n <= 10 && !next; n++) {
      const dd = addDays(d, n);
      const r = await Promise.allSettled(sports.map((s) => boardDay(s, dd)));
      if (r.some((x) => x.status === "fulfilled" && x.value.length)) next = `<div style="text-align:center;margin-top:12px"><button class="btn primary" data-action="day" data-n="${ui.scoresDay + n}">Next games: ${esc(fmtDay(dd))}</button></div>`;
    }
  }
  view.innerHTML = head + (body || empty(`No games on ${fmtDay(d)} for the sports you picked.`)) + next +
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

// ================================================================= STATS hub: Stats Lab, Rankings, Matchup, Standings
const STATS_TABS = [["lab", "Stats Lab"], ["rankings", "Rankings"], ["matchup", "Matchup"], ["standings", "Standings"]];
async function viewStats(args = []) {
  const sub = STATS_TABS.some(([k]) => k === args[0]) ? args[0] : ui.statsSub || "lab";
  ui.statsSub = sub;
  const sports = enabled();
  if (sub === "matchup" && sports.includes(args[1])) ui.statsSport = args[1];
  ui.statsSport = sports.includes(ui.statsSport) ? ui.statsSport : sports[0];
  const s = ui.statsSport;
  if (!s) { view.innerHTML = empty("All sports are off."); return; }
  view.dataset.v = "stats";
  view.innerHTML = `<h1 class="page-title">Stats</h1>
    <div class="subtabs">${STATS_TABS.map(([k, l]) => `<a href="#/stats/${k}" aria-current="${k === sub ? "page" : "false"}">${l}</a>`).join("")}</div>
    <div class="seg" style="margin-bottom:12px">${sports.map((k) => `<button data-action="ssport" data-sport="${k}" aria-pressed="${k === s}">${SPORTS[k].label}</button>`).join("")}</div>
    <div id="statsBody"></div>`;
  const el = $("#statsBody");
  if (sub === "lab") return renderLab(el, s);
  if (sub === "rankings") return renderRankings(el, s);
  if (sub === "matchup") return renderMatchup(el, s, args[2], args[3], (a, b) => (location.hash = `#/stats/matchup/${s}/${a}/${b}`));
  return standingsInto(el, s);
}

async function standingsInto(el, s) {
  const head = "";
  el.innerHTML = skel(2);
  let d;
  try { d = await standings(s); } catch (e) { el.innerHTML = errBox("standings", e); return; }
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
  el.innerHTML = head + (college ? `<select class="input" data-action="sconf" style="margin-bottom:12px">${confs.map((c) => `<option ${c === ui.statsConf ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>` : "") +
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
    ${section("notif", "Notifications", `<div class="card list">${KINDS.map(([k, l, h]) => `<div class="li"><div class="sp"><div class="t">${esc(l)}</div><div class="s">${esc(h)}</div></div>
        <button class="tog" role="switch" aria-checked="${state.alerts?.kinds?.[k] !== false}" data-action="alertkind" data-k="${k}" aria-label="${esc(l)}"></button></div>`).join("")}
      <div class="li"><div class="sp"><div class="t">Phone alerts</div><div class="s">${state.alerts?.push ? "On while GAME DAY is open." : "Pop-up alerts while GAME DAY is open. On iPhone, add it to your home screen first."} Background alerts with the app closed would need a server; the hub's ntfy alerts cover your best plays.</div></div>
        <button class="btn ${state.alerts?.push ? "on" : ""}" data-action="pushon">${state.alerts?.push ? "On" : "Turn on"}</button></div>
      <div class="li"><div class="sp"><div class="t">Game reminders</div><div class="s">Add every upcoming game for the teams you follow to your phone's calendar, with an alert 30 minutes before.</div></div>
        <button class="btn" data-action="icsall">${ICON.cal} Add</button></div></div>
      <p style="margin:8px 2px 0"><a class="sec-more" href="#/alerts">Open notifications</a></p>`)}
    ${section("legend", "How to read numbers", `<div class="card list">
      <div class="li"><span class="badge b-actual">Actual</span><div class="sp s">Real results and stats from ESPN</div></div>
      <div class="li"><span class="badge b-model">Model</span><div class="sp s">Predictions from your own models (NBA, NFL, NCAAB, CFB), shown separately and never averaged</div></div>
      <div class="li"><span class="badge b-market">DK</span><div class="sp s">Sportsbook lines (DraftKings via ESPN, or the NFL model's consensus line)</div></div></div>`)}
    ${section("sources", "Data sources", `<div class="card list">${log.length ? log.map(([k, v]) => `<div class="li"><span class="badge ${v.ok ? "b-actual" : "b-live"}">${v.ok ? "OK" : "Error"}</span>
      <div class="sp"><div class="t ellip">${esc(k)}</div><div class="s ellip">${v.ok ? `loaded ${ago(v.at)} · ${v.ms} ms` : esc(v.error)}</div></div></div>`).join("") : '<div class="li muted">Nothing loaded yet this session.</div>'}</div>`, "This session")}
    ${section("install", "Install on your phone", `<div class="card pad small muted">${matchMedia("(display-mode: standalone)").matches || navigator.standalone ? "GAME DAY is installed on this device." : `To install on iPhone: open this page in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>. It then opens full screen, keeps your favorites, and can show alerts while open.`}</div>`)}
    ${section("about", "About", `<div class="card pad small muted">Favorites and settings are saved on this device only. Live data comes straight from ESPN; predictions come from the files your models already publish to this site 4 times a day.
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-action="refresh">Refresh data</button><button class="btn" data-action="reset">Reset GAME DAY</button></div></div>`)}`;
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
  const tab = { team: "teams", player: "teams", game: "scores", calendar: "scores", news: "home", alerts: "home", odds: "scores", ask: "home" }[name] || name;
  document.querySelectorAll(".tabs a").forEach((a) => (a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  renderChips();
  if (!quiet) { view.dataset.v = ""; window.scrollTo(0, 0); }
  rendering = true;
  try {
    if (name === "home") lastGames = (await viewHome()) || [];
    else if (name === "scores") lastGames = (await viewScores()) || [];
    else if (name === "teams") await viewTeams();
    else if (name === "stats") await viewStats(args);
    else if (name === "news") await viewNews(view, args[0]);
    else if (name === "calendar") await viewCalendar(view, args);
    else if (name === "alerts") await viewAlerts(view);
    else if (name === "odds") await viewOdds(view, args[0]);
    else if (name === "ask") viewAssistant(view);
    else if (name === "profile") await viewProfile();
    else if (name === "team") await viewTeam(view, args[0], args[1]);
    else if (name === "player") await viewPlayer(view, args[0], args[1]);
    else if (name === "game") lastGames = (await viewGame(view, args[0], args[1], { quiet, tab: args[2] })) || [];
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
    case "close": closeSheet(); break;
    case "close-go": closeSheet(); break; // link navigates on its own
    case "back": e.preventDefault(); history.length > 1 ? history.back() : (location.hash = "#/home"); break;
    case "day": ui.scoresDay = +ds.n; view.dataset.v = ""; rerender(); break;
    case "tsport": ui.teamsSport = ds.sport; ui.teamsQ = ""; rerender(); break;
    case "ssport": ui.statsSport = ds.sport; if (ui.statsSub === "matchup") location.hash = `#/stats/matchup/${ds.sport}`; else rerender(); break;
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
    case "findplayer": {
      e.preventDefault();
      searchPlayers(ds.q).then((r) => {
        const hit = r.find((p) => p.sport === (ds.sport || "nfl"));
        if (hit) location.hash = `#/player/${hit.sport}/${hit.id}`; else toast(`Couldn't find ${ds.q} on ESPN`);
      }).catch(() => toast("Player search failed"));
      break;
    }
    case "alertkind": { state.alerts ||= { seen: [], notified: [], inj: {}, kinds: {}, push: false }; state.alerts.kinds[ds.k] = state.alerts.kinds[ds.k] === false; save(); rerender(); break; }
    case "pushon": enablePush().then((m) => { toast(m.length > 60 ? m.slice(0, 60) + "…" : m); rerender(); }); break;
    case "icsall": {
      el.textContent = "Loading schedules…";
      Promise.allSettled([...new Set([...state.teams.map((t) => `${t.sport}:${t.id}`), ...state.players.filter((p) => p.teamId).map((p) => `${p.sport}:${p.teamId}`)])]
        .map((k) => schedule(k.split(":")[0], k.split(":")[1])))
        .then((rs) => {
          const seen = new Set();
          const gs = rs.flatMap((r) => (r.status === "fulfilled" ? r.value.games : [])).filter((g) => g.state === "pre" && !seen.has(`${g.sport}:${g.id}`) && seen.add(`${g.sport}:${g.id}`));
          const n2 = gs.length ? downloadIcs(gs, "gameday-my-teams.ics", { name: "GAME DAY: my teams" }) : 0;
          el.textContent = n2 ? `Added ${n2} games` : "No upcoming games";
        });
      break;
    }
    case "hideinstall": state.hideInstall = true; save(); e.target.closest(".install")?.remove(); break;
    case "refresh": forget(); toast("Refreshing…"); rerender(); break;
    case "reset": if (confirm("Reset GAME DAY? This removes your followed teams, players and settings on this device.")) resetAll(); break;
  }
});
document.addEventListener("change", (e) => {
  if (e.target.matches('[data-action="sconf"]')) { ui.statsConf = e.target.value; render({ quiet: true }); }
  if (e.target.matches('[data-action="sdate"]') && e.target.value) {
    const [y, m, dd] = e.target.value.split("-").map(Number);
    ui.scoresDay = Math.round((new Date(y, m - 1, dd, 12) - today()) / 864e5);
    view.dataset.v = ""; render({ quiet: true });
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) closeSheet(); });
window.addEventListener("hashchange", () => { closeSheet(); render(); });

// ---------------------------------------------------------------- auto refresh (live: 30s, otherwise 2 min)
let lastTick = Date.now();
setInterval(() => {
  if (document.hidden || rendering || !overlay.hidden) return;
  const { name } = route();
  if (!["home", "scores", "game"].includes(name)) return;
  const live = lastGames.some((g) => g.state === "in");
  const startingSoon = lastGames.some((g) => g.state === "pre" && g.start - Date.now() < 5 * 60e3 && g.start - Date.now() > -30 * 60e3);
  if (Date.now() - lastTick >= (live ? (name === "game" ? 20e3 : 30e3) : startingSoon ? 30e3 : 120e3)) { lastTick = Date.now(); render({ quiet: true }); }
}, 5e3);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastTick > 60e3) { lastTick = Date.now(); render({ quiet: true }); }
});

render();
