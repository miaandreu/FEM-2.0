/** Number formatting shared by every display (plain text and LaTeX). */
export interface NumFmt {
  mode: 'sig' | 'sci';
  /** Significant digits. */
  digits: number;
}

export const DEFAULT_FMT: NumFmt = { mode: 'sig', digits: 4 };

function sciParts(v: number, digits: number): { m: string; e: number } {
  const [m, e] = v.toExponential(Math.max(0, digits - 1)).split('e');
  const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
  return { m: mant, e: parseInt(e, 10) };
}

export function fmtNum(v: number, f: NumFmt = DEFAULT_FMT): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (f.mode === 'sci' || a >= 1e7 || a < 1e-4) {
    const { m, e } = sciParts(v, f.digits);
    return `${m}e${e >= 0 ? '+' : ''}${e}`;
  }
  return String(parseFloat(v.toPrecision(f.digits)));
}

export function fmtTex(v: number, f: NumFmt = DEFAULT_FMT): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (f.mode === 'sci' || a >= 1e7 || a < 1e-4) {
    const { m, e } = sciParts(v, f.digits);
    return e === 0 ? m : `${m}\\!\\times\\!10^{${e}}`;
  }
  return String(parseFloat(v.toPrecision(f.digits)));
}

/** Wrap negatives in parentheses so substitutions read like a textbook: (−60) − (−60). */
export function paren(v: number, f: NumFmt = DEFAULT_FMT): string {
  const s = fmtNum(v, f);
  return v < 0 ? `(${s})` : s;
}

export function parenTex(v: number, f: NumFmt = DEFAULT_FMT): string {
  const s = fmtTex(v, f);
  return v < 0 ? `(${s})` : s;
}
