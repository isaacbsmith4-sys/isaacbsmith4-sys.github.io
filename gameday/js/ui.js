// Shared UI pieces. All return HTML strings; clicks are handled by data-action in app.js.
import { esc, fmtTime, dayLabel, ago, isFavTeam, isFavPlayer, state } from "./core.js?v=9";
import { SPORTS, spreadText, fmt1, pct } from "./data.js?v=9";

export const ICON = {
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
};

export const sportBadge = (sport) =>
  `<span class="badge b-sport" style="background:var(--${sport})">${SPORTS[sport].label}</span>`;
export const modelBadge = (src) => `<span class="badge b-model" title="Prediction from ${esc(src)}">Model</span>`;
export const marketBadge = (book) => `<span class="badge b-market" title="Sportsbook line">${esc(shortBook(book))}</span>`;
export const shortBook = (b) => (!b ? "Line" : /draft\s*kings/i.test(b) ? "DK" : /consensus/i.test(b) ? "Consensus" : b);

export function logo(t, cls = "logo") {
  if (t?.logo) return `<img class="${cls}" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
  return `<span class="${cls} logo-fb" style="background:${esc(t?.color || "#333")}">${esc((t?.abbr || "?").slice(0, 3))}</span>`;
}
export function headshot(url, cls = "headshot") {
  return url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : `<span class="${cls}"></span>`;
}
export const starBtn = (on, action, data, label) =>
  `<button class="star-btn" aria-pressed="${on}" aria-label="${on ? "Unfollow" : "Follow"} ${esc(label)}" data-action="${action}" ${data}>${ICON.star}</button>`;

export function statusText(g) {
  if (g.state === "pre") return `${dayLabel(g.start) === "Today" ? "" : dayLabel(g.start) + " · "}${fmtTime(g.start)}`;
  return g.detail || (g.state === "post" ? "Final" : "Live");
}

// ---------- game card
export function gameCard(g, { reason = "", showModel = true } = {}) {
  const fav = isFavTeam(g.sport, g.home.id) || isFavTeam(g.sport, g.away.id) ||
    state.players.some((p) => p.sport === g.sport && (p.teamId === g.home.id || p.teamId === g.away.id));
  const live = g.state === "in";
  const row = (t, other) => {
    const lose = g.state === "post" && t.score != null && other.score != null && t.score < other.score;
    const star = isFavTeam(g.sport, t.id) ? '<span class="star">★</span>' : "";
    return `<div class="trow ${lose ? "lose" : ""}">${logo(t)}
      <div class="tname"><span class="ellip">${t.rank ? `<span class="rk">${t.rank}</span> ` : ""}${esc(t.short || t.name)}</span>${star}
      ${t.record ? `<span class="rec">${esc(t.record)}</span>` : ""}</div>
      <div class="score">${g.state === "pre" || t.score == null ? "" : t.score}</div></div>`;
  };
  let foot = "";
  const m = showModel && g.model;
  if (m && g.state !== "post") {
    const hp = m.home_win_prob;
    foot = `<div class="game-foot">${modelBadge(m.source)}
      <span class="kv"><b>${spreadText(m.spread_home, g)}</b></span>
      ${m.total != null ? `<span class="kv">O/U <b>${fmt1(m.total)}</b></span>` : ""}
      ${hp != null ? `<span class="kv">${esc(hp >= 0.5 ? g.home.abbr : g.away.abbr)} <b>${pct(Math.max(hp, 1 - hp))}</b></span>` : ""}
      ${m.market?.spread_home != null ? `<span class="sp"></span>${marketBadge(m.market.book)}<span class="kv"><b>${spreadText(m.market.spread_home, g)}</b></span>` : ""}
    </div>
    ${hp != null ? `<div class="wbar" aria-hidden="true"><i style="width:${(1 - hp) * 100}%;background:${esc(g.away.color)}"></i><i style="width:${hp * 100}%;background:${esc(g.home.color)}"></i></div>` : ""}`;
  } else if (g.state === "pre" && g.espnOdds?.details) {
    foot = `<div class="game-foot">${marketBadge(g.espnOdds.book)}<span class="kv"><b>${esc(g.espnOdds.details)}</b></span>
      ${g.espnOdds.total ? `<span class="kv">O/U <b>${esc(g.espnOdds.total)}</b></span>` : ""}
      <span class="sp"></span><span class="muted small">No model line</span></div>`;
  }
  return `<a class="card game ${fav ? "fav" : ""} ${live ? "live" : ""}" href="#/game/${g.sport}/${g.id}">
    <div class="game-top">${sportBadge(g.sport)}${live ? '<span class="dot-live"></span>' : ""}
      ${reason ? `<span class="reason ellip">${esc(reason)}</span>` : g.tv.length ? `<span class="ellip">${esc(g.tv.slice(0, 2).join(" · "))}</span>` : ""}
      <span class="status">${esc(statusText(g))}</span></div>
    ${row(g.away, g.home)}${row(g.home, g.away)}${foot}</a>`;
}

export const section = (key, title, body, meta = "") =>
  `<section class="section" data-sec="${key}"><div class="sec-head"><h2 class="sec-title">${title}</h2>${meta ? `<span class="sec-meta">${meta}</span>` : ""}</div>${body}</section>`;
export const empty = (html) => `<div class="empty">${html}</div>`;
export const errBox = (what, e) => `<div class="err">Couldn't load ${esc(what)}: ${esc(e?.message || e)}. It'll retry on the next refresh.</div>`;
export const skel = (n = 2) => `<div class="grid cols">${'<div class="skel"></div>'.repeat(n)}</div>`;
export const updated = (d, src) => `${esc(src)} · updated ${ago(d)}`;

export function newsItem(a) {
  const fav = a.teamIds.some((id) => isFavTeam(a.sport, id)) || a.athleteIds.some((id) => isFavPlayer(a.sport, id));
  return `<a class="news" href="${esc(a.url)}" target="_blank" rel="noopener">
    ${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy">` : ""}
    <div class="sp"><div class="h">${esc(a.headline)}</div>
    <div class="m">${sportBadge(a.sport)}${fav ? '<span class="badge b-fav">Following</span>' : ""}<span>${esc(a.source)}</span>·<span>${ago(a.published)}</span></div></div></a>`;
}

// Your model next to the line, for one game (team page, game center)
export function modelBlock(g) {
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
