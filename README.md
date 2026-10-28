# FEM Frame Learning Tool

An interactive, step-by-step teaching tool for the finite element method applied to **2D and 3D beam/frame structures**
(Bonus Assignment #2). You define a structure in tables; the tool shows the manual stiffness-method solution for *your*
numbers: element matrices, coordinate transformation, assembly, boundary conditions, the reduced system, Gaussian
elimination, displacements, reactions, member forces and the deformed shape.

* **No AI at runtime.** Every number and every sentence of explanation comes from deterministic code and templates.
  There are no network calls of any kind; identical input gives identical output.
* **Static website**, no backend: it deploys to GitHub Pages.
* Models are saved as JSON files or in the page address (share a link).

## Run locally

```bash
npm install
npm run dev        # development server (http://localhost:5173)
npm test           # unit tests (Vitest)
npm run typecheck  # TypeScript, strict mode
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ locally
```

Node 20 or newer.

## What is in the box

| Area | Where |
| --- | --- |
| Linear algebra with recorded solution steps (Gauss with partial pivoting, Cholesky, static condensation) | `src/linalg/` |
| Data model, validation, JSON/URL-hash serialization, DOF numbering, units | `src/model/`, `schema/model.schema.json` |
| 2D engine (element, transformation, loads, assembly, solve, reactions, member forces) | `src/fem/element2d.ts`, `loads2d.ts`, `analyze2d.ts` |
| 3D engine (12×12 element, orientation rule, releases, loads, analysis) | `src/fem/element3d.ts`, `loads3d.ts`, `analyze3d.ts` |
| Shared partition / solve / reactions / mechanism detection | `src/fem/core.ts` |
| Built-in examples A–E | `src/examples/` |
| UI: editor, 2D (SVG) and 3D (three.js) views, solution steps, help | `src/ui/`, `src/App.tsx` |
| Tests | `src/**/*.test.ts` (121 tests) |

Built-in examples (Examples menu): **A** Logan rigid plane frame (Fig. 5-4), **B** beam with internal hinge (P4-41),
**C** beam with hinge and distributed load (P4-42), **D** 3D L-shaped cantilever, **E** 3D space frame.

## Documents

* [USER_GUIDE.md](USER_GUIDE.md): how to build a structure and read the steps (also shown in the app under *Help*).
* [DECISIONS.md](DECISIONS.md): sign conventions, the 3D orientation rule, the release method, solver choices.
* [TESTING.md](TESTING.md): what is checked, with the hand calculations behind Examples B, C and D.
* [RUBRIC_MAP.md](RUBRIC_MAP.md): where each grading criterion is satisfied.
* [AI_DISCLOSURE.md](AI_DISCLOSURE.md): how AI was used in development.
* [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md): what is left to do by hand.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` runs the tests, builds, and publishes on every push to `main`.
One-time setup: in the repository, **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The site is then at `https://<user>.github.io/<repo>/`. The build uses relative asset paths (`base: './'`), so it works
under any repository name.

## Scope and known limits

Implemented: 2D frame elements (axial + bending), 3D frame elements (axial, torsion, bending about two axes), end
releases/hinges by static condensation, nodal loads, uniform and linearly varying distributed loads (local or global
axes), fixed/pinned/roller/custom supports with prescribed displacements, ground springs, mechanism detection with
the DOFs named, and the deformed shape from cubic Hermite functions.

Not implemented: axial/shear/moment diagrams along members (optional in the brief); a drawn free-body diagram in 3D (a
table of end actions is shown instead); a closed-form global 3D matrix to compare with Tᵀk̂T (the 3D check is symmetry
and rigid-body motion); click-to-add nodes in 3D; thermal loads, member offsets, shear deformation, or nonlinear analysis.
Matrices up to 12×12 are typeset as LaTeX; larger ones are scrollable tables capped at 60×60 until you ask for all of it.
