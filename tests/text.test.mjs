import { test } from 'node:test';
import assert from 'node:assert/strict';

// stub KaTeX before question.js loads
globalThis.katex = {
  renderToString: (tex, opts) => `<kx d="${opts?.displayMode ? 1 : 0}">${tex}</kx>`,
};

const { mathHTML } = await import('../js/question.js');
const { decodeTex, formatSI } = await import('../js/figures.js');

test('mathHTML: inline and display math delegate to katex', () => {
  assert.equal(mathHTML('$V = IR$'), '<kx d="0">V = IR</kx>');
  assert.equal(mathHTML('a $$x$$ b'), 'a <kx d="1">x</kx> b');
});

test('mathHTML: escapes HTML in prose but not math', () => {
  assert.equal(mathHTML('a < b & c'), 'a &lt; b &amp; c');
  assert.equal(mathHTML('$a<b$'), '<kx d="0">a<b</kx>');
});

test('mathHTML: markdown bold and italic in prose runs', () => {
  assert.equal(mathHTML('the **most** power'), 'the <b>most</b> power');
  assert.equal(mathHTML('is *practically* done'), 'is <i>practically</i> done');
  assert.equal(mathHTML('**bold** and $x*y$'), '<b>bold</b> and <kx d="0">x*y</kx>');
});

test('mathHTML: unbalanced $ degrades gracefully, no crash', () => {
  const out = mathHTML('costs $5 in total');
  assert.ok(typeof out === 'string' && out.includes('5 in total'));
});

test('decodeTex: strips TeX authors slip into canvas labels', () => {
  assert.equal(decodeTex('+12\\,\\text{V}'), '+12 V');
  assert.equal(decodeTex('4.7\\,\\text{k}\\Omega'), '4.7 kΩ');
  assert.equal(decodeTex('10\\,\\mu\\text{F}'), '10 µF');
  assert.equal(decodeTex('V_{out}'), 'V_{out}'); // sub/sup markup passes through
});

test('formatSI: engineering notation', () => {
  assert.equal(formatSI(4700), '4.7k');
  assert.equal(formatSI(0.005), '5m');
  assert.equal(formatSI(1e-5), '10µ');
  assert.equal(formatSI(2.2e6), '2.2M');
  assert.equal(formatSI(0), '0');
  assert.equal(formatSI(3.3e-10), '330p');
});
