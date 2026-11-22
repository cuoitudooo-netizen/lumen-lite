/* Lumen — Offline Flashcards. Plain JS, no build step, no network. */
(function () {
  "use strict";

  var IS_PRO = false;
  var STORAGE_KEY = IS_PRO ? "lumen-pro-v1" : "lumen-lite-v1";
  var MAX_DECKS_LITE = 2;
  var MAX_CARDS_LITE = 40;
  var THEMES = ["parchment", "nocturne", "river"];
  var COLORS = ["copper", "moss", "slate", "amber", "plum"];
  var LEARNING_STEPS = [1, 10];
  var RELEARN_STEP = 10;
  var GRADUATING_INTERVAL = 1;
  var EASY_INTERVAL = 4;
  var STARTING_EASE = 2.5;
  var MIN_EASE = 1.3;
  var EASY_BONUS = 1.3;
  var HARD_FACTOR = 1.2;
  var SECOND_INTERVAL = 6;
  var DAY_MS = 86400000;

  var state = null;
  var view = "library";
  var session = null;
  var browseDeckId = null;
  var toastTimer = null;
  var lastFocused = null;

  /* ---------- helpers ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function uid() {
    return "l" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }

  function startOfDay(d) {
    var x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function isoDay(d) {
    var x = new Date(d);
    var y = x.getFullYear();
    var m = String(x.getMonth() + 1).padStart(2, "0");
    var day = String(x.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function addDays(d, n) {
    var x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function mondayIndex(d) {
    return (d.getDay() + 6) % 7;
  }

  function startOfWeek(d) {
    var s = startOfDay(d);
    return addDays(s, -mondayIndex(s));
  }

  function endOfToday() {
    return addDays(startOfDay(new Date()), 1).getTime();
  }

  function greeting(name) {
    var h = new Date().getHours();
    var hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    return name ? hello + ", " + name : hello;
  }

  function prettyDate(d) {
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  }

  function prettyDay(d) {
    var t = startOfDay(new Date()).getTime();
    var x = startOfDay(d).getTime();
    if (x === t) return "Today";
    if (x === t + DAY_MS) return "Tomorrow";
    if (x === t - DAY_MS) return "Yesterday";
    return new Date(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  function notify(msg) {
    var el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
  }

  function liteLimitMsg() {
    return "Lite includes two decks and 40 cards. The full version at cuoitudo.gumroad.com lifts those limits.";
  }

  /* ---------- SRS ---------- */

  function formatIntervalMs(ms) {
    var min = Math.round(ms / 60000);
    if (min < 1) return "<1m";
    if (min < 60) return min + "m";
    var hours = Math.round(min / 60);
    if (hours < 24) return hours + "h";
    var days = Math.round(hours / 24);
    if (days < 30) return days + "d";
    var months = Math.round(days / 30.4);
    return months + "mo";
  }

  function dueInMinutes(now, minutes) {
    return now + Math.max(1, minutes) * 60000;
  }

  function dueInDays(now, days) {
    return now + Math.max(1, days) * DAY_MS;
  }

  function previewInterval(card, rating) {
    var next = schedule(card, rating, Date.now());
    return formatIntervalMs(Math.max(0, next.due - Date.now()));
  }

  function schedule(card, rating, now) {
    now = now || Date.now();
    var next = {
      status: card.status,
      due: card.due,
      interval: card.interval,
      ease: card.ease,
      reps: card.reps,
      lapses: card.lapses,
      step: card.step
    };
    var status = card.status || "new";
    var ease = card.ease || STARTING_EASE;
    var interval = card.interval || 0;
    var reps = card.reps || 0;
    var step = card.step || 0;

    if (status === "new" || status === "learning") {
      if (rating === "again") {
        next.status = "learning";
        next.step = 0;
        next.due = dueInMinutes(now, LEARNING_STEPS[0]);
      } else if (rating === "hard") {
        next.status = "learning";
        next.step = step;
        var cur = LEARNING_STEPS[step] || LEARNING_STEPS[0];
        var nxt = LEARNING_STEPS[step + 1] || cur * 2;
        next.due = dueInMinutes(now, Math.max(cur, Math.round((cur + nxt) / 2)));
      } else if (rating === "good") {
        if (step + 1 >= LEARNING_STEPS.length) {
          next.status = "review";
          next.step = 0;
          next.reps = reps + 1;
          next.interval = GRADUATING_INTERVAL;
          next.due = dueInDays(now, GRADUATING_INTERVAL);
        } else {
          next.status = "learning";
          next.step = step + 1;
          next.due = dueInMinutes(now, LEARNING_STEPS[next.step]);
        }
      } else {
        next.status = "review";
        next.step = 0;
        next.reps = reps + 1;
        next.interval = EASY_INTERVAL;
        next.ease = ease + 0.15;
        next.due = dueInDays(now, EASY_INTERVAL);
      }
    } else if (status === "relearning") {
      if (rating === "again") {
        next.step = 0;
        next.due = dueInMinutes(now, RELEARN_STEP);
      } else if (rating === "hard") {
        next.due = dueInMinutes(now, Math.round(RELEARN_STEP * 1.5));
      } else {
        var base = Math.max(GRADUATING_INTERVAL, Math.round((interval || 1) * 0.1));
        next.status = "review";
        next.step = 0;
        next.reps = reps + 1;
        if (rating === "easy") {
          next.interval = Math.max(EASY_INTERVAL, Math.round(base * ease * EASY_BONUS));
          next.ease = ease + 0.15;
        } else {
          next.interval = base;
        }
        next.due = dueInDays(now, next.interval);
      }
    } else {
      if (rating === "again") {
        next.status = "relearning";
        next.lapses = (card.lapses || 0) + 1;
        next.ease = Math.max(MIN_EASE, ease - 0.2);
        next.step = 0;
        next.due = dueInMinutes(now, RELEARN_STEP);
      } else if (rating === "hard") {
        next.ease = Math.max(MIN_EASE, ease - 0.15);
        next.interval = Math.max(1, Math.round((interval || 1) * HARD_FACTOR));
        next.reps = reps + 1;
        next.due = dueInDays(now, next.interval);
      } else if (rating === "good") {
        next.interval = reps <= 1 ? SECOND_INTERVAL : Math.max((interval || 1) + 1, Math.round((interval || 1) * ease));
        next.reps = reps + 1;
        next.due = dueInDays(now, next.interval);
      } else {
        next.ease = ease + 0.15;
        next.interval = Math.max(EASY_INTERVAL, Math.round((interval || 1) * next.ease * EASY_BONUS));
        next.reps = reps + 1;
        next.due = dueInDays(now, next.interval);
      }
    }
    return next;
  }

  /* ---------- storage ---------- */

  function blankCard(deckId, front, back, hint) {
    return {
      id: uid(),
      deckId: deckId,
      front: front || "",
      back: back || "",
      hint: hint || "",
      status: "new",
      due: Date.now(),
      interval: 0,
      ease: STARTING_EASE,
      reps: 0,
      lapses: 0,
      step: 0,
      createdAt: Date.now()
    };
  }

  function defaultState() {
    return {
      version: 1,
      isDemo: false,
      settings: {
        name: "",
        theme: "parchment",
        newPerDay: 20
      },
      decks: [],
      cards: [],
      log: []
    };
  }

  function daysAgo(n, hour) {
    var d = startOfDay(new Date());
    d.setDate(d.getDate() - n);
    d.setHours(hour == null ? 19 : hour, (n * 13) % 50, 0, 0);
    return d.getTime();
  }

  function demoState() {
    var d1 = uid();
    var d2 = uid();
    var d3 = uid();
    var now = Date.now();
    var s = defaultState();
    s.isDemo = true;
    s.settings.name = "Maya";
    s.settings.theme = "parchment";
    s.decks = [
      { id: d1, name: "Cell Biology", color: "copper", createdAt: daysAgo(20) },
      { id: d2, name: "Spanish A1", color: "moss", createdAt: daysAgo(14) },
      { id: d3, name: "Research Methods", color: "slate", createdAt: daysAgo(10) }
    ];

    function add(deckId, front, back, hint, patch) {
      var c = blankCard(deckId, front, back, hint);
      if (patch) Object.assign(c, patch);
      s.cards.push(c);
      return c;
    }

    /* Cell Biology — a mix of due, new, and later reviews */
    add(d1, "Which organelle produces most of a cell’s ATP?", "The mitochondrion. It generates ATP through cellular respiration.", "Think of the “powerhouse.”", { status: "review", due: daysAgo(1, 8), interval: 3, ease: 2.5, reps: 3, createdAt: daysAgo(18) });
    add(d1, "What is the function of the ribosome?", "Protein synthesis. Ribosomes translate mRNA into polypeptide chains.", "", { status: "review", due: now - 3600000, interval: 2, ease: 2.36, reps: 2, createdAt: daysAgo(17) });
    add(d1, "What does the Golgi apparatus do?", "It modifies, sorts, and packages proteins and lipids for storage or transport out of the cell.", "", { status: "review", due: daysAgo(0, 7), interval: 4, ease: 2.6, reps: 4, createdAt: daysAgo(16) });
    add(d1, "Name the process that divides a somatic cell into two identical daughter cells.", "Mitosis.", "Not meiosis.", { status: "learning", due: now - 120000, interval: 0, ease: 2.5, reps: 0, step: 1, createdAt: daysAgo(2) });
    add(d1, "What is the role of the cell membrane?", "It is a selectively permeable barrier that controls what enters and leaves the cell, and it supports cell signaling.", "", { status: "review", due: addDays(new Date(), 3).getTime(), interval: 6, ease: 2.7, reps: 4, createdAt: daysAgo(15) });
    add(d1, "Where is genetic material stored in a eukaryotic cell?", "In the nucleus, as DNA organized into chromosomes.", "", { status: "review", due: addDays(new Date(), 5).getTime(), interval: 8, ease: 2.5, reps: 3, createdAt: daysAgo(14) });
    add(d1, "What is osmosis?", "The movement of water across a selectively permeable membrane, from a lower to a higher solute concentration.", "", { status: "review", due: daysAgo(0, 6), interval: 1, ease: 2.5, reps: 1, createdAt: daysAgo(8) });
    add(d1, "What is the difference between rough and smooth endoplasmic reticulum?", "Rough ER is studded with ribosomes and helps make proteins. Smooth ER has no ribosomes and helps make lipids and detoxify chemicals.", "", { status: "new", due: now, createdAt: daysAgo(1) });
    add(d1, "What is a lysosome?", "A membrane-bound organelle that contains enzymes to digest waste, debris, and worn-out cell parts.", "", { status: "new", due: now, createdAt: daysAgo(1) });
    add(d1, "What is the cytoskeleton?", "A network of protein filaments — microfilaments, microtubules, and intermediate filaments — that gives the cell shape and helps it move.", "", { status: "review", due: addDays(new Date(), 2).getTime(), interval: 6, ease: 2.5, reps: 2, createdAt: daysAgo(12) });
    add(d1, "What is photosynthesis, in one sentence?", "The process by which plants and some other organisms convert light energy into chemical energy stored in sugars.", "", { status: "review", due: addDays(new Date(), 7).getTime(), interval: 10, ease: 2.8, reps: 5, createdAt: daysAgo(19) });
    add(d1, "What is the basic structural and functional unit of life?", "The cell.", "", { status: "review", due: addDays(new Date(), 12).getTime(), interval: 21, ease: 2.9, reps: 7, createdAt: daysAgo(20) });

    /* Spanish A1 */
    add(d2, "Hola", "Hello", "", { status: "review", due: daysAgo(0, 8), interval: 4, ease: 2.6, reps: 5, createdAt: daysAgo(13) });
    add(d2, "Gracias", "Thank you", "", { status: "review", due: now - 7200000, interval: 3, ease: 2.5, reps: 3, createdAt: daysAgo(12) });
    add(d2, "¿Cómo te llamas?", "What is your name?", "", { status: "review", due: daysAgo(0, 9), interval: 2, ease: 2.36, reps: 2, createdAt: daysAgo(11) });
    add(d2, "Me llamo Maya.", "My name is Maya.", "A full sentence.", { status: "review", due: addDays(new Date(), 4).getTime(), interval: 6, ease: 2.6, reps: 3, createdAt: daysAgo(11) });
    add(d2, "Por favor", "Please", "", { status: "review", due: addDays(new Date(), 2).getTime(), interval: 3, ease: 2.5, reps: 2, createdAt: daysAgo(10) });
    add(d2, "¿Dónde está la biblioteca?", "Where is the library?", "", { status: "learning", due: now - 60000, interval: 0, ease: 2.5, reps: 0, step: 0, createdAt: daysAgo(1) });
    add(d2, "Yo estudio biología.", "I study biology.", "", { status: "new", due: now, createdAt: daysAgo(1) });
    add(d2, "Buenos días", "Good morning", "", { status: "review", due: addDays(new Date(), 6).getTime(), interval: 8, ease: 2.7, reps: 4, createdAt: daysAgo(13) });
    add(d2, "Hasta mañana", "See you tomorrow", "", { status: "new", due: now, createdAt: daysAgo(0, 10) });
    add(d2, "¿Puedes repetir, por favor?", "Can you repeat that, please?", "", { status: "review", due: addDays(new Date(), 1).getTime(), interval: 1, ease: 2.5, reps: 1, createdAt: daysAgo(5) });

    /* Research Methods */
    add(d3, "What is an independent variable?", "The variable the researcher changes or controls in order to test its effect on the outcome.", "", { status: "review", due: daysAgo(0, 8), interval: 3, ease: 2.5, reps: 3, createdAt: daysAgo(9) });
    add(d3, "What is a dependent variable?", "The outcome the researcher measures, which may change in response to the independent variable.", "", { status: "review", due: addDays(new Date(), 3).getTime(), interval: 6, ease: 2.6, reps: 3, createdAt: daysAgo(9) });
    add(d3, "What does a p-value tell you, in plain language?", "The probability of seeing results at least as extreme as yours if the null hypothesis were true.", "", { status: "review", due: now - 1800000, interval: 2, ease: 2.36, reps: 2, createdAt: daysAgo(6) });
    add(d3, "What is a control group?", "A group that does not receive the treatment, used as a baseline for comparison.", "", { status: "review", due: addDays(new Date(), 8).getTime(), interval: 10, ease: 2.7, reps: 4, createdAt: daysAgo(8) });
    add(d3, "What is a hypothesis?", "A clear, testable statement about a possible relationship between variables.", "", { status: "new", due: now, createdAt: daysAgo(0, 11) });
    add(d3, "What is a confounding variable?", "An outside factor that influences both the supposed cause and the effect, which can distort the results.", "", { status: "review", due: addDays(new Date(), 2).getTime(), interval: 4, ease: 2.5, reps: 2, createdAt: daysAgo(7) });
    add(d3, "What is the difference between a population and a sample?", "The population is the whole group you want to understand. A sample is the smaller group you actually study.", "", { status: "review", due: addDays(new Date(), 5).getTime(), interval: 7, ease: 2.5, reps: 3, createdAt: daysAgo(8) });
    add(d3, "What is a literature review?", "A structured survey of existing research on a topic, used to show what is already known and where a new study fits.", "", { status: "review", due: addDays(new Date(), 14).getTime(), interval: 21, ease: 2.8, reps: 5, createdAt: daysAgo(10) });

    /* Review history so the 7-day chart, streak, and 12-week heatmap look lived-in */
    var ratings = ["again", "hard", "good", "good", "good", "easy"];
    var cardIds = s.cards.map(function (c) { return c.id; });
    var deckIds = [d1, d2, d3];
    s.log = [];
    var recent = [11, 9, 6, 8, 14, 10, 12, 7, 9]; /* days ago 8..0 — a 9-day streak */
    var i, n, k;
    for (i = 69; i >= 0; i--) {
      if (i <= 8) n = recent[8 - i];
      else if (i % 7 === 5) n = 0;
      else n = 3 + ((i * 5) % 9);
      for (k = 0; k < n; k++) {
        s.log.push({
          at: daysAgo(i, 17 - (k % 8)),
          rating: ratings[(i + k) % ratings.length],
          cardId: cardIds[(i * 3 + k) % cardIds.length],
          deckId: deckIds[(i + k) % 3]
        });
      }
    }
    return s;
  }

  function sanitize(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== "object") return base;
    base.isDemo = !!raw.isDemo;
    var s = raw.settings || {};
    base.settings.name = String(s.name || "").slice(0, 40);
    base.settings.theme = THEMES.indexOf(s.theme) >= 0 ? s.theme : "parchment";
    var n = Number(s.newPerDay);
    base.settings.newPerDay = n >= 1 && n <= 200 ? Math.round(n) : 20;
    if (!IS_PRO) base.settings.theme = "parchment";
    var decks = Array.isArray(raw.decks) ? raw.decks : [];
    var cards = Array.isArray(raw.cards) ? raw.cards : [];
    var seen = {};
    decks.forEach(function (d) {
      if (!d || !d.id) return;
      var color = COLORS.indexOf(d.color) >= 0 ? d.color : "copper";
      base.decks.push({
        id: String(d.id),
        name: String(d.name || "Untitled deck").slice(0, 48),
        color: color,
        createdAt: Number(d.createdAt) || Date.now()
      });
      seen[d.id] = true;
    });
    cards.forEach(function (c) {
      if (!c || !c.id || !seen[c.deckId]) return;
      var status = c.status;
      if (["new", "learning", "review", "relearning"].indexOf(status) < 0) status = "new";
      base.cards.push({
        id: String(c.id),
        deckId: String(c.deckId),
        front: String(c.front || "").slice(0, 500),
        back: String(c.back || "").slice(0, 800),
        hint: String(c.hint || "").slice(0, 120),
        status: status,
        due: Number(c.due) || Date.now(),
        interval: Math.max(0, Number(c.interval) || 0),
        ease: Math.max(MIN_EASE, Number(c.ease) || STARTING_EASE),
        reps: Math.max(0, Number(c.reps) || 0),
        lapses: Math.max(0, Number(c.lapses) || 0),
        step: Math.max(0, Number(c.step) || 0),
        createdAt: Number(c.createdAt) || Date.now()
      });
    });
    var log = Array.isArray(raw.log) ? raw.log : [];
    var cutoff = Date.now() - 120 * DAY_MS;
    log.forEach(function (e) {
      if (!e || !e.at || e.at < cutoff) return;
      var rating = e.rating;
      if (["again", "hard", "good", "easy"].indexOf(rating) < 0) return;
      base.log.push({
        at: Number(e.at),
        rating: rating,
        cardId: String(e.cardId || ""),
        deckId: String(e.deckId || "")
      });
    });
    if (!IS_PRO) {
      base.decks = base.decks.slice(0, MAX_DECKS_LITE);
      var keep = {};
      base.decks.forEach(function (d) { keep[d.id] = true; });
      base.cards = base.cards.filter(function (c) { return keep[c.deckId]; }).slice(0, MAX_CARDS_LITE);
    }
    return base;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state = demoState();
        if (!IS_PRO) state = sanitize(state);
        save();
        return;
      }
      state = sanitize(JSON.parse(raw));
    } catch (err) {
      state = demoState();
      if (!IS_PRO) state = sanitize(state);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      notify("Could not save. This browser may be blocking local storage.");
    }
  }

  /* ---------- queries ---------- */

  function deckById(id) {
    for (var i = 0; i < state.decks.length; i++) if (state.decks[i].id === id) return state.decks[i];
    return null;
  }

  function cardById(id) {
    for (var i = 0; i < state.cards.length; i++) if (state.cards[i].id === id) return state.cards[i];
    return null;
  }

  function cardsIn(deckId) {
    return state.cards.filter(function (c) { return !deckId || c.deckId === deckId; });
  }

  function dueReviews(deckId, now) {
    var end = endOfToday();
    return cardsIn(deckId).filter(function (c) {
      return c.status !== "new" && c.due <= end;
    }).sort(function (a, b) { return a.due - b.due; });
  }

  function newIntroducedToday() {
    var start = startOfDay(new Date()).getTime();
    var ids = {};
    state.log.forEach(function (e) {
      if (e.at >= start) ids[e.cardId] = true;
    });
    var n = 0;
    state.cards.forEach(function (c) {
      if (c.status !== "new" && c.createdAt >= start && ids[c.id]) n++;
      /* count cards that left "new" today: they have a log today and reps starting */
    });
    /* Simpler: count log entries today whose card had been new — we store no flag.
       Approximate by counting unique cards reviewed today that still have reps === 1 and interval <= EASY_INTERVAL
       Better approach: count cards whose first log is today. */
    n = 0;
    var first = {};
    state.log.forEach(function (e) {
      if (!first[e.cardId] || e.at < first[e.cardId]) first[e.cardId] = e.at;
    });
    Object.keys(first).forEach(function (id) {
      if (first[id] >= start) n++;
    });
    return n;
  }

  function newAvailable(deckId) {
    var list = cardsIn(deckId).filter(function (c) { return c.status === "new"; });
    var cap = IS_PRO ? (state.settings.newPerDay || 20) : 10;
    var left = Math.max(0, cap - newIntroducedToday());
    return list.slice(0, left);
  }

  function dueCount(deckId) {
    return dueReviews(deckId).length + newAvailable(deckId).length;
  }

  function reviewsOn(day) {
    var n = 0;
    state.log.forEach(function (e) { if (isoDay(e.at) === day) n++; });
    return n;
  }

  function currentStreak() {
    var t = startOfDay(new Date());
    var streak = 0;
    /* If nothing today yet, start counting from yesterday so a mid-day open keeps yesterday's streak visible */
    if (reviewsOn(isoDay(t)) === 0) t = addDays(t, -1);
    while (reviewsOn(isoDay(t)) > 0) {
      streak++;
      t = addDays(t, -1);
    }
    return streak;
  }

  function matureCount(deckId) {
    return cardsIn(deckId).filter(function (c) { return c.status === "review" && c.interval >= 7; }).length;
  }

  /* ---------- render ---------- */

  function applyTheme() {
    var theme = IS_PRO ? state.settings.theme : "parchment";
    if (THEMES.indexOf(theme) < 0) theme = "parchment";
    document.body.setAttribute("data-theme", theme);
    document.querySelectorAll("[data-theme-btn]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-theme-btn") === theme);
    });
  }

  function applyLiteChrome() {
    if (IS_PRO) return;
    document.querySelectorAll(".pro-only").forEach(function (el) { el.hidden = true; });
    document.querySelectorAll("[data-theme-btn]").forEach(function (el) {
      if (el.getAttribute("data-theme-btn") !== "parchment") el.hidden = true;
    });
    var heat = $("heatmap-wrap");
    if (heat) heat.hidden = true;
    var backup = $("backup");
    if (backup) backup.hidden = true;
    var themeSwitch = document.querySelector(".theme-switch");
    if (themeSwitch) themeSwitch.hidden = true;
  }

  function showView(name) {
    view = name;
    $("view-library").hidden = name !== "library";
    $("view-study").hidden = name !== "study";
    $("view-browse").hidden = name !== "browse";
  }

  function renderHeader() {
    $("greet").textContent = greeting(state.settings.name);
    $("today-date").textContent = prettyDate(new Date());
    $("clear-demo").hidden = !state.isDemo;
    applyTheme();
  }

  function renderStats() {
    var due = dueCount(null);
    var neu = newAvailable(null).length;
    var today = reviewsOn(isoDay(new Date()));
    var streak = currentStreak();
    $("stats").innerHTML =
      statHtml(due, "Due today") +
      statHtml(neu, "New waiting") +
      statHtml(today, "Reviewed today") +
      statHtml(streak, streak === 1 ? "Day streak" : "Day streak");
  }

  function statHtml(value, label) {
    return '<div class="stat"><div class="stat-value">' + esc(String(value)) + '</div><div class="stat-label">' + esc(label) + "</div></div>";
  }

  function renderDecks() {
    var grid = $("deck-grid");
    var empty = $("deck-empty");
    var wrap = $("study-all-wrap");
    if (!state.decks.length) {
      grid.innerHTML = "";
      empty.hidden = false;
      wrap.hidden = true;
      return;
    }
    empty.hidden = true;
    var html = "";
    state.decks.forEach(function (d) {
      var total = cardsIn(d.id).length;
      var due = dueCount(d.id);
      var mature = matureCount(d.id);
      var pct = total ? Math.round((mature / total) * 100) : 0;
      html += '<article class="deck deck-' + esc(d.color) + '">' +
        '<button type="button" class="deck-name" data-edit-deck="' + esc(d.id) + '">' + esc(d.name) + "</button>" +
        '<p class="deck-meta">' + due + " due · " + total + (total === 1 ? " card" : " cards") + "</p>" +
        '<div class="deck-bar" title="' + pct + '% with a week or more between reviews"><span style="width:' + pct + '%"></span></div>' +
        '<div class="deck-actions">' +
          '<button type="button" class="btn-primary" data-study="' + esc(d.id) + '"' + (due ? "" : " disabled") + ">Study</button>" +
          '<button type="button" class="btn-ghost" data-browse="' + esc(d.id) + '">Browse</button>' +
        "</div></article>";
    });
    grid.innerHTML = html;
    wrap.hidden = dueCount(null) === 0;
  }

  function renderWeek() {
    var days = [];
    var today = startOfDay(new Date());
    var i, n, max = 1, counts = [];
    for (i = 6; i >= 0; i--) days.push(addDays(today, -i));
    for (i = 0; i < 7; i++) {
      n = reviewsOn(isoDay(days[i]));
      counts.push(n);
      if (n > max) max = n;
    }
    var html = "";
    var labels = ["S", "M", "T", "W", "T", "F", "S"];
    for (i = 0; i < 7; i++) {
      var h = counts[i] ? Math.max(8, Math.round((counts[i] / max) * 92)) : 5;
      var label = labels[days[i].getDay()];
      html += '<div class="bar"><span class="bar-n">' + (counts[i] ? counts[i] : "") + "</span>" +
        '<span class="bar-fill" style="height:' + h + 'px;opacity:' + (counts[i] ? 1 : 0.35) + '"></span>' +
        '<span class="bar-label">' + label + "</span></div>";
    }
    $("week-bars").innerHTML = html;
  }

  function renderHeatmap() {
    var el = $("heatmap");
    if (!el || !IS_PRO) return;
    var start = startOfWeek(addDays(startOfDay(new Date()), -77));
    var html = "";
    for (var i = 0; i < 84; i++) {
      var d = addDays(start, i);
      var n = reviewsOn(isoDay(d));
      var level = n === 0 ? 0 : n < 5 ? 1 : n < 10 ? 2 : n < 18 ? 3 : 4;
      html += '<span class="heat" data-n="' + level + '" title="' + isoDay(d) + ": " + n + ' review' + (n === 1 ? "" : "s") + '"></span>';
    }
    el.innerHTML = html;
  }

  function renderUpcoming() {
    var el = $("upcoming");
    var end = endOfToday();
    var future = state.cards.filter(function (c) { return c.status !== "new" && c.due > end; })
      .sort(function (a, b) { return a.due - b.due; });
    var groups = [];
    future.forEach(function (c) {
      var key = isoDay(c.due);
      var last = groups[groups.length - 1];
      if (!last || last.day !== key) {
        groups.push({ day: key, due: c.due, n: 1 });
      } else last.n++;
    });
    groups = groups.slice(0, 5);
    if (!groups.length) {
      el.innerHTML = '<li><span>Nothing scheduled after today.</span></li>';
      return;
    }
    el.innerHTML = groups.map(function (g) {
      return "<li><span>" + g.n + " card" + (g.n === 1 ? "" : "s") + "</span><span class=\"when\">" + prettyDay(g.due) + "</span></li>";
    }).join("");
  }

  function renderLibrary() {
    showView("library");
    renderHeader();
    renderStats();
    renderDecks();
    renderWeek();
    renderHeatmap();
    renderUpcoming();
  }

  function currentCard() {
    if (!session || session.index >= session.queue.length) return null;
    return cardById(session.queue[session.index]);
  }

  function renderStudyCard() {
    var card = currentCard();
    $("study-active").hidden = !card;
    $("study-summary").hidden = !!card;
    $("undo-review").hidden = !(session && session.undo);
    if (!card) return;
    var deck = deckById(card.deckId);
    $("study-deck").textContent = session.mode === "cram"
      ? (deck ? deck.name : "Deck") + " · Cram"
      : session.deckId ? (deck ? deck.name : "Deck") : "All due cards";
    var total = session.queue.length;
    var at = session.index + 1;
    $("study-progress").textContent = at + " of " + total + (session.mode === "cram" ? "" : " due");
    $("front-text").textContent = card.front;
    $("back-text").textContent = card.back;
    $("front-hint").textContent = card.hint ? "Hint: " + card.hint : "";
    var flash = $("flash");
    flash.classList.toggle("is-flipped", !!session.flipped);
    flash.setAttribute("aria-label", session.flipped ? "Answer. Click to hide." : "Question. Click to flip.");
    $("ratings").hidden = session.mode === "cram" || !session.flipped;
    $("cram-actions").hidden = session.mode !== "cram" || !session.flipped;
    $("flip-prompt").textContent = session.flipped ? "" : (session.mode === "cram" ? "Click or press Space to flip" : "Click or press Space to flip");
    if (session.mode !== "cram") {
      ["again", "hard", "good", "easy"].forEach(function (r) {
        var el = document.querySelector('[data-when="' + r + '"]');
        if (el) el.textContent = previewInterval(card, r);
      });
    }
  }

  function showSummary() {
    $("study-active").hidden = true;
    $("study-summary").hidden = false;
    $("undo-review").hidden = true;
    var c = session.counts;
    var total = session.done;
    $("study-deck").textContent = "Session complete";
    $("study-progress").textContent = total + " card" + (total === 1 ? "" : "s") + " reviewed";
    $("summary-lead").textContent = total
      ? "Nice work. Your next reviews are already scheduled on this device."
      : "No cards were reviewed in this session.";
    $("summary-stats").innerHTML =
      "<li><strong>" + c.again + "</strong>Again</li>" +
      "<li><strong>" + c.hard + "</strong>Hard</li>" +
      "<li><strong>" + c.good + "</strong>Good</li>" +
      "<li><strong>" + c.easy + "</strong>Easy</li>";
  }

  function startSession(deckId, mode) {
    var queue;
    if (mode === "cram") {
      if (!IS_PRO) {
        notify("Cram mode is in the Pro version.");
        return;
      }
      queue = cardsIn(deckId).map(function (c) { return c.id; });
      for (var i = queue.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = queue[i]; queue[i] = queue[j]; queue[j] = tmp;
      }
    } else {
      queue = dueReviews(deckId).map(function (c) { return c.id; })
        .concat(newAvailable(deckId).map(function (c) { return c.id; }));
    }
    if (!queue.length) {
      notify(mode === "cram" ? "This deck has no cards yet." : "Nothing is due in this deck.");
      return;
    }
    session = {
      deckId: deckId,
      mode: mode || "due",
      queue: queue,
      index: 0,
      flipped: false,
      done: 0,
      counts: { again: 0, hard: 0, good: 0, easy: 0 },
      undo: null
    };
    showView("study");
    renderHeader();
    renderStudyCard();
    $("flash").focus();
  }

  function flipCard() {
    if (view !== "study" || $("study-summary").hidden === false) return;
    if (!currentCard()) return;
    session.flipped = !session.flipped;
    renderStudyCard();
  }

  function applyRating(rating) {
    if (view !== "study" || session.mode === "cram" || !session.flipped) return;
    var card = currentCard();
    if (!card) return;
    session.undo = {
      card: {
        id: card.id,
        status: card.status,
        due: card.due,
        interval: card.interval,
        ease: card.ease,
        reps: card.reps,
        lapses: card.lapses,
        step: card.step
      },
      index: session.index,
      done: session.done,
      counts: { again: session.counts.again, hard: session.counts.hard, good: session.counts.good, easy: session.counts.easy },
      logLen: state.log.length
    };
    var next = schedule(card, rating, Date.now());
    card.status = next.status;
    card.due = next.due;
    card.interval = next.interval;
    card.ease = next.ease;
    card.reps = next.reps;
    card.lapses = next.lapses;
    card.step = next.step;
    state.isDemo = false;
    state.log.push({ at: Date.now(), rating: rating, cardId: card.id, deckId: card.deckId });
    session.counts[rating]++;
    session.done++;
    session.index++;
    session.flipped = false;
    save();
    if (session.index >= session.queue.length) showSummary();
    else renderStudyCard();
  }

  function undoReview() {
    if (!session || !session.undo) return;
    var u = session.undo;
    var card = cardById(u.card.id);
    if (card) {
      card.status = u.card.status;
      card.due = u.card.due;
      card.interval = u.card.interval;
      card.ease = u.card.ease;
      card.reps = u.card.reps;
      card.lapses = u.card.lapses;
      card.step = u.card.step;
    }
    state.log = state.log.slice(0, u.logLen);
    session.index = u.index;
    session.done = u.done;
    session.counts = u.counts;
    session.flipped = true;
    session.undo = null;
    save();
    $("study-active").hidden = false;
    $("study-summary").hidden = true;
    renderStudyCard();
    notify("Last rating undone.");
  }

  function cramNext() {
    if (!session || session.mode !== "cram") return;
    session.index++;
    session.done++;
    session.flipped = false;
    if (session.index >= session.queue.length) {
      $("study-active").hidden = true;
      $("study-summary").hidden = false;
      $("undo-review").hidden = true;
      $("study-deck").textContent = "Cram complete";
      $("study-progress").textContent = session.done + " card" + (session.done === 1 ? "" : "s");
      $("summary-lead").textContent = "Cram mode does not change your review schedule.";
      $("summary-stats").innerHTML = "";
      return;
    }
    renderStudyCard();
  }

  function renderBrowse() {
    var deck = deckById(browseDeckId);
    if (!deck) {
      renderLibrary();
      return;
    }
    showView("browse");
    renderHeader();
    $("browse-deck").textContent = deck.name;
    var q = ($("card-search").value || "").trim().toLowerCase();
    var list = cardsIn(deck.id).filter(function (c) {
      if (!q) return true;
      return (c.front + " " + c.back + " " + c.hint).toLowerCase().indexOf(q) >= 0;
    });
    $("browse-count").textContent = list.length + " card" + (list.length === 1 ? "" : "s");
    var empty = $("card-empty");
    var ul = $("card-list");
    if (!list.length) {
      ul.innerHTML = "";
      empty.hidden = false;
      empty.textContent = q ? "No cards match that search." : "No cards in this deck yet. Add one to start studying.";
      return;
    }
    empty.hidden = true;
    ul.innerHTML = list.map(function (c) {
      return '<li class="entry">' +
        '<div class="entry-front">' + esc(c.front) + "</div>" +
        '<div class="entry-back">' + esc(c.back) + "</div>" +
        '<div class="entry-actions">' +
          '<button type="button" class="tiny-btn" data-edit-card="' + esc(c.id) + '" aria-label="Edit card">Edit</button>' +
        "</div></li>";
    }).join("");
  }

  /* ---------- modals ---------- */

  function openModal(id) {
    lastFocused = document.activeElement;
    $(id).hidden = false;
    var focusable = $(id).querySelector("input, textarea, button, [href]");
    if (focusable) focusable.focus();
  }

  function closeModal(id) {
    $(id).hidden = true;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function openDeckModal(id) {
    var deck = id ? deckById(id) : null;
    $("deck-title").textContent = deck ? "Edit deck" : "New deck";
    $("deck-id").value = deck ? deck.id : "";
    $("deck-name").value = deck ? deck.name : "";
    var color = deck ? deck.color : "copper";
    document.querySelectorAll('input[name="deck-color"]').forEach(function (r) {
      r.checked = r.value === color;
    });
    $("delete-deck").hidden = !deck;
    openModal("deck-modal");
  }

  function openCardModal(cardId, deckId) {
    var card = cardId ? cardById(cardId) : null;
    $("card-title").textContent = card ? "Edit card" : "New card";
    $("card-id").value = card ? card.id : "";
    $("card-deck").value = card ? card.deckId : deckId;
    $("card-front").value = card ? card.front : "";
    $("card-back").value = card ? card.back : "";
    $("card-hint").value = card ? card.hint : "";
    $("delete-card").hidden = !card;
    $("card-save-next").hidden = !!card;
    openModal("card-modal");
  }

  function fillSettings() {
    $("set-name").value = state.settings.name || "";
    $("set-new").value = state.settings.newPerDay || 20;
    $("settings-msg").textContent = "";
    $("settings-msg").classList.remove("is-error");
  }

  /* ---------- import / export ---------- */

  function download(filename, text, type) {
    var blob = new Blob([text], { type: type || "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  function parseCsv(text) {
    var rows = [];
    var i = 0;
    var field = "";
    var row = [];
    var inQ = false;
    text = String(text || "").replace(/^\ufeff/, "");
    while (i < text.length) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += ch;
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        if (row.some(function (cell) { return String(cell).trim(); })) rows.push(row);
        row = [];
      } else {
        field += ch;
      }
      i++;
    }
    if (field || row.length) {
      row.push(field);
      if (row.some(function (cell) { return String(cell).trim(); })) rows.push(row);
    }
    if (rows[0] && /^front$/i.test(String(rows[0][0] || "").trim())) rows.shift();
    return rows;
  }

  /* ---------- events ---------- */

  function onAddDeck() {
    if (!IS_PRO && state.decks.length >= MAX_DECKS_LITE) {
      notify(liteLimitMsg());
      return;
    }
    openDeckModal(null);
  }

  function bind() {
    document.querySelectorAll("[data-theme-btn]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!IS_PRO) return;
        state.settings.theme = btn.getAttribute("data-theme-btn");
        save();
        applyTheme();
      });
    });

    $("open-settings").addEventListener("click", function () {
      fillSettings();
      openModal("settings-modal");
    });
    $("open-settings-foot").addEventListener("click", function () {
      fillSettings();
      openModal("settings-modal");
    });
    document.querySelectorAll("[data-close-modal]").forEach(function (el) {
      el.addEventListener("click", function () { closeModal("settings-modal"); });
    });
    document.querySelectorAll("[data-close-deck]").forEach(function (el) {
      el.addEventListener("click", function () { closeModal("deck-modal"); });
    });
    document.querySelectorAll("[data-close-card]").forEach(function (el) {
      el.addEventListener("click", function () { closeModal("card-modal"); });
    });

    $("clear-demo").addEventListener("click", function () {
      if (!confirm("Clear the sample decks and start with an empty desk?")) return;
      state = defaultState();
      save();
      session = null;
      renderLibrary();
      notify("Demo data cleared. Add a deck to begin.");
    });

    $("add-deck").addEventListener("click", onAddDeck);
    $("study-all").addEventListener("click", function () { startSession(null, "due"); });

    $("deck-grid").addEventListener("click", function (e) {
      var study = e.target.closest("[data-study]");
      var browse = e.target.closest("[data-browse]");
      var edit = e.target.closest("[data-edit-deck]");
      if (study) startSession(study.getAttribute("data-study"), "due");
      else if (browse) {
        browseDeckId = browse.getAttribute("data-browse");
        $("card-search").value = "";
        renderBrowse();
      } else if (edit) openDeckModal(edit.getAttribute("data-edit-deck"));
    });

    $("deck-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var id = $("deck-id").value;
      var name = $("deck-name").value.trim();
      if (!name) return;
      var colorEl = document.querySelector('input[name="deck-color"]:checked');
      var color = colorEl ? colorEl.value : "copper";
      if (id) {
        var deck = deckById(id);
        if (deck) {
          deck.name = name;
          deck.color = color;
        }
      } else {
        if (!IS_PRO && state.decks.length >= MAX_DECKS_LITE) {
          notify(liteLimitMsg());
          return;
        }
        state.decks.push({ id: uid(), name: name, color: color, createdAt: Date.now() });
        state.isDemo = false;
      }
      save();
      closeModal("deck-modal");
      if (view === "browse") renderBrowse();
      else renderLibrary();
    });

    $("delete-deck").addEventListener("click", function () {
      var id = $("deck-id").value;
      var deck = deckById(id);
      if (!deck) return;
      if (!confirm("Delete “" + deck.name + "” and all of its cards? This cannot be undone.")) return;
      state.decks = state.decks.filter(function (d) { return d.id !== id; });
      state.cards = state.cards.filter(function (c) { return c.deckId !== id; });
      state.isDemo = false;
      save();
      closeModal("deck-modal");
      browseDeckId = null;
      renderLibrary();
      notify("Deck deleted.");
    });

    $("leave-study").addEventListener("click", function () {
      session = null;
      renderLibrary();
    });
    $("summary-done").addEventListener("click", function () {
      session = null;
      renderLibrary();
    });
    $("flash").addEventListener("click", flipCard);
    $("ratings").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-rate]");
      if (btn) applyRating(btn.getAttribute("data-rate"));
    });
    $("undo-review").addEventListener("click", undoReview);
    $("cram-next").addEventListener("click", cramNext);
    $("edit-current").addEventListener("click", function () {
      var card = currentCard();
      if (card) openCardModal(card.id, card.deckId);
    });

    $("leave-browse").addEventListener("click", function () {
      browseDeckId = null;
      renderLibrary();
    });
    $("browse-add").addEventListener("click", function () {
      if (!IS_PRO && state.cards.length >= MAX_CARDS_LITE) {
        notify(liteLimitMsg());
        return;
      }
      openCardModal(null, browseDeckId);
    });
    $("cram-deck").addEventListener("click", function () {
      startSession(browseDeckId, "cram");
    });
    $("card-search").addEventListener("input", renderBrowse);
    $("card-list").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-edit-card]");
      if (btn) openCardModal(btn.getAttribute("data-edit-card"), browseDeckId);
    });

    $("card-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var id = $("card-id").value;
      var deckId = $("card-deck").value;
      var front = $("card-front").value.trim();
      var back = $("card-back").value.trim();
      var hint = $("card-hint").value.trim();
      if (!front || !back || !deckId) return;
      var addAnother = e.submitter && e.submitter.id === "card-save-next";
      if (id) {
        var card = cardById(id);
        if (card) {
          card.front = front;
          card.back = back;
          card.hint = hint;
        }
      } else {
        if (!IS_PRO && state.cards.length >= MAX_CARDS_LITE) {
          notify(liteLimitMsg());
          return;
        }
        state.cards.push(blankCard(deckId, front, back, hint));
        state.isDemo = false;
      }
      save();
      if (addAnother) {
        $("card-id").value = "";
        $("card-front").value = "";
        $("card-back").value = "";
        $("card-hint").value = "";
        $("card-front").focus();
        notify("Card saved. Add another?");
      } else {
        closeModal("card-modal");
      }
      if (view === "study") renderStudyCard();
      else if (view === "browse") renderBrowse();
      else renderLibrary();
    });

    $("delete-card").addEventListener("click", function () {
      var id = $("card-id").value;
      if (!id) return;
      if (!confirm("Delete this card?")) return;
      state.cards = state.cards.filter(function (c) { return c.id !== id; });
      if (session && session.queue) {
        session.queue = session.queue.filter(function (cid) { return cid !== id; });
        if (session.index >= session.queue.length) session.index = Math.max(0, session.queue.length - 1);
      }
      state.isDemo = false;
      save();
      closeModal("card-modal");
      if (view === "study") {
        if (!session.queue.length) {
          session = null;
          renderLibrary();
        } else renderStudyCard();
      } else if (view === "browse") renderBrowse();
      else renderLibrary();
    });

    $("settings-form").addEventListener("submit", function (e) {
      e.preventDefault();
      state.settings.name = $("set-name").value.trim().slice(0, 40);
      if (IS_PRO) {
        var n = Number($("set-new").value);
        if (n >= 1 && n <= 200) state.settings.newPerDay = Math.round(n);
      }
      save();
      renderHeader();
      $("settings-msg").textContent = "Saved.";
      $("settings-msg").classList.remove("is-error");
    });

    $("export-data").addEventListener("click", function () {
      if (!IS_PRO) return;
      download("lumen-backup.json", JSON.stringify(state, null, 2), "application/json");
      $("settings-msg").textContent = "Backup file downloaded.";
    });

    $("import-data").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file || !IS_PRO) return;
      if (!confirm("Importing a JSON backup will replace the decks and cards currently on this device. Continue?")) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(String(reader.result || ""));
          state = sanitize(parsed);
          state.isDemo = false;
          save();
          session = null;
          closeModal("settings-modal");
          renderLibrary();
          notify("Backup imported.");
        } catch (err) {
          $("settings-msg").textContent = "That file could not be read as a Lumen backup.";
          $("settings-msg").classList.add("is-error");
        }
      };
      reader.readAsText(file);
    });

    $("import-csv").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file || !IS_PRO) return;
      var reader = new FileReader();
      reader.onload = function () {
        var rows = parseCsv(String(reader.result || ""));
        if (!rows.length) {
          $("settings-msg").textContent = "No cards found in that CSV.";
          $("settings-msg").classList.add("is-error");
          return;
        }
        var deck = { id: uid(), name: "Imported cards", color: "amber", createdAt: Date.now() };
        var n = 0;
        rows.forEach(function (row) {
          var front = String(row[0] || "").trim();
          var back = String(row[1] || "").trim();
          var hint = String(row[2] || "").trim();
          if (!front || !back) return;
          state.cards.push(blankCard(deck.id, front.slice(0, 500), back.slice(0, 800), hint.slice(0, 120)));
          n++;
        });
        if (!n) {
          $("settings-msg").textContent = "Each row needs a front and a back column.";
          $("settings-msg").classList.add("is-error");
          return;
        }
        var base = "Imported cards";
        var name = base;
        var k = 2;
        while (state.decks.some(function (d) { return d.name === name; })) {
          name = base + " " + k;
          k++;
        }
        deck.name = name;
        state.decks.push(deck);
        state.isDemo = false;
        save();
        closeModal("settings-modal");
        renderLibrary();
        notify(n + " card" + (n === 1 ? "" : "s") + " imported into “" + name + "”.");
      };
      reader.readAsText(file);
    });

    $("reset-data").addEventListener("click", function () {
      if (!confirm("Reset all decks, cards, and review history on this device?")) return;
      state = defaultState();
      save();
      session = null;
      closeModal("settings-modal");
      renderLibrary();
      notify("All data cleared.");
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (!$("card-modal").hidden) { closeModal("card-modal"); return; }
        if (!$("deck-modal").hidden) { closeModal("deck-modal"); return; }
        if (!$("settings-modal").hidden) { closeModal("settings-modal"); return; }
        if (view === "study") { session = null; renderLibrary(); }
        else if (view === "browse") { browseDeckId = null; renderLibrary(); }
        return;
      }
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (view !== "study" || $("study-summary").hidden === false) return;
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        if (!session.flipped) flipCard();
        else if (session.mode === "cram") cramNext();
        return;
      }
      if ((e.key === "u" || e.key === "U") && session.mode !== "cram") {
        e.preventDefault();
        undoReview();
        return;
      }
      if (session.mode === "cram") {
        if (session.flipped && (e.key === "3" || e.key === "4")) cramNext();
        return;
      }
      if (!session.flipped) return;
      if (e.key === "1") applyRating("again");
      else if (e.key === "2") applyRating("hard");
      else if (e.key === "3") applyRating("good");
      else if (e.key === "4") applyRating("easy");
    });
  }

  /* ---------- start ---------- */

  load();
  applyLiteChrome();
  bind();
  renderLibrary();
})();
