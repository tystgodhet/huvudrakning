import { test } from "node:test";
import assert from "node:assert/strict";
import { dayStreak, lastPractice, lastSessionAt, personalBest, thenVsNow, masteryByTable } from "../js/stats.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 6, 19, 15, 0).getTime(); // local noon-ish, avoids DST edges

test("streak counts consecutive days ending today", () => {
  const ts = [NOW, NOW - DAY, NOW - 2 * DAY];
  assert.equal(dayStreak(ts, NOW), 3);
});

test("no session today keeps yesterday's streak alive", () => {
  const ts = [NOW - DAY, NOW - 2 * DAY];
  assert.equal(dayStreak(ts, NOW), 2);
});

test("a gap breaks the streak", () => {
  const ts = [NOW, NOW - 2 * DAY, NOW - 3 * DAY]; // yesterday missing
  assert.equal(dayStreak(ts, NOW), 1);
});

test("two days ago without yesterday or today means no streak", () => {
  assert.equal(dayStreak([NOW - 2 * DAY], NOW), 0);
});

test("empty history has no streak", () => {
  assert.equal(dayStreak([], NOW), 0);
});

test("multiple sessions on one day count as one streak day", () => {
  const ts = [NOW, NOW - 1000, NOW - DAY];
  assert.equal(dayStreak(ts, NOW), 2);
});

test("last session is the latest timestamp, or null if none", () => {
  assert.equal(lastSessionAt([]), null);
  assert.equal(lastSessionAt([NOW - 5 * DAY, NOW - DAY, NOW - 10 * DAY]), NOW - DAY);
});

test("last practice is never when history is empty", () => {
  assert.deepEqual(lastPractice([], NOW), { kind: "never", at: null });
});

test("last practice is today when the latest session is today", () => {
  const ts = [NOW - 5 * DAY, NOW];
  assert.deepEqual(lastPractice(ts, NOW), { kind: "today", at: NOW });
});

test("last practice is yesterday when the latest session was yesterday", () => {
  const ts = [NOW - 5 * DAY, NOW - DAY];
  assert.deepEqual(lastPractice(ts, NOW), { kind: "yesterday", at: NOW - DAY });
});

test("last practice is a date when the latest session is older than yesterday", () => {
  const at = NOW - 5 * DAY;
  assert.deepEqual(lastPractice([at, NOW - 10 * DAY], NOW), { kind: "date", at });
});

test("last practice uses the latest session even if timestamps are unsorted", () => {
  const ts = [NOW - 2 * DAY, NOW - 8 * DAY, NOW - DAY, NOW - 4 * DAY];
  assert.deepEqual(lastPractice(ts, NOW), { kind: "yesterday", at: NOW - DAY });
});

const sess = (skill, correct, attempted, avg) => ({
  skill,
  correct,
  attempted,
  acc: Math.round((correct / attempted) * 100),
  avg,
});

test("personal best tracks most correct and fastest pace per skill", () => {
  const sessions = [sess("mul", 12, 15, 3.1), sess("mul", 18, 20, 2.4), sess("add", 25, 26, 1.9)];
  const pb = personalBest(sessions, "mul");
  assert.equal(pb.bestCorrect, 18);
  assert.equal(pb.bestAvg, 2.4);
  assert.equal(personalBest(sessions, "div"), null);
});

test("pace PB ignores tiny sessions", () => {
  const sessions = [sess("mul", 2, 2, 0.5), sess("mul", 10, 12, 3.0)];
  assert.equal(personalBest(sessions, "mul").bestAvg, 3.0);
});

test("then-vs-now compares first and last windows", () => {
  const sessions = [
    sess("mul", 5, 10, 5.0),
    sess("mul", 6, 10, 4.8),
    sess("mul", 7, 10, 4.6),
    sess("mul", 14, 16, 3.0),
    sess("mul", 15, 16, 2.8),
    sess("mul", 16, 17, 2.6),
  ];
  const tn = thenVsNow(sessions, "mul");
  assert.equal(tn.then.acc, 60);
  assert.equal(tn.now.acc, 92);
  assert.equal(tn.then.avg, 4.8);
  assert.equal(tn.now.avg, 2.8);
});

test("then-vs-now needs at least two full windows", () => {
  const sessions = Array.from({ length: 5 }, () => sess("mul", 10, 12, 3));
  assert.equal(thenVsNow(sessions, "mul"), null);
});

test("mastery counts misses per table (larger factor for ×, divisor for ÷)", () => {
  const misses = [
    { a: 7, b: 8, op: "×" },
    { a: 8, b: 6, op: "×" },
    { a: 3, b: 8, op: "×" },
    { a: 54, b: 6, op: "÷" },
  ];
  assert.deepEqual(masteryByTable(misses, "×"), { 8: 3 });
  assert.deepEqual(masteryByTable(misses, "÷"), { 6: 1 });
});
