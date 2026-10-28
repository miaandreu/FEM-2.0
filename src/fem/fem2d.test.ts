import { describe, expect, it } from 'vitest';
import { Matrix } from '../linalg';
import { analyze2D, deformedMember2D, runningStiffness } from './analyze2d';
import { elementMatrices2D, geometry2D, localStiffness2D, transformation2D } from './element2d';
import { equivalentNodalLoadLocal } from './loads2d';
import { exampleA, exampleB, exampleC } from '../examples/examples2d';
import { NO_RELEASE, emptyModel, makeSupport } from '../model';
import { cantilever2D } from '../test/fixtures';

const rel = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(Math.abs(b), 1e-12));
const el = (id: number, a: number, b: number, rz: [boolean, boolean] = [false, false]) => ({
  id, nodeI: a, nodeJ: b, materialId: 1, sectionId: 1,
  releaseI: { ...NO_RELEASE, rz: rz[0] }, releaseJ: { ...NO_RELEASE, rz: rz[1] },
});

describe('2D element matrices', () => {
  const E = 2e8, A = 0.02, I = 3e-4, L = 3.7;
  const { k } = localStiffness2D(E, A, I, L);
  it('is symmetric with positive diagonal', () => {
    expect(k.isSymmetric()).toBe(true);
    for (let i = 0; i < 6; i++) expect(k.get(i, i)).toBeGreaterThan(0);
  });
  it('has the three rigid-body modes in its null space', () => {
    const modes = [
      [1, 0, 0, 1, 0, 0], // translation x
      [0, 1, 0, 0, 1, 0], // translation y
      [0, 0, 1, 0, L, 1], // rotation about node i: v2 = θ L
    ];
    for (const m of modes) for (const f of k.mulVec(m)) expect(Math.abs(f)).toBeLessThan(1e-6 * k.maxAbs());
  });
  it('T is orthogonal', () => {
    for (const deg of [0, 30, 90, 137, 270]) {
      const T = transformation2D(Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180));
      const P = T.transpose().mul(T);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) expect(P.get(i, j)).toBeCloseTo(i === j ? 1 : 0, 12);
    }
  });
  it('TᵀkT equals the closed form of Logan Eq. 5.1.11 for any orientation', () => {
    for (const [x2, y2] of [[3, 4], [-2, 5], [0, -6], [7, 0], [-3, -3]]) {
      const g = geometry2D({ x: 1, y: 1 }, { x: 1 + x2, y: 1 + y2 });
      const m = elementMatrices2D(E, A, I, g, []);
      expect(m.closedFormMismatch).toBeLessThan(1e-12);
      expect(m.kGlobal.isSymmetric()).toBe(true);
    }
  });
  it('splits into axial + bending parts', () => {
    const p = localStiffness2D(E, A, I, L);
    expect(p.axial.plus(p.bending).data).toEqual(p.k.data);
    expect(p.axial.get(0, 0)).toBeCloseTo((E * A) / L, 6);
    expect(p.bending.get(2, 2)).toBeCloseTo((4 * E * I) / L, 6);
  });
  it('a hinge at end j condenses to the propped-cantilever stiffness', () => {
    const m = elementMatrices2D(E, A, I, geometry2D({ x: 0, y: 0 }, { x: L, y: 0 }), [5]);
    const kk = m.kLocalUsed;
    rel(kk.get(1, 1), (3 * E * I) / L ** 3, 1e-12);
    rel(kk.get(1, 2), (3 * E * I) / L ** 2, 1e-12);
    rel(kk.get(2, 2), (3 * E * I) / L, 1e-12);
    for (let j = 0; j < 6; j++) expect(kk.get(5, j)).toBe(0);
  });
});

describe('equivalent nodal loads', () => {
  it('uniform: wL/2, wL²/12', () => {
    const f = equivalentNodalLoadLocal({ wx1: 0, wx2: 0, wy1: -3, wy2: -3 }, 4);
    expect(Array.from(f)).toEqual([0, -6, -4, 0, -6, 4]);
  });
  it('linearly varying (0 → w): 3wL/20, wL²/30 at the light end; 7wL/20, wL²/20 at the heavy end', () => {
    const w = 10, L = 2;
    const f = equivalentNodalLoadLocal({ wx1: 0, wx2: 0, wy1: 0, wy2: w }, L);
    rel(f[1], (3 * w * L) / 20, 1e-14);
    rel(f[2], (w * L * L) / 30, 1e-14);
    rel(f[4], (7 * w * L) / 20, 1e-14);
    rel(f[5], -(w * L * L) / 20, 1e-14);
  });
});

describe('Example A (Logan Fig. 5-4 / 5-5)', () => {
  const a = analyze2D(exampleA());
  it('solves with no issues', () => {
    expect(a.ok).toBe(true);
    expect(a.issues).toEqual([]);
  });
  it('element 1 geometry, factors and global k match Eq. 5.2.1–5.2.2', () => {
    const e = a.elements[0];
    expect(e.geometry.C).toBeCloseTo(0, 12);
    expect(e.geometry.S).toBeCloseTo(1, 12);
    expect(e.geometry.L).toBe(120);
    rel(e.local.factors.twelveI_L2, 0.167, 2e-3);
    rel(e.local.factors.sixI_L, 10, 1e-12);
    rel(e.local.factors.E_L, 250000, 1e-12);
    const book = Matrix.fromRows([
      [0.167, 0, -10, -0.167, 0, -10],
      [0, 10, 0, 0, -10, 0],
      [-10, 0, 800, 10, 0, 400],
      [-0.167, 0, 10, 0.167, 0, 10],
      [0, -10, 0, 0, 10, 0],
      [-10, 0, 400, 10, 0, 800],
    ]).scale(250000);
    for (let i = 0; i < 36; i++) expect(Math.abs(e.kGlobal.data[i] - book.data[i])).toBeLessThan(0.002 * 250000 * 10 + 1e-6);
  });
  it('element 2 and 3 factors match Eq. 5.2.3 and orientations (C,S) = (1,0), (0,−1)', () => {
    rel(a.elements[1].local.factors.twelveI_L2, 0.0835, 2e-3);
    rel(a.elements[1].local.factors.sixI_L, 5, 1e-12);
    expect(a.elements[1].geometry.C).toBeCloseTo(1, 12);
    expect(a.elements[2].geometry.S).toBeCloseTo(-1, 12);
  });
  it('reduced system equals Eq. 5.2.6 (÷ 250,000)', () => {
    const book = Matrix.fromRows([
      [10.167, 0, 10, -10, 0, 0],
      [0, 10.0835, 5, 0, -0.0835, 5],
      [10, 5, 1200, 0, -5, 200],
      [-10, 0, 0, 10.167, 0, 10],
      [0, -0.0835, -5, 0, 10.0835, -5],
      [0, 5, 200, 10, -5, 1200],
    ]);
    expect(a.dofClass.free.map((i) => i + 1)).toEqual([4, 5, 6, 7, 8, 9]);
    const got = a.Kff.scale(1 / 250000);
    for (let i = 0; i < 36; i++) expect(Math.abs(got.data[i] - book.data[i])).toBeLessThan(2e-3 * Math.max(1, Math.abs(book.data[i])));
    expect(Array.from(a.Ff)).toEqual([10000, 0, 0, 0, 0, 5000]);
  });
  it('displacements match Eq. 5.2.7 within 1%', () => {
    const book = [0.211, 0.00148, -0.00153, 0.209, -0.00148, -0.00149];
    book.forEach((v, i) => rel(a.d[3 + i], v, 0.01));
  });
  it('element end forces match Eq. 5.2.11–5.2.12 / Fig. 5-5 within 1%', () => {
    const book = [
      [-3700, 4990, 376000, 3700, -4990, 223000],
      [5010, -3700, -223000, -5010, 3700, -221000],
      [3700, 5010, 226000, -3700, -5010, 375000],
    ];
    book.forEach((row, e) => row.forEach((v, i) => rel(a.elements[e].endForces[i], v, 0.01)));
  });
  it('satisfies equilibrium: per element, globally, and at the moment joint', () => {
    a.elements.forEach((e) => expect(e.equilibrium.ok).toBe(true));
    expect(a.globalEquilibrium!.ok).toBe(true);
    const hx = a.reactions[0] + a.reactions[3];
    rel(hx, -10000, 1e-9);
    const f2 = a.elements[1].endForces[5];
    const f3 = a.elements[2].endForces[2];
    rel(f2 + f3, 5000, 1e-9);
  });
  it('reactions come from the original equations, R = K_cf d_f + K_cc d_c − F_c', () => {
    const R = a.K.mulVec(a.d);
    a.dofClass.constrained.forEach((gi, i) => expect(a.reactions[i]).toBeCloseTo(R[gi] - a.F[gi], 6));
  });
  it('the running assembly ends at the full K', () => {
    expect(runningStiffness(a, 3).data).toEqual(a.K.data);
    expect(runningStiffness(a, 0).maxAbs()).toBe(0);
  });
  it('the deformed member starts and ends at the displaced nodes', () => {
    const p = deformedMember2D(a, a.elements[0], 1, 11);
    expect(p.deformed[10].x).toBeCloseTo(-60 + a.d[3], 9);
    expect(p.deformed[10].y).toBeCloseTo(120 + a.d[4], 9);
    expect(p.deformed[0]).toEqual({ x: -60, y: 0 });
  });
});

describe('Example B (P4-41): hinge beam', () => {
  const a = analyze2D(exampleB());
  const EI = 2e8 * 1e-4;
  it('cantilever takes all of P; roller gets nothing', () => {
    expect(a.ok).toBe(true);
    const R = (dof: number) => a.reactions[a.dofClass.constrained.indexOf(dof - 1)];
    rel(R(2), 5, 1e-9);
    rel(R(3), 10, 1e-9);
    expect(Math.abs(R(8))).toBeLessThan(1e-9);
  });
  it('hinge deflection = P L³ / 3EI', () => {
    rel(a.d[4], -(5 * 8) / (3 * EI), 1e-9);
  });
  it('right element carries no end forces', () => {
    for (const f of a.elements[1].endForces) expect(Math.abs(f)).toBeLessThan(1e-9);
  });
});

describe('Example C (P4-42): hinge + distributed load, vs hand calculation', () => {
  // Hand calc (TESTING.md): V = 15/14 kN passes through the hinge.
  const V = 15 / 14;
  const a = analyze2D(exampleC());
  const R = (dof: number) => a.reactions[a.dofClass.constrained.indexOf(dof - 1)];
  it('solves', () => expect(a.ok).toBe(true));
  it('reactions match the statics/compatibility hand calculation', () => {
    rel(R(2), -0.75 * V, 1e-9); // A, vertical
    rel(R(3), -V / 2, 1e-9); // A, moment
    rel(R(5), 1.75 * V, 1e-9); // B roller
    rel(R(11), 10 - V, 1e-9); // D, vertical
    rel(R(12), -(10 * 0.5 - V), 1e-9); // D, moment
  });
  it('vertical and moment equilibrium of the reactions against the 10 kN load', () => {
    rel(R(2) + R(5) + R(11), 10, 1e-9);
    rel(R(3) + 2 * R(5) + 4 * R(11) + R(12), 10 * 3.5, 1e-9);
  });
  it('hinge deflection = −(5/6) V / EI', () => {
    rel(a.d[7], -(5 / 6) * V / (2e8 * 1e-4), 1e-9);
  });
  it('removes the zero-stiffness hinge rotation, explains why, and recovers each member end rotation', () => {
    expect(a.dofClass.removed.map((r) => r.dof + 1)).toEqual([9]);
    expect(a.dofClass.removed[0].reason).toBe('hinge');
    expect(a.dofClass.removed[0].text).toMatch(/releases/);
    // The two members meeting at the hinge rotate differently there.
    const rotEl2 = a.elements[1].dLocal[5];
    const rotEl3 = a.elements[2].dLocal[2];
    expect(Math.abs(rotEl2 - rotEl3)).toBeGreaterThan(1e-6);
    // ...and the moments at the released ends are zero.
    expect(Math.abs(a.elements[1].endForces[5])).toBeLessThan(1e-9);
    expect(Math.abs(a.elements[2].endForces[2])).toBeLessThan(1e-9);
  });
  it('all elements and the structure are in equilibrium', () => {
    a.elements.forEach((e) => expect(e.equilibrium.ok).toBe(true));
    expect(a.globalEquilibrium!.ok).toBe(true);
  });
});

describe('loads, springs and prescribed displacements', () => {
  it('cantilever with UDL: tip deflection wL⁴/8EI, root reaction wL and wL²/2', () => {
    const m = cantilever2D(3, 0);
    m.nodalLoads = [];
    m.elementLoads = [{ elementId: 1, kind: 'uniform', coordSys: 'local', axis: 'y', w1: -4, w2: -4 }];
    const a = analyze2D(m);
    rel(a.d[4], -(4 * 81) / (8 * 2e4), 1e-9);
    rel(a.reactions[1], 12, 1e-9);
    rel(a.reactions[2], 18, 1e-9);
  });
  it('a global-direction load on an inclined member has the same resultant as the load', () => {
    const m = cantilever2D(3, 0);
    m.nodes[1] = { id: 2, x: 3, y: 4, z: 0 };
    m.nodalLoads = [];
    m.elementLoads = [{ elementId: 1, kind: 'uniform', coordSys: 'global', axis: 'y', w1: -2, w2: -2 }];
    const a = analyze2D(m);
    rel(a.reactions[1], 2 * 5, 1e-9); // w per unit member length × L = 10
    expect(Math.abs(a.reactions[0])).toBeLessThan(1e-9);
    expect(a.globalEquilibrium!.ok).toBe(true);
  });
  it('triangular load on a fixed-fixed beam gives the textbook fixed-end moments', () => {
    const m = emptyModel('2D', 'kN-m');
    m.nodes = [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 4, y: 0, z: 0 }];
    m.materials = [{ id: 1, name: 'm', E: 2e8 }];
    m.sections = [{ id: 1, name: 's', A: 0.01, Iz: 1e-4, Iy: 1e-4, J: 1 }];
    m.elements = [el(1, 1, 2)];
    m.supports = [makeSupport('2D', 1, 'fixed'), makeSupport('2D', 2, 'fixed')];
    m.elementLoads = [{ elementId: 1, kind: 'linear', coordSys: 'local', axis: 'y', w1: 0, w2: -6 }];
    const a = analyze2D(m);
    const w = 6, L = 4;
    rel(a.reactions[2], (w * L * L) / 30, 1e-9);
    rel(a.reactions[5], -(w * L * L) / 20, 1e-9);
    rel(a.reactions[1], (3 * w * L) / 20, 1e-9);
    rel(a.reactions[4], (7 * w * L) / 20, 1e-9);
  });
  it('a ground spring at the tip: d = P / (k + 3EI/L³)', () => {
    const m = cantilever2D(2, 10);
    m.springs = [{ nodeId: 2, dof: 1, k: 5000 }];
    const a = analyze2D(m);
    rel(a.d[4], -10 / (5000 + (3 * 2e4) / 8), 1e-9);
    expect(a.globalEquilibrium!.ok).toBe(true);
  });
  it('support settlement moves K_fc·d_c to the right-hand side', () => {
    const m = emptyModel('2D', 'kN-m');
    m.nodes = [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 2, y: 0, z: 0 }];
    m.materials = [{ id: 1, name: 'm', E: 2e8 }];
    m.sections = [{ id: 1, name: 's', A: 0.01, Iz: 1e-4, Iy: 1e-4, J: 1 }];
    m.elements = [el(1, 1, 2)];
    m.supports = [makeSupport('2D', 1, 'fixed'), makeSupport('2D', 2, 'fixed')];
    m.supports[1].prescribed = [0, -0.01, 0];
    const a = analyze2D(m);
    rel(a.reactions[4], (12 * 2e4 * -0.01) / 8, 1e-9);
    rel(a.reactions[1], -(12 * 2e4 * -0.01) / 8, 1e-9);
    // free-DOF case: cantilever with a prescribed tip rotation of the supported node
    const m2 = cantilever2D(2, 0);
    m2.nodalLoads = [];
    m2.supports.push({ nodeId: 2, fixed: [false, true, true], prescribed: [0, 0, 0.002] });
    const a2 = analyze2D(m2);
    expect(a2.ok).toBe(true);
    rel(a2.reactions[a2.dofClass.constrained.indexOf(5)], (4 * 2e4 * 0.002) / 2, 1e-9);
    expect(Array.from(a2.rhs).length).toBe(a2.Ff.length);
  });
  it('pin-ended bar (both end moments released): removes both rotations and gives PL/EA', () => {
    const m = emptyModel('2D', 'kN-m');
    m.nodes = [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 5, y: 0, z: 0 }];
    m.materials = [{ id: 1, name: 'm', E: 2e8 }];
    m.sections = [{ id: 1, name: 's', A: 0.01, Iz: 1e-4, Iy: 1e-4, J: 1 }];
    m.elements = [el(1, 1, 2, [true, true])];
    m.supports = [makeSupport('2D', 1, 'pinned'), makeSupport('2D', 2, 'roller-x')];
    m.nodalLoads = [{ nodeId: 2, dof: 0, value: 100 }];
    const a = analyze2D(m);
    expect(a.ok).toBe(true);
    expect(a.dofClass.removed.map((r) => r.dof + 1)).toEqual([3, 6]);
    rel(a.d[3], (100 * 5) / (2e8 * 0.01), 1e-9);
  });
});

describe('stability detection', () => {
  const base = () => {
    const m = emptyModel('2D', 'kN-m');
    m.materials = [{ id: 1, name: 'm', E: 2e8 }];
    m.sections = [{ id: 1, name: 's', A: 0.01, Iz: 1e-4, Iy: 1e-4, J: 1 }];
    return m;
  };
  it('a portal with both beam-column joints hinged and pinned bases is a four-bar mechanism', () => {
    const m = base();
    m.nodes = [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 3, z: 0 }, { id: 3, x: 4, y: 3, z: 0 }, { id: 4, x: 4, y: 0, z: 0 }];
    m.elements = [el(1, 1, 2, [false, true]), el(2, 2, 3, [true, true]), el(3, 3, 4, [true, false])];
    m.supports = [makeSupport('2D', 1, 'pinned'), makeSupport('2D', 4, 'pinned')];
    m.nodalLoads = [{ nodeId: 2, dof: 0, value: 5 }];
    const a = analyze2D(m);
    expect(a.ok).toBe(false);
    const msg = a.issues.filter((i) => i.code === 'STRUCTURE_UNSTABLE' || i.code === 'LOAD_ON_UNRESISTED_DOF');
    expect(msg.length).toBeGreaterThan(0);
    expect(msg[0].message).toMatch(/d\d[xy]|φ\d/);
  });
  it('a beam on y-only restraints can slide in x, and the message names that DOF', () => {
    const m = base();
    m.nodes = [0, 2, 4].map((x, i) => ({ id: i + 1, x, y: 0, z: 0 }));
    m.elements = [el(1, 1, 2), el(2, 2, 3)];
    m.supports = [1, 2, 3].map((n) => makeSupport('2D', n, 'roller-x'));
    const a = analyze2D(m);
    expect(a.ok).toBe(false);
    const issue = a.issues.find((i) => i.code === 'STRUCTURE_UNSTABLE')!;
    expect(issue.message).toMatch(/can move freely in DOF d\dx \(node \d, x-translation\)/);
    expect(issue.message).toMatch(/add a support or check releases/);
  });
  it('too few supports is caught before solving', () => {
    const m = cantilever2D();
    m.supports = [makeSupport('2D', 1, 'pinned')];
    const a = analyze2D(m);
    expect(a.ok).toBe(false);
    expect(a.issues.some((i) => i.code === 'TOO_FEW_RESTRAINTS')).toBe(true);
  });
  it('rotation invariance: rotating Example A by 30° rotates the displacements', () => {
    const base = analyze2D(exampleA());
    const m = exampleA();
    const th = (30 * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    m.nodes = m.nodes.map((n) => ({ ...n, x: c * n.x - s * n.y, y: s * n.x + c * n.y }));
    m.nodalLoads = [
      { nodeId: 2, dof: 0, value: 10000 * c },
      { nodeId: 2, dof: 1, value: 10000 * s },
      { nodeId: 3, dof: 2, value: 5000 },
    ];
    const r = analyze2D(m);
    for (const n of [2, 3]) {
      const ux = base.d[(n - 1) * 3], uy = base.d[(n - 1) * 3 + 1];
      rel(r.d[(n - 1) * 3], c * ux - s * uy, 1e-8);
      rel(r.d[(n - 1) * 3 + 1], s * ux + c * uy, 1e-8);
      rel(r.d[(n - 1) * 3 + 2], base.d[(n - 1) * 3 + 2], 1e-8);
    }
  });
});

describe('determinism and scale', () => {
  it('same model in → identical results out', () => {
    const s1 = JSON.stringify(analyze2D(exampleC()));
    const s2 = JSON.stringify(analyze2D(exampleC()));
    expect(s1).toBe(s2);
  });
  it('a 50-node / 100-element frame solves and is in equilibrium', () => {
    const m = emptyModel('2D', 'kN-m');
    m.materials = [{ id: 1, name: 'm', E: 2e8 }];
    m.sections = [{ id: 1, name: 's', A: 0.02, Iz: 4e-4, Iy: 4e-4, J: 1 }];
    const cols = 10, rows = 5;
    const id = (c: number, r: number) => r * cols + c + 1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) m.nodes.push({ id: id(c, r), x: c * 4, y: r * 3, z: 0 });
    let e = 1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols - 1; c++) m.elements.push(el(e++, id(c, r), id(c + 1, r)));
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) m.elements.push(el(e++, id(c, r), id(c, r + 1)));
    for (let c = 0; c < 15; c++) m.elements.push(el(e++, id(c % (cols - 1), Math.floor(c / (cols - 1))), id((c % (cols - 1)) + 1, Math.floor(c / (cols - 1)) + 1)));
    expect(m.nodes).toHaveLength(50);
    expect(m.elements).toHaveLength(100);
    for (let c = 0; c < cols; c++) m.supports.push(makeSupport('2D', id(c, 0), 'fixed'));
    m.nodalLoads = [{ nodeId: id(cols - 1, rows - 1), dof: 0, value: 50 }, { nodeId: id(0, rows - 1), dof: 1, value: -30 }];
    const t0 = performance.now();
    const a = analyze2D(m);
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(a.ok).toBe(true);
    expect(a.solve!.method).toBe('cholesky');
    expect(a.globalEquilibrium!.ok).toBe(true);
    a.elements.forEach((x) => expect(x.equilibrium.ok).toBe(true));
  });
});
