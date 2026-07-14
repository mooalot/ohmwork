// Verifies the DC solver against hand-verified question answers, then sweeps
// the whole bank reporting which figures are solvable.
// Usage: node tools/sim-test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { simulate, parseValue } from '../js/sim.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const QDIR = join(ROOT, 'data', 'questions');
const bank = {};
for (const f of readdirSync(QDIR).filter((x) => x.endsWith('.json'))) {
  for (const q of JSON.parse(readFileSync(join(QDIR, f), 'utf8'))) bank[q.id] = q;
}

let fails = 0;
function check(name, actual, expected, tol = 0.02) {
  const ok = isFinite(actual) && Math.abs(actual - expected) <= Math.abs(expected) * tol + 1e-12;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${actual?.toPrecision?.(4)}, want ~${expected}`);
  if (!ok) fails++;
}
const el = (sim, label) => sim.elements.find((e) => e.comp.label === label);
const vAt = (sim, p) => sim.nets[sim.netOfPoint(p)]?.v;

// parseValue sanity
check('parse 4.7 kΩ', parseValue('4.7 kΩ'), 4700, 0);
check('parse 100 nF', parseValue('100 nF'), 1e-7, 0);
check('parse 10 µF', parseValue('10 µF'), 1e-5, 0);
check('parse 5 mA', parseValue('5 mA'), 5e-3, 0);
check('parse 0.5 Ω', parseValue('0.5 Ω'), 0.5, 0);

// dc-002: divider 12V, 6.8k/3.3k → V_out = 3.92 V at the output wire end
let s = simulate(bank['dc-002'].figure);
check('dc-002 V_out', vAt(s, [330, 140]), 3.92);
check('dc-002 I(R_1)', el(s, 'R_1').I, 12 / 10100);

// dc-005: 9V across 1k ∥ 4.7k ∥ 10k → I(R_A) = 9 mA (attaches mid-wire)
s = simulate(bank['dc-005'].figure);
check('dc-005 I(R_A)', el(s, 'R_A').I, 0.009);
check('dc-005 I(R_C)', el(s, 'R_C').I, 0.0009);

// dc-006: I(R_3) = 2.069 mA, mid node 6.83 V
s = simulate(bank['dc-006'].figure);
check('dc-006 I(R_3)', el(s, 'R_3').I, 0.002069);
check('dc-006 node', vAt(s, [220, 60]), 6.828);

// dc-012: opposing sources, loop I = 2.059 mA
s = simulate(bank['dc-012'].figure);
check('dc-012 I(R_1)', el(s, 'R_1').I, 0.0020588);

// dc-018: battery + internal resistance → 8.5 V across R_L
s = simulate(bank['dc-018'].figure);
check('dc-018 V(R_L)', Math.abs(el(s, 'R_L').V), 8.5);

// dc-010: slider divider with bindValue=2350 → V_out = 4 V
s = simulate(bank['dc-010'].figure, 2350);
check('dc-010 V_out @2350Ω', vAt(s, [330, 140]), 4.0);

// segment flows: dc-002 top wire carries the loop current
s = simulate(bank['dc-002'].figure);
const topSeg = s.segFlows.find((f) => f.a[1] === 60 && f.b[1] === 60);
check('dc-002 top wire flow', Math.abs(topSeg.I), 12 / 10100);

// full-bank sweep
let solvable = 0;
let circuits = 0;
const unsolved = [];
for (const q of Object.values(bank)) {
  if (q.figure?.kind !== 'circuit') continue;
  circuits++;
  let r = null;
  try {
    r = simulate(q.figure, q.type === 'slider' ? q.answer : undefined);
  } catch (e) {
    console.log(`CRASH ${q.id}: ${e.message}`);
    fails++;
  }
  if (r && r.nets.every((n) => isFinite(n.v))) solvable++;
  else unsolved.push(q.id);
}
console.log(`\n${solvable}/${circuits} circuit figures solvable`);
console.log(`unsolvable: ${unsolved.join(' ')}`);
console.log(fails ? `\n${fails} FAILURES` : '\nall checks passed');
process.exit(fails ? 1 : 0);
