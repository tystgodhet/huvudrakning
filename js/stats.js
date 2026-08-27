/* Pure statistics over session history. No DOM, no storage. */

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Consecutive practice days ending today (or yesterday, if today has no
 * session yet — a streak isn't broken until the day is actually over).
 * @param {number[]} timestamps session timestamps (ms)
 * @param {number} [now]
 */
export function dayStreak(timestamps, now = Date.now()) {
  const days = new Set(timestamps.map(dayKey));
  const d = new Date(now);
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(d.getTime()))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/**
 * Most recent session timestamp, or null if the history is empty.
 * @param {number[]} timestamps
 */
export function lastSessionAt(timestamps) {
  if (!timestamps.length) return null;
  return Math.max(...timestamps);
}

/**
 * Last practice as a local calendar-day signal relative to `now`.
 * A parent glance: today / yesterday / an older date / never — never a
 * comparison against anyone else.
 * @param {number[]} timestamps session timestamps (ms)
 * @param {number} [now]
 * @returns {{kind: "today"|"yesterday"|"date"|"never", at: number|null}}
 */
export function lastPractice(timestamps, now = Date.now()) {
  const at = lastSessionAt(timestamps);
  if (at == null) return { kind: "never", at: null };
  if (dayKey(at) === dayKey(now)) return { kind: "today", at };
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (dayKey(at) === dayKey(y.getTime())) return { kind: "yesterday", at };
  return { kind: "date", at };
}

/**
 * Personal bests for one skill: most correct in a session, and fastest
 * average pace (only sessions with ≥5 attempts count for pace).
 * @returns {{bestCorrect:number, bestAvg:number|null}|null}
 */
export function personalBest(sessions, skill) {
  const rel = sessions.filter((s) => s.skill === skill);
  if (!rel.length) return null;
  const bestCorrect = Math.max(...rel.map((s) => s.correct));
  const paced = rel.filter((s) => s.attempted >= 5 && s.avg > 0);
  const bestAvg = paced.length ? Math.min(...paced.map((s) => s.avg)) : null;
  return { bestCorrect, bestAvg };
}

/**
 * "Then vs now": averages over the first `windowSize` sessions vs the most
 * recent `windowSize` sessions of a skill. Null until 2× windowSize exist.
 */
export function thenVsNow(sessions, skill, windowSize = 3) {
  const rel = sessions.filter((s) => s.skill === skill);
  if (rel.length < windowSize * 2) return null;
  const avgOf = (list) => ({
    acc: Math.round(list.reduce((sum, s) => sum + s.acc, 0) / list.length),
    avg: Math.round((list.reduce((sum, s) => sum + (s.avg || 0), 0) / list.length) * 10) / 10,
    correct: Math.round(list.reduce((sum, s) => sum + s.correct, 0) / list.length),
  });
  return {
    then: avgOf(rel.slice(0, windowSize)),
    now: avgOf(rel.slice(-windowSize)),
    windowSize,
  };
}

/**
 * Outstanding-miss count per table for × or ÷ (the table is the larger
 * factor for ×, the divisor for ÷). Lower is better; 0 = mastered.
 * @param {object[]} misses outstanding misses [{a,b,op,...}]
 * @param {"×"|"÷"} op
 * @returns {Object<number,number>}
 */
export function masteryByTable(misses, op) {
  const counts = {};
  for (const m of misses) {
    if (m.op !== op) continue;
    const tbl = op === "×" ? Math.max(m.a, m.b) : m.b;
    counts[tbl] = (counts[tbl] || 0) + 1;
  }
  return counts;
}
