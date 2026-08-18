/* Pure mastery logic for multiplication: per-component ("deltal") adaptive
   levels, active session composition, miss recurrence, practice weights and
   error classification. No DOM, no storage.

   Design principles: hold the player in an ~80–85 % accuracy band per
   component (raise a component's level above 85 %, lower it below 75 %) —
   there is no single global level. Sessions focus on the two weakest
   components; misses recur until solved fast twice in a row. */

export const BAND_UP = 85; // component acc above this → level up
export const BAND_DOWN = 75; // component acc below this → level down
export const COMP_MAX_LVL = 3;
export const COMP_WINDOW = 20; // rolling answers kept per component
export const COMP_MIN = 6; // attempts before the band acts

export const FOCUS_SHARE = 0.7; // ~70 % of problems from the weakest two
export const FOCUS_COUNT = 2;
export const DUE_RATE = 0.25; // recurring-miss injection rate
export const CLEAR_STREAK = 2; // fast solves in a row to clear a miss

export const FAST_SEC = 3; // "fast" bar: miss clearing + heatmap green
export const SLOW_SEC = 5; // answers slower than this raise the weight

export const W_WRONG = 3;
export const W_SLOW = 2;
export const W_FAST = 0.7;
export const W_MIN = 0.3;
export const W_MAX = 27;

/* Components in unlock order: each times table, then two-digit × one-digit,
   squares, and two-digit × two-digit. */
export const COMP_ORDER = [
  "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t11", "t12",
  "big1", "sq", "big2",
];

export function defaultComps() {
  const comps = {};
  COMP_ORDER.forEach((k, i) => {
    comps[k] = { open: i < 5, lvl: 1, recent: [] };
  });
  return comps;
}

/** Migrate a pre-component global ladder level (1–6) to component state. */
export function migrateComps(oldLevel) {
  const comps = defaultComps();
  const topTable = oldLevel >= 3 ? 12 : oldLevel === 2 ? 10 : 5;
  for (let n = 1; n <= 12; n++) comps["t" + n].open = n <= topTable;
  comps.big1.open = oldLevel >= 4;
  comps.sq.open = oldLevel >= 5;
  comps.big2.open = oldLevel >= 6;
  const lvl = Math.min(3, Math.max(1, oldLevel));
  for (let n = 1; n <= 12; n++) if (comps["t" + n].open) comps["t" + n].lvl = lvl;
  return comps;
}

/** Which component a fact belongs to (used for recurring misses). */
export function componentOf(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (a === b && a >= 11) return "sq";
  if (lo >= 11) return "big2";
  if (hi >= 13) return "big1";
  return "t" + hi;
}

/** Rolling accuracy % for a component, or null before COMP_MIN attempts. */
export function compAccuracy(c) {
  if (!c || !Array.isArray(c.recent) || c.recent.length < COMP_MIN) return null;
  return (100 * c.recent.reduce((s, x) => s + x, 0)) / c.recent.length;
}

/** The n weakest open components; barely-trained ones count as weakest. */
export function weakestOpen(comps, n = FOCUS_COUNT) {
  return COMP_ORDER.filter((k) => comps[k] && comps[k].open)
    .map((k) => ({ k, acc: compAccuracy(comps[k]) }))
    .sort((x, y) => (x.acc ?? -1) - (y.acc ?? -1))
    .slice(0, n)
    .map((o) => o.k);
}

/** Record one answer into a component's rolling window. */
export function recordResult(comps, key, ok) {
  const c = comps[key];
  if (!c) return;
  c.recent.push(ok ? 1 : 0);
  if (c.recent.length > COMP_WINDOW) c.recent.shift();
}

/**
 * End-of-session banding: raise a component's level above BAND_UP, lower it
 * below BAND_DOWN. A component mastered at the top level opens the next
 * locked component instead. Windows reset on every change so the new
 * difficulty gets a fresh measurement.
 */
export function adjustComponents(comps) {
  const changes = [];
  const opened = [];
  for (const k of COMP_ORDER) {
    const c = comps[k];
    if (!c || !c.open) continue;
    const acc = compAccuracy(c);
    if (acc === null) continue;
    if (acc > BAND_UP) {
      if (c.lvl < COMP_MAX_LVL) {
        changes.push({ key: k, from: c.lvl, to: c.lvl + 1 });
        c.lvl++;
        c.recent = [];
      } else {
        const next = COMP_ORDER.find((k2) => comps[k2] && !comps[k2].open);
        if (next) {
          comps[next].open = true;
          opened.push(next);
          c.recent = [];
        }
      }
    } else if (acc < BAND_DOWN && c.lvl > 1) {
      changes.push({ key: k, from: c.lvl, to: c.lvl - 1 });
      c.lvl--;
      c.recent = [];
      if (c.gold) c.gold = false; // gold is a live claim, not a trophy case
    }
  }
  return { changes, opened };
}

/* ---- mästarprov (gold) ----
   A voluntary challenge that gilds a component on the path: GOLD_N problems
   in a row, every one correct and solved within GOLD_FAST_SEC. Pure speed +
   precision — failing costs nothing and leaves no trace. */
export const GOLD_N = 10;
export const GOLD_FAST_SEC = 3;

/** A component can be challenged once it sits open at the top level. */
export function goldEligible(c) {
  return !!(c && c.open && c.lvl === COMP_MAX_LVL && !c.gold);
}

/** Canonical key for a multiplication fact: order-independent. */
export function factKey(a, b) {
  return Math.min(a, b) + "x" + Math.max(a, b);
}

/** New practice weight for a fact after an answer. */
export function updateWeight(prev, ok, seconds) {
  const factor = !ok ? W_WRONG : seconds > SLOW_SEC ? W_SLOW : W_FAST;
  const w = (prev || 1) * factor;
  return Math.round(Math.min(W_MAX, Math.max(W_MIN, w)) * 100) / 100;
}

/**
 * Update a fact's record and the recurring-miss queue after an answer.
 * A miss enters `due` and stays until the fact is solved fast (≤FAST_SEC)
 * CLEAR_STREAK times in a row; a slow or wrong answer breaks the chain.
 */
export function updateFactAfterAnswer(facts, due, key, ok, seconds) {
  const prev = facts[key] || {};
  let s = prev.s || 0;
  if (ok && seconds <= FAST_SEC) s += 1;
  else s = 0;
  facts[key] = { w: updateWeight(prev.w, ok, seconds), ok, t: Math.round(seconds * 10) / 10, s };
  const i = due.indexOf(key);
  if (!ok) {
    if (i === -1) due.push(key);
  } else if (s >= CLEAR_STREAK && i !== -1) due.splice(i, 1);
  return facts[key];
}

export const RETRY_MIN = 2; // a missed problem returns after 2–4 problems,
export const RETRY_MAX = 4; // while the memory trace from the review is fresh

/** Queue a just-missed problem for a guaranteed quick reappearance. */
export function scheduleRetry(retries, problem, rng = Math.random) {
  const gap = RETRY_MIN + Math.floor(rng() * (RETRY_MAX - RETRY_MIN + 1));
  retries.push({ p: problem, gap });
}

/**
 * Call once per new problem slot: counts every queued retry down and
 * returns a problem whose turn has come, or null.
 */
export function nextRetry(retries) {
  for (const r of retries) r.gap--;
  const i = retries.findIndex((r) => r.gap <= 0);
  return i === -1 ? null : retries.splice(i, 1)[0].p;
}

/** Median of a list of numbers, or null on an empty list. */
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Heatmap state for a fact record: green/yellow/red/gray. */
export function factState(f) {
  if (!f) return "gray";
  if (!f.ok) return "red";
  return f.t <= FAST_SEC ? "green" : "yellow";
}

/**
 * Classify a wrong answer. kind: "magnitude" (wrong number of digits),
 * "carry" (ones digit right, so the carry went wrong), "near" (close miss),
 * "other". dir: "high"/"low" — which way the answer deviated.
 */
export function classifyError(ans, given) {
  if (typeof given !== "number" || Number.isNaN(given)) return { kind: "other", dir: "low" };
  const dir = given > ans ? "high" : "low";
  if (String(Math.abs(given)).length !== String(ans).length) return { kind: "magnitude", dir };
  if (given % 10 === ans % 10) return { kind: "carry", dir };
  if (Math.abs(given - ans) <= Math.max(3, Math.round(ans * 0.12))) return { kind: "near", dir };
  return { kind: "other", dir };
}

/**
 * Per-table error-direction tendencies from recent session items, e.g.
 * "tends to answer low on the 8s table". A table qualifies with ≥minCount
 * classified errors of which ≥minShare lean the same way.
 */
export function errorInsights(sessions, { minCount = 3, minShare = 0.7, maxItems = 300 } = {}) {
  const perTable = {};
  let seen = 0;
  for (let i = sessions.length - 1; i >= 0 && seen < maxItems; i--) {
    const s = sessions[i];
    if (s.skill !== "mul" || !Array.isArray(s.items)) continue;
    for (const it of s.items) {
      seen++;
      if (it.given === it.ans || !it.ed) continue;
      for (const f of [it.a, it.b]) {
        if (f < 2 || f > 12) continue;
        const rec = (perTable[f] ||= { high: 0, low: 0 });
        rec[it.ed]++;
      }
    }
  }
  const out = [];
  for (const [tbl, c] of Object.entries(perTable)) {
    const total = c.high + c.low;
    if (total < minCount) continue;
    const dir = c.high >= c.low ? "high" : "low";
    const share = c[dir] / total;
    if (share >= minShare) out.push({ table: +tbl, dir, count: total, share: Math.round(share * 100) / 100 });
  }
  return out.sort((x, y) => y.count - x.count);
}
