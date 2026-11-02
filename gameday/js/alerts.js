// Notification center for your teams and players, built from live data each time it runs:
// games starting soon, live and final scores, big performances, injury-report changes, news, and
// where your model and the book disagree on your team's next game. Optional phone alerts while
// GAME DAY is open (a true background push would need a server, which this app doesn't have).
import { esc, ago, fmtTime, dayLabel, isoDay, addDays, today, state, save, isFavTeam, isFavPlayer, favTeamIds, favPlayerTeamIds } from "./core.js?v=11";
import { SPORTS, SPORT_KEYS, slate, leagueNews, leagueInjuries, HAS_INJURY_REPORT, spreadText, fmt1 } from "./data.js?v=11";
import { sportBadge, modelBadge, logo, headshot, section, empty, errBox, skel } from "./ui.js?v=11";

export const KINDS = [
  ["soon", "Game starting soon", "Your teams, 3 hours before"], ["live", "Live games", "When your teams' games are in progress"],
  ["final", "Final scores", "Results for your teams"], ["perf", "Big performances", "Your players leading their game"],
  ["injury", "Injury updates", "Your players on, or coming off, the NBA/NFL injury report"], ["news", "News", "Stories tagged with your teams or players"],
  ["model", "Model vs line", "Your model 3+ pts off the book on your team's next game"],
];
const st = () => {
  state.alerts ||= { seen: [], notified: [], inj: {}, kinds: Object.fromEntries(KINDS.map(([k]) => [k, true])), push: false };
  for (const [k] of KINDS) if (!(k in state.alerts.kinds)) state.alerts.kinds[k] = true;
  return state.alerts;
};

const mine = (g) => [g.home, g.away].filter((t) => isFavTeam(g.sport, t.id) || favPlayerTeamIds(g.sport).has(t.id));

export async function computeAlerts(games = null) {
  const A = st();
  const sports = SPORT_KEYS.filter((k) => state.sports[k]);
  if (!state.teams.length && !state.players.length) return [];
  if (!games) games = (await Promise.allSettled(sports.map((s) => slate(s)))).flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const items = [];
  const now = Date.now(), yKey = isoDay(addDays(today(), -1));
  for (const g of games) {
    const my = mine(g);
    if (!my.length) continue;
    const t = my[0], op = t === g.home ? g.away : g.home, at = t === g.home ? "vs" : "@";
    const href = `#/game/${g.sport}/${g.id}`;
    if (g.state === "pre" && g.start - now < 3 * 3600e3 && g.start > now)
      items.push({ id: `soon:${g.sport}:${g.id}`, kind: "soon", sport: g.sport, time: +g.start - 3 * 3600e3, img: t.logo, title: `${t.short} ${at} ${op.short} at ${fmtTime(g.start)}`, text: g.tv.length ? `On ${g.tv.join(", ")}` : "Starting soon", href });
    if (g.state === "in")
      items.push({ id: `live:${g.sport}:${g.id}`, kind: "live", sport: g.sport, time: +g.start, img: t.logo, title: `Live: ${g.away.abbr} ${g.away.score} – ${g.home.abbr} ${g.home.score}`, text: g.detail, href });
    if (g.state === "post" && g.day >= yKey) {
      const won = t.score > op.score;
      items.push({ id: `final:${g.sport}:${g.id}`, kind: "final", sport: g.sport, time: +g.start + 2.5 * 3600e3, img: t.logo,
        title: `${t.short} ${won ? "beat" : "lost to"} ${op.short} ${Math.max(t.score, op.score)}-${Math.min(t.score, op.score)}`, text: `Final · ${dayLabel(g.start)}`, href });
    }
    // model vs line on your team's next game (labeled as your model)
    const m = g.model;
    if (g.state === "pre" && m?.spread_home != null && m.market?.spread_home != null) {
      const diff = m.spread_home - m.market.spread_home;
      if (Math.abs(diff) >= 3) {
        const side = diff < 0 ? g.home : g.away;
        items.push({ id: `model:${g.sport}:${g.id}`, kind: "model", sport: g.sport, time: +g.start - 24 * 3600e3, img: side.logo,
          title: `${m.source} is ${fmt1(Math.abs(diff))} pts higher on ${side.short} than ${m.market.book || "the book"}`,
          text: `${g.away.abbr} @ ${g.home.abbr}: model ${spreadText(m.spread_home, g)}, line ${spreadText(m.market.spread_home, g)}`, href });
      }
    }
  }
  // big performances by players you follow (game leaders, live or final, today/yesterday)
  for (const g of games.filter((g) => g.state !== "pre" && g.day >= yKey)) for (const side of [g.away, g.home]) for (const l of side.leaders || [])
    if (isFavPlayer(g.sport, l.athlete.id))
      items.push({ id: `perf:${g.sport}:${g.id}:${l.athlete.id}:${l.cat}`, kind: "perf", sport: g.sport, time: +g.start + 2 * 3600e3, img: l.athlete.headshot,
        title: `${l.athlete.name}: ${l.text}`, text: `Led ${side.abbr} in ${l.label.toLowerCase()} · ${g.state === "in" ? "live" : "final"} vs ${(side === g.home ? g.away : g.home).abbr}`, href: `#/game/${g.sport}/${g.id}` });
  // injury report changes for players you follow
  const injSports = sports.filter((s) => HAS_INJURY_REPORT[s] && state.players.some((p) => p.sport === s));
  const inj = await Promise.allSettled(injSports.map((s) => leagueInjuries(s)));
  inj.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const s = injSports[i];
    const onReport = new Map();
    for (const t of r.value.teams) for (const x of t.list) if (x.status !== "Active") onReport.set(x.id, x); // "Active" entries are notes, not injuries
    for (const p of state.players.filter((p) => p.sport === s)) {
      const key = `${s}:${p.id}`, x = onReport.get(p.id), prev = A.inj[key];
      if (x) {
        items.push({ id: `inj:${key}:${x.status}:${x.date}`, kind: "injury", sport: s, time: +new Date(x.date), img: x.headshot || p.headshot,
          title: `${p.name}: ${x.status}${x.type ? ` (${x.type})` : ""}`, text: x.short || "On the ESPN injury report", href: `#/player/${s}/${p.id}` });
        A.inj[key] = { status: x.status, at: Date.now() };
      } else if (prev && prev.status !== "clear") {
        A.inj[key] = { status: "clear", at: Date.now() };
      }
      if (!x && A.inj[key]?.status === "clear" && Date.now() - A.inj[key].at < 3 * 864e5)
        items.push({ id: `injclear:${key}:${A.inj[key].at}`, kind: "injury", sport: s, time: A.inj[key].at, img: p.headshot, title: `${p.name} is off the injury report`, text: "No longer listed by ESPN", href: `#/player/${s}/${p.id}` });
    }
  });
  // news tagged with your teams or players (last 24 hours)
  const nw = await Promise.allSettled(sports.map((s) => leagueNews(s, 30)));
  let newsN = 0;
  for (const r of nw) if (r.status === "fulfilled") for (const a of r.value.sort((x, y) => new Date(y.published) - new Date(x.published))) {
    if (newsN >= 8) break; // keep news from burying game and injury alerts
    if (Date.now() - new Date(a.published) > 864e5) continue;
    if (a.teamIds.some((id) => isFavTeam(a.sport, id)) || a.athleteIds.some((id) => isFavPlayer(a.sport, id)))
      newsN++, items.push({ id: `news:${a.id}`, kind: "news", sport: a.sport, time: +new Date(a.published), img: a.image, title: a.headline, text: `ESPN · ${ago(a.published)}`, href: a.url, ext: true });
  }
  save();
  const seenIds = new Set();
  return items.filter((x) => A.kinds[x.kind] && !seenIds.has(x.id) && seenIds.add(x.id)).sort((a, b) => b.time - a.time);
}

export const unread = (items) => { const s = new Set(st().seen); return items.filter((x) => !s.has(x.id)); };
export function markRead(items) {
  const A = st();
  A.seen = [...new Set([...items.map((x) => x.id), ...A.seen])].slice(0, 400);
  save();
}
export function setBadge(items) {
  const n = unread(items).length;
  const b = document.getElementById("bellCount");
  if (b) { b.hidden = !n; b.textContent = n > 9 ? "9+" : String(n); }
}

// phone alerts while the app is open (needs the user's permission; on iPhone, GAME DAY must be on the home screen)
export async function notifyNew(items) {
  const A = st();
  if (!A.push || !("Notification" in window) || Notification.permission !== "granted") return;
  const sent = new Set(A.notified);
  const fresh = unread(items).filter((x) => !sent.has(x.id) && ["soon", "live", "final", "injury", "perf"].includes(x.kind) && Date.now() - x.time < 6 * 3600e3).slice(0, 3);
  if (!fresh.length) return;
  const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
  for (const x of fresh) {
    const opts = { body: x.text, tag: x.id, icon: "icon-192.png", data: { href: x.href } };
    try { reg ? await reg.showNotification(x.title, opts) : new Notification(x.title, opts); } catch {}
    A.notified.unshift(x.id);
  }
  A.notified = A.notified.slice(0, 400);
  save();
}

export async function enablePush() {
  const A = st();
  if (!("Notification" in window)) return "This browser doesn't support notifications. On iPhone, add GAME DAY to your home screen first (Share → Add to Home Screen), then open it from there.";
  const p = await Notification.requestPermission();
  A.push = p === "granted";
  save();
  return A.push ? "Phone alerts are on while GAME DAY is open." : "Notifications were not allowed. You can change that in your phone's Settings.";
}

// ---------------------------------------------------------------- page
export async function viewAlerts(view) {
  view.dataset.v = "alerts";
  view.innerHTML = `<h1 class="page-title">Notifications</h1>${skel(3)}`;
  if (!state.teams.length && !state.players.length) { view.innerHTML = `<h1 class="page-title">Notifications</h1>${empty(`Follow teams and players and their alerts show up here.<br><br><button class="btn primary" data-action="search">Find teams and players</button>`)}`; return; }
  let items;
  try { items = await computeAlerts(); } catch (e) { view.innerHTML = `<h1 class="page-title">Notifications</h1>${errBox("notifications", e)}`; return; }
  const fresh = new Set(unread(items).map((x) => x.id));
  markRead(items);
  setBadge(items);
  const A = st();
  const label = Object.fromEntries(KINDS.map(([k, l]) => [k, l]));
  view.innerHTML = `<div class="row" style="justify-content:space-between"><h1 class="page-title">Notifications</h1><a class="btn" href="#/profile">Settings</a></div>
    <p class="page-sub">Built from live ESPN data and your models' files each time you open this. ${A.push ? "Phone alerts are on while GAME DAY is open." : ""}</p>
    ${items.length ? `<div class="card list">${items.map((x) => `<a class="li ${fresh.has(x.id) ? "unread" : ""}" href="${esc(x.href)}" ${x.ext ? 'target="_blank" rel="noopener"' : ""}>
      ${x.kind === "perf" || x.kind === "injury" ? headshot(x.img) : x.img ? `<img class="logo" src="${esc(x.img)}" alt="" loading="lazy" style="${x.kind === "news" ? "border-radius:8px;object-fit:cover;width:44px;height:44px" : ""}">` : ""}
      <div class="sp"><div class="t" style="font-weight:${fresh.has(x.id) ? 700 : 500}">${esc(x.title)}</div><div class="s">${sportBadge(x.sport)} ${x.kind === "model" ? modelBadge("model") + " " : ""}${esc(label[x.kind])} · ${esc(x.text)}</div></div>
      ${fresh.has(x.id) ? '<i class="udot"></i>' : ""}</a>`).join("")}</div>` : empty("Nothing new for your teams and players right now.")}`;
}
