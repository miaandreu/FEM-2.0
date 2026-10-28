/**
 * Dense row-major matrix on a Float64Array.
 *
 * Deliberately small and dependency-free: every operation the solution
 * walkthrough displays (products, transposes, sub-matrix extraction) is
 * implemented here so the UI can show exactly what the code does.
 */
export class Matrix {
  readonly rows: number;
  readonly cols: number;
  readonly data: Float64Array;

  constructor(rows: number, cols: number, data?: Float64Array) {
    if (data && data.length !== rows * cols) {
      throw new Error(`Matrix data length ${data.length} does not match ${rows}x${cols}`);
    }
    this.rows = rows;
    this.cols = cols;
    this.data = data ?? new Float64Array(rows * cols);
  }

  static zeros(rows: number, cols: number = rows): Matrix {
    return new Matrix(rows, cols);
  }

  static identity(n: number): Matrix {
    const m = new Matrix(n, n);
    for (let i = 0; i < n; i++) m.data[i * n + i] = 1;
    return m;
  }

  static fromRows(rows: ArrayLike<number>[]): Matrix {
    const r = rows.length;
    const c = r === 0 ? 0 : rows[0].length;
    const m = new Matrix(r, c);
    for (let i = 0; i < r; i++) {
      if (rows[i].length !== c) throw new Error('Matrix.fromRows: ragged rows');
      for (let j = 0; j < c; j++) m.data[i * c + j] = rows[i][j];
    }
    return m;
  }

  get(i: number, j: number): number {
    return this.data[i * this.cols + j];
  }

  set(i: number, j: number, v: number): void {
    this.data[i * this.cols + j] = v;
  }

  /** this[i][j] += v (used by assembly). */
  add(i: number, j: number, v: number): void {
    this.data[i * this.cols + j] += v;
  }

  clone(): Matrix {
    return new Matrix(this.rows, this.cols, this.data.slice());
  }

  transpose(): Matrix {
    const t = new Matrix(this.cols, this.rows);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) t.data[j * this.rows + i] = this.data[i * this.cols + j];
    }
    return t;
  }

  mul(b: Matrix): Matrix {
    if (this.cols !== b.rows) throw new Error(`Matrix.mul: ${this.rows}x${this.cols} * ${b.rows}x${b.cols}`);
    const out = new Matrix(this.rows, b.cols);
    for (let i = 0; i < this.rows; i++) {
      for (let k = 0; k < this.cols; k++) {
        const a = this.data[i * this.cols + k];
        if (a === 0) continue;
        for (let j = 0; j < b.cols; j++) out.data[i * b.cols + j] += a * b.data[k * b.cols + j];
      }
    }
    return out;
  }

  mulVec(x: ArrayLike<number>): Float64Array {
    if (this.cols !== x.length) throw new Error(`Matrix.mulVec: ${this.cols} cols vs vector ${x.length}`);
    const y = new Float64Array(this.rows);
    for (let i = 0; i < this.rows; i++) {
      let s = 0;
      for (let j = 0; j < this.cols; j++) s += this.data[i * this.cols + j] * x[j];
      y[i] = s;
    }
    return y;
  }

  scale(s: number): Matrix {
    const out = this.clone();
    for (let i = 0; i < out.data.length; i++) out.data[i] *= s;
    return out;
  }

  plus(b: Matrix): Matrix {
    this.assertSameShape(b, 'plus');
    const out = this.clone();
    for (let i = 0; i < out.data.length; i++) out.data[i] += b.data[i];
    return out;
  }

  minus(b: Matrix): Matrix {
    this.assertSameShape(b, 'minus');
    const out = this.clone();
    for (let i = 0; i < out.data.length; i++) out.data[i] -= b.data[i];
    return out;
  }

  /** Extract the sub-matrix with the given (0-based) rows and columns, in the order given. */
  sub(rowIdx: readonly number[], colIdx: readonly number[]): Matrix {
    const out = new Matrix(rowIdx.length, colIdx.length);
    for (let i = 0; i < rowIdx.length; i++) {
      for (let j = 0; j < colIdx.length; j++) out.data[i * colIdx.length + j] = this.get(rowIdx[i], colIdx[j]);
    }
    return out;
  }

  maxAbs(): number {
    let m = 0;
    for (let i = 0; i < this.data.length; i++) {
      const a = Math.abs(this.data[i]);
      if (a > m) m = a;
    }
    return m;
  }

  /** True if |a_ij - a_ji| <= tol * maxAbs for all i, j. */
  isSymmetric(tol = 1e-12): boolean {
    if (this.rows !== this.cols) return false;
    const scale = Math.max(this.maxAbs(), 1e-300);
    for (let i = 0; i < this.rows; i++) {
      for (let j = i + 1; j < this.cols; j++) {
        if (Math.abs(this.get(i, j) - this.get(j, i)) > tol * scale) return false;
      }
    }
    return true;
  }

  toRows(): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < this.rows; i++) out.push(Array.from(this.data.subarray(i * this.cols, (i + 1) * this.cols)));
    return out;
  }

  private assertSameShape(b: Matrix, op: string): void {
    if (this.rows !== b.rows || this.cols !== b.cols) {
      throw new Error(`Matrix.${op}: shape mismatch ${this.rows}x${this.cols} vs ${b.rows}x${b.cols}`);
    }
  }
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function maxAbsVec(a: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const v = Math.abs(a[i]);
    if (v > m) m = v;
  }
  return m;
}
