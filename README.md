# ⚡ Ohmwork

A Duolingo-style practice app for electrical engineering: streaks, XP, mastery levels, and
spaced repetition over a bank of circuit questions with Canvas-drawn schematics, plots, and
interactive components.

## Run it

Any static file server works (JSON files must load over HTTP):

```sh
cd ee
python3 -m http.server 8000
# open http://localhost:8000
```

## How it works

- **Lessons** are 10 questions. Pick a topic, hit **Daily Mix** for a cross-topic session, or
  **Review due** when the spaced-repetition scheduler has questions waiting.
- **Difficulty is luck of the draw** — every lesson mixes *intuition* (green), *applied*
  (blue), and *rigorous* (red) tiers.
- **XP**: 10/15/20 per correct answer by tier, +20 for a perfect lesson, 2 for a miss.
- **Streak**: complete at least one lesson per calendar day.
- **Spaced repetition**: Leitner boxes per question. A miss sends the question back to
  box 0 (due again in ~10 min); each correct answer pushes it up (8 h → 1 d → 3 d → 1 w →
  3 w). Topic mastery bars reflect average box level.
- Progress lives in `localStorage` — no backend, no account. "Reset progress" on the home
  screen wipes it.

## Code layout

- **Live circuits**: after you answer, solvable schematics animate — current-flow dots move
  through the wires and you can hover any node or component to probe its voltage, current,
  and power. Powered by a built-in DC solver (`js/sim.js`) that treats the drawing itself as
  the netlist (modified nodal analysis; caps open, inductors short, constant-drop diodes).
- **Probe questions** answer by clicking the schematic: "click the node at 8.2 V", "click
  the resistor dissipating the most power".

| path | what |
|---|---|
| `js/app.js` | screens (home / lesson / results), lesson loop |
| `js/question.js` | question player: MC, numeric-with-tolerance, slider, probe |
| `js/figures.js` | Canvas renderer: schematics + plots, explore/probe interactivity |
| `js/sim.js` | DC circuit solver (MNA) — turns the drawn figure into a solved netlist |
| `js/state.js` | XP, streak, levels, Leitner SRS (localStorage) |
| `js/topics.js` | skill-tree topic list |
| `data/questions/*.json` | the question bank, one file per topic |
| `tools/validate.js` | schema/figure validator — run `node tools/validate.js` |
| `tools/sim-test.mjs` | solver verification against hand-computed answers |
| `tools/test-interactive.html` | scripted probe/explore tests (title = ALLPASS/FAIL) |
| `tools/test-render.html` | renders every figure question of a topic (`?topic=…&ids=…`) |
| `tools/test-logic.html` | scripted grading/state smoke tests (title = ALLPASS/FAIL) |
| `QUESTIONS.md` | authoring spec for questions and figures |

## Testing

```sh
npm test          # everything: schema, unit tests, solver-vs-bank, browser suites
npm run test:unit # just the node unit tests (tests/*.test.mjs)
npm run validate  # just the question-bank schema check
```

The suite has four layers, and all content/code changes are expected to keep it green:

1. **Schema** — `tools/validate.js` checks every question against `QUESTIONS.md` (types,
   answers in range, balanced math, figure geometry, probe targets exist).
2. **Unit** (`tests/`, node built-in runner) — the solver (Ohm/KCL, diode states, zener
   breakdown, DC steady-state idealizations, junction current splits), state (XP, levels,
   streak day-math via an injected clock, Leitner scheduling), and text rendering
   (KaTeX splitting, markdown, TeX-in-canvas decoding).
3. **Solver vs bank** — `tools/sim-test.mjs` re-solves drawn figures and asserts they
   agree with hand-computed question answers (this caught a real polarity bug in dc-012).
4. **Browser** — `tools/test-logic.html` and `tools/test-interactive.html` run scripted
   DOM tests (grading flows, probe clicks, explore activation) in headless Chrome; the
   orchestrator greps for the ALLPASS title. Append `?noanim` to any page to freeze
   current-flow animation for deterministic screenshots.

Workflow for changes: write the failing test first (a unit test for engine code, a
validator rule for schema constraints, or a sim-test assertion for new figures), then make
it pass with `npm test`.

## Growing the bank toward 1000

Questions are declarative JSON (see `QUESTIONS.md`) — schematics are tiny netlists rendered
at runtime, so new diagram questions need no image work. To add a batch: write/generate
questions into the topic file, run `node tools/validate.js`, and spot-check figures with
`tools/test-render.html?topic=<id>`. New topics: add an entry in `js/topics.js` plus a
matching JSON file (ideas: Laplace & transients, two-ports, magnetics & transformers, power
electronics, signal integrity).
# ohmwork
