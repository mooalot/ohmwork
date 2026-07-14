# Question authoring spec

Questions live in `data/questions/<topic-id>.json` — one file per topic, containing a JSON
**array** of question objects. Topic ids are defined in `js/topics.js`.

## Question object

```json
{
  "id": "dc-001",
  "topic": "dc-basics",
  "tier": 1,
  "type": "mc",
  "prompt": "A $9\\,\\text{V}$ battery drives a $3\\,\\text{k}\\Omega$ resistor. What current flows?",
  "figure": { "...optional, see Figures below..." },
  "choices": ["$3\\,\\text{mA}$", "$27\\,\\text{mA}$", "$0.33\\,\\text{mA}$", "$3\\,\\text{A}$"],
  "answer": 0,
  "explanation": "Ohm's law: $I = V/R = 9/3000 = 3\\,\\text{mA}$. ..."
}
```

Common fields (all required unless noted):

- `id` — unique, `<topic-prefix>-NNN` (zero-padded, e.g. `dc-014`, `rc-003`).
- `topic` — a topic id from `js/topics.js`.
- `tier` — `1` intuition ("what does this circuit do?"), `2` applied (single-concept
  calculation), `3` rigorous (multi-step math: phasor arithmetic, Laplace, small-signal, etc.).
- `type` — `"mc"`, `"numeric"`, or `"slider"`.
- `prompt` — HTML-safe text. Inline math in `$...$` (KaTeX); `**bold**` and `*italic*`
  markdown in prose. No raw `<` / `>` outside math.
- `figure` — optional circuit or plot (see below).
- `explanation` — shown after answering, right or wrong. Teach the **intuition first**, then
  the math. 2–5 sentences. May contain `$...$` math and `$$...$$` display math.

### type: "mc" (multiple choice)

- `choices` — array of 3–5 strings (may contain math). Distractors should encode *real
  misconceptions* (inverted formula, wrong unit prefix, series/parallel confusion), not noise.
- `answer` — index into `choices` of the correct one. Choices are shuffled at runtime.

### type: "numeric"

- `answer` — the numeric value (number, not string).
- `unit` — display unit string, e.g. `"mA"`, `"V"`, `"kΩ"`, `"µs"`, `"dB"`, `"°"`. The prompt
  must make the expected unit unambiguous; the input field shows the unit.
- `tolerance` — accepted relative error as a fraction (e.g. `0.03` = ±3%). Use `0.02`–`0.05`
  for computed values. For answers of exactly 0, tolerance is treated as absolute.

### type: "slider"

The user drags a slider that live-updates a component value on the schematic, and must set it
to satisfy a goal stated in the prompt (e.g. "Set $R_2$ so $V_{out} = 4\,\text{V}$").

- `slider` — `{ "min": 100, "max": 10000, "step": 100, "unit": "Ω", "label": "R_2" }`
- `answer` — correct slider value (number, in slider units).
- `tolerance` — relative, as for numeric.
- The figure component whose value should live-update carries `"bind": true` (see below).

### type: "probe"

The user answers by **clicking the schematic** — a node or a component.

```json
"type": "probe",
"probe": { "target": "node" },
"answer": { "at": [220, 60] }
```

- `probe.target` — `"node"` (click any point on the correct electrical net; the whole net
  counts, so `at` can be any point on it) or `"component"`.
- `answer` — `{ "at": [x, y] }` for nodes, `{ "component": "R_2" }` (the component's exact
  `label`) for components.
- Requires a circuit figure. Works even for figures the simulator can't solve
  (transistor circuits etc.) since grading is geometric.

### Live circuits (automatic)

After any circuit question is answered, the app tries to DC-solve the schematic straight
from the drawing (`js/sim.js`): coincident coordinates form nets, caps are open, inductors
short, diodes use the 0.7 V (LED 2.0 V, zener V_Z from its `value`) constant-drop model.
If it solves, the figure becomes **explorable**: animated current flow plus hover probing
of node voltages and component V/I/P. This means drawn circuits should be *electrically
truthful* — correct source polarity, realistic values — because learners will see the
solved numbers. Circuits with `vsine` or transistors/op-amps simply don't get explore mode.

## Figures

`figure.kind` is `"circuit"` or `"plot"`.

### Circuits

```json
{
  "kind": "circuit",
  "width": 420, "height": 240,
  "components": [
    { "type": "vsource",   "from": [60, 200], "to": [60, 60],  "label": "V_1", "value": "12 V" },
    { "type": "resistor",  "from": [60, 60],  "to": [200, 60], "label": "R_1", "value": "4.7 kΩ" },
    { "type": "capacitor", "from": [200, 60], "to": [200, 200],"label": "C_1", "value": "10 µF" },
    { "type": "ground",    "at": [60, 200] }
  ],
  "wires": [ [[200, 60], [340, 60]], [[60, 200], [200, 200]] ],
  "nodes": [ [200, 60] ],
  "labels": [ { "text": "V_{out}", "at": [348, 60], "anchor": "left" } ]
}
```

Conventions:

- Coordinate space is `width` × `height` logical px, **y grows downward**. Keep coordinates on
  a 20 px grid. Default canvas 420×240; up to 460×300 for transistor circuits.
- Two-terminal components run `from` → `to` and must be **horizontal or vertical**, with
  length ≥ 60 (symbol is ~40 px, the rest becomes lead stubs).
- Figure text (`label`, `value`, `labels[].text`, plot axis labels) is **not KaTeX** — it's a
  lightweight canvas renderer supporting only `_`/`^` sub/superscripts (with `{...}` groups)
  and plain Unicode (Ω, µ, °, π). Write `"+12 V"`, `"V_{out}"`, `"4.7 kΩ"` — no `\text{}`,
  no `$`. `label` is drawn in italic math style, `value` in plain text. Both optional. They render beside the component (right of vertical components,
  above horizontal ones); add `"flipLabel": true` to put them on the other side.
- `wires` — array of polylines (each an array of `[x,y]` points). Only H/V segments.
- `nodes` — junction dots at `[x,y]` points. Put one wherever ≥3 conductors meet.
- `labels` — free text (math-styled) at a point; `anchor` is `"left"`, `"right"` or
  `"center"` (default center). Use for net names like `V_{out}`; an open terminal circle is
  drawn automatically if the label sits at the end of a wire — add `"terminal": [x,y]` to
  force a terminal circle at a point.
- On a `slider` question, exactly one component has `"bind": true`; its displayed `value` is
  replaced live by the slider value + unit.

Two-terminal `type` values:

| type        | notes                                                                 |
|-------------|-----------------------------------------------------------------------|
| `resistor`  | zigzag                                                                |
| `capacitor` | flat plates; `"polarized": true` for electrolytic (+ on `from` side)  |
| `inductor`  | humps                                                                 |
| `vsource`   | circle with +/−; **`to` is the + terminal**                           |
| `isource`   | circle with arrow pointing toward `to`                                |
| `vsine`     | AC source (circle with sine wave)                                     |
| `diode`     | triangle points `from` → `to`, i.e. **`from` = anode, `to` = cathode**|
| `zener`     | like diode with bent cathode bar                                      |
| `led`       | diode plus emission arrows                                            |
| `switch`    | drawn open; `"closed": true` for closed                               |
| `battery`   | long/short plates, long plate (+) on `to` side                        |

Point-placed `type` values (`at: [x,y]`, plus `ground` which needs no terminals):

| type     | terminals (offsets from `at`)                                              |
|----------|-----------------------------------------------------------------------------|
| `ground` | connect wires to `at` itself; symbol hangs below                            |
| `npn` / `pnp` | Base **B** at `(-24, 0)`, Collector **C** at `(+16, -28)`, Emitter **E** at `(+16, +28)`. `"mirror": true` flips horizontally (B at `(+24,0)`, C/E at `(-16, ∓28)`). |
| `nmos` / `pmos` | Gate **G** at `(-24, 0)`, Drain **D** at `(+16, -28)`, Source **S** at `(+16, +28)`. `"mirror": true` as above. |
| `opamp`  | Inverting **−** at `(-32, -14)`, non-inverting **+** at `(-32, +14)`, output at `(+32, 0)`. `"swap": true` puts + on top. |

Wires you draw must land exactly on those terminal points. For npn/pnp, C is the top terminal
and E the bottom (arrow on the emitter shows npn vs pnp automatically).

### Plots

```json
{
  "kind": "plot",
  "width": 420, "height": 220,
  "xlabel": "t (ms)", "ylabel": "v_C (V)",
  "xmin": 0, "xmax": 10, "ymin": 0, "ymax": 12,
  "xticks": 2, "yticks": 3,
  "curves": [
    { "fn": "exp", "v0": 0, "vf": 10, "tau": 2 },
    { "fn": "sine", "amp": 5, "freq": 0.4, "phase": 0, "offset": 0 },
    { "fn": "expr", "expr": "10*Math.exp(-t/2)*Math.cos(2*Math.PI*t)" },
    { "fn": "points", "points": [[0,0],[1,3],[2,4]] }
  ],
  "marks": [ { "x": 2, "y": 6.32, "label": "A" } ],
  "hlines": [ { "y": 6.32, "label": "63%" } ],
  "vlines": [ { "x": 2 } ]
}
```

- `exp`: `v(t) = vf + (v0 − vf)·e^(−t/τ)` — covers both charge and decay curves.
- `sine`: `y = offset + amp·sin(2π·freq·x + phase)` (freq in cycles per x-unit).
- `expr`: any JS expression of `t` (x-axis variable). `Math.*` available.
- `points`: straight-line segments through the given points.
- Each curve may set `"dash": true` and/or a `"color"` index (0–3) for multi-curve plots;
  add `"legend": "label"` to show a legend entry.
- `xticks`/`yticks` are tick *spacings* in axis units (optional; auto if omitted).

## Quality bar

- **Verify every number.** Work the problem before writing the answer. Tolerances don't
  excuse wrong values.
- Explanations should build *intuition for how circuits work* — lead with the mental model
  ("the cap looks like an open circuit long after the switch closes, so no current flows and
  the resistor drops nothing"), then show the math.
- Tier mix per topic: roughly 35% tier 1, 40% tier 2, 25% tier 3.
- Type mix per topic: mostly `mc` and `numeric` (roughly 60/35), a couple of `slider`
  questions where "dial in the value" feels natural. At least a third of questions should
  have a figure.
- Use real-world component values (E12/E24 series: 1.0, 1.2, 1.5, 2.2, 3.3, 4.7, 6.8, 10 …).
- Prompts must be self-contained: all given values in the prompt or on the figure.
