// Game Center: one game, five tabs. Actual data from ESPN's game summary; prediction from your model's file.
import { esc, fmtTime, fmtDay, dayLabel, ago, isFavTeam, isFavPlayer } from "./core.js?v=9";
import { SPORTS, summary, schedule, seasonSchedule, spreadText, fmt1, pct } from "./data.js?v=9";
import { gameProjections, projectionTable } from "./players.js?v=9";
import { ICON, sportBadge, marketBadge, logo, headshot, section, empty, errBox, skel, modelBlock } from "./ui.js?v=9";

const TABS = [["overview", "Overview"], ["box", "Box"], ["team", "Stats"], ["plays", "Plays"], ["matchup", "Matchup"]];
const ui = { tab: "overview", boxSide: "away", period: "all", playsMode: "all", key: null };

export async function viewGame(view, sport, id, { quiet = false, tab } = {}) {
  const key = `${sport}:${id}`;
  if (ui.key !== key) Object.assign(ui, { key, tab: TABS.some(([k]) => k === tab) ? tab : "overview", boxSide: "away", period: "all", playsMode: "all" });
  if (!SPORTS[sport]) { view.innerHTML = empty("Unknown sport."); return; }
  const y = window.scrollY; // keep the reader's place on live refreshes
  if (!quiet) view.innerHTML = back() + skel(3);
  view.dataset.v = "game";
  let g, d;
  try { ({ g, d } = await summary(sport, id)); } catch (e) { view.innerHTML = back() + errBox("this game", e); return; }
  view.innerHTML = back() + header(g) +
    `<div class="seg gc-tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-gc="tab" data-v="${k}" aria-pressed="${ui.tab === k}">${l}</button>`).join("")}</div>
     <div id="gcBody"></div>`;
  const body = view.querySelector("#gcBody");
  const draw = async () => {
    view.querySelectorAll('[data-gc="tab"]').forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === ui.tab));
    try {
      if (ui.tab === "overview") body.innerHTML = await overview(g, d, sport);
      if (ui.tab === "box") body.innerHTML = box(g, d, sport);
      if (ui.tab === "team") body.innerHTML = teamStats(g, d);
      if (ui.tab === "plays") body.innerHTML = plays(g, d, sport);
      if (ui.tab === "matchup") { body.innerHTML = skel(2); body.innerHTML = await matchup(g, d, sport); }
    } catch (e) { body.innerHTML = errBox("this section", e); console.error(e); }
  };
  view.onclick = (e) => {
    const b = e.target.closest("[data-gc]");
    if (!b) return;
    const k = b.dataset.gc, v = b.dataset.v;
    if (k === "tab") ui.tab = v;
    if (k === "side") ui.boxSide = v;
    if (k === "period") ui.period = v;
    if (k === "mode") ui.playsMode = v;
    if (k === "drive") { b.closest(".drive").classList.toggle("open"); return; }
    draw();
  };
  if (quiet) body.style.minHeight = `${Math.max(0, y)}px`; // hold height while the tab redraws
  await draw();
  body.style.minHeight = "";
  if (quiet) window.scrollTo(0, y);
  return [g];
}

const back = () => `<a class="back" href="#" data-action="back">${ICON.back} Back</a>`;

// ---------------------------------------------------------------- header + line score
function header(g) {
  const side = (t) => `<a class="side" href="#/team/${g.sport}/${t.id}">${logo(t, "logo logo-lg")}
    <div class="nm">${t.rank ? `<span class="muted">${t.rank}</span> ` : ""}${esc(t.short)}${isFavTeam(g.sport, t.id) ? ' <span style="color:var(--fav)">★</span>' : ""}</div>
    <div class="muted small">${esc(t.record || "")}</div></a>`;
  const mid = g.state === "pre"
    ? `<div class="mid">${esc(dayLabel(g.start))}<br><span style="color:var(--text);font-size:18px">${fmtTime(g.start)}</span></div>`
    : `<div class="big">${g.away.score ?? 0}<span class="muted" style="font-size:24px"> – </span>${g.home.score ?? 0}</div>
       <div class="mid" style="${g.state === "in" ? "color:var(--live)" : ""}">${g.state === "in" ? '<span class="dot-live"></span> ' : ""}${esc(g.detail)}</div>`;
  const n = Math.max(g.away.lines?.length || 0, g.home.lines?.length || 0);
  const reg = SPORTS[g.sport].key === "ncaab" ? 2 : 4;
  const pl = (i) => (i < reg ? (reg === 2 ? `${i + 1}H` : `Q${i + 1}`) : n - reg > 1 ? `OT${i - reg + 1}` : "OT");
  const lines = n ? `<div class="tscroll"><table class="tbl ls"><thead><tr><th></th>${Array.from({ length: n }, (_, i) => `<th>${pl(i)}</th>`).join("")}<th>T</th></tr></thead><tbody>
    ${[g.away, g.home].map((t) => `<tr><td><span class="tm">${logo(t, "logo")}${esc(t.abbr)}</span></td>${Array.from({ length: n }, (_, i) => `<td>${esc(t.lines[i] ?? "")}</td>`).join("")}<td><b>${t.score ?? ""}</b></td></tr>`).join("")}
    </tbody></table></div>` : "";
  return `<div class="hero gc-hero" style="--tc:${esc(g.home.color)}">
    <div class="row" style="gap:6px;margin-bottom:6px">${sportBadge(g.sport)}${g.state === "in" ? '<span class="badge b-live">Live</span>' : ""}<span class="sp muted small ellip">${esc(g.note || "")}</span></div>
    <div class="vs">${side(g.away)}<div>${mid}</div>${side(g.home)}</div>
    ${lines}
    <div class="muted small" style="text-align:center;margin-top:10px">${esc([g.venue, g.city].filter(Boolean).join(" · "))}${g.tv.length ? ` · ${esc(g.tv.join(", "))}` : ""}${g.attendance ? ` · Att. ${g.attendance.toLocaleString()}` : ""}</div>
  </div>`;
}

// ---------------------------------------------------------------- overview
async function overview(g, d, sport) {
  const out = [];
  // your model (prediction) and the sportsbook (market), kept apart
  out.push(section("model", "Your model", g.model ? modelBlock(g)
    : `<div class="card pad small muted">${esc(SPORTS[sport].modelName)} has no prediction for this game in its published file${g.state === "post" ? " (finished games drop off after a day or two)" : ""}.</div>`));
  const pc = (d.pickcenter || [])[0];
  if (pc && (pc.details || pc.overUnder)) {
    const ml = (o) => (o?.moneyLine != null ? (o.moneyLine > 0 ? `+${o.moneyLine}` : o.moneyLine) : "–");
    out.push(section("odds", "Sportsbook", `<div class="card pad"><div class="row" style="margin-bottom:10px">${marketBadge(pc.provider?.name)}<b>${esc(pc.provider?.name || "Sportsbook")}</b><span class="sp"></span><span class="muted small">via ESPN</span></div>
      <div class="stats-grid">
        <div class="stat-box"><div class="n" style="color:var(--market)">${pc.spread != null ? spreadText(pc.spread, g) : esc(pc.details || "–")}</div><div class="l">Spread</div></div>
        ${pc.overUnder != null ? `<div class="stat-box"><div class="n" style="color:var(--market)">${fmt1(pc.overUnder)}</div><div class="l">Total</div></div>` : ""}
        <div class="stat-box"><div class="n" style="color:var(--market)">${ml(pc.awayTeamOdds)}</div><div class="l">${esc(g.away.abbr)} ML</div></div>
        <div class="stat-box"><div class="n" style="color:var(--market)">${ml(pc.homeTeamOdds)}</div><div class="l">${esc(g.home.abbr)} ML</div></div>
      </div>${g.state !== "pre" ? `<p class="muted small" style="margin:10px 0 0">ESPN may still show the pre-game line once a game starts; this isn't a live in-game price.</p>` : ""}</div>`));
  }
  // your model's player projections (NBA props board, NFL player file)
  if (g.state !== "post" && (sport === "nba" || sport === "nfl")) {
    try { out.push(projectionTable(sport, await gameProjections(sport, g))); }
    catch (e) { out.push(section("pp", "Player projections", errBox("the model's player file", e))); }
  }
  // ESPN's win probability (theirs, not your model)
  const wp = d.winprobability || [];
  if (wp.length > 3 && g.state !== "pre") out.push(section("wp", "Win probability", wpChart(g, wp), "ESPN's model, not yours"));
  // key events
  out.push(keyEvents(g, d, sport));
  // game leaders
  const L = d.leaders || [];
  if (L.length && L.some((t) => t.leaders?.some((c) => c.leaders?.length))) {
    const rows = L.flatMap((t) => (t.leaders || []).slice(0, 3).map((c) => ({ t, c, a: c.leaders?.[0] }))).filter((x) => x.a);
    out.push(section("leaders", g.state === "pre" ? "Season leaders" : "Game leaders", `<div class="card list">${rows.map(({ t, c, a }) =>
      `<a class="perf" href="#/player/${sport}/${a.athlete.id}">${headshot(a.athlete.headshot?.href || a.athlete.headshot)}
        <div class="sp"><div class="t ellip">${esc(a.athlete.displayName)}${isFavPlayer(sport, a.athlete.id) ? ' <span class="badge b-fav">★</span>' : ""}</div>
        <div class="s muted small">${esc(t.team?.abbreviation || "")} · ${esc(c.displayName)}</div></div><div class="stat">${esc(a.displayValue)}</div></a>`).join("")}</div>`, "Actual · ESPN"));
  }
  // injuries (ESPN, with update dates)
  const inj = (d.injuries || []).filter((t) => t.injuries?.length);
  if (inj.length) out.push(section("inj", "Injuries", `<div class="card list">${inj.flatMap((t) => t.injuries.slice(0, 8).map((i) =>
    `<a class="li" href="#/player/${sport}/${i.athlete?.id}">${headshot(i.athlete?.headshot?.href)}<div class="sp"><div class="t ellip">${esc(i.athlete?.displayName)}</div>
      <div class="s ellip">${esc(t.team?.abbreviation)} · ${esc([i.details?.type, i.details?.detail].filter(Boolean).join(" ") || i.type?.description || "")}${i.date ? ` · updated ${esc(fmtDay(new Date(i.date)))}` : ""}</div></div>
      <span class="badge b-plain">${esc(i.status)}</span></a>`)).join("")}</div>`, "ESPN"));
  else if (g.model?.injuries && (g.model.injuries.away.length || g.model.injuries.home.length))
    out.push(section("inj", "Injuries", `<div class="card list">${[["away", g.away], ["home", g.home]].flatMap(([k, t]) => g.model.injuries[k].map((p) =>
      `<div class="li">${logo(t)}<div class="sp t">${esc(p.name)}</div><span class="badge b-plain">${esc(p.status)}</span></div>`)).join("")}</div>`, `via ${esc(SPORTS[sport].modelName)} file, ${ago(g.model.updated)}`));
  return out.join("") + `<p class="muted small" style="text-align:center;margin-top:18px">Game data: ESPN${g.state === "in" ? " · refreshes every 20 seconds" : ""}</p>`;
}

function wpChart(g, wp) {
  const W = 600, H = 150, n = wp.length;
  const pts = wp.map((w, i) => [(i / (n - 1)) * W, H - w.homeWinPercentage * H]);
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const last = wp[n - 1].homeWinPercentage;
  const lead = last >= 0.5 ? g.home : g.away;
  return `<div class="card pad"><div class="row" style="margin-bottom:8px"><b>${esc(lead.abbr)} ${pct(Math.max(last, 1 - last))}</b><span class="muted small">${g.state === "post" ? "at the end" : "right now"}</span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:120px;display:block" role="img" aria-label="Win probability over the game">
      <rect x="0" y="0" width="${W}" height="${H / 2}" fill="${esc(g.home.color)}" opacity=".07"/><rect x="0" y="${H / 2}" width="${W}" height="${H / 2}" fill="${esc(g.away.color)}" opacity=".07"/>
      <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="var(--line2)" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
      <path d="${path}" stroke="var(--text)" stroke-width="2" fill="none" vector-effect="non-scaling-stroke"/></svg>
    <div class="row muted small" style="justify-content:space-between;margin-top:4px"><span>↑ ${esc(g.home.abbr)}</span><span>↓ ${esc(g.away.abbr)}</span></div></div>`;
}

function keyEvents(g, d, sport) {
  if (SPORTS[sport].kind === "football") {
    const sp = d.scoringPlays || [];
    if (!sp.length) return "";
    return section("events", "Scoring plays", `<div class="card list">${sp.map((p) => {
      const t = p.team?.id === g.home.id ? g.home : g.away;
      return `<div class="li">${logo(t)}<div class="sp"><div class="t" style="font-weight:500">${esc(p.text)}</div>
        <div class="s">${esc(p.type?.text || "")} · Q${p.period?.number} ${esc(p.clock?.displayValue || "")}</div></div>
        <b class="small" style="white-space:nowrap">${p.awayScore}-${p.homeScore}</b></div>`;
    }).join("")}</div>`, "ESPN");
  }
  // basketball: work out lead changes, ties, biggest leads and runs from the play-by-play
  const P = (d.plays || []).filter((p) => p.awayScore != null);
  if (!P.length || g.state === "pre") return "";
  let changes = 0, ties = 0, leader = 0, maxA = 0, maxH = 0, prevA = 0, prevH = 0;
  let run = { team: null, pts: 0 }, best = { team: null, pts: 0, end: null };
  for (const p of P) {
    const a = p.awayScore, h = p.homeScore;
    if (a === prevA && h === prevH) continue;
    const scorer = a > prevA ? "away" : "home";
    const ptsNow = scorer === "away" ? a - prevA : h - prevH;
    run = run.team === scorer ? { team: scorer, pts: run.pts + ptsNow } : { team: scorer, pts: ptsNow };
    if (run.pts > best.pts) best = { ...run, end: p };
    const l = Math.sign(h - a);
    if (l === 0 && (a || h)) ties++;
    if (l !== 0 && leader !== 0 && l !== leader) changes++;
    if (l !== 0) leader = l;
    maxA = Math.max(maxA, a - h); maxH = Math.max(maxH, h - a);
    prevA = a; prevH = h;
  }
  const bt = best.team ? g[best.team] : null;
  const recent = g.state === "in" ? P.slice(-6).reverse() : [];
  return section("events", "Game flow", `<div class="stats-grid">
      <div class="stat-box"><div class="n">${changes}</div><div class="l">Lead changes</div></div>
      <div class="stat-box"><div class="n">${ties}</div><div class="l">Times tied</div></div>
      <div class="stat-box"><div class="n">${maxA}</div><div class="l">${esc(g.away.abbr)} biggest lead</div></div>
      <div class="stat-box"><div class="n">${maxH}</div><div class="l">${esc(g.home.abbr)} biggest lead</div></div>
      ${bt ? `<div class="stat-box"><div class="n">${best.pts}-0</div><div class="l">${esc(bt.abbr)} biggest run</div><div class="r">ended ${esc(best.end?.period?.displayValue || "")} ${esc(best.end?.clock?.displayValue || "")}</div></div>` : ""}
    </div>${recent.length ? `<div class="card list" style="margin-top:10px">${recent.map((p) => playRow(g, p)).join("")}</div>` : ""}`, "From ESPN play-by-play");
}

// ---------------------------------------------------------------- box score
function box(g, d, sport) {
  const P = d.boxscore?.players || [];
  if (!P.length) return empty(g.state === "pre" ? "The box score shows up once the game starts." : "ESPN has no box score for this game.");
  const sideTeam = (k) => (k === "home" ? g.home : g.away);
  const blk = P.find((p) => String(p.team.id) === sideTeam(ui.boxSide).id) || P[0];
  const toggle = `<div class="seg" style="margin:14px 0 10px">${["away", "home"].map((k) => `<button data-gc="side" data-v="${k}" aria-pressed="${ui.boxSide === k}">${esc(sideTeam(k).short)}</button>`).join("")}</div>`;
  const kind = SPORTS[sport].kind;
  const tables = blk.statistics.map((grp) => {
    const ath = grp.athletes || [];
    if (!ath.length) return "";
    const row = (a) => `<tr class="${isFavPlayer(sport, a.athlete.id) ? "fav" : ""}"><td class="pcol"><a href="#/player/${sport}/${a.athlete.id}">${esc(a.athlete.shortName || a.athlete.displayName)}</a>
      <span class="muted small">${esc(a.athlete.position?.abbreviation || "")}</span></td>
      ${a.didNotPlay ? `<td colspan="${grp.labels.length}" style="text-align:left" class="muted small">${esc(a.reason || "DNP")}</td>` : a.stats.map((s) => `<td>${esc(s)}</td>`).join("")}</tr>`;
    const head = `<tr><th class="pcol">${esc(grp.text || (kind === "basketball" ? "Player" : grp.name))}</th>${grp.labels.map((l) => `<th>${esc(l)}</th>`).join("")}</tr>`;
    let bodyRows;
    if (kind === "basketball") {
      const st = ath.filter((a) => a.starter), bn = ath.filter((a) => !a.starter && !a.didNotPlay), dnp = ath.filter((a) => a.didNotPlay);
      bodyRows = `${st.length ? `<tr class="sub"><td colspan="${grp.labels.length + 1}">Starters</td></tr>${st.map(row).join("")}` : ""}
        ${bn.length ? `<tr class="sub"><td colspan="${grp.labels.length + 1}">Bench</td></tr>${bn.map(row).join("")}` : ""}${dnp.map(row).join("")}`;
    } else bodyRows = ath.map(row).join("");
    const totals = grp.totals?.some((x) => x) ? `<tr class="tot"><td class="pcol">Team</td>${grp.totals.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>` : "";
    return `<div class="card tscroll" style="margin-bottom:12px"><table class="tbl box"><thead>${head}</thead><tbody>${bodyRows}${totals}</tbody></table></div>`;
  }).join("");
  return toggle + tables + `<p class="muted small" style="text-align:center">Actual · ESPN box score</p>`;
}

// ---------------------------------------------------------------- team stats comparison
function teamStats(g, d) {
  const T = d.boxscore?.teams || [];
  if (T.length < 2 || !T[0].statistics?.length) return empty(g.state === "pre" ? "Team stats show up once the game starts." : "No team stats from ESPN for this game.");
  const away = T.find((t) => String(t.team.id) === g.away.id) || T[0];
  const home = T.find((t) => String(t.team.id) === g.home.id) || T[1];
  const lead = (v) => parseFloat(String(v).replace(/[^0-9.\-]/g, " ").trim().split(/\s+/)[0]);
  const rows = away.statistics.map((s) => {
    const h = home.statistics.find((x) => x.name === s.name);
    if (!h) return "";
    const a = lead(s.displayValue), b = lead(h.displayValue);
    const tot = (Math.abs(a) || 0) + (Math.abs(b) || 0);
    const wa = tot ? (Math.abs(a) / tot) * 100 : 50;
    return `<div class="cmp"><div class="cmp-h"><b>${esc(s.displayValue)}</b><span>${esc(s.label)}</span><b>${esc(h.displayValue)}</b></div>
      <div class="cmp-bar"><i style="width:${wa}%;background:${esc(g.away.color)}"></i><i style="width:${100 - wa}%;background:${esc(g.home.color)}"></i></div></div>`;
  }).join("");
  return `<div class="card pad" style="margin-top:14px"><div class="cmp-h" style="margin-bottom:6px"><span class="tm">${logo(g.away)} <b>${esc(g.away.abbr)}</b></span><span></span><span class="tm"><b>${esc(g.home.abbr)}</b> ${logo(g.home)}</span></div>${rows}</div>
    <p class="muted small" style="text-align:center">${g.state === "pre" ? "Season numbers before the game" : "This game"} · Actual · ESPN</p>`;
}

// ---------------------------------------------------------------- plays
function playRow(g, p) {
  const t = p.team?.id === g.home.id ? g.home : p.team?.id === g.away.id ? g.away : null;
  return `<div class="play ${p.scoringPlay ? "scoring" : ""}">${t ? logo(t, "logo logo-sm") : '<span class="logo-sm"></span>'}
    <div class="sp"><div class="pt">${esc(p.text)}</div><div class="s muted small">${esc(p.period?.displayValue || (p.period?.number ? `Q${p.period.number}` : ""))} ${esc(p.clock?.displayValue || "")}</div></div>
    <b class="small" style="white-space:nowrap">${p.awayScore ?? ""}-${p.homeScore ?? ""}</b></div>`;
}

function plays(g, d, sport) {
  if (SPORTS[sport].kind === "football") {
    const drives = [...(d.drives?.previous || [])];
    if (d.drives?.current) drives.push(d.drives.current);
    if (!drives.length) return empty(g.state === "pre" ? "Drives show up once the game starts." : "ESPN has no drive data for this game.");
    const list = (ui.playsMode === "scoring" ? drives.filter((x) => x.isScore) : drives).slice().reverse();
    return `<div class="seg" style="margin:14px 0 10px"><button data-gc="mode" data-v="all" aria-pressed="${ui.playsMode === "all"}">All drives</button><button data-gc="mode" data-v="scoring" aria-pressed="${ui.playsMode === "scoring"}">Scoring drives</button></div>
      <div class="card list">${list.map((dr) => {
        const t = String(dr.team?.id) === g.home.id ? g.home : g.away;
        return `<div class="drive"><button class="li" data-gc="drive" style="width:100%;text-align:left">${logo(t)}<div class="sp"><div class="t">${esc(dr.displayResult || dr.result || "")}</div>
          <div class="s">${esc(dr.description || "")}${dr.start?.period?.number ? ` · Q${dr.start.period.number}` : ""}</div></div>${dr.isScore ? '<span class="badge b-actual">Score</span>' : ""}<span class="chev">${ICON.down}</span></button>
          <div class="drive-plays">${(dr.plays || []).map((p) => playRow(g, { ...p, team: dr.team })).join("")}</div></div>`;
      }).join("")}</div><p class="muted small" style="text-align:center">Actual · ESPN</p>`;
  }
  const P = (d.plays || []).filter((p) => p.text);
  if (!P.length) return empty(g.state === "pre" ? "Play-by-play starts at tip-off." : "ESPN has no play-by-play for this game.");
  const periods = [...new Set(P.map((p) => p.period?.number))].filter(Boolean);
  const label = (n) => (sport === "ncaab" ? (n <= 2 ? `${n}H` : `OT${n - 2}`) : n <= 4 ? `Q${n}` : `OT${n - 4}`);
  if (ui.period !== "all" && ui.period !== "scoring" && !periods.includes(+ui.period)) ui.period = "all";
  let list = P;
  if (ui.period === "scoring") list = P.filter((p) => p.scoringPlay);
  else if (ui.period !== "all") list = P.filter((p) => p.period?.number === +ui.period);
  list = list.slice().reverse().slice(0, 400);
  return `<div class="seg" style="margin:14px 0 10px"><button data-gc="period" data-v="all" aria-pressed="${ui.period === "all"}">All</button><button data-gc="period" data-v="scoring" aria-pressed="${ui.period === "scoring"}">Scoring</button>
      ${periods.map((n) => `<button data-gc="period" data-v="${n}" aria-pressed="${ui.period === String(n)}">${label(n)}</button>`).join("")}</div>
    <div class="card list">${list.map((p) => playRow(g, p)).join("")}</div><p class="muted small" style="text-align:center">Newest first · Actual · ESPN</p>`;
}

// ---------------------------------------------------------------- matchup: head-to-head + recent form
async function matchup(g, d, sport) {
  const out = [];
  const season = d.header?.season?.year;
  // previous meetings: the home team's schedules this season and the 3 before it
  const seasons = season ? [season, season - 1, season - 2, season - 3] : [];
  const res = await Promise.allSettled(seasons.map((s) => seasonSchedule(sport, g.home.id, s)));
  const seen = new Set();
  const meets = res.flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((x) => x.state === "post" && x.id !== g.id && [x.home.id, x.away.id].includes(g.away.id) && !seen.has(x.id) && seen.add(x.id))
    .sort((a, b) => b.start - a.start);
  let wa = 0, wh = 0;
  for (const m of meets) {
    const ah = m.home.id === g.home.id ? m.home : m.away, aa = ah === m.home ? m.away : m.home;
    if (ah.score > aa.score) wh++; else if (aa.score > ah.score) wa++;
  }
  const failed = res.filter((r) => r.status === "rejected").length;
  out.push(section("h2h", "Head to head", meets.length ? `<div class="stats-grid" style="margin-bottom:10px">
      <div class="stat-box"><div class="n">${wa}</div><div class="l">${esc(g.away.abbr)} wins</div></div>
      <div class="stat-box"><div class="n">${wh}</div><div class="l">${esc(g.home.abbr)} wins</div></div>
      <div class="stat-box"><div class="n">${meets.length}</div><div class="l">Meetings</div><div class="r">last ${seasons.length} seasons</div></div></div>
    <div class="card list">${meets.slice(0, 10).map((m) => {
      const w = m.home.score > m.away.score ? m.home : m.away;
      return `<a class="li" href="#/game/${sport}/${m.id}">${logo(w)}<div class="sp"><div class="t">${esc(w.abbr)} won ${Math.max(m.home.score, m.away.score)}-${Math.min(m.home.score, m.away.score)}</div>
        <div class="s">${esc(m.away.abbr)} @ ${esc(m.home.abbr)} · ${esc(m.start.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }))}</div></div></a>`;
    }).join("")}</div>`
    : empty(`No meetings between these teams in the last ${seasons.length || "few"} seasons${failed ? " (some seasons failed to load)" : ""}.`), "Actual · ESPN"));

  // recent form (current season)
  const forms = await Promise.allSettled([g.away, g.home].map((t) => schedule(sport, t.id)));
  const form = (t, r) => {
    if (r.status !== "fulfilled") return `<div class="li muted small">Couldn't load ${esc(t.short)}'s schedule.</div>`;
    const last = r.value.games.filter((x) => x.state === "post" && x.id !== g.id).slice(-5).reverse();
    if (!last.length) return `<div class="li muted small">${esc(t.short)}: no games yet.</div>`;
    const pills = last.map((x) => {
      const me = x.home.id === t.id ? x.home : x.away, op = me === x.home ? x.away : x.home;
      const w = me.score > op.score;
      return `<a class="fpill ${w ? "w" : "l"}" href="#/game/${sport}/${x.id}" title="${me === x.home ? "vs" : "@"} ${esc(op.abbr)} ${me.score}-${op.score}"><b>${w ? "W" : "L"}</b><span>${me === x.home ? "" : "@"}${esc(op.abbr)}</span></a>`;
    }).join("");
    const margin = last.reduce((s, x) => { const me = x.home.id === t.id ? x.home : x.away, op = me === x.home ? x.away : x.home; return s + (me.score - op.score); }, 0) / last.length;
    return `<div class="li" style="flex-wrap:wrap">${logo(t)}<div class="sp"><div class="t">${esc(t.short)}</div><div class="s">Avg margin ${margin > 0 ? "+" : ""}${margin.toFixed(1)} over last ${last.length}</div></div><div class="fpills">${pills}</div></div>`;
  };
  out.push(section("form", "Recent form", `<div class="card list">${form(g.away, forms[0])}${form(g.home, forms[1])}</div>`, "Last 5 · Actual · ESPN"));

  // records side by side (ESPN gives the home team's home record and the road team's road record)
  const rec = (t, type) => t.records?.find((r) => r.type === type)?.text || "–";
  out.push(section("recs", "Records", `<div class="card tscroll"><table class="tbl"><thead><tr><th>Team</th><th>Overall</th><th>Home / road</th><th>Conf</th></tr></thead><tbody>
    ${[[g.away, "road"], [g.home, "home"]].map(([t, k]) => `<tr><td><span class="tm">${logo(t)}${esc(t.abbr)}</span></td><td>${esc(rec(t, "total"))}</td>
      <td>${esc(rec(t, k))} <span class="muted small">${k}</span></td><td>${esc(rec(t, "vsconf"))}</td></tr>`).join("")}
    </tbody></table></div>`, "ESPN"));
  out.push(`<p class="muted small" style="text-align:center;margin-top:16px">Deeper matchup analysis (efficiency, player matchups) comes with the Matchup Analyzer.</p>`);
  return out.join("");
}
