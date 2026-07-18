/* Pure adaptive-difficulty rules for addition/subtraction levels. */

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;
export const MIN_ATTEMPTS = 5;
export const LEVEL_UP_ACC = 90; // ≥90 % → level up
export const LEVEL_DOWN_ACC = 70; // <70 % → level down (target band ~80–85 %)

/**
 * Level after a finished session.
 * @param {number} level     current level 1–5
 * @param {number} attempted problems attempted in the session
 * @param {number} correct   problems answered correctly
 * @returns {number} next level (may equal current)
 */
export function nextLevel(level, attempted, correct) {
  if (attempted < MIN_ATTEMPTS) return level;
  const acc = (correct / attempted) * 100;
  if (acc >= LEVEL_UP_ACC) return Math.min(MAX_LEVEL, level + 1);
  if (acc < LEVEL_DOWN_ACC) return Math.max(MIN_LEVEL, level - 1);
  return level;
}

/** True when adaptive levelling applies to a session of this skill. */
export function isAdaptiveSkill(skill) {
  return skill === "add" || skill === "sub";
}
