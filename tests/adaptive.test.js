import { test } from "node:test";
import assert from "node:assert/strict";
import { nextLevel, isAdaptiveSkill, MAX_LEVEL, MIN_LEVEL } from "../js/adaptive.js";

test("fewer than 5 attempts never changes the level", () => {
  assert.equal(nextLevel(3, 4, 4), 3); // 100% but only 4 attempts
  assert.equal(nextLevel(3, 0, 0), 3);
});

test("accuracy ≥90% levels up", () => {
  assert.equal(nextLevel(2, 10, 9), 3); // exactly 90%
  assert.equal(nextLevel(2, 10, 10), 3);
});

test("accuracy <70% levels down", () => {
  assert.equal(nextLevel(3, 10, 6), 2); // 60%
  assert.equal(nextLevel(3, 10, 7), 3); // exactly 70% stays
});

test("accuracy in the 70–89% band keeps the level", () => {
  assert.equal(nextLevel(3, 10, 8), 3); // 80% — the target band
  assert.equal(nextLevel(3, 20, 17), 3); // 85%
});

test("level is clamped to 1–5", () => {
  assert.equal(nextLevel(MAX_LEVEL, 10, 10), MAX_LEVEL);
  assert.equal(nextLevel(MIN_LEVEL, 10, 0), MIN_LEVEL);
});

test("adaptive levelling applies only to add/sub", () => {
  assert.ok(isAdaptiveSkill("add"));
  assert.ok(isAdaptiveSkill("sub"));
  assert.ok(!isAdaptiveSkill("mul"));
  assert.ok(!isAdaptiveSkill("div"));
  assert.ok(!isAdaptiveSkill("mix"));
});
