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

function pick(rng, arr) {
  return arr[randInt(rng, 0, arr.length - 1)];
}

/* ---- investor mode ----
   Problems that build the mental math investors actually use. Each problem
   is fully described by (op, a, b): op names the kind, a/b are the two
   salient numbers, so misses round-trip through storage unchanged. All
   parameters are constrained so answers are positive integers (the keypad
   has no minus sign or decimal point). */

export const INVEST_LEVEL_KINDS = [
  ["invPercentOf", "invRule72Years"],
  ["invPercentOf", "invChange", "invRule72Rate"],
  ["invYield", "invPE", "invChange", "invRule72Years"],
  ["invCompound", "invBreakEven", "invPercentOf", "invYield"],
  ["invCompound", "invBreakEven", "invPercentOf", "invPE", "invChange"],
];

const INVEST_GEN = {
  // p % of base. Bases are multiples of 20 (early) or 100 (late) so every
  // listed percentage yields an integer.
  invPercentOf(rng, level) {
    const pcts =
      level <= 1 ? [10, 20, 25, 50] : level <= 2 ? [5, 15, 30, 75] : level <= 4 ? [4, 6, 8, 12, 15] : [3, 7, 9, 11, 15];
    const p = pick(rng, pcts);
    const base = level <= 2 ? 20 * randInt(rng, 2, 15) : 100 * randInt(rng, 2, level >= 5 ? 20 : 9);
    return { op: "invPercentOf", a: p, b: base, ans: (p * base) / 100 };
  },
  // From a to b — change in %. a is a multiple of 20 and pct a multiple of 5,
  // so the price difference is always an integer.
  invChange(rng, level) {
    const from = 20 * pick(rng, [1, 2, 4, 5, 10, 15, 25]);
    const down = level >= 3 && rng() < 0.5;
    const pct = pick(rng, down ? [10, 25, 50, 75] : [10, 25, 50, 100]);
    const diff = (from * pct) / 100;
    return down
      ? { op: "invChangeDown", a: from, b: from - diff, ans: pct }
      : { op: "invChangeUp", a: from, b: from + diff, ans: pct };
  },
  // Rule of 72: years to double at b % — rates are divisors of 72.
  invRule72Years(rng) {
    const rate = pick(rng, [2, 3, 4, 6, 8, 9, 12]);
    return { op: "invRule72Years", a: 72, b: rate, ans: 72 / rate };
  },
  // Rule of 72 backwards: required return to double in b years.
  invRule72Rate(rng) {
    const years = pick(rng, [3, 4, 6, 8, 9, 12]);
    return { op: "invRule72Rate", a: 72, b: years, ans: 72 / years };
  },
  // Dividend a on price b → yield %. Prices are multiples of 100.
  invYield(rng) {
    const price = 100 * randInt(rng, 1, 5);
    const y = randInt(rng, 2, 8);
    return { op: "invYield", a: (price * y) / 100, b: price, ans: y };
  },
  // Price a, earnings per share b → P/E.
  invPE(rng) {
    const eps = randInt(rng, 2, 12);
    const pe = randInt(rng, 8, 25);
    return { op: "invPE", a: eps * pe, b: eps, ans: pe };
  },
  // a kr compounding at b % for 2 years. Bases are multiples of 100 and
  // rates in {10,20,50}, so both intermediate and final values are integers.
  invCompound(rng) {
    const r = pick(rng, [10, 20, 50]);
    const base = 100 * randInt(rng, 1, 5);
    return { op: "invCompound", a: base, b: r, ans: (base * (100 + r) * (100 + r)) / 10000 };
  },
  // Down a % — how many % up to get back to even? Drops chosen so
  // 100·a/(100−a) is an integer.
  invBreakEven(rng, level) {
    const d = pick(rng, level >= 5 ? [20, 50, 60, 75, 80, 90] : [20, 50, 60, 75, 80]);
    return { op: "invBreakEven", a: d, b: 100 - d, ans: (100 * d) / (100 - d) };
  },
};

/**
 * Generate one problem.
 * @param {object} opts
 * @param {"add"|"sub"|"mul"|"div"|"mix"|"invest"} opts.skill
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

  if (s === "invest") {
    const lvl = Math.min(Math.max(levels.invest || 1, 1), INVEST_LEVEL_KINDS.length);
    const kind = pick(rng, INVEST_LEVEL_KINDS[lvl - 1]);
    return { skill: "invest", ...INVEST_GEN[kind](rng, lvl), fromMiss: false };
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

  if (typeof op === "string" && op.startsWith("inv")) {
    if (op === "invPercentOf") return { kind: op, p: a, base: b, tenth: b / 10, ans };
    if (op === "invChangeUp") return { kind: op, from: a, diff: b - a, ans };
    if (op === "invChangeDown") return { kind: op, from: a, diff: a - b, ans };
    if (op === "invRule72Years") return { kind: op, rate: b, ans };
    if (op === "invRule72Rate") return { kind: op, years: b, ans };
    if (op === "invYield") return { kind: op, div: a, price: b, onePct: b / 100, ans };
    if (op === "invPE") return { kind: op, price: a, eps: b, ans };
    if (op === "invCompound") return { kind: op, base: a, r: b, mid: (a * (100 + b)) / 100, ans };
    return { kind: "invBreakEven", d: a, left: 100 - a, ans };
  }

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
