import { Matrix } from './matrix';

/**
 * Gaussian elimination with partial pivoting that RECORDS every row operation so
 * the UI can replay it like a textbook solution.
 *
 * It is a rank-revealing (row-echelon) elimination: if a column has no usable
 * pivot it is marked "free" and elimination continues with the next column. A
 * free column is exactly a mechanism: the structure can move in that DOF without
 * any resisting force. For each free column we also build a null-space vector
 * (a "mechanism shape") so the caller can say which DOFs move together.
 */

export interface Snapshot {
  A: number[][];
  b: number[];
}

export type GaussStep =
  | { kind: 'swap'; column: number; rowA: number; rowB: number; snapshot?: Snapshot }
  | {
      kind: 'eliminate';
      pivotRow: number;
      pivotCol: number;
      pivot: number;
      row: number;
      /** multiplier m = a[row][pivotCol] / pivot; operation is R_row <- R_row - m * R_pivot */
      factor: number;
      snapshot?: Snapshot;
    }
  | { kind: 'free-column'; column: number; largestCandidate: number; scale: number; snapshot?: Snapshot }
  | {
      kind: 'back-sub';
      row: number;
      column: number;
      pivot: number;
      rhs: number;
      /** sum over j > column of a[row][j] * x[j] */
      knownSum: number;
      value: number;
    };

export interface GaussOptions {
  /** Relative pivot tolerance: pivot is "zero" if |pivot| <= tol * (largest |entry| in that original column). */
  tol?: number;
  /** Stop recording steps after this many (all work is still performed and counted). */
  maxRecordedSteps?: number;
  /** Attach a full matrix snapshot to each recorded step only if n <= this. */
  snapshotMaxN?: number;
}

export interface GaussResult {
  n: number;
  /** Solution, or null if the matrix is singular. */
  x: Float64Array | null;
  singular: boolean;
  /** 0-based unknown indices that have no pivot (mechanism DOFs). Empty if non-singular. */
  freeColumns: number[];
  /** One mechanism shape per free column (max |entry| scaled to 1). */
  nullVectors: Float64Array[];
  /** |pivot| used in each pivot column (in column order). */
  pivots: number[];
  /** pivot_k / (largest |entry| of original column k) for each pivot column. */
  pivotRatios: number[];
  minPivotRatio: number;
  /** max|pivot| / min|pivot| over pivot columns; Infinity if singular. */
  pivotSpread: number;
  steps: GaussStep[];
  /** Total number of row operations performed (may exceed steps.length). */
  totalOps: number;
  truncated: boolean;
  tol: number;
}

export const DEFAULT_PIVOT_TOL = 1e-9;

export function gaussSolve(Ain: Matrix, bin: ArrayLike<number>, opts: GaussOptions = {}): GaussResult {
  const n = Ain.rows;
  if (Ain.cols !== n) throw new Error('gaussSolve: matrix must be square');
  if (bin.length !== n) throw new Error('gaussSolve: right-hand side length mismatch');
  const tol = opts.tol ?? DEFAULT_PIVOT_TOL;
  const maxRec = opts.maxRecordedSteps ?? 1_000_000;
  const snapMax = opts.snapshotMaxN ?? 12;

  const A = Ain.clone();
  const a = A.data;
  const b = Float64Array.from(bin);

  // Per-column scale from the ORIGINAL matrix, used for the relative pivot test.
  const colScale = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = Math.abs(a[i * n + j]);
      if (v > colScale[j]) colScale[j] = v;
    }
  }

  const steps: GaussStep[] = [];
  let totalOps = 0;
  const record = (s: GaussStep) => {
    totalOps++;
    if (steps.length < maxRec) steps.push(s);
  };
  const snap = (): Snapshot | undefined =>
    n <= snapMax && steps.length < maxRec ? { A: A.toRows(), b: Array.from(b) } : undefined;

  const pivotCols: number[] = []; // pivotCols[r] = column of the pivot in row r
  const freeColumns: number[] = [];
  const pivots: number[] = [];
  const pivotRatios: number[] = [];

  let r = 0;
  for (let c = 0; c < n && r < n; c++) {
    // Partial pivoting: largest |entry| in column c among rows r..n-1.
    let best = r;
    let bestVal = Math.abs(a[r * n + c]);
    for (let i = r + 1; i < n; i++) {
      const v = Math.abs(a[i * n + c]);
      if (v > bestVal) {
        bestVal = v;
        best = i;
      }
    }
    const scale = colScale[c];
    if (bestVal <= tol * scale || bestVal === 0) {
      freeColumns.push(c);
      record({ kind: 'free-column', column: c, largestCandidate: bestVal, scale, snapshot: snap() });
      continue;
    }
    if (best !== r) {
      for (let j = 0; j < n; j++) {
        const t = a[r * n + j];
        a[r * n + j] = a[best * n + j];
        a[best * n + j] = t;
      }
      const tb = b[r];
      b[r] = b[best];
      b[best] = tb;
      record({ kind: 'swap', column: c, rowA: r, rowB: best, snapshot: snap() });
    }
    const piv = a[r * n + c];
    pivots.push(Math.abs(piv));
    pivotRatios.push(Math.abs(piv) / scale);
    pivotCols[r] = c;
    for (let i = r + 1; i < n; i++) {
      const aic = a[i * n + c];
      if (aic === 0) continue;
      const m = aic / piv;
      for (let j = c; j < n; j++) a[i * n + j] -= m * a[r * n + j];
      a[i * n + c] = 0;
      b[i] -= m * b[r];
      record({ kind: 'eliminate', pivotRow: r, pivotCol: c, pivot: piv, row: i, factor: m, snapshot: snap() });
    }
    r++;
  }
  // Columns after the loop ended early because r reached n cannot be free (n pivots found).
  const rank = r;
  const singular = rank < n;

  let x: Float64Array | null = null;
  const nullVectors: Float64Array[] = [];

  if (!singular) {
    x = new Float64Array(n);
    for (let row = n - 1; row >= 0; row--) {
      const col = pivotCols[row];
      let sum = 0;
      for (let j = col + 1; j < n; j++) sum += a[row * n + j] * x[j];
      const value = (b[row] - sum) / a[row * n + col];
      x[col] = value;
      record({ kind: 'back-sub', row, column: col, pivot: a[row * n + col], rhs: b[row], knownSum: sum, value });
    }
  } else {
    for (const f of freeColumns) {
      const v = new Float64Array(n);
      v[f] = 1;
      for (let row = rank - 1; row >= 0; row--) {
        const col = pivotCols[row];
        let sum = 0;
        for (let j = col + 1; j < n; j++) sum += a[row * n + j] * v[j];
        v[col] = -sum / a[row * n + col];
      }
      let mx = 0;
      for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(v[i]));
      if (mx > 0) for (let i = 0; i < n; i++) v[i] /= mx;
      nullVectors.push(v);
    }
  }

  const minP = pivots.length ? Math.min(...pivots) : 0;
  const maxP = pivots.length ? Math.max(...pivots) : 0;
  return {
    n,
    x,
    singular,
    freeColumns,
    nullVectors,
    pivots,
    pivotRatios,
    minPivotRatio: pivotRatios.length ? Math.min(...pivotRatios) : 0,
    pivotSpread: singular || minP === 0 ? Infinity : maxP / minP,
    steps,
    totalOps,
    truncated: totalOps > steps.length,
    tol,
  };
}

/** Inverse by Gauss-Jordan with partial pivoting. Returns null if singular (relative tolerance). */
export function invert(Ain: Matrix, tol = DEFAULT_PIVOT_TOL): Matrix | null {
  const n = Ain.rows;
  if (Ain.cols !== n) throw new Error('invert: matrix must be square');
  const A = Ain.clone();
  const inv = Matrix.identity(n);
  const scale = Math.max(Ain.maxAbs(), 1e-300);
  for (let c = 0; c < n; c++) {
    let best = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(A.get(i, c)) > Math.abs(A.get(best, c))) best = i;
    if (Math.abs(A.get(best, c)) <= tol * scale) return null;
    if (best !== c) {
      for (let j = 0; j < n; j++) {
        const t = A.get(c, j);
        A.set(c, j, A.get(best, j));
        A.set(best, j, t);
        const u = inv.get(c, j);
        inv.set(c, j, inv.get(best, j));
        inv.set(best, j, u);
      }
    }
    const p = A.get(c, c);
    for (let j = 0; j < n; j++) {
      A.set(c, j, A.get(c, j) / p);
      inv.set(c, j, inv.get(c, j) / p);
    }
    for (let i = 0; i < n; i++) {
      if (i === c) continue;
      const f = A.get(i, c);
      if (f === 0) continue;
      for (let j = 0; j < n; j++) {
        A.set(i, j, A.get(i, j) - f * A.get(c, j));
        inv.set(i, j, inv.get(i, j) - f * inv.get(c, j));
      }
    }
  }
  return inv;
}
