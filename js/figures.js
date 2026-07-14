// Canvas renderer for question figures: circuit schematics and plots.
// See QUESTIONS.md for the figure spec this implements.
// Interactivity (explore mode + probe questions) is driven by sim.js.
import { simulate, buildNets } from './sim.js';

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function theme() {
  return {
    stroke: cssVar('--fig-stroke', '#dcefe2'),
    text: cssVar('--fig-text', '#93b3a2'),
    accent: cssVar('--fig-accent', '#3df5a6'),
    muted: cssVar('--fig-muted', '#4e6a5c'),
    grid: cssVar('--fig-grid', 'rgba(120,170,145,0.13)'),
    curves: ['#3df5a6', '#46d4e8', '#e0954f', '#ff5c7a'],
  };
}

// Renders `figure` into `container`. Returns a handle:
//   setBind(value, unit) — slider questions live-update the bound component
//   enableExplore()      — after answering: hover-probe + current animation
//   setProbeMode(target, onPick) — probe questions: click a node/component
//   probeReveal(answer, pickedOk) — mark the correct target after grading
export function renderFigure(container, figure) {
  const canvas = document.createElement('canvas');
  const w = figure.width || 420;
  const h = figure.height || (figure.kind === 'plot' ? 220 : 240);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.maxWidth = '100%';
  canvas.className = 'figure-canvas';
  container.appendChild(canvas);

  let bindText = null;
  let bindValue = null;
  const overlay = { hover: null, probePick: null, probeReveal: null, sim: null, dots: false };

  function draw() {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (figure.kind === 'plot') drawPlot(ctx, figure, w, h);
    else {
      drawCircuit(ctx, figure, bindText);
      drawOverlay(ctx, figure, overlay);
    }
  }
  draw();

  // map a mouse event to figure coordinates (canvas may be CSS-scaled down)
  function toFig(ev) {
    const r = canvas.getBoundingClientRect();
    return [((ev.clientX - r.left) / r.width) * w, ((ev.clientY - r.top) / r.height) * h];
  }

  const geo = figure.kind === 'circuit' ? buildNets(figure) : null;

  function nearestTarget(p, mode) {
    // mode 'node' | 'component' | 'any'
    let best = null;
    if (mode !== 'component') {
      for (let n = 0; n < geo.nets.length; n++) {
        for (const pt of geo.nets[n].points) {
          const d = Math.hypot(pt[0] - p[0], pt[1] - p[1]);
          if (d < 14 && (!best || d < best.d)) best = { kind: 'node', net: n, at: pt, d };
        }
      }
    }
    if (mode !== 'node' && !best) {
      for (const c of figure.components || []) {
        if (c.type === 'ground') continue;
        const [cx, cy] = c.at || [(c.from[0] + c.to[0]) / 2, (c.from[1] + c.to[1]) / 2];
        const d = Math.hypot(cx - p[0], cy - p[1]);
        if (d < 30 && (!best || d < best.d)) best = { kind: 'component', comp: c, at: [cx, cy], d };
      }
    }
    return best;
  }

  let raf = null;
  function animate() {
    if (!canvas.isConnected) { cancelAnimationFrame(raf); return; }
    draw();
    raf = requestAnimationFrame(animate);
  }

  const api = {
    setBind(value, unit) {
      bindValue = value;
      bindText = formatSI(value) + (unit ? ' ' + unit : '');
      draw();
    },

    // hover-probe + animated current flow (call after the question is graded)
    enableExplore(onInfo) {
      if (figure.kind !== 'circuit') return false;
      const sim = simulate(figure, bindValue);
      if (!sim || !sim.nets.every((n) => isFinite(n.v) && Math.abs(n.v) < 1e6)) return false;
      overlay.sim = sim;
      overlay.dots = true;
      canvas.style.cursor = 'crosshair';
      canvas.addEventListener('pointermove', (ev) => {
        const t = nearestTarget(toFig(ev), 'any');
        overlay.hover = t;
        if (!onInfo) return;
        if (!t) return onInfo(null);
        if (t.kind === 'node') {
          onInfo(`node — ${formatSI(sim.nets[t.net].v)}V`);
        } else {
          const el = sim.elements.find((e) => e.comp === t.comp);
          if (!el) return onInfo(null);
          const name = t.comp.label || t.comp.type;
          onInfo(`${name} — ${formatSI(Math.abs(el.V))}V · ${formatSI(Math.abs(el.I))}A · ${formatSI(el.P)}W`);
        }
      });
      canvas.addEventListener('pointerleave', () => {
        overlay.hover = null;
        if (onInfo) onInfo(null);
      });
      // ?noanim renders one static frame — deterministic headless screenshots
      if (typeof location !== 'undefined' && /[?&]noanim/.test(location.search)) draw();
      else animate();
      return true;
    },

    // probe questions: user must click a node or component
    setProbeMode(target, onPick) {
      canvas.style.cursor = 'crosshair';
      const handler = (ev) => {
        const t = nearestTarget(toFig(ev), target);
        if (!t) return;
        overlay.probePick = t;
        draw();
        onPick(t);
      };
      canvas.addEventListener('click', handler);
      api._stopProbe = () => canvas.removeEventListener('click', handler);
    },

    // after grading a probe: highlight the true answer (green) and, if the
    // pick was wrong, leave the pick marked red
    probeReveal(answerTarget, pickedOk) {
      api._stopProbe?.();
      canvas.style.cursor = 'default';
      overlay.probeReveal = { target: answerTarget, ok: pickedOk };
      draw();
    },

    netOfPoint: (p) => (geo ? geo.netOfPoint(p) : -1),
    redraw: draw,
  };
  return api;
}

// --- explore/probe overlay --------------------------------------------------
function drawOverlay(ctx, fig, ov) {
  const t = theme();

  // animated current dots
  if (ov.dots && ov.sim) {
    const now = performance.now() / 1000;
    const Imax = Math.max(1e-12, ...ov.sim.elements.map((e) => Math.abs(e.I)));
    const paths = [];
    for (const f of ov.sim.segFlows) if (Math.abs(f.I) > Imax * 1e-3) paths.push(f);
    for (const e of ov.sim.elements) {
      if (Math.abs(e.I) > Imax * 1e-3) paths.push({ a: e.from, b: e.to, I: e.I });
    }
    ctx.save();
    ctx.fillStyle = t.curves[2]; // orange
    for (const p of paths) {
      const len = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
      if (len < 4) continue;
      const speed = 18 + 55 * (Math.abs(p.I) / Imax); // px/s
      const dir = p.I >= 0 ? 1 : -1;
      const spacing = 26;
      const offset = ((now * speed * dir) % spacing + spacing) % spacing;
      for (let s = offset; s < len; s += spacing) {
        const x = p.a[0] + ((p.b[0] - p.a[0]) * s) / len;
        const y = p.a[1] + ((p.b[1] - p.a[1]) * s) / len;
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  const ring = (at, color, r = 9) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(at[0], at[1], r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  if (ov.hover) ring(ov.hover.at, t.curves[1], ov.hover.kind === 'node' ? 8 : 22);
  if (ov.probePick && !ov.probeReveal) ring(ov.probePick.at, t.curves[1], ov.probePick.kind === 'node' ? 9 : 24);
  if (ov.probeReveal) {
    const { target, ok } = ov.probeReveal;
    if (ov.probePick && !ok) ring(ov.probePick.at, t.curves[3], ov.probePick.kind === 'node' ? 9 : 24);
    ring(target.at, t.accent, target.kind === 'node' ? 9 : 24);
  }
}

export function formatSI(v) {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e6) return trim(v / 1e6) + 'M';
  if (abs >= 1e3) return trim(v / 1e3) + 'k';
  if (abs >= 1) return trim(v);
  if (abs >= 1e-3) return trim(v * 1e3) + 'm';
  if (abs >= 1e-6) return trim(v * 1e6) + 'µ';
  if (abs >= 1e-9) return trim(v * 1e9) + 'n';
  return trim(v * 1e12) + 'p';
}
function trim(x) {
  return String(parseFloat(x.toPrecision(4)));
}

// ---------------------------------------------------------------------------
// Text with simple TeX-ish subscripts/superscripts: "R_1", "V_{out}", "10^{3}"
// ---------------------------------------------------------------------------
// canvas text is NOT KaTeX — decode the TeX fragments authors commonly slip in
const TEX_MAP = [
  [/\\text\{([^}]*)\}/g, '$1'], [/\\mathrm\{([^}]*)\}/g, '$1'],
  [/\\Omega/g, 'Ω'], [/\\mu/g, 'µ'], [/\\pi/g, 'π'], [/\\infty/g, '∞'],
  [/\\approx/g, '≈'], [/\\cdot/g, '·'], [/\\circ/g, '°'], [/\\pm/g, '±'],
  [/\\[,;!]/g, ' '], [/\\ /g, ' '], [/\$/g, ''],
];
export function decodeTex(s) {
  for (const [re, rep] of TEX_MAP) s = s.replace(re, rep);
  return s;
}

function drawSubText(ctx, text, x, y, { align = 'center', size = 13, color } = {}) {
  const t = theme();
  text = decodeTex(text);
  ctx.save();
  ctx.fillStyle = color || t.text;
  ctx.textBaseline = 'middle';
  const parts = [];
  let i = 0;
  let buf = '';
  while (i < text.length) {
    const c = text[i];
    if (c === '_' || c === '^') {
      if (buf) parts.push({ t: buf, mode: 'n' });
      buf = '';
      let sub = '';
      if (text[i + 1] === '{') {
        const end = text.indexOf('}', i + 2);
        sub = text.slice(i + 2, end === -1 ? text.length : end);
        i = end === -1 ? text.length : end + 1;
      } else {
        sub = text[i + 1] || '';
        i += 2;
      }
      parts.push({ t: sub, mode: c === '_' ? 's' : 'p' });
    } else {
      buf += c;
      i += 1;
    }
  }
  if (buf) parts.push({ t: buf, mode: 'n' });

  const widths = parts.map((p) => {
    ctx.font = fontFor(p.mode, size);
    return ctx.measureText(p.t).width;
  });
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  parts.forEach((p, k) => {
    ctx.font = fontFor(p.mode, size);
    const dy = p.mode === 's' ? size * 0.28 : p.mode === 'p' ? -size * 0.35 : 0;
    ctx.fillText(p.t, cx, y + dy);
    cx += widths[k];
  });
  ctx.restore();
}
function fontFor(mode, size) {
  const s = mode === 'n' ? size : size * 0.75;
  return `italic ${s}px "Georgia", serif`;
}
function drawPlainText(ctx, text, x, y, { align = 'center', size = 12, color } = {}) {
  const t = theme();
  ctx.save();
  ctx.fillStyle = color || t.text;
  ctx.font = `${size}px -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Circuit drawing
// ---------------------------------------------------------------------------
function drawCircuit(ctx, fig, bindText) {
  const t = theme();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = t.stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const poly of fig.wires || []) {
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  for (const comp of fig.components || []) {
    drawComponent(ctx, comp, t, bindText);
  }
  for (const [x, y] of fig.nodes || []) {
    ctx.beginPath();
    ctx.fillStyle = t.stroke;
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const lab of fig.labels || []) {
    const [x, y] = lab.at;
    drawSubText(ctx, lab.text, x, y, {
      align: lab.anchor === 'left' ? 'left' : lab.anchor === 'right' ? 'right' : 'center',
      color: t.accent,
      size: 14,
    });
    if (lab.terminal) drawTerminal(ctx, lab.terminal[0], lab.terminal[1], t);
  }
  // auto terminals: open circles at label points that sit on a wire end
  for (const lab of fig.labels || []) {
    if (lab.terminal) continue;
    for (const poly of fig.wires || []) {
      for (const end of [poly[0], poly[poly.length - 1]]) {
        const dx = end[0] - lab.at[0];
        const dy = end[1] - lab.at[1];
        if (Math.hypot(dx, dy) < 26) drawTerminal(ctx, end[0], end[1], t);
      }
    }
  }
}

function drawTerminal(ctx, x, y, t) {
  ctx.beginPath();
  ctx.strokeStyle = t.stroke;
  ctx.fillStyle = 'transparent';
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.stroke();
}

const POINT_TYPES = new Set(['ground', 'npn', 'pnp', 'nmos', 'pmos', 'opamp']);

function drawComponent(ctx, comp, t, bindText) {
  if (POINT_TYPES.has(comp.type)) {
    drawPointComponent(ctx, comp, t);
    return;
  }
  const [x1, y1] = comp.from;
  const [x2, y2] = comp.to;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const body = 40;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.strokeStyle = t.stroke;
  ctx.lineWidth = 1.8;

  // leads
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  ctx.lineTo(-body / 2, 0);
  ctx.moveTo(body / 2, 0);
  ctx.lineTo(len / 2, 0);
  ctx.stroke();

  switch (comp.type) {
    case 'resistor': drawResistor(ctx, body); break;
    case 'capacitor': drawCapacitor(ctx, comp, t); break;
    case 'inductor': drawInductor(ctx); break;
    case 'vsource': drawVSource(ctx, t); break;
    case 'vsine': drawVSine(ctx, t); break;
    case 'isource': drawISource(ctx, t); break;
    case 'battery': drawBattery(ctx); break;
    case 'diode': drawDiode(ctx, t, 'plain'); break;
    case 'zener': drawDiode(ctx, t, 'zener'); break;
    case 'led': drawDiode(ctx, t, 'led'); break;
    case 'switch': drawSwitch(ctx, comp); break;
    default: {
      // unknown: draw a box with the type name
      ctx.strokeRect(-body / 2, -12, body, 24);
    }
  }
  ctx.restore();

  // label & value, in screen space
  const horiz = Math.abs(y2 - y1) < Math.abs(x2 - x1);
  const flip = comp.flipLabel ? -1 : 1;
  const value = comp.bind && bindText != null ? bindText : comp.value;
  if (horiz) {
    if (comp.label) drawSubText(ctx, comp.label, cx, cy - 18 * flip, { color: t.stroke });
    if (value) drawPlainText(ctx, value, cx, cy + 19 * flip, { color: t.text });
  } else {
    const side = 16 * flip;
    if (comp.label) drawSubText(ctx, comp.label, cx + side, cy - 9, { align: flip > 0 ? 'left' : 'right', color: t.stroke });
    if (value) drawPlainText(ctx, value, cx + side, cy + 10, { align: flip > 0 ? 'left' : 'right', color: t.text });
  }
}

function drawResistor(ctx, body) {
  const n = 6;
  const dx = body / n;
  ctx.beginPath();
  ctx.moveTo(-body / 2, 0);
  for (let i = 0; i < n; i++) {
    const x = -body / 2 + dx * (i + 0.5);
    ctx.lineTo(x, i % 2 === 0 ? -8 : 8);
  }
  ctx.lineTo(body / 2, 0);
  ctx.stroke();
}

function drawCapacitor(ctx, comp, t) {
  const gap = 5;
  ctx.beginPath();
  ctx.moveTo(-gap, -13);
  ctx.lineTo(-gap, 13);
  ctx.moveTo(gap, -13);
  ctx.lineTo(gap, 13);
  ctx.stroke();
  // close the lead gap (body is 40, plates at ±5)
  ctx.beginPath();
  ctx.moveTo(-20, 0);
  ctx.lineTo(-gap, 0);
  ctx.moveTo(gap, 0);
  ctx.lineTo(20, 0);
  ctx.stroke();
  if (comp.polarized) {
    ctx.save();
    ctx.strokeStyle = t.text;
    ctx.lineWidth = 1.4;
    plus(ctx, -14, -10, 4);
    ctx.restore();
  }
}

function drawInductor(ctx) {
  ctx.beginPath();
  const r = 5;
  for (let i = 0; i < 4; i++) {
    const cx = -15 + i * 10;
    ctx.moveTo(cx + r, 0);
    ctx.arc(cx, 0, r, 0, Math.PI, true);
  }
  ctx.stroke();
}

function plus(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x - s, y);
  ctx.lineTo(x + s, y);
  ctx.moveTo(x, y - s);
  ctx.lineTo(x, y + s);
  ctx.stroke();
}
function minus(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x - s, y);
  ctx.lineTo(x + s, y);
  ctx.stroke();
}

function drawVSource(ctx, t) {
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.stroke();
  // + toward `to` (local +x), − toward `from`
  ctx.save();
  ctx.strokeStyle = t.stroke;
  ctx.lineWidth = 1.6;
  plus(ctx, 8, 0, 4);
  minus(ctx, -8, 0, 4);
  ctx.restore();
}

function drawVSine(ctx, t) {
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const x = -9 + (18 * i) / 24;
    const y = -6 * Math.sin((Math.PI * 2 * i) / 24);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
}

function drawISource(ctx, t) {
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.lineTo(8, 0);
  ctx.moveTo(3, -4.5);
  ctx.lineTo(8, 0);
  ctx.lineTo(3, 4.5);
  ctx.stroke();
}

function drawBattery(ctx) {
  // long plate (+) toward `to` (local +x)
  ctx.beginPath();
  ctx.moveTo(4, -14);
  ctx.lineTo(4, 14);
  ctx.moveTo(-4, -7);
  ctx.lineTo(-4, 7);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-20, 0);
  ctx.lineTo(-4, 0);
  ctx.moveTo(4, 0);
  ctx.lineTo(20, 0);
  ctx.stroke();
}

function drawDiode(ctx, t, variant) {
  ctx.beginPath();
  ctx.moveTo(-8, -9);
  ctx.lineTo(-8, 9);
  ctx.lineTo(8, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  if (variant === 'zener') {
    ctx.moveTo(4, -12);
    ctx.lineTo(8, -9);
    ctx.lineTo(8, 9);
    ctx.lineTo(12, 12);
  } else {
    ctx.moveTo(8, -9);
    ctx.lineTo(8, 9);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-20, 0);
  ctx.lineTo(-8, 0);
  ctx.moveTo(8, 0);
  ctx.lineTo(20, 0);
  ctx.stroke();
  if (variant === 'led') {
    ctx.save();
    ctx.lineWidth = 1.3;
    for (const off of [0, 6]) {
      ctx.beginPath();
      ctx.moveTo(-2 + off, -10);
      ctx.lineTo(3 + off, -16);
      ctx.moveTo(3 + off, -16);
      ctx.lineTo(0.5 + off, -15);
      ctx.moveTo(3 + off, -16);
      ctx.lineTo(2 + off, -13.5);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawSwitch(ctx, comp) {
  ctx.beginPath();
  ctx.arc(-14, 0, 2.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(14, 0, 2.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-12, 0);
  if (comp.closed) ctx.lineTo(12, 0);
  else ctx.lineTo(10, -13);
  ctx.stroke();
}

function drawPointComponent(ctx, comp, t) {
  const [x, y] = comp.at;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = t.stroke;
  ctx.lineWidth = 1.8;

  if (comp.type === 'ground') {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 8);
    ctx.moveTo(-11, 8);
    ctx.lineTo(11, 8);
    ctx.moveTo(-7, 13);
    ctx.lineTo(7, 13);
    ctx.moveTo(-3, 18);
    ctx.lineTo(3, 18);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (comp.type === 'opamp') {
    ctx.beginPath();
    ctx.moveTo(-24, -24);
    ctx.lineTo(-24, 24);
    ctx.lineTo(32, 0);
    ctx.closePath();
    ctx.stroke();
    // input leads
    const topSign = comp.swap ? '+' : '−';
    ctx.beginPath();
    ctx.moveTo(-32, -14);
    ctx.lineTo(-24, -14);
    ctx.moveTo(-32, 14);
    ctx.lineTo(-24, 14);
    ctx.stroke();
    ctx.save();
    ctx.lineWidth = 1.5;
    if (topSign === '−') {
      minus(ctx, -17, -14, 4);
      plus(ctx, -17, 14, 4);
    } else {
      plus(ctx, -17, -14, 4);
      minus(ctx, -17, 14, 4);
    }
    ctx.restore();
    if (comp.label) drawSubText(ctx, comp.label, 2, -26, { color: t.stroke });
    ctx.restore();
    return;
  }

  const m = comp.mirror ? -1 : 1;
  ctx.scale(m, 1);

  if (comp.type === 'npn' || comp.type === 'pnp') {
    ctx.beginPath();
    ctx.arc(2, 0, 20, 0, Math.PI * 2);
    ctx.stroke();
    // base lead + bar
    ctx.beginPath();
    ctx.moveTo(-24, 0);
    ctx.lineTo(-8, 0);
    ctx.moveTo(-8, -12);
    ctx.lineTo(-8, 12);
    ctx.stroke();
    // collector (up) and emitter (down) diagonals to terminals at (16, ∓28)
    ctx.beginPath();
    ctx.moveTo(-8, -6);
    ctx.lineTo(16, -20);
    ctx.lineTo(16, -28);
    ctx.moveTo(-8, 6);
    ctx.lineTo(16, 20);
    ctx.lineTo(16, 28);
    ctx.stroke();
    arrowOnSegment(ctx, comp.type === 'npn' ? [-8, 6, 16, 20] : [16, 20, -8, 6], 0.62);
  } else {
    // nmos / pmos (simplified enhancement symbol)
    ctx.beginPath();
    ctx.moveTo(-24, 0);
    ctx.lineTo(-12, 0);
    ctx.moveTo(-12, -10);
    ctx.lineTo(-12, 10);
    ctx.moveTo(-6, -13);
    ctx.lineTo(-6, 13);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-6, -10);
    ctx.lineTo(16, -10);
    ctx.lineTo(16, -28);
    ctx.moveTo(-6, 10);
    ctx.lineTo(16, 10);
    ctx.lineTo(16, 28);
    ctx.stroke();
    if (comp.type === 'pmos') {
      ctx.beginPath();
      ctx.arc(-15.5, 0, 3.2, 0, Math.PI * 2);
      ctx.stroke();
      arrowOnSegment(ctx, [-6, 10, 16, 10], 0.5, true);
    } else {
      arrowOnSegment(ctx, [16, 10, -6, 10], 0.5, true);
    }
  }
  ctx.restore();
  // device label, drawn unmirrored
  if (comp.label) {
    drawSubText(ctx, comp.label, x + (comp.mirror ? 30 : -30), y - 20, { color: t.stroke });
  }
}

// small arrowhead placed `frac` of the way along segment [x1,y1,x2,y2]
function arrowOnSegment(ctx, [x1, y1, x2, y2], frac, midOnly) {
  const px = x1 + (x2 - x1) * frac;
  const py = y1 + (y2 - y1) * frac;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const s = 6;
  ctx.beginPath();
  ctx.moveTo(px - s * Math.cos(ang - 0.45), py - s * Math.sin(ang - 0.45));
  ctx.lineTo(px, py);
  ctx.lineTo(px - s * Math.cos(ang + 0.45), py - s * Math.sin(ang + 0.45));
  if (!midOnly) ctx.closePath();
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Plot drawing
// ---------------------------------------------------------------------------
function drawPlot(ctx, fig, W, H) {
  const t = theme();
  const m = { l: 46, r: 14, t: 14, b: 34 };
  const xmin = fig.xmin ?? 0;
  const xmax = fig.xmax ?? 10;
  const ymin = fig.ymin ?? 0;
  const ymax = fig.ymax ?? 10;
  const X = (x) => m.l + ((x - xmin) / (xmax - xmin)) * (W - m.l - m.r);
  const Y = (y) => H - m.b - ((y - ymin) / (ymax - ymin)) * (H - m.t - m.b);

  const xstep = fig.xticks || niceStep(xmax - xmin);
  const ystep = fig.yticks || niceStep(ymax - ymin);

  // grid + ticks
  ctx.lineWidth = 1;
  ctx.strokeStyle = t.grid;
  for (let x = Math.ceil(xmin / xstep) * xstep; x <= xmax + 1e-9; x += xstep) {
    ctx.beginPath();
    ctx.moveTo(X(x), Y(ymin));
    ctx.lineTo(X(x), Y(ymax));
    ctx.stroke();
    drawPlainText(ctx, tickLabel(x), X(x), H - m.b + 12, { size: 11 });
  }
  for (let y = Math.ceil(ymin / ystep) * ystep; y <= ymax + 1e-9; y += ystep) {
    ctx.beginPath();
    ctx.moveTo(X(xmin), Y(y));
    ctx.lineTo(X(xmax), Y(y));
    ctx.stroke();
    drawPlainText(ctx, tickLabel(y), m.l - 8, Y(y), { align: 'right', size: 11 });
  }

  // axes
  ctx.strokeStyle = t.muted;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(X(xmin), Y(ymax));
  ctx.lineTo(X(xmin), Y(ymin));
  ctx.lineTo(X(xmax), Y(ymin));
  ctx.stroke();
  // zero line if visible and not the bottom edge
  if (ymin < 0 && ymax > 0) {
    ctx.beginPath();
    ctx.moveTo(X(xmin), Y(0));
    ctx.lineTo(X(xmax), Y(0));
    ctx.stroke();
  }

  if (fig.xlabel) drawSubText(ctx, fig.xlabel, W - m.r, H - m.b + 24, { align: 'right', size: 12 });
  if (fig.ylabel) drawSubText(ctx, fig.ylabel, m.l - 4, m.t - 4, { align: 'right', size: 12 });

  // curves
  const legends = [];
  (fig.curves || []).forEach((c, ci) => {
    const color = t.curves[(c.color ?? ci) % t.curves.length];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.setLineDash(c.dash ? [6, 5] : []);
    ctx.beginPath();
    if (c.fn === 'points') {
      c.points.forEach(([px, py], i) => {
        i ? ctx.lineTo(X(px), Y(clampY(py, ymin, ymax))) : ctx.moveTo(X(px), Y(clampY(py, ymin, ymax)));
      });
    } else {
      const f = curveFn(c);
      const N = 240;
      for (let i = 0; i <= N; i++) {
        const x = xmin + ((xmax - xmin) * i) / N;
        let y;
        try { y = f(x); } catch { y = NaN; }
        if (!isFinite(y)) continue;
        y = clampY(y, ymin, ymax);
        i === 0 ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y));
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (c.legend) legends.push({ text: c.legend, color });
  });

  // legend (top-right corner)
  legends.forEach((lg, i) => {
    const lx = W - m.r - 12;
    const ly = m.t + 10 + i * 16;
    ctx.strokeStyle = lg.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + 12, ly);
    ctx.stroke();
    drawSubText(ctx, lg.text, lx - 4, ly, { align: 'right', size: 11 });
  });

  // guide lines
  ctx.strokeStyle = t.muted;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  for (const hl of fig.hlines || []) {
    ctx.beginPath();
    ctx.moveTo(X(xmin), Y(hl.y));
    ctx.lineTo(X(xmax), Y(hl.y));
    ctx.stroke();
    if (hl.label) drawSubText(ctx, hl.label, X(xmin) + 6, Y(hl.y) - 9, { align: 'left', size: 11 });
  }
  for (const vl of fig.vlines || []) {
    ctx.beginPath();
    ctx.moveTo(X(vl.x), Y(ymin));
    ctx.lineTo(X(vl.x), Y(ymax));
    ctx.stroke();
    if (vl.label) drawSubText(ctx, vl.label, X(vl.x) + 4, m.t + 8, { align: 'left', size: 11 });
  }
  ctx.setLineDash([]);

  // marks
  for (const mk of fig.marks || []) {
    ctx.fillStyle = t.curves[3];
    ctx.beginPath();
    ctx.arc(X(mk.x), Y(mk.y), 4, 0, Math.PI * 2);
    ctx.fill();
    if (mk.label) drawSubText(ctx, mk.label, X(mk.x) + 8, Y(mk.y) - 8, { align: 'left', size: 12, color: t.curves[3] });
  }
}

function clampY(y, ymin, ymax) {
  const pad = (ymax - ymin) * 0.02;
  return Math.max(ymin - pad, Math.min(ymax + pad, y));
}

function curveFn(c) {
  if (c.fn === 'exp') {
    const { v0 = 0, vf = 1, tau = 1, t0 = 0 } = c;
    return (t) => (t < t0 ? v0 : vf + (v0 - vf) * Math.exp(-(t - t0) / tau));
  }
  if (c.fn === 'sine') {
    const { amp = 1, freq = 1, phase = 0, offset = 0 } = c;
    return (t) => offset + amp * Math.sin(2 * Math.PI * freq * t + phase);
  }
  if (c.fn === 'expr') {
    // eslint-disable-next-line no-new-func
    const f = new Function('t', `return (${c.expr});`);
    return f;
  }
  return () => NaN;
}

function niceStep(range) {
  const raw = range / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return step * mag;
}

function tickLabel(v) {
  const r = parseFloat(v.toPrecision(3));
  return String(r);
}
