// Data layer. Two kinds of sources, kept apart:
//   ESPN public APIs  -> actual data (scores, schedules, rosters, stats, standings, news)
//   Your model feeds  -> predictions, read from what each model already publishes on this site
// To add a sport: add an entry to SPORTS with its ESPN path and a model adapter.

import { getJSON, ymd, isoDay, addDays, today } from "./core.js?v=9";

const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const WEB = "https://site.web.api.espn.com/apis";

export const SPORTS = {
  nba:   { key: "nba", label: "NBA", name: "NBA", path: "basketball/nba", league: "nba", kind: "basketball",
           board: "", model: "nba", modelName: "NBA Model" },
  nfl:   { key: "nfl", label: "NFL", name: "NFL", path: "football/nfl", league: "nfl", kind: "football",
           board: "", model: "nfl", modelName: "NFL Model" },
  ncaab: { key: "ncaab", label: "NCAAB", name: "College Basketball", path: "basketball/mens-college-basketball",
           league: "mens-college-basketball", kind: "basketball", board: "&groups=50&limit=400", model: "ncaab", modelName: "NCAAB Model" },
  cfb:   { key: "cfb", label: "CFB", name: "College Football", path: "football/college-football",
           league: "college-football", kind: "football", board: "&groups=80&limit=300", model: "cfb", modelName: "CFB Model" },
};
export const SPORT_KEYS = Object.keys(SPORTS);
export const byLeague = (league) => SPORT_KEYS.find((k) => SPORTS[k].league === league);

// ---------- teams (static file built by tools/build_teams.py; ESPN's teams list blocks browsers)
let teamsP;
export function teams() {
  teamsP ||= getJSON("data/teams.json", { label: "Team list (ESPN, saved)", ttl: 1e12 });
  return teamsP;
}
export async function team(sport, id) {
  const d = await teams();
  return d.sports[sport].find((t) => t.id === String(id));
}

// ---------- scoreboards
function normTeam(c, sport) {
  const t = c.team || {};
  const rec = (c.records || []).find((r) => r.type === "total" || r.name === "overall") || (c.records || [])[0];
  const rank = c.curatedRank?.current;
  return {
    id: String(t.id), name: t.displayName, short: t.shortDisplayName || t.name, abbr: t.abbreviation,
    logo: t.logo || t.logos?.[0]?.href, color: t.color ? "#" + t.color : "#556", alt: t.alternateColor ? "#" + t.alternateColor : null,
    score: c.score != null && c.score !== "" ? Number(c.score) : null, winner: !!c.winner,
    record: rec?.summary || null, rank: rank && rank <= 25 ? rank : null,
    leaders: (c.leaders || []).map((l) => ({
      cat: l.name, label: l.shortDisplayName || l.displayName,
      value: l.leaders?.[0]?.value, text: l.leaders?.[0]?.displayValue,
      athlete: l.leaders?.[0]?.athlete && {
        id: String(l.leaders[0].athlete.id), name: l.leaders[0].athlete.displayName,
        short: l.leaders[0].athlete.shortName, headshot: l.leaders[0].athlete.headshot,
        pos: l.leaders[0].athlete.position?.abbreviation,
      },
    })).filter((l) => l.athlete),
  };
}

export function normEvent(e, sport) {
  const c = e.competitions[0];
  const st = c.status || e.status;
  const home = c.competitors.find((x) => x.homeAway === "home");
  const away = c.competitors.find((x) => x.homeAway === "away");
  const start = new Date(e.date);
  // scoreboard: {market, names[]}; team schedule: {type, market:{type}, media:{shortName}}
  const bc = (c.broadcasts || []).map((b) => ({ national: (b.market?.type || b.market) === "National" || b.market === "national",
    names: b.names || [b.media?.shortName].filter(Boolean) }));
  const national = bc.filter((b) => b.national).flatMap((b) => b.names);
  const odds = c.odds?.[0];
  return {
    sport, id: String(e.id), start, day: isoDay(start), name: e.shortName,
    state: st.type.state, // pre | in | post
    detail: st.type.shortDetail, completed: st.type.completed, period: st.period, clock: st.displayClock,
    neutral: !!c.neutralSite, venue: c.venue?.fullName, national,
    tv: national.length ? national : bc.flatMap((b) => b.names).slice(0, 2),
    note: c.notes?.[0]?.headline || null,
    home: normTeam(home, sport), away: normTeam(away, sport),
    espnOdds: odds ? { book: odds.provider?.name, details: odds.details, total: odds.overUnder } : null,
    model: null,
  };
}

export async function boardDay(sport, d) {
  const s = SPORTS[sport];
  const url = `${SITE}/${s.path}/scoreboard?dates=${ymd(d)}${s.board}`;
  const j = await getJSON(url, { label: `${s.label} scoreboard`, ttl: 25_000 });
  return (j.events || []).map((e) => normEvent(e, sport));
}
async function boardWeek(sport) {
  const s = SPORTS[sport];
  const j = await getJSON(`${SITE}/${s.path}/scoreboard?${s.board.slice(1)}`, { label: `${s.label} scoreboard`, ttl: 25_000 });
  return (j.events || []).map((e) => normEvent(e, sport));
}

// Yesterday through the next few days for one sport, with model predictions attached.
export async function slate(sport) {
  const t = today();
  const jobs = [-1, 0, 1].map((n) => boardDay(sport, addDays(t, n)));
  if (SPORTS[sport].kind === "football") jobs.push(boardWeek(sport)); // football: the rest of this week
  const parts = await Promise.allSettled(jobs);
  if (parts.every((p) => p.status === "rejected")) throw parts[0].reason;
  const seen = new Map();
  for (const p of parts) if (p.status === "fulfilled") for (const g of p.value) seen.set(g.id, g);
  const games = [...seen.values()].sort((a, b) => a.start - b.start);
  await attachModel(sport, games).catch(() => {});
  return games;
}

// ---------- model adapters: each turns that model's published file into one shape
//   { source, updated, home_win_prob, spread_home (negative = home favored), total|null,
//     market: { book, spread_home, total, spread_open, total_open, home_ml, away_ml } | null, notes }
const NFL_ABBR = { LAR: "LA", WSH: "WAS" }; // ESPN -> nflverse

const num = (x) => (x === null || x === undefined || x === "" || Number.isNaN(+x) ? null : +x);

export async function modelFeed(sport) {
  const s = SPORTS[sport];
  if (sport === "nfl") {
    const d = await getJSON(`../nfl/predictions.json`, { label: "NFL Model predictions", ttl: 300_000 });
    const map = new Map();
    for (const games of Object.values(d.weeks || {})) {
      for (const g of games) {
        const k = `${g.away}@${g.home}`;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push({ date: g.date, m: {
          source: s.modelName, version: d.model_version, updated: d.generated_at,
          home_win_prob: num(g.home_prob),
          spread_home: g.model_spread == null ? null : -g.model_spread, // file: home margin (+ = home wins)
          total: num(g.model_total),
          market: g.market || g.vegas_spread != null ? {
            book: "Consensus (nflverse)",
            spread_home: g.vegas_spread == null ? null : -g.vegas_spread,
            total: num(g.total_line), home_ml: num(g.market?.home_ml), away_ml: num(g.market?.away_ml),
          } : null,
          notes: g.alerts || [],
          qbs: [g.away_qb, g.home_qb],
          qbRatings: [num(g.away_qb_rating), num(g.home_qb_rating)],
          explain: g.explain || null, // the model's breakdown of its margin, home perspective
          injuries: g.injuries ? { away: (g.injuries[g.away] || []), home: (g.injuries[g.home] || []) } : null,
        } });
      }
    }
    const ab = (t) => NFL_ABBR[t.abbr] || t.abbr;
    // team ratings for all 32 teams, with ranks (Elo, offense EPA/play, defense EPA/play allowed: lower is better)
    const R = (d.ratings || []).map((r) => ({ ...r }));
    const rank = (key, desc) => [...R].sort((a, b) => (desc ? b[key] - a[key] : a[key] - b[key])).forEach((r, i) => (r[`${key}_rank`] = i + 1));
    rank("elo", true); rank("off_epa", true); rank("def_epa", false);
    const ratings = new Map(R.map((r) => [r.team, r]));
    // match on teams + date within a day (the file's dates are US Eastern; the device may not be)
    return { updated: d.generated_at, ratings, teamKey: ab, lookup: (game) => (map.get(`${ab(game.away)}@${ab(game.home)}`) || [])
      .find((x) => Math.abs(new Date(x.date + "T12:00") - new Date(game.day + "T12:00")) <= 864e5)?.m };
  }
  const d = await getJSON(`../${s.model}/games.json`, { label: `${s.modelName} games`, ttl: 300_000 });
  const byId = new Map(), byDay = new Map(), teamStats = new Map();
  for (const g of d.games || []) {
    // latest model numbers per team (games are in date order)
    // per team, keep the model's numbers for its next game (or its latest one if none is ahead)
    const todayKey = isoDay(today());
    for (const side of ["away", "home"]) {
      const ab = g[side]?.abbr;
      if (!ab || !Object.keys(g[side].stats || {}).length) continue;
      const cur = teamStats.get(ab);
      const better = !cur || (cur.date < todayKey ? g.date > cur.date : g.date >= todayKey && g.date < cur.date);
      if (better) teamStats.set(ab, { date: g.date, stats: g[side].stats });
    }
    if (!g.model) continue;
    const L = g.lines;
    const m = {
      source: s.modelName, updated: d.generated_at,
      home_win_prob: num(g.model.home_win_prob), spread_home: num(g.model.spread), total: num(g.model.total),
      market: L && (L.spread != null || L.total != null) ? {
        book: L.book, spread_home: num(L.spread), total: num(L.total), spread_open: num(L.spread_open),
        total_open: num(L.total_open), home_ml: num(L.home_ml), away_ml: num(L.away_ml),
      } : null,
      notes: g.notes || [],
      injuries: { away: g.away?.injuries || [], home: g.home?.injuries || [] },
      stats: { away: g.away?.stats || {}, home: g.home?.stats || {} },
    };
    const id = String(g.id).split("-").pop();
    if (/^\d+$/.test(id)) byId.set(id, m);
    byDay.set(`${g.date}|${g.home?.abbr}`, m);
  }
  return { updated: d.generated_at, teamStats, lookup: (game) => byId.get(game.id) || byDay.get(`${game.day}|${game.home.abbr}`) };
}

// ---------- team stats, roster, league table (ESPN)
export async function teamStatistics(sport, id) {
  const s = SPORTS[sport];
  return getJSON(`${SITE}/${s.path}/teams/${id}/statistics`, { label: `${s.label} team stats (ESPN)`, ttl: 600_000 });
}
export async function roster(sport, id) {
  const s = SPORTS[sport];
  return getJSON(`${SITE}/${s.path}/teams/${id}/roster`, { label: `${s.label} roster (ESPN)`, ttl: 3_600_000 });
}
// Every team's standings row, flattened, with league ranks for scoring offense, defense and margin
export async function leagueTable(sport) {
  const d = await standings(sport);
  const rows = [];
  const walk = (node, conf) => {
    for (const e of node.standings?.entries || []) {
      const st = {};
      // a stat can repeat for home/road splits under the same type: the first one is the overall figure
      for (const x of e.stats || []) { if (!(x.type in st)) st[x.type] = x; if (!(x.name in st)) st[x.name] = x; }
      const val = (k) => num(st[k]?.value);
      // games played from the overall record ("7-1"); college "wins"/"losses" can be conference-only
      const ov = String(st.total?.displayValue || "").split("-").map(Number).filter(Number.isFinite);
      const gp = ov.length ? ov.reduce((a, b) => a + b, 0) : (val("wins") || 0) + (val("losses") || 0) + (val("ties") || 0);
      const pf = val("avgpointsfor") ?? (val("pointsfor") != null && gp ? val("pointsfor") / gp : null);
      const pa = val("avgpointsagainst") ?? (val("pointsagainst") != null && gp ? val("pointsagainst") / gp : null);
      rows.push({ id: String(e.team.id), abbr: e.team.abbreviation, name: e.team.displayName, logo: e.team.logos?.[0]?.href,
        group: node.name, conf: conf || node.name, gp, pf, pa, diff: pf != null && pa != null ? pf - pa : null,
        rec: { total: st.total?.displayValue, home: st.home?.displayValue, road: st.road?.displayValue, conf: st.vsconf?.displayValue,
          div: st.vsdiv?.displayValue, streak: st.streak?.displayValue, pct: st.winpercent?.displayValue, gb: st.gamesbehind?.displayValue, seed: st.playoffseed?.displayValue } });
    }
    for (const c of node.children || []) walk(c, conf || node.name);
  };
  (d.children || []).forEach((c) => walk(c, null));
  const played = rows.filter((r) => r.gp > 0);
  const rank = (key, desc) => [...played].filter((r) => r[key] != null).sort((a, b) => (desc ? b[key] - a[key] : a[key] - b[key])).forEach((r, i) => (r[`${key}Rank`] = i + 1));
  rank("pf", true); rank("pa", false); rank("diff", true);
  return { rows, n: played.length, season: d.seasons?.[0]?.displayName || "" };
}

async function attachModel(sport, games) {
  const f = await modelFeed(sport);
  for (const g of games) g.model = f.lookup(g) || null;
}

// "BOS -3.5" style from a home-perspective spread
export function spreadText(spreadHome, g) {
  if (spreadHome == null) return "–";
  if (Math.abs(spreadHome) < 0.05) return "PK";
  return spreadHome < 0 ? `${g.home.abbr} ${fmt1(spreadHome)}` : `${g.away.abbr} ${fmt1(-spreadHome)}`;
}
// one decimal, as the model/book published it (no rounding to half points)
export const fmt1 = (x) => (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, "");
export const pct = (p) => (p == null ? "–" : p >= 0.995 ? ">99%" : p <= 0.005 ? "<1%" : `${Math.round(p * 100)}%`);

// ---------- news (ESPN). Articles carry team/athlete tags we use to find your favorites.
export async function news(sport, limit = 12) {
  const s = SPORTS[sport];
  const j = await getJSON(`${SITE}/${s.path}/news?limit=${limit}`, { label: `${s.label} news`, ttl: 300_000 });
  return (j.articles || []).filter((a) => a.type !== "Media" || a.headline).map((a) => ({
    sport, id: String(a.id), headline: a.headline, desc: a.description, published: a.published,
    url: a.links?.web?.href, image: a.images?.[0]?.url, byline: a.byline, source: "ESPN",
    teamIds: (a.categories || []).filter((c) => c.type === "team" && c.teamId).map((c) => String(c.teamId)),
    athleteIds: (a.categories || []).filter((c) => c.type === "athlete" && c.athleteId).map((c) => String(c.athleteId)),
  }));
}

// ---------- player search (ESPN search API), limited to our leagues
export async function searchPlayers(q) {
  const j = await getJSON(`${WEB}/common/v3/search?query=${encodeURIComponent(q)}&limit=40&type=player`,
    { label: "Player search (ESPN)", ttl: 120_000 });
  return (j.items || []).map((i) => {
    const sport = byLeague(i.league);
    if (!sport) return null;
    const t = i.teamRelationships?.[0]?.core;
    return { sport, id: String(i.id), name: i.displayName, teamId: t?.id ? String(t.id) : null,
      team: t?.displayName || null, abbr: t?.abbreviation || null,
      headshot: i.headshot?.href || null };
  }).filter(Boolean);
}

// ---------- athlete + team schedule + standings
export async function athlete(sport, id) {
  const s = SPORTS[sport];
  const j = await getJSON(`${WEB}/common/v3/sports/${s.path}/athletes/${id}`, { label: `${s.label} player (ESPN)`, ttl: 300_000 });
  return j.athlete;
}
export async function schedule(sport, teamId) {
  const s = SPORTS[sport];
  const j = await getJSON(`${SITE}/${s.path}/teams/${teamId}/schedule`, { label: `${s.label} team schedule`, ttl: 120_000 });
  const games = (j.events || []).map((e) => {
    try {
      const g = normEvent(e, sport);
      for (const c of e.competitions[0].competitors) { // schedule scores come as objects
        const side = c.homeAway === "home" ? g.home : g.away;
        if (c.score && typeof c.score === "object") side.score = num(c.score.value ?? c.score.displayValue);
      }
      return g;
    } catch { return null; }
  }).filter(Boolean);
  await attachModel(sport, games).catch(() => {});
  return { team: j.team, games };
}
export async function standings(sport) {
  const s = SPORTS[sport];
  const level = sport === "nfl" ? "?level=3" : "";
  return getJSON(`${WEB}/v2/sports/${s.path}/standings${level}`, { label: `${s.label} standings`, ttl: 300_000 });
}

// ---------- game center (ESPN summary: box score, plays/drives, win probability, odds, injuries)
export async function summary(sport, id, ttl = 15_000) {
  const s = SPORTS[sport];
  const d = await getJSON(`${SITE}/${s.path}/summary?event=${id}`, { label: `${s.label} game center`, ttl });
  const comp = d.header.competitions[0];
  const g = normEvent({ id, date: comp.date, shortName: d.header.shortName, status: comp.status, competitions: [comp] }, sport);
  // summary scores are strings, linescores live here
  for (const c of comp.competitors) {
    const side = c.homeAway === "home" ? g.home : g.away;
    side.lines = (c.linescores || []).map((l) => l.displayValue);
    side.records = (c.record || []).map((r) => ({ type: r.type, text: r.displayValue || r.summary }));
    if (!side.record) side.record = side.records.find((r) => r.type === "total")?.text || null;
  }
  g.venue = d.gameInfo?.venue?.fullName || g.venue;
  g.city = [d.gameInfo?.venue?.address?.city, d.gameInfo?.venue?.address?.state].filter(Boolean).join(", ");
  g.attendance = d.gameInfo?.attendance || null;
  try { g.model = (await modelFeed(sport)).lookup(g) || null; } catch { g.model = null; }
  return { g, d };
}

// A team's games in an earlier season (for head-to-head history)
export async function seasonSchedule(sport, teamId, season) {
  const s = SPORTS[sport];
  const j = await getJSON(`${SITE}/${s.path}/teams/${teamId}/schedule?season=${season}`, { label: `${s.label} past schedules`, ttl: 3_600_000 });
  return (j.events || []).map((e) => {
    try {
      const g = normEvent(e, sport);
      for (const c of e.competitions[0].competitors) {
        const side = c.homeAway === "home" ? g.home : g.away;
        if (c.score && typeof c.score === "object") side.score = num(c.score.value ?? c.score.displayValue);
      }
      return g;
    } catch { return null; }
  }).filter(Boolean);
}
