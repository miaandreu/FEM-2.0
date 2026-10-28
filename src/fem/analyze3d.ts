import { Matrix } from '../linalg';
import { dofsPerNode, elementIdArray, hasErrors, resolveShearModulus, splitDof, validateModel, type FemModel, type ValidationIssue } from '../model';
import { solveCore, type CoreResult } from './core';
import { elementMatrices3D, orientation3D, releasedLocalDofs3D, type ElementMatrices3D } from './element3d';
import { equivalentNodalLoadLocal3D, loadResultantLocal3D, localLoadComponents3D, type LocalLoad3D } from './loads3d';
import type { LoadSource2D } from './analyze2d';

/** Full 3D frame analysis; same step structure as analyze2d, with 6 DOF per node. */

export interface ElementLoadResult3D {
  loadIndex: number;
  local: LocalLoad3D;
  eqLocal: Float64Array;
  resultant: { F: [number, number, number]; M: [number, number, number] };
}

export interface ElementResult3D extends ElementMatrices3D {
  id: number;
  nodeI: number;
  nodeJ: number;
  E: number;
  G: number;
  Gsource: 'G' | 'nu' | 'default-nu';
  A: number;
  Iy: number;
  Iz: number;
  J: number;
  idArray: number[];
  loads: ElementLoadResult3D[];
  eqLocal: Float64Array;
  eqLocalUsed: Float64Array;
  eqGlobal: Float64Array;
  dGlobal: Float64Array;
  dLocalNodal: Float64Array;
  dLocal: Float64Array;
  endForces: Float64Array;
  kd: Float64Array;
  equilibrium: { sumF: [number, number, number]; sumM: [number, number, number]; ok: boolean };
}

export interface Analysis3D extends CoreResult {
  issues: ValidationIssue[];
  model: FemModel;
  nDof: number;
  elements: ElementResult3D[];
  K: Matrix;
  F: Float64Array;
  loadSources: LoadSource2D[][];
  globalEquilibrium: { sumF: [number, number, number]; sumM: [number, number, number]; scale: number; ok: boolean } | null;
}

const EQ_TOL = 1e-6;

function scatter(K: Matrix, k: Matrix, ids: number[]) {
  for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) K.add(ids[i] - 1, ids[j] - 1, k.get(i, j));
}

export function runningStiffness3D(a: Pick<Analysis3D, 'elements' | 'nDof'>, upTo: number): Matrix {
  const K = Matrix.zeros(a.nDof);
  for (let e = 0; e < upTo; e++) scatter(K, a.elements[e].kGlobal, a.elements[e].idArray);
  return K;
}

const emptyCore = (): CoreResult => ({
  ok: false, dofClass: { free: [], constrained: [], removed: [] }, prescribed: new Float64Array(0),
  Kff: Matrix.zeros(0), Kfc: Matrix.zeros(0), Kcf: Matrix.zeros(0), Kcc: Matrix.zeros(0),
  Ff: new Float64Array(0), Fc: new Float64Array(0), dc: new Float64Array(0), KfcDc: new Float64Array(0), rhs: new Float64Array(0),
  solve: null, d: new Float64Array(0), reactions: new Float64Array(0), reactionParts: { KcfDf: new Float64Array(0), KccDc: new Float64Array(0) }, isConstrained: [],
});

export function analyze3D(model: FemModel): Analysis3D {
  const issues = validateModel(model);
  const dim = '3D' as const;
  const k = dofsPerNode(dim);
  const nDof = model.nodes.length * k;
  if (hasErrors(issues)) {
    return { ...emptyCore(), issues, model, nDof, elements: [], K: Matrix.zeros(0), F: new Float64Array(0), loadSources: [], globalEquilibrium: null };
  }

  const K = Matrix.zeros(nDof);
  const elements: ElementResult3D[] = model.elements.map((el) => {
    const ni = model.nodes[el.nodeI - 1];
    const nj = model.nodes[el.nodeJ - 1];
    const mat = model.materials[el.materialId - 1];
    const sec = model.sections[el.sectionId - 1];
    const { G, source } = resolveShearModulus(mat);
    const o = orientation3D(ni, nj, el.refVector, el.rollAngleDeg ?? 0);
    const m = elementMatrices3D(mat.E, G, sec.A, sec.Iy, sec.Iz, sec.J, o, releasedLocalDofs3D(el.releaseI, el.releaseJ));
    const idArray = elementIdArray(el, dim);
    scatter(K, m.kGlobal, idArray);

    const loads: ElementLoadResult3D[] = [];
    const eqLocal = new Float64Array(12);
    model.elementLoads.forEach((ld, loadIndex) => {
      if (ld.elementId !== el.id) return;
      const local = localLoadComponents3D(ld, o);
      const eq = equivalentNodalLoadLocal3D(local, o.L);
      for (let i = 0; i < 12; i++) eqLocal[i] += eq[i];
      loads.push({ loadIndex, local, eqLocal: eq, resultant: loadResultantLocal3D(local, o.L) });
    });
    let eqLocalUsed = eqLocal;
    if (m.condensation?.gain) {
      eqLocalUsed = new Float64Array(12);
      const corr = m.condensation.gain.mulVec(m.condensation.released.map((i) => eqLocal[i]));
      m.condensation.retained.forEach((idx, i) => (eqLocalUsed[idx] = eqLocal[idx] - corr[i]));
    }
    if (m.decoupled) {
      eqLocalUsed = Float64Array.from(eqLocalUsed);
      eqLocalUsed[3] = 0;
      eqLocalUsed[9] = 0;
    }
    const eqGlobal = m.T.transpose().mulVec(eqLocalUsed);
    const z = new Float64Array(12);
    return {
      ...m, id: el.id, nodeI: el.nodeI, nodeJ: el.nodeJ, E: mat.E, G, Gsource: source, A: sec.A, Iy: sec.Iy, Iz: sec.Iz, J: sec.J,
      idArray, loads, eqLocal, eqLocalUsed, eqGlobal, dGlobal: z, dLocalNodal: z, dLocal: z, endForces: z, kd: z,
      equilibrium: { sumF: [0, 0, 0], sumM: [0, 0, 0], ok: true },
    };
  });
  for (const sp of model.springs) K.add((sp.nodeId - 1) * k + sp.dof, (sp.nodeId - 1) * k + sp.dof, sp.k);

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

  const core = solveCore({ dim, nNodes: model.nodes.length, elementNodes: model.elements, K, F, supports: model.supports, issues });
  const base = { issues, model, nDof, elements, K, F, loadSources, ...core };
  if (!core.ok) return { ...base, globalEquilibrium: null };
  const { d, reactions } = core;

  // ---- member end forces: f̂ = k̂ d̂ − F_eq, with released end rotations recovered ----
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
    const L = e.orientation.L;
    const rs = e.loads.reduce((a, l) => ({
      F: [a.F[0] + l.resultant.F[0], a.F[1] + l.resultant.F[1], a.F[2] + l.resultant.F[2]] as [number, number, number],
      M: [a.M[0] + l.resultant.M[0], a.M[1] + l.resultant.M[1], a.M[2] + l.resultant.M[2]] as [number, number, number],
    }), { F: [0, 0, 0] as [number, number, number], M: [0, 0, 0] as [number, number, number] });
    const sumF: [number, number, number] = [f[0] + f[6] + rs.F[0], f[1] + f[7] + rs.F[1], f[2] + f[8] + rs.F[2]];
    // moments about node i: m1 + m2 + r2 × f2 (r2 = (L,0,0) ⇒ (0, −L f2z, L f2y)) + load moment
    const sumM: [number, number, number] = [f[3] + f[9] + rs.M[0], f[4] + f[10] - L * f[8] + rs.M[1], f[5] + f[11] + L * f[7] + rs.M[2]];
    const sc = Math.max(modelForceScale, ...Array.from(f, Math.abs));
    e.dGlobal = dG; e.dLocalNodal = dN; e.dLocal = dL; e.kd = kd; e.endForces = f;
    e.equilibrium = { sumF, sumM, ok: [...sumF, ...sumM.map((m) => m / Math.max(L, 1))].every((v) => Math.abs(v) <= EQ_TOL * sc) };
  }

  // ---- global equilibrium: loads + reactions (+ ground springs), moments about the origin ----
  const tf = [0, 0, 0], tm = [0, 0, 0];
  let fScale = 0;
  let lScale = 1;
  const addForce = (nodeId: number, local: number, v: number) => {
    const n = model.nodes[nodeId - 1];
    lScale = Math.max(lScale, Math.hypot(n.x, n.y, n.z));
    fScale = Math.max(fScale, Math.abs(v));
    if (local < 3) {
      const r = [n.x, n.y, n.z];
      const F3 = [0, 0, 0];
      F3[local] = v;
      tf[local] += v;
      tm[0] += r[1] * F3[2] - r[2] * F3[1];
      tm[1] += r[2] * F3[0] - r[0] * F3[2];
      tm[2] += r[0] * F3[1] - r[1] * F3[0];
    } else tm[local - 3] += v;
  };
  for (let i = 0; i < nDof; i++) if (F[i] !== 0) { const s = splitDof(i + 1, dim); addForce(s.nodeId, s.local, F[i]); }
  core.dofClass.constrained.forEach((gi, i) => { const s = splitDof(gi + 1, dim); addForce(s.nodeId, s.local, reactions[i]); });
  for (const sp of model.springs) {
    const gi = (sp.nodeId - 1) * k + sp.dof;
    if (!core.isConstrained[gi]) addForce(sp.nodeId, sp.dof, -sp.k * d[gi]);
  }
  const globalEquilibrium = {
    sumF: tf as [number, number, number], sumM: tm as [number, number, number], scale: fScale,
    ok: fScale === 0 || (tf.every((v) => Math.abs(v) <= EQ_TOL * fScale * 10) && tm.every((v) => Math.abs(v) <= EQ_TOL * fScale * 10 * lScale)),
  };
  return { ...base, globalEquilibrium };
}

/**
 * Deformed centerline of a 3D member: cubic Hermite in both bending planes (w′ = −θy),
 * linear axial, using member-end values, scaled by `scale`.
 */
export function deformedMember3D(a: Analysis3D, e: ElementResult3D, scale: number, nPts = 21) {
  const ni = a.model.nodes[e.nodeI - 1];
  const { L, ex, ey, ez } = e.orientation;
  const [u1, v1, w1, , ty1, tz1, u2, v2, w2, , ty2, tz2] = e.dLocal;
  const undeformed: { x: number; y: number; z: number }[] = [];
  const deformed: { x: number; y: number; z: number }[] = [];
  for (let p = 0; p < nPts; p++) {
    const s = p / (nPts - 1);
    const N1 = 1 - 3 * s * s + 2 * s ** 3, N2 = s - 2 * s * s + s ** 3, N3 = 3 * s * s - 2 * s ** 3, N4 = -(s * s) + s ** 3;
    const u = (1 - s) * u1 + s * u2;
    const v = N1 * v1 + N2 * L * tz1 + N3 * v2 + N4 * L * tz2;
    const w = N1 * w1 - N2 * L * ty1 + N3 * w2 - N4 * L * ty2;
    const lx = s * L;
    undeformed.push({ x: ni.x + lx * ex[0], y: ni.y + lx * ex[1], z: ni.z + lx * ex[2] });
    const px = lx + scale * u, py = scale * v, pz = scale * w;
    deformed.push({
      x: ni.x + px * ex[0] + py * ey[0] + pz * ez[0],
      y: ni.y + px * ex[1] + py * ey[1] + pz * ez[1],
      z: ni.z + px * ex[2] + py * ey[2] + pz * ez[2],
    });
  }
  return { undeformed, deformed };
}
