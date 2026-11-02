/* LIFE HQ app registry and adapters. Loaded by LIFE HQ (after kit.js).

   Each built app gets an adapter that reads that app's own files in life-data and answers two
   questions in one common shape, so LIFE HQ never copies data out of an app:
     today(dayKey)  -> the numbers for the Today screen
     events(from, to) -> calendar entries: {date, time?, end?, title, detail?, app, planned?}
     series(from, to) -> {metricId: [{date, v}]}, the daily numbers behind Goals and Analytics
   METRICS describes each metric id once (label, unit, how a week of it adds up, which way is better).
   `planned: true` marks things that haven't happened yet (a bedtime, a due date) so they're
   never shown as logged. Adding an app = one entry in APPS + one adapter here. */
(function () {
  "use strict";
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parseKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return ymd(d); };
  const hm = s => { const [h, m] = String(s || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const at = (k, t) => { const d = parseKey(k); d.setMinutes(hm(t)); return d; };
  const dur = min => { min = Math.max(0, Math.round(min)); const h = Math.floor(min / 60), m = min % 60; return h ? h + "h " + pad(m) + "m" : m + "m"; };
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  const time = d => d.toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});

  // phase = roadmap stage it's built in; path is relative to /hq/
  const APPS = [
    {id: "sleep", name: "Sleep", color: "#8f86ff", path: "../sleep/", built: true, blurb: "Bedtime, wind-down, sleep log"},
    {id: "fuel", name: "Fuel", color: "#ff6a3d", path: "../fuel/", built: true, blurb: "Food, macros, water, weight"},
    {id: "train", name: "Train", color: "#3fd3ff", path: "../train/", built: true, blurb: "Lifting, progressive overload, PRs"},
    {id: "habits", name: "Habits", color: "#ff7eb6", path: "../habits/", built: true, blurb: "Routines, streaks, non-negotiables"},
    {id: "school", name: "School", color: "#f2c14e", path: "../school/", built: true, blurb: "Assignments, grades, study tools"},
    {id: "focus", name: "Focus", color: "#6aa8ff", path: "../focus/", built: true, blurb: "Focus timer and study hours"},
    {id: "mindset", name: "Mindset", color: "#d29bff", phase: 3, blurb: "Journal, reflections, weekly review"},
    {id: "recovery", name: "Recovery", color: "#46d1c4", path: "../recovery/", built: true, blurb: "Readiness, soreness, training load"},
    {id: "basketball", name: "Basketball", color: "#e0955a", path: "../basketball/", built: true, blurb: "Shooting charts and skill work"},
    {id: "finance", name: "Finance", color: "#7bd88f", phase: 4, blurb: "Budget, spending, savings"},
  ];

  /* ---------- Sleep ---------- */
  const sleep = (() => {
    const nights = Life.col("sleep/nights"), settings = Life.doc("sleep/settings"), state = Life.doc("sleep/state");
    const DEF = {goal: 8.5, wake: ["08:30", "06:30", "06:30", "06:30", "06:30", "06:30", "08:30"], windDown: 45, latency: 15, checklist: []};
    const set = () => ({...DEF, ...(settings.get() || {})});
    const asleep = (n, s) => n && n.bed && n.wake ? Math.max(0, (new Date(n.wake) - new Date(n.bed)) / 60000 - s.latency) : null;
    function plan(k) {
      const s = set(), n = nights.all()[k];
      const tomorrow = addDays(k, 1), wake = at(tomorrow, s.wake[parseKey(tomorrow).getDay()]);
      const bed = new Date(wake - (s.goal * 60 + (n && n.big ? 30 : 0) + s.latency) * 60000);
      return {wake, bed, wind: new Date(bed - s.windDown * 60000)};
    }
    return {
      has: () => !!settings.get() || Object.keys(nights.all()).length > 0,
      today(k) {
        const s = set(), all = nights.all(), last = all[addDays(k, -1)], tonight = all[k] || {};
        const p = plan(k), wd = s.checklist.filter(i => tonight.wd && tonight.wd[i.id]).length;
        const active = (state.get() || {}).active;
        return {
          lastNight: last && last.wake ? {min: asleep(last, s), q: last.q || null, bed: new Date(last.bed), wake: new Date(last.wake)} : null,
          goalMin: s.goal * 60, bed: p.bed, wind: p.wind, wake: p.wake, windDone: wd, windTotal: s.checklist.length, inBed: active ? new Date(active.start) : null,
        };
      },
      events(from, to) {
        const s = set(), out = [];
        for (const [k, n] of Object.entries(nights.all())) {
          if (k < from || k > to || !n.wake) continue;
          const m = asleep(n, s);
          out.push({date: k, time: new Date(n.bed), end: new Date(n.wake), app: "sleep", title: "Slept " + dur(m), detail: `${time(new Date(n.bed))} → ${time(new Date(n.wake))}${n.q ? " · rested " + n.q + "/5" : ""}`});
        }
        const today = ymd(new Date(Date.now() - 4 * 3600e3));
        if (today >= from && today <= to && settings.get() && !(nights.all()[today] || {}).wake) { // planned bedtime only once Sleep is set up
          const p = plan(today);
          out.push({date: today, time: p.wind, app: "sleep", planned: true, title: "Wind-down", detail: "starts " + time(p.wind)});
          out.push({date: today, time: p.bed, app: "sleep", planned: true, title: "Bedtime", detail: `${time(p.bed)} for ${s.goal}h before ${time(p.wake)}`});
        }
        return out;
      },
      series(from, to) {
        const s = set(), out = {"sleep.asleep": [], "sleep.rested": [], "sleep.bedtime": []};
        for (const [k, n] of Object.entries(nights.all()).sort()) {
          if (k < from || k > to || !n.wake) continue;
          out["sleep.asleep"].push({date: k, v: asleep(n, s) / 60});
          if (n.q) out["sleep.rested"].push({date: k, v: n.q});
          const b = new Date(n.bed); let m = b.getHours() * 60 + b.getMinutes(); if (m < 720) m += 1440; // minutes after midnight, past-midnight wraps forward
          out["sleep.bedtime"].push({date: k, v: m});
        }
        return out;
      },
      goalHours: () => set().goal,
      load: months => nights.load(months),
    };
  })();

  /* ---------- Fuel ---------- */
  const fuel = (() => {
    const days = Life.col("fuel/days"), weights = Life.col("fuel/weights"), settings = Life.doc("fuel/settings");
    const goals = () => ({cal: 2800, p: 160, c: 340, f: 85, water: 10, ...((settings.get() || {}).settings || {})});
    const totals = d => (d && d.items || []).reduce((t, i) => ({cal: t.cal + i.cal, p: t.p + i.p, c: t.c + i.c, f: t.f + i.f}), {cal: 0, p: 0, c: 0, f: 0});
    return {
      has: () => !!settings.get() || Object.keys(days.all()).length > 0,
      today(k) {
        const d = days.all()[k], ws = Object.entries(weights.all()).sort((a, b) => a[0] < b[0] ? 1 : -1);
        return {goals: goals(), t: totals(d), water: (d && d.water) || 0, items: (d && d.items || []).length, weight: ws.length ? {date: ws[0][0], lb: ws[0][1].lb} : null};
      },
      events(from, to) {
        const out = [];
        for (const [k, d] of Object.entries(days.all())) {
          if (k < from || k > to || !(d.items || []).length) continue;
          const t = totals(d);
          out.push({date: k, app: "fuel", title: `${Math.round(t.cal).toLocaleString()} kcal`, detail: `${Math.round(t.p)} g protein · ${(d.items || []).length} food${(d.items || []).length === 1 ? "" : "s"}${d.water ? ` · ${d.water} cups water` : ""}`});
        }
        for (const [k, w] of Object.entries(weights.all())) if (k >= from && k <= to) out.push({date: k, app: "fuel", title: `Weighed ${w.lb} lb`});
        return out;
      },
      series(from, to) {
        const out = {"fuel.cal": [], "fuel.protein": [], "fuel.water": [], "fuel.weight": []};
        for (const [k, d] of Object.entries(days.all()).sort()) {
          if (k < from || k > to) continue;
          if ((d.items || []).length) { const t = totals(d); out["fuel.cal"].push({date: k, v: t.cal}); out["fuel.protein"].push({date: k, v: t.p}); }
          if (d.water) out["fuel.water"].push({date: k, v: d.water});
        }
        for (const [k, w] of Object.entries(weights.all()).sort()) if (k >= from && k <= to) out["fuel.weight"].push({date: k, v: w.lb});
        return out;
      },
      goals,
      load: months => Promise.all([days.load(months), weights.load(months)]),
    };
  })();

  /* ---------- Train ---------- */
  const train = (() => {
    const workouts = Life.col("train/workouts", {months: 6}), settings = Life.doc("train/settings"), state = Life.doc("train/state");
    const set = () => ({plan: {}, templates: [], ...(settings.get() || {})});
    const label = w => w.type === "strength" ? `${plural((w.ex || []).length, "exercise")} · ${plural((w.ex || []).reduce((n, x) => n + x.sets.length, 0), "set")}${(w.prs || []).length ? ` · ${w.prs.length} PR` : ""}`
      : w.type === "cond" ? `${w.cond.min} min${w.cond.dist ? " · " + w.cond.dist + " mi" : ""}` : `${(w.mob || {}).min || 0} min mobility`;
    const plannedOn = k => { const s = set(), id = s.plan[parseKey(k).getDay()]; return id ? s.templates.find(t => t.id === id) : null; };
    return {
      has: () => !!settings.get() || Object.keys(workouts.all()).length > 0,
      today(k) {
        const all = Object.values(workouts.all()), done = all.filter(w => w.date === k);
        const ws = addDays(k, -parseKey(k).getDay()), week = all.filter(w => w.date >= ws && w.date <= k).length;
        const s = set(), plannedWeek = Object.values(s.plan).filter(Boolean).length, a = (state.get() || {}).active;
        return {done, planned: plannedOn(k), week, plannedWeek, active: a || null};
      },
      events(from, to) {
        const out = [], all = workouts.all(), today = ymd(new Date(Date.now() - 3 * 3600e3));
        for (const w of Object.values(all)) if (w.date >= from && w.date <= to)
          out.push({date: w.date, time: w.start ? new Date(w.start) : null, app: "train", title: w.name + (w.start && w.end ? ` · ${Math.round((new Date(w.end) - new Date(w.start)) / 60000)} min` : ""), detail: label(w)});
        for (let k = from > today ? from : today; k <= to; k = addDays(k, 1)) {
          const t = plannedOn(k);
          if (t && !Object.values(all).some(w => w.date === k)) out.push({date: k, app: "train", planned: true, title: t.name, detail: `${t.ex.length} exercises`});
        }
        return out;
      },
      series(from, to) {
        const out = {"train.workouts": [], "train.sets": []}, per = {};
        const e1 = (w, r) => w > 0 && r > 0 ? w * (1 + r / 30) : 0;
        for (const w of Object.values(workouts.all()).sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")))) {
          if (w.date < from || w.date > to) continue;
          const d = per[w.date] ||= {n: 0, sets: 0}; d.n++;
          for (const x of w.ex || []) {
            d.sets += x.sets.length;
            const best = Math.max(0, ...x.sets.map(st => e1(+st.w || 0, +st.r || 0)));
            if (best) (out["train.lift:" + x.n] ||= []).push({date: w.date, v: Math.round(best)});
          }
        }
        for (const [k, d] of Object.entries(per).sort()) { out["train.workouts"].push({date: k, v: d.n}); out["train.sets"].push({date: k, v: d.sets}); }
        return out;
      },
      workouts: () => Object.values(workouts.all()),
      lifts() { const n = {}; for (const w of Object.values(workouts.all())) for (const x of w.ex || []) n[x.n] = (n[x.n] || 0) + 1; return Object.keys(n).sort((a, b) => n[b] - n[a]); },
      load: months => workouts.load(months),
    };
  })();

  /* ---------- Habits ---------- */
  const habits = (() => {
    const days = Life.col("habits/days", {months: 4}), settings = Life.doc("habits/settings");
    const live = () => ((settings.get() || {}).habits || []).filter(h => !h.archived);
    const val = (h, k) => ((days.all()[k] || {}).done || {})[h.id];
    const isDone = (h, k) => h.kind === "count" ? (val(h, k) || 0) >= h.target : !!val(h, k);
    const weekStart = k => addDays(k, -parseKey(k).getDay());
    // same rules as the Habits app: set days, or "N times a week" stays due until the week's count is met
    function isDue(h, k) {
      if (k < (h.created || "2000-01-01")) return false;
      const s = h.sched || {type: "daily"};
      if (s.type === "days") return (s.days || []).includes(parseKey(k).getDay());
      if (s.type === "weekly") { let n = 0; for (let d = weekStart(k); d < k; d = addDays(d, 1)) if (isDone(h, d)) n++; return n < s.times || isDone(h, k); }
      return true;
    }
    const score = k => { const due = live().filter(h => isDue(h, k)); return due.length ? {done: due.filter(h => isDone(h, k)).length, due: due.length, left: due.filter(h => !isDone(h, k))} : null; };
    return {
      has: () => live().length > 0,
      today(k) { const s = score(k) || {done: 0, due: 0, left: []}; return {...s, mustLeft: s.left.filter(h => h.nonneg).map(h => h.name)}; },
      events(from, to) {
        const out = [], today = ymd(new Date(Date.now() - 3 * 3600e3));
        for (let k = from; k <= to && k <= today; k = addDays(k, 1)) {
          const s = score(k); if (!s || (!s.done && k !== today)) continue;
          if (s.done) out.push({date: k, app: "habits", title: `Habits ${s.done}/${s.due}`, detail: s.done === s.due ? "all done" : `${s.due - s.done} missed${k === today ? " so far" : ""}`});
          if (k === today) for (const h of s.left) if (h.time) { const [hh, mm] = h.time.split(":").map(Number), t = parseKey(k); t.setHours(hh, mm); out.push({date: k, time: t, app: "habits", planned: true, title: h.name, detail: h.nonneg ? "non-negotiable" : ""}); }
        }
        return out;
      },
      series(from, to) {
        const out = {"habits.pct": []}, today = ymd(new Date(Date.now() - 3 * 3600e3));
        for (let k = from; k <= to && k <= today; k = addDays(k, 1)) { const s = score(k); if (s && (k < today || s.done === s.due)) out["habits.pct"].push({date: k, v: Math.round(s.done / s.due * 100)}); }
        return out;
      },
      load: months => days.load(months),
    };
  })();

  /* ---------- Focus ---------- */
  const focus = (() => {
    const sessions = Life.col("focus/sessions", {months: 4}), settings = Life.doc("focus/settings"), state = Life.doc("focus/state");
    const goal = () => ((settings.get() || {}).goal) || 120;
    const all = () => Object.values(sessions.all());
    return {
      has: () => !!settings.get() || all().length > 0,
      today(k) {
        const list = all().filter(x => x.date === k), a = (state.get() || {}).active;
        return {min: list.reduce((t, x) => t + x.min, 0), goal: goal(), count: list.length, active: a || null};
      },
      events(from, to) {
        return all().filter(x => x.date >= from && x.date <= to).map(x => ({date: x.date, time: new Date(x.start), end: new Date(x.end), app: "focus",
          title: `Focus · ${dur(x.min)}`, detail: [x.label || x.cat, x.label ? x.cat : "", x.distractions && x.distractions.length ? plural(x.distractions.length, "distraction") : "no distractions"].filter(Boolean).join(" · ")}));
      },
      series(from, to) {
        const by = {}, school = {};
        for (const x of all()) if (x.date >= from && x.date <= to) { by[x.date] = (by[x.date] || 0) + x.min; if (x.cat === "School") school[x.date] = (school[x.date] || 0) + x.min; }
        return {"focus.min": Object.entries(by).sort().map(([date, v]) => ({date, v})), "focus.school": Object.entries(school).sort().map(([date, v]) => ({date, v}))};
      },
      goal,
      load: months => sessions.load(months),
    };
  })();

  /* ---------- Recovery ----------
     The Recovery app stores each morning's readiness score with the check-in (and refreshes it when
     late inputs like last night's sleep arrive), so LIFE HQ shows the same number without recomputing. */
  const recovery = (() => {
    const checkins = Life.col("recovery/checkins", {months: 4}), sessions = Life.col("recovery/sessions", {months: 4});
    const band = sc => sc == null ? "" : sc >= 75 ? "ready to push" : sc >= 55 ? "moderate" : "take it easier";
    return {
      has: () => Object.keys(checkins.all()).length > 0 || Object.keys(sessions.all()).length > 0,
      today(k) { const c = checkins.all()[k]; return {checkin: c || null, score: c ? c.score ?? null : null, band: c ? band(c.score) : "", sessions: Object.values(sessions.all()).filter(x => x.date === k)}; },
      events(from, to) {
        const out = [];
        for (const [k, c] of Object.entries(checkins.all())) if (k >= from && k <= to)
          out.push({date: k, app: "recovery", title: `Readiness ${c.score ?? "–"}`, detail: `energy ${c.energy}/5 · soreness ${c.sore}/5 · stress ${c.stress}/5${c.rhr ? " · " + c.rhr + " bpm" : ""}`});
        for (const x of Object.values(sessions.all())) if (x.date >= from && x.date <= to) out.push({date: x.date, app: "recovery", title: x.type, detail: `${x.min} min recovery`});
        return out;
      },
      series(from, to) {
        const out = {"recovery.readiness": [], "recovery.energy": [], "recovery.soreness": [], "recovery.rhr": [], "recovery.hrv": []};
        for (const [k, c] of Object.entries(checkins.all()).sort()) {
          if (k < from || k > to) continue;
          if (c.score != null) out["recovery.readiness"].push({date: k, v: c.score});
          if (c.energy) out["recovery.energy"].push({date: k, v: c.energy});
          if (c.sore) out["recovery.soreness"].push({date: k, v: c.sore});
          if (c.rhr) out["recovery.rhr"].push({date: k, v: c.rhr});
          if (c.hrv) out["recovery.hrv"].push({date: k, v: c.hrv});
        }
        return out;
      },
      load: months => Promise.all([checkins.load(months), sessions.load(months)]),
    };
  })();

  /* ---------- Basketball ---------- */
  const basketball = (() => {
    const sessions = Life.col("basketball/sessions", {months: 6}), tests = Life.col("basketball/tests", {months: 24}), state = Life.doc("basketball/state");
    const THREE = new Set(["lc3", "rc3", "lw3", "rw3", "top3"]);
    const sum = (shots, f = () => true) => (shots || []).filter(f).reduce((t, x) => ({m: t.m + x.m, a: t.a + x.a}), {m: 0, a: 0});
    const TEST = {vert: ["Vertical", "in"], reach: ["Max touch", "in"], sprint34: ["3/4-court sprint", "sec"], yd40: ["40-yard dash", "sec"], lane: ["Lane agility", "sec"]};
    const all = () => Object.values(sessions.all());
    return {
      has: () => all().length > 0 || Object.keys(tests.all()).length > 0 || !!(state.get() || {}).active,
      today(k) {
        const list = all().filter(x => x.date === k), sh = sum(list.flatMap(x => x.shots || []));
        const ws = addDays(k, -parseKey(k).getDay()), wkList = all().filter(x => x.date >= ws && x.date <= k), wk = sum(wkList.flatMap(x => x.shots || []));
        const mins = l => l.reduce((t, x) => t + (x.min || (x.end ? Math.round((new Date(x.end) - new Date(x.start)) / 60000) : 0)), 0);
        return {count: list.length, shots: sh, week: wk, min: mins(list), weekMin: mins(wkList), weekCount: wkList.length, tags: list.flatMap(x => x.tags || []), active: (state.get() || {}).active || null};
      },
      events(from, to) {
        const out = [];
        for (const x of all()) if (x.date >= from && x.date <= to) {
          const sh = sum(x.shots), th = sum(x.shots, s => THREE.has(s.z)), ft = sum(x.shots, s => s.z === "ft");
          const mins = x.end ? Math.round((new Date(x.end) - new Date(x.start)) / 60000) : null;
          if (x.kind === "quick") { out.push({date: x.date, time: new Date(x.start), app: "basketball", title: `Basketball · ${x.min || mins} min`, detail: [(x.tags || []).join(", "), x.effort ? `effort ${x.effort}/10` : "", sh.a ? `${sh.m}/${sh.a} shots` : ""].filter(Boolean).join(" · ")}); continue; }
          out.push({date: x.date, time: new Date(x.start), app: "basketball", title: sh.a ? `Shooting · ${sh.m}/${sh.a}` : "Skill work" + (mins ? ` · ${mins} min` : ""),
            detail: [sh.a ? Math.round(sh.m / sh.a * 100) + "%" : "", th.a ? `3PT ${th.m}/${th.a}` : "", ft.a ? `FT ${ft.m}/${ft.a}` : "", (x.drills || []).length ? plural(x.drills.length, "drill") : ""].filter(Boolean).join(" · ")});
        }
        for (const t of Object.values(tests.all())) if (t.date >= from && t.date <= to) out.push({date: t.date, app: "basketball", title: `${TEST[t.test][0]}: ${t.v} ${TEST[t.test][1]}`, detail: t.pr ? "personal record" : "test"});
        return out;
      },
      series(from, to) {
        const by = {};
        for (const x of all()) if (x.date >= from && x.date <= to) (by[x.date] ||= []).push(...(x.shots || []));
        const out = {"bb.shots": [], "bb.pct": [], "bb.three": [], "bb.ft": [], "bb.vert": [], "bb.sprint34": []};
        for (const [k, sh] of Object.entries(by).sort()) {
          const a = sum(sh), th = sum(sh, s => THREE.has(s.z)), ft = sum(sh, s => s.z === "ft");
          if (a.a) { out["bb.shots"].push({date: k, v: a.a}); out["bb.pct"].push({date: k, v: Math.round(a.m / a.a * 100)}); }
          if (th.a >= 10) out["bb.three"].push({date: k, v: Math.round(th.m / th.a * 100)});
          if (ft.a >= 10) out["bb.ft"].push({date: k, v: Math.round(ft.m / ft.a * 100)});
        }
        for (const t of Object.values(tests.all()).sort((a, b) => a.date.localeCompare(b.date))) if (t.date >= from && t.date <= to && (t.test === "vert" || t.test === "sprint34")) out["bb." + t.test].push({date: t.date, v: t.v});
        return out;
      },
      load: months => Promise.all([sessions.load(months), tests.load(months)]),
    };
  })();

  /* ---------- School ---------- */
  const school = (() => {
    const items = Life.col("school/items", {months: 6, ahead: 6}), plan = Life.col("school/plan", {months: 2, ahead: 3}), settings = Life.doc("school/settings");
    const BIG = new Set(["Test", "Exam", "Project", "Essay"]);
    const cls = id => (((settings.get() || {}).classes || []).find(c => c.id === id) || {name: ""}).name;
    const at = (d, t) => { if (!t) return null; const x = parseKey(d), [h, m] = t.split(":").map(Number); x.setHours(h, m); return x; };
    const all = () => Object.values(items.all());
    return {
      has: () => ((settings.get() || {}).classes || []).length > 0,
      today(k) {
        const open = all().filter(x => !x.done), due = open.filter(x => x.date === k), late = open.filter(x => x.date < k);
        const next = open.filter(x => BIG.has(x.type) && x.date >= k).sort((a, b) => a.date.localeCompare(b.date))[0];
        const study = Object.values(plan.all()).filter(p => p.date === k && !p.done);
        return {due, late, next: next ? {title: next.title, type: next.type, date: next.date, cls: cls(next.cls)} : null, study};
      },
      events(from, to) {
        const out = [], today = ymd(new Date());
        for (const x of all()) if (x.date >= from && x.date <= to) {
          const lateTxt = !x.done && x.date < today ? " · late" : "";
          out.push({date: x.date, time: at(x.date, x.time), app: "school", planned: !x.done, title: (BIG.has(x.type) ? x.type + ": " : "Due: ") + x.title, detail: cls(x.cls) + (x.score != null ? ` · ${x.score}/${x.outOf}` : x.done ? " · done" : lateTxt)});
        }
        for (const p of Object.values(plan.all())) if (p.date >= from && p.date <= to) out.push({date: p.date, app: "school", planned: !p.done, title: "Study: " + p.title, detail: `${p.min} min · ${cls(p.cls)}`});
        return out;
      },
      series(from, to) {
        const by = {};
        for (const x of all()) if (x.done && x.doneAt) { const d = ymd(new Date(x.doneAt)); if (d >= from && d <= to) by[d] = (by[d] || 0) + 1; }
        return {"school.done": Object.entries(by).sort().map(([date, v]) => ({date, v}))};
      },
      load: months => Promise.all([items.load(months), plan.load(months)]),
    };
  })();

  // agg: how a stretch of days adds up (avg of logged days, sum, or the latest value); better: 1 up, -1 down, 0 depends
  const METRICS = {
    "sleep.asleep": {app: "sleep", label: "Sleep", unit: "h", agg: "avg", better: 1, dp: 1},
    "sleep.rested": {app: "sleep", label: "Rested score", unit: "/5", agg: "avg", better: 1, dp: 1},
    "sleep.bedtime": {app: "sleep", label: "Bedtime", unit: "min", agg: "avg", better: 0, dp: 0, hidden: true},
    "fuel.cal": {app: "fuel", label: "Calories", unit: "kcal", agg: "avg", better: 0, dp: 0},
    "fuel.protein": {app: "fuel", label: "Protein", unit: "g", agg: "avg", better: 1, dp: 0},
    "fuel.water": {app: "fuel", label: "Water", unit: "cups", agg: "avg", better: 1, dp: 1},
    "fuel.weight": {app: "fuel", label: "Bodyweight", unit: "lb", agg: "last", better: 0, dp: 1},
    "train.workouts": {app: "train", label: "Workouts", unit: "per week", agg: "sum", better: 1, dp: 0},
    "train.sets": {app: "train", label: "Hard sets", unit: "per week", agg: "sum", better: 1, dp: 0},
    "habits.pct": {app: "habits", label: "Habits done", unit: "%", agg: "avg", better: 1, dp: 0},
    "recovery.readiness": {app: "recovery", label: "Readiness", unit: "/100", agg: "avg", better: 1, dp: 0},
    "recovery.energy": {app: "recovery", label: "Energy", unit: "/5", agg: "avg", better: 1, dp: 1},
    "recovery.soreness": {app: "recovery", label: "Soreness", unit: "/5", agg: "avg", better: -1, dp: 1},
    "recovery.rhr": {app: "recovery", label: "Resting heart rate", unit: "bpm", agg: "avg", better: -1, dp: 0},
    "recovery.hrv": {app: "recovery", label: "HRV", unit: "ms", agg: "avg", better: 1, dp: 0},
    "bb.shots": {app: "basketball", label: "Shots", unit: "per week", agg: "sum", better: 1, dp: 0},
    "bb.pct": {app: "basketball", label: "Shooting %", unit: "%", agg: "avg", better: 1, dp: 0},
    "bb.three": {app: "basketball", label: "3-point %", unit: "%", agg: "avg", better: 1, dp: 0},
    "bb.ft": {app: "basketball", label: "Free throw %", unit: "%", agg: "avg", better: 1, dp: 0},
    "bb.vert": {app: "basketball", label: "Vertical jump", unit: "in", agg: "last", better: 1, dp: 1},
    "bb.sprint34": {app: "basketball", label: "3/4-court sprint", unit: "sec", agg: "last", better: -1, dp: 2},
    "school.done": {app: "school", label: "Assignments finished", unit: "per week", agg: "sum", better: 1, dp: 0},
    "focus.min": {app: "focus", label: "Focus time", unit: "min", agg: "sum", better: 1, dp: 0},
    "focus.school": {app: "focus", label: "Study time", unit: "min", agg: "sum", better: 1, dp: 0},
  };
  const metricInfo = id => METRICS[id] || (id.startsWith("train.lift:") ? {app: "train", label: id.slice(11) + " est. max", unit: "lb", agg: "last", better: 1, dp: 0} : null);

  const adapters = {sleep, fuel, train, habits, focus, recovery, basketball, school};
  /** daily points for one metric id between two dates (inclusive) */
  function metric(id, from, to) { const a = adapters[(metricInfo(id) || {}).app]; return a && a.series ? (a.series(from, to)[id] || []) : []; }
  window.LifeApps = {APPS, adapters, METRICS, metricInfo, metric, util: {ymd, parseKey, addDays, dur, time}};
})();
