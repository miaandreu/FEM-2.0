import { Matrix } from './matrix';

/**
 * Cholesky factorization K = L Lᵀ for symmetric positive definite matrices.
 * Used for large systems, where the UI summarizes instead of listing every
 * row operation. A stable structure has an SPD reduced stiffness matrix; if
 * the factorization breaks down, the caller falls back to the recorded Gauss
 * path to locate the mechanism.
 */
export interface CholeskyResult {
  ok: boolean;
  /** Lower-triangular factor (only meaningful when ok). */
  L: Matrix | null;
  x: Float64Array | null;
  /** 0-based index where a non-positive pivot was found (when !ok). */
  failedAt: number | null;
  /** smallest and largest L_ii squared (the pivots d_i of the factorization). */
  minPivot: number;
  maxPivot: number;
  /** Approximate multiply-add count, n³/3. */
  flops: number;
}

export function choleskySolve(Ain: Matrix, b: ArrayLike<number>, tol = 1e-12): CholeskyResult {
  const n = Ain.rows;
  if (Ain.cols !== n) throw new Error('choleskySolve: matrix must be square');
  if (b.length !== n) throw new Error('choleskySolve: right-hand side length mismatch');
  const L = new Matrix(n, n);
  const l = L.data;
  const a = Ain.data;
  let minPivot = Infinity;
  let maxPivot = 0;
  for (let j = 0; j < n; j++) {
    let d = a[j * n + j];
    for (let k = 0; k < j; k++) d -= l[j * n + k] * l[j * n + k];
    const origDiag = Math.abs(a[j * n + j]);
    if (!(d > tol * Math.max(origDiag, 1e-300))) {
      return { ok: false, L: null, x: null, failedAt: j, minPivot: Math.min(minPivot, d), maxPivot, flops: (n * n * n) / 3 };
    }
    minPivot = Math.min(minPivot, d);
    maxPivot = Math.max(maxPivot, d);
    const ljj = Math.sqrt(d);
    l[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = a[i * n + j];
      for (let k = 0; k < j; k++) s -= l[i * n + k] * l[j * n + k];
      l[i * n + j] = s / ljj;
    }
  }
  // Forward substitution L y = b, then back substitution Lᵀ x = y.
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= l[i * n + k] * y[k];
    y[i] = s / l[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= l[k * n + i] * x[k];
    x[i] = s / l[i * n + i];
  }
  return { ok: true, L, x, failedAt: null, minPivot, maxPivot, flops: (n * n * n) / 3 };
}
