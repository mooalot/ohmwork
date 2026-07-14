// DC circuit solver for figure schematics. The drawing is the netlist:
// coincident coordinates (including points landing mid-segment on a wire)
// are the same electrical node. DOM-free so it also runs under Node for tests.
//
// Solves linear DC via modified nodal analysis. Steady-state conventions:
// capacitor = open, inductor = short, closed switch = short, open switch =
// open. Diodes/zeners/LEDs use the constant-drop model with state iteration.
// Figures containing vsine or any transistor/op-amp are reported unsolvable.

const EPS = 0.51; // px snap distance for "same point"

export function parseValue(str) {
  if (typeof str !== 'string') return NaN;
  const m = str.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*([pnuµmkMG]?)(?=[A-Za-zΩ°]|$|\s)/u);
  if (!m) return NaN;
  const mult = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9, '': 1 }[m[2]];
  return parseFloat(m[1]) * mult;
}

const key = (p) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;

function onSegment(p, a, b) {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) > EPS * Math.hypot(b[0] - a[0], b[1] - a[1])) return false;
  const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
  const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  return dot >= -EPS && dot <= len2 + EPS;
}

const TWO_TERMINAL = new Set([
  'resistor', 'capacitor', 'inductor', 'vsource', 'isource', 'vsine',
  'diode', 'zener', 'led', 'switch', 'battery',
]);
const UNSOLVABLE = new Set(['vsine', 'npn', 'pnp', 'nmos', 'pmos', 'opamp']);

// ---------------------------------------------------------------------------
// Net extraction (pure geometry — usable without component values)
// ---------------------------------------------------------------------------
export function buildNets(figure) {
  const comps = figure.components || [];
  const wires = figure.wires || [];

  // electrical points: component terminals + wire vertices
  const points = [];
  const addPoint = (p) => { points.push([p[0], p[1]]); };
  for (const c of comps) {
    if (TWO_TERMINAL.has(c.type)) { addPoint(c.from); addPoint(c.to); }
    else if (c.type === 'ground') addPoint(c.at);
  }
  for (const w of wires) for (const p of w) addPoint(p);

  // split wires into segments, splitting at any electrical point on them
  const segments = [];
  for (const w of wires) {
    for (let i = 1; i < w.length; i++) {
      const a = w[i - 1];
      const b = w[i];
      const cuts = points
        .filter((p) => onSegment(p, a, b))
        .sort((p, q) => (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2 - ((q[0] - a[0]) ** 2 + (q[1] - a[1]) ** 2));
      let prev = a;
      for (const c of cuts) {
        if (key(c) !== key(prev)) { segments.push([prev, c]); prev = c; }
      }
      if (key(prev) !== key(b)) segments.push([prev, b]);
    }
  }

  // union-find over point keys; wire segments merge their endpoints
  const parent = new Map();
  const find = (k) => {
    while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); }
    return k;
  };
  const ensure = (k) => { if (!parent.has(k)) parent.set(k, k); return k; };
  const union = (a, b) => { parent.set(find(ensure(a)), find(ensure(b))); };
  for (const p of points) ensure(key(p));
  for (const [a, b] of segments) union(key(a), key(b));

  // net ids
  const netOf = new Map(); // root key -> net index
  const nets = [];
  const netIndex = (k) => {
    const r = find(ensure(k));
    if (!netOf.has(r)) { netOf.set(r, nets.length); nets.push({ points: [] }); }
    return netOf.get(r);
  };
  const seenPt = new Set();
  for (const p of points) {
    const pk = key(p);
    const n = netIndex(pk);
    if (!seenPt.has(pk)) { nets[n].points.push(p); seenPt.add(pk); }
  }

  return {
    nets,
    segments,
    netOfPoint(p) {
      const k = key(p);
      if (parent.has(k)) return netOf.get(find(k)) ?? -1;
      // not an exact electrical point: try nearest within snap or on a segment
      for (const [a, b] of segments) if (onSegment(p, a, b)) return netOf.get(find(key(a))) ?? -1;
      return -1;
    },
  };
}

// ---------------------------------------------------------------------------
// MNA solve
// ---------------------------------------------------------------------------
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

const DROPS = { diode: 0.7, led: 2.0 };

export function simulate(figure, bindValue) {
  if (!figure || figure.kind !== 'circuit') return null;
  const comps = figure.components || [];
  if (comps.some((c) => UNSOLVABLE.has(c.type))) return null;

  const geo = buildNets(figure);
  const N = geo.nets.length;
  if (N < 2) return null;

  // reference: first ground's net, else net 0
  let ref = 0;
  const gnd = comps.find((c) => c.type === 'ground');
  if (gnd) {
    const g = geo.netOfPoint(gnd.at);
    if (g >= 0) ref = g;
  }

  // classify elements
  const els = [];
  let hasSource = false;
  for (const c of comps) {
    if (!TWO_TERMINAL.has(c.type)) continue;
    const a = geo.netOfPoint(c.from);
    const b = geo.netOfPoint(c.to);
    if (a < 0 || b < 0) return null;
    const el = { comp: c, from: c.from, to: c.to, a, b, I: 0, V: 0 };
    const val = c.bind && bindValue != null ? bindValue : parseValue(c.value ?? '');
    switch (c.type) {
      case 'resistor':
        if (!(val > 0)) return null;
        el.kind = 'R'; el.R = val; break;
      case 'vsource': case 'battery':
        if (!isFinite(val)) return null;
        el.kind = 'V'; el.E = val; hasSource = true; break;
      case 'isource':
        if (!isFinite(val)) return null;
        el.kind = 'I'; el.Isrc = val; hasSource = true; break;
      case 'capacitor': el.kind = 'open'; break;
      case 'inductor': el.kind = 'short'; break;
      case 'switch': el.kind = c.closed ? 'short' : 'open'; break;
      case 'diode': case 'led':
        el.kind = 'D'; el.Vf = DROPS[c.type]; el.state = 'off'; break;
      case 'zener':
        el.kind = 'Z'; el.Vf = 0.7;
        el.Vz = isFinite(val) ? val : 5.1; el.state = 'off'; break;
      default: return null;
    }
    els.push(el);
  }
  if (!hasSource) return null;

  const diodes = els.filter((e) => e.kind === 'D' || e.kind === 'Z');
  let v = null;

  for (let iter = 0; iter < 24; iter++) {
    const res = mnaPass(els, N, ref);
    if (!res) return null;
    v = res;
    // re-evaluate diode states
    let changed = false;
    for (const d of diodes) {
      const vd = v.nodeV[d.a] - v.nodeV[d.b]; // anode − cathode
      let want = 'off';
      if (d.state === 'fwd' && d.I >= -1e-9) want = 'fwd';
      else if (d.state === 'rev' && d.kind === 'Z' && d.I <= 1e-9) want = 'rev';
      if (d.state === 'off') {
        if (vd > d.Vf + 1e-6) want = 'fwd';
        else if (d.kind === 'Z' && -vd > d.Vz + 1e-6) want = 'rev';
      }
      if (want !== d.state) { d.state = want; changed = true; }
    }
    if (!changed) break;
    if (iter === 23) return null; // no convergence
  }

  // package results
  const nets = geo.nets.map((n, i) => ({ points: n.points, v: v.nodeV[i] }));
  const elements = els.map((e) => {
    const V = v.nodeV[e.a] - v.nodeV[e.b];
    return {
      comp: e.comp, from: e.from, to: e.to,
      V, I: e.I, P: Math.abs(V * e.I),
    };
  });

  // per-wire-segment current flows (leaf elimination on each net's segment graph)
  const segFlows = computeSegFlows(geo, els);

  return {
    nets, elements, segFlows,
    netOfPoint: geo.netOfPoint,
    netAt: (p) => geo.netOfPoint(p),
  };

  function mnaPass(els, N, ref) {
    // unknowns: node voltages (except ref) + branch currents for V-like elements
    const idx = []; // net -> unknown index or -1
    let nv = 0;
    for (let i = 0; i < N; i++) idx.push(i === ref ? -1 : nv++);
    const vlike = els.filter((e) =>
      e.kind === 'V' || e.kind === 'short' ||
      ((e.kind === 'D' || e.kind === 'Z') && e.state !== 'off'));
    const n = nv + vlike.length;
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    const rhs = new Array(n).fill(0);
    const GMIN = 1e-9;
    for (let i = 0; i < nv; i++) A[i][i] += GMIN; // keeps floating islands non-singular

    const stampG = (a, b, g) => {
      if (idx[a] >= 0) A[idx[a]][idx[a]] += g;
      if (idx[b] >= 0) A[idx[b]][idx[b]] += g;
      if (idx[a] >= 0 && idx[b] >= 0) { A[idx[a]][idx[b]] -= g; A[idx[b]][idx[a]] -= g; }
    };

    vlike.forEach((e, k) => {
      // element equation: v(p) − v(m) = E, current j flows p→m inside element
      let p; let m; let E;
      if (e.kind === 'V') { p = e.b; m = e.a; E = e.E; }         // + at `to`
      else if (e.kind === 'short') { p = e.a; m = e.b; E = 0; }
      else if (e.state === 'fwd') { p = e.a; m = e.b; E = e.Vf; } // anode→cathode
      else { p = e.b; m = e.a; E = e.Vz; }                        // zener breakdown
      const col = nv + k;
      if (idx[p] >= 0) { A[idx[p]][col] += 1; A[col][idx[p]] += 1; }
      if (idx[m] >= 0) { A[idx[m]][col] -= 1; A[col][idx[m]] -= 1; }
      rhs[col] = E;
      e._p = p;
    });

    for (const e of els) {
      if (e.kind === 'R') stampG(e.a, e.b, 1 / e.R);
      else if (e.kind === 'I') {
        if (idx[e.b] >= 0) rhs[idx[e.b]] += e.Isrc;
        if (idx[e.a] >= 0) rhs[idx[e.a]] -= e.Isrc;
      }
    }

    const x = solveLinear(A, rhs);
    if (!x) return null;
    const nodeV = new Array(N).fill(0);
    for (let i = 0; i < N; i++) if (idx[i] >= 0) nodeV[i] = x[idx[i]];

    // element currents, positive from→to (through the element)
    vlike.forEach((e, k) => {
      const j = x[nv + k];
      // j flows p→m inside the element; convert to from→to
      e.I = e._p === e.a ? j : -j;
    });
    for (const e of els) {
      if (e.kind === 'R') e.I = (nodeV[e.a] - nodeV[e.b]) / e.R;
      else if (e.kind === 'I') e.I = e.Isrc;
      else if (e.kind === 'open' || ((e.kind === 'D' || e.kind === 'Z') && e.state === 'off')) e.I = 0;
    }
    return { nodeV };
  }
}

// Distribute each net's element currents across its wire segments so the
// animation shows flow through the actual drawn wires. Works when the net's
// segment graph is a tree (schematics almost always are); chords get 0.
function computeSegFlows(geo, els) {
  // injections: current entering the net at a specific point
  const inj = new Map(); // pointKey -> current in
  const bump = (p, i) => inj.set(key(p), (inj.get(key(p)) || 0) + i);
  for (const e of els) {
    // current I flows from→to through the element: it leaves the `from` net
    // at e.from (so −I enters there) and enters the `to` net at e.to (+I).
    bump(e.from, -e.I);
    bump(e.to, e.I);
  }

  const flows = [];
  // group segments by net
  const byNet = new Map();
  for (const s of geo.segments) {
    const n = geo.netOfPoint(s[0]);
    if (!byNet.has(n)) byNet.set(n, []);
    byNet.get(n).push(s);
  }

  for (const segs of byNet.values()) {
    // vertex graph
    const adj = new Map(); // key -> [{seg, other, otherKey, idx}]
    const verts = new Map(); // key -> point
    segs.forEach((s, i) => {
      const [a, b] = s;
      for (const [p, q] of [[a, b], [b, a]]) {
        const k = key(p);
        if (!adj.has(k)) { adj.set(k, []); verts.set(k, p); }
        adj.get(k).push({ idx: i, otherKey: key(q) });
      }
    });
    const segFlow = new Array(segs.length).fill(null);
    const degree = new Map([...adj.entries()].map(([k, l]) => [k, l.length]));
    const injLeft = new Map([...adj.keys()].map((k) => [k, inj.get(k) || 0]));
    // leaf elimination
    const queue = [...degree.keys()].filter((k) => degree.get(k) === 1);
    while (queue.length) {
      const k = queue.pop();
      const edges = adj.get(k).filter((e) => segFlow[e.idx] === null);
      if (edges.length !== 1) continue;
      const e = edges[0];
      const seg = segs[e.idx];
      // current entering net at k must leave along this segment toward other
      const out = injLeft.get(k) || 0;
      // flow sign: positive = seg[0]→seg[1]
      const fromA = key(seg[0]) === k;
      segFlow[e.idx] = fromA ? out : -out;
      injLeft.set(e.otherKey, (injLeft.get(e.otherKey) || 0) + out);
      injLeft.set(k, 0);
      const remaining = adj.get(e.otherKey).filter((x) => segFlow[x.idx] === null).length;
      if (remaining === 1) queue.push(e.otherKey);
    }
    segs.forEach((s, i) => {
      flows.push({ a: s[0], b: s[1], I: segFlow[i] ?? 0 });
    });
  }
  return flows;
}
