// Skill tree definition. Order matters: it's the suggested learning path.
// Icons are inline SVG schematic symbols (stroke = currentColor).

const S = (body) =>
  `<svg viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const TOPICS = [
  {
    id: 'dc-basics',
    title: 'DC Circuits',
    icon: S('<path d="M2 22h16M26 22h16M18 6v32M26 15v14"/>'),
    blurb: "Ohm's law, Kirchhoff's laws, series/parallel, dividers, power",
  },
  {
    id: 'network-theorems',
    title: 'Network Theorems',
    icon: S('<path d="M4 22h8M32 22h6"/><rect x="12" y="14" width="20" height="16"/><circle cx="41" cy="22" r="2.6"/>'),
    blurb: 'Thévenin, Norton, superposition, source transforms, max power',
  },
  {
    id: 'capacitors-rc',
    title: 'Capacitors & RC',
    icon: S('<path d="M2 22h16M26 22h16M18 8v28M26 8v28"/>'),
    blurb: 'Capacitor behavior, RC transients, time constants, energy',
  },
  {
    id: 'inductors-rl',
    title: 'Inductors & RL',
    icon: S('<path d="M2 22h6a5 5 0 0 1 10 0 5 5 0 0 1 10 0 5 5 0 0 1 10 0h4" stroke-width="2"/>'),
    blurb: 'Inductor behavior, RL transients, stored energy, kickback',
  },
  {
    id: 'rlc-resonance',
    title: 'RLC & Resonance',
    icon: S('<path d="M2 22q3-19 7 0t7 0q2.5-13 5 0t5 0q2-8 4 0t4 0q1.5-4 3 0h5" stroke-width="2"/>'),
    blurb: 'Second-order circuits, damping, resonance, Q factor',
  },
  {
    id: 'ac-phasors',
    title: 'AC & Phasors',
    icon: S('<path d="M2 22q10-26 20 0t20 0" stroke-width="2"/>'),
    blurb: 'Impedance, phasor math, reactance, power factor, complex power',
  },
  {
    id: 'filters-bode',
    title: 'Filters & Bode',
    icon: S('<path d="M6 6v32h34" stroke-width="1.6" opacity="0.55"/><path d="M9 14h13l15 19"/>'),
    blurb: 'Transfer functions, cutoff frequencies, dB, Bode plots',
  },
  {
    id: 'diodes',
    title: 'Diodes',
    icon: S('<path d="M3 22h10M30 22h11M30 11v22"/><path d="M13 12l17 10-17 10z"/>'),
    blurb: 'Diode models, rectifiers, zeners, LEDs, clippers & clampers',
  },
  {
    id: 'bjt',
    title: 'BJTs',
    icon: S('<circle cx="23" cy="22" r="16" stroke-width="1.8"/><path d="M4 22h12M16 12v20M16 17l14-8v-5M16 27l14 8v5"/><path d="M24 32l6 3-2-6" fill="currentColor" stroke="none"/>'),
    blurb: 'Operating regions, biasing, small-signal, common-emitter',
  },
  {
    id: 'mosfets-opamps',
    title: 'MOSFETs & Op-Amps',
    icon: S('<path d="M10 7v30l28-15z"/><path d="M2 14h8M2 30h8M38 22h4M13 14h5M15.5 27.5v5M13 30h5" stroke-width="1.9"/>'),
    blurb: 'MOSFET regions, switching, golden rules, op-amp topologies',
  },
];

export const TOPIC_BY_ID = Object.fromEntries(TOPICS.map((t) => [t.id, t]));
