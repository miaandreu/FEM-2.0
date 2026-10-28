import { Matrix, solveSystem, type SolveResult } from '../linalg';
import { describeDof, dofsPerNode, globalDofLabel, splitDof, type Dimension, type Support, type ValidationIssue } from '../model';
import type { DofClass } from './analyze2d';

/**
 * Dimension-independent back half of the analysis: classify DOFs, partition,
 * solve the reduced system, recover reactions. Mirrors the 2D pipeline step for step
 * (see analyze2d.ts); used by the 3D analysis.
 */
export interface CoreInput {
  dim: Dimension;
  nNodes: number;
  /** Node pairs of every element (to decide whether a zero-stiffness DOF belongs to a connected node). */
  elementNodes: { nodeI: number; nodeJ: number }[];
  K: Matrix;
  F: Float64Array;
  supports: Support[];
  issues: ValidationIssue[];
}

export interface CoreResult {
  ok: boolean;
  dofClass: DofClass;
  prescribed: Float64Array;
  Kff: Matrix;
  Kfc: Matrix;
  Kcf: Matrix;
  Kcc: Matrix;
  Ff: Float64Array;
  Fc: Float64Array;
  dc: Float64Array;
  KfcDc: Float64Array;
  rhs: Float64Array;
  solve: SolveResult | null;
  d: Float64Array;
  reactions: Float64Array;
  reactionParts: { KcfDf: Float64Array; KccDc: Float64Array };
  isConstrained: boolean[];
}

export function solveCore(inp: CoreInput, extraRemoved: Map<number, string> = new Map()): CoreResult {
  const { dim, K, F } = inp;
  // Issues found in this pass are only committed to inp.issues at the end (a retry must not duplicate them).
  const issues: ValidationIssue[] = [];
  const commit = () => inp.issues.push(...issues);
  const k = dofsPerNode(dim);
  const nDof = inp.nNodes * k;
  const prescribed = new Float64Array(nDof);
  const isConstrained = new Array<boolean>(nDof).fill(false);
  for (const s of inp.supports) {
    s.fixed.forEach((f, d) => {
      if (!f) return;
      const i = (s.nodeId - 1) * k + d;
      isConstrained[i] = true;
      prescribed[i] = s.prescribed[d];
    });
  }
  const kScale = Math.max(K.maxAbs(), 1e-300);
  const constrained: number[] = [];
  const free: number[] = [];
  const removed: DofClass['removed'] = [];
  for (let i = 0; i < nDof; i++) {
    if (isConstrained[i]) { constrained.push(i); continue; }
    if (extraRemoved.has(i)) {
      removed.push({ dof: i, reason: 'hinge', text: extraRemoved.get(i)! });
      continue;
    }
    let rowMax = 0;
    for (let j = 0; j < nDof; j++) rowMax = Math.max(rowMax, Math.abs(K.get(i, j)));
    if (rowMax > 1e-12 * kScale) { free.push(i); continue; }
    const { nodeId, local } = splitDof(i + 1, dim);
    const connected = inp.elementNodes.some((e) => e.nodeI === nodeId || e.nodeJ === nodeId);
    if (Math.abs(F[i]) > 0) {
      issues.push({
        severity: 'error', code: 'LOAD_ON_UNRESISTED_DOF', table: 'nodalLoads',
        message: `A load acts on ${describeDof(i + 1, dim)}, but nothing resists that motion (${connected ? 'every element at this node releases it' : 'the node is not connected to any element'}). The structure would move without limit; add stiffness or a support.`,
      });
    }
    removed.push({
      dof: i,
      reason: connected ? 'hinge' : 'unconnected',
      text: connected
        ? `${describeDof(i + 1, dim)} has zero stiffness: every element meeting at node ${nodeId} releases its end ${local >= dofsPerNode(dim) / 2 && dim === '3D' || local === 2 && dim === '2D' ? 'moment' : 'DOF'} there, so the node is a free hinge for that rotation. It is not needed to solve the structure and is removed from the solve (each member's own end rotation is recovered afterwards).`
        : `${describeDof(i + 1, dim)} belongs to node ${nodeId}, which is not connected to any element, so it is left out of the solve.`,
    });
  }
  const dofClass: DofClass = { free, constrained, removed };
  const Kff = K.sub(free, free);
  const Kfc = K.sub(free, constrained);
  const Kcf = K.sub(constrained, free);
  const Kcc = K.sub(constrained, constrained);
  const Ff = Float64Array.from(free, (i) => F[i]);
  const Fc = Float64Array.from(constrained, (i) => F[i]);
  const dc = Float64Array.from(constrained, (i) => prescribed[i]);
  const KfcDc = Kfc.mulVec(dc);
  const rhs = Float64Array.from(Ff, (v, i) => v - KfcDc[i]);
  const d = new Float64Array(nDof);
  const empty = new Float64Array(0);
  const base = { dofClass, prescribed, Kff, Kfc, Kcf, Kcc, Ff, Fc, dc, KfcDc, rhs, isConstrained };

  let solve: SolveResult | null = null;
  if (free.length > 0) {
    solve = solveSystem(Kff, rhs);
    if (solve.singular && solve.gauss && solve.gauss.freeColumns.length > 0 && extraRemoved.size < 12) {
      // A rotation about an INCLINED hinge axis has zero stiffness without any single DOF row being zero. If every
      // mechanism is such a rotation of one node (and the loads do not push on it), it is harmless: remove it.
      const g = solve.gauss;
      const newly = new Map<number, string>();
      const rhsNorm = Math.hypot(...Array.from(rhs));
      const ok = g.freeColumns.every((col, idx) => {
        const v = g.nullVectors[idx];
        const support = Array.from(v).map((val, j) => ({ val, j })).filter((o) => Math.abs(o.val) > 1e-8);
        const nodes = new Set(support.map((o) => splitDof(free[o.j] + 1, dim).nodeId));
        const allRot = support.every((o) => splitDof(free[o.j] + 1, dim).local >= (dim === '3D' ? 3 : 2));
        let dotv = 0;
        support.forEach((o) => (dotv += rhs[o.j] * o.val));
        const compatible = Math.abs(dotv) <= 1e-9 * Math.max(rhsNorm, 1e-300);
        if (nodes.size !== 1 || !allRot || !compatible) return false;
        const gi = free[col];
        const node = splitDof(gi + 1, dim).nodeId;
        newly.set(gi, `Node ${node} can rotate freely about an axis that is not a global axis: every element meeting there releases its end moment about that axis (an inclined hinge), so that rotation has zero stiffness. It is not needed to solve the structure; ${describeDof(gi + 1, dim)} is set to zero in the solve (any value gives the same member forces) and each member's own end rotation is recovered afterwards.`);
        return true;
      });
      if (ok && newly.size > 0) {
        const merged = new Map([...extraRemoved, ...newly]);
        return solveCore(inp, merged);
      }
    }
    if (solve.singular || !solve.x) {
      const g = solve.gauss;
      const lines = (g?.freeColumns ?? []).map((col, idx) => {
        const v = g!.nullVectors[idx];
        const moving = Array.from(v).map((val, j) => ({ val, j })).filter((o) => Math.abs(o.val) > 1e-6 && o.j !== col).map((o) => globalDofLabel(free[o.j] + 1, dim));
        return `The structure can move freely in DOF ${describeDof(free[col] + 1, dim)}${moving.length ? ` (together with ${moving.join(', ')})` : ''}; add a support or check releases.`;
      });
      for (const text of lines.length ? lines : ['The structure is unstable (singular stiffness matrix); add supports or check releases.']) {
        issues.push({ severity: 'error', code: 'STRUCTURE_UNSTABLE', table: 'model', message: text });
      }
      commit();
      return { ...base, ok: false, solve, d, reactions: empty, reactionParts: { KcfDf: empty, KccDc: empty } };
    }
    const spread = solve.gauss?.pivotSpread ?? (solve.cholesky ? solve.cholesky.maxPivot / solve.cholesky.minPivot : 1);
    if (spread > 1e12) {
      issues.push({ severity: 'warning', code: 'ILL_CONDITIONED', table: 'model', message: `The reduced stiffness matrix is badly scaled (largest/smallest pivot ≈ ${spread.toExponential(1)}). Results may lose accuracy; check for extremely different member sizes or near-mechanisms.` });
    }
    free.forEach((gi, i) => (d[gi] = solve!.x![i]));
  }
  constrained.forEach((gi, i) => (d[gi] = dc[i]));
  const df = Float64Array.from(free, (i) => d[i]);
  const KcfDf = Kcf.mulVec(df);
  const KccDc = Kcc.mulVec(dc);
  const reactions = Float64Array.from(constrained, (_, i) => KcfDf[i] + KccDc[i] - Fc[i]);
  commit();
  return { ...base, ok: !inp.issues.some((i) => i.severity === 'error'), solve, d, reactions, reactionParts: { KcfDf, KccDc } };
}
