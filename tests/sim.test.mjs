import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, parseValue, buildNets } from '../js/sim.js';

const close = (a, b, tol = 0.01) =>
  assert.ok(Math.abs(a - b) <= Math.abs(b) * tol + 1e-12, `got ${a}, want ~${b}`);

// convenience: single-loop circuit builder (source on the left, elements on top/right)
function loop(components, wires = []) {
  return { kind: 'circuit', width: 420, height: 240, components, wires };
}
const V = (val, extra = {}) => ({ type: 'vsource', from: [60, 200], to: [60, 60], value: val, ...extra });
const el = (sim, label) => sim.elements.find((e) => e.comp.label === label);

test('parseValue: SI prefixes and units', () => {
  close(parseValue('4.7 kΩ'), 4700, 0);
  close(parseValue('10 µF'), 1e-5, 1e-9);
  close(parseValue('10 uF'), 1e-5, 1e-9);
  close(parseValue('100 nF'), 1e-7, 1e-9);
  close(parseValue('47 pF'), 47e-12, 1e-9);
  close(parseValue('5 mA'), 0.005, 1e-9);
  close(parseValue('2.2 MΩ'), 2.2e6, 1e-9);
  close(parseValue('0.5 Ω'), 0.5, 0);
  close(parseValue('12 V'), 12, 0);
  close(parseValue('-9 V'), -9, 0);
});

test('parseValue: rejects non-numeric', () => {
  assert.ok(Number.isNaN(parseValue('relay coil')));
  assert.ok(Number.isNaN(parseValue('±5 V')));
  assert.ok(Number.isNaN(parseValue(undefined)));
  assert.ok(Number.isNaN(parseValue('')));
});

test('buildNets: wires merge points, mid-segment attachments join the net', () => {
  const fig = loop(
    [V('12 V'), { type: 'resistor', from: [200, 60], to: [200, 200], value: '1 kΩ' }],
    [[[60, 60], [340, 60]], [[60, 200], [340, 200]]] // resistor attaches mid-wire
  );
  const geo = buildNets(fig);
  assert.equal(geo.netOfPoint([60, 60]), geo.netOfPoint([200, 60]));
  assert.equal(geo.netOfPoint([60, 60]), geo.netOfPoint([340, 60]));
  assert.notEqual(geo.netOfPoint([60, 60]), geo.netOfPoint([60, 200]));
});

test('ohm: single resistor loop', () => {
  const s = simulate(
    loop(
      [V('9 V'), { type: 'resistor', from: [200, 60], to: [200, 200], label: 'R', value: '3 kΩ' }],
      [[[60, 60], [200, 60]], [[60, 200], [200, 200]]]
    )
  );
  close(el(s, 'R').I, 0.003);
  close(Math.abs(el(s, 'R').V), 9);
  close(el(s, 'R').P, 0.027);
});

test('capacitor is open at DC: no current, full voltage', () => {
  const s = simulate(
    loop(
      [
        V('12 V'),
        { type: 'resistor', from: [60, 60], to: [200, 60], label: 'R', value: '1 kΩ' },
        { type: 'capacitor', from: [200, 60], to: [200, 200], label: 'C', value: '10 µF' },
      ],
      [[[60, 200], [200, 200]]]
    )
  );
  assert.ok(Math.abs(el(s, 'R').I) < 1e-6, 'only GMIN-level leakage allowed');
  close(Math.abs(el(s, 'C').V), 12);
});

test('inductor is short at DC', () => {
  const s = simulate(
    loop(
      [
        V('10 V'),
        { type: 'resistor', from: [60, 60], to: [200, 60], label: 'R', value: '500 Ω' },
        { type: 'inductor', from: [200, 60], to: [200, 200], label: 'L', value: '100 mH' },
      ],
      [[[60, 200], [200, 200]]]
    )
  );
  close(el(s, 'L').I, 0.02);
  close(Math.abs(el(s, 'L').V), 0, 0);
});

test('switch: open blocks, closed conducts', () => {
  const mk = (closed) =>
    loop(
      [
        V('10 V'),
        { type: 'switch', from: [60, 60], to: [140, 60], label: 'S', closed },
        { type: 'resistor', from: [200, 60], to: [200, 200], label: 'R', value: '1 kΩ' },
      ],
      [[[140, 60], [200, 60]], [[60, 200], [200, 200]]]
    );
  close(el(simulate(mk(false)), 'R').I, 0, 0);
  close(el(simulate(mk(true)), 'R').I, 0.01);
});

test('diode conducts forward with 0.7 V drop', () => {
  const s = simulate(
    loop(
      [
        V('5 V'),
        { type: 'diode', from: [60, 60], to: [180, 60], label: 'D' }, // anode toward source +
        { type: 'resistor', from: [240, 60], to: [240, 200], label: 'R', value: '1 kΩ' },
      ],
      [[[180, 60], [240, 60]], [[60, 200], [240, 200]]]
    )
  );
  close(el(s, 'R').I, (5 - 0.7) / 1000);
  close(el(s, 'D').V, 0.7);
});

test('diode blocks reverse', () => {
  const s = simulate(
    loop(
      [
        V('5 V'),
        { type: 'diode', from: [180, 60], to: [60, 60], label: 'D' }, // flipped: cathode at +
        { type: 'resistor', from: [240, 60], to: [240, 200], label: 'R', value: '1 kΩ' },
      ],
      [[[180, 60], [240, 60]], [[60, 200], [240, 200]]]
    )
  );
  close(el(s, 'R').I, 0, 0);
});

test('LED drops 2 V', () => {
  const s = simulate(
    loop(
      [
        V('5 V'),
        { type: 'resistor', from: [60, 60], to: [180, 60], label: 'R', value: '300 Ω' },
        { type: 'led', from: [240, 60], to: [240, 200], label: 'D', value: '2 V' },
      ],
      [[[180, 60], [240, 60]], [[60, 200], [240, 200]]]
    )
  );
  close(el(s, 'R').I, 0.01);
});

test('zener regulates in reverse breakdown', () => {
  // 12 V → 470 Ω → zener (cathode up) to ground: Vz = 5.1, Iz = (12−5.1)/470
  const s = simulate(
    loop(
      [
        V('12 V'),
        { type: 'resistor', from: [60, 60], to: [200, 60], label: 'R', value: '470 Ω' },
        { type: 'zener', from: [200, 200], to: [200, 60], label: 'Z', value: '5.1 V' },
      ],
      [[[60, 200], [200, 200]]]
    )
  );
  close(Math.abs(el(s, 'Z').V), 5.1);
  close(Math.abs(el(s, 'Z').I), (12 - 5.1) / 470);
});

test('current source drives set current', () => {
  const s = simulate(
    loop(
      [
        { type: 'isource', from: [60, 200], to: [60, 60], value: '5 mA' },
        { type: 'resistor', from: [200, 60], to: [200, 200], label: 'R', value: '2 kΩ' },
      ],
      [[[60, 60], [200, 60]], [[60, 200], [200, 200]]]
    )
  );
  close(Math.abs(el(s, 'R').I), 0.005);
  close(Math.abs(el(s, 'R').V), 10);
});

test('slider bind value substitutes the bound component', () => {
  const fig = loop(
    [
      V('12 V'),
      { type: 'resistor', from: [200, 60], to: [200, 130], label: 'R1', value: '4.7 kΩ' },
      { type: 'resistor', from: [200, 130], to: [200, 200], label: 'R2', bind: true },
    ],
    [[[60, 60], [200, 60]], [[60, 200], [200, 200]]]
  );
  const s = simulate(fig, 2350);
  close(s.nets[s.netOfPoint([200, 130])].v - s.nets[s.netOfPoint([200, 200])].v, 4.0);
  assert.equal(simulate(fig), null); // no bind value and none parseable → unsolvable
});

test('unsolvable: transistors, vsine, missing values, no source', () => {
  assert.equal(simulate(loop([V('5 V'), { type: 'npn', at: [200, 130] }])), null);
  assert.equal(
    simulate(loop([{ type: 'vsine', from: [60, 200], to: [60, 60], value: '5 V' },
      { type: 'resistor', from: [200, 60], to: [200, 200], value: '1 kΩ' }])),
    null
  );
  assert.equal(
    simulate(loop([V('5 V'), { type: 'resistor', from: [200, 60], to: [200, 200] }])),
    null
  );
  assert.equal(
    simulate(loop([{ type: 'resistor', from: [200, 60], to: [200, 200], value: '1 kΩ' }])),
    null
  );
});

test('segment flows: current splits correctly at a junction', () => {
  // 6 V across two parallel resistors fed by one top wire
  const s = simulate(
    loop(
      [
        V('6 V'),
        { type: 'resistor', from: [200, 60], to: [200, 200], label: 'A', value: '1 kΩ' },
        { type: 'resistor', from: [300, 60], to: [300, 200], label: 'B', value: '2 kΩ' },
      ],
      [[[60, 60], [300, 60]], [[60, 200], [300, 200]]]
    )
  );
  const seg = (x1, x2, y) =>
    s.segFlows.find(
      (f) => f.a[1] === y && f.b[1] === y && Math.min(f.a[0], f.b[0]) === x1 && Math.max(f.a[0], f.b[0]) === x2
    );
  close(Math.abs(seg(60, 200, 60).I), 0.009); // full 9 mA before the junction
  close(Math.abs(seg(200, 300, 60).I), 0.003); // only B's 3 mA after it
});

test('ground fixes the reference node to 0 V', () => {
  const fig = loop(
    [
      V('12 V'),
      { type: 'resistor', from: [200, 60], to: [200, 200], label: 'R', value: '1 kΩ' },
      { type: 'ground', at: [130, 200] },
    ],
    [[[60, 60], [200, 60]], [[60, 200], [200, 200]]]
  );
  const s = simulate(fig);
  close(s.nets[s.netOfPoint([60, 200])].v, 0, 0);
  close(s.nets[s.netOfPoint([60, 60])].v, 12);
});
