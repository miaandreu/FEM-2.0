import { NO_RELEASE, emptyModel, makeSupport, type FemElement, type FemModel } from '../model';

const el = (id: number, nodeI: number, nodeJ: number, extra: Partial<FemElement> = {}): FemElement => ({
  id, nodeI, nodeJ, materialId: 1, sectionId: 1, releaseI: { ...NO_RELEASE }, releaseJ: { ...NO_RELEASE }, ...extra,
});

/** Parameters of Example D, exported so tests can compare with the closed-form answer. */
export const EXAMPLE_D = { L1: 3, L2: 2, P: 10, E: 2e8, G: 8e7, Iy: 8e-5, Iz: 4e-5, A: 0.01, J: 2e-5 };

/**
 * Example D: L-shaped cantilever. Member 1 along +X from a fixed support at the origin, member 2 along +Y;
 * tip load P in −Z. Iy ≠ Iz on purpose: both members are horizontal, so local ŷ = global Z and the
 * vertical bending is governed by Iz (see the orientation rule). kN, m.
 */
export function exampleD(): FemModel {
  const { L1, L2, P, E, G, Iy, Iz, A, J } = EXAMPLE_D;
  const m = emptyModel('3D', 'kN-m');
  m.name = 'D: 3D L-shaped cantilever';
  m.nodes = [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: L1, y: 0, z: 0 },
    { id: 3, x: L1, y: L2, z: 0 },
  ];
  m.materials = [{ id: 1, name: 'E = 200 GPa, G = 80 GPa', E, G }];
  m.sections = [{ id: 1, name: 'A, Iy, Iz, J', A, Iy, Iz, J }];
  m.elements = [el(1, 1, 2), el(2, 2, 3)];
  m.supports = [makeSupport('3D', 1, 'fixed')];
  m.nodalLoads = [{ nodeId: 3, dof: 2, value: -P }];
  return m;
}

/**
 * Example E: space frame. Four columns (vertical members, exercising the orientation fallback) carry a roof grid of
 * four edge beams plus one interior beam, with gravity as a distributed load and lateral loads at the roof. kN, m.
 * Nodes 1–4 are the fixed column bases; 5–8 the roof corners; 9 and 10 the midpoints of the long edges.
 */
export function exampleE(opts: { lateral?: boolean } = {}): FemModel {
  const lateral = opts.lateral ?? true;
  const H = 3, a = 6, b = 4;
  const m = emptyModel('3D', 'kN-m');
  m.name = lateral ? 'E: 3D space frame (portal with roof beams)' : 'E: space frame, gravity only (symmetric)';
  m.nodes = [
    [0, 0, 0], [a, 0, 0], [a, b, 0], [0, b, 0],
    [0, 0, H], [a, 0, H], [a, b, H], [0, b, H],
    [a / 2, 0, H], [a / 2, b, H],
  ].map(([x, y, z], i) => ({ id: i + 1, x, y, z }));
  m.materials = [{ id: 1, name: 'Steel', E: 2e8, nu: 0.3 }];
  m.sections = [
    { id: 1, name: 'Column', A: 0.012, Iy: 1.6e-4, Iz: 1.6e-4, J: 2.5e-4 },
    { id: 2, name: 'Beam', A: 0.008, Iy: 6e-5, Iz: 1.2e-4, J: 1.5e-5 },
  ];
  // columns 1–4 (bottom → top), roof edge beams (split at midpoints on the long edges), interior beam 9–10
  const beams: [number, number][] = [[5, 9], [9, 6], [6, 7], [7, 10], [10, 8], [8, 5], [9, 10]];
  m.elements = [
    el(1, 1, 5), el(2, 2, 6), el(3, 3, 7), el(4, 4, 8),
    ...beams.map(([i, j], k) => el(5 + k, i, j, { sectionId: 2 })),
  ];
  m.supports = [1, 2, 3, 4].map((n) => makeSupport('3D', n, 'fixed'));
  m.elementLoads = m.elements.slice(4).map((e) => ({ elementId: e.id, kind: 'uniform' as const, coordSys: 'global' as const, axis: 'z' as const, w1: -12, w2: -12 }));
  if (lateral) {
    m.nodalLoads = [
      { nodeId: 5, dof: 0, value: 20 },
      { nodeId: 6, dof: 1, value: 10 },
      { nodeId: 7, dof: 0, value: 20 },
    ];
  }
  return m;
}
