import type { ReactNode } from 'react';
import type { Analysis2D } from '../../fem/analyze2d';
import type { Analysis3D } from '../../fem/analyze3d';
import type { Matrix } from '../../linalg';
import { dofLabel, dofLabelTex, dofsPerNode, splitDof, UNIT_SYSTEMS, type Dimension, type FemModel } from '../../model';
import type { Label } from '../Tex';

export type AnyAnalysis = Analysis2D | Analysis3D;

export interface StepPropsBase<A> {
  a: A;
  model: FemModel;
  /** Selected element id (1-based). */
  sel: number;
  setSel: (id: number) => void;
  scale: number;
  setScale: (s: number) => void;
  autoScale: number;
}
export type StepProps = StepPropsBase<Analysis2D>;
export type StepProps3 = StepPropsBase<Analysis3D>;
export type StepPropsAny = StepPropsBase<AnyAnalysis>;

/** The parts of an element result that the dimension-independent steps (assembly, loads) use. */
export interface CommonEl {
  id: number;
  nodeI: number;
  nodeJ: number;
  idArray: number[];
  kGlobal: Matrix;
  loads: { local: object; eqLocal: Float64Array }[];
  eqLocal: Float64Array;
  eqLocalUsed: Float64Array;
  eqGlobal: Float64Array;
  condensation: unknown | null;
}

/**
 * Dimension used by the label helpers. App sets it (once per render) before any step renders, so the generic steps
 * can call dl()/dlIdx() without threading a parameter through every call.
 */
let DIM: Dimension = '2D';
export const setLabelDim = (d: Dimension) => { DIM = d; };
export const labelDim = () => DIM;
/** DOFs per node for the current dimension. */
export const kOf = () => dofsPerNode(DIM);
/** True if the 0-based global DOF index is a rotation. */
export const isRot = (i: number) => (DIM === '2D' ? i % 3 === 2 : i % 6 >= 3);

/** Label (LaTeX + plain) for the 1-based global DOF g. */
export const dl = (g: number): Label => {
  const { nodeId, local } = splitDof(g, DIM);
  return { tex: dofLabelTex(nodeId, local, DIM), text: dofLabel(nodeId, local, DIM) };
};
/** Same for a 0-based index. */
export const dlIdx = (i: number): Label => dl(i + 1);

export const LOCAL_D: Label[] = [
  { tex: String.raw`\hat d_{1x}`, text: 'd̂1x' }, { tex: String.raw`\hat d_{1y}`, text: 'd̂1y' }, { tex: String.raw`\hat\phi_{1}`, text: 'φ̂1' },
  { tex: String.raw`\hat d_{2x}`, text: 'd̂2x' }, { tex: String.raw`\hat d_{2y}`, text: 'd̂2y' }, { tex: String.raw`\hat\phi_{2}`, text: 'φ̂2' },
];
export const LOCAL_F: Label[] = [
  { tex: String.raw`\hat f_{1x}`, text: 'f̂1x' }, { tex: String.raw`\hat f_{1y}`, text: 'f̂1y' }, { tex: String.raw`\hat m_{1}`, text: 'm̂1' },
  { tex: String.raw`\hat f_{2x}`, text: 'f̂2x' }, { tex: String.raw`\hat f_{2y}`, text: 'f̂2y' }, { tex: String.raw`\hat m_{2}`, text: 'm̂2' },
];
const ax = ['x', 'y', 'z'];
export const LOCAL_D3: Label[] = [1, 2].flatMap((n) => [
  ...ax.map((c) => ({ tex: String.raw`\hat d_{${n}${c}}`, text: `d̂${n}${c}` })),
  ...ax.map((c) => ({ tex: String.raw`\hat\phi_{${n}${c}}`, text: `φ̂${n}${c}` })),
]);
export const LOCAL_F3: Label[] = [1, 2].flatMap((n) => [
  ...ax.map((c) => ({ tex: String.raw`\hat f_{${n}${c}}`, text: `f̂${n}${c}` })),
  ...ax.map((c) => ({ tex: String.raw`\hat m_{${n}${c}}`, text: `m̂${n}${c}` })),
]);
/** Local DOF / force labels for the current dimension (6 or 12 entries). */
export const localD = () => (DIM === '2D' ? LOCAL_D : LOCAL_D3);
export const localF = () => (DIM === '2D' ? LOCAL_F : LOCAL_F3);

export const units = (m: FemModel) => UNIT_SYSTEMS[m.units];

export const dofUnit = (i: number, m: FemModel) => (isRot(i) ? 'rad' : units(m).length);
export const loadUnit = (i: number, m: FemModel) => (isRot(i) ? units(m).moment : units(m).force);
/** Plain-words name of the local slot of a global 0-based DOF index. */
export const dofMeaning = (i: number) =>
  (DIM === '2D' ? ['x-translation', 'y-translation', 'rotation'] : ['x-translation', 'y-translation', 'z-translation', 'x-rotation', 'y-rotation', 'z-rotation'])[i % kOf()];
export const reactionMeaning = (i: number) =>
  (DIM === '2D' ? ['horizontal force', 'vertical force', 'moment'] : ['force in x', 'force in y', 'force in z', 'moment about x', 'moment about y', 'moment about z'])[i % kOf()];

/** K after adding only elements 1..upTo, from the elements' global matrices. */
export function runningK(els: CommonEl[], N: number, upTo: number): Matrix {
  // Matrix is imported as a type only; build through the first element's constructor to avoid a value import cycle.
  const M = new (els[0].kGlobal.constructor as new (r: number, c: number) => Matrix)(N, N);
  for (let e = 0; e < upTo; e++) {
    const ids = els[e].idArray;
    for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) M.add(ids[i] - 1, ids[j] - 1, els[e].kGlobal.get(i, j));
  }
  return M;
}

export function Explain({ children }: { children: ReactNode }) {
  return <p className="explain">{children}</p>;
}

export function ElementSelector({ a, sel, setSel }: { a: { elements: { id: number; nodeI: number; nodeJ: number }[] }; sel: number; setSel: (id: number) => void }) {
  const els = a.elements;
  const n = els.length;
  if (n > 12) {
    return (
      <div className="elsel">
        <button onClick={() => setSel(Math.max(1, sel - 1))} aria-label="Previous element">◀</button>
        <select value={sel} onChange={(e) => setSel(Number(e.target.value))} aria-label="Choose element">
          {els.map((e) => (
            <option key={e.id} value={e.id}>Element {e.id} (node {e.nodeI} → {e.nodeJ})</option>
          ))}
        </select>
        <button onClick={() => setSel(Math.min(n, sel + 1))} aria-label="Next element">▶</button>
      </div>
    );
  }
  return (
    <div className="elsel" role="tablist" aria-label="Choose element">
      {els.map((e) => (
        <button key={e.id} role="tab" aria-selected={e.id === sel} className={e.id === sel ? 'active' : ''} onClick={() => setSel(e.id)}>
          Element {e.id}
        </button>
      ))}
    </div>
  );
}

export function Ok({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <span className={ok ? 'pill ok' : 'pill bad'}>{ok ? '✓' : '✗'} {children}</span>;
}
