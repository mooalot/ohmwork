#!/usr/bin/env node
// Validates question files in data/questions/ against QUESTIONS.md.
// Usage: node tools/validate.js [file.json ...]   (default: all files)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const QDIR = path.join(ROOT, 'data', 'questions');

const TWO_TERMINAL = new Set([
  'resistor', 'capacitor', 'inductor', 'vsource', 'isource', 'vsine',
  'diode', 'zener', 'led', 'switch', 'battery',
]);
const POINT = new Set(['ground', 'npn', 'pnp', 'nmos', 'pmos', 'opamp']);

let errors = 0;
let warnings = 0;

function err(file, id, msg) {
  console.error(`ERROR ${file}${id ? ` [${id}]` : ''}: ${msg}`);
  errors++;
}
function warn(file, id, msg) {
  console.warn(`warn  ${file}${id ? ` [${id}]` : ''}: ${msg}`);
  warnings++;
}

function balancedMath(s) {
  // count of unescaped $ must be even
  const n = (s.match(/(?<!\\)\$/g) || []).length;
  return n % 2 === 0;
}

function checkText(file, id, field, s) {
  if (typeof s !== 'string' || !s.trim()) return err(file, id, `${field} missing/empty`);
  if (!balancedMath(s)) err(file, id, `${field} has unbalanced $ delimiters`);
  if (/<[a-z]/i.test(s.replace(/\$[^$]*\$/g, ''))) warn(file, id, `${field} contains raw HTML tags`);
}

function checkFigure(file, id, fig, q) {
  if (fig.kind === 'plot') {
    if (!Array.isArray(fig.curves) || !fig.curves.length) return err(file, id, 'plot has no curves');
    for (const c of fig.curves) {
      if (!['exp', 'sine', 'expr', 'points'].includes(c.fn)) err(file, id, `unknown curve fn "${c.fn}"`);
      if (c.fn === 'points' && (!Array.isArray(c.points) || c.points.length < 2)) err(file, id, 'points curve needs >=2 points');
      if (c.fn === 'expr') {
        try { new Function('t', `return (${c.expr});`)(1); } catch (e) { err(file, id, `bad expr: ${e.message}`); }
      }
    }
    return;
  }
  if (fig.kind !== 'circuit') return err(file, id, `unknown figure kind "${fig.kind}"`);

  const W = fig.width || 420;
  const H = fig.height || 240;
  const inBounds = ([x, y]) => x >= 0 && x <= W && y >= 0 && y <= H;
  let binds = 0;

  for (const c of fig.components || []) {
    if (TWO_TERMINAL.has(c.type)) {
      if (!Array.isArray(c.from) || !Array.isArray(c.to)) { err(file, id, `${c.type} missing from/to`); continue; }
      if (!inBounds(c.from) || !inBounds(c.to)) err(file, id, `${c.type} ${c.label || ''} out of bounds (${W}x${H})`);
      const dx = Math.abs(c.to[0] - c.from[0]);
      const dy = Math.abs(c.to[1] - c.from[1]);
      if (dx > 0.01 && dy > 0.01) err(file, id, `${c.type} ${c.label || ''} not axis-aligned`);
      if (Math.max(dx, dy) < 60) err(file, id, `${c.type} ${c.label || ''} shorter than 60px (${Math.max(dx, dy)})`);
    } else if (POINT.has(c.type)) {
      if (!Array.isArray(c.at)) { err(file, id, `${c.type} missing at`); continue; }
      if (!inBounds(c.at)) err(file, id, `${c.type} out of bounds`);
    } else {
      err(file, id, `unknown component type "${c.type}"`);
    }
    if (c.bind) binds++;
  }
  for (const w of fig.wires || []) {
    if (!Array.isArray(w) || w.length < 2) { err(file, id, 'wire with <2 points'); continue; }
    for (let i = 1; i < w.length; i++) {
      const dx = Math.abs(w[i][0] - w[i - 1][0]);
      const dy = Math.abs(w[i][1] - w[i - 1][1]);
      if (dx > 0.01 && dy > 0.01) warn(file, id, `wire segment not axis-aligned at ${JSON.stringify(w[i - 1])}→${JSON.stringify(w[i])}`);
      if (!inBounds(w[i]) || !inBounds(w[i - 1])) err(file, id, 'wire out of bounds');
    }
  }
  if (q.type === 'slider' && binds !== 1) err(file, id, `slider question needs exactly one bind:true component (found ${binds})`);
  if (q.type !== 'slider' && binds > 0) warn(file, id, 'bind:true on a non-slider question');
}

function checkQuestion(file, q, topicId, seenIds) {
  const id = q.id || '(no id)';
  if (!q.id || typeof q.id !== 'string') err(file, null, 'question missing id');
  else if (seenIds.has(q.id)) err(file, id, 'duplicate id');
  seenIds.add(q.id);

  if (q.topic !== topicId) err(file, id, `topic "${q.topic}" != file topic "${topicId}"`);
  if (![1, 2, 3].includes(q.tier)) err(file, id, `tier must be 1|2|3, got ${q.tier}`);
  checkText(file, id, 'prompt', q.prompt);
  checkText(file, id, 'explanation', q.explanation);

  if (q.type === 'mc') {
    if (!Array.isArray(q.choices) || q.choices.length < 3 || q.choices.length > 5) {
      err(file, id, `mc needs 3-5 choices, got ${q.choices?.length}`);
    } else {
      q.choices.forEach((c, i) => checkText(file, id, `choices[${i}]`, c));
      if (new Set(q.choices).size !== q.choices.length) err(file, id, 'duplicate choices');
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.choices?.length || 0)) {
      err(file, id, `mc answer index ${q.answer} out of range`);
    }
  } else if (q.type === 'numeric') {
    if (typeof q.answer !== 'number' || !isFinite(q.answer)) err(file, id, `numeric answer must be a number, got ${JSON.stringify(q.answer)}`);
    if (typeof q.tolerance !== 'number' || q.tolerance <= 0 || q.tolerance > 0.25) err(file, id, `tolerance should be a fraction in (0, 0.25], got ${q.tolerance}`);
    if (q.unit != null && typeof q.unit !== 'string') err(file, id, 'unit must be a string');
  } else if (q.type === 'slider') {
    const s = q.slider;
    if (!s || typeof s.min !== 'number' || typeof s.max !== 'number' || typeof s.step !== 'number' || !s.unit || !s.label) {
      err(file, id, 'slider needs {min,max,step,unit,label}');
    } else {
      if (typeof q.answer !== 'number' || q.answer < s.min || q.answer > s.max) err(file, id, `slider answer ${q.answer} outside [${s.min}, ${s.max}]`);
      if (Math.abs(Math.round((q.answer - s.min) / s.step) * s.step + s.min - q.answer) > 1e-9) {
        warn(file, id, 'slider answer not reachable with given step');
      }
      if (!q.figure) err(file, id, 'slider question needs a figure with a bind:true component');
    }
    if (typeof q.tolerance !== 'number') err(file, id, 'slider needs tolerance');
  } else if (q.type === 'probe') {
    if (!q.probe || !['node', 'component'].includes(q.probe.target)) {
      err(file, id, 'probe needs probe.target of "node" or "component"');
    }
    if (!q.figure || q.figure.kind !== 'circuit') err(file, id, 'probe question needs a circuit figure');
    if (q.probe?.target === 'node') {
      if (!Array.isArray(q.answer?.at)) err(file, id, 'probe node answer needs {at:[x,y]}');
    } else if (q.probe?.target === 'component') {
      if (typeof q.answer?.component !== 'string') err(file, id, 'probe component answer needs {component:"label"}');
      else if (q.figure && !(q.figure.components || []).some((c) => c.label === q.answer.component)) {
        err(file, id, `probe answer component "${q.answer.component}" not in figure`);
      }
    }
  } else {
    err(file, id, `unknown type "${q.type}"`);
  }

  if (q.figure) checkFigure(file, id, q.figure, q);
}

const files = process.argv.length > 2
  ? process.argv.slice(2)
  : fs.readdirSync(QDIR).filter((f) => f.endsWith('.json')).map((f) => path.join(QDIR, f));

let total = 0;
const globalIds = new Set();
const tierCount = { 1: 0, 2: 0, 3: 0 };
const typeCount = {};
let withFigure = 0;

for (const fp of files) {
  const file = path.basename(fp);
  const topicId = file.replace(/\.json$/, '');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    err(file, null, `invalid JSON: ${e.message}`);
    continue;
  }
  if (!Array.isArray(data)) { err(file, null, 'top level must be an array'); continue; }
  const seen = new Set();
  for (const q of data) {
    checkQuestion(file, q, topicId, seen);
    if (q.id) {
      if (globalIds.has(q.id)) err(file, q.id, 'id duplicated across files');
      globalIds.add(q.id);
    }
    if (q.tier) tierCount[q.tier] = (tierCount[q.tier] || 0) + 1;
    typeCount[q.type] = (typeCount[q.type] || 0) + 1;
    if (q.figure) withFigure++;
    total++;
  }
  console.log(`${file}: ${data.length} questions`);
}

console.log(`\n${total} questions total | tiers ${tierCount[1]}/${tierCount[2]}/${tierCount[3]} | types ${JSON.stringify(typeCount)} | ${withFigure} with figures`);
console.log(`${errors} errors, ${warnings} warnings`);
process.exit(errors ? 1 : 0);
