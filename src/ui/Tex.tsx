import katex from 'katex';
import 'katex/dist/katex.min.css';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Matrix } from '../linalg';
import { DEFAULT_FMT, fmtNum, fmtTex, type NumFmt } from './format';

// ---- display settings (significant figures, scientific notation, factoring, zoom) ----
export interface Display {
  fmt: NumFmt;
  /** Show matrices as "scalar × matrix". */
  factor: boolean;
  zoom: number;
}
export const DisplayCtx = createContext<Display>({ fmt: DEFAULT_FMT, factor: false, zoom: 1 });
export const useDisplay = () => useContext(DisplayCtx);

export function Tex({ tex, block = false }: { tex: string; block?: boolean }) {
  const html = useMemo(() => katex.renderToString(tex, { displayMode: block, throwOnError: false, strict: 'ignore', trust: false }), [tex, block]);
  return <span className={block ? 'tex-block' : 'tex-inline'} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A label usable in both KaTeX and plain HTML tables. */
export interface Label {
  tex: string;
  text: string;
}

const BLUE = '#3b82f6';
const RED = '#ef4444';
export const COLORS = { axial: BLUE, bending: RED, torsion: '#10b981', gray: '#8b8b8b' };

export interface MatOpts {
  rowLabels?: Label[];
  colLabels?: Label[];
  fmt: NumFmt;
  factor?: boolean;
  /** Text colour for a cell (e.g. axial blue / bending red). */
  color?: (i: number, j: number) => string | undefined;
  /** Background highlight for a cell. */
  fill?: (i: number, j: number) => string | undefined;
}

function toRows(M: Matrix | number[][]): number[][] {
  return M instanceof Matrix ? M.toRows() : M;
}

function autoScalar(maxAbs: number): number | null {
  if (!(maxAbs > 0)) return null;
  if (maxAbs >= 1e3 || maxAbs < 1e-2) return Math.pow(10, Math.floor(Math.log10(maxAbs)));
  return null;
}

/** LaTeX bmatrix-style array with row/column DOF labels. */
export function matrixTex(M: Matrix | number[][], o: MatOpts): string {
  const rows = toRows(M);
  const nr = rows.length;
  const nc = nr ? rows[0].length : 0;
  let maxAbs = 0;
  for (const r of rows) for (const v of r) maxAbs = Math.max(maxAbs, Math.abs(v));
  const scalar = o.factor ? autoScalar(maxAbs) : null;
  const zeroTol = 1e-12 * maxAbs;
  const cell = (i: number, j: number) => {
    const raw = rows[i][j];
    const isZero = Math.abs(raw) <= zeroTol;
    const v = scalar ? raw / scalar : raw;
    let s = isZero ? '0' : fmtTex(v, o.fmt);
    const col = isZero ? COLORS.gray : o.color?.(i, j);
    if (col) s = `\\textcolor{${col}}{${s}}`;
    const fill = o.fill?.(i, j);
    if (fill) s = `\\colorbox{${fill}}{$\\textcolor{#000000}{${s}}$}`;
    return s;
  };
  const hasRow = !!o.rowLabels;
  const hasCol = !!o.colLabels;
  const spec = (hasRow ? 'r|' : '') + 'c'.repeat(nc);
  const lines: string[] = [];
  if (hasCol) lines.push((hasRow ? ' & ' : '') + o.colLabels!.map((l) => l.tex).join(' & ') + ' \\\\ \\hline');
  for (let i = 0; i < nr; i++) {
    const cells = Array.from({ length: nc }, (_, j) => cell(i, j)).join(' & ');
    lines.push((hasRow ? o.rowLabels![i].tex + ' & ' : '') + cells);
  }
  const body = `\\left[\\begin{array}{${spec}}${lines.join(' \\\\ ')}\\end{array}\\right]`;
  return scalar ? `${fmtTex(scalar, { ...o.fmt, mode: 'sig' })}\\times ${body}` : body;
}

export function vectorTex(values: ArrayLike<number>, labels: Label[] | undefined, fmt: NumFmt): string {
  const n = values.length;
  const rows = Array.from({ length: n }, (_, i) => (labels ? labels[i].tex + ' & ' : '') + fmtTex(values[i], fmt));
  return `\\left\\{\\begin{array}{${labels ? 'r|' : ''}r}${rows.join(' \\\\ ')}\\end{array}\\right\\}`;
}

export interface MatrixViewProps {
  M: Matrix | number[][];
  rowLabels?: Label[];
  colLabels?: Label[];
  color?: (i: number, j: number) => string | undefined;
  fill?: (i: number, j: number) => string | undefined;
  /** Node number owning each row / column (enables the "only node n" filter on big tables). */
  rowNode?: number[];
  colNode?: number[];
  /** CSS class for table cells (strike-through views etc.). */
  cellClass?: (i: number, j: number) => string | undefined;
  forceTable?: boolean;
  caption?: ReactNode;
}

const TEX_LIMIT = 12;
const TABLE_CAP = 60;

/**
 * Small matrices render as a real LaTeX matrix; large ones as a scrollable table
 * with sticky labels, zero-dimming, a node filter, and a render cap that must be
 * lifted explicitly (so the page stays responsive on big models).
 */
export function MatrixView(p: MatrixViewProps) {
  const d = useDisplay();
  // Keep the matrix itself; nested arrays are only built for the (small) LaTeX path.
  const mat = useMemo(() => (p.M instanceof Matrix ? p.M : Matrix.fromRows(p.M)), [p.M]);
  const nr = mat.rows;
  const nc = mat.cols;
  const [showAll, setShowAll] = useState(false);
  const [nodeFilter, setNodeFilter] = useState('');
  const asTex = !p.forceTable && nr <= TEX_LIMIT && nc <= TEX_LIMIT && !p.cellClass;
  const tex = useMemo(
    () => (asTex ? matrixTex(mat.toRows(), { rowLabels: p.rowLabels, colLabels: p.colLabels, fmt: d.fmt, factor: d.factor, color: p.color, fill: p.fill }) : ''),
    [asTex, mat, p.rowLabels, p.colLabels, d.fmt, d.factor, p.color, p.fill],
  );
  if (nr === 0 || nc === 0) return <div className="muted">(empty matrix)</div>;
  if (asTex) {
    return (
      <figure className="matrix" style={{ fontSize: `${d.zoom}em` }}>
        <div className="matrix-scroll"><Tex tex={tex} block /></div>
        {p.caption && <figcaption>{p.caption}</figcaption>}
      </figure>
    );
  }
  // ---- table path ----
  const maxAbs = mat.maxAbs();
  const wanted = new Set(nodeFilter.split(/[,\s]+/).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n)));
  const keep = (idx: number, nodes?: number[]) => wanted.size === 0 || !nodes || wanted.has(nodes[idx]);
  let ri = Array.from({ length: nr }, (_, i) => i).filter((i) => keep(i, p.rowNode));
  let ci = Array.from({ length: nc }, (_, j) => j).filter((j) => keep(j, p.colNode));
  const capped = !showAll && (ri.length > TABLE_CAP || ci.length > TABLE_CAP);
  if (capped) {
    ri = ri.slice(0, TABLE_CAP);
    ci = ci.slice(0, TABLE_CAP);
  }
  return (
    <figure className="matrix" style={{ fontSize: `${d.zoom}em` }}>
      {p.rowNode && (
        <label className="filter">
          Show only node(s):{' '}
          <input value={nodeFilter} onChange={(e) => setNodeFilter(e.target.value)} placeholder="e.g. 2, 3 (blank = all)" size={18} />
        </label>
      )}
      <div className="matrix-scroll tall">
        <table className="mtable">
          <thead>
            <tr>
              <th className="corner" />
              {ci.map((j) => (
                <th key={j} className="colhead">{p.colLabels ? p.colLabels[j].text : j + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ri.map((i) => (
              <tr key={i}>
                <th className="rowhead">{p.rowLabels ? p.rowLabels[i].text : i + 1}</th>
                {ci.map((j) => {
                  const v = mat.get(i, j);
                  const zero = Math.abs(v) <= 1e-12 * maxAbs;
                  return (
                    <td
                      key={j}
                      className={[zero ? 'zero' : '', p.cellClass?.(i, j) ?? ''].join(' ')}
                      style={{ color: zero ? undefined : p.color?.(i, j), background: p.fill?.(i, j) }}
                    >
                      {zero ? '0' : fmtNum(v, d.fmt)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {capped && (
        <div className="muted">
          Showing the first {TABLE_CAP}×{TABLE_CAP} of {nr}×{nc}.{' '}
          <button className="link" onClick={() => setShowAll(true)}>Show everything</button> (may be slow for large models) or filter by node above.
        </div>
      )}
      {p.caption && <figcaption>{p.caption}</figcaption>}
    </figure>
  );
}

export function VectorView({ values, labels, caption }: { values: ArrayLike<number>; labels?: Label[]; caption?: ReactNode }) {
  const d = useDisplay();
  const tex = useMemo(() => vectorTex(values, labels, d.fmt), [values, labels, d.fmt]);
  if (values.length > 24) {
    return (
      <MatrixView
        M={Array.from({ length: values.length }, (_, i) => [values[i]])}
        rowLabels={labels}
        colLabels={[{ tex: '', text: 'value' }]}
        forceTable
        caption={caption}
      />
    );
  }
  return (
    <figure className="matrix" style={{ fontSize: `${d.zoom}em` }}>
      <div className="matrix-scroll"><Tex tex={tex} block /></div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
