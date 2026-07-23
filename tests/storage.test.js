import { test } from "node:test";
import assert from "node:assert/strict";
import { exportProfile, exportAnalysis, sessionsToCSV, parseImport } from "../js/storage.js";

test("export → import round-trips a profile", () => {
  const profile = { id: "p1", name: "Elsa", emoji: "🦊" };
  const state = { levels: { add: 3, sub: 2 }, misses: [], config: { skill: "add", tables: [1, 2], duration: 60 } };
  const sessions = [{ at: 1752900000000, skill: "add", attempted: 20, correct: 18, acc: 90, avg: 2.1, misses: [] }];
  const parsed = parseImport(JSON.stringify(exportProfile(profile, state, sessions)));
  assert.deepEqual(parsed.profile, profile);
  assert.deepEqual(parsed.state, state);
  assert.deepEqual(parsed.sessions, sessions);
});

test("analysis export is pseudonymized and not importable as a profile", () => {
  const profile = { id: "p1", name: "Elsa", emoji: "🦊", createdAt: 1752000000000 };
  const state = { levels: { add: 3 }, ladder: { level: 2, facts: { "3x7": { w: 3, ok: false, t: 4 } } } };
  const sessions = [{ at: 1752900000000, skill: "mul", ladder: 2, attempted: 5, correct: 4, acc: 80, avg: 2.1, items: [] }];
  const env = exportAnalysis(profile, state, sessions);
  assert.equal(env.kind, "analysis");
  assert.deepEqual(env.profile, { id: "p1", createdAt: 1752000000000 });
  assert.equal(JSON.stringify(env).includes("Elsa"), false);
  assert.equal(JSON.stringify(env).includes("🦊"), false);
  assert.deepEqual(env.sessions, sessions);
  assert.deepEqual(env.state, state);
  // must never round-trip back in as a profile — it has no name
  assert.throws(() => parseImport(JSON.stringify(env)));
});

test("CSV export: one row per attempt, legacy sessions skipped, blank for missing answers", () => {
  const sessions = [
    { at: 1752900000000, skill: "mul", ladder: 1, attempted: 2, correct: 1, acc: 50, avg: 2, misses: [] }, // legacy, no items
    {
      at: 1752990000000,
      skill: "mul",
      ladder: 2,
      attempted: 2,
      correct: 1,
      acc: 50,
      avg: 2,
      items: [
        { skill: "mul", a: 7, b: 8, op: "×", ans: 56, given: 56, ms: 2100, at: 1752990001000 },
        { skill: "mul", a: 6, b: 9, op: "×", ans: 54, given: null, ms: 8000, at: 1752990009000 },
      ],
    },
  ];
  const csv = sessionsToCSV(sessions);
  assert.ok(csv.startsWith("﻿"), "missing UTF-8 BOM");
  const lines = csv.replace("﻿", "").trim().split("\n");
  assert.equal(lines.length, 3); // header + 2 attempts, legacy session skipped
  assert.equal(lines[0], "session_at;skill;level;a;op;b;answer;given;correct;ms;at");
  assert.equal(lines[1], "2025-07-20T05:40:00.000Z;mul;2;7;×;8;56;56;1;2100;2025-07-20T05:40:01.000Z");
  assert.equal(lines[2], "2025-07-20T05:40:00.000Z;mul;2;6;×;9;54;;0;8000;2025-07-20T05:40:09.000Z");
});

test("import rejects foreign or malformed data", () => {
  assert.throws(() => parseImport("not json"));
  assert.throws(() => parseImport(JSON.stringify({ app: "other", version: 1 })));
  assert.throws(() => parseImport(JSON.stringify({ app: "huvudrakning", version: 2 })));
  assert.throws(() => parseImport(JSON.stringify({ app: "huvudrakning", version: 1, profile: { id: 5 }, state: {}, sessions: [] })));
  assert.throws(() => parseImport(JSON.stringify({ app: "huvudrakning", version: 1, profile: { id: "a", name: "b" }, state: {}, sessions: "x" })));
});
