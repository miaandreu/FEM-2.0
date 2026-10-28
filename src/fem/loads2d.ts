import type { ElementLoad } from '../model';
import type { Geometry2D } from './element2d';

/**
 * Element distributed loads (force per unit member length) → equivalent nodal loads.
 *
 * Local load components are w_x (axial) and w_y (transverse), each varying linearly
 * from value 1 at node i to value 2 at node j. The EQUIVALENT NODAL LOAD vector in
 * local coordinates [f1x, f1y, m1, f2x, f2y, m2] is
 *
 *   f1x = L(2 wx1 + wx2)/6          f2x = L(wx1 + 2 wx2)/6
 *   f1y = L(7 wy1 + 3 wy2)/20       f2y = L(3 wy1 + 7 wy2)/20
 *   m1  = L²(3 wy1 + 2 wy2)/60      m2  = −L²(2 wy1 + 3 wy2)/60
 *
 * (uniform wy: wL/2, wL²/12, wL/2, −wL²/12). The clamped-end reactions ("fixed-end
 * forces" in Logan's sense) are the NEGATIVE of these, and the member end forces are
 *   f̂ = k̂ T d − F_eq   (= k̂ T d + clamped-end reactions).
 */
export interface LocalLoad2D {
  wx1: number;
  wx2: number;
  wy1: number;
  wy2: number;
}

/** Resolve a user load into local x̂/ŷ components (global loads act per unit member length). */
export function localLoadComponents(load: ElementLoad, g: Pick<Geometry2D, 'C' | 'S'>): LocalLoad2D {
  const w1 = load.w1;
  const w2 = load.kind === 'uniform' ? load.w1 : load.w2;
  if (load.coordSys === 'local') {
    return load.axis === 'x' ? { wx1: w1, wx2: w2, wy1: 0, wy2: 0 } : { wx1: 0, wx2: 0, wy1: w1, wy2: w2 };
  }
  const { C, S } = g;
  if (load.axis === 'x') return { wx1: C * w1, wx2: C * w2, wy1: -S * w1, wy2: -S * w2 };
  return { wx1: S * w1, wx2: S * w2, wy1: C * w1, wy2: C * w2 };
}

export function equivalentNodalLoadLocal(w: LocalLoad2D, L: number): Float64Array {
  return Float64Array.from([
    (L * (2 * w.wx1 + w.wx2)) / 6,
    (L * (7 * w.wy1 + 3 * w.wy2)) / 20,
    (L * L * (3 * w.wy1 + 2 * w.wy2)) / 60,
    (L * (w.wx1 + 2 * w.wx2)) / 6,
    (L * (3 * w.wy1 + 7 * w.wy2)) / 20,
    (-L * L * (2 * w.wy1 + 3 * w.wy2)) / 60,
  ]);
}

/** Resultant of the distributed load in local axes: forces and moment about node i (CCW +). */
export function loadResultantLocal(w: LocalLoad2D, L: number) {
  return {
    Fx: (L * (w.wx1 + w.wx2)) / 2,
    Fy: (L * (w.wy1 + w.wy2)) / 2,
    Mi: (L * L * (w.wy1 + 2 * w.wy2)) / 6,
  };
}
