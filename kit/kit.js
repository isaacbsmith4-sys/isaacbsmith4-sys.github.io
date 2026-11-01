/* LIFE HQ kit: the shared layer every life app loads (Sleep, Fuel, …, and LIFE HQ itself).

   - Data lives in the private repo isaacbsmith4-sys/life-data, read and written through the
     GitHub API with a fine-grained token that can only touch that repo. Nothing is ever written
     to this public Pages site.
   - Each device keeps a local copy, so apps work offline and before they're connected; edits
     queue up and push when there's a connection.
   - Two kinds of files (see life-data/FORMAT.md):
       col("sleep/nights")  -> records keyed by id, one file per month: sleep/nights/2026-10.json
       doc("sleep/settings") -> one object: sleep/settings.json
     Every record and doc carries _u (last-updated ms); merges keep the newer _u per record, so
     two devices editing different nights never clobber each other. Deletes are kept as
     tombstones (_d: 1) so they sync too.
*/
(function () {
  "use strict";
  const OWNER = "isaacbsmith4-sys", REPO = "life-data";
  const K = {tok: "life:token", cache: "life:cache", seeded: "life:seeded:"};
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  // a local stand-in for GitHub, only ever honored on localhost (used for testing)
  const API = (isLocal && lsGet("life:api")) || "https://api.github.com";

  let token = lsGet(K.tok) || "";
  let cache = {};
  try { cache = JSON.parse(lsGet(K.cache) || "{}") || {}; } catch (e) {}
  const persist = () => lsSet(K.cache, JSON.stringify(cache));
  // records are always copied in and out, so an app editing its own objects later can't silently change (or skip saving) what's stored
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const strip = o => { if (!o) return o; const {_u, _d, ...rest} = clone(o); return rest; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /* ---------- status ---------- */
  let status = token ? "syncing" : "local", lastError = "", lastSync = 0;
  const statusFns = new Set(), changeFns = new Set();
  function setStatus(s, err) {
    status = s; lastError = err || "";
    if (s === "synced") lastSync = Date.now();
    statusFns.forEach(f => { try { f(s); } catch (e) {} });
  }

  /* ---------- registered files ---------- */
  const cols = new Map(), docs = new Map();
  const monthsBack = n => { const out = [], d = new Date(); d.setDate(1); for (let i = 0; i < n; i++) { out.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")); d.setMonth(d.getMonth() - 1); } return out; };
  const shardPath = (name, month) => `${name}/${month}.json`;
  const monthOf = (id, r) => String((r && r.date) || id).slice(0, 7);

  function col(name, opts = {}) {
    if (cols.has(name)) return cols.get(name);
    const c = {
      name, months: opts.months || 3,
      /** every live record in the months this device has, keyed by id (meta fields removed) */
      all() {
        const out = {};
        for (const p in cache) if (cache[p].kind === "col" && p.startsWith(name + "/"))
          for (const [id, r] of Object.entries(cache[p].data)) if (!r._d) out[id] = strip(r);
        return out;
      },
      /** make the stored set match `map` (id -> record with a YYYY-MM-DD `date`); only changed records are written */
      replace(map) {
        const cur = this.all(), now = Date.now();
        let n = 0;
        for (const [id, r] of Object.entries(map)) if (!same(r, cur[id])) { write(name, id, {...r, _u: now}); n++; }
        for (const id in cur) if (!(id in map)) { write(name, id, {date: cur[id].date || id, _u: now, _d: 1}); n++; }
        if (n) { persist(); schedulePush(); }
      },
      /** first run on a device: hand over records it already had, without overriding anything newer in the cloud */
      seed(map) {
        if (lsGet(K.seeded + name)) return;
        for (const [id, r] of Object.entries(map)) { const p = shardPath(name, monthOf(id, r)); if (!cache[p]?.data[id]) write(name, id, {...r, _u: 1}); }
        lsSet(K.seeded + name, "1"); persist(); schedulePush();
      },
      /** pull more months (for longer history views); resolves when loaded */
      async load(months) { if (token) await pullCol(name, months); },
    };
    cols.set(name, c);
    return c;
  }
  function write(name, id, rec) {
    const p = shardPath(name, monthOf(id, rec));
    const f = cache[p] || (cache[p] = {kind: "col", data: {}, sha: null});
    f.data[id] = clone(rec); f.dirty = 1; f.v = (f.v || 0) + 1;
  }

  function doc(name) {
    if (docs.has(name)) return docs.get(name);
    const p = name + ".json";
    const d = {
      name,
      get() { return cache[p] ? strip(cache[p].data) : null; },
      set(obj) {
        if (cache[p] && same(strip(cache[p].data), obj)) return;
        const f = cache[p] || (cache[p] = {kind: "doc", sha: null});
        f.data = {...clone(obj), _u: Date.now()}; f.dirty = 1; f.v = (f.v || 0) + 1;
        persist(); schedulePush();
      },
      seed(obj) {
        if (lsGet(K.seeded + name)) return;
        if (!cache[p]) { cache[p] = {kind: "doc", sha: null, data: {...clone(obj), _u: 1}, dirty: 1, v: 1}; persist(); schedulePush(); }
        lsSet(K.seeded + name, "1");
      },
    };
    docs.set(name, d);
    return d;
  }

  function merge(kind, local, remote) {
    if (!remote) return local;
    if (!local) return remote;
    if (kind === "doc") return (local._u || 0) >= (remote._u || 0) ? local : remote;
    const out = {...remote};
    for (const [id, r] of Object.entries(local)) if (!out[id] || (r._u || 0) > (out[id]._u || 0)) out[id] = r;
    return out;
  }

  /* ---------- GitHub contents API ---------- */
  const b64enc = str => { const bytes = new TextEncoder().encode(str); let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const b64dec = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0)));
  class SyncError extends Error { constructor(msg, code) { super(msg); this.code = code; } }
  async function gh(method, path, body) {
    let r;
    try {
      r = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}`, {
        method, cache: "no-store",
        headers: {Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...(body ? {"Content-Type": "application/json"} : {})},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new SyncError("No connection", "offline"); }
    if (r.status === 401) throw new SyncError("GitHub didn't accept the key. It may have expired; connect again.", "auth");
    if (r.status === 403) throw new SyncError("The key can't write to life-data. Check its Contents permission is Read and write.", "auth");
    return r;
  }
  async function getFile(path) {
    const r = await gh("GET", path);
    if (r.status === 404) return {sha: null, data: null};
    if (!r.ok) throw new SyncError("GitHub error " + r.status, "http");
    const j = await r.json();
    if (Array.isArray(j)) return {sha: null, data: null, list: j};
    return {sha: j.sha, data: JSON.parse(b64dec(j.content))};
  }
  async function listDir(path) {
    const r = await gh("GET", path);
    if (r.status === 404) return [];
    if (!r.ok) throw new SyncError("GitHub error " + r.status, "http");
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  }
  const device = (() => { const ua = navigator.userAgent; return /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Mac/.test(ua) ? "Mac" : "web"; })();
  async function pushFile(path) {
    const f = cache[path];
    for (let attempt = 0; attempt < 4; attempt++) {
      const v0 = f.v, mine = f.data;
      const remote = await getFile(path);
      const merged = merge(f.kind, mine, remote.data);
      const r = await gh("PUT", path, {message: `${path} (${device})`, content: b64enc(JSON.stringify(merged)), ...(remote.sha ? {sha: remote.sha} : {})});
      if (r.ok) {
        const j = await r.json();
        f.sha = j.content && j.content.sha;
        if (f.v === v0) { f.data = merged; f.dirty = 0; }
        else f.data = merge(f.kind, f.data, merged); // edited while saving: keep the new edits and push again
        persist();
        if (!f.dirty) return;
        continue;
      }
      if (r.status === 409 || r.status === 422) continue; // someone else saved first: re-read and merge
      throw new SyncError("GitHub error " + r.status, "http");
    }
    throw new SyncError("Couldn't save after several tries", "conflict");
  }
  async function pullPath(path, kind) {
    const remote = await getFile(path);
    if (!remote.data) return false;
    const f = cache[path];
    if (!f) { cache[path] = {kind, data: remote.data, sha: remote.sha}; return true; }
    if (f.sha === remote.sha && !f.dirty) return false;
    const m = merge(kind, f.data, remote.data);
    const changed = !same(m, f.data);
    f.data = m; f.sha = remote.sha;
    if (!same(m, remote.data)) f.dirty = 1;
    return changed;
  }
  async function pullCol(name, months) {
    const want = new Set(months || monthsBack(cols.get(name)?.months || 3));
    const list = await listDir(name);
    let changed = false;
    for (const it of list) {
      const m = it.name.replace(/\.json$/, "");
      if (!want.has(m)) continue;
      const p = shardPath(name, m);
      if (cache[p] && cache[p].sha === it.sha && !cache[p].dirty) continue;
      if (await pullPath(p, "col")) changed = true;
    }
    return changed;
  }

  /* ---------- sync loop ---------- */
  let pushTimer = null, running = null;
  function schedulePush() { if (!token) return; clearTimeout(pushTimer); pushTimer = setTimeout(() => sync({pull: false}), 1500); }
  async function sync({pull = true} = {}) {
    if (!token) { setStatus("local"); return false; }
    if (running) { await running; if (!pull) return false; }
    running = (async () => {
      setStatus("syncing");
      let changed = false;
      try {
        for (const p of Object.keys(cache)) if (cache[p].dirty) await pushFile(p);
        if (pull) {
          for (const name of cols.keys()) if (await pullCol(name)) changed = true;
          for (const name of docs.keys()) if (await pullPath(name + ".json", "doc")) changed = true;
          for (const p of Object.keys(cache)) if (cache[p].dirty) await pushFile(p);
        }
        persist();
        setStatus("synced");
      } catch (e) {
        persist();
        setStatus(e.code === "offline" ? "offline" : "error", e.message);
      }
      if (changed) changeFns.forEach(f => { try { f(); } catch (e) {} });
      return changed;
    })();
    try { return await running; } finally { running = null; }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });
  window.addEventListener("online", () => sync());
  setInterval(() => { if (document.visibilityState === "visible" && token) sync(); }, 120000);

  /* ---------- connect ---------- */
  async function connect(t) {
    t = String(t || "").trim();
    if (!t) throw new SyncError("Paste your key first.", "input");
    const prev = token; token = t;
    try {
      const r = await fetch(`${API}/repos/${OWNER}/${REPO}`, {cache: "no-store", headers: {Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json"}});
      if (r.status === 401) throw new SyncError("GitHub didn't accept that key. Copy it again, the whole thing.", "auth");
      if (r.status === 404) throw new SyncError("That key can't see life-data. Under Repository access, pick life-data.", "auth");
      if (!r.ok) throw new SyncError("GitHub error " + r.status, "http");
      const j = await r.json();
      if (j.permissions && !j.permissions.push) throw new SyncError("That key can only read. Set Contents to Read and write.", "auth");
    } catch (e) { token = prev; throw e.code ? e : new SyncError("No connection. Try again on Wi-Fi or cell data.", "offline"); }
    lsSet(K.tok, t);
    await sync();
  }
  function disconnect() { token = ""; lsSet(K.tok, null); setStatus("local"); }

  /* ---------- small shared UI: status pill + connect sheet ---------- */
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const css = `
  .lk-pill{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line,#2a2f45);background:var(--surface,#12152a);color:var(--muted,#8a90b0);font:600 11.5px var(--body,system-ui);padding:6px 10px;border-radius:999px;cursor:pointer;white-space:nowrap}
  .lk-pill i{width:7px;height:7px;border-radius:50%;background:#7a7f95}
  .lk-pill.synced i{background:#5fd8a0;box-shadow:0 0 8px #5fd8a0}.lk-pill.syncing i{background:#f2b45c;animation:lkb 1s infinite}.lk-pill.error i,.lk-pill.offline i{background:#ff6a7c}
  @keyframes lkb{50%{opacity:.3}}
  .lk-bar{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap}
  .lk-home{color:var(--ink,#eef0fb);font:700 12.5px var(--body,system-ui);text-decoration:none;border:1px solid var(--line,#2a2f45);background:var(--surface2,#1a1e36);padding:6px 11px;border-radius:999px;white-space:nowrap}
  .lk-sheet{position:fixed;inset:0;z-index:90;background:rgba(3,4,10,.72);backdrop-filter:blur(5px);display:grid;align-items:end;justify-items:center}
  .lk-in{width:min(620px,100%);max-height:90vh;overflow:auto;background:var(--surface,#12152a);color:var(--ink,#eef0fb);border:1px solid var(--line,#2a2f45);border-bottom:0;border-radius:24px 24px 0 0;display:grid;gap:14px;font:15px/1.5 var(--body,system-ui);
    padding:20px max(18px,env(safe-area-inset-right,0px)) calc(22px + env(safe-area-inset-bottom,0px)) max(18px,env(safe-area-inset-left,0px))}
  .lk-in h3{margin:0;font:700 19px var(--display,system-ui)}
  .lk-in ol{margin:0;padding-left:20px;display:grid;gap:6px;color:var(--ink2,#c8cce0);font-size:14px}
  .lk-in input{font:14px var(--mono,ui-monospace,monospace);color:var(--ink,#eef0fb);background:var(--sunk,#0a0d1d);border:1px solid var(--line,#2a2f45);border-radius:11px;padding:11px;width:100%}
  .lk-in .lk-row{display:flex;gap:8px;flex-wrap:wrap}
  .lk-in button{appearance:none;border:1px solid var(--line-hi,#3a4260);background:var(--surface2,#1a1e36);color:var(--ink,#eef0fb);font:700 14px var(--body,system-ui);padding:11px 16px;border-radius:13px;cursor:pointer}
  .lk-in button.lk-go{background:var(--accent,#8f86ff);border-color:var(--accent,#8f86ff);color:#0b0b14}
  .lk-note{color:var(--muted,#8a90b0);font-size:12.5px;margin:0}
  .lk-err{color:#ff8a98;font-size:13.5px;margin:0}`;
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

  const LABEL = {local: "On this phone", syncing: "Syncing…", synced: "Synced", offline: "Offline · saved here", error: "Sync problem"};
  function mountStatus(el) {
    if (!el) return;
    // apps opened from LIFE HQ get a way back (an installed web app has no back button)
    const home = /\/hq\//.test(location.pathname) ? "" : `<a class="lk-home" href="../hq/">‹ LIFE HQ</a>`;
    const draw = () => { el.innerHTML = `<span class="lk-bar">${home}<button class="lk-pill ${status}" type="button" aria-label="Backup: ${LABEL[status]}"><i></i>${LABEL[status]}</button></span>`; };
    draw(); statusFns.add(draw);
    el.addEventListener("click", e => { if (e.target.closest(".lk-pill")) openConnect(); });
  }
  function openConnect() {
    const wrap = document.createElement("div");
    wrap.className = "lk-sheet";
    const ago = lastSync ? Math.round((Date.now() - lastSync) / 60000) : null;
    wrap.innerHTML = `<div class="lk-in" role="dialog" aria-label="Sync">
      ${token ? `<h3>Synced to your account</h3>
        <p class="lk-note">${status === "synced" ? `Up to date${ago ? `, ${ago} min ago` : ""}.` : esc(lastError || LABEL[status])} Everything you log is saved to your private <b>life-data</b> repo on GitHub, so it shows up in LIFE HQ and on your other devices.</p>
        ${lastError ? `<p class="lk-err">${esc(lastError)}</p>` : ""}
        <div class="lk-row"><button class="lk-go" data-lk="sync">Sync now</button><button data-lk="copy">Copy key for another app</button><button data-lk="off">Disconnect</button><button data-lk="close">Close</button></div>
        <p class="lk-note">Each app on your home screen keeps its own storage, so paste the same key once in each one.</p>`
      : `<h3>Saved on this phone</h3>
        <p class="lk-note">Everything you log is saved on this phone and shows up in LIFE HQ. Nothing else is needed.</p>
        <p class="lk-note"><b>Optional:</b> connect a GitHub key to back everything up to your private life-data repo and see it on your computer too.</p>
        <details><summary class="lk-note" style="cursor:pointer">First time: make a key (2 minutes)</summary>
        <ol style="margin-top:8px">
          <li>Open <b>github.com/settings/personal-access-tokens/new</b> and sign in.</li>
          <li>Name it <b>LIFE HQ</b>. Set Expiration to the longest option.</li>
          <li>Repository access: <b>Only select repositories</b> › <b>life-data</b>.</li>
          <li>Permissions › Repository permissions › <b>Contents</b>: <b>Read and write</b>.</li>
          <li>Generate token, copy it, paste it below.</li>
        </ol></details>
        <input id="lkTok" type="password" autocomplete="off" placeholder="github_pat_…" aria-label="GitHub key">
        <p class="lk-err" id="lkErr" hidden></p>
        <div class="lk-row"><button class="lk-go" data-lk="connect">Connect</button><button data-lk="close">Not now</button></div>
        <p class="lk-note">The key stays on this device. It can only read and write life-data, nothing else on your GitHub.</p>`}
    </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener("click", async e => {
      if (e.target === wrap) return close();
      const b = e.target.closest("[data-lk]"); if (!b) return;
      const act = b.dataset.lk;
      if (act === "close") close();
      if (act === "off") { disconnect(); close(); }
      if (act === "sync") { b.textContent = "Syncing…"; await sync(); close(); }
      if (act === "copy") { try { await navigator.clipboard.writeText(token); b.textContent = "Copied"; } catch (err) { b.textContent = "Couldn't copy"; } }
      if (act === "connect") {
        const err = wrap.querySelector("#lkErr"); b.textContent = "Connecting…"; b.disabled = true;
        try { await connect(wrap.querySelector("#lkTok").value); close(); }
        catch (x) { err.hidden = false; err.textContent = x.message; b.textContent = "Connect"; b.disabled = false; }
      }
    });
  }

  window.Life = {
    OWNER, REPO, col, doc, sync, connect, disconnect, openConnect, mountStatus,
    get connected() { return !!token; }, get status() { return status; }, get lastError() { return lastError; },
    onChange(fn) { changeFns.add(fn); }, onStatus(fn) { statusFns.add(fn); },
    token() { return token; },
    /** start syncing; call once after the app has registered its cols/docs */
    start() { if (token) sync(); else setStatus("local"); },
  };
})();
