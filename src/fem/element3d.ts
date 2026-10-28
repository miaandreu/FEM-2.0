import { Matrix, condense, type CondensationResult } from '../linalg';
import type { EndRelease, FemNode } from '../model';

/**
 * 3D frame element: 6 DOF per node (u, v, w, θx, θy, θz), 12×12 stiffness.
 * Local DOF order: [u1 v1 w1 θx1 θy1 θz1 | u2 v2 w2 θx2 θy2 θz2].
 *
 * Four decoupled blocks (each returned separately so the UI can colour them):
 *   axial    EA/L          DOFs u1,u2
 *   torsion  GJ/L          DOFs θx1,θx2
 *   bend-xy  EIz/L³ ...    DOFs v1,θz1,v2,θz2   (bending about local z, in the x–y plane)
 *   bend-xz  EIy/L³ ...    DOFs w1,θy1,w2,θy2   (bending about local y, in the x–z plane)
 * The x–z block has the SAME magnitudes as x–y but the θy couplings change sign,
 * because a positive rotation about y tilts the beam the opposite way to w′: θy = −dw/dx.
 */

export interface Orientation3D {
  L: number;
  dx: number;
  dy: number;
  dz: number;
  /** Local axes as unit vectors in global coordinates. */
  ex: [number, number, number];
  ey: [number, number, number];
  ez: [number, number, number];
  /** 3×3 direction-cosine matrix, rows = ex, ey, ez. */
  lambda: Matrix;
  /** Reference vector that was actually used (before roll). */
  refUsed: [number, number, number];
  refSource: 'user' | 'default-Z' | 'fallback-X';
  rollDeg: number;
  /** Student-facing explanation of how the axes were chosen. */
  note: string;
}

const cross = (a: number[], b: number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: number[]): [number, number, number] => {
  const n = norm(a);
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** A member is "vertical" (for the default reference) if x̂ is within this of ±Z. */
const PARALLEL_TOL = 1e-6;

/**
 * Orientation rule (documented in DECISIONS.md):
 *  - x̂ runs from node i to node j.
 *  - The reference vector r defines the local x–y plane: ẑ = x̂ × r (normalized), ŷ = ẑ × x̂, so ŷ lies on the
 *    same side as r.  Default r = global Z.
 *  - If the member is parallel to global Z (vertical) and no vector was given, r = global X instead.
 *  - A roll angle β then rotates ŷ, ẑ about x̂ (right-hand rule).
 */
export function orientation3D(ni: FemNode, nj: FemNode, refVector?: [number, number, number], rollDeg = 0): Orientation3D {
  const dx = nj.x - ni.x, dy = nj.y - ni.y, dz = nj.z - ni.z;
  const L = Math.hypot(dx, dy, dz);
  const ex = unit([dx, dy, dz]);
  let ref: [number, number, number];
  let refSource: Orientation3D['refSource'];
  let note: string;
  if (refVector) {
    ref = refVector;
    refSource = 'user';
    note = `Reference vector (${ref.join(', ')}) was given by the user: it defines the local x–y plane.`;
  } else if (norm(cross(ex, [0, 0, 1])) > PARALLEL_TOL) {
    ref = [0, 0, 1];
    refSource = 'default-Z';
    note = 'Default reference vector = global Z, so local ŷ points “up” (toward +Z) and ẑ = x̂ × Z.';
  } else {
    ref = [1, 0, 0];
    refSource = 'fallback-X';
    note = 'This member is parallel to global Z, so the default reference (Z) cannot define a plane. Fallback used: reference vector = global X, so local ŷ = global X for a column (and ẑ = x̂ × X).';
  }
  const ez0 = unit(cross(ex, ref));
  const ey0 = cross(ez0, ex);
  const b = (rollDeg * Math.PI) / 180;
  const c = Math.cos(b), s = Math.sin(b);
  const ey: [number, number, number] = [c * ey0[0] + s * ez0[0], c * ey0[1] + s * ez0[1], c * ey0[2] + s * ez0[2]];
  const ez: [number, number, number] = [-s * ey0[0] + c * ez0[0], -s * ey0[1] + c * ez0[1], -s * ey0[2] + c * ez0[2]];
  if (rollDeg) note += ` Then rolled by ${rollDeg}° about x̂.`;
  return { L, dx, dy, dz, ex, ey, ez, lambda: Matrix.fromRows([ex, ey, ez]), refUsed: ref, refSource, rollDeg, note };
}

/** T = diag(λ, λ, λ, λ): rotates the four 3-vectors (u, θ at node i; u, θ at node j) together. */
export function transformation3D(lambda: Matrix): Matrix {
  const T = Matrix.zeros(12);
  for (let b = 0; b < 4; b++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) T.set(3 * b + i, 3 * b + j, lambda.get(i, j));
  return T;
}

export interface Factors3D {
  EA_L: number;
  GJ_L: number;
  EIz_L3: number;
  EIy_L3: number;
}

export interface LocalStiffness3D {
  k: Matrix;
  axial: Matrix;
  torsion: Matrix;
  bendXY: Matrix;
  bendXZ: Matrix;
  factors: Factors3D;
}

export function localStiffness3D(E: number, G: number, A: number, Iy: number, Iz: number, J: number, L: number): LocalStiffness3D {
  const make = (fill: (m: Matrix, set: (i: number, j: number, v: number) => void) => void) => {
    const m = Matrix.zeros(12);
    fill(m, (i, j, v) => {
      m.set(i, j, v);
      if (i !== j) m.set(j, i, v);
    });
    return m;
  };
  const EA_L = (E * A) / L;
  const GJ_L = (G * J) / L;
  const EIz_L3 = (E * Iz) / L ** 3;
  const EIy_L3 = (E * Iy) / L ** 3;
  const axial = make((_, s) => { s(0, 0, EA_L); s(6, 6, EA_L); s(0, 6, -EA_L); });
  const torsion = make((_, s) => { s(3, 3, GJ_L); s(9, 9, GJ_L); s(3, 9, -GJ_L); });
  const B = [
    [12, 6 * L, -12, 6 * L],
    [6 * L, 4 * L * L, -6 * L, 2 * L * L],
    [-12, -6 * L, 12, -6 * L],
    [6 * L, 2 * L * L, -6 * L, 4 * L * L],
  ];
  const bend = (idx: number[], c: number, sign: number[]) =>
    make((_, s) => {
      for (let a = 0; a < 4; a++) for (let b = a; b < 4; b++) s(idx[a], idx[b], c * sign[a] * sign[b] * B[a][b]);
    });
  const bendXY = bend([1, 5, 7, 11], EIz_L3, [1, 1, 1, 1]);
  const bendXZ = bend([2, 4, 8, 10], EIy_L3, [1, -1, 1, -1]);
  return { k: axial.plus(torsion).plus(bendXY).plus(bendXZ), axial, torsion, bendXY, bendXZ, factors: { EA_L, GJ_L, EIz_L3, EIy_L3 } };
}

/** Local DOF indices released by end releases (θx,θy,θz at node i = 3,4,5; at node j = 9,10,11). */
export function releasedLocalDofs3D(rI: EndRelease, rJ: EndRelease): number[] {
  const r: number[] = [];
  if (rI.rx) r.push(3);
  if (rI.ry) r.push(4);
  if (rI.rz) r.push(5);
  if (rJ.rx) r.push(9);
  if (rJ.ry) r.push(10);
  if (rJ.rz) r.push(11);
  return r;
}

export interface ElementMatrices3D {
  orientation: Orientation3D;
  local: LocalStiffness3D;
  T: Matrix;
  kGlobalFull: Matrix;
  released: number[];
  condensation: CondensationResult | null;
  /**
   * True when torsion is released at BOTH ends (k_cc would be singular): the torsion rows/columns decouple from
   * everything else and are simply zeroed; any other released DOFs are still condensed.
   */
  decoupled: boolean;
  kLocalUsed: Matrix;
  kGlobal: Matrix;
}

export function elementMatrices3D(E: number, G: number, A: number, Iy: number, Iz: number, J: number, o: Orientation3D, released: number[]): ElementMatrices3D {
  const local = localStiffness3D(E, G, A, Iy, Iz, J, o.L);
  const T = transformation3D(o.lambda);
  const kGlobalFull = T.transpose().mul(local.k).mul(T);
  let condensation: CondensationResult | null = null;
  let decoupled = false;
  let kLocalUsed = local.k;
  if (released.length) {
    // Torsion released at BOTH ends makes k_cc singular (rigid spin about the axis). That block is decoupled from
    // everything else, so it is simply zeroed; every other released DOF is condensed normally.
    decoupled = released.includes(3) && released.includes(9);
    const toCondense = decoupled ? released.filter((r) => r !== 3 && r !== 9) : released;
    if (toCondense.length) {
      condensation = condense(local.k, toCondense);
      kLocalUsed = condensation.kStar ?? local.k;
    }
    if (decoupled) {
      kLocalUsed = kLocalUsed.clone();
      for (const r of [3, 9]) for (let j = 0; j < 12; j++) { kLocalUsed.set(r, j, 0); kLocalUsed.set(j, r, 0); }
    }
  }
  const kGlobal = released.length ? T.transpose().mul(kLocalUsed).mul(T) : kGlobalFull;
  return { orientation: o, local, T, kGlobalFull, released, condensation, decoupled, kLocalUsed, kGlobal };
}
