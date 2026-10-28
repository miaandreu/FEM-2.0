import type { Dimension, EndRelease, FemModel, UnitSystemId } from './types';
import { dofsPerNode } from './dof';
import { UNIT_SYSTEMS } from './units';

/**
 * JSON import/export and URL-hash sharing. Output is canonical (fixed key order,
 * fixed array order) so identical models always serialize to identical bytes.
 */

const num = (v: unknown, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);

function release(r: unknown): EndRelease {
  const o = (r ?? {}) as Record<string, unknown>;
  return { rx: o.rx === true, ry: o.ry === true, rz: o.rz === true };
}

/** Rebuild a model with canonical key order. Does not validate values (see validateModel). */
export function canonicalize(m: FemModel): FemModel {
  return {
    schemaVersion: 1,
    name: m.name,
    dimension: m.dimension,
    units: m.units,
    nodes: m.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, z: n.z })),
    materials: m.materials.map((x) => {
      const o: FemModel['materials'][number] = { id: x.id, name: x.name, E: x.E };
      if (x.G !== undefined) o.G = x.G;
      if (x.nu !== undefined) o.nu = x.nu;
      return o;
    }),
    sections: m.sections.map((s) => ({ id: s.id, name: s.name, A: s.A, Iz: s.Iz, Iy: s.Iy, J: s.J })),
    elements: m.elements.map((e) => {
      const o: FemModel['elements'][number] = {
        id: e.id,
        nodeI: e.nodeI,
        nodeJ: e.nodeJ,
        materialId: e.materialId,
        sectionId: e.sectionId,
        releaseI: { rx: e.releaseI.rx, ry: e.releaseI.ry, rz: e.releaseI.rz },
        releaseJ: { rx: e.releaseJ.rx, ry: e.releaseJ.ry, rz: e.releaseJ.rz },
      };
      if (e.refVector) o.refVector = [e.refVector[0], e.refVector[1], e.refVector[2]];
      if (e.rollAngleDeg !== undefined) o.rollAngleDeg = e.rollAngleDeg;
      return o;
    }),
    supports: m.supports.map((s) => ({ nodeId: s.nodeId, fixed: [...s.fixed], prescribed: [...s.prescribed] })),
    springs: m.springs.map((s) => ({ nodeId: s.nodeId, dof: s.dof, k: s.k })),
    nodalLoads: m.nodalLoads.map((l) => ({ nodeId: l.nodeId, dof: l.dof, value: l.value })),
    elementLoads: m.elementLoads.map((l) => ({
      elementId: l.elementId,
      kind: l.kind,
      coordSys: l.coordSys,
      axis: l.axis,
      w1: l.w1,
      w2: l.w2,
    })),
  };
}

export function modelToJson(m: FemModel): string {
  return JSON.stringify(canonicalize(m), null, 2);
}

export interface ParseResult {
  model: FemModel | null;
  /** Structural problems that made the file unusable (value-level problems come from validateModel). */
  errors: string[];
}

/**
 * Parse untrusted JSON (file contents, URL hash payload) into a FemModel.
 * Structure is checked strictly; missing optional fields get defaults; numeric
 * values are NOT range-checked here so the validator can explain them to the user.
 */
export function parseModel(input: string | unknown): ParseResult {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { model: null, errors: [`This is not valid JSON: ${(e as Error).message}`] };
    }
  }
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { model: null, errors: ['The file must contain a JSON object.'] };
  const o = raw as Record<string, unknown>;

  if (o.schemaVersion !== 1) errors.push(`Unsupported schemaVersion ${JSON.stringify(o.schemaVersion)} (this tool reads version 1).`);
  if (o.dimension !== '2D' && o.dimension !== '3D') errors.push('"dimension" must be "2D" or "3D".');
  if (typeof o.units !== 'string' || !(o.units in UNIT_SYSTEMS)) errors.push(`"units" must be one of: ${Object.keys(UNIT_SYSTEMS).join(', ')}.`);

  const arr = (key: string): Record<string, unknown>[] => {
    const v = o[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      errors.push(`"${key}" must be a list.`);
      return [];
    }
    const rows: Record<string, unknown>[] = [];
    v.forEach((r, i) => {
      if (typeof r !== 'object' || r === null || Array.isArray(r)) errors.push(`${key}[${i}] must be an object.`);
      else rows.push(r as Record<string, unknown>);
    });
    return rows;
  };
  const required = (rows: Record<string, unknown>[], key: string, fields: string[]) => {
    rows.forEach((r, i) => {
      for (const f of fields) if (typeof r[f] !== 'number') errors.push(`${key}[${i}] is missing the number "${f}".`);
    });
  };

  const nodes = arr('nodes');
  const materials = arr('materials');
  const sections = arr('sections');
  const elements = arr('elements');
  const supports = arr('supports');
  const springs = arr('springs');
  const nodalLoads = arr('nodalLoads');
  const elementLoads = arr('elementLoads');
  required(nodes, 'nodes', ['id', 'x', 'y']);
  required(materials, 'materials', ['id', 'E']);
  required(sections, 'sections', ['id', 'A']);
  required(elements, 'elements', ['id', 'nodeI', 'nodeJ', 'materialId', 'sectionId']);
  required(supports, 'supports', ['nodeId']);
  required(springs, 'springs', ['nodeId', 'dof', 'k']);
  required(nodalLoads, 'nodalLoads', ['nodeId', 'dof', 'value']);
  required(elementLoads, 'elementLoads', ['elementId']);
  supports.forEach((s, i) => {
    if (!Array.isArray(s.fixed) || !s.fixed.every((b) => typeof b === 'boolean')) errors.push(`supports[${i}].fixed must be a list of true/false values.`);
    if (!Array.isArray(s.prescribed) || !s.prescribed.every((v) => typeof v === 'number')) errors.push(`supports[${i}].prescribed must be a list of numbers.`);
  });
  if (errors.length) return { model: null, errors };

  const dim = o.dimension as Dimension;
  const k = dofsPerNode(dim);
  const model: FemModel = {
    schemaVersion: 1,
    name: typeof o.name === 'string' ? o.name : 'Untitled',
    dimension: dim,
    units: o.units as UnitSystemId,
    nodes: nodes.map((n) => ({ id: n.id as number, x: n.x as number, y: n.y as number, z: num(n.z) })),
    materials: materials.map((m) => {
      const out: FemModel['materials'][number] = { id: m.id as number, name: typeof m.name === 'string' ? m.name : `Material ${m.id}`, E: m.E as number };
      if (typeof m.G === 'number') out.G = m.G;
      if (typeof m.nu === 'number') out.nu = m.nu;
      return out;
    }),
    sections: sections.map((s) => ({
      id: s.id as number,
      name: typeof s.name === 'string' ? s.name : `Section ${s.id}`,
      A: s.A as number,
      Iz: num(s.Iz ?? s.I),
      Iy: num(s.Iy, num(s.Iz ?? s.I)),
      J: num(s.J),
    })),
    elements: elements.map((e) => {
      const out: FemModel['elements'][number] = {
        id: e.id as number,
        nodeI: e.nodeI as number,
        nodeJ: e.nodeJ as number,
        materialId: e.materialId as number,
        sectionId: e.sectionId as number,
        releaseI: release(e.releaseI),
        releaseJ: release(e.releaseJ),
      };
      const rv = e.refVector;
      if (Array.isArray(rv) && rv.length === 3 && rv.every((v) => typeof v === 'number')) out.refVector = [rv[0], rv[1], rv[2]];
      if (typeof e.rollAngleDeg === 'number') out.rollAngleDeg = e.rollAngleDeg;
      return out;
    }),
    supports: supports.map((s) => ({ nodeId: s.nodeId as number, fixed: s.fixed as boolean[], prescribed: s.prescribed as number[] })),
    springs: springs.map((s) => ({ nodeId: s.nodeId as number, dof: s.dof as number, k: s.k as number })),
    nodalLoads: nodalLoads.map((l) => ({ nodeId: l.nodeId as number, dof: l.dof as number, value: l.value as number })),
    elementLoads: elementLoads.map((l) => ({
      elementId: l.elementId as number,
      kind: l.kind === 'linear' ? 'linear' : 'uniform',
      coordSys: l.coordSys === 'global' ? 'global' : 'local',
      axis: l.axis === 'x' || l.axis === 'z' ? (l.axis as 'x' | 'z') : 'y',
      w1: num(l.w1),
      w2: num(l.w2, num(l.w1)),
    })),
  };
  // Support arrays of the wrong length are left for validateModel to report; just avoid crashing here.
  void k;
  return { model, errors: [] };
}

// ---- URL hash ----------------------------------------------------------

const HASH_PREFIX = '#m=';

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Compact (unindented) canonical JSON, base64url-encoded, as a "#m=..." hash. */
export function modelToHash(m: FemModel): string {
  return HASH_PREFIX + toBase64Url(JSON.stringify(canonicalize(m)));
}

export function modelFromHash(hash: string): ParseResult {
  if (!hash.startsWith(HASH_PREFIX)) return { model: null, errors: ['This link does not contain a model.'] };
  try {
    return parseModel(fromBase64Url(hash.slice(HASH_PREFIX.length)));
  } catch {
    return { model: null, errors: ['The model in this link is damaged and could not be read.'] };
  }
}
