import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUEST_FAST_ANY_TARGET,
  QUEST_FAST_TARGET,
  QUEST_MISS_TARGET,
  QUEST_SESSION_MIN,
  allQuestsDone,
  dayKey,
  generateQuests,
  questEvent,
  questsStale,
} from "../js/quests.js";
import { FAST_SEC, defaultComps, recordResult } from "../js/ladder.js";

/** Comps where t2 is clearly the weakest open component. */
function trainedComps() {
  const comps = defaultComps();
  for (const k of ["t1", "t3", "t4", "t5"]) for (let i = 0; i < 20; i++) recordResult(comps, k, true);
  for (let i = 0; i < 20; i++) recordResult(comps, "t2", i < 10);
  return comps;
}

test("dayKey is local YYYY-MM-DD", () => {
  assert.equal(dayKey(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(dayKey(new Date(2026, 10, 23)), "2026-11-23");
});

test("quests: one session + fast-correct in the weakest component", () => {
  const q = generateQuests({ comps: trainedComps(), due: [], misses: [] }, "2026-08-18");
  assert.equal(q.day, "2026-08-18");
  assert.deepEqual(q.list[0], { type: "session", target: 1, done: 0 });
  assert.equal(q.list[1].type, "fastFocus");
  assert.equal(q.list[1].comp, "t2");
  assert.equal(q.list[1].target, QUEST_FAST_TARGET);
});

test("third quest settles old misses when any exist, else asks for fast answers", () => {
  const comps = trainedComps();
  let q = generateQuests({ comps, due: ["7x8"], misses: [{ a: 9, b: 6 }] }, "d");
  assert.deepEqual(q.list[2], { type: "clearMiss", target: 2, done: 0 });
  q = generateQuests({ comps, due: ["7x8", "6x9", "8x8", "9x9"], misses: [] }, "d");
  assert.equal(q.list[2].target, QUEST_MISS_TARGET);
  q = generateQuests({ comps, due: [], misses: [] }, "d");
  assert.deepEqual(q.list[2], { type: "fastAny", target: QUEST_FAST_ANY_TARGET, done: 0 });
});

test("stale detection: missing, malformed or another day", () => {
  assert.ok(questsStale(null, "d"));
  assert.ok(questsStale({ day: "other", list: [] }, "d"));
  assert.ok(questsStale({ day: "d" }, "d"));
  assert.ok(!questsStale({ day: "d", list: [] }, "d"));
});

test("fastFocus counts only fast correct answers in its component", () => {
  const q = generateQuests({ comps: trainedComps(), due: [], misses: [] }, "d");
  const focus = q.list[1];
  questEvent(q, { type: "answer", ok: true, secs: FAST_SEC, comp: "t2" }); // counts
  questEvent(q, { type: "answer", ok: true, secs: FAST_SEC + 1, comp: "t2" }); // too slow
  questEvent(q, { type: "answer", ok: false, secs: 1, comp: "t2" }); // wrong
  questEvent(q, { type: "answer", ok: true, secs: 1, comp: "t5" }); // other component
  assert.equal(focus.done, 1);
});

test("clearMiss counts only correct answers on old misses", () => {
  const q = generateQuests({ comps: trainedComps(), due: ["7x8"], misses: [] }, "d");
  const clear = q.list[2];
  questEvent(q, { type: "answer", ok: true, secs: 9, oldMiss: true }); // counts (speed irrelevant)
  questEvent(q, { type: "answer", ok: false, secs: 2, oldMiss: true }); // wrong
  questEvent(q, { type: "answer", ok: true, secs: 2, oldMiss: false }); // not an old miss
  assert.equal(clear.done, 1);
});

test("a session counts once it has enough attempts; completion is reported once", () => {
  const q = generateQuests({ comps: trainedComps(), due: [], misses: [] }, "d");
  assert.deepEqual(questEvent(q, { type: "session", attempted: QUEST_SESSION_MIN - 1 }), []);
  const done = questEvent(q, { type: "session", attempted: QUEST_SESSION_MIN });
  assert.equal(done.length, 1);
  assert.equal(done[0].type, "session");
  // already complete → no double completion
  assert.deepEqual(questEvent(q, { type: "session", attempted: 20 }), []);
});

test("allQuestsDone", () => {
  const q = generateQuests({ comps: trainedComps(), due: [], misses: [] }, "d");
  assert.ok(!allQuestsDone(q));
  q.list.forEach((it) => (it.done = it.target));
  assert.ok(allQuestsDone(q));
  assert.ok(!allQuestsDone(null));
});
