import { describe, expect, it } from 'vitest';
import { analyze3D, deformedMember3D } from './analyze3d';
import { elementMatrices3D, localStiffness3D, orientation3D, transformation3D } from './element3d';
import { equivalentNodalLoadLocal3D } from './loads3d';
import { EXAMPLE_D, exampleD, exampleE } from '../examples/examples3d';
import { NO_RELEASE, emptyModel, makeSupport, type FemElement, type FemModel } from '../model';

const rel = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(Math.abs(b), 1e-12));
const node = (id: number, x: number, y: number, z: number) => ({ id, x, y, z });
const el = (id: number, i: number, j: number, extra: Partial<FemElement> = {}): FemElement => ({
  id, nodeI: i, nodeJ: j, materialId: 1, sectionId: 1, releaseI: { ...NO_RELEASE }, releaseJ: { ...NO_RELEASE }, ...extra,
});
const base3D = (): FemModel => {
  const m = emptyModel('3D', 'kN-m');
  m.materials = [{ id: 1, name: 'm', E: 2e8, G: 8e7 }];
  m.sections = [{ id: 1, name: 's', A: 0.01, Iy: 8e-5, Iz: 4e-5, J: 2e-5 }];
  return m;
};
const dof = (n: number, k: number) => (n - 1) * 6 + k;

describe('3D orientation', () => {
  it('horizontal member, default reference Z: local ŷ = global Z, ẑ = x̂ × Z', () => {
    const o = orientation3D(node(1, 0, 0, 0), node(2, 4, 0, 0));
    expect(o.refSource).toBe('default-Z');
    expect(o.ex).toEqual([1, 0, 0]);
    expect(o.ey[2]).toBeCloseTo(1, 12);
    expect(o.ez[1]).toBeCloseTo(-1, 12);
  });
  it('vertical members use the documented fallback (reference = global X) and say so', () => {
    for (const dz of [3, -3]) {
      const o = orientation3D(node(1, 0, 0, 0), node(2, 0, 0, dz));
      expect(o.refSource).toBe('fallback-X');
      expect(o.ey[0]).toBeCloseTo(1, 12);
      expect(o.note).toMatch(/parallel to global Z/);
    }
  });
  it('λ is orthonormal and right-handed for random members, and T is orthogonal', () => {
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 10 - 5;
    for (let t = 0; t < 20; t++) {
      const o = orientation3D(node(1, r(), r(), r()), node(2, r(), r(), r()), t % 3 === 0 ? [r(), r(), r()] : undefined, t * 17);
      const P = o.lambda.mul(o.lambda.transpose());
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(P.get(i, j)).toBeCloseTo(i === j ? 1 : 0, 10);
      const [a, b, c] = [o.ex, o.ey, o.ez];
      const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
      expect(det).toBeCloseTo(1, 10);
      const T = transformation3D(o.lambda);
      const TT = T.transpose().mul(T);
      for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) expect(TT.get(i, j)).toBeCloseTo(i === j ? 1 : 0, 10);
    }
  });
  it('roll angle of 90° swaps ŷ and ẑ (up to sign)', () => {
    const a = orientation3D(node(1, 0, 0, 0), node(2, 4, 0, 0));
    const b = orientation3D(node(1, 0, 0, 0), node(2, 4, 0, 0), undefined, 90);
    for (let i = 0; i < 3; i++) {
      expect(b.ey[i]).toBeCloseTo(a.ez[i], 12);
      expect(b.ez[i]).toBeCloseTo(-a.ey[i], 12);
    }
  });
});

describe('3D element matrices', () => {
  const E = 2e8, G = 8e7, A = 0.02, Iy = 3e-4, Iz = 5e-4, J = 1e-4, L = 3.3;
  const { k, factors } = localStiffness3D(E, G, A, Iy, Iz, J, L);
  it('is symmetric with a positive diagonal', () => {
    expect(k.isSymmetric()).toBe(true);
    for (let i = 0; i < 12; i++) expect(k.get(i, i)).toBeGreaterThan(0);
  });
  it('contains the four expected blocks', () => {
    rel(k.get(0, 0), factors.EA_L, 1e-14);
    rel(k.get(3, 3), (G * J) / L, 1e-14);
    rel(k.get(1, 1), (12 * E * Iz) / L ** 3, 1e-14);
    rel(k.get(2, 2), (12 * E * Iy) / L ** 3, 1e-14);
    rel(k.get(5, 5), (4 * E * Iz) / L, 1e-14);
    rel(k.get(4, 4), (4 * E * Iy) / L, 1e-14);
  });
  it('x–z bending block has the flipped θy sign pattern', () => {
    // x–y plane: k(θz1, v1) = +6EIz/L²; x–z plane: k(θy1, w1) = −6EIy/L²
    rel(k.get(5, 1), (6 * E * Iz) / L ** 2, 1e-14);
    rel(k.get(4, 2), (-6 * E * Iy) / L ** 2, 1e-14);
    rel(k.get(4, 8), (6 * E * Iy) / L ** 2, 1e-14);
    rel(k.get(10, 2), (-6 * E * Iy) / L ** 2, 1e-14);
    rel(k.get(10, 8), (6 * E * Iy) / L ** 2, 1e-14);
    rel(k.get(4, 10), (2 * E * Iy) / L, 1e-14);
    rel(k.get(11, 7), (-6 * E * Iz) / L ** 2, 1e-14);
    rel(k.get(11, 5), (2 * E * Iz) / L, 1e-14);
  });
  it('has all six rigid-body modes in its null space (local)', () => {
    const modes = [
      [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0],
      [0, 0, -L * 0, 0, 1, 0, 0, 0, -L, 0, 1, 0], // rotation about y: w2 = −θy L
      [0, 0, 0, 0, 0, 1, 0, L, 0, 0, 0, 1], // rotation about z: v2 = θz L
    ];
    for (const m of modes) for (const f of k.mulVec(m)) expect(Math.abs(f)).toBeLessThan(1e-9 * k.maxAbs());
  });
  it('global matrix keeps the rigid-body modes for an arbitrarily oriented, rolled member', () => {
    const ni = node(1, 1, 2, 3), nj = node(2, 4, -1, 5);
    const o = orientation3D(ni, nj, [0.3, -0.2, 1], 33);
    const m = elementMatrices3D(E, G, A, Iy, Iz, J, o, []);
    expect(m.kGlobal.isSymmetric()).toBe(true);
    const w = [0.3, -0.5, 0.2], t = [1, 2, 3], p0 = [0.5, 0.5, 0.5];
    const field = (n: { x: number; y: number; z: number }) => {
      const r = [n.x - p0[0], n.y - p0[1], n.z - p0[2]];
      return [t[0] + w[1] * r[2] - w[2] * r[1], t[1] + w[2] * r[0] - w[0] * r[2], t[2] + w[0] * r[1] - w[1] * r[0], ...w];
    };
    const mode = [...field(ni), ...field(nj)];
    for (const f of m.kGlobal.mulVec(mode)) expect(Math.abs(f)).toBeLessThan(1e-8 * m.kGlobal.maxAbs());
  });
  it('end releases: torsion at one end removes torsional stiffness; at both ends zeroes it; hinge gives the propped form', () => {
    const o = orientation3D(node(1, 0, 0, 0), node(2, L, 0, 0));
    const one = elementMatrices3D(E, G, A, Iy, Iz, J, o, [3]);
    expect(one.condensation?.kStar).not.toBeNull();
    for (let j = 0; j < 12; j++) expect(Math.abs(one.kLocalUsed.get(9, j))).toBeLessThan(1e-9);
    const both = elementMatrices3D(E, G, A, Iy, Iz, J, o, [3, 9]);
    expect(both.decoupled).toBe(true);
    for (let j = 0; j < 12; j++) { expect(both.kLocalUsed.get(3, j)).toBe(0); expect(both.kLocalUsed.get(9, j)).toBe(0); }
    rel(both.kLocalUsed.get(1, 1), k.get(1, 1), 1e-14);
    const hinge = elementMatrices3D(E, G, A, Iy, Iz, J, o, [11]); // hinge about z at node j
    rel(hinge.kLocalUsed.get(1, 1), (3 * E * Iz) / L ** 3, 1e-12);
    rel(hinge.kLocalUsed.get(5, 5), (3 * E * Iz) / L, 1e-12);
    const hingeY = elementMatrices3D(E, G, A, Iy, Iz, J, o, [10]); // hinge about y at node j
    rel(hingeY.kLocalUsed.get(2, 2), (3 * E * Iy) / L ** 3, 1e-12);
    rel(hingeY.kLocalUsed.get(4, 4), (3 * E * Iy) / L, 1e-12);
  });
});

describe('3D equivalent loads', () => {
  it('uniform local z: wL/2 and ∓wL²/12 on θy (flipped relative to y)', () => {
    const L = 4, w = 3;
    const f = equivalentNodalLoadLocal3D({ wx1: 0, wx2: 0, wy1: 0, wy2: 0, wz1: w, wz2: w }, L);
    rel(f[2], (w * L) / 2, 1e-14);
    rel(f[4], (-w * L * L) / 12, 1e-14);
    rel(f[10], (w * L * L) / 12, 1e-14);
    const g = equivalentNodalLoadLocal3D({ wx1: 0, wx2: 0, wy1: w, wy2: w, wz1: 0, wz2: 0 }, L);
    rel(g[5], (w * L * L) / 12, 1e-14);
    rel(g[11], (-w * L * L) / 12, 1e-14);
  });
});

describe('3D cantilever sign checks', () => {
  const cant = (ref?: [number, number, number]) => {
    const m = base3D();
    m.nodes = [node(1, 0, 0, 0), node(2, 2, 0, 0)];
    m.elements = [el(1, 1, 2, ref ? { refVector: ref } : {})];
    m.supports = [makeSupport('3D', 1, 'fixed')];
    m.nodalLoads = [{ nodeId: 2, dof: 2, value: -10 }];
    return m;
  };
  it('default axes: vertical load bends about local z, so Iz governs', () => {
    const a = analyze3D(cant());
    rel(a.d[dof(2, 2)], (-10 * 8) / (3 * 2e8 * 4e-5), 1e-9);
  });
  it('reference vector Y: ẑ = global Z, vertical load bends about local y, so Iy governs; θy has the −dw/dx sign', () => {
    const a = analyze3D(cant([0, 1, 0]));
    rel(a.d[dof(2, 2)], (-10 * 8) / (3 * 2e8 * 8e-5), 1e-9);
    rel(a.d[dof(2, 4)], (10 * 4) / (2 * 2e8 * 8e-5), 1e-9); // θy = −w′ > 0 for a downward-deflecting tip
  });
  it('uniform load: tip deflection wL⁴/8EI in both planes', () => {
    for (const ref of [undefined, [0, 1, 0] as [number, number, number]]) {
      const m = cant(ref);
      m.nodalLoads = [];
      m.elementLoads = [{ elementId: 1, kind: 'uniform', coordSys: 'global', axis: 'z', w1: -5, w2: -5 }];
      const a = analyze3D(m);
      const I = ref ? 8e-5 : 4e-5;
      rel(a.d[dof(2, 2)], (-5 * 16) / (8 * 2e8 * I), 1e-9);
      rel(a.reactions[2], 10, 1e-9);
    }
  });
  it('axial and torsion', () => {
    const m = cant();
    m.nodalLoads = [{ nodeId: 2, dof: 0, value: 50 }, { nodeId: 2, dof: 3, value: 4 }];
    const a = analyze3D(m);
    rel(a.d[dof(2, 0)], (50 * 2) / (2e8 * 0.01), 1e-9);
    rel(a.d[dof(2, 3)], (4 * 2) / (8e7 * 2e-5), 1e-9);
  });
});

describe('Example D: L-shaped cantilever', () => {
  const { L1, L2, P, E, G, Iz, J } = EXAMPLE_D;
  const a = analyze3D(exampleD());
  it('solves cleanly', () => {
    expect(a.ok).toBe(true);
    expect(a.issues.filter((i) => i.severity !== 'info')).toEqual([]);
  });
  it('tip deflection = P L2³/3EI + P L1³/3EI + P L2² L1/GJ', () => {
    const expected = -(P * L2 ** 3) / (3 * E * Iz) - (P * L1 ** 3) / (3 * E * Iz) - (P * L2 ** 2 * L1) / (G * J);
    rel(a.d[dof(3, 2)], expected, 1e-9);
  });
  it('support reactions: Fz = P, torque about X = P·L2, bending moment about Y = −P·L1', () => {
    const R = (k: number) => a.reactions[a.dofClass.constrained.indexOf(dof(1, k))];
    rel(R(2), P, 1e-9);
    rel(R(3), P * L2, 1e-9);
    rel(R(4), -P * L1, 1e-9);
    expect(Math.abs(R(0))).toBeLessThan(1e-9);
    expect(Math.abs(R(1))).toBeLessThan(1e-9);
    expect(Math.abs(R(5))).toBeLessThan(1e-9);
  });
  it('member 1 carries torque P·L2; equilibrium holds everywhere', () => {
    rel(Math.abs(a.elements[0].endForces[3]), P * L2, 1e-9);
    a.elements.forEach((e) => expect(e.equilibrium.ok).toBe(true));
    expect(a.globalEquilibrium!.ok).toBe(true);
  });
  it('deformed shape reaches the displaced tip', () => {
    const p = deformedMember3D(a, a.elements[1], 1, 11);
    expect(p.deformed[10].z).toBeCloseTo(a.d[dof(3, 2)], 9);
    expect(p.deformed[10].x).toBeCloseTo(EXAMPLE_D.L1 + a.d[dof(3, 0)], 9);
  });
});

describe('Example E: space frame', () => {
  const a = analyze3D(exampleE());
  it('solves; vertical members use the fallback and the UI can tell', () => {
    expect(a.ok).toBe(true);
    expect(a.elements.filter((e) => e.orientation.refSource === 'fallback-X').map((e) => e.id)).toEqual([1, 2, 3, 4]);
  });
  it('satisfies global and element equilibrium to 1e-6 relative', () => {
    const g = a.globalEquilibrium!;
    expect(g.ok).toBe(true);
    const gravity = 12 * 24;
    rel(g.sumF[2], 0, 1);
    expect(Math.abs(g.sumF[0])).toBeLessThan(1e-6 * gravity);
    expect(Math.abs(g.sumF[1])).toBeLessThan(1e-6 * gravity);
    expect(Math.abs(g.sumF[2])).toBeLessThan(1e-6 * gravity);
    a.elements.forEach((e) => expect(e.equilibrium.ok).toBe(true));
  });
  it('reactions balance the applied loads', () => {
    const R = (n: number, k: number) => a.reactions[a.dofClass.constrained.indexOf(dof(n, k))];
    let fx = 0, fy = 0, fz = 0;
    for (const n of [1, 2, 3, 4]) { fx += R(n, 0); fy += R(n, 1); fz += R(n, 2); }
    rel(fx, -40, 1e-9); // 20 at node 5 + 20 at node 7
    rel(fy, -10, 1e-9);
    rel(fz, 12 * 24, 1e-9);
  });
  it('symmetry: gravity-only frame has equal base reactions and mirrored displacements', () => {
    const s = analyze3D(exampleE({ lateral: false }));
    expect(s.ok).toBe(true);
    const R = (n: number, k: number) => s.reactions[s.dofClass.constrained.indexOf(dof(n, k))];
    for (const n of [1, 2, 3, 4]) rel(R(n, 2), 72, 1e-9);
    const u = (n: number, k: number) => s.d[dof(n, k)];
    for (const n of [5, 6, 7, 8]) rel(u(n, 2), u(5, 2), 1e-9);
    expect(Math.abs(u(5, 0) + u(6, 0))).toBeLessThan(1e-12);
    expect(Math.abs(u(5, 1) + u(8, 1))).toBeLessThan(1e-12);
    rel(u(9, 2), u(10, 2), 1e-9);
  });
});

describe('3D hinge beam equals the 2D example B result', () => {
  it('P4-41 geometry in the x–z plane', () => {
    const m = base3D();
    m.sections[0] = { id: 1, name: 's', A: 0.01, Iy: 1e-4, Iz: 1e-4, J: 1e-4 };
    m.nodes = [node(1, 0, 0, 0), node(2, 2, 0, 0), node(3, 4, 0, 0)];
    m.elements = [el(1, 1, 2), el(2, 2, 3, { releaseI: { rx: false, ry: false, rz: true } })];
    m.supports = [makeSupport('3D', 1, 'fixed'), { nodeId: 3, fixed: [false, true, true, false, false, false], prescribed: new Array<number>(6).fill(0) }];
    m.nodalLoads = [{ nodeId: 2, dof: 2, value: -5 }];
    const a = analyze3D(m);
    expect(a.ok).toBe(true);
    const R = (n: number, k: number) => a.reactions[a.dofClass.constrained.indexOf(dof(n, k))];
    rel(R(1, 2), 5, 1e-9);
    rel(R(1, 4), -10, 1e-9);
    expect(Math.abs(R(3, 2))).toBeLessThan(1e-9);
    rel(a.d[dof(2, 2)], -(5 * 8) / (3 * 2e8 * 1e-4), 1e-9);
  });
  it('a node where every element hinges its local-z rotation is removed from the solve with an explanation', () => {
    const m = base3D();
    m.nodes = [node(1, 0, 0, 0), node(2, 2, 0, 0), node(3, 4, 0, 0)];
    m.elements = [el(1, 1, 2, { releaseJ: { rx: false, ry: false, rz: true } }), el(2, 2, 3, { releaseI: { rx: false, ry: false, rz: true } })];
    m.supports = [makeSupport('3D', 1, 'fixed'), makeSupport('3D', 3, 'fixed')];
    m.nodalLoads = [{ nodeId: 2, dof: 2, value: -5 }];
    const a = analyze3D(m);
    expect(a.ok).toBe(true);
    // Default axes: local ẑ = −global Y, so a hinge about local z is a rotation about global Y (node 2: DOF 11).
    expect(a.dofClass.removed.map((r) => r.dof + 1)).toEqual([dof(2, 4) + 1]);
    expect(a.dofClass.removed[0].text).toMatch(/releases/);
    a.elements.forEach((e) => expect(e.equilibrium.ok).toBe(true));
  });
});

describe('inclined hinges (axis is not a global axis)', () => {
  const build = (angleDeg: number): FemModel => {
    const m = base3D();
    const c = Math.cos((angleDeg * Math.PI) / 180), s = Math.sin((angleDeg * Math.PI) / 180);
    m.nodes = [node(1, 0, 0, 0), node(2, 2 * c, 2 * s, 0), node(3, 4 * c, 4 * s, 0)];
    m.elements = [el(1, 1, 2, { releaseJ: { rx: false, ry: false, rz: true } }), el(2, 2, 3, { releaseI: { rx: false, ry: false, rz: true } })];
    m.supports = [makeSupport('3D', 1, 'fixed'), makeSupport('3D', 3, 'fixed')];
    m.nodalLoads = [{ nodeId: 2, dof: 2, value: -5 }];
    return m;
  };
  it('a hinge about an inclined axis is detected as a harmless zero-stiffness rotation and removed', () => {
    const a = analyze3D(build(45));
    expect(a.ok).toBe(true);
    expect(a.dofClass.removed).toHaveLength(1);
    expect(a.dofClass.removed[0].text).toMatch(/not a global axis/);
    a.elements.forEach((e) => expect(e.equilibrium.ok).toBe(true));
    expect(a.globalEquilibrium!.ok).toBe(true);
  });
  it('gives the same vertical deflection and reactions as the axis-aligned version', () => {
    const a0 = analyze3D(build(0));
    const a45 = analyze3D(build(45));
    rel(a45.d[dof(2, 2)], a0.d[dof(2, 2)], 1e-9);
    const R = (a: typeof a0, n: number, k: number) => a.reactions[a.dofClass.constrained.indexOf(dof(n, k))];
    rel(R(a45, 1, 2), R(a0, 1, 2), 1e-9);
    rel(R(a45, 3, 2), R(a0, 3, 2), 1e-9);
  });
  it('a load pushing on the unresisted rotation is reported, not silently dropped', () => {
    const m = build(45);
    m.nodalLoads = [{ nodeId: 2, dof: 3, value: 1 }, { nodeId: 2, dof: 4, value: -1 }]; // a moment along the hinge axis (1,−1,0)/√2
    const a = analyze3D(m);
    expect(a.ok).toBe(false);
  });
});

describe('3D stability detection', () => {
  it('a member pinned at both ends can spin about its own axis; the message names the rotation DOF', () => {
    const m = base3D();
    m.nodes = [node(1, 0, 0, 0), node(2, 3, 0, 0)];
    m.elements = [el(1, 1, 2)];
    m.supports = [makeSupport('3D', 1, 'pinned'), makeSupport('3D', 2, 'pinned')];
    m.nodalLoads = [{ nodeId: 2, dof: 2, value: -1 }];
    const a = analyze3D(m);
    expect(a.ok).toBe(false);
    const msg = a.issues.find((i) => i.code === 'STRUCTURE_UNSTABLE')!.message;
    expect(msg).toMatch(/can move freely in DOF φ\dx \(node \d, x-rotation\)/);
    expect(msg).toMatch(/add a support or check releases/);
  });
  it('too few restraints is caught before solving', () => {
    const m = base3D();
    m.nodes = [node(1, 0, 0, 0), node(2, 3, 0, 0)];
    m.elements = [el(1, 1, 2)];
    m.supports = [makeSupport('3D', 1, 'pinned')];
    const a = analyze3D(m);
    expect(a.ok).toBe(false);
    expect(a.issues.some((i) => i.code === 'TOO_FEW_RESTRAINTS')).toBe(true);
  });
  it('a fully hinged chain is a mechanism even with a fixed base', () => {
    const m = base3D();
    const all = { rx: true, ry: true, rz: true };
    m.nodes = [node(1, 0, 0, 0), node(2, 3, 0, 0), node(3, 6, 0, 0)];
    m.elements = [el(1, 1, 2), el(2, 2, 3, { releaseI: all, releaseJ: all })];
    m.supports = [makeSupport('3D', 1, 'fixed')];
    m.nodalLoads = [{ nodeId: 3, dof: 2, value: -1 }];
    const a = analyze3D(m);
    expect(a.ok).toBe(false);
    expect(a.issues.some((i) => i.severity === 'error')).toBe(true);
  });
});

describe('3D rotation invariance and determinism', () => {
  it('rotating an isotropic-section frame rotates the displacements and rotations', () => {
    const build = (): FemModel => {
      const m = base3D();
      m.sections[0] = { id: 1, name: 's', A: 0.01, Iy: 6e-5, Iz: 6e-5, J: 1e-4 };
      m.nodes = [node(1, 0, 0, 0), node(2, 3, 0, 0), node(3, 3, 2, 0), node(4, 3, 0, -2)];
      m.elements = [el(1, 1, 2), el(2, 2, 3), el(3, 2, 4)];
      m.supports = [makeSupport('3D', 1, 'fixed')];
      m.nodalLoads = [{ nodeId: 3, dof: 2, value: -10 }, { nodeId: 4, dof: 0, value: 4 }, { nodeId: 4, dof: 4, value: 2 }];
      return m;
    };
    const A0 = analyze3D(build());
    // rotation about axis (1,2,2)/3 by 0.7 rad (Rodrigues)
    const ax = [1 / 3, 2 / 3, 2 / 3], th = 0.7, c = Math.cos(th), s = Math.sin(th);
    const R = [0, 1, 2].map((i) => [0, 1, 2].map((j) => c * (i === j ? 1 : 0) + (1 - c) * ax[i] * ax[j] + s * [[0, -ax[2], ax[1]], [ax[2], 0, -ax[0]], [-ax[1], ax[0], 0]][i][j]));
    const rot = (v: number[]) => R.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
    const m = build();
    m.nodes = m.nodes.map((n) => { const [x, y, z] = rot([n.x, n.y, n.z]); return { ...n, x, y, z }; });
    // loads: forces at nodes 3,4 are vectors; moment at node 4 (about y) rotates too
    const f3 = rot([0, 0, -10]), f4 = rot([4, 0, 0]), mm4 = rot([0, 2, 0]);
    m.nodalLoads = [
      ...[0, 1, 2].map((k) => ({ nodeId: 3, dof: k, value: f3[k] })),
      ...[0, 1, 2].map((k) => ({ nodeId: 4, dof: k, value: f4[k] })),
      ...[0, 1, 2].map((k) => ({ nodeId: 4, dof: 3 + k, value: mm4[k] })),
    ];
    const A1 = analyze3D(m);
    expect(A0.ok && A1.ok).toBe(true);
    for (const n of [2, 3, 4]) {
      const t0 = rot([A0.d[dof(n, 0)], A0.d[dof(n, 1)], A0.d[dof(n, 2)]]);
      const r0 = rot([A0.d[dof(n, 3)], A0.d[dof(n, 4)], A0.d[dof(n, 5)]]);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(A1.d[dof(n, k)] - t0[k])).toBeLessThan(1e-9 * Math.max(1e-6, Math.abs(t0[k]), 1e-3));
        expect(Math.abs(A1.d[dof(n, 3 + k)] - r0[k])).toBeLessThan(1e-9 * Math.max(1e-6, Math.abs(r0[k]), 1e-3));
      }
    }
  });
  it('same model in → identical results out', () => {
    expect(JSON.stringify(analyze3D(exampleE()))).toBe(JSON.stringify(analyze3D(exampleE())));
  });
});

describe('3D scale', () => {
  it('a 50-node / 100-element space grid solves quickly and is in equilibrium', () => {
    const m = base3D();
    const cols = 10, rows = 5;
    const id = (c: number, r: number) => r * cols + c + 1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) m.nodes.push(node(id(c, r), c * 4, r * 3, (c + r) % 2));
    let e = 1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols - 1; c++) m.elements.push(el(e++, id(c, r), id(c + 1, r)));
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) m.elements.push(el(e++, id(c, r), id(c, r + 1)));
    for (let c = 0; c < 15; c++) m.elements.push(el(e++, id(c % (cols - 1), Math.floor(c / (cols - 1))), id((c % (cols - 1)) + 1, Math.floor(c / (cols - 1)) + 1)));
    expect(m.nodes).toHaveLength(50);
    expect(m.elements).toHaveLength(100);
    for (let r = 0; r < rows; r++) m.supports.push(makeSupport('3D', id(0, r), 'fixed'));
    m.nodalLoads = [{ nodeId: id(cols - 1, rows - 1), dof: 2, value: -50 }, { nodeId: id(cols - 1, 0), dof: 1, value: 20 }];
    const t0 = performance.now();
    const a = analyze3D(m);
    expect(performance.now() - t0).toBeLessThan(8000);
    expect(a.ok).toBe(true);
    expect(a.solve!.method).toBe('cholesky');
    expect(a.globalEquilibrium!.ok).toBe(true);
    a.elements.forEach((x) => expect(x.equilibrium.ok).toBe(true));
  });
});
