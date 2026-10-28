import { describe, expect, it } from 'vitest';
import {
  NO_RELEASE,
  canonicalize,
  describeDof,
  dofLabel,
  dofLabelTex,
  dofTable,
  elementIdArray,
  emptyModel,
  globalDof,
  hasErrors,
  isPlausibleModulus,
  makeSupport,
  modelFromHash,
  modelToHash,
  modelToJson,
  parseModel,
  renumberModel,
  resolveShearModulus,
  splitDof,
  supportPresetFlags,
  validateModel,
  type FemModel,
} from './index';
import { cantilever2D } from '../test/fixtures';
import schema from '../../schema/model.schema.json';

const codes = (m: FemModel) => validateModel(m).map((i) => i.code);
const el = (id: number, a: number, b: number) => ({ id, nodeI: a, nodeJ: b, materialId: 1, sectionId: 1, releaseI: { ...NO_RELEASE }, releaseJ: { ...NO_RELEASE } });

describe('DOF numbering', () => {
  it('numbers 2D DOFs (n-1)*3+1 .. n*3', () => {
    expect(globalDof(1, 0, '2D')).toBe(1);
    expect(globalDof(3, 0, '2D')).toBe(7);
    expect(globalDof(3, 2, '2D')).toBe(9);
    expect(splitDof(8, '2D')).toEqual({ nodeId: 3, local: 1 });
  });
  it('numbers 3D DOFs (n-1)*6+1 .. n*6', () => {
    expect(globalDof(2, 0, '3D')).toBe(7);
    expect(globalDof(2, 5, '3D')).toBe(12);
    expect(splitDof(12, '3D')).toEqual({ nodeId: 2, local: 5 });
  });
  it('builds element ID arrays (node i then node j)', () => {
    expect(elementIdArray({ nodeI: 2, nodeJ: 3 }, '2D')).toEqual([4, 5, 6, 7, 8, 9]);
    expect(elementIdArray({ nodeI: 1, nodeJ: 3 }, '3D')).toEqual([1, 2, 3, 4, 5, 6, 13, 14, 15, 16, 17, 18]);
  });
  it('labels DOFs like the textbook', () => {
    expect(dofLabel(2, 0, '2D')).toBe('d2x');
    expect(dofLabel(2, 2, '2D')).toBe('φ2');
    expect(dofLabel(4, 3, '3D')).toBe('φ4x');
    expect(dofLabelTex(4, 1, '2D')).toBe('d_{4y}');
    expect(describeDof(11, '2D')).toBe('d4y (node 4, y-translation)');
  });
  it('produces a DOF table', () => {
    const t = dofTable(cantilever2D());
    expect(t).toHaveLength(2);
    expect(t[1].dofs.map((d) => d.global)).toEqual([4, 5, 6]);
  });
});

describe('support presets', () => {
  it('2D presets', () => {
    expect(supportPresetFlags('2D', 'fixed')).toEqual([true, true, true]);
    expect(supportPresetFlags('2D', 'pinned')).toEqual([true, true, false]);
    expect(supportPresetFlags('2D', 'roller-x')).toEqual([false, true, false]);
    expect(supportPresetFlags('2D', 'roller-y')).toEqual([true, false, false]);
    expect(supportPresetFlags('2D', 'roller-z')).toBeNull();
  });
  it('3D presets', () => {
    expect(supportPresetFlags('3D', 'fixed')).toEqual(Array(6).fill(true));
    expect(supportPresetFlags('3D', 'pinned')).toEqual([true, true, true, false, false, false]);
    expect(supportPresetFlags('3D', 'roller-z')).toEqual([true, true, false, false, false, false]);
    expect(makeSupport('3D', 4, 'pinned').prescribed).toEqual(Array(6).fill(0));
  });
});

describe('validateModel', () => {
  it('accepts a good model with no errors', () => {
    expect(hasErrors(validateModel(cantilever2D()))).toBe(false);
  });
  it('catches missing/empty basics', () => {
    expect(codes(emptyModel('2D'))).toEqual(expect.arrayContaining(['NO_NODES', 'NO_ELEMENTS', 'NO_SUPPORTS']));
  });
  it('catches zero-length elements and duplicate nodes', () => {
    const m = cantilever2D();
    m.nodes[1] = { id: 2, x: 0, y: 0, z: 0 };
    expect(codes(m)).toEqual(expect.arrayContaining(['DUPLICATE_NODE', 'ELEMENT_ZERO_LENGTH']));
  });
  it('catches elements with missing nodes/material/section and same-node elements', () => {
    const m = cantilever2D();
    m.elements.push(el(2, 2, 9));
    m.elements.push({ ...el(3, 1, 1), materialId: 7, sectionId: 8 });
    expect(codes(m)).toEqual(expect.arrayContaining(['ELEMENT_MISSING_NODE', 'ELEMENT_SAME_NODES', 'ELEMENT_MISSING_MATERIAL', 'ELEMENT_MISSING_SECTION']));
  });
  it('catches non-positive E, A, I, J', () => {
    const m = cantilever2D();
    m.materials[0].E = 0;
    m.sections[0].A = -1;
    m.sections[0].Iz = 0;
    expect(codes(m)).toEqual(expect.arrayContaining(['E_NOT_POSITIVE', 'SECTION_NOT_POSITIVE']));
    const m3 = cantilever2D();
    m3.dimension = '3D';
    m3.sections[0].J = 0;
    expect(validateModel(m3).filter((i) => i.code === 'SECTION_NOT_POSITIVE')).toHaveLength(1);
  });
  it('warns about an unconnected node, and about implausible E for the unit system', () => {
    const m = cantilever2D();
    m.nodes.push({ id: 3, x: 5, y: 5, z: 0 });
    m.units = 'lb-in';
    const c = codes(m);
    expect(c).toContain('NODE_UNCONNECTED');
    expect(c).toContain('E_IMPLAUSIBLE'); // 2e8 psi is not steel
    expect(isPlausibleModulus(30e6, 'lb-in')).toBe(true);
    expect(isPlausibleModulus(200e9, 'N-m')).toBe(true);
    expect(isPlausibleModulus(200e3, 'N-mm')).toBe(true);
    expect(isPlausibleModulus(30e6, 'N-mm')).toBe(false);
  });
  it('reports no supports and too few restraints', () => {
    const m = cantilever2D();
    m.supports = [];
    expect(codes(m)).toContain('NO_SUPPORTS');
    m.supports = [makeSupport('2D', 1, 'pinned')];
    expect(codes(m)).toContain('TOO_FEW_RESTRAINTS');
    m.supports = [makeSupport('2D', 1, 'pinned'), makeSupport('2D', 2, 'roller-x')];
    expect(codes(m)).not.toContain('TOO_FEW_RESTRAINTS');
  });
  it('catches bad support/load/spring references and DOFs', () => {
    const m = cantilever2D();
    m.supports.push({ nodeId: 9, fixed: [true, true, true], prescribed: [0, 0, 0] });
    m.supports.push({ nodeId: 1, fixed: [true], prescribed: [0] });
    m.nodalLoads.push({ nodeId: 1, dof: 5, value: 1 }, { nodeId: 7, dof: 0, value: 1 });
    m.springs.push({ nodeId: 2, dof: 1, k: -3 });
    m.elementLoads.push({ elementId: 4, kind: 'uniform', coordSys: 'local', axis: 'z', w1: 1, w2: 1 });
    expect(codes(m)).toEqual(
      expect.arrayContaining(['SUPPORT_MISSING_NODE', 'SUPPORT_DUPLICATE', 'SUPPORT_BAD_LENGTH', 'LOAD_BAD_DOF', 'LOAD_MISSING_NODE', 'SPRING_NOT_POSITIVE', 'ELOAD_MISSING_ELEMENT', 'ELOAD_BAD_AXIS']),
    );
  });
  it('gives an info note for a load on a restrained DOF', () => {
    const m = cantilever2D();
    m.nodalLoads.push({ nodeId: 1, dof: 0, value: 5 });
    expect(codes(m)).toContain('LOAD_ON_RESTRAINED_DOF');
    expect(hasErrors(validateModel(m))).toBe(false);
  });
  it('requires contiguous ids', () => {
    const m = cantilever2D();
    m.nodes[1].id = 5;
    expect(codes(m)).toContain('ID_NOT_CONTIGUOUS');
  });
  it('rejects a 3D reference vector parallel to the member', () => {
    const m = cantilever2D();
    m.dimension = '3D';
    m.supports = [makeSupport('3D', 1, 'fixed')];
    m.nodalLoads = [];
    m.elements[0].refVector = [1, 0, 0];
    expect(codes(m)).toContain('REF_VECTOR_PARALLEL');
    m.elements[0].refVector = [0, 0, 1];
    expect(codes(m)).not.toContain('REF_VECTOR_PARALLEL');
  });
  it('writes student-friendly messages', () => {
    const m = cantilever2D();
    m.supports = [];
    const msg = validateModel(m).find((i) => i.code === 'NO_SUPPORTS')!.message;
    expect(msg).toMatch(/no supports/i);
  });
});

describe('shear modulus', () => {
  it('prefers G, then nu, then the default', () => {
    expect(resolveShearModulus({ id: 1, name: '', E: 200, G: 80 })).toEqual({ G: 80, source: 'G' });
    expect(resolveShearModulus({ id: 1, name: '', E: 200, nu: 0.25 })).toEqual({ G: 80, source: 'nu' });
    const d = resolveShearModulus({ id: 1, name: '', E: 260 });
    expect(d.source).toBe('default-nu');
    expect(d.G).toBeCloseTo(100, 12);
  });
});

describe('renumberModel', () => {
  it('closes gaps and remaps every reference', () => {
    const m = cantilever2D();
    m.nodes.push({ id: 3, x: 4, y: 0, z: 0 });
    m.elements.push(el(2, 2, 3));
    m.nodalLoads.push({ nodeId: 3, dof: 1, value: -1 });
    m.elementLoads.push({ elementId: 2, kind: 'uniform', coordSys: 'local', axis: 'y', w1: -2, w2: -2 });
    // delete node 2 and the element that used it (element 1 too since it ends on node 2)
    m.nodes = m.nodes.filter((n) => n.id !== 2);
    const r = renumberModel(m);
    expect(r.nodes.map((n) => n.id)).toEqual([1, 2]);
    expect(r.elements).toHaveLength(0); // both elements touched node 2
    expect(r.elementLoads).toHaveLength(0);
    expect(r.nodalLoads).toEqual([{ nodeId: 2, dof: 1, value: -1 }]);
  });
  it('keeps valid elements and renumbers them', () => {
    const m = cantilever2D();
    m.nodes.push({ id: 3, x: 4, y: 0, z: 0 });
    m.elements.push(el(2, 2, 3));
    m.elementLoads.push({ elementId: 2, kind: 'uniform', coordSys: 'local', axis: 'y', w1: -2, w2: -2 });
    m.elements[0].id = 5; // gap
    const r = renumberModel(m);
    expect(r.elements.map((e) => e.id)).toEqual([1, 2]);
    expect(r.elementLoads[0].elementId).toBe(1);
    expect(validateModel(r).some((i) => i.code === 'ID_NOT_CONTIGUOUS')).toBe(false);
  });
});

describe('JSON and URL hash', () => {
  it('round-trips and is byte-identical', () => {
    const m = cantilever2D();
    const json = modelToJson(m);
    const back = parseModel(json);
    expect(back.errors).toEqual([]);
    expect(modelToJson(back.model!)).toBe(json);
    expect(modelToJson(canonicalize(m))).toBe(json);
  });
  it('canonical output does not depend on key insertion order', () => {
    const m = cantilever2D();
    const shuffled = JSON.parse(JSON.stringify(m));
    shuffled.nodes = shuffled.nodes.map((n: Record<string, number>) => ({ z: n.z, y: n.y, x: n.x, id: n.id }));
    expect(modelToJson(parseModel(shuffled).model!)).toBe(modelToJson(m));
  });
  it('round-trips through the URL hash, including non-ASCII names', () => {
    const m = cantilever2D();
    m.name = 'Pórtico – ünïcode θ';
    const h = modelToHash(m);
    expect(h.startsWith('#m=')).toBe(true);
    expect(h).toMatch(/^#m=[A-Za-z0-9_-]+$/);
    const back = modelFromHash(h);
    expect(back.errors).toEqual([]);
    expect(back.model!.name).toBe(m.name);
    expect(modelToJson(back.model!)).toBe(modelToJson(m));
  });
  it('survives a large model in the hash', () => {
    const m = cantilever2D();
    for (let i = 3; i <= 800; i++) m.nodes.push({ id: i, x: i, y: 0, z: 0 });
    expect(modelFromHash(modelToHash(m)).model!.nodes).toHaveLength(800);
  });
  it('reports structural problems in plain language', () => {
    expect(parseModel('not json').errors[0]).toMatch(/not valid JSON/);
    expect(parseModel('[]').errors[0]).toMatch(/object/);
    expect(parseModel({ schemaVersion: 2, dimension: '4D', units: 'furlongs' }).errors.length).toBeGreaterThanOrEqual(3);
    const bad = JSON.parse(modelToJson(cantilever2D()));
    delete bad.nodes[0].x;
    expect(parseModel(bad).errors.join(' ')).toMatch(/nodes\[0\].*"x"/);
    expect(modelFromHash('#nothing').model).toBeNull();
    expect(modelFromHash('#m=%%%').model).toBeNull();
  });
  it('JSON schema agrees with the serializer on required keys and enums', () => {
    const json = JSON.parse(modelToJson(cantilever2D()));
    for (const key of schema.required) expect(json).toHaveProperty(key);
    expect(schema.properties.units.enum).toContain(json.units);
    expect(schema.properties.dimension.enum).toContain(json.dimension);
    for (const key of Object.keys(json)) expect(schema.properties).toHaveProperty(key);
  });
});
