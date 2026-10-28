import { describe, expect, it } from 'vitest';
import { Matrix, choleskySolve, condense, condenseVector, gaussSolve, invert, solveSystem } from './index';
import { lcg } from '../test/fixtures';

const close = (a: ArrayLike<number>, b: ArrayLike<number>, tol = 1e-9) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b[i])));
};

function randomSPD(n: number, seed: number): Matrix {
  const r = lcg(seed);
  const B = new Matrix(n, n);
  for (let i = 0; i < n * n; i++) B.data[i] = r() - 0.5;
  const A = B.transpose().mul(B);
  for (let i = 0; i < n; i++) A.add(i, i, n); // diagonal dominance -> well conditioned
  return A;
}

describe('Matrix', () => {
  it('multiplies, transposes and extracts sub-matrices', () => {
    const A = Matrix.fromRows([[1, 2, 3], [4, 5, 6]]);
    const B = Matrix.fromRows([[1, 0], [0, 1], [2, 2]]);
    expect(A.mul(B).toRows()).toEqual([[7, 8], [16, 17]]);
    expect(A.transpose().toRows()).toEqual([[1, 4], [2, 5], [3, 6]]);
    expect(A.sub([1], [0, 2]).toRows()).toEqual([[4, 6]]);
    expect(Array.from(A.mulVec([1, 1, 1]))).toEqual([6, 15]);
  });
  it('rejects shape mismatches', () => {
    expect(() => Matrix.zeros(2, 3).mul(Matrix.zeros(2, 3))).toThrow();
    expect(() => Matrix.zeros(2, 2).plus(Matrix.zeros(3, 3))).toThrow();
  });
  it('detects symmetry', () => {
    expect(Matrix.fromRows([[1, 2], [2, 1]]).isSymmetric()).toBe(true);
    expect(Matrix.fromRows([[1, 2], [3, 1]]).isSymmetric()).toBe(false);
  });
});

describe('gaussSolve', () => {
  it('solves a 3x3 system', () => {
    const A = Matrix.fromRows([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]]);
    const r = gaussSolve(A, [8, -11, -3]);
    expect(r.singular).toBe(false);
    close(r.x!, [2, 3, -1]);
  });
  it('records swaps, eliminations and back-substitution', () => {
    const A = Matrix.fromRows([[0.001, 2], [1, 1]]); // forces a row swap
    const r = gaussSolve(A, [1, 2]);
    expect(r.steps.some((s) => s.kind === 'swap')).toBe(true);
    expect(r.steps.filter((s) => s.kind === 'eliminate')).toHaveLength(1);
    expect(r.steps.filter((s) => s.kind === 'back-sub')).toHaveLength(2);
    const el = r.steps.find((s) => s.kind === 'eliminate');
    // snapshot after elimination must have a zero below the pivot
    expect(el && 'snapshot' in el && el.snapshot!.A[1][0]).toBe(0);
  });
  it('limits recorded steps but keeps solving and counting', () => {
    const A = randomSPD(20, 3);
    const b = new Float64Array(20).fill(1);
    const full = gaussSolve(A, b);
    const lim = gaussSolve(A, b, { maxRecordedSteps: 10 });
    expect(lim.steps).toHaveLength(10);
    expect(lim.truncated).toBe(true);
    expect(lim.totalOps).toBe(full.totalOps);
    close(lim.x!, full.x!, 1e-12);
  });
  it('reports a free-free spring chain as a mechanism with the rigid-body shape', () => {
    const K = Matrix.fromRows([[1, -1, 0], [-1, 2, -1], [0, -1, 1]]);
    const r = gaussSolve(K, [0, 0, 0]);
    expect(r.singular).toBe(true);
    expect(r.x).toBeNull();
    expect(r.freeColumns).toEqual([2]);
    close(r.nullVectors[0], [1, 1, 1]);
  });
  it('detects several independent mechanisms', () => {
    const K = Matrix.zeros(4, 4);
    K.set(0, 0, 5);
    K.set(1, 1, 5);
    const r = gaussSolve(K, [0, 0, 0, 0]);
    expect(r.freeColumns).toEqual([2, 3]);
    expect(r.nullVectors).toHaveLength(2);
  });
  it('uses a relative tolerance so a tiny-but-genuine stiffness is not "singular"', () => {
    const K = Matrix.fromRows([[1e9, 0], [0, 1e-3]]);
    expect(gaussSolve(K, [1, 1]).singular).toBe(false);
  });
  it('is deterministic', () => {
    const A = randomSPD(15, 9);
    const b = Float64Array.from({ length: 15 }, (_, i) => i + 1);
    const a = gaussSolve(A, b);
    const c = gaussSolve(A, b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
  });
});

describe('invert', () => {
  it('inverts a well-conditioned matrix and rejects a singular one', () => {
    const A = randomSPD(6, 5);
    const I = A.mul(invert(A)!);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) expect(I.get(i, j)).toBeCloseTo(i === j ? 1 : 0, 10);
    expect(invert(Matrix.fromRows([[1, 2], [2, 4]]))).toBeNull();
  });
});

describe('choleskySolve / solveSystem', () => {
  it('agrees with Gauss on SPD systems', () => {
    const A = randomSPD(30, 11);
    const b = Float64Array.from({ length: 30 }, (_, i) => Math.sin(i));
    const ch = choleskySolve(A, b);
    expect(ch.ok).toBe(true);
    close(ch.x!, gaussSolve(A, b).x!, 1e-9);
  });
  it('fails on a singular matrix and reports where', () => {
    const K = Matrix.fromRows([[1, -1], [-1, 1]]);
    const ch = choleskySolve(K, [0, 0]);
    expect(ch.ok).toBe(false);
    expect(ch.failedAt).toBe(1);
  });
  it('uses Cholesky for large systems and Gauss (with mechanism info) when that breaks down', () => {
    const n = 80;
    const A = randomSPD(n, 21);
    const b = new Float64Array(n).fill(1);
    expect(solveSystem(A, b).method).toBe('cholesky');
    // free-free chain of n springs: singular
    const K = Matrix.zeros(n, n);
    for (let i = 0; i < n - 1; i++) {
      K.add(i, i, 1);
      K.add(i + 1, i + 1, 1);
      K.add(i, i + 1, -1);
      K.add(i + 1, i, -1);
    }
    const s = solveSystem(K, new Float64Array(n));
    expect(s.method).toBe('gauss');
    expect(s.singular).toBe(true);
    expect(s.gauss!.freeColumns).toEqual([n - 1]);
  });
});

describe('static condensation', () => {
  // Beam element DOFs: [v1, th1, v2, th2], EI = 1, L given.
  const beam = (L: number) =>
    Matrix.fromRows([
      [12, 6 * L, -12, 6 * L],
      [6 * L, 4 * L * L, -6 * L, 2 * L * L],
      [-12, -6 * L, 12, -6 * L],
      [6 * L, 2 * L * L, -6 * L, 4 * L * L],
    ]).scale(1 / (L * L * L));

  it('hinge at node j gives the propped-cantilever matrix (3EI/L³, 3EI/L², 3EI/L)', () => {
    const L = 2.5;
    const c = condense(beam(L), [3]);
    const f = 3 / (L * L * L);
    const expected = Matrix.fromRows([
      [f, f * L, -f, 0],
      [f * L, f * L * L, -f * L, 0],
      [-f, -f * L, f, 0],
      [0, 0, 0, 0],
    ]);
    close(c.kStar!.data, expected.data, 1e-12);
    expect(c.kStar!.isSymmetric()).toBe(true);
  });
  it('condenses the uniform-load fixed-end vector to 5wL/8, wL²/8, 3wL/8', () => {
    const L = 4;
    const w = 3;
    const c = condense(beam(L), [3]);
    const fe = [(w * L) / 2, (w * L * L) / 12, (w * L) / 2, -(w * L * L) / 12];
    close(condenseVector(c, fe), [(5 * w * L) / 8, (w * L * L) / 8, (3 * w * L) / 8, 0], 1e-12);
  });
  it('nodal linkage (Logan 4.43): shear released at node i', () => {
    const L = 3;
    const c = condense(beam(L), [0]);
    const K = c.kStar!;
    for (let j = 0; j < 4; j++) expect(K.get(0, j)).toBe(0);
    expect(K.get(1, 1)).toBeCloseTo(1 / L, 12); // EI/L
    expect(K.get(1, 3)).toBeCloseTo(-1 / L, 12);
    expect(K.get(3, 3)).toBeCloseTo(1 / L, 12);
    expect(K.get(2, 2)).toBeCloseTo(0, 12);
  });
  it('flags dependent released DOFs as non-condensable', () => {
    const c = condense(Matrix.fromRows([[1, 1], [1, 1]]), [0, 1]);
    expect(c.kStar).toBeNull();
  });
  it('is a no-op with no released DOFs', () => {
    const k = beam(2);
    expect(condense(k, []).kStar!.data).toEqual(k.data);
  });
});
