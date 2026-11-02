// Calendar: day / week / month views, your teams' schedules, season phases and postseason rounds,
// and reminders as calendar files (.ics) your phone's Calendar app can add, with an alert before tip-off.
import { esc, fmtTime, fmtDay, dayLabel, isoDay, addDays, today, state, isFavTeam, favTeamIds, favPlayerTeamIds } from "./core.js?v=23";
import { SPORTS, SPORT_KEYS, boardDay, schedule, seasonCalendar, modelFeed } from "./data.js?v=23";
import { sportBadge, logo, section, empty, errBox, skel, gameCard, ICON } from "./ui.js?v=23";

const ui = { mode: "month", date: null, sport: "all", team: "all" };

// ---------------------------------------------------------------- .ics reminders
const icsDate = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s) => String(s || "").replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
export function icsFor(games, { alarmMin = 30, name = "GAME DAY" } = {}) {
  const hours = (g) => (SPORTS[g.sport].kind === "football" ? 3.5 : 2.5);
  const ev = games.filter((g) => g.start && g.state === "pre").map((g) => [
    "BEGIN:VEVENT", `UID:gameday-${g.sport}-${g.id}@isaacbsmith4-sys.github.io`, `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(g.start)}`, `DTEND:${icsDate(new Date(+g.start + hours(g) * 3600e3))}`,
    `SUMMARY:${icsText(`${SPORTS[g.sport].label}: ${g.away.short} @ ${g.home.short}`)}`,
    `DESCRIPTION:${icsText([g.tv.length ? `TV: ${g.tv.join(", ")}` : "", `https://isaacbsmith4-sys.github.io/gameday/#/game/${g.sport}/${g.id}`].filter(Boolean).join("\n"))}`,
    g.venue ? `LOCATION:${icsText(g.venue)}` : "",
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(`${g.away.short} @ ${g.home.short} starts soon`)}`, `TRIGGER:-PT${alarmMin}M`, "END:VALARM",
    "END:VEVENT"].filter(Boolean).join("\r\n"));
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GAME DAY//EN", `X-WR-CALNAME:${icsText(name)}`, ...ev, "END:VCALENDAR"].join("\r\n");
}
export function downloadIcs(games, filename, opts) {
  const ics = icsFor(games, opts);
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return games.filter((g) => g.state === "pre").length;
}

// ---------------------------------------------------------------- data
async function favoriteSchedules(sports) {
  const want = [];
  for (const s of sports) {
    const ids = new Set([...favTeamIds(s), ...favPlayerTeamIds(s)]);
    for (const id of ids) want.push([s, id]);
  }
  const res = await Promise.allSettled(want.map(([s, id]) => schedule(s, id)));
  const games = new Map();
  res.forEach((r, i) => { if (r.status === "fulfilled") for (const g of r.value.games) games.set(`${g.sport}:${g.id}`, { ...g, favTeam: want[i][1] }); });
  return [...games.values()].sort((a, b) => a.start - b.start);
}
const teamFilter = (g) => ui.team === "all" ? true : ui.team === "mine"
  ? [g.home, g.away].some((t) => isFavTeam(g.sport, t.id) || favPlayerTeamIds(g.sport).has(t.id))
  : [g.home.id, g.away.id].includes(ui.team.split(":")[1]) && g.sport === ui.team.split(":")[0];

// ---------------------------------------------------------------- view
export async function viewCalendar(view, args = []) {
  if (args[0] && ["day", "week", "month"].includes(args[0])) ui.mode = args[0];
  if (args[1] && /^\d{4}-\d{2}-\d{2}$/.test(args[1])) ui.date = args[1];
  ui.date ||= isoDay(today());
  const sports = SPORT_KEYS.filter((k) => state.sports[k]);
  if (ui.sport !== "all" && !sports.includes(ui.sport)) ui.sport = "all";
  const active = ui.sport === "all" ? sports : [ui.sport];
  const d = new Date(ui.date + "T12:00");
  view.dataset.v = "calendar";
  const favOpts = state.teams.filter((t) => active.includes(t.sport));
  view.innerHTML = `<div class="row" style="justify-content:space-between"><h1 class="page-title">Calendar</h1><a class="btn" href="#/scores">Scores</a></div>
    <div class="seg" style="margin-bottom:10px">${["day", "week", "month"].map((m) => `<button data-cal="mode" data-v="${m}" aria-pressed="${ui.mode === m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join("")}</div>
    <div class="chips" style="padding-top:0">${[["all", "All"], ...sports.map((k) => [k, SPORTS[k].label])].map(([k, l]) => `<button class="chip" data-cal="sport" data-v="${k}" aria-pressed="${ui.sport === k}">${k !== "all" ? `<span class="sw" style="background:var(--${k})"></span>` : ""}${l}</button>`).join("")}</div>
    <select class="input" data-cal="team" style="margin:6px 0 12px"><option value="all">All teams</option><option value="mine" ${ui.team === "mine" ? "selected" : ""}>★ My teams and players</option>
      ${favOpts.map((t) => `<option value="${t.sport}:${t.id}" ${ui.team === `${t.sport}:${t.id}` ? "selected" : ""}>${esc(t.name)} (${SPORTS[t.sport].label})</option>`).join("")}</select>
    <div id="calBody">${skel(3)}</div>`;
  view.onclick = (e) => {
    const b = e.target.closest("[data-cal]");
    if (!b || b.tagName === "SELECT") return;
    const k = b.dataset.cal, v = b.dataset.v;
    if (k === "mode") ui.mode = v;
    if (k === "sport") ui.sport = v;
    if (k === "go") ui.date = v;
    if (k === "day") { ui.date = v; ui.mode = "day"; }
    if (k === "remind" || k === "remindall") {
      const list = k === "remind" ? [cache.get(v)].filter(Boolean) : [...cache.values()].filter((g) => g.state === "pre" && teamFilter(g));
      const n = downloadIcs(list, k === "remind" ? "game.ics" : "gameday-games.ics", { name: "GAME DAY" });
      b.textContent = n ? `Added ${n} to calendar file` : "Nothing upcoming";
      return;
    }
    viewCalendar(view);
  };
  view.onchange = (e) => { if (e.target.dataset.cal === "team") { ui.team = e.target.value; viewCalendar(view); } };
  const body = view.querySelector("#calBody");
  try {
    if (ui.mode === "day") body.innerHTML = await dayView(active, d);
    if (ui.mode === "week") body.innerHTML = await weekView(active, d);
    if (ui.mode === "month") body.innerHTML = await monthView(active, d);
  } catch (e) { body.innerHTML = errBox("the calendar", e); console.error(e); }
}
const cache = new Map(); // "sport:id" -> game, for reminder buttons

const nav = (d, step, unit) => {
  const prev = unit === "month" ? new Date(d.getFullYear(), d.getMonth() - 1, 1, 12) : addDays(d, -step);
  const next = unit === "month" ? new Date(d.getFullYear(), d.getMonth() + 1, 1, 12) : addDays(d, step);
  const label = unit === "month" ? d.toLocaleDateString([], { month: "long", year: "numeric" }) : unit === "week" ? `${fmtDay(d)} – ${fmtDay(addDays(d, 6))}` : `${dayLabel(d)}${dayLabel(d) !== fmtDay(d) ? ` · ${fmtDay(d)}` : ""}`;
  return `<div class="cal-nav"><button class="mini" data-cal="go" data-v="${isoDay(prev)}" aria-label="Previous">${ICON.back}</button>
    <b>${esc(label)}</b><button class="mini" data-cal="go" data-v="${isoDay(next)}" aria-label="Next" style="transform:scaleX(-1)">${ICON.back}</button>
    ${(unit === "month" ? d.getMonth() !== today().getMonth() || d.getFullYear() !== today().getFullYear() : isoDay(d) !== isoDay(today())) ? `<button class="chip" data-cal="go" data-v="${isoDay(today())}" style="height:30px">Today</button>` : ""}</div>`;
};
const remindBtn = (g) => (g.state === "pre" ? `<button class="mini rem" data-cal="remind" data-v="${g.sport}:${g.id}" aria-label="Add a reminder to your calendar" title="Add to calendar">${ICON.cal}</button>` : "");

async function dayView(sports, d) {
  const res = await Promise.allSettled(sports.map((s) => boardDay(s, d)));
  await Promise.all(sports.map(async (s, i) => {
    if (res[i].status !== "fulfilled") return;
    try { const f = await modelFeed(s); for (const g of res[i].value) g.model = f.lookup(g) || null; } catch {}
  }));
  const parts = [nav(d, 1, "day")];
  let any = false;
  sports.forEach((s, i) => {
    if (res[i].status === "rejected") { parts.push(errBox(`${SPORTS[s].label} schedule`, res[i].reason)); return; }
    const gs = res[i].value.filter(teamFilter).sort((a, b) => isFav(b) - isFav(a) || a.start - b.start);
    if (!gs.length) return;
    any = true;
    gs.forEach((g) => cache.set(`${g.sport}:${g.id}`, g));
    parts.push(section(s, `${sportBadge(s)} ${SPORTS[s].name}`, `<div class="grid cols">${gs.map((g) => `<div class="calg">${gameCard(g)}${remindBtn(g)}</div>`).join("")}</div>`, `${gs.length} game${gs.length === 1 ? "" : "s"}`));
  });
  if (!any) parts.push(empty(`No games on ${fmtDay(d)}${ui.team !== "all" ? " for that team filter" : ""}.`));
  else if ([...cache.values()].some((g) => g.state === "pre" && g.day === isoDay(d) && teamFilter(g)))
    parts.push(`<div style="text-align:center;margin-top:12px"><button class="btn" data-cal="remindall">${ICON.cal} Add these to my calendar</button></div>`);
  parts.push(`<p class="muted small" style="text-align:center;margin-top:12px">Reminders download as a calendar file with an alert 30 minutes before start; your phone asks to add them to Calendar.</p>`);
  return parts.join("");
}
const isFav = (g) => [g.home, g.away].some((t) => isFavTeam(g.sport, t.id) || favPlayerTeamIds(g.sport).has(t.id));

async function weekView(sports, d) {
  const start = d;
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const res = await Promise.allSettled(days.flatMap((dd) => sports.map((s) => boardDay(s, dd).then((gs) => ({ dd, s, gs })))));
  const byDay = new Map(days.map((dd) => [isoDay(dd), []]));
  for (const r of res) if (r.status === "fulfilled") for (const g of r.value.gs) if (byDay.has(isoDay(r.value.dd))) byDay.get(isoDay(r.value.dd)).push(g);
  const fails = res.filter((r) => r.status === "rejected").length;
  const parts = [nav(d, 7, "week"), fails ? `<div class="err" style="margin-bottom:10px">${fails} day/sport schedule${fails > 1 ? "s" : ""} didn't load.</div>` : ""];
  for (const dd of days) {
    const all = byDay.get(isoDay(dd)).filter(teamFilter);
    all.forEach((g) => cache.set(`${g.sport}:${g.id}`, g));
    const fav = all.filter(isFav);
    const counts = sports.map((s) => [s, all.filter((g) => g.sport === s).length]).filter(([, c]) => c);
    parts.push(`<div class="cal-day"><button class="cal-dh" data-cal="day" data-v="${isoDay(dd)}"><b>${esc(dayLabel(dd))}</b>${dayLabel(dd) !== fmtDay(dd) ? `<span class="muted small">${esc(fmtDay(dd))}</span>` : ""}<span class="sp"></span>
      ${counts.map(([s, c]) => `<span class="badge b-sport" style="background:var(--${s})">${SPORTS[s].label} ${c}</span>`).join("") || '<span class="muted small">No games</span>'}<span class="chev">›</span></button>
      ${fav.length ? `<div class="card list">${fav.map((g) => `<a class="li" href="#/game/${g.sport}/${g.id}">${logo(g.away)}<div class="sp"><div class="t ellip">${esc(g.away.short)} @ ${esc(g.home.short)}</div><div class="s">${sportBadge(g.sport)} ${g.state === "pre" ? fmtTime(g.start) : esc(g.detail)}${g.tv.length ? ` · ${esc(g.tv[0])}` : ""}</div></div>${logo(g.home)}${remindBtn(g)}</a>`).join("")}</div>` : ""}</div>`);
  }
  return parts.join("");
}

async function monthView(sports, d) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1, 12);
  const daysIn = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const [calR, favR] = await Promise.all([Promise.allSettled(sports.map((s) => seasonCalendar(s))), favoriteSchedules(sports).catch(() => [])]);
  // which sports have games each day: basketball calendars list game dates; football gets dates from your teams' schedules
  const gameDays = new Map();
  calR.forEach((r, i) => {
    if (r.status !== "fulfilled" || r.value.type !== "day") return;
    for (const iso of r.value.entries) {
      const k = isoDay(new Date(iso)); // ESPN marks each day at 07:00Z, which is the right local date in US time zones
      if (!gameDays.has(k)) gameDays.set(k, new Set());
      gameDays.get(k).add(sports[i]);
    }
  });
  const favByDay = new Map();
  for (const g of favR.filter(teamFilter)) {
    cache.set(`${g.sport}:${g.id}`, g);
    if (!favByDay.has(g.day)) favByDay.set(g.day, []);
    favByDay.get(g.day).push(g);
    if (!gameDays.has(g.day)) gameDays.set(g.day, new Set());
    gameDays.get(g.day).add(g.sport);
  }
  const lead = (first.getDay() + 6) % 7; // weeks start Monday
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell off"></div>');
  for (let day = 1; day <= daysIn; day++) {
    const k = isoDay(new Date(d.getFullYear(), d.getMonth(), day, 12));
    const fav = favByDay.get(k) || [];
    const sp = [...(gameDays.get(k) || [])];
    const isToday = k === isoDay(today());
    const opp = (g) => { const mine = isFavTeam(g.sport, g.home.id) || favPlayerTeamIds(g.sport).has(g.home.id) ? g.home : g.away; return mine === g.home ? g.away : g.home; };
    cells.push(`<button class="cal-cell ${isToday ? "today" : ""} ${k === ui.date ? "sel" : ""} ${fav.length ? "has-fav" : ""}" data-cal="day" data-v="${k}" aria-label="${esc(fmtDay(new Date(k + "T12:00")))}${fav.length ? `, ${fav.length} of your games` : ""}">
      <span class="dn">${day}</span>${fav.slice(0, 2).map((g) => `<img src="${esc(opp(g).logo || "")}" alt="" class="cal-logo" loading="lazy">`).join("")}
      <span class="dots">${sp.map((s) => `<i style="background:var(--${s})"></i>`).join("")}</span></button>`);
  }
  const monthFav = favR.filter((g) => g.start.getMonth() === d.getMonth() && g.start.getFullYear() === d.getFullYear() && teamFilter(g));
  const upcomingFav = monthFav.filter((g) => g.state === "pre");
  const phases = await phasesHtml(sports, calR);
  return `${nav(first, 0, "month")}
    <div class="cal-grid">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => `<div class="cal-wd">${w}</div>`).join("")}${cells.join("")}</div>
    <div class="row small muted" style="gap:12px;flex-wrap:wrap;margin:8px 2px">${sports.map((s) => `<span><i class="lgd" style="background:var(--${s})"></i>${SPORTS[s].label}</span>`).join("")}<span>· logos = your teams' opponents</span></div>
    ${section("myMonth", `<span style="color:var(--fav)">★</span> Your games this month`, monthFav.length ? `<div class="card list">${monthFav.map((g) => {
      const homeMine = isFavTeam(g.sport, g.home.id) || favPlayerTeamIds(g.sport).has(g.home.id);
      const mine = homeMine ? g.home : g.away, op = homeMine ? g.away : g.home;
      return `<a class="li" href="#/game/${g.sport}/${g.id}">${logo(mine)}<div class="sp"><div class="t ellip">${esc(mine.short)} ${mine === g.home ? "vs" : "@"} ${esc(op.short)}</div><div class="s">${sportBadge(g.sport)} ${esc(fmtDay(g.start))} · ${g.state === "pre" ? fmtTime(g.start) : esc(g.detail)}${g.tv.length ? ` · ${esc(g.tv[0])}` : ""}</div></div>${g.state === "post" ? `<b>${g.away.score}-${g.home.score}</b>` : ""}${remindBtn(g)}</a>`;
    }).join("")}</div>${upcomingFav.length > 1 ? `<div style="text-align:center;margin-top:10px"><button class="btn" data-cal="remindall">${ICON.cal} Add all ${upcomingFav.length} upcoming to my calendar</button></div>` : ""}`
      : empty(state.teams.length || state.players.length ? "None of your teams play this month." : "Follow teams to see their games on the calendar."))}
    ${phases}`;
}

// season phases, playoff rounds and tournaments from ESPN's league calendars
async function phasesHtml(sports, calR) {
  const out = [];
  calR.forEach((r, i) => {
    const s = sports[i];
    if (r.status !== "fulfilled") return;
    const { type, entries } = r.value;
    if (type === "day" && entries.length) {
      const a = new Date(entries[0]), b = new Date(entries[entries.length - 1]);
      out.push(`<div class="li">${sportBadge(s)}<div class="sp"><div class="t">Game days on ESPN's calendar</div><div class="s">${esc(fmtDay(a))} – ${esc(fmtDay(b))}. ${s === "nba" ? "NBA Cup knockouts, play-in and playoffs" : "Conference tournaments and March Madness"} aren't on ESPN's calendar yet; they'll show once scheduled.</div></div></div>`);
      return;
    }
    const now = Date.now();
    for (const ph of entries) {
      if (/off ?season/i.test(ph.label)) continue;
      const end = new Date(ph.endDate);
      if (end < now) continue;
      const wk = (ph.entries || []).filter((e) => new Date(e.endDate) >= now);
      const post = /post|bowl|playoff/i.test(ph.label);
      out.push(`<div class="li" style="align-items:flex-start">${sportBadge(s)}<div class="sp"><div class="t">${esc(ph.label)}${post ? ' <span class="badge b-plain">Postseason</span>' : ""}</div>
        <div class="s">${(post ? wk : wk.slice(0, 3)).map((e) => `${esc(e.label)} <span class="muted">(${esc(e.detail || fmtDay(new Date(e.startDate)))})</span>`).join(" · ")}${!post && wk.length > 3 ? ` · … ${esc(wk[wk.length - 1].label)} (${esc(wk[wk.length - 1].detail || "")})` : ""}</div></div></div>`);
    }
  });
  return out.length ? section("phases", "Season, playoffs and tournaments", `<div class="card list">${out.join("")}</div>`, "ESPN league calendars") : "";
}
