# Room Planner

Draw a room to scale in the browser, put furniture in it, and take the file with you.

No account, no upload, no paywall on export. A plan lives in your browser and leaves as a
file you own.

```
npm install
npm run dev        # http://localhost:5173
npm test           # 152 unit tests
npm run build      # typecheck + production build
```

---

## What it does

**2D editor**

- Wall drawing with grid and angle snapping, and a live length/angle readout while you draw
- Real wall joins — corners mitre, walls have thickness, interiors close into rooms with
  computed areas
- Doors and windows hosted *in* a wall segment: slide along it, follow it when it moves
- A furniture catalog of parametric primitives at correct real-world dimensions
- Numeric entry everywhere. Click a wall, type `12' 6"`, done
- Imperial/metric toggle, undo/redo, multi-select, marquee, duplicate, lock
- Autosave to IndexedDB so a refresh never loses work

**Export** — all free, all local

| Format | What it's for |
| ------ | ------------- |
| PDF    | Vector, printed at a true scale with a title block |
| SVG    | Vector and exact, editable in other tools |
| PNG    | An image at a chosen DPI, for texting or slides |
| JSON   | The save file. Re-openable here |

Every sheet carries a **scale bar** so the print can be checked against a real
ruler — see [Print scale](#print-scale).

**3D walkthrough** — press `3`, or the toggle in the top bar

- Walls extruded from the same plan, with doors and windows as real openings
- Orbit around the model, or walk it in first person with `WASD` and the mouse
- Furniture as low-poly proxies at true size
- Read-only. Everything is edited in 2D and the 3D view re-derives

---

## Keyboard

| | |
| --- | --- |
| `V` `W` `R` `D` `M` | Select · Wall · Room · Door/window · Measure |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+S` | Export JSON |
| `Ctrl+E` | Open the export dialog |
| `Ctrl+O` | Open a plan file |
| `Ctrl+D` | Duplicate selection |
| `Ctrl+A` | Select all |
| Arrows | Nudge one grid step (`Shift` for a fine nudge) |
| `F` | Fit the plan on screen |
| `Alt` (hold) | Bypass snapping |
| `Space` + drag, or middle-drag | Pan |
| `2` / `3` | 2D drawing / 3D walkthrough |
| `Esc` | End the current wall run, or clear the selection |

In the 3D view: `WASD` to walk, mouse to look, `Shift` to hurry, `Esc` to stop.

---

## How it's built

```
src/
  types/plan.ts          The document. Everything else is a function of this
  lib/
    geometry.ts          Vector maths
    wallGeometry.ts      Mitred joins + room detection      ← the load-bearing piece
    commands.ts          Undo/redo primitives
    edits.ts             What a user action means (weld, split, cascade)
    render.ts            Drawing vocabulary shared by canvas and export
    catalog.ts           Parametric furniture at real dimensions
    units.ts             mm ⇄ feet/inches
    schema.ts            Reading a plan file back in
    export/              Sheet layout, SVG builder, PDF/PNG/JSON
    three/               Scene derivation, wall spans, meshes
  stores/                plan (document + history) · editor (UI state)
  components/canvas/     SVG layers
  components/panels/     Toolbar, rail, inspector, drawer, export
  components/three/      The 3D walkthrough
```

### The decisions worth knowing about

**Everything is millimetres.** Imperial exists only as a display and parse layer at the UI
edge. Nothing below the component boundary has ever heard of a foot.

**Walls store node ids, not coordinates.** Two walls meeting at a corner *share* that node,
so a join isn't something to detect — it's structural. All that's left is solving where the
outline corners land, which is a line intersection between the two walls' offset edges.
Rooms fall out of the same graph via a planar face walk. This is the piece the plan called
the go/no-go, and it has the densest test coverage in the project.

**The renderer is SVG, not canvas.** That falls out of the export requirement: SVG gives
vector export by serialization, vector PDF via `svg2pdf.js`, PNG by rasterising the same
markup, and DOM-native hit-testing. A canvas renderer would need a second geometry-to-SVG
emitter just to satisfy export, and the two would drift. Room plans are tens-to-low-hundreds
of objects, so SVG's performance ceiling never comes up.

**One SVG builder feeds every visual export.** PDF, SVG and PNG are the same string. Three
emitters would guarantee divergence.

**Command-pattern undo from the first commit**, not snapshots. A plan with a photo underlay
carries a base64 image; thirty snapshots of that is thirty copies of a photograph. Commands
store only the fields they touched — usually two numbers. Every mutation goes through
`planStore.execute`; anything that can't be expressed as a command doesn't get to happen.

**No Tailwind.** Vuetify carries the UI alone — one design system, no preflight-vs-reset
collisions, no specificity war. The canvas needs bespoke CSS regardless, and scoped styles
handle that.

### Print scale

The sheet is laid out in *paper millimetres* with the drawing nested in a group scaled by
`1/denominator`, and the PDF is emitted in mm — so a 1:48 drawing lands at exactly
`worldSize / 48` mm with no unit conversion anywhere in between.

This is verified arithmetically in `export.test.ts` rather than trusted: a 10 ft wall must
measure 2.5 inches on paper at 1/4" = 1'-0". An early version rounded the transform's scale
factor to three decimals, turning 1/48 into 0.021 — a 0.8% error, about an inch and a half
across a fourteen-foot room, and exactly what someone finds by holding a ruler to a print.

Tests can only prove the *file* is right. The last link — printer margins, a driver
quietly deciding to "fit to page" — lives outside the program, so every sheet carries a
graduated **scale bar** and states its own length in plain words:

> Printed at 1:48 this bar is 2 1/2" on paper. If it isn't, the print was rescaled.

Lay a ruler across it. The bar always draws to 2½ inches, at every offered scale — the run
it represents changes instead (5 ft at 1:24, 10 ft at 1:48, 20 ft at 1:96), so the check is
the same gesture no matter what the drawing is set to.

---

## Storage, honestly

Autosave writes to IndexedDB, which dies with a cleared cache, an incognito window, or a
browser reset. The app therefore says **"saved in this browser"** and never just "saved",
prompts for a JSON download once there's real work at stake, and warns on the way out if
that work has no file behind it.

The exported JSON is the save file. Treat it like a document.

---

## Design

Dark ink chrome around a light paper canvas — a drafting table under a lamp, where the tools
sit in shadow and the drawing is the lit thing. There is deliberately no light/dark toggle:
the paper has to stay paper either way.

Blueprint blue is the only accent and is reserved for things that are *measured* — selection,
dimension strings, snap indicators. Every number in the interface is set in IBM Plex Mono,
because dimensions align in a real drawing and they should align here.

The signature mark is the dimension string: witness lines, a run, 45° tick slashes, and the
length set in a gap knocked out of the line. Anyone can put a number beside a rectangle; the
tick-slash string is what makes the output read as a drawing.

---

## The 3D walkthrough

Built as a **derived, read-only view**, and that constraint is the whole reason it was
finishable. 3D is where projects like this die — extrusion is easy, but materials, lighting,
camera controls and the endless "can I change the wall colour" are not. Nothing in
`components/three/` can write to the plan; there is a test asserting that deriving a scene
leaves the document byte-identical. **2D correctness is the product, 3D is the demo.**

**Openings are cut by splitting walls, not by subtracting meshes.** A real boolean would
mean a CSG dependency and would fight the mitred footprints. Instead each wall is sliced
along its length into the solid pieces that survive: full-height runs between openings, a
header over every door, a sill under every window. Same result, no dependency, and it is
arithmetic that unit-tests can check.

The subtlety is that a slice must *not* be cut at the wall's own ends — clipping there would
saw the mitres off and leave a gap at every corner — so span bounds are nullable, meaning
"leave this end alone". `wallSpans` returns `{ from: null, to: 4000, … }` for the first piece
of a wall for exactly that reason.

**Axis mapping**: the plan is a top-down drawing on X/Y with +y running south; Three is
Y-up. So plan x → three x, plan y → three z, height → three y. `ExtrudeGeometry` builds in XY
and pushes along +Z, so shapes are authored with y negated and rotated −90° about X. Get the
sign wrong and the model is a mirror of the drawing — which nobody notices until they try to
use it.

**Not done**: collision. Walking through a wall is a mild oddity; a camera jammed in a
doorway is a bug report, and solving it properly means a collision pass over geometry that
exists to be looked at.

## Attribution

The furniture catalog is parametric primitives with published real-world dimensions — no
scraped manufacturer models, which is a licensing problem rather than a technical one. Any
future mesh library must come from a clearly-licensed source (CC0 or similar) with
attribution tracked from the first commit.
