/* localStorage wrapper + profile export/import.
   localStorage over IndexedDB: a heavy year of practice is <100 kB per
   profile, the API is synchronous and simple, and export/import covers
   moving between devices. */

const PREFIX = "hr:v1:";

export const keys = {
  lang: PREFIX + "lang",
  profiles: PREFIX + "profiles",
  familyCode: PREFIX + "familyCode",
  familySnapshot: PREFIX + "familySnapshot",
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
 * Build a pseudonymized envelope for sharing outside the family (e.g. with
 * a coach or an AI): full stats and per-problem logs, but no name or
 * avatar. Deliberately NOT importable as a profile — parseImport rejects
 * it since the profile carries no name.
 */
export function exportAnalysis(profile, state, sessions) {
  return {
    app: "huvudrakning",
    version: 1,
    kind: "analysis",
    exportedAt: new Date().toISOString(),
    profile: { id: profile.id, createdAt: profile.createdAt },
    state,
    sessions,
  };
}

/**
 * Per-attempt log as CSV, one row per answered problem. Semicolon
 * delimiter so Swedish-locale Excel opens it directly; Google Sheets
 * auto-detects. Sessions recorded before per-problem logging are skipped.
 */
export function sessionsToCSV(sessions) {
  const rows = ["session_at;skill;level;a;op;b;answer;given;correct;ms;at"];
  for (const s of sessions) {
    if (!Array.isArray(s.items)) continue;
    const level = s.ladder ?? s.level ?? "";
    for (const it of s.items) {
      const given = typeof it.given === "number" && !Number.isNaN(it.given) ? it.given : "";
      rows.push(
        [
          new Date(s.at).toISOString(),
          s.skill,
          level,
          it.a,
          it.op,
          it.b,
          it.ans,
          given,
          given === it.ans ? 1 : 0,
          it.ms,
          new Date(it.at).toISOString(),
        ].join(";")
      );
    }
  }
  // BOM so Excel detects UTF-8 (the × and ÷ signs)
  return "\uFEFF" + rows.join("\n") + "\n";
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
