/* INBOX: save anything fast, find it later.

   Records live in the suite database's `inbox` store (see ../suite/suite.js); photos are in `files`.
   An item: {id, type: note|idea|link|image, title, body, url, note, cat, tags[], pinned, fav, archived,
   task: null | {due: "YYYY-MM-DDTHH:MM" | "", done, doneAt}, imageId, thumbId, link: {title, author, thumb},
   summary, ai: {at}, catBy: rules|ai|you, source, created, updated}.

   Sorting new items: on-device rules always (keywords, link domains, #tags); Claude on top when the user
   has added an API key in Settings. The rules never claim to be AI and nothing pretends to read a web
   page: YouTube titles come from YouTube's own oEmbed endpoint, other links keep their address.
*/
(function () {
  "use strict";
  const { esc, ago, toast } = Suite;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  /* ---------------------------------------------------------------- icons */
  const P = {
    note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    idea: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L5 21"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    all: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    cats: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    pin: '<path d="M9 4h6l-1 6 4 3v2H6v-2l4-3z"/><path d="M12 15v6"/>',
    task: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h4"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>',
  };
  const ico = (k, sw = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k]}</svg>`;
  const icoFill = (k) => `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">${P[k]}</svg>`;

  const TYPES = { note: "Note", idea: "Idea", link: "Link", image: "Image" };
  const TYPE_COLOR = { note: "#8b7bff", idea: "#ffb020", link: "#2ed3b7", image: "#ff5fa2" };
  const PALETTE = ["#8b7bff", "#ffb020", "#2ed3b7", "#ff5fa2", "#4aa8ff", "#3ddc97", "#ff7a59", "#c77dff", "#a3a8bd"];

  /* default categories; the keyword lists are the on-device auto-sort rules */
  const DEFAULT_CATS = [
    { id: "ideas", name: "Ideas", color: "#ffb020" },
    { id: "todo", name: "To-Do", color: "#ff7a59" },
    { id: "watch", name: "Watch", color: "#ff5fa2" },
    { id: "read", name: "Read", color: "#4aa8ff" },
    { id: "shopping", name: "Shopping", color: "#2ed3b7" },
    { id: "school", name: "School", color: "#c77dff" },
    { id: "hoops", name: "Basketball", color: "#ff8a3d" },
    { id: "personal", name: "Personal", color: "#3ddc97" },
  ];
  const RULES = {
    ideas: { words: ["idea", "what if", "could build", "app idea", "business", "invent", "concept", "brainstorm", "startup"] },
    todo: { words: ["todo", "to-do", "to do", "need to", "have to", "gotta", "remember to", "don't forget", "dont forget", "remind me", "call ", "email ", "text ", "finish", "pick up", "schedule", "appointment", "deadline"] },
    watch: { words: ["watch", "movie", "film", "show", "episode", "season", "trailer", "video", "documentary", "netflix", "hulu", "youtube"], domains: ["youtube.com", "youtu.be", "vimeo.com", "netflix.com", "hulu.com", "twitch.tv", "max.com", "disneyplus.com", "primevideo.com", "tv.apple.com"] },
    read: { words: ["read", "article", "book", "blog", "newsletter", "essay", "paper", "chapter", "kindle"], domains: ["medium.com", "substack.com", "nytimes.com", "theathletic.com", "wikipedia.org", "goodreads.com", "theatlantic.com", "wsj.com"] },
    shopping: { words: ["buy", "shoes", "sneakers", "price", "deal", "sale", "cart", "wishlist", "gift", "jacket", "hoodie", "headphones", "$"], domains: ["amazon.com", "a.co", "amzn.to", "ebay.com", "etsy.com", "target.com", "walmart.com", "bestbuy.com", "nike.com", "adidas.com", "stockx.com", "goat.com", "footlocker.com", "apple.com/shop", "costco.com"] },
    school: { words: ["homework", "hw", "class", "teacher", "quiz", "test", "exam", "essay", "study", "assignment", "project due", "syllabus", "grade", "college", "lab report", "canvas", "schoology"] },
    hoops: { words: ["basketball", "hoops", "practice", "drill", "workout", "shooting", "dribble", "pick and roll", "pnr", "film", "coach", "game", "aau", "nba", "brunson", "sga", "handles", "layup", "jumper", "defense"], domains: ["nba.com", "espn.com/nba", "basketball-reference.com"] },
    personal: { words: ["mom", "dad", "family", "friend", "birthday", "doctor", "dentist", "haircut", "church", "journal", "goal", "health", "sleep", "gym"] },
  };

  /* ---------------------------------------------------------------- state */
  let items = [], cats = [], settings = { autoSort: true, aiAuto: true };
  let route = { view: "home" };
  let listLimit = 60;
  const thumbURL = new Map();
  let pendingImages = []; // [{file, url}] attached to the home capture box
  const allState = { mode: "active", type: "all", sort: "new" };
  const searchState = { q: "", type: "all", cat: "", archived: false };

  const catById = (id) => cats.find((c) => c.id === id);
  const live = () => items.filter((i) => !i.archived);
  const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };

  async function load() {
    items = (await Suite.store.all("inbox")) || [];
    cats = await Suite.meta.get("inbox:categories", null);
    if (!cats) { cats = DEFAULT_CATS.map((c) => ({ ...c })); await Suite.meta.set("inbox:categories", cats); }
    settings = { ...settings, ...(await Suite.meta.get("inbox:settings", {})) };
  }
  const saveCats = () => Suite.meta.set("inbox:categories", cats);
  const saveSettings = () => Suite.meta.set("inbox:settings", settings);

  async function save(it, quiet) {
    it.updated = Date.now();
    await Suite.store.put("inbox", it);
    const i = items.findIndex((x) => x.id === it.id);
    if (i >= 0) items[i] = it; else items.unshift(it);
    if (!quiet) render();
    return it;
  }

  /* ---------------------------------------------------------------- parsing + auto-sort */
  const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi;
  const TAG_RE = /(^|\s)#([\p{L}\p{N}_-]{1,32})/gu;

  function parseCapture(raw) {
    let text = String(raw || "").replace(/\r/g, "").trim();
    const tags = [];
    text = text.replace(TAG_RE, (m, sp, t) => { if (!tags.includes(t.toLowerCase())) tags.push(t.toLowerCase()); return sp; }).replace(/[ \t]+\n/g, "\n").trim();
    const urls = (text.match(URL_RE) || []).map((u) => (/^www\./i.test(u) ? "https://" + u : u));
    const url = urls[0] || "";
    let rest = url ? text.replace(text.match(URL_RE)[0], "").trim() : text;
    rest = rest.replace(/\n{3,}/g, "\n\n");
    let title = "", body = "";
    const lines = rest.split("\n");
    const first = lines[0].trim();
    if (first.length <= 100) { title = first; body = lines.slice(1).join("\n").trim(); }
    else { const cut = first.slice(0, 90).replace(/\s+\S*$/, ""); title = cut + "…"; body = rest; }
    let type = url ? "link" : /^(idea|app idea|business idea|what if|maybe (i|we) (could|should))\b/i.test(rest) ? "idea" : "note";
    return { title, body, url, tags, type, text: rest };
  }

  /* natural dates: today / tonight / tomorrow / weekday / next week, optional "at 4", "4pm", "4:30 pm", "noon" */
  function parseDue(text) {
    const t = " " + text.toLowerCase() + " ";
    const now = new Date();
    let day = null;
    if (/\btomorrow\b|\btmrw\b|\btmr\b/.test(t)) { day = new Date(now); day.setDate(day.getDate() + 1); }
    else if (/\btonight\b|\btoday\b/.test(t)) day = new Date(now);
    else if (/\bnext week\b/.test(t)) { day = new Date(now); day.setDate(day.getDate() + 7); }
    else {
      const wd = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const m = t.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
      if (m) {
        const idx = wd.indexOf(m[1]);
        day = new Date(now);
        let add = (idx - now.getDay() + 7) % 7; if (add === 0) add = 7;
        day.setDate(day.getDate() + add);
      }
    }
    let hh = null, mm = 0;
    const tm = t.match(/\b(?:at|by|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/) || t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
    if (tm) {
      hh = +tm[1]; mm = +(tm[2] || 0);
      const ap = (tm[3] || "").replace(/\./g, "");
      if (ap === "pm" && hh < 12) hh += 12;
      if (ap === "am" && hh === 12) hh = 0;
      if (!ap && hh >= 1 && hh <= 7) hh += 12; // "at 4" means the afternoon
      if (hh > 23 || mm > 59) hh = null;
    } else if (/\bnoon\b/.test(t)) hh = 12;
    else if (/\btonight\b/.test(t)) hh = 20;
    if (!day && hh == null) return "";
    if (!day) { day = new Date(now); if (hh < now.getHours() || (hh === now.getHours() && mm <= now.getMinutes())) day.setDate(day.getDate() + 1); }
    if (hh == null) { hh = 9; mm = 0; }
    day.setHours(hh, mm, 0, 0);
    return localISO(day);
  }
  const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const TASK_RE = /\b(todo|to-do|need to|have to|gotta|remember to|don'?t forget|remind me|must|due)\b/i;

  /** rules-based category: a #tag naming a category wins, then link domain, then keyword score */
  function ruleCategory(it) {
    for (const t of it.tags || []) { const c = cats.find((c) => c.name.toLowerCase() === t || c.id === t); if (c) return c.id; }
    const dom = domainOf(it.url), full = (it.url || "").toLowerCase();
    if (dom) for (const [id, r] of Object.entries(RULES)) if (catById(id) && (r.domains || []).some((d) => dom === d || dom.endsWith("." + d) || full.includes(d))) return id;
    const txt = " " + [it.title, it.body, it.note, it.link && it.link.title].filter(Boolean).join(" ").toLowerCase() + " ";
    let best = null, bestN = 0, subject = null;
    for (const c of cats) {
      const r = RULES[c.id];
      const words = r ? r.words : [c.name.toLowerCase()];
      let n = 0;
      for (const w of words) if (w.length <= 3 ? new RegExp("\\b" + w.trim().replace(/[$]/g, "\\$") + "\\b").test(txt) || (w === "$" && txt.includes("$")) : txt.includes(w)) n++;
      if (!r && txt.includes(" " + c.name.toLowerCase())) n += 2;
      if (n > bestN) { best = c.id; bestN = n; }
      if (n && c.id !== "todo") subject = subject || c.id;
    }
    // "need to finish my homework" is already a task; the subject (School) says more than To-Do
    return best === "todo" && subject ? subject : best;
  }

  async function fetchLinkMeta(url) {
    const d = domainOf(url);
    if (!/(^|\.)youtube\.com$|^youtu\.be$/.test(d)) return null;
    try {
      const r = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(url));
      if (!r.ok) return null;
      const j = await r.json();
      return { title: j.title || "", author: j.author_name || "", thumb: j.thumbnail_url || "", provider: "YouTube" };
    } catch (e) { return null; }
  }
  function prettyLinkTitle(url) {
    try {
      const u = new URL(url);
      const seg = u.pathname.split("/").filter(Boolean).pop() || "";
      const words = decodeURIComponent(seg).replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_+]+/g, " ").trim();
      return words && !/^\d+$/.test(words) && words.length > 3 ? words.charAt(0).toUpperCase() + words.slice(1) : u.hostname.replace(/^www\./, "");
    } catch (e) { return url; }
  }

  /* ---------------------------------------------------------------- images */
  async function shrink(file, max, q) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Couldn't read that image")); i.src = url; });
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
      const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
      const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", q));
      return { blob, w, h };
    } finally { URL.revokeObjectURL(url); }
  }
  async function storeImage(file) {
    const big = await shrink(file, 1800, 0.85), small = await shrink(file, 240, 0.72);
    const imageId = await Suite.files.put(big.blob, { name: file.name || "image.jpg" });
    const thumbId = await Suite.files.put(small.blob);
    return { imageId, thumbId, imgW: big.w, imgH: big.h };
  }
  async function thumb(id) {
    if (!id) return "";
    if (thumbURL.has(id)) return thumbURL.get(id);
    const b = await Suite.files.blob(id);
    const u = b ? URL.createObjectURL(b) : "";
    thumbURL.set(id, u);
    return u;
  }
  function hydrateThumbs(root = document) {
    $$("img[data-thumb]", root).forEach(async (img) => { const u = await thumb(img.dataset.thumb); if (u) img.src = u; img.removeAttribute("data-thumb"); });
  }

  /* ---------------------------------------------------------------- create */
  async function createItem({ text = "", images = [], cat = "", tags = [], pinned = false, fav = false, task = null, source = "manual", type = "" }) {
    const p = parseCapture(text);
    const imgs = images.length ? images : [null];
    const made = [];
    for (let k = 0; k < imgs.length; k++) {
      const now = Date.now() + k;
      const it = {
        id: Suite.uid("in"), type: type || (imgs[k] ? "image" : p.type), title: p.title, body: p.body, url: p.url, note: "",
        cat: cat || null, catBy: cat ? "you" : null, tags: [...new Set([...p.tags, ...tags])],
        pinned, fav, archived: false, task: task ? { due: task.due || "", done: false } : null,
        source, created: now, updated: now,
      };
      if (imgs[k]) Object.assign(it, await storeImage(imgs[k]));
      if (!it.task && TASK_RE.test(p.text)) it.task = { due: parseDue(p.text), done: false };
      if (it.task && !it.task.due && p.text) it.task.due = parseDue(p.text);
      if (it.type === "link" && !it.title) it.title = prettyLinkTitle(it.url), it.titleAuto = true;
      if (!it.title && it.type === "image") it.title = "Screenshot " + new Date(now).toLocaleDateString(undefined, { month: "short", day: "numeric" }), it.titleAuto = true;
      if (!it.cat && settings.autoSort) { it.cat = ruleCategory(it); if (it.cat) it.catBy = "rules"; }
      await save(it, true);
      made.push(it);
    }
    render();
    for (const it of made) enrich(it);
    return made;
  }

  /* after saving: YouTube title/thumbnail, then AI sort if switched on */
  async function enrich(it) {
    if (it.url) {
      const meta = await fetchLinkMeta(it.url);
      if (meta) {
        it = items.find((x) => x.id === it.id) || it;
        it.link = meta;
        if (it.titleAuto || !it.title) { it.title = meta.title || it.title; it.titleAuto = true; }
        if (it.catBy !== "you" && settings.autoSort) { const c = ruleCategory(it); if (c) { it.cat = c; it.catBy = "rules"; } }
        await save(it);
      }
    }
    if (Suite.ai.enabled() && settings.aiAuto) aiSort(it.id, true);
  }

  /* ---------------------------------------------------------------- AI */
  async function imageBlock(it) {
    if (!it.imageId) return null;
    const f = await Suite.files.raw(it.imageId);
    if (!f) return null;
    const u = new Uint8Array(f.buf); let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return { type: "image", source: { type: "base64", media_type: f.type || "image/jpeg", data: btoa(s) } };
  }
  function itemText(it) {
    return [
      it.title && "Title: " + it.title, it.body && "Text: " + it.body, it.url && "Link: " + it.url,
      it.link && it.link.title && `Link title (from ${it.link.provider}): ${it.link.title}${it.link.author ? " by " + it.link.author : ""}`,
      it.note && "Personal note: " + it.note, (it.tags || []).length && "Tags: " + it.tags.join(", "),
    ].filter(Boolean).join("\n");
  }
  async function aiSort(id, quiet) {
    let it = items.find((x) => x.id === id);
    if (!it) return;
    const names = cats.map((c) => c.name);
    const schema = {
      type: "object", additionalProperties: false,
      required: ["title", "category", "tags", "type", "summary", "is_task", "due"],
      properties: {
        title: { type: "string" }, category: { type: "string", enum: [...names, "None"] },
        tags: { type: "array", items: { type: "string" } }, type: { type: "string", enum: Object.keys(TYPES) },
        summary: { type: "string" }, is_task: { type: "boolean" }, due: { type: "string" },
      },
    };
    const now = new Date();
    const system = "You file items for a personal 'save everything' inbox app. Pick the best category from the list (or None), "
      + "1-4 short lowercase tags, a clear title of at most 8 words, and the item type. Write a 1-2 sentence summary only if the item is long "
      + "or an image whose content is worth describing; otherwise an empty string. You cannot open links: judge them only from the address and any "
      + "title given, and never describe a page's contents. is_task is true only if the item is something the user must do; then give due as "
      + "YYYY-MM-DDTHH:MM local time if a time is stated or clearly implied, otherwise an empty string.";
    const content = [];
    const img = await imageBlock(it);
    if (img) content.push(img);
    content.push({ type: "text", text: `Now: ${localISO(now)} (${now.toLocaleDateString(undefined, { weekday: "long" })})\nCategories: ${names.join(", ")}\n\n${itemText(it) || "(image only)"}` });
    try {
      const r = await Suite.ai.json({ system, content, schema, maxTokens: 1500 });
      it = items.find((x) => x.id === id);
      if (!it) return;
      const c = cats.find((c) => c.name === r.category);
      if (it.catBy !== "you" && c) { it.cat = c.id; it.catBy = "ai"; }
      if ((it.titleAuto || !it.title) && r.title) { it.title = r.title; it.titleAuto = true; }
      const tg = (r.tags || []).map((t) => String(t).toLowerCase().replace(/^#/, "").replace(/\s+/g, "-").slice(0, 32)).filter(Boolean);
      it.tags = [...new Set([...(it.tags || []), ...tg])].slice(0, 8);
      if (r.summary && !it.summary) it.summary = r.summary;
      if (r.is_task && !it.task) it.task = { due: /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(r.due) ? r.due : "", done: false };
      it.ai = { at: Date.now() };
      await save(it);
      if (!quiet) toast("Sorted by AI");
      refreshOpenSheet(it.id);
    } catch (e) { if (!quiet) toast(e.message); else console.warn("AI sort:", e.message); }
  }
  async function aiSummarize(id) {
    let it = items.find((x) => x.id === id);
    const schema = { type: "object", additionalProperties: false, required: ["summary", "key_points"], properties: { summary: { type: "string" }, key_points: { type: "array", items: { type: "string" } } } };
    const content = [];
    const img = await imageBlock(it);
    if (img) content.push(img);
    content.push({ type: "text", text: itemText(it) || "(image only)" });
    const r = await Suite.ai.json({
      system: "Summarize this saved item for its owner in 1-3 plain sentences, plus up to 5 key points (empty list if there are none worth listing). "
        + "Use only what is given here: you cannot open links, so for a bare link say what the address and title suggest and that the page itself wasn't read. "
        + "For an image, describe and transcribe what matters in it.",
      content, schema, maxTokens: 2000,
    });
    it = items.find((x) => x.id === id);
    it.summary = r.summary + (r.key_points && r.key_points.length ? "\n" + r.key_points.map((k) => "• " + k).join("\n") : "");
    it.ai = { ...(it.ai || {}), at: Date.now() };
    await save(it);
  }

  /* ---------------------------------------------------------------- rendering helpers */
  function dueInfo(task) {
    if (!task || !task.due) return null;
    const d = new Date(task.due), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1);
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    let label = sameDay ? "Today " + time : d.toDateString() === tmr.toDateString() ? "Tomorrow " + time : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " " + time;
    const cls = task.done ? "" : d < now ? "late" : sameDay ? "today" : "";
    return { label, cls, d };
  }
  function hl(text, q) {
    const s = esc(text);
    if (!q) return s;
    const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return terms.length ? s.replace(new RegExp("(" + terms.map(esc).join("|") + ")", "gi"), "<mark>$1</mark>") : s;
  }
  function row(it, q) {
    const c = catById(it.cat);
    const color = c ? c.color : TYPE_COLOR[it.type];
    const di = dueInfo(it.task);
    const icon = it.thumbId ? `<img data-thumb="${it.thumbId}" alt="">` : it.link && it.link.thumb ? `<img src="${esc(it.link.thumb)}" alt="" loading="lazy">` : ico(it.type);
    const sub = it.body || it.note || (it.url ? domainOf(it.url) : "") || it.summary || "";
    return `<div class="item${it.task && it.task.done ? " done" : ""}" data-id="${it.id}" role="button" tabindex="0" style="--c:${color}">
      ${it.task ? `<button class="check${it.task.done ? " on" : ""}" data-check="${it.id}" aria-label="${it.task.done ? "Mark not done" : "Mark done"}"></button>` : ""}
      <div class="ic">${icon}</div>
      <div class="m">
        <div class="t">${hl(it.title || "Untitled", q)}</div>
        ${sub ? `<div class="b">${hl(sub, q)}</div>` : ""}
        <div class="meta">
          ${c ? `<span class="cat"><i class="dot" style="--c:${c.color}"></i>${esc(c.name)}</span>` : ""}
          ${di ? `<span class="due ${di.cls}">${esc(di.label)}</span>` : ""}
          ${(it.tags || []).slice(0, 3).map((t) => `<span class="tag">#${hl(t, q)}</span>`).join("")}
          <span>${ago(it.created)}</span>
          ${it.archived ? `<span class="badge">Archived</span>` : ""}
        </div>
      </div>
      <div class="flags">
        <button class="pinbtn${it.pinned ? " on" : ""}" data-pin="${it.id}" aria-label="${it.pinned ? "Unpin" : "Pin"}">${it.pinned ? icoFill("pin") : ico("pin")}</button>
        <button class="${it.fav ? "on" : ""}" data-fav="${it.id}" aria-label="${it.fav ? "Remove favorite" : "Favorite"}">${it.fav ? icoFill("star") : ico("star")}</button>
      </div>
    </div>`;
  }
  function listHTML(arr, { q, group, empty } = {}) {
    if (!arr.length) return empty || `<div class="empty">${ico("inbox")}<b>Nothing here yet</b>Saved items will show up here.</div>`;
    const shown = arr.slice(0, listLimit);
    let html = "", last = null;
    for (const it of shown) {
      if (group) {
        const g = group(it);
        if (g.key !== last) { html += `<div class="group-h">${g.dot ? `<i class="dot" style="--c:${g.dot}"></i>` : ""}${esc(g.label)}</div>`; last = g.key; }
      }
      html += row(it, q);
    }
    return `<div class="list">${html}</div>` + (arr.length > shown.length ? `<button class="btn wide" style="margin-top:10px" data-more>Show more (${arr.length - shown.length})</button>` : "");
  }
  const byNew = (a, b) => b.created - a.created;
  const openTasks = () => live().filter((i) => i.task && !i.task.done).sort((a, b) => (a.task.due || "9999") < (b.task.due || "9999") ? -1 : (a.task.due || "9999") > (b.task.due || "9999") ? 1 : b.created - a.created);

  /* ---------------------------------------------------------------- views */
  function viewHome() {
    const L = live().sort(byNew);
    const pins = L.filter((i) => i.pinned);
    const tasks = openTasks();
    const week = L.filter((i) => i.created > Date.now() - 7 * 864e5).length;
    const catCounts = cats.map((c) => ({ c, n: L.filter((i) => i.cat === c.id).length })).filter((x) => x.n);
    return `
      <section class="capture" id="capture">
        <label class="sr" for="capText">Save something</label>
        <textarea id="capText" rows="2" placeholder="Type, paste a link, or drop a screenshot…" enterkeyhint="done"></textarea>
        <div class="att" id="capAtt"></div>
        <div class="bar">
          <button class="btn ghost" id="capPhoto" aria-label="Add photo or screenshot" title="Photo / screenshot">${ico("camera")}</button>
          <button class="btn ghost" id="capPaste" aria-label="Paste from clipboard" title="Paste">${ico("paste")}</button>
          <span class="hint" id="capHint">#tag to tag · “need to… tomorrow 4pm” makes a task</span>
          <button class="btn go sm" id="capSave">Save</button>
        </div>
      </section>
      <div class="stats">
        <button class="stat" data-go="all"><b>${L.length}</b><span>Saved</span></button>
        <button class="stat" data-go="favs"><b>${L.filter((i) => i.fav || i.pinned).length}</b><span>Starred</span></button>
        <button class="stat" data-go="tasks"><b>${tasks.length}</b><span>Tasks</span></button>
        <button class="stat" data-go="all"><b>${week}</b><span>This week</span></button>
      </div>
      ${pins.length ? `<h2 class="sec">Pinned</h2><div class="pins">${pins.map((it) => { const c = catById(it.cat); return `<button class="pin" data-id="${it.id}" style="--c:${c ? c.color : TYPE_COLOR[it.type]}"><b>${esc(it.title || "Untitled")}</b>${it.body || it.url ? `<span>${esc(it.body || domainOf(it.url))}</span>` : ""}<div class="eyebrow">${ico(it.type)}${c ? esc(c.name) : TYPES[it.type]}</div></button>`; }).join("")}</div>` : ""}
      ${tasks.length ? `<h2 class="sec">Tasks <button class="more" data-go="tasks">See all</button></h2>${listHTML(tasks.slice(0, 4))}` : ""}
      <h2 class="sec">Recently added ${L.length > 8 ? `<button class="more" data-go="all">See all</button>` : ""}</h2>
      ${listHTML(L.slice(0, 8), { empty: `<div class="empty">${ico("inbox")}<b>Your inbox is empty</b>Type anything above and hit Save, or tap + from any screen.</div>` })}
      ${catCounts.length ? `<h2 class="sec">Categories <button class="more" data-go="cats">All</button></h2><div class="chips">${catCounts.map(({ c, n }) => `<button class="chip" data-cat="${c.id}"><i class="dot" style="--c:${c.color}"></i>${esc(c.name)} <span class="n">${n}</span></button>`).join("")}</div>` : ""}`;
  }

  function sortItems(arr, sort) {
    const s = [...arr];
    const catPos = (i) => { const k = cats.findIndex((c) => c.id === i.cat); return k < 0 ? 1e9 : k; };
    if (sort === "old") s.sort((a, b) => a.created - b.created);
    else if (sort === "edited") s.sort((a, b) => b.updated - a.updated);
    else if (sort === "az") s.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    else if (sort === "cat") s.sort((a, b) => catPos(a) - catPos(b) || b.created - a.created);
    else if (sort === "type") s.sort((a, b) => a.type.localeCompare(b.type) || b.created - a.created);
    else if (sort === "due") s.sort((a, b) => ((a.task && a.task.due) || "9999").localeCompare((b.task && b.task.due) || "9999"));
    else s.sort(byNew);
    return s;
  }
  const groupFor = (sort) => sort === "cat" ? (i) => { const c = catById(i.cat); return { key: i.cat || "-", label: c ? c.name : "Uncategorized", dot: c && c.color }; }
    : sort === "type" ? (i) => ({ key: i.type, label: TYPES[i.type] + "s", dot: TYPE_COLOR[i.type] }) : null;

  function viewAll() {
    const st = allState;
    let arr = items.filter((i) => (st.mode === "archive" ? i.archived : !i.archived));
    if (st.type === "tasks") arr = arr.filter((i) => i.task);
    else if (st.type !== "all") arr = arr.filter((i) => i.type === st.type);
    const sort = st.type === "tasks" && st.sort === "new" ? "due" : st.sort;
    arr = sortItems(arr, sort);
    const typeChips = [["all", "All"], ["note", "Notes"], ["idea", "Ideas"], ["link", "Links"], ["image", "Images"], ["tasks", "Tasks"]];
    return `
      <div class="seg" style="margin-bottom:12px"><button data-mode="active" class="${st.mode === "active" ? "on" : ""}">All saved</button><button data-mode="archive" class="${st.mode === "archive" ? "on" : ""}">Archive</button></div>
      <div class="toolbar">
        <div class="chips" style="flex:1;min-width:0">${typeChips.map(([k, l]) => `<button class="chip${st.type === k ? " on" : ""}" data-type="${k}">${l}</button>`).join("")}</div>
        <label class="sr" for="sortSel">Sort</label>
        <select id="sortSel">${[["new", "Newest"], ["old", "Oldest"], ["edited", "Recently edited"], ["az", "A–Z"], ["cat", "Category"], ["type", "Type"], ["due", "Due date"]].map(([k, l]) => `<option value="${k}"${st.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select>
      </div>
      <p class="muted small" style="margin:0 2px 10px">${arr.length} item${arr.length === 1 ? "" : "s"}${st.mode === "archive" ? " in the archive" : ""}</p>
      ${listHTML(arr, { group: groupFor(sort), empty: st.mode === "archive" ? `<div class="empty">${ico("archive")}<b>Archive is empty</b>Archive things you're done with to keep the inbox clean. They stay searchable.</div>` : undefined })}`;
  }

  function viewCats() {
    const L = live();
    const unc = L.filter((i) => !i.cat || !catById(i.cat)).length;
    const tagCounts = {};
    L.forEach((i) => (i.tags || []).forEach((t) => (tagCounts[t] = (tagCounts[t] || 0) + 1)));
    const tags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
    return `
      <div class="row" style="margin-bottom:12px"><span class="muted small spacer">${cats.length} categories</span><button class="btn sm" id="manageCats">Manage</button></div>
      <div class="cats">
        ${cats.map((c) => { const arr = L.filter((i) => i.cat === c.id); return `<button class="catc" data-cat="${c.id}" style="--c:${c.color}"><span class="n">${arr.length}</span><b>${esc(c.name)}</b><span class="s">${arr.length ? "Last " + ago(Math.max(...arr.map((i) => i.created))) : "Empty"}</span></button>`; }).join("")}
        ${unc ? `<button class="catc" data-cat="none" style="--c:#a3a8bd"><span class="n">${unc}</span><b>Uncategorized</b><span class="s">Needs a home</span></button>` : ""}
      </div>
      <h2 class="sec">Tags</h2>
      ${tags.length ? `<div class="row">${tags.map(([t, n]) => `<button class="chip" data-tag="${esc(t)}">#${esc(t)} <span class="n">${n}</span></button>`).join("")}</div>` : `<p class="muted small">Add #tags while typing (“new shoes #nike”) or in an item's details.</p>`}`;
  }

  function viewCat(id) {
    const c = id === "none" ? { id: "none", name: "Uncategorized", color: "#a3a8bd" } : catById(id);
    if (!c) return viewCats();
    const arr = live().filter((i) => (id === "none" ? !i.cat || !catById(i.cat) : i.cat === id)).sort(byNew);
    return `
      <div class="row" style="margin-bottom:14px"><button class="iconbtn" data-go="cats" aria-label="Back to categories">${ico("back")}</button>
        <i class="dot" style="--c:${c.color};width:12px;height:12px"></i><h2 style="font:800 20px var(--display);margin:0" class="spacer">${esc(c.name)}</h2>
        <span class="muted small">${arr.length}</span></div>
      ${listHTML(arr, { empty: `<div class="empty">${ico("cats")}<b>Nothing in ${esc(c.name)} yet</b>Items you save land here automatically when they match, or pick it in an item's details.</div>` })}`;
  }

  function viewTag(tag) {
    const arr = live().filter((i) => (i.tags || []).includes(tag)).sort(byNew);
    return `<div class="row" style="margin-bottom:14px"><button class="iconbtn" data-go="cats" aria-label="Back">${ico("back")}</button><h2 style="font:800 20px var(--display);margin:0" class="spacer">#${esc(tag)}</h2><span class="muted small">${arr.length}</span></div>${listHTML(arr)}`;
  }

  function viewFavs() {
    const L = live().sort(byNew);
    const pins = L.filter((i) => i.pinned), favs = L.filter((i) => i.fav);
    return `
      <h2 class="sec" style="margin-top:4px">Pinned</h2>
      ${listHTML(pins, { empty: `<div class="empty">${icoFill("pin")}<b>No pins</b>Pin what you need often and it stays on top of Home.</div>` })}
      <h2 class="sec">Favorites</h2>
      ${listHTML(favs, { empty: `<div class="empty">${icoFill("star")}<b>No favorites yet</b>Tap the star on anything worth keeping close.</div>` })}`;
  }

  function viewTasks() {
    const t = openTasks();
    const done = live().filter((i) => i.task && i.task.done).sort((a, b) => (b.task.doneAt || b.updated) - (a.task.doneAt || a.updated));
    return `
      <div class="row" style="margin-bottom:6px"><button class="iconbtn" data-go="home" aria-label="Back">${ico("back")}</button><h2 style="font:800 20px var(--display);margin:0" class="spacer">Tasks</h2></div>
      <p class="muted small" style="margin:0 2px 12px">Anything you saved that you need to do. Use “Add to Calendar” in a task to get a phone alert at its time.</p>
      ${listHTML(t, { empty: `<div class="empty">${ico("task")}<b>No open tasks</b>Start a note with “need to…” or open any item and tap Task.</div>` })}
      ${done.length ? `<h2 class="sec">Done</h2>${listHTML(done.slice(0, 30))}` : ""}`;
  }

  function searchResults() {
    const s = searchState;
    const terms = s.q.toLowerCase().split(/\s+/).filter(Boolean);
    let arr = items.filter((i) => s.archived || !i.archived);
    if (s.type !== "all") arr = arr.filter((i) => (s.type === "tasks" ? i.task : i.type === s.type));
    if (s.cat) arr = arr.filter((i) => (s.cat === "none" ? !i.cat : i.cat === s.cat));
    if (terms.length) {
      arr = arr.map((i) => {
        const c = catById(i.cat);
        const hay = { title: (i.title || "").toLowerCase(), rest: [i.body, i.note, i.url, i.summary, (i.tags || []).map((t) => "#" + t).join(" "), c && c.name, i.link && i.link.title, i.link && i.link.author].filter(Boolean).join(" ").toLowerCase() };
        let score = 0;
        for (const t of terms) { if (hay.title.includes(t)) score += 3; else if (hay.rest.includes(t)) score += 1; else return null; }
        return { i, score };
      }).filter(Boolean).sort((a, b) => b.score - a.score || b.i.created - a.i.created).map((x) => x.i);
    } else if (s.type === "all" && !s.cat) return null;
    else arr.sort(byNew);
    return arr;
  }
  function viewSearch() {
    const s = searchState;
    return `
      <div class="search"><label class="sr" for="q">Search</label>${ico("search")}<input id="q" type="search" placeholder="Search everything" value="${esc(s.q)}" autocomplete="off" enterkeyhint="search"></div>
      <div class="toolbar" style="margin-top:10px">
        <div class="chips" style="flex:1;min-width:0">${[["all", "Any type"], ["note", "Notes"], ["idea", "Ideas"], ["link", "Links"], ["image", "Images"], ["tasks", "Tasks"]].map(([k, l]) => `<button class="chip${s.type === k ? " on" : ""}" data-stype="${k}">${l}</button>`).join("")}</div>
      </div>
      <div class="row" style="margin-bottom:12px">
        <label class="sr" for="scat">Category</label>
        <select id="scat" style="width:auto;flex:1"><option value="">Any category</option>${cats.map((c) => `<option value="${c.id}"${s.cat === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}<option value="none"${s.cat === "none" ? " selected" : ""}>Uncategorized</option></select>
        <label class="row small muted" style="gap:8px">Archive <span class="switch"><input type="checkbox" id="sarch"${s.archived ? " checked" : ""}><span></span></span></label>
      </div>
      <div id="sres"></div>`;
  }
  function renderSearchResults() {
    const box = $("#sres");
    if (!box) return;
    const r = searchResults();
    box.innerHTML = r == null
      ? `<div class="empty">${ico("search")}<b>Search titles, text, notes, links, tags and summaries</b>Every word has to match. Try a #tag or a site name.</div>`
      : `<p class="muted small" style="margin:0 2px 10px">${r.length} result${r.length === 1 ? "" : "s"}</p>` + listHTML(r, { q: searchState.q, empty: `<div class="empty">${ico("search")}<b>No matches</b>Try fewer words${searchState.archived ? "" : ", or include the archive"}.</div>` });
    hydrateThumbs(box);
  }

  async function viewSettings() {
    let est = null; try { est = await navigator.storage.estimate(); } catch (e) {}
    let persisted = false; try { persisted = await navigator.storage.persisted(); } catch (e) {}
    const th = Suite.theme.get();
    const ai = Suite.ai.enabled();
    const book = `javascript:void(open('${location.origin}${location.pathname}?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)))`;
    return `
      <div class="row" style="margin-bottom:12px"><button class="iconbtn" data-go="home" aria-label="Back">${ico("back")}</button><h2 style="font:800 20px var(--display);margin:0">Settings</h2></div>
      <div class="stack">
        <div class="card">
          <div class="eyebrow" style="margin-bottom:10px">Appearance</div>
          <div class="seg" id="themeSeg">${[["auto", "Auto"], ["dark", "Dark"], ["light", "Light"]].map(([k, l]) => `<button data-theme-set="${k}" class="${th === k ? "on" : ""}">${l}</button>`).join("")}</div>
        </div>
        <div class="card">
          <div class="eyebrow" style="margin-bottom:4px">Sorting</div>
          <div class="setrow"><div class="l"><b>Auto-sort new items</b><span>On-device rules: #tags, link sites (YouTube → Watch, Amazon → Shopping) and keywords. Free, instant, works offline.</span></div><span class="switch"><input type="checkbox" id="setAuto"${settings.autoSort ? " checked" : ""}><span></span></span></div>
          <div class="setrow"><div class="l"><b>Categories</b><span>${cats.length} categories. Rename, recolor, add or remove.</span></div><button class="btn sm" id="manageCats">Manage</button></div>
        </div>
        <div class="card">
          <div class="eyebrow" style="margin-bottom:4px">AI (Claude)</div>
          <p class="small muted" style="margin:6px 0 10px">${ai ? "Connected. New items get a category, tags, a cleaner title, and task detection from Claude; any item can be summarized (screenshots are read too)." : "Off. Add an Anthropic API key to turn on AI sorting and summaries. Without a key everything else works and nothing is sent anywhere."}
            The key is stored only on this device and sent only to Anthropic. Usage is billed to your Anthropic account (a sort is roughly a fraction of a cent). Get a key at console.anthropic.com → API Keys.</p>
          ${ai ? `<div class="setrow"><div class="l"><b>AI auto-sort</b><span>Run Claude on every new item (rules still run first).</span></div><span class="switch"><input type="checkbox" id="setAI"${settings.aiAuto ? " checked" : ""}><span></span></span></div>
            <div class="row" style="margin-top:6px"><button class="btn sm" id="aiTest">Test connection</button><button class="btn sm danger" id="aiRemove">Remove key</button></div>`
          : `<div class="row"><input type="password" id="aiKey" placeholder="sk-ant-…" autocomplete="off" style="flex:1"><button class="btn go" id="aiSave">Save</button></div>`}
        </div>
        <div class="card">
          <div class="eyebrow" style="margin-bottom:4px">Saving from other apps</div>
          <div class="setrow"><div class="l"><b>Fastest way on iPhone</b><span>Copy a link or text anywhere, open INBOX, tap the paste button. Screenshots: camera button → Photo Library.</span></div></div>
          <div class="setrow"><div class="l"><b>iPhone share sheet</b><span>iOS doesn't let web apps appear in the share sheet. A Shortcut can: Shortcuts app → new shortcut → “Show in Share Sheet” on → add “Open URLs” with <span class="mono">${esc(location.origin + location.pathname)}?text=</span> followed by the Shortcut Input. It opens INBOX with the item ready to save (in Safari, see note below).</span></div></div>
          <div class="setrow"><div class="l"><b>On a computer</b><span>Drag this to your bookmarks bar, then click it on any page to save that page:</span></div><a class="btn sm" href="${esc(book)}" onclick="event.preventDefault();Suite.toast('Drag it to your bookmarks bar')">+ INBOX</a></div>
        </div>
        <div class="card">
          <div class="eyebrow" style="margin-bottom:4px">Your data</div>
          <div class="setrow"><div class="l"><b>${items.length} items</b><span>${est ? `About ${(est.usage / 1048576).toFixed(1)} MB used on this device. ` : ""}${persisted ? "Protected from automatic cleanup." : "Not yet protected from automatic cleanup."} Everything is stored on this device only.</span></div>${persisted ? "" : `<button class="btn sm" id="persist">Protect</button>`}</div>
          <div class="setrow"><div class="l"><b>Backup</b><span>Download everything (photos included) as one file, or restore from one. Restoring merges; it never deletes.</span></div><div class="row"><button class="btn sm" id="exportBtn">Export</button><button class="btn sm" id="importBtn">Import</button></div></div>
          <p class="small muted" style="margin:10px 0 0">Note: on iPhone, each home-screen icon and Safari keep separate storage. Open INBOX from BASE on your home screen and keep using that; Safari's 7-day cleanup doesn't apply there.</p>
        </div>
        ${Suite.isStandalone() ? "" : `<div class="card"><div class="eyebrow" style="margin-bottom:6px">Install</div><p class="small" style="margin:0">Install <a href="../base/">BASE</a>, not INBOX on its own: open BASE in Safari → Share → <b>Add to Home Screen</b>, then open INBOX from BASE. All five apps live inside BASE and share one storage, so they can pass things to each other.</p></div>`}
        <div class="card">
          <div class="eyebrow" style="margin-bottom:10px">The suite</div>
          <div class="applist">${Suite.apps.map((a) => `<div class="appl"><i style="--c:${a.color}"></i><div class="spacer"><b>${a.name}</b><br><span>${esc(a.tag)}</span></div><span class="small ${a.built ? "" : "muted"}">${a.id === "inbox" ? "This app" : a.built ? `<a href="${a.url}">Open</a>` : "Coming next"}</span></div>`).join("")}</div>
          <p class="small muted" style="margin:10px 0 0">Opened from <a href="../base/">BASE</a>, the five apps share one storage, so once TALK, DON'T FORGET, LINK VAULT and QUEUE exist, items can move between them without copies.</p>
        </div>
        <div class="card"><div class="setrow"><div class="l"><b>Erase INBOX</b><span>Deletes every item and photo on this device. Export first if you might want them.</span></div><button class="btn sm danger" id="erase">Erase</button></div></div>
      </div>`;
  }

  /* ---------------------------------------------------------------- tabs + routing */
  const TABS = [["home", "Home", "home"], ["all", "All", "all"], ["cats", "Categories", "cats"], ["favs", "Favorites", "star"], ["search", "Search", "search"]];
  function renderTabs() {
    const cur = route.view === "cat" || route.view === "tag" ? "cats" : route.view === "tasks" ? "home" : route.view;
    $("#tabs").innerHTML = TABS.map(([k, l, i]) => `<a class="tab${cur === k ? " on" : ""}" href="#${k}" ${cur === k ? 'aria-current="page"' : ""}>${ico(i)}<span>${l}</span></a>`).join("");
    $("#settingsBtn").classList.toggle("on", route.view === "settings");
  }
  function parseRoute() {
    const h = decodeURIComponent(location.hash.slice(1) || "home");
    const [view, arg] = h.split("/");
    route = { view: ["home", "all", "cats", "cat", "tag", "favs", "search", "settings", "tasks"].includes(view) ? view : "home", arg };
  }
  const SUBTITLE = { home: "Save everything", all: "Everything you've saved", cats: "Categories & tags", cat: "Category", tag: "Tag", favs: "Pinned & favorites", search: "Find anything", settings: "Settings", tasks: "Tasks" };

  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    renderTabs();
    $("#subtitle").textContent = SUBTITLE[route.view];
    const main = $("#main");
    // keep what's typed in the capture box across re-renders
    const draft = $("#capText") ? $("#capText").value : null;
    const capFocus = document.activeElement && document.activeElement.id === "capText";
    let html;
    switch (route.view) {
      case "all": html = viewAll(); break;
      case "cats": html = viewCats(); break;
      case "cat": html = viewCat(route.arg); break;
      case "tag": html = viewTag(route.arg); break;
      case "favs": html = viewFavs(); break;
      case "tasks": html = viewTasks(); break;
      case "search": html = viewSearch(); break;
      case "settings": html = await viewSettings(); break;
      default: html = viewHome();
    }
    if (seq !== renderSeq) return;
    if (route.view === "search" && $("#q")) { renderSearchResults(); return; } // don't rebuild the box being typed in
    main.innerHTML = html;
    if (route.view === "home") {
      if (draft) $("#capText").value = draft;
      renderAttachments();
      if (capFocus) $("#capText").focus();
      autoGrow($("#capText"));
    }
    if (route.view === "search") { renderSearchResults(); }
    hydrateThumbs(main);
  }

  function go(view, arg) { const h = "#" + view + (arg ? "/" + encodeURIComponent(arg) : ""); if (location.hash === h) render(); else location.hash = h; }
  window.addEventListener("hashchange", () => { parseRoute(); listLimit = 60; render(); window.scrollTo(0, 0); });

  /* ---------------------------------------------------------------- capture box */
  function autoGrow(t) { if (!t) return; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, innerHeight * 0.4) + "px"; }
  function renderAttachments() {
    const box = $("#capAtt");
    if (!box) return;
    box.innerHTML = pendingImages.map((p, i) => `<div class="th"><img src="${p.url}" alt="Attached image ${i + 1}"><button data-unatt="${i}" aria-label="Remove image">×</button></div>`).join("");
    box.style.display = pendingImages.length ? "" : "none";
  }
  function attach(files) {
    const imgs = [...files].filter((f) => f && /^image\//.test(f.type));
    if (!imgs.length) return false;
    imgs.forEach((f) => pendingImages.push({ file: f, url: URL.createObjectURL(f) }));
    if (route.view !== "home") go("home"); else renderAttachments();
    toast(imgs.length === 1 ? "Image attached. Add a note or just Save." : imgs.length + " images attached");
    return true;
  }
  async function saveCapture() {
    const t = $("#capText");
    const text = t ? t.value : "";
    if (!text.trim() && !pendingImages.length) { t && t.focus(); toast("Type something first"); return; }
    const imgs = pendingImages.map((p) => p.file);
    const btn = $("#capSave"); if (btn) btn.disabled = true;
    try {
      const made = await createItem({ text, images: imgs });
      pendingImages.forEach((p) => URL.revokeObjectURL(p.url)); pendingImages = [];
      if ($("#capText")) { $("#capText").value = ""; autoGrow($("#capText")); }
      renderAttachments();
      const it = made[0], c = catById(it.cat);
      toast(`Saved${c ? " to " + c.name : ""}${it.task ? " as a task" : ""}`, { label: "Edit", run: () => openItem(it.id) });
    } catch (e) { toast("Couldn't save: " + e.message); }
    finally { if ($("#capSave")) $("#capSave").disabled = false; }
  }
  async function pasteInto(textarea) {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const list = await navigator.clipboard.read();
        const imgs = [];
        for (const ci of list) {
          const it = ci.types.find((x) => x.startsWith("image/"));
          if (it) { const b = await ci.getType(it); imgs.push(new File([b], "pasted." + it.split("/")[1], { type: it })); }
          else if (ci.types.includes("text/plain")) { const txt = await (await ci.getType("text/plain")).text(); insertText(textarea, txt); }
        }
        if (imgs.length) attach(imgs);
        return;
      }
      insertText(textarea, await navigator.clipboard.readText());
    } catch (e) {
      try { insertText(textarea, await navigator.clipboard.readText()); }
      catch (e2) { textarea.focus(); toast("Clipboard blocked. Long-press the box and tap Paste."); }
    }
  }
  function insertText(t, txt) {
    if (!txt) return;
    const v = t.value;
    t.value = v ? v.replace(/\s*$/, "") + (v.trim() ? "\n" : "") + txt : txt;
    autoGrow(t); t.focus();
  }

  /* ---------------------------------------------------------------- quick add sheet */
  function quickAdd(pre = {}) {
    let imgs = [];
    const s = Suite.sheet(`
      <div class="sh"><h3>Quick add</h3><button class="btn ghost sm" data-close>Cancel</button></div>
      <textarea id="qaText" rows="4" placeholder="Note, idea, link… (#tags work here too)">${esc(pre.text || "")}</textarea>
      <div class="att" id="qaAtt" style="padding:8px 0 0"></div>
      <div class="row" style="margin:10px 0">
        <button class="btn sm" id="qaPaste">${ico("paste")}Paste</button>
        <button class="btn sm" id="qaPhoto">${ico("camera")}Photo</button>
        <span class="spacer"></span>
        <button class="act" id="qaPin" style="flex-direction:row;padding:7px 10px" aria-pressed="false">${ico("pin")}Pin</button>
        <button class="act fav" id="qaFav" style="flex-direction:row;padding:7px 10px" aria-pressed="false">${ico("star")}Fav</button>
      </div>
      <details class="more"><summary>More options ▾</summary>
        <div class="kv" style="margin-top:8px">
          <label class="field"><span>Category</span><select id="qaCat"><option value="">Auto</option>${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
          <label class="field"><span>Type</span><select id="qaType"><option value="">Auto</option>${Object.entries(TYPES).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
          <label class="row" style="justify-content:space-between"><span class="small" style="font-weight:600">Make it a task</span><span class="switch"><input type="checkbox" id="qaTask"><span></span></span></label>
          <label class="field hidden" id="qaDueWrap"><span>Due (optional)</span><input type="datetime-local" id="qaDue"></label>
        </div>
      </details>
      <button class="btn go wide" id="qaSave" style="margin-top:14px">Save</button>`);
    const el = s.el, t = $("#qaText", el);
    setTimeout(() => t.focus(), 50);
    t.focus();
    const drawAtt = () => { $("#qaAtt", el).innerHTML = imgs.map((p, i) => `<div class="th"><img src="${p.url}" alt=""><button data-i="${i}" aria-label="Remove image">×</button></div>`).join(""); $$("#qaAtt button", el).forEach((b) => (b.onclick = () => { URL.revokeObjectURL(imgs[+b.dataset.i].url); imgs.splice(+b.dataset.i, 1); drawAtt(); })); };
    const addImgs = (fs) => { [...fs].filter((f) => /^image\//.test(f.type)).forEach((f) => imgs.push({ file: f, url: URL.createObjectURL(f) })); drawAtt(); };
    if (pre.files) addImgs(pre.files);
    const toggle = (b) => { const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", on); b.classList.toggle("on", on); };
    $("#qaPin", el).onclick = (e) => toggle(e.currentTarget);
    $("#qaFav", el).onclick = (e) => toggle(e.currentTarget);
    $("#qaTask", el).onchange = (e) => $("#qaDueWrap", el).classList.toggle("hidden", !e.target.checked);
    $("#qaPaste", el).onclick = async () => {
      try {
        if (navigator.clipboard.read) {
          for (const ci of await navigator.clipboard.read()) {
            const it = ci.types.find((x) => x.startsWith("image/"));
            if (it) addImgs([new File([await ci.getType(it)], "pasted", { type: it })]);
            else if (ci.types.includes("text/plain")) insertText(t, await (await ci.getType("text/plain")).text());
          }
        } else insertText(t, await navigator.clipboard.readText());
      } catch (e) { t.focus(); toast("Clipboard blocked. Long-press the box and tap Paste."); }
    };
    $("#qaPhoto", el).onclick = () => { filePickTarget = addImgs; $("#filePick").click(); };
    t.addEventListener("paste", (e) => { const fs = [...(e.clipboardData && e.clipboardData.files || [])]; if (fs.length) { e.preventDefault(); addImgs(fs); } });
    const doSave = async () => {
      if (!t.value.trim() && !imgs.length) { toast("Type something first"); t.focus(); return; }
      $("#qaSave", el).disabled = true;
      try {
        const task = $("#qaTask", el).checked ? { due: $("#qaDue", el).value } : null;
        const made = await createItem({
          text: t.value, images: imgs.map((p) => p.file), cat: $("#qaCat", el).value, type: $("#qaType", el).value,
          pinned: $("#qaPin", el).classList.contains("on"), fav: $("#qaFav", el).classList.contains("on"), task, source: pre.source || "manual",
        });
        imgs.forEach((p) => URL.revokeObjectURL(p.url));
        s.close();
        const c = catById(made[0].cat);
        toast(`Saved${c ? " to " + c.name : ""}`, { label: "Edit", run: () => openItem(made[0].id) });
      } catch (e) { $("#qaSave", el).disabled = false; toast("Couldn't save: " + e.message); }
    };
    $("#qaSave", el).onclick = doSave;
    t.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doSave(); } });
  }

  /* ---------------------------------------------------------------- item sheet */
  let openSheet = null; // {id, s}
  function refreshOpenSheet(id) { if (openSheet && openSheet.id === id) { const y = openSheet.s.el.scrollTop; openSheet.s.close(); openItem(id, y); } }

  async function openItem(id, scrollY) {
    const it0 = items.find((x) => x.id === id);
    if (!it0) return;
    const it = it0;
    const c = catById(it.cat);
    const di = dueInfo(it.task);
    const s = Suite.sheet(`
      <div class="sh">
        <div class="typepick" role="radiogroup" aria-label="Type">${Object.entries(TYPES).map(([k, l]) => `<button class="chip${it.type === k ? " on" : ""}" data-settype="${k}" role="radio" aria-checked="${it.type === k}">${ico(k)}${l}</button>`).join("")}</div>
        <button class="btn ghost sm" data-close>Done</button>
      </div>
      ${it.imageId ? `<div class="preview"><img id="fullImg" alt="${esc(it.title)}"></div>` : ""}
      ${it.url ? `<a class="linkcard" href="${esc(it.url)}" target="_blank" rel="noopener">${it.link && it.link.thumb ? `<img src="${esc(it.link.thumb)}" alt="">` : `<span class="fav">${esc((domainOf(it.url)[0] || "?").toUpperCase())}</span>`}<div style="min-width:0"><b>${esc((it.link && it.link.title) || domainOf(it.url) || it.url)}</b><span>${esc(it.link && it.link.author ? it.link.author + " · " + it.link.provider : it.url)}</span></div></a>` : ""}
      ${it.summary ? `<div class="summary"><div class="eyebrow"><span>AI summary</span><button class="btn ghost sm" id="rmSum" style="padding:0;font-size:11px">Remove</button></div><div style="white-space:pre-wrap">${esc(it.summary)}</div></div>` : ""}
      <div class="kv">
        <label class="field"><span>Title</span><input type="text" id="fTitle" value="${esc(it.title)}" placeholder="Untitled"></label>
        <label class="field"><span>${it.type === "link" ? "Description" : "Content"}</span><textarea id="fBody" rows="3" placeholder="${it.type === "link" ? "What is this link?" : "Details"}">${esc(it.body)}</textarea></label>
        ${it.type === "link" || it.url ? `<label class="field"><span>Link</span><input type="url" id="fUrl" value="${esc(it.url)}" placeholder="https://"></label>` : ""}
        <label class="field"><span>Personal note</span><textarea id="fNote" rows="2" placeholder="Why you saved it, what to do with it">${esc(it.note)}</textarea></label>
        <div class="row" style="gap:10px">
          <label class="field" style="flex:1"><span>Category${it.catBy && it.catBy !== "you" && c ? ` · <i class="muted">sorted by ${it.catBy === "ai" ? "AI" : "rules"}</i>` : ""}</span>
            <select id="fCat"><option value="">None</option>${cats.map((x) => `<option value="${x.id}"${x.id === it.cat ? " selected" : ""}>${esc(x.name)}</option>`).join("")}<option value="__new">+ New category…</option></select></label>
        </div>
        <div class="field"><span>Tags</span><div class="tagsin" id="fTags">${(it.tags || []).map((t, i) => `<span class="tg">#${esc(t)}<button data-rmtag="${i}" aria-label="Remove tag ${esc(t)}">×</button></span>`).join("")}<input type="text" id="fTagIn" placeholder="add tag" autocapitalize="off" enterkeyhint="done"></div></div>
      </div>
      <div class="actions">
        <button class="act${it.pinned ? " on" : ""}" id="aPin">${it.pinned ? icoFill("pin") : ico("pin")}${it.pinned ? "Pinned" : "Pin"}</button>
        <button class="act fav${it.fav ? " on" : ""}" id="aFav">${it.fav ? icoFill("star") : ico("star")}${it.fav ? "Favorite" : "Favorite"}</button>
        <button class="act${it.task ? " on" : ""}" id="aTask">${ico("task")}${it.task ? "Task" : "Make task"}</button>
        <button class="act${it.archived ? " on" : ""}" id="aArch">${ico("archive")}${it.archived ? "Archived" : "Archive"}</button>
        <button class="act" id="aCopy">${ico("copy")}Copy</button>
        ${navigator.share ? `<button class="act" id="aShare">${ico("share")}Share</button>` : ""}
        ${Suite.ai.enabled() ? `<button class="act" id="aSum">${ico("sparkle")}${it.summary ? "Re-summarize" : "Summarize"}</button><button class="act" id="aSort">${ico("sparkle")}AI sort</button>` : ""}
      </div>
      ${it.task ? `<div class="taskbox">
        <div class="row" style="justify-content:space-between"><b style="font-size:14px">Task</b><label class="row small" style="gap:8px">Done <span class="switch"><input type="checkbox" id="tDone"${it.task.done ? " checked" : ""}><span></span></span></label></div>
        <label class="field"><span>Due${di ? ` · <span class="${di.cls}">${esc(di.label)}</span>` : ""}</span><input type="datetime-local" id="tDue" value="${esc(it.task.due || "")}"></label>
        <div class="row"><button class="btn sm" id="tCal"${it.task.due ? "" : " disabled"}>${ico("cal")}Add to Calendar</button><button class="btn sm ghost" id="tRemove">Remove task</button></div>
        <p class="small muted" style="margin:0">INBOX can't send notifications on its own. “Add to Calendar” gives your phone a calendar event with an alert at the due time.${Suite.apps.find((a) => a.id === "reminders").built ? "" : " DON'T FORGET will take over reminders when it's built."}</p>
      </div>` : ""}
      <div class="row" style="margin-top:16px">
        <span class="small muted spacer">Saved ${new Date(it.created).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}${it.updated - it.created > 60000 ? " · edited " + ago(it.updated) : ""}${it.source && it.source !== "manual" ? " · via " + esc(it.source) : ""}</span>
        <button class="btn sm danger" id="aDel">${ico("trash")}Delete</button>
      </div>`, { onClose: () => { flush(); if (openSheet && openSheet.s === s) openSheet = null; } });
    openSheet = { id, s };
    const el = s.el;
    if (scrollY) el.scrollTop = scrollY;
    if (it.imageId) Suite.files.blob(it.imageId).then((b) => { if (b && $("#fullImg", el)) { const u = URL.createObjectURL(b); $("#fullImg", el).src = u; $("#fullImg", el).onload = () => URL.revokeObjectURL(u); } });

    /* text fields save as you type */
    let dirty = false, timer = null;
    const flush = async () => {
      clearTimeout(timer);
      if (!dirty) return;
      dirty = false;
      const cur = items.find((x) => x.id === id);
      if (!cur) return;
      const nt = $("#fTitle", el).value.trim();
      if (nt !== cur.title) { cur.title = nt; cur.titleAuto = false; }
      cur.body = $("#fBody", el).value;
      cur.note = $("#fNote", el).value;
      if ($("#fUrl", el)) cur.url = $("#fUrl", el).value.trim();
      await save(cur);
    };
    ["#fTitle", "#fBody", "#fNote", "#fUrl"].forEach((sel) => { const f = $(sel, el); if (f) f.addEventListener("input", () => { dirty = true; clearTimeout(timer); timer = setTimeout(flush, 600); }); });
    const update = async (fn, reopen = true) => { await flush(); const cur = items.find((x) => x.id === id); fn(cur); await save(cur); if (reopen) refreshOpenSheet(id); };

    $$("[data-settype]", el).forEach((b) => (b.onclick = () => update((x) => { x.type = b.dataset.settype; })));
    $("#fCat", el).onchange = async (e) => {
      if (e.target.value === "__new") {
        const name = prompt("New category name");
        if (!name || !name.trim()) { e.target.value = it.cat || ""; return; }
        const nc = { id: Suite.uid("c"), name: name.trim().slice(0, 30), color: PALETTE[cats.length % PALETTE.length] };
        cats.push(nc); await saveCats();
        return update((x) => { x.cat = nc.id; x.catBy = "you"; });
      }
      update((x) => { x.cat = e.target.value || null; x.catBy = "you"; }, false);
    };
    const tagIn = $("#fTagIn", el);
    const addTag = () => { const v = tagIn.value.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-").slice(0, 32); if (v) update((x) => { x.tags = [...new Set([...(x.tags || []), v])]; }).then(() => { const n = openSheet && $("#fTagIn", openSheet.s.el); n && n.focus(); }); };
    tagIn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } });
    tagIn.addEventListener("blur", () => { if (tagIn.value.trim()) addTag(); });
    $$("[data-rmtag]", el).forEach((b) => (b.onclick = () => update((x) => { x.tags.splice(+b.dataset.rmtag, 1); })));
    $("#aPin", el).onclick = () => update((x) => { x.pinned = !x.pinned; });
    $("#aFav", el).onclick = () => update((x) => { x.fav = !x.fav; });
    $("#aTask", el).onclick = () => update((x) => { if (!x.task) x.task = { due: parseDue([x.title, x.body].join(" ")), done: false }; });
    $("#aArch", el).onclick = async () => { const was = it.archived; await update((x) => { x.archived = !x.archived; }, false); s.close(); toast(was ? "Moved back to inbox" : "Archived", { label: "Undo", run: () => { const x = items.find((y) => y.id === id); x.archived = was; save(x); } }); };
    $("#aCopy", el).onclick = async () => {
      const cur = items.find((x) => x.id === id);
      const txt = [cur.title, cur.body, cur.url, cur.note && "Note: " + cur.note].filter(Boolean).join("\n");
      try { await navigator.clipboard.writeText(txt); toast("Copied"); } catch (e) { toast("Couldn't copy"); }
    };
    if ($("#aShare", el)) $("#aShare", el).onclick = async () => {
      const cur = items.find((x) => x.id === id);
      const data = { title: cur.title, text: [cur.body, cur.note].filter(Boolean).join("\n\n") || cur.title };
      if (cur.url) data.url = cur.url;
      if (cur.imageId) { const b = await Suite.files.blob(cur.imageId); const f = b && new File([b], (cur.title || "image").replace(/[^\w -]/g, "") + ".jpg", { type: b.type }); if (f && navigator.canShare && navigator.canShare({ files: [f] })) data.files = [f]; }
      try { await navigator.share(data); } catch (e) {}
    };
    if ($("#aSum", el)) $("#aSum", el).onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.lastChild.textContent = "Working…";
      try { await flush(); await aiSummarize(id); refreshOpenSheet(id); } catch (err) { toast(err.message); b.disabled = false; b.lastChild.textContent = "Summarize"; }
    };
    if ($("#aSort", el)) $("#aSort", el).onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.lastChild.textContent = "Working…";
      await flush();
      const cur = items.find((x) => x.id === id);
      if (cur.catBy === "you") cur.catBy = "rules"; // an explicit AI sort may change a category you picked
      await aiSort(id, false);
      if (openSheet && openSheet.id === id && b.isConnected) { b.disabled = false; b.lastChild.textContent = "AI sort"; }
    };
    if ($("#rmSum", el)) $("#rmSum", el).onclick = () => update((x) => { x.summary = ""; });
    if (it.task) {
      $("#tDone", el).onchange = (e) => update((x) => { x.task.done = e.target.checked; x.task.doneAt = e.target.checked ? Date.now() : null; });
      $("#tDue", el).onchange = (e) => update((x) => { x.task.due = e.target.value; });
      $("#tRemove", el).onclick = () => update((x) => { x.task = null; });
      $("#tCal", el).onclick = () => {
        const cur = items.find((x) => x.id === id);
        if (!cur.task.due) return;
        Suite.download(Suite.ics({ id: cur.id, title: cur.title || "INBOX task", notes: [cur.body, cur.url, cur.note].filter(Boolean).join("\n"), start: new Date(cur.task.due), app: "INBOX" }), "inbox-task.ics");
        toast("Calendar event downloaded. Tap Add on your phone.");
      };
    }
    $("#aDel", el).onclick = async () => {
      const cur = items.find((x) => x.id === id);
      s.close();
      await removeItem(cur);
    };
  }

  async function removeItem(it) {
    await Suite.store.del("inbox", it.id);
    items = items.filter((x) => x.id !== it.id);
    render();
    let undone = false;
    toast("Deleted", { label: "Undo", run: async () => { undone = true; await save(it); toast("Restored"); } });
    setTimeout(() => { if (!undone) { Suite.files.del(it.imageId); Suite.files.del(it.thumbId); } }, 6500);
  }

  /* ---------------------------------------------------------------- categories sheet */
  function manageCats() {
    const s = Suite.sheet(`<div class="sh"><h3>Categories</h3><button class="btn ghost sm" data-close>Done</button></div><div id="catList" class="stack"></div>
      <div class="row" style="margin-top:14px"><input type="text" id="newCat" placeholder="New category" style="flex:1"><button class="btn go" id="addCat">Add</button></div>
      <p class="small muted">Deleting a category keeps its items; they become uncategorized. Custom categories auto-sort items that mention their name.</p>`);
    const el = s.el;
    const draw = () => {
      $("#catList", el).innerHTML = cats.map((c, i) => `
        <div class="card" style="padding:12px">
          <div class="row"><i class="dot" style="--c:${c.color};width:12px;height:12px"></i><input type="text" value="${esc(c.name)}" data-rename="${i}" aria-label="Category name" style="flex:1;padding:8px 10px">
            <button class="iconbtn" data-up="${i}" aria-label="Move up"${i ? "" : " disabled"} style="width:34px;height:34px">↑</button>
            <button class="iconbtn" data-delcat="${i}" aria-label="Delete ${esc(c.name)}" style="width:34px;height:34px;color:var(--bad)">${ico("trash")}</button></div>
          <div class="swatches" style="margin-top:10px">${PALETTE.map((p) => `<button class="sw${p === c.color ? " on" : ""}" style="--c:${p}" data-color="${i}|${p}" aria-label="Color ${p}"></button>`).join("")}</div>
        </div>`).join("");
      $$("[data-rename]", el).forEach((inp) => inp.addEventListener("change", async () => { const v = inp.value.trim(); if (v) { cats[+inp.dataset.rename].name = v.slice(0, 30); await saveCats(); render(); } }));
      $$("[data-color]", el).forEach((b) => (b.onclick = async () => { const [i, col] = b.dataset.color.split("|"); cats[+i].color = col; await saveCats(); draw(); render(); }));
      $$("[data-up]", el).forEach((b) => (b.onclick = async () => { const i = +b.dataset.up; [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]]; await saveCats(); draw(); render(); }));
      $$("[data-delcat]", el).forEach((b) => (b.onclick = async () => {
        const c = cats[+b.dataset.delcat];
        const n = items.filter((x) => x.cat === c.id).length;
        if (!confirm(`Delete “${c.name}”?${n ? ` Its ${n} item${n === 1 ? "" : "s"} will be kept as uncategorized.` : ""}`)) return;
        cats = cats.filter((x) => x.id !== c.id); await saveCats();
        const touched = items.filter((x) => x.cat === c.id);
        touched.forEach((x) => { x.cat = null; x.catBy = null; x.updated = Date.now(); });
        if (touched.length) await Suite.store.putMany("inbox", touched);
        draw(); render();
      }));
    };
    draw();
    const add = async () => { const v = $("#newCat", el).value.trim(); if (!v) return; cats.push({ id: Suite.uid("c"), name: v.slice(0, 30), color: PALETTE[cats.length % PALETTE.length] }); await saveCats(); $("#newCat", el).value = ""; draw(); render(); };
    $("#addCat", el).onclick = add;
    $("#newCat", el).addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  }

  /* ---------------------------------------------------------------- events */
  let filePickTarget = null;
  $("#filePick").addEventListener("change", (e) => { const fs = [...e.target.files]; e.target.value = ""; if (filePickTarget) { filePickTarget(fs); filePickTarget = null; } else attach(fs); });
  $("#fab").onclick = () => quickAdd();
  $("#settingsBtn").onclick = () => go(route.view === "settings" ? "home" : "settings");

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button, [data-id], a");
    if (!t || !$("#main").contains(t) && !t.closest(".tabs")) return;
    const d = t.dataset;
    if (d.check) { e.stopPropagation(); const it = items.find((x) => x.id === d.check); it.task.done = !it.task.done; it.task.doneAt = it.task.done ? Date.now() : null; await save(it); if (it.task.done) toast("Done ✓", { label: "Undo", run: async () => { it.task.done = false; await save(it); } }); return; }
    if (d.pin) { e.stopPropagation(); const it = items.find((x) => x.id === d.pin); it.pinned = !it.pinned; await save(it); toast(it.pinned ? "Pinned" : "Unpinned"); return; }
    if (d.fav) { e.stopPropagation(); const it = items.find((x) => x.id === d.fav); it.fav = !it.fav; await save(it); toast(it.fav ? "Added to favorites" : "Removed from favorites"); return; }
    if (d.unatt != null) { URL.revokeObjectURL(pendingImages[+d.unatt].url); pendingImages.splice(+d.unatt, 1); renderAttachments(); return; }
    if (d.go) { if (d.go === "tasks") go("tasks"); else go(d.go); return; }
    if (d.cat) { go("cat", d.cat); return; }
    if (d.tag) { go("tag", d.tag); return; }
    if (d.more != null) { listLimit += 100; render(); return; }
    if (d.mode) { allState.mode = d.mode; render(); return; }
    if (d.type) { allState.type = d.type; render(); return; }
    if (d.stype) { searchState.type = d.stype; $$("[data-stype]").forEach((b) => b.classList.toggle("on", b.dataset.stype === d.stype)); renderSearchResults(); return; }
    if (d.themeSet) { Suite.theme.set(d.themeSet); render(); return; }
    if (d.id && !t.closest(".flags")) { openItem(d.id); return; }
    switch (t.id) {
      case "capSave": return saveCapture();
      case "capPhoto": filePickTarget = null; return $("#filePick").click();
      case "capPaste": return pasteInto($("#capText"));
      case "manageCats": return manageCats();
      case "persist": { const ok = await Suite.persist(); toast(ok ? "Protected" : "Your browser said no. Adding INBOX to the home screen protects it."); return render(); }
      case "exportBtn": { const b = await Suite.backup.export(["inbox"]); Suite.download(b, `inbox-backup-${new Date().toISOString().slice(0, 10)}.json`); return toast("Backup downloaded"); }
      case "importBtn": return $("#importPick").click();
      case "aiSave": { const k = $("#aiKey").value.trim(); if (!/^sk-ant-/.test(k)) return toast("That doesn't look like an Anthropic key (starts with sk-ant-)"); Suite.ai.setKey(k); toast("Key saved on this device"); return render(); }
      case "aiRemove": if (confirm("Remove the API key from this device? AI features turn off.")) { Suite.ai.setKey(""); render(); } return;
      case "aiTest": {
        t.disabled = true; t.textContent = "Testing…";
        try { const r = await Suite.ai.json({ system: "Reply with ok=true.", content: "ping", schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } }, maxTokens: 200 }); toast(r.ok ? "AI is working" : "Unexpected reply"); }
        catch (err) { toast(err.message); }
        t.disabled = false; t.textContent = "Test connection"; return;
      }
      case "erase":
        if (prompt(`Type ERASE to delete all ${items.length} items and their photos from this device.`) !== "ERASE") return;
        for (const it of items) { await Suite.files.del(it.imageId); await Suite.files.del(it.thumbId); }
        await Suite.store.clear("inbox"); items = []; toast("INBOX erased"); return render();
    }
  });
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t.matches && t.matches("[data-id]") && (e.key === "Enter" || e.key === " ") && t === document.activeElement) { e.preventDefault(); openItem(t.dataset.id); return; }
    if (t.id === "capText" && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveCapture(); return; }
    // "n" anywhere (not typing) opens quick add; "/" jumps to search
    if (!/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !document.querySelector(".sheet") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (e.key === "n") { e.preventDefault(); quickAdd(); }
      if (e.key === "/") { e.preventDefault(); go("search"); setTimeout(() => $("#q") && $("#q").focus(), 30); }
    }
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "capText") autoGrow(t);
    if (t.id === "q") { searchState.q = t.value; listLimit = 60; renderSearchResults(); }
  });
  document.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.id === "sortSel") { allState.sort = t.value; render(); }
    if (t.id === "scat") { searchState.cat = t.value; renderSearchResults(); }
    if (t.id === "sarch") { searchState.archived = t.checked; renderSearchResults(); }
    if (t.id === "setAuto") { settings.autoSort = t.checked; await saveSettings(); toast(t.checked ? "Auto-sort on" : "Auto-sort off"); }
    if (t.id === "setAI") { settings.aiAuto = t.checked; await saveSettings(); }
  });
  document.addEventListener("paste", (e) => {
    if (document.querySelector(".sheet")) return;
    const fs = [...(e.clipboardData && e.clipboardData.files || [])].filter((f) => /^image\//.test(f.type));
    if (fs.length) { e.preventDefault(); attach(fs); }
  });
  $("#importPick").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try { const n = await Suite.backup.import(await f.text()); await load(); render(); toast(n ? `Restored ${n} item${n === 1 ? "" : "s"}` : "Nothing new in that backup"); }
    catch (err) { toast(err.message); }
  });
  // drag and drop images or text (computer)
  let dragN = 0;
  addEventListener("dragenter", (e) => { if ([...e.dataTransfer.types].some((x) => x === "Files" || x === "text/uri-list" || x === "text/plain")) { dragN++; $("#drop").classList.add("show"); } });
  addEventListener("dragleave", () => { if (--dragN <= 0) { dragN = 0; $("#drop").classList.remove("show"); } });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", (e) => {
    e.preventDefault(); dragN = 0; $("#drop").classList.remove("show");
    if (attach(e.dataTransfer.files)) return;
    const txt = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (txt) quickAdd({ text: txt.trim() });
  });

  // other tabs/apps changed the store
  Suite.onChange(async (s) => { if (s === "inbox") { items = await Suite.store.all("inbox"); render(); } });

  /* ---------------------------------------------------------------- start */
  (async function start() {
    try { await load(); }
    catch (e) { $("#main").innerHTML = `<div class="empty"><b>Storage isn't available</b>${esc(e.message)}<br>Private browsing can block it.</div>`; return; }
    parseRoute();
    await render();
    // shared in: ?text= / ?url= / ?title= (Shortcuts, bookmarklet, Android share)
    const q = new URLSearchParams(location.search);
    const shared = [q.get("title"), q.get("text"), q.get("url")].filter(Boolean);
    if (q.has("add") && !shared.length) { history.replaceState(null, "", location.pathname + location.hash); quickAdd(); }
    if (shared.length) {
      history.replaceState(null, "", location.pathname + location.hash);
      const uniq = shared.filter((v, i) => !shared.slice(0, i).some((p) => p.includes(v)));
      quickAdd({ text: uniq.join("\n"), source: "share" });
    }
    if (items.length >= 3) Suite.persist();
  })();
})();
