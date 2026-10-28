import type { FemModel, Material, ValidationIssue } from './types';
import { dofsPerNode, dofWords } from './dof';
import { UNIT_SYSTEMS, isPlausibleModulus, plausibleModulusRange } from './units';

/** Default Poisson's ratio used when a 3D material gives neither G nor nu. */
export const DEFAULT_POISSON = 0.3;

/** Shear modulus of a material: G if given, else E / (2(1+nu)). */
export function resolveShearModulus(m: Material): { G: number; source: 'G' | 'nu' | 'default-nu' } {
  if (m.G !== undefined) return { G: m.G, source: 'G' };
  if (m.nu !== undefined) return { G: m.E / (2 * (1 + m.nu)), source: 'nu' };
  return { G: m.E / (2 * (1 + DEFAULT_POISSON)), source: 'default-nu' };
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Check a model for problems a student can fix. Never throws; returns every issue
 * found (errors block analysis, warnings and infos do not). Mechanism / singularity
 * detection that needs the stiffness matrix lives in the solver, not here.
 */
export function validateModel(model: FemModel): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const add = (i: ValidationIssue) => out.push(i);
  const dim = model.dimension;
  const k = dofsPerNode(dim);

  if (dim !== '2D' && dim !== '3D') add({ severity: 'error', code: 'BAD_DIMENSION', table: 'model', message: `Dimension must be "2D" or "3D" (got "${String(dim)}").` });
  if (!UNIT_SYSTEMS[model.units]) add({ severity: 'error', code: 'BAD_UNITS', table: 'model', message: `Unknown unit system "${String(model.units)}".` });

  // ---- ids -------------------------------------------------------------
  const contiguous = (rows: { id: number }[], table: ValidationIssue['table'], what: string) => {
    const seen = new Set<number>();
    let dup = false;
    for (const r of rows) {
      if (seen.has(r.id)) {
        dup = true;
        add({ severity: 'error', code: 'DUPLICATE_ID', table, id: r.id, message: `Two ${what}s have the same number ${r.id}. Each ${what} needs its own number.` });
      }
      seen.add(r.id);
    }
    if (!dup) {
      const sorted = [...rows].sort((a, b) => a.id - b.id);
      sorted.forEach((r, i) => {
        if (r.id !== i + 1) {
          add({ severity: 'error', code: 'ID_NOT_CONTIGUOUS', table, id: r.id, message: `${what[0].toUpperCase() + what.slice(1)} numbers must run 1, 2, 3, … without gaps (found ${r.id} where ${i + 1} was expected). Renumber the ${what}s.` });
        }
      });
    }
  };
  contiguous(model.nodes, 'nodes', 'node');
  contiguous(model.materials, 'materials', 'material');
  contiguous(model.sections, 'sections', 'section');
  contiguous(model.elements, 'elements', 'element');

  if (model.nodes.length === 0) add({ severity: 'error', code: 'NO_NODES', table: 'nodes', message: 'The model has no nodes. Add at least two nodes to define a member.' });
  if (model.elements.length === 0) add({ severity: 'error', code: 'NO_ELEMENTS', table: 'elements', message: 'The model has no elements. Connect two nodes with an element.' });

  // ---- nodes -----------------------------------------------------------
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  for (const n of model.nodes) {
    if (!fin(n.x) || !fin(n.y) || !fin(n.z)) add({ severity: 'error', code: 'NODE_NOT_FINITE', table: 'nodes', id: n.id, message: `Node ${n.id} has a coordinate that is not a number.` });
    else if (dim === '2D' && n.z !== 0) add({ severity: 'warning', code: 'NODE_Z_IGNORED', table: 'nodes', id: n.id, message: `Node ${n.id} has z = ${n.z}, but 2D models are planar; z is ignored.` });
  }
  for (let i = 0; i < model.nodes.length; i++) {
    for (let j = i + 1; j < model.nodes.length; j++) {
      const a = model.nodes[i];
      const b = model.nodes[j];
      if (a.x === b.x && a.y === b.y && (dim === '2D' || a.z === b.z)) {
        add({ severity: 'error', code: 'DUPLICATE_NODE', table: 'nodes', id: b.id, message: `Nodes ${a.id} and ${b.id} are at the same location. Delete one and connect the elements to the other.` });
      }
    }
  }

  // ---- materials & sections -------------------------------------------
  const matById = new Map(model.materials.map((m) => [m.id, m]));
  const secById = new Map(model.sections.map((s) => [s.id, s]));
  for (const m of model.materials) {
    if (!fin(m.E) || m.E <= 0) {
      add({ severity: 'error', code: 'E_NOT_POSITIVE', table: 'materials', id: m.id, message: `Material ${m.id}: Young's modulus E must be a positive number.` });
    } else if (UNIT_SYSTEMS[model.units] && !isPlausibleModulus(m.E, model.units)) {
      const r = plausibleModulusRange(model.units);
      add({ severity: 'warning', code: 'E_IMPLAUSIBLE', table: 'materials', id: m.id, message: `Material ${m.id}: E = ${m.E} looks unusual for ${UNIT_SYSTEMS[model.units].label} (typical structural materials are about ${r.min.toExponential(1)} to ${r.max.toExponential(1)} ${UNIT_SYSTEMS[model.units].stress}). Check your units.` });
    }
    if (dim === '3D') {
      if (m.G !== undefined && (!fin(m.G) || m.G <= 0)) add({ severity: 'error', code: 'G_NOT_POSITIVE', table: 'materials', id: m.id, message: `Material ${m.id}: shear modulus G must be positive.` });
      else if (m.G === undefined && m.nu !== undefined && (!fin(m.nu) || m.nu <= -1 || m.nu >= 0.5)) add({ severity: 'error', code: 'NU_OUT_OF_RANGE', table: 'materials', id: m.id, message: `Material ${m.id}: Poisson's ratio must be between -1 and 0.5.` });
      else if (m.G === undefined && m.nu === undefined) add({ severity: 'info', code: 'G_DEFAULTED', table: 'materials', id: m.id, message: `Material ${m.id}: neither G nor ν given; using ν = ${DEFAULT_POISSON}, so G = E / (2(1+ν)).` });
    }
  }
  for (const s of model.sections) {
    const pos = (v: unknown, name: string) => {
      if (!fin(v) || v <= 0) add({ severity: 'error', code: 'SECTION_NOT_POSITIVE', table: 'sections', id: s.id, message: `Section ${s.id}: ${name} must be a positive number.` });
    };
    pos(s.A, 'area A');
    pos(s.Iz, dim === '2D' ? 'moment of inertia I' : 'moment of inertia Iz');
    if (dim === '3D') {
      pos(s.Iy, 'moment of inertia Iy');
      pos(s.J, 'torsion constant J');
    }
  }

  // ---- elements --------------------------------------------------------
  const used = new Set<number>();
  const pairSeen = new Map<string, number>();
  const sizeScale = Math.max(1e-300, ...model.nodes.map((n) => Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z))));
  for (const e of model.elements) {
    const ni = nodeById.get(e.nodeI);
    const nj = nodeById.get(e.nodeJ);
    if (!ni) add({ severity: 'error', code: 'ELEMENT_MISSING_NODE', table: 'elements', id: e.id, message: `Element ${e.id} refers to node ${e.nodeI}, which does not exist.` });
    if (!nj) add({ severity: 'error', code: 'ELEMENT_MISSING_NODE', table: 'elements', id: e.id, message: `Element ${e.id} refers to node ${e.nodeJ}, which does not exist.` });
    if (!matById.has(e.materialId)) add({ severity: 'error', code: 'ELEMENT_MISSING_MATERIAL', table: 'elements', id: e.id, message: `Element ${e.id} uses material ${e.materialId}, which does not exist.` });
    if (!secById.has(e.sectionId)) add({ severity: 'error', code: 'ELEMENT_MISSING_SECTION', table: 'elements', id: e.id, message: `Element ${e.id} uses section ${e.sectionId}, which does not exist.` });
    if (e.nodeI === e.nodeJ) add({ severity: 'error', code: 'ELEMENT_SAME_NODES', table: 'elements', id: e.id, message: `Element ${e.id} starts and ends at node ${e.nodeI}. An element needs two different nodes.` });
    used.add(e.nodeI);
    used.add(e.nodeJ);
    if (ni && nj && e.nodeI !== e.nodeJ) {
      const dx = nj.x - ni.x;
      const dy = nj.y - ni.y;
      const dz = dim === '3D' ? nj.z - ni.z : 0;
      const L = Math.hypot(dx, dy, dz);
      if (L <= 1e-12 * sizeScale) {
        add({ severity: 'error', code: 'ELEMENT_ZERO_LENGTH', table: 'elements', id: e.id, message: `Element ${e.id} has zero length (nodes ${e.nodeI} and ${e.nodeJ} coincide).` });
      } else if (dim === '3D' && e.refVector) {
        const rv = e.refVector;
        if (!rv.every(fin) || Math.hypot(rv[0], rv[1], rv[2]) === 0) {
          add({ severity: 'error', code: 'REF_VECTOR_INVALID', table: 'elements', id: e.id, message: `Element ${e.id}: the reference vector must be three numbers and not all zero.` });
        } else {
          const cx = [dy * rv[2] - dz * rv[1], dz * rv[0] - dx * rv[2], dx * rv[1] - dy * rv[0]];
          if (Math.hypot(cx[0], cx[1], cx[2]) <= 1e-9 * L * Math.hypot(rv[0], rv[1], rv[2])) {
            add({ severity: 'error', code: 'REF_VECTOR_PARALLEL', table: 'elements', id: e.id, message: `Element ${e.id}: the reference vector is parallel to the member axis, so it cannot define the local y–z plane. Choose a different vector.` });
          }
        }
      }
    }
    if (dim === '2D' && (e.releaseI.rx || e.releaseI.ry || e.releaseJ.rx || e.releaseJ.ry)) {
      add({ severity: 'warning', code: 'RELEASE_IGNORED_2D', table: 'elements', id: e.id, message: `Element ${e.id}: only the moment release (rz) applies in 2D; the others are ignored.` });
    }
    if (dim === '2D' && (e.refVector || e.rollAngleDeg)) {
      add({ severity: 'warning', code: 'ORIENTATION_IGNORED_2D', table: 'elements', id: e.id, message: `Element ${e.id}: reference vector / roll angle are ignored in 2D.` });
    }
    if (e.rollAngleDeg !== undefined && !fin(e.rollAngleDeg)) add({ severity: 'error', code: 'ROLL_NOT_FINITE', table: 'elements', id: e.id, message: `Element ${e.id}: roll angle must be a number.` });
    const key = [Math.min(e.nodeI, e.nodeJ), Math.max(e.nodeI, e.nodeJ)].join('-');
    if (pairSeen.has(key)) add({ severity: 'warning', code: 'ELEMENT_DUPLICATE', table: 'elements', id: e.id, message: `Elements ${pairSeen.get(key)} and ${e.id} connect the same two nodes. Is that intentional?` });
    else pairSeen.set(key, e.id);
  }
  for (const n of model.nodes) {
    if (!used.has(n.id)) add({ severity: 'warning', code: 'NODE_UNCONNECTED', table: 'nodes', id: n.id, message: `Node ${n.id} is not connected to any element, so it is left out of the analysis.` });
  }

  // ---- supports --------------------------------------------------------
  const supportNodes = new Set<number>();
  let restrained = 0;
  model.supports.forEach((s, idx) => {
    if (!nodeById.has(s.nodeId)) add({ severity: 'error', code: 'SUPPORT_MISSING_NODE', table: 'supports', id: idx + 1, message: `Support ${idx + 1} is on node ${s.nodeId}, which does not exist.` });
    if (supportNodes.has(s.nodeId)) add({ severity: 'error', code: 'SUPPORT_DUPLICATE', table: 'supports', id: idx + 1, message: `Node ${s.nodeId} has more than one support entry. Combine them into one.` });
    supportNodes.add(s.nodeId);
    if (s.fixed.length !== k || s.prescribed.length !== k) {
      add({ severity: 'error', code: 'SUPPORT_BAD_LENGTH', table: 'supports', id: idx + 1, message: `Support ${idx + 1} must list ${k} DOF flags and ${k} prescribed values for a ${dim} model.` });
      return;
    }
    s.fixed.forEach((f, d) => {
      if (f) restrained++;
      if (!f && s.prescribed[d] !== 0) add({ severity: 'warning', code: 'PRESCRIBED_ON_FREE', table: 'supports', id: idx + 1, message: `Support ${idx + 1}: a displacement is entered for the ${dofWords(dim)[d]} of node ${s.nodeId}, but that DOF is free, so the value is ignored.` });
      if (!fin(s.prescribed[d])) add({ severity: 'error', code: 'PRESCRIBED_NOT_FINITE', table: 'supports', id: idx + 1, message: `Support ${idx + 1}: prescribed value for ${dofWords(dim)[d]} must be a number.` });
    });
  });
  const springRestraints = model.springs.length;
  const needed = dim === '2D' ? 3 : 6;
  if (restrained === 0 && springRestraints === 0) {
    add({ severity: 'error', code: 'NO_SUPPORTS', table: 'supports', message: 'The structure has no supports. Without supports it can move freely (rigid-body motion). Add at least one support, e.g. a fixed support.' });
  } else if (restrained + springRestraints < needed) {
    add({ severity: 'error', code: 'TOO_FEW_RESTRAINTS', table: 'supports', message: `A ${dim} structure needs at least ${needed} restrained degrees of freedom to prevent rigid-body motion, but only ${restrained + springRestraints} are restrained. Add supports.` });
  }

  // ---- springs ---------------------------------------------------------
  model.springs.forEach((s, idx) => {
    if (!nodeById.has(s.nodeId)) add({ severity: 'error', code: 'SPRING_MISSING_NODE', table: 'springs', id: idx + 1, message: `Spring ${idx + 1} is on node ${s.nodeId}, which does not exist.` });
    if (!Number.isInteger(s.dof) || s.dof < 0 || s.dof >= k) add({ severity: 'error', code: 'SPRING_BAD_DOF', table: 'springs', id: idx + 1, message: `Spring ${idx + 1}: DOF must be one of the ${k} DOFs of a ${dim} node.` });
    if (!fin(s.k) || s.k <= 0) add({ severity: 'error', code: 'SPRING_NOT_POSITIVE', table: 'springs', id: idx + 1, message: `Spring ${idx + 1}: stiffness must be a positive number.` });
  });

  // ---- loads -----------------------------------------------------------
  model.nodalLoads.forEach((l, idx) => {
    if (!nodeById.has(l.nodeId)) add({ severity: 'error', code: 'LOAD_MISSING_NODE', table: 'nodalLoads', id: idx + 1, message: `Load ${idx + 1} is on node ${l.nodeId}, which does not exist.` });
    if (!Number.isInteger(l.dof) || l.dof < 0 || l.dof >= k) add({ severity: 'error', code: 'LOAD_BAD_DOF', table: 'nodalLoads', id: idx + 1, message: `Load ${idx + 1}: DOF must be one of the ${k} DOFs of a ${dim} node.` });
    if (!fin(l.value)) add({ severity: 'error', code: 'LOAD_NOT_FINITE', table: 'nodalLoads', id: idx + 1, message: `Load ${idx + 1}: the value must be a number.` });
    const sup = model.supports.find((s) => s.nodeId === l.nodeId);
    if (sup && sup.fixed[l.dof]) add({ severity: 'info', code: 'LOAD_ON_RESTRAINED_DOF', table: 'nodalLoads', id: idx + 1, message: `Load ${idx + 1} acts on a restrained DOF of node ${l.nodeId}; it goes straight into the reaction and causes no displacement.` });
  });
  const elById = new Set(model.elements.map((e) => e.id));
  model.elementLoads.forEach((l, idx) => {
    if (!elById.has(l.elementId)) add({ severity: 'error', code: 'ELOAD_MISSING_ELEMENT', table: 'elementLoads', id: idx + 1, message: `Distributed load ${idx + 1} is on element ${l.elementId}, which does not exist.` });
    if (l.axis !== 'x' && l.axis !== 'y' && l.axis !== 'z') add({ severity: 'error', code: 'ELOAD_BAD_AXIS', table: 'elementLoads', id: idx + 1, message: `Distributed load ${idx + 1}: direction must be x, y or z.` });
    else if (dim === '2D' && l.axis === 'z') add({ severity: 'error', code: 'ELOAD_BAD_AXIS', table: 'elementLoads', id: idx + 1, message: `Distributed load ${idx + 1}: a 2D model has no z-direction loads.` });
    if (!fin(l.w1) || !fin(l.w2)) add({ severity: 'error', code: 'ELOAD_NOT_FINITE', table: 'elementLoads', id: idx + 1, message: `Distributed load ${idx + 1}: intensities must be numbers.` });
  });

  return out;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
