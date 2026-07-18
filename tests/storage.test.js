import { test } from "node:test";
import assert from "node:assert/strict";
import { exportProfile, parseImport } from "../js/storage.js";

test("export → import round-trips a profile", () => {
  const profile = { id: "p1", name: "Elsa", emoji: "🦊" };
  const state = { levels: { add: 3, sub: 2 }, misses: [], config: { skill: "add", tables: [1, 2], duration: 60 } };
  const sessions = [{ at: 1752900000000, skill: "add", attempted: 20, correct: 18, acc: 90, avg: 2.1, misses: [] }];
  const parsed = parseImport(JSON.stringify(exportProfile(profile, state, sessions)));
  assert.deepEqual(parsed.profile, profile);
  assert.deepEqual(parsed.state, state);
  assert.deepEqual(parsed.sessions, sessions);
});

test("import rejects foreign or malformed data", () => {
  assert.throws(() => parseImport("not json"));
  assert.throws(() => parseImport(JSON.stringify({ app: "other", version: 1 })));
  assert.throws(() => parseImport(JSON.stringify({ app: "huvudrakning", version: 2 })));
  assert.throws(() => parseImport(JSON.stringify({ app: "huvudrakning", version: 1, profile: { id: 5 }, state: {}, sessions: [] })));
  assert.throws(() => parseImport(JSON.stringify({ app: "huvudrakning", version: 1, profile: { id: "a", name: "b" }, state: {}, sessions: "x" })));
});
