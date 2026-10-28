import { Matrix } from './matrix';
import { invert } from './gauss';

/**
 * Static condensation of released DOFs (Logan problem 4.43 "nodal linkage",
 * internal hinges, end releases):
 *
 *     k* = k_rr - k_rc · k_cc⁻¹ · k_cr
 *
 * "c" = condensed (released) DOFs, "r" = retained DOFs. The result is returned
 * with every intermediate piece so the UI can display the derivation, and is
 * also provided in full size (zero rows/columns at the released DOFs).
 */
export interface CondensationResult {
  retained: number[];
  released: number[];
  kRR: Matrix;
  kRC: Matrix;
  kCR: Matrix;
  kCC: Matrix;
  /** null if k_cc is singular (the released DOFs are not independent of the rest). */
  kCCinv: Matrix | null;
  /** k_rc · k_cc⁻¹ (needed again for load condensation). */
  gain: Matrix | null;
  /** k_rc · k_cc⁻¹ · k_cr */
  correction: Matrix | null;
  /** k* on the retained DOFs only. */
  kStarReduced: Matrix | null;
  /** k* at full size, zero rows/columns at the released DOFs. */
  kStar: Matrix | null;
}

export function condense(k: Matrix, released: readonly number[]): CondensationResult {
  const n = k.rows;
  const rel = [...new Set(released)].sort((a, b) => a - b);
  const retained: number[] = [];
  for (let i = 0; i < n; i++) if (!rel.includes(i)) retained.push(i);

  const kRR = k.sub(retained, retained);
  const kRC = k.sub(retained, rel);
  const kCR = k.sub(rel, retained);
  const kCC = k.sub(rel, rel);

  if (rel.length === 0) {
    return { retained, released: rel, kRR, kRC, kCR, kCC, kCCinv: null, gain: null, correction: null, kStarReduced: kRR, kStar: k.clone() };
  }
  const kCCinv = invert(kCC);
  if (!kCCinv) {
    return { retained, released: rel, kRR, kRC, kCR, kCC, kCCinv: null, gain: null, correction: null, kStarReduced: null, kStar: null };
  }
  const gain = kRC.mul(kCCinv);
  const correction = gain.mul(kCR);
  const kStarReduced = kRR.minus(correction);
  const kStar = new Matrix(n, n);
  for (let i = 0; i < retained.length; i++) {
    for (let j = 0; j < retained.length; j++) kStar.set(retained[i], retained[j], kStarReduced.get(i, j));
  }
  return { retained, released: rel, kRR, kRC, kCR, kCC, kCCinv, gain, correction, kStarReduced, kStar };
}

/**
 * Condense an element load / fixed-end-force vector the same way:
 *   f* = f_r - k_rc · k_cc⁻¹ · f_c      (zero at released DOFs)
 */
export function condenseVector(res: CondensationResult, f: ArrayLike<number>): Float64Array {
  const n = res.retained.length + res.released.length;
  const out = new Float64Array(n);
  if (res.released.length === 0) {
    for (let i = 0; i < n; i++) out[i] = f[i];
    return out;
  }
  if (!res.gain) throw new Error('condenseVector: condensation is singular');
  const fR = res.retained.map((i) => f[i]);
  const fC = res.released.map((i) => f[i]);
  const corr = res.gain.mulVec(fC);
  res.retained.forEach((idx, i) => {
    out[idx] = fR[i] - corr[i];
  });
  return out;
}
