/* Pure family-presence helpers. No DOM, no network.
   A family is a shared secret code. The only thing that ever crosses
   devices is a tiny presence chip: who, last practice, day streak. */

import { dayStreak, lastSessionAt } from "./stats.js";

/** Crockford-ish: no 0/O/1/I so a parent can read the code out. */
export const FAMILY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const FAMILY_CODE_LEN = 6;
export const MEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ROOM_CAP = 20;

const ID_MAX = 64;
const NAME_MAX = 40;
const EMOJI_MAX = 16;
const STREAK_MAX = 9999;

const CODE_RE = new RegExp(`^[${FAMILY_ALPHABET}]{${FAMILY_CODE_LEN}}$`);

/** Uppercase, strip spaces/dashes. Invalid → "". */
export function normalizeFamilyCode(raw) {
  if (typeof raw !== "string") return "";
  const code = raw
    .toUpperCase()
    .replace(/[\s._-]+/g, "")
    .trim();
  return CODE_RE.test(code) ? code : "";
}

export function formatFamilyCode(code) {
  const n = normalizeFamilyCode(code);
  if (!n) return "";
  return n.slice(0, 3) + " " + n.slice(3);
}

/** @param {() => number} [rand] Math.random-compatible, for tests. */
export function generateFamilyCode(rand = Math.random) {
  let out = "";
  for (let i = 0; i < FAMILY_CODE_LEN; i++) {
    out += FAMILY_ALPHABET[Math.floor(rand() * FAMILY_ALPHABET.length) % FAMILY_ALPHABET.length];
  }
  return out;
}

function cleanText(v, max) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

/**
 * Allowlist a presence payload. Extra keys are dropped. Returns null if
 * any required field is the wrong shape — never a partial leak.
 */
export function sanitizePresence(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = cleanText(raw.id, ID_MAX);
  const name = cleanText(raw.name, NAME_MAX);
  const emoji = cleanText(raw.emoji, EMOJI_MAX);
  if (!id || !name || !emoji) return null;

  let lastAt = null;
  if (raw.lastAt != null) {
    if (typeof raw.lastAt !== "number" || !Number.isFinite(raw.lastAt) || raw.lastAt <= 0) return null;
    lastAt = Math.round(raw.lastAt);
  }

  if (typeof raw.streak !== "number" || !Number.isFinite(raw.streak) || raw.streak < 0) return null;
  const streak = Math.min(STREAK_MAX, Math.round(raw.streak));
  return { id, name, emoji, lastAt, streak };
}

/** Presence for one local profile. Own timestamps only. */
export function buildPresence(profile, timestamps, now = Date.now()) {
  if (!profile) return null;
  return sanitizePresence({
    id: profile.id,
    name: profile.name,
    emoji: profile.emoji,
    lastAt: lastSessionAt(timestamps || []),
    streak: dayStreak(timestamps || [], now),
  });
}

/**
 * Remotes that are not already a local profile (same stable id).
 * Locals stay the source of truth; remotes are presence chips only.
 */
export function mergeFamilyMembers(locals, remotes) {
  const list = Array.isArray(locals) ? locals : [];
  const localIds = new Set(list.map((p) => p && p.id).filter(Boolean));
  const extra = [];
  for (const r of Array.isArray(remotes) ? remotes : []) {
    const p = sanitizePresence(r);
    if (!p || localIds.has(p.id)) continue;
    extra.push(p);
  }
  return extra;
}

export function visibleFamilyCount(locals, remotes) {
  return (Array.isArray(locals) ? locals.length : 0) + mergeFamilyMembers(locals, remotes).length;
}

export function emptyRoom() {
  return { members: {} };
}

export function pruneRoom(room, now = Date.now(), ttl = MEMBER_TTL_MS) {
  const members = {};
  for (const [id, m] of Object.entries(room?.members || {})) {
    if (typeof m?.seenAt === "number" && now - m.seenAt <= ttl) members[id] = m;
  }
  return { members };
}

export function upsertRoomMember(room, presence, now = Date.now()) {
  const p = sanitizePresence(presence);
  const pruned = pruneRoom(room, now);
  if (!p) return { room: pruned, ok: false };
  pruned.members[p.id] = { ...p, seenAt: now };
  const ids = Object.keys(pruned.members);
  if (ids.length > ROOM_CAP) {
    const oldest = ids
      .filter((id) => id !== p.id)
      .sort((a, b) => (pruned.members[a].seenAt || 0) - (pruned.members[b].seenAt || 0));
    while (Object.keys(pruned.members).length > ROOM_CAP && oldest.length) {
      delete pruned.members[oldest.shift()];
    }
  }
  return { room: pruned, ok: true };
}

export function removeRoomMember(room, id) {
  const members = { ...(room?.members || {}) };
  if (typeof id === "string") delete members[id];
  return { members };
}

export function listRoomMembers(room, now = Date.now()) {
  return Object.values(pruneRoom(room, now).members)
    .map((m) => sanitizePresence(m))
    .filter(Boolean);
}
