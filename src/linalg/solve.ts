import { Matrix } from './matrix';
import { gaussSolve, type GaussResult } from './gauss';
import { choleskySolve, type CholeskyResult } from './cholesky';

/**
 * Solver front door. Small systems use the fully recorded Gauss path (the one
 * the UI walks through). Large systems try Cholesky first (fast, steps summarized)
 * and fall back to a lightly recorded Gauss run only if Cholesky breaks down,
 * because that run is what locates the mechanism DOFs.
 */
export interface SolveOptions {
  /** Use the detailed Gauss path for n <= this. */
  detailedMaxN?: number;
  /** Gauss steps recorded in the large-system fallback path. */
  fallbackRecordedSteps?: number;
}

export interface SolveResult {
  method: 'gauss' | 'cholesky';
  n: number;
  x: Float64Array | null;
  singular: boolean;
  gauss: GaussResult | null;
  cholesky: CholeskyResult | null;
}

export function solveSystem(A: Matrix, b: ArrayLike<number>, opts: SolveOptions = {}): SolveResult {
  const n = A.rows;
  const detailedMaxN = opts.detailedMaxN ?? 60;
  if (n <= detailedMaxN) {
    const g = gaussSolve(A, b);
    return { method: 'gauss', n, x: g.x, singular: g.singular, gauss: g, cholesky: null };
  }
  const ch = choleskySolve(A, b);
  if (ch.ok) return { method: 'cholesky', n, x: ch.x, singular: false, gauss: null, cholesky: ch };
  const g = gaussSolve(A, b, { maxRecordedSteps: opts.fallbackRecordedSteps ?? 200, snapshotMaxN: 0 });
  return { method: 'gauss', n, x: g.x, singular: g.singular, gauss: g, cholesky: ch };
}
