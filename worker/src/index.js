/* Family presence room. One KV record per family code.
   Publishes only the allowlisted chip: id, name, emoji, lastAt, streak.
   Never logs request bodies. CORS: Pages origin + localhost only. */

import {
  listRoomMembers,
  normalizeFamilyCode,
  pruneRoom,
  removeRoomMember,
  sanitizePresence,
  upsertRoomMember,
} from "../../js/family.js";

const MAX_BODY = 2048;

function allowedOrigin(origin, env) {
  if (!origin) return "";
  const pages = (env.PAGES_ORIGIN || "").replace(/\/+$/, "");
  if (pages && origin === pages) return origin;
  try {
    const u = new URL(origin);
    if ((u.protocol === "http:" || u.protocol === "https:") && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
      return origin;
    }
  } catch {
    /* ignore */
  }
  return "";
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(origin, status, body) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function roomKey(code) {
  return "room:" + code;
}

async function readRoom(env, code) {
  const raw = await env.ROOMS.get(roomKey(code), "json");
  return raw && typeof raw === "object" ? raw : { members: {} };
}

async function writeRoom(env, code, room) {
  await env.ROOMS.put(roomKey(code), JSON.stringify(room));
}

const MEMBER = /^\/rooms\/([^/]+)\/members\/([^/]+)$/;
const ROOM = /^\/rooms\/([^/]+)$/;

export async function handleRequest(req, env) {
  const origin = allowedOrigin(req.headers.get("Origin") || "", env);
  if (req.method === "OPTIONS") {
    if (!origin) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (!origin) return new Response("forbidden", { status: 403 });

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  const roomMatch = path.match(ROOM);
  const memberMatch = path.match(MEMBER);

  if (req.method === "GET" && roomMatch) {
    const code = normalizeFamilyCode(decodeURIComponent(roomMatch[1]));
    if (!code) return json(origin, 404, { error: "bad code" });
    const room = await readRoom(env, code);
    const pruned = pruneRoom(room);
    if (JSON.stringify(pruned) !== JSON.stringify(room)) await writeRoom(env, code, pruned);
    return json(origin, 200, { members: listRoomMembers(pruned) });
  }

  if (req.method === "PUT" && memberMatch) {
    const code = normalizeFamilyCode(decodeURIComponent(memberMatch[1]));
    const urlId = decodeURIComponent(memberMatch[2]);
    if (!code) return json(origin, 404, { error: "bad code" });
    const len = Number(req.headers.get("Content-Length") || 0);
    if (len > MAX_BODY) return json(origin, 413, { error: "too large" });
    let raw;
    try {
      const text = await req.text();
      if (text.length > MAX_BODY) return json(origin, 413, { error: "too large" });
      raw = JSON.parse(text);
    } catch {
      return json(origin, 400, { error: "bad presence" });
    }
    const presence = sanitizePresence(raw);
    if (!presence || presence.id !== urlId) return json(origin, 400, { error: "bad presence" });
    const room = await readRoom(env, code);
    const { room: next, ok } = upsertRoomMember(room, presence, Date.now());
    if (!ok) return json(origin, 400, { error: "bad presence" });
    await writeRoom(env, code, next);
    return json(origin, 200, { ok: true });
  }

  if (req.method === "DELETE" && memberMatch) {
    const code = normalizeFamilyCode(decodeURIComponent(memberMatch[1]));
    const urlId = decodeURIComponent(memberMatch[2]);
    if (!code) return json(origin, 404, { error: "bad code" });
    const room = await readRoom(env, code);
    await writeRoom(env, code, removeRoomMember(room, urlId));
    return json(origin, 200, { ok: true });
  }

  return json(origin, 404, { error: "not found" });
}

export function memoryKv(init = {}) {
  const data = { ...init };
  return {
    async get(key, type) {
      const v = data[key];
      if (v == null) return null;
      if (type === "json") return typeof v === "string" ? JSON.parse(v) : v;
      return typeof v === "string" ? v : JSON.stringify(v);
    },
    async put(key, value) {
      data[key] = value;
    },
    data,
  };
}

export default {
  async fetch(req, env) {
    return handleRequest(req, env);
  },
};
