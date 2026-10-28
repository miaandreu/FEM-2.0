# User guide

This tool teaches the manual finite-element procedure for beam and frame structures. You describe a structure; the tool shows every step of the textbook solution for **your** numbers. It never calls AI: the same input always gives the same output.

## Try an example first
Open the **Examples** menu at the top and pick one. The structure, tables and all solution steps load instantly. Use **Next** and **Back** under the *Solution steps* heading to walk through the solution.

## Build your own structure
1. Choose your **units** (they are labels only: type all numbers in one consistent system, for example kN and m).
2. **Nodes**: add a row for each joint and type its x and y coordinates. You can also switch on *Click to add nodes* and click in the drawing.
3. **Materials**: give Young's modulus E. **Sections**: give the area A and the moment of inertia I.
4. **Elements**: each element joins node *i* to node *j* and uses a material and a section. Tick *hinge i* or *hinge j* to put a hinge (zero end moment) at that end.
5. **Supports**: pick a node and a type (fixed, pinned, roller) or tick individual restrained DOFs. A restrained DOF can have a non-zero *prescribed displacement* such as a settlement.
6. **Loads**: add nodal forces or moments (global directions, counter-clockwise moments positive) and distributed loads on elements (uniform or linearly varying).

To **edit**, change any cell. To **delete**, click ✕ on a row; node, element, material and section numbers are renumbered automatically and anything that used a deleted row is removed.

## 3D structures
Switch to **3D** with the toggle at the top (each mode keeps its own model). Everything works as in 2D, with these differences:
- Nodes have x, y, z (**Z is up**). Materials take E and either G or ν (leave G empty to use ν; the default is 0.3). Sections take A, **Iy, Iz** and the torsion constant **J**.
- **Which I is which?** With the default axes a horizontal member's local y axis points up, so bending under vertical loads uses **Iz** and sideways bending uses **Iy**. To turn a section, give the element a **reference vector** or a **roll angle** (the *Elements* table). Vertical members cannot use the default (Z) reference; the tool switches to global X and tells you in steps 1 and 3.
- **Releases:** tick θx, θy or θz at an element end to release that moment (a hinge about that local axis; θx releases torsion).
- **Supports** list six DOFs. Presets: fixed, pinned (3 translations), and rollers that roll along x, y or z.
- **Drawing:** drag to rotate, right-drag to pan, scroll to zoom, *Reset view* to refit. Click an element or node to select it; the selected element shows its local x̂ (red), ŷ (green) and ẑ (blue) axes.
- Step 3 shows the direction-cosine matrix λ with each row explained, the four stiffness blocks (axial, torsion, two bending planes), T = diag(λ, λ, λ, λ) and k = Tᵀk̂T.

## Read the solution
The steps are: 1 model, 2 DOF numbering, 3 element matrices, 4 assembly, 5 load vector, 6 supports and reduced system, 7 solving, 8 displacements, 9 reactions, 10 element forces, 11 deformed shape.

- **Undo / redo**: the ↶ ↷ buttons (or Ctrl/Cmd+Z) step back through your edits.
- **Inspect an element**: click an element in the drawing (or pick its tab in steps 3, 4 and 10). Step 3 shows its geometry, k̂, T and k; step 4 highlights where it lands in the global matrix.
- Matrices show the DOF labels on rows and columns (d2x = x-displacement of node 2, φ2 = rotation of node 2). Large matrices scroll; type node numbers into *Show only node(s)* to focus.
- Use the **display** controls to change significant figures, scientific notation, or factor a common scalar out of matrices ("scalar × matrix"), and to zoom.
- The deformed shape uses a **scale factor** you can change in step 11 (or the slider under the drawing).

## Save and share
- **Export** downloads a `.json` file; **Import** loads one back.
- **Copy link** puts the whole model in the web address so you can send it to someone.

## What the messages mean
- **No supports / too few restraints**: the structure could move as a rigid body. Add supports.
- **The structure can move freely in DOF d4y …**: the stiffness matrix is singular, so some part is a mechanism. Add a support, remove a hinge, or add a member.
- **Zero-stiffness DOF removed**: every element at a node has a hinge there, so the node's rotation has no stiffness. The tool leaves it out of the solve and recovers each member's own end rotation afterwards.
- **E looks unusual for these units**: you may have mixed units (for example E in psi with lengths in metres).
- **Nodes at the same location / zero-length element / missing node / non-positive E, A, I or J**: fix the row named in the message. Rows with problems are tinted red (errors) or amber (warnings) in the tables.
- **Reference vector parallel to the member** (3D): choose a vector that is not along the element.
- **Badly scaled stiffness matrix**: very different member sizes or a nearly unstable structure; results may lose accuracy.
