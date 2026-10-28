import { useMemo, useState } from 'react';
import { Matrix } from '../../linalg';
import { fmtNum, fmtTex, paren } from '../format';
import { Arrow, MomentArc } from '../StructureView2D';
import { MatrixView, Tex, VectorView, useDisplay, type Label } from '../Tex';
import { ElementSelector, Explain, LOCAL_D, LOCAL_F, Ok, dl, dlIdx, dofMeaning, dofUnit, kOf, loadUnit, reactionMeaning, units, type StepProps, type StepPropsAny } from './common';

const lab = (idx: number[]): Label[] => idx.map((i) => dlIdx(i));

/** Step 6: free/constrained partition, strike-through view, reduced system. */
export function StepPartition({ a, model }: StepPropsAny) {
  const { free, constrained, removed } = a.dofClass;
  const N = a.nDof;
  const labels = useMemo(() => lab(Array.from({ length: N }, (_, i) => i)), [N]);
  const struck = useMemo(() => {
    const s = new Set<number>([...constrained, ...removed.map((r) => r.dof)]);
    return s;
  }, [constrained, removed]);
  const hasPrescribed = a.dc.some((v) => v !== 0);
  const nodeOf = useMemo(() => Array.from({ length: N }, (_, i) => Math.floor(i / kOf()) + 1), [N]);
  return (
    <>
      <Explain>
        A support fixes some DOFs: their displacement is <b>known</b> (usually zero). Those are the <b>constrained</b> DOFs (c); the unknown ones are <b>free</b> (f). Here there are {free.length} free and {constrained.length} constrained DOFs
        {removed.length ? ` (plus ${removed.length} zero-stiffness DOF${removed.length > 1 ? 's' : ''} removed from the solve)` : ''}.
        Writing {'{F}'} = [K]{'{d}'} with the DOFs sorted this way:
      </Explain>
      <Tex block tex={String.raw`\begin{Bmatrix}F_f\\F_c\end{Bmatrix}=\begin{bmatrix}K_{ff}&K_{fc}\\K_{cf}&K_{cc}\end{bmatrix}\begin{Bmatrix}d_f\\d_c\end{Bmatrix}`} />
      <div className="row-wrap">
        <div className="card"><b>Free</b> ({free.length})<br />{free.slice(0, 80).map((i) => dlIdx(i).text).join('  ')}{free.length > 80 ? ` … (+${free.length - 80} more)` : ''}</div>
        <div className="card">
          <b>Constrained</b> ({constrained.length})<br />
          {constrained.slice(0, 80).map((i, k) => `${dlIdx(i).text} = ${fmtNum(a.dc[k])}`).join('   ')}{constrained.length > 80 ? ` … (+${constrained.length - 80} more)` : ''}
        </div>
      </div>
      {removed.map((r) => (
        <Explain key={r.dof}>⚠️ {r.text}</Explain>
      ))}
      <h4>Rows and columns removed (strike-through view)</h4>
      <MatrixView
        M={a.K}
        rowLabels={labels}
        colLabels={labels}
        rowNode={nodeOf}
        colNode={nodeOf}
        cellClass={(i, j) => (struck.has(i) || struck.has(j) ? 'struck' : undefined)}
        caption="Struck-out rows and columns belong to constrained (or removed) DOFs. What remains is K_ff."
      />
      <h4>The partitions</h4>
      <div className="row-wrap">
        <MatrixView M={a.Kff} rowLabels={lab(free)} colLabels={lab(free)} rowNode={free.map((i) => nodeOf[i])} colNode={free.map((i) => nodeOf[i])} caption="K_ff" />
      </div>
      {constrained.length > 0 && free.length > 0 && (
        <div className="row-wrap">
          <MatrixView M={a.Kfc} rowLabels={lab(free)} colLabels={lab(constrained)} rowNode={free.map((i) => nodeOf[i])} colNode={constrained.map((i) => nodeOf[i])} caption="K_fc" />
        </div>
      )}
      <h4>Reduced system</h4>
      <Explain>
        The free-DOF equations are <Tex tex={String.raw`K_{ff}\,d_f=F_f-K_{fc}\,d_c`} />.{' '}
        {hasPrescribed
          ? 'Some supports have non-zero prescribed displacements, so K_fc·d_c is not zero: it moves to the right-hand side as a load-like term.'
          : 'All prescribed displacements are zero, so K_fc·d_c = 0 and the right-hand side is just F_f.'}
      </Explain>
      <div className="row-wrap">
        <VectorView values={a.Ff} labels={lab(free)} caption="F_f" />
        {hasPrescribed && <VectorView values={a.KfcDc} labels={lab(free)} caption="K_fc d_c" />}
        <VectorView values={a.rhs} labels={lab(free)} caption={hasPrescribed ? 'F_f − K_fc d_c' : 'right-hand side'} />
      </div>
      {free.length === 0 && <Explain>Every DOF is constrained, so there is nothing to solve: all displacements are prescribed.</Explain>}
      <span hidden>{model.name}</span>
    </>
  );
}

/** Step 7: Gaussian elimination, recorded. */
export function StepSolve({ a }: StepPropsAny) {
  const d = useDisplay();
  const [shown, setShown] = useState(24);
  const s = a.solve;
  const free = a.dofClass.free;
  const cols: Label[] = useMemo(() => [...lab(free), { tex: 'F', text: 'rhs' }], [free]);
  const aug = useMemo(() => {
    const M = Matrix.zeros(free.length, free.length + 1);
    for (let i = 0; i < free.length; i++) {
      for (let j = 0; j < free.length; j++) M.set(i, j, a.Kff.get(i, j));
      M.set(i, free.length, a.rhs[i]);
    }
    return M;
  }, [a, free]);
  if (!s) return <Explain>No free DOFs, so there is nothing to solve.</Explain>;
  const g = s.gauss;
  const ch = s.cholesky;
  const f = d.fmt;
  const xl = (col: number) => dlIdx(free[col]).tex;
  const R = (r: number) => `R_{${r + 1}}`;
  return (
    <>
      <Explain>
        The reduced system has {free.length} equations in {free.length} unknowns. It is solved by <b>Gaussian elimination</b>
        {s.method === 'gauss' ? ' with partial pivoting: row operations turn the matrix into upper-triangular form, then back-substitution finds the unknowns from the bottom up.' : ''}
      </Explain>
      <MatrixView M={aug} rowLabels={lab(free)} colLabels={cols} caption="Augmented matrix [K_ff | F_f − K_fc d_c]" />
      {s.method === 'cholesky' && ch && (
        <Explain>
          Because the system is large ({s.n} equations), the tool uses a <b>Cholesky factorization</b> K<sub>ff</sub> = L Lᵀ instead (about {fmtNum(ch.flops)} multiply-adds), then forward substitution L y = F and back substitution Lᵀ d = y.
          Listing every row operation would be thousands of lines, so only this summary is shown. Pivots range from {fmtNum(ch.minPivot)} to {fmtNum(ch.maxPivot)}. All pivots are positive, which confirms the structure is stable.
        </Explain>
      )}
      {g && (
        <>
          {g.singular && <Explain>⚠️ Elimination found {g.freeColumns.length} column(s) with no usable pivot: the structure is unstable. See the message under the model.</Explain>}
          <h4>Row operations ({g.totalOps} total{g.truncated ? `, first ${g.steps.length} recorded` : ''})</h4>
          <ol className="gsteps">
            {g.steps.slice(0, shown).map((st, k) => {
              if (st.kind === 'swap')
                return (
                  <li key={k}>
                    <b>Pivot</b>: the largest entry in column {st.column + 1} is in row {st.rowB + 1}, so swap R<sub>{st.rowA + 1}</sub> ↔ R<sub>{st.rowB + 1}</sub>.
                    {st.snapshot && <MatrixView M={st.snapshot.A.map((r, i) => [...r, st.snapshot!.b[i]])} rowLabels={lab(free)} colLabels={cols} />}
                  </li>
                );
              if (st.kind === 'eliminate')
                return (
                  <li key={k}>
                    <Tex tex={String.raw`m=\frac{a_{${st.row + 1}${st.pivotCol + 1}}}{a_{${st.pivotRow + 1}${st.pivotCol + 1}}}=\frac{${fmtTex(st.factor * st.pivot, f)}}{${fmtTex(st.pivot, f)}}=${fmtTex(st.factor, f)}\;\Rightarrow\; ${R(st.row)}\leftarrow ${R(st.row)}-(${fmtTex(st.factor, f)})\,${R(st.pivotRow)}`} />
                    {st.snapshot && <MatrixView M={st.snapshot.A.map((r, i) => [...r, st.snapshot!.b[i]])} rowLabels={lab(free)} colLabels={cols} />}
                  </li>
                );
              if (st.kind === 'free-column')
                return (
                  <li key={k}>
                    <b>No pivot</b> in column {st.column + 1} (<Tex tex={xl(st.column)} />): the largest candidate {fmtNum(st.largestCandidate)} is negligible next to the column scale {fmtNum(st.scale)}. That DOF is unrestrained.
                  </li>
                );
              return (
                <li key={k}>
                  <b>Back-substitute</b> row {st.row + 1}:{' '}
                  <Tex tex={String.raw`${xl(st.column)}=\frac{b_{${st.row + 1}}-\sum a\,x}{a_{${st.row + 1}${st.column + 1}}}=\frac{${fmtTex(st.rhs, f)}-(${fmtTex(st.knownSum, f)})}{${fmtTex(st.pivot, f)}}=${fmtTex(st.value, f)}`} />
                </li>
              );
            })}
          </ol>
          {shown < g.steps.length ? (
            <div className="row-wrap">
              <span className="muted">Showing {shown} of {g.steps.length} recorded operations.</span>
              <button onClick={() => setShown(shown + 50)}>Show next 50</button>
              <button onClick={() => setShown(g.steps.length)}>Show all</button>
            </div>
          ) : g.truncated ? (
            <Explain>… {g.totalOps - g.steps.length} further operations were performed but not recorded (the model is large).</Explain>
          ) : (
            <button className="link" onClick={() => setShown(24)}>Collapse to the first 24</button>
          )}
          {g.x && <Explain>Smallest pivot ÷ its column scale = {fmtNum(g.minPivotRatio)}; largest/smallest pivot = {fmtNum(g.pivotSpread)}. Large ratios would warn of an ill-conditioned (nearly unstable) structure.</Explain>}
        </>
      )}
      {s.x && <VectorView values={s.x} labels={lab(free)} caption="Solution d_f" />}
    </>
  );
}

/** Step 8: displacements. */
export function StepDisplacements({ a, model }: StepPropsAny) {
  const u = units(model);
  return (
    <>
      <Explain>
        These are the unknown displacements {'{d_f}'} found in the previous step, combined with the known (support) values. Translations are in {u.length}, rotations in radians (counter-clockwise positive).
      </Explain>
      <table className="data">
        <thead><tr><th>DOF</th><th>Label</th><th>Meaning</th><th>Value</th><th>Unit</th><th>Status</th></tr></thead>
        <tbody>
          {Array.from(a.d).map((v, i) => {
            const rem = a.dofClass.removed.find((r) => r.dof === i);
            const con = a.dofClass.constrained.includes(i);
            return (
              <tr key={i} className={con ? 'dim' : ''}>
                <td>{i + 1}</td>
                <td>{dlIdx(i).text}</td>
                <td>node {Math.floor(i / kOf()) + 1}, {dofMeaning(i)}</td>
                <td>{fmtNum(v, { mode: 'sig', digits: 5 })}</td>
                <td>{dofUnit(i, model)}</td>
                <td>{rem ? 'not solved (free hinge)' : con ? 'prescribed' : 'solved'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/** Step 9: reactions. */
export function StepReactions({ a, model }: StepPropsAny) {
  const d = useDisplay();
  const [pick, setPick] = useState(0);
  const c = a.dofClass.constrained;
  if (c.length === 0) return <Explain>There are no supports, so there are no reactions.</Explain>;
  const k = Math.min(pick, c.length - 1);
  const row = c[k];
  const terms: { k: number; d: number; lab: string }[] = [];
  a.dofClass.free.forEach((fi, j) => {
    const kv = a.Kcf.get(k, j);
    if (kv !== 0) terms.push({ k: kv, d: a.d[fi], lab: dlIdx(fi).tex });
  });
  c.forEach((ci, j) => {
    const kv = a.Kcc.get(k, j);
    if (kv !== 0 && a.dc[j] !== 0) terms.push({ k: kv, d: a.dc[j], lab: dlIdx(ci).tex });
  });
  const shownTerms = terms.slice(0, 10);
  const eq = a.globalEquilibrium;
  const un = loadUnit(row, model);
  return (
    <>
      <Explain>
        Reactions come from the <b>original</b> equations (the rows that were struck out before): <Tex tex={String.raw`R=K_{cf}\,d_f+K_{cc}\,d_c-F_c`} />. The displacements just found are substituted back in.
      </Explain>
      <label>
        Show the product for reaction:{' '}
        <select value={k} onChange={(e) => setPick(Number(e.target.value))}>
          {c.map((ci, i) => <option key={ci} value={i}>R at {dlIdx(ci).text} (DOF {ci + 1})</option>)}
        </select>
      </label>
      <Tex block tex={String.raw`R_{${dlIdx(row).tex}}=${terms.length ? shownTerms.map((t) => `(${fmtTex(t.k, d.fmt)})(${fmtTex(t.d, d.fmt)})`).join('+') + (terms.length > shownTerms.length ? `+\\cdots\\ (${terms.length - shownTerms.length}\\text{ more})` : '') : '0'}-(${fmtTex(a.Fc[k], d.fmt)})=${fmtTex(a.reactions[k], d.fmt)}\ \text{${un}}`} />
      <Explain>Only non-zero terms of row {row + 1} of K times the displacement vector are listed; the reaction equals that sum minus the load applied at the same DOF.</Explain>
      <table className="data">
        <thead><tr><th>DOF</th><th>Reaction</th><th>Value</th><th>Unit</th></tr></thead>
        <tbody>
          {c.map((ci, i) => (
            <tr key={ci}>
              <td>{ci + 1}</td>
              <td>R({dlIdx(ci).text}) (node {Math.floor(ci / kOf()) + 1}, {reactionMeaning(ci)})</td>
              <td>{fmtNum(a.reactions[i], { mode: 'sig', digits: 5 })}</td>
              <td>{loadUnit(ci, model)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {eq && (
        <div className="card">
          <b>Global equilibrium check</b> (all loads + reactions, moments about the origin)
          <div>
            {'sumF' in eq
              ? <>ΣF = ({eq.sumF.map((v) => fmtNum(v)).join(', ')}), ΣM = ({eq.sumM.map((v) => fmtNum(v)).join(', ')})</>
              : <>ΣFx = {fmtNum(eq.sumFx)}, ΣFy = {fmtNum(eq.sumFy)}, ΣM = {fmtNum(eq.sumM)}</>}{' '}
            <Ok ok={eq.ok}>{eq.ok ? 'balanced' : 'not balanced'}</Ok>
          </div>
          <div className="muted small">Each sum should be zero apart from round-off (tolerance relative to the largest force, {fmtNum(eq.scale)}).</div>
        </div>
      )}
    </>
  );
}

/** Free-body diagram of one element in its local axes (like Logan Fig. 5-5). */
function FreeBody({ f, L, model }: { f: ArrayLike<number>; L: number; model: StepProps['model'] }) {
  const u = units(model);
  const x1 = 90, x2 = 410, y = 120;
  const c = 'var(--load)';
  const txt = (v: number) => fmtNum(v, { mode: 'sig', digits: 4 });
  const fy = (x: number, v: number) => {
    const dir = v >= 0 ? -1 : 1; // +ŷ is up on screen
    return (
      <g>
        <Arrow x1={x} y1={y} x2={x} y2={y + dir * 46} color={c} w={2.5} />
        <text x={x + 6} y={y + dir * 50 + (dir > 0 ? 10 : -2)} fontSize={11} fill={c}>{txt(v)} {u.force}</text>
      </g>
    );
  };
  const fx = (x: number, v: number) => {
    const dir = v >= 0 ? 1 : -1;
    return (
      <g>
        <Arrow x1={x} y1={y} x2={x + dir * 52} y2={y} color={c} w={2.5} />
        <text x={x + dir * 26 - 22} y={y - 8} fontSize={11} fill={c}>{txt(v)}</text>
      </g>
    );
  };
  return (
    <svg viewBox="0 0 500 220" className="fbd" role="img" aria-label="Free-body diagram of the element in local axes">
      <line x1={x1} y1={y} x2={x2} y2={y} stroke="var(--line)" strokeWidth={5} />
      <circle cx={x1} cy={y} r={4} fill="var(--fg)" /><circle cx={x2} cy={y} r={4} fill="var(--fg)" />
      <text x={x1 - 8} y={y + 18} fontSize={12} textAnchor="end">node i</text>
      <text x={x2 + 8} y={y + 18} fontSize={12}>node j</text>
      <text x={(x1 + x2) / 2} y={y + 22} fontSize={11} textAnchor="middle" fill="var(--muted)">L = {fmtNum(L)} {u.length}</text>
      <Arrow x1={20} y1={200} x2={56} y2={200} color="var(--muted)" w={1.5} /><text x={60} y={204} fontSize={12}>x̂</text>
      <Arrow x1={20} y1={200} x2={20} y2={166} color="var(--muted)" w={1.5} /><text x={14} y={160} fontSize={12}>ŷ</text>
      {fx(x1, f[0])}
      {fy(x1, f[1])}
      <MomentArc x={x1} y={y} ccw={f[2] >= 0} color={c} />
      <text x={x1 - 40} y={y - 24} fontSize={11} fill={c}>{txt(f[2])} {u.moment}</text>
      {fx(x2, f[3])}
      {fy(x2, f[4])}
      <MomentArc x={x2} y={y} ccw={f[5] >= 0} color={c} />
      <text x={x2 + 12} y={y - 24} fontSize={11} fill={c}>{txt(f[5])} {u.moment}</text>
    </svg>
  );
}

/** Step 10: element end forces. */
export function StepForces({ a, model, sel, setSel }: StepProps) {
  const e = a.elements[Math.min(sel, a.elements.length) - 1];
  const u = units(model);
  const gl = e.idArray.map((id) => dl(id));
  const eq = e.equilibrium;
  const hasLoad = e.loads.length > 0;
  return (
    <>
      <ElementSelector a={a} sel={sel} setSel={setSel} />
      <Explain>
        Now go back to each element: its end displacements in <b>local</b> axes, <Tex tex={String.raw`\hat d=T\,d`} />, give the local end forces <Tex tex={String.raw`\hat f=\hat k\,\hat d${hasLoad ? '-\\hat f_{eq}' : ''}`} />.
        {hasLoad ? ' The equivalent nodal load of the distributed load is subtracted, because it was added to the load vector in step 5 but the member really carries it.' : ''}
      </Explain>
      <div className="row-wrap">
        <VectorView values={e.dGlobal} labels={gl} caption={<>d (global, from step 8)</>} />
        <VectorView values={e.dLocalNodal} labels={LOCAL_D} caption="T d (local)" />
        {e.condensation && <VectorView values={e.dLocal} labels={LOCAL_D} caption="with the hinge’s own end rotation recovered" />}
      </div>
      {e.condensation && (
        <Explain>
          The hinged end rotates independently of the node: its rotation is recovered from the condensed equation <Tex tex={String.raw`\hat d_c=k_{cc}^{-1}\,(\hat f_{eq,c}-k_{cr}\,\hat d_r)`} />, so the end moment comes out zero as it must.
        </Explain>
      )}
      <div className="row-wrap">
        <MatrixView M={e.local.k} rowLabels={LOCAL_D} colLabels={LOCAL_D} caption="k̂ (uncondensed)" />
        <VectorView values={e.kd} labels={LOCAL_F} caption="k̂ d̂" />
        {hasLoad && <VectorView values={e.eqLocal} labels={LOCAL_F} caption="− f̂_eq (equivalent load, local)" />}
        <VectorView values={e.endForces} labels={LOCAL_F} caption={<b>f̂: end forces ({u.force}, {u.moment})</b>} />
      </div>
      <h4>Free-body diagram</h4>
      <FreeBody f={e.endForces} L={e.geometry.L} model={model} />
      <Explain>
        Positive f̂<sub>x</sub> / f̂<sub>y</sub> act in the +x̂ / +ŷ direction of the element, and positive moments act counter-clockwise, as in Logan Fig. 5-5. A negative axial force at node i with a positive one at node j means tension.
      </Explain>
      <div className="card">
        <b>Equilibrium of element {e.id}</b>{hasLoad ? ' (including its distributed load)' : ''}:
        <div>ΣF<sub>x̂</sub> = {fmtNum(eq.sumFx)}, ΣF<sub>ŷ</sub> = {fmtNum(eq.sumFy)}, ΣM about node i = {fmtNum(eq.sumM)} <Ok ok={eq.ok}>{eq.ok ? 'balanced' : 'check'}</Ok></div>
        <div className="muted small">ΣM = m̂₁ + m̂₂ + f̂₂y·L{hasLoad ? ' + moment of the load' : ''} = {paren(e.endForces[2])} + {paren(e.endForces[5])} + {paren(e.endForces[4])}({fmtNum(e.geometry.L)}).</div>
      </div>
    </>
  );
}

/** Step 11: deformed shape. */
export function StepDeformed({ a, model, scale, setScale, autoScale }: StepPropsAny) {
  const u = units(model);
  let maxD = 0;
  let where = 1;
  for (let n = 0; n < model.nodes.length; n++) {
    const kk = kOf();
    const m = Math.hypot(a.d[n * kk], a.d[n * kk + 1], kk === 6 ? a.d[n * kk + 2] : 0);
    if (m > maxD) { maxD = m; where = n + 1; }
  }
  return (
    <>
      <Explain>
        The drawing shows the undeformed structure (dashed) and the deformed structure (solid). Real displacements are tiny compared with the member lengths, so they are multiplied by a <b>scale factor</b> to be visible:
        <b> displacements × {fmtNum(scale)}</b>. Largest nodal displacement: {fmtNum(maxD)} {u.length} at node {where}.
      </Explain>
      <div className="row-wrap">
        <label>
          Scale factor{' '}
          <input type="number" step="any" min="0" value={scale} onChange={(e) => setScale(Math.max(0, Number(e.target.value) || 0))} style={{ width: 110 }} aria-label="Deformation scale factor" />
        </label>
        <input type="range" min={-2} max={4} step={0.05} value={Math.log10(Math.max(scale / Math.max(autoScale, 1e-12), 1e-3))} onChange={(e) => setScale(autoScale * Math.pow(10, Number(e.target.value)))} aria-label="Scale slider" />
        <button onClick={() => setScale(autoScale)}>Auto</button>
        <button onClick={() => setScale(1)}>True scale (1×)</button>
      </div>
      <Explain>
        Between the nodes each member is drawn with the <b>cubic Hermite shape functions</b>, using that member’s own end displacements and rotations (so a hinge shows as a kink):
      </Explain>
      <Tex block tex={String.raw`v(\xi)=N_1\hat d_{1y}+N_2 L\hat\phi_1+N_3\hat d_{2y}+N_4 L\hat\phi_2,\quad \xi=\hat x/L`} />
      <Tex block tex={String.raw`N_1=1-3\xi^2+2\xi^3,\; N_2=\xi-2\xi^2+\xi^3,\; N_3=3\xi^2-2\xi^3,\; N_4=-\xi^2+\xi^3`} />
      <Explain>The axial displacement varies linearly between the two ends. With distributed loads the true curve has an extra bulge between nodes that this simple shape omits; the end values are exact.</Explain>
    </>
  );
}
