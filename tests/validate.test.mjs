import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALIDATOR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'validate.js');

function run(questions, topic = 'dc-basics') {
  const dir = mkdtempSync(join(tmpdir(), 'ohmwork-val-'));
  const file = join(dir, `${topic}.json`);
  writeFileSync(file, JSON.stringify(questions));
  try {
    const out = execFileSync('node', [VALIDATOR, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const GOOD = {
  id: 'dc-901', topic: 'dc-basics', tier: 1, type: 'mc',
  prompt: 'ok $x$?', choices: ['a', 'b', 'c'], answer: 0, explanation: 'because $y$',
};

test('accepts a valid question', () => {
  assert.equal(run([GOOD]).code, 0);
});

test('rejects mc answer index out of range', () => {
  const r = run([{ ...GOOD, answer: 5 }]);
  assert.equal(r.code, 1);
  assert.match(r.out, /out of range/);
});

test('rejects unbalanced math delimiters', () => {
  const r = run([{ ...GOOD, prompt: 'lonely $ dollar' }]);
  assert.equal(r.code, 1);
  assert.match(r.out, /unbalanced/);
});

test('rejects duplicate ids and wrong topic', () => {
  const r = run([GOOD, { ...GOOD }]);
  assert.equal(r.code, 1);
  assert.match(r.out, /duplicate id/);
  const r2 = run([{ ...GOOD, topic: 'bjt' }]);
  assert.match(r2.out, /!= file topic/);
});

test('rejects bad tier and unknown type', () => {
  assert.match(run([{ ...GOOD, tier: 4 }]).out, /tier must be/);
  assert.match(run([{ ...GOOD, type: 'essay' }]).out, /unknown type/);
});

test('rejects numeric without tolerance or with string answer', () => {
  const nq = { ...GOOD, type: 'numeric', answer: 5, unit: 'V' };
  delete nq.choices;
  assert.match(run([nq]).out, /tolerance/);
  assert.match(run([{ ...nq, tolerance: 0.03, answer: '5' }]).out, /must be a number/);
});

test('rejects figure geometry violations', () => {
  const fig = (components, extra = {}) => [{
    ...GOOD,
    figure: { kind: 'circuit', width: 420, height: 240, components, ...extra },
  }];
  // diagonal component
  assert.match(run(fig([{ type: 'resistor', from: [60, 60], to: [200, 200] }])).out, /not axis-aligned/);
  // too short
  assert.match(run(fig([{ type: 'resistor', from: [60, 60], to: [100, 60] }])).out, /shorter than 60px/);
  // out of bounds
  assert.match(run(fig([{ type: 'resistor', from: [60, 60], to: [500, 60] }])).out, /out of bounds/);
  // unknown component
  assert.match(run(fig([{ type: 'transformer', from: [60, 60], to: [160, 60] }])).out, /unknown component/);
});

test('rejects slider without exactly one bound component', () => {
  const sq = {
    ...GOOD, type: 'slider', prompt: 'set $R$', answer: 500, tolerance: 0.05,
    slider: { min: 100, max: 1000, step: 50, unit: 'Ω', label: 'R' },
    figure: { kind: 'circuit', components: [{ type: 'resistor', from: [60, 60], to: [160, 60] }] },
  };
  delete sq.choices;
  assert.match(run([sq]).out, /exactly one bind/);
});

test('rejects probe with missing/foreign answer component', () => {
  const pq = {
    ...GOOD, type: 'probe', probe: { target: 'component' }, answer: { component: 'R_9' },
    figure: { kind: 'circuit', components: [{ type: 'resistor', from: [60, 60], to: [160, 60], label: 'R_1' }] },
  };
  delete pq.choices;
  assert.match(run([pq]).out, /not in figure/);
  const pn = { ...pq, probe: { target: 'node' }, answer: {} };
  assert.match(run([pn]).out, /needs \{at:\[x,y\]\}/);
});

test('whole real bank passes', () => {
  const out = execFileSync('node', [VALIDATOR], { encoding: 'utf8' });
  assert.match(out, /0 errors, 0 warnings/);
});
