/* Shared layer for the productivity suite (INBOX, TALK, DON'T FORGET, LINK VAULT, QUEUE).

   - Storage: one IndexedDB database ("suite") on this site, one object store per app plus `files`
     (photos and recordings as raw bytes) and `meta` (settings, categories). Because every app writes
     to the same database, an app can hand a record to another one with Suite.send() instead of
     keeping its own copy. (On iPhone, apps share it when opened from the same home-screen app or
     the same browser; a separately installed home-screen app gets its own storage.)
   - Suite.apps lists the five apps; `built` gates every "send to" button, so no app ever offers a
     hand-off to an app that doesn't exist yet.
   - Suite.ai calls Claude straight from the phone with the user's own API key (Settings), stored only
     on this device. Without a key every AI feature stays hidden.
*/
(function () {
  "use strict";
  const DB = "suite", VER = 1;
  const STORES = ["inbox", "talk", "reminders", "links", "queue", "files", "meta"];
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  /* ---------- IndexedDB ---------- */
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === "meta" ? "key" : "id" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error("Storage is busy in another tab. Close other copies of the app and reload."));
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then((v) => { out = v; });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error("Save failed"));
    });
  }
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const bc = "BroadcastChannel" in self ? new BroadcastChannel("suite") : null;
  const changeFns = new Set();
  const emit = (store, local) => { changeFns.forEach((f) => { try { f(store); } catch (e) {} }); if (local && bc) bc.postMessage({ store }); };
  if (bc) bc.onmessage = (e) => emit(e.data && e.data.store, false);

  const store = {
    all: (s) => tx(s, "readonly", (o) => req(o.getAll())),
    get: (s, id) => tx(s, "readonly", (o) => req(o.get(id))),
    async put(s, rec) { await tx(s, "readwrite", (o) => { o.put(rec); }); emit(s, true); return rec; },
    async putMany(s, recs) { await tx(s, "readwrite", (o) => { recs.forEach((r) => o.put(r)); }); emit(s, true); },
    async del(s, id) { await tx(s, "readwrite", (o) => { o.delete(id); }); emit(s, true); },
    async clear(s) { await tx(s, "readwrite", (o) => { o.clear(); }); emit(s, true); },
  };

  /* files: kept as ArrayBuffer + type (older iOS versions mishandle Blobs in IndexedDB) */
  const files = {
    async put(blob, extra = {}) {
      // read the bytes first: a transaction closes if it waits on anything that isn't IndexedDB
      const id = uid("f"), buf = await blob.arrayBuffer();
      await tx("files", "readwrite", (o) => { o.put({ id, type: blob.type, buf, size: blob.size, at: Date.now(), ...extra }); });
      return id;
    },
    async putAt(id, rec) { await tx("files", "readwrite", (o) => { o.put({ ...rec, id }); }); },
    async blob(id) { const f = id && await store.get("files", id); return f ? new Blob([f.buf], { type: f.type }) : null; },
    raw: (id) => store.get("files", id),
    del: (id) => id ? tx("files", "readwrite", (o) => { o.delete(id); }) : null,
  };

  const meta = {
    async get(key, dflt) { const r = await store.get("meta", key); return r ? r.value : dflt; },
    async set(key, value) { await store.put("meta", { key, value }); },
  };

  /* ---------- helpers ---------- */
  function uid(p = "") { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function ago(ts) {
    const s = (Date.now() - ts) / 1000;
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    if (s < 86400 * 6) return Math.round(s / 86400) + "d ago";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  }
  function toast(msg, action) {
    let t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : "");
    if (action) t.querySelector("button").onclick = () => { t.classList.remove("show"); action.run(); };
    t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), action ? 5000 : 2400);
  }

  /* bottom sheet: Suite.sheet(html, {onClose}) -> {el, close} */
  function sheet(html, opts = {}) {
    const scrim = document.createElement("div"); scrim.className = "scrim";
    const el = document.createElement("div"); el.className = "sheet"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    el.innerHTML = `<div class="grab"></div>` + html;
    document.body.append(scrim, el);
    const prevOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    requestAnimationFrame(() => { scrim.classList.add("show"); el.classList.add("show"); });
    let closed = false;
    function close() {
      if (closed) return; closed = true;
      scrim.classList.remove("show"); el.classList.remove("show");
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      setTimeout(() => { scrim.remove(); el.remove(); }, 300);
      opts.onClose && opts.onClose();
    }
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    scrim.onclick = close;
    el.querySelectorAll("[data-close]").forEach((b) => (b.onclick = close));
    return { el, close };
  }

  /* calendar file with an alert at the time itself; the phone offers to add it to Calendar */
  const icsDate = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const icsText = (s) => String(s || "").replace(/[\\;,]/g, (c) => "\\" + c).replace(/\r?\n/g, "\\n");
  function ics({ id, title, notes, start, minutes = 30, app = "Suite" }) {
    const end = new Date(+start + minutes * 60000);
    const body = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${app}//EN`, "BEGIN:VEVENT",
      `UID:${id}@isaacbsmith4-sys.github.io`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsText(title)}`, notes ? `DESCRIPTION:${icsText(notes)}` : "",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(title)}`, "TRIGGER:PT0M", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
    return new Blob([body], { type: "text/calendar" });
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ---------- theme ---------- */
  const theme = {
    get: () => lsGet("suite:theme") || "auto",
    set(v) { lsSet("suite:theme", v === "auto" ? null : v); theme.apply(); },
    apply() {
      const v = theme.get();
      if (v === "auto") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", v);
      const m = document.querySelector('meta[name="theme-color"]');
      if (m) m.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || m.content;
    },
  };
  theme.apply();
  matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", theme.apply);

  /* ---------- apps ---------- */
  const apps = [
    { id: "inbox", name: "INBOX", tag: "Save everything", url: "../inbox/", color: "#8b7bff", built: true },
    { id: "talk", name: "TALK", tag: "Voice to notes", url: "../talk/", color: "#ff7a59", built: true },
    { id: "reminders", name: "DON'T FORGET", tag: "Smart reminders", url: "../dontforget/", color: "#ffb020", built: false },
    { id: "links", name: "LINK VAULT", tag: "Links, organized", url: "../vault/", color: "#2ed3b7", built: false },
    { id: "queue", name: "QUEUE", tag: "Watch, read, do", url: "../queue/", color: "#ff5fa2", built: false },
  ];
  /** hand a record to another app's store; refuses for apps that aren't built yet */
  async function send(appId, rec) {
    const app = apps.find((a) => a.id === appId);
    if (!app || !app.built) throw new Error((app ? app.name : appId) + " isn't available yet");
    const now = Date.now();
    const r = { id: uid(appId.slice(0, 2)), created: now, updated: now, ...rec };
    await store.put(appId, r);
    return r;
  }

  /* ---------- AI (Claude, with the user's own key) ---------- */
  const AI_MODEL = "claude-opus-5-5";
  const ai = {
    key: () => lsGet("suite:ai-key") || "",
    setKey(k) { lsSet("suite:ai-key", k ? k.trim() : null); },
    enabled: () => !!ai.key(),
    /** one request that must come back as JSON matching `schema`; content = string or content blocks */
    async json({ system, content, schema, maxTokens = 2000 }) {
      if (!ai.key()) throw new Error("Add your Anthropic API key in Settings to use AI.");
      const body = {
        model: AI_MODEL, max_tokens: maxTokens, system,
        output_config: { effort: "low", format: { type: "json_schema", schema } },
        messages: [{ role: "user", content }],
      };
      const call = (withFallback) => fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json", "x-api-key": ai.key(), "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          ...(withFallback ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
        },
        body: JSON.stringify(withFallback ? { ...body, fallbacks: "default" } : body),
      });
      let r;
      try { r = await call(true); if (r.status === 400) r = await call(false); }
      catch (e) { throw new Error("No connection to the AI service."); }
      if (r.status === 401) throw new Error("The API key wasn't accepted. Check it in Settings.");
      if (r.status === 429) throw new Error("AI is rate-limited right now. Try again in a minute.");
      if (!r.ok) { let m = ""; try { m = (await r.json()).error.message; } catch (e) {} throw new Error("AI error " + r.status + (m ? ": " + m : "")); }
      const j = await r.json();
      if (j.stop_reason === "refusal") throw new Error("The AI declined this one.");
      const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      try { return JSON.parse(text); } catch (e) { throw new Error("AI sent back something unreadable. Try again."); }
    },
  };

  /* ---------- backup ---------- */
  const b64 = (buf) => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
  const backup = {
    /** everything in the given stores, plus the files they point at (fileKeys: fields holding file ids) */
    async export(stores, fileKeys = ["imageId", "thumbId", "audioId"]) {
      const out = { suite: 1, exported: new Date().toISOString(), stores: {}, files: [], meta: [] };
      const ids = new Set();
      for (const s of stores) {
        out.stores[s] = await store.all(s);
        out.stores[s].forEach((r) => fileKeys.forEach((k) => r[k] && ids.add(r[k])));
      }
      for (const id of ids) { const f = await files.raw(id); if (f) out.files.push({ ...f, buf: b64(f.buf) }); }
      out.meta = (await store.all("meta")).filter((m) => stores.some((s) => m.key.startsWith(s + ":")));
      return new Blob([JSON.stringify(out)], { type: "application/json" });
    },
    /** merge a backup in: a record replaces the local one only when it was edited more recently */
    async import(text) {
      const j = JSON.parse(text);
      if (!j || !j.stores) throw new Error("That file isn't a backup from this app.");
      let n = 0;
      for (const f of j.files || []) if (!(await files.raw(f.id))) await files.putAt(f.id, { ...f, buf: unb64(f.buf) });
      for (const [s, recs] of Object.entries(j.stores)) {
        if (!STORES.includes(s)) continue;
        const cur = new Map((await store.all(s)).map((r) => [r.id, r]));
        const take = recs.filter((r) => !cur.has(r.id) || (r.updated || 0) > (cur.get(r.id).updated || 0));
        if (take.length) await store.putMany(s, take);
        n += take.length;
      }
      for (const m of j.meta || []) if ((await store.get("meta", m.key)) == null) await store.put("meta", m);
      return n;
    },
  };

  async function persist() {
    try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (e) { return false; }
  }

  self.Suite = { store, files, meta, uid, esc, ago, toast, sheet, ics, download, theme, apps, send, ai, backup, persist,
    onChange: (f) => changeFns.add(f), isStandalone: () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true };
})();
