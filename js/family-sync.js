/* Best-effort family presence. Offline: keep the last snapshot, stay
   fully usable locally. Empty FAMILY_SYNC_URL disables every call. */

import { FAMILY_SYNC_URL } from "./config.js";
import { keys, load, save, remove } from "./storage.js";
import { normalizeFamilyCode, sanitizePresence } from "./family.js";

export function familySyncEnabled() {
  return typeof FAMILY_SYNC_URL === "string" && FAMILY_SYNC_URL.trim() !== "";
}

export function loadFamilyCode() {
  return normalizeFamilyCode(load(keys.familyCode, "") || "");
}

export function persistFamilyCode(code) {
  const n = normalizeFamilyCode(code);
  if (!n) {
    remove(keys.familyCode);
    return "";
  }
  save(keys.familyCode, n);
  return n;
}

export function loadFamilySnapshot() {
  const snap = load(keys.familySnapshot, null);
  if (!snap || !Array.isArray(snap.members)) return [];
  return snap.members.map(sanitizePresence).filter(Boolean);
}

export function clearFamilyMembership() {
  remove(keys.familyCode);
  remove(keys.familySnapshot);
}

function rememberSnapshot(members) {
  save(keys.familySnapshot, { fetchedAt: Date.now(), members });
}

function baseUrl() {
  return FAMILY_SYNC_URL.replace(/\/+$/, "");
}

async function api(path, opts = {}) {
  const headers = { Accept: "application/json" };
  if (opts.body) headers["Content-Type"] = "application/json";
  const res = await fetch(baseUrl() + path, { ...opts, headers });
  if (!res.ok) throw new Error("sync");
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function publishPresence(code, presence) {
  if (!familySyncEnabled()) return false;
  const n = normalizeFamilyCode(code);
  const p = sanitizePresence(presence);
  if (!n || !p) return false;
  try {
    await api(`/rooms/${n}/members/${encodeURIComponent(p.id)}`, {
      method: "PUT",
      body: JSON.stringify(p),
    });
    return true;
  } catch {
    return false;
  }
}

export async function fetchRoom(code) {
  if (!familySyncEnabled()) return [];
  const n = normalizeFamilyCode(code);
  if (!n) return loadFamilySnapshot();
  try {
    const data = await api(`/rooms/${n}`);
    const members = Array.isArray(data?.members) ? data.members.map(sanitizePresence).filter(Boolean) : [];
    rememberSnapshot(members);
    return members;
  } catch {
    return loadFamilySnapshot();
  }
}

export async function unpublishPresence(code, id) {
  if (!familySyncEnabled()) return;
  const n = normalizeFamilyCode(code);
  if (!n || typeof id !== "string" || !id) return;
  try {
    await api(`/rooms/${n}/members/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* leave is local-first; remote drop is best-effort */
  }
}
