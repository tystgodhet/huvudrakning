import { test } from "node:test";
import assert from "node:assert/strict";
import {
  factKey,
  updateWeight,
  median,
  promotionStatus,
  slumpActive,
  factState,
  W_MIN,
  W_MAX,
  LADDER_LEVELS,
} from "../js/ladder.js";

function sess(over) {
  return { skill: "mul", ladder: 1, attempted: 20, correct: 20, acc: 100, med: 2.0, ...over };
}

test("factKey is order-independent", () => {
  assert.equal(factKey(3, 7), "3x7");
  assert.equal(factKey(7, 3), "3x7");
  assert.equal(factKey(12, 12), "12x12");
});

test("weights: wrong ×3, slow ×2, fast correct ×0.7, with floor and cap", () => {
  assert.equal(updateWeight(undefined, false, 2), 3); // 1 × 3
  assert.equal(updateWeight(3, true, 6), 6); // slow (>5 s) × 2
  assert.equal(updateWeight(6, true, 2), 4.2); // fast correct × 0.7
  // repeated fast answers bottom out at the floor, never zero
  let w = 1;
  for (let i = 0; i < 10; i++) w = updateWeight(w, true, 1);
  assert.equal(w, W_MIN);
  // repeated misses top out at the cap
  w = 1;
  for (let i = 0; i < 10; i++) w = updateWeight(w, false, 1);
  assert.equal(w, W_MAX);
});

test("median handles odd, even and empty lists", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test("promotion requires 3 sessions at the level with ≥95% pooled acc and median ≤3 s", () => {
  const good = [sess({ correct: 19, acc: 95, med: 2.8 }), sess({ med: 2.5 }), sess({ med: 3.0 })];
  const st = promotionStatus(good, 1);
  assert.equal(st.ready, true);
  assert.equal(st.accOk, true);
  assert.equal(st.medOk, true);

  // only two sessions → not yet, but progress numbers are exposed
  const two = promotionStatus(good.slice(0, 2), 1);
  assert.equal(two.ready, false);
  assert.equal(two.count, 2);
  assert.ok(two.acc !== null && two.med !== null);

  // pooled accuracy below 95 blocks promotion even with fast times
  const slowAcc = [sess({ correct: 16, acc: 80 }), sess(), sess()];
  assert.equal(promotionStatus(slowAcc, 1).ready, false); // 56/60 ≈ 93.3 %

  // median above 3.0 blocks promotion even with perfect accuracy
  const slowMed = [sess({ med: 3.4 }), sess({ med: 3.5 }), sess({ med: 3.6 })];
  const stSlow = promotionStatus(slowMed, 1);
  assert.equal(stSlow.ready, false);
  assert.equal(stSlow.accOk, true);
  assert.equal(stSlow.medOk, false);

  // sessions at other levels or skills do not count
  const other = [sess({ ladder: 2 }), sess({ skill: "add", ladder: undefined }), sess()];
  assert.equal(promotionStatus(other, 1).count, 1);

  // the top level has nothing to promote to
  const top = [sess({ ladder: LADDER_LEVELS }), sess({ ladder: LADDER_LEVELS }), sess({ ladder: LADDER_LEVELS })];
  const stTop = promotionStatus(top, LADDER_LEVELS);
  assert.equal(stTop.ready, false);
  assert.equal(stTop.accOk && stTop.medOk, true);
});

test("slump activates after two sessions in a row below 80%, never on level 1", () => {
  const dip = [sess({ ladder: 2, acc: 75 }), sess({ ladder: 2, acc: 70 })];
  assert.equal(slumpActive(dip, 2), true);
  assert.equal(slumpActive([sess({ ladder: 2, acc: 75 }), sess({ ladder: 2, acc: 85 })], 2), false);
  assert.equal(slumpActive([sess({ ladder: 2, acc: 75 })], 2), false);
  assert.equal(slumpActive([sess({ acc: 10 }), sess({ acc: 10 })], 1), false);
});

test("fact heatmap states", () => {
  assert.equal(factState(undefined), "gray");
  assert.equal(factState({ ok: false, t: 1.2 }), "red");
  assert.equal(factState({ ok: true, t: 2.9 }), "green");
  assert.equal(factState({ ok: true, t: 4.5 }), "yellow");
});
