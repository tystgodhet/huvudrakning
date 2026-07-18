/* App controller: screens, profiles, config, drill loop, results, progress.
   All pure logic lives in problems/adaptive/stats; this file owns the DOM. */

import { keys, load, save, remove, exportProfile, parseImport } from "./storage.js";
import { T, tipText } from "./i18n.js";
import { generateProblem, tipFor } from "./problems.js";
import { nextLevel, isAdaptiveSkill } from "./adaptive.js";
import { dayStreak, personalBest, thenVsNow, masteryByTable } from "./stats.js";
import { sessionChartSVG } from "./charts.js";

const $ = (id) => document.getElementById(id);

const SKILLS = ["add", "sub", "mul", "div", "mix"];
const SKILL_ICONS = { add: "➕", sub: "➖", mul: "✖️", div: "➗", mix: "🎲" };
const EMOJIS = ["🦊", "🐯", "🦁", "🐸", "🦄", "🐼", "🐙", "🦈", "🚀", "⚡", "🌟", "🏀"];
const DURATIONS = [60, 90, 120];
const DEFAULT_DURATION = 90;
const MISS_CAP = 60;
const ANSWER_MAX_LEN = 5;
const FEEDBACK_OK_MS = 250;
const FEEDBACK_MISS_MS = 2600;

let lang = load(keys.lang) || "sv";
let profiles = load(keys.profiles) || [];
let currentProfile = null;
let pstate = null; // {levels, misses, config}
let sessions = []; // current profile's history, append-only
let drill = null;
let progSkill = "mul";
let npEmoji = EMOJIS[0];

function t(key) {
  return T[lang][key];
}

function defaultState() {
  return {
    levels: { add: 1, sub: 1 },
    misses: [],
    config: { skill: "mul", tables: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], duration: DEFAULT_DURATION },
  };
}

function normalizeState(s) {
  const d = defaultState();
  return {
    levels: { ...d.levels, ...(s?.levels || {}) },
    misses: Array.isArray(s?.misses) ? s.misses.slice(-MISS_CAP) : [],
    config: { ...d.config, ...(s?.config || {}) },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============ i18n ============ */
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i]").forEach((el) => {
    const v = T[lang][el.dataset.i];
    if (typeof v === "string") el.textContent = v;
  });
  document.querySelectorAll("[data-i-ph]").forEach((el) => {
    const v = T[lang][el.dataset.iPh];
    if (typeof v === "string") el.placeholder = v;
  });
  $("langBtn").textContent = lang === "sv" ? "EN" : "SV";
  $("brandSub").textContent = t("brandSub");
  renderHome();
  renderHello();
  renderProfiles();
}

/* ============ navigation ============ */
const SCREENS = ["profiles", "home", "drill", "result", "progress"];
function show(name) {
  SCREENS.forEach((s) => $("scr-" + s).classList.toggle("visible", s === name));
  const navMap = { home: "nav-home", progress: "nav-progress", profiles: "nav-profiles" };
  document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
  if (navMap[name]) $(navMap[name]).classList.add("active");
  if (name === "progress") renderProgress();
}

/* ============ profiles ============ */
function selectProfile(id) {
  currentProfile = profiles.find((p) => p.id === id) || null;
  if (!currentProfile) return;
  pstate = normalizeState(load(keys.state(id)));
  sessions = load(keys.sessions(id)) || [];
  $("profChip").textContent = currentProfile.emoji;
  renderHello();
  renderHome();
  renderProfiles();
}

function persistState() {
  if (currentProfile) save(keys.state(currentProfile.id), pstate);
}

function renderProfiles() {
  const list = $("profList");
  list.innerHTML = "";
  profiles.forEach((p) => {
    const b = document.createElement("button");
    b.className = "prof-btn" + (currentProfile && p.id === currentProfile.id ? " current" : "");
    b.innerHTML = `<span class="em">${p.emoji}</span><span>${escapeHtml(p.name)}</span>`;
    b.onclick = () => {
      selectProfile(p.id);
      show("home");
    };
    list.appendChild(b);
  });
  if (currentProfile) {
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = t("deleteProfile");
    del.onclick = () => {
      if (!confirm(t("confirmDelete"))) return;
      const id = currentProfile.id;
      profiles = profiles.filter((p) => p.id !== id);
      save(keys.profiles, profiles);
      remove(keys.state(id));
      remove(keys.sessions(id));
      currentProfile = null;
      pstate = null;
      sessions = [];
      $("profChip").textContent = "👤";
      if (profiles.length) selectProfile(profiles[0].id);
      renderProfiles();
      renderHome();
    };
    list.appendChild(del);
  }
  const er = $("npEmojis");
  er.innerHTML = "";
  EMOJIS.forEach((e) => {
    const b = document.createElement("button");
    b.textContent = e;
    b.className = e === npEmoji ? "on" : "";
    b.onclick = () => {
      npEmoji = e;
      renderProfiles();
    };
    er.appendChild(b);
  });
}

$("npAdd").onclick = () => {
  const name = $("npName").value.trim();
  if (!name) return;
  const p = { id: "p" + Date.now(), name, emoji: npEmoji, createdAt: Date.now() };
  profiles.push(p);
  save(keys.profiles, profiles);
  $("npName").value = "";
  selectProfile(p.id);
  show("home");
};

/* ============ export / import ============ */
$("exportBtn").onclick = () => {
  if (!currentProfile) {
    show("profiles");
    return;
  }
  const data = exportProfile(currentProfile, pstate, sessions);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const slug = currentProfile.name.toLowerCase().replace(/[^a-z0-9åäö]+/gi, "-").replace(/^-|-$/g, "") || "profil";
  a.download = `huvudrakning-${slug}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const { profile, state, sessions: sess } = parseImport(await file.text());
    const existing = profiles.find((p) => p.id === profile.id);
    if (existing && !confirm(t("importReplace"))) return;
    if (existing) Object.assign(existing, profile);
    else profiles.push(profile);
    save(keys.profiles, profiles);
    save(keys.state(profile.id), normalizeState(state));
    save(keys.sessions(profile.id), sess);
    selectProfile(profile.id);
    alert(t("importOk"));
    show("home");
  } catch {
    alert(t("importErr"));
  }
};

/* ============ home / config ============ */
function renderHello() {
  if (!currentProfile) return;
  $("helloLine").textContent = `${t("hello")} ${currentProfile.name}! ${currentProfile.emoji}`;
}

function renderHome() {
  renderSkillGrid();
  renderDurations();
  renderStartBtn();
}

function renderSkillGrid() {
  const grid = $("skillGrid");
  grid.innerHTML = "";
  if (!pstate) return;
  SKILLS.forEach((s) => {
    const b = document.createElement("button");
    b.className = "skill-btn" + (pstate.config.skill === s ? " selected" : "");
    let lvlTxt;
    if (s === "mul" || s === "div") lvlTxt = `${pstate.config.tables.length} ${t("tables")}`;
    else if (s === "mix") lvlTxt = `${t("lvl")} ${pstate.levels.add}/${pstate.levels.sub}`;
    else lvlTxt = `${t("lvl")} ${pstate.levels[s]}`;
    b.innerHTML = `<div class="big">${SKILL_ICONS[s]}</div><div class="name">${T[lang].skills[s]}</div><div class="lvl">${lvlTxt}</div>`;
    b.onclick = () => {
      pstate.config.skill = s;
      persistState();
      renderHome();
    };
    grid.appendChild(b);
  });
  const showTables = ["mul", "div", "mix"].includes(pstate.config.skill);
  $("tablesCard").style.display = showTables ? "block" : "none";
  if (showTables) renderTables();
}

function renderTables() {
  const wrap = $("tablesWrap");
  wrap.innerHTML = "";
  for (let i = 1; i <= 12; i++) {
    const b = document.createElement("button");
    b.className = "tbl" + (pstate.config.tables.includes(i) ? " on" : "");
    b.textContent = i;
    b.onclick = () => {
      const set = new Set(pstate.config.tables);
      set.has(i) ? set.delete(i) : set.add(i);
      pstate.config.tables = [...set].sort((x, y) => x - y);
      persistState();
      renderHome();
    };
    wrap.appendChild(b);
  }
}

document.querySelectorAll(".quick[data-upto]").forEach((q) => {
  q.onclick = () => {
    if (!pstate) return;
    const upto = parseInt(q.dataset.upto, 10);
    pstate.config.tables = Array.from({ length: upto }, (_, i) => i + 1);
    persistState();
    renderHome();
  };
});

function renderDurations() {
  const row = $("durRow");
  row.innerHTML = "";
  if (!pstate) return;
  DURATIONS.forEach((sec) => {
    const b = document.createElement("button");
    b.className = "dur" + (pstate.config.duration === sec ? " active" : "");
    b.textContent = sec + " s";
    b.onclick = () => {
      pstate.config.duration = sec;
      persistState();
      renderHome();
    };
    row.appendChild(b);
  });
}

function renderStartBtn() {
  const btn = $("startBtn");
  if (!pstate) return;
  const needTables = pstate.config.skill === "mul" || pstate.config.skill === "div";
  btn.disabled = needTables && pstate.config.tables.length === 0;
  btn.textContent = `${t("start")} · ${pstate.config.duration} s`;
}

/* ============ drill ============ */
$("startBtn").onclick = () => startDrill();
$("againBtn").onclick = () => startDrill();
$("homeBtn").onclick = () => show("home");
$("quitBtn").onclick = () => endDrill();

function startDrill() {
  if (!pstate) return;
  const skill = pstate.config.skill;
  const duration = pstate.config.duration || DEFAULT_DURATION;
  drill = {
    skill,
    level: isAdaptiveSkill(skill) ? pstate.levels[skill] : null,
    duration,
    deadline: Date.now() + duration * 1000,
    attempted: 0,
    correct: 0,
    times: [],
    misses: [],
    current: null,
    input: "",
    locked: false,
    pStart: 0,
    timer: null,
    feedbackTimeout: null,
  };
  $("drillSkillLbl").textContent =
    T[lang].skills[skill] + (isAdaptiveSkill(skill) ? ` · ${t("lvl")} ${drill.level}` : "");
  $("tipEl").className = "tip";
  buildKeypad();
  nextProblem();
  show("drill");
  initFuse();
  drill.timer = setInterval(tickDrill, 250);
}

function initFuse() {
  const f = $("fuse");
  f.style.transition = "none";
  f.style.width = "100%";
  f.classList.remove("low");
  void f.offsetWidth;
  f.style.transition = "";
  tickDrill();
}

function remainingSec() {
  return Math.max(0, (drill.deadline - Date.now()) / 1000);
}

function tickDrill() {
  if (!drill) return;
  const rem = remainingSec();
  const f = $("fuse");
  f.style.width = (rem / drill.duration) * 100 + "%";
  f.classList.toggle("low", rem <= 15);
  $("drillCount").textContent = `${drill.correct} ✓ · ${Math.ceil(rem)}s`;
  if (rem <= 0) endDrill();
}

function nextProblem() {
  if (!drill) return;
  drill.current = generateProblem({
    skill: drill.skill,
    levels: pstate.levels,
    tables: pstate.config.tables,
    misses: pstate.misses,
  });
  drill.input = "";
  drill.locked = false;
  drill.pStart = Date.now();
  $("tipEl").className = "tip";
  const p = drill.current;
  $("problemEl").textContent = `${p.a} ${p.op} ${p.b}`;
  renderInput();
  $("drillZone").className = "";
}

function renderInput() {
  $("answerEl").innerHTML = escapeHtml(drill.input) + '<span class="caret"></span>';
}

function buildKeypad() {
  const kp = $("keypad");
  kp.innerHTML = "";
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].forEach((k) => {
    const b = document.createElement("button");
    b.className = "key" + (k === "OK" ? " ok action" : k === "⌫" ? " action" : "");
    b.textContent = k;
    b.onclick = () => press(k);
    kp.appendChild(b);
  });
}

function press(k) {
  if (!drill || drill.locked) return;
  if (k === "⌫") drill.input = drill.input.slice(0, -1);
  else if (k === "OK") {
    submit();
    return;
  } else if (drill.input.length < ANSWER_MAX_LEN) drill.input += k;
  renderInput();
}

window.addEventListener("keydown", (e) => {
  if (!$("scr-drill").classList.contains("visible")) return;
  if (e.key >= "0" && e.key <= "9") press(e.key);
  else if (e.key === "Backspace") press("⌫");
  else if (e.key === "Enter") press("OK");
});

function submit() {
  if (!drill || drill.input === "" || drill.locked) return;
  const p = drill.current;
  const val = parseInt(drill.input, 10);
  const dt = (Date.now() - drill.pStart) / 1000;
  drill.attempted++;
  drill.locked = true;
  const zone = $("drillZone");
  if (val === p.ans) {
    drill.correct++;
    drill.times.push(dt);
    // a miss is cleared once answered correctly
    pstate.misses = pstate.misses.filter((m) => !(m.skill === p.skill && m.a === p.a && m.b === p.b && m.op === p.op));
    zone.className = "flash-ok";
    drill.feedbackTimeout = setTimeout(nextProblem, FEEDBACK_OK_MS);
  } else {
    drill.misses.push({ a: p.a, b: p.b, op: p.op, ans: p.ans, given: val, skill: p.skill });
    pstate.misses.push({ a: p.a, b: p.b, op: p.op, ans: p.ans, skill: p.skill });
    if (pstate.misses.length > MISS_CAP) pstate.misses = pstate.misses.slice(-MISS_CAP);
    zone.className = "flash-bad";
    $("problemEl").textContent = `${p.a} ${p.op} ${p.b} = ${p.ans}`;
    const tip = $("tipEl");
    tip.textContent = "💡 " + tipText(lang, tipFor(p));
    tip.className = "tip show";
    drill.feedbackTimeout = setTimeout(nextProblem, FEEDBACK_MISS_MS);
  }
  $("drillCount").textContent = `${drill.correct} ✓ · ${Math.ceil(remainingSec())}s`;
}

function endDrill() {
  if (!drill) return;
  clearInterval(drill.timer);
  clearTimeout(drill.feedbackTimeout);
  const d = drill;
  drill = null;

  const acc = d.attempted ? Math.round((d.correct / d.attempted) * 100) : 0;
  const avg = d.times.length ? d.times.reduce((x, y) => x + y, 0) / d.times.length : 0;

  let newLevel = d.level;
  if (isAdaptiveSkill(d.skill)) {
    newLevel = nextLevel(d.level, d.attempted, d.correct);
    pstate.levels[d.skill] = newLevel;
  }

  // personal best = most correct in a session for this skill, before this one
  const prev = personalBest(sessions, d.skill);
  const isPB = d.correct > 0 && d.correct > (prev ? prev.bestCorrect : 0);

  const rec = {
    at: Date.now(),
    skill: d.skill,
    level: isAdaptiveSkill(d.skill) ? d.level : null,
    tables: ["mul", "div", "mix"].includes(d.skill) ? [...pstate.config.tables] : null,
    duration: d.duration,
    attempted: d.attempted,
    correct: d.correct,
    acc,
    avg: Math.round(avg * 10) / 10,
    misses: d.misses,
  };
  sessions.push(rec); // append-only, never overwrite
  save(keys.sessions(currentProfile.id), sessions);
  persistState();

  $("resCorrect").textContent = d.correct;
  $("resAcc").textContent = d.attempted ? acc + "%" : "–";
  $("resAvg").textContent = d.times.length ? rec.avg + "s" : "–";
  $("resLvl").textContent = isAdaptiveSkill(d.skill)
    ? newLevel + (newLevel > d.level ? " ↑" : newLevel < d.level ? " ↓" : "")
    : pstate.config.tables.length + " " + t("tables");
  const pb = $("pbBanner");
  pb.style.display = isPB ? "block" : "none";
  pb.textContent = "🏅 " + t("newPB");

  const mc = $("missCard");
  const ml = $("missList");
  ml.innerHTML = "";
  if (d.misses.length) {
    mc.style.display = "block";
    d.misses.slice(0, 8).forEach((m) => {
      const row = document.createElement("div");
      row.innerHTML = `<span>${m.a} ${m.op} ${m.b}</span><span><span class="wrong">${Number.isNaN(m.given) ? "–" : m.given}</span><span class="right">${m.ans}</span></span>`;
      ml.appendChild(row);
    });
  } else mc.style.display = "none";

  show("result");
  renderHome();
}

/* ============ progress ============ */
function renderProgress() {
  const streak = dayStreak(sessions.map((s) => s.at));
  $("streakTxt").textContent = `${streak} ${streak === 1 ? t("streak1") : t("streakN")} · ${sessions.length} ${t("day")}`;

  const tabs = $("progTabs");
  tabs.innerHTML = "";
  SKILLS.forEach((s) => {
    const b = document.createElement("button");
    b.className = "chip" + (progSkill === s ? " active" : "");
    b.textContent = T[lang].skills[s];
    b.onclick = () => {
      progSkill = s;
      renderProgress();
    };
    tabs.appendChild(b);
  });

  const data = sessions.filter((s) => s.skill === progSkill).slice(-14);
  $("chartTitle").textContent = T[lang].skills[progSkill];

  const best = personalBest(sessions, progSkill);
  $("pbLine").textContent = best
    ? `🏅 ${t("pb")}: ${best.bestCorrect} ${t("correctWord")}` + (best.bestAvg !== null ? ` · ${best.bestAvg} ${t("perProblem")}` : "")
    : "";

  const host = $("chartHost");
  const svg = sessionChartSVG(data);
  host.innerHTML = svg || `<p class="sub" style="margin:6px 0;">${t("noSessions")}</p>`;

  renderThenNow();
  renderMastery();
  renderSessList();
}

function renderThenNow() {
  const card = $("tnCard");
  const tn = thenVsNow(sessions, progSkill);
  if (!tn) {
    card.style.display = "none";
    return;
  }
  card.style.display = "block";
  const delta = (a, b, betterIsHigher, unit) => {
    const diff = Math.round((b - a) * 10) / 10;
    if (diff === 0) return `<span class="tn-delta">±0</span>`;
    const good = betterIsHigher ? diff > 0 : diff < 0;
    return `<span class="tn-delta ${good ? "good" : "bad"}">${diff > 0 ? "+" : ""}${diff}${unit}</span>`;
  };
  const row = (label, thenV, nowV, betterIsHigher, unit) =>
    `<div class="tn-row"><span class="lbl">${label}</span><b>${thenV}${unit}</b><span class="tn-arrow">→</span><b>${nowV}${unit}</b>${delta(thenV, nowV, betterIsHigher, unit)}</div>`;
  $("tnGrid").innerHTML =
    `<div class="tn-head"><span class="lbl"></span><span>${t("tnThen")}</span><span></span><span>${t("tnNow")}</span><span></span></div>` +
    row(t("accuracy"), tn.then.acc, tn.now.acc, true, "%") +
    row(t("legendSpeed"), tn.then.avg, tn.now.avg, false, "s") +
    row(t("tnCorrect"), tn.then.correct, tn.now.correct, true, "");
}

function renderMastery() {
  const card = $("masteryCard");
  if (progSkill !== "mul" && progSkill !== "div") {
    card.style.display = "none";
    return;
  }
  card.style.display = "block";
  const counts = masteryByTable(pstate ? pstate.misses : [], progSkill === "mul" ? "×" : "÷");
  const grid = $("masteryGrid");
  grid.innerHTML = "";
  for (let i = 1; i <= 12; i++) {
    const c = document.createElement("div");
    const mc = counts[i] || 0;
    const inScope = pstate && pstate.config.tables.includes(i);
    c.className = "m-cell";
    if (inScope) {
      c.style.background = mc === 0 ? "#D9F2E4" : mc < 3 ? "#FFF1CC" : "#FBDCDD";
      c.style.color = mc === 0 ? "#1F7A4D" : mc < 3 ? "#8A6A12" : "#B03236";
    }
    c.innerHTML = `${i}<small>${inScope ? (mc === 0 ? "✓" : mc + "✗") : "·"}</small>`;
    grid.appendChild(c);
  }
}

function renderSessList() {
  const host = $("sessList");
  host.innerHTML = "";
  const data = sessions.slice(-10).reverse();
  if (!data.length) {
    host.innerHTML = `<p class="sub" style="margin:6px 0;">${t("noSessions")}</p>`;
    return;
  }
  const locale = lang === "sv" ? "sv-SE" : "en-GB";
  data.forEach((s) => {
    const d = new Date(s.at);
    const when =
      d.toLocaleDateString(locale, { day: "numeric", month: "short" }) +
      " " +
      d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    const scope =
      s.tables && s.tables.length ? ` · ≤${Math.max(...s.tables)}` : s.level ? ` · ${t("lvl")} ${s.level}` : "";
    const row = document.createElement("div");
    row.className = "sess-item";
    row.innerHTML = `<span>${T[lang].skills[s.skill]}${scope}<br><span class="when">${when}</span></span>
      <span style="text-align:right; font-variant-numeric:tabular-nums;"><b>${s.correct}</b> ${t("correctOf")} ${s.attempted}<br><span class="when">${s.acc}% · ${s.avg}s</span></span>`;
    host.appendChild(row);
  });
}

/* ============ wiring ============ */
$("nav-home").onclick = () => show(currentProfile ? "home" : "profiles");
$("nav-progress").onclick = () => show(currentProfile ? "progress" : "profiles");
$("nav-profiles").onclick = () => show("profiles");
$("profChip").onclick = () => show("profiles");
$("langBtn").onclick = () => {
  lang = lang === "sv" ? "en" : "sv";
  save(keys.lang, lang);
  applyLang();
};

applyLang();
if (profiles.length === 0) show("profiles");
else {
  selectProfile(profiles[0].id);
  show("home");
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
