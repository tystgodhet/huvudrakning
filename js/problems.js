/* Pure problem generation + technique-tip selection. No DOM, no storage. */

export const LEVEL_RANGES = [
  [1, 10],
  [5, 30],
  [10, 99],
  [25, 199],
  [100, 999],
];
export const MAX_TABLE = 12;
export const MISS_RESAMPLE_RATE = 0.3;

export function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/**
 * Generate one problem.
 * @param {object} opts
 * @param {"add"|"sub"|"mul"|"div"|"mix"} opts.skill
 * @param {object} opts.levels    per-skill levels 1–5 (used for add/sub)
 * @param {number[]} opts.tables  selected tables 1–12 (used for mul/div)
 * @param {object[]} opts.misses  outstanding misses [{skill,a,b,op,ans}]
 * @param {function} [opts.rng]   0..1 random source, injectable for tests
 * @returns {{skill:string,a:number,b:number,op:string,ans:number,fromMiss:boolean}}
 */
export function generateProblem({ skill, levels = {}, tables = [], misses = [], rng = Math.random }) {
  let s = skill;
  if (s === "mix") {
    const pool = tables.length ? ["add", "sub", "mul", "div"] : ["add", "sub"];
    s = pool[randInt(rng, 0, pool.length - 1)];
  }

  const skillMisses = misses.filter((m) => m.skill === s);
  if (skillMisses.length && rng() < MISS_RESAMPLE_RATE) {
    const m = skillMisses[randInt(rng, 0, skillMisses.length - 1)];
    return { skill: s, a: m.a, b: m.b, op: m.op, ans: m.ans, fromMiss: true };
  }

  const level = Math.min(Math.max(levels[s] || 1, 1), LEVEL_RANGES.length);
  if (s === "add") {
    const [lo, hi] = LEVEL_RANGES[level - 1];
    const a = randInt(rng, lo, hi);
    const b = randInt(rng, lo, hi);
    return { skill: s, a, b, op: "+", ans: a + b, fromMiss: false };
  }
  if (s === "sub") {
    const [lo, hi] = LEVEL_RANGES[level - 1];
    let a = randInt(rng, lo, hi);
    let b = randInt(rng, lo, hi);
    if (b > a) [a, b] = [b, a];
    return { skill: s, a, b, op: "−", ans: a - b, fromMiss: false };
  }
  if (s === "mul") {
    const tbl = tables[randInt(rng, 0, tables.length - 1)];
    const other = randInt(rng, 1, 10);
    const [a, b] = rng() < 0.5 ? [other, tbl] : [tbl, other];
    return { skill: s, a, b, op: "×", ans: a * b, fromMiss: false };
  }
  // div: built from the selected tables so it mirrors multiplication practice
  const tbl = tables.length ? tables[randInt(rng, 0, tables.length - 1)] : 2;
  const q = randInt(rng, 1, 10);
  return { skill: "div", a: tbl * q, b: tbl, op: "÷", ans: q, fromMiss: false };
}

/**
 * Pick a mental-math technique for a missed problem, with all numbers
 * precomputed so i18n templates stay dumb.
 * @returns {{kind:string}} plus kind-specific params
 */
export function tipFor(p) {
  const { a, b, op, ans } = p;

  if (op === "+") {
    const big = Math.max(a, b);
    const small = Math.min(a, b);
    if (small >= 10) {
      const tens = Math.floor(small / 10) * 10;
      const rest = small % 10;
      if (rest === 0) return { kind: "addTens", big, small, tCount: small / 10, ans };
      return { kind: "addLeftRight", big, small, tens, mid: big + tens, rest, ans };
    }
    const toTen = 10 - (big % 10);
    if (big % 10 !== 0 && toTen < small) {
      return { kind: "addMakeTen", big, small, toTen, mid: big + toTen, rest: small - toTen, ans };
    }
    return { kind: "addSimple", big, small, ans };
  }

  if (op === "−") {
    if (b >= 10 && b % 10 === 0) return { kind: "subTens", a, b, tCount: b / 10, ans };
    if (a >= 10 && b < 10 && a % 10 >= b) {
      return { kind: "subOnes", a, b, ones: a % 10, onesLeft: (a % 10) - b, ans };
    }
    const rounded = Math.ceil(b / 10) * 10;
    if (rounded !== b && a - rounded >= 0) {
      return { kind: "subRound", a, b, rounded, mid: a - rounded, back: rounded - b, ans };
    }
    return { kind: "subCountUp", a, b, ans };
  }

  if (op === "×") {
    if (a === 1 || b === 1) return { kind: "mul1", ans };
    if (a === 10 || b === 10) return { kind: "mul10", other: a === 10 ? b : a, ans };
    if (a === 9 || b === 9) return { kind: "mul9", other: a === 9 ? b : a, ans };
    if (a === 5 || b === 5) {
      const other = a === 5 ? b : a;
      return { kind: "mul5", other, ten: other * 10, ans };
    }
    const f = Math.max(a, b);
    const o = Math.min(a, b);
    if (f > 10) return { kind: "mulSplit10", o, f, part1: o * 10, rest: f - 10, part2: o * (f - 10), ans };
    return { kind: "mulSplit", a, b, prev: a * (b - 1), ans };
  }

  // division
  if (b === 1) return { kind: "div1", ans };
  if (b === 10) return { kind: "div10", a, ans };
  return { kind: "divBack", a, b, ans };
}
