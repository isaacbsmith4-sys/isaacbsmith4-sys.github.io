/* On-device language rules shared by the suite apps (no AI, no network except YouTube's oEmbed).

   - parseDue: "tomorrow at 4pm", "friday", "tonight" -> "YYYY-MM-DDTHH:MM" local, or "".
   - ruleCategory: keyword / link-domain / #tag scoring against a category list.
   - splitThoughts + classify: turn a spoken ramble into separate action items (TALK).
   - destFor + toRecord: which built app an item goes to, and the record that app stores. Apps that
     aren't built yet are skipped, so items fall back to INBOX until DON'T FORGET and QUEUE exist.
*/
(function () {
  "use strict";
  const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi;
  const TAG_RE = /(^|\s)#([\p{L}\p{N}_-]{1,32})/gu;
  const TASK_RE = /\b(todo|to-do|need to|have to|gotta|remember to|don'?t forget|remind me|must|due)\b/i;

  /* INBOX's default categories; the keyword lists are the auto-sort rules (TALK reuses the ids) */
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

  /* natural dates: today / tonight / tomorrow / weekday / next week, optional "at 4", "4pm", "4:30 pm", "noon" */
  function parseDue(text) {
    const t = " " + String(text || "").toLowerCase() + " ";
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
    const tm = t.match(/\b(?:at|by|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/) || t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\W)/);
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
    if (hh == null) {
      // no time said: 9 AM, or the next hour when that's already past today
      hh = 9; mm = 0;
      if (day.toDateString() === now.toDateString() && now.getHours() >= 9) hh = Math.min(now.getHours() + 1, 23);
    }
    day.setHours(hh, mm, 0, 0);
    return localISO(day);
  }

  /** rules-based category: a #tag naming a category wins, then link domain, then keyword score */
  function ruleCategory(it, cats) {
    const has = (id) => cats.some((c) => c.id === id);
    for (const t of it.tags || []) { const c = cats.find((c) => c.name.toLowerCase() === t || c.id === t); if (c) return c.id; }
    const dom = domainOf(it.url), full = (it.url || "").toLowerCase();
    if (dom) for (const [id, r] of Object.entries(RULES)) if (has(id) && (r.domains || []).some((d) => dom === d || dom.endsWith("." + d) || full.includes(d))) return id;
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

  /* ---------- speech -> items ---------- */
  const VERBS = "remember|don'?t forget|look|watch|buy|get|call|text|email|finish|read|check|pick up|schedule|try|make|send|find|order|need|have to|go|start|study|practice|listen|book|sign up|ask|tell|clean|do|i need|i have|i should|i want|i gotta|i'?m gonna|maybe|what if|i could";
  const FILLER = /^(?:and|also|plus|then|so|um+|uh+|oh|okay|ok|like|anyway|alright|and then|but)\b[\s,]*/i;
  /** split a ramble into separate thoughts: sentences, commas, "also", and "and" before a new action */
  function splitThoughts(text) {
    const out = [];
    const andSplit = new RegExp(`\\s+(?:and|but)\\s+(?:then\\s+|also\\s+)?(?=(?:${VERBS})\\b)`, "i");
    for (const sentence of String(text || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+|;\s*|\n+/)) {
      for (const piece of sentence.split(/,\s+|\s+also\s+|\s+plus\s+/i)) {
        for (let p of piece.split(andSplit)) {
          for (let k = 0; k < 4 && FILLER.test(p); k++) p = p.replace(FILLER, "");
          p = p.replace(/[\s.,!?;:]+$/, "").trim();
          if (p.split(" ").length >= 2) out.push(p);
        }
      }
    }
    return out;
  }
  function clean(text) {
    let t = String(text || "").trim()
      .replace(/^(?:i\s+(?:really\s+)?(?:need|have|want|got)\s+to|i(?:'m| am)\s+(?:gonna|going to)|i\s+should(?:\s+probably)?|i\s+gotta|i\s+must|remember\s+to|don'?t\s+forget(?:\s+to|\s+that)?|make\s+sure\s+(?:to|i)|remind\s+me\s+to|note\s+to\s+self:?|idea:|(?:app|business)\s+idea:|we\s+need\s+to)\s+/i, "");
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }
  const KINDS = { task: "Reminder", watch: "Watch", read: "Read", listen: "Listen", buy: "Buy", idea: "Idea", note: "Note" };
  /** what kind of action a single thought is, or null when it's just talk */
  function classify(text) {
    const t = " " + String(text || "").toLowerCase() + " ";
    const due = parseDue(t);
    const school = /\b(homework|hw|assignment|quiz|test|exam|essay|class|project|study)\b/.test(t);
    let kind = null;
    if (/\b(watch|video|movie|film|show|episode|documentary|youtube|trailer|series)\b/.test(t) && !school) kind = "watch";
    else if (/\b(listen to|podcast|album)\b/.test(t)) kind = "listen";
    else if (/\b(read|article|book|novel)\b/.test(t) && !school) kind = "read";
    else if (/\b(buy|buying|purchase|order|shopping|new (?:shoes|sneakers|jacket|headphones|phone|clothes)|gift|present)\b|\bget (?:a|some|new)\b/.test(t)) kind = "buy";
    else if (/\b(idea|what if|maybe i (?:could|should)|i could (?:build|make|start)|thinking (?:about|of) (?:building|making|starting))\b/.test(t)) kind = "idea";
    else if (TASK_RE.test(t) || school || /\b(i should|i want to|i'?m gonna|i'?m going to|work on|gotta)\b/.test(t) || /^\s*(call|text|email|finish|submit|study|practice|clean|pay|book|schedule|sign up|ask|tell|pick up|send|do|go to|turn in)\b/.test(t)) kind = "task";
    return kind ? { kind, text: clean(text), due } : null;
  }
  /** a transcript -> [{id, kind, text, due}] (only the thoughts that ask for something) */
  function extract(transcript) {
    const seen = new Set();
    return splitThoughts(transcript).map(classify).filter(Boolean)
      .filter((x) => { const k = x.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .map((x) => ({ id: Suite.uid("ai"), ...x, sent: null }));
  }
  function titleFor(transcript) {
    const first = splitThoughts(transcript)[0] || String(transcript || "").trim();
    const words = clean(first).split(/\s+/).filter(Boolean);
    return words.slice(0, 8).join(" ") + (words.length > 8 ? "…" : "");
  }

  /* ---------- routing between apps ---------- */
  const ROUTES = { task: ["reminders", "inbox"], watch: ["queue", "inbox"], read: ["queue", "inbox"], listen: ["queue", "inbox"], buy: ["inbox"], idea: ["inbox"], note: ["inbox"] };
  const built = (id) => (Suite.apps.find((a) => a.id === id) || {}).built;
  /** the first built app for this kind of item */
  const destFor = (kind) => (ROUTES[kind] || ["inbox"]).find(built) || "inbox";
  /** how the item will look over there, for the button label */
  function destLabel(kind) {
    const d = destFor(kind), name = Suite.apps.find((a) => a.id === d).name;
    if (d === "inbox" && kind === "task") return name + " task";
    return name;
  }
  /** the record the destination app stores; INBOX's categories come from its own list */
  async function toRecord(appId, it, source) {
    if (appId !== "inbox") throw new Error("Sending to " + appId + " isn't wired up yet");
    const cats = (await Suite.meta.get("inbox:categories", null)) || DEFAULT_CATS;
    const urls = it.text.match(URL_RE) || [];
    const url = urls[0] ? (/^www\./i.test(urls[0]) ? "https://" + urls[0] : urls[0]) : "";
    const title = (url ? it.text.replace(urls[0], "").trim() : it.text).slice(0, 140);
    const prefer = { watch: "watch", read: "read", listen: "watch", buy: "shopping", idea: "ideas" }[it.kind];
    const base = { title, body: it.detail || "", url, note: it.note || "", tags: [] };
    const cat = prefer && cats.some((c) => c.id === prefer) ? prefer : ruleCategory(base, cats);
    return {
      ...base, type: url ? "link" : it.kind === "idea" ? "idea" : "note",
      cat: cat || null, catBy: cat ? "rules" : null, pinned: false, fav: false, archived: false,
      task: it.kind === "task" ? { due: it.due || "", done: false } : null, source,
    };
  }

  Suite.nlp = { localISO, domainOf, URL_RE, TAG_RE, TASK_RE, DEFAULT_CATS, RULES, parseDue, ruleCategory, fetchLinkMeta,
    splitThoughts, classify, extract, clean, titleFor, KINDS, destFor, destLabel, toRecord };
})();
