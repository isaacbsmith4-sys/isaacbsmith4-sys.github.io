/* TALK: talk naturally, get notes and actions.

   Capture is layered so a recording is never lost:
     1. live transcription with the browser's speech recognition (Safari uses Apple's dictation service),
     2. the audio itself with MediaRecorder (kept even when live transcription fails),
     3. the keyboard's own dictation mic in the transcript box, which always works on iPhone.
   While recording, the transcript so far is copied to localStorage every second; if the app is closed
   mid-recording, the Record screen offers to recover it.

   A note: {id, title, titleAuto, transcript, audioId, audioType, duration, cat, catBy, fav, summary, points[],
   items: [{id, kind, text, due, sent: null | {app, id, at}}], captured: live|audio|typed, ai, created, updated}.
   Items are found by on-device rules (../suite/nlp.js) or by Claude when an API key is set, and go to the app
   Suite.nlp.destFor picks: only apps that exist, so everything lands in INBOX until DON'T FORGET and QUEUE ship.
*/
(function () {
  "use strict";
  const { esc, ago, toast } = Suite;
  const N = Suite.nlp;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const P = {
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/>',
    notes: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    type: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
    send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
    wave: '<path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 10v4"/>',
  };
  const ico = (k, sw = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k]}</svg>`;
  const KIND_COLOR = { task: "#ffb020", watch: "#ff5fa2", read: "#4aa8ff", listen: "#c77dff", buy: "#2ed3b7", idea: "#ffd166", note: "#a3a8bd" };
  const PALETTE = ["#ff7a59", "#ffb020", "#2ed3b7", "#ff5fa2", "#4aa8ff", "#3ddc97", "#8b7bff", "#c77dff", "#a3a8bd"];
  const DEFAULT_CATS = [
    { id: "thoughts", name: "Thoughts", color: "#ff7a59" },
    { id: "todo", name: "To-dos", color: "#ffb020" },
    { id: "ideas", name: "Ideas", color: "#ffd166" },
    { id: "school", name: "School", color: "#c77dff" },
    { id: "hoops", name: "Basketball", color: "#ff8a3d" },
    { id: "personal", name: "Personal", color: "#3ddc97" },
  ];
  const LANGS = [["", "Phone default"], ["en-US", "English (US)"], ["en-GB", "English (UK)"], ["es-US", "Spanish (US)"], ["es-ES", "Spanish (Spain)"], ["fr-FR", "French"], ["de-DE", "German"], ["pt-BR", "Portuguese (Brazil)"]];

  /* ---------------------------------------------------------------- state */
  let notes = [], cats = [], settings = { saveAudio: true, lang: "", autoFind: true, aiAuto: true };
  let route = { view: "record" };
  const noteState = { q: "", cat: "" };
  const catById = (id) => cats.find((c) => c.id === id);
  const fmtDur = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const CAN_REC = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const DRAFT = "talk:draft";

  async function load() {
    notes = (await Suite.store.all("talk")) || [];
    cats = await Suite.meta.get("talk:categories", null);
    if (!cats) { cats = DEFAULT_CATS.map((c) => ({ ...c })); await Suite.meta.set("talk:categories", cats); }
    settings = { ...settings, ...(await Suite.meta.get("talk:settings", {})) };
  }
  const saveCats = () => Suite.meta.set("talk:categories", cats);
  const saveSettings = () => Suite.meta.set("talk:settings", settings);
  async function save(n, quiet) {
    n.updated = Date.now();
    await Suite.store.put("talk", n);
    const i = notes.findIndex((x) => x.id === n.id);
    if (i >= 0) notes[i] = n; else notes.unshift(n);
    if (!quiet) render();
    return n;
  }
  const pending = (n) => (n.items || []).filter((i) => !i.sent);

  /* ---------------------------------------------------------------- recording */
  let rec = null; // the recording in progress
  function newRec() {
    return { on: true, start: Date.now(), committed: "", sessionFinal: "", interim: "", chunks: [], mr: null, stream: null, recog: null,
      srOk: false, srFatal: "", srRestarts: 0, micError: "", level: 0, ctx: null, raf: 0, tick: 0, draftTick: 0, wake: null, stopping: false };
  }
  const liveText = () => rec ? (rec.committed + " " + rec.sessionFinal).replace(/\s+/g, " ").trim() : "";

  async function startRecording() {
    if (rec && rec.on) return;
    if (!SR && !CAN_REC) { toast("Recording isn't available in this browser. Use Type instead."); return; }
    rec = newRec();
    go("record");
    // 1. audio (also feeds the level meter)
    if (CAN_REC && settings.saveAudio) {
      try {
        rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/aac"].find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
        rec.mr = new MediaRecorder(rec.stream, type ? { mimeType: type } : undefined);
        rec.mr.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
        rec.mr.start(1000);
        meter(rec.stream);
      } catch (e) {
        rec.micError = e && e.name === "NotAllowedError" ? "Microphone access was blocked." : "Couldn't open the microphone.";
        rec.stream = null; rec.mr = null;
      }
    }
    // 2. live transcription
    if (SR) startRecognition();
    if (!rec.mr && !rec.recog) { const msg = rec.micError || "Couldn't start recording."; rec = null; render(); toast(msg + " Check microphone permission, or use Type instead."); return; }
    try { rec.wake = navigator.wakeLock ? await navigator.wakeLock.request("screen") : null; } catch (e) {}
    rec.tick = setInterval(updateRecUI, 250);
    rec.draftTick = setInterval(() => { try { localStorage.setItem(DRAFT, JSON.stringify({ start: rec.start, text: (liveText() + " " + rec.interim).trim() })); } catch (e) {} }, 1000);
    render();
  }

  function startRecognition() {
    const r = new SR();
    r.continuous = true; r.interimResults = true;
    r.lang = settings.lang || navigator.language || "en-US";
    r.onresult = (e) => {
      let fin = "", int = "";
      for (let i = 0; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t + " "; else int += t; }
      rec.sessionFinal = fin; rec.interim = int; rec.srOk = true; rec.srRestarts = 0;
      updateRecUI();
    };
    r.onerror = (e) => {
      const code = e.error;
      if (code === "not-allowed" || code === "service-not-allowed") rec.srFatal = "Live transcription isn't allowed here. Turn on Dictation (Settings → General → Keyboard → Enable Dictation), then try again.";
      else if (code === "audio-capture") rec.srFatal = "Live transcription couldn't use the microphone.";
      else if (code === "language-not-supported") rec.srFatal = "Live transcription doesn't support that language. Change it in Settings.";
      else if (code === "network") rec.srFatal = "Live transcription needs an internet connection.";
      // no-speech / aborted: harmless, onend restarts
    };
    r.onend = () => {
      if (!rec || rec.recog !== r) return;
      rec.committed = (rec.committed + " " + rec.sessionFinal + " " + rec.interim).trim(); // keep what was heard, even unfinalized
      rec.sessionFinal = ""; rec.interim = "";
      // Safari ends recognition after pauses; keep it going while recording
      if (rec.on && !rec.srFatal && ++rec.srRestarts < 40) setTimeout(() => { if (rec && rec.on && rec.recog === r) { try { r.start(); } catch (e) {} } }, 200);
      else if (rec.on && !rec.srFatal) rec.srFatal = "Live transcription stopped. The audio is still recording.";
      updateRecUI();
    };
    rec.recog = r;
    try { r.start(); } catch (e) { rec.srFatal = "Live transcription couldn't start."; rec.recog = null; }
  }

  function meter(stream) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      rec.ctx = new AC();
      const src = rec.ctx.createMediaStreamSource(stream), an = rec.ctx.createAnalyser();
      an.fftSize = 512; src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const loop = () => {
        if (!rec || !rec.on) return;
        an.getByteTimeDomainData(buf);
        let sum = 0; for (const v of buf) sum += (v - 128) * (v - 128);
        rec.level = Math.min(1, Math.sqrt(sum / buf.length) / 40);
        const ring = $(".mic .ring"); if (ring) ring.style.setProperty("--lv", (1 + rec.level * 0.28).toFixed(3));
        rec.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {}
  }

  function updateRecUI() {
    if (!rec) return;
    const t = $("#recTime"); if (t) t.textContent = fmtDur((Date.now() - rec.start) / 1000);
    const live = $("#live");
    if (live) {
      const txt = liveText();
      live.innerHTML = txt || rec.interim ? `${esc(txt)} <span class="interim">${esc(rec.interim)}</span>`
        : `<span class="ph">${rec.recog && !rec.srFatal ? "Listening… start talking." : rec.mr ? "Recording audio. Live text isn't available, so you'll type or dictate the text after." : ""}</span>`;
      live.scrollTop = live.scrollHeight;
    }
    const st = $("#recStatus");
    if (st) st.innerHTML = statusHTML();
  }
  function statusHTML() {
    if (!rec) return "";
    const parts = [];
    if (rec.srFatal) parts.push(`<div class="cap warn">${ico("warn")}<div>${esc(rec.srFatal)}${rec.mr ? " Your audio is still being saved." : ""}</div></div>`);
    if (rec.micError && rec.recog) parts.push(`<div class="cap warn">${ico("warn")}<div>${esc(rec.micError)} Only the text will be saved.</div></div>`);
    return parts.join("");
  }

  async function stopRecording(cancel) {
    if (!rec || rec.stopping) return;
    rec.stopping = true;
    const r = rec;
    r.on = false;
    clearInterval(r.tick); clearInterval(r.draftTick); cancelAnimationFrame(r.raf);
    const duration = (Date.now() - r.start) / 1000;
    // let recognition deliver its last words
    if (r.recog) {
      await new Promise((res) => { const done = () => res(); const rr = r.recog; rr.onend = done; try { rr.stop(); } catch (e) { done(); } setTimeout(done, 1500); });
      r.committed = (r.committed + " " + r.sessionFinal + " " + r.interim).trim();
    }
    let audio = null;
    if (r.mr) {
      audio = await new Promise((res) => {
        r.mr.onstop = () => res(r.chunks.length ? new Blob(r.chunks, { type: r.mr.mimeType || r.chunks[0].type || "audio/mp4" }) : null);
        try { r.mr.stop(); } catch (e) { res(null); }
        setTimeout(() => res(r.chunks.length ? new Blob(r.chunks, { type: r.mr.mimeType || "audio/mp4" }) : null), 2500);
      });
    }
    if (r.stream) r.stream.getTracks().forEach((t) => t.stop());
    try { r.ctx && r.ctx.close(); } catch (e) {}
    try { r.wake && r.wake.release(); } catch (e) {}
    rec = null;
    const transcript = r.committed.replace(/\s+/g, " ").trim();
    if (cancel) { try { localStorage.removeItem(DRAFT); } catch (e) {} render(); toast("Recording discarded"); return; }
    if (!transcript && !audio) { try { localStorage.removeItem(DRAFT); } catch (e) {} render(); toast("Nothing was captured. Check the microphone and try again."); return; }
    const n = await createNote({ transcript, duration, captured: transcript ? "live" : "audio" }, audio);
    try { localStorage.removeItem(DRAFT); } catch (e) {}
    go("note", n.id);
    organize(n.id, { auto: true });
  }

  async function createNote({ transcript = "", duration = 0, captured = "typed" }, audio) {
    const now = Date.now();
    const n = {
      id: Suite.uid("tk"), title: transcript ? N.titleFor(transcript) : captured === "typed" ? "" : "Voice note " + new Date(now).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      titleAuto: true, transcript, duration, captured, cat: null, catBy: null, fav: false, summary: "", points: [], items: [], created: now, updated: now,
    };
    if (audio) { n.audioId = await Suite.files.put(audio, { name: "talk-" + n.id }); n.audioType = audio.type; }
    await save(n, true);
    return n;
  }

  /* ---------------------------------------------------------------- organizing */
  /** rules always; Claude on top when there's a key (and it's switched on, or asked for) */
  async function organize(id, { auto = false, ai = null } = {}) {
    let n = notes.find((x) => x.id === id);
    if (!n || !n.transcript.trim()) return;
    if (!auto || settings.autoFind) {
      const sent = n.items.filter((i) => i.sent);
      const found = N.extract(n.transcript).filter((f) => !sent.some((s) => s.text.toLowerCase() === f.text.toLowerCase()));
      n.items = [...sent, ...found];
      if (n.titleAuto) n.title = N.titleFor(n.transcript);
      if (n.catBy !== "you") { const c = N.ruleCategory({ title: n.title, body: n.transcript }, cats); n.cat = c || "thoughts"; n.catBy = "rules"; }
      await save(n, true);
      refresh(id);
    }
    const useAI = ai === true || (ai === null && settings.aiAuto);
    if (useAI && Suite.ai.enabled()) {
      try { await aiOrganize(id); if (!auto) toast("Organized by AI"); }
      catch (e) { toast(e.message); }
    } else if (!auto) toast(n.items.length ? `Found ${pending(n).length} item${pending(n).length === 1 ? "" : "s"}` : "No action items found");
  }

  async function aiOrganize(id) {
    let n = notes.find((x) => x.id === id);
    const names = cats.map((c) => c.name);
    const kinds = Object.keys(N.KINDS);
    const schema = {
      type: "object", additionalProperties: false, required: ["title", "summary", "key_points", "category", "items"],
      properties: {
        title: { type: "string" }, summary: { type: "string" },
        key_points: { type: "array", items: { type: "string" } },
        category: { type: "string", enum: names },
        items: { type: "array", items: { type: "object", additionalProperties: false, required: ["kind", "text", "due"],
          properties: { kind: { type: "string", enum: kinds }, text: { type: "string" }, due: { type: "string" } } } },
      },
    };
    const now = new Date();
    const r = await Suite.ai.json({
      system: "You organize a voice note someone recorded for themselves. Speech-to-text may have errors; read through them. "
        + "Give a title (max 8 words), a 1-3 sentence summary in plain words, up to 5 key points (empty if the note is short), the best category, "
        + "and every separate thing the person wants to do or save as items. Kinds: task = something to do or be reminded of; watch, read, listen = media to "
        + "consume later; buy = something to buy or look into buying; idea = an idea to keep; note = anything else worth saving on its own. "
        + "Write each item as a short imperative phrase in the person's words (\"Finish homework\", \"Watch the basketball video\"). "
        + "due = YYYY-MM-DDTHH:MM local time when a day or time is said or clearly meant (use 09:00 if only a day), else empty. Don't invent items.",
      content: `Now: ${N.localISO(now)} (${now.toLocaleDateString(undefined, { weekday: "long" })})\nCategories: ${names.join(", ")}\n\nTranscript:\n${n.transcript}`,
      schema, maxTokens: 3000,
    });
    n = notes.find((x) => x.id === id);
    const sent = n.items.filter((i) => i.sent);
    const fresh = (r.items || []).filter((it) => it.text && !sent.some((s) => s.text.toLowerCase() === it.text.toLowerCase()))
      .map((it) => ({ id: Suite.uid("ai"), kind: kinds.includes(it.kind) ? it.kind : "note", text: it.text.trim(), due: /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(it.due) ? it.due : "", sent: null }));
    n.items = [...sent, ...fresh];
    if (n.titleAuto && r.title) n.title = r.title;
    n.summary = r.summary || ""; n.points = r.key_points || [];
    const c = cats.find((c) => c.name === r.category);
    if (c && n.catBy !== "you") { n.cat = c.id; n.catBy = "ai"; }
    n.ai = { at: Date.now() };
    await save(n, true);
    refresh(id);
  }

  async function sendItems(noteId, ids) {
    const n = notes.find((x) => x.id === noteId);
    let count = 0; const where = new Set();
    for (const it of n.items) {
      if (!ids.includes(it.id) || it.sent || !it.text.trim()) continue;
      const dest = N.destFor(it.kind);
      const rec = await N.toRecord(dest, { ...it, note: "From a TALK note: " + (n.title || "voice note") }, "TALK");
      const saved = await Suite.send(dest, rec);
      it.sent = { app: dest, id: saved.id, at: Date.now() };
      count++; where.add(dest);
    }
    await save(n, true);
    refresh(noteId);
    if (count) toast(`Sent ${count} item${count === 1 ? "" : "s"} to ${[...where].map((d) => Suite.apps.find((a) => a.id === d).name).join(" & ")}`);
    return count;
  }
  const openLink = (s) => s.app === "inbox" ? `../inbox/#item/${s.id}` : (Suite.apps.find((a) => a.id === s.app) || {}).url || "#";

  /* ---------------------------------------------------------------- views */
  function noteRow(n, q) {
    const c = catById(n.cat), p = pending(n).length;
    const hl = (t) => { const s = esc(t); if (!q) return s; const terms = q.toLowerCase().split(/\s+/).filter((x) => x.length > 1).map((x) => esc(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); return terms.length ? s.replace(new RegExp("(" + terms.join("|") + ")", "gi"), "<mark>$1</mark>") : s; };
    return `<a class="note" href="#note/${n.id}">
      <div class="t"><span>${hl(n.title || "Untitled note")}</span>${n.fav ? `<svg viewBox="0 0 24 24" fill="currentColor">${P.star}</svg>` : ""}</div>
      ${n.summary || n.transcript ? `<div class="b">${hl(n.summary || n.transcript)}</div>` : ""}
      <div class="meta">${c ? `<span class="cat"><i class="dot" style="--c:${c.color}"></i>${esc(c.name)}</span>` : ""}<span>${ago(n.created)}</span>${n.duration ? `<span>${fmtDur(n.duration)}</span>` : ""}${n.audioId ? `<span>● audio</span>` : ""}${p ? `<span class="pill">${p} to send</span>` : ""}</div>
    </a>`;
  }

  function viewRecord() {
    if (rec && rec.on) {
      return `<section class="stage">
        <button class="mic on" id="micBtn" aria-label="Stop and save">${ico("stop")}<span class="ring"></span></button>
        <div class="timer" id="recTime">${fmtDur((Date.now() - rec.start) / 1000)}</div>
        <div class="hint">${rec.recog && !rec.srFatal ? "Listening" : "Recording"}${rec.mr ? " · audio saved" : ""}. Tap to stop and save.</div>
      </section>
      <section class="card live" id="live"></section>
      <div id="recStatus">${statusHTML()}</div>
      <div class="recbar"><button class="btn ghost" id="recCancel">Discard</button><button class="btn go" id="recDone">${ico("stop")}Stop &amp; save</button></div>`;
    }
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT) || "null"); } catch (e) {}
    const recent = [...notes].sort((a, b) => b.created - a.created).slice(0, 3);
    const cap = SR && CAN_REC ? `<div class="cap ok">${ico("ok")}<div>Live transcription and audio recording are available. If live text doesn't work on your phone, the audio still saves.</div></div>`
      : SR ? `<div class="cap ok">${ico("ok")}<div>Live transcription is available. Audio can't be saved in this browser.</div></div>`
      : CAN_REC ? `<div class="cap warn">${ico("warn")}<div>Live transcription isn't available in this browser. TALK will save the audio; then type or use the keyboard's dictation mic for the text.</div></div>`
      : `<div class="cap bad">${ico("warn")}<div>This browser can't record. Use <b>Type or dictate</b>: the keyboard's mic button turns speech into text.</div></div>`;
    return `
      ${draft && draft.text ? `<div class="cap recover">${ico("warn")}<div style="flex:1">A recording from ${ago(draft.start)} wasn't finished. Its transcript was kept.<div class="row" style="margin-top:8px"><button class="btn sm go" id="recoverYes">Recover it</button><button class="btn sm ghost" id="recoverNo">Discard</button></div></div></div>` : ""}
      <section class="stage">
        <button class="mic" id="micBtn" aria-label="Start recording">${ico("mic")}<span class="ring"></span></button>
        <div class="timer" style="color:var(--muted)">0:00</div>
        <div class="hint">Tap and talk. Say it the way you'd tell a friend: “I need to finish my homework tomorrow, remember to watch that basketball video, and look into new shoes.”</div>
      </section>
      <div class="row" style="justify-content:center;margin-top:6px"><button class="btn" id="typeBtn">${ico("type")}Type or dictate instead</button></div>
      ${cap}
      ${recent.length ? `<h2 class="sec">Recent <a class="more" href="#notes" style="text-decoration:none">All notes</a></h2><div class="list">${recent.map((n) => noteRow(n)).join("")}</div>` : ""}`;
  }

  function viewNotes() {
    const s = noteState;
    const terms = s.q.toLowerCase().split(/\s+/).filter(Boolean);
    let arr = [...notes].sort((a, b) => b.created - a.created);
    if (s.cat === "fav") arr = arr.filter((n) => n.fav);
    else if (s.cat === "pending") arr = arr.filter((n) => pending(n).length);
    else if (s.cat) arr = arr.filter((n) => n.cat === s.cat);
    if (terms.length) arr = arr.filter((n) => { const hay = [n.title, n.transcript, n.summary, ...(n.points || []), ...(n.items || []).map((i) => i.text)].join(" ").toLowerCase(); return terms.every((t) => hay.includes(t)); });
    const used = cats.filter((c) => notes.some((n) => n.cat === c.id));
    return `
      <div class="search"><label class="sr" for="nq">Search notes</label>${ico("search")}<input id="nq" type="search" placeholder="Search transcripts and summaries" value="${esc(s.q)}" autocomplete="off" enterkeyhint="search"></div>
      <div class="chips" style="margin:10px 0 12px">
        <button class="chip${!s.cat ? " on" : ""}" data-ncat="">All <span class="n">${notes.length}</span></button>
        <button class="chip${s.cat === "pending" ? " on" : ""}" data-ncat="pending">Has items</button>
        <button class="chip${s.cat === "fav" ? " on" : ""}" data-ncat="fav">Favorites</button>
        ${used.map((c) => `<button class="chip${s.cat === c.id ? " on" : ""}" data-ncat="${c.id}"><i class="dot" style="--c:${c.color}"></i>${esc(c.name)}</button>`).join("")}
      </div>
      <div id="nres">${notesList(arr, s.q)}</div>`;
  }
  const notesList = (arr, q) => arr.length ? `<div class="list">${arr.map((n) => noteRow(n, q)).join("")}</div>`
    : notes.length ? `<div class="empty">${ico("search")}<b>No matches</b>Try fewer words or another filter.</div>`
    : `<div class="empty">${ico("mic")}<b>No voice notes yet</b>Tap the mic and say what's on your mind.</div>`;

  function itemRow(n, it, compact) {
    const color = KIND_COLOR[it.kind] || "#a3a8bd";
    if (it.sent) {
      const app = Suite.apps.find((a) => a.id === it.sent.app);
      return `<div class="act-it sent"><span class="sel done"></span><div><div style="font-weight:600;padding:6px 4px">${esc(it.text)}</div>
        <div class="row2"><span class="kind" style="--c:${color}">${N.KINDS[it.kind]}</span><span class="sentlab">✓ In ${esc(app ? app.name : it.sent.app)} · <a href="${openLink(it.sent)}">Open</a></span></div></div></div>`;
    }
    return `<div class="act-it" data-item="${it.id}" data-note="${n.id}">
      <button class="sel${it.off ? "" : " on"}" data-toggle="${it.id}" aria-label="Include this item" aria-pressed="${!it.off}"></button>
      <div>
        <input type="text" value="${esc(it.text)}" data-edit="${it.id}" aria-label="Item text">
        <div class="row2">
          <select data-kind="${it.id}" aria-label="Kind">${Object.entries(N.KINDS).map(([k, l]) => `<option value="${k}"${k === it.kind ? " selected" : ""}>${l}</option>`).join("")}</select>
          ${it.kind === "task" ? `<input type="datetime-local" value="${esc(it.due || "")}" data-due="${it.id}" aria-label="Due">` : ""}
          <span class="dest">→ <b>${esc(N.destLabel(it.kind))}</b></span>
          ${compact ? `<button class="btn sm" data-sendone="${it.id}">${ico("send")}Send</button>` : `<button class="xbtn" data-rmitem="${it.id}" aria-label="Remove item">×</button>`}
        </div>
      </div>
    </div>`;
  }

  function viewNote(id) {
    const n = notes.find((x) => x.id === id);
    if (!n) return `<div class="empty"><b>That note is gone</b><a href="#notes">Back to notes</a></div>`;
    const p = pending(n), sel = p.filter((i) => !i.off);
    const ai = Suite.ai.enabled();
    return `
      <div class="row" style="margin-bottom:4px"><a class="iconbtn" href="#notes" aria-label="Back to notes">${ico("back")}</a><span class="spacer"></span>
        <button class="iconbtn${n.fav ? " on" : ""}" id="nFav" aria-label="${n.fav ? "Remove favorite" : "Favorite"}" style="${n.fav ? "color:var(--warn)" : ""}"><svg viewBox="0 0 24 24" fill="${n.fav ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linejoin="round">${P.star}</svg></button></div>
      <input type="text" class="titlein" id="nTitle" value="${esc(n.title)}" placeholder="Untitled note" aria-label="Title">
      <div class="nmeta"><span>${new Date(n.created).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>${n.duration ? `<span>· ${fmtDur(n.duration)}</span>` : ""}
        <select id="nCat" aria-label="Category">${cats.map((c) => `<option value="${c.id}"${c.id === n.cat ? " selected" : ""}>${esc(c.name)}</option>`).join("")}<option value="__new">+ New category…</option></select>
        ${n.catBy === "ai" ? `<span class="small">sorted by AI</span>` : ""}</div>
      ${n.audioId ? `<audio id="nAudio" controls preload="metadata"></audio>` : ""}
      ${n.summary ? `<section class="summary"><div class="eyebrow">AI summary</div><div>${esc(n.summary)}</div>${n.points && n.points.length ? `<ul>${n.points.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</section>` : ""}

      <h2 class="sec">Action items ${p.length ? `<span class="small muted" style="font-weight:500">${sel.length} selected</span>` : ""}</h2>
      ${n.items.length ? `<div class="acts">${n.items.map((it) => itemRow(n, it)).join("")}</div>` : `<p class="muted small" style="margin:0 2px">${n.transcript.trim() ? "Nothing to do or save was found. Add one yourself, or edit the transcript and look again." : "Add the transcript below, then find items."}</p>`}
      <div class="row" style="margin-top:10px">
        ${p.length ? `<button class="btn go" id="sendSel"${sel.length ? "" : " disabled"}>${ico("send")}Send ${sel.length || ""}</button>` : ""}
        <button class="btn sm" id="addItem">+ Add item</button>
        <button class="btn sm" id="findAgain">Find again</button>
        ${ai ? `<button class="btn sm" id="aiOrg">${ico("sparkle")}${n.ai ? "Redo with AI" : "Organize with AI"}</button>` : ""}
      </div>
      <p class="small muted" style="margin:8px 2px 0">Reminders go to INBOX as tasks${Suite.apps.find((a) => a.id === "reminders").built ? "" : " until DON'T FORGET is built"}; watch/read items go to INBOX${Suite.apps.find((a) => a.id === "queue").built ? "" : " until QUEUE is built"}.${ai ? "" : " Add an API key in Settings for AI summaries and smarter item finding."}</p>

      <h2 class="sec">Transcript</h2>
      ${!n.transcript && n.captured !== "typed" ? `<div class="cap warn" style="margin:0 0 8px">${ico("warn")}<div>Live transcription didn't run for this recording. Play it above and type, or tap the mic on your keyboard to dictate.</div></div>` : ""}
      <textarea class="transcript" id="nText" placeholder="Type here, or tap the mic on your keyboard and talk.">${esc(n.transcript)}</textarea>
      <div class="row" style="margin-top:14px">
        <button class="btn sm" id="nCopy">${ico("copy")}Copy</button>
        ${navigator.share ? `<button class="btn sm" id="nShare">${ico("share")}Share</button>` : ""}
        <span class="spacer"></span>
        <button class="btn sm danger" id="nDel">${ico("trash")}Delete</button>
      </div>`;
  }

  function viewActions() {
    const open = [], sent = [];
    for (const n of notes) for (const it of n.items || []) (it.sent ? sent : open).push({ n, it });
    open.sort((a, b) => b.n.created - a.n.created);
    sent.sort((a, b) => b.it.sent.at - a.it.sent.at);
    const groups = {};
    open.forEach((x) => (groups[x.it.kind] = groups[x.it.kind] || []).push(x));
    return `
      <p class="muted small" style="margin:0 2px 12px">Everything TALK found in your notes that hasn't been sent yet. Each one goes to the app shown.</p>
      ${open.length ? `<button class="btn go wide" id="sendAll"${open.some((x) => !x.it.off) ? "" : " disabled"}>${ico("send")}Send ${open.every((x) => !x.it.off) ? "all " : ""}${open.filter((x) => !x.it.off).length}</button>` : ""}
      ${open.length ? Object.keys(N.KINDS).filter((k) => groups[k]).map((k) => `<div class="group-h"><i class="dot" style="--c:${KIND_COLOR[k]}"></i>${N.KINDS[k]} · ${groups[k].length}</div><div class="acts">${groups[k].map(({ n, it }) => itemRow(n, it, true) + `<a class="small muted" href="#note/${n.id}" style="margin:-4px 0 4px 46px;text-decoration:none">from “${esc(n.title || "voice note")}”</a>`).join("")}</div>`).join("")
        : `<div class="empty">${ico("bolt")}<b>All caught up</b>Items you mention in a recording show up here until you send them.</div>`}
      ${sent.length ? `<h2 class="sec">Sent</h2><div class="acts">${sent.slice(0, 25).map(({ n, it }) => itemRow(n, it)).join("")}</div>` : ""}`;
  }

  async function viewSettings() {
    let est = null; try { est = await navigator.storage.estimate(); } catch (e) {}
    const th = Suite.theme.get(), ai = Suite.ai.enabled();
    return `
      <div class="row" style="margin-bottom:12px"><a class="iconbtn" href="#record" aria-label="Back">${ico("back")}</a><h2 style="font:800 20px var(--display);margin:0">Settings</h2></div>
      <div class="stack">
        <div class="card"><div class="eyebrow" style="margin-bottom:10px">Appearance</div>
          <div class="seg">${[["auto", "Auto"], ["dark", "Dark"], ["light", "Light"]].map(([k, l]) => `<button data-theme-set="${k}" class="${th === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
        <div class="card"><div class="eyebrow" style="margin-bottom:4px">Recording</div>
          <div class="setrow"><div class="l"><b>Save the audio</b><span>Keep the original recording with each note. Also the backup when live text fails.</span></div><span class="switch"><input type="checkbox" id="sAudio"${settings.saveAudio ? " checked" : ""}><span></span></span></div>
          <div class="setrow"><div class="l"><b>Language</b><span>For live transcription.</span></div><select id="sLang">${LANGS.map(([k, l]) => `<option value="${k}"${settings.lang === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>
          <div class="setrow"><div class="l"><b>Find action items automatically</b><span>After each recording, pull out reminders, things to watch or buy, and ideas (on-device rules).</span></div><span class="switch"><input type="checkbox" id="sFind"${settings.autoFind ? " checked" : ""}><span></span></span></div>
          <p class="small muted" style="margin:8px 0 0">Live transcription uses your phone's dictation service (Apple's, on iPhone), so it needs a connection. If it says it isn't allowed, turn on Dictation in Settings → General → Keyboard. iPhone stops the mic if you leave the app while recording, so stay in TALK until you tap stop.</p>
        </div>
        <div class="card"><div class="eyebrow" style="margin-bottom:4px">AI (Claude)</div>
          <p class="small muted" style="margin:6px 0 10px">${ai ? "Connected. The key is shared with INBOX on this device." : "Off. With an Anthropic API key, TALK writes a summary and key points and finds items more accurately. The same key works for INBOX."} The key stays on this device and is only sent to Anthropic; usage is billed to your Anthropic account. Audio is never sent, only the transcript text.</p>
          ${ai ? `<div class="setrow"><div class="l"><b>Organize every recording with AI</b><span>Otherwise use “Organize with AI” on a note.</span></div><span class="switch"><input type="checkbox" id="sAI"${settings.aiAuto ? " checked" : ""}><span></span></span></div>
            <div class="row"><button class="btn sm danger" id="aiRemove">Remove key</button></div>`
          : `<div class="row"><input type="password" id="aiKey" placeholder="sk-ant-…" autocomplete="off" style="flex:1"><button class="btn go" id="aiSave">Save</button></div>`}
        </div>
        <div class="card"><div class="eyebrow" style="margin-bottom:8px">Categories</div>
          <div class="stack" id="catList">${cats.map((c, i) => `<div class="row"><i class="dot" style="--c:${c.color};width:12px;height:12px"></i><input type="text" value="${esc(c.name)}" data-rename="${i}" aria-label="Category name" style="flex:1;padding:8px 10px"><button class="iconbtn" data-delcat="${i}" aria-label="Delete ${esc(c.name)}" style="width:36px;height:36px;color:var(--bad)">${ico("trash")}</button></div>`).join("")}</div>
          <div class="row" style="margin-top:10px"><input type="text" id="newCat" placeholder="New category" style="flex:1"><button class="btn" id="addCat">Add</button></div>
        </div>
        <div class="card"><div class="eyebrow" style="margin-bottom:4px">Your data</div>
          <div class="setrow"><div class="l"><b>${notes.length} notes</b><span>${est ? `About ${(est.usage / 1048576).toFixed(1)} MB used on this device (all suite apps). ` : ""}Recordings stay on this device.</span></div></div>
          <div class="setrow"><div class="l"><b>Backup</b><span>Notes and recordings in one file. Restoring merges; it never deletes.</span></div><div class="row"><button class="btn sm" id="exportBtn">Export</button><button class="btn sm" id="importBtn">Import</button></div></div>
          <div class="setrow"><div class="l"><b>Erase TALK</b><span>Deletes every note and recording on this device. Items already sent to INBOX stay there.</span></div><button class="btn sm danger" id="erase">Erase</button></div>
        </div>
      </div>`;
  }

  /* ---------------------------------------------------------------- routing */
  const TABS = [["record", "Record", "mic"], ["notes", "Notes", "notes"], ["actions", "Actions", "bolt"]];
  const SUB = { record: "Say it, sort it", notes: "Your voice notes", note: "Voice note", actions: "Things to send", settings: "Settings" };
  function parseRoute() {
    const [view, arg] = decodeURIComponent(location.hash.slice(1) || "record").split("/");
    route = { view: ["record", "notes", "note", "actions", "settings"].includes(view) ? view : "record", arg };
  }
  function go(view, arg) { const h = "#" + view + (arg ? "/" + arg : ""); if (location.hash === h) render(); else location.hash = h; }
  window.addEventListener("hashchange", () => { parseRoute(); render(); window.scrollTo(0, 0); });

  let seq = 0, audioURL = null;
  async function render() {
    const my = ++seq;
    const cur = route.view === "note" ? "notes" : route.view;
    $("#tabs").innerHTML = TABS.map(([k, l, i]) => `<a class="tab${cur === k ? " on" : ""}" href="#${k}"${cur === k ? ' aria-current="page"' : ""}>${ico(i)}<span>${l}</span></a>`).join("");
    $("#settingsBtn").classList.toggle("on", route.view === "settings");
    $("#subtitle").textContent = SUB[route.view];
    $("#fab").classList.toggle("hide", route.view === "record" || route.view === "settings" || !!(rec && rec.on));
    // don't rebuild the search box (or a note being edited) underneath the user
    if (route.view === "notes" && $("#nq")) { renderNoteResults(); return; }
    const html = route.view === "notes" ? viewNotes() : route.view === "note" ? viewNote(route.arg) : route.view === "actions" ? viewActions() : route.view === "settings" ? await viewSettings() : viewRecord();
    if (my !== seq) return;
    $("#main").innerHTML = html;
    if (route.view === "record") updateRecUI();
    if (route.view === "note") bindNote(route.arg);
  }
  function renderNoteResults() {
    const box = $("#nres"); if (!box) return;
    const tmp = document.createElement("div"); tmp.innerHTML = viewNotes();
    box.innerHTML = $("#nres", tmp).innerHTML;
    $$(".chips .chip").forEach((b, i) => { const nb = $$(".chips .chip", tmp)[i]; if (nb) b.className = nb.className; });
  }
  /** re-render a note page in place, keeping scroll */
  function refresh(id) { if (route.view === "note" && route.arg === id) { const y = scrollY; render().then(() => scrollTo(0, y)); } else if (route.view !== "record") render(); }

  function bindNote(id) {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    if (n.audioId) Suite.files.blob(n.audioId).then((b) => { const a = $("#nAudio"); if (b && a) { if (audioURL) URL.revokeObjectURL(audioURL); audioURL = URL.createObjectURL(b); a.src = audioURL; } });
    let t = null;
    const flush = async () => {
      clearTimeout(t);
      const cur = notes.find((x) => x.id === id); if (!cur) return;
      const title = $("#nTitle").value.trim(), text = $("#nText").value;
      if (title === cur.title && text === cur.transcript) return;
      if (title !== cur.title) { cur.title = title; cur.titleAuto = false; }
      cur.transcript = text;
      await save(cur, true);
    };
    ["#nTitle", "#nText"].forEach((s) => { const f = $(s); f.addEventListener("input", () => { clearTimeout(t); t = setTimeout(flush, 500); }); f.addEventListener("blur", flush); });
    $("#nText").addEventListener("blur", async () => { const cur = notes.find((x) => x.id === id); if (cur && cur.transcript.trim() && !cur.items.length && cur.captured !== "live") { await organize(id, { auto: true }); } });
    bindNote.flush = flush;
  }

  /* ---------------------------------------------------------------- events */
  const noteOf = (el) => notes.find((x) => x.id === (el.closest("[data-note]") || {}).dataset?.note) || notes.find((x) => x.id === route.arg);
  const itemOf = (n, id) => n && n.items.find((i) => i.id === id);

  $("#fab").onclick = () => { go("record"); startRecording(); };
  $("#settingsBtn").onclick = () => go(route.view === "settings" ? "record" : "settings");

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button");
    if (!t || !$("#main").contains(t)) return;
    const d = t.dataset;
    if (d.themeSet) { Suite.theme.set(d.themeSet); return render(); }
    if (d.ncat != null) { noteState.cat = d.ncat; return renderNoteResults(); }
    if (d.toggle) { const n = noteOf(t), it = itemOf(n, d.toggle); it.off = !it.off; await save(n, true); return refresh(n.id); }
    if (d.rmitem) { const n = noteOf(t); n.items = n.items.filter((i) => i.id !== d.rmitem); await save(n, true); return refresh(n.id); }
    if (d.sendone) { const n = noteOf(t); return sendItems(n.id, [d.sendone]).then(() => render()); }
    if (d.delcat) {
      const c = cats[+d.delcat];
      if (!confirm(`Delete “${c.name}”? Notes in it stay, without a category.`)) return;
      cats.splice(+d.delcat, 1); await saveCats();
      for (const n of notes.filter((x) => x.cat === c.id)) { n.cat = null; n.catBy = null; await save(n, true); }
      return render();
    }
    switch (t.id) {
      case "micBtn": return rec && rec.on ? stopRecording(false) : startRecording();
      case "recDone": return stopRecording(false);
      case "recCancel": if (liveText().length < 40 || confirm("Discard this recording?")) stopRecording(true); return;
      case "typeBtn": { const n = await createNote({ captured: "typed" }); go("note", n.id); setTimeout(() => $("#nText") && $("#nText").focus(), 80); return; }
      case "recoverYes": {
        let dr = null; try { dr = JSON.parse(localStorage.getItem(DRAFT)); } catch (e) {}
        if (dr && dr.text) { const n = await createNote({ transcript: dr.text, duration: 0, captured: "live" }); n.created = dr.start || n.created; await save(n, true); localStorage.removeItem(DRAFT); go("note", n.id); organize(n.id, { auto: true }); }
        return;
      }
      case "recoverNo": localStorage.removeItem(DRAFT); return render();
      case "nFav": { const n = notes.find((x) => x.id === route.arg); n.fav = !n.fav; await save(n, true); return refresh(n.id); }
      case "sendSel": { await bindNote.flush(); const n = notes.find((x) => x.id === route.arg); t.disabled = true; return sendItems(n.id, pending(n).filter((i) => !i.off).map((i) => i.id)); }
      case "addItem": { const n = notes.find((x) => x.id === route.arg); n.items.push({ id: Suite.uid("ai"), kind: "task", text: "", due: "", sent: null }); await save(n, true); await render(); const inputs = $$("[data-edit]"); inputs.length && inputs[inputs.length - 1].focus(); return; }
      case "findAgain": await bindNote.flush(); return organize(route.arg, { ai: false });
      case "aiOrg": { await bindNote.flush(); t.disabled = true; t.lastChild.textContent = "Working…"; try { await aiOrganize(route.arg); toast("Organized by AI"); } catch (err) { toast(err.message); t.disabled = false; t.lastChild.textContent = "Organize with AI"; } return; }
      case "nCopy": case "nShare": {
        await bindNote.flush();
        const n = notes.find((x) => x.id === route.arg);
        const txt = [n.title, n.summary, (n.points || []).map((p) => "• " + p).join("\n"), (n.items || []).length ? "To do:\n" + n.items.map((i) => "- " + i.text).join("\n") : "", n.transcript].filter(Boolean).join("\n\n");
        if (t.id === "nShare") { try { await navigator.share({ title: n.title || "Voice note", text: txt }); } catch (err) {} return; }
        try { await navigator.clipboard.writeText(txt); toast("Copied"); } catch (err) { toast("Couldn't copy"); }
        return;
      }
      case "nDel": {
        const n = notes.find((x) => x.id === route.arg);
        await Suite.store.del("talk", n.id); notes = notes.filter((x) => x.id !== n.id);
        go("notes");
        let undone = false;
        toast("Note deleted", { label: "Undo", run: async () => { undone = true; await save(n); go("note", n.id); } });
        setTimeout(() => { if (!undone) Suite.files.del(n.audioId); }, 6500);
        return;
      }
      case "sendAll": {
        t.disabled = true; let total = 0;
        for (const n of notes) { const ids = pending(n).filter((i) => !i.off).map((i) => i.id); if (ids.length) total += await sendItemsQuiet(n.id, ids); }
        toast(`Sent ${total} item${total === 1 ? "" : "s"}`); return render();
      }
      case "addCat": { const v = $("#newCat").value.trim(); if (!v) return; cats.push({ id: Suite.uid("c"), name: v.slice(0, 30), color: PALETTE[cats.length % PALETTE.length] }); await saveCats(); return render(); }
      case "aiSave": { const k = $("#aiKey").value.trim(); if (!/^sk-ant-/.test(k)) return toast("That doesn't look like an Anthropic key (starts with sk-ant-)"); Suite.ai.setKey(k); toast("Key saved on this device"); return render(); }
      case "aiRemove": if (confirm("Remove the API key from this device? AI turns off in TALK and INBOX.")) { Suite.ai.setKey(""); render(); } return;
      case "exportBtn": { const b = await Suite.backup.export(["talk"]); Suite.download(b, `talk-backup-${new Date().toISOString().slice(0, 10)}.json`); return toast("Backup downloaded"); }
      case "importBtn": return $("#importPick").click();
      case "erase":
        if (prompt(`Type ERASE to delete all ${notes.length} notes and recordings from this device.`) !== "ERASE") return;
        for (const n of notes) await Suite.files.del(n.audioId);
        await Suite.store.clear("talk"); notes = []; toast("TALK erased"); return render();
    }
  });
  async function sendItemsQuiet(noteId, ids) {
    const n = notes.find((x) => x.id === noteId); let c = 0;
    for (const it of n.items) {
      if (!ids.includes(it.id) || it.sent || !it.text.trim()) continue;
      const dest = N.destFor(it.kind);
      const saved = await Suite.send(dest, await N.toRecord(dest, { ...it, note: "From a TALK note: " + (n.title || "voice note") }, "TALK"));
      it.sent = { app: dest, id: saved.id, at: Date.now() }; c++;
    }
    await save(n, true);
    return c;
  }

  document.addEventListener("change", async (e) => {
    const t = e.target, d = t.dataset;
    if (d.kind) { const n = noteOf(t), it = itemOf(n, d.kind); it.kind = t.value; if (it.kind === "task" && !it.due) it.due = N.parseDue(it.text); await save(n, true); return refresh(n.id); }
    if (d.due) { const n = noteOf(t), it = itemOf(n, d.due); it.due = t.value; return save(n, true); }
    if (d.rename) { const v = t.value.trim(); if (v) { cats[+d.rename].name = v.slice(0, 30); await saveCats(); } return; }
    if (t.id === "nCat") {
      const n = notes.find((x) => x.id === route.arg);
      if (t.value === "__new") {
        const name = prompt("New category name");
        if (!name || !name.trim()) { t.value = n.cat || ""; return; }
        const c = { id: Suite.uid("c"), name: name.trim().slice(0, 30), color: PALETTE[cats.length % PALETTE.length] };
        cats.push(c); await saveCats(); n.cat = c.id;
      } else n.cat = t.value;
      n.catBy = "you"; await save(n, true); return refresh(n.id);
    }
    if (t.id === "sAudio") { settings.saveAudio = t.checked; return saveSettings(); }
    if (t.id === "sLang") { settings.lang = t.value; return saveSettings(); }
    if (t.id === "sFind") { settings.autoFind = t.checked; return saveSettings(); }
    if (t.id === "sAI") { settings.aiAuto = t.checked; return saveSettings(); }
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "nq") { noteState.q = t.value; renderNoteResults(); }
    if (t.dataset.edit) { const n = noteOf(t), it = itemOf(n, t.dataset.edit); if (it) { it.text = t.value; clearTimeout(t._h); t._h = setTimeout(() => save(n, true), 400); } }
  });
  $("#importPick").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try { const n = await Suite.backup.import(await f.text()); await load(); render(); toast(n ? `Restored ${n} note${n === 1 ? "" : "s"}` : "Nothing new in that backup"); }
    catch (err) { toast(err.message); }
  });
  // leaving the app mid-recording: iPhone cuts the mic, so save what we have
  document.addEventListener("visibilitychange", () => { if (document.hidden && rec && rec.on) stopRecording(false); });
  Suite.onChange(async (s) => { if (s === "talk" && !(rec && rec.on)) { notes = await Suite.store.all("talk"); if (route.view !== "note") render(); } });

  (async function start() {
    try { await load(); }
    catch (e) { $("#main").innerHTML = `<div class="empty"><b>Storage isn't available</b>${esc(e.message)}</div>`; return; }
    parseRoute();
    await render();
  })();
})();
