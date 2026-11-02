// Odds Center: DraftKings lines from ESPN (open -> latest), no-vig implied probabilities, your models' numbers and
// the gap to the book, your models' tracked plays and records, and NFL against-the-spread records.
// Not live in-play odds. FanDuel isn't connected.
import { esc, ago, fmtTime, dayLabel, state, isFavTeam, favTeamIds, favPlayerTeamIds, getJSON } from "./core.js?v=22";
import { SPORTS, SPORT_KEYS, slate, spreadText, fmt1, pct, modelFeed } from "./data.js?v=22";
import { sportBadge, modelBadge, marketBadge, logo, section, empty, errBox, skel } from "./ui.js?v=22";

const ui = { sport: "all", sort: "gap", mine: false, tab: "lines" };
const TABS = [["lines", "Lines"], ["plays", "Your models' plays"], ["records", "Records & ATS"]];
const APP = { nba: "../nba/", nfl: "../nfl/", ncaab: "../ncaab/", cfb: "../cfb/" };

// American odds -> implied probability; two sides -> no-vig probability for each
export const implied = (ml) => (ml == null ? null : ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100));
export function noVig(a, b) { const pa = implied(a), pb = implied(b); return pa == null || pb == null ? [null, null] : [pa / (pa + pb), pb / (pa + pb)]; }
const amer = (x) => (x == null ? "–" : x > 0 ? `+${x}` : `${x}`);
const ln = (x) => (x == null ? "–" : x > 0 ? `+${fmt1(x)}` : fmt1(x));

export async function viewOdds(view, sub) {
  ui.tab = TABS.some(([k]) => k === sub) ? sub : "lines";
  const sports = SPORT_KEYS.filter((k) => state.sports[k]);
  if (ui.sport !== "all" && !sports.includes(ui.sport)) ui.sport = "all";
  const active = ui.sport === "all" ? sports : [ui.sport];
  view.dataset.v = "odds";
  view.innerHTML = `<div class="row" style="justify-content:space-between"><h1 class="page-title">Odds</h1><a class="btn" href="../">Best Plays hub</a></div>
    <div class="subtabs">${TABS.map(([k, l]) => `<a href="#/odds/${k}" aria-current="${k === ui.tab ? "page" : "false"}">${l}</a>`).join("")}</div>
    <div class="chips" style="padding-top:0">${[["all", "All"], ...sports.map((k) => [k, SPORTS[k].label])].map(([k, l]) => `<button class="chip" data-od="sport" data-v="${k}" aria-pressed="${ui.sport === k}">${k !== "all" ? `<span class="sw" style="background:var(--${k})"></span>` : ""}${l}</button>`).join("")}
      <button class="chip" data-od="mine" aria-pressed="${ui.mine}">★ Mine only</button></div>
    <div id="odBody">${skel(3)}</div>`;
  view.onclick = (e) => {
    const b = e.target.closest("[data-od]");
    if (!b) return;
    if (b.dataset.od === "sport") ui.sport = b.dataset.v;
    if (b.dataset.od === "mine") ui.mine = !ui.mine;
    if (b.dataset.od === "sort") ui.sort = b.dataset.v;
    viewOdds(view, ui.tab);
  };
  const body = view.querySelector("#odBody");
  try {
    if (ui.tab === "lines") body.innerHTML = await lines(active);
    if (ui.tab === "plays") body.innerHTML = await plays(active);
    if (ui.tab === "records") body.innerHTML = await records(active);
  } catch (e) { body.innerHTML = errBox("odds", e); console.error(e); }
}

const isMine = (g) => [g.home, g.away].some((t) => isFavTeam(g.sport, t.id) || favPlayerTeamIds(g.sport).has(t.id));

// ---------------------------------------------------------------- lines
async function lines(sports) {
  const res = await Promise.allSettled(sports.map((s) => slate(s)));
  const fetched = new Date();
  let games = res.flatMap((r) => (r.status === "fulfilled" ? r.value : [])).filter((g) => g.state === "pre" && (g.espnOdds || g.model?.market));
  if (ui.mine) games = games.filter(isMine);
  const gap = (g) => {
    const m = g.model, sp = g.espnOdds?.spreadHome?.cur ?? m?.market?.spread_home;
    return m?.spread_home != null && sp != null ? Math.abs(m.spread_home - sp) : -1;
  };
  games.sort((a, b) => (ui.sort === "gap" ? gap(b) - gap(a) : 0) || (ui.sort === "move" ? move(b) - move(a) : 0) || a.start - b.start);
  const fails = sports.filter((s, i) => res[i].status === "rejected");
  const head = `<div class="seg" style="margin-bottom:12px">${[["gap", "Biggest model gap"], ["move", "Most line movement"], ["time", "Start time"]].map(([k, l]) => `<button data-od="sort" data-v="${k}" aria-pressed="${ui.sort === k}">${l}</button>`).join("")}</div>
    ${fails.length ? `<div class="err" style="margin-bottom:10px">Couldn't load ${fails.map((s) => SPORTS[s].label).join(", ")} lines.</div>` : ""}`;
  const shown = games.slice(0, 40);
  return head + (shown.length ? `<div class="grid cols">${shown.map(oddsCard).join("")}</div>` : empty(ui.mine ? "No upcoming games with lines for your teams." : "No upcoming games with lines right now.")) +
    `<div class="card pad small muted" style="margin-top:14px;line-height:1.5">${marketBadge("DraftKings")} DraftKings lines from ESPN's odds feed, opening number → ESPN's latest, fetched ${ago(fetched)}. These aren't live in-play prices, and ESPN can lag the book. FanDuel isn't connected.<br>
      Implied % removes the vig from the two moneylines. ${modelBadge("model")} numbers come from your models' published files, shown next to the line, never blended.${games.length > shown.length ? `<br>Showing ${shown.length} of ${games.length} games.` : ""}</div>`;
}
const move = (g) => { const s = g.espnOdds?.spreadHome; return s?.open != null && s?.cur != null ? Math.abs(s.cur - s.open) : -1; };

function oddsCard(g) {
  const o = g.espnOdds, m = g.model;
  const sh = o?.spreadHome?.cur ?? m?.market?.spread_home, sho = o?.spreadHome?.open ?? m?.market?.spread_open;
  const tot = o?.over?.cur ?? o?.total ?? m?.market?.total, toto = o?.over?.open ?? m?.market?.total_open;
  const mlH = o?.mlHome?.cur ?? m?.market?.home_ml, mlA = o?.mlAway?.cur ?? m?.market?.away_ml;
  const [pA, pH] = noVig(mlA, mlH);
  const arrow = (a, b) => (a == null || b == null || a === b ? "" : `<span class="mvd">${ln(a)} → </span>`);
  const book = o?.book || m?.market?.book || "Book";
  const gapPts = m?.spread_home != null && sh != null ? m.spread_home - sh : null;
  const gapTot = m?.total != null && tot != null ? m.total - tot : null;
  const fav = isMine(g);
  return `<div class="card odds ${fav ? "fav" : ""}">
    <a class="game-top" href="#/game/${g.sport}/${g.id}">${sportBadge(g.sport)}${fav ? '<span class="reason">★ Yours</span>' : ""}<span class="status">${esc(dayLabel(g.start))} · ${fmtTime(g.start)}</span></a>
    <table class="otbl"><thead><tr><th></th><th>Spread</th><th>ML</th><th>No-vig</th>${m ? `<th class="mh">Model</th>` : ""}</tr></thead><tbody>
      ${[["away", g.away, -1, mlA, pA, o?.spreadAway], ["home", g.home, 1, mlH, pH, o?.spreadHome]].map(([k, t, sgn, ml, p, spd]) => {
        const line = sh == null ? null : k === "home" ? sh : -sh, open = sho == null ? null : k === "home" ? sho : -sho;
        const mWin = m?.home_win_prob == null ? null : k === "home" ? m.home_win_prob : 1 - m.home_win_prob;
        const mLine = m?.spread_home == null ? null : k === "home" ? m.spread_home : -m.spread_home;
        return `<tr><td><span class="tm">${logo(t, "logo-sm")}${esc(t.abbr)}</span></td>
          <td>${arrow(open, line)}<b>${ln(line)}</b>${spd?.price != null ? ` <span class="muted small opx">${amer(spd.price)}</span>` : ""}</td>
          <td>${(k === "home" ? o?.mlHome?.open : o?.mlAway?.open) != null && (k === "home" ? o.mlHome.open : o.mlAway.open) !== ml ? `<span class="mvd">${amer(k === "home" ? o.mlHome.open : o.mlAway.open)} → </span>` : ""}${amer(ml)}</td>
          <td>${p == null ? "–" : pct(p)}</td>
          ${m ? `<td class="mc">${ln(mLine)}${mWin != null ? ` <span class="small">${pct(mWin)}</span>` : ""}</td>` : ""}</tr>`;
      }).join("")}
      <tr><td class="muted small">Total</td><td colspan="3">${toto != null && tot != null && toto !== tot ? `<span class="mvd">${fmt1(toto)} → </span>` : ""}<b>${tot == null ? "–" : fmt1(tot)}</b>${o?.over?.price != null ? ` <span class="muted small">O ${amer(o.over.price)} / U ${amer(o.under.price)}</span>` : ""}</td>${m ? `<td class="mc">${m.total == null ? "–" : fmt1(m.total)}</td>` : ""}</tr>
    </tbody></table>
    <div class="odds-foot">${marketBadge(book)}
      ${gapPts != null && Math.abs(gapPts) >= 0.5 ? `<span>${modelBadge(m.source)} <b>${fmt1(Math.abs(gapPts))} pts</b> more on ${esc(gapPts < 0 ? g.home.abbr : g.away.abbr)}</span>` : m ? `<span class="muted">Model agrees with the spread</span>` : `<span class="muted">No model line</span>`}
      ${gapTot != null && Math.abs(gapTot) >= 1 ? `<span>${gapTot > 0 ? "Over" : "Under"} by <b>${fmt1(Math.abs(gapTot))}</b></span>` : ""}
      ${o?.link ? `<a style="margin-left:auto;white-space:nowrap;color:var(--accent2)" href="${esc(o.link)}" target="_blank" rel="noopener">DraftKings ↗</a>` : ""}</div>
  </div>`;
}

// ---------------------------------------------------------------- your models' plays (their own plays.json files)
async function playsFile(sport) { return getJSON(`../${sport}/plays.json`, { label: `${SPORTS[sport].modelName} plays`, ttl: 300_000 }); }
const TIERS = ["3U", "2U", "1U", "Lean", "Light lean"];
const tierOf = (t) => (t === "play3" ? "3U" : t === "play1" ? "1U" : t === "lean" ? "Lean" : t === "light" ? "Light lean" : t);
async function plays(sports) {
  const res = await Promise.allSettled(sports.map(playsFile));
  const out = [];
  res.forEach((r, i) => {
    const s = sports[i];
    if (r.status === "rejected") { out.push(section(s, SPORTS[s].modelName, errBox("plays", r.reason))); return; }
    let P = r.value.plays.filter((p) => p.status === "pending").map((p) => ({ ...p, tier: tierOf(p.tier) }));
    if (ui.mine) P = P.filter((p) => state.teams.some((t) => t.sport === s && p.event?.includes(t.name.split(" ").pop())) || (p.player && state.players.some((x) => x.sport === s && x.name === p.player)));
    P.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || (b.ev || 0) - (a.ev || 0));
    const games = P.filter((p) => p.market !== "prop"), props = P.filter((p) => p.market === "prop");
    const row = (p) => `<div class="li"><span class="badge tier t-${esc(p.tier.replace(/\s/g, ""))}">${esc(p.tier)}</span><div class="sp"><div class="t ellip">${esc(p.selection)}${p.price ? ` <span class="muted small">${amer(p.price)}</span>` : ""}</div>
      <div class="s ellip">${esc(p.event || "")}${p.start ? ` · ${esc(dayLabel(new Date(p.start)))} ${fmtTime(new Date(p.start))}` : p.date ? ` · ${esc(p.date)}` : ""} · edge ${esc(p.edge_display || "")} · model ${pct(p.model_prob)} vs book ${pct(p.market_prob)}</div></div></div>`;
    out.push(section(s, `${sportBadge(s)} ${esc(SPORTS[s].modelName)}`, (games.length || props.length) ? `
      ${games.length ? `<div class="card list" style="margin-bottom:10px"><div class="group-h">Game lines · ${games.length}</div>${games.slice(0, 15).map(row).join("")}</div>` : ""}
      ${props.length ? `<div class="card list"><div class="group-h">Player props · ${props.length}</div>${props.slice(0, 15).map(row).join("")}</div>` : ""}`
      : empty(ui.mine ? "No open plays involving your teams or players." : "No open plays right now."),
      `<a class="sec-more" href="${APP[s]}">Open the ${esc(SPORTS[s].label)} app</a> · updated ${ago(r.value.generated_at)}`));
  });
  return out.join("") + `<p class="muted small" style="margin:12px 2px">Straight from each model's plays.json (the same feed the Best Plays hub reads). Leans and light leans carry no stake.</p>`;
}

// ---------------------------------------------------------------- records + NFL ATS
async function records(sports) {
  const res = await Promise.allSettled(sports.map(playsFile));
  const out = [];
  res.forEach((r, i) => {
    const s = sports[i];
    if (r.status === "rejected") return;
    const graded = r.value.plays.filter((p) => ["win", "loss", "push"].includes(p.status));
    const rows = [];
    for (const kind of ["game", "prop"]) for (const t of TIERS) {
      const g = graded.filter((p) => (kind === "prop") === (p.market === "prop") && tierOf(p.tier) === t);
      if (!g.length) continue;
      const w = g.filter((p) => p.status === "win").length, l = g.filter((p) => p.status === "loss").length, pu = g.length - w - l;
      const units = g.reduce((a, p) => a + (p.units ? (p.result_units || 0) * p.units : 0), 0);
      const flat = g.reduce((a, p) => a + (p.result_units || 0), 0);
      const bc = g.filter((p) => p.beat_close != null), bcp = bc.length ? bc.filter((p) => p.beat_close).length / bc.length : null;
      rows.push(`<tr><td class="pcol">${kind === "prop" ? "Props · " : ""}${esc(t)}</td><td>${w}-${l}${pu ? `-${pu}` : ""}</td><td>${w + l ? `${Math.round((w / (w + l)) * 100)}%` : "–"}</td>
        <td class="${flat >= 0 ? "up" : "down"}">${flat >= 0 ? "+" : ""}${flat.toFixed(1)}</td><td>${TIERS.indexOf(t) < 3 ? `<span class="${units >= 0 ? "up" : "down"}">${units >= 0 ? "+" : ""}${units.toFixed(1)}</span>` : "–"}</td><td>${bcp == null ? "–" : `${Math.round(bcp * 100)}%`}</td></tr>`);
    }
    out.push(section(`rec-${s}`, `${sportBadge(s)} ${esc(SPORTS[s].modelName)} record`, rows.length ? `<div class="card tscroll"><table class="tbl box perf-t"><thead><tr><th class="pcol">Tier</th><th>W-L</th><th>Win %</th><th>Flat units</th><th>Staked units</th><th>Beat close</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`
      : empty("No graded plays yet."), `${graded.length} graded · ${ago(r.value.generated_at)}`));
  });
  if (sports.includes("nfl")) {
    try { out.push(await nflAts()); } catch (e) { out.push(section("ats", "NFL against the spread", errBox("ATS records", e))); }
  }
  out.push(`<p class="muted small" style="margin:12px 2px">Records are graded by your models' own pipelines. Flat units = 1 unit per pick at the logged price; staked units use each pick's tier. ${sports.some((s) => s !== "nfl") ? "Team ATS records for the NBA and college aren't in any connected feed (ESPN returns none), so only the NFL table is shown." : ""}</p>`);
  return out.join("");
}

// NFL ATS: final scores (research feed, nflverse) against the consensus line in the NFL model's file
async function nflAts() {
  const [ts, pred, teamsJ] = await Promise.all([getJSON("../research/data/nfl_teamstats.json", { ttl: 600_000 }), getJSON("../nfl/predictions.json", { ttl: 300_000 }), import("./data.js?v=22").then((m) => m.teams())]);
  const lines = new Map();
  for (const games of Object.values(pred.weeks || {})) for (const g of games) if (g.vegas_spread != null) lines.set(`${g.date}|${g.home}|${g.away}`, g.vegas_spread); // home margin line
  const season = Math.max(...Object.values(ts.teams).flat().map((r) => r.s));
  const rows = [];
  const ESPN = { LA: "LAR", WAS: "WSH" };
  for (const [ab, games] of Object.entries(ts.teams)) {
    let w = 0, l = 0, p = 0, home = [0, 0], away = [0, 0];
    for (const r of games.filter((x) => x.s === season)) {
      const key = r.h ? `${r.d}|${ab}|${r.o}` : `${r.d}|${r.o}|${ab}`;
      const vs = lines.get(key);
      if (vs == null) continue;
      const myLine = r.h ? vs : -vs; // expected margin for this team
      const cover = r.pf - r.pa - myLine;
      if (Math.abs(cover) < 1e-9) p++; else if (cover > 0) { w++; (r.h ? home : away)[0]++; } else { l++; (r.h ? home : away)[1]++; }
    }
    if (w + l + p) {
      const t = teamsJ.sports.nfl.find((x) => x.abbr === (ESPN[ab] || ab));
      rows.push({ t, w, l, p, home, away });
    }
  }
  rows.sort((a, b) => b.w / (b.w + b.l || 1) - a.w / (a.w + a.l || 1));
  const ft = favTeamIds("nfl");
  return section("ats", "NFL against the spread", `<div class="card tscroll"><table class="tbl"><thead><tr><th>Team</th><th>ATS</th><th>Cover %</th><th>Home</th><th>Away</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="${r.t && ft.has(r.t.id) ? "fav" : ""}"><td>${r.t ? `<a class="tm" href="#/team/nfl/${r.t.id}">${logo(r.t, "logo-sm")}${esc(r.t.abbr)}</a>` : ""}</td><td>${r.w}-${r.l}${r.p ? `-${r.p}` : ""}</td><td>${r.w + r.l ? `${Math.round((r.w / (r.w + r.l)) * 100)}%` : "–"}</td><td>${r.home[0]}-${r.home[1]}</td><td>${r.away[0]}-${r.away[1]}</td></tr>`).join("")}
  </tbody></table></div><p class="muted small" style="margin:8px 2px 0">Final scores from nflverse play-by-play (research feed) against the consensus line in the NFL model's file (nflverse). ${season} season.</p>`, "Computed here");
}
