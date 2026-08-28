import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeFamilyMembers } from "../js/family.js";
import { handleRequest, memoryKv } from "../worker/src/index.js";

const ENV = {
  PAGES_ORIGIN: "https://tystgodhet.github.io",
};

function envWith(kv) {
  return { ...ENV, ROOMS: kv };
}

async function call(kv, { method, path, origin, body }) {
  const req = new Request("https://family.test" + path, {
    method,
    headers: {
      Origin: origin || ENV.PAGES_ORIGIN,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleRequest(req, envWith(kv));
}

const chip = {
  id: "p1",
  name: "Elsa",
  emoji: "🦊",
  lastAt: 1752900000000,
  streak: 2,
};

test("CORS allows Pages origin and localhost, rejects others", async () => {
  const kv = memoryKv();
  const ok = await call(kv, { method: "GET", path: "/rooms/K7M4QP", origin: ENV.PAGES_ORIGIN });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), ENV.PAGES_ORIGIN);

  const local = await call(kv, { method: "GET", path: "/rooms/K7M4QP", origin: "http://localhost:8080" });
  assert.equal(local.status, 200);
  assert.equal(local.headers.get("Access-Control-Allow-Origin"), "http://localhost:8080");

  const denied = await call(kv, { method: "GET", path: "/rooms/K7M4QP", origin: "https://evil.example" });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
});

test("PUT then GET stores only the allowlisted chip", async () => {
  const kv = memoryKv();
  const put = await call(kv, {
    method: "PUT",
    path: "/rooms/K7M4QP/members/p1",
    body: {
      ...chip,
      sessions: [{ items: [{ a: 7, ans: 56 }] }],
      accuracy: 99,
      email: "x@y.z",
    },
  });
  assert.equal(put.status, 200);
  const get = await call(kv, { method: "GET", path: "/rooms/K7M4QP" });
  const data = await get.json();
  assert.deepEqual(data.members, [chip]);
  const stored = JSON.parse(kv.data["room:K7M4QP"]);
  assert.equal(JSON.stringify(stored).includes("sessions"), false);
  assert.equal(JSON.stringify(stored).includes("accuracy"), false);
  assert.equal(JSON.stringify(stored).includes("email"), false);
});

test("PUT rejects a bad body or id mismatch without echoing it back", async () => {
  const kv = memoryKv();
  const bad = await call(kv, {
    method: "PUT",
    path: "/rooms/K7M4QP/members/p1",
    body: { id: "p1", name: "Elsa" },
  });
  assert.equal(bad.status, 400);
  const msg = await bad.text();
  assert.ok(!msg.includes("Elsa"));

  const mismatch = await call(kv, {
    method: "PUT",
    path: "/rooms/K7M4QP/members/p1",
    body: { ...chip, id: "p2" },
  });
  assert.equal(mismatch.status, 400);
});

test("two devices in one room see each other after merge", async () => {
  const kv = memoryKv();
  const mamma = { id: "p9", name: "Mamma", emoji: "🌟", lastAt: chip.lastAt, streak: 1 };
  await call(kv, { method: "PUT", path: "/rooms/K7M4QP/members/p1", body: chip });
  await call(kv, { method: "PUT", path: "/rooms/K7M4QP/members/p9", body: mamma });
  const members = (await (await call(kv, { method: "GET", path: "/rooms/K7M4QP" })).json()).members;
  const onIpad = mergeFamilyMembers([{ id: "p1", name: "Elsa", emoji: "🦊" }], members);
  const onPhone = mergeFamilyMembers([{ id: "p9", name: "Mamma", emoji: "🌟" }], members);
  assert.deepEqual(onIpad, [mamma]);
  assert.deepEqual(onPhone, [chip]);
});

test("invalid family code is 404; leave removes the member", async () => {
  const kv = memoryKv();
  const nope = await call(kv, { method: "GET", path: "/rooms/NOPE" });
  assert.equal(nope.status, 404);

  await call(kv, { method: "PUT", path: "/rooms/K7M4QP/members/p1", body: chip });
  const del = await call(kv, { method: "DELETE", path: "/rooms/K7M4QP/members/p1" });
  assert.equal(del.status, 200);
  const get = await call(kv, { method: "GET", path: "/rooms/K7M4QP" });
  assert.deepEqual((await get.json()).members, []);
});
