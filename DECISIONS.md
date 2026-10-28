# Design decisions

Living document; each phase appends. Sections for sign conventions, 3D orientation, and the
release method are filled in as those features land (Phases 2 and 4).

## Project layout
- The app lives in `fem-learning-tool/`, next to the assignment PDFs, so `node_modules` stays out of the PDF folder.
- Vite `base` is `./` (relative). The app has no router (state lives in the URL hash), so this works on a
  GitHub Pages project site, a user site, or any static host without knowing the repo name.

## Data model (Phase 1)
- **IDs are 1-based and contiguous** per table. Global DOF numbering depends on it (node n owns DOFs
  (n-1)k+1..nk). Validation reports gaps; `renumberModel` fixes them after deletions and remaps all references,
  dropping anything that pointed at a deleted row.
- **Section properties** are `A, Iz, Iy, J` in both dimensions. 2D uses only `A` and `Iz` (written "I" in the UI).
- **Shear modulus (3D):** `G` if given, else `E / (2(1+ν))` from `nu`, else ν = 0.3 with an info message.
- **Releases** are per element end, as booleans on the local rotational DOFs (`rx, ry, rz`). 2D uses `rz` only.
- **Support presets:** "roller-x" rolls along x (restrains y); "roller-y" rolls along y (restrains x);
  in 3D a roller restrains the two translations perpendicular to its rolling axis. Rotations stay free.
- **Unconnected nodes** are a warning, not an error: they are left out of the analysis rather than blocking it.
- **Unit systems are labels.** Nothing is converted. E is checked against a wide plausibility band
  (1e5–1e8 psi equivalent) to catch unit slips without flagging real materials.
- **Persistence:** canonical JSON (fixed key order) is the primary save format; the URL hash is the same JSON,
  base64url-encoded. Identical models give byte-identical output.

## Linear algebra (Phase 1)
- Own `Matrix` on `Float64Array`; no math library.
- **Gauss with partial pivoting is rank-revealing:** a column without a usable pivot is marked *free* and
  elimination continues. Each free column is a mechanism DOF, and a null-space vector (the mechanism shape)
  is built so the UI can say which DOFs move together.
- **Pivot test is relative** to the largest entry of that column of the ORIGINAL matrix (tol 1e-9), so mixed
  axial/bending stiffnesses (very different magnitudes) are not mistaken for singularity.
- **Step recording:** every swap, elimination row-operation, free-column and back-substitution is recorded.
  Full matrix snapshots are attached only for small systems (n ≤ 12); `maxRecordedSteps` caps memory for
  large ones while the true operation count is still reported.
- **Large systems (n > 60):** Cholesky (steps summarized). If it breaks down (not positive definite), the solver
  falls back to a lightly recorded Gauss run, because that run is what locates the mechanism.
- **Static condensation** (`k* = k_rr − k_rc k_cc⁻¹ k_cr`) lives in `linalg/condense.ts` and returns every
  intermediate matrix for display; load vectors condense the same way (`f* = f_r − k_rc k_cc⁻¹ f_c`).

## 2D engine (Phase 2)
- **Sign convention:** right-handed X, Y; counter-clockwise rotation and moment positive. Local x̂ runs from
  node i to node j, ŷ is x̂ rotated 90° CCW, and ẑ = z. Local end-force order is [f̂1x, f̂1y, m̂1, f̂2x, f̂2y, m̂2],
  forces ON the element ends (as in Logan Eq. 5.2.11).
- **Equivalent nodal loads:** for a distributed load, `F_eq` is the nodal load statically equivalent to it
  (uniform ŷ: wL/2, wL²/12, wL/2, −wL²/12 with signed w). The clamped-end ("fixed-end") reactions are −F_eq.
  Global system: K d = F_applied + Σ F_eq. Member end forces: f̂ = k̂ d̂ − F_eq. Distributed loads given in
  global axes act per unit member length (not per unit projected length).
- **Release method:** static condensation of the released local rotation(s), `k* = k_rr − k_rc k_cc⁻¹ k_cr`
  (condensed load: `f* = f_r − k_rc k_cc⁻¹ f_c`). The condensed element has zero rows/columns at the released DOF.
  After the solve, each member's own end rotation is recovered as `d̂_c = k_cc⁻¹ (F_eq,c − k_cr d̂_r)`, and member end
  forces use the original unreduced k̂ with that recovered rotation, so the released moments come out ≈ 0.
- **Zero-stiffness DOFs:** a free DOF whose whole K row is zero (e.g. a node where every element releases the
  rotation, or an unconnected node) is removed from the solve and reported with an explanation; a load on such a
  DOF is reported as an error. No artificial springs are added.
- **Stability:** singular K_ff is reported per free column ("the structure can move freely in DOF d4y (node 4,
  y-translation) …, together with …"), using the null-space mechanism shape. Pivot spread > 1e12 gives an
  ill-conditioning warning.
- **Reactions:** `R = K_cf d_f + K_cc d_c − F_c` from the unreduced K, F (springs on constrained DOFs are included).
- **Deformed shape:** cubic Hermite for transverse displacement, linear for axial, using member-end values
  (so a hinge shows as a kink). With distributed loads the particular-solution term is omitted; end values are exact.
- **Examples B/C material:** E = 200 GPa = 2×10⁸ kN/m², I = 1×10⁻⁴ m⁴, A = 0.01 m² (editable in the UI).
- **Support naming:** Example B/C rollers are `roller-x` (free to roll along x, restrain y).

## 2D UI (Phase 3)
- **Layout:** model editor (left), structure drawing + element/node inspector (centre), step-by-step panel (right);
  stacks to one column below 1100 px. Light/dark theme follows the OS and can be toggled.
- **Matrix display:** matrices up to 12×12 render as real LaTeX arrays with row/column DOF labels (KaTeX). Larger
  ones switch to a scrollable table with sticky labels, a "show only node(s)" filter, and a 60×60 render cap that must
  be lifted explicitly. Zeros are dimmed. Controls: significant digits, scientific notation, "scalar × matrix" factoring, zoom.
- **Colours:** blue = axial, red = bending, grey = zero, yellow = cells touched by the selected element.
- **Gauss walkthrough:** every recorded row operation is shown with the substituted multiplier; matrix snapshots appear
  for systems up to 12 unknowns; longer lists paginate (24, then +50 / all). Systems above 60 unknowns show a Cholesky summary.
- **Persistence:** the model is written to the URL hash (debounced 400 ms) and can be exported/imported as JSON.
  The 3D toggle is present but disabled until Phase 5; each dimension will keep its own model.
- **Click-to-add nodes** snaps to a power-of-ten grid about 1/20 of the model size.
- **Verification method for the UI:** all 33 step views (3 examples × 11 steps) were rendered in a real browser with no
  KaTeX errors or error boundaries; there are no automated component tests yet.

## 3D engine (Phase 4)
- **DOF order:** node DOFs are (u, v, w, θx, θy, θz); local element order [u1 v1 w1 θx1 θy1 θz1 | u2 v2 w2 θx2 θy2 θz2].
- **Local stiffness (12×12)** is the sum of four blocks, returned separately for colour-coding: axial EA/L (u),
  torsion GJ/L (θx), bending in the local x–y plane with EIz (v, θz), bending in the local x–z plane with EIy (w, θy).
  The x–z block has the same magnitudes as x–y but the θy couplings change sign (θy = −dw/dx); a test pins the pattern.
- **Orientation rule.** x̂ runs from node i to node j. The *reference vector* r defines the local x–y plane:
  ẑ = x̂ × r (normalized), ŷ = ẑ × x̂ (so ŷ lies on r's side). Default r = global Z. **Vertical members** (x̂ parallel to ±Z,
  tolerance 1e-6) cannot use Z, so the **fallback is r = global X** (local ŷ = global X, ẑ = x̂ × X); the UI reports this per
  element (`orientation.refSource === 'fallback-X'` and a plain-language `note`). A roll angle β then rotates ŷ, ẑ about x̂
  (right-hand rule). λ has rows x̂, ŷ, ẑ; T = diag(λ, λ, λ, λ).
  *Consequence:* for a horizontal member with the default reference, local ŷ = global Z, so vertical bending uses **Iz**
  and bending about the vertical axis uses Iy. Example D uses Iy ≠ Iz to make this checkable.
- **Releases (3D):** each end can release θx, θy and/or θz (local). Released DOFs are statically condensed exactly as in 2D.
  Torsion released at *both* ends makes k_cc singular (rigid spin about the axis); that block is decoupled from the rest,
  so those two rows/columns are zeroed and the remaining released DOFs are condensed normally.
- **Distributed loads:** global-axis loads act per unit member length and are resolved with λ. Equivalent loads follow the
  2D formulas for y, and the same with the θy moments sign-flipped for z.
- **Zero-stiffness rotations at hinged nodes.** A node whose elements all release the same rotation has no stiffness in
  it. If that axis is a global axis the DOF row is exactly zero (removed as in 2D). If the hinge axis is *inclined*, no single
  DOF row is zero but K_ff is singular along that axis; the solver checks that every null vector lies on one node's
  rotation DOFs and that the load is orthogonal to it, then removes one DOF per mode (set to zero; any value gives the same
  member forces) and says so. A load or moment pushing on such a mode is reported as an error instead.
- **Shared back half:** `fem/core.ts` (partition, solve, reactions, mechanism messages) is dimension-independent and used by
  the 3D analysis. The 2D analysis still has its own copy of that logic (kept untouched because its tests pass);
  merging them is a possible cleanup.
- **Fix to 2D found while building 3D:** a load on a DOF that nothing resists used to add an error message but leave
  `ok = true`; `ok` is now false whenever an error issue exists.
- **Example D:** L1 = 3, L2 = 2, P = 10 kN, E = 200 GPa, G = 80 GPa, Iy = 8×10⁻⁵, Iz = 4×10⁻⁵, A = 0.01, J = 2×10⁻⁵ (kN, m).
  Closed-form tip deflection uses Iz (see orientation consequence above). Reactions: Fz = P, Mx = P·L2, My = −P·L1.
- **Example E:** 4 vertical columns (fixed bases), roof grid of 7 beams, 12 kN/m gravity on the beams, lateral nodal loads;
  a gravity-only variant is used for the symmetry check.

## 3D UI (Phase 5)
- **Two modes, two models.** The 2D/3D toggle keeps one model per dimension (switching never loses the other). Loading an
  example, importing a file, or opening a shared link switches to that model's dimension. The URL hash holds the model
  currently shown.
- **Shared steps.** DOF numbering, assembly, load vector, partition, solve, displacements, reactions and deformed shape are
  one set of components for both dimensions; they read the dimension from `setLabelDim()` (set by `App` on every render)
  so DOF labels (d2x vs φ2z), DOFs per node, and units follow the mode. Only the model summary, element matrices (orientation,
  λ, T, the four blocks) and element forces are 3D-specific (`ui/steps/StepsC.tsx`). The 3D free-body diagram is a table of
  end actions instead of a drawing.
- **three.js view** (`ui/StructureView3D.tsx`) is loaded lazily (separate ~580 kB chunk), so the 2D tool does not pay for it.
  Z is up. Orbit/pan/zoom; node and element numbers; x̂ arrow on every element and the full x̂ŷẑ triad on the selected
  one; supports (cube = fully fixed, cone = pinned, axis bars = rollers/custom); force arrows, double-headed moment
  vectors, distributed-load arrows; hinge rings; deformed shape as a tube using the same Hermite curves as the engine.
  Picking uses invisible, fatter proxies so thin members are easy to click; nodes win over members when both are hit.
  If WebGL is unavailable the view shows a message and everything else still works.
- **3D editor:** z coordinates; G (blank → from ν, default 0.3); A, Iy, Iz, J; per-element release checkboxes for θx/θy/θz at
  each end; optional reference vector and roll angle; six-DOF supports with fixed/pinned/three roller presets; z-direction loads.
  The section hint explains that, with default axes, vertical bending of a horizontal member uses Iz.
- **Not done in 3D:** click-to-add nodes (2D only), a drawn free-body diagram.

## Polish (Phase 6)
- **Large models.** Measured on a 50-node / 100-element 3D model (300 DOFs) in dev mode, which renders everything twice:
  before, steps 2, 5, 6 and 8 took 0.8–1.8 s because every table row rendered a KaTeX label (300–400 renders per step) and
  `MatrixView` copied the whole 300×300 matrix into nested arrays just to draw a capped 60×60 table. Table labels are now plain
  text, and `MatrixView` reads the matrix directly (nested arrays only for the ≤12×12 LaTeX path). Rule of thumb in the code:
  LaTeX for equations and small matrices, plain text for anything repeated per DOF.
- **Responsive typing.** The structure view and all steps follow the model through `useDeferredValue`, so edits in the table
  never wait for a re-solve of a large model; export, copy-link and click-to-add always use the live (not deferred) model.
- **Undo / redo** (header buttons, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y outside text fields): edits within 700 ms are merged
  into one step; loading an example, New and Import are undoable too (up to 100 steps, in memory only).
- **Problem rows** in the editor tables are tinted red (error) or amber (warning) from the validation messages, so the
  row to fix is visible, not only named in a list.
- **Accessibility:** skip link; landmarks and labelled controls; `aria-live` problem list and a screen-reader status line;
  the drawings carry a generated plain-language description (`ui/describe.ts`) and, in 2D, elements and nodes are
  keyboard-focusable buttons; all tables have text equivalents; matrices are KaTeX (which also emits MathML);
  `prefers-reduced-motion` is honoured. Contrast follows the CSS tokens in both themes.
- **Crash guard.** A root error boundary offers "Reset and reload" instead of a blank page; each solution step also has its own
  boundary so one failing step never hides the rest.
- **Tooling note (this machine).** The native TypeScript 7 `tsc` hangs while exiting and prints nothing, so an empty
  log from it is NOT evidence of a clean typecheck. Use `npm run typecheck` on a normal machine, or a JS TypeScript
  (5.x) as `node <ts5>/bin/tsc --noEmit -p tsconfig.json`, and `vite build` plus a browser run as additional checks.
