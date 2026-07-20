/* Pure mastery-ladder logic for multiplication: named levels, promotion,
   silent slump support, per-fact practice weights. No DOM, no storage.

   Design principles: reward mastery (speed + precision), never raw play
   time. No visible demotion — a slump quietly mixes in easier problems. */

export const LADDER_LEVELS = 6;

export const PROMO_ACC = 95; // pooled accuracy over the window, %
export const PROMO_MEDIAN = 3.0; // median s/problem over the window
export const PROMO_WINDOW = 3; // sessions at the current level

export const SLUMP_ACC = 80; // two sessions in a row below this →
export const SLUMP_SHARE = 0.3; // ...mix in 30 % from the level below

export const FAST_SEC = 3; // "fast" bar: promotion + heatmap green
export const SLOW_SEC = 5; // answers slower than this raise the weight

export const W_WRONG = 3;
export const W_SLOW = 2;
export const W_FAST = 0.7;
export const W_MIN = 0.3;
export const W_MAX = 27;

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

/** Median of a list of numbers, or null on an empty list. */
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function atLevel(sessions, level) {
  return sessions.filter((s) => s.skill === "mul" && s.ladder === level);
}

/**
 * Progress toward promotion from `level`, over the last PROMO_WINDOW
 * sessions at that level: pooled accuracy ≥ PROMO_ACC and median session
 * speed (median of the sessions' median times) ≤ PROMO_MEDIAN. Both
 * numbers are returned so the UI can show exactly what is missing.
 */
export function promotionStatus(sessions, level) {
  const rel = atLevel(sessions, level).slice(-PROMO_WINDOW);
  const attempted = rel.reduce((n, s) => n + s.attempted, 0);
  const correct = rel.reduce((n, s) => n + s.correct, 0);
  const acc = attempted ? Math.round((correct / attempted) * 1000) / 10 : null;
  const med = median(rel.map((s) => s.med).filter((m) => m != null));
  const full = rel.length >= PROMO_WINDOW;
  const accOk = full && acc !== null && acc >= PROMO_ACC;
  const medOk = full && med !== null && med <= PROMO_MEDIAN;
  return { count: rel.length, acc, med, accOk, medOk, ready: accOk && medOk && level < LADDER_LEVELS };
}

/** True when the last two sessions at this level both dipped below SLUMP_ACC. */
export function slumpActive(sessions, level) {
  if (level <= 1) return false;
  const rel = atLevel(sessions, level).slice(-2);
  return rel.length === 2 && rel.every((s) => s.acc < SLUMP_ACC);
}

/** Heatmap state for a fact record: green/yellow/red/gray. */
export function factState(f) {
  if (!f) return "gray";
  if (!f.ok) return "red";
  return f.t <= FAST_SEC ? "green" : "yellow";
}
