// Question player: renders one question, collects the answer, grades it.
import { renderFigure, formatSI } from './figures.js';
import { shuffle } from './state.js';

// Render text containing $...$ / $$...$$ into HTML with KaTeX.
export function mathHTML(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const isDisplay = text.startsWith('$$', i);
    if (text[i] === '$') {
      const delim = isDisplay ? '$$' : '$';
      const end = text.indexOf(delim, i + delim.length);
      if (end !== -1) {
        const tex = text.slice(i + delim.length, end);
        try {
          out.push(katex.renderToString(tex, { displayMode: isDisplay, throwOnError: false }));
        } catch (e) {
          out.push(escapeHTML(tex));
        }
        i = end + delim.length;
        continue;
      }
    }
    // plain text run up to the next $ (starting past i if we're sitting on an
    // unmatched $ — otherwise a lone $ would loop forever)
    let next = text.indexOf('$', text[i] === '$' ? i + 1 : i);
    if (next === -1) next = text.length;
    out.push(mdInline(escapeHTML(text.slice(i, next))));
    i = next;
  }
  return out.join('');
}

function escapeHTML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// minimal markdown for prose runs: **bold**, *italic*
function mdInline(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*\s][^*]*)\*/g, '<i>$1</i>');
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// Renders `q` into `container`. Calls `onAnswered(correct)` once graded.
// Returns { check() } — check() grades current input (used by the Check button
// and the Enter key); it returns null if no answer is selected yet.
export function renderQuestion(container, q, onAnswered) {
  container.innerHTML = '';
  const card = el('div', 'qcard');
  container.appendChild(card);

  const tierNames = { 1: 'intuition', 2: 'applied', 3: 'rigorous' };
  const badge = el('div', `tier-badge tier-${q.tier}`, tierNames[q.tier] || '');
  card.appendChild(badge);

  card.appendChild(el('div', 'prompt', mathHTML(q.prompt)));

  let figureApi = null;
  if (q.figure) {
    const figWrap = el('div', 'figure-wrap');
    card.appendChild(figWrap);
    figureApi = renderFigure(figWrap, q.figure);
  }

  const inputArea = el('div', 'input-area');
  card.appendChild(inputArea);

  let getAnswer; // () => {correct, chosen} | null
  let lockInputs;

  if (q.type === 'mc') {
    ({ getAnswer, lockInputs } = buildMC(inputArea, q));
  } else if (q.type === 'numeric') {
    ({ getAnswer, lockInputs } = buildNumeric(inputArea, q));
  } else if (q.type === 'slider') {
    ({ getAnswer, lockInputs } = buildSlider(inputArea, q, figureApi));
  } else if (q.type === 'probe') {
    ({ getAnswer, lockInputs } = buildProbe(inputArea, q, figureApi));
  } else {
    inputArea.textContent = `Unknown question type: ${q.type}`;
    getAnswer = () => null;
    lockInputs = () => {};
  }

  let answered = false;
  function check() {
    if (answered) return 'answered';
    const res = getAnswer();
    if (!res) return null;
    answered = true;
    lockInputs(res);
    const fb = el('div', `feedback ${res.correct ? 'good' : 'bad'}`);
    fb.appendChild(el('div', 'feedback-title', res.correct ? pick(PRAISE) : pick(ENCOURAGE)));
    if (!res.correct && res.correctText) {
      fb.appendChild(el('div', 'correct-answer', 'Answer: ' + res.correctText));
    }
    fb.appendChild(el('div', 'explanation', mathHTML(q.explanation || '')));
    card.appendChild(fb);

    // circuits come alive after grading: hover to probe, watch current flow
    if (figureApi && q.figure?.kind === 'circuit') {
      const readout = el('div', 'explore-readout');
      const hint = '🔬 <span>live circuit — hover to probe voltages & currents</span>';
      readout.innerHTML = hint;
      const on = figureApi.enableExplore((info) => {
        readout.innerHTML = info ? `🔬 <b>${info}</b>` : hint;
      });
      if (on) card.insertBefore(readout, fb);
    }

    fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    onAnswered(res.correct);
    return res.correct;
  }

  return { check };
}

const PRAISE = ['Nailed it! ⚡', 'Correct!', 'Sharp as a step edge.', 'Exactly right.', 'Low impedance path to the answer!'];
const ENCOURAGE = ['Not quite.', 'Close, but the circuit disagrees.', 'Not this time.', "Let's debug that."];
function pick(a) {
  return a[Math.floor(Math.random() * a.length)];
}

// --- multiple choice --------------------------------------------------------
function buildMC(area, q) {
  const order = shuffle(q.choices.map((_, i) => i));
  let selected = null;
  const buttons = order.map((origIdx, i) => {
    const b = el('button', 'choice');
    b.innerHTML = `<span class="choice-key">${i + 1}</span><span class="choice-body">${mathHTML(q.choices[origIdx])}</span>`;
    b.dataset.orig = origIdx;
    b.addEventListener('click', () => {
      if (b.disabled) return;
      selected = origIdx;
      buttons.forEach((x) => x.classList.toggle('selected', x === b));
    });
    area.appendChild(b);
    return b;
  });

  // number-key selection
  const keyHandler = (e) => {
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= buttons.length && !buttons[0].disabled) buttons[n - 1].click();
  };
  document.addEventListener('keydown', keyHandler);

  return {
    getAnswer() {
      if (selected == null) return null;
      return { correct: selected === q.answer };
    },
    lockInputs() {
      document.removeEventListener('keydown', keyHandler);
      buttons.forEach((b) => {
        b.disabled = true;
        const orig = parseInt(b.dataset.orig, 10);
        if (orig === q.answer) b.classList.add('reveal-correct');
        else if (orig === selected) b.classList.add('reveal-wrong');
      });
    },
  };
}

// --- numeric ----------------------------------------------------------------
function buildNumeric(area, q) {
  const wrap = el('div', 'numeric-wrap');
  const input = el('input', 'numeric-input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.placeholder = 'your answer';
  input.autocomplete = 'off';
  wrap.appendChild(input);
  if (q.unit) wrap.appendChild(el('span', 'unit', q.unit));
  area.appendChild(wrap);
  setTimeout(() => input.focus(), 0);

  return {
    getAnswer() {
      const v = parseFloat(input.value.replace(',', '.'));
      if (input.value.trim() === '' || isNaN(v)) return null;
      const correct = withinTolerance(v, q.answer, q.tolerance ?? 0.03);
      return { correct, correctText: `${q.answer} ${q.unit || ''}`.trim() };
    },
    lockInputs(res) {
      input.disabled = true;
      wrap.classList.add(res.correct ? 'good' : 'bad');
    },
  };
}

function withinTolerance(v, answer, tol) {
  if (answer === 0) return Math.abs(v) <= tol;
  return Math.abs(v - answer) / Math.abs(answer) <= tol;
}

// --- probe: answer by clicking the schematic --------------------------------
function buildProbe(area, q, figureApi) {
  const target = q.probe.target; // 'node' | 'component'
  const wrap = el('div', 'probe-wrap');
  const status = el(
    'div',
    'probe-status',
    target === 'node' ? '👆 Click a node on the schematic' : '👆 Click a component on the schematic'
  );
  wrap.appendChild(status);
  area.appendChild(wrap);

  let picked = null;
  figureApi.setProbeMode(target, (t) => {
    picked = t;
    status.innerHTML =
      t.kind === 'node'
        ? `Selected: node at (${t.at[0]}, ${t.at[1]}) — press Check`
        : `Selected: <b>${mathHTML('$' + (t.comp.label || t.comp.type) + '$')}</b> — press Check`;
  });

  function answerTarget() {
    if (q.answer.at) {
      return { kind: 'node', at: q.answer.at, net: figureApi.netOfPoint(q.answer.at) };
    }
    const comp = (q.figure.components || []).find((c) => c.label === q.answer.component);
    const at = comp.at || [(comp.from[0] + comp.to[0]) / 2, (comp.from[1] + comp.to[1]) / 2];
    return { kind: 'component', comp, at };
  }

  return {
    getAnswer() {
      if (!picked) return null;
      const ans = answerTarget();
      let correct;
      if (ans.kind === 'node') {
        correct = picked.kind === 'node' && figureApi.netOfPoint(picked.at) === ans.net && ans.net !== -1;
      } else {
        correct = picked.kind === 'component' && picked.comp.label === q.answer.component;
      }
      return {
        correct,
        correctText: ans.kind === 'component' ? `${q.answer.component}` : 'the highlighted node',
      };
    },
    lockInputs(res) {
      figureApi.probeReveal(answerTarget(), res.correct);
      wrap.classList.add(res.correct ? 'good' : 'bad');
    },
  };
}

// --- slider ----------------------------------------------------------------
function buildSlider(area, q, figureApi) {
  const s = q.slider;
  const wrap = el('div', 'slider-wrap');
  const label = el('div', 'slider-label');
  const input = el('input', 'slider-input');
  input.type = 'range';
  input.min = s.min;
  input.max = s.max;
  input.step = s.step;
  // start away from the answer so it's never pre-solved
  const mid = s.min + Math.round((s.max - s.min) / 2 / s.step) * s.step;
  input.value = withinTolerance(mid, q.answer, 0.1) ? s.min : mid;

  function refresh() {
    const v = parseFloat(input.value);
    label.innerHTML = mathHTML(`$${s.label} = $`) + `<b>${formatSI(v)}${s.unit}</b>`;
    if (figureApi) figureApi.setBind(v, s.unit);
  }
  input.addEventListener('input', refresh);
  wrap.appendChild(label);
  wrap.appendChild(input);
  area.appendChild(wrap);
  refresh();

  return {
    getAnswer() {
      const v = parseFloat(input.value);
      const correct = withinTolerance(v, q.answer, q.tolerance ?? 0.05);
      return { correct, correctText: `${formatSI(q.answer)}${s.unit}` };
    },
    lockInputs(res) {
      input.disabled = true;
      wrap.classList.add(res.correct ? 'good' : 'bad');
    },
  };
}
