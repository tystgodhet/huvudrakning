import { test } from "node:test";
import assert from "node:assert/strict";
import { stepLevel, mulPlacement, maxOpenTable, PLACE_FAST_SEC, MUL_PROBES } from "../js/placement.js";

test("staircase: fast correct climbs, slow holds, wrong descends, clamped 1-5", () => {
  assert.equal(stepLevel(3, true, 2), 4);
  assert.equal(stepLevel(3, true, PLACE_FAST_SEC), 4); // exactly on the bar is fast
  assert.equal(stepLevel(3, true, 6), 3); // slow correct = rounding down
  assert.equal(stepLevel(3, false, 1), 2);
  assert.equal(stepLevel(5, true, 1), 5);
  assert.equal(stepLevel(1, false, 1), 1);
});

test("a perfect fast run places at level 5, a failed run at level 1", () => {
  let lvl = 3;
  for (let i = 0; i < 5; i++) lvl = stepLevel(lvl, true, 1);
  assert.equal(lvl, 5);
  lvl = 3;
  for (let i = 0; i < 5; i++) lvl = stepLevel(lvl, false, 1);
  assert.equal(lvl, 1);
});

test("mul placement maps passed probes to opened tables and levels", () => {
  // nothing passed → the default start
  let c = mulPlacement(0);
  assert.equal(maxOpenTable(c), 5);
  assert.equal(c.t3.lvl, 1);
  assert.ok(!c.big1.open);

  // passed t3 and t6 → open through 7, passed tables at level 2
  c = mulPlacement(2);
  assert.equal(maxOpenTable(c), 7);
  assert.equal(c.t6.lvl, 2);
  assert.equal(c.t7.lvl, 1);

  // passed t9 → open through 10
  c = mulPlacement(3);
  assert.equal(maxOpenTable(c), 10);
  assert.equal(c.t9.lvl, 2);

  // passed all tables → everything open at level 2 plus big1 unlocked
  c = mulPlacement(4);
  assert.equal(maxOpenTable(c), 12);
  assert.equal(c.t12.lvl, 2);
  assert.ok(c.big1.open);
  assert.equal(c.big1.lvl, 1);
  assert.ok(!c.sq.open);

  // passed big1 too → big1 level 2 and squares unlocked
  c = mulPlacement(5);
  assert.equal(c.big1.lvl, 2);
  assert.ok(c.sq.open);
});

test("probe order rises through the tables to two-digit", () => {
  assert.deepEqual(MUL_PROBES, ["t3", "t6", "t9", "t12", "big1"]);
});
