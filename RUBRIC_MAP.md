# Rubric map (10 points)

Screens refer to the app: **Model** = left panel, **Drawing** = centre, **Step N** = the solution panel on the right.

| # | Criterion (points) | Screens | Main files |
| --- | --- | --- | --- |
| 1 | **User-defined 2D and 3D problem definition and visualization (2)**: nodes, elements, materials, sections, supports, loads, releases entered in tables with add/delete; no fixed limits; invalid input reported; node/element labels, local and global axes, DOF numbers, loads, supports, hinges, deformed shape | Model (all tables, problem list with tinted rows), Drawing (2D SVG; 3D orbitable three.js view), 2D/3D toggle, Step 1, Step 2 (DOF table) | `src/ui/Editor.tsx`, `src/ui/StructureView2D.tsx`, `src/ui/StructureView3D.tsx`, `src/model/validate.ts`, `src/model/serialize.ts`, `src/model/types.ts`, `src/model/dof.ts` |
| 2 | **Element stiffness matrix formulation and coordinate transformation (2)**: local k̂ with axial / bending / torsion contributions, role of EA, EI, GJ, L; T and k = Tᵀk̂T; releases | Step 3 (2D: geometry with numbers substituted, factors, k̂ symbolic / axial+bending / numeric, T, Tᵀ, k, closed-form check, hinge condensation. 3D: λ with each row explained, four coloured blocks, T = diag(λ…), k) | `src/fem/element2d.ts`, `src/fem/element3d.ts`, `src/linalg/condense.ts`, `src/ui/steps/StepsA.tsx` (`StepElements`), `src/ui/steps/StepsC.tsx` (`StepElements3`) |
| 3 | **Step-by-step global stiffness assembly (2)**: ID arrays, scatter of each element into K, running sum, complete K | Step 2 (ID arrays), Step 4 (element expanded to full size, running sum with touched cells highlighted, "same label adds" example, scatter pattern, final K), element inspector under the Drawing | `src/ui/steps/StepsA.tsx` (`StepDofs`, `StepAssembly`), `src/fem/analyze2d.ts` / `analyze3d.ts` (assembly), `src/ui/steps/common.tsx` (`runningK`) |
| 4 | **Boundary conditions and reduced equations (1)**: free/constrained DOFs, prescribed values, strike-through view, K_ff d_f = F_f − K_fc d_c, load vector | Step 5 (load vector with the source of every entry, equivalent nodal loads), Step 6 (partition, strike-through K, reduced system) | `src/fem/core.ts`, `src/fem/loads2d.ts`, `src/fem/loads3d.ts`, `src/ui/steps/StepsB.tsx` (`StepPartition`), `src/ui/steps/StepsA.tsx` (`StepLoads`) |
| 5 | **Step-by-step displacements/rotations and reaction calculation (2)**: the solution process, labelled results with units, reactions from the original equations | Step 7 (every row operation / back-substitution, Cholesky summary for large models), Step 8 (displacements with units), Step 9 (R = K_cf d_f + K_cc d_c − F_c, product term by term, global equilibrium), Step 10 (member end forces, equilibrium checks, free-body diagrams in 2D) | `src/linalg/gauss.ts`, `src/linalg/cholesky.ts`, `src/fem/core.ts`, `src/ui/steps/StepsB.tsx`, `src/ui/steps/StepsC.tsx` (`StepForces3`) |
| 6 | **Educational clarity, navigation, visualization (1)**: stepper, plain-language explanations with the real numbers, conventions, help, deformed shape with stated scale | Stepper (Back / Next / jump list), Help and Conventions panels, display controls (digits, scientific, factor, zoom), Step 11 + Drawing (deformed shape, adjustable scale), dark mode, undo/redo, Examples menu | `src/App.tsx`, `src/ui/Help.tsx`, `USER_GUIDE.md`, `src/ui/Tex.tsx`, `src/ui/steps/StepsB.tsx` (`StepDeformed`) |

## Submission list

| Required item | Where |
| --- | --- |
| Working learning tool (web link) | GitHub Pages site from `.github/workflows/deploy.yml` (see README) |
| User guide | `USER_GUIDE.md` and the in-app **Help** panel |
| Demonstration examples (≥ 1 2D, ≥ 1 3D, no setup) | **Examples** menu: A, B, C (2D), D, E (3D) |
| Source files | this repository |
| AI usage disclosure | `AI_DISCLOSURE.md` (draft: add your own words) |
