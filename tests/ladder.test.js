import { test } from "node:test";
import assert from "node:assert/strict";
import * as ladderApi from "../js/ladder.js";
import {
  factKey,
  updateWeight,
  updateFactAfterAnswer,
  median,
  factState,
  defaultComps,
  migrateComps,
  componentOf,
  compAccuracy,
  weakestOpen,
  recordResult,
  adjustComponents,
  classifyError,
  errorInsights,
  W_MIN,
  W_MAX,
  COMP_ORDER,
} from "../js/ladder.js";

test("factKey is order-independent", () => {
  assert.equal(factKey(3, 7), "3x7");
  assert.equal(factKey(7, 3), "3x7");
});

test("weights: wrong ×3, slow ×2, fast correct ×0.7, with floor and cap", () => {
  assert.equal(updateWeight(undefined, false, 2), 3);
  assert.equal(updateWeight(3, true, 6), 6);
  assert.equal(updateWeight(6, true, 2), 4.2);
  let w = 1;
  for (let i = 0; i < 10; i++) w = updateWeight(w, true, 1);
  assert.equal(w, W_MIN);
  w = 1;
  for (let i = 0; i < 10; i++) w = updateWeight(w, false, 1);
  assert.equal(w, W_MAX);
});

test("median handles odd, even and empty lists", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test("fact heatmap states", () => {
  assert.equal(factState(undefined), "gray");
  assert.equal(factState({ ok: false, t: 1.2 }), "red");
  assert.equal(factState({ ok: true, t: 2.9 }), "green");
  assert.equal(factState({ ok: true, t: 4.5 }), "yellow");
});

test("default components open the first five tables; migration honors old levels", () => {
  const d = defaultComps();
  assert.ok(d.t5.open && !d.t6.open && !d.big1.open);
  const m = migrateComps(4);
  assert.ok(m.t12.open && m.big1.open && !m.sq.open);
  assert.equal(m.t8.lvl, 3);
});

test("componentOf attributes facts correctly", () => {
  assert.equal(componentOf(3, 7), "t7");
  assert.equal(componentOf(12, 5), "t12");
  assert.equal(componentOf(14, 6), "big1");
  assert.equal(componentOf(13, 13), "sq");
  assert.equal(componentOf(13, 17), "big2");
});

test("band: >85% raises a component's level, <75% lowers it, in between holds", () => {
  const mk = (oks) => {
    const comps = defaultComps();
    oks.forEach((ok) => recordResult(comps, "t3", ok));
    return comps;
  };
  // 18/20 = 90% → up, window resets
  let comps = mk(Array(18).fill(true).concat([false, false]));
  let r = adjustComponents(comps);
  assert.deepEqual(r.changes, [{ key: "t3", from: 1, to: 2 }]);
  assert.equal(comps.t3.recent.length, 0);
  // 14/20 = 70% → down (from level 2)
  comps = mk(Array(14).fill(true).concat(Array(6).fill(false)));
  comps.t3.lvl = 2;
  r = adjustComponents(comps);
  assert.deepEqual(r.changes, [{ key: "t3", from: 2, to: 1 }]);
  // 16/20 = 80% → hold (the target band)
  comps = mk(Array(16).fill(true).concat(Array(4).fill(false)));
  comps.t3.lvl = 2;
  r = adjustComponents(comps);
  assert.deepEqual(r.changes, []);
  assert.equal(comps.t3.lvl, 2);
  // level 1 never drops below 1
  comps = mk(Array(20).fill(false));
  r = adjustComponents(comps);
  assert.equal(comps.t3.lvl, 1);
  // fewer than COMP_MIN attempts → no action
  comps = defaultComps();
  recordResult(comps, "t3", true);
  assert.deepEqual(adjustComponents(comps).changes, []);
});

test("a component mastered at top level opens the next locked component", () => {
  const comps = defaultComps();
  comps.t3.lvl = 3;
  for (let i = 0; i < 20; i++) recordResult(comps, "t3", true);
  const r = adjustComponents(comps);
  assert.deepEqual(r.opened, ["t6"]);
  assert.ok(comps.t6.open);
  assert.equal(comps.t3.lvl, 3);
});

test("weakest components: barely-trained count as weakest, then lowest accuracy", () => {
  const comps = defaultComps();
  for (let i = 0; i < 20; i++) recordResult(comps, "t1", true);
  for (let i = 0; i < 20; i++) recordResult(comps, "t2", i < 10);
  for (let i = 0; i < 20; i++) recordResult(comps, "t3", i < 18);
  for (let i = 0; i < 20; i++) recordResult(comps, "t4", i < 16);
  // t5 untrained → weakest; t2 at 50% next
  assert.deepEqual(weakestOpen(comps), ["t5", "t2"]);
});

test("misses recur until solved fast twice in a row", () => {
  const facts = {};
  const due = [];
  const k = "7x8";
  updateFactAfterAnswer(facts, due, k, false, 2); // miss → due
  assert.deepEqual(due, [k]);
  updateFactAfterAnswer(facts, due, k, true, 2); // fast ×1 → still due
  assert.deepEqual(due, [k]);
  updateFactAfterAnswer(facts, due, k, true, 7); // slow correct breaks the chain
  assert.equal(facts[k].s, 0);
  assert.deepEqual(due, [k]);
  updateFactAfterAnswer(facts, due, k, true, 2);
  updateFactAfterAnswer(facts, due, k, true, 2); // fast ×2 in a row → cleared
  assert.deepEqual(due, []);
  // a new miss re-enters the queue
  updateFactAfterAnswer(facts, due, k, false, 2);
  assert.deepEqual(due, [k]);
});

test("error classification: magnitude, carry, near, direction", () => {
  assert.deepEqual(classifyError(56, 560), { kind: "magnitude", dir: "high" });
  assert.deepEqual(classifyError(56, 5), { kind: "magnitude", dir: "low" });
  assert.deepEqual(classifyError(56, 46), { kind: "carry", dir: "low" });
  assert.deepEqual(classifyError(56, 54), { kind: "near", dir: "low" });
  assert.deepEqual(classifyError(56, 58), { kind: "near", dir: "high" });
  assert.deepEqual(classifyError(56, 71), { kind: "other", dir: "high" });
  assert.equal(classifyError(56, NaN).kind, "other");
});

test("error insights find a dominant direction per table", () => {
  const items = [
    { a: 8, b: 6, ans: 48, given: 42, ed: "low" },
    { a: 8, b: 7, ans: 56, given: 54, ed: "low" },
    { a: 4, b: 8, ans: 32, given: 24, ed: "low" },
    { a: 8, b: 9, ans: 72, given: 81, ed: "high" },
    { a: 3, b: 5, ans: 15, given: 15 }, // correct — ignored
  ];
  const sessions = [{ skill: "mul", items }];
  const out = errorInsights(sessions, { minCount: 3, minShare: 0.7 });
  const t8 = out.find((i) => i.table === 8);
  assert.ok(t8, "no insight for table 8");
  assert.equal(t8.dir, "low");
  assert.equal(t8.count, 4);
  assert.equal(t8.share, 0.75);
  // tables with too few classified errors stay silent
  assert.equal(out.find((i) => i.table === 6), undefined);
});

test("missed problems get a guaranteed retry after 2-4 problems", () => {
  const { scheduleRetry, nextRetry, RETRY_MIN, RETRY_MAX } = ladderApi;
  const retries = [];
  scheduleRetry(retries, { a: 7, b: 8 }, () => 0); // rng 0 → gap RETRY_MIN
  assert.equal(retries[0].gap, RETRY_MIN);
  scheduleRetry(retries, { a: 6, b: 9 }, () => 0.999); // rng ~1 → gap RETRY_MAX
  assert.equal(retries[1].gap, RETRY_MAX);
  // first slot: both count down, none ready yet (gaps 1 and 3)
  assert.equal(nextRetry(retries), null);
  // second slot: the first miss is due
  assert.deepEqual(nextRetry(retries), { a: 7, b: 8 });
  // the second miss follows two slots later
  assert.equal(nextRetry(retries), null);
  assert.deepEqual(nextRetry(retries), { a: 6, b: 9 });
  assert.equal(retries.length, 0);
  assert.equal(nextRetry(retries), null);
});

test("COMP_ORDER unlocks tables before the advanced components", () => {
  assert.equal(COMP_ORDER[0], "t1");
  assert.deepEqual(COMP_ORDER.slice(-3), ["big1", "sq", "big2"]);
});
