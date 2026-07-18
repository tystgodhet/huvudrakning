/* localStorage wrapper + profile export/import.
   localStorage over IndexedDB: a heavy year of practice is <100 kB per
   profile, the API is synchronous and simple, and export/import covers
   moving between devices. */

const PREFIX = "hr:v1:";

export const keys = {
  lang: PREFIX + "lang",
  profiles: PREFIX + "profiles",
  state: (id) => PREFIX + "state:" + id,
  sessions: (id) => PREFIX + "sessions:" + id,
};

export function load(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("storage save failed", key, e);
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Build the portable JSON envelope for one profile. */
export function exportProfile(profile, state, sessions) {
  return {
    app: "huvudrakning",
    version: 1,
    exportedAt: new Date().toISOString(),
    profile,
    state,
    sessions,
  };
}

/**
 * Parse + validate an exported envelope.
 * @param {string} json
 * @returns {{profile:object, state:object, sessions:object[]}}
 * @throws on any format problem
 */
export function parseImport(json) {
  const obj = JSON.parse(json);
  if (!obj || obj.app !== "huvudrakning" || obj.version !== 1) {
    throw new Error("unrecognized export format");
  }
  const { profile, state, sessions } = obj;
  if (!profile || typeof profile.id !== "string" || typeof profile.name !== "string") {
    throw new Error("bad profile");
  }
  if (!state || typeof state !== "object") throw new Error("bad state");
  if (!Array.isArray(sessions)) throw new Error("bad sessions");
  return { profile, state, sessions };
}
