// Skill tree definition. Order matters: it's the suggested learning path.
export const TOPICS = [
  {
    id: 'dc-basics',
    title: 'DC Circuits',
    icon: '🔋',
    blurb: "Ohm's law, Kirchhoff's laws, series/parallel, dividers, power",
  },
  {
    id: 'network-theorems',
    title: 'Network Theorems',
    icon: '🕸️',
    blurb: 'Thévenin, Norton, superposition, source transforms, max power',
  },
  {
    id: 'capacitors-rc',
    title: 'Capacitors & RC',
    icon: '⛽',
    blurb: 'Capacitor behavior, RC transients, time constants, energy',
  },
  {
    id: 'inductors-rl',
    title: 'Inductors & RL',
    icon: '🧲',
    blurb: 'Inductor behavior, RL transients, stored energy, kickback',
  },
  {
    id: 'rlc-resonance',
    title: 'RLC & Resonance',
    icon: '🔔',
    blurb: 'Second-order circuits, damping, resonance, Q factor',
  },
  {
    id: 'ac-phasors',
    title: 'AC & Phasors',
    icon: '🌊',
    blurb: 'Impedance, phasor math, reactance, power factor, complex power',
  },
  {
    id: 'filters-bode',
    title: 'Filters & Bode',
    icon: '🎚️',
    blurb: 'Transfer functions, cutoff frequencies, dB, Bode plots',
  },
  {
    id: 'diodes',
    title: 'Diodes',
    icon: '➡️',
    blurb: 'Diode models, rectifiers, zeners, LEDs, clippers & clampers',
  },
  {
    id: 'bjt',
    title: 'BJTs',
    icon: '📶',
    blurb: 'Operating regions, biasing, small-signal, common-emitter',
  },
  {
    id: 'mosfets-opamps',
    title: 'MOSFETs & Op-Amps',
    icon: '🔀',
    blurb: 'MOSFET regions, switching, golden rules, op-amp topologies',
  },
];

export const TOPIC_BY_ID = Object.fromEntries(TOPICS.map((t) => [t.id, t]));
