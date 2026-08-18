/* Daily quests ("dagens uppdrag"): up to three mastery-framed goals per day,
   generated from the player's actual weaknesses. The reward is a checkmark
   and a cheer — never XP, currency or shortcuts, and never raw play time.
   No DOM, no storage. */

import { FAST_SEC, weakestOpen } from "./ladder.js";

export const QUEST_FAST_TARGET = 5; // fast correct answers in the focus component
export const QUEST_MISS_TARGET = 3; // old misses to settle
export const QUEST_FAST_ANY_TARGET = 10; // fallback when no old misses exist
export const QUEST_SESSION_MIN = 5; // attempts for a session to count as one

/** Local YYYY-MM-DD — the quest day boundary follows the device clock. */
export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True when stored quests are missing, malformed or from another day. */
export function questsStale(q, day) {
  return !q || q.day !== day || !Array.isArray(q.list);
}

/**
 * Generate the day's quests from current state:
 *  1. do one real session,
 *  2. fast correct answers in the weakest open component (the focus),
 *  3. settle old misses — or, with a clean slate, fast correct answers
 *     anywhere.
 */
export function generateQuests({ comps, due = [], misses = [] }, day) {
  const list = [{ type: "session", target: 1, done: 0 }];
  const weak = weakestOpen(comps, 1)[0];
  if (weak) list.push({ type: "fastFocus", comp: weak, target: QUEST_FAST_TARGET, done: 0 });
  const oldMisses = due.length + misses.length;
  list.push(
    oldMisses > 0
      ? { type: "clearMiss", target: Math.min(QUEST_MISS_TARGET, oldMisses), done: 0 }
      : { type: "fastAny", target: QUEST_FAST_ANY_TARGET, done: 0 }
  );
  return { day, list };
}

/**
 * Advance quest progress on one event and return the quests it completed.
 * Events:
 *  {type:"answer", ok, secs, comp?, oldMiss?} — one answered problem
 *  {type:"session", attempted}               — one finished session
 */
export function questEvent(quests, ev) {
  const completed = [];
  for (const q of quests.list) {
    if (q.done >= q.target) continue;
    let hit = false;
    if (q.type === "session") {
      hit = ev.type === "session" && ev.attempted >= QUEST_SESSION_MIN;
    } else if (ev.type === "answer" && ev.ok) {
      if (q.type === "fastFocus") hit = ev.comp === q.comp && ev.secs <= FAST_SEC;
      else if (q.type === "fastAny") hit = ev.secs <= FAST_SEC;
      else if (q.type === "clearMiss") hit = !!ev.oldMiss;
    }
    if (hit) {
      q.done++;
      if (q.done >= q.target) completed.push(q);
    }
  }
  return completed;
}

export function allQuestsDone(quests) {
  return !!quests && Array.isArray(quests.list) && quests.list.length > 0 && quests.list.every((q) => q.done >= q.target);
}
