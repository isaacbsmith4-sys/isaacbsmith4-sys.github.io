/* LIFE HQ app registry and adapters. Loaded by LIFE HQ (after kit.js).

   Each built app gets an adapter that reads that app's own files in life-data and answers two
   questions in one common shape, so LIFE HQ never copies data out of an app:
     today(dayKey)  -> the numbers for the Today screen
     events(from, to) -> calendar entries: {date, time?, end?, title, detail?, app, planned?}
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
  const time = d => d.toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});

  // phase = roadmap stage it's built in; path is relative to /hq/
  const APPS = [
    {id: "sleep", name: "Sleep", color: "#8f86ff", path: "../sleep/", built: true, blurb: "Bedtime, wind-down, sleep log"},
    {id: "fuel", name: "Fuel", color: "#ff6a3d", path: "../fuel/", built: true, blurb: "Food, macros, water, weight"},
    {id: "train", name: "Train", color: "#3fd3ff", phase: 2, blurb: "Lifting, progressive overload, PRs"},
    {id: "habits", name: "Habits", color: "#ff7eb6", phase: 2, blurb: "Routines, streaks, non-negotiables"},
    {id: "school", name: "School", color: "#f2c14e", phase: 3, blurb: "Assignments, grades, study tools"},
    {id: "focus", name: "Focus", color: "#6aa8ff", phase: 3, blurb: "Focus timer and study hours"},
    {id: "mindset", name: "Mindset", color: "#d29bff", phase: 3, blurb: "Journal, reflections, weekly review"},
    {id: "recovery", name: "Recovery", color: "#46d1c4", phase: 4, blurb: "Readiness, soreness, training load"},
    {id: "basketball", name: "Basketball", color: "#e0955a", phase: 4, blurb: "Shooting charts and skill work"},
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
        if (today >= from && today <= to && !(nights.all()[today] || {}).wake) {
          const p = plan(today);
          out.push({date: today, time: p.wind, app: "sleep", planned: true, title: "Wind-down", detail: "starts " + time(p.wind)});
          out.push({date: today, time: p.bed, app: "sleep", planned: true, title: "Bedtime", detail: `${time(p.bed)} for ${s.goal}h before ${time(p.wake)}`});
        }
        return out;
      },
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
      load: months => Promise.all([days.load(months), weights.load(months)]),
    };
  })();

  window.LifeApps = {APPS, adapters: {sleep, fuel}, util: {ymd, parseKey, addDays, dur, time}};
})();
