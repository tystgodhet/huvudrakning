import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAMILY_ALPHABET,
  FAMILY_CODE_LEN,
  MEMBER_TTL_MS,
  ROOM_CAP,
  buildPresence,
  formatFamilyCode,
  generateFamilyCode,
  listRoomMembers,
  mergeFamilyMembers,
  normalizeFamilyCode,
  pruneRoom,
  removeRoomMember,
  sanitizePresence,
  upsertRoomMember,
  visibleFamilyCount,
} from "../js/family.js";

const NOW = new Date(2026, 6, 19, 15, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

test("normalizeFamilyCode uppercases, strips spaces/dashes, rejects junk", () => {
  assert.equal(normalizeFamilyCode("ab2-c3k"), "AB2C3K");
  assert.equal(normalizeFamilyCode("  k7m 4qp "), "K7M4QP");
  assert.equal(normalizeFamilyCode("k7m-4qp"), "K7M4QP");
  assert.equal(normalizeFamilyCode("k7m.4qp"), "K7M4QP");
  assert.equal(normalizeFamilyCode("SHORT"), "");
  assert.equal(normalizeFamilyCode("TOOLONGX"), "");
  assert.equal(normalizeFamilyCode("ABC10I"), ""); // 0, 1, I not in alphabet
  assert.equal(normalizeFamilyCode("ABC0OI"), "");
  assert.equal(normalizeFamilyCode(null), "");
  assert.equal(normalizeFamilyCode(12), "");
});

test("formatFamilyCode groups for reading out loud", () => {
  assert.equal(formatFamilyCode("k7m4qp"), "K7M 4QP");
  assert.equal(formatFamilyCode("bad"), "");
});

test("generateFamilyCode is short and typeable", () => {
  const seq = [0.01, 0.2, 0.4, 0.6, 0.8, 0.99];
  let i = 0;
  const code = generateFamilyCode(() => seq[i++]);
  assert.equal(code.length, FAMILY_CODE_LEN);
  for (const ch of code) assert.ok(FAMILY_ALPHABET.includes(ch));
  assert.equal(generateFamilyCode(() => 0).length, FAMILY_CODE_LEN);
});

test("sanitizePresence allowlists chip fields and drops the rest", () => {
  const dirty = {
    id: "p1",
    name: "Elsa",
    emoji: "🦊",
    lastAt: NOW,
    streak: 3,
    sessions: [{ at: NOW, items: [{ a: 7, b: 8, ans: 56 }] }],
    accuracy: 91,
    answers: [56],
    exportJson: { app: "huvudrakning" },
    email: "kid@example.com",
  };
  assert.deepEqual(sanitizePresence(dirty), {
    id: "p1",
    name: "Elsa",
    emoji: "🦊",
    lastAt: NOW,
    streak: 3,
  });
  assert.equal(JSON.stringify(sanitizePresence(dirty)).includes("sessions"), false);
  assert.equal(JSON.stringify(sanitizePresence(dirty)).includes("accuracy"), false);
  assert.equal(JSON.stringify(sanitizePresence(dirty)).includes("email"), false);
});

test("sanitizePresence rejects the wrong shape", () => {
  assert.equal(sanitizePresence(null), null);
  assert.equal(sanitizePresence([]), null);
  assert.equal(sanitizePresence({ id: "p1", name: "Elsa", emoji: "🦊", lastAt: NOW }), null); // no streak
  assert.equal(sanitizePresence({ id: "p1", name: "Elsa", emoji: "🦊", lastAt: "today", streak: 1 }), null);
  assert.equal(sanitizePresence({ id: "p1", name: "Elsa", emoji: "🦊", lastAt: -1, streak: 1 }), null);
  assert.equal(sanitizePresence({ id: "", name: "Elsa", emoji: "🦊", lastAt: NOW, streak: 1 }), null);
  assert.equal(sanitizePresence({ id: "p1", name: "Elsa", emoji: "🦊", lastAt: NOW, streak: -2 }), null);
  assert.equal(sanitizePresence({ id: 5, name: "Elsa", emoji: "🦊", lastAt: NOW, streak: 1 }), null);
});

test("sanitizePresence allows never-practiced (null lastAt, zero streak)", () => {
  assert.deepEqual(sanitizePresence({ id: "p2", name: "Olle", emoji: "🐯", lastAt: null, streak: 0 }), {
    id: "p2",
    name: "Olle",
    emoji: "🐯",
    lastAt: null,
    streak: 0,
  });
});

test("buildPresence is last-practice + streak, never session lists", () => {
  const p = buildPresence({ id: "p1", name: "Elsa", emoji: "🦊" }, [NOW, NOW - DAY], NOW);
  assert.deepEqual(p, { id: "p1", name: "Elsa", emoji: "🦊", lastAt: NOW, streak: 2 });
  assert.equal(buildPresence({ id: "p1", name: "Elsa", emoji: "🦊" }, [], NOW).lastAt, null);
});

test("mergeFamilyMembers skips ids that are already local", () => {
  const locals = [
    { id: "p1", name: "Elsa", emoji: "🦊" },
    { id: "p2", name: "Olle", emoji: "🐯" },
  ];
  const remotes = [
    { id: "p1", name: "Elsa-phone", emoji: "🦊", lastAt: NOW, streak: 4 },
    { id: "p9", name: "Mamma", emoji: "🌟", lastAt: NOW - DAY, streak: 1 },
    { id: "p2", name: "Olle", emoji: "🐯", lastAt: NOW, streak: 2 },
    { id: "bad", name: "X" },
  ];
  assert.deepEqual(mergeFamilyMembers(locals, remotes), [
    { id: "p9", name: "Mamma", emoji: "🌟", lastAt: NOW - DAY, streak: 1 },
  ]);
});

test("family row hides when only one visible person", () => {
  const one = [{ id: "p1", name: "Elsa", emoji: "🦊" }];
  assert.equal(visibleFamilyCount(one, []), 1);
  assert.equal(visibleFamilyCount(one, [{ id: "p1", name: "Elsa", emoji: "🦊", lastAt: NOW, streak: 1 }]), 1);
  assert.equal(visibleFamilyCount(one, [{ id: "p9", name: "Mamma", emoji: "🌟", lastAt: NOW, streak: 1 }]), 2);
  assert.equal(visibleFamilyCount([], []), 0);
});

test("room upsert overwrites by id and drops members not seen in 30 days", () => {
  let room = { members: {} };
  const a = { id: "p1", name: "Elsa", emoji: "🦊", lastAt: NOW, streak: 1 };
  room = upsertRoomMember(room, a, NOW).room;
  room = upsertRoomMember(room, { ...a, name: "Elsa", streak: 5 }, NOW + 1000).room;
  assert.equal(room.members.p1.streak, 5);
  assert.equal(Object.keys(room.members).length, 1);

  room = upsertRoomMember(
    room,
    { id: "p9", name: "Mamma", emoji: "🌟", lastAt: NOW - 40 * DAY, streak: 0 },
    NOW - 40 * DAY
  ).room;
  const pruned = pruneRoom(room, NOW, MEMBER_TTL_MS);
  assert.equal(pruned.members.p9, undefined);
  assert.ok(pruned.members.p1);
  assert.deepEqual(listRoomMembers(room, NOW), [{ id: "p1", name: "Elsa", emoji: "🦊", lastAt: NOW, streak: 5 }]);
});

test("room cap drops the oldest other member, not the writer", () => {
  let room = { members: {} };
  for (let i = 0; i < ROOM_CAP; i++) {
    room = upsertRoomMember(
      room,
      { id: "old" + i, name: "N" + i, emoji: "🐸", lastAt: NOW, streak: 0 },
      NOW + i
    ).room;
  }
  const { room: next } = upsertRoomMember(
    room,
    { id: "new", name: "Ny", emoji: "🚀", lastAt: NOW, streak: 0 },
    NOW + 1000
  );
  assert.equal(Object.keys(next.members).length, ROOM_CAP);
  assert.ok(next.members.new);
  assert.equal(next.members.old0, undefined);
});

test("removeRoomMember drops one id", () => {
  const room = {
    members: {
      p1: { id: "p1", name: "Elsa", emoji: "🦊", lastAt: NOW, streak: 1, seenAt: NOW },
      p9: { id: "p9", name: "Mamma", emoji: "🌟", lastAt: NOW, streak: 1, seenAt: NOW },
    },
  };
  assert.deepEqual(Object.keys(removeRoomMember(room, "p1").members), ["p9"]);
});
