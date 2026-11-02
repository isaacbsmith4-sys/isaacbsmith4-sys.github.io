// News hub: headlines (league + your teams), the injury report, transactions. All from ESPN, with source and time.
import { esc, ago, fmtDay, state, isFavTeam, isFavPlayer, favTeamIds } from "./core.js?v=11";
import { SPORTS, SPORT_KEYS, leagueNews, teamNews, leagueInjuries, transactions, HAS_INJURY_REPORT } from "./data.js?v=11";
import { sportBadge, logo, headshot, section, empty, errBox, skel } from "./ui.js?v=11";

const TABS = [["headlines", "Headlines"], ["injuries", "Injuries"], ["moves", "Transactions"]];
const ui = { sport: "all", mine: false, status: "all", type: "all" };
const NEW_MIN = 90; // minutes an article counts as new

export async function viewNews(view, sub) {
  sub = TABS.some(([k]) => k === sub) ? sub : "headlines";
  const sports = SPORT_KEYS.filter((k) => state.sports[k]);
  if (ui.sport !== "all" && !sports.includes(ui.sport)) ui.sport = "all";
  const active = ui.sport === "all" ? sports : [ui.sport];
  view.dataset.v = "news";
  view.innerHTML = `<h1 class="page-title">News</h1>
    <div class="subtabs">${TABS.map(([k, l]) => `<a href="#/news/${k}" aria-current="${k === sub ? "page" : "false"}">${l}</a>`).join("")}</div>
    <div class="chips" style="padding-top:0">${[["all", "All"], ...sports.map((k) => [k, SPORTS[k].label])].map(([k, l]) =>
      `<button class="chip" data-nw="sport" data-v="${k}" aria-pressed="${ui.sport === k}">${k !== "all" ? `<span class="sw" style="background:var(--${k})"></span>` : ""}${l}</button>`).join("")}
      <button class="chip" data-nw="mine" aria-pressed="${ui.mine}">★ Mine only</button></div>
    <div id="nwBody">${skel(3)}</div>`;
  view.onclick = (e) => {
    const b = e.target.closest("[data-nw]");
    if (!b) return;
    const k = b.dataset.nw;
    if (k === "sport") ui.sport = b.dataset.v;
    if (k === "mine") ui.mine = !ui.mine;
    if (k === "status" || k === "type") ui[k] = b.dataset.v;
    viewNews(view, sub);
  };
  const body = view.querySelector("#nwBody");
  try {
    if (sub === "headlines") body.innerHTML = await headlines(active);
    if (sub === "injuries") body.innerHTML = await injuries(active);
    if (sub === "moves") body.innerHTML = await moves(active);
  } catch (e) { body.innerHTML = errBox("news", e); }
}

const favArticle = (a) => a.teamIds.some((id) => isFavTeam(a.sport, id)) || a.athleteIds.some((id) => isFavPlayer(a.sport, id));

async function headlines(sports) {
  // league feeds plus each followed team's own feed
  const jobs = sports.map((s) => leagueNews(s, 30));
  for (const t of state.teams.filter((t) => sports.includes(t.sport))) jobs.push(teamNews(t.sport, t.id, 8));
  const res = await Promise.allSettled(jobs);
  const seen = new Set();
  let list = res.flatMap((r) => (r.status === "fulfilled" ? r.value : [])).filter((a) => a.headline && !seen.has(a.id) && seen.add(a.id));
  const types = [...new Set(list.map((a) => a.type).filter(Boolean))];
  if (ui.type !== "all") list = list.filter((a) => a.type === ui.type);
  if (ui.mine) list = list.filter(favArticle);
  list.sort((a, b) => new Date(b.published) - new Date(a.published));
  const fails = res.filter((r) => r.status === "rejected").length;
  const typeChips = types.length > 1 ? `<div class="chips" style="padding:0 0 10px">${["all", ...types].map((t) => `<button class="chip" data-nw="type" data-v="${esc(t)}" aria-pressed="${ui.type === t}">${t === "all" ? "Every type" : esc(typeLabel(t))}</button>`).join("")}</div>` : "";
  const mine = list.filter(favArticle);
  return typeChips + (fails ? `<div class="err" style="margin-bottom:10px">${fails} news feed${fails > 1 ? "s" : ""} didn't load.</div>` : "") +
    (!ui.mine && mine.length ? section("mine", '<span style="color:var(--fav)">★</span> About your teams and players', `<div class="card list">${mine.slice(0, 6).map(item).join("")}</div>`) : "") +
    section("all", ui.mine ? "Your teams and players" : "Latest", list.length ? `<div class="card list">${list.slice(0, 60).map(item).join("")}</div>`
      : empty(ui.mine ? "No recent stories tagged with the teams or players you follow." : "No stories."), "Source: ESPN");
}
const typeLabel = (t) => ({ HeadlineNews: "Headlines", Story: "Stories", Recap: "Recaps", Preview: "Previews", Media: "Video", Blog: "Blogs" }[t] || t);

function item(a) {
  const mins = (Date.now() - new Date(a.published)) / 60000;
  return `<a class="news" href="${esc(a.url)}" target="_blank" rel="noopener">
    ${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy">` : ""}
    <div class="sp"><div class="h">${esc(a.headline)}</div>
    <div class="m">${sportBadge(a.sport)}${mins < NEW_MIN ? '<span class="badge b-live">New</span>' : ""}${favArticle(a) ? '<span class="badge b-fav">Following</span>' : ""}
      ${a.type && a.type !== "Story" ? `<span class="badge b-plain">${esc(typeLabel(a.type).replace(/s$/, ""))}</span>` : ""}
      <span>${esc(a.source)}${a.byline ? ` · ${esc(a.byline)}` : ""}</span>·<span title="${esc(new Date(a.published).toLocaleString())}">${ago(a.published)}</span></div></div></a>`;
}

// ---------------------------------------------------------------- injuries
const STATUS_ORDER = ["Out", "Doubtful", "Questionable", "Day-To-Day", "Suspension", "Probable"];
async function injuries(sports) {
  const out = [];
  const noReport = sports.filter((s) => !HAS_INJURY_REPORT[s]);
  const withReport = sports.filter((s) => HAS_INJURY_REPORT[s]);
  const res = await Promise.allSettled(withReport.map((s) => leagueInjuries(s)));
  const statuses = new Set();
  res.forEach((r) => r.status === "fulfilled" && r.value.teams.forEach((t) => t.list.forEach((i) => statuses.add(i.status))));
  const order = [...statuses].sort((a, b) => (STATUS_ORDER.indexOf(a) + 1 || 99) - (STATUS_ORDER.indexOf(b) + 1 || 99));
  out.push(`<div class="chips" style="padding:0 0 10px">${["all", ...order].map((s) => `<button class="chip" data-nw="status" data-v="${esc(s)}" aria-pressed="${ui.status === s}">${s === "all" ? "Any status" : esc(s)}</button>`).join("")}</div>`);
  res.forEach((r, i) => {
    const sport = withReport[i];
    if (r.status === "rejected") { out.push(section(sport, SPORTS[sport].name, errBox("injury report", r.reason))); return; }
    const ft = favTeamIds(sport);
    let teamsList = r.value.teams.map((t) => ({ ...t, list: t.list.filter((x) => (ui.status === "all" || x.status === ui.status)) }))
      .filter((t) => t.list.length && (!ui.mine || ft.has(t.id) || t.list.some((x) => isFavPlayer(sport, x.id))));
    teamsList.sort((a, b) => ft.has(b.id) - ft.has(a.id) || a.name.localeCompare(b.name));
    const total = teamsList.reduce((s, t) => s + t.list.length, 0);
    out.push(section(sport, `${sportBadge(sport)} ${SPORTS[sport].name} injury report`, teamsList.length ? teamsList.map((t) => `<div class="card list" style="margin-bottom:10px;overflow:hidden">
        <a class="group-h row" href="#/team/${sport}/${t.id}" style="gap:8px">${ft.has(t.id) ? "★ " : ""}${esc(t.name)} <span class="sp"></span>${t.list.length}</a>
        ${t.list.sort((a, b) => (STATUS_ORDER.indexOf(a.status) + 1 || 99) - (STATUS_ORDER.indexOf(b.status) + 1 || 99)).map((x) => `<details class="inj">
          <summary class="li">${headshot(x.headshot)}<div class="sp"><div class="t ellip">${esc(x.name)} ${isFavPlayer(sport, x.id) ? '<span class="badge b-fav">★</span>' : ""}</div>
            <div class="s ellip">${esc(x.pos || "")}${x.type ? ` · ${esc(x.type)}${x.location && x.location !== "Other" ? ` (${esc(x.location)})` : ""}` : ""}${x.returnDate ? ` · back ~${esc(fmtDay(new Date(x.returnDate + "T12:00")))}` : ""}</div></div>
            <span class="badge ${/^out|susp/i.test(x.status) ? "b-live" : "b-plain"}">${esc(x.status)}</span></summary>
          <div class="note">${esc(x.short || "")}${x.long ? `<br><span class="muted">${esc(x.long)}</span>` : ""}<br><span class="small muted">ESPN injury report · updated ${ago(x.date)} · <a href="#/player/${sport}/${x.id}" style="color:var(--accent2)">Player page</a></span></div></details>`).join("")}</div>`).join("")
      : empty(ui.mine ? "None of your teams or players are on the report." : "Nobody matches that filter."), `${total} players · updated ${ago(r.value.updated)}`));
  });
  for (const s of noReport) out.push(section(s, `${sportBadge(s)} ${SPORTS[s].name}`, `<div class="card pad small muted">ESPN doesn't publish a current league-wide injury report for ${esc(SPORTS[s].name.toLowerCase())}. Team rosters show injury tags when ESPN has them, and each Game Center lists the injuries ESPN reports for that game.</div>`));
  return out.join("");
}

// ---------------------------------------------------------------- transactions
async function moves(sports) {
  const pro = sports.filter((s) => s === "nba" || s === "nfl");
  const res = await Promise.allSettled(pro.map((s) => transactions(s)));
  let list = res.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (ui.mine) list = list.filter((t) => t.team && isFavTeam(t.sport, t.team.id));
  list.sort((a, b) => new Date(b.date) - new Date(a.date));
  const out = [];
  if (pro.length) out.push(section("tx", "Trades, signings and moves", list.length ? `<div class="card list">${list.slice(0, 80).map((t) => `<a class="li" href="${t.team ? `#/team/${t.sport}/${t.team.id}` : "#"}">${t.team ? logo(t.team) : ""}
      <div class="sp"><div class="t" style="font-weight:500">${esc(t.text)}</div><div class="s">${sportBadge(t.sport)} ${esc(t.team?.name || "")} · ${esc(fmtDay(new Date(t.date)))}</div></div></a>`).join("")}</div>`
    : empty(ui.mine ? "No recent moves by the teams you follow." : "No transactions."), "Source: ESPN"));
  if (sports.some((s) => s === "ncaab" || s === "cfb")) out.push(`<p class="muted small" style="margin:12px 2px">College sports don't have transaction wires on ESPN; transfer and roster news shows up in Headlines.</p>`);
  return out.join("");
}
