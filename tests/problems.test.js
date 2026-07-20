import { test } from "node:test";
import assert from "node:assert/strict";
import { generateProblem, generateLadderProblem, ladderPool, tipFor, LEVEL_RANGES, INVEST_LEVEL_KINDS } from "../js/problems.js";

// deterministic rng (mulberry32)
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("addition stays within the level's range and is correct", () => {
  for (let level = 1; level <= 5; level++) {
    const rng = seeded(level * 7);
    const [lo, hi] = LEVEL_RANGES[level - 1];
    for (let i = 0; i < 200; i++) {
      const p = generateProblem({ skill: "add", levels: { add: level }, rng });
      assert.equal(p.op, "+");
      assert.ok(p.a >= lo && p.a <= hi, `a=${p.a} outside [${lo},${hi}]`);
      assert.ok(p.b >= lo && p.b <= hi, `b=${p.b} outside [${lo},${hi}]`);
      assert.equal(p.ans, p.a + p.b);
    }
  }
});

test("subtraction never produces a negative answer", () => {
  const rng = seeded(42);
  for (let i = 0; i < 500; i++) {
    const p = generateProblem({ skill: "sub", levels: { sub: 1 + (i % 5) }, rng });
    assert.equal(p.op, "−");
    assert.ok(p.ans >= 0);
    assert.equal(p.ans, p.a - p.b);
  }
});

test("multiplication uses a selected table and a factor 1–10", () => {
  const tables = [3, 7, 12];
  const rng = seeded(9);
  for (let i = 0; i < 300; i++) {
    const p = generateProblem({ skill: "mul", tables, rng });
    assert.equal(p.op, "×");
    const valid =
      (tables.includes(p.a) && p.b >= 1 && p.b <= 10) || (tables.includes(p.b) && p.a >= 1 && p.a <= 10);
    assert.ok(valid, `${p.a}×${p.b} has no (table, 1–10 factor) assignment`);
    assert.equal(p.ans, p.a * p.b);
  }
});

test("division divides evenly by a selected table with quotient 1–10", () => {
  const tables = [4, 6];
  const rng = seeded(13);
  for (let i = 0; i < 300; i++) {
    const p = generateProblem({ skill: "div", tables, rng });
    assert.equal(p.op, "÷");
    assert.ok(tables.includes(p.b));
    assert.equal(p.a % p.b, 0);
    assert.ok(p.ans >= 1 && p.ans <= 10);
    assert.equal(p.ans, p.a / p.b);
  }
});

test("mixed skill never picks mul/div when no tables are selected", () => {
  const rng = seeded(77);
  for (let i = 0; i < 300; i++) {
    const p = generateProblem({ skill: "mix", levels: { add: 2, sub: 2 }, tables: [], rng });
    assert.ok(p.op === "+" || p.op === "−", `unexpected op ${p.op}`);
  }
});

test("misses are resampled ~30% of the time for the current skill", () => {
  const misses = [{ skill: "mul", a: 7, b: 8, op: "×", ans: 56 }];
  // rng below 0.3 → resample path
  let calls = 0;
  const lowRng = () => [0.1, 0.0][calls++ % 2];
  const p = generateProblem({ skill: "mul", tables: [2], misses, rng: lowRng });
  assert.equal(p.fromMiss, true);
  assert.deepEqual([p.a, p.b, p.ans], [7, 8, 56]);

  // rng above 0.3 → fresh problem
  const freshRng = seeded(5);
  const results = [];
  for (let i = 0; i < 500; i++) {
    results.push(generateProblem({ skill: "mul", tables: [2], misses, rng: freshRng }).fromMiss);
  }
  const rate = results.filter(Boolean).length / results.length;
  assert.ok(rate > 0.2 && rate < 0.4, `resample rate ${rate} not ≈0.3`);
});

test("misses from another skill are not resampled", () => {
  const misses = [{ skill: "add", a: 99, b: 99, op: "+", ans: 198 }];
  const rng = () => 0.0; // would always resample if eligible
  const p = generateProblem({ skill: "mul", tables: [2], misses, rng });
  assert.equal(p.fromMiss, false);
});

test("ladder problems stay within each level's fact pool and are correct", () => {
  const inPool = (level, a, b) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (level <= 3) {
      const top = level === 1 ? 5 : level === 2 ? 10 : 12;
      return (lo <= top && hi <= 10) || (hi <= top && lo <= 10);
    }
    if (level === 4) return lo >= 3 && lo <= 9 && hi >= 12 && hi <= 29;
    if (level === 5) return a === b && a >= 11 && a <= 25;
    return lo >= 11 && hi <= 25;
  };
  for (let level = 1; level <= 6; level++) {
    const rng = seeded(level * 31);
    for (let i = 0; i < 300; i++) {
      const p = generateLadderProblem({ level, rng });
      assert.equal(p.skill, "mul");
      assert.equal(p.ans, p.a * p.b);
      assert.equal(p.ladder, level);
      assert.equal(p.fromBelow, false);
      assert.ok(inPool(level, p.a, p.b), `${p.a}×${p.b} outside level ${level}`);
    }
  }
});

test("high-weight facts are sampled far more often", () => {
  const facts = { "7x8": { w: 27, ok: false, t: 8 } };
  const rng = seeded(3);
  let hits = 0;
  const N = 1000;
  for (let i = 0; i < N; i++) {
    const p = generateLadderProblem({ level: 2, facts, rng });
    if (Math.min(p.a, p.b) === 7 && Math.max(p.a, p.b) === 8) hits++;
  }
  // uniform would be ~2 %, weighted expectation is ~26 %
  assert.ok(hits / N > 0.12, `weighted fact hit rate ${hits / N} too low`);
});

test("slump mixes in ~30% problems from the level below, never above", () => {
  const rng = seeded(17);
  let below = 0;
  const N = 1000;
  for (let i = 0; i < N; i++) {
    const p = generateLadderProblem({ level: 3, slump: true, rng });
    if (p.fromBelow) {
      below++;
      assert.equal(p.ladder, 2);
    } else assert.equal(p.ladder, 3);
  }
  const rate = below / N;
  assert.ok(rate > 0.2 && rate < 0.4, `fromBelow rate ${rate} not ≈0.3`);
  // no slump on level 1 even when flagged
  const p1 = generateLadderProblem({ level: 1, slump: true, rng });
  assert.equal(p1.fromBelow, false);
});

test("ladder pools have the expected sizes", () => {
  assert.equal(ladderPool(1).length, 50);
  assert.equal(ladderPool(2).length, 100);
  assert.equal(ladderPool(3).length, 120);
  assert.equal(ladderPool(5).length, 15);
});

test("square and two-digit tips are numerically consistent", () => {
  const sq = tipFor({ a: 23, b: 23, op: "×", ans: 529 });
  assert.equal(sq.kind, "mulSquare");
  assert.equal(sq.prod + sq.dsq, 529);
  const two = tipFor({ a: 17, b: 23, op: "×", ans: 391 });
  assert.equal(two.kind, "mulSplit2");
  assert.equal(two.p1 + two.p2, 391);
  // round factors fall back to the tens split
  assert.equal(tipFor({ a: 20, b: 20, op: "×", ans: 400 }).kind, "mulSplit10");
});

test("invest problems draw from the level's kinds and have positive integer answers", () => {
  for (let level = 1; level <= 5; level++) {
    const rng = seeded(level * 11);
    const allowed = INVEST_LEVEL_KINDS[level - 1];
    for (let i = 0; i < 300; i++) {
      const p = generateProblem({ skill: "invest", levels: { invest: level }, rng });
      assert.equal(p.skill, "invest");
      const base = p.op.replace(/(Up|Down)$/, "");
      assert.ok(allowed.includes(base) || allowed.includes("invChange"), `${p.op} not allowed at level ${level}`);
      assert.ok(Number.isInteger(p.ans) && p.ans > 0, `non-integer/negative answer ${p.ans} for ${p.op}`);
      assert.ok(String(p.ans).length <= 5, `answer ${p.ans} does not fit the keypad`);
    }
  }
});

test("invest answers satisfy each kind's defining relation", () => {
  const rng = seeded(101);
  for (let level = 1; level <= 5; level++) {
    for (let i = 0; i < 300; i++) {
      const p = generateProblem({ skill: "invest", levels: { invest: level }, rng });
      const { a, b, op, ans } = p;
      if (op === "invPercentOf") assert.equal(ans * 100, a * b);
      else if (op === "invChangeUp") assert.equal(ans * a, (b - a) * 100);
      else if (op === "invChangeDown") assert.equal(ans * a, (a - b) * 100);
      else if (op === "invRule72Years" || op === "invRule72Rate") assert.equal(ans * b, 72);
      else if (op === "invYield") assert.equal(ans * b, a * 100);
      else if (op === "invPE") assert.equal(ans * b, a);
      else if (op === "invCompound") assert.equal(ans * 10000, a * (100 + b) * (100 + b));
      else if (op === "invBreakEven") assert.equal(ans * (100 - a), 100 * a);
      else assert.fail(`unknown invest kind ${op}`);
    }
  }
});

test("invest misses resample with the kind preserved", () => {
  const misses = [{ skill: "invest", a: 80, b: 100, op: "invChangeUp", ans: 25 }];
  let calls = 0;
  const lowRng = () => [0.1, 0.0][calls++ % 2];
  const p = generateProblem({ skill: "invest", levels: { invest: 3 }, misses, rng: lowRng });
  assert.equal(p.fromMiss, true);
  assert.equal(p.op, "invChangeUp");
  assert.deepEqual([p.a, p.b, p.ans], [80, 100, 25]);
});

test("invest tips are computed from the problem's numbers", () => {
  const c = tipFor({ op: "invCompound", a: 100, b: 10, ans: 121 });
  assert.equal(c.kind, "invCompound");
  assert.equal(c.mid, 110);
  const po = tipFor({ op: "invPercentOf", a: 15, b: 200, ans: 30 });
  assert.equal(po.tenth, 20);
  const be = tipFor({ op: "invBreakEven", a: 50, b: 50, ans: 100 });
  assert.equal(be.left, 50);
  const y = tipFor({ op: "invYield", a: 12, b: 300, ans: 4 });
  assert.equal(y.onePct, 3);
  assert.equal(tipFor({ op: "invChangeDown", a: 100, b: 75, ans: 25 }).diff, 25);
});

test("tip selection picks the right technique", () => {
  assert.equal(tipFor({ a: 9, b: 7, op: "×", ans: 63 }).kind, "mul9");
  assert.equal(tipFor({ a: 6, b: 5, op: "×", ans: 30 }).kind, "mul5");
  assert.equal(tipFor({ a: 7, b: 8, op: "×", ans: 56 }).kind, "mulSplit");
  assert.equal(tipFor({ a: 12, b: 7, op: "×", ans: 84 }).kind, "mulSplit10");
  assert.equal(tipFor({ a: 3, b: 10, op: "×", ans: 30 }).kind, "mul10");
  assert.equal(tipFor({ a: 56, b: 8, op: "÷", ans: 7 }).kind, "divBack");
  assert.equal(tipFor({ a: 70, b: 10, op: "÷", ans: 7 }).kind, "div10");
  assert.equal(tipFor({ a: 47, b: 25, op: "+", ans: 72 }).kind, "addLeftRight");
  assert.equal(tipFor({ a: 8, b: 5, op: "+", ans: 13 }).kind, "addMakeTen");
  assert.equal(tipFor({ a: 83, b: 27, op: "−", ans: 56 }).kind, "subRound");
  assert.equal(tipFor({ a: 15, b: 7, op: "−", ans: 8 }).kind, "subRound");
  assert.equal(tipFor({ a: 48, b: 3, op: "−", ans: 45 }).kind, "subOnes");
  assert.equal(tipFor({ a: 7, b: 3, op: "−", ans: 4 }).kind, "subCountUp");
});

test("tip params are numerically consistent", () => {
  const tip = tipFor({ a: 83, b: 27, op: "−", ans: 56 });
  assert.equal(tip.rounded, 30);
  assert.equal(tip.mid, 53);
  assert.equal(tip.back, 3);
  const mul = tipFor({ a: 12, b: 7, op: "×", ans: 84 });
  assert.equal(mul.part1 + mul.part2, 84);
});
