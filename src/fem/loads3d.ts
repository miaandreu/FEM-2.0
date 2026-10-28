import type { ElementLoad } from '../model';
import type { Orientation3D } from './element3d';

/**
 * 3D distributed loads → equivalent nodal loads, local order
 * [f1x f1y f1z m1x m1y m1z f2x f2y f2z m2x m2y m2z].
 *
 *   axial        f1x = L(2wx1+wx2)/6                f2x = L(wx1+2wx2)/6
 *   local y      f1y = L(7wy1+3wy2)/20              f2y = L(3wy1+7wy2)/20
 *                m1z = L²(3wy1+2wy2)/60             m2z = −L²(2wy1+3wy2)/60
 *   local z      f1z, f2z as for y                  m1y = −L²(3wz1+2wz2)/60   m2y = +L²(2wz1+3wz2)/60
 * (the y-moments flip sign because θy = −dw/dx).
 */
export interface LocalLoad3D {
  wx1: number; wx2: number;
  wy1: number; wy2: number;
  wz1: number; wz2: number;
}

export function localLoadComponents3D(load: ElementLoad, o: Orientation3D): LocalLoad3D {
  const w1 = load.w1;
  const w2 = load.kind === 'uniform' ? load.w1 : load.w2;
  const idx = load.axis === 'x' ? 0 : load.axis === 'y' ? 1 : 2;
  const out: LocalLoad3D = { wx1: 0, wx2: 0, wy1: 0, wy2: 0, wz1: 0, wz2: 0 };
  if (load.coordSys === 'local') {
    const k = (['x', 'y', 'z'] as const)[idx];
    out[`w${k}1`] = w1;
    out[`w${k}2`] = w2;
    return out;
  }
  // global direction e_idx: local components are the rows of λ applied to it
  const rows = [o.ex, o.ey, o.ez];
  (['x', 'y', 'z'] as const).forEach((k, r) => {
    out[`w${k}1`] = rows[r][idx] * w1;
    out[`w${k}2`] = rows[r][idx] * w2;
  });
  return out;
}

export function equivalentNodalLoadLocal3D(w: LocalLoad3D, L: number): Float64Array {
  return Float64Array.from([
    (L * (2 * w.wx1 + w.wx2)) / 6,
    (L * (7 * w.wy1 + 3 * w.wy2)) / 20,
    (L * (7 * w.wz1 + 3 * w.wz2)) / 20,
    0,
    (-L * L * (3 * w.wz1 + 2 * w.wz2)) / 60,
    (L * L * (3 * w.wy1 + 2 * w.wy2)) / 60,
    (L * (w.wx1 + 2 * w.wx2)) / 6,
    (L * (3 * w.wy1 + 7 * w.wy2)) / 20,
    (L * (3 * w.wz1 + 7 * w.wz2)) / 20,
    0,
    (L * L * (2 * w.wz1 + 3 * w.wz2)) / 60,
    (-L * L * (2 * w.wy1 + 3 * w.wy2)) / 60,
  ]);
}

/** Resultant of the load in local axes: force vector and moment vector about node i. */
export function loadResultantLocal3D(w: LocalLoad3D, L: number) {
  return {
    F: [(L * (w.wx1 + w.wx2)) / 2, (L * (w.wy1 + w.wy2)) / 2, (L * (w.wz1 + w.wz2)) / 2] as [number, number, number],
    // r × F with r = (x,0,0): (0, −x Fz, x Fy)
    M: [0, (-L * L * (w.wz1 + 2 * w.wz2)) / 6, (L * L * (w.wy1 + 2 * w.wy2)) / 6] as [number, number, number],
  };
}
