# Testing

Run everything with `npm test` (Vitest). Each phase adds checkpoints; this file records the
independent hand calculations the tests compare against.

## Example A: Logan Example 5.1 (Fig. 5-4 / 5-5)
Checked against the book's printed values: factors (Eq. 5.2.1/5.2.3), element global matrices
(5.2.2), the reduced system (5.2.6), displacements (5.2.7, within 1%), element end forces
(5.2.11–5.2.12, within 1%), and the joint moment check −221,000 + 226,000 ≈ 5,000 lb·in.
The recomputed values agree with the textbook figures you quoted
(d2x = 0.21136 in, d2y = 0.001481 in, φ2 = −0.001526 rad, d3x = 0.20936 in, d3y = −0.001481 in,
φ3 = −0.001486 rad; element 1 end forces −3703, 4992, 375,803, 3703, −4992, 223,200).
The small differences from the book are the book's three-digit rounding.

## Example B: Logan Fig. P4-41 (hinge beam)
Right segment: hinge at one end, roller at the other, so both end moments are zero and its shear is
zero. The cantilever (0–2 m) carries all of P = 5 kN:
R_y = 5 kN, M = P·L = 10 kN·m (CCW, i.e. positive), roller reaction 0,
hinge deflection −P L³/(3EI) = −5·8/(3·2×10⁴) = −6.667×10⁻⁴ m.

## Example C: Logan Fig. P4-42 (hinge + distributed load), statics and compatibility
Geometry: A fixed at x=0, B roller at x=2, hinge C at x=3, D fixed at x=4; w = 10 kN/m down on C–D.
EI = 2×10⁸ × 10⁻⁴ = 2×10⁴ kN·m².

Unknown: the shear V (kN, upward on C–D) that the hinge transmits. The hinge carries no moment.

1. **Member C–D** (cantilever from D, length 1, UDL down, tip force V up):
   δ_C = −wL⁴/(8EI) + V L³/(3EI) = (−10/8 + V/3)/EI.
2. **Member A–B–C**: span A–B (L = 2, fixed at A, roller at B) plus overhang B–C (a = 1) loaded at C by V downward.
   - The overhang puts a moment V·a (hogging) on the span at B. The span's rotational stiffness at B is
     4EI/L (far end fixed, B's translation held), so θ_B = −V a L/(4EI) = −V/(2EI).
   - δ_C = θ_B·a − V a³/(3EI) = −(1/2 + 1/3) V/EI = −(5/6) V/EI.
3. **Compatibility** (hinge has one deflection): −10/8 + V/3 = −(5/6) V ⇒ V(1/3 + 5/6) = 1.25 ⇒ **V = 15/14 = 1.0714 kN**.
4. **Reactions:**
   - Carry-over: M_A = M_B/2 = −V/2 = **−0.5357 kN·m** (clockwise).
   - Span A–B as a cantilever from A with v_B = 0: (R_B − V)·L³/(3EI) − V·a·L²/(2EI) = 0 ⇒ R_B = V + 0.75 V = 1.75 V = **1.875 kN**.
   - R_A = V − R_B = −0.75 V = **−0.8036 kN** (downward).
   - C–D: R_D = 10 − V = **8.9286 kN**; moments about D: V·(−1) + 10·(0.5) + M_D = 0 ⇒ M_D = −(5 − V) = **−3.9286 kN·m**.
5. **Checks:** ΣFy = −0.8036 + 1.875 + 8.9286 = 10.000 ✓; ΣM about A = −0.5357 + 2(1.875) + 4(8.9286) − 3.9286 − 10·3.5 = 0 ✓.
6. Hinge deflection = −(5/6) V/EI = −4.464×10⁻⁵ m.

(An early draft of this hand calculation used 3EI/L for the rotational stiffness at B, which is wrong for a
far-end-fixed span; 4EI/L is correct and is what the numbers above use. The FE result agreed with the
corrected value to 1e-9.)

## Other 2D checks in `src/fem/fem2d.test.ts`
Element matrix symmetry, rigid-body modes, T orthogonality, TᵀkT = closed form (Logan 5.1.11) for any
orientation, hinge condensation = propped cantilever, equivalent loads (uniform, triangular),
UDL cantilever (wL⁴/8EI), global-direction load on an inclined member, ground spring, support settlement,
prescribed rotation, pin-ended bar (both rotations removed), four-bar mechanism, y-only-restraint sliding
mechanism (message names the DOF), rotation invariance, determinism, and a 50-node / 100-element frame.

## Example D: L-shaped cantilever (closed form)
Member 1 along +X (L1 = 3 m), member 2 along +Y (L2 = 2 m), P = 10 kN down (−Z) at the tip; with
E = 2×10⁸, Iz = 4×10⁻⁵ (so EIz = 8×10³ kN·m²), G = 8×10⁷, J = 2×10⁻⁵ (all kN, m).
- Tip deflection: w = −[P L2³/(3EI) + P L1³/(3EI) + P L2² L1/(GJ)] with I = Iz (horizontal members: local ŷ = global Z).
- Reactions at the fixed support: Fz = +P, Mx = +P·L2 (torque in member 1), My = −P·L1 (moment of P about the base).
  Check: the load's moment about the origin is r × F = (L1, L2, 0) × (0, 0, −P) = (−P L2, +P L1, 0); the reaction is the opposite.

## Example E: space frame
Global equilibrium of loads + reactions (forces and moments about the origin) to 1e-6 relative; every member in
equilibrium; reactions sum to the applied loads (gravity 12 kN/m × 24 m of beams = 288 kN; lateral 20 + 20 kN in x, 10 kN in y).
Symmetry check (gravity only): all four base reactions equal 72 kN; node vertical displacements equal; x-displacements
of mirrored nodes are equal and opposite.

## Other 3D checks (`src/fem/fem3d.test.ts`)
λ orthonormal and right-handed, T orthogonal, vertical-member fallback, roll angle; k̂ symmetric with positive diagonal;
x–z bending sign pattern; six rigid-body modes (local and for an arbitrarily oriented rolled member in global axes);
hinge/torsion-release condensation (propped forms 3EI/L³, 3EI/L); cantilever sign checks for both bending planes
(including θy = −dw/dx) and UDL; the 3D hinge beam reproduces the 2D Example B numbers; a hinged node is removed from the
solve (axis-aligned and inclined hinge, the latter compared against the aligned version); mechanism and too-few-supports
messages; rotation invariance (arbitrary-axis rotation of an isotropic-section frame); determinism; a 50-node / 100-element
space grid (Cholesky path).
