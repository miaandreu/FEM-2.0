import { useMemo, useState } from 'react';
import { Matrix } from '../../linalg';
import type { Analysis2D } from '../../fem/analyze2d';
import type { Analysis3D } from '../../fem/analyze3d';
import { splitDof, UNIT_SYSTEMS } from '../../model';
import { fmtNum, fmtTex, paren } from '../format';
import { COLORS, MatrixView, Tex, VectorView, useDisplay, type Label } from '../Tex';
import { ElementSelector, Explain, LOCAL_D, LOCAL_F, dl, dlIdx, isRot, kOf, labelDim, localF, runningK, units, type CommonEl, type StepProps, type StepPropsAny } from './common';

const loc = (a: Label[], idx: number[]) => idx.map((i) => a[i]);

/** Step 1: model summary. */
export function StepModel({ a, model }: StepProps) {
  const u = UNIT_SYSTEMS[model.units];
  return (
    <>
      <Explain>
        The structure has <b>{model.nodes.length}</b> nodes and <b>{model.elements.length}</b> elements, {model.supports.length} support{model.supports.length === 1 ? '' : 's'},{' '}
        {model.nodalLoads.length} nodal load{model.nodalLoads.length === 1 ? '' : 's'} and {model.elementLoads.length} distributed load{model.elementLoads.length === 1 ? '' : 's'}. Units: {u.label}. Every
        step that follows is computed from exactly these tables: change anything on the left and the whole solution updates.
      </Explain>
      <table className="data">
        <thead><tr><th>Element</th><th>Nodes</th><th>L ({u.length})</th><th>Angle θ</th><th>E ({u.stress})</th><th>A</th><th>I</th><th>Hinges</th></tr></thead>
        <tbody>
          {a.elements.map((e) => (
            <tr key={e.id}>
              <td>{e.id}</td>
              <td>{e.nodeI} → {e.nodeJ}</td>
              <td>{fmtNum(e.geometry.L)}</td>
              <td>{fmtNum(e.geometry.angleDeg)}°</td>
              <td>{fmtNum(e.E)}</td>
              <td>{fmtNum(e.A)}</td>
              <td>{fmtNum(e.I)}</td>
              <td>{[e.released.includes(2) ? 'i' : '', e.released.includes(5) ? 'j' : ''].filter(Boolean).join(', ') || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Explain>
        The 2D frame element carries axial force, shear and bending moment, so each node has 3 degrees of freedom: displacement in x, displacement in y, and a rotation. The
        solution below follows the manual direct-stiffness procedure: element matrices → assembly → boundary conditions → solve → reactions → member forces.
      </Explain>
    </>
  );
}

/** Step 2: DOF numbering and ID arrays (2D and 3D). */
export function StepDofs({ a, model }: StepPropsAny) {
  const k = kOf();
  const n2 = Math.min(2, model.nodes.length);
  const els = a.elements as CommonEl[];
  const slots = k === 3 ? ['x-disp', 'y-disp', 'rotation'] : ['x-disp', 'y-disp', 'z-disp', 'x-rot', 'y-rot', 'z-rot'];
  return (
    <>
      <Explain>
        Node <i>n</i> owns global DOFs <b>{k}n−{k - 1} … {k}n</b> ({k === 3 ? 'x, y, rotation' : 'u, v, w, θx, θy, θz'}). For example node {n2} owns DOFs {k * n2 - k + 1} to {k * n2}.
        An element’s <b>ID array</b> lists the global DOF numbers of its {2 * k} local DOFs (node i first, then node j); it tells assembly where each local entry goes.
      </Explain>
      <div className="scrollx">
        <table className="data">
          <thead><tr><th>Node</th><th>{k === 3 ? 'x, y' : 'x, y, z'}</th>{slots.map((t) => <th key={t}>{t}</th>)}</tr></thead>
          <tbody>
            {model.nodes.map((n) => (
              <tr key={n.id}>
                <td>{n.id}</td>
                <td>({fmtNum(n.x)}, {fmtNum(n.y)}{k === 6 ? `, ${fmtNum(n.z)}` : ''})</td>
                {slots.map((_, j) => (
                  <td key={j}>{dl((n.id - 1) * k + j + 1).text} = DOF {(n.id - 1) * k + j + 1}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>Element ID arrays</h4>
      <div className="scrollx">
        <table className="data">
          <thead><tr><th>Element</th><th>Connects</th><th>ID array (global DOFs)</th></tr></thead>
          <tbody>
            {els.map((e) => (
              <tr key={e.id}>
                <td>{e.id}</td>
                <td>{e.nodeI} → {e.nodeJ}</td>
                <td>{'{'}{e.idArray.join(', ')}{'}'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Explain>Total: {a.nDof} global DOFs ({model.nodes.length} nodes × {k}), so the global stiffness matrix K is {a.nDof} × {a.nDof}.</Explain>
    </>
  );
}

/** Step 3: element stiffness, transformation, global element matrix. */
export function StepElements({ a, model, sel, setSel }: StepProps) {
  const d = useDisplay();
  const e = a.elements[Math.min(sel, a.elements.length) - 1];
  const [view, setView] = useState<'sym' | 'split' | 'num'>('num');
  const u = units(model);
  const ni = model.nodes[e.nodeI - 1];
  const nj = model.nodes[e.nodeJ - 1];
  const g = e.geometry;
  const f = d.fmt;
  const f1 = e.local.factors;
  const axialCell = (i: number, j: number) => ((i === 0 || i === 3) && (j === 0 || j === 3) ? COLORS.axial : COLORS.bending);
  const gl = e.idArray.map((id) => dl(id));

  const sym = (() => {
    const A = String.raw`\frac{AE}{L}`, b12 = String.raw`\frac{12EI}{L^3}`, b6 = String.raw`\frac{6EI}{L^2}`, b4 = String.raw`\frac{4EI}{L}`, b2 = String.raw`\frac{2EI}{L}`;
    const R = (s: string, c: string) => `\\textcolor{${c}}{${s}}`;
    const ax = (s: string) => R(s, COLORS.axial), bd = (s: string) => R(s, COLORS.bending);
    const rows = [
      [ax(A), '0', '0', ax('-' + A), '0', '0'],
      ['0', bd(b12), bd(b6), '0', bd('-' + b12), bd(b6)],
      ['0', bd(b6), bd(b4), '0', bd('-' + b6), bd(b2)],
      [ax('-' + A), '0', '0', ax(A), '0', '0'],
      ['0', bd('-' + b12), bd('-' + b6), '0', bd(b12), bd('-' + b6)],
      ['0', bd(b6), bd(b2), '0', bd('-' + b6), bd(b4)],
    ];
    const head = ' & ' + LOCAL_D.map((l) => l.tex).join(' & ') + String.raw` \\ \hline `;
    return String.raw`\hat k=\left[\begin{array}{r|cccccc}${head}${rows.map((r, i) => LOCAL_D[i].tex + ' & ' + r.join(' & ')).join(' \\\\ ')}\end{array}\right]`;
  })();

  const rel = e.condensation;
  const maxMis = e.closedFormMismatch;
  const lab = (idx: number[]) => loc(LOCAL_D, idx);

  return (
    <>
      <ElementSelector a={a} sel={sel} setSel={setSel} />
      <Explain>
        Element {e.id} connects node {e.nodeI} to node {e.nodeJ}, so its local x̂ axis points from node {e.nodeI} at ({fmtNum(ni.x)}, {fmtNum(ni.y)}) to node {e.nodeJ} at ({fmtNum(nj.x)}, {fmtNum(nj.y)}).
        It makes an angle of {fmtNum(g.angleDeg)}° with the global x axis.
      </Explain>

      <h4>a) Geometry: length and direction cosines</h4>
      <Tex block tex={String.raw`L=\sqrt{(x_2-x_1)^2+(y_2-y_1)^2}=\sqrt{(${paren(nj.x)}-${paren(ni.x)})^2+(${paren(nj.y)}-${paren(ni.y)})^2}=${fmtTex(g.L, f)}\ \text{${u.length}}`} />
      <Tex block tex={String.raw`C=\frac{x_2-x_1}{L}=\frac{${paren(nj.x)}-${paren(ni.x)}}{${fmtTex(g.L, f)}}=${fmtTex(g.C, f)}\qquad S=\frac{y_2-y_1}{L}=\frac{${paren(nj.y)}-${paren(ni.y)}}{${fmtTex(g.L, f)}}=${fmtTex(g.S, f)}`} />

      <h4>b) Precomputed factors</h4>
      <Explain>These groups of E, A, I and L appear again and again in the matrices, so they are evaluated once (like Logan Eq. 5.2.1).</Explain>
      <Tex block tex={String.raw`\frac{12I}{L^2}=\frac{12(${fmtTex(e.I, f)})}{(${fmtTex(g.L, f)})^2}=${fmtTex(f1.twelveI_L2, f)}\qquad \frac{6I}{L}=\frac{6(${fmtTex(e.I, f)})}{${fmtTex(g.L, f)}}=${fmtTex(f1.sixI_L, f)}`} />
      <Tex block tex={String.raw`\frac{E}{L}=\frac{${fmtTex(e.E, f)}}{${fmtTex(g.L, f)}}=${fmtTex(f1.E_L, f)}\qquad \frac{AE}{L}=${fmtTex(f1.EA_L, f)}\qquad \frac{EI}{L^3}=${fmtTex(f1.EI_L3, f)}`} />

      <h4>c) Local stiffness matrix k̂ (local axes)</h4>
      <Explain>
        Axial stretching is governed by <span style={{ color: COLORS.axial }}><b>AE/L</b> = {fmtNum(f1.EA_L)}</span> (a bar spring). Bending couples transverse displacement and rotation through
        <span style={{ color: COLORS.bending }}> <b>EI/L³</b> = {fmtNum(f1.EI_L3)}</span> times the terms 12, 6L, 4L², 2L². Length L, material E and the section (A, I) enter only through these two groups.
      </Explain>
      <div className="tabs" role="tablist">
        {([['sym', 'Symbolic'], ['split', 'Axial + bending'], ['num', 'Numeric']] as const).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>{t}</button>
        ))}
      </div>
      {view === 'sym' && <div className="matrix-scroll"><Tex block tex={sym} /></div>}
      {view === 'split' && (
        <div className="row-wrap">
          <MatrixView M={e.local.axial} rowLabels={LOCAL_D} colLabels={LOCAL_D} color={() => COLORS.axial} caption={<span style={{ color: COLORS.axial }}>axial (AE/L)</span>} />
          <span className="op">+</span>
          <MatrixView M={e.local.bending} rowLabels={LOCAL_D} colLabels={LOCAL_D} color={() => COLORS.bending} caption={<span style={{ color: COLORS.bending }}>bending (EI)</span>} />
        </div>
      )}
      {view === 'num' && <MatrixView M={e.local.k} rowLabels={LOCAL_D} colLabels={LOCAL_D} color={axialCell} caption={<>k̂ in {u.force}/{u.length}, blue = axial, red = bending</>} />}

      {rel && (
        <>
          <h4>d) Hinge: static condensation of the released moment</h4>
          <Explain>
            This element has a hinge at {e.released.includes(2) && e.released.includes(5) ? 'both ends' : e.released.includes(2) ? 'node i' : 'node j'}: the end moment there must be zero, so that row of k̂ must give zero force.
            Splitting k̂ into released (<i>c</i>) and retained (<i>r</i>) DOFs, the released rotation is eliminated: <Tex tex={String.raw`k^*=k_{rr}-k_{rc}\,k_{cc}^{-1}\,k_{cr}`} />. This is exactly the “nodal linkage” of Logan problem 4.43.
          </Explain>
          <div className="row-wrap">
            <MatrixView M={rel.kRR} rowLabels={lab(rel.retained)} colLabels={lab(rel.retained)} caption="k_rr" />
            <MatrixView M={rel.kRC} rowLabels={lab(rel.retained)} colLabels={lab(rel.released)} caption="k_rc" />
            <MatrixView M={rel.kCC} rowLabels={lab(rel.released)} colLabels={lab(rel.released)} caption="k_cc" />
          </div>
          {rel.kCCinv && rel.gain && rel.correction && rel.kStarReduced ? (
            <>
              <div className="row-wrap">
                <MatrixView M={rel.kCCinv} rowLabels={lab(rel.released)} colLabels={lab(rel.released)} caption="k_cc⁻¹" />
                <MatrixView M={rel.correction} rowLabels={lab(rel.retained)} colLabels={lab(rel.retained)} caption="k_rc k_cc⁻¹ k_cr" />
                <MatrixView M={rel.kStarReduced} rowLabels={lab(rel.retained)} colLabels={lab(rel.retained)} caption="k* = k_rr − k_rc k_cc⁻¹ k_cr" />
              </div>
              <MatrixView M={e.kLocalUsed} rowLabels={LOCAL_D} colLabels={LOCAL_D} color={() => COLORS.bending} caption="Condensed k̂* (zero row and column at the released DOF), used from here on" />
            </>
          ) : (
            <Explain>The released DOFs are not independent of each other, so they cannot be condensed.</Explain>
          )}
        </>
      )}

      <h4>{rel ? 'e' : 'd'}) Transformation matrix T</h4>
      <Explain>
        T rotates global displacements into the element’s local axes: <Tex tex={String.raw`\hat d=T\,d`} />. It repeats the 3×3 block <Tex tex={String.raw`\begin{bmatrix}C&S&0\\-S&C&0\\0&0&1\end{bmatrix}`} /> for each node; rotations are the same in both systems. Because T is orthogonal, T⁻¹ = Tᵀ.
      </Explain>
      <div className="row-wrap">
        <MatrixView M={e.T} rowLabels={LOCAL_D} colLabels={gl} caption="T" />
        <MatrixView M={e.T.transpose()} rowLabels={gl} colLabels={LOCAL_D} caption="Tᵀ" />
      </div>

      <h4>{rel ? 'f' : 'e'}) Global element matrix k = Tᵀ k̂ T</h4>
      <Explain>Using {rel ? 'the condensed k̂*' : 'k̂'} above, the product Tᵀ·k̂·T gives the element matrix in global axes; its rows and columns are labelled with the global DOFs from the ID array.</Explain>
      <MatrixView M={e.kGlobal} rowLabels={gl} colLabels={gl} caption={<>k<sup>({e.id})</sup> in {u.force}/{u.length} (and {u.moment}-type terms)</>} />
      <h4>Cross-check with the closed form (Logan Eq. 5.1.11)</h4>
      <MatrixView M={e.closedForm} rowLabels={gl} colLabels={gl} caption="Closed-form global matrix, written directly in terms of C, S, A, I, L" />
      <Explain>
        {maxMis < 1e-9 ? (
          <>The triple product Tᵀk̂T and the closed-form expression agree (largest relative difference {maxMis.toExponential(1)}), so the transformation is correct.{rel ? ' (The closed form shown is for the un-hinged element; the assembled matrix uses the condensed one.)' : ''}</>
        ) : (
          <>Largest relative difference between the two: {maxMis.toExponential(2)}.</>
        )}
      </Explain>
    </>
  );
}

/** Step 4: assembly. */
export function StepAssembly({ a, model, sel, setSel }: StepPropsAny) {
  const els = a.elements as CommonEl[];
  const e = els[Math.min(sel, els.length) - 1];
  const kk = kOf();
  const N = a.nDof;
  const labels = useMemo(() => Array.from({ length: N }, (_, i) => dlIdx(i)), [N]);
  const nodeOf = useMemo(() => Array.from({ length: N }, (_, i) => splitDof(i + 1, labelDim()).nodeId), [N]);
  const touched = useMemo(() => {
    const s = new Set<number>();
    for (const r of e.idArray) for (const c of e.idArray) s.add((r - 1) * N + (c - 1));
    return s;
  }, [e, N]);
  const expanded = useMemo(() => {
    const M = Matrix.zeros(N);
    e.idArray.forEach((r, i) => e.idArray.forEach((c, j) => M.add(r - 1, c - 1, e.kGlobal.get(i, j))));
    return M;
  }, [e, N]);
  const running = useMemo(() => runningK(els, N, e.id), [a, e.id]);
  const fill = (i: number, j: number) => (touched.has(i * N + j) ? '#fde68a' : undefined);
  const g = e.idArray[3];
  const contrib = els.filter((x) => x.idArray.includes(g)).map((x) => ({ id: x.id, v: x.kGlobal.get(x.idArray.indexOf(g), x.idArray.indexOf(g)) }));
  const total = contrib.reduce((s, c) => s + c.v, 0);
  const px = Math.max(2, Math.min(8, Math.floor(420 / N)));
  const cells: { i: number; j: number; k: number }[] = [];
  if (N <= 90) {
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (a.K.get(i, j) !== 0) cells.push({ i, j, k: touched.has(i * N + j) ? 2 : 1 });
    }
  }
  return (
    <>
      <ElementSelector a={a} sel={sel} setSel={setSel} />
      <Explain>
        Element {e.id} connects node {e.nodeI} to node {e.nodeJ}, so its ID array is {'{'}{e.idArray.join(', ')}{'}'}: it fills rows and columns {e.idArray.slice(0, kk).join(', ')} (node {e.nodeI}) and {e.idArray.slice(kk).join(', ')} (node {e.nodeJ}) of K.
        Each entry k<sub>ab</sub> of the element matrix is <b>added</b> to K at (row = ID[a], column = ID[b]). Entries with the same row and column label simply add.
      </Explain>
      <h4>Element {e.id} expanded to the full {N}×{N} size</h4>
      <MatrixView M={expanded} rowLabels={labels} colLabels={labels} rowNode={nodeOf} colNode={nodeOf} fill={fill} caption="Yellow = rows/columns this element touches; everything else is zero." />
      <h4>Running sum: K after adding elements 1 … {e.id}</h4>
      <MatrixView M={running} rowLabels={labels} colLabels={labels} rowNode={nodeOf} colNode={nodeOf} fill={fill} caption={<>Cells updated by element {e.id} are highlighted.</>} />
      <Explain>
        Example of “same label adds”: entry K({g},{g}) ({dlIdx(g - 1).text}) receives {contrib.length === 1 ? 'a contribution from element ' : 'contributions from elements '}
        {contrib.map((c) => c.id).join(' and ')}: {contrib.map((c) => fmtNum(c.v)).join(' + ')} = {fmtNum(total)}
        {model.springs.some((s) => (s.nodeId - 1) * kk + s.dof === g - 1) ? ' (plus a ground spring on this DOF)' : ''}.
      </Explain>
      {N <= 90 && (
        <>
          <h4>Scatter pattern</h4>
          <svg width={N * px + 2} height={N * px + 2} className="pattern" role="img" aria-label="Sparsity pattern of K">
            <rect x={0} y={0} width={N * px + 2} height={N * px + 2} fill="none" stroke="var(--muted)" />
            {cells.map((c) => (
              <rect key={`${c.i}-${c.j}`} x={1 + c.j * px} y={1 + c.i * px} width={px} height={px} fill={c.k === 2 ? 'var(--accent)' : 'var(--muted)'} opacity={c.k === 2 ? 1 : 0.5} />
            ))}
          </svg>
          <p className="muted small">Each dot is a nonzero entry of the final K; the selected element’s blocks are blue.</p>
        </>
      )}
      {e.id === els.length && (
        <>
          <h4>Final global stiffness matrix K</h4>
          <MatrixView M={a.K} rowLabels={labels} colLabels={labels} rowNode={nodeOf} colNode={nodeOf} caption={<>K ({N}×{N}) after all {els.length} elements{model.springs.length ? ' and springs' : ''}.</>} />
          <Explain>K is symmetric and its diagonal is positive; zero entries mean two DOFs are not directly connected by any element.</Explain>
        </>
      )}
    </>
  );
}

/** Step 5: global load vector (2D and 3D). */
export function StepLoads({ a, model }: StepPropsAny) {
  const u = units(model);
  const is3 = model.dimension === '3D';
  const els = a.elements as CommonEl[];
  const labels = useMemo(() => Array.from({ length: a.nDof }, (_, i) => dlIdx(i)), [a.nDof]);
  const LF = localF();
  const comp = (o: object) => o as Record<string, number>;
  return (
    <>
      <Explain>
        The load vector {'{F}'} has one entry per DOF. Applied nodal forces and moments go straight in. A distributed load is replaced by <b>equivalent nodal loads</b> (the forces and moments at the
        ends that do the same work); those are computed in the element’s local axes, rotated to global axes with Tᵀ, and added to the matching DOFs.
      </Explain>
      {els.filter((e) => e.loads.length > 0).map((e) => {
        const L = is3 ? (a as Analysis3D).elements[e.id - 1].orientation.L : (a as Analysis2D).elements[e.id - 1].geometry.L;
        return (
          <div key={e.id} className="card">
            <b>Element {e.id}</b>, L = {fmtNum(L)} {u.length}
            {e.loads.map((l, k) => {
              const w = comp(l.local);
              return (
                <div key={k}>
                  <Tex block tex={String.raw`w_{\hat x}=${fmtTex(w.wx1)}\to${fmtTex(w.wx2)}\qquad w_{\hat y}=${fmtTex(w.wy1)}\to${fmtTex(w.wy2)}${is3 ? String.raw`\qquad w_{\hat z}=${fmtTex(w.wz1)}\to${fmtTex(w.wz2)}` : ''}\quad(\text{${u.force}/${u.length}})`} />
                </div>
              );
            })}
            <Tex block tex={String.raw`\hat f_{1y}=\tfrac{L(7w_1+3w_2)}{20},\ \hat m_{1}=\tfrac{L^2(3w_1+2w_2)}{60},\ \hat f_{2y}=\tfrac{L(3w_1+7w_2)}{20},\ \hat m_{2}=-\tfrac{L^2(2w_1+3w_2)}{60}\quad(\text{uniform: } \tfrac{wL}{2},\ \tfrac{wL^2}{12})${is3 ? String.raw`\ \text{(for }w_{\hat z}\text{ the }\hat m_y\text{ moments have the opposite sign)}` : ''}`} />
            <div className="row-wrap">
              <VectorView values={e.eqLocal} labels={LF} caption="equivalent load, local" />
              {e.condensation !== null && <VectorView values={e.eqLocalUsed} labels={LF} caption="after hinge condensation f* = f_r − k_rc k_cc⁻¹ f_c" />}
              <VectorView values={e.eqGlobal} labels={e.idArray.map((id) => dl(id))} caption="global: Tᵀ f" />
            </div>
          </div>
        );
      })}
      <h4>Global load vector</h4>
      <div className="scrollx">
        <table className="data">
          <thead><tr><th>DOF</th><th>Label</th><th>F</th><th>Where it came from</th></tr></thead>
          <tbody>
            {Array.from(a.F).map((v, i) => (
              <tr key={i} className={v === 0 ? 'dim' : ''}>
                <td>{i + 1}</td>
                <td>{labels[i].text}</td>
                <td>{fmtNum(v)} {v === 0 ? '' : isRot(i) ? u.moment : u.force}</td>
                <td>
                  {a.loadSources[i].length === 0
                    ? '–'
                    : a.loadSources[i].map((s, k) => (
                        <span key={k}>{k ? ' + ' : ''}{s.kind === 'nodal' ? `applied nodal load ${fmtNum(s.value)}` : `equivalent load from element ${s.elementId}: ${fmtNum(s.value)}`}</span>
                      ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <VectorView values={a.F} labels={labels} caption="{F}" />
    </>
  );
}

export { LOCAL_F };
