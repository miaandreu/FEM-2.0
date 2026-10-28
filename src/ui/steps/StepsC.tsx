import { useState } from 'react';
import { fmtNum, fmtTex, paren } from '../format';
import { COLORS, MatrixView, Tex, VectorView, useDisplay, type Label } from '../Tex';
import { ElementSelector, Explain, LOCAL_D3, LOCAL_F3, Ok, dl, units, type StepProps3 } from './common';

const PURPLE = '#a855f7';
const sub = (all: Label[], idx: number[]) => idx.map((i) => all[i]);
const vec = (v: number[], f = fmtNum) => `(${v.map((x) => f(x)).join(', ')})`;

const BLOCKS = {
  axial: { idx: [0, 6], color: COLORS.axial },
  torsion: { idx: [3, 9], color: COLORS.torsion },
  bendXY: { idx: [1, 5, 7, 11], color: COLORS.bending },
  bendXZ: { idx: [2, 4, 8, 10], color: PURPLE },
};
const blockOf = (i: number, j: number): string | undefined => {
  for (const [k, b] of Object.entries(BLOCKS)) if (b.idx.includes(i) && b.idx.includes(j)) return k;
  return undefined;
};

/** Step 1 (3D): model summary. */
export function StepModel3({ a, model }: StepProps3) {
  const u = units(model);
  const fallbacks = a.elements.filter((e) => e.orientation.refSource === 'fallback-X');
  return (
    <>
      <Explain>
        The structure has <b>{model.nodes.length}</b> nodes and <b>{model.elements.length}</b> elements, {model.supports.length} support{model.supports.length === 1 ? '' : 's'},{' '}
        {model.nodalLoads.length} nodal load{model.nodalLoads.length === 1 ? '' : 's'} and {model.elementLoads.length} distributed load{model.elementLoads.length === 1 ? '' : 's'}. Units: {u.label}.
        The 3D frame element carries axial force, torsion, and bending about <b>two</b> axes, so each node has 6 degrees of freedom (u, v, w, θx, θy, θz) and each element matrix is 12 × 12.
      </Explain>
      <div className="scrollx">
        <table className="data">
          <thead><tr><th>El.</th><th>Nodes</th><th>L ({u.length})</th><th>x̂ (direction)</th><th>Axes from</th><th>E</th><th>G</th><th>A</th><th>Iy</th><th>Iz</th><th>J</th><th>Hinges</th></tr></thead>
          <tbody>
            {a.elements.map((e) => {
              const rel = (r: number[]) => r.map((d) => ({ 3: 'θx', 4: 'θy', 5: 'θz', 9: 'θx', 10: 'θy', 11: 'θz' } as Record<number, string>)[d]).join(' ');
              return (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td>{e.nodeI} → {e.nodeJ}</td>
                  <td>{fmtNum(e.orientation.L)}</td>
                  <td>{vec(e.orientation.ex, (x) => fmtNum(x, { mode: 'sig', digits: 3 }))}</td>
                  <td>{e.orientation.refSource === 'user' ? `vector ${vec(e.orientation.refUsed)}` : e.orientation.refSource === 'default-Z' ? 'global Z (default)' : 'global X (vertical member fallback)'}{e.orientation.rollDeg ? `, roll ${e.orientation.rollDeg}°` : ''}</td>
                  <td>{fmtNum(e.E)}</td>
                  <td>{fmtNum(e.G)}{e.Gsource === 'nu' ? ' (from ν)' : e.Gsource === 'default-nu' ? ' (ν = 0.3)' : ''}</td>
                  <td>{fmtNum(e.A)}</td><td>{fmtNum(e.Iy)}</td><td>{fmtNum(e.Iz)}</td><td>{fmtNum(e.J)}</td>
                  <td>{[e.released.filter((d) => d < 6), e.released.filter((d) => d >= 6)].map((r, i) => (r.length ? `${i ? 'j' : 'i'}: ${rel(r)}` : '')).filter(Boolean).join('; ') || '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {fallbacks.length > 0 && (
        <Explain>
          ⚠️ Element{fallbacks.length > 1 ? 's' : ''} {fallbacks.map((e) => e.id).join(', ')} {fallbacks.length > 1 ? 'are' : 'is'} vertical (parallel to global Z), so the default reference vector (Z) cannot define the local y–z axes. The documented fallback is used instead:
          reference vector = global X, which makes local ŷ = global X for these members.
        </Explain>
      )}
      <Explain>
        <b>Which I is which?</b> With the default axes a <i>horizontal</i> member has local ŷ pointing up (global Z), so vertical bending uses <b>Iz</b> (bending in the local x–y plane) and sideways bending uses <b>Iy</b>.
        Change the reference vector or roll angle of an element to turn its section.
      </Explain>
    </>
  );
}

/** Step 3 (3D): element stiffness, orientation, transformation. */
export function StepElements3({ a, model, sel, setSel }: StepProps3) {
  const d = useDisplay();
  const e = a.elements[Math.min(sel, a.elements.length) - 1];
  const [view, setView] = useState<'blocks' | 'full'>('blocks');
  const u = units(model);
  const o = e.orientation;
  const ni = model.nodes[e.nodeI - 1];
  const nj = model.nodes[e.nodeJ - 1];
  const f = d.fmt;
  const fa = e.local.factors;
  const gl = e.idArray.map((id) => dl(id));
  const rel = e.condensation;
  const lab = (idx: number[]) => sub(LOCAL_D3, idx);
  const L = fmtTex(o.L, f);
  const axes: Label[] = [{ tex: String.raw`\hat x`, text: 'x̂' }, { tex: String.raw`\hat y`, text: 'ŷ' }, { tex: String.raw`\hat z`, text: 'ẑ' }];
  const glob: Label[] = [{ tex: 'X', text: 'X' }, { tex: 'Y', text: 'Y' }, { tex: 'Z', text: 'Z' }];
  const color = (i: number, j: number) => { const b = blockOf(i, j); return b ? BLOCKS[b as keyof typeof BLOCKS].color : undefined; };
  const rigid = (() => {
    const mode = Array.from({ length: 12 }, (_, i) => (i % 6 === 0 ? 1 : 0)); // both nodes translate in global x
    const r = e.kGlobal.mulVec(mode);
    return Math.max(...Array.from(r, Math.abs)) / Math.max(e.kGlobal.maxAbs(), 1e-300);
  })();
  const sym = e.kGlobal.isSymmetric();
  const rv = o.refUsed;
  return (
    <>
      <ElementSelector a={a} sel={sel} setSel={setSel} />
      <Explain>
        Element {e.id} connects node {e.nodeI} at {vec([ni.x, ni.y, ni.z])} to node {e.nodeJ} at {vec([nj.x, nj.y, nj.z])}; its local x̂ axis points from node {e.nodeI} to node {e.nodeJ}.
      </Explain>

      <h4>a) Geometry</h4>
      <Tex block tex={String.raw`L=\sqrt{\Delta x^2+\Delta y^2+\Delta z^2}=\sqrt{(${paren(o.dx)})^2+(${paren(o.dy)})^2+(${paren(o.dz)})^2}=${L}\ \text{${u.length}}`} />
      <Tex block tex={String.raw`\hat x=\frac{(\Delta x,\Delta y,\Delta z)}{L}=\frac{(${paren(o.dx)},\,${paren(o.dy)},\,${paren(o.dz)})}{${L}}=(${o.ex.map((x) => fmtTex(x, f)).join(',\\,')})`} />

      <h4>b) Local axes and the direction-cosine matrix λ</h4>
      <Explain>
        {o.note} The reference vector r = {vec(rv)} lies in the local x–y plane, so
        ẑ = (x̂ × r)/|x̂ × r| and ŷ = ẑ × x̂ (which makes x̂, ŷ, ẑ a right-handed set).
      </Explain>
      {o.refSource === 'fallback-X' && <Explain>⚠️ Orientation fallback in use for this vertical member (see note above).</Explain>}
      <div className="row-wrap">
        <MatrixView M={o.lambda} rowLabels={axes} colLabels={glob} caption="λ: each row is a local axis written in global X, Y, Z components" />
        <ul className="small">
          <li><b>Row 1</b> = x̂ = {vec(o.ex, (x) => fmtNum(x, f))}: along the member, node i → j.</li>
          <li><b>Row 2</b> = ŷ = {vec(o.ey, (x) => fmtNum(x, f))}: ẑ × x̂, on the same side as r.</li>
          <li><b>Row 3</b> = ẑ = {vec(o.ez, (x) => fmtNum(x, f))}: x̂ × ŷ, perpendicular to the x–y plane.</li>
        </ul>
      </div>
      <Explain>
        Multiplying a global vector by λ gives its components along x̂, ŷ, ẑ: <Tex tex={String.raw`\{\hat u\}=\lambda\{u\}`} />. Because the rows are orthonormal, λ⁻¹ = λᵀ.
      </Explain>

      <h4>c) Properties and factors</h4>
      <Tex block tex={String.raw`\frac{EA}{L}=\frac{${fmtTex(e.E, f)}(${fmtTex(e.A, f)})}{${L}}=${fmtTex(fa.EA_L, f)}\qquad \frac{GJ}{L}=\frac{${fmtTex(e.G, f)}(${fmtTex(e.J, f)})}{${L}}=${fmtTex(fa.GJ_L, f)}`} />
      <Tex block tex={String.raw`\frac{EI_z}{L^3}=\frac{${fmtTex(e.E, f)}(${fmtTex(e.Iz, f)})}{(${L})^3}=${fmtTex(fa.EIz_L3, f)}\qquad \frac{EI_y}{L^3}=\frac{${fmtTex(e.E, f)}(${fmtTex(e.Iy, f)})}{(${L})^3}=${fmtTex(fa.EIy_L3, f)}`} />
      {e.Gsource !== 'G' && <Explain>G was not given, so G = E / (2(1+ν)) = {fmtNum(e.G)}{e.Gsource === 'default-nu' ? ' using the default ν = 0.3' : ''}.</Explain>}

      <h4>d) Local stiffness matrix k̂ (12 × 12)</h4>
      <Explain>
        k̂ is the sum of four independent blocks (every other entry is zero):
        <span style={{ color: COLORS.axial }}> axial EA/L</span>,
        <span style={{ color: COLORS.torsion }}> torsion GJ/L</span>,
        <span style={{ color: COLORS.bending }}> bending in the x–y plane (EIz: v, θz)</span> and
        <span style={{ color: PURPLE }}> bending in the x–z plane (EIy: w, θy)</span>. The x–z block has the same numbers as x–y but the signs of the θy couplings are reversed, because a positive rotation about y tilts the beam the opposite way to the deflection slope (θy = −dw/dx).
      </Explain>
      <div className="tabs" role="tablist">
        {([['blocks', 'The four blocks'], ['full', 'Full 12×12']] as const).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>{t}</button>
        ))}
      </div>
      {view === 'blocks' ? (
        <>
          <div className="row-wrap">
            <div>
              <Tex tex={String.raw`\textcolor{${COLORS.axial}}{\tfrac{EA}{L}\begin{bmatrix}1&-1\\-1&1\end{bmatrix}}`} block />
              <MatrixView M={e.local.axial.sub(BLOCKS.axial.idx, BLOCKS.axial.idx)} rowLabels={lab(BLOCKS.axial.idx)} colLabels={lab(BLOCKS.axial.idx)} color={() => COLORS.axial} />
            </div>
            <div>
              <Tex tex={String.raw`\textcolor{${COLORS.torsion}}{\tfrac{GJ}{L}\begin{bmatrix}1&-1\\-1&1\end{bmatrix}}`} block />
              <MatrixView M={e.local.torsion.sub(BLOCKS.torsion.idx, BLOCKS.torsion.idx)} rowLabels={lab(BLOCKS.torsion.idx)} colLabels={lab(BLOCKS.torsion.idx)} color={() => COLORS.torsion} />
            </div>
          </div>
          <Tex block tex={String.raw`\textcolor{${COLORS.bending}}{\tfrac{EI_z}{L^3}\begin{bmatrix}12&6L&-12&6L\\6L&4L^2&-6L&2L^2\\-12&-6L&12&-6L\\6L&2L^2&-6L&4L^2\end{bmatrix}}`} />
          <MatrixView M={e.local.bendXY.sub(BLOCKS.bendXY.idx, BLOCKS.bendXY.idx)} rowLabels={lab(BLOCKS.bendXY.idx)} colLabels={lab(BLOCKS.bendXY.idx)} color={() => COLORS.bending} />
          <Tex block tex={String.raw`\textcolor{${PURPLE}}{\tfrac{EI_y}{L^3}\begin{bmatrix}12&-6L&-12&-6L\\-6L&4L^2&6L&2L^2\\-12&6L&12&6L\\-6L&2L^2&6L&4L^2\end{bmatrix}}`} />
          <MatrixView M={e.local.bendXZ.sub(BLOCKS.bendXZ.idx, BLOCKS.bendXZ.idx)} rowLabels={lab(BLOCKS.bendXZ.idx)} colLabels={lab(BLOCKS.bendXZ.idx)} color={() => PURPLE} />
        </>
      ) : (
        <MatrixView M={e.local.k} rowLabels={LOCAL_D3} colLabels={LOCAL_D3} color={color} caption={<>k̂ in consistent units; blue = axial, green = torsion, red = x–y bending, purple = x–z bending</>} />
      )}

      {rel && (
        <>
          <h4>e) Releases: static condensation</h4>
          <Explain>
            This element has released rotation(s) at {[e.released.filter((x) => x < 6).length ? 'node i' : '', e.released.filter((x) => x >= 6).length ? 'node j' : ''].filter(Boolean).join(' and ')} (local DOFs {e.released.map((x) => LOCAL_D3[x].text).join(', ')}).
            The released DOFs (<i>c</i>) are eliminated: <Tex tex={String.raw`k^*=k_{rr}-k_{rc}\,k_{cc}^{-1}\,k_{cr}`} />, leaving a zero row and column at each.
          </Explain>
          <div className="row-wrap">
            <MatrixView M={rel.kCC} rowLabels={lab(rel.released)} colLabels={lab(rel.released)} caption="k_cc" />
            {rel.kCCinv && <MatrixView M={rel.kCCinv} rowLabels={lab(rel.released)} colLabels={lab(rel.released)} caption="k_cc⁻¹" />}
            {rel.correction && <MatrixView M={rel.correction} rowLabels={lab(rel.retained)} colLabels={lab(rel.retained)} caption="k_rc k_cc⁻¹ k_cr" forceTable />}
          </div>
          <MatrixView M={e.kLocalUsed} rowLabels={LOCAL_D3} colLabels={LOCAL_D3} color={color} caption="Condensed k̂*, used from here on" />
        </>
      )}
      {e.decoupled && (
        <Explain>Torsion is released at <b>both</b> ends, so the element can spin freely about its own axis: its torsion rows and columns are zeroed (they do not couple to anything else).</Explain>
      )}

      <h4>{rel || e.decoupled ? 'f' : 'e'}) Transformation matrix T</h4>
      <Explain>
        <Tex tex={String.raw`T=\mathrm{diag}(\lambda,\lambda,\lambda,\lambda)`} />: λ rotates, in turn, the translations at node i, the rotations at node i, the translations at node j, and the rotations at node j (rotations are vectors too). So <Tex tex={String.raw`\hat d=T\,d`} /> and, since T is orthogonal, <Tex tex={String.raw`k=T^{\mathsf T}\hat k\,T`} />.
      </Explain>
      <MatrixView M={e.T} rowLabels={LOCAL_D3} colLabels={gl} caption="T (12×12)" />

      <h4>{rel || e.decoupled ? 'g' : 'f'}) Global element matrix k = Tᵀ k̂ T</h4>
      <MatrixView M={e.kGlobal} rowLabels={gl} colLabels={gl} caption={<>k<sup>({e.id})</sup>, rows and columns labelled with the global DOFs from the ID array</>} />
      <div className="row-wrap">
        <Ok ok={sym}>k is symmetric</Ok>
        <Ok ok={rigid < 1e-9}>moving the whole element {rigid < 1e-9 ? 'rigidly in X produces no force' : `rigidly in X gives residual ${rigid.toExponential(1)}`}</Ok>
      </div>
      <Explain>A rigid translation must not strain the element, so k times that motion is zero (largest residual relative to the biggest entry: {rigid.toExponential(1)}).</Explain>
    </>
  );
}

/** Step 10 (3D): element end forces. */
export function StepForces3({ a, model, sel, setSel }: StepProps3) {
  const e = a.elements[Math.min(sel, a.elements.length) - 1];
  const u = units(model);
  const gl = e.idArray.map((id) => dl(id));
  const eq = e.equilibrium;
  const hasLoad = e.loads.length > 0;
  const f = e.endForces;
  const rows: [string, number, number][] = [
    ['Axial force N (along x̂)', f[0], f[6]],
    ['Shear along ŷ', f[1], f[7]],
    ['Shear along ẑ', f[2], f[8]],
    ['Torque about x̂', f[3], f[9]],
    ['Moment about ŷ', f[4], f[10]],
    ['Moment about ẑ', f[5], f[11]],
  ];
  return (
    <>
      <ElementSelector a={a} sel={sel} setSel={setSel} />
      <Explain>
        Back to each element: its end displacements in <b>local</b> axes, <Tex tex={String.raw`\hat d=T\,d`} />, give the end forces <Tex tex={String.raw`\hat f=\hat k\,\hat d${hasLoad ? '-\\hat f_{eq}' : ''}`} />, as forces and moments ON the element ends along x̂, ŷ, ẑ.
        {hasLoad ? ' The equivalent nodal load is subtracted because the member really carries the distributed load.' : ''}
      </Explain>
      <div className="row-wrap">
        <VectorView values={e.dGlobal} labels={gl} caption="d (global)" />
        <VectorView values={e.dLocalNodal} labels={LOCAL_D3} caption="T d (local)" />
        {e.condensation && <VectorView values={e.dLocal} labels={LOCAL_D3} caption="with released end rotations recovered" />}
      </div>
      {e.condensation && (
        <Explain>Released ends rotate independently of the node; their rotation is recovered from <Tex tex={String.raw`\hat d_c=k_{cc}^{-1}(\hat f_{eq,c}-k_{cr}\hat d_r)`} />, so the corresponding end moment comes out zero.</Explain>
      )}
      <div className="row-wrap">
        <VectorView values={e.kd} labels={LOCAL_F3} caption="k̂ d̂" />
        {hasLoad && <VectorView values={e.eqLocal} labels={LOCAL_F3} caption="− f̂_eq" />}
        <VectorView values={f} labels={LOCAL_F3} caption={<b>f̂ ({u.force}, {u.moment})</b>} />
      </div>
      <h4>Internal actions at the two ends (local axes)</h4>
      <table className="data">
        <thead><tr><th /><th>node {e.nodeI} (i)</th><th>node {e.nodeJ} (j)</th></tr></thead>
        <tbody>
          {rows.map(([name, i, j], k) => (
            <tr key={name}><td>{name} ({k < 3 ? u.force : u.moment})</td><td>{fmtNum(i)}</td><td>{fmtNum(j)}</td></tr>
          ))}
        </tbody>
      </table>
      <Explain>Forces are those acting on the element ends. A negative axial force at i with a positive one at j means tension; equal and opposite torques mean the member is twisted.</Explain>
      <div className="card">
        <b>Equilibrium of element {e.id}</b>{hasLoad ? ' (including its distributed load)' : ''}:
        <div>ΣF = ({eq.sumF.map((v) => fmtNum(v)).join(', ')}) <Ok ok={eq.ok}>{eq.ok ? 'balanced' : 'check'}</Ok></div>
        <div>ΣM about node i = ({eq.sumM.map((v) => fmtNum(v)).join(', ')}) <span className="muted small">(m̂₁ + m̂₂ + r₂ × f̂₂ {hasLoad ? '+ load moment' : ''}, with r₂ = (L, 0, 0))</span></div>
        <div className="muted small">Axial terms use f̂x, shears f̂y, f̂z; moment equilibrium about ŷ includes −L·f̂₂z and about ẑ includes +L·f̂₂y.</div>
      </div>
    </>
  );
}
