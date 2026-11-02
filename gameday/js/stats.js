// Stats Lab, Rankings and the Matchup Analyzer.
//   NBA efficiency: research/data/nba_teamstats.json (per-game team box-score efficiency from the NBA model's data)
//   NFL efficiency: research/data/nfl_teamstats.json (per-game EPA, success rate etc. from nflverse play-by-play)
//   College: your NCAAB / CFB models' own ratings (games.json), plus the AP poll from ESPN
//   Standings-based numbers (records, scoring, seeds): ESPN
import { esc, fmtDay, ago, getJSON, isFavTeam, favTeamIds, state } from "./core.js?v=23";
import { SPORTS, teams, modelFeed, leagueTable, schedule, seasonSchedule, roster, spreadText, fmt1, pct } from "./data.js?v=23";
import { sportBadge, modelBadge, logo, section, empty, errBox, skel, gameCard, ICON } from "./ui.js?v=23";
import { prediction } from "./teams.js?v=23";
import { gameProjections, projectionTable } from "./players.js?v=23";

const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const NFL_TO_ESPN = { LA: "LAR", WAS: "WSH" };
const n = (v) => { const x = parseFloat(String(v ?? "").replace(/[#,]/g, "")); return Number.isFinite(x) ? x : null; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const f1 = (x) => (x == null ? "–" : x.toFixed(1));
const f3 = (x) => (x == null ? "–" : `${x > 0 ? "+" : ""}${x.toFixed(3)}`);
const p1 = (x) => (x == null ? "–" : `${(x * 100).toFixed(1)}`);
const sg = (x) => (x == null ? "–" : `${x > 0 ? "+" : ""}${x.toFixed(1)}`);

// ---------------------------------------------------------------- lab data per sport
// returns { rows:[{id, abbr, name, logo, conf, ...}], cols:[{key,label,fmt,better,group,src}], source, updated, notes, missing }
export async function labData(sport) {
  const T = (await teams()).sports[sport];
  const byAbbr = new Map(T.map((t) => [t.abbr, t]));
  const base = (t) => ({ id: t.id, abbr: t.abbr, name: t.name, short: t.short, logo: t.logo, color: t.color, conf: t.conf, div: t.div });
  if (sport === "nba") {
    const [d, feed] = await Promise.all([getJSON("../research/data/nba_teamstats.json", { label: "NBA team efficiency (research)", ttl: 600_000 }), modelFeed("nba").catch(() => null)]);
    const season = Math.max(...Object.values(d.teams).flat().map((r) => r.s));
    const rows = [];
    for (const [ab, games] of Object.entries(d.teams)) {
      const t = byAbbr.get(ab);
      if (!t) continue;
      const g = games.filter((r) => r.s === season);
      if (!g.length) continue;
      const m = (k) => mean(g.map((r) => r[k]).filter((x) => x != null));
      const ortg = m("ortg"), drtg = m("drtg");
      rows.push({ ...base(t), gp: g.length, w: g.filter((r) => r.pf > r.pa).length, ppg: m("pf"), opp: m("pa"), ortg, drtg, net: ortg - drtg, pace: m("pace"),
        efg: m("efg"), defg: m("d_efg"), tov: m("tovp"), dtov: m("d_tovp"), oreb: m("orebp"), dreb: 1 - m("d_orebp"), ftr: m("ftr"), fg3: m("fg3p"), par3: m("par3"), ast: m("ast"),
        model: n(feed?.teamStats?.get(ab)?.stats?.["Team rating (pts vs avg)"]), opps: g.map((r) => r.o) });
    }
    // strength of schedule: average NBA Model rating of opponents faced
    const rate = new Map(rows.map((r) => [r.abbr, r.model]));
    for (const r of rows) r.sos = mean(r.opps.map((o) => rate.get(o)).filter((x) => x != null));
    return { rows, updated: d.generated_at, source: "NBA box-score efficiency (research feed, from the NBA model's data)", season, sortBy: "net",
      cols: [
        { key: "w", label: "W", fmt: (x, r) => `${x}-${r.gp - x}`, better: "high" },
        { key: "ortg", label: "ORtg", fmt: f1, better: "high", group: "Efficiency" }, { key: "drtg", label: "DRtg", fmt: f1, better: "low" },
        { key: "net", label: "Net", fmt: sg, better: "high" }, { key: "pace", label: "Pace", fmt: f1 },
        { key: "efg", label: "eFG%", fmt: p1, better: "high", group: "Four factors" }, { key: "tov", label: "TOV%", fmt: p1, better: "low" },
        { key: "oreb", label: "OREB%", fmt: p1, better: "high" }, { key: "dreb", label: "DREB%", fmt: p1, better: "high" }, { key: "ftr", label: "FTr", fmt: p1, better: "high" },
        { key: "defg", label: "Opp eFG%", fmt: p1, better: "low" }, { key: "dtov", label: "Forced TOV%", fmt: p1, better: "high" },
        { key: "fg3", label: "3P%", fmt: p1, better: "high", group: "Shooting" }, { key: "par3", label: "3PA rate", fmt: p1 },
        { key: "ppg", label: "PPG", fmt: f1, better: "high" }, { key: "opp", label: "Opp PPG", fmt: f1, better: "low" }, { key: "ast", label: "AST", fmt: f1, better: "high" },
        { key: "model", label: "Model rtg", fmt: sg, better: "high", src: "model" }, { key: "sos", label: "SOS", fmt: sg, better: "high", src: "model" },
      ],
      chart: { x: "ortg", y: "drtg", xl: "Offensive rating (pts / 100 poss)", yl: "Defensive rating (lower is better)", invertY: true },
      notes: ["ORtg/DRtg = points scored/allowed per 100 possessions; Net = the difference. Four factors per Dean Oliver.",
        "Model rtg = NBA Model team rating (pts vs average). SOS = average Model rating of opponents faced so far.",
        "Not in this data: true shooting % and usage rate (those need player-level free-throw and usage inputs)."] };
  }
  if (sport === "nfl") {
    const [d, feed] = await Promise.all([getJSON("../research/data/nfl_teamstats.json", { label: "NFL team efficiency (research)", ttl: 600_000 }), modelFeed("nfl").catch(() => null)]);
    const season = Math.max(...Object.values(d.teams).flat().map((r) => r.s));
    const rows = [];
    for (const [ab, games] of Object.entries(d.teams)) {
      const t = byAbbr.get(NFL_TO_ESPN[ab] || ab);
      if (!t) continue;
      const g = games.filter((r) => r.s === season);
      if (!g.length) continue;
      const m = (k) => mean(g.map((r) => r[k]).filter((x) => x != null));
      const sum = (k) => g.reduce((s, r) => s + (r[k] || 0), 0);
      const R = feed?.ratings?.get(ab);
      rows.push({ ...base(t), gp: g.length, w: g.filter((r) => r.pf > r.pa).length, ppg: m("pf"), opp: m("pa"),
        oepa: m("o_epa"), depa: m("d_epa"), nepa: m("o_epa") - m("d_epa"), osr: m("o_sr"), dsr: m("d_sr"),
        opass: m("o_pass_epa"), orush: m("o_rush_epa"), dpass: m("d_pass_epa"), drush: m("d_rush_epa"), expl: m("o_expl"), dexpl: m("d_expl"), proe: m("o_proe"),
        third: sum("o_third_att") ? sum("o_third_conv") / sum("o_third_att") : null, dthird: sum("d_third_att") ? sum("d_third_conv") / sum("d_third_att") : null,
        rz: sum("o_rz_trips") ? sum("o_rz_td") / sum("o_rz_trips") : null, todiff: sum("d_to") - sum("o_to"),
        elo: R?.elo ?? null, opps: g.map((r) => r.o) });
    }
    const elo = new Map([...(feed?.ratings || new Map())].map(([k, v]) => [k, v.elo]));
    for (const r of rows) r.sos = mean(r.opps.map((o) => elo.get(o)).filter((x) => x != null));
    return { rows, updated: d.generated_at, source: "nflverse play-by-play (research feed)", season, sortBy: "nepa",
      cols: [
        { key: "w", label: "W", fmt: (x, r) => `${x}-${r.gp - x}`, better: "high" },
        { key: "oepa", label: "Off EPA", fmt: f3, better: "high", group: "EPA / play" }, { key: "depa", label: "Def EPA", fmt: f3, better: "low" }, { key: "nepa", label: "Net EPA", fmt: f3, better: "high" },
        { key: "osr", label: "Off SR", fmt: p1, better: "high", group: "Success rate" }, { key: "dsr", label: "Def SR", fmt: p1, better: "low" },
        { key: "opass", label: "Pass EPA", fmt: f3, better: "high" }, { key: "orush", label: "Rush EPA", fmt: f3, better: "high" },
        { key: "dpass", label: "Def pass EPA", fmt: f3, better: "low" }, { key: "drush", label: "Def rush EPA", fmt: f3, better: "low" },
        { key: "expl", label: "Explosive %", fmt: p1, better: "high" }, { key: "proe", label: "PROE", fmt: p1 },
        { key: "third", label: "3rd down %", fmt: p1, better: "high" }, { key: "rz", label: "Red zone TD %", fmt: p1, better: "high" },
        { key: "todiff", label: "TO diff", fmt: (x) => (x > 0 ? `+${x}` : `${x}`), better: "high" },
        { key: "ppg", label: "PPG", fmt: f1, better: "high" }, { key: "opp", label: "Opp PPG", fmt: f1, better: "low" },
        { key: "elo", label: "Model Elo", fmt: (x) => (x == null ? "–" : x.toFixed(0)), better: "high", src: "model" }, { key: "sos", label: "SOS (Elo)", fmt: (x) => (x == null ? "–" : x.toFixed(0)), better: "high", src: "model" },
      ],
      chart: { x: "oepa", y: "depa", xl: "Offense EPA / play", yl: "Defense EPA / play (lower is better)", invertY: true },
      notes: ["EPA = expected points added per play. SR = success rate. PROE = pass rate over expected.",
        "Model Elo = NFL Model rating. SOS = average Model Elo of opponents faced so far.",
        "Yards per play and per-team totals are on each team page (ESPN)."] };
  }
  // college: the model's own ratings for every team in its file
  const feed = await modelFeed(sport);
  const [ap] = await Promise.allSettled([apPoll(sport)]);
  const apRank = new Map(ap.status === "fulfilled" ? ap.value.ranks.map((r) => [String(r.team.id), r.current]) : []);
  const rows = [];
  for (const [ab, v] of feed.teamStats || []) {
    const t = byAbbr.get(ab);
    if (!t) continue;
    const s = v.stats;
    const g = (re) => { const k = Object.keys(s).find((x) => re.test(x)); return k ? n(s[k]) : null; };
    rows.push({ ...base(t), conf: s.Conference || t.conf, rank: g(/^Model rank/), rating: g(/^Overall rating/), off: g(/^(Adj\. offense|Offense rating)/), def: g(/^(Adj\. defense|Defense rating)/),
      tempo: g(/^Tempo/), plays: g(/^Plays per game/), ypp: g(/^Yards per play edge/), pppf: g(/^Points per play for/), pppa: g(/^Points per play against/), ap: apRank.get(t.id) ?? null });
  }
  const isBB = sport === "ncaab";
  return { rows, updated: feed.updated, source: `${SPORTS[sport].modelName} ratings (your model)`, allModel: true, sortBy: "rank",
    cols: [
      { key: "rank", label: "Model #", fmt: (x) => (x == null ? "–" : x.toFixed(0)), better: "low", src: "model" },
      { key: "ap", label: "AP", fmt: (x) => (x == null ? "–" : `#${x}`), better: "low", src: "espn", group: "AP poll (ESPN)" },
      { key: "rating", label: isBB ? "Rating" : "Overall", fmt: sg, better: "high", src: "model", group: "Your model" },
      { key: "off", label: isBB ? "Adj O" : "Offense", fmt: sg, better: "high", src: "model" },
      { key: "def", label: isBB ? "Adj D" : "Defense", fmt: sg, better: "high", src: "model" },
      ...(isBB ? [{ key: "tempo", label: "Tempo", fmt: f1, src: "model" }]
        : [{ key: "ypp", label: "YPP edge", fmt: (x) => (x == null ? "–" : x.toFixed(2)), better: "high", src: "model" },
           { key: "pppf", label: "PPP for", fmt: (x) => (x == null ? "–" : x.toFixed(3)), better: "high", src: "model" },
           { key: "pppa", label: "PPP vs", fmt: (x) => (x == null ? "–" : x.toFixed(3)), better: "low", src: "model" },
           { key: "plays", label: "Plays/g", fmt: f1, src: "model" }]),
    ],
    chart: { x: "off", y: "def", xl: isBB ? "Adj. offense (pts/100 vs avg)" : "Offense rating (pts)", yl: isBB ? "Adj. defense (pts/100 vs avg)" : "Defense rating (higher is better)" },
    notes: [isBB ? "KenPom isn't connected (it's a paid subscription). These are your NCAAB model's opponent-adjusted ratings: points per 100 possessions vs an average team, and possessions per game."
      : "Your CFB model's ratings: points vs an average FBS team, yards-per-play edge, points per play.",
      "Strength of schedule isn't in the model's published file, so it isn't shown.",
      `Covers the ${rows.length} teams in the model's file right now (teams playing in its current window).`] };
}

export async function apPoll(sport) {
  const s = SPORTS[sport];
  const d = await getJSON(`${SITE}/${s.path}/rankings`, { label: `${s.label} polls (ESPN)`, ttl: 1_800_000 });
  const ap = (d.rankings || []).find((r) => r.type === "ap" || /AP/.test(r.name)) || d.rankings?.[0];
  return { ...ap, all: d.rankings || [] };
}

// ---------------------------------------------------------------- Stats Lab view
const ui = { sort: {}, filter: "", cols: {} };

export async function renderLab(el, sport) {
  el.innerHTML = skel(3);
  let L;
  try { L = await labData(sport); } catch (e) { el.innerHTML = errBox("Stats Lab data", e); return; }
  const confs = [...new Set(L.rows.map((r) => r.conf).filter(Boolean))].sort();
  if (ui.filter && !confs.includes(ui.filter)) ui.filter = "";
  const sortKey = ui.sort[sport]?.key || L.sortBy || L.cols.find((c) => c.better)?.key;
  const col = L.cols.find((c) => c.key === sortKey) || L.cols[0];
  const dir = ui.sort[sport]?.dir ?? (col.better === "low" ? 1 : -1);
  const rows = L.rows.filter((r) => !ui.filter || r.conf === ui.filter)
    .sort((a, b) => (a[col.key] == null) - (b[col.key] == null) || dir * ((a[col.key] ?? 0) - (b[col.key] ?? 0)));
  // league rank for every column (among all teams, not just the filter)
  const ranks = {};
  for (const c of L.cols) if (c.better) {
    const vals = L.rows.map((r) => r[c.key]).filter((x) => x != null).sort((a, b) => (c.better === "low" ? a - b : b - a));
    ranks[c.key] = (x) => (x == null ? null : vals.indexOf(x) + 1);
  }
  const ft = favTeamIds(sport);
  const nTot = L.rows.length;
  const tier = (r) => (r == null ? "" : r <= Math.ceil(nTot * 0.2) ? "t1" : r > Math.floor(nTot * 0.8) ? "t5" : "");
  const shown = rows.slice(0, sport === "ncaab" && !ui.filter ? 100 : 400);
  el.innerHTML = `${chart(L, sport)}
    ${confs.length > 1 ? `<select class="input" data-lab="conf" style="margin:12px 0">${["", ...confs].map((c) => `<option value="${esc(c)}" ${c === ui.filter ? "selected" : ""}>${c ? esc(c) : `All ${nTot} teams`}</option>`).join("")}</select>` : ""}
    <div class="card tscroll lab"><table class="tbl box sortable"><thead><tr><th class="pcol">#&nbsp; Team</th>${L.cols.map((c) => `<th data-lab="sort" data-k="${c.key}" class="${c.key === col.key ? "on" : ""} ${c.src === "model" ? "mh" : ""}" title="Sort">${esc(c.label)}${c.key === col.key ? (dir < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead><tbody>
      ${shown.map((r, i) => `<tr class="${ft.has(r.id) ? "fav" : ""}"><td class="pcol"><a class="tm" href="#/team/${sport}/${r.id}"><span class="muted small" style="width:22px;display:inline-block">${i + 1}</span>${logo(r, "logo-sm")}${esc(r.abbr)}</a></td>
        ${L.cols.map((c) => { const rk = ranks[c.key]?.(r[c.key]); return `<td class="${tier(rk)} ${c.src === "model" ? "mc" : ""}" title="${rk ? `${rk} of ${nTot}` : ""}">${c.fmt(r[c.key], r)}</td>`; }).join("")}</tr>`).join("")}
    </tbody></table></div>
    ${rows.length > shown.length ? `<p class="muted small" style="margin:8px 2px">Showing the top ${shown.length}. Pick a conference to see all of its teams.</p>` : ""}
    <div class="card pad small muted" style="margin-top:12px;line-height:1.5">${L.notes.map(esc).join("<br>")}<br>
      <span class="lab-key"><i class="t1"></i> top 20% <i class="t5"></i> bottom 20%</span> · ${L.allModel ? `${modelBadge("model")} every column but AP comes from your model` : `${modelBadge("model")} columns come from your model; the rest are actual stats`}
      <br>Source: ${esc(L.source)}, updated ${ago(L.updated)}.</div>`;
  el.onclick = (e) => {
    const b = e.target.closest("[data-lab]");
    if (b?.dataset.lab === "sort") {
      const k = b.dataset.k, c = L.cols.find((x) => x.key === k);
      const cur = ui.sort[sport];
      ui.sort[sport] = { key: k, dir: cur?.key === k ? -cur.dir : c.better === "low" ? 1 : -1 };
      renderLab(el, sport);
    }
  };
  el.onchange = (e) => { if (e.target.dataset.lab === "conf") { ui.filter = e.target.value; renderLab(el, sport); } };
}

function chart(L, sport) {
  const { x, y, xl, yl, invertY } = L.chart;
  const pts = L.rows.filter((r) => r[x] != null && r[y] != null && (!ui.filter || r.conf === ui.filter));
  if (pts.length < 3) return "";
  const xs = pts.map((r) => r[x]), ys = pts.map((r) => r[y]);
  const pad = (a) => { const lo = Math.min(...a), hi = Math.max(...a), p = (hi - lo) * 0.08 || 1; return [lo - p, hi + p]; };
  const [x0, x1] = pad(xs), [y0, y1] = pad(ys);
  const W = 640, H = 400, M = 34;
  const sx = (v) => M + ((v - x0) / (x1 - x0)) * (W - 2 * M);
  const sy = (v) => { const t = (v - y0) / (y1 - y0); return invertY ? M + t * (H - 2 * M) : H - M - t * (H - 2 * M); };
  const mx = mean(xs), my = mean(ys);
  const big = pts.length <= 40;
  const ft = favTeamIds(sport);
  const dots = pts.map((r) => {
    const cx = sx(r[x]), cy = sy(r[y]);
    const fav = ft.has(r.id);
    return big && r.logo ? `<a href="#/team/${sport}/${r.id}"><image href="${esc(r.logo)}" x="${cx - 14}" y="${cy - 14}" width="28" height="28"><title>${esc(r.name)}</title></image>${fav ? `<circle cx="${cx}" cy="${cy}" r="17" fill="none" stroke="var(--fav)" stroke-width="2"/>` : ""}</a>`
      : `<a href="#/team/${sport}/${r.id}"><circle cx="${cx}" cy="${cy}" r="${fav ? 6 : 4}" fill="${fav ? "var(--fav)" : esc(r.color || "#888")}" stroke="rgba(255,255,255,.6)" stroke-width="1"><title>${esc(r.name)}: ${r[x].toFixed(2)}, ${r[y].toFixed(2)}</title></circle></a>`;
  }).join("");
  return `<div class="card pad"><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="${esc(xl)} vs ${esc(yl)}">
    <rect x="${sx(mx)}" y="${M}" width="${W - M - sx(mx)}" height="${(invertY ? sy(my) : sy(my)) - M}" fill="var(--win)" opacity=".06"/>
    <line x1="${sx(mx)}" x2="${sx(mx)}" y1="${M}" y2="${H - M}" stroke="var(--line2)" stroke-dasharray="4 4"/><line x1="${M}" x2="${W - M}" y1="${sy(my)}" y2="${sy(my)}" stroke="var(--line2)" stroke-dasharray="4 4"/>
    ${dots}
    <text x="${W / 2}" y="${H - 6}" text-anchor="middle" font-size="13" fill="var(--muted)">${esc(xl)} →</text>
    <text x="12" y="${H / 2}" text-anchor="middle" font-size="13" fill="var(--muted)" transform="rotate(-90 12 ${H / 2})">${esc(yl)} ${invertY ? "↑ better" : "↑"}</text>
    <text x="${W - M}" y="${M + 14}" text-anchor="end" font-size="12" fill="var(--win)">good on both ends</text>
  </svg></div>`;
}

// ---------------------------------------------------------------- Rankings
export async function renderRankings(el, sport) {
  el.innerHTML = skel(3);
  const college = sport === "ncaab" || sport === "cfb";
  const parts = [];
  const T = (await teams()).sports[sport];
  const tByid = new Map(T.map((t) => [t.id, t]));
  if (college) {
    const [pollR, labR] = await Promise.allSettled([apPoll(sport), labData(sport)]);
    const modelTop = labR.status === "fulfilled" ? labR.value.rows.filter((r) => r.rank != null).sort((a, b) => a.rank - b.rank).slice(0, 25) : [];
    const modelRank = new Map(labR.status === "fulfilled" ? labR.value.rows.map((r) => [r.id, r.rank]) : []);
    if (pollR.status === "fulfilled") {
      for (const poll of pollR.value.all.slice(0, 2)) { // AP, then the coaches poll
        parts.push(section("poll", esc(poll.name), `<div class="card list">${poll.ranks.map((r) => {
          const t = tByid.get(String(r.team.id)) || { logo: r.team.logos?.[0]?.href, abbr: r.team.abbreviation };
          const mv = r.previous ? r.previous - r.current : 0;
          const mr = modelRank.get(String(r.team.id));
          return `<a class="li" href="#/team/${sport}/${r.team.id}"><b style="width:24px">${r.current}</b>${logo(t)}<div class="sp"><div class="t ellip">${esc(r.team.location || r.team.name)} ${isFavTeam(sport, String(r.team.id)) ? "★" : ""}</div>
            <div class="s">${esc(r.recordSummary || "")}${r.firstPlaceVotes ? ` · ${r.firstPlaceVotes} first-place` : ""}${r.points ? ` · ${r.points} pts` : ""}</div></div>
            ${mr ? `<span class="badge b-model" title="Your model's rank">#${mr}</span>` : ""}<span class="mv ${mv > 0 ? "up" : mv < 0 ? "down" : ""}">${mv > 0 ? `▲${mv}` : mv < 0 ? `▼${-mv}` : "–"}</span></a>`;
        }).join("")}</div>`, `ESPN · your model's rank in blue`));
      }
    } else parts.push(errBox("polls", pollR.reason));
    if (modelTop.length) parts.push(section("mtop", `${esc(SPORTS[sport].modelName)} top 25`, `<div class="card list">${modelTop.map((r) => `<a class="li" href="#/team/${sport}/${r.id}"><b style="width:24px">${r.rank}</b>${logo(r)}<div class="sp"><div class="t ellip">${esc(r.name)}</div><div class="s">${esc(r.conf || "")} · rating ${sg(r.rating)}</div></div>${r.ap ? `<span class="badge b-plain">AP #${r.ap}</span>` : ""}</a>`).join("")}</div>`, `${modelBadge("model")} power ranking`));
    parts.push(`<p class="muted small" style="margin:12px 2px">KenPom isn't connected (paid). Strength-of-schedule rankings aren't in your college models' published files.</p>`);
  } else {
    const [labR, tblR] = await Promise.allSettled([labData(sport), leagueTable(sport)]);
    if (labR.status === "fulfilled") {
      const L = labR.value;
      const key = sport === "nfl" ? "elo" : "model";
      const pr = L.rows.filter((r) => r[key] != null).sort((a, b) => b[key] - a[key]);
      const feed = sport === "nfl" ? await modelFeed("nfl").catch(() => null) : null;
      parts.push(section("power", "Model power rankings", `<div class="card list">${pr.map((r, i) => {
        const chg = sport === "nfl" ? feed?.ratings?.get(Object.entries(NFL_TO_ESPN).find(([, v]) => v === r.abbr)?.[0] || r.abbr)?.rank_change : null;
        return `<a class="li" href="#/team/${sport}/${r.id}"><b style="width:24px">${i + 1}</b>${logo(r)}<div class="sp"><div class="t ellip">${esc(r.name)} ${isFavTeam(sport, r.id) ? "★" : ""}</div>
          <div class="s">${r.w}-${r.gp - r.w} · ${sport === "nfl" ? `net EPA ${f3(r.nepa)}` : `net rating ${sg(r.net)}`} · SOS ${sport === "nfl" ? (r.sos?.toFixed(0) ?? "–") : sg(r.sos)}</div></div>
          <b style="color:var(--model)">${sport === "nfl" ? r.elo : sg(r.model)}</b>${chg ? `<span class="mv ${chg > 0 ? "up" : "down"}">${chg > 0 ? "▲" : "▼"}${Math.abs(chg)}</span>` : ""}</a>`;
      }).join("")}</div>`, `${modelBadge("model")} ${sport === "nfl" ? "NFL Model Elo" : "NBA Model team rating (pts vs avg)"}`));
      // strength of schedule
      const sos = L.rows.filter((r) => r.sos != null).sort((a, b) => b.sos - a.sos);
      parts.push(section("sos", "Strength of schedule so far", `<div class="card list">${sos.slice(0, 10).map((r, i) => `<a class="li" href="#/team/${sport}/${r.id}"><b style="width:24px">${i + 1}</b>${logo(r)}<div class="sp t ellip">${esc(r.name)}</div><b>${sport === "nfl" ? r.sos.toFixed(0) : sg(r.sos)}</b></a>`).join("")}</div>
        <p class="muted small" style="margin:8px 2px 0">Average ${sport === "nfl" ? "Elo" : "model rating"} of opponents faced, from your model's ratings. Hardest 10 shown.</p>`, "Model"));
    } else parts.push(errBox("power rankings", labR.reason));
    if (tblR.status === "fulfilled") parts.push(playoffPicture(sport, tblR.value));
  }
  el.innerHTML = parts.join("");
}

function playoffPicture(sport, tbl) {
  const wp = (rec) => { const [w = 0, l = 0, t = 0] = String(rec || "").split("-").map(Number); return w + l + t ? (w + t / 2) / (w + l + t) : 0; };
  const byConf = new Map();
  for (const r of tbl.rows) { if (!byConf.has(r.conf)) byConf.set(r.conf, []); byConf.get(r.conf).push(r); }
  const html = [...byConf].map(([conf, rows]) => {
    const seeded = rows.some((r) => n(r.rec.seed) > 0) ? rows.slice().sort((a, b) => (n(a.rec.seed) || 99) - (n(b.rec.seed) || 99)) : rows.slice().sort((a, b) => wp(b.rec.total) - wp(a.rec.total));
    const cut = sport === "nfl" ? 7 : 6, play = sport === "nba" ? 10 : cut;
    return section("po", esc(conf), `<div class="card list">${seeded.map((r, i) => `${i === cut ? `<div class="group-h">${sport === "nba" ? "Play-in" : "Outside looking in"}</div>` : i === play && play !== cut ? '<div class="group-h">Outside</div>' : ""}
      <a class="li" href="#/team/${sport}/${r.id}"><b style="width:24px">${i + 1}</b>${logo(r)}<div class="sp t ellip">${esc(r.name)} ${isFavTeam(sport, r.id) ? "★" : ""}</div><span class="muted small">${esc(r.rec.total || "")}</span></a>`).join("")}</div>`,
      sport === "nfl" ? "ESPN seeds" : "By win %");
  }).join("");
  return `<h2 class="sec-title" style="margin:22px 2px 0">Playoff picture</h2><p class="muted small" style="margin:4px 2px 0">If the season ended today. ${sport === "nba" ? "Seeds 7–10 go to the play-in." : "Seeds from ESPN's standings."}</p>${html}`;
}

// ---------------------------------------------------------------- Matchup Analyzer
export async function renderMatchup(el, sport, aId, bId, go) {
  const T = (await teams()).sports[sport].slice().sort((a, b) => a.name.localeCompare(b.name));
  // defaults: a followed team and its next opponent
  if (!aId) aId = state.teams.find((t) => t.sport === sport)?.id || T[0].id;
  if (!bId) {
    try { const ng = (await schedule(sport, aId)).games.find((g) => g.state !== "post"); bId = ng ? (ng.home.id === String(aId) ? ng.away.id : ng.home.id) : null; } catch {}
    bId = bId || T.find((t) => t.id !== String(aId)).id;
  }
  const A = T.find((t) => t.id === String(aId)), B = T.find((t) => t.id === String(bId));
  if (!A || !B) { el.innerHTML = empty("Pick two teams."); return; }
  const pick = (which, cur) => `<select class="input" data-mu="${which}">${T.map((t) => `<option value="${t.id}" ${t.id === cur.id ? "selected" : ""}>${esc(t.name)}${isFavTeam(sport, t.id) ? " ★" : ""}</option>`).join("")}</select>`;
  el.innerHTML = `<div class="mu-pick">${pick("a", A)}<button class="mini" data-mu="swap" aria-label="Swap teams">⇄</button>${pick("b", B)}</div><div id="muBody">${skel(3)}</div>`;
  el.onchange = (e) => { const w = e.target.dataset.mu; if (w === "a") go(e.target.value, B.id); if (w === "b") go(A.id, e.target.value); };
  el.onclick = (e) => { if (e.target.closest('[data-mu="swap"]')) go(B.id, A.id); };
  const body = el.querySelector("#muBody");

  const [sA, sB, tblR, labR, feedR, rA, rB] = await Promise.allSettled([schedule(sport, A.id), schedule(sport, B.id), leagueTable(sport), labData(sport), modelFeed(sport), roster(sport, A.id), roster(sport, B.id)]);
  const out = [];
  // 1. your model: only for a scheduled game between them
  const sched = sA.status === "fulfilled" ? sA.value.games.find((g) => g.state !== "post" && (g.home.id === B.id || g.away.id === B.id)) : null;
  if (sched?.model) {
    const feed = feedR.status === "fulfilled" ? feedR.value : null;
    out.push(prediction(sport, A, sched, feed, tblR.value).replace("Next game: your model", "Your model's prediction"));
    if (sport === "nba" || sport === "nfl") { try { out.push(projectionTable(sport, await gameProjections(sport, sched))); } catch {} }
  } else {
    out.push(section("pred", "Your model's prediction", `<div class="card pad small muted">${sched
      ? `${esc(A.short)} and ${esc(B.short)} play ${esc(fmtDay(sched.start))}, but ${esc(SPORTS[sport].modelName)} hasn't published a line for it yet (its file covers the next few days).`
      : `These teams don't have a scheduled game. ${esc(SPORTS[sport].modelName)} only predicts scheduled games, so there's no projected score for a hypothetical matchup. The ratings below are its view of each team.`}</div>`));
  }
  // 2. side-by-side comparison
  const tbl = tblR.status === "fulfilled" ? tblR.value : null;
  const L = labR.status === "fulfilled" ? labR.value : null;
  const ta = tbl?.rows.find((r) => r.id === A.id), tb = tbl?.rows.find((r) => r.id === B.id);
  const la = L?.rows.find((r) => r.id === A.id), lb = L?.rows.find((r) => r.id === B.id);
  const rowsHtml = [];
  const cmpRow = (label, va, vb, fa, better, src) => {
    if ((va == null || va === "–") && (vb == null || vb === "–")) return; // nothing to compare
    let w = null;
    if (better && va != null && vb != null && va !== vb) w = (better === "high" ? va > vb : va < vb) ? "a" : "b";
    rowsHtml.push(`<tr><td class="${w === "a" ? "adv-w" : ""}">${fa(va, "a")}</td><td class="lbl">${esc(label)}${src === "model" ? ' <span class="badge b-model">Model</span>' : ""}</td><td class="${w === "b" ? "adv-w" : ""}">${fa(vb, "b")}</td></tr>`);
  };
  const recWp = (r) => { const [w = 0, l = 0] = String(r || "").split("-").map(Number); return w + l ? w / (w + l) : null; };
  const str = (x) => esc(x ?? "–");
  if (ta || tb) {
    rowsHtml.push(`<tr class="grp"><td colspan="3">Record (ESPN)</td></tr>`);
    cmpRow("Overall", ta?.rec.total, tb?.rec.total, str);
    cmpRow("Home", ta?.rec.home, tb?.rec.home, str); cmpRow("Away", ta?.rec.road, tb?.rec.road, str);
    if (ta?.rec.conf || tb?.rec.conf) cmpRow("Conference", ta?.rec.conf, tb?.rec.conf, str);
    rowsHtml.push(`<tr class="grp"><td colspan="3">Scoring per game (ESPN)</td></tr>`);
    const rk = (v, r) => (v == null ? "–" : `${v.toFixed(1)}${r ? ` <span class="muted small">${r}</span>` : ""}`);
    const ordn = (i) => (i ? `#${i}` : "");
    cmpRow("Points", ta?.pf, tb?.pf, (v, side) => rk(v, ordn(side === "a" ? ta?.pfRank : tb?.pfRank)), "high");
    cmpRow("Allowed", ta?.pa, tb?.pa, (v, side) => rk(v, ordn(side === "a" ? ta?.paRank : tb?.paRank)), "low");
    cmpRow("Margin", ta?.diff, tb?.diff, (v) => (v == null ? "–" : sg(v)), "high");
  }
  if (la || lb) {
    let grp = null;
    for (const c of L.cols) {
      if (c.key === "w") continue;
      const g = c.group || (c.src === "model" ? "Your model" : grp);
      if (g !== grp) { rowsHtml.push(`<tr class="grp"><td colspan="3">${esc(g || "Stats")}</td></tr>`); grp = g; }
      cmpRow(c.label, la?.[c.key], lb?.[c.key], (v, side) => c.fmt(v, side === "a" ? la : lb), c.better, c.src);
    }
  }
  // recent form
  const form = (r, id) => {
    if (r.status !== "fulfilled") return null;
    const last = r.value.games.filter((g) => g.state === "post").slice(-5);
    const w = last.filter((g) => { const me = g.home.id === String(id) ? g.home : g.away, op = me === g.home ? g.away : g.home; return me.score > op.score; }).length;
    const m = mean(last.map((g) => { const me = g.home.id === String(id) ? g.home : g.away, op = me === g.home ? g.away : g.home; return me.score - op.score; }));
    return { rec: `${w}-${last.length - w}`, m };
  };
  const fa = form(sA, A.id), fb = form(sB, B.id);
  if (fa || fb) {
    rowsHtml.push(`<tr class="grp"><td colspan="3">Last 5 games (ESPN)</td></tr>`);
    cmpRow("Record", fa?.rec, fb?.rec, str);
    cmpRow("Avg margin", fa?.m, fb?.m, (v) => (v == null ? "–" : sg(v)), "high");
  }
  out.push(section("cmp", "Side by side", `<div class="card tscroll"><table class="tbl adv-t mu-t"><thead><tr><th>${logo(A)} ${esc(A.abbr)}</th><th></th><th>${esc(B.abbr)} ${logo(B)}</th></tr></thead><tbody>${rowsHtml.join("")}</tbody></table></div>
    <p class="muted small" style="margin:8px 2px 0">Green = better side where higher/lower is clearly better. ${L ? `Efficiency: ${esc(L.source)}.` : ""}</p>`));
  // 3. head to head (last 4 seasons, from team A's schedules)
  const yrs = [];
  try {
    const cur = await getJSON(`${SITE}/${SPORTS[sport].path}/teams/${A.id}/schedule`, { ttl: 600_000 });
    const y = cur.season?.year; if (y) yrs.push(y, y - 1, y - 2, y - 3);
  } catch {}
  const hs = await Promise.allSettled(yrs.map((y) => seasonSchedule(sport, A.id, y)));
  const seen = new Set();
  const meets = hs.flatMap((r) => (r.status === "fulfilled" ? r.value : [])).filter((g) => g.state === "post" && (g.home.id === B.id || g.away.id === B.id) && !seen.has(g.id) && seen.add(g.id)).sort((a, b) => b.start - a.start);
  const wa = meets.filter((g) => (g.home.id === A.id ? g.home.score > g.away.score : g.away.score > g.home.score)).length;
  out.push(section("h2h", "Head to head", meets.length ? `<div class="stats-grid" style="margin-bottom:10px"><div class="stat-box"><div class="n">${wa}</div><div class="l">${esc(A.abbr)} wins</div></div><div class="stat-box"><div class="n">${meets.length - wa}</div><div class="l">${esc(B.abbr)} wins</div></div><div class="stat-box"><div class="n">${meets.length}</div><div class="l">Meetings</div><div class="r">last ${yrs.length} seasons</div></div></div>
    <div class="card list">${meets.slice(0, 8).map((g) => { const w = g.home.score > g.away.score ? g.home : g.away; return `<a class="li" href="#/game/${sport}/${g.id}">${logo(w)}<div class="sp"><div class="t">${esc(w.abbr)} won ${Math.max(g.home.score, g.away.score)}-${Math.min(g.home.score, g.away.score)}</div><div class="s">${esc(g.away.abbr)} @ ${esc(g.home.abbr)} · ${esc(g.start.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }))}</div></div></a>`; }).join("")}</div>`
    : empty(`No meetings in the last ${yrs.length || "few"} seasons.`), "Actual · ESPN"));
  // 4. availability (ESPN roster injuries)
  const inj = (r, t) => (r.status === "fulfilled" ? (r.value.athletes || []).flatMap((x) => x.items || [x]).filter((p) => p.injuries?.length).map((p) => ({ t, p })) : []);
  const injAll = [...inj(rA, A), ...inj(rB, B)];
  out.push(section("avail", "Player availability", injAll.length ? `<div class="card list">${injAll.map(({ t, p }) => `<a class="li" href="#/player/${sport}/${p.id}">${logo(t)}<div class="sp"><div class="t ellip">${esc(p.displayName)}</div><div class="s">${esc(p.position?.abbreviation || "")}${p.injuries[0].date ? ` · updated ${esc(fmtDay(new Date(p.injuries[0].date)))}` : ""}</div></div><span class="badge b-live">${esc(p.injuries[0].status || "Injured")}</span></a>`).join("")}</div>`
    : empty("No injuries on either roster in ESPN's data."), "ESPN rosters"));
  if (!(sport === "nba" || sport === "nfl") || !sched?.model) out.push(`<p class="muted small" style="margin:12px 2px">Player-vs-player projections appear when the two teams have a scheduled game with model lines (NBA and NFL).</p>`);
  body.innerHTML = out.join("");
}
