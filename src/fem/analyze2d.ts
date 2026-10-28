import { Matrix, solveSystem, type SolveResult } from '../linalg';
import {
  describeDof,
  dofsPerNode,
  elementIdArray,
  globalDofLabel,
  hasErrors,
  splitDof,
  validateModel,
  type FemModel,
  type ValidationIssue,
} from '../model';
import { elementMatrices2D, geometry2D, releasedLocalDofs2D, type ElementMatrices2D } from './element2d';
import { equivalentNodalLoadLocal, loadResultantLocal, localLoadComponents, type LocalLoad2D } from './loads2d';

/**
 * Full 2D frame analysis, structured as the sequence of steps the UI walks through.
 * Every array indexed by DOF is 0-based internally (global DOF number = index + 1).
 */

export interface ElementLoadResult2D {
  loadIndex: number;
  local: LocalLoad2D;
  /** Equivalent nodal load, local coordinates (before condensation). */
  eqLocal: Float64Array;
  resultant: { Fx: number; Fy: number; Mi: number };
}

export interface ElementResult2D extends ElementMatrices2D {
  id: number;
  nodeI: number;
  nodeJ: number;
  E: number;
  A: number;
  I: number;
  idArray: number[];
  loads: ElementLoadResult2D[];
  /** Sum of equivalent nodal loads, local, before condensation. */
  eqLocal: Float64Array;
  /** Equivalent nodal loads actually used (condensed if released), local. */
  eqLocalUsed: Float64Array;
  /** Same, in global coordinates: Tᵀ f. */
  eqGlobal: Float64Array;
  // ---- filled after the solve ----
  dGlobal: Float64Array;
  /** T d: node displacements in local axes (as in Logan Eq. 5.2.9). */
  dLocalNodal: Float64Array;
  /** Member-end displacements: nodal values with released end rotations recovered. */
  dLocal: Float64Array;
  /** f̂ = k̂ d̂ − F_eq (local end forces; component order [f1x f1y m1 f2x f2y m2]). */
  endForces: Float64Array;
  /** k̂ d̂ before subtracting the load term. */
  kd: Float64Array;
  equilibrium: { sumFx: number; sumFy: number; sumM: number; ok: boolean };
}

export interface LoadSource2D {
  kind: 'nodal' | 'element';
  value: number;
  elementId?: number;
}

export interface DofClass {
  free: number[];
  constrained: number[];
  /** Free DOFs with no stiffness and no load (e.g. a node whose elements all release the rotation). */
  removed: { dof: number; reason: 'hinge' | 'unconnected'; text: string }[];
}

export interface Analysis2D {
  ok: boolean;
  issues: ValidationIssue[];
  model: FemModel;
  nDof: number;
  elements: ElementResult2D[];
  K: Matrix;
  /** Global load vector F with per-entry sources. */
  F: Float64Array;
  loadSources: LoadSource2D[][];
  dofClass: DofClass;
  prescribed: Float64Array;
  /** Partition (index lists are 0-based global DOFs). */
  Kff: Matrix;
  Kfc: Matrix;
  Kcf: Matrix;
  Kcc: Matrix;
  Ff: Float64Array;
  Fc: Float64Array;
  dc: Float64Array;
  /** K_fc d_c */
  KfcDc: Float64Array;
  /** F_f − K_fc d_c */
  rhs: Float64Array;
  solve: SolveResult | null;
  d: Float64Array;
  /** R = K_cf d_f + K_cc d_c − F_c, aligned with dofClass.constrained. */
  reactions: Float64Array;
  /** Springs to ground that carry force on free DOFs: dof index -> force on structure. */
  globalEquilibrium: { sumFx: number; sumFy: number; sumM: number; scale: number; ok: boolean } | null;
  /** The constrained DOFs' K_cf d_f and K_cc d_c pieces, for showing the reaction product. */
  reactionParts: { KcfDf: Float64Array; KccDc: Float64Array };
}

const EQ_TOL = 1e-6;

/** K after adding only elements 1..upTo (for the "running sum" assembly view). */
export function runningStiffness(a: Pick<Analysis2D, 'elements' | 'nDof'>, upTo: number): Matrix {
  const K = Matrix.zeros(a.nDof);
  for (let e = 0; e < upTo; e++) scatter(K, a.elements[e].kGlobal, a.elements[e].idArray);
  return K;
}

function scatter(K: Matrix, k: Matrix, ids: number[]) {
  for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) K.add(ids[i] - 1, ids[j] - 1, k.get(i, j));
}

export function analyze2D(model: FemModel): Analysis2D {
  const issues = validateModel(model);
  const dim = '2D' as const;
  const k = dofsPerNode(dim);
  const nDof = model.nodes.length * k;
  const empty = (): Analysis2D => ({
    ok: false, issues, model, nDof, elements: [], K: Matrix.zeros(0), F: new Float64Array(0), loadSources: [],
    dofClass: { free: [], constrained: [], removed: [] }, prescribed: new Float64Array(0),
    Kff: Matrix.zeros(0), Kfc: Matrix.zeros(0), Kcf: Matrix.zeros(0), Kcc: Matrix.zeros(0),
    Ff: new Float64Array(0), Fc: new Float64Array(0), dc: new Float64Array(0), KfcDc: new Float64Array(0), rhs: new Float64Array(0),
    solve: null, d: new Float64Array(0), reactions: new Float64Array(0), globalEquilibrium: null,
    reactionParts: { KcfDf: new Float64Array(0), KccDc: new Float64Array(0) },
  });
  if (hasErrors(issues)) return empty();

  // ---- steps 3–4: element matrices and assembly ---------------------------
  const K = Matrix.zeros(nDof);
  const elements: ElementResult2D[] = model.elements.map((el) => {
    const ni = model.nodes[el.nodeI - 1];
    const nj = model.nodes[el.nodeJ - 1];
    const mat = model.materials[el.materialId - 1];
    const sec = model.sections[el.sectionId - 1];
    const g = geometry2D(ni, nj);
    const m = elementMatrices2D(mat.E, sec.A, sec.Iz, g, releasedLocalDofs2D(el.releaseI.rz, el.releaseJ.rz));
    const idArray = elementIdArray(el, dim);
    scatter(K, m.kGlobal, idArray);

    const loads: ElementLoadResult2D[] = [];
    const eqLocal = new Float64Array(6);
    model.elementLoads.forEach((ld, loadIndex) => {
      if (ld.elementId !== el.id) return;
      const local = localLoadComponents(ld, g);
      const eq = equivalentNodalLoadLocal(local, g.L);
      for (let i = 0; i < 6; i++) eqLocal[i] += eq[i];
      loads.push({ loadIndex, local, eqLocal: eq, resultant: loadResultantLocal(local, g.L) });
    });
    let eqLocalUsed = eqLocal;
    if (m.condensation && m.condensation.gain) {
      eqLocalUsed = new Float64Array(6);
      const r = m.condensation.retained;
      const c = m.condensation.released;
      const corr = m.condensation.gain.mulVec(c.map((i) => eqLocal[i]));
      r.forEach((idx, i) => (eqLocalUsed[idx] = eqLocal[idx] - corr[i]));
    }
    const eqGlobal = m.T.transpose().mulVec(eqLocalUsed);
    const z = new Float64Array(6);
    return {
      ...m, id: el.id, nodeI: el.nodeI, nodeJ: el.nodeJ, E: mat.E, A: sec.A, I: sec.Iz, idArray, loads,
      eqLocal, eqLocalUsed, eqGlobal, dGlobal: z, dLocalNodal: z, dLocal: z, endForces: z, kd: z,
      equilibrium: { sumFx: 0, sumFy: 0, sumM: 0, ok: true },
    };
  });
  for (const sp of model.springs) K.add(sp.nodeId * k - k + sp.dof, sp.nodeId * k - k + sp.dof, sp.k);

  // ---- step 5: global load vector with sources ----------------------------
  const F = new Float64Array(nDof);
  const loadSources: LoadSource2D[][] = Array.from({ length: nDof }, () => []);
  for (const l of model.nodalLoads) {
    const i = (l.nodeId - 1) * k + l.dof;
    F[i] += l.value;
    loadSources[i].push({ kind: 'nodal', value: l.value });
  }
  for (const e of elements) {
    if (!e.loads.length) continue;
    e.idArray.forEach((gid, i) => {
      if (e.eqGlobal[i] === 0) return;
      F[gid - 1] += e.eqGlobal[i];
      loadSources[gid - 1].push({ kind: 'element', value: e.eqGlobal[i], elementId: e.id });
    });
  }

  // ---- step 6: classify and partition DOFs --------------------------------
  const constrained: number[] = [];
  const prescribed = new Float64Array(nDof);
  const isConstrained = new Array<boolean>(nDof).fill(false);
  for (const s of model.supports) {
    s.fixed.forEach((f, d) => {
      if (!f) return;
      const i = (s.nodeId - 1) * k + d;
      isConstrained[i] = true;
      prescribed[i] = s.prescribed[d];
    });
  }
  const kScale = Math.max(K.maxAbs(), 1e-300);
  const free: number[] = [];
  const removed: DofClass['removed'] = [];
  for (let i = 0; i < nDof; i++) {
    if (isConstrained[i]) {
      constrained.push(i);
      continue;
    }
    let rowMax = 0;
    for (let j = 0; j < nDof; j++) rowMax = Math.max(rowMax, Math.abs(K.get(i, j)));
    if (rowMax <= 1e-12 * kScale) {
      const { nodeId, local } = splitDof(i + 1, dim);
      const connected = model.elements.some((e) => e.nodeI === nodeId || e.nodeJ === nodeId);
      if (Math.abs(F[i]) > 0) {
        issues.push({
          severity: 'error', code: 'LOAD_ON_UNRESISTED_DOF', table: 'nodalLoads',
          message: `A load acts on ${describeDof(i + 1, dim)}, but nothing resists that motion (${connected ? 'every element at this node releases it' : 'the node is not connected to any element'}). The structure would move without limit; add stiffness or a support.`,
        });
      }
      removed.push({
        dof: i, reason: connected ? 'hinge' : 'unconnected',
        text: connected
          ? `${describeDof(i + 1, dim)} has zero stiffness: every element meeting at node ${nodeId} releases its end ${local === 2 ? 'moment' : 'DOF'}, so the node is a free hinge there. Its rotation is not needed to solve the structure and is removed from the solve (each member's own end rotation is recovered afterwards).`
          : `${describeDof(i + 1, dim)} belongs to node ${nodeId}, which is not connected to any element, so it is left out of the solve.`,
      });
    } else free.push(i);
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

  // ---- step 7: solve -------------------------------------------------------
  let solve: SolveResult | null = null;
  const d = new Float64Array(nDof);
  if (free.length > 0) {
    solve = solveSystem(Kff, rhs);
    if (solve.singular || !solve.x) {
      const g = solve.gauss;
      const lines = (g?.freeColumns ?? []).map((col, idx) => {
        const dof = free[col] + 1;
        const v = g!.nullVectors[idx];
        const moving = Array.from(v).map((val, j) => ({ val, j })).filter((o) => Math.abs(o.val) > 1e-6 && o.j !== col).map((o) => globalDofLabel(free[o.j] + 1, dim));
        return `The structure can move freely in DOF ${describeDof(dof, dim)}${moving.length ? ` (together with ${moving.join(', ')})` : ''}; add a support or check releases.`;
      });
      for (const text of lines.length ? lines : ['The structure is unstable (singular stiffness matrix); add supports or check releases.']) {
        issues.push({ severity: 'error', code: 'STRUCTURE_UNSTABLE', table: 'model', message: text });
      }
      return { ...empty(), ok: false, issues, elements, K, F, loadSources, dofClass, prescribed, Kff, Kfc, Kcf, Kcc, Ff, Fc, dc, KfcDc, rhs, solve, nDof };
    }
    const spread = solve.gauss?.pivotSpread ?? (solve.cholesky ? solve.cholesky.maxPivot / solve.cholesky.minPivot : 1);
    if (spread > 1e12) {
      issues.push({ severity: 'warning', code: 'ILL_CONDITIONED', table: 'model', message: `The reduced stiffness matrix is badly scaled (largest/smallest pivot ≈ ${spread.toExponential(1)}). Results may lose accuracy; check for extremely different member sizes or near-mechanisms.` });
    }
    free.forEach((gi, i) => (d[gi] = solve!.x![i]));
  }
  constrained.forEach((gi, i) => (d[gi] = dc[i]));

  // ---- step 9: reactions from the ORIGINAL equations -----------------------
  const df = Float64Array.from(free, (i) => d[i]);
  const KcfDf = Kcf.mulVec(df);
  const KccDc = Kcc.mulVec(dc);
  const reactions = Float64Array.from(constrained, (_, i) => KcfDf[i] + KccDc[i] - Fc[i]);

  // ---- step 10: member end forces and equilibrium --------------------------
  // Floor for equilibrium tolerances: element forces that are pure round-off must not be judged against themselves.
  const modelForceScale = Math.max(1e-300, ...Array.from(F, Math.abs), ...Array.from(reactions, Math.abs));
  for (const e of elements) {
    const dG = Float64Array.from(e.idArray, (gid) => d[gid - 1]);
    const dN = e.T.mulVec(dG);
    const dL = Float64Array.from(dN);
    if (e.condensation?.kCCinv) {
      const c = e.condensation;
      const rhsC = c.released.map((ci) => e.eqLocal[ci] - c.retained.reduce((s, ri) => s + e.local.k.get(ci, ri) * dN[ri], 0));
      const dc2 = c.kCCinv!.mulVec(rhsC);
      c.released.forEach((ci, i) => (dL[ci] = dc2[i]));
    }
    const kd = e.local.k.mulVec(dL);
    const f = Float64Array.from(kd, (v, i) => v - e.eqLocal[i]);
    const L = e.geometry.L;
    const rs = e.loads.reduce((a, l) => ({ Fx: a.Fx + l.resultant.Fx, Fy: a.Fy + l.resultant.Fy, Mi: a.Mi + l.resultant.Mi }), { Fx: 0, Fy: 0, Mi: 0 });
    const sumFx = f[0] + f[3] + rs.Fx;
    const sumFy = f[1] + f[4] + rs.Fy;
    const sumM = f[2] + f[5] + f[4] * L + rs.Mi;
    const sc = Math.max(modelForceScale, ...Array.from(f, Math.abs), Math.abs(rs.Fy), Math.abs(rs.Fx));
    e.dGlobal = dG;
    e.dLocalNodal = dN;
    e.dLocal = dL;
    e.kd = kd;
    e.endForces = f;
    e.equilibrium = {
      sumFx, sumFy, sumM,
      ok: Math.abs(sumFx) <= EQ_TOL * sc && Math.abs(sumFy) <= EQ_TOL * sc && Math.abs(sumM) <= EQ_TOL * sc * Math.max(L, 1),
    };
  }

  // ---- global equilibrium: applied/equivalent loads + reactions (+ ground springs) = 0 ----
  const total = [0, 0, 0];
  let fScale = 0;
  const addForce = (nodeId: number, local: number, v: number) => {
    const n = model.nodes[nodeId - 1];
    if (local === 0) { total[0] += v; total[2] -= n.y * v; }
    else if (local === 1) { total[1] += v; total[2] += n.x * v; }
    else total[2] += v;
    fScale = Math.max(fScale, Math.abs(v));
  };
  for (let i = 0; i < nDof; i++) {
    const { nodeId, local } = splitDof(i + 1, dim);
    if (F[i] !== 0) addForce(nodeId, local, F[i]);
  }
  constrained.forEach((gi, i) => {
    const { nodeId, local } = splitDof(gi + 1, dim);
    addForce(nodeId, local, reactions[i]);
  });
  for (const sp of model.springs) {
    const gi = (sp.nodeId - 1) * k + sp.dof;
    if (!isConstrained[gi]) addForce(sp.nodeId, sp.dof, -sp.k * d[gi]);
  }
  const globalEquilibrium = {
    sumFx: total[0], sumFy: total[1], sumM: total[2], scale: fScale,
    ok: fScale === 0 || Math.max(Math.abs(total[0]), Math.abs(total[1])) <= EQ_TOL * fScale * 10 && Math.abs(total[2]) <= EQ_TOL * fScale * 10 * Math.max(1, ...model.nodes.map((n) => Math.hypot(n.x, n.y))),
  };

  return {
    ok: !issues.some((i) => i.severity === 'error'), issues, model, nDof, elements, K, F, loadSources, dofClass, prescribed, Kff, Kfc, Kcf, Kcc, Ff, Fc, dc, KfcDc, rhs,
    solve, d, reactions, globalEquilibrium, reactionParts: { KcfDf, KccDc },
  };
}

/**
 * Deformed centerline of one member, using cubic Hermite shape functions for the
 * transverse displacement and a linear axial displacement, scaled by `scale`.
 * (With distributed loads the true curve also has a particular-solution term that
 * this display shape omits; end values are exact.)
 */
export function deformedMember2D(a: Analysis2D, e: ElementResult2D, scale: number, nPts = 21) {
  const ni = a.model.nodes[e.nodeI - 1];
  const { L, C, S } = e.geometry;
  const [u1, v1, t1, u2, v2, t2] = e.dLocal;
  const undeformed: { x: number; y: number }[] = [];
  const deformed: { x: number; y: number }[] = [];
  for (let p = 0; p < nPts; p++) {
    const s = p / (nPts - 1);
    const N1 = 1 - 3 * s * s + 2 * s ** 3;
    const N2 = s - 2 * s * s + s ** 3;
    const N3 = 3 * s * s - 2 * s ** 3;
    const N4 = -(s * s) + s ** 3;
    const u = (1 - s) * u1 + s * u2;
    const v = N1 * v1 + N2 * L * t1 + N3 * v2 + N4 * L * t2;
    const lx = s * L;
    undeformed.push({ x: ni.x + lx * C, y: ni.y + lx * S });
    const px = lx + scale * u;
    const py = scale * v;
    deformed.push({ x: ni.x + px * C - py * S, y: ni.y + px * S + py * C });
  }
  return { undeformed, deformed };
}
