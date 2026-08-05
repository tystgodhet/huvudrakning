/* Pure placement-test logic: adaptive staircase for add/sub and a probe
   sequence for multiplication. The test measures — it never trains: no
   weights, misses, sessions or streaks are produced. On uncertainty we
   round DOWN: a too-easy start self-corrects via the bands within a few
   sessions, a too-hard start feels like failure on day one. */

import { defaultComps } from "./ladder.js";

export const PLACE_FAST_SEC = 4; // fast-correct bar during the test
export const PLACE_TIMEOUT_SEC = 10; // per-problem cap so the test never stalls
export const PLACE_PER_SKILL = 5; // staircase length for add and sub
export const PLACE_START_LVL = 3;

/* Multiplication probes in rising order; two fast-correct answers advance
   to the next probe, anything else ends the sequence. */
export const MUL_PROBES = ["t3", "t6", "t9", "t12", "big1"];

/**
 * One staircase step for add/sub: fast correct climbs, slow correct holds
 * (that is the rounding-down), wrong or timeout descends.
 */
export function stepLevel(lvl, ok, seconds) {
  if (!ok) return Math.max(1, lvl - 1);
  if (seconds <= PLACE_FAST_SEC) return Math.min(5, lvl + 1);
  return lvl;
}

/**
 * Map the number of fully passed multiplication probes (0–5) to component
 * state: tables open through the reached table plus one of headroom (never
 * fewer than the default five), passed tables at level 2, and the next
 * big component unlocked once all tables are passed.
 */
export function mulPlacement(passedCount) {
  const comps = defaultComps();
  const reached = [0, 3, 6, 9, 12, 12][Math.min(passedCount, 5)];
  const openThrough = Math.max(5, Math.min(12, reached + 1));
  for (let n = 1; n <= 12; n++) {
    comps["t" + n].open = n <= openThrough;
    if (n <= reached) comps["t" + n].lvl = 2;
  }
  if (passedCount >= 4) comps.big1.open = true;
  if (passedCount >= 5) {
    comps.big1.lvl = 2;
    comps.sq.open = true;
  }
  return comps;
}

/** Largest open table in a component map (for the summary text). */
export function maxOpenTable(comps) {
  let top = 0;
  for (let n = 1; n <= 12; n++) if (comps["t" + n]?.open) top = n;
  return top;
}
