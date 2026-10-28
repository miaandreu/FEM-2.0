import type { FemModel } from '../model';
import { NO_RELEASE, emptyModel, makeSupport } from '../model';

/** Small 2D cantilever: node 1 fixed at origin, element 1 to node 2 at (L, 0), tip load -P in y. */
export function cantilever2D(L = 2, P = 10): FemModel {
  const m = emptyModel('2D', 'kN-m');
  m.name = 'Cantilever';
  m.nodes = [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: L, y: 0, z: 0 },
  ];
  m.materials = [{ id: 1, name: 'Steel', E: 2e8 }];
  m.sections = [{ id: 1, name: 'S1', A: 0.01, Iz: 1e-4, Iy: 1e-4, J: 1e-5 }];
  m.elements = [{ id: 1, nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1, releaseI: { ...NO_RELEASE }, releaseJ: { ...NO_RELEASE } }];
  m.supports = [makeSupport('2D', 1, 'fixed')];
  m.nodalLoads = [{ nodeId: 2, dof: 1, value: -P }];
  return m;
}

/** Deterministic pseudo-random numbers (LCG) so tests never depend on Math.random. */
export function lcg(seed = 12345) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
