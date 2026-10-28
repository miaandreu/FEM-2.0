import { Matrix } from '../linalg';
import { condense, type CondensationResult } from '../linalg';
import type { FemNode } from '../model';

/**
 * 2D frame element (3 DOF per node: u, v, θz), following Logan ch. 5.
 * Local DOF order: [d1x, d1y, φ1, d2x, d2y, φ2].
 */

export interface Geometry2D {
  dx: number;
  dy: number;
  L: number;
  /** C = cos θ = (x2 − x1)/L */
  C: number;
  /** S = sin θ = (y2 − y1)/L */
  S: number;
  angleDeg: number;
}

export function geometry2D(ni: Pick<FemNode, 'x' | 'y'>, nj: Pick<FemNode, 'x' | 'y'>): Geometry2D {
  const dx = nj.x - ni.x;
  const dy = nj.y - ni.y;
  const L = Math.sqrt(dx * dx + dy * dy);
  return { dx, dy, L, C: dx / L, S: dy / L, angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/** The precomputed factors Logan lists before building the matrix (Eq. 5.2.1). */
export interface Factors2D {
  /** 12 I / L² */
  twelveI_L2: number;
  /** 6 I / L */
  sixI_L: number;
  /** E / L */
  E_L: number;
  EA_L: number;
  EI_L3: number;
}

export interface LocalStiffness2D {
  k: Matrix;
  /** Axial contribution only (AE/L terms). */
  axial: Matrix;
  /** Bending contribution only (EI terms). */
  bending: Matrix;
  factors: Factors2D;
}

export function localStiffness2D(E: number, A: number, I: number, L: number): LocalStiffness2D {
  const EA_L = (E * A) / L;
  const EI_L3 = (E * I) / (L * L * L);
  const axial = Matrix.zeros(6);
  axial.set(0, 0, EA_L);
  axial.set(0, 3, -EA_L);
  axial.set(3, 0, -EA_L);
  axial.set(3, 3, EA_L);
  const b = Matrix.fromRows([
    [0, 0, 0, 0, 0, 0],
    [0, 12, 6 * L, 0, -12, 6 * L],
    [0, 6 * L, 4 * L * L, 0, -6 * L, 2 * L * L],
    [0, 0, 0, 0, 0, 0],
    [0, -12, -6 * L, 0, 12, -6 * L],
    [0, 6 * L, 2 * L * L, 0, -6 * L, 4 * L * L],
  ]).scale(EI_L3);
  return {
    k: axial.plus(b),
    axial,
    bending: b,
    factors: { twelveI_L2: (12 * I) / (L * L), sixI_L: (6 * I) / L, E_L: E / L, EA_L, EI_L3 },
  };
}

/** 6×6 transformation built from the 3×3 block [[C, S, 0], [−S, C, 0], [0, 0, 1]]. */
export function transformation2D(C: number, S: number): Matrix {
  const T = Matrix.zeros(6);
  for (const o of [0, 3]) {
    T.set(o, o, C);
    T.set(o, o + 1, S);
    T.set(o + 1, o, -S);
    T.set(o + 1, o + 1, C);
    T.set(o + 2, o + 2, 1);
  }
  return T;
}

/** k = Tᵀ k̂ T */
export function globalStiffness2D(kLocal: Matrix, T: Matrix): Matrix {
  return T.transpose().mul(kLocal).mul(T);
}

/**
 * Closed-form global matrix, Logan Eq. 5.1.11, written independently of T so the
 * two routes can be compared:
 *   k = E/L × [ AC²+12I/L² S², (A−12I/L²)CS, −6I/L S, ... ]
 */
export function closedFormGlobal2D(E: number, A: number, I: number, L: number, C: number, S: number): Matrix {
  const a = 12 * I / (L * L);
  const b = (6 * I) / L;
  const m = Matrix.zeros(6);
  const u: [number, number, number][] = [
    [0, 0, A * C * C + a * S * S],
    [0, 1, (A - a) * C * S],
    [0, 2, -b * S],
    [0, 3, -(A * C * C + a * S * S)],
    [0, 4, -(A - a) * C * S],
    [0, 5, -b * S],
    [1, 1, A * S * S + a * C * C],
    [1, 2, b * C],
    [1, 3, -(A - a) * C * S],
    [1, 4, -(A * S * S + a * C * C)],
    [1, 5, b * C],
    [2, 2, 4 * I],
    [2, 3, b * S],
    [2, 4, -b * C],
    [2, 5, 2 * I],
    [3, 3, A * C * C + a * S * S],
    [3, 4, (A - a) * C * S],
    [3, 5, b * S],
    [4, 4, A * S * S + a * C * C],
    [4, 5, -b * C],
    [5, 5, 4 * I],
  ];
  for (const [i, j, v] of u) {
    m.set(i, j, v * (E / L));
    m.set(j, i, v * (E / L));
  }
  return m;
}

/** Local DOF indices released by end releases (moment at end i = slot 2, at end j = slot 5). */
export function releasedLocalDofs2D(releaseIrz: boolean, releaseJrz: boolean): number[] {
  const r: number[] = [];
  if (releaseIrz) r.push(2);
  if (releaseJrz) r.push(5);
  return r;
}

export interface ElementMatrices2D {
  geometry: Geometry2D;
  local: LocalStiffness2D;
  T: Matrix;
  /** Un-condensed global matrix Tᵀ k̂ T. */
  kGlobalFull: Matrix;
  closedForm: Matrix;
  /** Max |difference| between Tᵀk̂T and the closed form, relative to the largest entry. */
  closedFormMismatch: number;
  released: number[];
  condensation: CondensationResult | null;
  /** Local matrix actually used in assembly (condensed if there are releases). */
  kLocalUsed: Matrix;
  /** Global matrix actually assembled: Tᵀ k̂* T. */
  kGlobal: Matrix;
}

export function elementMatrices2D(E: number, A: number, I: number, g: Geometry2D, released: number[]): ElementMatrices2D {
  const local = localStiffness2D(E, A, I, g.L);
  const T = transformation2D(g.C, g.S);
  const kGlobalFull = globalStiffness2D(local.k, T);
  const closedForm = closedFormGlobal2D(E, A, I, g.L, g.C, g.S);
  const scale = Math.max(kGlobalFull.maxAbs(), 1e-300);
  const closedFormMismatch = kGlobalFull.minus(closedForm).maxAbs() / scale;
  const condensation = released.length ? condense(local.k, released) : null;
  const kLocalUsed = condensation?.kStar ?? local.k;
  const kGlobal = condensation ? globalStiffness2D(kLocalUsed, T) : kGlobalFull;
  return { geometry: g, local, T, kGlobalFull, closedForm, closedFormMismatch, released, condensation, kLocalUsed, kGlobal };
}
