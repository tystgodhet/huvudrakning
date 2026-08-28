/* App controller: screens, profiles, config, drill loop, results, progress.
   All pure logic lives in problems/adaptive/stats; this file owns the DOM. */

import { keys, load, save, remove, exportProfile, exportAnalysis, sessionsToCSV, parseImport } from "./storage.js";
import { T, tipText, problemText } from "./i18n.js";
import { buildPresence, formatFamilyCode, generateFamilyCode, mergeFamilyMembers, normalizeFamilyCode, visibleFamilyCount } from "./family.js";
import {
  clearFamilyMembership,
  familySyncEnabled,
  fetchRoom,
  loadFamilyCode,
  loadFamilySnapshot,
  persistFamilyCode,
  publishPresence,
  unpublishPresence,
} from "./family-sync.js";
import { generateProblem, generateComposedProblem, componentPool, tipFor } from "./problems.js";
import {
  MUL_PROBES,
  PLACE_FAST_SEC,
  PLACE_PER_SKILL,
  PLACE_START_LVL,
  PLACE_TIMEOUT_SEC,
  maxOpenTable,
  mulPlacement,
  stepLevel,
} from "./placement.js";
import { nextLevel, isAdaptiveSkill } from "./adaptive.js";
import {
  COMP_MAX_LVL,
  COMP_ORDER,
  GOLD_FAST_SEC,
  GOLD_N,
  adjustComponents,
  classifyError,
  compAccuracy,
  defaultComps,
  errorInsights,
  factKey,
  factState,
  goldEligible,
  median,
  migrateComps,
  nextRetry,
  recordResult,
  scheduleRetry,
  updateFactAfterAnswer,
  weakestOpen,
} from "./ladder.js";
import { RAMP_DAYS, allQuestsDone, dayKey, distinctDays, generateQuests, questEvent, questsStale } from "./quests.js";
import { dayStreak, lastPractice, personalBest, thenVsNow, masteryByTable } from "./stats.js";
import { sessionChartSVG } from "./charts.js";

const $ = (id) => document.getElementById(id);

const SKILLS = ["add", "sub", "mul", "div", "invest", "mix"];
const SKILL_ICONS = { add: "➕", sub: "➖", mul: "✖️", div: "➗", invest: "📈", mix: "🎲" };
const EMOJIS = ["🦊", "🐯", "🦁", "🐸", "🦄", "🐼", "🐙", "🦈", "🚀", "⚡", "🌟", "🏀"];
const DURATIONS = [60, 90, 120];
const DEFAULT_DURATION = 90;
const MISS_CAP = 60;
const ANSWER_MAX_LEN = 5;
const FEEDBACK_OK_MS = 250;

let lang = load(keys.lang) || "sv";
let profiles = load(keys.profiles) || [];
let currentProfile = null;
let pstate = null; // {levels, misses, config}
let sessions = []; // current profile's history, append-only
let drill = null;
let progSkill = "mul";
let npEmoji = EMOJIS[0];
let sdSession = null; // session record shown in the detail view
let sdFilter = "all"; // "all" | "focus"
let remoteMembers = familySyncEnabled() && loadFamilyCode() ? loadFamilySnapshot() : [];
let familyPulse = null;
let familyJoinOpen = false;

function t(key) {
  return T[lang][key];
}

function defaultState() {
  return {
    levels: { add: 1, sub: 1, invest: 1 },
    ladder: { comps: defaultComps(), facts: {}, due: [] },
    misses: [],
    quests: null, // {day, list} — regenerated when the day changes
    config: { skill: "mul", tables: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], duration: DEFAULT_DURATION },
  };
}

function normalizeState(s) {
  const d = defaultState();
  // profiles from the global-ladder era migrate their level to components
  const comps =
    s?.ladder?.comps && typeof s.ladder.comps === "object"
      ? { ...defaultComps(), ...s.ladder.comps }
      : s?.ladder?.level
        ? migrateComps(s.ladder.level)
        : defaultComps();
  return {
    levels: { ...d.levels, ...(s?.levels || {}) },
    ladder: {
      comps,
      facts: s?.ladder?.facts && typeof s.ladder.facts === "object" ? s.ladder.facts : {},
      due: Array.isArray(s?.ladder?.due) ? s.ladder.due : [],
    },
    misses: Array.isArray(s?.misses) ? s.misses.slice(-MISS_CAP) : [],
    quests: s?.quests && typeof s.quests === "object" ? s.quests : null,
    config: { ...d.config, ...(s?.config || {}) },
  };
}

function fmtNum(x) {
  const s = String(Math.round(x * 10) / 10);
  return lang === "sv" ? s.replace(".", ",") : s;
}

function fmtSec(x) {
  const s = (Math.round(x * 10) / 10).toFixed(1);
  return (lang === "sv" ? s.replace(".", ",") : s) + " s";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============ celebrations ============ */
/* Juice reserved for mastery moments (level up, unlock, gold, PB, quest) —
   never for raw play time. Skipped under prefers-reduced-motion. */
const CF_COLORS = ["#2B50E0", "#2FA36B", "#FFC53D", "#E5484D", "#9B59E0"];

function reducedMotion() {
  return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function celebrate(n = 70) {
  if (reducedMotion()) return;
  const host = $("cfHost");
  for (let i = 0; i < n; i++) {
    const s = document.createElement("i");
    s.className = "cf";
    s.style.left = Math.random() * 100 + "%";
    s.style.background = CF_COLORS[i % CF_COLORS.length];
    s.style.animationDelay = (Math.random() * 0.5).toFixed(2) + "s";
    s.style.animationDuration = (1.4 + Math.random() * 1.3).toFixed(2) + "s";
    s.style.setProperty("--rot", Math.round(Math.random() * 720 - 360) + "deg");
    s.style.setProperty("--drift", Math.round(Math.random() * 140 - 70) + "px");
    s.addEventListener("animationend", () => s.remove());
    host.appendChild(s);
  }
}

/** Show a result banner with a small pop-in. */
function showBanner(el, html) {
  el.style.display = "block";
  el.innerHTML = html;
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
}

/** Animate a number counting up (used for the result hero). */
function countUp(el, to) {
  if (to <= 0 || reducedMotion()) {
    el.textContent = to;
    return;
  }
  const t0 = performance.now();
  const dur = 600;
  const step = (now) => {
    const f = Math.min(1, (now - t0) / dur);
    el.textContent = Math.round(to * (1 - Math.pow(1 - f, 3)));
    if (f < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
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
  if (sdSession && $("scr-sessdetail").classList.contains("visible")) renderSessDetail();
}

/* ============ navigation ============ */
const SCREENS = ["profiles", "home", "drill", "result", "progress", "sessdetail", "place"];
function show(name) {
  SCREENS.forEach((s) => $("scr-" + s).classList.toggle("visible", s === name));
  const navMap = { home: "nav-home", progress: "nav-progress", sessdetail: "nav-progress", profiles: "nav-profiles" };
  document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
  if (navMap[name]) $(navMap[name]).classList.add("active");
  if (name === "progress") renderProgress();
  if (name === "home" || name === "profiles") {
    if (name === "profiles") renderFamilyCard();
    touchFamilySync();
  } else {
    stopFamilyPulse();
  }
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

/** This device's sessions for a profile — in-memory for the current one. */
function sessionsFor(id) {
  if (currentProfile && id === currentProfile.id) return sessions;
  return load(keys.sessions(id)) || [];
}

function fmtPracticeDate(at) {
  const locale = lang === "sv" ? "sv-SE" : "en-GB";
  const d = new Date(at);
  const opts = { day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(locale, opts);
}

function practiceWhen(lp) {
  return lp.kind === "today"
    ? t("lastPracticeToday")
    : lp.kind === "yesterday"
      ? t("lastPracticeYesterday")
      : lp.kind === "never"
        ? t("lastPracticeNever")
        : fmtPracticeDate(lp.at);
}

function practiceSig(when, streak) {
  return streak > 0 ? `${when} · 🔥 ${streak}` : when;
}

/** Glanceable last-practice + streak for one local profile. Own history only. */
function practiceMeta(timestamps) {
  const lp = lastPractice(timestamps);
  return { kind: lp.kind, text: practiceSig(practiceWhen(lp), dayStreak(timestamps)) };
}

function remoteMeta(member) {
  const lp = lastPractice(member.lastAt == null ? [] : [member.lastAt]);
  const when = practiceWhen(lp);
  return { kind: lp.kind, text: `${practiceSig(when, member.streak || 0)} · ${t("familyRemote")}` };
}

function visibleRemotes() {
  if (!familySyncEnabled() || !loadFamilyCode()) return [];
  return mergeFamilyMembers(profiles, remoteMembers);
}

function chipHtml(emoji, name, sig) {
  return `<span class="em">${emoji}</span><span class="family-body"><span class="name">${escapeHtml(name)}</span><span class="sig">${escapeHtml(sig)}</span></span>`;
}

function renderFamilyRow() {
  const row = $("familyRow");
  if (!row) return;
  const remotes = visibleRemotes();
  if (visibleFamilyCount(profiles, remotes) < 2) {
    row.hidden = true;
    row.innerHTML = "";
    return;
  }
  row.hidden = false;
  row.innerHTML = "";
  profiles.forEach((p) => {
    const meta = practiceMeta(sessionsFor(p.id).map((s) => s.at));
    const b = document.createElement("button");
    const current = currentProfile && p.id === currentProfile.id;
    b.className = "family-chip" + (current ? " current" : "") + (meta.kind === "today" ? " today" : "");
    if (current) b.setAttribute("aria-current", "true");
    b.setAttribute("aria-label", `${p.name}, ${meta.text}`);
    b.innerHTML = chipHtml(p.emoji, p.name, meta.text);
    b.onclick = () => {
      selectProfile(p.id);
      show("home");
    };
    row.appendChild(b);
  });
  remotes.forEach((p) => {
    const meta = remoteMeta(p);
    const el = document.createElement("div");
    el.className = "family-chip remote" + (meta.kind === "today" ? " today" : "");
    el.setAttribute("aria-label", `${p.name}, ${meta.text}`);
    el.innerHTML = chipHtml(p.emoji, p.name, meta.text);
    row.appendChild(el);
  });
}

function renderProfiles() {
  const list = $("profList");
  list.innerHTML = "";
  profiles.forEach((p) => {
    const meta = practiceMeta(sessionsFor(p.id).map((s) => s.at));
    const b = document.createElement("button");
    const current = currentProfile && p.id === currentProfile.id;
    b.className = "prof-btn" + (current ? " current" : "") + (meta.kind === "today" ? " today" : "");
    if (current) b.setAttribute("aria-current", "true");
    b.innerHTML = `<span class="em">${p.emoji}</span><span class="prof-body"><span>${escapeHtml(p.name)}</span><span class="prof-sig">${escapeHtml(meta.text)}</span></span>`;
    b.onclick = () => {
      selectProfile(p.id);
      show("home");
    };
    list.appendChild(b);
  });
  visibleRemotes().forEach((p) => {
    const meta = remoteMeta(p);
    const el = document.createElement("div");
    el.className = "prof-btn remote" + (meta.kind === "today" ? " today" : "");
    el.setAttribute("aria-label", `${p.name}, ${meta.text}`);
    el.innerHTML = `<span class="em">${p.emoji}</span><span class="prof-body"><span>${escapeHtml(p.name)}</span><span class="prof-sig">${escapeHtml(meta.text)}</span></span>`;
    list.appendChild(el);
  });
  if (currentProfile) {
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = t("deleteProfile");
    del.onclick = () => {
      if (!confirm(t("confirmDelete"))) return;
      const id = currentProfile.id;
      const code = loadFamilyCode();
      profiles = profiles.filter((p) => p.id !== id);
      save(keys.profiles, profiles);
      remove(keys.state(id));
      remove(keys.sessions(id));
      if (code) unpublishPresence(code, id);
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
  renderFamilyCard();
}

$("npAdd").onclick = () => {
  const name = $("npName").value.trim();
  if (!name) return;
  const p = { id: "p" + Date.now(), name, emoji: npEmoji, createdAt: Date.now() };
  profiles.push(p);
  save(keys.profiles, profiles);
  $("npName").value = "";
  selectProfile(p.id);
  startPlacement(); // Duolingo-style: find the right starting level first
};

/* ============ family presence ============ */
/* Optional. Empty FAMILY_SYNC_URL keeps the row local-only (PR #11). */
const FAMILY_PULSE_MS = 60_000;

function renderFamilyCard() {
  const card = $("familyCard");
  if (!card) return;
  if (!familySyncEnabled()) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const code = loadFamilyCode();
  $("familyIdle").hidden = !!code;
  $("familyActive").hidden = !code;
  $("familyJoinRow").hidden = !familyJoinOpen || !!code;
  if (code) $("familyCodeShow").textContent = formatFamilyCode(code);
}

function stopFamilyPulse() {
  if (familyPulse) {
    clearInterval(familyPulse);
    familyPulse = null;
  }
}

function startFamilyPulse() {
  if (familyPulse || !familySyncEnabled() || !loadFamilyCode()) return;
  familyPulse = setInterval(() => {
    if (document.visibilityState === "hidden") return;
    const home = $("scr-home").classList.contains("visible");
    const prof = $("scr-profiles").classList.contains("visible");
    if (home || prof) touchFamilySync();
  }, FAMILY_PULSE_MS);
}

async function publishCurrent() {
  const code = loadFamilyCode();
  if (!familySyncEnabled() || !code || !currentProfile) return;
  const presence = buildPresence(
    currentProfile,
    sessions.map((s) => s.at)
  );
  if (presence) await publishPresence(code, presence);
}

async function publishAllLocals() {
  const code = loadFamilyCode();
  if (!familySyncEnabled() || !code) return;
  for (const p of profiles) {
    const presence = buildPresence(
      p,
      sessionsFor(p.id).map((s) => s.at)
    );
    if (presence) await publishPresence(code, presence);
  }
}

async function touchFamilySync() {
  if (!familySyncEnabled() || !loadFamilyCode()) {
    remoteMembers = [];
    renderFamilyRow();
    stopFamilyPulse();
    return;
  }
  await publishCurrent();
  remoteMembers = await fetchRoom(loadFamilyCode());
  renderFamilyRow();
  if ($("scr-profiles").classList.contains("visible")) renderProfiles();
  startFamilyPulse();
}

function joinFamily(code) {
  const n = persistFamilyCode(code);
  if (!n) return false;
  familyJoinOpen = false;
  if ($("familyJoinCode")) $("familyJoinCode").value = "";
  renderFamilyCard();
  publishAllLocals().then(() => touchFamilySync());
  return true;
}

$("familyCreate").onclick = () => joinFamily(generateFamilyCode());

$("familyJoinToggle").onclick = () => {
  familyJoinOpen = !familyJoinOpen;
  renderFamilyCard();
};

function submitFamilyJoin() {
  const n = normalizeFamilyCode($("familyJoinCode").value);
  if (!n) {
    alert(t("familyBadCode"));
    return;
  }
  joinFamily(n);
}

$("familyJoinBtn").onclick = submitFamilyJoin;
$("familyJoinCode").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitFamilyJoin();
  }
});

$("familyLeave").onclick = async () => {
  if (!confirm(t("familyLeaveConfirm"))) return;
  const code = loadFamilyCode();
  const ids = profiles.map((p) => p.id);
  clearFamilyMembership();
  remoteMembers = [];
  familyJoinOpen = false;
  stopFamilyPulse();
  renderFamilyCard();
  renderFamilyRow();
  renderProfiles();
  for (const id of ids) await unpublishPresence(code, id);
};

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const home = $("scr-home").classList.contains("visible");
  const prof = $("scr-profiles").classList.contains("visible");
  if (home || prof) touchFamilySync();
});

/* ============ export / import ============ */
function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function nameSlug() {
  return currentProfile.name.toLowerCase().replace(/[^a-z0-9åäö]+/gi, "-").replace(/^-|-$/g, "") || "profil";
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

$("exportBtn").onclick = () => {
  if (!currentProfile) {
    show("profiles");
    return;
  }
  const data = exportProfile(currentProfile, pstate, sessions);
  download(`huvudrakning-${nameSlug()}.json`, JSON.stringify(data, null, 2), "application/json");
};

// pseudonymized share: results + times, but no name or avatar
$("analysisBtn").onclick = () => {
  if (!currentProfile) {
    show("profiles");
    return;
  }
  const data = exportAnalysis(currentProfile, pstate, sessions);
  download(`huvudrakning-analys-${dateStamp()}.json`, JSON.stringify(data, null, 2), "application/json");
};

$("csvBtn").onclick = () => {
  if (!currentProfile) {
    show("profiles");
    return;
  }
  download(`huvudrakning-tal-${dateStamp()}.csv`, sessionsToCSV(sessions), "text/csv");
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

/* ============ placement test ============ */
/* Measurement, not practice: no misses, weights, sessions or streaks are
   produced, and there is no red/green judgment during the test. */
let placing = null;

function startPlacement() {
  placing = { stage: "add", lvl: PLACE_START_LVL, done: 0, results: {}, probeIdx: 0, probeHits: 0, probeCount: 0, count: 0, input: "", pStart: 0, timeout: null, current: null };
  $("placeIntro").style.display = "block";
  $("placeRun").style.display = "none";
  $("placeDone").style.display = "none";
  show("place");
}

function endPlacement() {
  if (placing) clearTimeout(placing.timeout);
  placing = null;
}

$("placeSkip").onclick = () => {
  endPlacement();
  show("home");
};

$("placeStart").onclick = () => {
  $("placeIntro").style.display = "none";
  $("placeRun").style.display = "block";
  const kp = $("pKeypad");
  kp.innerHTML = "";
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].forEach((k) => {
    const b = document.createElement("button");
    b.className = "key" + (k === "OK" ? " ok action" : k === "⌫" ? " action" : "");
    b.textContent = k;
    b.onclick = () => placePress(k);
    kp.appendChild(b);
  });
  nextPlaceProblem();
};

function placeGen() {
  if (placing.stage !== "mul") {
    return generateProblem({ skill: placing.stage, levels: { [placing.stage]: placing.lvl } });
  }
  const key = MUL_PROBES[placing.probeIdx];
  if (key === "big1") {
    const pool = componentPool("big1", 1);
    const [a, b] = pool[Math.floor(Math.random() * pool.length)];
    return { skill: "mul", a, b, op: "×", ans: a * b };
  }
  const tbl = +key.slice(1);
  const f = 3 + Math.floor(Math.random() * 7);
  const [a, b] = Math.random() < 0.5 ? [tbl, f] : [f, tbl];
  return { skill: "mul", a, b, op: "×", ans: a * b };
}

function nextPlaceProblem() {
  if (!placing) return;
  if (!$("scr-place").classList.contains("visible")) {
    endPlacement(); // the user navigated away mid-test
    return;
  }
  placing.current = placeGen();
  placing.input = "";
  placing.count++;
  const p = placing.current;
  $("pProblem").textContent = `${p.a} ${p.op} ${p.b}`;
  $("pMeta").textContent = `${t("placeItem")} ${placing.count} · ${T[lang].skills[placing.stage]}`;
  renderPlaceInput();
  placing.pStart = Date.now();
  clearTimeout(placing.timeout);
  placing.timeout = setTimeout(() => answerPlace(NaN, PLACE_TIMEOUT_SEC + 1), PLACE_TIMEOUT_SEC * 1000);
}

function renderPlaceInput() {
  $("pAnswer").innerHTML = escapeHtml(placing.input) + '<span class="caret"></span>';
}

function placePress(k) {
  if (!placing) return;
  if (k === "⌫") placing.input = placing.input.slice(0, -1);
  else if (k === "OK") {
    if (placing.input === "") return;
    answerPlace(parseInt(placing.input, 10), (Date.now() - placing.pStart) / 1000);
    return;
  } else if (placing.input.length < ANSWER_MAX_LEN) placing.input += k;
  renderPlaceInput();
}

function answerPlace(val, secs) {
  if (!placing) return;
  clearTimeout(placing.timeout);
  const ok = val === placing.current.ans;
  if (placing.stage !== "mul") {
    placing.lvl = stepLevel(placing.lvl, ok, secs);
    placing.done++;
    if (placing.done >= PLACE_PER_SKILL) {
      placing.results[placing.stage] = placing.lvl;
      if (placing.stage === "add") {
        placing.stage = "sub";
        placing.lvl = PLACE_START_LVL;
        placing.done = 0;
      } else {
        placing.stage = "mul";
      }
    }
  } else {
    placing.probeCount++;
    if (ok && secs <= PLACE_FAST_SEC) placing.probeHits++;
    if (placing.probeCount === 2) {
      const passed = placing.probeHits === 2;
      placing.probeCount = 0;
      placing.probeHits = 0;
      if (passed) placing.probeIdx++;
      if (!passed || placing.probeIdx >= MUL_PROBES.length) {
        finishPlacement(placing.probeIdx);
        return;
      }
    }
  }
  nextPlaceProblem();
}

function finishPlacement(mulPassed) {
  placing.results.mulPassed = mulPassed;
  $("placeRun").style.display = "none";
  $("placeDone").style.display = "block";
  const comps = mulPlacement(mulPassed);
  const bits = [
    `${T[lang].skills.add} ${t("lvl").toLowerCase()} ${placing.results.add}`,
    `${T[lang].skills.sub} ${t("lvl").toLowerCase()} ${placing.results.sub}`,
    t("placeTables")(maxOpenTable(comps)),
  ];
  if (comps.big1.open) bits.push(t("placeBig1"));
  $("placeSummary").textContent = `${t("placeYouStart")} ${bits.join(" · ")}`;
}

$("placeApply").onclick = () => {
  if (!placing || !pstate) return;
  pstate.levels.add = placing.results.add;
  pstate.levels.sub = placing.results.sub;
  pstate.ladder.comps = mulPlacement(placing.results.mulPassed);
  persistState();
  endPlacement();
  renderHome();
  show("home");
};

$("retakeBtn").onclick = () => {
  if (!currentProfile) return;
  if (!confirm(t("retakeConfirm"))) return;
  startPlacement();
};

/* ============ home / config ============ */
function renderHello() {
  if (!currentProfile) return;
  $("helloLine").textContent = `${t("hello")} ${currentProfile.name}! ${currentProfile.emoji}`;
}

function renderHome() {
  renderFamilyRow();
  renderSkillGrid();
  renderQuests();
  renderDailyStatus();
  renderDurations();
  renderStartBtn();
}

/* ============ daily quests ============ */
function ensureQuests() {
  if (!pstate) return;
  const day = dayKey();
  if (questsStale(pstate.quests, day)) {
    pstate.quests = generateQuests(
      {
        comps: pstate.ladder.comps,
        due: pstate.ladder.due,
        misses: pstate.misses,
        days: distinctDays(sessions.map((s) => s.at)),
      },
      day
    );
    persistState();
  }
}

function questLabel(q) {
  if (q.type === "session") return t("questSession");
  if (q.type === "fastFocus") return T[lang].questFastFocus({ n: q.target, name: t("compShort")(q.comp) });
  if (q.type === "clearMiss") return T[lang].questClearMiss({ n: q.target });
  return T[lang].questFastAny({ n: q.target });
}

function renderQuests() {
  const card = $("questCard");
  if (!pstate) {
    card.style.display = "none";
    return;
  }
  ensureQuests();
  card.style.display = "block";
  const host = $("questList");
  host.innerHTML = "";
  pstate.quests.list.forEach((q) => {
    const done = q.done >= q.target;
    const row = document.createElement("div");
    row.className = "q-row" + (done ? " done" : "");
    row.innerHTML = `<span class="q-check">${done ? "✅" : "⬜️"}</span><span class="q-lbl">${escapeHtml(questLabel(q))}</span><span class="q-prog">${Math.min(q.done, q.target)}/${q.target}</span>`;
    host.appendChild(row);
  });
  // habit ramp: one quest a day until the habit sticks, the rest teased
  if (pstate.quests.ramp) {
    const row = document.createElement("div");
    row.className = "q-row q-locked";
    const have = Math.min(distinctDays(sessions.map((s) => s.at)), RAMP_DAYS);
    row.innerHTML = `<span class="q-check">🔒</span><span class="q-lbl">${escapeHtml(T[lang].questRampLocked({ have, need: RAMP_DAYS }))}</span>`;
    host.appendChild(row);
  }
}

/* "Done for today": after the day's first real session the home screen says
   so instead of asking for more — the opposite of a countdown owl. */
function renderDailyStatus() {
  const streakEl = $("homeStreak");
  const doneEl = $("doneLine");
  if (!pstate) {
    streakEl.style.display = "none";
    doneEl.style.display = "none";
    return;
  }
  const streak = dayStreak(sessions.map((s) => s.at));
  streakEl.style.display = streak > 0 ? "block" : "none";
  streakEl.textContent = `🔥 ${streak} ${streak === 1 ? t("streak1") : t("streakN")}`;
  const sq = pstate.quests && pstate.quests.list.find((q) => q.type === "session");
  const done = !!sq && sq.done >= sq.target;
  doneEl.style.display = done ? "block" : "none";
  doneEl.textContent = `✅ ${t("doneToday")}`;
}

function renderSkillGrid() {
  const grid = $("skillGrid");
  grid.innerHTML = "";
  if (!pstate) return;
  SKILLS.forEach((s) => {
    const b = document.createElement("button");
    b.className = "skill-btn" + (pstate.config.skill === s ? " selected" : "");
    let lvlTxt;
    if (s === "mul") {
      const open = COMP_ORDER.filter((k) => pstate.ladder.comps[k]?.open).length;
      lvlTxt = `${open}/${COMP_ORDER.length} ${t("parts")}`;
    } else if (s === "div") lvlTxt = `${pstate.config.tables.length} ${t("tables")}`;
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
  const showTables = ["div", "mix"].includes(pstate.config.skill);
  $("tablesCard").style.display = showTables ? "block" : "none";
  if (showTables) renderTables();
  const showLadder = pstate.config.skill === "mul";
  $("ladderCard").style.display = showLadder ? "block" : "none";
  if (showLadder) renderLadder();
}

/* The ladder as a Duolingo-style winding path: one node per component,
   snaking down the card. Stars show the node's level, 🔒 locked, 👑 gold,
   a pulsing ring marks the session focus. A node at the top level can be
   tapped to attempt its mästarprov. */
const PATH_STEP = 78; // vertical rhythm px per node
const NODE_R = 31;

function renderLadder() {
  const host = $("ladderList");
  host.innerHTML = "";
  const comps = pstate.ladder.comps;
  const weak = weakestOpen(comps);

  const focusLine = document.createElement("p");
  focusLine.className = "sub ladder-focus";
  focusLine.textContent = `🎯 ${t("focusNow")} ${weak.map((k) => t("compShort")(k)).join(" & ")}`;
  host.appendChild(focusLine);

  const wrap = document.createElement("div");
  wrap.className = "path-wrap";
  const path = document.createElement("div");
  path.className = "path";
  path.style.height = COMP_ORDER.length * PATH_STEP + "px";
  const pt = (i) => ({ x: 50 + 34 * Math.sin((i * Math.PI) / 3), y: i * PATH_STEP + PATH_STEP / 2 });

  COMP_ORDER.forEach((k, i) => {
    if (i) {
      // dotted trail interpolated toward the previous node
      const prev = pt(i - 1);
      const here = pt(i);
      for (const f of [0.28, 0.5, 0.72]) {
        const d = document.createElement("i");
        d.className = "path-dot";
        d.style.left = `calc(${prev.x + (here.x - prev.x) * f}% - 2.5px)`;
        d.style.top = prev.y + (here.y - prev.y) * f - 2.5 + "px";
        path.appendChild(d);
      }
    }
    const { x, y } = pt(i);
    const c = comps[k];
    const b = document.createElement("button");
    b.type = "button";
    const cls = ["path-node"];
    let stars;
    if (!c?.open) {
      cls.push("locked");
      stars = "🔒";
    } else if (c.gold) {
      cls.push("gold");
      stars = "👑";
    } else {
      cls.push("open-node");
      stars = "★".repeat(c.lvl) + "☆".repeat(COMP_MAX_LVL - c.lvl);
      if (weak.includes(k)) cls.push("focus");
      if (goldEligible(c)) cls.push("ready");
    }
    b.className = cls.join(" ");
    b.style.left = `calc(${x}% - ${NODE_R}px)`;
    b.style.top = y - NODE_R + "px";
    const acc = c?.open ? compAccuracy(c) : null;
    if (acc !== null) b.title = `${Math.round(acc)} %`;
    b.innerHTML = `<span class="pn-lbl">${t("compNode")(k)}</span><span class="pn-stars">${stars}</span>`;
    if (goldEligible(c)) {
      b.onclick = () => {
        if (confirm(T[lang].goldConfirm({ name: t("compName")(k), n: GOLD_N, sec: GOLD_FAST_SEC }))) startGold(k);
      };
    }
    path.appendChild(b);
  });
  wrap.appendChild(path);
  host.appendChild(wrap);

  const ready = COMP_ORDER.filter((k) => goldEligible(comps[k]));
  if (ready.length) {
    const hint = document.createElement("p");
    hint.className = "sub gold-hint";
    hint.textContent = `👑 ${t("goldReady")} ${ready.map((k) => t("compShort")(k)).join(", ")}`;
    host.appendChild(hint);
  }

  // keep the frontier in view: scroll to the first focus node
  const focusIdx = COMP_ORDER.findIndex((k) => weak.includes(k));
  if (focusIdx > 1) wrap.scrollTop = focusIdx * PATH_STEP - 110;
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
  const needTables = pstate.config.skill === "div";
  btn.disabled = needTables && pstate.config.tables.length === 0;
  btn.textContent = `${t("start")} · ${pstate.config.duration} s`;
}

/* ============ drill ============ */
let goldRetry = null; // comp key when the result screen offers a challenge retry

$("startBtn").onclick = () => startDrill();
$("againBtn").onclick = () => (goldRetry ? startGold(goldRetry) : startDrill());
$("homeBtn").onclick = () => show("home");
$("quitBtn").onclick = () => {
  // quitting a mästarprov just abandons it — no record, no penalty
  if (drill && drill.gold) {
    clearTimeout(drill.feedbackTimeout);
    drill = null;
    show("home");
  } else endDrill();
};

function startDrill() {
  if (!pstate) return;
  goldRetry = null;
  ensureQuests();
  const skill = pstate.config.skill;
  const duration = pstate.config.duration || DEFAULT_DURATION;
  drill = {
    skill,
    level: isAdaptiveSkill(skill) ? pstate.levels[skill] : null,
    focus: skill === "mul" ? weakestOpen(pstate.ladder.comps) : null,
    duration,
    solveMs: 0, // accumulated pure solve time — the session clock
    running: false, // false while feedback/review shows: the clock is paused
    attempted: 0,
    correct: 0,
    times: [],
    misses: [],
    items: [],
    retries: [], // missed problems awaiting their guaranteed comeback
    questsDone: [], // quests completed during this session, cheered at the end
    current: null,
    input: "",
    locked: false,
    pStart: 0,
    timer: null,
    feedbackTimeout: null,
  };
  $("drillSkillLbl").textContent =
    skill === "mul"
      ? `${t("focusLbl")}: ${drill.focus.map((k) => t("compShort")(k)).join(" & ")}`
      : T[lang].skills[skill] + (isAdaptiveSkill(skill) ? ` · ${t("lvl")} ${drill.level}` : "");
  $("fbChip").textContent = "";
  $("tipEl").className = "tip";
  $("nextBtn").style.display = "none";
  $("keypad").classList.remove("disabled");
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

/* ---- mästarprov (gold challenge) ----
   GOLD_N problems in a row from one top-level component; every answer must
   be correct and within GOLD_FAST_SEC. No clock, no session record, no
   weight or miss updates — pure speed + precision, and failing is free. */
function startGold(key) {
  if (!pstate) return;
  goldRetry = null;
  drill = {
    gold: key,
    goldDone: 0,
    skill: "mul",
    current: null,
    input: "",
    locked: false,
    pStart: 0,
    running: false,
    feedbackTimeout: null,
  };
  $("drillSkillLbl").textContent = `👑 ${t("goldLbl")} · ${t("compShort")(key)}`;
  $("fbChip").textContent = "";
  $("tipEl").className = "tip";
  $("nextBtn").style.display = "none";
  $("keypad").classList.remove("disabled");
  const f = $("fuse"); // the bar fills with progress instead of burning down
  f.style.transition = "none";
  f.style.width = "0%";
  f.classList.remove("low");
  void f.offsetWidth;
  f.style.transition = "";
  $("drillCount").textContent = `0/${GOLD_N}`;
  buildKeypad();
  nextProblem();
  show("drill");
}

function goldProblem(key) {
  const pool = componentPool(key, COMP_MAX_LVL);
  const last = drill.current ? factKey(drill.current.a, drill.current.b) : null;
  let pair = pool[Math.floor(Math.random() * pool.length)];
  while (pool.length > 1 && factKey(pair[0], pair[1]) === last) {
    pair = pool[Math.floor(Math.random() * pool.length)];
  }
  let [a, b] = pair;
  if (Math.random() < 0.5) [a, b] = [b, a];
  return { skill: "mul", a, b, op: "×", ans: a * b };
}

function goldAnswer(ok, dt) {
  const fb = $("fbChip");
  fb.textContent = (ok ? "✓ " : "✗ ") + fmtSec(dt);
  fb.className = "fb-chip " + (ok ? "ok" : "bad");
  if (!ok || dt > GOLD_FAST_SEC) {
    endGold(false, { ok, dt });
    return;
  }
  drill.goldDone++;
  $("fuse").style.width = (drill.goldDone / GOLD_N) * 100 + "%";
  $("drillCount").textContent = `${drill.goldDone}/${GOLD_N}`;
  $("drillZone").className = "flash-ok";
  if (drill.goldDone >= GOLD_N) {
    endGold(true);
    return;
  }
  drill.feedbackTimeout = setTimeout(nextProblem, FEEDBACK_OK_MS);
}

function endGold(passed, fail) {
  clearTimeout(drill.feedbackTimeout);
  const d = drill;
  drill = null;
  if (passed) {
    pstate.ladder.comps[d.gold].gold = true;
    persistState();
  }
  $("resCorrect").textContent = passed ? "👑" : `${d.goldDone}/${GOLD_N}`;
  $("resHeroLbl").textContent = `${t("goldLbl")} · ${t("compShort")(d.gold)}`;
  $("statRow").style.display = "none";
  $("vsAvg").style.display = "none";
  $("missCard").style.display = "none";
  $("pbBanner").style.display = "none";
  $("questBanner").style.display = "none";
  let html;
  if (passed) {
    html = escapeHtml(`👑 ${t("goldPassedTitle")} ${T[lang].goldPassedLine(t("compName")(d.gold))}`);
  } else {
    const p = d.current;
    const detail = fail.ok
      ? T[lang].goldSlow({ t: fmtSec(fail.dt), sec: GOLD_FAST_SEC })
      : `✗ ${p.a} × ${p.b} = ${p.ans}`;
    html = escapeHtml(detail) + "<br>" + escapeHtml(T[lang].goldFailedLine({ done: d.goldDone, n: GOLD_N }));
  }
  showBanner($("promoBanner"), html);
  goldRetry = passed ? null : d.gold;
  $("againBtn").textContent = goldRetry ? t("goldTryAgain") : t("again");
  show("result");
  renderHome();
  if (passed) celebrate(140);
}

/* The session clock counts pure solve time only: it runs while a problem
   is on screen awaiting an answer and pauses during feedback and review. */
function remainingSec() {
  const solving = drill.running ? Date.now() - drill.pStart : 0;
  return Math.max(0, (drill.duration * 1000 - drill.solveMs - solving) / 1000);
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
  // a just-missed problem takes its guaranteed comeback slot when due
  const retry = drill.gold ? null : nextRetry(drill.retries);
  drill.current = drill.gold
    ? goldProblem(drill.gold)
    : retry
    ? { ...retry, fromRetry: true }
    : drill.skill === "mul"
      ? generateComposedProblem({ comps: pstate.ladder.comps, facts: pstate.ladder.facts, due: pstate.ladder.due })
      : generateProblem({
          skill: drill.skill,
          levels: pstate.levels,
          tables: pstate.config.tables,
          misses: pstate.misses,
        });
  drill.input = "";
  drill.locked = false;
  drill.pStart = Date.now();
  drill.running = true;
  $("tipEl").className = "tip";
  const p = drill.current;
  const el = $("problemEl");
  el.classList.toggle("long", p.skill === "invest");
  el.textContent = problemText(lang, p);
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
  if ($("scr-place").classList.contains("visible") && placing && $("placeRun").style.display === "block") {
    if (e.key >= "0" && e.key <= "9") placePress(e.key);
    else if (e.key === "Backspace") placePress("⌫");
    else if (e.key === "Enter") placePress("OK");
    return;
  }
  if (!$("scr-drill").classList.contains("visible")) return;
  if ($("nextBtn").style.display === "block") {
    if (e.key === "Enter" || e.key === " ") advanceReview();
    return;
  }
  if (e.key >= "0" && e.key <= "9") press(e.key);
  else if (e.key === "Backspace") press("⌫");
  else if (e.key === "Enter") press("OK");
});

function submit() {
  if (!drill || drill.input === "" || drill.locked) return;
  const p = drill.current;
  const val = parseInt(drill.input, 10);
  const dt = (Date.now() - drill.pStart) / 1000;
  if (drill.gold) {
    drill.locked = true;
    goldAnswer(val === p.ans, dt);
    return;
  }
  drill.solveMs += dt * 1000; // bank the solve time; the clock pauses now
  drill.running = false;
  drill.attempted++;
  drill.locked = true;
  const ok = val === p.ans;
  // full per-problem log so a session can be replayed in the detail view;
  // wrong answers also get an error class + direction for pattern insights
  const item = { skill: p.skill, a: p.a, b: p.b, op: p.op, ans: p.ans, given: val, ms: Math.round(dt * 1000), at: Date.now() };
  if (p.comp) item.comp = p.comp;
  if (!ok) {
    const cls = classifyError(p.ans, val);
    item.ek = cls.kind;
    item.ed = cls.dir;
  }
  drill.items.push(item);
  // instant feedback: right/wrong + time, always against the clock, never a sound
  const fb = $("fbChip");
  fb.textContent = (ok ? "✓ " : "✗ ") + fmtSec(dt);
  fb.className = "fb-chip " + (ok ? "ok" : "bad");
  // per-component rolling accuracy + practice weights + miss recurrence
  if (drill.skill === "mul") {
    if (p.comp) recordResult(pstate.ladder.comps, p.comp, ok);
    updateFactAfterAnswer(pstate.ladder.facts, pstate.ladder.due, factKey(p.a, p.b), ok, dt);
  }
  // daily quests tick along silently; completions are cheered at the end
  if (pstate.quests) {
    drill.questsDone.push(
      ...questEvent(pstate.quests, { type: "answer", ok, secs: dt, comp: p.comp, oldMiss: !!(p.fromDue || p.fromMiss) })
    );
  }
  const zone = $("drillZone");
  if (ok) {
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
    // self-paced review: clock stays paused until "Nästa tal" is pressed,
    // and the same problem is queued to return within a few problems
    scheduleRetry(drill.retries, { skill: p.skill, a: p.a, b: p.b, op: p.op, ans: p.ans, comp: p.comp });
    zone.className = "flash-bad";
    $("problemEl").textContent = problemText(lang, p) + (p.skill === "invest" ? ` → ${p.ans}` : ` = ${p.ans}`);
    const tip = $("tipEl");
    tip.textContent = "💡 " + tipText(lang, tipFor(p));
    tip.className = "tip show";
    $("keypad").classList.add("disabled");
    $("nextBtn").style.display = "block";
  }
  $("drillCount").textContent = `${drill.correct} ✓ · ${Math.ceil(remainingSec())}s`;
}

function advanceReview() {
  if (!drill) return;
  $("nextBtn").style.display = "none";
  $("keypad").classList.remove("disabled");
  nextProblem();
}

$("nextBtn").onclick = advanceReview;

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

  // personal best = most correct in a session for this skill, before this
  // one — compared within pure-time sessions only (old wall-clock records
  // measured something else and stay archived)
  const prev = personalBest(sessions.filter((s) => s.pure), d.skill);
  const isPB = d.correct > 0 && d.correct > (prev ? prev.bestCorrect : 0);

  const rec = {
    at: Date.now(),
    pure: true, // session clock counted pure solve time (review was free)
    skill: d.skill,
    level: isAdaptiveSkill(d.skill) ? d.level : null,
    focus: d.skill === "mul" ? d.focus : null,
    tables: ["div", "mix"].includes(d.skill) ? [...pstate.config.tables] : null,
    duration: d.duration,
    attempted: d.attempted,
    correct: d.correct,
    acc,
    avg: Math.round(avg * 10) / 10,
    med: d.times.length ? Math.round(median(d.times) * 10) / 10 : null,
    misses: d.misses,
    items: d.items,
  };
  sessions.push(rec); // append-only, never overwrite

  // per-component banding: hold each "deltal" in the 80–85 % accuracy band
  let compResult = { changes: [], opened: [] };
  if (d.skill === "mul") compResult = adjustComponents(pstate.ladder.comps);

  // the session itself can complete a quest (a real session: ≥5 attempts)
  let questsCleared = d.questsDone;
  if (pstate.quests) {
    questsCleared = questsCleared.concat(questEvent(pstate.quests, { type: "session", attempted: d.attempted }));
  }

  save(keys.sessions(currentProfile.id), sessions);
  persistState();
  publishCurrent();

  goldRetry = null;
  $("againBtn").textContent = t("again");
  $("resHeroLbl").textContent = t("solved");
  $("statRow").style.display = "flex";
  countUp($("resCorrect"), d.correct);
  $("resAcc").textContent = d.attempted ? acc + "%" : "–";
  $("resAvg").textContent = d.times.length ? rec.avg + "s" : "–";
  $("resLvl").textContent =
    d.skill === "mul"
      ? `${COMP_ORDER.filter((k) => pstate.ladder.comps[k]?.open).length}/${COMP_ORDER.length}` +
        (compResult.opened.length ? " ↑" : "")
      : isAdaptiveSkill(d.skill)
        ? newLevel + (newLevel > d.level ? " ↑" : newLevel < d.level ? " ↓" : "")
        : pstate.config.tables.length + " " + t("tables");
  const pb = $("pbBanner");
  if (isPB) showBanner(pb, escapeHtml("🏅 " + t("newPB")));
  else pb.style.display = "none";
  const promo = $("promoBanner");
  const promoBits = [];
  if (compResult.opened.length)
    promoBits.push(`🔓 ${t("unlocked")} ${compResult.opened.map((k) => t("compName")(k)).join(", ")}`);
  compResult.changes.forEach((c) =>
    promoBits.push(
      `${c.to > c.from ? "⬆️" : "🛟"} ${t("compName")(c.key)} ${c.to > c.from ? t("compUp") : t("compDown")} ${c.to}`
    )
  );
  if (promoBits.length) showBanner(promo, promoBits.map(escapeHtml).join("<br>"));
  else promo.style.display = "none";

  // quests completed this session get their cheer here, not mid-drill
  const qb = $("questBanner");
  if (questsCleared.length) {
    let qHtml = escapeHtml(`🎯 ${t("questDoneLine")} ${questsCleared.map((q) => questLabel(q)).join(" · ")}`);
    if (pstate.quests.list.length > 1 && allQuestsDone(pstate.quests)) qHtml += `<br>${escapeHtml("🎉 " + t("questAllDone"))}`;
    showBanner(qb, qHtml);
  } else qb.style.display = "none";

  // confetti only for mastery moments: level up, unlock, PB or a quest
  const leveledUp = compResult.changes.some((c) => c.to > c.from);
  if (isPB || leveledUp || compResult.opened.length || questsCleared.length) {
    celebrate(isPB || compResult.opened.length ? 100 : 60);
  }

  // session summary vs the player's OWN average — never vs other profiles
  const vs = $("vsAvg");
  const prior = sessions.slice(0, -1).filter((s) => s.skill === d.skill && s.pure);
  const priorSpd = prior.filter((s) => s.avg > 0);
  if (prior.length && d.attempted && d.times.length && priorSpd.length) {
    const accAvg = Math.round(prior.reduce((n, s) => n + s.acc, 0) / prior.length);
    const spdAvg = priorSpd.reduce((n, s) => n + s.avg, 0) / priorSpd.length;
    vs.style.display = "block";
    vs.textContent = "📊 " + t("vsAvg")({ acc: acc, accAvg, spd: fmtSec(rec.avg), spdAvg: fmtSec(spdAvg) });
  } else vs.style.display = "none";

  renderReviewList(d);
  show("result");
  renderHome();
}

/* "Worth extra practice": for the ladder it is driven by the practice
   weights (highest first); other skills list this session's misses. */
function renderReviewList(d) {
  const mc = $("missCard");
  const ml = $("missList");
  ml.innerHTML = "";
  if (d.skill === "mul") {
    const top = Object.entries(pstate.ladder.facts)
      .filter(([, f]) => f.w > 1)
      .sort((x, y) => y[1].w - x[1].w)
      .slice(0, 8);
    if (!top.length) {
      mc.style.display = "none";
      return;
    }
    mc.style.display = "block";
    top.forEach(([k, f]) => {
      const [a, b] = k.split("x");
      const row = document.createElement("div");
      const status = f.ok ? `<span class="slow-t">${fmtSec(f.t)}</span>` : `<span class="wrong">✗</span>`;
      row.innerHTML = `<span>${a} × ${b}</span><span>${status}<span class="right">${a * b}</span></span>`;
      ml.appendChild(row);
    });
    return;
  }
  if (d.misses.length) {
    mc.style.display = "block";
    d.misses.slice(0, 8).forEach((m) => {
      const row = document.createElement("div");
      row.innerHTML = `<span>${escapeHtml(problemText(lang, m))}</span><span><span class="wrong">${Number.isNaN(m.given) ? "–" : m.given}</span><span class="right">${m.ans}</span></span>`;
      ml.appendChild(row);
    });
  } else mc.style.display = "none";
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

  const best = personalBest(sessions.filter((s) => s.pure), progSkill);
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
  const tn = thenVsNow(sessions.filter((s) => s.pure), progSkill);
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
  const host = $("masteryHost");
  if (progSkill !== "mul" && progSkill !== "div") {
    card.style.display = "none";
    return;
  }
  card.style.display = "block";
  host.innerHTML = "";

  if (progSkill === "mul") {
    renderHeatmap(host);
    return;
  }

  // division keeps the per-table miss overview
  const counts = masteryByTable(pstate ? pstate.misses : [], "÷");
  const grid = document.createElement("div");
  grid.className = "mastery";
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
  host.appendChild(grid);
}

/* Mastery heatmap: one cell per fact. Green = fast + correct, yellow =
   correct but slow, red = missed last time, gray = not practiced yet. */
function renderHeatmap(host) {
  const facts = pstate ? pstate.ladder.facts : {};
  const grid = document.createElement("div");
  grid.className = "hm";
  grid.appendChild(document.createElement("i")); // corner
  for (let f = 1; f <= 10; f++) {
    const h = document.createElement("i");
    h.className = "hm-lbl";
    h.textContent = f;
    grid.appendChild(h);
  }
  for (let tbl = 1; tbl <= 12; tbl++) {
    const lbl = document.createElement("i");
    lbl.className = "hm-lbl";
    lbl.textContent = tbl;
    grid.appendChild(lbl);
    for (let f = 1; f <= 10; f++) {
      const c = document.createElement("i");
      c.className = "hm-cell hm-" + factState(facts[factKey(tbl, f)]);
      c.title = `${tbl} × ${f}`;
      grid.appendChild(c);
    }
  }
  host.appendChild(grid);

  // squares strip once that component is in reach
  const anySquare = Array.from({ length: 15 }, (_, i) => i + 11).some((n) => facts[factKey(n, n)]);
  if ((pstate && pstate.ladder.comps.sq?.open) || anySquare) {
    const cap = document.createElement("div");
    cap.className = "hm-cap";
    cap.textContent = t("squaresLbl") + " 11–25";
    host.appendChild(cap);
    const sq = document.createElement("div");
    sq.className = "hm-squares";
    for (let n = 11; n <= 25; n++) {
      const c = document.createElement("i");
      c.className = "hm-sq hm-" + factState(facts[factKey(n, n)]);
      c.textContent = n;
      c.title = `${n} × ${n}`;
      sq.appendChild(c);
    }
    host.appendChild(sq);
  }

  const leg = document.createElement("div");
  leg.className = "hm-legend";
  leg.innerHTML = [
    `<span><i class="hm-cell hm-green"></i>${t("hmFast")}</span>`,
    `<span><i class="hm-cell hm-yellow"></i>${t("hmSlow")}</span>`,
    `<span><i class="hm-cell hm-red"></i>${t("hmWrong")}</span>`,
    `<span><i class="hm-cell hm-gray"></i>${t("hmNew")}</span>`,
  ].join("");
  host.appendChild(leg);

  // error-direction tendencies, e.g. "tends to answer low on the 8s table"
  const insights = errorInsights(sessions).slice(0, 2);
  if (insights.length) {
    const box = document.createElement("div");
    box.className = "hm-insights";
    box.innerHTML = insights
      .map((i) => `📉 ${escapeHtml(t("insight")({ dir: i.dir, name: t("compName")("t" + i.table), count: i.count }))}`)
      .join("<br>");
    host.appendChild(box);
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
  data.forEach((s) => {
    const when = fmtWhen(s.at);
    const scope = sessScope(s);
    const row = document.createElement("button");
    row.className = "sess-item";
    row.innerHTML = `<span>${T[lang].skills[s.skill]}${scope}<br><span class="when">${when}</span></span>
      <span style="text-align:right; font-variant-numeric:tabular-nums;"><b>${s.correct}</b> ${t("correctOf")} ${s.attempted}<br><span class="when">${s.acc}% · ${s.avg}s</span></span>`;
    row.onclick = () => {
      sdSession = s;
      sdFilter = "all";
      renderSessDetail();
      show("sessdetail");
    };
    host.appendChild(row);
  });
}

function fmtWhen(at) {
  const locale = lang === "sv" ? "sv-SE" : "en-GB";
  const d = new Date(at);
  return (
    d.toLocaleDateString(locale, { day: "numeric", month: "short" }) +
    " " +
    d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
  );
}

function sessScope(s) {
  return s.tables && s.tables.length
    ? ` · ≤${Math.max(...s.tables)}`
    : s.ladder
      ? ` · ${t("lvl")} ${s.ladder}`
      : s.level
        ? ` · ${t("lvl")} ${s.level}`
        : "";
}

/* ============ session detail ============ */
const SLOW_MS = 5000; // correct answers slower than this get a ⚠️

function renderSessDetail() {
  const s = sdSession;
  if (!s) return;
  $("sdTitle").textContent = `${T[lang].skills[s.skill]}${sessScope(s)}`;
  $("sdMeta").textContent =
    `${fmtWhen(s.at)} · ${s.correct} ${t("correctOf")} ${s.attempted} · ${s.acc} % · ${fmtSec(s.avg)}/${lang === "sv" ? "tal" : "problem"}`;
  $("sdAll").classList.toggle("active", sdFilter === "all");
  $("sdFocus").classList.toggle("active", sdFilter === "focus");

  const host = $("sdList");
  host.innerHTML = "";
  const items = Array.isArray(s.items) ? s.items : [];
  if (!items.length) {
    host.innerHTML = `<p class="sub" style="margin:6px 0;">${t("noDetails")}</p>`;
    return;
  }
  const shown = items.filter((it) => {
    if (sdFilter === "all") return true;
    const ok = it.given === it.ans;
    return !ok || it.ms > SLOW_MS;
  });
  if (!shown.length) {
    host.innerHTML = `<p class="sub" style="margin:6px 0;">🎉 ${t("allClean")}</p>`;
    return;
  }
  shown.forEach((it) => {
    const ok = it.given === it.ans;
    const slow = ok && it.ms > SLOW_MS;
    const left =
      it.skill === "invest"
        ? `${problemText(lang, it)} <b>${it.ans}</b>`
        : `${it.a} ${it.op} ${it.b} = <b>${it.ans}</b>`;
    const res = !ok
      ? `<span class="sd-res bad">✗ ${Number.isNaN(it.given) ? "–" : it.given} · ${fmtSec(it.ms / 1000)}</span>`
      : slow
        ? `<span class="sd-res warn">⚠️ ✓ ${fmtSec(it.ms / 1000)}</span>`
        : `<span class="sd-res ok">✓ ${fmtSec(it.ms / 1000)}</span>`;
    const row = document.createElement("div");
    row.className = "sd-row";
    row.innerHTML = `<span class="sd-q">${left}</span>${res}`;
    host.appendChild(row);
  });
}

$("sdBack").onclick = () => show("progress");
$("sdAll").onclick = () => {
  sdFilter = "all";
  renderSessDetail();
};
$("sdFocus").onclick = () => {
  sdFilter = "focus";
  renderSessDetail();
};

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
